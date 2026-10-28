(function(root){'use strict';
 let panel,controller,key='';
 const scope=()=>{const shell=document.getElementById('market-workspace-shell');return {market:shell?.dataset.marketScope||'',workspace:shell?.dataset.workspace||''};};
 const active=()=>root.mm_isLoggedIn===true&&root.mm_isGuest!==true&&scope().market==='stocks'&&scope().workspace==='research-lab'&&!document.hidden;
 function sync(){const next=JSON.stringify(scope());if(next!==key||!active()){controller?.abort();controller=null;key=next;if(panel)panel.querySelector('[data-output]').textContent='';}if(panel)panel.hidden=!active();}
 async function request(url,body){
  if(!active())return;controller?.abort();const current=controller=new AbortController(),context=key;
  const token=document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('mm_csrf='));
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:current.signal,headers:{'content-type':'application/json',...(token?{'x-csrf-token':decodeURIComponent(token.slice(8))}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const result=await response.json();if(current.signal.aborted||context!==key||!active())return;if(!response.ok||result.success===false)throw Error(result.reason||'历史标的池请求失败');
  panel.querySelector('[data-output]').textContent=JSON.stringify(result.data,null,2);
 }
 function install(){
  const host=document.getElementById('mm-research-lab');if(!host||panel)return;panel=document.createElement('details');panel.className='mm-data-assets';panel.dataset.historicalUniverse='';
  panel.innerHTML='<summary>历史标的池证据</summary><p>使用已保存的股票成员证据；来源声明、观察和抓取时间均保留。未知行业及退市状态不推算，不能证明观察间成员未变。</p><label>已保存证据 ID <input data-evidence-id maxlength="200"></label> <label>截止时点（含时区） <input data-asof placeholder="2025-01-01T00:00:00Z"></label> <button type="button" data-capture>保存固定观察</button> <button type="button" data-list>读取截止时点已保存记录</button><pre data-output style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto" aria-live="polite"></pre>';
  const output=panel.querySelector('[data-output]'),error=e=>{if(e.name!=='AbortError'&&active())output.textContent=e.message;};
  panel.querySelector('[data-capture]').onclick=()=>{const evidenceId=panel.querySelector('[data-evidence-id]').value.trim(),asOf=panel.querySelector('[data-asof]').value.trim();if(!evidenceId||!asOf){output.textContent='请填写证据 ID 和带时区截止时点';return;}request('/api/research/historical-universes',{market:'stocks',evidenceId,asOf,requestId:root.crypto.randomUUID()}).catch(error);};
  panel.querySelector('[data-list]').onclick=()=>{const asOf=panel.querySelector('[data-asof]').value.trim();if(!asOf){output.textContent='请填写截止时点';return;}request('/api/research/historical-universes?'+new URLSearchParams({asOf})).catch(error);};
  host.append(panel);sync();
 }
 function initialize(){install();const shell=document.getElementById('market-workspace-shell');if(shell)new MutationObserver(()=>{install();sync();}).observe(shell,{attributes:true,attributeFilter:['data-market-scope','data-workspace']});root.addEventListener('mm-workspace-context',()=>{install();sync();});document.addEventListener('visibilitychange',sync);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})(window);
