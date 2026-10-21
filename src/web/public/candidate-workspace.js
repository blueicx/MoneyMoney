(function(root){'use strict';
 const views=new Set();
 function scope(){const n=document.getElementById('market-workspace-shell');return [n?.dataset.marketScope,n?.dataset.workspace].join('|');}
 const active=()=>root.mm_isLoggedIn===true&&root.mm_isGuest!==true&&scope()==='stocks|research-lab';
 function install(host,getObservation){
  if(host.querySelector('[data-candidate-panel]'))return;
  const panel=document.createElement('details');panel.className='chart-strategy-entry';panel.dataset.candidatePanel='';
  panel.innerHTML='<summary>候选证据与人工晋级</summary><p>仅明确关联当前观察的固定版本。历史模型、手动走势和提交的收益数字不能代替样本外与实际成交证明；不足时保留待核验，不启用监控。</p><button type="button" data-candidate-create>从当前观察保存草稿并核验</button><button type="button" data-candidate-list>读取本市场候选</button><div data-candidate-choices></div><button type="button" data-candidate-proof>重新读取服务端证据</button><button type="button" data-candidate-evaluate>重新核验门槛</button><button type="button" data-candidate-approve>人工批准</button><button type="button" data-candidate-retire>人工退役并保留历史</button><p data-candidate-status role="status"></p><div data-candidate-detail></div>';
  host.append(panel);const q=s=>panel.querySelector(s),v={host,panel,getObservation,selection:getObservation()?.id,row:null,controller:null,key:scope(),busy:false,nonce:null};views.add(v);
  function sync(){const yes=active();panel.hidden=root.mm_isGuest===true||root.mm_isLoggedIn!==true;for(const action of ['create','list','proof','evaluate','approve','retire'])q('[data-candidate-'+action+']').disabled=!yes||v.busy||!['create','list'].includes(action)&&!v.row||action==='approve'&&v.row?.status!=='candidate';}
  v.sync=sync;
  async function request(path,body){
   if(!active()||document.hidden)return null;const captured=v.key,controller=new AbortController();v.controller?.abort();v.controller=controller;
   const csrf=document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('mm_csrf='));
   const r=await root.fetch('/api/research/candidates'+path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':decodeURIComponent(csrf.slice(8))}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),result=await r.json();
   if(controller.signal.aborted||v.key!==captured||!active())return null;
   if(!r.ok||!result.success||result.market!=='stocks')throw Error(result.reason||result.error||'候选请求失败');return result.data;
  }
  const run=fn=>async()=>{if(!active()||v.busy)return;v.busy=true;sync();try{await fn();}catch(e){if(e.name!=='AbortError'&&active())q('[data-candidate-status]').textContent=e.message;}finally{v.busy=false;sync();}};
  function display(row,proof){
   v.row=row;const out=q('[data-candidate-detail]');out.replaceChildren();
   function add(text){const p=document.createElement('p');p.textContent=text;out.append(p);}
   add(`${row.id} · ${row.instrument||'未关联标的'} · ${row.status}`);add('固定策略版本 '+row.version);
   add('观察引用 '+(row.evidenceRef?.observationId||'未关联')+'；旧批准不代表当前证据有效');
   for(const reason of proof?.reasons||row.gate?.reasons||[])add(reason);
   add('评估证据 Hash '+(row.gate?.evidenceHash||'未核验')+'；批准证据 Hash '+(row.approvalEvidenceHash||'未批准'));
   for(const h of row.history||[])add(new Date(h.at).toLocaleString()+' · '+h.action+(h.reason?' · '+h.reason:''));
   q('[data-candidate-status]').textContent=proof?.passed?'服务端证据达标，仍需人工批准':'仅记录核验状态；没有启动监控或创建订单';sync();
  }
  q('[data-candidate-create]').onclick=run(async()=>{
   const o=getObservation();if(!o||o.market!=='stocks')throw Error('请先选择明确的股票前向观察');
   if(!root.confirm(`将观察 ${o.id}\n${o.instrument}\n版本 ${o.strategyHash}\n保存为私人候选草稿并核验；不启动监控、不创建订单。确认？`))return;
   v.nonce??='candidate_'+root.crypto.randomUUID();
   const row=await request('',{id:v.nonce,market:'stocks',instrument:o.instrument,version:o.strategyHash,metrics:{},evidenceRef:{observationId:o.id}});if(!row)return;
   v.nonce=null;display(row);const evaluated=await request('/'+encodeURIComponent(row.id)+'/evaluate',{market:'stocks'});if(evaluated)display(evaluated);
  });
  q('[data-candidate-list]').onclick=run(async()=>{const rows=await request('?market=stocks');if(!rows)return;q('[data-candidate-choices]').replaceChildren();q('[data-candidate-status]').textContent=rows.length?'选择明确候选查看证据':'本市场尚无已保存候选';for(const row of rows){const b=document.createElement('button');b.type='button';b.textContent=`${row.instrument||'未关联'} · ${row.status} · ${row.id}`;b.onclick=run(async()=>{const proof=await request('/'+encodeURIComponent(row.id)+'/proof?market=stocks');if(proof)display(row,proof);});q('[data-candidate-choices]').append(b);}});
  q('[data-candidate-proof]').onclick=run(async()=>{const row=v.row;if(!row)return;const proof=await request('/'+encodeURIComponent(row.id)+'/proof?market=stocks');if(proof)display(row,proof);});
  for(const action of ['evaluate','approve','retire'])q('[data-candidate-'+action+']').onclick=run(async()=>{
   const row=v.row;if(!row)return;let reason;
   if(action==='approve'&&!root.confirm('重新核验服务端证据后人工批准该固定版本；不创建订单。确认？'))return;
   if(action==='retire'){reason=root.prompt('请输入退役原因（保留原审批与历史，不改变已有持仓）');if(!reason?.trim())return;}
   const data=await request('/'+encodeURIComponent(row.id)+'/'+action,{market:'stocks',...(reason?{reason}:{})});if(data)display(data);
  });sync();
 }
 function clear(v){v.controller?.abort();v.key=scope();v.selection=v.getObservation()?.id;v.row=null;v.nonce=null;v.panel.querySelector('[data-candidate-detail]').replaceChildren();v.panel.querySelector('[data-candidate-choices]').replaceChildren();v.panel.querySelector('[data-candidate-status]').textContent='';v.sync();}
 function sync(){for(const v of views){if(v.key!==scope()||!active()||v.selection!==v.getObservation()?.id)clear(v);v.sync();}}
 root.MoneyCandidateProof={install,selectionChanged(host){for(const v of views)if(v.host===host&&v.selection!==v.getObservation()?.id)clear(v);}};root.addEventListener('mm-workspace-context',sync);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const v of views)v.controller?.abort();});root.addEventListener('pagehide',()=>{for(const v of views)v.controller?.abort();});
})(window);
