import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {parseOfficialRadioCatalog} from '../src/catalog.js';
import {looksLikeAudio,openAudioCandidate,findAudioSource,closeSource,audioResponse} from '../src/stream.js';
const mp3=new Uint8Array([0x49,0x44,0x33,0x04,0,0,0,0,0,6,0xff,0xfb,0x10,0x09]);
const good=()=>new Response(mp3,{status:200,headers:{'content-type':'audio/mpeg'}});
const first={id:'one',url:'https://test/one'};
test('catalog includes radio only, not TV',()=>{
 const ids=[7,8,9,10,11,12];
 const html='<html><a href="/stream/1">TV</a><h2>المحطات الاذاعية</h2>'+
   ids.map(id=>'<a href="/stream/'+id+'">radio</a>').join('')+
   '<a href="/stream/31">محطة جديدة</a><footer>© 2026</footer></html>';
 const result=parseOfficialRadioCatalog(html);
 assert(!result.some(x=>x.id===1));assert(result.some(x=>x.id===31));
});
test('invalid catalog fails closed',()=>{
 assert.throws(()=>parseOfficialRadioCatalog('<html>'+'x'.repeat(200)+'</html>'));
});
test('audio magic bytes verified, HTML masquerading as audio rejected',()=>{
 assert(looksLikeAudio(mp3,'audio/mpeg'));
 assert(!looksLikeAudio(new TextEncoder().encode('<html>Oops</html>'),'audio/mpeg'));
});
test('526 rejected',async()=>{
 const r=await openAudioCandidate(first,async()=>new Response('error',{status:526}));
 assert.equal(r.ok,false);assert.equal(r.status,526);
});
test('200 HTML mislabeled audio rejected',async()=>{
 const r=await openAudioCandidate(first,async()=>new Response('<html>error</html>',{headers:{'content-type':'audio/mpeg'}}));
 assert.equal(r.ok,false);
});
test('real audio preserved by streaming response',async()=>{
 const source=await openAudioCandidate(first,async()=>good());
 assert.equal(source.ok,true);
 const output=audioResponse(source);
 assert.deepEqual(new Uint8Array(await output.arrayBuffer()),mp3);
});
test('fallback to second source',async()=>{
 const r=await findAudioSource([{id:'bad',url:'https://test/bad'},{id:'good',url:'https://test/good'}],
   async url=>url.endsWith('/bad')?new Response('SSL',{status:526}):good());
 assert.equal(r.ok,true);assert.equal(r.source,'good');await closeSource(r);
});
test('no source returns plain 503, not JSON',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('SSL',{status:526});
 try{
  const res=await worker.fetch(new Request('https://test/stream/general'),{});
  assert.equal(res.status,503);assert.match(res.headers.get('content-type'),/text\/plain/);
 }finally{globalThis.fetch=old;}
});
test('health reports real failure, never fake ok true',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('SSL',{status:526});
 try{
  const res=await worker.fetch(new Request('https://test/health/general'),{});
  assert.equal((await res.json()).ok,false);
 }finally{globalThis.fetch=old;}
});
test('working audio endpoint gives 200 bytes, not redirect',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>good();
 try{
  const res=await worker.fetch(new Request('https://test/stream/general'),{});
  assert.equal(res.status,200);assert.equal(res.headers.get('location'),null);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()),mp3);
 }finally{globalThis.fetch=old;}
});
