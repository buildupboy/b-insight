import { request, DataApiError } from './data.js';

const operations = [
  { service:'소진공 상권', base:process.env.SEMAS_API_BASE_URL || 'https://apis.data.go.kr/B553077/api/open/sdsc2', route:process.env.SEMAS_ZONES_BY_DONG_PATH || '/storeZoneInAdmi', params:{divId:'ctprvnCd',key:'26',type:'json'}, keyName:'servicekey' },
  { service:'소진공 업종 소분류', base:process.env.SEMAS_API_BASE_URL || 'https://apis.data.go.kr/B553077/api/open/sdsc2', route:process.env.SEMAS_UPJONG_SMALL_PATH || '/smallUpjongList', params:{type:'json'}, keyName:'servicekey' },
  { service:'소진공 업종 대분류', base:process.env.SEMAS_API_BASE_URL || 'https://apis.data.go.kr/B553077/api/open/sdsc2', route:process.env.SEMAS_UPJONG_LARGE_PATH || '/largeUpjongList', params:{type:'json'}, keyName:'ServiceKey' },
  { service:'부산 변화지표', base:process.env.BUSAN_CHANGE_API_BASE_URL || 'https://apis.data.go.kr/6260000/BusanCommercialChangeService', route:process.env.BUSAN_CHANGE_API_PATH || '/getCommercialChangeList', params:{pageNo:1,numOfRows:10,resultType:'json'}, keyName:'serviceKey' },
  { service:'부산 점포이력', base:process.env.BUSAN_STORE_HISTORY_API_BASE_URL || 'https://apis.data.go.kr/6260000/BusanCommercialHistoryService', route:process.env.BUSAN_STORE_HISTORY_API_PATH || '/getCommercialHistoryList', params:{pageNo:1,numOfRows:10,resultType:'json',rdnwhladdr:'부산진구'}, keyName:'serviceKey' }
];
for (const operation of operations) {
  try {
    const result = await request(operation.base,operation.route,operation.params,operation.keyName);
    const sampleValues = operation.route.includes('CommercialHistory') ? Object.fromEntries(['majornm','minornm','upjongnm'].map(field=>[field,[...new Set(result.rows.map(row=>String(row[field]||'').trim()).filter(Boolean))].slice(0,8)])) : undefined;
    const dateFormats = operation.route.includes('CommercialHistory') ? Object.fromEntries(['apvpermymd','dcbymd'].map(field=>[field,[...new Set(result.rows.map(row=>String(row[field]||'').replace(/\d/g,'0')).filter(Boolean))].slice(0,4)])) : undefined;
    const addressCoverage = operation.route.includes('CommercialHistory') ? {requestedDistrict:String(operation.params.rdnwhladdr||''),rowsContainingDistrict:result.rows.filter(row=>String(row.rdnwhladdr||'').includes(String(operation.params.rdnwhladdr||''))).length,rowsContainingDongToken:result.rows.filter(row=>/(동|읍|면)\s/.test(String(row.rdnwhladdr||''))).length} : undefined;
    console.log(JSON.stringify({ ...result.diagnostic, receivedRows:result.rawCount, sourceFieldNames:result.sourceFields, selectedFields:[...new Set(result.rows.flatMap(row => Object.keys(row)))].sort(), total:result.total, sampleValues, dateFormats, addressCoverage }));
    if(operation.route.includes('CommercialHistory')) {
      for(const address of ['부산진구','부산진구 부전1동','부산진구 부전2동','부산진구 전포1동','부산진구 전포2동','부전1동','전포1동']) {
        try {
          const scoped=await request(operation.base,operation.route,{pageNo:1,numOfRows:10,resultType:'json',rdnwhladdr:address},operation.keyName);
          const normalizedFilter=address.replace(/\s/g,'');
          const addressMatches=scoped.rows.filter(row=>String(row.rdnwhladdr||'').replace(/\s/g,'').includes(normalizedFilter)).length;
          const returnedAreaTokens=[...new Set(scoped.rows.flatMap(row=>String(row.rdnwhladdr||'').match(/[가-힣]+(?:구|동)/g)||[]))].slice(0,8);
          console.log(JSON.stringify({service:operation.service,operation:operation.route.split('/').at(-1),addressFilter:address,status:scoped.diagnostic.status,receivedRows:scoped.rawCount,total:scoped.total,addressMatchesInPage:addressMatches,returnedAreaTokens}));
        } catch(error) {
          console.log(JSON.stringify({service:operation.service,operation:operation.route.split('/').at(-1),addressFilter:address,status:error.diagnostic?.status??null,reason:error instanceof DataApiError?error.message.split(': ').at(-1):'요청 실패'}));
        }
      }
    }
  } catch (error) {
    if (error instanceof DataApiError) console.log(JSON.stringify({ ...error.diagnostic, reason:error.message.split(': ').at(-1) }));
    else console.log(JSON.stringify({ service:operation.service, operation:operation.route.split('/').at(-1), reason:'진단을 완료할 수 없습니다.' }));
  }
}
