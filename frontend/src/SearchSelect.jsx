import React,{useEffect,useId,useRef,useState} from 'react';

export default function SearchSelect({label,options,value,onChange,placeholder='검색하거나 선택하세요',disabled=false,accent=false}) {
  const id=useId(),root=useRef(null),input=useRef(null),composing=useRef(false);
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1);
  const selected=options.find(option=>option.value===value);
  const normalize=text=>text.replace(/\s/g,'').toLowerCase();
  const matches=options.filter(option=>normalize(`${option.label} ${option.value}`).includes(normalize(query)));
  useEffect(()=>{
    const close=event=>{if(!root.current?.contains(event.target)){setOpen(false);setQuery('');setActive(-1);}};
    document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);
  },[]);
  useEffect(()=>{setActive(-1);},[query]);
  useEffect(()=>{if(active>=0)document.getElementById(`${id}-option-${active}`)?.scrollIntoView({block:'nearest'});},[active,id]);
  function choose(option){onChange(option.value);setOpen(false);setQuery('');setActive(-1);}
  function keyDown(event){
    if(composing.current||event.nativeEvent.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();setOpen(false);setQuery('');setActive(-1);}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();setOpen(true);
      setActive(current=>matches.length?(event.key==='ArrowDown'?(current+1)%matches.length:(current<=0?matches.length-1:current-1)):-1);
    }
    if(event.key==='Enter'&&open){event.preventDefault();if(matches[active])choose(matches[active]);else if(matches.length===1)choose(matches[0]);}
    if(event.key==='Tab'){setOpen(false);setQuery('');}
  }
  return <div className={`search-select${accent?' accent':''}`} ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)){setOpen(false);setQuery('');}}}>
    <label htmlFor={id}>{label}</label><div className="search-select-control">
      <input id={id} ref={input} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`}
        aria-activedescendant={open&&active>=0?`${id}-option-${active}`:undefined} aria-describedby={open&&query?`${id}-hint`:undefined}
        autoComplete="off" disabled={disabled} placeholder={selected?.label||placeholder} value={open?query:selected?.label||''}
        onFocus={()=>{setOpen(true);setQuery('');}} onClick={()=>setOpen(true)}
        onChange={event=>{setQuery(event.target.value);setOpen(true);}} onKeyDown={keyDown}
        onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}/>
      {value&&<button className="search-select-clear" type="button" disabled={disabled} aria-label={`${label} 선택 지우기`} onClick={()=>{onChange('');setQuery('');input.current.focus();}}>×</button>}
      <button className="search-select-toggle" type="button" disabled={disabled} aria-label={`${label} 목록 ${open?'닫기':'열기'}`} tabIndex={-1} onClick={()=>{if(open){setOpen(false);setQuery('');}else input.current.focus();}}><img src="/figma-assets/condition-chevron.svg" alt=""/></button>
    </div>
    {open&&<div className="search-select-popup"><ul role="listbox" id={`${id}-list`} aria-label={`${label} 목록`}>
      {matches.map((option,index)=><li id={`${id}-option-${index}`} role="option" aria-selected={option.value===value} className={index===active?'highlighted':''} key={option.value}
        onPointerDown={event=>{event.preventDefault();choose(option);}} onMouseMove={()=>setActive(index)}>{option.label}{options.some(item=>item.value!==option.value&&item.label===option.label)&&<small>{option.value}</small>}</li>)}
      {!matches.length&&<li className="search-select-empty" role="presentation">검색 결과가 없습니다.</li>}
    </ul>{query&&<p id={`${id}-hint`}>목록에서 항목을 선택하면 반영됩니다.</p>}</div>}
  </div>;
}
