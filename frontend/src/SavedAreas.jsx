import React from 'react';
import {useAuth} from './AuthContext.jsx';
import SaveAreaButton from './SaveAreaButton.jsx';

export default function SavedAreas({onOpenDetail}){
  const {user,initializing,saved,savedLoading,error,loadSaved,requestAuth}=useAuth();
  return <section className="comparison-page saved-page" aria-labelledby="saved-title">
    <h1 id="saved-title">내 보관함</h1><p className="comparison-context">관심 있는 상권을 저장하고 다시 확인해보세요.</p>
    {initializing?<p role="status">로그인 확인 중…</p>:!user?<div className="panel saved-empty"><h2>로그인 후 보관함을 확인해보세요.</h2><p>관심 상권을 저장하려면 로그인이 필요합니다.</p><button className="primary" onClick={()=>requestAuth('login')}>로그인</button></div>:
    <><p className="saved-count">저장한 상권 <strong>{saved.length}</strong>개</p>
      {savedLoading?<p role="status">보관함을 불러오는 중…</p>:error?<button type="button" onClick={loadSaved}>보관함 다시 불러오기</button>:saved.length?
      <div className="saved-grid">{saved.map(area=><article className="panel saved-card" key={area.id}>
        <span className="tag blue">부산광역시 {area.region}</span>
        <h2><a href={`#area-${area.id}`} onClick={event=>{event.preventDefault();onOpenDetail(area);}}>{area.name}</a></h2>
        {area.industry&&<p>분석 업종 · {area.industry}</p>}
        <p className="saved-date">저장일 <time dateTime={area.createdAt}>{new Date(area.createdAt).toLocaleDateString('ko-KR')}</time></p>
        <div className="saved-actions"><button type="button" className="detail-button" onClick={()=>onOpenDetail(area)}>상세 보기</button><SaveAreaButton area={area} industry={area.industry}/></div>
      </article>)}</div>:<div className="panel saved-empty"><h2>아직 저장한 관심 상권이 없습니다.</h2><a className="primary" href="#map">상권 둘러보기</a></div>}
    </>}
  </section>;
}
