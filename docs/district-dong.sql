-- 전체 UPDATE를 승인받은 뒤 먼저 실행한다. 기존 주소와 행은 유지된다.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS district_dong text;

CREATE INDEX IF NOT EXISTS stores_district_dong_idx
  ON public.stores (district_dong);

CREATE INDEX IF NOT EXISTS stores_district_dong_industry_idx
  ON public.stores (district_dong, industry_name);

-- 부산진구 부전1동의 전체 상가
SELECT store_id, store_name, industry_name, road_address, district_dong
FROM public.stores
WHERE district_dong = '부산진구-부전1동'
ORDER BY store_id;

-- 해운대구 우1동의 카페 (API 소분류 업종명 기준)
SELECT store_id, store_name, industry_name, road_address, district_dong
FROM public.stores
WHERE district_dong = '해운대구-우1동'
  AND (industry_name ILIKE '%커피%' OR industry_name ILIKE '%카페%')
ORDER BY store_id;

-- 구·동별 상가 수
SELECT district_dong, count(*) AS store_count
FROM public.stores
WHERE district_dong IS NOT NULL
GROUP BY district_dong
ORDER BY district_dong;

-- 백필 후 확인
SELECT count(*) FILTER (WHERE district_dong IS NOT NULL) AS populated,
       count(*) FILTER (WHERE district_dong IS NULL) AS missing,
       count(*) AS total
FROM public.stores;
