(() => {
  'use strict';
  let root,controller,contextKey='',plan=null,job=null;
  const scope=()=>{const s=document.getElementById('market-workspace-shell');return {market:s?.dataset.marketScope||'',instrument:s?.dataset.instrument||'',workspace:s?.dataset.workspace||''};};
  const active=()=>window.mm_isLoggedIn===true&&window.mm_isGuest!==true&&scope().workspace==='research-lab';
  const esc=v=>String(v??'未知').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function sync(){
    const key=JSON.stringify(scope());
    if(key!==contextKey||!active()){controller?.abort();contextKey=key;plan=null;job=null;if(root){root.querySelector('[data-assets-result]').replaceChildren();root.querySelector('[data-assets-plan]').replaceChildren();root.querySelector('[data-assets-jobs]').replaceChildren();}}
    if(root)root.hidden=!active();
  }
  async function request(url,body){
    if(!active()||document.hidden)return null;
    controller?.abort();controller=new AbortController();const signal=controller.signal,key=JSON.stringify(scope());
    const token=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('mm_csrf='));
    const response=await fetch(url,{signal,credentials:'same-origin',cache:'no-store',...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'content-type':'application/json',...(token?{'x-csrf-token':decodeURIComponent(token.slice(8))}:{})}});
    const value=await response.json();
    if(signal.aborted||key!==JSON.stringify(scope())||!active())return null;
    if(!response.ok||value.success===false)throw Error(value.reason||'数据资产请求失败');
    return value;
  }
  async function run(work){try{await work();}catch(error){if(error.name!=='AbortError'&&active())root.querySelector('[data-assets-result]').textContent=error.message;}}
  const currentInput=()=>({...scope(),timeframe:root.querySelector('[name=timeframe]').value});
  function renderPlan(){
    const host=root.querySelector('[data-assets-plan]');if(!plan){host.replaceChildren();return;}
    host.innerHTML=`<p>来源：${esc(plan.provider)} · 请求上限 ${esc(plan.estimates.maxRequests)} · 估计存储 ${esc(plan.estimates.storageBytes)} B · 最多 ${esc(plan.estimates.maxRows)} 根</p><p>${esc(plan.estimates.reason)}</p><p>${esc(plan.retention)} · 预览有效至 ${esc(plan.expiresAt)}</p><small>计划 Hash：${esc(plan.hash)}</small><p data-assets-job role="status">${job?esc(job.status+' · '+(job.reason||'')):'尚未确认；未启动采集'}</p><button type="button" data-assets-confirm>确认范围与预算并启动</button><button type="button" data-assets-status>刷新任务状态</button>${['pause','resume','cancel'].map((action,i)=>`<button type="button" data-assets-control="${action}">${['暂停','恢复','取消'][i]}</button>`).join('')}`;
    host.querySelector('[data-assets-confirm]').onclick=()=>run(async()=>{if(!plan||!active()||!window.confirm('确认按以上范围、请求预算及保留政策创建采集任务？'))return;const value=await request(`/api/data/collection-plans/${encodeURIComponent(plan.id)}/confirm`,{hash:plan.hash});if(value){job=value.data;renderPlan();}});
    host.querySelector('[data-assets-status]').onclick=()=>run(async()=>{if(!plan)return;const value=await request(`/api/data/collection-plans/${encodeURIComponent(plan.id)}`);if(value){job=value.data.job||null;renderPlan();}});
    host.querySelectorAll('[data-assets-control]').forEach(button=>button.onclick=()=>run(async()=>{if(!plan||!active())return;if(button.dataset.assetsControl==='cancel'&&!window.confirm('取消此采集任务？已发布历史保留。'))return;const value=await request(`/api/data/collection-plans/${encodeURIComponent(plan.id)}/control`,{action:button.dataset.assetsControl});if(value){job=value.data;renderPlan();}}));
  }
  function install(){
    const lab=document.getElementById('mm-research-lab');if(!lab||root)return;
    root=document.createElement('details');root.dataset.dataAssets='';root.className='mm-data-assets';
    root.innerHTML='<summary>数据资产与采集计划</summary><p>仅管理员 · 只读取本地目录；预览后确认才启动采集。不自动扩大标的范围。</p><label>周期 <select name="timeframe"><option value="1d">1日</option><option value="5m">5分钟</option><option value="15m">15分钟</option><option value="1h">1小时</option><option value="snapshot">链快照</option></select></label><button type="button" data-assets-load>读取当前标的覆盖</button><div data-assets-result role="status"></div><form data-assets-form><label>开始（UTC）<input name="from" type="date" required></label><label>结束（UTC，不包含）<input name="to" type="date" required></label><button type="button" data-assets-preview>预览请求与存储</button></form><div data-assets-plan></div>';
    lab.append(root);window.MoneyResearchAssistance?.installRecovery(root,request,run,scope);
    const historyButton=document.createElement('button');historyButton.type='button';historyButton.dataset.assetsHistory='';historyButton.textContent='读取当前标的采集计划';root.querySelector('[data-assets-form]').before(historyButton);
    const history=document.createElement('div');history.dataset.assetsJobs='';historyButton.after(history);
    historyButton.onclick=()=>run(async()=>{const s=currentInput();const value=await request('/api/data/collection-plans?'+new URLSearchParams({market:s.market,instrument:s.instrument,timeframe:s.timeframe}));if(!value)return;history.replaceChildren();if(!value.data.length)history.textContent='当前身份与周期没有保存的采集计划';value.data.forEach(saved=>{const button=document.createElement('button');button.type='button';button.dataset.assetsRestore='';button.textContent=`${saved.from} → ${saved.to} · ${saved.job?.status||'未确认'}`;button.onclick=()=>{plan=saved;job=saved.job||null;renderPlan();};history.append(button);});});
    root.querySelector('[data-assets-load]').onclick=()=>run(async()=>{
      const s=currentInput();if(!s.instrument)throw Error('请先从右侧选择身份明确的当前市场标的');
      const value=await request('/api/data/assets?'+new URLSearchParams({market:s.market,instrument:s.instrument,timeframe:s.timeframe}));if(!value)return;
      const d=value.data;
      root.querySelector('[data-assets-result]').innerHTML=`<p>${esc(value.reason)} · ${esc(value.dataStatus)}</p><p>容量 ${esc(d.capacity.usageBytes)} / ${esc(d.capacity.quotaBytes)} B · ${esc(d.capacity.quotaState)}</p><div class="mm-data-assets-table"><table><thead><tr><th>周期</th><th>目录记录 / 已核验记录</th><th>覆盖开始</th><th>覆盖结束</th><th>状态</th></tr></thead><tbody>${d.coverage.map(r=>`<tr><td>${esc(r.timeframe)}</td><td>${esc(r.rowCount)} / ${esc(r.availableRowCount??'未核验')}</td><td>${esc(r.periodStart)}</td><td>${esc(r.periodEnd)}</td><td>${esc(r.dataStatus||r.status)} ${esc(r.reason||'')}${r.unavailablePartitionCount?' · 不可用快照 '+esc(r.unavailablePartitionCount):''}</td></tr>`).join('')}</tbody></table></div>${d.partitions.map(p=>`<p>${esc(p.source)} · 来源抓取 ${esc(p.fetchedAt)} · 发布 ${esc(p.publishedAt)} · ${esc(p.timezone)} · 复权 ${esc(p.adjustment)}<br><small>Hash ${esc(p.contentHash)} · ${esc(p.unitsReason||'单位见分区证据')}</small></p>`).join('')}${(d.optionSnapshots||[]).map(p=>`<p>${esc(p.source)} · 期权链 ${esc(p.tradeDate)} · 来源抓取 ${esc(p.fetchedAt)}<br><small>Hash ${esc(p.contentHash)} · ${esc(p.id)}</small></p>`).join('')}<p>来源差异 ${esc(d.discrepancies?.length||0)} · 修订 ${esc(d.revisions.length)}；详细依据保留在分区和修订记录。</p>`;
    });
    root.querySelector('[data-assets-preview]').onclick=()=>run(async()=>{const form=root.querySelector('form');if(!form.reportValidity())return;plan=null;job=null;renderPlan();const value=await request('/api/data/collection-plans',{...currentInput(),from:root.querySelector('[name=from]').value+'T00:00:00Z',to:root.querySelector('[name=to]').value+'T00:00:00Z'});if(value){plan=value.data;renderPlan();}});
    root.querySelector('form').onsubmit=e=>e.preventDefault();
    root.querySelectorAll('input,select').forEach(input=>input.addEventListener('change',()=>{controller?.abort();plan=null;job=null;history.replaceChildren();renderPlan();}));
    sync();
  }
  function initialize(){install();const shell=document.getElementById('market-workspace-shell');if(shell)new MutationObserver(()=>{install();sync();}).observe(shell,{attributes:true,attributeFilter:['data-market-scope','data-workspace','data-instrument']});window.addEventListener('mm-workspace-context',()=>{install();sync();});document.addEventListener('visibilitychange',()=>{if(document.hidden)controller?.abort();});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
