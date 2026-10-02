(function(root,factory){const api=factory();if(typeof module==='object' && module.exports)module.exports=api;else root.MoneyMoneyGuruReplay=api;})(typeof window==='undefined'?globalThis:window,()=>{
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function identity(row){return /^[A-Z0-9]{9}$/.test(String(row.cusip || '').toUpperCase()) && row.classTitle ? [row.cusip.toUpperCase(),row.classTitle.trim().toUpperCase(),row.putCall || '',row.shareAmountType || 'SH'].join('|'):null;}
  function compareReports(previous,current){
    const old=new Map(),fresh=new Map();let unresolved=0,duplicate=false;
    for(const [report,map] of [[previous,old],[current,fresh]])for(const row of report?.positions || []){const key=identity(row);if(!key){unresolved++;continue;}if(map.has(key))duplicate=true;map.set(key,row);}
    const months=(Date.parse(current?.reportPeriod)-Date.parse(previous?.reportPeriod))/86400_000;
    const comparable=Boolean(previous && months>=85 && months<=95 && !duplicate && !/\/A$/.test(previous.form || '') && !/\/A$/.test(current.form || '') && previous.comparisonAvailable!==false && current.comparisonAvailable!==false);
    const positions=current?.positions || [],total=positions.length && positions.every(row=>Number.isFinite(row.reportedValueUsd) && row.reportedValueUsd>=0) ? positions.reduce((sum,row)=>sum+row.reportedValueUsd,0):null;
    const rows=[...new Set([...old.keys(),...fresh.keys()])].map(key=>{const a=old.get(key),b=fresh.get(key),shares=b?.shares ?? 0,change=comparable && Number.isFinite(a?.shares ?? 0) && Number.isFinite(shares) ? shares-(a?.shares ?? 0):null;return {...(b || a),shares,previousShares:a?.shares ?? null,change,status:!comparable?'不可比':!a?'新进':!b?'退出':change>0?'增持':change<0?'减持':'不变',weightPct:total && b && Number.isFinite(b.reportedValueUsd)?b.reportedValueUsd/total*100:null};});
    return {rows,unresolved,comparable,reason:comparable ? '同机构、相邻季度、同 CUSIP/类别/股数单位；不推算实时持仓':'缺少相邻季度、身份重复或修订报告尚不可比；只展示本期申报，不猜测变化'};
  }
  function render(host,history){
    const reports=(history.reports || []).slice().sort((a,b)=>String(a.reportPeriod).localeCompare(String(b.reportPeriod)) || String(a.filedAt).localeCompare(String(b.filedAt)));
    if(!reports.length)return;const panel=document.createElement('section');panel.className='mm-guru-replay';panel.innerHTML='<h4>季度持仓回放</h4><p>13F 季度滞后披露，非实时持仓。权重仅指该机构本期已披露 13F 证券市值。</p><label>已保存报告 <input type="range" min="0" max="'+(reports.length-1)+'" value="'+(reports.length-1)+'" aria-label="13F报告回放"></label><div data-report></div>';host.append(panel);
    const input=panel.querySelector('input'),output=panel.querySelector('[data-report]');
    function draw(){const i=Number(input.value),current=reports[i],result=compareReports(reports[i-1],current);const link=current.informationTableUrl || current.sourceUrl;const safe=/^https:\/\/(www\.)?sec\.gov\//i.test(link || '');output.innerHTML='<h4>'+esc(current.reportPeriod)+' · 申报 '+esc(current.filedAt)+' · '+esc(current.form || '13F')+'</h4><p>'+esc(result.reason)+' · 未映射 '+result.unresolved+' 项</p>'+(safe?'<a target="_blank" rel="noopener noreferrer" href="'+esc(link)+'">SEC 原文</a>':'<p>原文链接不可用</p>')+'<div class="mm-table-scroll"><table><thead><tr><th>证券身份</th><th>股数</th><th>变化</th><th>权重</th></tr></thead><tbody>'+result.rows.sort((a,b)=>(b.reportedValueUsd || 0)-(a.reportedValueUsd || 0)).map(row=>'<tr><td>'+esc(row.issuerName || row.cusip)+'<br>'+esc(row.cusip+' / '+row.classTitle+' / '+(row.putCall || '股票')+' / '+(row.shareAmountType || 'SH'))+'</td><td>'+esc(row.shares)+'</td><td>'+esc(row.status)+' '+esc(row.change ?? '不可用')+'</td><td>'+esc(row.weightPct==null?'口径不完整':row.weightPct.toFixed(2)+'%')+'</td></tr>').join('')+'</tbody></table></div>';}
    input.oninput=draw;draw();
  }
  return {compareReports,render};
});
