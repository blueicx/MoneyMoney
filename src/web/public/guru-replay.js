(function(root,factory){const api=factory();if(typeof module==='object' && module.exports)module.exports=api;else root.MoneyMoneyGuruReplay=api;})(typeof window==='undefined'?globalThis:window,()=>{
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const shareValue=value=>typeof value==='number' && Number.isFinite(value) && value>=0 ? value:null;
  const manager=value=>/^\d{1,10}$/.test(String(value || '')) ? String(value).replace(/^0+/,'') || null:null;
  const statusText=status=>status==='退出' ? '本期未披露（不代表清仓）':status==='新进' ? '新披露':status;
  function security(row){
    const cusip=String(row.cusip || '').trim().toUpperCase(),title=String(row.classTitle || '').trim().toUpperCase(),putCall=String(row.putCall || '').trim().toUpperCase();
    return /^[A-Z0-9]{9}$/.test(cusip) && title && ['', 'PUT','CALL'].includes(putCall) ? [cusip,title,putCall].join('|'):null;
  }
  function identity(row){const key=security(row);return key && ['SH','PRN'].includes(row.shareAmountType) ? key+'|'+row.shareAmountType:null;}
  function quarter(date){
    const match=String(date || '').match(/^(\d{4})-(03-31|06-30|09-30|12-31)$/);
    return match ? Number(match[1])*4+['03-31','06-30','09-30','12-31'].indexOf(match[2]):null;
  }
  function compareReports(previous,current){
    const old=new Map(),fresh=new Map(),unknown=[];let unresolved=0,oldUnknown=0,newUnknown=0,duplicate=false;
    for(const [report,map] of [[previous,old],[current,fresh]])for(const row of report?.positions || []){
      const key=identity(row);
      if(!key){unresolved++;if(map===old)oldUnknown++;else{newUnknown++;unknown.push({...row,shares:shareValue(row.shares),change:null,previousShares:null,status:'不可比',weightPct:null,comparisonReason:'证券身份或股数单位不完整，未猜测归属'});}continue;}
      if(map.has(key))duplicate=true;map.set(key,row);
    }
    const priorQuarter=quarter(previous?.reportPeriod),currentQuarter=quarter(current?.reportPeriod);
    const comparable=Boolean(previous && manager(previous.cik) && manager(previous.cik)===manager(current?.cik) && priorQuarter!=null && currentQuarter===priorQuarter+1 && !duplicate && !/\/A$/i.test(previous.form || '') && !/\/A$/i.test(current.form || '') && previous.comparisonAvailable!==false && current.comparisonAvailable!==false);
    const positions=current?.positions || [],total=positions.length && positions.every(row=>typeof row.reportedValueUsd==='number' && Number.isFinite(row.reportedValueUsd) && row.reportedValueUsd>=0) ? positions.reduce((sum,row)=>sum+row.reportedValueUsd,0):null;
    let uncertain=0;
    const oldSecurities=new Set([...old.values()].map(security)),newSecurities=new Set([...fresh.values()].map(security));
    const rows=[...new Set([...old.keys(),...fresh.keys()])].map(key=>{
      const a=old.get(key),b=fresh.get(key),basis=b || a;
      const unitChanged=(!a && oldSecurities.has(security(b))) || (!b && newSecurities.has(security(a)));
      const shares=b ? shareValue(b.shares):null,previousShares=a ? shareValue(a.shares):null;
      const known=comparable && !unitChanged && (a ? previousShares!=null:oldUnknown===0) && (b ? shares!=null:newUnknown===0);
      const change=known ? (b ? shares:0)-(a ? previousShares:0):null;
      if(!known)uncertain++;
      return {...basis,shares,previousShares,change,status:!known ? '不可比':!a ? '新进':!b ? '退出':change>0 ? '增持':change<0 ? '减持':'不变',weightPct:total>0 && b ? b.reportedValueUsd/total*100:null,comparisonReason:known ? null:unitChanged ? '股数单位变化，不比较 SH 与 PRN':comparable ? '股数或身份不完整，未把缺失值当作零':'机构、相邻季度或修订状态不可比较'};
    });
    return {rows:[...rows,...unknown],unresolved,comparable,reason:!comparable ? '机构身份、相邻季度、重复身份或修订状态不可比较；仅展示申报，不猜测变化':uncertain || unresolved ? '部分股数、单位或身份不完整；仅比较已核验项，不推算实时持仓':'同机构、相邻季度、同 CUSIP/类别/股数单位；不推算实时持仓'};
  }
  function csv(rows){const cell=value=>{const text=String(value??'');return '"'+(/^[=+@\-\t\r]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';};return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');}
  function render(host,history,options={}){
    const reports=(history.reports || []).slice().sort((a,b)=>String(a.reportPeriod).localeCompare(String(b.reportPeriod)) || String(a.filedAt).localeCompare(String(b.filedAt)));
    host.querySelector('.mm-guru-replay')?.remove();
    if(!reports.length)return;
    const panel=document.createElement('section');panel.className='mm-guru-replay';
    panel.innerHTML='<h4>季度持仓回放</h4><p>13F 季度滞后披露，非实时持仓。权重仅指该机构本期已披露 13F 证券市值。</p><div class="mm-guru-controls"><button type="button" data-guru-previous>上一期</button><label>已保存报告 <input type="range" min="0" max="'+(reports.length-1)+'" value="'+(reports.length-1)+'" aria-label="13F报告回放"></label><button type="button" data-guru-next>下一期</button></div><div class="mm-guru-controls"><label>搜索证券 <input type="search" data-guru-search placeholder="公司名称 / CUSIP / 类别"></label><label>披露变化 <select data-guru-filter><option value="">全部</option><option value="增持">增持</option><option value="减持">减持</option><option value="新进">新披露</option><option value="退出">本期未披露</option><option value="不变">不变</option><option value="不可比">不可比</option></select></label><button type="button" data-guru-export>导出当前结果 CSV</button></div><div data-report></div>';
    host.append(panel);
    const input=panel.querySelector('input[type=range]'),output=panel.querySelector('[data-report]'),search=panel.querySelector('[data-guru-search]'),filter=panel.querySelector('[data-guru-filter]');
    let selected=[],current,page=0;
    const pageSize=100;
    function draw(){
      const i=Number(input.value);current=reports[i];const result=compareReports(reports[i-1],current),query=search.value.trim().toLowerCase();
      selected=result.rows.filter(row=>(!filter.value || row.status===filter.value) && (!query || [row.issuerName,row.cusip,row.classTitle,row.putCall].join(' ').toLowerCase().includes(query))).sort((a,b)=>(b.reportedValueUsd || 0)-(a.reportedValueUsd || 0));
      page=Math.max(0,Math.min(page,Math.ceil(selected.length/pageSize)-1));
      const visibleRows=selected.slice(page*pageSize,(page+1)*pageSize);
      const link=current.informationTableUrl || current.sourceUrl,safe=/^https:\/\/(www\.)?sec\.gov\//i.test(link || '');
      panel.querySelector('[data-guru-previous]').disabled=i===0;panel.querySelector('[data-guru-next]').disabled=i===reports.length-1;
      panel.querySelector('[data-guru-export]').disabled=!selected.length;
      output.innerHTML='<h4>'+esc(current.reportPeriod)+' · 申报 '+esc(current.filedAt || '时间未知')+' · '+esc(current.form || '13F')+'</h4><p>'+esc(result.reason)+' · 身份/单位不完整 '+result.unresolved+' 项</p>'+(safe ? '<a target="_blank" rel="noopener noreferrer" href="'+esc(link)+'">SEC 原文</a>':'<p>原文链接不可用</p>')+'<p role="status" aria-live="polite">当前 '+selected.length+' / '+result.rows.length+' 项</p>'+(selected.length ? '<div class="mm-table-scroll"><table><thead><tr><th scope="col">证券身份</th><th scope="col">本期股数</th><th scope="col">上期股数</th><th scope="col">披露变化</th><th scope="col">本期披露权重</th></tr></thead><tbody>'+visibleRows.map(row=>'<tr><td>'+esc(row.issuerName || row.cusip || '未映射证券')+'<br>'+esc((row.cusip || 'CUSIP未知')+' / '+(row.classTitle || '类别未知')+' / '+(row.putCall || '未申报 Put/Call')+' / '+(row.shareAmountType || '单位未知'))+'</td><td>'+esc(row.shares ?? '未披露/不可用')+'</td><td>'+esc(row.previousShares ?? '未披露/不可用')+'</td><td>'+esc(statusText(row.status))+' '+esc(row.change ?? '变化不可用')+(row.comparisonReason ? '<br>'+esc(row.comparisonReason):'')+'</td><td>'+esc(row.weightPct==null ? '口径不完整':row.weightPct.toFixed(2)+'%')+'</td></tr>').join('')+'</tbody></table></div>':'<p class="empty-tip">没有符合筛选的申报；请调整搜索或变化筛选。</p>');
      output.insertAdjacentHTML('beforeend','<div class="mm-guru-controls"><button type="button" data-guru-page-previous>上一页</button><span>第 '+(page+1)+' / '+Math.max(1,Math.ceil(selected.length/pageSize))+' 页 · 每页最多 '+pageSize+' 项</span><button type="button" data-guru-page-next>下一页</button></div>');
      const previousPage=output.querySelector('[data-guru-page-previous]'),nextPage=output.querySelector('[data-guru-page-next]');
      previousPage.disabled=page===0;nextPage.disabled=(page+1)*pageSize>=selected.length;
      previousPage.onclick=()=>{page--;draw();};nextPage.onclick=()=>{page++;draw();};
    }
    const reset=()=>{page=0;draw();};
    input.oninput=reset;search.oninput=reset;filter.onchange=reset;
    panel.querySelector('[data-guru-previous]').onclick=()=>{input.value=String(Math.max(0,Number(input.value)-1));reset();};
    panel.querySelector('[data-guru-next]').onclick=()=>{input.value=String(Math.min(reports.length-1,Number(input.value)+1));reset();};
    panel.querySelector('[data-guru-export]').onclick=()=>{
      const content=csv([['机构 CIK','报告期','申报时间','公司','CUSIP','类别','Put/Call','单位','本期股数','上期股数','披露变化','股数变化','本期披露权重(%)','限制','SEC 原文'],...selected.map(row=>[current.cik,current.reportPeriod,current.filedAt,row.issuerName,row.cusip,row.classTitle,row.putCall,row.shareAmountType,row.shares,row.previousShares,statusText(row.status),row.change,row.weightPct,row.comparisonReason || '季度滞后披露，非实时持仓',current.informationTableUrl || current.sourceUrl])]);
      const name='moneymoney-13f-'+String(current.reportPeriod || 'unknown').replace(/[^\d-]/g,'')+'.csv';
      if(options.download){options.download(name,content);return;}
      const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    draw();
  }
  return {compareReports,render,csv};
});
