(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MoneyWorkspaceHistory=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function createPreferenceJournal(storage){
    const journalKey='mm-local-preference-history-v1',allowed=key=>key==='mm-layout-widths-v1'||/^mm-chart-overlays:stocks:[A-Za-z0-9._:-]{1,100}$/.test(key)||/^mm-crypto-chart-overlays:[A-Z0-9]{2,30}:[a-z0-9]{1,8}$/.test(key);
    const safe=(value,depth=0)=>depth<6&&(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=100&&Object.entries(value).every(([key,v])=>!/token|secret|password|api.?key|private.?key/i.test(key)&&safe(v,depth+1)));
    const safeText=value=>{if(value===null)return true;try{return value.length<=24000&&safe(JSON.parse(value));}catch{return false;}};
    const read=()=>{try{const rows=JSON.parse(storage.getItem(journalKey)||'[]');return Array.isArray(rows)?rows.slice(-50).filter(row=>row&&allowed(row.key)&&safeText(row.before)&&safeText(row.after)):[];}catch{return [];}};
    const save=rows=>{while(rows.length>50||JSON.stringify(rows).length>100000)rows.shift();storage.setItem(journalKey,JSON.stringify(rows));};
    const id=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
    return {
      record(key,value,context={}){if(!allowed(key))throw Error('偏好历史仅允许图表和布局范围');const before=storage.getItem(key),after=JSON.stringify(value);storage.setItem(key,after);if(before===after||!safeText(before)||!safeText(after))return;
        const rows=read();rows.push({id:id(),kind:'local-preference',key,before,after,market:context.market||null,workspace:context.workspace||null,at:new Date().toISOString()});save(rows);
      },
      list(market){const rows=read(),latest=new Map();for(const row of rows)latest.set(row.key,row.id);return rows.filter(row=>!market||row.market===market).reverse().map(row=>({id:row.id,kind:row.kind,key:row.key,market:row.market,instrument:null,at:row.at,summary:row.key==='mm-layout-widths-v1'?'本机布局宽度变更':'本机图表图层 / 策略参数变更',canUndo:latest.get(row.key)===row.id&&storage.getItem(row.key)===row.after,undoOf:row.undoOf||null}));},
      undo(operationId){const rows=read(),row=rows.find(entry=>entry.id===operationId);if(!row||rows.filter(entry=>entry.key===row.key).at(-1)?.id!==operationId||storage.getItem(row.key)!==row.after)throw Error('本机偏好已变化或存在后续修改，未覆盖新状态');
        if(row.before===null)storage.removeItem(row.key);else storage.setItem(row.key,row.before);rows.push({...row,id:id(),undoOf:row.id,before:row.after,after:row.before,at:new Date().toISOString()});save(rows);return {key:row.key,value:row.before===null?null:JSON.parse(row.before)};
      },
    };
  }
  function install(options){
    const w=options.window,history=w.history;let disposed=false,restoring=false,pending=false,last=null,queuedTarget=null;
    const contextKey=row=>JSON.stringify([row.market,row.workspace,row.instrument||null]);
    const capture=()=>({...options.current(),url:w.location.pathname+w.location.search+w.location.hash,scroll:Math.max(0,w.scrollY||0),centerScroll:w.document.getElementById('center-workspace')?.scrollTop||0});
    const write=(entry,url=entry.url)=>history.replaceState({...history.state,mmWorkspace:entry},'',url);
    const valid=entry=>{
      if(!entry||!['overview','stocks','options','crypto','prediction','watchlist'].includes(entry.market)||typeof entry.workspace!=='string'||typeof entry.url!=='string'||entry.url.length>4000)return false;
      try{const url=new URL(entry.url,w.location.origin);return url.origin===w.location.origin&&(!url.searchParams.has('market')||url.searchParams.get('market')===entry.market)&&(!url.searchParams.has('workspace')||url.searchParams.get('workspace')===entry.workspace)&&options.canRestore(entry)!==false;}catch{return false;}
    };
    const scroll=()=>{if(last&&!restoring){last.scroll=Math.max(0,w.scrollY||0);last.centerScroll=w.document.getElementById('center-workspace')?.scrollTop||0;}};
    const change=()=>{if(disposed||restoring||pending)return;pending=true;queueMicrotask(()=>{
      pending=false;if(disposed||restoring)return;const next=capture();
      if(last&&contextKey(next)!==contextKey(last)){
        write(last);history.pushState({mmWorkspace:next},'',next.url);
      }else write(next);
      last=next;
    });};
    const pop=async event=>{
      const requested=event.state?.mmWorkspace;if(disposed||!valid(requested))return;
      queuedTarget=requested;if(restoring)return;
      restoring=true;
      try{
        while(queuedTarget&&!disposed){
        const target=queuedTarget;queuedTarget=null;if(!valid(target))continue;
        const result=options.restore(target),waitingState=history.state,waitingUrl=w.location.href;
        await result;if(disposed)return;if(queuedTarget)continue;
        // Native traversal changes the active entry before its popstate is delivered.
        // A late completion must not replace that newer entry with the previous target.
        const active=history.state?.mmWorkspace;
        if((history.state!==waitingState||w.location.href!==waitingUrl)&&valid(active)&&contextKey(active)!==contextKey(target)){queuedTarget=active;continue;}
        last={...target};write(last,target.url);
        const apply=()=>{if(disposed||!last||contextKey(last)!==contextKey(target))return;w.scrollTo({top:Number.isFinite(target.scroll)?Math.max(0,target.scroll):0});const center=w.document.getElementById('center-workspace');if(center)center.scrollTop=Number.isFinite(target.centerScroll)?Math.max(0,target.centerScroll):0;};
        apply();w.requestAnimationFrame?.(apply);
        }
      }catch{options.onError?.('无法恢复该工作区，请从当前市场菜单重新打开；没有执行写操作。');}
      finally{restoring=false;}
    };
    last=capture();write(last);w.addEventListener('mm-workspace-context',change);w.addEventListener('popstate',pop);w.addEventListener('scroll',scroll,{passive:true,capture:true});
    return {dispose(){disposed=true;w.removeEventListener('mm-workspace-context',change);w.removeEventListener('popstate',pop);w.removeEventListener('scroll',scroll,true);}};
  }
  return {install,createPreferenceJournal};
});
