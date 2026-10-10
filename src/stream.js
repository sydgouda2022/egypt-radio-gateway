// The list is deliberately limited to public direct audio candidates.
// Provider-restricted Dailymotion URLs and HTML player pages are excluded.
export const DIRECT_AUDIO_CANDIDATES=Object.freeze({
  general:Object.freeze([
    {id:'radiotub-icecast',url:'https://stream.radiotub.com/ertu-cairo'},
    {id:'ertu-direct',url:'http://stream.ertu.org:8000/programG'}
  ])
});
export const DEFAULT_PROBE_TIMEOUT=3800;
const AUDIO_TYPE=/^(audio\/(?:mpeg|mp3|aac|aacp|ogg|opus|mp4|x-mpeg)|application\/ogg)(?:\s*;|$)/i;
function fail(reason,extra={}){return {ok:false,reason,...extra};}
export function looksLikeAudio(first,mime){
  if(!first?.byteLength)return false;
  const text=new TextDecoder().decode(first.slice(0,Math.min(180,first.length))).trimStart().toLowerCase();
  if(/^(<!doctype|<html|<\?xml|<head|\{|\[|#extm3u|error|access denied|forbidden)/.test(text))return false;
  const mp3=first.length>=3&&((first[0]===0x49&&first[1]===0x44&&first[2]===0x33)||(first[0]===0xff&&(first[1]&0xe0)===0xe0));
  const ogg=first.length>=4&&first[0]===0x4f&&first[1]===0x67&&first[2]===0x67&&first[3]===0x53;
  const mp4=first.length>=8&&first[4]===0x66&&first[5]===0x74&&first[6]===0x79&&first[7]===0x70;
  return mp3||ogg||mp4||(AUDIO_TYPE.test(mime)&&first.length>=4&&!/^[\x20-\x7e\r\n\t]+$/.test(text));
}
export async function openAudioCandidate(candidate,fetcher=fetch,timeoutMs=DEFAULT_PROBE_TIMEOUT){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort('audio_probe_timeout'),timeoutMs);
  const started=Date.now();
  try{
    const response=await fetcher(candidate.url,{
      method:'GET',redirect:'follow',signal:controller.signal,
      headers:{accept:'audio/*,application/ogg;q=0.9,*/*;q=0.1','icy-metadata':'0'}
    });
    const mime=(response.headers.get('content-type')||'').toLowerCase();
    if(!response.ok){controller.abort();return fail('upstream_http_error',{status:response.status,mime,elapsed_ms:Date.now()-started});}
    if(!response.body){controller.abort();return fail('upstream_no_body',{status:response.status,mime});}
    if(!AUDIO_TYPE.test(mime)&&mime!=='application/octet-stream'){
      controller.abort();return fail('not_an_audio_response',{status:response.status,mime});
    }
    const reader=response.body.getReader();
    const part=await reader.read();
    if(part.done||!part.value?.byteLength){
      try{await reader.cancel();}catch{}
      controller.abort();return fail('upstream_no_audio_bytes',{status:response.status,mime});
    }
    if(!looksLikeAudio(part.value,mime)){
      try{await reader.cancel();}catch{}
      controller.abort();return fail('invalid_audio_signature',{status:response.status,mime});
    }
    clearTimeout(timeout);
    return {ok:true,source:candidate.id,mime:AUDIO_TYPE.test(mime)?mime:'audio/mpeg',
      latency_ms:Date.now()-started,reader,initial:part.value,controller};
  }catch(error){
    controller.abort();
    return fail(error?.name==='AbortError'||String(error).includes('abort')?'probe_timeout':'upstream_fetch_failed',
      {detail:String(error?.message||error),elapsed_ms:Date.now()-started});
  }finally{clearTimeout(timeout);}
}
export async function findAudioSource(candidates,fetcher=fetch,timeoutMs=DEFAULT_PROBE_TIMEOUT){
  if(!candidates?.length)return {ok:false,attempts:[]};
  const attempts=[];let settled=false;let pending=candidates.length;
  return new Promise(resolve=>{
    candidates.forEach(candidate=>{
      openAudioCandidate(candidate,fetcher,timeoutMs).then(async result=>{
        if(settled){
          if(result.ok){try{await result.reader.cancel();}catch{}result.controller.abort();}
          return;
        }
        if(result.ok){settled=true;resolve({...result,attempts});return;}
        attempts.push({source:candidate.id,...result});
        if(--pending===0){settled=true;resolve({ok:false,attempts});}
      }).catch(error=>{
        attempts.push({source:candidate.id,ok:false,reason:'unexpected_probe_error',detail:String(error)});
        if(!settled&&--pending===0){settled=true;resolve({ok:false,attempts});}
      });
    });
  });
}
export async function closeSource(source){
  if(!source?.ok)return;
  try{await source.reader.cancel();}catch{}
  source.controller.abort();
}
export function audioResponse(source,method='GET'){
  const headers=new Headers({
    'content-type':source.mime,'cache-control':'no-store',
    'access-control-allow-origin':'*','accept-ranges':'none',
    'x-radio-source':source.source,'x-content-type-options':'nosniff'
  });
  if(method==='HEAD')return new Response(null,{status:200,headers});
  // Pull-based relay: an infinite audio stream must NEVER be read
  // into an unbounded queue faster than the listener consumes it.
  let first=false;
  const body=new ReadableStream({
    async pull(out){
      if(!first){first=true;out.enqueue(source.initial);return;}
      try{
        const part=await source.reader.read();
        if(part.done){out.close();source.controller.abort();}
        else out.enqueue(part.value);
      }catch(error){source.controller.abort();out.error(error);}
    },
    cancel(){source.controller.abort();void source.reader.cancel().catch(()=>{});}
  });
  return new Response(body,{status:200,headers});
}
