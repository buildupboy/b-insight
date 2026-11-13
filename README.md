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

## 분석 흐름

`POST /api/analyze`에 `{ "prompt": "서면에서 카페 창업..." }`를 보내면 OpenAI가 조건을 추출하고 서버가 소진공 상권 목록의 지역·업종 코드를 확인합니다. 결과 화면에서 조건을 수정하면 `{ prompt, conditions }`로 다시 분석합니다. `GET /api/health`는 키의 설정 여부만 표시합니다.

지명과 업종이 모호하면 선택지를 반환합니다. 상권 목록의 검증된 번호로 점포를 조회하며, 부산 변화지표와 정확히 연결 가능한 상권만 안정성 점수에 사용합니다. 부산 점포이력에는 소진공 상권번호와 확인된 연결 필드가 없어 구 단위 참고 조회만 하고 상권별 성장성 점수를 만들지 않습니다. 자세한 계산·결측 규칙은 [추천 계산 문서](docs/recommendation.md)를 참조하세요.
