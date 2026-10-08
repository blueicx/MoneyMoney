import type { EventRecord, Result } from './telegram-event-results';
import type { ResearchJob } from './research-contracts';
import type { SettlementEvidence } from './prediction-settlement';
import type { ContractResearchService } from './contract-research';

interface ResultPorts {
  job?: (id:string)=>ResearchJob|null;
  contract?: (instrument:string)=>ReturnType<ContractResearchService['detail']>;
  settlement?: (platform:'Kalshi'|'Polymarket',id:string)=>Promise<SettlementEvidence|null>;
}
export function resultTrackingDisabledReason(eventsEnabled:boolean):string|null {
  return eventsEnabled?null:'未启动结果追踪：事件通知已关闭，请先在通知设置中开启事件通知；不会自动修改你的偏好。';
}
/** Same durable result monitor and existing business repositories, no inferred outcomes. */
export async function lookupTrackedResult(event:EventRecord,ports:ResultPorts):Promise<Result>{
  const unsupported=(reason:string):Result=>({actual:null,status:'unsupported',reason});
  if(event.kind==='research'){
    if(!event.resourceId || !ports.job)return unsupported('研究任务引用缺失');
    const job=ports.job(event.resourceId);
    if(!job || job.id!==event.resourceId || job.market!==event.market)return unsupported('任务不存在或市场身份不一致');
    if(job.status==='succeeded')return {actual:'研究任务已完成',status:'published',source:'MoneyMoney 持久研究任务',publishedAt:job.updatedAt,evidenceRefs:[job.id,...(job.artifactHash?[job.artifactHash]:[])]};
    if(['failed','cancelled'].includes(job.status))return {actual:null,status:'stopped',source:'MoneyMoney 持久研究任务',reason:job.errorReason||'任务已取消；没有成功结果',evidenceRefs:[job.id]};
    return {actual:null,status:'pending',reason:'任务状态 '+job.status+' · 进度 '+job.progress+'%，尚未完成'};
  }
  if(event.kind==='funding'){
    if(event.market!=='crypto'||!event.instrument||!/^crypto:gateio:[A-Z0-9]+_USDT$/.test(event.instrument)||!ports.contract)return unsupported('资金结算只支持已核验Gate USDT永续身份');
    const snapshot=await ports.contract(event.instrument);
    if(snapshot.instrument!==event.instrument)return unsupported('资金费率来源身份不一致');
    const matches=snapshot.funding.filter((row:{at:string;ratePct:number})=>row.at===event.date);
    if(matches.length!==1)return {actual:null,status:snapshot.sections.funding.dataStatus==='unavailable'?'unavailable':'pending',reason:snapshot.sections.funding.reason||'该结算时间尚无唯一实际费率，不使用当前预估费率'};
    return {actual:String(matches[0].ratePct)+'%',status:'published',source:'Gate 实际历史资金费率',url:snapshot.sections.funding.source,publishedAt:matches[0].at};
  }
  if(event.kind==='prediction'){
    if(event.market!=='prediction'||!event.instrument||!event.resourceId||!['Kalshi','Polymarket'].includes(event.platform||'')||!ports.settlement)return unsupported('预测结算身份或平台缺失');
    const result=await ports.settlement(event.platform as 'Kalshi'|'Polymarket',event.resourceId);
    if(!result || result.instrument!==event.instrument||result.marketId!==event.resourceId||result.platform!==event.platform)return unsupported('官方结算身份不一致或缺少证据');
    if(result.status!=='settled'||!['YES','NO'].includes(result.result||'')||!result.evidenceHash)return {actual:null,status:result.status==='unavailable'?'unavailable':'pending',reason:result.reason||'官方尚未明确结算；不以市场概率作为结果',source:result.platform,url:result.sourceUrl};
    return {actual:result.result,status:'published',source:result.platform+' 官方结算',url:result.sourceUrl,publishedAt:result.settlementAt||result.determinationAt||undefined,evidenceRefs:[result.evidenceHash]};
  }
  return unsupported('结果类型不支持');
}
