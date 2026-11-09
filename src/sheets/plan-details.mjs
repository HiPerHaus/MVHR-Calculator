import { renderInstallReferenceIllustration } from "./install-reference-illustrations.mjs";

// Drawing references are annotations only, never equipment geometry or quantities.
// Measurements transcribed from owner-supplied drawings reviewed 2026-11-09.
const SOURCE_DATE = "2026-11-09";
const CARD_HEIGHT_MM = 88;
const GAP_MM = 3;

export const PLAN_DETAIL_REFERENCES = Object.freeze({
  tva: Object.freeze({ id: "ceiling-tva", source: "owner-terminal-housings-2026-11-09", title: "Ceiling TVA housing", widthMm: 128, heightMm: 140 }),
  wall: Object.freeze({ id: "wall-housing", source: "owner-terminal-housings-2026-11-09", title: "Wall / floor / bulkhead", horizontalMm: 120, innerVerticalMm: 115, overallVerticalMm: 140, spigotMm: 90 }),
  q320: Object.freeze({ id: "q-cw320", source: "owner-q350-q450-cw320-2026-11-09", title: "Q350 / Q450 + CW320", widthMm: 791, depthMm: 566, heightMm: 1414, drainAllowanceMm: null }),
  af520: Object.freeze({ id: "af-cw520", source: "owner-aerofresh-450-600-cw520-2026-11-09", title: "AeroFresh 450 / 600 + CW520", widthMm: 870, depthMm: 650, heightMm: 1400, drainAllowanceMm: 150, suggestedCabinetryMm: 700 }),
  af300: Object.freeze({ id: "af300-remote", source: "owner-aerofresh-300-2026-11-09", title: "AeroFresh 300 · remote", widthMm: null, depthMm: null, heightMm: null, drainAllowanceMm: null }),
});

function recordId(component) {
  return component.catalogueItemId ?? component.catalogueSnapshot?.recordId ?? "";
}

export function selectPlanDetails(project, floorId) {
  const components = project.components.filter(component => component.floorId === floorId);
  const matches = new Map(), unmatched = [];
  let hasQ = false, hasAeroFresh = false;
  for (const component of components) {
    const record = recordId(component), intent = component.mvhrDesignIntent;
    const q = /^zehnder-q(350|450)(?:-de)?-/u.test(record);
    const af = /^aerofresh-(300|450|600)-/u.test(record);
    hasQ ||= q;
    hasAeroFresh ||= af;
    let detail = null;
    const upright = intent?.mounting === "vertical";
    if (upright && intent?.layout === "unit-mounted-cw") {
      // Other CW sizes and German BIM profiles are not the supplied TR assembly.
      if (/^zehnder-q(350|450)-(hrv|erv)-(left|right)-drawing-profile$/u.test(record) && intent.cwSize === "320") detail = PLAN_DETAIL_REFERENCES.q320;
      if (/^aerofresh-(450|600)-(hrv|erv)-(left|right)-drawing-profile$/u.test(record) && intent.cwSize === "520") detail = PLAN_DETAIL_REFERENCES.af520;
    }
    if (upright && /^aerofresh-300-(hrv|erv)(?:-(left|right)-drawing-profile)?$/u.test(record) && intent?.layout === "remote-attenuators") detail = PLAN_DETAIL_REFERENCES.af300;
    if (detail) {
      if (!matches.has(detail.id)) matches.set(detail.id, { ...detail, componentIds: [] });
      matches.get(detail.id).componentIds.push(component.id);
    } else if (intent || q || af || record.startsWith("zehnder-ca200-")) {
      unmatched.push(component.id);
    }
  }
  const equipment = [PLAN_DETAIL_REFERENCES.q320, PLAN_DETAIL_REFERENCES.af520, PLAN_DETAIL_REFERENCES.af300]
    .flatMap(detail => matches.has(detail.id) ? [matches.get(detail.id)] : []);
  return {
    sourceDate: SOURCE_DATE,
    cards: [{ ...PLAN_DETAIL_REFERENCES.tva }, { ...PLAN_DETAIL_REFERENCES.wall }, ...equipment,
      ...(equipment.length ? [] : [{ id: "equipment-notes", title: "Equipment reference", source: "selection-status" }])],
    unmatchedComponentIds: unmatched,
    hasQ,
    hasAeroFresh,
  };
}

export function layoutPlanDetails(details, area) {
  // Never shrink the text to fit an additional assembly.
  const columns = Math.min(details.cards.length, Math.max(1, Math.floor((area.widthMm + GAP_MM) / 63)));
  const rows = Math.ceil(details.cards.length / columns);
  const heightMm = 14 + rows * CARD_HEIGHT_MM + (rows - 1) * GAP_MM;
  const bounds = { xMm: area.xMm, yMm: area.yMm + area.heightMm - heightMm, widthMm: area.widthMm, heightMm };
  const cardWidth = (area.widthMm - GAP_MM * (columns - 1)) / columns;
  const cards = details.cards.map((detail, index) => ({
    ...detail,
    bounds: { xMm: bounds.xMm + (index % columns) * (cardWidth + GAP_MM), yMm: bounds.yMm + 8 + Math.floor(index / columns) * (CARD_HEIGHT_MM + GAP_MM), widthMm: cardWidth, heightMm: CARD_HEIGHT_MM },
  }));
  return { ...details, bounds, cards };
}

export function renderPlanDetails(details) {
  const b = details.bounds;
  const out = ['<g id="plan-details" data-evidence-boundary="owner-reference-not-installation-approval">',
    text(b.xMm + 1, b.yMm + 4.5, "INSTALLATION REFERENCES · dimensions in mm · schematics NTS", 2.8, 'font-weight="700"')];
  for (const card of details.cards) out.push(renderCard(card, details));
  const footer = details.unmatchedComponentIds.length
    ? `${details.unmatchedComponentIds.length} other unit(s): matching assembly reference required.${details.hasQ && !details.cards.some(card => card.id === "q-cw320") ? " Q-series wiring source unreadable; original drawing required." : " Verify exact model, CW and arrangement."}`
    : "Assembly envelopes exclude service clearances. Confirm the current manufacturer instructions before installation.";
  out.push(text(b.xMm + 1, b.yMm + b.heightMm - 1, footer, 2.5), "</g>");
  return out.join("");
}

function renderCard(card, details) {
  const b = card.bounds, centre = b.xMm + b.widthMm / 2;
  const out = [`<g data-kind="plan-detail" data-detail-id="${card.id}" data-source="${card.source}">`,
    `<title>${xml(card.title)} · supplied ${SOURCE_DATE}</title>`,
    `<rect x="${b.xMm}" y="${b.yMm}" width="${b.widthMm}" height="${b.heightMm}" fill="white" stroke="#75858c" stroke-width=".25"/>`];
  const heading = wrap(card.title, b.widthMm - 6, 2.8);
  heading.forEach((line, index) => out.push(text(b.xMm + 3, b.yMm + 5 + index * 3.5, line, 2.8, 'font-weight="700"')));
  const top = b.yMm + 13;
  if (card.id === "ceiling-tva") {
    out.push(`<g transform="translate(${centre - 29} ${top})">`, renderInstallReferenceIllustration(card.id), "</g>");
    out.push(paragraphs(["Leave housing below the plaster line; cut off after plastering.", "Section dimensions, not a cutout specification."], b, top + 55));
  } else if (card.id === "wall-housing") {
    out.push(text(b.xMm + 3, b.yMm + 9, "AeroFresh grille housing", 2.5));
    out.push(`<g transform="translate(${centre - 29} ${top})">`, renderInstallReferenceIllustration(card.id), "</g>");
    out.push(paragraphs(["90 mm duct spigot.", "Dimensions follow source endpoints, not cutout or face size."], b, top + 55));
  } else if (card.id === "q-cw320" || card.id === "af-cw520") {
    out.push(`<g transform="translate(${centre - 29} ${top})">`, renderInstallReferenceIllustration(card.id), "</g>");
    const notes = card.id === "q-cw320"
      ? ["Drain space: not dimensioned.", "Wiring source unreadable. Original drawing required."]
      : ["Source suggests 700 cabinetry.", "Wiring: original diagram required; fine labels not transcribed."];
    out.push(paragraphs(notes, b, top + 52));
  } else if (card.id === "af300-remote") {
    out.push(`<g transform="translate(${centre - 29} ${top})">`, renderInstallReferenceIllustration(card.id), "</g>");
    out.push(paragraphs(["Source dimension arrows are blank.", "Assembly dimensions required."], b, top + 63));
  } else {
    out.push(paragraphs(details.unmatchedComponentIds.length
      ? ["No supplied setout matches the unit and arrangement on this floor.", "Select the exact model, mounting and CW size; obtain the matching assembly drawing.",
        ...(details.hasQ ? ["Q-series wiring source unreadable. Original drawing required."] : details.hasAeroFresh ? ["Verify the model-specific original wiring drawing."] : [])]
      : ["No matching central unit on this floor.", "TVA and AeroFresh housing sections are retained as general references."], b, top + 4));
  }
  out.push("</g>");
  return out.join("");
}

function text(x, y, value, size = 2.5, attrs = "") {
  return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="#243b46" ${attrs}>${xml(value)}</text>`;
}
function wrap(value, width, size) {
  const max = Math.floor(width / (size * .54)), words = value.split(/\s+/u), lines = [];
  let current = "";
  for (const word of words) {
    if (current && (current.length + word.length + 1) > max) { lines.push(current); current = ""; }
    current += `${current ? " " : ""}${word}`;
  }
  if (current) lines.push(current);
  return lines;
}
function paragraphs(values, bounds, startY) {
  let y = startY;
  return `<g data-role="detail-notes">${values.map(value => {
    const result = wrap(value, bounds.widthMm - 6, 2.5).map(line => {
      const result = text(bounds.xMm + 3, y, line);
      y += 3.2;
      return result;
    }).join("");
    y += 1;
    return result;
  }).join("")}</g>`;
}
function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
