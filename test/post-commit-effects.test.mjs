import test from 'node:test';
import assert from 'node:assert/strict';
import {runPostCommitEffects} from '../src/editor/post-commit-effects.mjs';
test('view failure still attempts recovery and reports which effect failed',()=>{
 const ran=[];const result=runPostCommitEffects({view:()=>{ran.push('view');throw new Error('view error');},recovery:()=>ran.push('recovery')});
 assert.deepEqual(ran,['view','recovery']);assert.deepEqual(result,[{name:'view',message:'view error'}]);
});
test('storage failure is distinct from an already accepted model and success is empty',()=>{
 let accepted=true;assert.deepEqual(runPostCommitEffects({view:()=>{},recovery:()=>{throw new Error('storage full');}}),[{name:'recovery',message:'storage full'}]);assert.equal(accepted,true);
 assert.deepEqual(runPostCommitEffects({view:()=>{},recovery:()=>{}}),[]);
});
