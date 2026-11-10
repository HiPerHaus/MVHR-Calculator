// Source-shaped vector illustrations from the five owner reference screenshots
// reviewed 2026-11-09. These are not product models or electrical instructions.
// Drawing geometry is pictorial; only the labelled source dimensions are values.
const INK = "#303438";
const RED = "#e23232";

export function renderInstallReferenceIllustration(id) {
  const drawing = {
    "ceiling-tva": ceilingHousing,
    "wall-housing": wallHousing,
    "q-cw320": qAssembly,
    "af-cw520": aeroFreshAssembly,
    "af300-remote": remoteAssembly,
  }[id];
  if (!drawing) throw new TypeError(`Unknown installation reference: ${id}`);
  return `<g data-illustration="${id}" data-visual-basis="owner-source-profile" stroke-linejoin="round" stroke-linecap="round">${drawing()}</g>`;
}

function ceilingHousing() {
  // Finished section: the housing and plasterboard share the same face datum.
  // The owner requested this trim relationship on 2026-11-10; NTS artwork only.
  const finishedFaceY = 39;
  return [
    // Insulation and timber backing retain the source section's relationship.
    hatch(4, 1, 44, 13),
    box(20, 13, 10, 3, "#eee8df"), hatch(20, 13, 10, 3, 2),
    box(4, 16, 7, 20, "#dbdbdb"),
    ...[4.5, 5.7, 7.3, 8.8, 10.2].map(x => seg(x, 16, x, 36, .25)),
    `<g data-source-feature="tva-body" data-finish-y="${finishedFaceY}">${path(`M11 14 H38 V${finishedFaceY} H12 V33 H11 Z`, "#828282")}</g>`,
    path("M12 15 C16 19 17 22 17 25 C17 30 15 33 12 35", "none", .25),
    box(23.5, 16, 3.5, 16.5, "#333333"),
    box(24.3, 14.5, 1.9, 20.5, "#919191"),
    circle(25.25, 19.3, .8, "#c4b83a"), circle(25.25, 26.7, .8, "#c4b83a"),
    `<g data-source-feature="plasterboard" data-finish-y="${finishedFaceY}">`,
    box(4, 36, 8, finishedFaceY - 36, "#eeeeee"), hatch(4, 36, 8, finishedFaceY - 36, 2),
    box(38, 36, 10, finishedFaceY - 36, "#eeeeee"), hatch(38, 36, 10, finishedFaceY - 36, 2),
    "</g>",
    box(16.5, 30, 19, 5, "#ffffff"),
    text(26, 33.2, "TVA housing", 2.5, 'text-anchor="middle"'),
    dimH(16.5, 38, 42.8, "128", RED, 40),
    dimV(14, finishedFaceY, 52, "140", RED, 48),
    // Separate lower grille profile from the same source, not a second housing.
    path("M18 47 H37 L39 49 H16 Z", "#dddddd", .15),
    box(18.8, 44.8, 17.4, 2.1, "#707070", .15),
    seg(17, 44.8, 38, 44.8, .25),
  ].join("");
}

function wallHousing() {
  return [
    hatch(16, 11, 16, 7), hatch(16, 36, 16, 7),
    box(32, 7, 2.8, 40, "white"),
    box(11, 18, 21, 18, "white"),
    seg(11, 18, 34, 18), seg(11, 36, 34, 36),
    path("M34.8 16.5 H37 V37.5 H34.8", "white"),
    circle(22, 27, 8, "white", .28),
    text(22, 26.6, "Ø90", 2.5, 'text-anchor="middle"', RED),
    text(22, 29.8, "spigot", 2.5, 'text-anchor="middle"', RED),
    circle(33.4, 17.2, .42, "#555555", .1), circle(33.4, 37.1, .42, "#555555", .1),
    seg(11, 3.5, 11, 44, .15, RED, 'stroke-dasharray=".8 .8"'),
    seg(8.5, 20.2, 39.5, 20.2, .15, RED, 'stroke-dasharray=".8 .8"'),
    dimH(11, 32, 4.8, "120", RED, 11),
    dimV(18, 36, 43, "115", RED, 37),
    dimV(16.5, 37.5, 54, "140", RED, 37),
    leader(6, 14, 10.9, 19.4, RED),
    text(1, 11, "Housing", 2.5, "", RED),
    text(36, 3, "Plasterboard", 2.5, "", RED), leader(38, 4.3, 34.6, 8, RED),
    text(38, 11.6, "Grille", 2.5, "", RED), leader(40, 13, 36.8, 16.7, RED),
  ].join("");
}

function qAssembly() {
  const s = .138, x = .1, y = -6.5;
  return [
    `<g transform="translate(${x} ${y}) scale(${s})" data-source-feature="q-mounting-set">`,
    // Left source view: asymmetrical mounted CW, elbow and sculpted unit face.
    box(50, 236, 127, 97, "#fbfbfb", 1.4),
    path("M45 184 H183 L183 208 L176 222 L151 199 V333 H50 V222 L45 207 Z", "#f7f7f7", 1.4),
    seg(50, 238, 177, 238, 1.3), seg(67, 200, 67, 333, 1.2), seg(153, 200, 153, 333, 1.2),
    path("M74 240 V287 Q74 296 84 296 H143 Q151 296 151 287 V240", "none", 1.5),
    path("M79 240 V284 Q79 290 85 290 H142 Q147 290 147 284 V240", "none", .8),
    box(45, 181, 35, 6, "#eeeeee", 1.2), seg(45, 184, 78, 184, 1),
    box(128, 87, 57, 95, "#fafafa", 1.3),
    box(127, 83, 59, 5, "#dadada", 1.2), box(127, 179, 59, 5, "#dadada", 1.2),
    path("M154 95 C139 96 135 111 135 134 V154 C135 169 145 175 156 175 C169 175 178 169 178 154 V117 C178 100 169 94 154 95 Z", "white", 1.2),
    ...[94, 113, 132, 151, 170].flatMap(v => [circle(132, v, 1.2, INK, .4), circle(181, v, 1.2, INK, .4)]),
    path("M157 142 V128 M153 134 L157 128 L161 134", "none", 1.2),
    // Right source view: two flanged attenuators and rounded transition pieces.
    box(291, 224, 90, 110, "#fbfbfb", 1.4), box(381, 225, 8, 109, "white", 1.1),
    box(290, 184, 99, 42, "#f9f9f9", 1.4),
    path("M294 190 C292 212 297 218 309 219 C323 218 331 214 331 190 Z", "white", 1.3),
    path("M342 190 C340 211 345 218 358 219 C372 218 380 213 380 190 Z", "white", 1.3),
    ...[291, 341].flatMap(px => [box(px, 88, 39, 94, "#fafafa", 1.3), box(px - 1, 83, 41, 5, "#dddddd", 1), box(px - 1, 178, 41, 6, "#dddddd", 1),
      ...[92, 112, 154, 174].flatMap(v => [circle(px + 3, v, 1.05, INK, .3), circle(px + 36, v, 1.05, INK, .3)])]),
    drain(74, 340),
    "</g>",
    dimH(x + 45 * s, x + 186 * s, 2.1, "791", INK, y + 83 * s),
    dimH(x + 290 * s, x + 389 * s, 2.1, "566", INK, y + 83 * s),
    dimV(y + 83 * s, y + 333 * s, 2.7, "1414", INK, x + 45 * s),
    // Blank allowance arrow preserved, never supplied a guessed drain value.
    dimV(y + 333 * s, 46, 2.7, null, "#858585", x + 69 * s),
  ].join("");
}

function aeroFreshAssembly() {
  const s = .088, x = 4, y = -4.1;
  return [
    `<g transform="translate(${x} ${y}) scale(${s})" data-source-feature="af-cw520-elevations">`,
    box(59, 270, 230, 274, "#fafafa", 1.8),
    path("M91 300 Q91 275 112 275 H235 Q257 275 257 300 V506 Q257 536 236 536 H113 Q91 536 91 512 Z", "white", 2.2),
    seg(94, 345, 255, 345, 1.6),
    box(94, 346, 161, 152, "#fafafa", 1.4),
    path("M113 323 L149 282 Q155 275 164 284 Q170 290 163 297 L126 333 Q116 339 111 332 Z", "#eeeeee", 2),
    path("M182 282 Q189 276 196 284 L236 323 Q242 330 234 336 Q229 340 222 334 L180 295 Q175 288 182 282 Z", "#eeeeee", 2),
    box(161, 108, 166, 155, "white", 1.5),
    ellipse(207, 195, 24, 63, "none", 1.7, 'stroke-dasharray="6 6"'),
    ellipse(280, 195, 24, 63, "none", 1.7, 'stroke-dasharray="6 6"'),
    path("M207 180 V218 M198 208 L207 220 L216 208 M280 180 V218 M271 208 L280 220 L289 208", "none", 2.4),
    box(160, 500, 29, 29, "#efefef", 1.5), box(164, 505, 21, 11, "white", 1),
    ...[166, 172, 178, 184].map(px=>circle(px, 521, 1.3, INK, .4)),
    // Opposite source elevation has round port faces beneath two CW bodies.
    box(366, 273, 190, 273, "#fafafa", 1.8),
    box(388, 109, 72, 156, "#fcfcfc", 1.5), box(470, 109, 71, 156, "#fcfcfc", 1.5),
    box(365, 264, 192, 9, "#e8e8e8", 1.2),
    box(383, 281, 78, 72, "white", 1.4), box(470, 281, 76, 72, "white", 1.4),
    circle(422, 316, 31, "white", 1.8), circle(509, 316, 31, "white", 1.8),
    seg(422, 304, 422, 327, 3), seg(509, 304, 509, 327, 3),
    ...[382, 548].flatMap(px=>[285, 348, 448, 538].map(v=>circle(px, v, 1.3, INK, .4))),
    drain(112, 551),
    "</g>",
    dimH(x + 59 * s, x + 327 * s, 1.8, "870", INK, y + 108 * s),
    dimH(x + 366 * s, x + 556 * s, 1.8, "650", INK, y + 109 * s),
    dimV(y + 108 * s, y + 545 * s, 2.8, "1400", INK, x + 59 * s),
    dimV(y + 545 * s, 48, 6, "150", INK, x + 112 * s),
  ].join("");
}

function remoteAssembly() {
  return [
    hatch(3, 1, 52, 3.5, 5),
    // Source overhead attenuator, elbow and intentional vertical duct break.
    path("M20 5.7 H28 V10.7 H23 Q21.5 10.7 21.5 12.4 V14.9 H16.5 V10 Q16.5 5.7 20 5.7 Z", "#353535"),
    box(24, 5, 12.5, 6, "#858585"), box(36.5, 5.5, 3.8, 2.4, "#bbbbbb"), box(36.5, 8, 3.8, 2.4, "#bbbbbb"),
    box(16.5, 17, 5, 13.5, "#353535"),
    box(6.8, 28.8, 5.6, 2.2, "#fafafa"), box(13.3, 28.8, 5.5, 2.2, "#fafafa"),
    box(5, 31, 22, 23.5, "#fafafa"),
    path("M8.5 31.5 H23.5 Q25.8 31.5 25.8 34.4 V51.5 Q25.8 53.5 23.8 53.5 H8.5 Q6.5 53.5 6.5 51.5 V33.8 Q6.5 31.5 8.5 31.5 Z", "white", .28),
    box(7.2, 37, 18, 13.4, "#fafafa", .15),
    `<rect x="7.8" y="32.8" width="16.5" height="1.9" rx=".9" fill="#eeeeee" stroke="${INK}" stroke-width=".25"/>`,
    path("M10 34.9 H21.5 V36 H10 Z", "#e8e8e8", .15), box(14.6, 35, 3.2, 1.7, "white", .2),
    box(14.3, 50.5, 3.5, 2.2, "#eeeeee", .2),
    ...[14.9, 15.8, 16.7, 17.4].map(px=>circle(px, 52.1, .12, INK, .05)),
    box(36, 28.8, 5.7, 2.2, "#fafafa"), box(43, 28.8, 5.7, 2.2, "#fafafa"),
    box(34.5, 31, 17.5, 23.5, "#fafafa"),
    ...[35, 51.5].flatMap(px=>[31.5, 40, 54].map(v=>circle(px, v, .1, INK, .05))),
    // Keep the source's undimensioned arrows rather than inventing AF300 values.
    dimH(5, 27, 26.8, null, INK, 31), dimH(34.5, 52, 27.6, null, INK, 31),
    dimV(4.5, 11, 2, null, INK, 16), dimV(11, 30, 2, null, INK, 16),
    dimV(31, 54.5, 2, null, INK, 5),
    path("M10 55.2 V57.5 Q10 59 11.1 59 Q12.2 59 12.2 57.5 V57 H15", "none", .7, "#c0c0c0"),
  ].join("");
}

function drain(x, y) {
  return `<g data-source-feature="condensate-drain">${path(`M${x} ${y} V${y+25} Q${x} ${y+37} ${x+10} ${y+37} Q${x+20} ${y+37} ${x+20} ${y+25} V${y+19} H${x+43}`, "none", 5, "#b8b8b8")}${path(`M${x} ${y} V${y+25} Q${x} ${y+37} ${x+10} ${y+37} Q${x+20} ${y+37} ${x+20} ${y+25} V${y+19} H${x+43}`, "none", 2.5, "#eeeeee")}</g>`;
}
function hatch(x, y, w, h, step = 3) {
  const out = [box(x, y, w, h, "#fafafa", .2)];
  for (let p = -h; p < w; p += step) {
    const x1 = Math.max(0, p), x2 = Math.min(w, p + h);
    out.push(seg(x + x1, y + h - (x1 - p), x + x2, y + h - (x2 - p), .16, "#a0a0a0"));
  }
  return `<g data-source-feature="hatched-section">${out.join("")}</g>`;
}
function dimH(x1, x2, y, label, color = INK, extensionY = y + 1.5) {
  return `<g data-dimension="${label ?? "unresolved"}">${seg(x1, y - .7, x1, extensionY, .12, color)}${seg(x2, y - .7, x2, extensionY, .12, color)}${seg(x1, y, x2, y, .16, color)}${arrow(x1, y, 0, color)}${arrow(x2, y, 180, color)}${label === null ? "" : text((x1 + x2) / 2, y - 1.1, label, 2.5, 'text-anchor="middle"', color)}</g>`;
}
function dimV(y1, y2, x, label, color = INK, extensionX = x + 1.5) {
  const cy = (y1 + y2) / 2, tx = x - 1.1;
  return `<g data-dimension="${label ?? "unresolved"}">${seg(x - .7, y1, extensionX, y1, .12, color)}${seg(x - .7, y2, extensionX, y2, .12, color)}${seg(x, y1, x, y2, .16, color)}${arrow(x, y1, 90, color)}${arrow(x, y2, -90, color)}${label === null ? "" : text(tx, cy, label, 2.5, `text-anchor="middle" transform="rotate(-90 ${tx} ${cy})"`, color)}</g>`;
}
function leader(x1, y1, x2, y2, color) {
  return seg(x1, y1, x2, y2, .15, color) + arrow(x2, y2, Math.atan2(y1 - y2, x1 - x2) * 180 / Math.PI, color);
}
function arrow(x, y, angle, color) {
  return `<path d="M0 0 L1.2 -.4 L1.2 .4 Z" transform="translate(${x} ${y}) rotate(${angle})" fill="${color}" stroke="none"/>`;
}
function box(x, y, w, h, fill = "white", stroke = .2) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${INK}" stroke-width="${stroke}"/>`;
}
function seg(x1, y1, x2, y2, width = .2, color = INK, attrs = "") {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${attrs}/>`;
}
function circle(x, y, r, fill = "white", width = .2) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="${width}"/>`;
}
function ellipse(x, y, rx, ry, fill, width, attrs = "") {
  return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${INK}" stroke-width="${width}" ${attrs}/>`;
}
function path(d, fill = "none", width = .2, stroke = INK) {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
}
function text(x, y, value, size, attrs = "", color = INK) {
  return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="${color}" ${attrs}>${value}</text>`;
}
