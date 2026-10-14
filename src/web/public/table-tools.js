(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.MoneyTableTools=api;api.install();}})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const enhanced=new WeakMap();
  const missing=value=>/^(?:—|--|未知|暂无|不可用|未提供|无记录|null|undefined)/.test(String(value??'').trim())||!String(value??'').trim();
  function numeric(value){const text=String(value).trim().replace(/^[$¥€]/,'');if(!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*(?:USD|USDT|shares|股|%))?$/.test(text))return null;const n=Number(text.replace(/,/g,'').replace(/\s*(?:USD|USDT|shares|股|%)$/,''));return Number.isFinite(n)?n:null;}
  function unit(value){const text=String(value).trim(),suffix=text.match(/(USD|USDT|shares|股|%)$/)?.[1];return suffix==='股'?'shares':suffix||({ '$':'USD','¥':'JPY/CNY-unspecified','€':'EUR' }[text[0]]||'unitless');}
  function compareCellValues(a,b,direction=1){const am=missing(a),bm=missing(b);if(am||bm)return am===bm?0:am?1:-1;const an=numeric(a),bn=numeric(b);return direction*(an!==null&&bn!==null?(unit(a)===unit(b)?an-bn:unit(a).localeCompare(unit(b))):String(a).localeCompare(String(b),'zh-CN',{numeric:true}));}
  function enhanceTable(table,context){
    if(enhanced.has(table)){enhanced.get(table).refresh();return enhanced.get(table);}
    const headers=[...(table.tHead?.rows[0]?.cells||[])],body=table.tBodies[0],document=table.ownerDocument;
    if(!body||headers.length<2||headers.length>60||table.tHead.rows.length!==1||headers.some(cell=>cell.colSpan!==1||cell.rowSpan!==1))return null;
    if([...body.rows].some(row=>row.cells.length!==headers.length||[...row.cells].some(cell=>cell.colSpan!==1||cell.rowSpan!==1)))return null;
    const titles=headers.map(cell=>cell.textContent.trim()),key='mm-table-view-v1|'+context.market+'|'+context.workspace+'|'+JSON.stringify(titles);let saved;
    try{saved=JSON.parse(document.defaultView.localStorage.getItem(key)||'{}');}catch{}
    const state={visible:headers.map((_,i)=>saved?.visible?.[i]!==false),sort:Number.isInteger(saved?.sort)&&saved.sort>=0&&saved.sort<headers.length?saved.sort:null,direction:saved?.direction===-1?-1:1};
    if(!state.visible.some(Boolean))state.visible.fill(true);
    const original=new WeakMap();let sequence=0;
    const save=()=>{try{document.defaultView.localStorage.setItem(key,JSON.stringify(state));}catch{}};
    const tools=document.createElement('details'),summary=document.createElement('summary'),fields=document.createElement('div'),reset=document.createElement('button');tools.className='mm-table-tools';tools.dataset.mmTableTools='';summary.textContent='表格列选择 / 排序';fields.className='mm-action-tools';reset.type='button';reset.dataset.mmTableReset='';reset.className='btn btn-secondary';reset.textContent='恢复列与原顺序';tools.append(summary,fields,reset);table.before(tools);
    headers.forEach((header,index)=>{
      const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.mmTableColumn=String(index);check.checked=state.visible[index];label.append(check,' '+(titles[index]||'列 '+(index+1)));fields.append(label);
      check.addEventListener('change',()=>{if(!check.checked&&state.visible.filter(Boolean).length===1){check.checked=true;return;}state.visible[index]=check.checked;save();refresh();});
      if(header.querySelector('button,input,select,a'))return;
      const sort=document.createElement('button');sort.type='button';sort.className='link-button';sort.dataset.mmTableSort=String(index);sort.textContent=titles[index]||'列 '+(index+1);sort.setAttribute('aria-label','排序 '+sort.textContent);header.replaceChildren(sort);
      sort.addEventListener('click',()=>{state.direction=state.sort===index?-state.direction:1;state.sort=index;save();refresh();});
    });
    function refresh(){
      const rows=[...body.rows];if(rows.some(row=>row.cells.length!==headers.length||[...row.cells].some(cell=>cell.colSpan!==1||cell.rowSpan!==1)))return;
      for(const row of rows){if(!original.has(row))original.set(row,sequence++);[...row.cells].forEach((cell,i)=>{if(cell.hidden===state.visible[i])cell.hidden=!state.visible[i];});}
      headers.forEach((header,i)=>{header.hidden=!state.visible[i];header.setAttribute('aria-sort',state.sort===i?(state.direction===1?'ascending':'descending'):'none');});
      const ordered=rows.slice().sort((a,b)=>state.sort===null?original.get(a)-original.get(b):compareCellValues(a.cells[state.sort].textContent,b.cells[state.sort].textContent,state.direction)||original.get(a)-original.get(b));
      if(ordered.some((row,i)=>row!==rows[i]))body.append(...ordered);
    }
    reset.addEventListener('click',()=>{state.visible.fill(true);state.sort=null;state.direction=1;fields.querySelectorAll('input').forEach(input=>input.checked=true);save();refresh();});
    table.classList.add('mm-enhanced-table');const api={refresh,state};enhanced.set(table,api);refresh();return api;
  }
  function install(){
    const style=document.createElement('style');style.textContent='.mm-table-tools{margin:6px 0;padding:6px 9px;border:1px solid var(--border);border-radius:9px;background:var(--bg-secondary);color:var(--text-primary);font-size:11px}.mm-table-tools summary{cursor:pointer}.mm-table-tools label{display:inline-flex;align-items:center;gap:4px;padding:6px}.mm-enhanced-table thead th{position:sticky;top:0;z-index:1;background:var(--bg-secondary);font-variant-numeric:tabular-nums}.mm-enhanced-table [hidden]{display:none!important}.mm-table-tools .link-button{min-height:32px}';document.head.append(style);
    let scheduled=false;
    const active=()=>{const shell=document.getElementById('market-workspace-shell');return !!shell&&window.MoneyWorkspaceModules?.groupsForWorkspace?.(shell.dataset.marketScope,shell.dataset.workspace)?.includes('tables');};
    function scan(){scheduled=false;if(document.hidden||!active())return;const shell=document.getElementById('market-workspace-shell'),center=document.getElementById('center-workspace');if(!shell||!center)return;const context={market:shell.dataset.marketScope,workspace:shell.dataset.workspace};
      for(const table of center.querySelectorAll('.mm-table-scroll table'))if(table.getClientRects().length)enhanceTable(table,context);
    }
    const schedule=()=>{if(scheduled||document.hidden||!active())return;scheduled=true;requestAnimationFrame(scan);};
    const center=document.getElementById('center-workspace');if(center)new MutationObserver(schedule).observe(center,{childList:true,subtree:true});window.addEventListener('mm-workspace-context',schedule);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});schedule();
  }
  return {compareCellValues,enhanceTable,install};
});
