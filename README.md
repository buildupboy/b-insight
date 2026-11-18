# B-Insight

부산 창업 조건을 자연어로 입력해 상권 후보와 검증 가능한 지표를 비교하는 React + Vite, Node.js 앱입니다.

## 실행

Node.js 20 이상에서 의존성을 설치한 뒤 프로젝트 루트 `.env`에 `OPENAI_API_KEY`, `DATA_GO_KR_SERVICE_KEY`를 설정합니다. 비밀키는 브라우저로 전송하지 않으며 `.env`는 Git에서 제외됩니다.

```bash
npm install
npm run build
npm start
```

`.env`의 `PORT`가 있으면 해당 포트로 접속합니다. `npm run dev`는 현재 Node 서버를 시작하며 프론트엔드 변경 후에는 `npm run build`로 정적 파일을 다시 생성해야 합니다. 검증은 `npm test`와 `npm run build`로 실행합니다.

공공데이터 응답 형식을 점검하려면 `npm run diagnose:data`를 실행하세요. 서비스·상세기능, 상태 코드, Content-Type, 형식, 요청 변수명만 표시하며 인증키와 원본 본문은 출력하지 않습니다. 상세기능별 필드 비교는 [API 필드 대조표](docs/api-field-mapping.md)에 정리했습니다.

### 부산 상권 변화지표 조회

```bash
npm run data:changes
npm run data:changes -- --view
npm run data:changes -- --view 해운대
```

첫 명령은 부산 상권 변화지표 API의 전체 행을 `.cache/binsight.sqlite`의 `commercial_change` 테이블에 저장합니다. `BINSIGHT_SQLITE_PATH`가 설정되어 있으면 그 경로를 사용합니다. `--view`는 저장된 자료에서 상권별 지표를 최대 15행 표시하고 변화 상태별 건수를 집계합니다. SQLite 뷰어에서는 전체 행을 열어볼 수 있습니다. 테이블의 일곱 컬럼명은 API 응답 필드명을 따릅니다.

Supabase로 가져오려면 `.env`에 `SUPABASE_DB_URL`을 설정하고 `npm run data:changes -- --supabase`를 실행합니다. `psql`이 PATH에 없으면 `.env`에 `PSQL_PATH`를 설정합니다. 전체 API 응답을 확인한 뒤 한 트랜잭션으로 `public.commercial_change`를 갱신하고 저장 행 수와 샘플을 출력합니다. Supabase Dashboard의 Table Editor에서 전체 행을 볼 수 있습니다.

원본을 보관하려면 `npm run data:changes -- --supabase-raw`를 실행합니다. `commercial_change_raw_pages.response_body`에 각 페이지의 JSON 응답 전문을 그대로 저장합니다. `commercial_change_raw` 뷰에서 `page_no`, `row_no`, `raw_data`로 원본 행을 확인할 수 있습니다. 전체 조회에 성공하면 기존 원본 스냅샷을 한 번에 갱신합니다.

## 분석 흐름

`POST /api/analyze`에 `{ "prompt": "서면에서 카페 창업..." }`를 보내면 OpenAI가 조건을 추출하고 서버가 소진공 상권 목록의 지역·업종 코드를 확인합니다. 결과 화면에서 조건을 수정하면 `{ prompt, conditions }`로 다시 분석합니다. `GET /api/health`는 키의 설정 여부만 표시합니다.

지명과 업종이 모호하면 선택지를 반환합니다. 상권 목록의 검증된 번호로 점포를 조회하며, 부산 변화지표와 정확히 연결 가능한 상권만 안정성 점수에 사용합니다. 부산 점포이력에는 소진공 상권번호와 확인된 연결 필드가 없어 구 단위 참고 조회만 하고 상권별 성장성 점수를 만들지 않습니다. 자세한 계산·결측 규칙은 [추천 계산 문서](docs/recommendation.md)를 참조하세요.
