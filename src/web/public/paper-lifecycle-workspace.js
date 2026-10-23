(function(root){
 'use strict';
 let panel,controller,revision=0,preview=null;
 const shell=()=>root.document.getElementById('market-workspace-shell');
 const active=()=>root.mm_isLoggedIn===true&&!root.mm_isGuest&&shell()?.dataset.marketScope==='stocks'&&shell()?.dataset.workspace==='paper';
 const text=(tag,value)=>{const node=root.document.createElement(tag);node.textContent=value;return node;};
 function install(){
  const host=root.document.getElementById('paper-tab');if(!host)return;
  if(!panel){
   const style=root.document.createElement('style');style.textContent='[data-paper-lifecycle]{font-size:13px;line-height:1.65;overflow-wrap:anywhere}[data-paper-lifecycle] summary{cursor:pointer;font-weight:700;min-height:28px}[data-paper-lifecycle] label{display:flex;gap:8px;align-items:center;flex-wrap:wrap}[data-paper-lifecycle] input{flex:1 1 180px;min-width:0;max-width:100%;min-height:40px;padding:8px 10px;background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);border-radius:8px}[data-paper-lifecycle] button{min-height:40px;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary);color:var(--text);padding:8px 12px}[data-paper-lifecycle] :is(button,input,summary):focus-visible{outline:2px solid var(--purple);outline-offset:3px}[data-paper-lifecycle] button:active{transform:scale(.97)}[data-lifecycle-output]>p{margin:10px 0;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary)}[data-lifecycle-output] small{display:block;color:var(--text-secondary)}@media(max-width:600px){[data-paper-lifecycle] button{min-height:44px}[data-paper-lifecycle] summary{min-height:44px}}';root.document.head.append(style);
   panel=root.document.createElement('details');panel.dataset.paperLifecycle='';panel.style.cssText='margin:12px 0;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card);color:var(--text)';
   panel.innerHTML='<summary>股票模拟账户 · 公司行动与股息对账</summary><p>只读取指定账户。核对后手动确认，才处理目录中有来源证据的公司行动；不会新增订单、模型调用或自动修改跑单配置。拆股晚到时校验历史后重放成本，原成交不改写；历史身份、时间边界或付款证据不足时仍待核验。</p><label>明确账户 ID <input data-lifecycle-account value="unified-paper-ledger" maxlength="200" aria-label="公司行动账户ID"></label><div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button type="button" class="tab" data-lifecycle-read>读取生命周期（只读）</button><button type="button" class="tab" data-lifecycle-reconcile>确认后对账</button></div><p role="status" data-lifecycle-status>尚未读取账户；不自动对账。</p><div data-lifecycle-output></div>';
   host.append(panel);const previewButton=text('button','只读预览对账影响');previewButton.type='button';previewButton.className='tab';previewButton.dataset.lifecyclePreview='';panel.querySelector('[data-lifecycle-reconcile]').before(previewButton);previewButton.onclick=()=>load('preview');panel.querySelector('[data-lifecycle-reconcile]').disabled=true;panel.querySelector('[data-lifecycle-read]').onclick=()=>load(false);panel.querySelector('[data-lifecycle-reconcile]').onclick=()=>load(true);
   panel.querySelector('[data-lifecycle-account]').oninput=invalidate;
  }
  panel.hidden=!active();
 }
 function invalidate(){revision++;preview=null;controller?.abort();if(panel){panel.querySelectorAll('button').forEach(b=>b.disabled=false);panel.querySelector('[data-lifecycle-reconcile]').disabled=true;panel.querySelector('[data-lifecycle-output]').replaceChildren();panel.querySelector('[data-lifecycle-status]').textContent='上下文已变更；请重新预览指定账户。';}}
 async function load(mode){
  const write=mode===true,isPreview=mode==='preview';
  if(!active()||root.document.hidden)return;
  const id=panel.querySelector('[data-lifecycle-account]').value.trim();
  if(!id||id.length>200){panel.querySelector('[data-lifecycle-status]').textContent='请输入明确的账户 ID。';return;}
  if(write&&(!preview||preview.accountId!==id||Date.now()>preview.expiresAt)){preview=null;panel.querySelector('[data-lifecycle-reconcile]').disabled=true;panel.querySelector('[data-lifecycle-status]').textContent='请先读取有效对账预览。';return;}
  if(write&&!root.confirm('确认预览中的来源、现金、数量与成本变化并对账此股票模拟账户？不创建订单，不修改跑单配置。'))return;
  const proof=preview;preview=null;
  controller?.abort();controller=new AbortController();const captured=++revision,signal=controller.signal,buttons=panel.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
  const status=panel.querySelector('[data-lifecycle-status]'),out=panel.querySelector('[data-lifecycle-output]');status.textContent=write?'正在核对来源与账户…':'正在读取私人账户…';out.replaceChildren();
  try{
   const csrf=root.document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('mm_csrf='));
   const response=await root.fetch('/api/paper/accounts/'+encodeURIComponent(id)+(write?'/reconcile':isPreview?'/reconcile/preview':'/lifecycle?market=stocks'),{credentials:'same-origin',cache:'no-store',signal,...(write||isPreview?{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':decodeURIComponent(csrf.slice(8))}:{})},body:JSON.stringify({market:'stocks',...(write?{previewHash:proof.hash,previewedAt:proof.previewedAt}:{})})}:{})});
   const result=await response.json();if(signal.aborted||revision!==captured||!active())return;
   if(!response.ok||!result.success||result.market!=='stocks')throw Error(result.reason||'账户生命周期读取失败');
   const data=result.data||{};if(isPreview){
    if(data.accountId!==id)throw Error('预览账户身份不一致');preview=data.blockedReason?null:data;status.textContent=data.blockedReason||'只读预览已完成；核对下面的变化后才能确认。';
    out.append(text('p',`现金 ${data.before.cash} → ${data.after.cash} USD · 已实现 ${data.before.realizedPnl} → ${data.after.realizedPnl} USD`));
    for(const row of data.changes.positions)out.append(text('p',`${row.instrumentId} · 数量 ${row.before?.quantity??0} → ${row.after.quantity} · 单位成本 ${row.before?.averageEntryPrice??'未知'} → ${row.after.averageEntryPrice}`));
    out.append(text('p',`原成交${data.changes.ordersUnchanged?'不变':'存在变化，需人工核验'} · 待核验 ${data.pending} · 有效至 ${new Date(data.expiresAt).toLocaleString()}`));
    for(const row of data.actions)out.append(text('p',`${row.instrument} · ${row.kind} · ${row.effectiveAt} · 来源 ${row.source}`));out.append(text('small',data.reason));return;
   }status.textContent=result.reason||'已读取指定账户；仅显示股票公司行动，不代表来源覆盖完整。';
   out.append(text('p','已入账股息 '+(Number.isFinite(data.performance?.corporateIncome)?data.performance.corporateIncome+' USD':'未核验')+' · 不计入交易平仓胜率'));
   for(const row of data.receivables||[]){const item=text('p',`${row.instrumentId} · ${row.amount} ${row.currency} · ${row.status==='paid'?'模拟现金已入账':row.paymentAt?'等待付款 / 币种核验':'等待付款日证据'} · ${row.reason||''}`);item.append(text('small',' · 来源 '+row.source+' · 除息 '+row.effectiveAt+(row.paymentAt?' · 付款 '+row.paymentAt:'')));item.style.overflowWrap='anywhere';out.append(item);}
   for(const row of data.events||[])out.append(text('p',`${row.instrument} · ${row.kind} · ${row.status} · ${row.effectiveAt} · ${row.source} · ${row.reason}`));
   for(const row of data.costAdjustments||[])out.append(text('p',`${row.instrumentId} · 成交 ${row.orderId} · 原始已实现 ${row.originalPnlUsd} USD → 拆股成本修正 ${row.adjustedPnlUsd} USD · 证据 ${(row.actionIds||[]).join(' / ')} · 仅成本归因，现金及原成交不变`));
   if(!(data.events?.length||data.receivables?.length))out.append(text('p','暂无已关联公司行动；没有记录不代表没有发生。'));
  }catch(error){if(revision===captured&&active()&&error.name!=='AbortError')status.textContent=error.message||'读取失败，请重试';}
  finally{if(revision===captured){buttons.forEach(b=>b.disabled=false);panel.querySelector('[data-lifecycle-reconcile]').disabled=!preview;}}
 }
 root.MoneyPaperLifecycle={install};
 root.addEventListener('mm-workspace-context',()=>{invalidate();install();});
 root.addEventListener('mm-workspace-module-ready',install);install();
})(window);
