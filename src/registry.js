import {KNOWN_RADIO,defaultStations,getCatalogFromOfficial} from './catalog.js';
const SCHEMA=[
  'CREATE TABLE IF NOT EXISTS radio_stations (id INTEGER PRIMARY KEY,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL,official_page TEXT NOT NULL,catalog_state TEXT NOT NULL DEFAULT \'active\',first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,missing_count INTEGER NOT NULL DEFAULT 0,missing_since INTEGER)',
  'CREATE TABLE IF NOT EXISTS catalog_scans (id INTEGER PRIMARY KEY AUTOINCREMENT,checked_at INTEGER NOT NULL,valid INTEGER NOT NULL,station_count INTEGER,error TEXT)'
];
export async function initializeRegistry(env){
  if(!env?.DB)throw new Error('D1_not_bound');
  for(const sql of SCHEMA)await env.DB.prepare(sql).run();
}
export async function syncRegistry(env,fetcher=fetch,now=Date.now()){
  await initializeRegistry(env);
  let discovered;
  try{discovered=await getCatalogFromOfficial(fetcher);}
  catch(error){
    await env.DB.prepare('INSERT INTO catalog_scans (checked_at,valid,station_count,error) VALUES (?,0,0,?)')
      .bind(now,String(error?.message||error)).run();
    return {ok:false,error:String(error?.message||error),changed:false};
  }
  const seen=new Set(discovered.map(x=>x.id));
  const old=(await env.DB.prepare('SELECT id,missing_count,missing_since FROM radio_stations').all()).results||[];
  const batch=[];
  for(const x of discovered){
    batch.push(env.DB.prepare(
      'INSERT INTO radio_stations (id,slug,name,official_page,catalog_state,first_seen_at,last_seen_at,missing_count,missing_since) '+
      "VALUES (?,?,?,?,'active',?,?,0,NULL) ON CONFLICT(id) DO UPDATE SET "+
      "name=excluded.name,official_page=excluded.official_page,catalog_state='active',last_seen_at=excluded.last_seen_at,missing_count=0,missing_since=NULL"
    ).bind(x.id,x.slug,x.name,x.official_page,now,now));
  }
  for(const row of old){
    if(seen.has(row.id))continue;
    const misses=row.missing_count+1;
    const since=row.missing_since??now;
    const status=misses>=3&&now-since>=7*86400000?'retired':misses>=3?'unavailable':'suspected_missing';
    batch.push(env.DB.prepare('UPDATE radio_stations SET missing_count=?,missing_since=?,catalog_state=? WHERE id=?').bind(misses,since,status,row.id));
  }
  batch.push(env.DB.prepare('INSERT INTO catalog_scans (checked_at,valid,station_count,error) VALUES (?,1,?,NULL)').bind(now,discovered.length));
  await env.DB.batch(batch);
  return {ok:true,station_count:discovered.length,checked_at:now};
}
export async function listRegistry(env){
  await initializeRegistry(env);
  const stored=(await env.DB.prepare('SELECT id,slug,name,official_page,catalog_state,missing_count FROM radio_stations ORDER BY id').all()).results||[];
  return stored.length?stored:defaultStations().map(x=>({...x,catalog_state:'not_yet_synced',missing_count:0}));
}
export async function getBySlug(env,slug){
  const entry=Object.entries(KNOWN_RADIO).find(([,x])=>x[0]===slug);
  if(entry)return defaultStations().find(x=>x.slug===slug);
  if(!env?.DB)return null;
  await initializeRegistry(env);
  return env.DB.prepare('SELECT id,slug,name,official_page,catalog_state FROM radio_stations WHERE slug=?').bind(slug).first();
}
export async function latestScan(env){
  await initializeRegistry(env);
  return env.DB.prepare('SELECT checked_at,valid,station_count,error FROM catalog_scans ORDER BY id DESC LIMIT 1').first();
}
