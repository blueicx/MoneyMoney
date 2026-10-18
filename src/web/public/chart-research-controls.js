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
      const buttons=[['quality','质量矩阵'],['agreement','共振与冲突'],['lab','运行参数实验'],['timeframes','多周期时点证据'],['diagnostics','加载耗时诊断'],['audit','K线数据自检'],['regimes','策略环境档案'],['redundancy','策略重合对照'],['counterfactual','保存快照反事实'],['layout','点位布局自检']].map(([key,label])=>{const button=node('button',label);button.type='button';button.dataset['research'+key[0].toUpperCase()+key.slice(1)]='';tools.append(button);return button;});
      const basisButton=node('button','来源冲突与研究口径');basisButton.type='button';basisButton.dataset.researchBasis='';tools.append(basisButton);buttons.push(basisButton);
      const bookmarkButton=node('button','私人书签与批注');bookmarkButton.type='button';bookmarkButton.dataset.researchBookmarks='';tools.append(bookmarkButton);buttons.push(bookmarkButton);
      tools.append(strategy,horizon,costLabel);panel.append(tools,node('label','参数组 JSON（最多12组；不修改图表参数）'),grid);
      const output=node('div');output.setAttribute('role','status');output.dataset.researchOutput='';panel.append(output);host.append(panel);
      view={options,panel,output,basisButton,bookmarkButton,revision:0};views.set(host,view);
      const table=(headers,rows)=>{const wrap=node('div'),el=node('table'),head=node('thead'),tr=node('tr');wrap.className='mm-table-scroll';for(const h of headers)tr.append(node('th',h));head.append(tr);el.append(head);const body=node('tbody');for(const cells of rows){const row=node('tr');for(const c of cells){const cell=node('td');if(c?.nodeType)cell.append(c);else cell.textContent=String(c);row.append(cell);}body.append(row);}el.append(body);wrap.append(el);return wrap;};
      const link=id=>{const button=node('button','查看点位');button.type='button';button.dataset.researchPoint=id;button.onclick=()=>view.options.onSelect?.(id);return button;};
      buttons.forEach((button,i)=>button.onclick=async()=>{
        if(view.options.isCurrent?.()===false){view.revision++;output.textContent='上下文已经变化或工作区不可见，请等待当前图表后重新分析。';return;}
        view.auditAbort?.abort();view.auditAbort=null;
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
          }else if(i===3){
            const result=research.alignTimeframeEvidence(input);
            output.append(node('p','光标时点 '+(Number.isFinite(input.at)?new Date(input.at).toISOString():'未知')+'；只读取已打开的同标的图表，不额外请求行情。末根没有收线证据则保持未知。'));
            output.append(table(['周期','已收线时间 / 价格','说明 / 导航'],result.rows.map(row=>{const detail=node('div',row.reason);if(row.point&&view.options.onTimeframeNavigate){const jump=node('button','定位该周期已收线证据');jump.type='button';jump.dataset.timeframeNavigate=row.timeframe;jump.onclick=()=>{if(view.revision!==revision||view.options.isCurrent?.()===false)return;const result=view.options.onTimeframeNavigate({market:input.market,instrument:input.instrument,timeframe:row.timeframe,time:row.point.time,asOf:input.at});detail.append(node('p',result?'已定位已打开图表；视窗不自动追随最新':'该图表已关闭或数据已变化，未请求其他来源或跳到未来'));};detail.append(jump);}return [row.timeframe,row.point?new Date(row.point.closeTime).toISOString()+' / '+fmt(row.point.value):'不可用',detail];})));
            if(!result.rows.length)output.append(node('p','请先打开同标的多周期图，并定位光标或选择历史日期。'));
          }else if(i===4){
            const result=research.buildRequestDiagnostics(input);
            output.append(node('p',result.reason),table(['阶段','毫秒','数据口径'],result.stages.map(row=>[row.label,fmt(row.durationMs),row.historical?'历史采集耗时，非本次上游请求':'当前可观测阶段；未测得保持未知'])));
            output.append(node('p','本次最大可观测阶段：'+(result.stages.find(row=>row.key===result.bottleneck)?.label||'未知')+' · 请求 ID '+(result.requestId||'未提供')));
            output.append(node('p','本页面已观察脚本请求 '+fmt(result.page.scriptRequests)+' · 传输 '+fmt(result.page.scriptTransferBytes)+' 字节；只记录数量和大小，不记录URL、令牌或报文。最近REST耗时不代表推流延迟。'));
            const budget=research.evaluateChartBudgets(input);
            output.append(node('p',budget.reason),table(['阶段','当前 / 预算毫秒','诊断'],budget.stages.map(row=>[row.label,fmt(row.durationMs)+' / '+row.budgetMs,({within:'预算内',exceeded:'超过诊断预算',historical:'旧采集，不评价本次延迟',unmeasured:'未测量'}[row.state])])));
            const bundle=research.buildChartSupportBundle(input),preview=node('details'),summary=node('summary','脱敏问题包预览（不自动上传）');preview.append(summary,node('pre',JSON.stringify(bundle,null,2)));output.append(preview);
            const download=node('button','下载脱敏问题包');download.type='button';download.dataset.chartSupportDownload='';download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='moneymoney-chart-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};output.append(download);
          }else if(i===5){
            let result=research.auditChartData(input),calendarError=null;
            if(input.market==='stocks'&&result.gaps.length&&view.options.onSessionAudit){
              button.disabled=true;
              try{
                const controller=new AbortController();view.auditAbort=controller;
                const sessionAudit=await view.options.onSessionAudit({market:input.market,instrument:input.instrument,timeframe:input.timeframe,asOf:input.asOf??null,gaps:result.gaps.filter(g=>g.to>g.from).slice(0,32).map(({from,to})=>({from,to}))},{signal:controller.signal});
                if(view.revision!==revision||!host.isConnected||view.options.isCurrent?.()===false)return;
                result=research.auditChartData({...input,sessionAudit});
              }catch(error){calendarError=error.message||'日历来源检查失败';}
              if(view.revision!==revision||!host.isConnected||view.options.isCurrent?.()===false)return;
            }
            if(calendarError)output.append(node('p','日历分类不可用：'+calendarError+'；保留待核验间隔，不据此声称漏数。'));
            output.append(node('p',result.dataStatus+' · '+result.reason),node('p','检查 '+result.rows+' 根 · 异常OHLC '+result.invalidOhlc.length+' · 异常成交量 '+result.invalidVolumes.length+' · 重复时间 '+result.duplicateTimes.length+' · 无效/倒序时间 '+result.invalidTimes.length+' · 待核验间隔 '+result.gaps.length+'；未修复或覆盖任何记录。'));
            const coverage=research.buildLoadedCoverage(input);
            output.append(node('p','逐日覆盖 · '+coverage.reason),table(['UTC日期','记录 / 唯一时间','首 / 末来源K线时间','OHLC异常 / 来源缺口','状态'],coverage.days.slice(-100).map(row=>[row.date,row.records+' / '+row.uniqueTimes,row.firstTime==null?'当前加载范围未观察到记录，不证明本日应有成交':new Date(row.firstTime).toISOString()+' / '+new Date(row.lastTime).toISOString(),row.invalidOhlc+' / '+row.sourceReportedGaps,row.dataStatus])));
            if(coverage.days.length>100)output.append(node('p','仅展示最近100个UTC日期；缩小加载范围查看更早记录。'));
            for(const row of result.sessionIntervals.slice(0,32))output.append(node('p',new Date(row.from).toISOString()+' → '+new Date(row.to).toISOString()+' · '+row.reason+' · '+(row.sourceUrl||'来源未提供')));
            const issues=[...result.invalidOhlc.map(r=>({...r,type:'OHLC无效'})),...result.invalidVolumes.map(r=>({...r,type:'成交量无效'})),...result.duplicateTimes.map(r=>({...r,type:'重复时间'})),...result.invalidTimes.map(r=>({...r,type:r.reason})),...result.gaps.map(r=>({time:r.from,type:'时间间隔',reason:r.reason}))];
            output.append(table(['异常','K线时间','原因'],issues.slice(0,100).map(row=>[row.type,Number.isFinite(row.time)?new Date(row.time).toISOString():'未知',row.reason||'只读记录，保留原始数据'])));
            if(issues.length>100)output.append(node('p','仅列出前100项；缩小当前加载区间查看其余记录。'));
            if(view.options.onBackfill){for(const gap of result.gaps.slice(0,10)){
              const preview=research.buildGapBackfillPreview({...input,gap});if(!preview.request){output.append(node('p',preview.reason));continue;}
              const repair=node('button','预览回补 '+preview.request.from+' → '+preview.request.to);repair.type='button';repair.dataset.gapBackfill='';output.append(repair);
              repair.onclick=async()=>{if(view.revision!==revision||view.options.isCurrent?.()===false)return;repair.disabled=true;try{const result=await view.options.onBackfill(preview);if(view.revision===revision&&view.options.isCurrent?.()!==false)output.append(node('p',result?.reason||'没有创建回补任务。'));}catch(error){if(view.revision===revision)output.append(node('p',error.message||'回补请求失败'));}finally{repair.disabled=false;}};
            }}else if(result.gaps.length)output.append(node('p','管理员登录后可预览并确认回补；本次只读检查不创建任务。'));
          }else if(i===6){
            const result=research.describeStrategyRegimes(input);
            output.append(node('p','入场前20根已完成K线；波动为逐根标准差，非年化。未知流动性不靠成交量猜测。最多展示最近100条。'));
            output.append(table(['点位 / 版本','趋势 / 已知根数','收益标准差 % / 平均成交量','证据'],result.rows.slice(-100).map(row=>[row.strategy+' / '+row.strategyVersion,({rising:'上升',falling:'下降',flat:'区间',unknown:'未知'}[row.trend])+' / '+row.priorBars,fmt(row.volatilityPct)+' / '+fmt(row.averageVolume),link(row.pointId)])));
            if(!result.rows.length)output.append(node('p',result.reason||'当前没有可核验的已确认策略点位。'));
            const map=research.buildStrategyRegimeMap({...input,horizon:Number(horizon.value),costBps:cost.value.trim()===''?null:Number(cost.value)});
            output.append(node('p','环境表现地图 · '+map.reason),table(['策略 / 版本','方向 / 趋势 / 波动','成熟 / 待观察 / 不可用','毛 / 净均值 %','MFE / MAE %','说明'],map.groups.map(g=>[g.strategy+' / '+g.strategyVersion,g.side+' / '+g.trend+' / '+g.volatility,g.samples+' / '+g.pending+' / '+g.unavailable,fmt(g.meanReturnPct)+' / '+fmt(g.meanNetReturnPct),fmt(g.meanMfePct)+' / '+fmt(g.meanMaePct),g.reason])));
          }else if(i===7){
            const result=research.analyzeStrategyRedundancy(input);
            output.append(node('p',result.reason),table(['策略 / 版本对','同向重合 / 并集','Jaccard','反向冲突','各自独有'],result.pairs.map(row=>[row.left.strategy+' '+row.left.strategyVersion+' / '+row.right.strategy+' '+row.right.strategyVersion,row.overlap+' / '+row.union,fmt(row.jaccard),row.conflicts,row.leftOnly+' / '+row.rightOnly])));
            if(!result.pairs.length)output.append(node('p','至少需要两个明确策略版本的已确认点位；不会生成替代信号。'));
          }else if(i===8){
            button.disabled=true;const result=await research.evaluateCounterfactual({...input,horizon:Number(horizon.value),costBps:cost.value.trim()===''?null:Number(cost.value)});
            if(view.revision!==revision||!host.isConnected||view.options.isCurrent?.()===false)return;
            output.replaceChildren(node('p',result.reason));
            if(result.dataHash)output.append(node('p','快照 SHA256 '+result.dataHash+' · 配置 SHA256 '+result.configurationHash));
            output.append(table(['点位','状态 / 原因','不交易 %','信号毛 / 净 %'],result.rows.slice(-100).map(row=>[link(row.pointId),row.status+' / '+(row.reason||'仅收盘情景，无实际成交假设'),fmt(row.noTradeReturnPct),fmt(row.returnPct)+' / '+fmt(row.netReturnPct)])));
            if(result.evidencePack){const download=node('button','导出可重放快照 JSON（含当前标的数据）');download.type='button';download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='counterfactual-'+result.dataHash.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};output.append(download);}
          }else if(i===11){
            if(!view.options.onBookmark)return;button.disabled=true;const controller=new AbortController();view.auditAbort=controller;
            const current=()=>view.revision===revision&&host.isConnected&&view.options.isCurrent?.()!==false;
            let rows=await view.options.onBookmark(input,null,{signal:controller.signal});if(!current())return;
            const draw=()=>{
              output.replaceChildren(node('p','私人图表书签 · 保存日期、图层、可用视窗与批注；不是当时已知的数据证据，不修改跑单。'));
              const name=node('input');name.maxLength=80;name.dataset.bookmarkName='';name.setAttribute('aria-label','图表书签名称');name.placeholder='书签名称';
              const note=node('textarea');note.maxLength=4000;note.dataset.bookmarkNote='';note.setAttribute('aria-label','私人研究批注');note.placeholder='支持理由、反证或下次观察事项';
              const save=node('button','保存当前图表书签'),status=node('p');status.setAttribute('role','status');save.type='button';save.dataset.bookmarkSave='';output.append(name,note,save,status);
              save.onclick=async()=>{if(!current())return;if(!name.value.trim()){status.textContent='请填写书签名称。';return;}save.disabled=true;try{const row=await view.options.onBookmark(input,{kind:'save',name:name.value.trim(),note:note.value},{signal:controller.signal});if(current()){rows=[row,...rows];draw();}}catch(error){if(current()&&error.name!=='AbortError')status.textContent=error.message;}finally{save.disabled=false;}};
              for(const row of rows){const details=node('details'),summary=node('summary',row.name+' · '+row.timeframe),bookmark=row.filters?.chartBookmark;details.append(summary,node('p',bookmark?.note||'无批注'),node('p',bookmark?.viewReason||'仅恢复已保存配置'));const restore=node('button','恢复该书签');restore.type='button';restore.dataset.bookmarkRestore=row.id;details.append(restore);restore.onclick=async()=>{if(!current())return;restore.disabled=true;try{const result=await view.options.onBookmark(input,{kind:'restore',bookmark:row},{signal:controller.signal});if(current())status.textContent=result.reason;}catch(error){if(current())status.textContent=error.message;}finally{restore.disabled=false;}};if(row.deepLink){try{const href=new URL(row.deepLink);if(href.protocol==='https:'){const link=node('a','安全网页深链（需管理员登录）');link.href=href.href;link.rel='noopener noreferrer';details.append(link);}}catch{}}output.append(details);}
              if(!rows.length)output.append(node('p','当前标的与周期还没有私人书签。'));
            };draw();
          }else if(i===10){
            if(!view.options.onBasis){output.append(node('p','当前账户或工作区不能读取私人研究口径。'));return;}
            button.disabled=true;const controller=new AbortController();view.auditAbort=controller;
            const current=()=>view.revision===revision&&host.isConnected&&view.options.isCurrent?.()!==false;
            const draw=data=>{
              output.replaceChildren(node('p',data.reason),node('p','逐来源核对原始值，不平均、不解除隔离。旧分区字段单位未固定时显示未知，不从当前契约回填。'));
              for(const conflict of (data.conflicts||[]).slice(0,50)){output.append(node('p',conflict.sourceA+' ↔ '+conflict.sourceB+' · '+conflict.createdAt+' · '+conflict.reason),table(['来源时间','A原值','B原值','差异 %'],(conflict.evidence||[]).slice(0,100).map(e=>[e.timestamp,fmt(e.closeA),fmt(e.closeB),fmt(e.differencePct)])));}
              if(!data.conflicts?.length)output.append(node('p','本地暂无已记录来源差异；不代表来源已经全部一致核验。'));
              output.append(table(['来源 / 分区','发布时间 / 抓取时间','时区 / 复权 / 字段版本','字段单位 / 质量'],data.options.map(p=>[p.source+' / '+p.id,p.publishedAt+' / '+p.fetchedAt,p.timezone+' / '+p.adjustment+' / '+p.fieldVersion,Object.keys(p.units||{}).length?JSON.stringify(p.units):'未知单位 · '+(p.qualityValid?'目录质量合格':'目录质量不合格')])));
              const select=node('select');select.setAttribute('aria-label','本次研究分区');for(const p of data.options.filter(p=>p.status==='committed'&&p.qualityValid)){const option=node('option',p.source+' · '+p.id);option.value=p.id;select.append(option);}
              const reason=node('textarea');reason.dataset.basisReason='';reason.maxLength=1000;reason.setAttribute('aria-label','选择研究口径的原因');reason.placeholder='记录为何选择该来源和口径；不会替换当前图表';
              const save=node('button','记录研究口径（不修改行情）'),status=node('p');status.setAttribute('role','status');save.type='button';save.dataset.basisSave='';save.disabled=!select.options.length;output.append(select,reason,save,status);
              if(!select.options.length)status.textContent='没有已发布且目录质量合格的分区，不开放来源切换或生成替代数据。';
              save.onclick=async()=>{if(!current())return;if(!reason.value.trim()){status.textContent='请填写选择原因。';return;}save.disabled=true;
                try{const next=await view.options.onBasis(input,{revision:data.revision,partitionId:select.value,reason:reason.value.trim(),asOf:new Date(input.asOf??Date.now()).toISOString()},{signal:controller.signal});if(current())draw(next);}catch(error){if(current()&&error.name!=='AbortError')status.textContent=error.message;}finally{save.disabled=!select.options.length;}};
              output.append(node('p','研究口径历史（最新20条；不影响已有实验）'));
              for(const row of data.records.slice(-20))output.append(node('p',row.selectedAt+' · '+(row.source||row.id)+' · '+row.reason));
            };
            const data=await view.options.onBasis(input,null,{signal:controller.signal});if(current())draw(data);
          }else if(i===9){
            const result=research.auditChartLayout(input);output.append(node('p',result.dataStatus+' · '+result.reason),node('p','越界点位 '+result.outsideMarkers.length+' · 越界文字 '+result.outsideLabels.length+' · 可见标签重叠 '+result.overlaps.length+' · 未关联解释 '+result.unlinkedIds.length));
            output.append(node('pre',JSON.stringify({outsideMarkers:result.outsideMarkers,outsideLabels:result.outsideLabels,overlaps:result.overlaps,unlinkedIds:result.unlinkedIds},null,2)));
          }
        }catch(error){if(view.revision===revision)output.textContent=error instanceof SyntaxError?'参数组 JSON 无效；没有改变当前策略。':error.message||'研究失败';}
        finally{button.disabled=false;}
      });
    }
    if(view.options.key!==options.key){view.auditAbort?.abort();view.auditAbort=null;view.revision++;view.output.textContent='标的、周期或参数已变化；请重新分析当前数据。';}
    view.basisButton.hidden=!options.onBasis;
    view.bookmarkButton.hidden=!options.onBookmark;
    view.options=options;
  }
  function openPointLifecycle(options){
    const host=options.host;if(!host||options.isCurrent?.()===false)return;
    const doc=host.ownerDocument,input=options.input,p=input.point,origin=doc.activeElement;
    doc.querySelector('[data-point-lifecycle]')?.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Escape'}));
    const dialog=doc.createElement('dialog');dialog.dataset.pointLifecycle='';dialog.className='mm-point-lifecycle-drawer';dialog.setAttribute('aria-label','策略点位生命周期');
    const text=(tag,value)=>{const node=doc.createElement(tag);node.textContent=value;return node;},close=doc.createElement('button');close.type='button';close.textContent='关闭点位详情';dialog.append(close);
    const controller=new AbortController(),current=()=>dialog.isConnected&&host.isConnected&&options.isCurrent?.()!==false;
    let observer;const dismiss=()=>{controller.abort();observer?.disconnect();dialog.remove();if(origin?.isConnected)origin.focus();};close.onclick=dismiss;dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();dismiss();}});
    const result=research.buildPointLifecycle(input);
    dialog.append(text('h3',(p.label||p.strategy||'策略点位')+' · '+p.id),text('p',p.market+' · '+p.instrument+' · '+p.timeframe+' · '+p.status),text('p','触发 '+new Date(p.time).toISOString()+' · 价格 '+(p.triggerPrice??p.price??'未提供')),text('p','OHLC '+['open','high','low','close'].map(key=>p[key]??'未知').join(' / ')),text('p',(p.reason||'原因未知')+' · 来源 '+(p.source||'未知')+' · 来源时间 '+(Number.isFinite(p.sourceTime)?new Date(p.sourceTime).toISOString():'未知')),text('p',result.reason),text('p','到期状态 '+({expired:'明确到期', 'not-expired':'尚未到期',unknown:'没有明确到期规则，不推测'}[result.expiry])));
    dialog.append(text('h4','当前会话观察记录'));for(const row of result.transitions)dialog.append(text('p',new Date(row.at).toISOString()+' · '+row.state+' · '+(row.price??'价格未关联')+' · '+(row.reason||'无结构化原因')));if(!result.transitions.length)dialog.append(text('p','未观察到形成/失效历史，不重建未保存的旧状态。'));
    dialog.append(text('h4','后续已完成K线观察（非实际成交）'));for(const row of result.observations)dialog.append(text('p','后续 '+row.horizon+' 根 · '+row.status+' · 毛/净 '+fmt(row.returnPct)+' / '+fmt(row.netReturnPct)+'% · MFE/MAE '+fmt(row.mfePct)+' / '+fmt(row.maePct)+'% · '+(row.reason||'已成熟')));
    if(options.loadFills){const button=text('button','读取明确关联的模拟成交'),output=text('div','未关联：尚未查询账本；不按时间或价格猜配对');button.type='button';button.dataset.lifecycleFills='';output.setAttribute('role','status');dialog.append(button,output);button.onclick=async()=>{if(!current())return;button.disabled=true;try{const fills=await options.loadFills({signal:controller.signal});if(!current())return;const rows=research.buildPointLifecycle({...input,fills}).linkedFills;output.replaceChildren();if(!rows.length)output.append(text('p','未关联：没有相同信号ID、市场、标的、账户与快照的成交'));for(const row of rows)output.append(text('p',row.orderId+' · 账户 '+row.accountId+' · '+row.price+' · 快照 '+row.snapshotId));}catch(error){if(current()&&error.name!=='AbortError')output.textContent=error.message;}finally{button.disabled=false;}};}
    doc.body.append(dialog);if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');close.focus();
    const shell=doc.getElementById('market-workspace-shell');if(shell){observer=new doc.defaultView.MutationObserver(()=>{if(!current())dismiss();});observer.observe(shell,{attributes:true,attributeFilter:['data-market-scope','data-workspace','data-instrument']});}
  }
  return {render,openPointLifecycle};
});
