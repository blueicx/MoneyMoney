(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const markets = { stocks:'股票', options:'期权', crypto:'虚拟币', prediction:'预测市场' };
  const kinds = { changes:'今日变化', upcoming:'未来七天', alert:'待确认提醒', screener:'筛选进出', '13f':'13F 变化', review:'到期复盘' };
  let records = [], controller, lastScope, lastContext='', lifecycleController = new AbortController();
  function context() { const shell=document.getElementById('market-workspace-shell');return {market:shell?.dataset.marketScope,workspace:shell?.dataset.workspace,instrument:shell?.dataset.instrument || ''}; }
  const saved = key => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };
  const pref = saved('mm-action-filter-v1');
  function csrf() { const token = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith('mm_csrf=')); return token ? { 'x-csrf-token': decodeURIComponent(token.slice(8)) } : {}; }
  async function api(url, options = {}) {
    const signal = options.signal || lifecycleController.signal;
    const response = await fetch(url, { ...options, signal, headers: { 'content-type':'application/json', ...csrf(), ...options.headers } });
    const body = await response.json();
    signal.throwIfAborted();
    if (!response.ok || body.success === false) throw new Error(body.reason || body.error || `请求失败 ${response.status}`);
    return body;
  }
  function link(row, workspace) { const params = new URLSearchParams({ market:row.market, workspace }); if (row.instrument) params.set('instrument',row.instrument); const at = row.occurredAt || row.publishedAt; if (at) params.set('asOf', at); return '/?' + params; }
  function drawer(row,group=records) {
    const overlay = document.createElement('dialog'); overlay.className = 'mm-action-detail';
    const links = [['图表', ({ stocks:'stock-quotes',crypto:'crypto-quotes',options:'option-chain',prediction:'prediction-radar' })[row.market]], ['事件研究','decision-intelligence'], ['决策日记','decision-intelligence']];
    overlay.innerHTML = `<button type="button" data-close aria-label="关闭详情">关闭</button><h3>${esc(row.title)}</h3><p>${esc(row.summary || row.reason || '')}</p><dl><dt>标的 / 市场</dt><dd>${esc(row.instrument || '当前市场')} · ${esc(markets[row.market])}</dd><dt>来源 / 状态</dt><dd>${esc(row.source)} · ${esc(window.MoneyMoneyWorkflow?.status(row.dataStatus) || row.dataStatus)}</dd><dt>发生 / 发布时间</dt><dd>${esc(row.occurredAt || '未知')} / ${esc(row.publishedAt || '未知')}</dd><dt>抓取时间</dt><dd>${esc(row.observedAt)}</dd><dt>原因</dt><dd>${esc(row.reason || '无')}</dd></dl><nav>${links.map(([label,workspace]) => `<a href="${esc(link(row,workspace))}">${label}</a>`).join(' ')}${row.sourceUrl ? ` <a href="${esc(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">原文</a>` : ''}</nav><h4>证据引用</h4>${row.evidenceRefs.length ? row.evidenceRefs.map(id => `<a href="/api/evidence/${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>`).join('<br>') : '<p>此记录尚无独立证据快照</p>'}`;
    const evidenceLinks = [...overlay.querySelectorAll('h4 ~ a')];
    evidenceLinks.forEach((anchor,index) => { const ref = row.evidenceRefs[index]; if (/^https?:\/\//i.test(ref)) anchor.href = ref; });
    for (const anchor of overlay.querySelectorAll('nav a')) {
      if (!['事件研究','决策日记'].includes(anchor.textContent)) continue;
      anchor.onclick = async event => {
        event.preventDefault();
        try {
          if (!row.instrument) throw new Error('此记录没有明确标的，无法建立事件研究或日记');
          if (anchor.textContent === '事件研究' && (!row.publishedAt || Date.parse(row.publishedAt) > Date.now() || row.occurredAt && Date.parse(row.occurredAt) > Date.now())) throw new Error('事件尚未发生或缺少发布时间，只可建立决策草稿');
          let refs = row.evidenceRefs.filter(id => !/^https?:/i.test(id));
          if (!refs.length) {
            const result = await api('/api/evidence',{ method:'POST',body:JSON.stringify({ market:row.market,instrument:row.instrument,workspace:'event-intelligence',dataStatus:row.dataStatus,source:{ id:'action-center:'+row.market,name:row.source,url:row.sourceUrl || null },observedAt:row.publishedAt || row.observedAt,fetchedAt:row.observedAt,fields:{ title:row.title,kind:row.kind,publishedAt:row.publishedAt || null,occurredAt:row.occurredAt || null,sourceUrl:row.sourceUrl || null } }) });
            refs = [result.data.id];
          }
          window.setMarketScope(row.market); window.setWorkspaceInstrument(row.instrument); window.openWorkspace('decision-intelligence');
          window.mm_decisionEvidenceIds = [...new Set([...(window.mm_decisionEvidenceIds || []),...refs])];
          if (anchor.textContent === '决策日记') { const field = document.getElementById('decision-thesis'); if (field) { field.value = `围绕「${row.title}」的研究假设：`; field.focus(); } }
          else { const at = new Date(Math.max(Date.parse(row.publishedAt),Date.parse(row.occurredAt || row.publishedAt))); const field = document.getElementById('event-study-at'); if (field) field.value = new Date(at.getTime()-at.getTimezoneOffset()*60000).toISOString().slice(0,16); const title = document.getElementById('event-study-title'); if (title) title.value = row.title; window.mm_selectedStudyEventId = row.eventId || null; window.mm_selectedStudyEventEvidenceId = refs[0]; }
          overlay.close();
        } catch (error) { let notice=overlay.querySelector('[data-error]'); if (!notice) { notice=document.createElement('p');notice.dataset.error='true';overlay.append(notice); } notice.textContent=error.message; }
      };
    }
    overlay.querySelector('[data-close]').onclick = () => overlay.close();
    const navigation=document.createElement('nav'),index=group.findIndex(item=>item.id===row.id);navigation.innerHTML='<button type="button" data-detail-previous>上一条</button><span>'+String(index+1)+' / '+group.length+'</span><button type="button" data-detail-next>下一条</button>';overlay.prepend(navigation);for(const [direction,offset] of [['previous',-1],['next',1]]){const button=navigation.querySelector('[data-detail-'+direction+']');button.disabled=!group[index+offset];button.onclick=()=>{overlay.close();drawer(group[index+offset],group);};}overlay.addEventListener('keydown',event=>{if(event.target?.matches('input,textarea,select'))return;if(event.key==='ArrowLeft')navigation.querySelector('[data-detail-previous]').click();if(event.key==='ArrowRight')navigation.querySelector('[data-detail-next]').click();});
    const chartLink=[...overlay.querySelectorAll('a')].find(anchor=>anchor.textContent==='图表');if(chartLink && row.market==='stocks')chartLink.onclick=async event=>{event.preventDefault();const at=row.occurredAt || row.publishedAt;if(at){overlay.close();await window.MoneyMoneyWorkflow.locate(at,row.instrument);}else window.showToast?.('记录没有确定日期，不能猜测图表位置','info');};
    overlay.addEventListener('close', () => overlay.remove(), { once:true }); document.body.append(overlay); overlay.showModal();
  }
  function render() {
    const host = document.getElementById('mm-action-list'); if (!host) return;
    const meta = {};
    for (const row of records) {
      if (!row.instrument) continue;
      const item = meta[row.instrument] || { pending:0,upcoming:Infinity,status:0 };
      if (!row.read && !row.snoozed) item.pending++;
      if (row.section === 'upcoming') item.upcoming=Math.min(item.upcoming,Date.parse(row.occurredAt || row.publishedAt));
      item.status=Math.max(item.status,({ failed:4,unavailable:4,partial:3,cached:2,delayed:1 })[row.dataStatus] || 0);
      meta[row.instrument]=item;
    }
    window.mmActionSortMeta=meta;
    window.dispatchEvent(new Event('mm-action-items-updated'));
    const section = document.getElementById('mm-action-section').value, market = document.getElementById('mm-action-market').value;
    pref.section = section; pref.market = market; try { localStorage.setItem('mm-action-filter-v1', JSON.stringify(pref)); } catch {}
    const filter=document.getElementById('mm-action-state')?.value || 'all';
    const rows = records.filter(row => (!section || row.section === section) && (!market || row.market === market) && (!row.snoozed || document.getElementById('mm-action-snoozed').checked) && (filter==='all' || filter==='unread' && !row.read || filter==='pinned' && row.pinned));
    const previousScroll = host.scrollTop;
    host.innerHTML = rows.length ? rows.map(row => `<article class="mm-action-row ${row.read ? 'is-read' : ''}" data-id="${esc(row.id)}"><button type="button" data-detail><strong>${row.pinned ? '📌 ' : ''}${esc(row.title)}</strong><small>${esc(markets[row.market])} · ${esc(row.instrument || '市场记录')} · ${esc(window.MoneyMoneyWorkflow?.status(row.dataStatus) || row.dataStatus)} · ${esc(row.observedAt)}</small><span>${esc(row.summary || row.reason || '')}</span></button><div><button data-read>${row.read ? '标未读' : '已读'}</button><button data-pin>${row.pinned ? '取消置顶' : '置顶'}</button><button data-snooze>${row.snoozed ? '恢复处理' : '稍后一天'}</button></div></article>`).join('') : '<p class="empty-tip">当前筛选暂无可处理记录。来源失败会单独显示，不表示没有事件。</p>';
    host.scrollTop = previousScroll;
    for (const article of host.querySelectorAll('article')) {
      const row = records.find(row => row.id === article.dataset.id);
      article.querySelector('[data-detail]').onclick = () => drawer(row,rows);
      const update = async change => { try { const result = await api('/api/watchlist/action-center/' + encodeURIComponent(row.id), { method:'PATCH', body:JSON.stringify(change) }); Object.assign(row,result.data); row.snoozed = Boolean(row.snoozedUntil && Date.parse(row.snoozedUntil) > Date.now()); render(); } catch (error) { article.querySelector('small').textContent = error.message; } };
      article.querySelector('[data-read]').onclick = () => update({ read:!row.read });
      article.querySelector('[data-pin]').onclick = () => update({ pinned:!row.pinned });
      article.querySelector('[data-snooze]').onclick = () => update({ snoozedUntil:row.snoozed ? null : new Date(Date.now() + 86400_000).toISOString() });
    }
  }
  async function loadActions() {
    controller?.abort(); controller = new AbortController(); const signal = controller.signal;
    const status = document.getElementById('mm-action-status'); status.textContent = '正在读取自选来源与处理记录…';
    try { const market=context().market;const result = await api('/api/watchlist/action-center'+(markets[market] ? '?market='+market:''), { signal }); if (signal.aborted) return; records = result.items; status.textContent = `${result.counts.unread} 项待处理 · ${window.MoneyMoneyWorkflow?.status(result.dataStatus) || result.dataStatus} · ${result.updatedAt}${result.reason ? ' · ' + result.reason : ''}`; render(); }
    catch (error) { if (error.name !== 'AbortError') status.textContent = error.message; }
  }
  function drawCurves(host, series) {
    window.MoneyMoneyHistoryChart.render(host,series.map(row=>({...row,points:row.values.map((value,i)=>({date:row.dates?.[i] || String(i+1).padStart(6,'0')+' 根',value}))})),{title:series[0]?.label || '历史比较',onLocate:series.length===1 && series[0].dates && /^stock:us:[A-Z0-9.-]+$/.test(series[0].instrument || '') ? date=>window.MoneyMoneyWorkflow.locate(date,series[0].instrument):undefined});
  }
  function install() {
    const parent = document.getElementById('center-workspace'); if (!parent || document.getElementById('mm-action-center')) return;
    document.querySelectorAll('#research-tab > :not([data-workspace-id]):not([data-workspace-ids])').forEach(node=>{node.dataset.workspaceId='decision-intelligence';});
    const section = document.createElement('section'); section.id = 'mm-action-center'; section.className = 'mm-action-center';
    section.dataset.workspaceIds='watchlist action-center';section.hidden=true;
    section.innerHTML = `<h3>自选行动与研究中心</h3><p>私人处理状态与证据 · 不执行真实交易</p><div class="mm-action-tools"><button id="mm-action-refresh">加载 / 刷新行动</button><select id="mm-action-market" aria-label="行动市场"><option value="">全部市场</option>${Object.entries(markets).map(([id,name]) => `<option value="${id}">${name}</option>`).join('')}</select><select id="mm-action-section" aria-label="行动类别"><option value="">全部类别</option>${Object.entries(kinds).map(([id,name]) => `<option value="${id}">${name}</option>`).join('')}</select><label><input type="checkbox" id="mm-action-snoozed">显示稍后处理</label></div><p id="mm-action-status" role="status">点击加载，读取真实自选记录。</p><div id="mm-action-list" aria-live="polite"></div><details><summary>研究实验并排比较</summary><label>市场 <select id="mm-experiment-market">${Object.entries(markets).map(([id,name]) => `<option value="${id}">${name}</option>`).join('')}</select></label><button id="mm-experiment-load">读取实验</button><div id="mm-experiment-options"></div><button id="mm-experiment-compare">比较选中实验（2–6个）</button><div id="mm-experiment-result" role="status"></div></details><details><summary>真实历史与快照比较</summary><label>市场 <select id="mm-history-market"><option value="options">期权</option><option value="crypto">虚拟币</option><option value="prediction">预测市场</option></select></label><label>规范标的 ID <input id="mm-history-id" placeholder="option:cboe:AAPL"></label><p>Binance 现货与 Gate.io 永续分开归档；预测市场用当前官方事件 ID，不猜测。</p><button id="mm-history-load">读取历史</button><button id="mm-history-capture">保存当前真实快照</button><div id="mm-history-result" role="status"></div></details>`;
    parent.append(section);
    section.querySelector('h3').textContent='自选行动';
    section.querySelector('.mm-action-tools').insertAdjacentHTML('beforeend','<select id="mm-action-state" aria-label="处理状态"><option value="all">全部状态</option><option value="unread">待处理</option><option value="pinned">已置顶</option></select>');
    document.getElementById('mm-action-state').onchange=render;
    const lab=document.createElement('section');lab.id='mm-research-lab';lab.className='mm-action-center';lab.dataset.workspaceId='research-lab';lab.hidden=true;
    lab.innerHTML='<h3>研究实验室</h3><p data-research-context></p><nav class="mm-research-tabs" role="tablist" aria-label="研究内容"><button role="tab" data-research-tab="history">历史快照</button><button role="tab" data-research-tab="experiments">实验比较</button><button role="tab" data-research-tab="comparison">标的比较</button><button role="tab" data-research-tab="forward">前向观察</button></nav>';
    const panels=[...section.querySelectorAll('details')];
    for(const [i,node] of panels.entries()){node.dataset.researchPanel=i===0 ? 'experiments':'history';node.id='mm-research-'+node.dataset.researchPanel;node.setAttribute('role','tabpanel');lab.append(node);}
    lab.querySelector('#mm-experiment-load').insertAdjacentHTML('beforebegin','<label><input type="checkbox" id="mm-experiment-all">包含同市场其他标的</label>');
    const comparison=document.createElement('section');comparison.dataset.researchPanel='comparison';comparison.id='mm-research-comparison';comparison.setAttribute('role','tabpanel');
    comparison.innerHTML='<p>从当前市场自选选择 2–6 个标的，使用已发布日线按同日归一化比较。</p><button data-comparison-load>读取当前市场自选</button><div data-comparison-options></div><button data-comparison-run>比较收益曲线</button><div data-comparison-result role="status"></div>';
    lab.append(comparison);parent.append(lab);
    const selectTab=tab=>{for(const button of lab.querySelectorAll('[data-research-tab]')){const selected=button.dataset.researchTab===tab;button.classList.toggle('active',selected);button.setAttribute('aria-selected',String(selected));button.setAttribute('tabindex',selected?'0':'-1');button.setAttribute('aria-controls','mm-research-'+button.dataset.researchTab);}for(const panel of lab.querySelectorAll('[data-research-panel]')){panel.hidden=panel.dataset.researchPanel!==tab;if(panel.tagName==='DETAILS')panel.open=true;}try{localStorage.setItem('mm-research-tab-v1',tab);}catch{}};
    lab.querySelectorAll('[data-research-tab]').forEach((button,index,buttons)=>{button.onclick=()=>selectTab(button.dataset.researchTab);button.onkeydown=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=buttons[(index+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length];next.click();next.focus();}};});
    const forward = document.createElement('details');
    forward.innerHTML = `<summary>信号前向观察</summary><label>市场 <select data-forward-market>${Object.entries(markets).map(([id,name]) => `<option value="${id}">${name}</option>`).join('')}</select></label><button data-forward-load>读取已完成K线观察</button><div data-forward-result role="status"></div>`;
    forward.dataset.researchPanel='forward';forward.id='mm-research-forward';forward.setAttribute('role','tabpanel');lab.append(forward);
    let initial='history';try{initial=localStorage.getItem('mm-research-tab-v1') || initial;}catch{}selectTab(['history','experiments','comparison','forward'].includes(initial)?initial:'history');
    comparison.querySelector('[data-comparison-load]').onclick=async()=>{const host=comparison.querySelector('[data-comparison-options]');try{const market=context().market;if(!markets[market]) throw new Error('请先选择股票、期权、虚拟币或预测市场');const result=await api('/api/workspace/watchlist?scope='+market+'&group=watchlist');host.innerHTML=(result.groups || []).flatMap(group=>group.items).map(row=>`<label><input type="checkbox" value="${esc(row.instrumentId)}">${esc(row.title)}</label>`).join('') || '<p>当前市场暂无自选，请在右侧添加。</p>';}catch(error){host.textContent=error.message;}};
    comparison.querySelector('[data-comparison-run]').onclick=async()=>{const host=comparison.querySelector('[data-comparison-result]');host.setAttribute('aria-busy','true');try{const ids=[...comparison.querySelectorAll('input:checked')].map(input=>input.value);if(ids.length<2 || ids.length>6)throw new Error('请选择 2–6 个同市场标的');const result=await api('/api/research/price-comparison?'+new URLSearchParams({market:context().market,instruments:ids.join(',')}));host.innerHTML='<p>'+esc(result.reason || '')+'</p><div data-plot></div>'+result.data.series.map(row=>'<p>'+esc(row.instrument+' · '+(row.source || '来源不可用')+' · '+(row.updatedAt || '时间未知')+' · '+(row.reason || row.dataStatus))+'</p>').join('');window.MoneyMoneyHistoryChart.render(host.querySelector('[data-plot]'),result.data.series,{title:'同日起点收益比较',unit:'%',reason:result.reason,onLocate:date=>window.MoneyMoneyWorkflow.locate(date,context().instrument)});window.MoneyMoneyWorkflow.historyTools(host,result.data,()=>comparison.querySelector('[data-comparison-run]').click());}catch(error){host.textContent=error.message;}finally{host.removeAttribute('aria-busy');}};
    forward.querySelector('[data-forward-load]').onclick = async () => {
      const host = forward.querySelector('[data-forward-result]'); host.textContent = '正在读取已发布历史分区…';
      try { const result = await api('/api/signals/forward?market='+forward.querySelector('select').value); host.innerHTML = result.data.length ? result.data.map(row => `<article><h4>${esc(row.strategyId || row.id)} / ${esc(row.strategyVersion || '未关联')} · ${esc(row.timeframe || '')} · ${esc(row.source || '')}</h4><p>${esc(row.instrument)} · MFE ${esc(row.mfePct ?? '不可用')}% · MAE ${esc(row.maePct ?? '不可用')}% · ${esc(row.warning || row.reason || '')}</p><div data-forward-curve="${esc(row.id)}"></div><p>${esc(row.historyReason || '')}</p>${row.experimentId ? `<a href="/api/research/experiments/${encodeURIComponent(row.experimentId)}" target="_blank" rel="noopener noreferrer">关联实验</a>` : '<p>实验未关联</p>'}</article>`).join('') : esc(result.reason); for (const row of result.data) { const target=[...host.querySelectorAll('[data-forward-curve]')].find(node=>node.dataset.forwardCurve===row.id); if (target && row.points.length) drawCurves(target,[{ instrument:row.instrument,label:row.instrument+'（仅已完成K线）',dates:row.points.map(point=>point.at),values:row.points.map(point=>point.returnPct) }]); } } catch (error) { host.textContent=error.message; }
    };
    document.getElementById('mm-action-market').value = pref.market || ''; document.getElementById('mm-action-section').value = pref.section || '';
    document.getElementById('mm-action-refresh').onclick = loadActions;
    for (const id of ['mm-action-market','mm-action-section','mm-action-snoozed']) document.getElementById(id).onchange = render;
    document.getElementById('mm-experiment-load').onclick = async () => {
      const host = document.getElementById('mm-experiment-options'); host.textContent = '正在读取…';
      try { const result = await api('/api/research/experiments?market=' + document.getElementById('mm-experiment-market').value + (!document.getElementById('mm-experiment-all').checked && context().instrument ? '&instrument='+encodeURIComponent(context().instrument):'')); host.innerHTML = result.data.length ? result.data.map(row => `<label><input type="checkbox" value="${esc(row.id)}">${esc(row.strategyId || '未命名策略')} · ${esc(row.instrument)} · ${esc(row.createdAt)} · ${esc(row.id)}</label>`).join('<br>') : esc(result.reason); } catch (error) { host.textContent = error.message; }
    };
    document.getElementById('mm-experiment-compare').onclick = async () => {
      const host = document.getElementById('mm-experiment-result'), ids = [...document.querySelectorAll('#mm-experiment-options input:checked')].map(input => input.value);
      try { const result = await api('/api/research/experiments/compare?ids=' + encodeURIComponent(ids.join(','))); host.innerHTML = `<p>${esc(result.data.warnings.join('；') || result.reason)}</p><h4>资金曲线</h4><div data-curves></div><h4>回撤（%）</h4><div data-drawdowns></div><table><thead><tr><th>实验</th><th>收益</th><th>样本外</th><th>成本</th><th>数据区间</th></tr></thead><tbody>${result.data.experiments.map(row => `<tr><td>${esc(row.id)}</td><td>${esc(row.metrics.totalReturnPct)}%</td><td>${esc(row.outOfSample.totalReturnPct)}%</td><td>费率 ${esc(row.feeRate)} / 滑点 ${esc(row.slippage)}<br>实际费用 ${esc(row.totalFees ?? '不可用')} / 滑点成本 ${esc(row.totalSlippage ?? '不可用')}<br>成交 ${esc(row.trades.length)} 笔</td><td>${esc(row.dataFrom)}—${esc(row.dataTo)}<br>${esc(row.freshness?.reason || row.freshnessReason)}</td></tr>`).join('')}</tbody></table><p>配置差异：${esc(result.data.differences.map(row => row.field).join('、') || '无')}</p>`; window.MoneyMoneyWorkflow.experimentDetails(host,result.data,api); drawCurves(host.querySelector('[data-curves]'), result.data.experiments.map(row => ({ label:row.id,values:row.equityCurve }))); drawCurves(host.querySelector('[data-drawdowns]'), result.data.experiments.map(row => ({ label:row.id,values:row.drawdownCurve }))); } catch (error) { host.textContent = error.message; }
    };
    const history = async capture => {
      const market = document.getElementById('mm-history-market').value, instrument = document.getElementById('mm-history-id').value.trim(), host = document.getElementById('mm-history-result'); host.textContent = '正在读取实际来源…';
      try {
        if (!instrument) throw new Error('请先从右侧标的库或下方搜索结果选择标的');
        if (market === 'stocks') {
          if (capture) throw new Error('股票日线由现有数据采集流程归档；此处不伪造当前历史快照');
          const result=await api('/api/research/price-comparison?'+new URLSearchParams({market,instruments:instrument+','+(instrument==='stock:us:SPY'?'stock:us:QQQ':'stock:us:SPY')}));
          host.innerHTML='<p>'+esc(result.reason || '当前标的与 SPY 的本地同日历史，不请求付费源')+'</p><div data-plot></div>'+result.data.series.map(row=>'<p>'+esc(row.instrument+' · '+(row.source || '来源不可用')+' · '+(row.updatedAt || '时间未知')+' · '+(row.reason || row.dataStatus))+'</p>').join('');
          window.MoneyMoneyHistoryChart.render(host.querySelector('[data-plot]'),result.data.series,{title:'日线历史比较',unit:'%',reason:result.reason,onLocate:date=>window.MoneyMoneyWorkflow.locate(date,instrument)});window.MoneyMoneyWorkflow.historyTools(host,result.data,()=>history(false));return;
        }
        if (capture) await api(market === 'options' ? '/api/options/history/save' : '/api/market-history/capture', { method:'POST', body:JSON.stringify({ market,instrument }) });
        const result = await api(market === 'options' ? '/api/options/history/compare?instrument=' + encodeURIComponent(instrument) : '/api/market-history?' + new URLSearchParams({ market,instrument }));
        if (market === 'options') {
          host.innerHTML = `<p>${esc(result.reason || '相邻同源、同合约快照')} · ${esc(result.source)}</p><div class="mm-history-coverage">${result.data.coverage.map(row => `<span title="${esc(row.source)}">${esc(row.at.slice(0,10))}</span>`).join(' ')}</div>${result.data.changes.map(change => `<h4>${esc(change.fromAt)} → ${esc(change.toAt)}</h4><table><thead><tr><th>合约</th><th>报价变化</th><th>IV变化</th><th>成交量变化</th><th>OI变化</th></tr></thead><tbody>${change.contracts.map(row => `<tr><td>${esc(row.contract)}</td>${['bidPrice','impliedVolPct','volume','openInterest'].map(field => `<td>${esc(row.fields[field].delta ?? row.fields[field].reason)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')}`;
        } else {
          const series = result.series, fields = market === 'prediction' ? ['probability','liquidity'] : ['fundingRatePct','openInterestUsd','bidDepthUsd','askDepthUsd','spreadPct'];
          host.innerHTML = `<p>${esc(result.reason || '同交易场所、同来源快照；不推算缺失历史')} · ${esc(result.source)}</p><div data-curves></div><table><thead><tr><th>时间 / 来源</th>${fields.map(field => `<th>${field}</th>`).join('')}</tr></thead><tbody>${series.map(row => `<tr><td>${esc(row.observedAt)}<br>${esc(row.source.name)}</td>${fields.map(field => `<td>${esc(row.fields[field] ?? '字段不可用')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
          // Different units/sources are never overlaid as a misleading single series.
          for (const field of fields) for (const source of [...new Set(series.map(row => row.source.id))]) {
            const points = series.filter(row => row.source.id === source); if (!points.some(row=>Number.isFinite(row.fields[field]))) continue;
            const curve = document.createElement('div'); host.querySelector('[data-curves]').append(curve); drawCurves(curve,[{ label:field + ' · ' + source, dates:points.map(row=>row.observedAt),values:points.map(row => typeof row.fields[field]==='number' ? row.fields[field]:null) }]);
          }
        }
      } catch (error) { host.textContent = error.message; }
    };
    document.getElementById('mm-history-load').onclick = () => history(false); document.getElementById('mm-history-capture').onclick = () => history(true);
    const marketSelect=document.getElementById('mm-history-market');marketSelect.insertAdjacentHTML('afterbegin','<option value="stocks">股票</option>');
    const idInput=document.getElementById('mm-history-id');idInput.type='hidden';idInput.closest('label').firstChild.textContent='选中标的 ';
    const picker=document.createElement('div');picker.className='mm-instrument-picker';picker.innerHTML='<strong data-selected-instrument>请从右侧选择标的</strong><label>搜索当前市场 <input type="search" data-history-search placeholder="输入代码或名称"></label><div data-history-candidates></div>';
    idInput.after(picker);
    let searchTimer,searchController;
    picker.querySelector('input').oninput=event=>{clearTimeout(searchTimer);searchController?.abort();const query=event.target.value.trim();const target=picker.querySelector('[data-history-candidates]');target.replaceChildren();if(!query)return;searchTimer=setTimeout(async()=>{searchController=new AbortController();const captured=context();try{const result=await api('/api/instruments/search?'+new URLSearchParams({scope:captured.market,q:query}),{signal:searchController.signal});if(context().market!==captured.market)return;const items=result.data?.items || result.items || result.data || [];target.innerHTML=Array.isArray(items)?items.filter(row=>row.instrumentId || row.id).map(row=>'<button type="button" data-instrument="'+esc(row.instrumentId || row.id)+'">'+esc(row.title || row.name || row.symbol || row.instrumentId || row.id)+'</button>').join(''):'暂无结果';target.querySelectorAll('button').forEach(button=>button.onclick=()=>{window.setWorkspaceInstrument(button.dataset.instrument);target.replaceChildren();});}catch(error){if(error.name!=='AbortError')target.textContent=error.message;}},300);};
    marketSelect.onchange=()=>window.setMarketScope(marketSelect.value);
    document.getElementById('mm-experiment-market').onchange=()=>window.setMarketScope(document.getElementById('mm-experiment-market').value);
    forward.querySelector('select').onchange=()=>window.setMarketScope(forward.querySelector('select').value);
  }
  function initialize() {
    install(); const shell = document.getElementById('market-workspace-shell');
    const sync=()=>{
      const current=context(),key=JSON.stringify(current),privateAccess=window.mm_isGuest!==true && window.mm_isLoggedIn===true;
      if(key!==lastContext){controller?.abort();lifecycleController.abort();lifecycleController=new AbortController();lastContext=key;
        if(current.market!==lastScope){records=[];lastScope=current.market;for(const id of ['mm-action-list','mm-experiment-options','mm-experiment-result','mm-history-result'])document.getElementById(id)?.replaceChildren();document.querySelector('[data-comparison-options]')?.replaceChildren();document.querySelector('[data-comparison-result]')?.replaceChildren();}
        const lab=document.getElementById('mm-research-lab');lab.querySelector('[data-research-context]').textContent=(markets[current.market] || '请选择独立市场')+' / '+(current.instrument || '尚未选择标的');
        for(const id of ['mm-history-market','mm-experiment-market'])if(markets[current.market])document.getElementById(id).value=current.market;
        if(markets[current.market])document.querySelector('[data-forward-market]').value=current.market;
        const input=document.getElementById('mm-history-id');if(input.value!==current.instrument)document.getElementById('mm-history-result').replaceChildren();input.value=current.instrument;
        document.querySelector('[data-selected-instrument]').textContent=current.instrument || '请从右侧选择标的';
        document.getElementById('mm-action-market').value=markets[current.market]?current.market:'';
      }
      document.getElementById('mm-action-center').hidden=!privateAccess || !['watchlist','action-center'].includes(current.workspace);
      document.getElementById('mm-research-lab').hidden=!privateAccess || current.workspace!=='research-lab';
    };
    if (shell) new MutationObserver(sync).observe(shell,{ attributes:true,attributeFilter:['data-market-scope','data-workspace','data-instrument'] });
    window.addEventListener('mm-workspace-context',sync);sync();
    let attempts = 0;
    const authCheck = setInterval(() => { sync(); if (window.mm_isLoggedIn === true || ++attempts > 20) clearInterval(authCheck); },500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialize,{ once:true }); else initialize();
})();
