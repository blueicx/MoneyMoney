(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const metric = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '不可用';
  function renderTailRisk(host, risk) {
    if (!host || !risk) return;
    const section = document.createElement('section');
    section.className = 'mm-action-center';
    section.dataset.tailRisk = 'true';
    section.innerHTML = '<h4>历史尾部风险 · 当前仓位权重</h4><p>' + esc(risk.disclaimer) + '</p>' +
      (risk.dataStatus !== 'historical' ? '<p class="empty-tip">' + esc(risk.reason) + '</p>' :
        '<dl><dt>一天 VaR ' + metric(risk.confidence * 100) + '%</dt><dd>' + metric(risk.varPct) + '% / ' + metric(risk.varAmount) + ' ' + esc(risk.currency) + '</dd>' +
        '<dt>Expected Shortfall / CVaR</dt><dd>' + metric(risk.expectedShortfallPct) + '% / ' + metric(risk.expectedShortfallAmount) + ' ' + esc(risk.currency) + '</dd></dl>' +
        '<p>区间 ' + esc(risk.windowStart) + ' — ' + esc(risk.windowEnd) + ' · ' + risk.samples + ' 个共同完成日 · 尾部有效样本 ' + metric(risk.tailSamples) + '</p>' +
        '<p>最近 60 日 ES：' + metric(risk.windows?.recent?.expectedShortfallPct) + '% · 前 60 日 ES：' + metric(risk.windows?.previous?.expectedShortfallPct) + '%</p>' +
        '<details><summary>日期对齐协方差矩阵（简单日收益，非年化）</summary><div class="mm-table-scroll"><table class="workspace-watchlist-table"><thead><tr><th>标的</th>' + risk.instruments.map(id => '<th>' + esc(id) + '</th>').join('') + '</tr></thead><tbody>' +
        risk.covariance.map((values, i) => '<tr><th>' + esc(risk.instruments[i]) + '</th>' + values.map(value => '<td>' + Number(value).toExponential(3) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></details>') +
      '<p role="note">' + (risk.warnings || []).map(esc).join(' ') + '</p><p>来源：' + esc(risk.source || '调用者提供的研究序列，未核验数据来源') + '；数据时点 ' + esc(risk.asOf) + '。不自动创建订单。</p><p>证据引用：' + (risk.evidenceRefs || []).map(esc).join('、') + '</p>';
    host.append(section);
  }
  window.MoneyMoneyProfessionalResearch = { renderTailRisk };

  // No polling or upstream work: only a visible, private stock-fundamentals workspace can query/index.
  let controller = new AbortController(), contextKey = '';
  function context() {
    const shell = document.getElementById('market-workspace-shell');
    return {market:shell?.dataset.marketScope,workspace:shell?.dataset.workspace,instrument:shell?.dataset.instrument || ''};
  }
  function syncFilingPanel() {
    const current = context(), parent = document.querySelector('[data-workspace-id="fundamentals"] .collapse-body');
    let panel = document.getElementById('financial-text-research');
    const key = [current.market,current.workspace,current.instrument,window.mm_isGuest,window.mm_isLoggedIn].join('|');
    if (key === contextKey) return;
    contextKey = key; controller.abort(); controller = new AbortController();
    if (current.market !== 'stocks' || current.workspace !== 'fundamentals' || !window.mm_isLoggedIn || window.mm_isGuest) { if(panel)panel.hidden=true;return; }
    if (!parent) return;
    if (!panel) {panel=document.createElement('section');panel.id='financial-text-research';panel.className='mm-action-center';parent.append(panel);}
    panel.hidden=false;
    const instrument = /^stock:us:[A-Z][A-Z0-9.-]{0,14}$/.test(current.instrument) ? current.instrument : /^us[A-Z][A-Z0-9.-]{0,14}$/.test(current.instrument) ? 'stock:us:' + current.instrument.slice(2).replace(/\.(OQ|N)$/, '') : null;
    panel.innerHTML='<h3>SEC 财报原文检索</h3><p>仅当前股票。先手动索引官方 10-K/10-Q，再按关键词搜索本地段落；不会自动调用 AI 或生成订单。</p>' +
      '<p data-filing-context></p><div data-filing-controls><button type="button" data-filing-index>索引最新官方财报</button> <button type="button" data-filing-list>查看已索引文件</button><form data-filing-search><label>关键词 <input name="query" maxlength="200" required placeholder="如 tariffs / liquidity"></label><label>已发布时间截止 <input name="asOf" type="date"></label><button type="submit">检索原文段落</button></form></div><p data-filing-status role="status"></p><div data-filing-results></div>';
    panel.querySelector('[data-filing-context]').textContent=instrument || '当前标的未绑定可核验的美国股票身份，检索不可用。';
    panel.querySelector('[data-filing-controls]').hidden=!instrument;
    if (!instrument) return;
    const signal=controller.signal, status=panel.querySelector('[data-filing-status]'), results=panel.querySelector('[data-filing-results]');
    async function request(url, options={}) {
      const token=document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('mm_csrf='));
      const response=await fetch(url,{...options,signal,credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(token?{'x-csrf-token':decodeURIComponent(token.slice(8))}:{}),...options.headers}});
      const body=await response.json();signal.throwIfAborted();
      if (!response.ok || body.success===false) throw new Error(body.reason || '请求失败 '+response.status);
      return body;
    }
    function errorMessage(error) { if(error.name!=='AbortError')status.textContent=error.message; }
    panel.querySelector('[data-filing-index]').onclick=async event=>{
      event.target.disabled=true;status.textContent='正在核验 SEC 目录与原文（最多 4MB，不自动重试）…';
      try { const body=await request('/api/research/filings/index',{method:'POST',body:JSON.stringify({instrument})});status.textContent=body.data.form+' '+body.data.accession+' 已索引 '+body.data.paragraphs+' 段；来源 SEC EDGAR，发布 '+body.data.publishedAt; }
      catch(error){errorMessage(error);}finally{event.target.disabled=false;}
    };
    panel.querySelector('[data-filing-list]').onclick=async()=>{
      status.textContent='正在读取本地索引…';
      try { const body=await request('/api/research/filings?'+new URLSearchParams({instrument}));status.textContent=body.reason || '已索引 '+body.data.length+' 份官方文件';results.innerHTML=body.data.map(row=>'<article><strong>'+esc(row.form)+' · '+esc(row.accession)+'</strong><p>发布 '+esc(row.publishedAt)+' · 抓取 '+esc(row.retrievedAt)+'</p><p>内容 Hash '+esc(row.contentHash)+'</p><a target="_blank" rel="noopener noreferrer" href="'+esc(row.sourceUrl)+'">SEC 原文 ↗</a></article>').join(''); }
      catch(error){errorMessage(error);}
    };
    panel.querySelector('[data-filing-search]').onsubmit=async event=>{
      event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;status.textContent='正在检索本地原文…';
      const values=new FormData(event.target), query=new URLSearchParams({instrument,q:String(values.get('query') || '')}), day=values.get('asOf');
      if(day)query.set('asOf',day+'T23:59:59.999Z');
      try {const body=await request('/api/research/filings/search?'+query);status.textContent=body.reason || '命中 '+body.data.length+' 个段落；历史原文，不是投资建议。';results.innerHTML=body.data.map(row=>'<article><strong>'+esc(row.form)+' · 原文段落 '+row.paragraph+'</strong><blockquote>'+esc(row.text)+'</blockquote><p>发布 '+esc(row.publishedAt)+' · 抓取 '+esc(row.retrievedAt)+' · '+esc(row.publicationPrecision)+'</p><p>引用 '+esc(row.documentId)+':'+esc(row.contentHash)+':'+row.paragraph+'；HTML 无可靠页码。</p><a target="_blank" rel="noopener noreferrer" href="'+esc(row.sourceUrl)+'">核对 SEC 原文 ↗</a></article>').join('');}
      catch(error){errorMessage(error);}finally{button.disabled=false;}
    };
  }
  function init() {
    const shell=document.getElementById('market-workspace-shell');
    if(shell)new MutationObserver(syncFilingPanel).observe(shell,{attributes:true,attributeFilter:['data-market-scope','data-workspace','data-instrument']});
    window.addEventListener('mm-workspace-context',syncFilingPanel);
    let attempts=0;const timer=setInterval(()=>{syncFilingPanel();if(window.mm_isLoggedIn || ++attempts>=20)clearInterval(timer);},500);
    syncFilingPanel();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
