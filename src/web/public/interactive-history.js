(function(root,factory){ const api=factory(); if(typeof module==='object' && module.exports) module.exports=api; else root.MoneyMoneyHistoryChart=api; })(typeof window==='undefined'?globalThis:window,()=>{
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function segments(points) { const result=[];let current=[];for(const point of points){if(typeof point.value==='number' && Number.isFinite(point.value)) current.push(point);else if(current.length){result.push(current);current=[];}}if(current.length)result.push(current);return result; }
  function csv(rows) {const cell=value=>{const text=String(value??'');return '"'+(/^[=+@\-]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';};return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');}
  function render(host,series,options={}) {
    const colors=['#a783ff','#3dc9c7','#ffba57','#ef8291','#71ce8a','#779ced'];
    const usable=series.filter(row=>row.points?.some(point=>typeof point.value==='number' && Number.isFinite(point.value)));
    if(!usable.length){host.innerHTML='<p class="empty-tip">'+esc(options.reason || '暂无可用历史曲线；请查看来源与覆盖区间。')+'</p>';return;}
    const dates=[...new Set(usable.flatMap(row=>row.points.map(point=>String(point.date))))].sort();
    const aligned=usable.map(row=>{const byDate=new Map(row.points.map(point=>[String(point.date),point.value]));return {...row,points:dates.map(date=>({date,value:byDate.has(date)?byDate.get(date):null}))};});
    let from=0,to=dates.length-1;
    host.classList.add('mm-interactive-chart');
    host.innerHTML=`<div class="mm-chart-toolbar"><strong>${esc(options.title || '真实历史')}</strong><button type="button" data-reset>全部区间</button><button type="button" data-export>导出 CSV</button><label><input type="checkbox" data-table-toggle>数据表</label></div><div class="mm-chart-stage"></div><output role="status" aria-live="polite" data-inspect>移动光标或使用左右方向键查看；拖动选择区间。</output><div class="mm-chart-legend">${aligned.map((row,i)=>`<span style="color:${colors[i%colors.length]}">${esc(row.label || row.instrument)}${options.unit ? ' · '+esc(options.unit):''}</span>`).join('')}</div><div data-table hidden></div>`;
    const stage=host.querySelector('.mm-chart-stage'),inspect=host.querySelector('[data-inspect]');
    const svgNS='http://www.w3.org/2000/svg';let focused=0,drag=null;
    function pointRows(){return dates.slice(from,to+1).map((date,k)=>[date,...aligned.map(row=>row.points[from+k].value)]);}
    function show(index){focused=Math.max(from,Math.min(to,index));inspect.textContent=dates[focused]+' · '+aligned.map(row=>(row.label || row.instrument)+': '+(row.points[focused].value==null?'数据缺口':Number(row.points[focused].value).toFixed(4)+(options.unit||''))).join(' · '); const line=stage.querySelector('[data-crosshair]');const x=60+(focused-from)/Math.max(1,to-from)*820;line?.setAttribute('x1',x);line?.setAttribute('x2',x);}
    function draw(){
      const values=aligned.flatMap(row=>row.points.slice(from,to+1).flatMap(point=>typeof point.value==='number' && Number.isFinite(point.value)?[point.value]:[]));
      const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1,span=max-min || 1;
      const x=index=>60+(index-from)/Math.max(1,to-from)*820,y=value=>240-(value-min)/span*200;
      stage.innerHTML=`<svg viewBox="0 0 900 280" tabindex="0" role="img" aria-label="${esc(options.title || '历史曲线')}，左右键定位，拖动选择区间"><text x="5" y="35">${esc(max.toFixed(2))}</text><text x="5" y="243">${esc(min.toFixed(2))}</text><text x="60" y="270">${esc(dates[from])}</text><text x="880" y="270" text-anchor="end">${esc(dates[to])}</text><path d="M60 40V240H880" fill="none" stroke="var(--border)"/>${aligned.map((row,i)=>segments(row.points.slice(from,to+1).map((point,k)=>({...point,index:from+k}))).map(segment=>segment.length===1?`<circle cx="${x(segment[0].index)}" cy="${y(segment[0].value)}" r="3" fill="${colors[i%colors.length]}"/>`:`<polyline fill="none" stroke="${colors[i%colors.length]}" stroke-width="2" points="${segment.map(point=>`${x(point.index)},${y(point.value)}`).join(' ')}"/>`).join('')).join('')}<line data-crosshair x1="60" x2="60" y1="30" y2="240" stroke="var(--text-secondary)" stroke-dasharray="4 4"/></svg>`;
      const svg=stage.querySelector('svg');
      const indexAt=event=>{const box=svg.getBoundingClientRect();return Math.max(from,Math.min(to,Math.round(from+(((event.clientX-box.left)/box.width*900-60)/820)*(to-from))));};
      svg.onpointermove=event=>show(indexAt(event));
      svg.onpointerdown=event=>{drag=indexAt(event);svg.setPointerCapture?.(event.pointerId);};
      svg.onpointerup=event=>{const end=indexAt(event);if(drag!=null && Math.abs(end-drag)>=2){from=Math.min(drag,end);to=Math.max(drag,end);draw();}else if(options.onLocate) options.onLocate(dates[end]);drag=null;};
      svg.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();show(event.key==='Home'?from:event.key==='End'?to:focused+(event.key==='ArrowRight'?1:-1));}else if(event.key==='Enter') options.onLocate?.(dates[focused]);else if(event.key==='Escape'){from=0;to=dates.length-1;draw();}};
      host.querySelector('[data-table]').innerHTML=`<table><thead><tr><th>时间</th>${aligned.map(row=>`<th>${esc(row.label || row.instrument)}</th>`).join('')}</tr></thead><tbody>${pointRows().map(row=>`<tr>${row.map(value=>`<td>${esc(value??'数据缺口')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      show(Math.max(from,Math.min(to,focused)));
    }
    host.querySelector('[data-reset]').onclick=()=>{from=0;to=dates.length-1;draw();};
    host.querySelector('[data-table-toggle]').onchange=event=>host.querySelector('[data-table]').hidden=!event.target.checked;
    host.querySelector('[data-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([csv([['时间',...aligned.map(row=>row.label || row.instrument)],...pointRows()])],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='moneymoney-history.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    draw();
  }
  return {segments,csv,render};
});
