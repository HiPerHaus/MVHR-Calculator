import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('proposal UI is distinct from accepted targets and saves only assumptions',async()=>{
 const source=await readFile(new URL('../app/airflow-proposal-ui.mjs',import.meta.url),'utf8');
 const main=await readFile(new URL('../app/main.mjs',import.meta.url),'utf8');
 assert.match(source,/Automatic airflow proposal/);assert.match(source,/Existing targets change only through the explicit review\/apply step/);
 assert.match(source,/Highest complete reference \(Studio policy\)/);assert.match(source,/Actual room geometry estimate \(not PHPP volume\)/);
 assert.match(source,/Save assumptions and recalculate proposal/);assert.match(source,/Export saved proposal/);
 assert.match(main,/type:"airflowProposal.setSettings",settings/);
 assert.doesNotMatch(source,/recordMeasurement|room.updateMetadata|engineering.setNetworkDesign/);
 assert.match(source,/reviewAirflowProposal/);assert.match(source,/scope:scope.control.value/);
 assert.match(source,/'Application scope','floor'/);assert.match(source,/'Existing design values','fill-unset'/);
 assert.match(source,/window.confirm/);assert.match(source,/expectedFingerprint:review.fingerprint/);
 assert.match(source,/confirmReplaceExisting:true/);assert.match(source,/dirty\|\|report.status/);
 assert.match(source,/report.issues/);assert.match(source,/line.missing/);assert.match(source,/assignedExistingM3h/);
 assert.match(main,/"airflow-proposal" \? "Provisional airflow proposal"/);
});
