(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let contextKey = '', controller = new AbortController();
  const currentContext = () => {
    const shell = document.getElementById('market-workspace-shell');
    return {market:shell?.dataset.marketScope || '',workspace:shell?.dataset.workspace || '',instrument:shell?.dataset.instrument || ''};
  };
  const stockInstrument = value => /^stock:us:[A-Z][A-Z0-9.-]{0,14}$/.test(value)
    ? value
    : /^us[A-Z][A-Z0-9.-]{0,14}$/.test(value)
      ? 'stock:us:' + value.slice(2).replace(/\.(OQ|N)$/, '')
      : null;
  const shortHash = value => {
    let hash = 2166136261;
    for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const writeKey = prefix => prefix + ':' + (globalThis.crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2)));
  const localNow = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  };
  const isoFromLocal = value => value ? new Date(value).toISOString() : '';

  function syncPanel() {
    const context = currentContext(), parent = document.querySelector('[data-workspace-id="fundamentals"] .collapse-body');
    let panel = document.getElementById('company-industry-graph');
    const key = [context.market,context.workspace,context.instrument,window.mm_isGuest,window.mm_isLoggedIn].join('|');
    if (key === contextKey) return;
    contextKey = key;
    controller.abort();
    controller = new AbortController();
    const instrument = stockInstrument(context.instrument);
    if (context.market !== 'stocks' || context.workspace !== 'fundamentals' || !instrument || !window.mm_isLoggedIn || window.mm_isGuest) {
      if (panel) panel.hidden = true;
      return;
    }
    if (!parent) return;
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'company-industry-graph';
      panel.className = 'mm-action-center';
      parent.append(panel);
    }
    const sourceId = 'company:' + instrument;
    panel.hidden = false;
    panel.innerHTML =
      '<h3>公司与产业关系图谱</h3><p>保存有来源和有效时间的供应商、客户、股东、行业及事件关系。推测关系不会被人工确认自动升级为事实，只有来源完整且带明确暴露比例的已披露关系参与组合间接集中度。</p>' +
      '<p><b>当前来源公司</b> '+esc(instrument)+'</p>' +
      '<details><summary>登记一条关系并预览</summary><form data-graph-form>' +
        '<div class="compact-controls"><label>截止时间 <input type="datetime-local" data-graph-asof required value="'+localNow()+'"></label><label>来源公司名称 <input data-graph-source-label maxlength="200" required value="'+esc(instrument)+'"></label></div>' +
        '<div class="compact-controls"><label>目标节点 <select data-graph-target-kind><option value="company">公司</option><option value="industry">行业</option><option value="fund">机构/基金</option><option value="person">个人</option><option value="event">事件</option></select></label><label>目标名称 <input data-graph-target-label maxlength="200" required placeholder="如 TSMC / semiconductors"></label><label>目标股票标的 <input data-graph-target-instrument maxlength="40" placeholder="可选 stock:us:TSM"></label></div>' +
        '<div class="compact-controls"><label>关系 <select data-graph-kind><option value="supplier">供应商</option><option value="customer">客户</option><option value="shareholder">股东</option><option value="industry-membership">所属行业</option><option value="event-exposure">事件影响</option></select></label><label>依据 <select data-graph-basis><option value="source-assertion">来源披露/断言</option><option value="research-inference">研究推测</option></select></label><label>暴露比例 % <input type="number" data-graph-exposure min="0.000001" max="100" step="0.000001" placeholder="缺失则只显示缺口"></label></div>' +
        '<div class="compact-controls"><label>关系生效时间 <input type="datetime-local" data-graph-effective-from required value="'+localNow()+'"></label><label>结束时间（可选） <input type="datetime-local" data-graph-effective-to></label></div>' +
        '<div class="compact-controls"><label>证据来源 <input data-graph-evidence-source maxlength="200" required placeholder="如 SEC 10-K / 公司公告"></label><label>发布时间 <input type="datetime-local" data-graph-published required value="'+localNow()+'"></label><label>抓取时间 <input type="datetime-local" data-graph-fetched required value="'+localNow()+'"></label></div>' +
        '<label>证据内容 SHA-256 <input data-graph-content-hash minlength="64" maxlength="64" pattern="[a-f0-9]{64}" required placeholder="64 位小写十六进制"></label><label>说明（可选） <textarea data-graph-note rows="2" maxlength="2000"></textarea></label>' +
        '<p><button type="submit" data-graph-preview>预览关系图</button> <button type="button" data-graph-list>读取已保存记录</button></p><p role="status" data-graph-status></p><div data-graph-preview-output></div>' +
      '</form></details>' +
      '<details><summary>组合间接集中度预览</summary><p>每行一个明确股票与权重，例如 stock:us:AAPL=50。权重必须合计 100%；不读取或修改模拟账本。</p><label>组合头寸 <textarea data-graph-positions rows="4" placeholder="stock:us:AAPL=50&#10;stock:us:MU=50"></textarea></label><div class="compact-controls"><label>关系传播跳数 <select data-graph-hops><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></label><button type="button" data-graph-concentration>计算已覆盖集中度</button></div><div data-graph-concentration-output></div></details>' +
      '<div data-graph-records></div>';
    const signal = controller.signal;
    const status = panel.querySelector('[data-graph-status]');
    async function request(url, options = {}) {
      const token = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('mm_csrf='));
      const response = await fetch(url, {
        ...options,
        signal,
        credentials: 'include',
        cache: 'no-store',
        headers: {'content-type':'application/json',...(token ? {'x-csrf-token':decodeURIComponent(token.slice(8))} : {}),...options.headers},
      });
      const body = await response.json();
      signal.throwIfAborted();
      if (!response.ok || body.success === false) throw new Error(body.reason || '请求失败 ' + response.status);
      return body;
    }
    const fail = error => { if (error.name !== 'AbortError') status.textContent = error.message; };
    const targetId = (kind, label, instrument) => instrument ? 'company:' + instrument : kind + ':entity-' + shortHash(label);
    function renderPreview(data) {
      const output = panel.querySelector('[data-graph-preview-output]');
      output.innerHTML = '<article><h4>'+esc(data.status)+' · 版本 '+data.revision+'</h4><p>节点 '+data.manifest.nodes.length+' · 关系 '+data.summary.edges+' · 来源完整 '+data.summary.supportedEdges+' · 推测 '+data.summary.inferredEdges+' · 待核验 '+data.summary.unverifiedEdges+'</p><p>内容 Hash '+esc(data.contentHash)+'</p>'+data.edges.map(edge=>'<p>'+esc(edge.id)+' · '+esc(edge.factStatus)+'<br>'+esc(edge.reason)+'</p>').join('')+(data.status==='preview'?'<button type="button" data-graph-confirm>明确确认此预览</button>':'<p>该版本已确认；推测关系仍保留为非事实。</p>')+'</article>';
      const confirm = output.querySelector('[data-graph-confirm]');
      if (!confirm) return;
      confirm.onclick = async event => {
        if (!window.confirm('确认这份关系图预览？推测关系仍不会被当作事实。')) return;
        event.target.disabled = true;
        try {
          const saved = await request('/api/research/company-graph/' + encodeURIComponent(data.id) + '/confirm', {
            method:'POST',
            headers:{'If-Match':'"' + data.revision + '"','Idempotency-Key':writeKey('company-graph-confirm')},
            body:JSON.stringify({expectedVersion:data.revision,contentHash:data.contentHash,acknowledge:true}),
          });
          status.textContent = '关系图已确认并追加审计版本 ' + saved.data.revision;
          renderPreview(saved.data);
        } catch (error) { fail(error); }
        finally { event.target.disabled = false; }
      };
    }
    panel.querySelector('[data-graph-form]').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget, value = selector => form.querySelector(selector).value.trim();
      const targetLabel = value('[data-graph-target-label]'), targetKind = value('[data-graph-target-kind]'), targetInstrument = value('[data-graph-target-instrument]');
      if (!targetLabel) { status.textContent = '请填写目标节点名称。'; return; }
      const targetNodeId = targetId(targetKind, targetLabel, targetInstrument), kind = value('[data-graph-kind]'), edgeId = 'edge:' + kind + ':' + shortHash(sourceId + '\0' + targetNodeId);
      const exposure = value('[data-graph-exposure]'), effectiveTo = value('[data-graph-effective-to]');
      const payload = {
        market:'stocks',
        asOf:isoFromLocal(value('[data-graph-asof]')),
        nodes:[
          {id:sourceId,kind:'company',label:value('[data-graph-source-label]'),instrument},
          {id:targetNodeId,kind:targetKind,label:targetLabel,...(targetInstrument ? {instrument:targetInstrument} : {})},
        ],
        edges:[{
          id:edgeId,from:sourceId,to:targetNodeId,kind,basis:value('[data-graph-basis]'),
          evidence:{market:'stocks',instrument:targetInstrument || instrument,kind:'company-relationship',source:value('[data-graph-evidence-source]'),publishedAt:isoFromLocal(value('[data-graph-published]')),observedAt:isoFromLocal(value('[data-graph-published]')),fetchedAt:isoFromLocal(value('[data-graph-fetched]')),contentHash:value('[data-graph-content-hash]'),coverage:'complete',unknownReason:null},
          effectiveFrom:isoFromLocal(value('[data-graph-effective-from]')),
          ...(effectiveTo ? {effectiveTo:isoFromLocal(effectiveTo)} : {}),
          ...(exposure ? {exposurePct:Number(exposure)} : {}),
        }],
        ...(value('[data-graph-note]') ? {note:value('[data-graph-note]')} : {}),
      };
      const button = form.querySelector('[data-graph-preview]');
      button.disabled = true; status.textContent = '正在校验证据、节点身份和关系依据…';
      try {
        const body = await request('/api/research/company-graph/preview', {method:'POST',headers:{'Idempotency-Key':writeKey('company-graph-preview')},body:JSON.stringify(payload)});
        status.textContent = body.reason || '预览已保存，尚未计入集中度。';
        renderPreview(body.data);
      } catch (error) { fail(error); }
      finally { button.disabled = false; }
    };
    panel.querySelector('[data-graph-list]').onclick = async () => {
      status.textContent = '正在读取截止时点内的已保存关系图…';
      try {
        const body = await request('/api/research/company-graph?' + new URLSearchParams({instrument,asOf:new Date().toISOString()}));
        status.textContent = body.reason || '已读取 '+body.data.length+' 份关系图记录';
        panel.querySelector('[data-graph-records]').innerHTML = body.data.map(row => '<article><strong>'+esc(row.status)+' · '+esc(row.asOf.slice(0,10))+'</strong><p>关系 '+row.summary.edges+' · 来源完整 '+row.summary.supportedEdges+' · 推测 '+row.summary.inferredEdges+' · 待核验 '+row.summary.unverifiedEdges+'</p><p>内容 Hash '+esc(row.contentHash)+'</p></article>').join('');
      } catch (error) { fail(error); }
    };
    panel.querySelector('[data-graph-concentration]').onclick = async event => {
      const lines = panel.querySelector('[data-graph-positions]').value.split(/\r?\n/).map(row => row.trim()).filter(Boolean);
      const positions = [];
      for (const line of lines) {
        const separator = line.lastIndexOf('=');
        if (separator < 1) { status.textContent = '组合头寸行必须使用 标的=权重 格式。'; return; }
        positions.push({instrument:line.slice(0,separator).trim(),weightPct:Number(line.slice(separator+1).trim())});
      }
      event.target.disabled = true; status.textContent = '正在只读计算已确认关系覆盖…';
      try {
        const body = await request('/api/research/company-graph/concentration', {method:'POST',body:JSON.stringify({asOf:new Date().toISOString(),maxHops:Number(panel.querySelector('[data-graph-hops]').value),positions})});
        const data = body.data;
        panel.querySelector('[data-graph-concentration-output]').innerHTML = '<article><h4>'+esc(data.status)+' · HHI '+esc(data.aggregateExposure.hhiLower)+'–'+esc(data.aggregateExposure.hhiUpper)+'</h4><p>'+esc(data.reason)+'</p><p>直接覆盖 '+data.coverage.mappedPositions+'/'+data.coverage.totalPositions+' · 活动关系 '+data.coverage.activeEdges+' · 缺口 '+data.coverage.exclusions.length+'</p><div class="mm-table-scroll"><table><thead><tr><th>节点</th><th>类型</th><th>最大单路径</th><th>上界合计</th></tr></thead><tbody>'+data.indirectExposures.map(row=>'<tr><td>'+esc(row.label)+'</td><td>'+esc(row.kind)+'</td><td>'+row.maxPathWeightPct.toFixed(4)+'%</td><td>'+row.upperBoundWeightPct.toFixed(4)+'%</td></tr>').join('')+'</tbody></table></div>'+data.coverage.exclusions.map(row=>'<p>缺口 '+esc(row.edgeId)+' · '+esc(row.reason)+'</p>').join('')+'</article>';
        status.textContent = body.reason || '集中度预览完成';
      } catch (error) { fail(error); }
      finally { event.target.disabled = false; }
    };
  }

  function init() {
    const shell = document.getElementById('market-workspace-shell');
    if (shell) new MutationObserver(syncPanel).observe(shell,{attributes:true,attributeFilter:['data-market-scope','data-workspace','data-instrument']});
    window.addEventListener('mm-workspace-context', syncPanel);
    let attempts = 0;
    const timer = setInterval(() => {syncPanel();if (window.mm_isLoggedIn || ++attempts >= 20) clearInterval(timer);},500);
    syncPanel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
