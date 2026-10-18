(function(root){
  'use strict';
  const views=new WeakMap();
  let ready=null,pending=null;
  const current=options=>options.host?.isConnected&&options.isCurrent?.()!==false;
  async function implementation(){
    if(ready)return ready;
    if(!pending)pending=Promise.resolve(root.MoneyWorkspaceModules.ensure('chartResearch')).then(()=>{
      const api=root.MoneyChartResearchControls;
      if(!api||api===lazy)throw Error('研究工具未加载，请重试');
      ready=api;root.MoneyChartResearchControls=lazy;return api;
    }).finally(()=>{pending=null;});
    return pending;
  }
  function render(options){
    const host=options.host;if(!host)return;
    let view=views.get(host);
    if(ready){view?.panel.remove();views.delete(host);return ready.render(options);}
    if(view){view.options=options;return;}
    const doc=host.ownerDocument,panel=doc.createElement('details'),summary=doc.createElement('summary'),status=doc.createElement('p'),retry=doc.createElement('button');
    panel.className='chart-research-panel';panel.dataset.chartResearch='';panel.dataset.chartResearchLazy='';
    summary.textContent='策略研究 · 参数实验 / 质量矩阵 / 共振冲突';
    status.textContent='展开时加载研究工具；不会调用模型或提交订单。';status.setAttribute('role','status');
    retry.type='button';retry.textContent='重试加载研究工具';retry.hidden=true;
    panel.append(summary,status,retry);host.append(panel);view={options,panel,pending:false};views.set(host,view);
    const load=async()=>{
      if(view.pending||!panel.isConnected||!panel.open||!current(view.options))return;
      const key=view.options.key;view.pending=true;retry.hidden=true;status.textContent='正在加载研究工具…';
      try{
        const api=await implementation();
        if(!current(view.options)||view.options.key!==key||!panel.open){status.textContent='上下文已经变化；请重新展开当前图表研究。';return;}
        const hadFocus=panel.contains(doc.activeElement);
        panel.remove();views.delete(host);api.render(view.options);
        const mounted=host.querySelector('[data-chart-research]');if(mounted){mounted.open=true;if(hadFocus)mounted.querySelector('summary')?.focus({preventScroll:true});}
      }catch(error){if(panel.isConnected){status.textContent='研究工具加载失败；行情与点位仍可使用。';retry.hidden=false;}}
      finally{view.pending=false;}
    };
    panel.addEventListener('toggle',()=>{if(panel.open)void load();});retry.onclick=load;
  }
  async function openPointLifecycle(options){
    if(!current(options))return;
    try{const api=await implementation();if(current(options))return api.openPointLifecycle(options);}
    catch(error){if(current(options)){let status=options.host.querySelector('[data-lifecycle-load-error]');if(!status){status=options.host.ownerDocument.createElement('p');status.dataset.lifecycleLoadError='';status.setAttribute('role','status');options.host.append(status);}status.textContent='生命周期工具加载失败；请再次点击重试。';}}
  }
  const lazy={render,openPointLifecycle};root.MoneyChartResearchControls=lazy;
})(window);
