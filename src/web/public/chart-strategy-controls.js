(function attach(root, factory) {
  const api=factory(typeof module==='object'&&module.exports?require('./chart-strategies.js'):root.MoneyChartStrategies);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MoneyChartStrategyControls=api;
})(typeof window!=='undefined'?window:globalThis,function(library){
  'use strict';
  const views=new WeakMap();
  function render(options){
    const {host}=options;
    if(!host||!library)return;
    let view=views.get(host);
    if(!view){
      const doc=host.ownerDocument,entries=new Map();
      view={options,entries};views.set(host,view);
      const node=(tag,text,className)=>{const el=doc.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
      for(const strategy of library.STRATEGY_CATALOG){
        const row=node('section',null,'chart-strategy-entry'),label=node('label'),toggle=node('input');
        toggle.type='checkbox';toggle.dataset.strategyId=strategy.id;toggle.setAttribute('aria-label',strategy.label+'策略开关');
        label.append(toggle,doc.createTextNode(' '+strategy.label));
        const detail=node('details'),summary=node('summary','参数与条件'),description=node('p',strategy.description),version=node('small',strategy.version),parameters=node('div',null,'chart-strategy-parameters'),inputs=new Map();
        detail.append(summary,description,version,parameters);
        for(const [key,spec] of Object.entries(strategy.parameters)){
          const field=node('label',spec.label+' '),input=node('input');
          input.type='number';input.min=spec.min;input.max=spec.max;input.step=spec.step;input.value=spec.default;
          input.dataset.strategyId=strategy.id;input.dataset.parameter=key;input.setAttribute('aria-label',strategy.label+' '+spec.label);
          field.append(input);parameters.append(field);inputs.set(key,input);
        }
        const status=node('small');status.dataset.strategyStatus=strategy.id;status.setAttribute('role','status');
        row.append(label,detail,status);host.append(row);entries.set(strategy.id,{toggle,inputs,status});
      }
      host.addEventListener('change',event=>{
        const input=event.target,id=input.dataset?.strategyId,entry=view.entries.get(id);
        if(!entry)return;
        if(input.type==='checkbox'){view.options.onChange?.({id,enabled:input.checked});return;}
        const field=input.dataset.parameter;
        if(!entry.inputs.has(field))return;
        const previous=view.options.parameters?.[id]||{};
        const result=library.normalizeParameters(id,{...previous,[field]:input.value});
        if(!result.valid){entry.status.textContent=result.reason;input.value=previous[field]??library.STRATEGY_CATALOG.find(s=>s.id===id).parameters[field].default;return;}
        view.options.onChange?.({id,parameters:result.parameters});
      });
    }
    view.options=options;
    for(const strategy of library.STRATEGY_CATALOG){
      const entry=view.entries.get(strategy.id),enabled=options.enabled?.[strategy.id]===true;
      entry.toggle.checked=enabled;
      for(const [key,input] of entry.inputs)if(host.ownerDocument.activeElement!==input){
        const value=options.parameters?.[strategy.id]?.[key]??strategy.parameters[key].default;
        if(input.value!==String(value))input.value=value;
      }
      const status=options.statuses?.[strategy.id];
      const text=status?.reason||(enabled?'等待当前标的 K 线与来源状态':'未启用；不会创建订单');
      if(entry.status.textContent!==text)entry.status.textContent=text;
      entry.status.dataset.state=status?.state||(enabled?'waiting':'disabled');
    }
  }
  return {render};
});
