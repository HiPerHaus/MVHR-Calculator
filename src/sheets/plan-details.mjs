
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
    out.push(`<g transform="translate(${centre - 29} ${top})">`, tvaDiagram(), "</g>");
    out.push(paragraphs(["128 horizontal × 140 vertical.", "Leave housing below the plaster line; cut off after plastering.", "Source section only; not a cutout specification."], b, top + 50));
  } else if (card.id === "wall-housing") {
    out.push(text(b.xMm + 3, b.yMm + 9, "AeroFresh grille housing", 2.5));
    out.push(`<g transform="translate(${centre - 29} ${top})">`, wallDiagram(), "</g>");
    out.push(paragraphs(["90 mm duct spigot.", "120, 115 and 140 match the dimension endpoints shown.", "Do not infer a cutout or face size."], b, top + 50));
  } else if (card.id === "q-cw320" || card.id === "af-cw520") {
    out.push(`<g transform="translate(${centre - 29} ${top})">`, assemblyDiagram(card), "</g>");
    const notes = card.id === "q-cw320"
      ? ["Assembled envelope only.", "Drain space: not dimensioned.", "Wiring source unreadable. Original wiring drawing required."]
      : ["Assembled envelope + 150 drain.", "Source suggests 700 cabinetry.", "Wiring: verify original diagram; fine labels are not transcribed."];
    out.push(paragraphs(notes, b, top + 50));
  } else if (card.id === "af300-remote") {
    out.push(`<g transform="translate(${centre - 29} ${top})">`, remoteDiagram(), "</g>");
    out.push(paragraphs(["Remote overhead arrangement.", "Source dimension arrows are blank. Assembly dimensions required.", "Bare-unit dimensions are not the assembled installation size."], b, top + 50));
  } else {
    out.push(paragraphs(details.unmatchedComponentIds.length
      ? ["No supplied setout matches the unit and arrangement on this floor.", "Select the exact model, mounting and CW size; obtain the matching assembly drawing.",
        ...(details.hasQ ? ["Q-series wiring source unreadable. Original drawing required."] : details.hasAeroFresh ? ["Verify the model-specific original wiring drawing."] : [])]
      : ["No matching central unit on this floor.", "TVA and AeroFresh housing sections are retained as general references."], b, top + 4));
  }
  out.push("</g>");
  return out.join("");
}

function tvaDiagram() {
  return [
    rect(14, 8, 29, 26, "#e8ecee"), rect(0, 12, 14, 17, "#d6dde0"),
    line(1, 8, 56, 8), line(1, 34, 56, 34), rect(14, 34, 29, 3),
    line(18, 37, 18, 40), line(39, 37, 39, 40), line(12, 40, 45, 40),
    dimH(14, 43, 4, "128"), dimV(8, 34, 51, "140"),
    text(28.5, 22, "TVA", 2.5, 'text-anchor="middle"'),
    text(0, 44, "Ceiling / plaster line", 2.5),
  ].join("");
}

function wallDiagram() {
  return [
    rect(12, 7, 19, 7, "#e8ecee"), rect(12, 34, 19, 7, "#e8ecee"),
    rect(31, 7, 3, 34), rect(8, 14, 26, 20, "#f4f6f7"),
    line(34, 13, 38, 13), line(38, 13, 38, 35), line(38, 35, 34, 35),
    `<circle cx="20" cy="24" r="8" fill="white" stroke="#30454e" stroke-width=".35"/>`,
    text(20, 25, "Ø90", 2.5, 'text-anchor="middle"'),
    dimH(8, 31, 3, "120"), dimV(14, 34, 44, "115"), dimV(13, 35, 54, "140"),
    text(8, 45, "Housing", 2.5), text(32, 45, "Grille", 2.5),
  ].join("");
}

function assemblyDiagram(card) {
  const q = card.id === "q-cw320";
  return [
    rect(10, 20, 21, 22, "#f3f5f6"),
    ...(q ? [rect(22, 6, 9, 14, "#e5eaec"), `<path d="M10 20 L16 20 L16 25 L10 25 Z" fill="#e5eaec" stroke="#30454e" stroke-width=".3"/>`]
      : [rect(10, 6, 21, 14, "#e5eaec"), line(20.5, 6, 20.5, 20)]),
    rect(39, 20, 14, 22, "#f3f5f6"), rect(39, 6, 6, 14, "#e5eaec"), rect(47, 6, 6, 14, "#e5eaec"),
    dimH(10, 31, 2, String(card.widthMm)), dimH(39, 53, 2, String(card.depthMm)),
    dimV(6, 42, 5, String(card.heightMm)),
    text(20.5, 32, q ? "Q" : "AF", 2.5, 'text-anchor="middle"'),
    text(46, 32, "Side", 2.5, 'text-anchor="middle"'),
    `<path d="M16 42 L16 46 Q16 48 19 48 L23 48" fill="none" stroke="#87969d" stroke-width=".5"/>`,
    ...(card.drainAllowanceMm === null ? [] : [dimV(42, 48, 30, String(card.drainAllowanceMm))]),
  ].join("");
}

function remoteDiagram() {
  return [
    line(5, 2, 54, 2), rect(26, 4, 18, 7, "#d6dde0"),
    `<path d="M26 7 H19 V15 M19 20 V27" fill="none" stroke="#687880" stroke-width="4"/>`,
    rect(10, 27, 22, 18, "#f3f5f6"), rect(41, 27, 13, 18, "#f3f5f6"),
    text(21, 38, "AF300", 2.5, 'text-anchor="middle"'),
    text(47.5, 38, "Side", 2.5, 'text-anchor="middle"'),
  ].join("");
}

function dimH(x1, x2, y, value) {
  return `${line(x1, y - 1, x1, y + 2)}${line(x2, y - 1, x2, y + 2)}${line(x1, y, x2, y)}${text((x1 + x2) / 2, y - 1.3, value, 2.5, 'text-anchor="middle"')}`;
}
function dimV(y1, y2, x, value) {
  return `${line(x - 1, y1, x + 2, y1)}${line(x - 1, y2, x + 2, y2)}${line(x, y1, x, y2)}${text(x - 1.2, (y1 + y2) / 2, value, 2.5, `text-anchor="middle" transform="rotate(-90 ${x - 1.2} ${(y1 + y2) / 2})"`)}`;
}
function rect(x, y, width, height, fill = "white") {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="#30454e" stroke-width=".35"/>`;
}
function line(x1, y1, x2, y2) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#30454e" stroke-width=".25"/>`;
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
  return values.map(value => {
    const result = wrap(value, bounds.widthMm - 6, 2.5).map(line => {
      const result = text(bounds.xMm + 3, y, line);
      y += 3.2;
      return result;
    }).join("");
    y += 1;
    return result;
  }).join("");
}
function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
