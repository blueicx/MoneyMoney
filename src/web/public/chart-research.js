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
  return {buildQualityMatrix,explainSignalAgreement,alignTimeframeEvidence,evaluateParameterLab};
});
