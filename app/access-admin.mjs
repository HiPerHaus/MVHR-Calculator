import { createAccessAdminStore } from "../src/persistence/studio-access.mjs";

export function initializeAccessAdmin(client, state) {
  const store = createAccessAdminStore(client);
  const section = document.querySelector("#access-admin-card");
  const pendingList = document.querySelector("#access-pending-list");
  const memberList = document.querySelector("#access-member-list");
  const pendingSection = document.querySelector("#access-pending-section");
  const status = document.querySelector("#access-admin-status");
  let revision = 0;

  async function load() {
    const current = ++revision;
    section.hidden = true;
    pendingList.replaceChildren();
    memberList.replaceChildren();
    if (!state.workspace || !state.user) return;
    status.textContent = "Checking user-management permission…";
    try {
      const capabilities = await store.capabilities(state.workspace.id, state.user.id);
      if (current !== revision) return;
      if (!capabilities.platformAdmin && !capabilities.canManageMembers) {
        status.textContent = "";
        return;
      }
      section.hidden = false;
      pendingSection.hidden = !capabilities.platformAdmin;
      const [members, pending] = await Promise.all([
        store.members(state.workspace.id),
        capabilities.platformAdmin ? store.pending() : Promise.resolve([]),
      ]);
      if (current !== revision) return;
      renderMembers(members, capabilities);
      renderPending(pending);
      status.textContent = "Access changes are checked by server-side roles. Suspended users retain no project access.";
    } catch (error) {
      if (current !== revision) return;
      section.hidden = false;
      status.textContent = `User management unavailable: ${error.message}`;
    }
  }

  function renderPending(records) {
    pendingList.replaceChildren();
    if (!records.length) return pendingList.append(message("No pending verified access requests."));
    for (const record of records) {
      const row = document.createElement("div"); row.className = "access-user-row";
      const details = document.createElement("div");
      details.append(label(record.full_name || record.email), message(`${record.email} · ${record.company_name}`));
      const role = document.createElement("select");
      role.innerHTML = '<option value="member">Member</option><option value="admin">Company admin</option>';
      role.setAttribute("aria-label", `Role for ${record.email}`);
      const approve = action("Approve", async () => {
        await store.approve({ userId: record.user_id, workspaceId: state.workspace.id, role: role.value });
        await load();
      });
      row.append(details, role, approve); pendingList.append(row);
    }
  }

  function renderMembers(records, capabilities) {
    memberList.replaceChildren();
    for (const record of records) {
      const row = document.createElement("div"); row.className = "access-user-row";
      const details = document.createElement("div");
      details.append(label(record.email || record.user_id), message(`${displayRole(record.role)} · ${record.status}`));
      row.append(details);
      const canChange = record.user_id !== state.user.id && canManageTarget(capabilities, record.role);
      if (canChange) row.append(action(record.status === "active" ? "Suspend" : "Reactivate", async () => {
        await store.setStatus({ userId: record.user_id, workspaceId: state.workspace.id, status: record.status === "active" ? "suspended" : "active" });
        await load();
      }));
      memberList.append(row);
    }
  }

  return { load };

  function action(text, handler) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = text;
    button.addEventListener("click", async () => {
      button.disabled = true; status.textContent = `${text} in progress…`;
      try { await handler(); }
      catch (error) { status.textContent = error.message; button.disabled = false; }
    });
    return button;
  }
}

function canManageTarget(capabilities, targetRole) {
  if (capabilities.platformAdmin) return true;
  if (capabilities.role === "owner") return targetRole !== "owner";
  return capabilities.role === "admin" && targetRole === "member";
}

function displayRole(role) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Company admin";
  return "Member";
}

function label(value) { const element = document.createElement("strong"); element.textContent = value; return element; }
function message(value) { const element = document.createElement("span"); element.textContent = value; return element; }
