import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';

const AuthContext=createContext(null);
export const useAuth=()=>useContext(AuthContext);
async function api(path,options={}) {
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok){const error=new Error(data.error||'요청을 처리하지 못했습니다.');error.status=response.status;throw error;}
  return data;
}
export const profileInitial=username=>/^[0-9]/.test(username)?username[0]:(username.match(/[a-z]/i)?.[0]||username[0]||'').toUpperCase();

export function AuthProvider({children}) {
  const [user,setUser]=useState(null),[initializing,setInitializing]=useState(true);
  const [saved,setSaved]=useState([]),[savedLoading,setSavedLoading]=useState(false),[error,setError]=useState('');
  const [pending,setPending]=useState(new Set()),[modal,setModal]=useState(null);
  const identity=useRef(null),generation=useRef(0),locks=useRef(new Set());
  const authMutation=useRef(false);
  const setAccount=useCallback(next=>{
    identity.current=next;generation.current++;locks.current.clear();setPending(new Set());
    setUser(next);setSaved([]);setSavedLoading(Boolean(next));setError('');
  },[]);
  const loadSaved=useCallback(async()=>{
    if(!identity.current)return;
    const version=generation.current;setSavedLoading(true);
    try {
      const data=await api('/api/saved-areas');
      if(version===generation.current){setSaved(data.areas);setError('');}
    }catch(reason){if(version===generation.current){if(reason.status===401)setAccount(null);setError(reason.message);}}
    finally{if(version===generation.current)setSavedLoading(false);}
  },[setAccount]);
  useEffect(()=>{
    let active=true;
    async function restore(){
      if(authMutation.current)return;
      const version=generation.current;setInitializing(true);
      try {
        const data=await api('/api/auth/me');
        if(!active||version!==generation.current||authMutation.current)return;
        setAccount(data.user);if(data.user)await loadSaved();
      }catch(reason){if(active)setError(reason.message);}
      finally{if(active)setInitializing(false);}
    }
    restore();window.addEventListener('focus',restore);
    return()=>{active=false;window.removeEventListener('focus',restore);};
  },[loadSaved,setAccount]);
  async function authenticate(mode,input) {
    authMutation.current=true;
    try{
      const data=await api(`/api/auth/${mode}`,{method:'POST',body:JSON.stringify(input)});
      setAccount(data.user);setModal(null);await loadSaved();
      if(mode==='signup')window.location.hash='analysis';
    }finally{authMutation.current=false;setInitializing(false);}
  }
  async function logout(){
    authMutation.current=true;
    try{await api('/api/auth/logout',{method:'POST'});setAccount(null);}
    catch(reason){setError(reason.message);}
    finally{authMutation.current=false;}
  }
  async function toggleSaved(area,industry) {
    if(!identity.current){setModal('notice');return;}
    if(initializing||savedLoading||locks.current.has(area.id))return;
    const version=generation.current;
    locks.current.add(area.id);setPending(new Set(locks.current));setError('');
    const exists=saved.some(item=>item.id===area.id);
    try {
      const data=await api(exists?`/api/saved-areas/${encodeURIComponent(area.id)}`:'/api/saved-areas',{
        method:exists?'DELETE':'POST',...(!exists?{body:JSON.stringify({areaId:area.id,industry})}:{})});
      if(version!==generation.current)return;
      setSaved(current=>exists?current.filter(item=>item.id!==area.id):[data.area,...current.filter(item=>item.id!==area.id)]);
    }catch(reason){if(version===generation.current){if(reason.status===401){setAccount(null);setModal('notice');}setError(reason.message);}}
    finally{if(version===generation.current){locks.current.delete(area.id);setPending(new Set(locks.current));}}
  }
  return <AuthContext.Provider value={{user,initializing,saved,savedLoading,error,pending,toggleSaved,loadSaved,logout,requestAuth:setModal}}>
    {children}
    <AuthDialog mode={modal} onMode={setModal} onClose={()=>setModal(null)} onAuthenticate={authenticate}/>
  </AuthContext.Provider>;
}

function AuthDialog({mode,onMode,onClose,onAuthenticate}) {
  const dialog=useRef(null),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[passwordConfirm,setConfirm]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    setError('');setPassword('');setConfirm('');
    if(mode&&!dialog.current.open)dialog.current.showModal();
    if(!mode&&dialog.current.open)dialog.current.close();
  },[mode]);
  async function submit(event){
    event.preventDefault();if(busy)return;setError('');
    if([...password].length<4){setError('비밀번호는 4자리 이상 입력해주세요.');return;}
    if(new TextEncoder().encode(password).length>72){setError('비밀번호는 UTF-8 기준 72바이트 이내로 입력해주세요.');return;}
    if(mode==='signup'&&password!==passwordConfirm){setError('비밀번호가 일치하지 않습니다.');return;}
    setBusy(true);
    try{await onAuthenticate(mode,{username:username.trim(),password,passwordConfirm});}
    catch(reason){setError(reason.message);}
    finally{setBusy(false);}
  }
  return <dialog ref={dialog} className="auth-dialog" aria-labelledby="auth-title" onCancel={event=>{if(busy)event.preventDefault();else onClose();}}>
    <button className="auth-close" type="button" disabled={busy} onClick={onClose} aria-label="닫기">×</button>
    <h2 id="auth-title">{mode==='notice'?'로그인이 필요해요':mode==='signup'?'회원가입':'로그인'}</h2>
    {mode==='notice'?<><p>관심 상권을 저장하려면 로그인이 필요합니다.</p><button className="primary" onClick={()=>onMode('login')}>로그인</button></>:
    <form onSubmit={submit}>
      <label htmlFor="auth-username">아이디<input id="auth-username" autoFocus required maxLength={40} pattern="[A-Za-z0-9 ]+" autoCapitalize="none" autoComplete="username" value={username} disabled={busy} onChange={e=>setUsername(e.target.value)}/></label>
      <small>영문 또는 숫자 1~40자 · 대소문자 구분 없음</small>
      <label htmlFor="auth-password">비밀번호<input id="auth-password" type="password" required autoComplete={mode==='signup'?'new-password':'current-password'} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
      <small>4자 이상, UTF-8 기준 72바이트 이하</small>
      {mode==='signup'&&<label htmlFor="auth-confirm">비밀번호 확인<input id="auth-confirm" type="password" required autoComplete="new-password" disabled={busy} value={passwordConfirm} onChange={e=>setConfirm(e.target.value)}/></label>}
      {error&&<p className="auth-error" role="alert">{error}</p>}
      <button className="primary" disabled={busy} type="submit">{busy?'처리 중…':mode==='signup'?'회원가입':'로그인'}</button>
      <button type="button" className="auth-switch" disabled={busy} onClick={()=>onMode(mode==='signup'?'login':'signup')}>{mode==='signup'?'이미 계정이 있으신가요? 로그인':'계정이 없으신가요? 회원가입'}</button>
    </form>}
  </dialog>;
}

export function UserMenu(){
  const {user,initializing,requestAuth,logout}=useAuth();
  const [open,setOpen]=useState(false),root=useRef(null);
  useEffect(()=>{
    const close=event=>{if(event.type==='keydown'?event.key==='Escape':!root.current?.contains(event.target))setOpen(false);};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};
  },[]);
  if(initializing)return <div className="user" role="status">로그인 확인 중…</div>;
  return <div className="user" ref={root}>{user?<div className="profile-menu">
    <button className="avatar" type="button" aria-label={`${user.username} 프로필`} aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{profileInitial(user.username)}</button>
    {open&&<div className="profile-dropdown"><strong>{user.username}</strong><a href="#saved" onClick={()=>setOpen(false)}>내 보관함</a><button type="button" onClick={()=>{setOpen(false);logout();}}>로그아웃</button></div>}
  </div>:<div className="auth-header-actions"><button type="button" onClick={()=>requestAuth('login')}>로그인</button><button type="button" className="primary" onClick={()=>requestAuth('signup')}>회원가입</button></div>}</div>;
}
