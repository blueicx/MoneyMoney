import type { AiRunnerDecisionRecord, AiRunnerPosition } from './ai-paper-runner';
interface DiagnosticGroup { instrument:string;strategyVersion:string;modelVersion:string;rounds:number;failedModelCalls:number;knownModelCalls:number;rejectedRounds:number;dataFailures:number;maturedSamples:number;maturedResult:null|{closedCount:number;netPnlUsd:number;recordedCostsUsd:number;winRate:number};reason:string }

const inactionLabels = {
  data_unqualified: ['数据不合格', '检查本轮来源状态、时间及缺失证据；不使用旧报价下单'],
  model_failed: ['模型调用失败', '检查已记录的模型错误和耗时；不会自动新增调用'],
  budget: ['预算门控', '核对当前账户可用预算；本页不调整预算'],
  risk_gate: ['风控或执行门控', '查看失败条件；不自动放宽限制或恢复策略'],
  no_opportunity: ['本轮信号未触发', '等待下一轮有效数据；不代表策略失效'],
  unknown: ['原因未结构化关联', '查看保存的原始理由，不从文本猜测归因'],
} as const;
type InactionCode = keyof typeof inactionLabels;

function inactionSummary(records:AiRunnerDecisionRecord[]) {
  const categories = new Map<InactionCode,{code:InactionCode;label:string;nextAction:string;count:number;firstAt:string;lastAt:string;durationMs:null}>();
  for (const row of records) {
    if (!['NONE','REJECTED'].includes(row.action)) continue;
    const failed = (row.riskChecks || []).filter(check=>check.passed===false);
    // Use recorded gates only. Combined budget-and-risk cannot distinguish the two.
    const dataFailed = !['live','delayed','historical'].includes(row.dataStatus)
      || failed.some(check=>['quote-freshness','executable-quote','strategy-indicator-evidence'].includes(check.name));
    const code:InactionCode = dataFailed ? 'data_unqualified' : row.modelCallStatus==='failed' ? 'model_failed'
      : failed.some(check=>check.name==='budget') ? 'budget' : failed.length ? 'risk_gate'
      : row.action==='NONE' && row.modelCallStatus==='success' && row.signals.length===0 ? 'no_opportunity' : 'unknown';
    const [label,nextAction]=inactionLabels[code],previous=categories.get(code);
    categories.set(code,{code,label,nextAction,count:(previous?.count||0)+1,
      firstAt:previous && Date.parse(previous.firstAt)<Date.parse(row.at)?previous.firstAt:row.at,
      lastAt:previous && Date.parse(previous.lastAt)>Date.parse(row.at)?previous.lastAt:row.at,durationMs:null});
  }
  const times=records.map(row=>Date.parse(row.at));
  return {total:[...categories.values()].reduce((sum,row)=>sum+row.count,0),categories:[...categories.values()],
    observedSpanMs:times.length?Math.max(...times)-Math.min(...times):null,
    durationReason:'仅为保留记录的观察跨度；离散扫描不证明故障持续时间',executionChanges:0};
}

export function diagnosticRunnerMarket(runner:{venue:string;universe?:{market:string}}):string|null {
  const markets:Record<string,string>={Stocks:'stocks',Options:'options',Binance:'crypto','Predict.fun':'prediction'};
  const market=markets[runner.venue]||null;
  return market && (!runner.universe || runner.universe.market===market)?market:null;
}

/** Counts recorded instrument-rounds, not an unrecorded universe scan. Order IDs alone are not fills. */
function decisionFunnel(records:AiRunnerDecisionRecord[],positions:AiRunnerPosition[],now:string) {
  let dataPassed=0,dataFailed=0,dataUnknown=0,riskPassed=0,riskBlocked=0,riskUnknown=0;
  const orders=new Set<string>();
  for(const row of records){
    const checks=row.riskChecks||[],quote=checks.filter(c=>['quote-freshness','executable-quote'].includes(c.name));
    if(quote.some(c=>c.passed===false)||['failed','empty','unavailable','unsupported'].includes(row.dataStatus))dataFailed++;
    else if(['live','delayed','historical'].includes(row.dataStatus)&&['quote-freshness','executable-quote'].every(name=>quote.some(c=>c.name===name&&c.passed===true)))dataPassed++;
    else dataUnknown++;
    if(checks.some(c=>c.passed===false))riskBlocked++;
    else if(checks.length&&checks.every(c=>c.passed===true))riskPassed++;
    else riskUnknown++;
    if(['BUY','SELL'].includes(row.action)&&row.orderId)orders.add(row.orderId);
  }
  const verified=[...orders].filter(id=>{
    const decisions=records.filter(row=>row.orderId===id&&['BUY','SELL'].includes(row.action));
    if(decisions.length!==1)return false;
    const decision=decisions[0],matches=positions.filter(p=>(p.instrumentId===decision.instrument || p.instrument?.symbolOrMarketId===decision.instrument&&diagnosticRunnerMarket({venue:p.instrument.venue} as Parameters<typeof diagnosticRunnerMarket>[0])===decision.market)&&['OPEN','CLOSED'].includes(p.status)&&(decision.action==='BUY'?p.entryOrderId===id:p.status==='CLOSED'&&p.exitOrderId===id));
    if(matches.length!==1)return false;
    const at=Date.parse(decision.action==='BUY'?matches[0].entryTime:matches[0].exitTime||'');
    return Number.isFinite(at)&&at>=Date.parse(decision.at)&&at<=Date.parse(now);
  }).length;
  return {evaluatedRounds:records.length,scannedUniverseSize:null,dataPassed,dataFailed,dataUnknown,
    signalRounds:records.filter(row=>Array.isArray(row.signals)&&row.signals.length>0).length,
    riskPassed,riskBlocked,riskUnknown,submittedOrders:orders.size,verifiedFilledOrders:verified,unverifiedSubmittedOrders:orders.size-verified,
    reason:'每轮只代表已记录的标的评估；各阶段非严格漏斗（持仓退出可能没有入场信号）。未知门控不算通过，订单ID不证明成交，未记录的全池扫描数量保持未知。'};
}

/** Read-only interpretation of recorded gates. No quote fetch, strategy change, or model invocation. */
export function reviewAiRunnerDecisions(records:AiRunnerDecisionRecord[],runnerId:string,market:string,positions:AiRunnerPosition[]=[],now=new Date().toISOString()) {
  const matching=records.filter(row=>row.runnerId===runnerId&&row.market===market);
  const seen=new Set<string>();let duplicateRecords=0,invalidTimeRecords=0;
  const scoped=matching.filter(row=>{
    const at=Date.parse(row.at);
    if(!Number.isFinite(at)||!Number.isFinite(Date.parse(now))||at>Date.parse(now)){invalidTimeRecords++;return false;}
    if(seen.has(row.id)){duplicateRecords++;return false;}seen.add(row.id);return true;
  });
  const rows=scoped.map(row=>{
    const blockedChecks=(row.riskChecks||[]).filter(check=>check.passed===false).map(check=>`${check.name}：${check.reason||'未记录拒绝原因'}`);
    const badEvidence=(row.evidence||[]).filter(evidence=>!['live','delayed','historical'].includes(evidence.status));
    const hasTime=Number.isFinite(Date.parse(row.dataAt||''))||(row.evidence||[]).some(e=>Number.isFinite(Date.parse(e.dataAt||'')));
    const hasRecordedData=['live','delayed','historical'].includes(row.dataStatus)&&hasTime&&!badEvidence.length;
    const explicitFailure=['failed','unavailable','unsupported','empty'].includes(row.dataStatus)||badEvidence.some(e=>['failed','unavailable','unsupported','empty'].includes(e.status));
    return {decisionId:row.id,at:row.at,instrument:row.instrument,strategyVersion:row.strategyVersion||'未关联',modelVersion:row.modelVersion||'未关联',action:row.action,reason:row.reason,
      dataGate:{status:explicitFailure?'failed':hasRecordedData?'recorded':'unknown',source:row.source||null,dataAt:row.dataAt||null,dataStatus:row.dataStatus,
        reason:explicitFailure?badEvidence.map(e=>e.reason||`${e.dataset} ${e.status}`).join('；')||row.reason:hasRecordedData?'仅说明本轮记录具有来源时间；是否可下单仍由保存的风控结果决定':'缺少可靠时间或门控记录，不推测数据合格'},
      model:{status:row.modelCallStatus||'unknown',version:row.modelVersion||null,latencyMs:Number.isFinite(row.modelLatencyMs)?row.modelLatencyMs:null,
        reason:row.modelCallStatus==='failed'?row.reason:row.modelCallStatus==='skipped'?'本轮记录为跳过模型；未静默切换模型':row.modelCallStatus==='success'?'本轮模型调用记录成功':'旧记录未关联模型调用状态'},
      blockedChecks,snapshotHash:row.snapshotHash||null,orderId:row.orderId||null,evidence:row.evidence||[]};
  });
  const groups=new Map<string,DiagnosticGroup>();
  for(const row of rows){const key=JSON.stringify([row.instrument,row.strategyVersion,row.modelVersion]);
    const group=groups.get(key)||{instrument:row.instrument,strategyVersion:row.strategyVersion,modelVersion:row.modelVersion,rounds:0,failedModelCalls:0,knownModelCalls:0,rejectedRounds:0,dataFailures:0,maturedSamples:0,maturedResult:null,reason:'仅按明确订单血缘查看已有质量统计；此诊断不从时间猜测平仓或成本'};
    group.rounds++;if(row.model.status==='failed')group.failedModelCalls++;if(['success','failed'].includes(row.model.status))group.knownModelCalls++;if(row.action==='REJECTED')group.rejectedRounds++;if(row.dataGate.status==='failed')group.dataFailures++;groups.set(key,group);
  }
  const totals=new Map<string,{count:number;costs:number;net:number;wins:number}>();
  for(const decision of scoped){
    if(!decision.orderId||decision.action!=='BUY'||scoped.filter(row=>row.orderId===decision.orderId).length!==1)continue;
    const matching=positions.filter(position=>position.entryOrderId===decision.orderId);if(matching.length!==1)continue;
    const position=matching[0],costs=[position.entryFeeUsd,position.exitFeeUsd,position.entrySlippageUsd,position.exitSlippageUsd];
    const times=[decision.at,position.entryTime,position.exitTime,now].map(value=>Date.parse(value||''));
    if(position.status!=='CLOSED'||!position.exitOrderId||typeof position.pnlUsd!=='number'||!Number.isFinite(position.pnlUsd)||costs.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0)||times.some(time=>!Number.isFinite(time))||times.some((time,index)=>index>0&&time<times[index-1]))continue;
    const key=JSON.stringify([decision.instrument,decision.strategyVersion||'未关联',decision.modelVersion||'未关联']);
    const total=totals.get(key)||{count:0,costs:0,net:0,wins:0},cost=costs.reduce<number>((sum,value)=>sum+value!,0),net=position.pnlUsd-cost;
    total.count++;total.costs+=cost;total.net+=net;total.wins+=Number(net>0);totals.set(key,total);
  }
  for(const [key,group] of groups){const total=totals.get(key);group.maturedSamples=total?.count||0;
    if(total&&total.count>=20){group.maturedResult={closedCount:total.count,netPnlUsd:total.net,recordedCostsUsd:total.costs,winRate:total.wins/total.count};group.reason='仅统计已成熟且订单与成本完整的样本，不作策略排名';}
    else group.reason=`已成熟且成本完整 ${group.maturedSamples} 笔；至少20笔后展示该版本/标的净结果与胜率`;
  }
  return {rows,groups:[...groups.values()].map(group=>({...group,modelFailureRate:group.knownModelCalls?group.failedModelCalls/group.knownModelCalls:null})),funnel:decisionFunnel(scoped,positions,now),inaction:inactionSummary(scoped),duplicateRecords,invalidTimeRecords,excludedRecords:records.length-scoped.length,readOnly:true,modelCalls:0};
}
