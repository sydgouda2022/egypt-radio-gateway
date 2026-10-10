export const KNOWN_RADIO = Object.freeze({
  7: ['quran','إذاعة القرآن الكريم'],
  8: ['radio-masr','إذاعة راديو مصر'],
  9: ['voice-arabs','إذاعة صوت العرب'],
  10: ['general','إذاعة البرنامج العام'],
  11: ['youth-sports','إذاعة الشباب والرياضة'],
  12: ['cultural','إذاعة البرنامج الثقافي'],
  13: ['songs','إذاعة الأغاني'],
  14: ['cairo','إذاعة القاهرة الكبرى'],
  16: ['middle-east','إذاعة الشرق الأوسط'],
  18: ['european','إذاعة البرنامج الأوروبي'],
  22: ['directed-2','الإذاعات الموجهة 2'],
  23: ['directed-1','الإذاعات الموجهة 1'],
  24: ['educational','إذاعة التعليمية']
});
export const OFFICIAL_CATALOG_URL='https://www.maspero.eg/stream';
const stripTags = value=>String(value||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
export function knownStation(id) {
  const tuple=KNOWN_RADIO[id];
  if(!tuple)return null;
  return {id:Number(id),slug:tuple[0],name:tuple[1],official_page:OFFICIAL_CATALOG_URL+'/'+id,catalog_state:'active'};
}
export function defaultStations(){return Object.keys(KNOWN_RADIO).map(knownStation);}
export function parseOfficialRadioCatalog(html){
  if(typeof html!=='string'||html.length<100)throw new Error('invalid_catalog_document');
  const marker=html.indexOf('المحطات الاذاعية');
  if(marker<0)throw new Error('radio_section_not_found');
  let section=html.slice(marker);
  const end=section.search(/<footer\b|©\s*20\d\d|جميع الحقوق محفوظة/i);
  if(end>=0)section=section.slice(0,end);
  const observed=new Map();
  const pattern=/<a\b([^>]*?href=["'][^"']*\/stream\/(\d+)(?:[/?#][^"']*)?["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for(const match of section.matchAll(pattern)){
    const id=Number(match[2]);
    if(!Number.isSafeInteger(id)||id<=0)continue;
    const known=knownStation(id);
    const label=stripTags(match[3])||(/(?:alt|title|aria-label)=["']([^"']+)/i.exec(match[3])?.[1]||'');
    observed.set(id,known||{
      id,slug:'maspero-'+id,name:label||'إذاعة ماسبيرو '+id,
      official_page:OFFICIAL_CATALOG_URL+'/'+id,catalog_state:'active'
    });
  }
  // A malformed or changed official page must never retire the registry.
  if(observed.size<5||!observed.has(10)||!observed.has(8))
    throw new Error('radio_section_incomplete:'+observed.size);
  return [...observed.values()].sort((a,b)=>a.id-b.id);
}
export async function getCatalogFromOfficial(fetcher=fetch){
  const response=await fetcher(OFFICIAL_CATALOG_URL,{
    headers:{accept:'text/html'},signal:AbortSignal.timeout(8500)
  });
  if(!response.ok)throw new Error('catalog_http_'+response.status);
  return parseOfficialRadioCatalog(await response.text());
}
