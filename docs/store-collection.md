# 부산 전체 상가 수집

프로젝트 루트에서 실행한다. 기존 100건 테스트는 `node --env-file=.env backend/collect-stores.js`, 3,000건 테스트는 `node --env-file=.env backend/collect-stores.js --limit=3000`이다. 두 모드는 `--save`를 붙일 때만 DB에 쓴다.

전체 수집의 기본 동작은 사전 점검이다. 다음 명령은 부산 조회 총건수, 지원되는 페이지 크기와 첫 두 페이지의 행·지역·ID를 확인한다. DB에 쓰지 않으며 전체 페이지를 다운로드하지 않는다.

```powershell
node --env-file=.env backend/collect-stores.js --all-busan --preflight
```

전체 저장은 별도 승인 후 실행한다. `N`에는 Supabase 프로젝트의 실제 DB 용량 한도(MiB)를 입력한다. 한도는 DB 연결만으로 확인할 수 없으므로 프로젝트 대시보드에서 확인해야 한다.

```powershell
node --env-file=.env backend/collect-stores.js --all-busan --save --db-limit-mb=N --api-call-budget=M
```

`M`에는 당일 남은 API 호출 허용량을 입력한다. 사전 점검과 남은 페이지에 필요한 정상 요청 수보다 적으면 저장을 시작하지 않고, 재시도도 이 예산을 넘지 않는다. 저장 전 현재 DB 사용량과 테이블 크기를 읽고, 전체 API 건수에 상가당 최소 2 KiB의 성장량을 적용해 추정한다. 추정 사용량이 지정한 한도의 80%를 넘으면 저장을 중단한다. 기존 `public.stores`의 8개 컬럼 중 `created_at`은 유지하고, 나머지 7개 필드만 `store_id` 기준 UPSERT한다. TLS 인증서와 호스트명은 `DATABASE_URL` 및 `pg` 기본 검증을 따른다.

전체 모드는 1,000건씩 API를 순차 조회하고 250건씩 DB에 저장한다. 요청 시작 간격은 최소 1.1초이며, 일시적 연결 오류·HTTP 429·5xx만 최대 3회 시도한다. API 총건수나 페이지 크기가 사전 점검과 달라지면 실패 페이지를 기록하고 중단한다. 실제 제공처 호출 할당량이 예상 호출 수보다 적으면 실행을 시작하지 않아야 한다.

체크포인트는 `.store-collection/`에 저장된다. 한 페이지의 UPSERT와 저장값 검증이 끝난 뒤에만 체크포인트가 갱신된다. 실패 후 같은 명령을 재실행하면 다음 미완료 페이지부터 이어지고, UPSERT로 재실행 중복 저장을 막는다. `.store-collection/`은 수집이 끝날 때까지 삭제하지 않는다.

최종 요약의 `complete`는 API 총건수, 수신 건수, 유효 상가 수, 누락·중복, 저장 ID 존재 여부, 부산 주소 검증을 모두 반영한다. `districts`는 수집해 저장·검증한 상가를 구·군 코드별로 집계한다. `dbUniqueStores`는 기존 행을 포함한 테이블 전체의 고유 `store_id` 수다.
