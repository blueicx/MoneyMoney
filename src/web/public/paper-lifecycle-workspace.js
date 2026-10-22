(function(root){
 'use strict';
 let panel,controller,revision=0;
 const shell=()=>root.document.getElementById('market-workspace-shell');
 const active=()=>root.mm_isLoggedIn===true&&!root.mm_isGuest&&shell()?.dataset.marketScope==='stocks'&&shell()?.dataset.workspace==='paper';
 const text=(tag,value)=>{const node=root.document.createElement(tag);node.textContent=value;return node;};
 function install(){
  const host=root.document.getElementById('paper-tab');if(!host)return;
  if(!panel){
   const style=root.document.createElement('style');style.textContent='[data-paper-lifecycle]{font-size:13px;line-height:1.65;overflow-wrap:anywhere}[data-paper-lifecycle] summary{cursor:pointer;font-weight:700;min-height:28px}[data-paper-lifecycle] label{display:flex;gap:8px;align-items:center;flex-wrap:wrap}[data-paper-lifecycle] input{flex:1 1 180px;min-width:0;max-width:100%;min-height:40px;padding:8px 10px;background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);border-radius:8px}[data-paper-lifecycle] button{min-height:40px;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary);color:var(--text);padding:8px 12px}[data-paper-lifecycle] :is(button,input,summary):focus-visible{outline:2px solid var(--purple);outline-offset:3px}[data-paper-lifecycle] button:active{transform:scale(.97)}[data-lifecycle-output]>p{margin:10px 0;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary)}[data-lifecycle-output] small{display:block;color:var(--text-secondary)}@media(max-width:600px){[data-paper-lifecycle] button{min-height:44px}[data-paper-lifecycle] summary{min-height:44px}}';root.document.head.append(style);
   panel=root.document.createElement('details');panel.dataset.paperLifecycle='';panel.style.cssText='margin:12px 0;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card);color:var(--text)';
   panel.innerHTML='<summary>股票模拟账户 · 公司行动与股息对账</summary><p>只读取指定账户。核对后手动确认，才处理目录中有来源证据的公司行动；不会新增订单、模型调用或自动修改跑单配置。拆股后已有成交、身份或付款证据不足时保留待核验。</p><label>明确账户 ID <input data-lifecycle-account value="unified-paper-ledger" maxlength="200" aria-label="公司行动账户ID"></label><div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button type="button" class="tab" data-lifecycle-read>读取生命周期（只读）</button><button type="button" class="tab" data-lifecycle-reconcile>确认后对账</button></div><p role="status" data-lifecycle-status>尚未读取账户；不自动对账。</p><div data-lifecycle-output></div>';
   host.append(panel);panel.querySelector('[data-lifecycle-read]').onclick=()=>load(false);panel.querySelector('[data-lifecycle-reconcile]').onclick=()=>load(true);
   panel.querySelector('[data-lifecycle-account]').oninput=invalidate;
  }
  panel.hidden=!active();
 }
 function invalidate(){revision++;controller?.abort();if(panel){panel.querySelectorAll('button').forEach(b=>b.disabled=false);panel.querySelector('[data-lifecycle-output]').replaceChildren();panel.querySelector('[data-lifecycle-status]').textContent='上下文已变更；请重新读取指定账户。';}}
 async function load(write){
  if(!active()||root.document.hidden)return;
  const id=panel.querySelector('[data-lifecycle-account]').value.trim();
  if(!id||id.length>200){panel.querySelector('[data-lifecycle-status]').textContent='请输入明确的账户 ID。';return;}
  if(write&&!root.confirm('按已有来源证据对账此股票模拟账户？这可能调整持仓或股息现金；不创建订单，不修改跑单配置。'))return;
  controller?.abort();controller=new AbortController();const captured=++revision,signal=controller.signal,buttons=panel.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
  const status=panel.querySelector('[data-lifecycle-status]'),out=panel.querySelector('[data-lifecycle-output]');status.textContent=write?'正在核对来源与账户…':'正在读取私人账户…';out.replaceChildren();
  try{
   const csrf=root.document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('mm_csrf='));
   const response=await root.fetch('/api/paper/accounts/'+encodeURIComponent(id)+(write?'/reconcile':'/lifecycle?market=stocks'),{credentials:'same-origin',cache:'no-store',signal,...(write?{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':decodeURIComponent(csrf.slice(8))}:{})},body:JSON.stringify({market:'stocks'})}:{})});
   const result=await response.json();if(signal.aborted||revision!==captured||!active())return;
   if(!response.ok||!result.success||result.market!=='stocks')throw Error(result.reason||'账户生命周期读取失败');
   const data=result.data||{};status.textContent=result.reason||'已读取指定账户；仅显示股票公司行动，不代表来源覆盖完整。';
   out.append(text('p','已入账股息 '+(Number.isFinite(data.performance?.corporateIncome)?data.performance.corporateIncome+' USD':'未核验')+' · 不计入交易平仓胜率'));
   for(const row of data.receivables||[]){const item=text('p',`${row.instrumentId} · ${row.amount} ${row.currency} · ${row.status==='paid'?'模拟现金已入账':row.paymentAt?'等待付款 / 币种核验':'等待付款日证据'} · ${row.reason||''}`);item.append(text('small',' · 来源 '+row.source+' · 除息 '+row.effectiveAt+(row.paymentAt?' · 付款 '+row.paymentAt:'')));item.style.overflowWrap='anywhere';out.append(item);}
   for(const row of data.events||[])out.append(text('p',`${row.instrument} · ${row.kind} · ${row.status} · ${row.effectiveAt} · ${row.source} · ${row.reason}`));
   if(!(data.events?.length||data.receivables?.length))out.append(text('p','暂无已关联公司行动；没有记录不代表没有发生。'));
  }catch(error){if(revision===captured&&active()&&error.name!=='AbortError')status.textContent=error.message||'读取失败，请重试';}
  finally{if(revision===captured)buttons.forEach(b=>b.disabled=false);}
 }
 root.MoneyPaperLifecycle={install};
 root.addEventListener('mm-workspace-context',()=>{invalidate();if(panel)panel.querySelectorAll('button').forEach(b=>b.disabled=false);install();});
 root.addEventListener('mm-workspace-module-ready',install);install();
})(window);
