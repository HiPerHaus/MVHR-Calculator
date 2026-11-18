import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('design airflows and commissioning have separate tabs and forms',async()=>{
 const main=await readFile(new URL('../app/main.mjs',import.meta.url),'utf8');
 const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
 assert.match(html,/id="commissioning-nav"/);assert.match(html,/id="commissioning-workspace"/);
 const design=main.slice(main.indexOf('function renderDesignAirflows'),main.indexOf('function renderFieldAirflows'));
 assert.doesNotMatch(design,/recordMeasurement|measuredLps|Save reading/);
 assert.match(design,/selectDesignStage\("export"\)/);
 assert.match(main,/activeTask === "commissioning"/);
 const asBuilt=main.slice(main.indexOf('function renderFieldAsBuilt'),main.indexOf('async function prepareSitePhoto'));
 assert.match(asBuilt,/Site photos/);assert.doesNotMatch(asBuilt,/Commissioning engineer|Airflow instrument/);
});
