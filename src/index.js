import {DIRECT_AUDIO_CANDIDATES,findAudioSource,closeSource,audioResponse} from './stream.js';
import {getBySlug,listRegistry,latestScan,syncRegistry} from './registry.js';
import {getCatalogFromOfficial} from './catalog.js';
const json=(x,status=200)=>new Response(JSON.stringify(x,null,2),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
const unavailable=(method='GET')=>new Response(method==='HEAD'?null:'Radio stream currently unavailable',{
  status:503,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',
    'retry-after':'180','access-control-allow-origin':'*'}
});
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function dashboard(stations,origin){
  const cards=stations.map(s=>{
    const active=!!DIRECT_AUDIO_CANDIDATES[s.slug]?.length;
    return '<article><strong>'+esc(s.name)+'</strong><p>'+
      (active?'Public audio candidates configured, but not yet confirmed playable.':'No confirmed external audio source.')+
      '</p><a href="/health/'+encodeURIComponent(s.slug)+'">Live Test / Diagnostics</a>'+
      (active?'<code>'+origin+'/stream/'+encodeURIComponent(s.slug)+'</code>'+
        '<button data-copy="'+origin+'/stream/'+encodeURIComponent(s.slug)+'">Copy testing link</button>':'')+
      '<small>Official catalog state: '+esc(s.catalog_state||'unknown')+'</small></article>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Egypt Radio Gateway</title>'+
    '<style>body{font-family:system-ui;background:#0e192b;color:#f3f6fc;max-width:850px;margin:auto;padding:20px}article{background:#1a2c44;padding:16px;margin:12px 0;border-radius:12px;display:grid;gap:8px}a{color:#99caff}code{overflow-wrap:anywhere;color:#b8d7ff}button{width:fit-content;padding:8px}small{color:#b7c9df}</style></head><body>'+
    '<h1>Egypt Radio Gateway</h1><p>Station discovery is not stream verification. Live Test checks HTTP status, MIME and real audio bytes. This gateway does not bypass playback restrictions.</p>'+
    cards+'<script>document.addEventListener("click",e=>{const b=e.target.closest("[data-copy]");if(b)navigator.clipboard.writeText(b.dataset.copy).then(()=>b.textContent="Copied")});</script></body></html>';
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const path=url.pathname.replace(/\/+$/,'')||'/';
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
      'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'*'
    }});
    if(!['GET','HEAD'].includes(request.method))return new Response('Method Not Allowed',{status:405,headers:{allow:'GET, HEAD, OPTIONS'}});
    try{
      if(path==='/'||path==='/api/stations'){
        const stations=await listRegistry(env);
        return path==='/'?new Response(dashboard(stations,url.origin),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}}):
          json({stations,note:'Catalogue presence does not imply playable audio.'});
      }
      if(path==='/api/sync-status')return json({last_scan:await latestScan(env)});
      // Read-only preview of official radio section; never mutates D1.
      if(path==='/api/catalog-preview')return json({stations:await getCatalogFromOfficial()});
      const stream=path.match(/^\/stream\/([a-z0-9-]+)$/i);
      const health=path.match(/^\/health\/([a-z0-9-]+)$/i);
      if(stream||health){
        const slug=(stream||health)[1];
        const station=await getBySlug(env,slug);
        if(!station)return stream?unavailable(request.method):json({error:'station_not_found'},404);
        const source=await findAudioSource(DIRECT_AUDIO_CANDIDATES[slug]||[]);
        if(health){
          const result=source.ok?{
            status:'verified_audio_at_request_time',mime:source.mime,
            provider:source.source,first_audio_byte_ms:source.latency_ms
          }:{status:'unavailable',attempts:source.attempts};
          await closeSource(source);
          return json({station,ok:source.ok,...result,checked_at:new Date().toISOString()});
        }
        if(!source.ok)return unavailable(request.method);
        if(request.method==='HEAD'){
          const result=audioResponse(source,'HEAD');
          await closeSource(source);
          return result;
        }
        return audioResponse(source,'GET');
      }
      return json({error:'not_found'},404);
    }catch(error){
      // Never send a JSON diagnostics response in a media route.
      if(path.startsWith('/stream/'))return unavailable(request.method);
      return json({error:'gateway_error',detail:String(error?.message||error)},503);
    }
  },
  async scheduled(event,env,ctx){
    ctx.waitUntil(syncRegistry(env).catch(error=>console.error('catalog_sync_failed',String(error))));
  }
};
