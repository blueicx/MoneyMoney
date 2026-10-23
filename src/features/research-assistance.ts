import {preserveResearchSummary,compareResearchSummaries} from './research-summary';
import {createHash} from 'node:crypto';
import type {ResearchProject} from './research-projects';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const destinations:Record<string,{workspace:string;section:string;label:string}>={
 version:{workspace:'research-lab',section:'strategies',label:'查看固定策略版本'},experiment:{workspace:'research-lab',section:'experiments',label:'查看明确历史实验'},
 snapshot:{workspace:'research-lab',section:'data-assets',label:'查看数据覆盖'},revision:{workspace:'research-lab',section:'data-assets',label:'核对来源修订'},
 costs:{workspace:'research-lab',section:'experiments',label:'核对实验成本'},sample:{workspace:'research-lab',section:'experiments',label:'查看历史样本'},
 oos:{workspace:'research-lab',section:'validation',label:'查看事前验证'},forward:{workspace:'research-lab',section:'forward-paper',label:'查看手动执行证据'},
 'corporate-actions':{workspace:'paper',section:'lifecycle',label:'打开公司行动对账'},approval:{workspace:'research-lab',section:'candidate-proof',label:'查看人工审批门槛'},
};
/** Derived exclusively from server-verified audit fields. No evidence or business state is created here. */
export function buildResearchGaps(audit:any){
 if(audit?.market!=='stocks'||!audit.observationId||!Array.isArray(audit.checks)||!audit.forward)throw Error('缺少服务端观察核验结果');
 const {signals,mature20,pairedFills}=audit.forward;
 if([signals,mature20,pairedFills].some(n=>!Number.isSafeInteger(n)||n<0)||mature20>signals)throw Error('前向样本计数不可核验');
 const remaining=Math.max(0,20-pairedFills),progress={verifiedClosedTrades:pairedFills,required:20,remaining,observedSignals:signals,matureObservations:mature20,
  reason:remaining?`还需 ${remaining} 笔可核验完整平仓；成熟走势不作为成交，不估算达到门槛的日期`:'已满足成交数量门槛；仍需其他证据和人工审批，不自动晋级',
  status:remaining?'waiting-evidence':'quantity-threshold-met'};
 const gaps=audit.checks.filter((row:any)=>row.status!=='met').map((row:any)=>({id:row.id,status:row.status,reason:row.reason,target:destinations[row.id]?{...destinations[row.id],market:audit.market,instrument:audit.instrument,observationId:audit.observationId}:null}));
 const data={market:audit.market,instrument:audit.instrument,observationId:audit.observationId,checkedAt:audit.checkedAt,auditHash:audit.contentHash,progress,gaps,
  promotionAllowed:false,monitoringAllowed:false,modelCalls:0,ordersCreated:0,reason:'只读缺口导航；只跳转到核验入口，不执行采集、对账、审批或订单'};
 return {...data,contentHash:digest(data)};
}

export function buildProjectRetrospective(project:Pick<ResearchProject,'id'|'market'|'version'|'hypothesis'|'links'|'conclusions'|'reviews'>,states:any[],linkIds:string[]){
 if(!Array.isArray(linkIds)||linkIds.length<2||linkIds.length>6||new Set(linkIds).size!==linkIds.length)throw Error('请选择2–6个不同的本项目明确引用');
 const columns=linkIds.map(linkId=>{
  const pinned=project.links.find(row=>row.linkId===linkId);if(!pinned||pinned.market!==project.market)throw Error('复盘引用必须属于同一项目和市场');
  const state=states.find(row=>row.linkId===linkId),currentHash=state?.current?.revisionHash||state?.current?.hash||state?.currentHash||null;
  const pinnedSummary=preserveResearchSummary(pinned.summary),summary=preserveResearchSummary(state?.current?.summary),fieldChanges=compareResearchSummaries(pinnedSummary,summary);
  return {pinnedSummary,comparisonStatus:pinnedSummary&&summary?'comparable':'unavailable',fieldChanges,linkId,kind:pinned.kind,id:pinned.id,instrument:pinned.instrument||null,pinnedHash:pinned.hash,pinnedAt:pinned.updatedAt,currentHash,
   changed:currentHash?currentHash!==pinned.hash:null,dataStatus:state?.dataStatus||'unavailable',reason:state?.reason||'当前引用不可核验，不推测后续结果',
   summary,
   conclusions:project.conclusions.filter(row=>row.references.some(ref=>ref.linkId===linkId&&ref.hash===pinned.hash)).map(({id,text,at})=>({id,text,at})),
   openReviews:project.reviews.filter(row=>row.linkId===linkId&&row.status==='open').map(({id,reason})=>({id,reason}))};
 });
 const result={projectId:project.id,projectVersion:project.version,market:project.market,hypothesis:project.hypothesis,columns,performanceWinner:null,ordersCreated:0,modelCalls:0,
  reason:'同一项目假设下的明确引用对照；固定判断与当前结果分开，缺失不补猜，不推断因果或优胜'};
 return {...result,contentHash:digest(result)};
}
