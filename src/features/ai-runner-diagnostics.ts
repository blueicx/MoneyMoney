import type { AiRunnerDecisionRecord, AiRunnerPosition } from './ai-paper-runner';
import type { VerifiedExecutionEvidence } from './runner-execution-evidence';
import { createHash } from 'node:crypto';
export { reviewRejectedIntentPath } from './ai-runner-rejected-path';

interface EvidenceNode {
  id:string;kind:'snapshot'|'decision'|'model'|'risk'|'order'|'account'|'result';recordId:string|null;
  label:string;status:'recorded'|'verified'|'blocked'|'unlinked';reason:string;at:string|null;
}

/** A graph of saved IDs, not inferred causes, model reasoning, or counterfactual fills. */
export function buildDecisionEvidenceGraph(
  decision:AiRunnerDecisionRecord,
  snapshot:{id:string;hash:string;market:string;instrument?:string;payload:Record<string,any>}|null,
  execution:VerifiedExecutionEvidence|null,
  positions:AiRunnerPosition[]=[],now=new Date().toISOString(),exits:VerifiedExecutionEvidence[]=[],
) {
  const nodes:EvidenceNode[]=[],edges:Array<{from:string;to:string;relation:string}>=[];
  const base={nodes,edges,readOnly:true,modelCalls:0,orderChanges:0};
  const cutoff=Date.parse(now),time=Date.parse(decision.at);
  if(!decision.id||!decision.runnerId||!Number.isFinite(time)||!Number.isFinite(cutoff)||time>cutoff)
    return {...base,dataStatus:'unavailable',reason:'决策时间无效或晚于查询时点，不连接未来证据'};
  const text=(value:unknown,max=500)=>typeof value==='string'?value.slice(0,max):'';
  const add=(kind:EvidenceNode['kind'],recordId:string|null,label:string,status:EvidenceNode['status'],reason:string,at:string|null=decision.at)=>{
    const id=decision.id+':'+kind+':'+nodes.length;nodes.push({id,kind,recordId,label,status,reason:text(reason),at});return id;
  };
  const decisionId=add('decision',decision.id,'保存的决策 · '+text(decision.action), 'recorded',decision.reason);
  const validTime=(at:unknown)=>typeof at==='string'&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=time;
  const snapshotLinked=Boolean(snapshot&&snapshot.id==='rs_'+decision.snapshotHash&&snapshot.hash===decision.snapshotHash&&snapshot.market===decision.market&&snapshot.payload?.market===decision.market&&snapshot.payload.instrument===decision.instrument&&(!snapshot.payload.dataAt||validTime(snapshot.payload.dataAt)));
  const snapshotId=add('snapshot',snapshotLinked?snapshot!.id:null,'行情输入快照',snapshotLinked?'verified':'unlinked',snapshotLinked?'已核验原始快照 Hash、市场与标的；不重新采集输入':'缺少匹配归档快照，不按时间或价格猜测配对',snapshotLinked?text(snapshot!.payload.dataAt)||decision.at:null);
  if(snapshotLinked)edges.push({from:snapshotId,to:decisionId,relation:'saved-input'});
  const model=decision.modelEvidence,hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const savedModel=Boolean(model&&decision.modelRequestRef&&model.returnedModel===decision.modelVersion&&model.input?.market===decision.market&&model.output?.instrument===decision.instrument&&hash(model.input)===model.inputHash&&hash(model.output)===model.outputHash);
  const modelId=add('model',savedModel?decision.modelRequestRef!:null,'模型 · '+(text(decision.modelVersion)||'未关联'), 'recorded',
    savedModel?'已保存请求额度引用（不是供应商回执）；提示词 '+text(model!.promptVersion,100)+'；输入Hash '+model!.inputHash+'；输出Hash '+model!.outputHash:
    '保存的调用状态：'+(text(decision.modelCallStatus)||'未知')+'；版本与状态不等于调用ID或完整模型输出，未关联部分不补造');
  edges.push({from:modelId,to:decisionId,relation:'recorded-model-metadata'});
  for(const check of (Array.isArray(decision.riskChecks)?decision.riskChecks:[]).slice(0,30)){
    if(!check||typeof check.passed!=='boolean')continue;
    const id=add('risk',null,'门控 · '+text(check.name,120),check.passed?'recorded':'blocked',text(check.reason)||'只展示当时保存的门控结果，不重新执行或放宽规则');
    edges.push({from:decisionId,to:id,relation:'recorded-gate'});
  }
  const matchingExecution=(row:VerifiedExecutionEvidence|null|undefined,action:string,orderId:string)=>Boolean(row&&snapshotLinked&&row.market===decision.market&&row.accountId==='ai-runner:'+decision.runnerId&&row.orderId===orderId&&row.signalId===row.decision.id&&row.decision.runnerId===decision.runnerId&&row.decision.orderId===orderId&&row.decision.market===decision.market&&row.decision.instrument===decision.instrument&&row.decision.action===action&&row.snapshotId==='rs_'+row.decision.snapshotHash&&row.snapshot.id===row.snapshotId&&row.snapshot.hash===row.decision.snapshotHash&&row.snapshot.fields.market===decision.market&&row.snapshot.fields.instrument===decision.instrument&&(!snapshot!.instrument||row.instrument===snapshot!.instrument)&&validTime(row.decision.at));
  const filled=Boolean(execution&&['BUY','SELL'].includes(decision.action)&&decision.orderId&&matchingExecution(execution,decision.action,decision.orderId)&&execution.signalId===decision.id&&execution.snapshotId===snapshot!.id&&execution.decision.at===decision.at);
  const orderId=add('order',filled?execution!.orderId:null,'模拟订单',filled?'verified':'unlinked',filled?'统一账本的账户、订单、信号及快照引用已核验':'订单ID本身不证明成交；缺少核验血缘或本轮没有订单');
  if(filled){
    edges.push({from:decisionId,to:orderId,relation:'verified-execution'});
    const accountId=add('account',execution!.accountId,'独立模拟账户','verified','明确 runnerId/accountId 关联；不修改资金或持仓');
    edges.push({from:orderId,to:accountId,relation:'owned-by'});
  }
  // Do not use a position's claimed exit ID as proof. Both ends must be verified in the ledger.
  const completed=filled?positions.filter(p=>{
    if(p.status!=='CLOSED'||!p.id||!p.entryOrderId||!p.exitOrderId||p.instrumentId!==execution!.instrument||!Number.isFinite(Date.parse(p.entryTime))||!Number.isFinite(Date.parse(p.exitTime||''))||Date.parse(p.exitTime!)<Date.parse(p.entryTime)||Date.parse(p.exitTime!)>cutoff)return false;
    const currentIsEntry=decision.action==='BUY';
    if((currentIsEntry?p.entryOrderId:p.exitOrderId)!==decision.orderId||time>Date.parse(currentIsEntry?p.entryTime:p.exitTime!))return false;
    const matches=exits.filter(other=>other.orderId===(currentIsEntry?p.exitOrderId:p.entryOrderId)&&other.accountId===execution!.accountId&&other.market===decision.market&&other.instrument===execution!.instrument&&other.decision.action===(currentIsEntry?'SELL':'BUY')&&other.decision.runnerId===decision.runnerId&&other.decision.instrument===decision.instrument&&other.signalId===other.decision.id&&other.decision.orderId===other.orderId&&other.snapshotId==='rs_'+other.decision.snapshotHash&&other.snapshot.id===other.snapshotId&&other.snapshot.hash===other.decision.snapshotHash&&other.snapshot.fields.market===decision.market&&other.snapshot.fields.instrument===decision.instrument&&Number.isFinite(Date.parse(other.decision.at))&&Date.parse(other.decision.at)<=Date.parse(currentIsEntry?p.exitTime!:p.entryTime)&&(currentIsEntry?Date.parse(other.decision.at)>=Date.parse(p.entryTime):Date.parse(other.decision.at)<=time));
    return matches.length===1;
  }):[];
  const resultId=add('result',completed.length===1?completed[0].id:null,'后续实际结果',completed.length===1?'verified':'unlinked',completed.length===1?'已平仓记录的入场及退出订单均有明确核验引用；本图不将原始盈亏当作扣费后收益':'未找到唯一且双端核验的成熟平仓记录；不按时间推算结果',completed.length===1?completed[0].exitTime!:null);
  if(completed.length===1)edges.push({from:orderId,to:resultId,relation:'verified-closed-position'});
  return {...base,dataStatus:snapshotLinked&&filled&&completed.length===1?'historical':'partial',reason:'仅连接明确保存和核验的引用；元数据节点不是独立模型调用或因果证明，缺失环节保持未关联。'};
}

/** Compare saved facts only; absent forward prices cannot become counterfactual fills or profit. */
export function buildSavedDecisionComparison(decision:AiRunnerDecisionRecord,snapshot:{hash:string;payload:Record<string,any>}){
  const base={dataStatus:'unavailable',reason:'原决策与归档快照未核验匹配，不重建旧输入',recorded:null as any,rules:null as any,hypotheticalPerformance:null,noTrade:{action:'NONE',hypothetical:true},modelCalls:0,orderChanges:0};
  if(!snapshot||snapshot.hash!==decision.snapshotHash||snapshot.payload?.market!==decision.market||snapshot.payload?.instrument!==decision.instrument)return base;
  const raw=snapshot.payload.candidateSignals,candidates=Array.isArray(raw)?raw.slice(0,50).flatMap(row=>typeof row==='string'?[{recordedText:row.slice(0,1000)}]:row&&typeof row==='object'?[Object.fromEntries(['strategy','strategyVersion','direction','side','reason','timeframe'].filter(key=>typeof row[key]==='string').map(key=>[key,row[key].slice(0,1000)]))]:[]):null;
  return {...base,dataStatus:'historical',recorded:{id:decision.id,action:decision.action,strategyVersion:decision.strategyVersion||null,modelVersion:decision.modelVersion||null,reason:decision.reason,signals:Array.isArray(decision.signals)?decision.signals.slice(0,50):[]},
    rules:candidates?{candidates,reason:'原快照已保存规则候选，不重新运行另一个策略版本'}:null,
    reason:'只比较已保存模型决定、原规则候选与不交易假设；未归档同口径的未来价格路径与替代成交条件，无法给出这些假设的成熟收益，不猜测配对、不调用模型或改写账本。'};
}
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
