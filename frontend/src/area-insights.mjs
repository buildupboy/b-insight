const number = (value, maximumFractionDigits = 0) =>
  value.toLocaleString('ko-KR', {maximumFractionDigits});
const factorLabels = {fit:'상권 규모', competition:'경쟁 적합도', stability:'안정성', growth:'성장성'};
// area.name은 "부산진구 부전1동"처럼 구 이름을 포함하므로 동 이름만 남긴다.
const dongName = area => {
  const name = String(area?.name || '').trim();
  if (!name) return '이 행정동';
  return area.region && name.startsWith(`${area.region} `) ? name.slice(area.region.length + 1) : name;
};

export function recentEvents(history, months) {
  const trend = history?.eventTrend ?? [];
  const to = history?.growthPeriod?.to ?? trend.at(-1)?.month;
  if (!to || !trend.length) return null;
  const [year, month] = to.split('-').map(Number);
  const from = new Date(Date.UTC(year, month - months, 1)).toISOString().slice(0, 7);
  const rows = trend.filter(row => row.month >= from && row.month <= to);
  const byMonth = new Map(rows.map(row => [row.month, row]));
  const series = Array.from({length:months}, (_, index) => {
    const monthKey = new Date(Date.UTC(year, month - months + index, 1)).toISOString().slice(0, 7);
    return byMonth.get(monthKey) ?? {month:monthKey, openings:0, closures:0};
  });
  return {
    from, to, rows:series,
    openings:rows.reduce((total, row) => total + row.openings, 0),
    closures:rows.reduce((total, row) => total + row.closures, 0)
  };
}

export function recommendationReason(area, industry) {
  if (area.score == null) return '비교할 수 있는 지표가 부족해 추천 순위를 매기기 어려워요.';
  const {metrics, scores, effectiveWeights, historyContext:history} = area;
  const industryLabel = industry || '선택 업종';
  const evidence = {
    fit:Number.isFinite(metrics.totalStores) && `${dongName(area)}에는 모든 업종을 합쳐 점포 ${number(metrics.totalStores)}곳이 있어요`,
    competition:Number.isFinite(metrics.competition) && Number.isFinite(metrics.industryStores) &&
      `동일 업종(${industryLabel}) 점포는 ${number(metrics.industryStores)}곳으로, ${dongName(area)} 전체 업종 점포의 ${number(metrics.competition * 100, 1)}%예요`,
    stability:Number.isFinite(metrics.stability) &&
      `전체 업종에서 폐업한 점포의 평균 영업기간은 ${number(metrics.stability, 1)}개월이에요`,
    growth:Number.isFinite(history?.periodOpenings) && Number.isFinite(history?.periodClosures) &&
      `${history.growthPeriod ? `${history.growthPeriod.from}~${history.growthPeriod.to}` : '관측 12개월'} 전체 업종에서 ${number(history.periodOpenings)}곳이 열고 ${number(history.periodClosures)}곳이 닫았어요`,
  };
  const labels = factorLabels;
  const factors = Object.keys(labels).filter(key => effectiveWeights?.[key] > 0 && Number.isFinite(scores?.[key]) && evidence[key]);
  const byScore = [...factors].sort((a,b) => scores[b] - scores[a] || effectiveWeights[b] - effectiveWeights[a]);
  const strongest = byScore[0];
  if (!strongest) return `부산 행정동을 같은 기준으로 비교한 결과 종합 ${area.score}점이에요.`;
  const weakest = byScore.at(-1);
  const main = `${evidence[strongest]}. 부산 행정동과 비교한 ${labels[strongest]} 점수는 ${scores[strongest]}점이에요.`;
  if (weakest !== strongest && scores[weakest] < 40) {
    return `${main} 함께 볼 ${labels[weakest]} 점수는 ${scores[weakest]}점이에요. ${evidence[weakest]}.`;
  }
  const second = byScore[1];
  return second && scores[second] >= 60
    ? `${main} ${evidence[second]}. ${labels[second]} 점수는 ${scores[second]}점이에요.`
    : main;
}

function rankSummary(area, rank, previousArea, region) {
  const result = `${region ? `${region} 후보 중 ` : ''}종합 ${area.score}점으로 ${rank}위예요.`;
  if (!Number.isFinite(previousArea?.score)) return result;
  const gap = previousArea.score - area.score;
  if (gap > 0) {
    const weights = area.effectiveWeights ?? {};
    const previousWeights = previousArea.effectiveWeights ?? {};
    const factors = Object.keys(factorLabels);
    const sameWeights = factors.every(key => (weights[key] ?? 0) === (previousWeights[key] ?? 0));
    const gaps = sameWeights ? factors.filter(key => weights[key] > 0 && previousArea.scores?.[key] > area.scores?.[key])
      .map(key => ({key, points:previousArea.scores[key] - area.scores[key]})) : [];
    const leadingGap = gaps.sort((a,b) => b.points * weights[b.key] - a.points * weights[a.key])[0];
    return leadingGap
      ? `${result} 바로 앞 후보와 종합 ${gap}점 차이고, ${factorLabels[leadingGap.key]} 점수는 ${leadingGap.points}점 낮아요.`
      : `${result} 바로 앞 후보와 ${gap}점 차이예요.`;
  }
  if (gap === 0 && previousArea.metrics?.totalStores > area.metrics?.totalStores) {
    return `${result} 바로 앞 후보와 동점이어서 전체 점포 수로 순서를 정했어요.`;
  }
  return gap === 0 ? `${result} 바로 앞 후보와 종합점수가 같아요.` : result;
}

export function recommendationComment(area, {industry, region, rank, previousArea, conditions} = {}) {
  const {metrics = {}, scores = {}, effectiveWeights = {}, historyContext:history} = area;
  const industryName = industry || '선택 업종';
  const dong = dongName(area);
  const hasScore = Number.isFinite(area.score);
  const openings = history?.periodOpenings;
  const closures = history?.periodClosures;
  const period = history?.growthPeriod;
  const permitBalance = Number.isFinite(openings) && Number.isFinite(closures) ? openings - closures : null;
  const counts = Number.isFinite(metrics.totalStores) && Number.isFinite(metrics.industryStores)
    ? `${dong} 전체 업종 점포 ${number(metrics.totalStores)}곳 중 ${industryName} 점포는 ${number(metrics.industryStores)}곳이에요.` : null;
  if (!hasScore) {
    return [
      area.scoreUnavailableReason || '비교할 수 있는 지표가 부족해 종합점수를 계산하지 못했어요.',
      counts || `${dong}의 전체 업종 점포 수와 ${industryName} 점포 수를 확인하기 어려워요.`,
      permitBalance === null ? '개업·폐업 이력도 확인할 수 없어 후보 평가를 보류했어요.'
        : `관측 12개월에는 전체 업종에서 ${number(openings)}곳이 열고 ${number(closures)}곳이 닫혔어요.`
    ];
  }

  const competition = scores.competition < 40 ? '같은 업종의 비중이 높은 편'
    : scores.competition >= 70 ? '같은 업종의 비중이 낮은 편' : '부산 행정동과 비교한 점수';
  const balance = permitBalance === 0 ? '개업과 폐업이 같았어요'
    : `${permitBalance > 0 ? '개업이' : '폐업이'} ${number(Math.abs(permitBalance))}건 더 많았어요`;
  const growthRatio = Number.isFinite(metrics.growth)
    ? `개업·폐업 전체에서 순증감 비율은 ${metrics.growth > 0 ? '+' : ''}${number(metrics.growth * 100, 1)}%로, ` : '';
  const evidence = {
    fit:Number.isFinite(metrics.totalStores) &&
      `${dong}에는 모든 업종을 합쳐 점포가 ${number(metrics.totalStores)}곳 있어요. 이 점포 수를 기준으로 한 상권 규모 점수는 ${scores.fit}점이에요.`,
    competition:Number.isFinite(metrics.competition) && Number.isFinite(metrics.industryStores) &&
      `${industryName} 점포는 ${number(metrics.industryStores)}곳으로 ${dong} 전체 업종 점포의 ${number(metrics.competition * 100, 1)}%예요. 경쟁 적합도 ${scores.competition}점(${competition})이에요.`,
    stability:Number.isFinite(metrics.stability) &&
      `폐업한 점포는 전체 업종 기준 평균 ${number(metrics.stability, 1)}개월 영업했어요. 이 이력으로 계산한 안정성은 ${scores.stability}점이에요.`,
    growth:permitBalance !== null &&
      `${period?.from && period?.to ? `${period.from}~${period.to}` : '관측 12개월'} 전체 업종에서 ${number(openings)}곳이 열고 ${number(closures)}곳이 닫혀 ${balance}. ${growthRatio}성장성은 ${scores.growth}점이에요.`
  };
  const applied = Object.keys(factorLabels)
    .filter(key => effectiveWeights[key] > 0 && Number.isFinite(scores[key]))
    .sort((a,b) => (scores[b] - 50) * effectiveWeights[b] - (scores[a] - 50) * effectiveWeights[a]);
  const lines = [rank ? rankSummary(area, rank, previousArea, region) : `종합 ${area.score}점이에요.`];
  for (const key of applied) {
    lines.push(evidence[key] || `부산 행정동과 비교한 ${factorLabels[key]} 점수는 ${scores[key]}점이에요.`);
  }
  const missing = Object.keys(factorLabels).filter(key => !Number.isFinite(scores[key]) &&
    (key !== 'competition' || conditions?.competition !== 'any'));
  if (missing.length && lines.length < 5) {
    lines.push(`${missing.map(key => factorLabels[key]).join('·')} 항목의 비교 데이터가 부족해, 확인된 지표로 종합점수를 계산했어요.`);
  }
  if (lines.length < 3 && counts) lines.push(counts);
  if (lines.length < 3) lines.push('각 항목 점수는 부산 전체 행정동을 기준으로 비교했어요.');
  return lines;
}
