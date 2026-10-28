(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let contextKey = '', controller = new AbortController();
  const scope = () => {
    const shell = document.getElementById('market-workspace-shell');
    return {market:shell?.dataset.marketScope || '',workspace:shell?.dataset.workspace || '',instrument:shell?.dataset.instrument || ''};
  };
  const nowValue = () => {
    const value = new Date();
    value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
    return value.toISOString().slice(0,16);
  };
  function sync() {
    const context = scope(), host = document.getElementById('mm-research-lab');
    let panel = document.getElementById('research-statistics-audit');
    const key = [context.market,context.workspace,context.instrument,window.mm_isGuest,window.mm_isLoggedIn].join('|');
    if (key === contextKey) return;
    contextKey = key;controller.abort();controller = new AbortController();
    if (context.workspace !== 'research-lab' || !['stocks','options','crypto','prediction'].includes(context.market) || !window.mm_isLoggedIn || window.mm_isGuest) {
      if (panel) panel.hidden = true;
      return;
    }
    if (!host) return;
    if (!panel) {panel = document.createElement('section');panel.id = 'research-statistics-audit';panel.className = 'mm-action-center';host.append(panel);}
    panel.hidden = false;
    panel.innerHTML = '<h3>研究统计审计台</h3><p><b>市场</b> '+esc(context.market)+' · 只读取已保存实验及追加式尝试台账；不重新优化、不剔除失败参数。</p><form data-statistics-form><div class="compact-controls"><label>已保存实验 ID <input data-statistics-id maxlength="200" required></label><label>截止时间 <input type="datetime-local" data-statistics-asof required value="'+nowValue()+'"></label><button type="submit">审计统计证据</button></div></form><p role="status" data-statistics-status></p><div data-statistics-output></div>';
    const signal = controller.signal, status = panel.querySelector('[data-statistics-status]');
    async function request(url, options) {
      const token = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('mm_csrf='));
      const response = await fetch(url,{...options,signal,credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(token?{'x-csrf-token':decodeURIComponent(token.slice(8))}:{})}});
      const body = await response.json();signal.throwIfAborted();
      if (!response.ok || body.success === false) throw new Error(body.reason || '请求失败 ' + response.status);
      return body;
    }
    panel.querySelector('[data-statistics-form]').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget,button = form.querySelector('button'),id = form.querySelector('[data-statistics-id]').value.trim(),asOf = form.querySelector('[data-statistics-asof]').value;
      button.disabled = true;status.textContent = '正在读取固定实验并计算保守统计区间…';
      try {
        const body = await request('/api/research/statistics/audit-preview',{method:'POST',body:JSON.stringify({market:context.market,experimentId:id,asOf:new Date(asOf).toISOString()})}),data = body.data;
        status.textContent = body.reason;
        const confidence = data.inference.blockBootstrap.confidence95;
        panel.querySelector('[data-statistics-output]').innerHTML = '<article><h4>'+esc(data.dataStatus)+' · '+data.sample.trades+' 笔交易</h4><p>尝试 '+(data.ledger.attempts??'未知')+' · 唯一配置 '+(data.ledger.uniqueConfigurations??'未知')+' · 失败 '+data.ledger.failedTrials+' · 当前实验匹配 '+esc(data.ledger.currentTrialMatched)+'</p><p>原始 p 值 '+(data.inference.naivePValue===null?'未知':data.inference.naivePValue.toFixed(6))+' · 多重检验校正 '+(data.inference.multipleTesting.adjustedPValue===null?'未知':data.inference.multipleTesting.adjustedPValue.toFixed(6))+'</p><p>块重采样 95% 区间 '+(confidence?confidence[0].toFixed(4)+'%–'+confidence[1].toFixed(4)+'%':'不可用')+'</p><p>样本依赖 '+esc(data.dependence.status)+' · 选择偏差 '+esc(data.selectionBias.status)+'</p><p>'+esc(data.dependence.reason)+'</p><p>'+esc(data.selectionBias.reason)+'</p><p>'+data.warnings.map(esc).join('；')+'</p><details><summary>尝试台账（包含失败）</summary>'+(data.ledger.trials.length?'<div class="mm-table-scroll"><table><thead><tr><th>尝试</th><th>状态</th><th>策略</th><th>配置 Hash</th></tr></thead><tbody>'+data.ledger.trials.map(trial=>'<tr><td>'+esc(trial.id)+'</td><td>'+esc(trial.status)+'</td><td>'+esc(trial.strategyVersion||'未知')+'</td><td>'+esc(trial.configurationHash)+'</td></tr>').join('')+'</tbody></table></div>':'<p>旧记录没有可核验尝试台账；数量保持未知。</p>')+'</details><p>内容 Hash '+esc(data.contentHash)+'</p></article>';
      } catch (error) {if (error.name !== 'AbortError') status.textContent = error.message;}
      finally {button.disabled = false;}
    };
  }
  function init() {
    const shell = document.getElementById('market-workspace-shell');
    if (shell) new MutationObserver(sync).observe(shell,{attributes:true,attributeFilter:['data-market-scope','data-workspace','data-instrument']});
    window.addEventListener('mm-workspace-context',sync);
    let attempts = 0;const timer = setInterval(() => {sync();if (window.mm_isLoggedIn || ++attempts >= 20) clearInterval(timer);},500);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
