const populationLabels={
  unspecified:'인구',density:'인구밀도',resident:'거주인구',living:'생활인구',floating:'유동인구'
};

export function describePreferences(conditions, results) {
  const recognized=[];
  const applied=[];
  const unsupported=[];
  const add=(key,label)=>{const item={key,label};recognized.push(item);return item;};
  const exclude=(item,reason)=>unsupported.push({...item,reason});
  const first=results[0];
  const hasScore=first?.score!=null;
  if (conditions.competition==='low') {
    const item=add('lowCompetition','낮은 경쟁');
    if (hasScore && first.effectiveWeights.competition>0) applied.push(item);
    else exclude(item,'비교 가능한 경쟁·상업 활동 점수가 부족합니다.');
  } else if (conditions.competition==='any') {
    const item=add('competitionAny','경쟁 무관');
    if (hasScore) applied.push(item);
    else exclude(item,'경쟁 지표를 제외하면 비교 가능한 점수가 부족합니다.');
  }
  for (const [key,label] of [['stability','안정성'],['growth','성장성']]) {
    if (conditions[key]!=='important') continue;
    const item=add(key,label);
    if (hasScore && first.effectiveWeights[key]>0) applied.push(item);
    else exclude(item,'전체 상권의 과거 이력 또는 비교 가능한 표본이 부족합니다.');
  }
  const types=conditions.populationTypes?.length?conditions.populationTypes:conditions.populationRequested?['unspecified']:[];
  for (const type of new Set(types)) {
    const label=populationLabels[type];
    if (label) exclude(add(type==='unspecified'?'population':`population_${type}`,label),`${label} 자료가 없어 점수에 반영하지 않았습니다.`);
  }
  return {
    mode:applied.length?'adjusted':'default',
    recognized,applied,unsupported,
    effectiveWeights:first?.effectiveWeights??{}
  };
}
