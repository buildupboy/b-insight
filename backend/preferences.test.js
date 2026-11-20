import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './conditions.js';
import { describePreferences } from './preferences.js';

const input={industry:'카페',region:'부산진구'};
const ranked=[{score:75,effectiveWeights:{fit:55,competition:45}}];
const rankedLow=[{score:75,effectiveWeights:{fit:43,competition:57}}];

test('기본 조건은 선호를 추가하지 않고 기존 가중치를 공개한다',()=>{
  const conditions=validate(input);
  assert.deepEqual(describePreferences(conditions,ranked),{
    mode:'default',recognized:[],applied:[],unsupported:[],effectiveWeights:{fit:55,competition:45}
  });
});

test('낮은 경쟁은 한 번만 적용하고 복합 미지원 조건을 구분한다',()=>{
  const conditions=validate({...input,competition:'low',stability:'important',growth:'important',
    populationRequested:true,populationTypes:['density','floating','density']});
  assert.deepEqual(conditions.populationTypes,['density','floating']);
  const summary=describePreferences(conditions,rankedLow);
  assert.equal(summary.mode,'adjusted');
  assert.deepEqual(summary.recognized.map(item=>item.label),['낮은 경쟁','안정성','성장성','인구밀도','유동인구']);
  assert.deepEqual(summary.applied.map(item=>item.key),['lowCompetition']);
  assert.deepEqual(summary.unsupported.map(item=>item.key),['stability','growth','population_density','population_floating']);
  assert.equal(Object.values(summary.effectiveWeights).reduce((a,b)=>a+b,0),100);
  assert(summary.unsupported.every(item=>item.reason));
});

test('거주·생활·유동인구, 밀도, 일반 인구를 구분하고 레거시 입력도 받는다',()=>{
  for (const type of ['density','resident','living','floating','unspecified']) {
    const conditions=validate({...input,populationTypes:[type]});
    assert.equal(conditions.populationRequested,true);
    const summary=describePreferences(conditions,ranked);
    assert.equal(summary.mode,'default');
    assert.equal(summary.unsupported.length,1);
    assert.equal(summary.applied.length,0);
  }
  assert.deepEqual(validate({...input,populationRequested:true}).populationTypes,['unspecified']);
  assert.deepEqual(validate({...input,months:12}),validate(input));
});

test('비교 후보가 부족하면 경쟁 선호도 적용된 것으로 표시하지 않는다',()=>{
  const summary=describePreferences(validate({...input,competition:'low'}),[{score:null,effectiveWeights:{}}]);
  assert.equal(summary.mode,'default');
  assert.deepEqual(summary.applied,[]);
  assert.equal(summary.unsupported[0].key,'lowCompetition');
  assert.deepEqual(summary.effectiveWeights,{});
});
