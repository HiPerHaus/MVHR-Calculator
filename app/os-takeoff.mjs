export function createOsTakeoff(rows, record, optionId, scope) {
  const first = rows[0];
  if (!first || !record?.id || !record.save_version || !optionId) throw new Error("Save the selected Studio design before sending.");
  const items = [];
  const issues = [];
  for (const row of rows) {
    const context = [row.floorName, row.ref, row.description].filter(Boolean).join(" · ");
    if (["unresolved", "selection"].includes(row.kind)) { issues.push(context); continue; }
    if (row.kind !== "part") continue;
    const value = String(row.quantity ?? "").trim();
    if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
      issues.push(context + " · quantity to confirm");
      continue;
    }
    if (Number(value) === 0) continue;
    items.push({
      description: row.description, quantity: Number(value), unit: row.unit,
      partNumber: row.partNumber || null,
      notes: [row.floorName, row.section, row.basis, row.review].filter(Boolean).join(" · ")
    });
  }
  return {
    kind: "hiper_studio_quote_parts", schemaVersion: 1,
    projectId: record.id, revision: JSON.stringify([record.save_version, optionId, scope]),
    items, issues
  };
}
