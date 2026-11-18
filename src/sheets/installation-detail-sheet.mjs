import { hasQElectricalReference } from "./q-series-electrical-reference.mjs";
import { Q_SERIES_ELECTRICAL_IMAGE } from "./q-series-electrical-source.mjs";
import { escapeXml, wrapSheetText } from "./a3-sheet.mjs";
import { renderInstallReferenceIllustration } from "./install-reference-illustrations.mjs";
import { renderInsulationReferenceIllustration } from "./insulation-reference-illustrations.mjs";

const AEROFRESH_CONTROLS = [
  "AeroFresh 300 / 450 / 600 controls reference: 10 A GPO.",
  "Boost: low-voltage 2-core to SW1 via momentary switches in bathroom and WC, and in kitchen/laundry where an extract grille is fitted.",
];

const EQUIPMENT_CARDS_PER_PAGE = 3;
const isEquipmentCard = card => !["ceiling-tva", "wall-housing", "equipment-notes"].includes(card.id);
function installationLayout(sheet) {
  const equipmentCount = sheet.installationDetails.cards.filter(isEquipmentCard).length;
  const equipmentPages = Math.max(1, Math.ceil(equipmentCount / EQUIPMENT_CARDS_PER_PAGE));
  const hasQ = hasQElectricalReference(sheet);
  // A narrow one-column panel cannot hold the source legibly. Portrait sheets
  // also need a full-width continuation rather than shrinking the reference.
  const coordinationContinuation = hasQ && equipmentCount > 0 && (equipmentCount % EQUIPMENT_CARDS_PER_PAGE !== 1 || sheet.page.orientation === "portrait");
  return { hasQ, equipmentPages, coordinationContinuation, count: equipmentPages + Number(coordinationContinuation) };
}
export function createInstallationDetailPages(sheet, { firstPageNumber = 2, totalPageCount = null } = {}) {
  const count = sheet.metadata.systemScope === "decentralised" ? 1 : installationLayout(sheet).count;
  return Array.from({ length: count }, (_, index) => ({
    installationPageNumber: index + 1, installationPageCount: count,
    pageNumber: firstPageNumber + index,
    totalPageCount: totalPageCount ?? firstPageNumber + count - 1,
  }));
}

// These sheets are reference annotations, not project engineering inputs.
// Only the labelled dimensions in the owner sources are specified values.
export function renderInstallationDetailSheetSvg(sheet, { pageNumber = 2, totalPageCount = 3, installationPageNumber = 1 } = {}) {
  if (sheet.metadata.systemScope === "decentralised") return renderDecentralisedDetailSheet(sheet, { pageNumber, totalPageCount });
  const { widthMm: width, heightMm: height } = sheet.page;
  const m = sheet.metadata, details = sheet.installationDetails;
  const allEquipment = details.cards.filter(isEquipmentCard);
  const layout = installationLayout(sheet);
  const installationPageCount = layout.count;
  const coordinationOnly = layout.coordinationContinuation && installationPageNumber === installationPageCount;
  if (!Number.isInteger(installationPageNumber) || installationPageNumber < 1 || installationPageNumber > installationPageCount) throw new RangeError("Installation detail page is unavailable");
  const equipmentOffset = (installationPageNumber - 1) * EQUIPMENT_CARDS_PER_PAGE;
  const gap = 4, x = 10, top = 43, contentWidth = width - 20;
  const cardWidth = (contentWidth - gap * 2) / 3;
  const availableHeight = height - 30 - top - gap;
  const cardHeight = layout.hasQ && !layout.coordinationContinuation && sheet.page.orientation === "landscape" ? 104 : availableHeight / 2;
  const lowerHeight = availableHeight - cardHeight;
  const lowerY = top + cardHeight + gap;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="Installation details for ${escapeXml(m.drawingId)}">`,
    '<rect width="100%" height="100%" fill="white"/>',
    rect(10, 10, width - 20, height - 20),
    text(15, 19, `INSTALLATION DETAILS${installationPageCount > 1 ? ` · ${installationPageNumber} OF ${installationPageCount}` : ""}`, 5.5, 'font-weight="700"'),
    ...lines(`${m.projectName} · ${sheet.printScene.floorName}`, 15, 26, width - 30, 3.2, 2),
    ...lines(`${m.drawingId} / DETAILS · Revision ${m.revision} · ${m.issueDate} · ${m.drawingTitle}`, 15, 35, width - 30, 2.8, 1),
    text(15, 40, "Dimensions in mm · Reference sections NTS · Read with the corresponding plan", 2.8),
  ];
  const box = (column, y = top, w = cardWidth) => ({ x: x + column * (cardWidth + gap), y, w, h: y === top ? cardHeight : lowerHeight });
  if (coordinationOnly) {
    out.push(coordinationCard(details, {x:10,y:top,w:contentWidth,h:height-top-30}, true));
  } else {
  out.push(referenceCard(details.cards.find(c => c.id === "ceiling-tva"), "01", box(0)),
    referenceCard(details.cards.find(c => c.id === "wall-housing"), "02", box(1)),
    insulationCard(box(2)));
  const equipment = allEquipment.slice(equipmentOffset, equipmentOffset + EQUIPMENT_CARDS_PER_PAGE);
  equipment.forEach((card, i) => out.push(referenceCard(card, String(equipmentOffset + i + 4).padStart(2, "0"), box(i, lowerY), equipment.length === 3 && card.id === "af300-remote")));
  if (equipment.length < 3) {
    const start = equipment.length;
    out.push(coordinationCard(details, box(start, lowerY, contentWidth - start * (cardWidth + gap)), layout.hasQ && !layout.coordinationContinuation));
  }
  }
  if (details.unmatchedComponentIds.length) out.push(text(15, height - 21, `${details.unmatchedComponentIds.length} other unit(s): matching assembly reference required. Verify exact model, mounting and CW arrangement.`, 2.5));
  out.push(text(15, height - 14, "Owner reference drawings supplied 09, 17 and 18 Nov 2026. Confirm current manufacturer instructions and exact arrangement.", 2.5),
    text(12, height - 4, m.status, 2.5),
    text(width - 12, height - 4, `Page ${pageNumber} of ${totalPageCount} · A3`, 2.5, 'text-anchor="end" data-output-page-number="true"'), "</svg>");
  return out.join("");
}

function referenceCard(card, number, b, includeControls = false) {
  const scale = Math.min(1.6, (b.w - 12) / 59, (b.h - (includeControls ? 54 : 43)) / 61);
  const artX = b.x + (b.w - 58 * scale) / 2, artY = b.y + 13;
  const notes = {
    "ceiling-tva": ["128 horizontal × 140 vertical (mm).", "Finished body flush with plasterboard face. Leave proud at first fix; trim after plastering.", "Source section dimensions only. Not a cutout specification."],
    "wall-housing": ["120 mm housing depth to framing face.", "115 mm housing height. 140 mm grille height in section.", "Ø90 duct spigot. Confirm the cutout separately."],
    "q-cw420": ["824 W × 566 D × 1414 H overall assembly. 8 outlets per CW manifold.", "Allow 150 mm below unit for trap and 50 mm each side in cupboards.", "Owner allowances; verify manufacturer service requirements."],
    "q-cw320": ["Assembly envelope excludes service clearances.", "Allow 150 mm below unit for trap and 50 mm each side in cupboards.", "Owner allowances; verify manufacturer service requirements."],
    "af-cw520": ["Assembly envelope + 150 drain. Source suggests 700 cabinetry; not service clearance.", "See AeroFresh controls reference."],
    "af300-remote": ["470 depth includes wall bracket allowance.", "Provide a 40 mm waste connection for condensate."],
  }[card.id];
  const body = [panelStart(b, `${number}  ${card.title}`, card.id, card.source),
    `<g transform="translate(${artX} ${artY}) scale(${scale})">${renderInstallReferenceIllustration(card.id)}</g>`,
    `<g data-role="detail-notes">${paragraphs(includeControls ? [...notes, ...AEROFRESH_CONTROLS] : notes, b, b.y + b.h - (includeControls ? 35 : 25))}</g>`, "</g>"];
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

function coordinationCard(details, b, includeQElectrical = false) {
  const messages = [
    ...(details.unmatchedComponentIds.length ? [`${details.unmatchedComponentIds.length} other unit(s) on this floor: no supplied assembly matches. Obtain the exact model, mounting and CW arrangement drawing.`] : []),
    ...(details.cards.some(c => c.id === "equipment-notes") && !details.unmatchedComponentIds.length ? ["No matching central unit on this floor. Terminal sections are general references."] : []),
    "Assembly envelopes are not service clearances. Confirm access, supports, condensate arrangement and manufacturer installation requirements.",
    ...(details.hasQ ? ["See Q-series electrical reference; verify current model instructions."] : []),
    ...(details.hasAeroFresh ? AEROFRESH_CONTROLS : []),
    "Use the current model-specific manufacturer wiring diagram.",
    "Source: owner-supplied installation drawings. Schematics are references only and do not change model geometry or parts quantities.",
    "Project insulation specification is not supplied. This sheet is preliminary, not installation approval.",
  ];
  if (includeQElectrical) {
    const imageWidth = Math.min(b.w * .56, (b.h - 16) * 858 / 758);
    const imageHeight = imageWidth * 758 / 858;
    const notesBox = { x: b.x + imageWidth + 8, y: b.y, w: b.w - imageWidth - 12, h: b.h };
    const summary = [
      `Q-series electrical reference: ${details.qElectricalModels.join(", ")}. Owner source, 18 Nov 2026.`,
      "Source: Q350 — 10 A GPO; Q450 / Q600 — 15 A GPO.",
      "Boost: low-voltage 2-core, momentary switches; bathroom, kitchen, laundry and WC shown.",
      "Comfoconnect Pro and Option Box shown. No terminal pinout inferred; verify exact accessories and current instructions with the installer.",
      "Not project circuit, cable-size or protective-device design, and not installation approval.",
      ...messages.filter(message => !message.startsWith("See Q-series electrical reference")),
    ];
    return panelStart(b, "COORDINATION / SOURCE NOTES", "coordination-notes", "owner-q350-q450-q600-controls-2026-11-18")
      + `<image data-role="q-electrical-source" data-source="owner-q350-q450-q600-controls-2026-11-18" href="${Q_SERIES_ELECTRICAL_IMAGE}" x="${b.x + 4}" y="${b.y + 12}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="xMidYMid meet"/>`
      + `<g data-role="coordination-notes">${paragraphs(summary, notesBox, b.y + 15)}</g></g>`;
  }
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

const DECENTRALISED_DETAILS = {
  "lunos-e2-60-decentralised": {
    title: "LUNOS e²60",
    source: "LUNOS 9/R 160 installation manual and e²60 technical information",
    hood: "External cover",
    notes: [
      "9/R 160 wall sleeve, nominal Ø160 mm. Confirm the required core opening for the actual sleeve and wall assembly.",
      "Check sleeve length against the finished wall build-up. Allow for the specified outward fall and retain access from indoors for servicing.",
    ],
  },
  "aerofresh-30-compact-decentralised": {
    title: "AeroFresh 30 Compact",
    source: "HiPer Haus AeroFresh 30 Compact guide",
    hood: "Standard or XL hood",
    notes: [
      "Guide wall-depth range: 140–280 mm with the standard hood, or 90–280 mm with the XL hood. Confirm the hood used on this project.",
      "Confirm sleeve and core-opening dimensions from the supplied instructions before drilling. The catalogue opening reference is unresolved.",
    ],
  },
};

function decentralisedWallSection(b, hood) {
  const x = b.x + b.w / 2;
  const y = b.y + 36;
  return `<g data-role="wall-section" aria-label="Conceptual through-wall section">
    <rect x="${x-13}" y="${y-16}" width="26" height="32" fill="#edf0f1" stroke="#687880" stroke-width=".3"/>
    <rect x="${x-15}" y="${y-4}" width="30" height="8" fill="#f4f8f7" stroke="#28745d" stroke-width=".6"/>
    <path d="M ${x-10} ${y-1.5} h 20 l -2 -1.4 M ${x+10} ${y+1.5} h -20 l 2 1.4" fill="none" stroke="#28745d" stroke-width=".55"/>
    <rect x="${x-16}" y="${y-6}" width="2" height="12" fill="#28745d"/>
    <path d="M ${x+14} ${y-6} h 4 v 12 h -4" fill="none" stroke="#28745d" stroke-width=".6"/>
    ${text(x-21, y-2, "INDOORS", 2.6, 'text-anchor="end"')}
    ${text(x-21, y+3, "Service access", 2.5, 'text-anchor="end"')}
    ${text(x+23, y-2, "OUTDOORS", 2.6)}
    ${text(x+23, y+3, hood, 2.5)}
    ${text(x, y+22, "Conceptual wall section · NTS", 2.5, 'text-anchor="middle"')}
  </g>`;
}

function renderDecentralisedDetailSheet(sheet, { pageNumber, totalPageCount }) {
  const { widthMm: width, heightMm: height } = sheet.page, m = sheet.metadata;
  const units = sheet.printScene.components.filter(component => component.decentralisedMvhr);
  const models = Object.entries(DECENTRALISED_DETAILS).filter(([id]) => units.some(unit => unit.catalogueItemId === id));
  const contentWidth = width - 30;
  const gap = 4;
  const cardWidth = (contentWidth - gap * (models.length - 1)) / Math.max(1, models.length);
  const cards = models.map(([id, detail], index) => {
    const b = { x: 15 + index * (cardWidth + gap), y: 47, w: cardWidth, h: 94 };
    const heads = units.filter(unit => unit.catalogueItemId === id);
    return [
      panelStart(b, detail.title, id, escapeXml(detail.source)),
      ...lines(`${heads.length} head(s) on this floor · Alternating paired operation`, b.x+4, b.y+13, b.w-8, 2.6, 1),
      decentralisedWallSection(b, detail.hood),
      paragraphs(detail.notes, b, b.y + 66),
      "</g>",
    ].join("");
  });
  const coordination = { x: 15, y: models.length ? 146 : 47, w: contentWidth, h: models.length ? 32 : 45 };
  const controls = { x: 15, y: coordination.y + coordination.h + 5, w: contentWidth, h: height - coordination.y - coordination.h - 20 };
  const connections = sheet.printScene.electricalConnections ?? [];
  const rowHeight = 13;
  const maxRows = Math.floor((controls.h - 22) / rowHeight);
  const rows = connections.slice(0, maxRows).flatMap((entry, index) => {
    const y = controls.y + 13 + index * rowHeight;
    const status = entry.evidenceStatus === "verified-manufacturer" ? "Manufacturer reference" : "Confirm current manual";
    return [
      ...lines(`${entry.controllerMarkupId} · ${entry.controllerType} → ${entry.unitType} (${entry.unitMarkupIds.join(", ")})`, controls.x+4, y, controls.w-8, 2.7, 1),
      ...lines(entry.controllerId ? `${status} · Marked cable: ${entry.cableType} · ${entry.topology}` : entry.topology, controls.x+4, y+4, controls.w-8, 2.4, 2),
    ];
  });
  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="Decentralised installation details for ${escapeXml(m.drawingId)}">`,
    '<rect width="100%" height="100%" fill="white"/>', rect(10, 10, width - 20, height - 20),
    text(15, 19, "DECENTRALISED INSTALLATION DETAILS", 5.5, 'font-weight="700"'),
    ...lines(`${m.projectName} · ${sheet.printScene.floorName}`, 15, 26, width - 30, 3.2, 2),
    ...lines(`${m.drawingId} / DETAILS · Revision ${m.revision} · ${m.issueDate} · ${m.drawingTitle}`, 15, 35, width - 30, 2.8, 1),
    text(15, 40, "Read with the corresponding plan and the current model-specific instructions.", 2.8),
    ...cards,
    panelStart(coordination, "WALL AND FAÇADE COORDINATION", "decentralised-reference-notes", "preliminary-coordination"),
    paragraphs([
      ...(units.some(unit => !DECENTRALISED_DETAILS[unit.catalogueItemId]) ? ["Other placed models: use their own installation instructions."] : []),
      ...(!units.length ? ["No decentralised units are placed on this floor."] : []),
      "Confirm structure, concealed services, wall layers, weatherproofing, airtight seals and clearances before forming the penetration.",
      "Confirm supply, protection, cable suitability and final connections with the responsible electrician using the current controller instructions.",
    ], coordination, coordination.y+13), "</g>",
    panelStart(controls, "CONTROLLERS AND MARKED CABLE RUNS", "decentralised-controls", "saved-controller-connections"),
    ...rows,
    ...(!connections.length ? lines("No controller-to-unit connections are marked.", controls.x+4, controls.y+13, controls.w-8, 2.7, 1) : []),
    ...(connections.length > maxRows ? lines(`${connections.length - maxRows} further connection groups. Refer to the floor drawing and parts list.`, controls.x+4, controls.y+controls.h-4, controls.w-8, 2.5, 1) : []),
    "</g>",
    text(12, height - 4, m.status, 2.5),
    text(width - 12, height - 4, `Page ${pageNumber} of ${totalPageCount} · A3`, 2.5, 'text-anchor="end" data-output-page-number="true"'), "</svg>"].join("");
}
