import type { AiRunnerDecisionRecord, AiRunnerPosition } from './ai-paper-runner';
interface DiagnosticGroup { instrument:string;strategyVersion:string;modelVersion:string;rounds:number;failedModelCalls:number;knownModelCalls:number;rejectedRounds:number;dataFailures:number;maturedSamples:number;maturedResult:null|{closedCount:number;netPnlUsd:number;recordedCostsUsd:number;winRate:number};reason:string }

export function diagnosticRunnerMarket(runner:{venue:string;universe?:{market:string}}):string|null {
  const markets:Record<string,string>={Stocks:'stocks',Options:'options',Binance:'crypto','Predict.fun':'prediction'};
  const market=markets[runner.venue]||null;
  return market && (!runner.universe || runner.universe.market===market)?market:null;
}

/** Read-only interpretation of recorded gates. No quote fetch, strategy change, or model invocation. */
export function reviewAiRunnerDecisions(records:AiRunnerDecisionRecord[],runnerId:string,market:string,positions:AiRunnerPosition[]=[],now=new Date().toISOString()) {
  const scoped=records.filter(row=>row.runnerId===runnerId&&row.market===market);
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
  return {rows,groups:[...groups.values()].map(group=>({...group,modelFailureRate:group.knownModelCalls?group.failedModelCalls/group.knownModelCalls:null})),excludedRecords:records.length-scoped.length,readOnly:true,modelCalls:0};
}
