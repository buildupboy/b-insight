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
  if (conditions.stability==='important')
    exclude(add('stability','안정성'),'행정동·선택 업종·관측 기간이 일치하는 생존 지표가 없습니다.');
  if (conditions.growth==='important')
    exclude(add('growth','성장성'),'상권 변화 자료를 행정동·선택 업종의 성장 지표로 검증할 수 없습니다.');
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
