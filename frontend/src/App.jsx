import React, { useState } from 'react';

const examples = [
  '경쟁 적은 카페 자리 추천해줘',
  '오래 버틸 수 있는 동네 음식점 자리',
  '요즘 뜨는 상권에서 소품샵',
  '서면 근처에서 베이커리 하고 싶어',
];

const conditions = [
  { id: 'industry', label: '업종' },
  { id: 'region', label: '희망 지역' },
  { id: 'competition', label: '경쟁 강도', accent: true },
  { id: 'stability', label: '안정성', accent: true },
  { id: 'growth', label: '성장성' },
];

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /></span>;
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8h10M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Header() {
  return (
    <header className="topbar">
      <div className="brand"><BrandMark /><span>B-Insight</span></div>
      <nav aria-label="주 메뉴">
        <a className="active" href="#">상권 분석</a>
        <a href="#">상권 지도</a>
        <a href="#">상권 비교</a>
        <a href="#">보관함</a>
      </nav>
      <div className="user"><div className="avatar">U</div></div>
    </header>
  );
}

function ConditionField({ condition, value, onChange }) {
  return (
    <div className={`condition${condition.accent ? ' accent' : ''}`}>
      <label htmlFor={condition.id}>{condition.label}</label>
      <div className="value-wrap">
        <input
          className="value"
          id={condition.id}
          value={value}
          onChange={(event) => onChange(condition.id, event.target.value)}
          aria-label={`${condition.label} 선택 또는 수정`}
        />
        <span className="chevron" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function App() {
  const [request, setRequest] = useState('');
  const [values, setValues] = useState(Object.fromEntries(conditions.map(({ id }) => [id, '-'])));

  const updateValue = (id, value) => setValues((previous) => ({ ...previous, [id]: value }));

  return (
    <>
      <Header />
      <main>
        <h1>어떤 창업을 준비하고 계신가요?</h1>
        <section className="panel input-panel" aria-labelledby="input-title">
          <h2 className="label" id="input-title">창업 조건</h2>
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="무엇이든 편하게 물어보세요!"
            aria-label="창업 조건 입력"
          />
          <div className="assist-row">
            <span className="assist">업종이 빠져 있으면 AI가 한 번 더 물어봐요</span>
            <button className="primary" type="button"><ArrowIcon />AI 상권 분석하기</button>
          </div>
        </section>
        <section className="examples" aria-label="예시 질문">
          <p className="examples-title">이렇게 써볼 수 있어요</p>
          <div className="chips">
            {examples.map((example) => (
              <button className="chip" key={example} type="button" onClick={() => setRequest(example)}>
                {example}
              </button>
            ))}
          </div>
        </section>
        <section className="panel conditions" aria-labelledby="conditions-title">
          <div className="section-head">
            <h2 id="conditions-title">AI가 이해한 조건</h2>
            <span>칩을 눌러 직접 고칠 수 있어요</span>
          </div>
          <div className="condition-list">
            {conditions.map((condition) => (
              <ConditionField key={condition.id} condition={condition} value={values[condition.id]} onChange={updateValue} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
