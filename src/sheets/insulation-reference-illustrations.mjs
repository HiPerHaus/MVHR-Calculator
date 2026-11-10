// Re-drawn from HiPer Haus - Your MVHR Guide V1, page 4, "Where the ducts go".
// These are alternative thermal-envelope concepts, not material or sizing specifications.
const INK = "#52616a";

export function renderInsulationReferenceIllustration(arrangement) {
  if (!["service-zone", "insulation-cover"].includes(arrangement)) {
    throw new TypeError(`Unknown insulation arrangement: ${arrangement}`);
  }
  const serviceZone = arrangement === "service-zone";
  const out = [`<g data-illustration="insulation-${arrangement}" data-visual-basis="owner-mvhr-guide-page-4" stroke-linejoin="round">`,
    `<title>${serviceZone ? "Dropped ceiling / service zone" : "Ducts protected by insulation"}</title>`];
  if (serviceZone) {
    // Insulated construction above a separate, internal service void.
    out.push(insulation(2, 3, 54, 15),
      `<g data-source-feature="ceiling-structure">${box(2, 3, 5, 15, "#e1d5c0")}${box(51, 3, 5, 15, "#e1d5c0")}${box(2, 18, 54, 2, "#e9edef")}</g>`,
      `<g data-source-feature="internal-service-zone">${box(2, 20, 54, 16, "#ffffff")}</g>`);
  } else {
    // The continuous top and side insulation cover the group, not each pipe
    // as an isolated wrap. The open front is a section through the ducts.
    out.push(`<g data-source-feature="continuous-insulation-cover">`,
      insulation(2, 3, 54, 19.5), insulation(2, 22.5, 7, 13.5), insulation(49, 22.5, 7, 13.5), "</g>");
  }
  out.push(`<g data-source-feature="three-parallel-ducts">`);
  for (const x of [16, 29, 42]) {
    out.push(`<g data-duct-section="distribution-duct">${circle(x, 29, 6.5, "#f5f6f6")}${circle(x, 29, 5.2, "white")}</g>`);
  }
  out.push("</g>",
    `<g data-source-feature="finished-ceiling-lining">${box(2, 36, 54, 2, "#e2e8eb")}</g>`,
    `<text x="29" y="12" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="2.8" fill="#243b46">Ceiling insulation</text>`,
    `<text x="29" y="43" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="2.8" fill="#243b46">Ceiling lining</text>`,
    "</g>");
  return out.join("");
}

function insulation(x, y, w, h) {
  const out = [box(x, y, w, h, "#f0e4ce")];
  // A simple batt hatch identifies the continuous insulation layer without
  // claiming a particular material, thickness or R-value.
  for (let xx = x + 1.5; xx < x + w - 1; xx += 4) {
    for (let yy = y + 1.5; yy < y + h - 1; yy += 4) {
      out.push(`<path d="M${xx} ${yy + 1.5} q1 -2 2 0" fill="none" stroke="#b7a17c" stroke-width=".2"/>`);
    }
  }
  return `<g data-source-feature="ceiling-insulation">${out.join("")}</g>`;
}
function box(x, y, w, h, fill) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${INK}" stroke-width=".25"/>`;
}
function circle(x, y, r, fill) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width=".3"/>`;
}
