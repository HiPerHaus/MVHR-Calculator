import { escapeXml, wrapSheetText } from "./a3-sheet.mjs";
import { renderInstallReferenceIllustration } from "./install-reference-illustrations.mjs";
import { renderInsulationReferenceIllustration } from "./insulation-reference-illustrations.mjs";

// These sheets are reference annotations, not project engineering inputs.
// Only the labelled dimensions in the owner sources are specified values.
export function renderInstallationDetailSheetSvg(sheet, { pageNumber = 2, totalPageCount = 3 } = {}) {
  const { widthMm: width, heightMm: height } = sheet.page;
  const m = sheet.metadata, details = sheet.installationDetails;
  const gap = 4, x = 10, top = 43, contentWidth = width - 20;
  const cardWidth = (contentWidth - gap * 2) / 3;
  const cardHeight = (height - 20 - top - gap - 10) / 2;
  const lowerY = top + cardHeight + gap;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="Installation details for ${escapeXml(m.drawingId)}">`,
    '<rect width="100%" height="100%" fill="white"/>',
    rect(10, 10, width - 20, height - 20),
    text(15, 19, "INSTALLATION DETAILS", 5.5, 'font-weight="700"'),
    ...lines(`${m.projectName} · ${sheet.printScene.floorName}`, 15, 26, width - 30, 3.2, 2),
    ...lines(`${m.drawingId} / DETAILS · Revision ${m.revision} · ${m.issueDate} · ${m.drawingTitle}`, 15, 35, width - 30, 2.8, 1),
    text(15, 40, "Dimensions in mm · Reference sections NTS · Read with the preceding plan", 2.8),
  ];
  const box = (column, y = top, w = cardWidth) => ({ x: x + column * (cardWidth + gap), y, w, h: cardHeight });
  out.push(referenceCard(details.cards.find(c => c.id === "ceiling-tva"), "01", box(0)),
    referenceCard(details.cards.find(c => c.id === "wall-housing"), "02", box(1)),
    insulationCard(box(2)));
  const equipment = details.cards.filter(c => !["ceiling-tva", "wall-housing", "equipment-notes"].includes(c.id));
  equipment.forEach((card, i) => out.push(referenceCard(card, String(i + 4).padStart(2, "0"), box(i, lowerY))));
  if (equipment.length < 3) {
    const start = equipment.length;
    out.push(coordinationCard(details, box(start, lowerY, contentWidth - start * (cardWidth + gap))));
  }
  if (details.unmatchedComponentIds.length) out.push(text(15, height - 21, `${details.unmatchedComponentIds.length} other unit(s): matching assembly reference required. Verify exact model, mounting and CW arrangement.`, 2.5));
  out.push(text(15, height - 14, "Owner reference drawings supplied 09 Nov 2026. Confirm current manufacturer instructions and exact arrangement.", 2.5),
    text(12, height - 4, m.status, 2.5),
    text(width - 12, height - 4, `Page ${pageNumber} of ${totalPageCount} · A3`, 2.5, 'text-anchor="end"'), "</svg>");
  return out.join("");
}

function referenceCard(card, number, b) {
  const scale = Math.min(1.6, (b.w - 12) / 59, (b.h - 43) / 60);
  const artX = b.x + (b.w - 58 * scale) / 2, artY = b.y + 13;
  const notes = {
    "ceiling-tva": ["128 horizontal × 140 vertical (mm).", "Finished body flush with plasterboard face. Leave proud at first fix; trim after plastering.", "Source section dimensions only. Not a cutout specification."],
    "wall-housing": ["120 horizontal · 115 inner · 140 overall (mm).", "AeroFresh grille housing · Ø90 duct spigot.", "120, 115 and 140 follow source endpoints, not cutout or face sizes."],
    "q-cw320": ["Assembly envelope excludes service clearances. Drain space: not dimensioned.", "Wiring source unreadable. Original drawing required."],
    "af-cw520": ["Assembly envelope + 150 drain. Source suggests 700 cabinetry; not service clearance.", "Wiring: original diagram required; fine labels not transcribed."],
    "af300-remote": ["Source dimension arrows are blank. Assembly dimensions required.", "Bare-unit dimensions are not the assembled installation size."],
  }[card.id];
  const body = [panelStart(b, `${number}  ${card.title}`, card.id, card.source),
    `<g transform="translate(${artX} ${artY}) scale(${scale})">${renderInstallReferenceIllustration(card.id)}</g>`,
    `<g data-role="detail-notes">${paragraphs(notes, b, b.y + b.h - 25)}</g>`, "</g>"];
  return body.join("");
}

function insulationCard(b) {
  const sideBySide = b.w >= 110;
  const cellWidth = sideBySide ? (b.w - 12) / 2 : b.w - 8;
  const scale = Math.min(1, cellWidth / 58);
  const artHeight = 44 * scale;
  const rowHeight = artHeight + 12;
  const sections = [
    ["service-zone", "Dropped ceiling / service zone"],
    ["insulation-cover", "Ducts protected by insulation"],
  ];
  const diagrams = sections.map(([arrangement, label], i) => {
    const cellX = b.x + 4 + (sideBySide ? i * (cellWidth + 4) : 0);
    const labelY = b.y + 16 + (sideBySide ? 0 : i * rowHeight);
    const artX = cellX + (cellWidth - 58 * scale) / 2;
    return lines(label, cellX, labelY, cellWidth, 2.6, 2).join("")
      + `<g transform="translate(${artX} ${labelY + 6}) scale(${scale})">${renderInsulationReferenceIllustration(arrangement)}</g>`;
  }).join("");
  const notesY = b.y + (sideBySide ? 73 : 16 + rowHeight * 2 + 1);
  return [panelStart(b, "03  Ducts within thermal envelope", "insulation-concept", "owner-mvhr-guide-v1-page-4"),
    '<g data-evidence-boundary="concept-not-project-specification">', diagrams, "</g>",
    `<g data-role="detail-notes">${paragraphs([
      "Guide p. 4: alternative ceiling arrangements (NTS).",
      "Keep ducts inside the thermal envelope, below continuous insulation or fully covered by the insulation strategy.",
      "Project material, thickness, R-value and vapour-control detail: not specified.",
      "Seal airtight-layer penetrations; external ducts need specified insulation.",
    ], b, notesY)}</g>`, "</g>"].join("");
}

function coordinationCard(details, b) {
  const messages = [
    ...(details.unmatchedComponentIds.length ? [`${details.unmatchedComponentIds.length} other unit(s) on this floor: no supplied assembly matches. Obtain the exact model, mounting and CW arrangement drawing.`] : []),
    ...(details.cards.some(c => c.id === "equipment-notes") && !details.unmatchedComponentIds.length ? ["No matching central unit on this floor. Terminal sections are general references."] : []),
    "Assembly envelopes are not service clearances. Confirm access, supports, condensate arrangement and manufacturer installation requirements.",
    ...(details.hasQ ? ["Q-series wiring source unreadable. Original wiring drawing required; no terminals or cable ratings have been inferred."] : details.hasAeroFresh ? ["Electrical installation: use the current model-specific original wiring diagram. Fine labels have not been transcribed."] : ["Electrical installation: use the current model-specific manufacturer instructions."]),
    "Source: owner-supplied installation drawings, 09 Nov 2026. Schematics are references only and do not change model geometry or parts quantities.",
    "Project insulation specification is not supplied. This sheet is preliminary, not installation approval.",
  ];
  return panelStart(b, "COORDINATION / SOURCE NOTES", "coordination-notes", "selection-status") + paragraphs(messages, b, b.y + 17) + "</g>";
}

function panelStart(b, title, id, source) {
  return `<g data-kind="installation-detail" data-detail-id="${id}" data-source="${source}">${rect(b.x,b.y,b.w,b.h)}${lines(title,b.x+4,b.y+6,b.w-8,3,2).join("")}`;
}
function paragraphs(values, b, startY) {
  let y = startY;
  return values.map(value => {
    const result = lines(value, b.x + 4, y, b.w - 8, 2.6, 20);
    y += result.length * 3.5 + 2;
    return result.join("");
  }).join("");
}
function lines(value, x, y, width, size, maxLines) {
  return wrapSheetText(value, Math.floor(width / (size * .51)), maxLines).map((line, i) => text(x, y + i * (size + .9), line, size));
}
function rect(x, y, w, h) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#687880" stroke-width=".25"/>`; }
function text(x, y, value, size = 2.6, attrs = "") { return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="#243b46" ${attrs}>${escapeXml(String(value))}</text>`; }
