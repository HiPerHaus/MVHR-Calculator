import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
test("volume settings use dedicated sections rather than the field-record grid",async()=>{
 const source=await readFile(new URL("../app/main.mjs",import.meta.url),"utf8");
 const section=source.slice(source.indexOf("function renderVolumeSettings(host)"));
 for(const cls of ["volume-settings","volume-floor-form","volume-summary","volume-room-list","volume-room-card","volume-room-controls","volume-reference","volume-reference-inputs"]) assert.ok(section.includes(cls),cls);
 assert.doesNotMatch(section,/field-details-form|field-airflow-row/);
 const css=await readFile(new URL("../app/style.css",import.meta.url),"utf8");
 assert.match(css,/\.volume-room-controls > \[hidden\] \{ display: none;/);
 assert.match(css,/max-width: 1240px/);
 assert.match(css,/min-height: 44px/);
});
