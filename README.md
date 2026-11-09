# B-Insight

부산 창업 상권 분석 · 추천 AI 웹 서비스

## 프로젝트 구조

```text
b-insight/
├── frontend/               # React + Vite 웹 애플리케이션
│   ├── public/              # 정적 파일 및 디자인 에셋
│   ├── src/                 # React 화면 및 스타일
│   ├── index.html
│   ├── package.json
│   └── package-lock.json
├── backend/                # Node.js 서버
│   ├── package.json
│   └── server.js
└── .gitignore
```

## 실행

의존성 설치:

```bash
npm install
```

프런트엔드 개발 서버:

```bash
npm run dev
```

프로덕션 빌드 후 백엔드 서버 실행:

```bash
npm run build
npm start
```

백엔드 서버는 `frontend/dist`의 빌드 결과를 제공합니다.
