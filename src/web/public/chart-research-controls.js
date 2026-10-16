(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./chart-research.js'):root.MoneyChartResearch,typeof module==='object'&&module.exports?require('./chart-strategies.js'):root.MoneyChartStrategies);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MoneyChartResearchControls=api;})(typeof window!=='undefined'?window:globalThis,function(research,library){
  'use strict';
  const views=new WeakMap(),fmt=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(2):'未知';
  function render(options){
    const host=options.host;if(!host||!research)return;
    let view=views.get(host);
    if(!view){
      const doc=host.ownerDocument,node=(tag,text)=>{const e=doc.createElement(tag);if(text!=null)e.textContent=text;return e;};
      const panel=node('details');panel.dataset.chartResearch='';panel.className='chart-research-panel';panel.append(node('summary','策略研究 · 参数实验 / 质量矩阵 / 共振冲突'));
      panel.append(node('p','仅分析当前已加载数据，点击才计算。不会调用模型、修改策略或提交订单；结果会随当前数据与参数变化。'));
      const tools=node('div');tools.className='chart-research-tools';
      const strategy=node('select');strategy.setAttribute('aria-label','参数实验策略');for(const s of library.STRATEGY_CATALOG){const option=node('option',s.label);option.value=s.id;strategy.append(option);}
      const horizon=node('select');horizon.setAttribute('aria-label','观察期限');for(const n of [1,3,5,20]){const o=node('option','后续 '+n+' 根');o.value=n;horizon.append(o);}
      const cost=node('input');cost.type='number';cost.min='0';cost.max='1000';cost.step='1';cost.placeholder='未知成本';cost.setAttribute('aria-label','往返成本假设（基点）');
      const costLabel=node('label','往返成本 bps ');costLabel.append(cost);
      const grid=node('textarea');grid.setAttribute('aria-label','参数组 JSON（最多12组）');grid.rows=3;grid.value='[{}]';
      const buttons=[['quality','质量矩阵'],['agreement','共振与冲突'],['lab','运行参数实验'],['timeframes','多周期时点证据']].map(([key,label])=>{const button=node('button',label);button.type='button';button.dataset['research'+key[0].toUpperCase()+key.slice(1)]='';tools.append(button);return button;});
      tools.append(strategy,horizon,costLabel);panel.append(tools,node('label','参数组 JSON（最多12组；不修改图表参数）'),grid);
      const output=node('div');output.setAttribute('role','status');output.dataset.researchOutput='';panel.append(output);host.append(panel);
      view={options,panel,output,revision:0};views.set(host,view);
      const table=(headers,rows)=>{const wrap=node('div'),el=node('table'),head=node('thead'),tr=node('tr');wrap.className='mm-table-scroll';for(const h of headers)tr.append(node('th',h));head.append(tr);el.append(head);const body=node('tbody');for(const cells of rows){const row=node('tr');for(const c of cells){const cell=node('td');if(c?.nodeType)cell.append(c);else cell.textContent=String(c);row.append(cell);}body.append(row);}el.append(body);wrap.append(el);return wrap;};
      const link=id=>{const button=node('button','查看点位');button.type='button';button.dataset.researchPoint=id;button.onclick=()=>view.options.onSelect?.(id);return button;};
      buttons.forEach((button,i)=>button.onclick=async()=>{
        if(view.options.isCurrent?.()===false){view.revision++;output.textContent='上下文已经变化或工作区不可见，请等待当前图表后重新分析。';return;}
        const revision=++view.revision,input=view.options.getInput?.()||{};output.replaceChildren();
        output.append(node('p','数据截至 '+(input.bars?.length?new Date(input.bars.at(-1).time).toISOString():'未知')+' · 来源 '+(input.source||'未知')+'；本次为手动快照分析，不随行情自动重算。'));
        const label=library.STRATEGY_CATALOG.find(s=>s.id===strategy.value)?.label||strategy.value;
        try{
          if(i===0){const result=research.buildQualityMatrix(input);
            output.append(node('p','质量矩阵 · 仅当前启用策略的已确认点位；重叠观察不等于独立成交。'));
            output.append(table(['策略 / 版本','方向 / 周期 / 期限 / 入场前20根状态','成熟 / 待观察 / 无效','毛 / 净均值 %','胜率','说明 / 点位'],result.groups.map(g=>{
              const detail=node('div',g.reason);if(g.pointIds.length)detail.append(link(g.pointIds[0]));
              const performance=node('span',fmt(g.meanReturnPct)+' / '+fmt(g.meanNetReturnPct));performance.dataset.researchHeat=g.meanNetReturnPct==null?'unknown':g.meanNetReturnPct>0?'positive':g.meanNetReturnPct<0?'negative':'flat';
              return [(library.STRATEGY_CATALOG.find(s=>s.id===g.strategy)?.label||g.strategy)+' / '+g.strategyVersion,g.side+' / '+g.timeframe+' / '+g.horizon+' / '+({rising:'上升>1%',falling:'下降<-1%',flat:'区间±1%',unknown:'未知'}[g.regime]),g.samples+' / '+g.pending+' / '+g.invalid,performance,g.winRate==null?'样本或成本不足':fmt(g.winRate*100)+'%',detail];
            })));
            if(!result.groups.length)output.append(node('p','暂无可统计的已确认点位；请启用策略并等待有效数据及观察期限。'));
          }else if(i===1){const result=research.explainSignalAgreement(input);
            output.append(node('p','同根策略可能相关；不生成综合概率或独立证据数量。'));
            output.append(table(['K线时间','确认状态','买 / 卖','家族','解释'],result.groups.slice(-80).map(g=>{const detail=node('div',g.conflict?'方向冲突，不自动选边':'同向信号，不代表更高胜率');for(const id of [...g.buy,...g.sell])detail.append(link(id));return [new Date(g.time).toISOString(),g.status,g.buy.length+' / '+g.sell.length,g.families.join('、'),detail];})));
            if(!result.groups.length)output.append(node('p','当前没有可比较的点位。'));
          }else if(i===2){
            const parameters=JSON.parse(grid.value);button.disabled=true;output.textContent='正在分析保存于当前页面的数据…';
            const result=await research.evaluateParameterLab({...input,strategy:strategy.value,parameterSets:parameters,horizon:Number(horizon.value),costBps:cost.value.trim()===''?null:Number(cost.value)});
            if(view.revision!==revision||!host.isConnected||view.options.isCurrent?.()===false)return;output.replaceChildren(node('p',label+' · '+result.reason));
            if(result.dataHash)output.append(node('p','数据 SHA256 '+result.dataHash+' · 配置 SHA256 '+result.configurationHash));
            if(result.evidencePack){const download=node('button','导出本次研究证据 JSON（含当前标的历史数据）');download.type='button';download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='chart-research-'+result.dataHash.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};output.append(download);}
            output.append(table(['参数','区间','成熟 / 跨界剔除','毛 / 净均值 %','说明'],result.rows.flatMap(row=>row.splits.map(s=>[JSON.stringify(row.parameters),s.name,s.samples+' / '+s.purged,fmt(s.meanReturnPct)+' / '+fmt(s.meanNetReturnPct),s.reason]))));
          }else{
            const result=research.alignTimeframeEvidence(input);
            output.append(node('p','光标时点 '+(Number.isFinite(input.at)?new Date(input.at).toISOString():'未知')+'；只读取已打开的同标的图表，不额外请求行情。末根没有收线证据则保持未知。'));
            output.append(table(['周期','已收线时间 / 价格','说明'],result.rows.map(row=>[row.timeframe,row.point?new Date(row.point.closeTime).toISOString()+' / '+fmt(row.point.value):'不可用',row.reason])));
            if(!result.rows.length)output.append(node('p','请先打开同标的多周期图，并定位光标或选择历史日期。'));
          }
        }catch(error){if(view.revision===revision)output.textContent=error instanceof SyntaxError?'参数组 JSON 无效；没有改变当前策略。':error.message||'研究失败';}
        finally{button.disabled=false;}
      });
    }
    if(view.options.key!==options.key){view.revision++;view.output.textContent='标的、周期或参数已变化；请重新分析当前数据。';}
    view.options=options;
  }
  return {render};
});
