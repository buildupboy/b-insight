import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {rows} from './llm-parsing-evaluation-cases.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'outputs');
const core=['industry','region','competition','stability','growth'];
const fields=[...core,'populationRequested','populationTypes','budget'];
const hash=text=>createHash('sha256').update(text).digest('hex');
const dataset=JSON.stringify(rows,null,2);
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'llm-parsing-evaluation-set-100.json'),dataset);
if(process.argv.includes('--prepare-only')){
 console.log(`평가 문장 ${rows.length}개와 사전 정답 준비 완료. API 호출 없음.`);
 console.log(JSON.stringify(Object.fromEntries([...new Set(rows.map(r=>r.category))].map(k=>[k,rows.filter(r=>r.category===k).length])),null,2));
 process.exit(0);
}
const {parseConditions}=await import(new URL('../backend/conditions.js',import.meta.url));
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const dir=path.join(output,'llm-evaluations',stamp);await mkdir(dir,{recursive:true});
const report={startedAt:new Date().toISOString(),model:process.env.OPENAI_MODEL||'gpt-4o-mini',planned:100,repetitions:1,datasetSha256:hash(dataset),sourceSha256:hash(await readFile(path.join(root,'backend','conditions.js'))),
 rules:{coreFields:core,fullFields:fields,threshold:90,method:'문장별 모든 필드 일치. 평가 전 명시한 대체 표현만 허용하며 인구 종류는 집합 비교. 필드 누락·해석 거부는 오답, 접속·인증·서버 장애는 환경 차단. 전체100건 평가 전에는 최종 통과 선언 없음.'},results:[]};
await writeFile(path.join(dir,'evaluation-set.json'),dataset);
const original=globalThis.fetch;let transport;
globalThis.fetch=async(...args)=>{try{return await original(...args);}catch(e){transport={name:e.name,code:e.cause?.code||e.code||null};throw e;}};
const equal=(a,b)=>Array.isArray(a)&&Array.isArray(b)?JSON.stringify([...a].sort())===JSON.stringify([...b].sort()):a===b;
let stopped=false;
try{
 for(const row of rows){
  if(stopped){report.results.push({...row,status:'not_run'});continue;}
  transport=null;let entry;const start=performance.now();
  try{
   const actual=await parseConditions(row.prompt);
   const correct=Object.fromEntries(fields.map(k=>[k,(row.accepted?.[k]??[row.expected[k]]).some(v=>equal(actual[k],v))]));
   entry={...row,status:'completed',actual,correct,corePass:core.every(k=>correct[k]),fullPass:fields.every(k=>correct[k])};
  }catch(e){
   const blocked=Boolean(transport)||e.name==='ConditionServiceError'&&!e.message.includes('AI가 조건을 해석하지 못');
   entry={...row,status:blocked?'blocked':'rejected',error:{name:e.name,message:e.message,transport},corePass:false,fullPass:false};
   if(blocked)stopped=true;
  }
  entry.elapsedMs=Math.round(performance.now()-start);report.results.push(entry);
  console.log(`[${report.results.length}/100] ${row.id} ${row.category}: ${entry.status==='completed'?(entry.corePass?'핵심 PASS':'핵심 FAIL'):entry.status}`);
  if(entry.status==='completed'&&!entry.corePass)console.log(JSON.stringify({expected:entry.expected,actual:entry.actual,mismatches:core.filter(k=>!entry.correct[k])}));
  if(entry.error)console.log(JSON.stringify(entry.error));
  await writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));
 }
}finally{globalThis.fetch=original;}
const evaluated=report.results.filter(r=>r.status==='completed'||r.status==='rejected');
const summaryFor=list=>({evaluated:list.length,corePass:list.filter(r=>r.corePass).length,fullPass:list.filter(r=>r.fullPass).length,coreAccuracy:list.length?list.filter(r=>r.corePass).length/list.length*100:null,fullAccuracy:list.length?list.filter(r=>r.fullPass).length/list.length*100:null});
report.summary={...summaryFor(evaluated),blocked:report.results.filter(r=>r.status==='blocked').length,notRun:report.results.filter(r=>r.status==='not_run').length,rejected:report.results.filter(r=>r.status==='rejected').length,
 fieldAccuracy:Object.fromEntries(fields.map(k=>[k,evaluated.length?evaluated.filter(r=>r.correct?.[k]).length/evaluated.length*100:null])),
 categories:Object.fromEntries([...new Set(rows.map(r=>r.category))].map(k=>[k,summaryFor(evaluated.filter(r=>r.category===k))]))};
report.summary.decision=evaluated.length===100?(report.summary.coreAccuracy>=90?'PASS':'FAIL'):'BLOCKED';report.finishedAt=new Date().toISOString();
await writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));
const pct=v=>v===null?'미측정':v.toFixed(1)+'%';
let md=`# B-insight 실제 LLM 조건 추출 평가\n\n모델 설정: ${report.model}\n\n시작 UTC: ${report.startedAt}\n\n문장 100개를 각1회 평가한다. 핵심5개 필드가 모두 맞은 문장 기준으로90개 이상이면 통과한다. 실제 API를 호출하며 제품의 파서·프롬프트는 변경하지 않는다.\n\n`;
md+=`|계획|평가 완료|핵심 정답|핵심 정확도|전체8필드 정확도|환경 차단|미실행|최종 판정|\n|---|---|---|---|---|---|---|---|\n|100|${evaluated.length}|${report.summary.corePass}|${pct(report.summary.coreAccuracy)}|${pct(report.summary.fullAccuracy)}|${report.summary.blocked}|${report.summary.notRun}|${report.summary.decision}|\n\n`;
md+='정답은 호출 전에 확정했다. 업종·지역은 원문 표현을 유지하는 현재 명세를 따른다. 역 이름의 ‘근처’ 유무만 미리 허용한 대체 표현으로 인정한다. 인구 종류 배열은 순서를 무시한다. 생략된 경쟁·안정성·성장성은 보통, 업종 미지정은 빈 문자열, 지역 미지정은 부산 전체이다. 문장 내 정정은 최종 요청을 따른다. 완전한 복수 업종·복수 지역처럼 단일 정답을 정할 수 없는 질의는 이 점수표에 포함하지 않았다.\n\n';
md+='|유형|평가 완료|핵심 정답|정확도|\n|---|---|---|---|\n';
for(const [k,v]of Object.entries(report.summary.categories))md+=`|${k}|${v.evaluated}|${v.corePass}|${pct(v.coreAccuracy)}|\n`;
md+='\n|ID|유형|질의|결과|\n|---|---|---|---|\n';
for(const r of report.results)md+=`|${r.id}|${r.category}|${r.prompt}|${r.status==='completed'?`핵심 ${r.corePass?'PASS':'FAIL'} / 전체 ${r.fullPass?'PASS':'FAIL'}`:r.status==='rejected'?'추출 거부·형식 오류 (오답)':r.status==='blocked'?'환경 차단':'미실행'}|\n`;
md+='\n이는 사전 작성한100개 질의에 대한1회 결과이다. 전체 사용자에 대한 일반화 정확도나 반복 실행 재현성을 보장하지 않는다. 결과를 본 뒤 정답을 고치지 않으며 정답 이견은 별도로 검토한다. JSON에 사전 정답·실제 출력·필드별 결과·코드 해시가 포함된다.\n';
await writeFile(path.join(dir,'report.md'),md);
console.log('\n최종 결과\n'+JSON.stringify(report.summary,null,2));console.log('\n저장 위치: '+dir);
if(report.summary.decision==='BLOCKED')process.exitCode=2;
