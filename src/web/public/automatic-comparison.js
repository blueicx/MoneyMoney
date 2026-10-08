(() => {
  'use strict';
  const names = { stocks:'股票',options:'期权',crypto:'虚拟币',prediction:'预测市场' };
  let controller, version = 0;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function headers() {
    const token = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('mm_csrf='));
    return {'Content-Type':'application/json',...(token ? {'x-csrf-token':decodeURIComponent(token.slice(8))} : {})};
  }
  function visible() { return !window.mm_isGuest && document.getElementById('paper-tab')?.classList.contains('active') && !document.hidden; }
  async function refresh(market) {
    controller?.abort(); const seq = ++version;
    if (window.mm_isGuest) { document.getElementById('mm-automatic-comparison')?.remove(); return; }
    if (!visible() || !names[market]) return;
    let panel = document.getElementById('mm-automatic-comparison');
    if (!panel) {
      panel = document.createElement('section'); panel.id = 'mm-automatic-comparison'; panel.className = 'glass-card';
      panel.style.cssText = 'padding:16px;margin:12px 0;border-radius:12px;overflow-wrap:anywhere';
      document.getElementById('ai-runners-list')?.before(panel);
    }
    if(panel.dataset.market!==market){panel.dataset.market=market;panel.textContent=names[market]+' · 正在读取当前市场的对照状态…';}
    controller = new AbortController();
    try {
      const res = await fetch('/api/ai-runners/comparisons/automatic', {cache:'no-store',signal:controller.signal}), payload = await res.json();
      if (seq !== version || !visible()) return;
      if (!res.ok || !payload.success) throw new Error(payload.reason || '自动对照状态不可用');
      const state = payload.data, group = state.groups.find(row => row.market === market), last = state.history.filter(row => row.market === market).slice(0, 12);
      panel.innerHTML = `<h3>${escape(names[market])} · 自动前向对照</h3><p class="empty-tip">三个独立账户各1000虚拟USD；AI评审不交易、不参与收益排名。持有基准只计算。现有自主跑单不受本开关影响。</p>
        <label class="backtest-toolbar">模型选择 <select data-model-selection><option value="random-free">随机选一个当前目录中的免费模型，并冻结本组</option><option value="fixed">手动指定具体模型 ID</option></select></label>
        <label class="backtest-toolbar" data-fixed-model-row hidden>固定模型 ID <input type="text" data-fixed-model maxlength="160" value="${escape(group?.model || '')}" placeholder="例如 provider/model:free" autocomplete="off" style="max-width:100%;min-width:0"></label>
        <div class="backtest-toolbar"><span>全局调度：${state.enabled ? '已启用' : '关闭'} · 每小时最多一轮 · UTC共享剩余额度 ${payload.budget.remaining}/24</span>
        <button type="button" class="tab" data-global>${state.enabled ? '暂停全部对照' : '启用整点调度'}</button><button type="button" class="tab" data-rebuild>${group ? '按当前自选重建' : '冻结当前自选建立对照'}</button>
        ${group ? `<button type="button" class="tab" data-pause>${group.paused ? '恢复此市场' : '暂停此市场'}</button><button type="button" class="tab" data-report>比较三个账户</button>` : ''}<button type="button" class="tab" data-refresh>刷新状态</button></div>
        <p>${group ? `冻结标的：${group.instruments.map(escape).join(' / ')} · 本组冻结模型 ${escape(group.model)} · ${group.paused ? '此市场已暂停' : '等待轮转'}` : '尚未创建对照；只选管理员已核验自选，最多5个，不跨市场补位。'}</p>
        ${group?.excluded?.length ? `<details><summary>未纳入的自选及原因</summary>${group.excluded.map(row => `<p>${escape(row)}</p>`).join('')}</details>` : ''}
        <p class="empty-tip">随机只在建组时发生：从 OpenRouter 当前免费文本模型目录选一个具体模型并冻结，三账户共用；目录不可用时不建组。恢复后最早下个整点；来源过期或能力不足整轮等待，不调用模型。低于20笔平仓不提供可靠胜率或排名。失败请求不退还额度。</p>
        <div data-auto-status role="status"></div><ol>${last.map(row => `<li>${escape(row.at)} · ${escape(row.instrument)} · ${escape({running:'执行中',completed:'已记录',waiting:'等待',failed:'失败',cancelled:'已取消'}[row.status] || row.status)} · ${escape(row.reason || '')}</li>`).join('') || '<li>暂无轮次记录</li>'}</ol>`;
      const status = panel.querySelector('[data-auto-status]');
      const modelSelection=panel.querySelector('[data-model-selection]'),fixedModelRow=panel.querySelector('[data-fixed-model-row]');
      modelSelection.value='random-free';fixedModelRow.hidden=true;
      modelSelection.onchange=()=>{fixedModelRow.hidden=modelSelection.value!=='fixed';};
      const post = async (path, body) => {
        panel.querySelectorAll('button').forEach(b => b.disabled = true);
        try {
          const result = await fetch('/api/ai-runners/comparisons/automatic/' + path, {method:'POST',headers:headers(),body:JSON.stringify(body),signal:controller.signal});
          const response = await result.json(); if (!result.ok || !response.success) throw new Error((response.reason || '操作失败') + (response.excluded?.map(row => '；' + row.instrument + '：' + row.reason).join('') || ''));
          if(seq !== version || !visible())return;
          await refresh(market);
        } catch (error) { if(error.name !== 'AbortError') status.textContent = error.message; }
        finally { if(seq===version)panel.querySelectorAll('button').forEach(b => b.disabled = false); }
      };
      panel.querySelector('[data-global]').onclick = () => { if (state.enabled || window.confirm('启用新增对照整点调度？共用UTC每日24次模型请求额度，可能产生模型费用，只允许模拟订单。')) post('control',{enabled:!state.enabled}); };
      panel.querySelector('[data-rebuild]').onclick = () => {
        const selection=modelSelection.value,model=panel.querySelector('[data-fixed-model]').value.trim();
        if(selection==='fixed'&&(!model || model==='openrouter/free' || model==='openrouter/auto')){status.textContent='请填写具体模型 ID；不能使用自动路由。';return;}
        if (!window.confirm('按当前管理员自选冻结最多5个标的？旧对照账户、持仓和历史保留，不再调度旧组。')) return;
        let pinned=[];try{pinned=JSON.parse(localStorage.getItem('mm-watchlist-pins-v1') || '[]');}catch{}
        post('rebuild',{market,pinned,modelSelection:selection,...(selection==='fixed'?{model}:{})});
      };
      if(group){panel.querySelector('[data-pause]').onclick=()=>post('control',{market,paused:!group.paused});
        panel.querySelector('[data-report]').onclick=()=>fetch('/api/ai-runners/comparisons/'+encodeURIComponent(group.groupId),{signal:controller.signal}).then(r=>r.json()).then(data=>{
          if(seq===version && visible() && data.success && window.compareAiRunners){
            const ids=new Set(data.data.runnerIds);
            document.querySelectorAll('[data-ai-compare-id]').forEach(input=>input.checked=ids.has(input.value));
            window.compareAiRunners();
          }
        }).catch(error=>{status.textContent=error.message;});}
      panel.querySelector('[data-refresh]').onclick = () => refresh(market);
      if (!payload.featureEnabled) panel.querySelectorAll('button:not([data-refresh])').forEach(b => b.disabled = true);
    } catch (error) { if(error.name !== 'AbortError' && seq === version) panel.textContent = '自动对照：' + error.message; }
  }
  window.addEventListener('mm-workspace-context',()=>{if(!visible()){controller?.abort();version++;}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){controller?.abort();version++;}});
  window.MoneyMoneyAutomaticComparison = { refresh };
})();
