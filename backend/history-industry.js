// Exact tuples observed in .cache/binsight.sqlite, commercial_history_by_dong.
// Broader source categories (including coffee/drinks) cannot identify a narrower code.
const mappings = {
  S20701: {name:'미용실', category:['서비스','미용실','미용실']},
  S20703: {name:'네일숍', category:['서비스','네일숍','기타 미용업']},
  I21001: {name:'빵/도넛', category:['외식','제과점','제과점업']},
  I21006: {name:'치킨', category:['외식','치킨전문점','치킨 전문점']},
};

export function resolveHistoryIndustry(industry, storedIndustries) {
  const codes = industry?.codes ?? [];
  if (!codes.length) return null;
  const categories = [];
  for (const code of codes) {
    const mapping = mappings[code];
    if (!mapping || !storedIndustries.some(row=>row.industry_code===code && row.industry_name===mapping.name)) return null;
    const [majornm,minornm,upjongnm] = mapping.category;
    categories.push({majornm,minornm,upjongnm});
  }
  return {codes:[...codes], label:industry.label, categories};
}

export const historySampleMinimums = {stability:5, growth:10};
