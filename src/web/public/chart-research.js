/* Read-only research over the current chart data. Never invokes a provider, model or executor. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./chart-analysis.js'):root.MoneyChartAnalysis,
    typeof module==='object'&&module.exports?require('./chart-strategies.js'):root.MoneyChartStrategies);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MoneyChartResearch=api;
})(typeof window!=='undefined'?window:globalThis,function(analysis,library){
  'use strict';
  const number=v=>typeof v==='number'&&Number.isFinite(v);
  const mean=rows=>rows.length?rows.reduce((a,b)=>a+b,0)/rows.length:null;
  const scopeOk=o=>['stocks','crypto'].includes(o.market)&&typeof o.instrument==='string'&&o.instrument.startsWith(o.market==='stocks'?'stock:':'crypto:')&&typeof o.timeframe==='string'&&o.timeframe.length>0;
  const same=(p,o)=>p?.market===o.market&&p.instrument===o.instrument&&p.timeframe===o.timeframe;
  function scopedPoints(o){
    const seen=new Set(),rows=[];let duplicatePoints=0,excludedPoints=0;
    if(!scopeOk(o))return {rows,duplicatePoints,excludedPoints:(o.points||[]).length};
    for(const p of o.points||[]){
      if(!same(p,o)||!p.id||!number(p.time)||!['buy','sell'].includes(p.side)||!['confirmed','forming'].includes(p.status)){excludedPoints++;continue;}
      if(seen.has(p.id)){duplicatePoints++;continue;}seen.add(p.id);rows.push(p);
    }
    return {rows,duplicatePoints,excludedPoints};
  }
  function buildQualityMatrix(o){
    const scoped=scopedPoints(o),groups=new Map();
    for(const p of scoped.rows.filter(p=>p.status==='confirmed')){
      const prior=(o.bars||[]).filter(b=>number(b.time)&&b.time<p.time&&b.closed!==false&&number(b.close)&&b.close>0).slice(-20);
      const change=prior.length===20?(prior.at(-1).close/prior[0].close-1)*100:null;
      const regime=change==null?'unknown':change>1?'rising':change< -1?'falling':'flat';
      const seenHorizons=new Set();
      for(const outcome of p.outcomes||[]){
        if(![1,3,5,20].includes(outcome.horizon)||seenHorizons.has(outcome.horizon))continue;seenHorizons.add(outcome.horizon);
        const key=JSON.stringify([p.strategy,p.strategyVersion||'未关联',p.side,p.timeframe,outcome.horizon,regime]);
        const group=groups.get(key)||{strategy:p.strategy,strategyVersion:p.strategyVersion||'未关联',side:p.side,timeframe:p.timeframe,regime,horizon:outcome.horizon,samples:0,pending:0,invalid:0,pointIds:[],gross:[],net:[],mfe:[],mae:[]};
        if(outcome.status==='pending')group.pending++;
        else if(outcome.status!=='matured')group.invalid++;
        else if(![outcome.returnPct,outcome.mfePct,outcome.maePct].every(number)||outcome.mfePct<0||outcome.maePct>0||outcome.netReturnPct!=null&&!number(outcome.netReturnPct))group.invalid++;
        else {group.samples++;group.pointIds.push(p.id);group.gross.push(outcome.returnPct);if(number(outcome.netReturnPct))group.net.push(outcome.netReturnPct);group.mfe.push(outcome.mfePct);group.mae.push(outcome.maePct);}
        groups.set(key,group);
      }
    }
    return {groups:[...groups.values()].map(({gross,net,mfe,mae,...g})=>({...g,meanReturnPct:mean(gross),meanNetReturnPct:net.length===g.samples?mean(net):null,meanMfePct:mean(mfe),meanMaePct:mean(mae),
      winRate:g.samples>=20&&net.length===g.samples?net.filter(v=>v>0).length/g.samples:null,
      reason:g.samples<20?'少于20个成熟样本，不提供可靠胜率或排名':net.length!==g.samples?'成本缺失，仅展示毛表现；不按零成本补齐':'重叠信号不是独立交易；历史描述不是统计显著性或排名'})),
      duplicatePoints:scoped.duplicatePoints,excludedPoints:scoped.excludedPoints,ranking:null,orderChanges:0};
  }
  const families={macdCross:'趋势',emaPullback:'趋势',maCross:'趋势',donchianBreakout:'突破',atrBreakout:'突破',bollingerSqueeze:'突破',volumeBreakoutV2:'突破',volumeBreakout:'量价',obvConfirmation:'量价',stochasticReversal:'震荡',cciReversal:'震荡',rsiReversal:'震荡',bollinger:'震荡',sessionVwap:'会话量价'};
  function explainSignalAgreement(o){
    const scoped=scopedPoints(o),groups=new Map();
    for(const p of scoped.rows){const key=JSON.stringify([p.time,p.status]),g=groups.get(key)||{time:p.time,status:p.status,buy:[],sell:[],families:[]};g[p.side].push(p.id);g.families.push(families[p.strategy]||'未知');groups.set(key,g);}
    return {groups:[...groups.values()].map(g=>({...g,families:[...new Set(g.families)],conflict:Boolean(g.buy.length&&g.sell.length),independentEvidenceCount:null,probability:null,reason:'同根方向比较；指标可能相关，家族标签不证明证据独立，不合成为胜率。'})),orderChanges:0};
  }
  function alignTimeframeEvidence(o){
    const rows=[];
    if(number(o.at))for(const s of o.series||[]){if(s.market!==o.market||s.instrument!==o.instrument)continue;
      const eligible=(s.points||[]).filter(p=>number(p.time)&&number(p.closeTime)&&p.closed===true&&p.closeTime>=p.time&&p.closeTime<=o.at).sort((a,b)=>a.closeTime-b.closeTime);
      rows.push({timeframe:s.timeframe,point:eligible.at(-1)||null,reason:eligible.length?'只使用光标时间之前已收线的数据':'该时点无可核验的已收线数据'});
    }
    return {rows,modelCalls:0,orderChanges:0};
  }
  const hash=async value=>[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
  async function evaluateParameterLab(o){
    const empty=(reason,dataStatus='failed')=>({dataStatus,reason,rows:[],ranking:null,modelCalls:0,orderChanges:0,dataHash:null,configurationHash:null});
    if(!scopeOk(o))return empty('当前身份不属于股票或虚拟币图表','unsupported');
    if(!o.source||!Array.isArray(o.bars)||o.bars.length>2000||!Array.isArray(o.parameterSets)||!o.parameterSets.length||o.parameterSets.length>12)return empty('需要明确来源、最多2000根数据与1–12组参数');
    if(![1,3,5,20].includes(o.horizon)||o.costBps!=null&&(!number(o.costBps)||o.costBps<0||o.costBps>1000))return empty('观察期限或往返成本假设无效');
    if(o.asOf!=null&&!number(o.asOf))return empty('历史时点无效');
    const bars=o.bars.filter(b=>o.asOf==null||b?.time<=o.asOf).map(b=>b&&{...b});
    if(bars.length){const last=bars.at(-1);
      if(last?.closed!==true||o.asOf!=null&&(!number(last.closedAt)||last.closedAt>o.asOf))bars.pop();
    }
    if(bars.some((b,i)=>!b||![b.time,b.open,b.high,b.low,b.close].every(number)||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.high<b.low||i&&b.time<=bars[i-1].time||b.gap||b.closed===false))return empty('OHLC、完成状态、时间顺序或数据缺口无效，不插值修复');
    if(bars.length<60)return empty('至少需要60根已完成K线','unavailable');
    const sets=[];for(const raw of o.parameterSets){const result=library.normalizeParameters(o.strategy,raw);if(!result.valid)return empty(result.reason);if(!sets.some(p=>JSON.stringify(p)===JSON.stringify(result.parameters)))sets.push(result.parameters);}
    const dataHash=await hash(bars),configuration={version:'chart-parameter-lab-v1',market:o.market,instrument:o.instrument,timeframe:o.timeframe,source:o.source,sourceTime:o.sourceTime??null,asOf:o.asOf??null,evidenceRefs:Array.isArray(o.evidenceRefs)?o.evidenceRefs.filter(r=>typeof r==='string'):[],dataHash,strategy:o.strategy,parameterSets:sets,horizon:o.horizon,costBps:o.costBps??null,exchangeTimeZone:o.exchangeTimeZone??null,sessionStartMinutes:o.sessionStartMinutes??null};
    const boundaries=[0,Math.floor(bars.length*.6),Math.floor(bars.length*.8),bars.length],names=['train','validation','out-of-sample'],rows=[];
    for(const parameters of sets){const calculated=analysis.evaluateChartStrategies(bars,{[o.strategy]:true},{market:o.market,timeframe:o.timeframe,parameters:{[o.strategy]:parameters},exchangeTimeZone:o.exchangeTimeZone,sessionStartMinutes:o.sessionStartMinutes});
      const splits=names.map((name,i)=>{const start=boundaries[i],end=boundaries[i+1],observations=[];let purged=0;
        for(const signal of calculated.signals){const index=signal.index;if(index<start||index>=end)continue;if(index+o.horizon>=end){purged++;continue;}
          const result=analysis.strategyPointOutcomes(bars,index,signal.price??bars[index].close,signal.side,{status:'confirmed',costBps:o.costBps??null,asOf:o.asOf}).find(r=>r.horizon===o.horizon);
          if(result?.status==='matured')observations.push({pointKey:[o.strategy,signal.strategyVersion,signal.side,bars[index].time].join('|'),entryIndex:index,exitIndex:index+o.horizon,side:signal.side,...result});
        }
        const net=observations.map(r=>r.netReturnPct).filter(number),samples=observations.length;
        return {name,start,end,samples,purged,observations,meanReturnPct:mean(observations.map(r=>r.returnPct)),meanNetReturnPct:net.length===samples?mean(net):null,winRate:samples>=20&&net.length===samples?net.filter(v=>v>0).length/samples:null,reason:samples<20?'低样本量，不提供可靠胜率；训练参数不可用样本外表现挑选':net.length!==samples?'成本未知，不给净胜率':'重叠信号观察，不等于独立交易回测'};
      });rows.push({parameters,status:calculated.statuses?.[o.strategy]||null,splits});
    }
    return {...empty('参数敏感性研究；60/20/20时间划分，剔除跨界观察。不是组合回测或参数推荐。','historical'),...configuration,barCount:bars.length,dataHash,configurationHash:await hash(configuration),rows,evidencePack:{version:1,configuration,bars,orderChanges:0,modelCalls:0}};
  }
  function buildRequestDiagnostics(o={}){
    const t=o.requestTiming||{},p=o.providerTelemetry||{},page=o.pageTiming||{},duration=v=>number(v)&&v>=0?v:null;
    const stages=[{key:'wait',label:t.prefetched?'等待已有预取完成（非完整请求）':'浏览器等待响应',durationMs:duration(t.waitMs)},
      {key:'decode',label:'响应读取与JSON解析（含传输）',durationMs:duration(t.decodeMs)},
      {key:'provider',label:'Provider来源耗时',durationMs:duration(p.providerLatencyMs),historical:p.cacheMode!=='origin'},
      {key:'render',label:'最近图表计算与绘制',durationMs:duration(o.renderMs)},
      {key:'document',scope:'page',label:'本页面文档下载（非当前标的请求）',durationMs:duration(page.documentDownloadMs)},
      {key:'auth',scope:'page',label:'本页面鉴权请求（可能早已完成）',durationMs:duration(page.authMs)}];
    const observed=stages.filter(s=>s.durationMs!=null&&!s.historical&&s.scope!=='page').sort((a,b)=>b.durationMs-a.durationMs);
    return {stages,bottleneck:observed[0]?.key??null,totalMs:null,source:p.provider||null,cacheMode:p.cacheMode||'unknown',sourceTime:p.sourceTime||null,page:{scriptRequests:duration(page.scriptRequests),scriptTransferBytes:duration(page.scriptTransferBytes)},
      requestId:typeof t.requestId==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(t.requestId)?t.requestId:null,
      reason:'Provider可能与请求等待重叠；缓存Provider耗时属于旧采集，不相加为总耗时。预取、鉴权、下载和解析未测得的阶段保持未知。'};
  }
  const intervals={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'1d':86400000};
  function buildGapBackfillPreview(o={}){
    const fail=reason=>({request:null,reason}),match=String(o.instrument||'').match(o.market==='stocks'?/^stock:us:([A-Z][A-Z0-9.]{0,9})$/:o.market==='crypto'?/^crypto:binance:([A-Z0-9]{2,20}(?:USDT|USDC|USD))$/:/$^/);
    if(!match||!intervals[o.timeframe])return fail('当前标的身份、交易场所或周期没有已接线的回补来源；不改用其他市场。');
    const gap=o.gap||{},cut=Number.isFinite(o.asOf)?Math.min(o.asOf,o.now??Date.now()):o.now??Date.now();
    if(!Number.isFinite(gap.from)||!Number.isFinite(gap.to)||gap.from>=gap.to||gap.to>cut||gap.to-gap.from>31*86400000)return fail('回补区间无效、超过31天或超出当前历史时点；没有创建任务。');
    return {request:{market:o.market,instrument:match[1],dataset:'bars',timeframe:o.timeframe,from:new Date(gap.from).toISOString(),to:new Date(gap.to).toISOString()},reason:'只请求本区间同市场真实来源；交易时段尚未核验，间隔可能是休市，不保证有缺失数据。新抓取数据不会被伪装成历史时点已知信息。'};
  }
  function auditChartData(o){
    const result={dataStatus:'historical',reason:'仅检查当前加载区间，不扫描或修改历史分区。',rows:0,invalidOhlc:[],invalidVolumes:[],duplicateTimes:[],invalidTimes:[],gaps:[],repairedRows:0};
    if(!scopeOk(o))return {...result,dataStatus:'unsupported',reason:'当前图表身份或市场不支持此检查'};
    if(!Array.isArray(o.bars)||o.bars.length>5000||o.asOf!=null&&!number(o.asOf))return {...result,dataStatus:'failed',reason:'需要有效时点及最多5000根K线'};
    const seen=new Set(),step=intervals[o.timeframe];let previous=null;
    for(const [index,b] of o.bars.entries()){
      if(o.asOf!=null&&number(b?.time)&&b.time>o.asOf)continue;result.rows++;
      if(!number(b?.time)){result.invalidTimes.push({index,reason:'时间无效'});continue;}
      if(seen.has(b.time))result.duplicateTimes.push({index,time:b.time});seen.add(b.time);
      if(previous!=null&&b.time<previous)result.invalidTimes.push({index,time:b.time,reason:'时间倒序'});
      if(![b.open,b.high,b.low,b.close].every(v=>number(v)&&v>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.low>b.high)result.invalidOhlc.push({index,time:b.time});
      if(b.volume!=null&&(!number(b.volume)||b.volume<0))result.invalidVolumes.push({index,time:b.time});
      if(previous!=null&&step&&b.time-previous>step*1.5)result.gaps.push({from:previous,to:b.time,verification:'unknown-session',missingBars:null,reason:'间隔超过名义周期；未提供交易所日历，可能休市或来源缺口，不直接判定丢失根数'});
      if(b.gap)result.gaps.push({from:b.time,to:b.time,verification:'source-reported',missingBars:null,reason:'来源显式标记缺口'});
      previous=b.time;
    }
    if(!result.rows)return {...result,dataStatus:'empty',reason:'当前加载区间没有记录；本检查无法据此判断上游来源是否故障'};
    if(result.invalidOhlc.length+result.invalidVolumes.length+result.duplicateTimes.length+result.invalidTimes.length+result.gaps.length)result.dataStatus='partial';
    return result;
  }
  function describeStrategyRegimes(o){
    const scoped=scopedPoints(o),rows=[];
    if(!Array.isArray(o.bars)||o.bars.length>5000)return {rows,reason:'需要最多5000根已加载K线',modelCalls:0,orderChanges:0};
    for(const p of scoped.rows.slice(-2000)){
      if(p.status!=='confirmed'||o.asOf!=null&&p.time>o.asOf)continue;
      const prior=o.bars.filter(b=>number(b?.time)&&b.time<p.time&&b.closed===true&&
        (b.closedAt==null||number(b.closedAt)&&b.closedAt<=p.time)).slice(-20);
      const complete=prior.length===20&&prior.every((b,i)=>number(b.close)&&b.close>0&&!b.gap&&(!i||b.time>prior[i-1].time)),returns=complete?prior.slice(1).map((b,i)=>(b.close/prior[i].close-1)*100):[],average=mean(returns),change=complete?(prior.at(-1).close/prior[0].close-1)*100:null;
      const volumes=prior.map(b=>b.volume),knownVolumes=complete&&volumes.every(v=>number(v)&&v>=0);
      rows.push({pointId:p.id,strategy:p.strategy,strategyVersion:p.strategyVersion||'未关联',time:p.time,priorBars:prior.length,latestPriorTime:prior.at(-1)?.time??null,
        trend:change==null?'unknown':change>1?'rising':change< -1?'falling':'flat',changePct:change,
        volatilityPct:complete?Math.sqrt(mean(returns.map(v=>(v-average)**2))):null,averageVolume:knownVolumes?mean(volumes):null,
        liquidity:'unknown',reason:'只使用入场前已完成K线；20根首尾±1%划分趋势，波动为逐根收益标准差，未年化。成交量不能证明盘口流动性。'});
    }
    return {rows,modelCalls:0,orderChanges:0};
  }
  function analyzeStrategyRedundancy(o){
    const groups=new Map();for(const p of scopedPoints(o).rows.slice(-2000)){
      if(p.status!=='confirmed'||o.asOf!=null&&p.time>o.asOf)continue;
      const key=JSON.stringify([p.strategy,p.strategyVersion||'未关联']),g=groups.get(key)||{strategy:p.strategy,strategyVersion:p.strategyVersion||'未关联',slots:new Set(),times:new Map()};
      g.slots.add(JSON.stringify([p.time,p.side]));const sides=g.times.get(p.time)||new Set();sides.add(p.side);g.times.set(p.time,sides);groups.set(key,g);
    }
    const values=[...groups.values()].slice(0,32),pairs=[];
    for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++){
      const a=values[i],b=values[j],overlap=[...a.slots].filter(s=>b.slots.has(s)).length,union=new Set([...a.slots,...b.slots]).size;
      let conflicts=0;for(const [time,sides] of a.times)if(b.times.has(time)&&[...sides].some(side=>b.times.get(time).has(side==='buy'?'sell':'buy')))conflicts++;
      pairs.push({left:{strategy:a.strategy,strategyVersion:a.strategyVersion},right:{strategy:b.strategy,strategyVersion:b.strategyVersion},overlap,union,jaccard:union?overlap/union:null,conflicts,leftOnly:a.slots.size-overlap,rightOnly:b.slots.size-overlap});
    }
    return {pairs,ranking:null,portfolioContribution:null,modelCalls:0,orderChanges:0,truncated:groups.size>32,
      reason:'已确认点位按同根同方向比较；Jaccard重合不证明独立性或因果，独有点位不是组合净收益贡献，不给策略排名。最多32个版本、2000个点位。'};
  }
  async function evaluateCounterfactual(o){
    const empty=(reason,dataStatus='failed')=>({dataStatus,reason,rows:[],dataHash:null,configurationHash:null,evidencePack:null,ranking:null,modelCalls:0,orderChanges:0});
    if(!scopeOk(o))return empty('当前身份不属于股票或虚拟币图表','unsupported');
    if(!o.source)return empty('缺少可追溯来源，不猜测保存快照','unavailable');
    if(!Array.isArray(o.bars)||o.bars.length>5000||!Array.isArray(o.points)||o.points.length>2000||![1,3,5,20].includes(o.horizon)||o.asOf!=null&&!number(o.asOf)||o.costBps!=null&&(!number(o.costBps)||o.costBps<0||o.costBps>1000))return empty('输入数量、观察期限、成本或时点无效');
    // Freeze before the first await. Export only explicitly scoped signal facts, not mutable precomputed outcomes.
    const bars=o.bars.filter(b=>o.asOf==null||b?.time<=o.asOf).map(b=>b&&({...b})),points=scopedPoints(o).rows.filter(p=>o.asOf==null||p.time<=o.asOf).map(p=>({id:p.id,market:p.market,instrument:p.instrument,timeframe:p.timeframe,time:p.time,price:p.price??null,side:p.side,status:p.status,strategy:p.strategy??null,strategyVersion:p.strategyVersion??null}));
    if(!bars.length||!points.length)return empty('当前快照没有K线或明确关联点位，不进行事后情景收益估算','empty');
    const audit=auditChartData({...o,bars});
    if(audit.invalidOhlc.length||audit.invalidTimes.length||audit.duplicateTimes.length)return empty('快照存在异常OHLC或时间顺序，未修补数据','unavailable');
    const configuration={version:'chart-counterfactual-v1',market:o.market,instrument:o.instrument,timeframe:o.timeframe,source:String(o.source),sourceTime:o.sourceTime??null,evidenceRefs:Array.isArray(o.evidenceRefs)?o.evidenceRefs.filter(v=>typeof v==='string'):[],horizon:o.horizon,costBps:o.costBps??null,asOf:o.asOf??null};
    const rows=points.map(p=>{
      const index=bars.findIndex(b=>b.time===p.time),outcome=analysis.strategyPointOutcomes(bars,index,p.price,p.side,{status:p.status,costBps:configuration.costBps,asOf:configuration.asOf}).find(r=>r.horizon===o.horizon);
      if(!p.strategyVersion||!p.strategy)return {pointId:p.id,status:'unavailable',reason:'策略版本未关联',noTradeReturnPct:0,returnPct:null,netReturnPct:null};
      return {pointId:p.id,strategy:p.strategy,strategyVersion:p.strategyVersion,time:p.time,side:p.side,...outcome,noTradeReturnPct:0};
    });
    const dataHash=await hash(bars),configurationHash=await hash({configuration,dataHash,points});
    return {...empty('保存快照的事后情景研究：不交易假设为0，信号收益按触发价与后续已收线收盘计算；不是实际成交、AI策略复跑或持仓排名。','historical'),rows,dataHash,configurationHash,evidencePack:{configuration,bars,points,modelCalls:0,orderChanges:0}};
  }
  function auditChartLayout(o){
    const layout=o.layout,b=layout?.bounds,base={dataStatus:'unavailable',reason:'当前图表没有同标的周期的已保存布局；请等待图表绘制。',outsideMarkers:[],outsideLabels:[],overlaps:[],unlinkedIds:[],modifiedMarkers:0};
    if(!scopeOk(o)||!same(layout,o)||!b||![b.left,b.right,b.top,b.bottom].every(number)||b.right<=b.left||b.bottom<=b.top)return base;
    const markers=(layout.markers||[]).slice(0,2000),labels=(layout.labels||[]).slice(0,2000).filter(r=>r.labelVisible===true),ids=new Set(scopedPoints(o).rows.map(p=>p.id)),height=number(layout.height)&&layout.height>0?layout.height:13;
    const invalid=r=>!number(r.x)||!number(r.y);
    const outsideMarkers=markers.filter(r=>invalid(r)||r.x<b.left-1||r.x>b.right+1||r.y<b.top-1||r.y>b.bottom+1).map(r=>r.id);
    const outsideLabels=labels.filter(r=>invalid(r)||!number(r.width)||r.width<0||r.x-r.width/2<b.left-1||r.x+r.width/2>b.right+1||r.y-height/2<b.top-1||r.y+height/2>b.bottom+1).map(r=>r.id);
    const overlaps=[];outer:for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i],c=labels[j];if(Math.abs(a.x-c.x)<(a.width+c.width)/2-1&&Math.abs(a.y-c.y)<height-1)overlaps.push([a.id,c.id]);if(overlaps.length>=100)break outer;}
    const unlinkedIds=markers.filter(r=>!r.id||!ids.has(r.id)).map(r=>r.id??'未关联');
    return {...base,dataStatus:outsideMarkers.length+outsideLabels.length+overlaps.length+unlinkedIds.length?'partial':'historical',reason:'只读检查当前投影：被聚合或主动隐藏的标签不算丢失点位；不自动删除、移动或生成信号。',outsideMarkers,outsideLabels,overlaps,unlinkedIds};
  }
  return {buildQualityMatrix,explainSignalAgreement,alignTimeframeEvidence,evaluateParameterLab,buildRequestDiagnostics,buildGapBackfillPreview,auditChartData,describeStrategyRegimes,analyzeStrategyRedundancy,evaluateCounterfactual,auditChartLayout};
});
