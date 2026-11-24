export const HIPER_OS_ORIGIN = "https://app.hiper-os.au";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value, limit) => {
  if (/[\u0000-\u001f\u007f]/u.test(value ?? "")) return "";
  const result = value?.trim() ?? "";
  return result.length <= limit ? result : "";
};

export function readOsLaunch({ search, hash, referrer, hasOpener }) {
  const designId = new URLSearchParams(search).get("osDesign");
  if (!hasOpener || !UUID.test(designId ?? "")) return null;
  try { if (new URL(referrer).origin !== HIPER_OS_ORIGIN) return null; }
  catch { return null; }
  const params = new URLSearchParams(hash.slice(1));
  const revision = params.get("drawingRevision");
  if (!/^[1-9]\d{0,8}$/.test(revision ?? "")) return null;
  const quoteNumber = clean(params.get("quoteNumber"), 80);
  const name = clean(params.get("osReference")?.replace(/ · Design Rev [1-9]\d{0,8}$/u, ""), 120);
  return { designId: designId.toLowerCase(), name: name || quoteNumber || "HiPer OS drawing", quoteNumber, revision };
}

export async function osProjectIdentity(workspaceId, designId, subtle = globalThis.crypto.subtle) {
  if (!UUID.test(workspaceId) || !UUID.test(designId)) throw new TypeError("Invalid HiPer OS project destination.");
  const digest = new Uint8Array(await subtle.digest("SHA-256",
    new TextEncoder().encode(`hiper-studio:os-design:v1:${workspaceId.toLowerCase()}:${designId.toLowerCase()}`)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
  const recordId = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  return { recordId, projectId: `os-design-${designId.toLowerCase()}` };
}

export function matchesOsProject(value, identity, workspaceId) {
  const record = value?.record ?? value?.cloudRecord;
  return Boolean(record && record.id === identity.recordId && record.workspace_id === workspaceId
    && record.project_id === identity.projectId && value.project?.id === identity.projectId);
}

export async function openOrCreateOsProject({store, identity, workspaceId, userId, name, makeProject}) {
  const {recordId, projectId}=identity;
  const open = async record => {
    const loaded = await store.open(record);
    if (!matchesOsProject(loaded,identity,workspaceId)) throw new Error("HiPer OS drawing identity did not match.");
    return loaded;
  };
  const existing=await store.find(workspaceId, recordId);
  if(existing) return {...await open(existing), created:false};
  const project=makeProject(projectId);
  try {
    const {record}=await store.save({project,name,workspaceId,userId,newRecordId:recordId});
    const loaded={project,name,record};
    if (!matchesOsProject(loaded,identity,workspaceId)) throw new Error("HiPer OS drawing identity did not match.");
    return {...loaded,created:true};
  } catch(error) {
    // A second tab or a lost acknowledgement may have already committed the same
    // identity. Re-open that one; never fall back to a random project or update it.
    const winner=await store.find(workspaceId, recordId).catch(()=>null);
    if(winner) return {...await open(winner),created:false};
    throw error;
  }
}
