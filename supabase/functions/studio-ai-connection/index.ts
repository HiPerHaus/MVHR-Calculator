// Configured with deployment secrets. Only workspace administrators can test a provider.
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
  const endpoint = openAI ? "https://api.openai.com/v1/models" : "https://api.anthropic.com/v1/models";
  const auth: Record<string,string> = openAI ? { Authorization: "Bearer " + key } : { "x-api-key": key, "anthropic-version": "2023-06-01" };
  try {
    const response = await fetch(endpoint, { headers: auth, signal: AbortSignal.timeout(10000), redirect: "error" });
    await response.body?.cancel();
    return response.ok ? reply(200, "Provider connection verified.") : reply(502, "Provider connection failed. Check the workspace key and access.");
  } catch { return reply(502, "Provider could not be reached."); }
});
