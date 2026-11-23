export async function studioHiperOsEnabled(client, workspaceId) {
  const result = await client.from("studio_workspace_integrations")
    .select("hiper_os_enabled").eq("workspace_id", workspaceId).maybeSingle();
  if (result.error) throw new Error("Could not read the HiPer OS integration setting.");
  return result.data?.hiper_os_enabled === true;
}

export async function setStudioHiperOsEnabled(client, workspaceId, enabled) {
  const result = await client.from("studio_workspace_integrations")
    .insert({ workspace_id: workspaceId, hiper_os_enabled: enabled });
  if (!result.error) return;
  if (result.error.code !== "23505") {
    throw new Error("Could not save the HiPer OS integration setting.");
  }
  const update = await client.from("studio_workspace_integrations")
    .update({ hiper_os_enabled: enabled }).eq("workspace_id", workspaceId)
    .select("hiper_os_enabled").single();
  if (update.error || update.data?.hiper_os_enabled !== enabled) {
    throw new Error("Could not save the HiPer OS integration setting.");
  }
}

export function mountStudioIntegrationSettings(client, memberships, host) {
  for (const membership of memberships) {
    if (membership.status !== "active" || !["owner", "admin"].includes(membership.role)) continue;
    const card = Object.assign(document.createElement("article"), { className: "workflow-card" });
    const heading = Object.assign(document.createElement("h2"), {
      textContent: `HiPer OS integration · ${membership.workspace?.name ?? "Workspace"}`
    });
    const label = document.createElement("label");
    const checkbox = Object.assign(document.createElement("input"), {
      type: "checkbox", disabled: true
    });
    label.append(checkbox, " Enable HiPer OS integration");
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Loading integration setting…";
    card.append(heading, label, status);
    host.append(card);
    const workspaceId = membership.workspaceId;
    const aiLabel = document.createElement("label");
    aiLabel.textContent = "AI provider ";
    const provider = document.createElement("select");
    provider.append(new Option("OpenAI", "openai"), new Option("Anthropic", "anthropic"));
    aiLabel.append(provider);
    const test = Object.assign(document.createElement("button"), { type: "button", textContent: "Test AI connection" });
    const aiStatus = document.createElement("p");
    aiStatus.setAttribute("role", "status");
    const showSetup = () => {
      aiStatus.textContent = "Server secret: " + provider.value.toUpperCase() + "_API_KEY_" + workspaceId.replaceAll("-", "_").toUpperCase();
    };
    showSetup();
    provider.addEventListener("change", showSetup);
    test.addEventListener("click", async () => {
      provider.disabled = test.disabled = true;
      aiStatus.textContent = "Testing provider connection…";
      try {
        const result = await client.functions.invoke("studio-ai-connection", { body: { workspaceId, provider: provider.value } });
        const errorDetail = result.error?.context;
        const detail = result.error && errorDetail instanceof Response ? await errorDetail.json().catch(() => null) : result.data;
        aiStatus.textContent = detail?.message ?? "Connection test unavailable.";
      } catch {
        aiStatus.textContent = "Connection test unavailable.";
      } finally {
        provider.disabled = test.disabled = false;
      }
    });
    card.append(aiLabel, test, aiStatus);
    let saved = false;
    studioHiperOsEnabled(client, workspaceId).then((enabled) => {
      saved = enabled;
      checkbox.checked = enabled;
      checkbox.disabled = false;
      status.textContent = "";
    }).catch((error) => {
      status.textContent = error.message;
    });
    checkbox.addEventListener("change", async () => {
      checkbox.disabled = true;
      try {
        await setStudioHiperOsEnabled(client, workspaceId, checkbox.checked);
        saved = checkbox.checked;
        window.dispatchEvent(new Event("studio-integration-updated"));
        status.textContent = "Integration setting saved.";
      } catch (error) {
        checkbox.checked = saved;
        status.textContent = error.message;
      } finally {
        checkbox.disabled = false;
      }
    });
  }
}
