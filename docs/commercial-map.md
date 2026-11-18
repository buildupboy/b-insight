# Commercial map

The `#map` screen follows Figma frame `18:2` in B-sight. Its icons and marker tails are the original SVG exports in `frontend/public/figma-assets/map-*.svg`.

## Data and scoring

`POST /api/map-data` accepts region, industry and the existing competition/stability/growth preferences. It reuses the analysis pipeline and returns all candidates, not only the top three. Scores are normalized against the same Busan-wide comparison population before region and score filters are applied. Moving the map and searching its viewport does not change scores.

The panel's lifetime operating period and cumulative opening/closure counts retain the existing all-industry history definitions. The store count is the selected industry. Opening a candidate loads its existing full analysis detail; it does not assign a misleading map rank.

## Actual region boundaries

`frontend/public/data/busan-dongs.geojson` contains the 206 Busan administrative dong boundaries from `HangJeongDong_ver20261001.geojson` in [vuski/admdongkor](https://github.com/vuski/admdongkor), dated 2026-10-01, originally supplied by SGIS. Coordinates retain CRS84 longitude/latitude and all original Polygon/MultiPolygon rings, including holes. No rectangular or invented region outlines are used.

Canonical district/dong names join the boundaries to database areas. A representative point inside the largest polygon positions each label. Selected polygons use blue fill and a dashed border. Optional radius circles are display aids around this representative point; all scores and selected region boundaries remain administrative-dong based.

Boundary attribution is visible below the map. The upstream data license and SGIS attribution terms are preserved in `frontend/public/data/BOUNDARIES-LICENSE.txt`.

## Kakao configuration

The map reuses `/api/map-config` and `KAKAO_JAVASCRIPT_KEY`. Configure the served web origin in the Kakao application's web platform settings. It uses the public JavaScript key, not an admin or REST secret. Missing configuration or SDK load failure leaves the selectable region list available. Location is requested only after the user presses the location button.

## Verification

Automated coverage checks all 206 unique canonical boundaries, representative points, holes and multipolygons, score filtering including zero/null, region filtering, and consistency with existing analysis scores. The live localhost screen was checked with real database scores and Kakao map tiles, region selection, actual highlighted boundaries, detail navigation, and a 390px mobile viewport.
