(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statuses={live:'实时',delayed:'延迟',cached:'缓存',partial:'部分成功',empty:'来源成功但暂无记录',unavailable:'来源不可用',unsupported:'当前市场不支持',failed:'请求失败',historical:'历史数据',queued:'排队中',running:'执行中',succeeded:'已完成',cancelled:'已取消'};
  const ctx=()=>{const shell=document.getElementById('market-workspace-shell');return {market:shell?.dataset.marketScope,workspace:shell?.dataset.workspace,instrument:shell?.dataset.instrument || ''};};
  let returnContext=null,locateVersion=0;
  // In-memory navigation only: never save private text, results or account data in URL/storage.
  const returnControls=['mm-experiment-all','mm-action-market','mm-action-section','mm-action-state','mm-action-snoozed','mm-action-map-sort'];
  function captureReturn(current){return {...current,url:location.pathname+location.search+location.hash,historyState:history.state,scroll:window.scrollY,centerScroll:document.getElementById('center-workspace')?.scrollTop||0,focus:document.activeElement,
    tab:document.querySelector('[data-research-tab][aria-selected="true"]')?.dataset.researchTab,
    controls:returnControls.flatMap(id=>{const node=document.getElementById(id);return node?[{id,value:node.value,checked:node.checked}]:[];}),
    choices:[...document.querySelectorAll('#mm-experiment-options input[type="checkbox"], [data-comparison-options] input[type="checkbox"]')].map(node=>({parent:node.closest('#mm-experiment-options')?'mm-experiment-options':'comparison',value:node.value,checked:node.checked}))};}
  function returnButton(){
    let button=document.getElementById('mm-return-to-research');if(!button){button=document.createElement('button');button.id='mm-return-to-research';button.className='btn btn-secondary';button.dataset.workspaceId='stock-quotes';button.dataset.marketScopes='stocks';button.type='button';button.textContent='← 返回上一个研究工作区';document.getElementById('center-workspace').prepend(button);}
    button.hidden=false;button.onclick=()=>{
      const saved=returnContext;if(!saved||ctx().market!==saved.market)return;returnContext=null;const version=++locateVersion;
      window.setMarketScope(saved.market);window.setWorkspaceInstrument(saved.instrument);window.openWorkspace(saved.workspace);history.replaceState(saved.historyState,'',saved.url);button.hidden=true;
      requestAnimationFrame(()=>{
        const current=ctx();if(version!==locateVersion||current.market!==saved.market||current.workspace!==saved.workspace||current.instrument!==saved.instrument)return;
        // Context navigation journals flush in a microtask; restore the saved entry afterwards.
        history.replaceState(saved.historyState,'',saved.url);
        [...document.querySelectorAll('[data-research-tab]')].find(node=>node.dataset.researchTab===saved.tab)?.click();
        for(const row of saved.controls){const node=document.getElementById(row.id);if(node){node.value=row.value;if(typeof row.checked==='boolean')node.checked=row.checked;}}
        for(const row of saved.choices){const selector=row.parent==='comparison'?'[data-comparison-options] input[type="checkbox"]':'#mm-experiment-options input[type="checkbox"]';for(const node of document.querySelectorAll(selector))if(node.value===row.value)node.checked=row.checked;}
        if(saved.focus?.isConnected)saved.focus.focus({preventScroll:true});
        const center=document.getElementById('center-workspace');if(center)center.scrollTop=saved.centerScroll;window.scrollTo({top:saved.scroll});
      });
    };
  }
  async function locate(date,instrument){
    const current=ctx(),day=String(date || '').slice(0,10);if(current.market!=='stocks' || !/^stock:us:[A-Z0-9.-]+$/.test(instrument || '') || !/^\d{4}-\d{2}-\d{2}$/.test(day)){window.showToast?.('该记录没有可核验的股票身份与日期，未猜测图表。','info');return null;}
    if(!returnContext||current.workspace!=='stock-quotes'||returnContext.market!==current.market)returnContext=captureReturn(current);
    const version=++locateVersion;window.setWorkspaceInstrument(instrument);window.openWorkspace('stock-quotes');returnButton();const index=await window.MoneyMoneyChartBridge.locateDay(instrument,day);
    const latest=ctx();if(version!==locateVersion||latest.market!=='stocks'||latest.workspace!=='stock-quotes'||latest.instrument!==instrument)return null;
    if(index==null)window.showToast?.('该日期不在可用日线覆盖内，请查看图表数据原因与覆盖区间。','info');return index;
  }
  async function api(url,options={}){const token=document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('mm_csrf='));const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(token?{'x-csrf-token':decodeURIComponent(token.slice(8))}:{}),...options.headers}});const body=await response.json();if(!response.ok || body.success===false)throw Error(body.reason || body.error || '请求失败 '+response.status);return body;}
  function historyTools(host,data,rerun){
    const market=ctx().market,series=data.series || [],instrument=ctx().instrument;
    const controls=document.createElement('div');controls.className='mm-action-tools';controls.innerHTML='<button type="button" data-history-retry>重试来源</button><button type="button" data-history-coverage>查看当前标的覆盖</button><button type="button" data-history-backfill>登记最近30天日线回补</button><div data-history-diagnostic role="status"></div>';
    host.append(controls);const diagnostic=controls.querySelector('[data-history-diagnostic]'),controller=new AbortController();
    const captured=JSON.stringify(ctx());const stale=()=>JSON.stringify(ctx())!==captured;
    window.addEventListener('mm-workspace-context',()=>{if(stale())controller.abort();},{signal:controller.signal});
    controls.querySelector('[data-history-retry]').onclick=rerun;
    controls.querySelector('[data-history-coverage]').onclick=async()=>{try{const result=await api('/api/data/coverage?'+new URLSearchParams({market,instrument:identity ? identity[2]:instrument}),{signal:controller.signal});if(stale())return;const rows=result.data?.instruments || result.data?.coverage || result.data || result.coverage || [];diagnostic.innerHTML='<p>'+esc(statuses[result.dataStatus] || result.dataStatus || '')+' · '+esc(result.reason || '覆盖详情')+'</p><pre>'+esc(JSON.stringify(rows,null,2))+'</pre>';}catch(error){if(error.name!=='AbortError')diagnostic.textContent=error.message;}};
    const identity=String(instrument).match(/^(stock:us|crypto:binance):([A-Z0-9.-]+)$/);
    controls.querySelector('[data-history-backfill]').disabled=!identity || window.mm_isGuest===true;
    controls.querySelector('[data-history-backfill]').onclick=async event=>{if(!identity || stale())return;if(!confirm('使用现有免费来源登记最近30天日线回补？来源可能只覆盖部分区间，任务不会生成缺失数据。'))return;event.target.disabled=true;try{const to=new Date().toISOString(),from=new Date(Date.now()-30*86400000).toISOString();const result=await api('/api/data/backfills',{method:'POST',signal:controller.signal,body:JSON.stringify({market,instrument:identity[2],dataset:'bars',timeframe:'1d',from,to})});if(stale())return;diagnostic.textContent=(statuses[result.dataStatus] || result.dataStatus)+' · '+result.data.id+' · '+(result.reason || '按来源预算执行');const refresh=document.createElement('button');refresh.type='button';refresh.textContent='查看任务状态';diagnostic.append(refresh);refresh.onclick=async()=>{try{const job=await api('/api/data/backfills/'+encodeURIComponent(result.data.id),{signal:controller.signal});if(stale())return;diagnostic.firstChild.textContent=(statuses[job.dataStatus] || job.dataStatus)+' · '+(job.reason || '')+' · 写入 '+(job.data.checkpoint?.rowsWritten || 0)+' 根';}catch(error){if(error.name!=='AbortError')diagnostic.firstChild.textContent=error.message;}};}catch(error){if(error.name!=='AbortError')diagnostic.textContent=error.message;}finally{event.target.disabled=!identity;}};
    const raw=series.filter(row=>row.rawPoints?.length);
    if(raw.length){const holder=document.createElement('details');holder.innerHTML='<summary>原始价格与公司行动口径（不把价格变化当总回报）</summary><div data-raw-chart></div>'+raw.map(row=>'<p>'+esc(row.instrument+' · 口径 '+(row.adjustment || '未知'))+'</p>'+(row.corporateActions || []).map(action=>'<p>'+esc(action.kind+' · 生效 '+action.effectiveAt+' · 发布 '+(action.publishedAt || '未知')+' · 来源 '+action.source+' · 参数 '+action.factor)+'</p>').join('')).join('');host.append(holder);window.MoneyMoneyHistoryChart.render(holder.querySelector('[data-raw-chart]'),raw.map(row=>({label:row.instrument+' · 来源原始价格',points:row.rawPoints.map(point=>({date:point.date,value:point.close}))})),{title:'来源原始价格（各标的单位分别核验）',onLocate:date=>locate(date,instrument)});}
  }
  function renderRevisionImpact(host,experiments,request){
    if(window.mm_isGuest===true)return;
    const captured=JSON.stringify(ctx()),stale=()=>!host.isConnected||captured!==JSON.stringify(ctx());
    const section=document.createElement('section');section.className='mm-revision-impact';host.append(section);
    for(const experiment of experiments.slice(0,6)){
      const article=document.createElement('article'),button=document.createElement('button'),output=document.createElement('div');
      button.type='button';button.className='tab';button.dataset.revisionImpact=experiment.id;button.textContent='检查快照修订影响 · '+experiment.id;output.setAttribute('role','status');article.append(button,output);section.append(article);
      const portable=document.createElement('button');portable.type='button';portable.className='tab';portable.dataset.experimentReproducibility=experiment.id;portable.textContent='导出此实验离线复现包';article.append(portable);portable.onclick=async()=>{if(stale())return;portable.disabled=true;try{const body=await request('/api/research/experiments/'+encodeURIComponent(experiment.id)+'/reproducibility?'+new URLSearchParams({market:ctx().market}));if(stale())return;const url=URL.createObjectURL(new Blob([JSON.stringify(body.data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='research-package-'+experiment.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);output.textContent='复现包已导出；使用 verify-research-package.cjs 在隔离环境校验并重新计算。';}catch(error){if(!stale()&&error.name!=='AbortError')output.textContent=error.message;}finally{portable.disabled=false;}};
      button.onclick=async()=>{
        if(stale())return;button.disabled=true;output.textContent='读取明确分区与快照引用…';
        try{
          const result=await request('/api/research/experiments/'+encodeURIComponent(experiment.id)+'/revision-impact');if(stale())return;
          output.replaceChildren();const note=document.createElement('p');note.textContent=result.reason;output.append(note);
          for(const row of result.data.rows){const p=document.createElement('p');p.textContent=row.kind+' · '+row.id+' · '+row.status+' · '+row.reason;output.append(p);
            for(const change of row.findings){const detail=document.createElement('p');detail.textContent=change.publishedAt+' · '+change.oldHash+' → '+change.newHash+' · '+change.reason;output.append(detail);}}
          if(!result.data.rows.length)output.textContent+=' 未关联到可核验研究记录。';
          const reminder=document.createElement('p');reminder.textContent='下面仅用保存输入复跑，不会自动采集或采用修订后数据。新数据研究需明确创建新实验。';output.append(reminder);
          const rerun=document.createElement('button');rerun.type='button';rerun.className='tab';rerun.dataset.preservedRerun=experiment.id;rerun.textContent='用保存输入复跑（保留原结果）';output.append(rerun);
          rerun.onclick=async()=>{if(stale()||!confirm('用已保存输入创建独立复跑？原实验和结果保留，不调用模型、不创建订单，也不自动替换数据。'))return;
            rerun.disabled=true;try{const result=await request('/api/research/experiments/'+encodeURIComponent(experiment.id)+'/rerun',{method:'POST',body:'{}'});if(stale())return;const p=document.createElement('p');p.textContent='已保存独立复跑 '+result.data.experiment.id+' · 原实验 '+result.rerunOf;output.append(p);}catch(error){if(!stale()&&error.name!=='AbortError')reminder.textContent=error.message;}finally{rerun.disabled=false;}};
        }catch(error){if(!stale()&&error.name!=='AbortError')output.textContent=error.message;}
        finally{button.disabled=false;}
      };
    }
  }
  function renderContextLedger(host,request){
    if(window.mm_isGuest===true)return;
    const captured=JSON.stringify(ctx()),market=ctx().market,stale=()=>!host.isConnected||captured!==JSON.stringify(ctx());
    const section=document.createElement('details'),summary=document.createElement('summary'),load=document.createElement('button'),output=document.createElement('div');summary.textContent='股票池观察与参数试验台账';load.type='button';load.className='tab';load.dataset.contextLedger='';load.textContent='读取当前市场台账';output.setAttribute('role','status');section.append(summary,load,output);host.append(section);
    const read=async()=>{const response=await request('/api/research/context-ledger?market='+encodeURIComponent(market));if(stale())return;const data=response.data;output.innerHTML='<p>'+esc(data.reason)+'</p><p>已记录尝试 '+esc(data.attempts)+' / 不同配置 '+esc(data.uniqueConfigurations)+'；无优劣排名。</p><h5>实际观察股票池（非历史成分回填）</h5>'+data.universes.map(row=>'<details><summary>'+esc(new Date(row.observedAt).toISOString())+' · '+esc(row.instruments.length)+'个</summary><p>'+esc(row.hash)+'</p><p>'+esc(row.instruments.join('、'))+'</p></details>').join('')+'<h5>最近试验</h5><div class="mm-table-scroll"><table><thead><tr><th>试验 / 关联实验</th><th>版本 / 区间声明</th><th>状态 / 参数</th></tr></thead><tbody>'+data.trials.map(row=>'<tr><td>'+esc(row.id)+' / '+esc(row.experimentId||'未关联')+'</td><td>'+esc(row.strategyVersion||'未关联')+' / '+esc(row.split)+'</td><td>'+esc(row.status)+' / '+esc(JSON.stringify(row.parameters))+'</td></tr>').join('')+'</tbody></table></div>';const save=document.createElement('button');save.type='button';save.className='tab';save.dataset.universeCapture='';save.textContent='保存当前市场自选观察（不修改实验）';output.append(save);save.onclick=async()=>{if(stale()||!confirm('记录当前服务端自选及当前观察时间？不回填旧成分、不改变已有跑单。'))return;save.disabled=true;try{await request('/api/research/context-ledger/universe',{method:'POST',body:JSON.stringify({market})});if(!stale())await read();}catch(error){if(!stale())output.append(document.createTextNode(error.message));}finally{save.disabled=false;}};};
    load.onclick=async()=>{if(stale())return;load.disabled=true;try{await read();}catch(error){if(!stale())output.textContent=error.message;}finally{load.disabled=false;}};
  }
  function renderSharedCapital(host,experiments,request){
    if(window.mm_isGuest===true||experiments.length<2)return;
    const captured=JSON.stringify(ctx()),stale=()=>!host.isConnected||captured!==JSON.stringify(ctx()),ids=experiments.map(row=>row.id);
    const section=document.createElement('details'),summary=document.createElement('summary'),button=document.createElement('button'),output=document.createElement('div');
    summary.textContent='同资金路径与逐策略增量贡献';button.type='button';button.className='tab';button.dataset.sharedCapital='';button.textContent='按已保存输入计算（不下单）';output.setAttribute('role','status');section.append(summary,button,output);host.append(section);
    button.onclick=async()=>{if(stale())return;button.disabled=true;output.textContent='核验相同标的、路径和成本，重放共享现金约束…';try{
      const response=await request('/api/research/shared-capital',{method:'POST',body:JSON.stringify({ids})});if(stale())return;const d=response.data,c=d.combined;
      output.innerHTML='<p>'+esc(d.reason)+'</p><p>期末权益 '+esc(c.endingEquity)+' · 费用 '+esc(c.totalFees)+' · 滑点 '+esc(c.totalSlippage)+' · 最大回撤 '+esc(c.maxDrawdownPct)+'%</p><p>配置 Hash '+esc(d.configurationHash)+'</p><div class="mm-table-scroll"><table><thead><tr><th>移除实验</th><th>权益增量</th><th>收益百分点差</th></tr></thead><tbody>'+d.contributions.map(row=>'<tr><td>'+esc(row.experimentId)+'</td><td>'+esc(row.marginalEquity)+'</td><td>'+esc(row.marginalReturnPoints)+'</td></tr>').join('')+'</tbody></table></div><details><summary>资金约束拒单 '+c.rejections.length+' · 未平仓 '+c.openPositions.length+'</summary>'+c.rejections.map(row=>'<p>'+esc(row.experimentId)+' · 第'+esc(row.timeIndex)+'根 · '+esc(row.reason)+'</p>').join('')+c.openPositions.map(row=>'<p>'+esc(row.experimentId)+' · '+esc(row.quantity)+' @ '+esc(row.markPrice)+'</p>').join('')+'</details><p>'+(d.warnings||[]).map(esc).join(' ')+'</p>';
    }catch(error){if(!stale()&&error.name!=='AbortError')output.textContent=error.message;}finally{button.disabled=false;}};
  }
  function experimentDetails(host,data,request){
    renderContextLedger(host,request);
    renderSharedCapital(host,data.experiments,request);
    const validity=document.createElement('section'),check=document.createElement('button'),output=document.createElement('div');check.type='button';check.className='tab';check.textContent='检查结论失效与复核历史';validity.append(check,output);host.append(validity);
    check.onclick=async()=>{check.disabled=true;output.textContent='读取同版本数据修订和漂移证据…';try{const rows=await Promise.all(data.experiments.map(async row=>({id:row.id,...await request('/api/research/experiments/'+encodeURIComponent(row.id)+'/freshness')})));output.replaceChildren();for(const row of rows){const p=document.createElement('p');p.textContent=row.id+' · '+row.data.status+' · '+row.data.reason+' · '+(row.validity?.reason||'无复核历史')+'\n'+(row.validity?.history||[]).map(entry=>entry.at+' '+entry.status+' '+entry.reasons.join('；')).join('\n');p.style.whiteSpace='pre-wrap';output.append(p);}}catch(error){if(error.name!=='AbortError')output.textContent=error.message;}finally{check.disabled=false;}};
    window.MoneyMoneyProfessionalResearch?.renderRobustness(host,data.experiments,request);
    renderRevisionImpact(host,data.experiments,request);
    const titles={instrument:'标的',timeframe:'周期',strategyId:'策略',strategyVersion:'策略版本',parameters:'声明参数',dataFrom:'数据起点',dataTo:'数据截止',dataSource:'来源',dataSnapshotHash:'快照 Hash',feeRate:'手续费率',slippage:'滑点',seed:'随机种子'};
    const section=document.createElement('section');section.innerHTML='<h4>逐实验配置差异</h4><div class="mm-table-scroll"><table><thead><tr><th>字段</th>'+data.experiments.map(row=>'<th>'+esc(row.id)+'</th>').join('')+'</tr></thead><tbody>'+data.differences.map(row=>'<tr><th>'+esc(titles[row.field] || row.field)+'</th>'+row.values.map(item=>'<td>'+esc(item.value!=null && typeof item.value==='object'?Object.entries(item.value).map(([key,value])=>key+'='+value).join('；'):item.value ?? '未声明')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+data.experiments.map(row=>'<article><h4>'+esc(row.id)+'</h4><p>声明参数：'+esc(row.parameters?Object.entries(row.parameters).map(([key,value])=>key+'='+value).join('；'):'旧实验未保存参数，不猜测')+' · 来源 '+esc(row.dataSource)+' · 策略 '+esc(row.strategyId)+' / '+esc(row.strategyVersion || '未关联')+'</p><p>样本外窗口：'+esc((row.folds || []).map(fold=>'训练 '+fold.trainStart+'–'+fold.trainEnd+' / 验证 '+fold.testStart+'–'+fold.testEnd).join('；') || '未声明')+'</p><button type="button" data-experiment-links="'+esc(row.id)+'">查看明确关联的信号、模拟成交和日记</button><div data-experiment-related="'+esc(row.id)+'"></div></article>').join('');host.append(section);
    section.querySelectorAll('[data-experiment-links]').forEach(button=>button.onclick=async()=>{const target=[...section.querySelectorAll('[data-experiment-related]')].find(node=>node.dataset.experimentRelated===button.dataset.experimentLinks);try{const result=await request('/api/research/experiments/'+encodeURIComponent(button.dataset.experimentLinks)+'/links');target.innerHTML='<p>'+esc(result.reason)+'</p>'+[['signals','信号'],['orders','模拟成交'],['decisions','决策日记']].map(([key,title])=>'<h5>'+title+'</h5>'+((result.data[key] || []).map(row=>'<p>'+esc(row.id+' · '+row.instrument+(row.timestamp?' · '+row.timestamp:''))+'</p>').join('') || '<p>未关联</p>')).join('');}catch(error){if(error.name!=='AbortError')target.textContent=error.message;}});
  }
  window.MoneyMoneyWorkflow={locate,historyTools,experimentDetails,renderRevisionImpact,renderContextLedger,renderSharedCapital,status:value=>statuses[value] || value};
  function init(){const date=new URLSearchParams(location.search).get('focusDate'),instrument=new URLSearchParams(location.search).get('instrument');if(date && /^stock:us:[A-Z0-9.-]+$/.test(instrument || ''))window.MoneyMoneyChartBridge.locateDay(instrument,date);const shell=document.getElementById('market-workspace-shell');new MutationObserver(()=>{if(returnContext && ctx().market!==returnContext.market){returnContext=null;document.getElementById('mm-return-to-research')?.setAttribute('hidden','');}}).observe(shell,{attributes:true,attributeFilter:['data-market-scope']});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
