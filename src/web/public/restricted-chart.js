(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./restricted-strategy.js'):root.MoneyRestrictedStrategy,typeof module==='object'&&module.exports?require('./chart-analysis.js'):root.MoneyChartAnalysis,root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MoneyRestrictedChart=api;})(typeof window==='undefined'?globalThis:window,(engine,analysis,root)=>{
 'use strict';
 const identity=v=>'restricted:'+v.id+':'+v.hash;
 const key=c=>JSON.stringify([c.market,c.instrument,c.timeframe,c.workspace]);
 const views=new Map(),allowed=()=>root.mm_isLoggedIn===true&&root.mm_isGuest!==true;
 function conditionText(c){if(!c.op)return '未配置过滤条件';if(c.children)return c.op+'['+c.children.map(conditionText).join('；')+']='+c.state;if(c.child)return 'NOT('+conditionText(c.child)+')='+c.state;return c.op+'('+String(c.left??'数据不足')+', '+String(c.right??'数据不足')+')='+c.state;}
 function evaluate(version,bars,context){
  const empty=reason=>({points:[],reason});
  try{
   if(context.authorized!==true)return empty('私人策略仅限管理员');
   const d=engine.validate(version.definition);
   if(!/^strategy_[a-f0-9-]{36}$/.test(version.id)||!/^[a-f0-9]{64}$/.test(version.hash)||!Number.isSafeInteger(version.version)||version.version<1||version.interpreterVersion!==engine.version)throw Error('策略版本身份不可核验');
   if(d.market!==context.market||version.market!==context.market||!['stocks','crypto'].includes(context.market)||!String(context.instrument||'').startsWith(context.market==='stocks'?'stock:':'crypto:'))return empty('策略或标的市场不匹配');
   if(d.timeframe!==context.timeframe)return empty('策略周期与当前图表不匹配，请选择对应周期');
   if(!context.source||(!context.historical&&context.sourceFresh!==true))return empty('来源缺失或过期，停止更新自定义研究点位');
   const now=context.now??Date.now(),asOf=context.asOf??now;if(!Number.isFinite(now)||!Number.isFinite(asOf))throw Error('图表时点无效');
   const cutoff=Math.min(now,asOf),result=engine.evaluate(d,bars,cutoff),byTime=new Map(bars.map((b,i)=>[b.time,i]));
   const signals=result.points.map(p=>{const explanation=result.observations[p.index];return {...p,index:byTime.get(p.time),side:p.direction,strategy:identity(version),strategyVersion:version.hash,label:d.name+' v'+version.version,reason:d.name+' v'+version.version+' · 已完成K线条件满足；仅研究，不创建订单',condition:'入场 '+conditionText(explanation.entry)+' · 过滤 '+conditionText(explanation.filter)+' · 退出 '+conditionText(explanation.exit),conditionExplanation:explanation,evidenceRefs:context.evidenceRefs||[]};});
   const points=analysis.buildStrategyChartPoints({...context,bars,signals,live:false,asOf:cutoff,costBps:2*(d.costs.feeBps+d.costs.slippageBps)});
   return {points,reason:result.reason||(points.length?`v${version.version} · ${points.length} 个已确认研究点位；仅已完成K线`:'当前完整数据未触发此版本，或指标仍在暖机')};
  }catch(error){return empty(error.message||'策略条件无法核验');}
 }
 function clear(view){view.controller?.abort();view.controller=null;view.selected=null;view.choices.replaceChildren();view.status.textContent='未选择私人策略；不自动采集、监控或下单';}
 function render(options){
  if(!options.host)return;
  let view=views.get(options.kind);
  if(view&&view.host!==options.host){clear(view);view.panel.remove();views.delete(options.kind);view=null;}
  if(!view){
   const doc=options.host.ownerDocument,panel=doc.createElement('details');panel.dataset.restrictedChart='';panel.className='chart-strategy-entry';
   panel.innerHTML='<summary>已保存的私人研究策略</summary><p>手动选择固定版本，只绘制已完成K线；不会加入跑单或提醒。定义在研究工作区创建。</p><button type="button" data-restricted-load>读取当前市场定义</button><button type="button" data-restricted-clear>移除研究点位</button><div data-restricted-choices></div><p data-restricted-status role="status"></p>';
   options.host.append(panel);view={host:options.host,panel,choices:panel.querySelector('[data-restricted-choices]'),status:panel.querySelector('[data-restricted-status]'),options,selected:null,controller:null,key:key(options.getContext())};views.set(options.kind,view);clear(view);
   const current=()=>allowed()&&!doc.hidden&&view.panel.isConnected&&key(view.options.getContext())===view.key;
   panel.querySelector('[data-restricted-clear]').onclick=()=>{clear(view);view.options.onChange();};
   panel.querySelector('[data-restricted-load]').onclick=async()=>{
    if(!current())return;view.controller?.abort();const controller=new AbortController();view.controller=controller;const captured=view.key,ctx=view.options.getContext();view.choices.replaceChildren();view.status.textContent='正在读取私人版本…';
    try{const response=await root.fetch('/api/strategies/definitions?'+new URLSearchParams({market:ctx.market}),{credentials:'same-origin',cache:'no-store',signal:controller.signal});const body=await response.json();if(controller.signal.aborted||!current()||view.key!==captured)return;if(!response.ok||!body.success||body.market!==ctx.market||!Array.isArray(body.data))throw Error(body.reason||'策略目录不可用');
     for(const row of body.data){if(row.market!==ctx.market||row.definition?.market!==ctx.market)throw Error('策略目录市场不一致');engine.validate(row.definition);}
     for(const row of body.data){const button=doc.createElement('button');button.type='button';button.dataset.restrictedChoice='';button.textContent=row.definition.name+' · v'+row.version+' · '+row.definition.timeframe;button.onclick=()=>{if(!current())return;view.selected=JSON.parse(JSON.stringify(row));view.status.textContent='已固定 v'+row.version+' · Hash '+row.hash;view.options.onChange();};view.choices.append(button);}
     view.status.textContent=body.data.length?'选择版本后只影响当前图表；后续保存新版本不自动替换':'当前市场尚无私人策略定义，请在研究工作区创建';
    }catch(error){if(!controller.signal.aborted&&current()){view.choices.replaceChildren();view.status.textContent=error.message||'策略目录请求失败';}}finally{if(view.controller===controller)view.controller=null;}
   };
  }
  view.options=options;const next=key(options.getContext());if(view.key!==next){clear(view);view.key=next;}view.panel.hidden=!allowed();if(!allowed())clear(view);
 }
 function enabled(kind){const v=views.get(kind);return allowed()&&v?.selected?[identity(v.selected)]:[];}
 function label(id){if(!allowed())return '';for(const v of views.values())if(v.selected&&identity(v.selected)===id)return v.selected.definition.name+' v'+v.selected.version;return '';}
 function points(kind,bars,context){const v=views.get(kind);if(!v?.selected||!allowed())return {points:[],reason:'未选择私人研究策略'};if(v.key!==key(context)){clear(v);return {points:[],reason:'图表上下文已变化，请重新选择版本'};}const result=evaluate(v.selected,bars,{...context,authorized:true});v.status.textContent=result.reason;return result;}
 if(root.document){root.addEventListener('mm-workspace-context',()=>{for(const v of views.values()){v.controller?.abort();if(!allowed()||v.key!==key(v.options.getContext()))clear(v);v.panel.hidden=!allowed();}});root.document.addEventListener('visibilitychange',()=>{if(root.document.hidden)for(const v of views.values())v.controller?.abort();});root.addEventListener('pagehide',()=>{for(const v of views.values())clear(v);});}
 return {evaluate,render,enabled,points,label};
});
