import React from 'react';
import {useAuth} from './AuthContext.jsx';

export default function SaveAreaButton({area,industry,primary=false}) {
  const {saved,pending,initializing,savedLoading,user,toggleSaved}=useAuth();
  const active=saved.some(item=>item.id===area.id),busy=pending.has(area.id);
  return <button type="button" className={`save-area-button${primary?' primary':''}${active?' is-saved':''}`} aria-pressed={active}
    disabled={initializing||busy||Boolean(user&&savedLoading)} onClick={event=>{event.stopPropagation();toggleSaved(area,industry);}}>
    <img src="/figma-assets/detail-bookmark.svg" alt=""/>{busy?'처리 중…':active?'저장됨':'관심 상권 저장'}
  </button>;
}
