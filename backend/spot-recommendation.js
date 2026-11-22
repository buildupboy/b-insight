// 선택한 동 안에서 같은 업종 점포가 적은 지점을 고른다.
// 현재 점포가 있는 위치만 후보로 쓰므로, 점포가 없는 곳(신축 상가, 새로 개발된 거리 등)은 후보가 되지 않는다.
// 공실·임대료·용도지역은 반영하지 않으며 거리는 직선거리다.
export const spotSettings = {radius:300, cell:50, limit:3};

const metersPerDegreeLat = 110540;
const metersPerDegreeLng = latitude => 111320 * Math.cos(latitude * Math.PI / 180);

// 동 경계 밖의 경쟁 점포까지 포함하도록 조회 범위를 넓힐 때 쓰는 여유 폭(도 단위).
export function searchMargin(radius = spotSettings.radius, latitude = 36) {
  return {lat:radius / metersPerDegreeLat, lng:radius / metersPerDegreeLng(latitude)};
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * stores: [{latitude, longitude, address, inDong, sameIndustry}]
 * inDong은 선택한 동의 점포, sameIndustry는 선택 업종 점포 여부다.
 */
export function recommendSpots(stores, {radius = spotSettings.radius, cell = spotSettings.cell, limit = spotSettings.limit} = {}) {
  const located = stores.filter(store => Number.isFinite(store.latitude) && Number.isFinite(store.longitude));
  const inDong = located.filter(store => store.inDong);
  if (!inDong.length) return {radius, candidateCount:0, activityThreshold:null, spots:[]};

  const lat0 = inDong.reduce((sum, store) => sum + store.latitude, 0) / inDong.length;
  const lng0 = inDong.reduce((sum, store) => sum + store.longitude, 0) / inDong.length;
  const kx = metersPerDegreeLng(lat0);
  const points = located.map(store => ({...store, x:(store.longitude - lng0) * kx, y:(store.latitude - lat0) * metersPerDegreeLat}));

  const cells = new Map();
  for (const point of points) {
    if (!point.inDong) continue;
    const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)}`;
    cells.set(key, [...(cells.get(key) ?? []), point]);
  }

  const candidates = [...cells.values()].map(group => {
    const x = group.reduce((sum, point) => sum + point.x, 0) / group.length;
    const y = group.reduce((sum, point) => sum + point.y, 0) / group.length;
    let storesWithin = 0, sameIndustryWithin = 0, nearest = Infinity;
    for (const point of points) {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= radius) storesWithin++;
      if (point.sameIndustry) {
        if (distance <= radius) sameIndustryWithin++;
        nearest = Math.min(nearest, distance);
      }
    }
    const representative = group.reduce((best, point) =>
      Math.hypot(point.x - x, point.y - y) < Math.hypot(best.x - x, best.y - y) ? point : best);
    // 조회 범위가 반경까지만 넓혀져 있어 반경 밖 거리는 정확하지 않으므로, 반경 밖은 모두 같은 값으로 본다.
    const nearestWithin = nearest <= radius ? nearest : null;
    return {x, y, storesWithin, sameIndustryWithin, nearestWithin, address:representative.address || null};
  });

  // 너무 한적한 곳이 1위가 되지 않도록 주변 점포 수가 동 안 후보의 중간값 이상인 곳만 남긴다.
  const activityThreshold = median(candidates.map(candidate => candidate.storesWithin));
  const ranked = candidates.filter(candidate => candidate.storesWithin >= activityThreshold)
    .sort((a, b) => a.sameIndustryWithin - b.sameIndustryWithin ||
      (b.nearestWithin ?? Infinity) - (a.nearestWithin ?? Infinity) || b.storesWithin - a.storesWithin);

  // 바로 옆 칸이 연달아 뽑히지 않도록 추천 지점끼리 반경의 절반 이상 떨어뜨린다.
  const spots = [];
  for (const candidate of ranked) {
    if (spots.length >= limit) break;
    if (spots.some(spot => Math.hypot(spot.x - candidate.x, spot.y - candidate.y) < radius / 2)) continue;
    spots.push(candidate);
  }

  return {
    radius, candidateCount:candidates.length, activityThreshold,
    spots:spots.map(spot => ({
      latitude:lat0 + spot.y / metersPerDegreeLat,
      longitude:lng0 + spot.x / kx,
      address:spot.address,
      sameIndustryWithin:spot.sameIndustryWithin,
      storesWithin:spot.storesWithin,
      nearestSameIndustryMeters:spot.nearestWithin == null ? null : Math.round(spot.nearestWithin),
    })),
  };
}
