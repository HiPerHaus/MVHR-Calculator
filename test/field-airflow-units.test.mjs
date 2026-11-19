import test from 'node:test';
import assert from 'node:assert/strict';
import {lpsToM3h,m3hToLps} from '../src/editor/field-airflow-units.mjs';
test('field m3/h values convert exactly once without changing canonical evidence',()=>{
 assert.equal(lpsToM3h(10),36);assert.equal(m3hToLps(36),10);
 assert.equal(lpsToM3h(0),0);assert.equal(m3hToLps(0),0);
 assert.equal(lpsToM3h(null),null);assert.equal(m3hToLps(null),null);
 assert.equal(lpsToM3h(undefined),null);assert.equal(lpsToM3h(NaN),null);
 assert.equal(lpsToM3h(-5),-18);
 for(const value of [0,9,12.5,100/3.6])assert.ok(Math.abs(m3hToLps(lpsToM3h(value))-value)<1e-10);
});

test('commissioning UI converts display input back to canonical L/s before saving',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../app/main.mjs',import.meta.url),'utf8');
 assert.match(source,/fieldInput\("Measured room total \(m³\/h\)", lpsToM3h\(line.measuredLps\)/);
 assert.match(source,/measuredLps:m3hToLps\(value\)/);
 assert.doesNotMatch(source,/Measured room total \(l\/s\)/);
});
