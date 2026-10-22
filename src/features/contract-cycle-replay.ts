import {createHash} from 'node:crypto';
import {contractIdentity} from './contract-research';

export interface ContractCycleEvent {
 id:string;kind:'fill'|'market-observation'|'funding-settlement';at:string;
 source:string;dataStatus:'historical'|'partial';evidenceRefs:string[];
 values:Record<string,unknown>;reason:string;
}
interface Input {market:string;instrument:string;accountId:string;orders:any[];history:any;settlements:any[];from?:string;to:string}
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const positive=(v:unknown)=>finite(v)&&v>0;
/** Observation playback only. No inferred position pairing, cash ledger, price interpolation or historical liquidation model. */
export function buildContractCycleReplay(input:Input,now=Date.now()){
 if(input.market!=='crypto')throw Error('合约周期回放只支持虚拟币市场');
 const identity=contractIdentity(input.instrument),expected='https://api.gateio.ws/api/v4/'+(identity.kind==='perpetual'?'futures':'delivery')+'/usdt/contracts/'+identity.contract;
 if(!input.accountId||input.history?.instrument!==input.instrument||input.history?.market&&input.history.market!=='crypto')throw Error('合约或账户身份不可核验');
 const from=input.from?Date.parse(input.from):-Infinity,to=Date.parse(input.to);
 if(Number.isNaN(from)||!Number.isFinite(to)||to>now+1000||from>to)throw Error('周期回放时间区间无效');
 if(!Array.isArray(input.orders)||!Array.isArray(input.history.rows)||!Array.isArray(input.settlements)||input.orders.length>10000||input.history.rows.length>2000||input.settlements.length>10000)throw Error('回放范围过大或记录无效，请缩小区间');
 const inside=(at:number)=>Number.isFinite(at)&&at>=from&&at<=to;
 const events:ContractCycleEvent[]=[];let unlinkedOrders=0,conflictedOrders=0,rejectedObservations=0,rejectedSettlements=0;
 const orders=new Map<string,any[]>();
 for(const row of input.orders){if(row?.instrumentId!==input.instrument||row.instrumentType!=='crypto'||!inside(Date.parse(row.timestamp)))continue;if(!row.accountId){unlinkedOrders++;continue;}if(row.accountId!==input.accountId)continue;if(typeof row.id!=='string'||!row.id||!['BUY','SELL'].includes(row.side)||!positive(row.price)||!positive(row.quantity)){unlinkedOrders++;continue;}const group=orders.get(row.id)||[];group.push(row);orders.set(row.id,group);}
 for(const [id,group]of orders){if(new Set(group.map(row=>JSON.stringify(row))).size!==1){conflictedOrders++;continue;}const row=group[0],feeUsd=finite(row.feeUsd)&&row.feeUsd>=0?row.feeUsd:null,slippageUsd=finite(row.slippageUsd)&&row.slippageUsd>=0?row.slippageUsd:null;
  events.push({id:'fill:'+id,kind:'fill',at:new Date(row.timestamp).toISOString(),source:'统一模拟账本（纸面成交，不是实盘）',dataStatus:feeUsd===null||slippageUsd===null?'partial':'historical',evidenceRefs:[id,...(typeof row.dataSnapshotId==='string'&&row.dataSnapshotId?[row.dataSnapshotId]:[])],values:{side:row.side,price:row.price,quantity:row.quantity,contractMultiplier:positive(row.contractMultiplier)?row.contractMultiplier:null,feeUsd,slippageUsd,recordedPnlUsd:finite(row.pnlUsd)?row.pnlUsd:null,strategyVersion:row.strategyVersion||null,signalId:row.signalId||null},reason:'仅该账户该合约的明确订单；报价快照ID只作关联，不等于已核验当时盘口。不按时间猜测入场/退出配对；缺少乘数时不推算敞口。'});
 }
 for(const row of input.history.rows){const at=Date.parse(row?.retrievedAt);if(!inside(at))continue;if(row.market!=='crypto'||row.instrument!==input.instrument||row.source!==expected||typeof row.evidenceRef!=='string'||!row.evidenceRef||!/^[a-f0-9]{64}$/.test(row.contentHash||'')||row.sourceTime!=null&&(!Number.isFinite(Date.parse(row.sourceTime))||Date.parse(row.sourceTime)>at)){rejectedObservations++;continue;}
  let quotes:any=null;if(typeof row.quoteJson==='string'&&row.quoteJson.length<=512)try{const q=JSON.parse(row.quoteJson);if(q?.currency==='USDT'&&Object.keys(q).every(k=>['currency','lastPrice','markPrice','indexPrice'].includes(k))&&['lastPrice','markPrice','indexPrice'].every(k=>q[k]==null||positive(q[k])))quotes=q;}catch{/* Old or malformed quotes remain unknown. */}
  const oi=row.units?.openInterestUsd==='USDT'&&finite(row.openInterestUsd)&&row.openInterestUsd>=0?row.openInterestUsd:null,basis=row.units?.basisPct==='%'&&finite(row.basisPct)?row.basisPct:null;
  events.push({id:'observation:'+row.evidenceRef,kind:'market-observation',at:new Date(at).toISOString(),source:row.source,dataStatus:quotes&&['lastPrice','markPrice','indexPrice'].every(k=>positive(quotes[k]))&&oi!==null&&basis!==null?'historical':'partial',evidenceRefs:[row.evidenceRef,row.contentHash],values:{lastPrice:quotes?.lastPrice??null,markPrice:quotes?.markPrice??null,indexPrice:quotes?.indexPrice??null,quoteCurrency:'USDT',openInterestUsd:oi,basisPct:basis,sourceTime:row.sourceTime??null,timeBasis:'retrievedAt',observedRulesJson:typeof row.rulesJson==='string'&&row.rulesJson.length<=2048?row.rulesJson:null,ruleEffectiveAt:null},reason:'抓取时点快照，不是逐笔成交价；旧价格未归档时保持未知，不以当前报价补历史。规则观察时间不等于生效时间。'});
 }
 const settlements=new Map<string,any[]>();for(const row of input.settlements){if(row?.market!=='crypto'||row.instrument!==input.instrument||row.accountId!==input.accountId||!inside(Date.parse(row.settledAt)))continue;if(!row.id||row.status!=='verified'||row.currency!=='USDT'||row.amountConvention!=='cash-credit-positive'||!finite(row.amount)||typeof row.source!=='string'||!row.source||typeof row.evidenceRef!=='string'||!row.evidenceRef){rejectedSettlements++;continue;}const group=settlements.get(row.id)||[];group.push(row);settlements.set(row.id,group);}
 for(const [id,group]of settlements){if(new Set(group.map(row=>JSON.stringify(row))).size!==1){rejectedSettlements++;continue;}const row=group[0];events.push({id:'funding:'+id,kind:'funding-settlement',at:new Date(row.settledAt).toISOString(),source:row.source,dataStatus:'historical',evidenceRefs:[row.evidenceRef],values:{cashFlowUSDT:row.amount,currency:'USDT'},reason:'仅已有账本明确记录的资金现金流；不把市场费率当作账户实际支付，不修改余额。'});}
 events.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id));
 const incomplete=events.some(e=>e.dataStatus==='partial')||unlinkedOrders+conflictedOrders+rejectedObservations+rejectedSettlements>0||input.history.dataStatus!=='historical';
 const dataStatus=events.length?incomplete?'partial':'historical':['unavailable','failed'].includes(input.history.dataStatus)?input.history.dataStatus:unlinkedOrders+conflictedOrders+rejectedObservations+rejectedSettlements>0?'partial':'empty';
 const result={market:'crypto',instrument:input.instrument,accountId:input.accountId,from:Number.isFinite(from)?new Date(from).toISOString():null,to:new Date(to).toISOString(),events,dataStatus,unlinkedOrders,conflictedOrders,rejectedObservations,rejectedSettlements,totalNetPnl:null,accountChanges:0,executionEnabled:false,pointInTimeVerified:false,marginModel:null,coverageComplete:false,reason:'一般账本复盘，非盲测或时点知识还原；事件生效日期不证明证据当时可知。只回放明确记录，不配对、不插值、不恢复未知期初仓位。USD记账费用与USDT资金现金流分开；没有完整持有期、汇率和历史风险参数，不发布净收益或强平价。'+(typeof input.history.reason==='string'?' 归档状态：'+input.history.reason.slice(0,1000):'')};
 return {...result,contentHash:createHash('sha256').update(JSON.stringify(result)).digest('hex')};
}
