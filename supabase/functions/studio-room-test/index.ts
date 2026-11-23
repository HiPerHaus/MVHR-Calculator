// Opt-in experiment for explicitly enabled test workspaces.
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async request => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (request.method === "OPTIONS") return new Response(null, { headers });
  const reply = (status: number, message: string) => Response.json({ message }, { status, headers });
  if (request.method !== "POST") return reply(405, "Use POST.");
  const authorization = request.headers.get("authorization");
  if (!authorization) return reply(401, "Sign in to Studio.");
  const input = await request.json().catch(() => null);
  if (!input || typeof input.workspaceId !== "string" || !["openai", "anthropic"].includes(input.provider)) return reply(400, "Choose a workspace and provider.");
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return reply(401, "Sign in to Studio.");
  const member = await client.from("studio_memberships").select("role").eq("workspace_id", input.workspaceId).eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (!["owner", "admin"].includes(member.data?.role)) return reply(403, "Workspace administrator access required.");
  // Scope every secret to its workspace, including on shared Studio deployments.
  const openAI = input.provider === "openai";
  const name = (openAI ? "OPENAI" : "ANTHROPIC") + "_API_KEY_" + input.workspaceId.replaceAll("-", "_").toUpperCase();
  const key = Deno.env.get(name);
  if (!key) return reply(409, "Add the workspace provider key to Studio server secrets first.");
  const allowed = (Deno.env.get("STUDIO_ROOM_TEST_WORKSPACES") || "").split(",").map(id => id.trim());
  if (!allowed.includes(input.workspaceId)) return reply(403, "Enable this test workspace first.");
  const image = input.image;
  if (typeof image !== "string" || image.length > 3500000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image)) return reply(400, "Invalid test image.");
  const model = Deno.env.get(openAI ? "STUDIO_ROOM_TEST_OPENAI_MODEL" : "STUDIO_ROOM_TEST_ANTHROPIC_MODEL");
  if (!model) return reply(409, "Configure a vision model for the test.");
  const roomIds: number[] | null = input.roomIds === undefined ? null : input.roomIds;
  if (input.roomIds !== undefined && (!Array.isArray(roomIds) || roomIds.length < 1 || roomIds.length > 120 ||
    !roomIds.every(id => Number.isInteger(id) && id >= 1 && id <= 120) ||
    new Set(roomIds).size !== roomIds.length)) return reply(400, "Invalid room identifiers.");
  const prompt = roomIds
    ? 'Read the architectural room names within the teal outlines for the numbered regions ' + roomIds.join(', ') +
      '. The teal numbers are references, not room names. Return only JSON {"labels":[{"id":1,"label":"exact printed room name"}]}. ' +
      'If the label is unclear, missing or several room labels occur inside a numbered region, omit that ID for human review. ' +
      'Do not use finish notes, furniture, cupboards, door tags or dimensions as room names. Never redraw a boundary or guess a ventilation role.'
    : 'Trace internal room polygons within the visible plan. Coordinates are fractions of the image width and height from its top left. Return only JSON {"rooms":[{"label":"printed name or Unlabelled","points":[[x,y],...]}]}. Use shared wall edges between adjoining rooms. Do not infer ventilation roles or invent rooms from fixtures. Ignore white space outside the plan.';
  const message = openAI ? [{type:"text",text:prompt},{type:"image_url",image_url:{url:image}}] : [{type:"text",text:prompt},{type:"image",source:{type:"base64",media_type:"image/jpeg",data:image.split(",")[1]}}];
  try {
    const response = await fetch(openAI ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/messages", {
      method:"POST", redirect:"error", signal:AbortSignal.timeout(90000),
      headers:openAI ? {"content-type":"application/json",Authorization:"Bearer "+key} : {"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model,messages:[{role:"user",content:message}],...(openAI ? {max_completion_tokens:4096,response_format:{type:"json_object"}} : {max_tokens:4096})})
    });
    if (!response.ok) return reply(502,"Provider could not analyse the plan.");
    const result = await response.json();
    const raw = openAI ? result.choices?.[0]?.message?.content : result.content?.find((item:{type:string})=>item.type==="text")?.text;
    const parsed = JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g,""));
    if (roomIds) {
      const ids = new Set(roomIds), used = new Set<number>();
      const labels = parsed?.labels;
      if (!Array.isArray(labels) || labels.length > roomIds.length || !labels.every(item => {
        if (!item || !ids.has(item.id) || used.has(item.id) ||
            typeof item.label !== "string" || !item.label.trim() || item.label.length > 150) return false;
        used.add(item.id);
        return true;
      })) return reply(502, "The provider returned invalid room labels.");
      const clean = labels.map(({id,label}) => ({id,label:label.trim()}));
      return Response.json({labels:clean},{headers});
    }
    const rooms = parsed?.rooms;
    if (!Array.isArray(rooms) || rooms.length > 120 || !rooms.every(r => r && typeof r.label === "string" && r.label.length <= 150 && Array.isArray(r.points) && r.points.length >= 3 && r.points.length <= 200 && r.points.every((p:unknown)=>Array.isArray(p) && p.length===2 && p.every(n=>Number.isFinite(n)&&n>=0&&n<=1)))) return reply(502,"The provider returned invalid room geometry.");
    return Response.json({rooms},{headers});
  } catch { return reply(502,"Room detection failed. Try again or choose another model."); }
});
