(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let contextKey = '', controller = new AbortController();
  const context = () => {
    const shell = document.getElementById('market-workspace-shell');
    return {market:shell?.dataset.marketScope || '',workspace:shell?.dataset.workspace || '',instrument:shell?.dataset.instrument || ''};
  };
  const stockInstrument = value => /^stock:us:[A-Z][A-Z0-9.-]{0,14}$/.test(value)
    ? value
    : /^us[A-Z][A-Z0-9.-]{0,14}$/.test(value)
      ? 'stock:us:' + value.slice(2).replace(/\.(OQ|N)$/, '')
      : null;
  const localNow = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  };
  const assumptionsTemplate = {
    forecastYears:2,
    segments:[{id:'core',label:'Core business',initialRevenuePct:100,growthPct:[8,8]}],
    cogsPctRevenue:[55,55],
    operatingExpensePctRevenue:[30,30],
    depreciationPctRevenue:[4,4],
    capexPctRevenue:[5,5],
    workingCapitalPctRevenue:20,
    receivablePctRevenue:15,
    inventoryPctRevenue:20,
    payablePctRevenue:15,
    interestRatePct:5,
    taxRatePct:21,
    debtRepaymentByYear:[0,0],
    financingScenarios:[{id:'base',label:'Base financing',equityIssuanceByYear:[0,0],debtIssuanceByYear:[0,0],dividendPayoutPct:[0,0]}],
  };

  function syncPanel() {
    const scope = context(), parent = document.querySelector('[data-workspace-id="fundamentals"] .collapse-body');
    let panel = document.getElementById('three-statement-model');
    const key = [scope.market,scope.workspace,scope.instrument,window.mm_isGuest,window.mm_isLoggedIn].join('|');
    if (key === contextKey) return;
    contextKey = key;
    controller.abort();
    controller = new AbortController();
    const instrument = stockInstrument(scope.instrument);
    if (scope.market !== 'stocks' || scope.workspace !== 'fundamentals' || !instrument || !window.mm_isLoggedIn || window.mm_isGuest) {
      if (panel) panel.hidden = true;
      return;
    }
    if (!parent) return;
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'three-statement-model';
      panel.className = 'mm-action-center';
      parent.append(panel);
    }
    panel.hidden = false;
    panel.innerHTML =
      '<h3>三表联动财务建模台</h3><p><b>当前标的</b> '+esc(instrument)+'</p><p>只加载两份已保存、Hash 可核验的利润表和资产负债表证据。用户假设在服务端计算，任一情景未通过现金勾稽或资产负债平衡时不输出完整三表。</p>' +
      '<form data-three-statement-form><div class="compact-controls"><label>利润表证据 ID <input data-three-income required maxlength="200"></label><label>资产负债表证据 ID <input data-three-balance required maxlength="200"></label><label>模型截止时间 <input type="datetime-local" data-three-asof required value="'+localNow()+'"></label></div>' +
      '<label>用户假设（JSON；不能包含客户端报表结果） <textarea data-three-assumptions rows="16" spellcheck="false"></textarea></label><p><button type="submit">服务端联动计算</button></p><p role="status" data-three-status></p></form><div data-three-output></div>';
    panel.querySelector('[data-three-assumptions]').value = JSON.stringify(assumptionsTemplate,null,2);
    const signal = controller.signal;
    const status = panel.querySelector('[data-three-status]');
    async function request(url, options) {
      const token = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('mm_csrf='));
      const response = await fetch(url,{...options,signal,credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(token?{'x-csrf-token':decodeURIComponent(token.slice(8))}:{})}});
      const body = await response.json();signal.throwIfAborted();
      if (!response.ok || body.success === false) throw new Error(body.reason || '请求失败 ' + response.status);
      return body;
    }
    panel.querySelector('[data-three-statement-form]').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget,button = form.querySelector('button[type="submit"]');
      let assumptions;
      try {assumptions = JSON.parse(form.querySelector('[data-three-assumptions]').value);} catch {status.textContent = '用户假设不是有效 JSON。';return;}
      const asOfValue = form.querySelector('[data-three-asof]').value;
      const payload = {market:'stocks',instrument,asOf:new Date(asOfValue).toISOString(),evidence:{income:form.querySelector('[data-three-income]').value.trim(),balance:form.querySelector('[data-three-balance]').value.trim()},assumptions};
      button.disabled = true;status.textContent = '正在核验证据并计算三表勾稽…';
      try {
        const body = await request('/api/research/three-statement/preview',{method:'POST',body:JSON.stringify(payload)}),data = body.data;
        status.textContent = body.reason;
        panel.querySelector('[data-three-output]').innerHTML = '<article><h4>'+esc(data.status)+' · 内容 Hash '+esc(data.contentHash)+'</h4><p>起点资产 '+data.opening.assets.toFixed(2)+' · 负债 '+data.opening.liabilities.toFixed(2)+' · 权益 '+data.opening.equity.toFixed(2)+' · 差额 '+data.opening.balanceDifference.toFixed(2)+'</p>'+data.scenarios.map(scenario=>'<details><summary>'+esc(scenario.label)+' · '+esc(scenario.status)+'</summary>'+scenario.checks.map(check=>'<p>'+esc(check.id)+' · '+esc(check.reason)+(check.year?' · 第'+check.year+'年':'')+'</p>').join('')+(scenario.incomeStatements.length?'<div class="mm-table-scroll"><table><thead><tr><th>年</th><th>收入</th><th>EBIT</th><th>净利</th><th>现金</th><th>资产负债差额</th></tr></thead><tbody>'+scenario.incomeStatements.map((income,index)=>'<tr><td>'+income.year+'</td><td>'+income.revenue.toFixed(2)+'</td><td>'+income.ebit.toFixed(2)+'</td><td>'+income.netIncome.toFixed(2)+'</td><td>'+scenario.balanceSheets[index].cash.toFixed(2)+'</td><td>'+scenario.balanceSheets[index].balanceDifference.toFixed(6)+'</td></tr>').join('')+'</tbody></table></div>':'<p>平衡校验未通过：本情景不展示完整三表。</p>')+'</details>').join('')+'</article>';
      } catch (error) { if (error.name !== 'AbortError') status.textContent = error.message; }
      finally { button.disabled = false; }
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
