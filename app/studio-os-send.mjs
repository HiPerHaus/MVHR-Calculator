import {studioHiperOsEnabled} from "./studio-integration-settings.mjs";
import {createOsTakeoff} from "./os-takeoff.mjs";

const osOrigin = "https://app.hiper-os.au";
export function attachOsSendBack({button, client, snapshot, status, referenceButton, applyReference}) {
  const target = new URLSearchParams(location.search).get("osDesign");
  if (!target || !/^[0-9a-f-]{36}$/i.test(target) || !window.opener) return;
  const reference = new URLSearchParams(location.hash.slice(1)).get("osReference");
  if (reference) {
    button.textContent = `Send back to HiPer OS · ${reference.slice(0, 150)}`;
  }
  const fields = new URLSearchParams(location.hash.slice(1));
  const quote = fields.get("quoteNumber")?.trim();
  const revision = fields.get("drawingRevision");
  const hasReference = Boolean(quote && quote.length <= 80 && /^[1-9]\d{0,8}$/.test(revision ?? ""));
  if (referenceButton && hasReference) {
    referenceButton.textContent = `Use ${quote} · Rev ${revision}`;
    referenceButton.addEventListener("click", async () => {
      const workspace = snapshot()?.workspaceId;
      if (workspace && await studioHiperOsEnabled(client, workspace).catch(() => false)) applyReference(quote, revision);
    });
  }
  let busy = false;
  async function refresh() {
    const state = snapshot();
    button.hidden = true;
    if (referenceButton) referenceButton.hidden = true;
    if (!state?.workspaceId) return;
    try {
      if (await studioHiperOsEnabled(client, state.workspaceId)) {
        button.hidden = false;
        if (referenceButton) referenceButton.hidden = !hasReference;
      }
    } catch { /* Standalone editing remains available when settings cannot load. */ }
  }
  window.addEventListener("focus", refresh);
  window.addEventListener("studio-integration-updated", refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(document.querySelector("#sheet-preview-host"), {childList:true});
  refresh();
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      const state = snapshot();
      if (!state?.record || !state.ready) throw new Error("Save the drawing and select one export option before sending.");
      const payload = createOsTakeoff(state.rows(), state.record, state.optionId, state.scope);
      const result = await client.rpc("studio_issue_os_takeoff", {
        p_project:state.record.id, p_version:state.record.save_version,
        p_design:target, p_schedule:payload
      });
      if (result.error || !result.data) throw new Error("Send failed. Check the workspace setting and reopen the latest saved drawing.");
      window.opener.postMessage({type:"hiper-studio-takeoff",designId:target,receipt:result.data},osOrigin);
      status.textContent = "Takeoff prepared. Return to the HiPer OS tab to check the import result.";
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; button.disabled = false; }
  });
}
