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
  let committeeController=new AbortController();
  function renderCommittee(host,items) {
    committeeController.abort();committeeController=new AbortController();
    if(!host || window.mm_isGuest || !window.mm_isLoggedIn)return;
    const current=context(),instrument=window.decisionScopeInstrument?.() || current.instrument;
    if(current.workspace!=='decision-intelligence' || !instrument)return;
    const section=document.createElement('section');section.className='mm-action-center';section.dataset.committee='true';
    const evidence=(items || []).filter(row=>row.persisted===true && row.market===current.market && row.instrument===instrument).slice(0,8);
    section.innerHTML='<h4>多空 / 风控研究审议</h4><p>只读、最多 3 次免费模型调用；UTC 日上限 24 次，与跑单额度分开。不会改变策略或创建订单。请选择当前标的证据。</p><div data-committee-evidence>'+evidence.map(row=>'<label><input type="checkbox" value="'+esc(row.id)+'"> '+esc(row.source?.name)+' · '+esc(row.dataStatus)+' · '+esc(row.observedAt)+'</label>').join('<br>')+'</div><p><button type="button" data-committee-run>手动审议所选证据</button> <button type="button" data-committee-history>查看审议历史</button></p><p role="status" data-committee-status></p><div data-committee-results></div>';
    host.append(section);const status=section.querySelector('[data-committee-status]'),results=section.querySelector('[data-committee-results]'),signal=committeeController.signal;
    if(!evidence.length)status.textContent='当前标的没有已存档证据。请先保存真实来源快照；不会生成替代数据。';
    const draw=rows=>{results.innerHTML=rows.map(row=>'<article><h5>'+esc(row.status)+' · '+esc(row.createdAt)+'</h5><p>'+esc(row.reason)+'</p><p>输入 Hash '+esc(row.inputHash)+' · 实际调用 '+esc(row.calls)+'</p>'+row.reviews.map(review=>'<details open><summary>'+esc({bull:'多头',bear:'空头',risk:'风控'}[review.role])+' · '+esc(review.stance)+'</summary><p>'+esc(review.summary)+'</p><p>反证 / 风险：'+review.risks.map(esc).join('；')+'</p><p>引用：'+review.citations.map(esc).join('、')+' · 模型 '+esc(review.model)+'</p></details>').join('')+'<p>'+esc(row.disclaimer)+'</p></article>').join('');};
    const request=async(options)=>{const cookie=document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('mm_csrf='));const response=await fetch('/api/research/committee'+(options?'':'?'+new URLSearchParams({market:current.market,instrument})),{...options,signal,cache:'no-store',headers:{'Content-Type':'application/json',...(cookie?{'x-csrf-token':decodeURIComponent(cookie.slice(8))}:{})}});const body=await response.json();signal.throwIfAborted();if(!response.ok)throw Error(body.reason || '审议不可用');return body;};
    section.querySelector('[data-committee-run]').onclick=async event=>{
      const evidenceRefs=[...section.querySelectorAll('input:checked')].map(node=>node.value);if(!evidenceRefs.length){status.textContent='请选择至少一条当前标的证据。';return;}
      if(!confirm('将调用最多 3 次已配置免费模型，只保存研究审议、不下单。继续？'))return;
      event.target.disabled=true;status.textContent='多空与风控正在串行审议（最多约 45 秒）…';
      try{const body=await request({method:'POST',body:JSON.stringify({market:current.market,instrument,evidenceRefs,idempotencyKey:'committee-'+crypto.randomUUID()})});status.textContent=body.reason;draw([body.data]);}catch(error){if(error.name!=='AbortError')status.textContent=error.message;}finally{event.target.disabled=false;}
    };
    section.querySelector('[data-committee-history]').onclick=async()=>{try{const body=await request();status.textContent=body.reason || '已读取私人审议历史';draw(body.data);}catch(error){if(error.name!=='AbortError')status.textContent=error.message;}};
  }
  function renderCostStress(host,experiments) {
    if(!host)return;
    const section=document.createElement('section');section.className='mm-action-center';section.dataset.costStress='true';
    section.innerHTML='<h4>费用 / 滑点压力比较（非排名）</h4>'+experiments.map(row=>{const cost=row.costStress;return '<article><h5>'+esc(row.id)+'</h5><p>'+esc(cost?.reason || '旧实验未保存成本压力结果，未推算')+'</p>'+(cost?.scenarios?.length?'<div class="mm-table-scroll"><table><thead><tr><th>成本倍数</th><th>费用</th><th>滑点成本</th><th>净收益</th><th>最大回撤</th><th>成交</th></tr></thead><tbody>'+cost.scenarios.map(value=>'<tr><td>'+value.multiplier+'×</td><td>'+metric(value.totalFees)+'</td><td>'+metric(value.totalSlippage)+'</td><td>'+metric(value.totalReturnPct)+'%</td><td>'+metric(value.maxDrawdownPct)+'%</td><td>'+value.trades+'</td></tr>').join('')+'</tbody></table></div>':'')+'<p>'+esc((cost?.warnings || []).join('；'))+'</p></article>';}).join('');host.append(section);
  }
  function renderRobustness(host,experiments,request) {
    if(!host || !window.mm_isLoggedIn || window.mm_isGuest)return;
    const initial=context(),key=JSON.stringify(initial);
    const section=document.createElement('section');section.className='mm-action-center';
    section.innerHTML='<h4>固定输入稳健性对照</h4><p>只分析已保存实验；随机入场、时间安慰剂与入场前市场状态。不会调用模型、抓取行情或发布策略。</p>'+experiments.map(row=>'<article><h5>'+esc(row.id)+'</h5><button type="button" data-robustness-run="'+esc(row.id)+'">分析已保存输入</button><div role="status" data-robustness-output></div></article>').join('');host.append(section);
    const current=()=>host.isConnected && !document.hidden && !window.mm_isGuest && window.mm_isLoggedIn && JSON.stringify(context())===key;
    section.querySelectorAll('[data-robustness-run]').forEach(button=>button.onclick=async()=>{
      if(!current())return;const output=button.parentElement.querySelector('[data-robustness-output]');button.disabled=true;output.textContent='正在分析保存输入…';
      try{
        const response=await request('/api/research/experiments/'+encodeURIComponent(button.dataset.robustnessRun)+'/robustness',{method:'POST'});
        if(!current()){output.textContent='';return;}
        const data=response.data,controls=data.controls;
        const summaries=controls?['randomEntry','timePlacebo'].map(name=>{
          const values=controls[name].map(row=>row.meanNetReturnPct).filter(value=>Number.isFinite(value));
          return '<p>'+({randomEntry:'随机入场',timePlacebo:'时间安慰剂'}[name])+' · '+values.length+' 次可用对照 · 每次平均区间净收益范围 '+(values.length?metric(Math.min(...values))+'% — '+metric(Math.max(...values))+'%':'不可用')+'</p>';
        }).join(''):'';
        output.innerHTML='<p>'+esc(data.reason)+'</p><p>数据 Hash '+esc(data.dataHash || '未关联')+' · 配置 Hash '+esc(data.configurationHash || '未关联')+' · seed '+esc(data.seed ?? '未声明')+'</p>'+summaries+'<div class="mm-table-scroll"><table><thead><tr><th>入场前状态</th><th>完整区间</th><th>平均净收益假设</th></tr></thead><tbody>'+data.regimes.map(row=>'<tr><td>'+esc({rising:'上升',falling:'下降',flat:'持平',unknown:'未知'}[row.regime] || row.regime)+'</td><td>'+row.sampleCount+'</td><td>'+metric(row.meanNetReturnPct)+'%</td></tr>').join('')+'</tbody></table></div><p>'+data.warnings.map(esc).join('；')+'</p>';
      }catch(error){if(current() && error.name!=='AbortError')output.textContent=error.message;else output.textContent='';}
      finally{button.disabled=false;}
    });
  }
  function renderRiskBudgetPreview(host, data, request) {
    if(!host || !data || !window.mm_isLoggedIn || window.mm_isGuest)return;
    const initial=JSON.stringify(context()),current=()=>host.isConnected && !document.hidden && context().workspace==='decision-intelligence' && !window.mm_isGuest && window.mm_isLoggedIn && JSON.stringify(context())===initial;
    const section=document.createElement('section');section.className='mm-action-center';section.dataset.riskBudget='true';
    section.innerHTML='<h4>风险预算 · 只读再平衡预览</h4><p>'+esc(data.reason)+'</p>'+
      (data.positions?.length?'<label>单标的上限（%） <input type="number" min="5" max="100" step="1" data-risk-cap value="'+esc(data.capPct)+'"></label> <button type="button" data-risk-preview>预览，不创建订单</button><p>最大权重 '+metric(data.before?.largestWeightPct)+'% → '+metric(data.after?.largestWeightPct)+'% · 假设现金留存 '+metric(data.cashReserveAmount)+' '+esc(data.currency)+'</p><p>日波动率 '+metric(data.before?.dailyVolatilityPct)+'% → '+metric(data.after?.dailyVolatilityPct)+'% · '+esc(data.riskReason || '')+'</p><div class="mm-table-scroll"><table class="workspace-watchlist-table"><thead><tr><th>标的</th><th>当前权重</th><th>假设权重</th><th>假设减少金额</th></tr></thead><tbody>'+data.positions.map(row=>'<tr><td>'+esc(row.instrument)+'</td><td>'+metric(row.currentPct)+'%</td><td>'+metric(row.targetPct)+'%</td><td>'+metric(row.reductionAmount)+' '+esc(data.currency)+'</td></tr>').join('')+'</tbody></table></div>':'')+
      '<p>'+ (data.assumptions || []).map(esc).join('；')+'</p><p data-risk-status role="status"></p>';
    host.append(section);const button=section.querySelector('[data-risk-preview]');if(!button)return;
    button.onclick=async()=>{if(!current())return;const cap=Number(section.querySelector('[data-risk-cap]').value),status=section.querySelector('[data-risk-status]');
      if(!Number.isFinite(cap)||cap<5||cap>100){status.textContent='上限必须为5–100%。';return;}
      button.disabled=true;status.textContent='正在分析保存估值，不创建订单…';
      try{await request(cap);}catch(error){if(current())status.textContent=error.message;}finally{button.disabled=false;}
    };
  }
  window.MoneyMoneyProfessionalResearch = { renderTailRisk, renderCommittee, renderCostStress,renderRobustness,renderRiskBudgetPreview };

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
    panel.innerHTML='<h3>SEC 财报版本研究台</h3><p>仅当前股票。先手动索引官方 10-K/10-Q，再检索本地段落、对照同类申报并保存原文批注；不会自动调用 AI 或生成订单。</p>' +
      '<p data-filing-context></p><div data-filing-controls><button type="button" data-filing-index>索引最新官方财报</button> <button type="button" data-filing-list>查看已索引文件</button><form data-filing-search><label>关键词 <input name="query" maxlength="200" required placeholder="如 tariffs / liquidity"></label><label>已发布时间截止 <input name="asOf" type="date"></label><button type="submit">检索原文段落</button></form></div><p data-filing-status role="status"></p><div data-filing-results></div>' +
      '<details data-filing-version-desk><summary>跨期章节对照与原文批注</summary><p>只比较同一股票、同类 10-K 或 10-Q 的稳定章节；表单口径、主体或章节证据不一致时显示不可比较。批注追加保存，不改原文。</p>' +
      '<div class="compact-controls"><label>基准文件 <select data-filing-base disabled></select></label><label>对照文件 <select data-filing-current disabled></select></label><button type="button" data-filing-compare disabled>对照</button></div><div data-filing-compare-results></div>' +
      '<hr><div class="compact-controls"><label>批注文件 <select data-filing-annotation-doc disabled></select></label><label>稳定章节 <select data-filing-annotation-section disabled></select></label><label>起始段 <input data-filing-annotation-start type="number" min="1" value="1"></label><label>结束段 <input data-filing-annotation-end type="number" min="1" value="1"></label></div><label>批注 <textarea data-filing-annotation-body maxlength="4000" rows="3" placeholder="记录与原文段落相关的判断、反证或复查问题"></textarea></label><button type="button" data-filing-annotation-save disabled>追加批注</button><div data-filing-annotations></div></details>';
    panel.querySelector('[data-filing-context]').textContent=instrument || '当前标的未绑定可核验的美国股票身份，检索不可用。';
    panel.querySelector('[data-filing-controls]').hidden=!instrument;
    if (!instrument) return;
    const signal=controller.signal, status=panel.querySelector('[data-filing-status]'), results=panel.querySelector('[data-filing-results]');
    let indexedDocuments=[];
    async function request(url, options={}) {
      const token=document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('mm_csrf='));
      const response=await fetch(url,{...options,signal,credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(token?{'x-csrf-token':decodeURIComponent(token.slice(8))}:{}),...options.headers}});
      const body=await response.json();signal.throwIfAborted();
      if (!response.ok || body.success===false) throw new Error(body.reason || '请求失败 '+response.status);
      return body;
    }
    function errorMessage(error) { if(error.name!=='AbortError')status.textContent=error.message; }
    function writeKey(prefix){const suffix=globalThis.crypto?.randomUUID?.() || (Date.now()+'-'+Math.random().toString(16).slice(2));return prefix+':'+suffix;}
    function refreshDocumentSelectors(){
      const base=panel.querySelector('[data-filing-base]'),current=panel.querySelector('[data-filing-current]'),annotations=panel.querySelector('[data-filing-annotation-doc]');
      const render=(rows)=>rows.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.form+' '+row.publishedAt.slice(0,10))+'</option>').join('');
      base.innerHTML=render(indexedDocuments.slice(1));current.innerHTML=render(indexedDocuments.slice(0,-1));annotations.innerHTML=render(indexedDocuments);
      [base,current,annotations].forEach(select=>{select.disabled=!select.options.length;});
      panel.querySelector('[data-filing-compare]').disabled=indexedDocuments.length<2;
      panel.querySelector('[data-filing-annotation-doc]').disabled=!indexedDocuments.length;
      void loadAnnotationSections();
    }
    async function loadAnnotationSections(){
      const select=panel.querySelector('[data-filing-annotation-doc]'),sectionSelect=panel.querySelector('[data-filing-annotation-section]'),button=panel.querySelector('[data-filing-annotation-save]');
      sectionSelect.innerHTML='';button.disabled=true;if(!select.value)return;
      try{
        const body=await request('/api/research/filings/'+encodeURIComponent(select.value)+'/sections');
        sectionSelect.innerHTML=body.data.map(row=>'<option value="'+esc(row.sectionKey)+'" data-start="'+row.startParagraph+'" data-end="'+row.endParagraph+'">'+esc(row.heading+' · '+row.startParagraph+'–'+row.endParagraph)+'</option>').join('');
        sectionSelect.disabled=!body.data.length;button.disabled=!body.data.length;updateSectionRange();
      }catch(error){if(error.name!=='AbortError')sectionSelect.innerHTML='<option value="">章节载入失败</option>';}
    }
    function updateSectionRange(){
      const section=panel.querySelector('[data-filing-annotation-section]').selectedOptions[0],start=panel.querySelector('[data-filing-annotation-start]'),end=panel.querySelector('[data-filing-annotation-end]');
      if(!section)return;start.min=start.value=section.dataset.start;end.min=end.value=section.dataset.end;
    }
    function renderComparison(data){
      panel.querySelector('[data-filing-compare-results]').innerHTML='<p>'+esc(data.status==='comparable'?'可比对照':'不可比较')+' · '+esc(data.baseDocument.form+' '+data.baseDocument.publishedAt.slice(0,10)+' → '+data.currentDocument.form+' '+data.currentDocument.publishedAt.slice(0,10))+'</p><p>'+esc(data.reasons.join('；') || '同类申报、相同股票与稳定章节键支持对齐；每个段落均可回到不可变原文 Hash。')+'</p>'+
        '<p>可比章节 '+data.summary.alignedSections+' · 未变 '+data.summary.unchangedSections+' · 基准独有 '+data.summary.baseOnlySections+' · 对照独有 '+data.summary.currentOnlySections+'</p><p>对照 Hash '+esc(data.contentHash)+'</p>'+
        data.sections.slice(0,24).map(section=>'<details><summary>'+esc(section.heading)+' · '+esc(section.status)+' · '+section.changedParagraphs+' 段差异</summary><p>'+esc(section.reason || section.alignmentEvidence.join(' / '))+'</p>'+section.changes.slice(0,20).map(change=>'<article><strong>'+esc(change.kind)+' · '+esc((change.baseParagraph??'—')+' → '+(change.currentParagraph??'—'))+'</strong><p>基准：'+esc(change.baseText||'缺失')+'</p><p>对照：'+esc(change.currentText||'缺失')+'</p><p>'+esc(change.baseCitation||'')+'<br>'+esc(change.currentCitation||'')+'</p></article>').join('')+(section.truncated?'<p>本节只展示部分差异，原始文件完整保留。</p>':'')+'</details>').join('');
    }
    panel.querySelector('[data-filing-index]').onclick=async event=>{
      event.target.disabled=true;status.textContent='正在核验 SEC 目录与原文（最多 4MB，不自动重试）…';
      try { const body=await request('/api/research/filings/index',{method:'POST',headers:{'Idempotency-Key':writeKey('filing-index')},body:JSON.stringify({instrument})});status.textContent=body.data.form+' '+body.data.accession+' 已索引 '+body.data.paragraphs+' 段；来源 SEC EDGAR，发布 '+body.data.publishedAt; }
      catch(error){errorMessage(error);}finally{event.target.disabled=false;}
    };
    panel.querySelector('[data-filing-list]').onclick=async()=>{
      status.textContent='正在读取本地索引…';
      try { const body=await request('/api/research/filings?'+new URLSearchParams({instrument}));indexedDocuments=body.data;status.textContent=body.reason || '已索引 '+body.data.length+' 份官方文件';results.innerHTML=body.data.map(row=>'<article><strong>'+esc(row.form)+' · '+esc(row.accession)+'</strong><p>发布 '+esc(row.publishedAt)+' · 抓取 '+esc(row.retrievedAt)+'</p><p>内容 Hash '+esc(row.contentHash)+'</p><a target="_blank" rel="noopener noreferrer" href="'+esc(row.sourceUrl)+'">SEC 原文 ↗</a></article>').join('');refreshDocumentSelectors(); }
      catch(error){errorMessage(error);}
    };
    panel.querySelector('[data-filing-search]').onsubmit=async event=>{
      event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;status.textContent='正在检索本地原文…';
      const values=new FormData(event.target), query=new URLSearchParams({instrument,q:String(values.get('query') || '')}), day=values.get('asOf');
      if(day)query.set('asOf',day+'T23:59:59.999Z');
      try {const body=await request('/api/research/filings/search?'+query);status.textContent=body.reason || '命中 '+body.data.length+' 个段落；历史原文，不是投资建议。';results.innerHTML=body.data.map(row=>'<article><strong>'+esc(row.form)+' · '+esc(row.sectionHeading)+' · 段落 '+row.paragraph+'</strong><blockquote>'+esc(row.text)+'</blockquote><p>发布 '+esc(row.publishedAt)+' · 抓取 '+esc(row.retrievedAt)+' · '+esc(row.publicationPrecision)+'</p><p>定位 '+esc(row.citation)+'；HTML 无可靠页码。</p><a target="_blank" rel="noopener noreferrer" href="'+esc(row.sourceUrl)+'">核对 SEC 原文 ↗</a></article>').join('');}
      catch(error){errorMessage(error);}finally{button.disabled=false;}
    };
    panel.querySelector('[data-filing-compare]').onclick=async event=>{
      const base=panel.querySelector('[data-filing-base]').value,current=panel.querySelector('[data-filing-current]').value;
      if(!base||!current||base===current){status.textContent='请选择两份不同的已索引文件。';return;}
      event.target.disabled=true;status.textContent='正在按稳定章节与原文 Hash 计算差异…';
      try{const body=await request('/api/research/filings/compare?'+new URLSearchParams({base,current}));status.textContent=body.reason||'版本对照完成；不可比较项不会强行对齐。';renderComparison(body.data);}
      catch(error){errorMessage(error);}finally{event.target.disabled=false;}
    };
    panel.querySelector('[data-filing-annotation-doc]').onchange=()=>void loadAnnotationSections();
    panel.querySelector('[data-filing-annotation-section]').onchange=updateSectionRange;
    panel.querySelector('[data-filing-annotation-save]').onclick=async event=>{
      const documentId=panel.querySelector('[data-filing-annotation-doc]').value,section=panel.querySelector('[data-filing-annotation-section]').selectedOptions[0],body=panel.querySelector('[data-filing-annotation-body]').value.trim();
      if(!documentId||!section||!body){status.textContent='请选择文件、章节并填写批注。';return;}
      event.target.disabled=true;
      try{
        const history=await request('/api/research/filings/'+encodeURIComponent(documentId)+'/annotations');
        const version=Math.max(0,...history.data.map(row=>Number(row.revision)||0));
        const saved=await request('/api/research/filings/'+encodeURIComponent(documentId)+'/annotations',{method:'POST',headers:{'If-Match':'"'+version+'"','Idempotency-Key':writeKey('filing-annotation')},body:JSON.stringify({sectionKey:section.value,startParagraph:Number(panel.querySelector('[data-filing-annotation-start]').value),endParagraph:Number(panel.querySelector('[data-filing-annotation-end]').value),body,expectedVersion:version})});
        panel.querySelector('[data-filing-annotations]').innerHTML='<p>已追加批注版本 '+esc(saved.data.revision)+' · '+esc(saved.data.citation)+'</p><p>定位 Hash '+esc(saved.data.citationHash)+'</p>';
        panel.querySelector('[data-filing-annotation-body]').value='';
      }catch(error){errorMessage(error);}finally{event.target.disabled=false;}
    };
  }
  function init() {
    const shell=document.getElementById('market-workspace-shell');
    if(shell)new MutationObserver(syncFilingPanel).observe(shell,{attributes:true,attributeFilter:['data-market-scope','data-workspace','data-instrument']});
    window.addEventListener('mm-workspace-context',()=>{committeeController.abort();syncFilingPanel();});
    let attempts=0;const timer=setInterval(()=>{syncFilingPanel();if(window.mm_isLoggedIn || ++attempts>=20)clearInterval(timer);},500);
    syncFilingPanel();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
