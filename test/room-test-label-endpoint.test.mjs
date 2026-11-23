import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('label-only endpoint validates IDs, strips geometry, and preserves legacy preview', async () => {
  const source = readFileSync(new URL('../supabase/functions/studio-room-test/index.ts', import.meta.url), 'utf8');
  const code=stripTypeScriptTypes(source).replace(/^import .*$/m,'');
  let handler, calls=0, response={labels:[{id:1,label:' Bedroom ',points:[[0,0]]}]};
  const fakeDeno={serve:f=>handler=f,env:{get:(key)=>({
    STUDIO_ROOM_TEST_WORKSPACES:'workspace',STUDIO_ROOM_TEST_OPENAI_MODEL:'fixture'
  }[key]||'mock')}};
  const createClient=()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:()=>({
    select(){return this},eq(){return this},async maybeSingle(){return {data:{role:'owner'}}}
  })});
  const fakeFetch=async (url,{body})=>{
    calls++;
    assert.equal(url,'https://api.openai.com/v1/chat/completions');
    const req=JSON.parse(body);
    if(Array.isArray(response.labels)) assert.match(req.messages[0].content[0].text,/Never redraw a boundary/);
    return Response.json({choices:[{message:{content:JSON.stringify(response)}}]});
  };
  new Function('Deno','createClient','fetch',code)(fakeDeno,createClient,fakeFetch);
  const req=(roomIds)=>new Request('https://test.invalid',{
    method:'POST',headers:{authorization:'Bearer fixture'},
    body:JSON.stringify({workspaceId:'workspace',provider:'openai',image:'data:image/jpeg;base64,AA==',roomIds})
  });
  assert.equal((await handler(req([1,1]))).status,400);
  assert.equal((await handler(req(null))).status,400);
  assert.equal(calls,0);
  let res=await handler(req([1,2]));
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{labels:[{id:1,label:'Bedroom'}]});
  response={labels:[{id:10,label:'Kitchen'}]};
  assert.equal((await handler(req([1]))).status,502);
  response={labels:[{id:1,label:'A'},{id:1,label:'B'}]};
  assert.equal((await handler(req([1,2]))).status,502);
  response={rooms:[{label:'Legacy',points:[[0,0],[0,1],[1,0]]}]};
  res=await handler(req(undefined));
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),response);
});
