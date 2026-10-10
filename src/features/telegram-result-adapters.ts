import type { EventRecord, Result } from './telegram-event-results';
import type { ResearchJob } from './research-contracts';
import type { SettlementEvidence } from './prediction-settlement';
import type { ContractResearchService } from './contract-research';
import type { UpcomingEvent } from './event-calendar';

interface SecEarningsSnapshot {
  symbol: string;
  reportPeriodEnd: string;
  acceptedAt: string;
  form: string;
  accessionNumber: string;
  epsUsdPerShare: number | null;
  revenueUsd: number | null;
  sourceUrl: string;
}

interface ResultPorts {
  job?: (id:string)=>ResearchJob|null;
  contract?: (instrument:string)=>ReturnType<ContractResearchService['detail']>;
  settlement?: (platform:'Kalshi'|'Polymarket',id:string)=>Promise<SettlementEvidence|null>;
  secEarnings?: (symbol:string,reportPeriodEnd:string,eventDate:string)=>Promise<SecEarningsSnapshot|null>;
}
export function resultTrackingDisabledReason(eventsEnabled:boolean):string|null {
  return eventsEnabled?null:'未启动结果追踪：事件通知已关闭，请先在通知设置中开启事件通知；不会自动修改你的偏好。';
}

export function toTrackedCalendarEvent(event:UpcomingEvent):EventRecord {
  if(event.category==='earnings'){
    const symbol=String(event.symbol||'').trim().toUpperCase();
    const safeSymbol=/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)?symbol:'';
    return {...event,kind:'earnings',market:'stocks',instrument:safeSymbol?`stock:us:${safeSymbol}`:undefined,resourceId:event.id,symbol:safeSymbol||undefined,reportPeriodEnd:event.reportPeriodEnd||undefined};
  }
  return {...event,kind:'macro'};
}

function dollars(value:number):string {
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
}

function validSecUrl(value:string):boolean {
  try { const url=new URL(value);return url.protocol==='https:'&&(url.hostname==='sec.gov'||url.hostname.endsWith('.sec.gov')); } catch { return false; }
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
  if(event.kind==='earnings'){
    const symbol=String(event.symbol||'').trim().toUpperCase();
    if(event.market!=='stocks'||!/^stock:us:[A-Z][A-Z0-9.-]{0,9}$/.test(event.instrument||'')||event.instrument!==`stock:us:${symbol}`||!/^\d{4}-\d{2}-\d{2}$/.test(event.reportPeriodEnd||''))return unsupported('财报标的或报告期身份未能核验');
    if(!ports.secEarnings)return unsupported('SEC 财报结果适配器不可用');
    const actual=await ports.secEarnings(symbol,event.reportPeriodEnd!,event.date);
    if(!actual)return {actual:null,status:'pending',source:'SEC EDGAR',reason:'SEC 尚无该报告期、该股票的可核验 8-K/10-Q/10-K 实际数据；继续等待，不用预期值代替'};
    const acceptedAt=Date.parse(actual.acceptedAt),eventDay=Date.parse(`${event.date.slice(0,10)}T00:00:00.000Z`);
    if(actual.symbol!==symbol||actual.reportPeriodEnd!==event.reportPeriodEnd||!['8-K','8-K/A','10-Q','10-Q/A','10-K','10-K/A'].includes(actual.form)||!/^\d{10}-\d{2}-\d{6}$/.test(actual.accessionNumber)||!Number.isFinite(acceptedAt)||!Number.isFinite(eventDay)||acceptedAt<eventDay||!validSecUrl(actual.sourceUrl))return unsupported('SEC 申报身份、报告期、时间或原文链接不一致');
    const values:string[]=[];
    if(actual.epsUsdPerShare!==null&&Number.isFinite(actual.epsUsdPerShare))values.push(`SEC GAAP EPS ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(actual.epsUsdPerShare)}`);
    if(actual.revenueUsd!==null&&Number.isFinite(actual.revenueUsd))values.push(`营收 ${dollars(actual.revenueUsd)}`);
    if(!values.length)return {actual:null,status:'pending',source:'SEC EDGAR',reason:'SEC 已有同报告期申报，但没有可核验的季度 EPS 或营收事实'};
    return {actual:values.join(' · '),status:'published',source:`SEC EDGAR ${actual.form}`,url:actual.sourceUrl,publishedAt:new Date(acceptedAt).toISOString(),evidenceRefs:[actual.accessionNumber],reason:'SEC XBRL 为 GAAP 披露；Nasdaq EPS 预期可能采用调整后口径，不直接据此计算超预期'};
  }
  if(event.kind==='prediction'){
    if(event.market!=='prediction'||!event.instrument||!event.resourceId||!['Kalshi','Polymarket'].includes(event.platform||'')||!ports.settlement)return unsupported('预测结算身份或平台缺失');
    const result=await ports.settlement(event.platform as 'Kalshi'|'Polymarket',event.resourceId);
    if(!result || result.instrument!==event.instrument||result.marketId!==event.resourceId||result.platform!==event.platform)return unsupported('官方结算身份不一致或缺少证据');
    if(result.status!=='settled'||!['YES','NO'].includes(result.result||'')||!result.evidenceHash)return {actual:null,status:result.status==='unavailable'?'unavailable':'pending',reason:result.reason||'官方尚未明确结算；不以市场概率作为结果',source:result.platform,url:result.sourceUrl};
    const eventAt=Date.parse(event.date),publishedAt=Number.isFinite(eventAt)?[result.settlementAt,result.determinationAt].find(value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>=eventAt):undefined;
    if(!publishedAt)return {actual:null,status:'pending',source:result.platform+' 官方结算',url:result.sourceUrl,reason:'官方已有明确 YES/NO，但缺少不早于事件时间的有效结算/裁定时间；暂不报告为实际结果',evidenceRefs:[result.evidenceHash]};
    return {actual:result.result,status:'published',source:result.platform+' 官方结算',url:result.sourceUrl,publishedAt,evidenceRefs:[result.evidenceHash]};
  }
  return unsupported('结果类型不支持');
}
