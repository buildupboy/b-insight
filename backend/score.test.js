import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCandidate,rank} from './score.js';

const industry={label:'카페',filter:{indsSclsCd:'I21201'}};
const dong=(id,name)=>({adongCd:id,adongNm:name,signguNm:'부산진구'});
const store=(id,code,small='I21201')=>({bizesId:id,adongCd:code,indsSclsCd:small,stdrYm:'202601'});
const result=rows=>({rows,truncated:false,total:rows.length,rawCount:rows.length});
const conditions={competition:'low',stability:'important',growth:'normal'};
test('행정동 비교값이 다르면 실제 점포 수와 업종 비중으로 점수를 만들고 상위 3개만 반환한다',()=>{
  const rows=Array.from({length:4},(_,i)=>{
    const code='2623010'+String(i).padStart(3,'0');
    const all=Array.from({length:10+i*5},(_,n)=>store(String(i)+'-'+n,code,n<2+i*2?'I21201':'I29999'));
    return makeCandidate(dong(code,'부전'+(i+1)+'동'),result(all),result(all.filter(r=>r.indsSclsCd==='I21201')),industry);
  });
  const top=rank(rows,conditions);
  assert.equal(top.length,3);
  assert(top.every(row=>row.score!==null));
  assert(top.every(row=>row.name.startsWith('부산진구 부전')));
  assert(top.every(row=>row.metrics.openings===null&&row.metrics.stability===null));
  assert(top.every(row=>row.effectiveWeights.fit>0&&row.effectiveWeights.competition>0));
});
test('불완전한 페이지, 업종 점포 ID 불일치, 비교값 동률은 점수와 수치를 만들지 않는다',()=>{
  const code='2623010000', all=result([store('1',code),store('2',code)]);
  const invalid=makeCandidate(dong(code,'부전동'),all,result([store('other',code)]),industry);
  assert.equal(invalid.metrics.industryStores,null);
  const a=makeCandidate(dong(code,'부전동'),all,result([store('1',code)]),industry);
  const b=makeCandidate(dong('2623010001','전포동'),result([store('3','2623010001'),store('4','2623010001')]),result([store('3','2623010001')]),industry);
  rank([a,b],conditions);
  assert.equal(a.score,null);
  assert.equal(b.verdict,'상대평가 불가');
});

test('stale event history remains visible but is excluded from growth scoring',()=>{
  const code='2623010000', all=result([store('1',code)]);
  const candidate=makeCandidate(dong(code,'\uBD80\uC8042\uB3D9'),all,all,industry,{
    verified:true,openings:0,closures:1,matchedRows:12,fields:['apvpermymd','dcbymd'],
    period:{from:'2022-05-26',to:'2023-05-26',stale:true,latestObserved:'2023-05-26'}
  },67);
  assert.equal(candidate.metrics.openings,0);
  assert.equal(candidate.metrics.closures,1);
  assert.equal(candidate.metrics.growth,null);
  assert.equal(candidate.metrics.historyRecords,12);
});

test('기본 점수와 낮은 경쟁 선호는 기존 두 지표만 100%로 배분한다',()=>{
  const make=()=>[
    makeCandidate(dong('a','A'),{count:100},{count:10},industry),
    makeCandidate(dong('b','B'),{count:200},{count:50},industry)
  ];
  const normal=rank(make(),{competition:'normal',stability:'normal',growth:'normal'});
  const low=rank(make(),{competition:'low',stability:'important',growth:'important'});
  assert.deepEqual(normal.map(row=>[row.name,row.score]),[['부산진구 B',55],['부산진구 A',45]]);
  assert.deepEqual(low.map(row=>[row.name,row.score]),[['부산진구 A',57],['부산진구 B',43]]);
  assert.deepEqual(normal[0].effectiveWeights,{fit:55,competition:45});
  assert.deepEqual(low[0].effectiveWeights,{fit:43,competition:57});
  assert.equal(Object.values(low[0].effectiveWeights).reduce((a,b)=>a+b,0),100);
  assert(low.every(row=>row.scores.stability===null&&row.scores.growth===null));
});

test('미지원 안정성·성장성 요청은 지표가 전달되어도 기본 점수를 바꾸지 않는다',()=>{
  const make=()=>[
    makeCandidate(dong('a','A'),{count:100},{count:10},industry,null,25),
    makeCandidate(dong('b','B'),{count:200},{count:50},industry,null,75)
  ];
  const base=rank(make(),{competition:'normal',stability:'normal',growth:'normal'});
  const unsupported=rank(make(),{competition:'normal',stability:'important',growth:'important'});
  assert.deepEqual(unsupported.map(row=>[row.name,row.score,row.effectiveWeights]),
    base.map(row=>[row.name,row.score,row.effectiveWeights]));
});

test('기존의 두 후보 0점·100점은 후보만으로 정규화했을 때 발생한다',()=>{
  const a=()=>makeCandidate(dong('a','A'),{count:100},{count:30},industry);
  const b=()=>makeCandidate(dong('b','B'),{count:200},{count:20},industry);
  const c=()=>makeCandidate(dong('c','C'),{count:400},{count:60},industry);
  const pair=rank([a(),b()],{competition:'normal'});
  assert.deepEqual(pair.map(row=>[row.name,row.score]),[['부산진구 B',100],['부산진구 A',0]]);
  const wider=rank([a(),b(),c()],{competition:'normal'});
  assert.notEqual(wider.find(row=>row.name==='부산진구 B').score,100);
  assert.equal(rank([a()],{competition:'normal'})[0].score,null);
  const tied=rank([a(),a()],{competition:'normal'});
  assert(tied.every(row=>row.score===null));
});

test('공통 업종 모집단으로 정규화하면 두 동과 단일 동도 검색 범위에 무관하게 같은 점수다',()=>{
  const make=()=>[
    makeCandidate(dong('h1','하단1동'),{count:854},{count:52},industry),
    makeCandidate(dong('h2','하단2동'),{count:1586},{count:86},industry),
    makeCandidate(dong('d','다대1동'),{count:200},{count:0},industry),
    makeCandidate(dong('b','부전2동'),{count:4174},{count:147},industry)
  ];
  const conditions={competition:'normal'};
  const all=make();
  rank(all,conditions);
  const reference=make();
  const pair=rank(reference,conditions,reference.slice(0,2));
  const oneReference=make();
  const one=rank(oneReference,conditions,[oneReference[1]]);
  for(const row of [...pair,...one]) {
    const baseline=all.find(candidate=>candidate.name===row.name);
    assert.equal(row.score,baseline.score);
    assert.deepEqual(row.scores,baseline.scores);
    assert.deepEqual(row.effectiveWeights,baseline.effectiveWeights);
  }
  assert(pair.every(row=>row.score>0&&row.score<100));
  assert.equal(one.length,1);
  assert.equal(one[0].scoreUnavailableReason,null);
  assert.equal(reference[2].metrics.industryStores,0);
  assert(Number.isFinite(reference[2].scores.competition));
});

test('전체 모집단에서 동률·누락 지표는 임의 점수를 만들지 않는다',()=>{
  const make=(id,total,selected)=>makeCandidate(dong(id,id),{count:total},{count:selected},industry);
  const tied=[make('a',100,10),make('b',100,10),make('c',100,10)];
  assert(rank(tied,{competition:'normal'}).every(row=>row.score===null));
  const missing=[make('a',100,10),make('b',200,20),make('bad',100,101)];
  rank(missing,{competition:'normal'});
  assert.equal(missing.find(row=>row.name==='부산진구 bad').score,null);
});
