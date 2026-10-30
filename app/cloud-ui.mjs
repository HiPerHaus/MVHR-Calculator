import { initializeCompanyAccount } from "./company-account.mjs";
import { initializeAccessAdmin } from "./access-admin.mjs";
import { clearStudioGate, establishStudioGate } from "./auth-client.mjs";
import { createReturnAccessVerifier } from "./protected-lifecycle.mjs";
import { createCloudProjectStore } from "../src/persistence/cloud-project-store.mjs";
import { verifyStudioAccess } from "../src/persistence/studio-access.mjs";
import { filterVentilationProjectEntries, ventilationProjectTypeLabel } from "../src/domain/ventilation-project-type.mjs";

export function initializeCloudUI({ client, initialAccess, onChange, onOpen, beforeSignOut, onSignedOut, onAccount, onAccessLost }) {
  if (!client || initialAccess?.state !== "approved") throw new TypeError("Verified Studio access is required");
  const store = createCloudProjectStore(client);
  const state = { user: null, workspace: null, workspaces: [], membership: null, store, loading: true, companyProfile: null };
  const company = initializeCompanyAccount(client, state, onChange);
  const accessAdmin = initializeAccessAdmin(client, state);
  state.openAccount = () => { onAccount(); company.load(); };
  const account = document.querySelector("#account-button");
  const dialog = document.querySelector("#signin-dialog");
  const error = document.querySelector("#signin-error");
  const signedIn = document.querySelector("#signed-in-account");
  const out = document.querySelector("#signout-button");
  const projects = document.querySelector("#cloud-projects-dialog");
  const list = document.querySelector("#cloud-projects-list");
  const listStatus = document.querySelector("#cloud-projects-status");
  const projectTypeFilter = document.querySelector("#project-type-filter");
  const text = (tag, value) => { const element = document.createElement(tag); element.textContent = value; return element; };
  let revision = 0;
  let cloudProjects = [];

  const notify = () => {
    account.textContent = "Account";
    signedIn.textContent = state.user ? `${state.user.email} · ${state.workspace?.name ?? "No approved workspace"}` : "";
    document.querySelector("#cloud-projects-button").disabled = state.loading;
    document.querySelector("#projects-signin").hidden = true;
    onChange(state);
    if (projects.open && !state.loading) showProjects();
  };

  async function applyAccess(access) {
    const current = ++revision;
    state.loading = true;
    state.user = access.user;
    state.companyProfile = null;
    const available = access.memberships.filter((membership) => membership.workspace);
    state.workspaces = available.map((membership) => membership.workspace);
    state.workspace = state.workspaces[0] ?? null;
    state.membership = available[0] ?? null;
    company.render();
    notify();
    if (!state.workspace) return loseAccess("access-not-approved");
    try { await Promise.all([company.load(), accessAdmin.load()]); }
    catch (cause) { if (current === revision) error.textContent = cause.message; }
    if (current !== revision) return;
    state.loading = false;
    notify();
  }

  async function refreshVerified(session = null) {
    const access = await verifyStudioAccess(client);
    if (access.state !== "approved") return loseAccess(access.state);
    if (!session) {
      const current = await client.auth.getSession();
      if (current.error || !current.data.session) return loseAccess("signed-out");
      session = current.data.session;
    }
    await establishStudioGate(session);
    await applyAccess(access);
  }

  function loseAccess(reason) {
    revision++;
    state.loading = false;
    state.user = null;
    state.workspace = null;
    state.workspaces = [];
    state.membership = null;
    notify();
    onAccessLost(reason);
  }

  account.addEventListener("click", () => state.openAccount());
  document.querySelector("#account-page-signin").hidden = true;
  document.querySelector("#account-page-signout").addEventListener("click", () => out.click());
  document.querySelector("#close-signin").addEventListener("click", () => dialog.close());
  out.addEventListener("click", async () => {
    error.textContent = "";
    out.disabled = true;
    try {
      await beforeSignOut();
      await clearStudioGate();
      const result = await client.auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
      onSignedOut();
    } catch (cause) {
      error.textContent = cause.message;
      document.querySelector("#company-status").textContent = cause.message;
      out.disabled = false;
    }
  });
  document.querySelector("#close-cloud-projects").addEventListener("click", () => projects.close());

  function renderProjectRows() {
    list.replaceChildren();
    const filter=projectTypeFilter.value;
    const shown=filterVentilationProjectEntries(cloudProjects,filter);
    if(cloudProjects.length===0) {
      listStatus.textContent="No saved projects yet. Import a drawing backup or start a new project.";
      return;
    }
    listStatus.textContent=shown.length
      ? `Choose a drawing to open. ${shown.length} of ${cloudProjects.length} shown.`
      : `No ${ventilationProjectTypeLabel(filter).toLowerCase()} cloud projects match this filter.`;
    for (const entry of shown) {
      const {record}=entry;
      const row = text("div", ""); row.className = "cloud-project-row";
      const copy = text("div", "");
      const badge=text("span",entry.ventilationDesignType==="unavailable"?"Type unavailable":ventilationProjectTypeLabel(entry.ventilationDesignType));
      badge.className=`project-type-badge ${entry.ventilationDesignType}`;
      if(entry.conflictsWithContent) badge.title="Selected project type conflicts with saved ventilation content";
      copy.append(text("strong", record.name),badge,text("small", `Saved ${new Date(record.updated_at).toLocaleString()} · version ${record.save_version}`));
      const open = text("button", "Open"); open.type = "button";
      open.addEventListener("click", async () => {
        open.disabled = true; listStatus.textContent = "Opening cloud drawing…";
        try {
          const loaded = await store.open(record);
          if (state.user?.id !== entry.userId) throw new Error("Account changed; cloud drawing was not opened");
          projects.close(); onOpen(loaded);
        } catch (cause) { listStatus.textContent = cause.message; }
        finally { open.disabled = false; }
      });
      row.append(copy, open); list.append(row);
    }
  }

  projectTypeFilter.addEventListener("change",renderProjectRows);

  async function showProjects() {
    if (!projects.open) projects.showModal();
    list.replaceChildren();
    if (state.loading) { listStatus.textContent = "Checking account access…"; return; }
    if (!state.workspace) { listStatus.textContent = "No approved workspace is available."; return; }
    listStatus.textContent = "Loading projects…";
    const userId = state.user.id;
    try {
      const records = await store.list(state.workspace.id);
      if (state.user?.id !== userId) return;
      if(!records.length) { cloudProjects=[]; renderProjectRows(); return; }
      listStatus.textContent="Reading project types…";
      cloudProjects=await Promise.all(records.map(async(record)=>{
        try { return {record,userId,...await store.describe(record)}; }
        catch { return {record,userId,ventilationDesignType:"unavailable",contentType:"unavailable",conflictsWithContent:false}; }
      }));
      if (state.user?.id !== userId) return;
      renderProjectRows();
    } catch (cause) { listStatus.textContent = cause.message; }
  }

  document.querySelector("#cloud-projects-button").addEventListener("click", showProjects);
  const verifyAfterReturn = createReturnAccessVerifier(() => refreshVerified());
  const revalidateReturnedPage = () => verifyAfterReturn().catch(() => loseAccess("verification-failed"));
  window.addEventListener("focus", revalidateReturnedPage);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revalidateReturnedPage();
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") return setTimeout(() => loseAccess("signed-out"), 0);
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      setTimeout(() => refreshVerified(session).catch(() => loseAccess("verification-failed")), 0);
    }
  });
  queueMicrotask(() => applyAccess(initialAccess).catch(() => loseAccess("verification-failed")));
  return state;
}
