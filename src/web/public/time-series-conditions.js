(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const writeKey = prefix => prefix + ':' + (globalThis.crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2)));
  let contextKey = '';
  let controller = new AbortController();
  const context = () => {
    const shell = document.getElementById('market-workspace-shell');
    return {market:shell?.dataset.marketScope || '',workspace:shell?.dataset.workspace || '',instrument:shell?.dataset.instrument || ''};
  };
  const localNow = () => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  };
  const iso = value => value ? new Date(value).toISOString() : '';
  const operatorOptions = ['eq','neq','gt','gte','lt','lte','in','exists'].map(value => '<option value="'+value+'">'+value+'</option>').join('');

  function parentForPanel() {
    return document.getElementById('market-research-tools')
      || document.querySelector('[data-workspace-id="screener"]:not(.workspace-item)')
      || document.querySelector('[data-workspace-ids~="screener"]')
      || document.getElementById('market-workspace-shell')?.parentElement
      || document.body;
  }

  function syncPanel() {
    const current = context();
    const key = [current.market,current.workspace,current.instrument,window.mm_isLoggedIn,window.mm_isGuest].join('|');
    if (key === contextKey) return;
    contextKey = key;
    controller.abort();
    controller = new AbortController();
    const panel = document.getElementById('time-series-conditions');
    const allowed = current.workspace === 'screener'
      && ['stocks','options','crypto','prediction'].includes(current.market)
      && current.instrument
      && window.mm_isLoggedIn && !window.mm_isGuest;
    if (!allowed) {
      if (panel) panel.hidden = true;
      return;
    }
    let mount = panel;
    if (!mount) {
      mount = document.createElement('section');
      mount.id = 'time-series-conditions';
      mount.className = 'glass-card';
      parentForPanel().append(mount);
    }
    mount.hidden = false;
    mount.style.gridColumn = '1 / -1';
    mount.innerHTML = [
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">',
      '<div><strong>⛓ 有序条件序列</strong><div style="font-size:12px;color:var(--text-secondary)">A → B → 非 C；按已保存证据的观察时间和明确窗口判断，不发起行情采集、模型调用或订单。</div></div>',
      '<button class="tab" type="button" data-sequence-list>读取已保存规则</button></div>',
      '<p><b>当前标的</b> '+esc(current.instrument)+' · <b>当前市场</b> '+esc(current.market)+'</p>',
      '<details><summary>新建并预览条件规则</summary><form data-sequence-form>',
      '<div class="compact-controls"><label>规则名称 <input data-sequence-name maxlength="160" required value="A 后出现 B 且窗口内没有 C"></label><label>截止时间 <input type="datetime-local" data-sequence-asof required value="'+localNow()+'"></label><label>最长观察窗（分钟） <input type="number" data-sequence-span min="1" max="525600" value="60" required></label></div>',
      '<label>已保存证据 ID（每行一个，2–200 个） <textarea data-sequence-evidence rows="4" required placeholder="ev_...&#10;ev_..."></textarea></label>',
      '<div class="compact-controls"><label>A 字段 <input data-sequence-a-field value="stage" required></label><label>A 操作 <select data-sequence-a-operator>'+operatorOptions+'</select></label><label>A 值 <input data-sequence-a-value value="A" required></label></div>',
      '<div class="compact-controls"><label>B 字段 <input data-sequence-b-field value="stage" required></label><label>B 操作 <select data-sequence-b-operator>'+operatorOptions+'</select></label><label>B 值 <input data-sequence-b-value value="B" required></label><label>距 A 最少分钟 <input type="number" data-sequence-b-min min="0" value="0"></label><label>距 A 最多分钟 <input type="number" data-sequence-b-max min="1" value="30"></label></div>',
      '<div class="compact-controls"><label><input type="checkbox" data-sequence-exclude-enabled checked> 启用“非 C”排除</label><label>C 字段 <input data-sequence-c-field value="stage"></label><label>C 操作 <select data-sequence-c-operator>'+operatorOptions+'</select></label><label>C 值 <input data-sequence-c-value value="C"></label><label>B 后排除窗口（分钟） <input type="number" data-sequence-c-window min="1" value="15"></label></div>',
      '<div class="compact-controls"><label>研究项目 ID（可选） <input data-sequence-project-id maxlength="80" placeholder="project_..."></label><label>项目当前版本 <input type="number" data-sequence-project-version min="1" value="1"></label></div>',
      '<p><button type="submit" data-sequence-preview>预览并校验证据</button></p><p role="status" data-sequence-status></p><div data-sequence-result></div>',
      '</form></details>',
      '<div data-sequence-list-output></div>',
    ].join('');
    const signal = controller.signal;
    const status = mount.querySelector('[data-sequence-status]');
    async function request(url, options = {}) {
      const csrf = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('mm_csrf='));
      const response = await fetch(url, {
        ...options,
        signal,
        credentials:'include',
        cache:'no-store',
        headers:{'content-type':'application/json',...(csrf ? {'x-csrf-token':decodeURIComponent(csrf.slice(8))} : {}),...(options.headers || {})},
      });
      const body = await response.json();
      signal.throwIfAborted();
      if (!response.ok || body.success === false) throw new Error(body.reason || '请求失败 ' + response.status);
      return body;
    }
    const fail = error => { if (error.name !== 'AbortError') status.textContent = error.message; };
    const predicate = (field,operator,value) => ({field:field.value.trim(),operator:operator.value,...(operator.value === 'exists' ? {} : {value: operator.value === 'in' ? value.value.split(',').map(item => item.trim()).filter(Boolean) : Number.isFinite(Number(value.value)) && value.value.trim() !== '' ? Number(value.value) : value.value.trim()})});
    mount.querySelector('[data-sequence-form]').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget, value = selector => form.querySelector(selector);
      const evidenceIds = value('[data-sequence-evidence]').value.split(/\s+/).map(item => item.trim()).filter(Boolean);
      const steps = [
        {id:'a',label:'阶段 A',predicate:predicate(value('[data-sequence-a-field]'),value('[data-sequence-a-operator]'),value('[data-sequence-a-value]'))},
        {id:'b',label:'阶段 B',afterPreviousMs:Number(value('[data-sequence-b-min]').value || 0) * 60_000,withinPreviousMs:Number(value('[data-sequence-b-max]').value) * 60_000,predicate:predicate(value('[data-sequence-b-field]'),value('[data-sequence-b-operator]'),value('[data-sequence-b-value]'))},
      ];
      const exclusions = value('[data-sequence-exclude-enabled]').checked ? [{
        id:'not-c',label:'窗口内不得出现 C',afterStepId:'b',withinMs:Number(value('[data-sequence-c-window]').value) * 60_000,
        predicate:predicate(value('[data-sequence-c-field]'),value('[data-sequence-c-operator]'),value('[data-sequence-c-value]')),
      }] : [];
      const payload = {market:current.market,instrument:current.instrument,name:value('[data-sequence-name]').value.trim(),asOf:iso(value('[data-sequence-asof]').value),evidenceIds,maxSpanMs:Number(value('[data-sequence-span]').value) * 60_000,steps,exclusions};
      const button = value('[data-sequence-preview]');
      button.disabled = true; status.textContent = '正在核验证据 Hash、市场、标的、时间和规则窗口…';
      try {
        const body = await request('/api/research/time-series-conditions/rules/preview',{method:'POST',headers:{'Idempotency-Key':writeKey('condition-preview')},body:JSON.stringify(payload)});
        renderRule(body.data,true);
        status.textContent = body.reason || '规则预览已保存，确认前不会运行。';
      } catch (error) { fail(error); }
      finally { button.disabled = false; }
    };
    function renderRule(data, preview) {
      const output = mount.querySelector('[data-sequence-result]');
      output.innerHTML = '<article><h4>'+esc(data.status)+' · 版本 '+esc(data.version)+'</h4><p>'+esc(data.manifest.name)+' · 证据 '+data.manifest.evidenceIds.length+' · '+esc(data.reason || '')+'</p><p>内容 Hash '+esc(data.contentHash)+'</p>'+(preview ? '<button type="button" data-sequence-confirm>确认规则</button>' : '<button type="button" data-sequence-run>运行并保存命中历史</button>')+'</article>';
      const confirm = output.querySelector('[data-sequence-confirm]');
      if (confirm) confirm.onclick = async () => {
        if (!window.confirm('确认保存这份有序条件规则？确认后仍需手动运行，不会自动转入研究项目。')) return;
        confirm.disabled = true;
        try {
          const body = await request('/api/research/time-series-conditions/rules/'+encodeURIComponent(data.id)+'/confirm',{method:'POST',headers:{'If-Match':'"'+data.version+'"','Idempotency-Key':writeKey('condition-confirm')},body:JSON.stringify({expectedVersion:data.version,contentHash:data.contentHash,acknowledge:true})});
          renderRule(body.data,false); status.textContent = '规则已确认，尚未运行。';
        } catch (error) { fail(error); }
        finally { confirm.disabled = false; }
      };
      const run = output.querySelector('[data-sequence-run]');
      if (run) run.onclick = async () => {
        run.disabled = true; status.textContent = '正在按已保存证据运行有序条件…';
        try {
          const body = await request('/api/research/time-series-conditions/rules/'+encodeURIComponent(data.id)+'/run',{method:'POST',headers:{'If-Match':'"'+data.version+'"','Idempotency-Key':writeKey('condition-run')},body:JSON.stringify({expectedVersion:data.version,contentHash:data.contentHash})});
          renderRun(body.data); status.textContent = body.reason || '条件运行完成。';
        } catch (error) { fail(error); }
        finally { run.disabled = false; }
      };
    }
    function renderRun(run) {
      mount.querySelector('[data-sequence-result]').innerHTML = '<article><h4>命中 '+run.hits.length+' · 未命中 '+run.misses.length+'</h4><p>输入版本 '+esc(run.inputVersion)+' · 证据 '+run.coverage.evidence+'</p>'+run.hits.map(hit=>'<div><strong>命中 '+esc(hit.startAt)+' → '+esc(hit.endAt)+'</strong><p>'+hit.steps.map(step=>esc(step.label)+' · '+esc(step.evidenceId)).join('<br>')+'</p>'+(hit.linkedProjectId?'<p>已关联研究项目 '+esc(hit.linkedProjectId)+'</p>':'<button type="button" data-sequence-link="'+esc(hit.id)+'">明确将此命中转入研究项目</button>')+'</div>').join('')+run.misses.map(row=>'<p>未命中 '+esc(row.startAt)+' · '+esc(row.reason)+'</p>').join('')+'</article>';
      for (const button of mount.querySelectorAll('[data-sequence-link]')) button.onclick = async () => {
        const projectId = mount.querySelector('[data-sequence-project-id]')?.value.trim();
        const projectVersion = Number(mount.querySelector('[data-sequence-project-version]')?.value || 0);
        if (!projectId) { status.textContent = '请先填写研究项目 ID；命中不会自动创建项目。'; return; }
        if (!window.confirm('把这个固定版本的条件命中显式关联到研究项目？')) return;
        button.disabled = true;
        try {
          const latest = await request('/api/research/time-series-conditions/rules/'+encodeURIComponent(run.ruleId));
          const body = await request('/api/research/time-series-conditions/rules/'+encodeURIComponent(run.ruleId)+'/hits/'+encodeURIComponent(button.dataset.sequenceLink)+'/link',{method:'POST',headers:{'If-Match':'"'+latest.data.version+'"','Idempotency-Key':writeKey('condition-link')},body:JSON.stringify({expectedVersion:latest.data.version,projectId,projectVersion})});
          button.replaceWith(Object.assign(document.createElement('span'),{textContent:'已关联研究项目 '+body.data.projectId}));
          status.textContent = '条件命中的固定版本已显式转入研究项目。';
        } catch (error) { fail(error); }
        finally { button.disabled = false; }
      };
    }
    mount.querySelector('[data-sequence-list]').onclick = async () => {
      status.textContent = '正在读取已保存的 '+current.instrument+' 条件规则…';
      const output = mount.querySelector('[data-sequence-list-output]');
      output.textContent = '';
      try {
        const body = await request('/api/research/time-series-conditions?market='+encodeURIComponent(current.market)+'&instrument='+encodeURIComponent(current.instrument));
        output.innerHTML = body.data.map(row=>'<article><strong>'+esc(row.name)+' · '+esc(row.status)+'</strong><p>版本 '+row.version+' · 命中 '+row.hits+' · 未命中 '+row.misses+' · 截止 '+esc(row.asOf)+'</p><button type="button" data-sequence-open="'+esc(row.id)+'">打开</button></article>').join('') || '<p>尚无匹配的条件规则。</p>';
        for (const button of output.querySelectorAll('[data-sequence-open]')) button.onclick = async () => {
          try { const selected = await request('/api/research/time-series-conditions/rules/'+encodeURIComponent(button.dataset.sequenceOpen)); renderRule(selected.data,selected.data.status === 'preview'); }
          catch (error) { fail(error); }
        };
        status.textContent = '已读取 '+body.data.length+' 份条件规则。';
      } catch (error) { fail(error); }
    };
  }

  function init() {
    const shell = document.getElementById('market-workspace-shell');
    if (shell) new MutationObserver(syncPanel).observe(shell,{attributes:true,attributeFilter:['data-market-scope','data-workspace','data-instrument']});
    window.addEventListener('mm-workspace-context',syncPanel);
    let attempts = 0;
    const timer = setInterval(() => {syncPanel();if (window.mm_isLoggedIn || ++attempts >= 20) clearInterval(timer);},500);
    syncPanel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
