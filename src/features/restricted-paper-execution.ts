import { createHash, randomUUID } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import type { UnifiedPaperLedgerStore, UnifiedPaperOrder } from './unified-paper-trading';
import type { StockQuote } from './stock-data-contracts';
import { stockQuoteObservationTime } from './stock-signal-schedule';
import { restrictedStrategy } from './strategy-definitions';

type State = Pick<SQLiteStateStore, 'get'|'set'|'transaction'|'appendAudit'|'health'>;
type Quote = { status: string; source: string; quote: StockQuote | null };
type Dependencies = { observation:(id:string)=>any; signals:(id:string)=>any[]; definition:(id:string,hash:string)=>any;
  snapshot:(id:string)=>any; actions:()=>any[]; ledger:Pick<UnifiedPaperLedgerStore,'getRunnerAccount'|'applyRunnerOrder'> };
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const money=(value:number)=>Math.round(value*1e6)/1e6;
const accountFor=(id:string)=>'research-forward:'+id;
interface Round {
  id:string; observationId:string; market:'stocks'; instrument:string; strategyId:string; strategyHash:string;
  experimentId:string; signalId:string; signalHash:string; snapshotId:string; barSnapshotId:string; barHash:string;
  accountId:string; runnerId:string; accountHash:string; sessionRevision:number; createdAt:number; expiresAt:number;
  quote:Quote; quoteHash:string; order:UnifiedPaperOrder; status:'preview'|'confirmed'; confirmedAt?:number;
  previewHash?:string; hash:string;
}

/** Manual quote-based paper execution; the only balances/orders remain in the unified ledger.
 * It is NOT exchange execution, a depth/queue model, a scheduler, or an AI runner configuration.
 */
export class RestrictedPaperExecutionStore {
  constructor(private state:State,private deps:Dependencies,private now=Date.now){}
  private healthy(){if(!this.state.health.ok)throw Error('模拟执行状态存储不可核验');}
  private stored<T>(key:string){this.healthy();const row=this.state.get<T>(key);this.healthy();return row;}
  private context(id:string,active=true){
    this.healthy();const s=this.deps.observation(id),v=this.deps.definition(s.strategyId,s.strategyHash);
    if(!/^forward_[a-f0-9]{64}$/.test(id)||s.id!==id||s.market!=='stocks'||!/^stock:us:[A-Z][A-Z0-9.-]{0,9}$/.test(s.instrument)
      ||v.id!==s.strategyId||v.hash!==s.strategyHash||v.market!=='stocks'||v.definition.timeframe!==s.timeframe
      ||!Number.isFinite(s.startedAt)||s.startedAt>this.now()||!Number.isSafeInteger(s.revision))throw Error('观察与策略版本身份不可核验；当前纸面执行只支持USD美股');
    if(active&&s.status!=='active')throw Error('观察已暂停或停止，不能提交纸面执行');
    return {s,v};
  }
  private signal(s:any,id:string,fresh=true){
    const matches=this.deps.signals(s.id).filter(row=>row.id===id),r=matches[0],step=restrictedStrategy.capabilities.intervals[s.timeframe];
    if(matches.length!==1||!r||r.market!==s.market||r.instrument!==s.instrument||r.strategyId!==s.strategyId||r.strategyVersion!==s.strategyHash
      ||r.experimentId!==s.experimentId||r.timeframe!==s.timeframe||r.source!==s.source||r.status!=='confirmed'||!['BUY','SELL'].includes(r.action)
      ||r.forwardObservation?.sessionId!==s.id||!Number.isFinite(r.forwardObservation.barTime)||!step
      ||r.forwardObservation.barTime+step>r.triggeredAt||!Number.isFinite(r.triggeredAt)||r.triggeredAt<s.startedAt||r.triggeredAt>this.now()
      ||fresh&&(r.triggeredAt<s.observingSince||this.now()-r.triggeredAt>90_000))throw Error('需要同一版本启动后刚确认的有效信号，不执行历史、过期或跨市场信号');
    if(!Array.isArray(r.evidenceRefs)||r.evidenceRefs.length!==1)throw Error('信号缺少唯一K线证据快照');
    const p=this.deps.snapshot(r.evidenceRefs[0]);
    if(!p||p.id!==r.evidenceRefs[0]||p.market!=='stocks'||![s.instrument,s.instrument.slice(9)].includes(p.instrument)||p.dataset!=='bars'
      ||p.timeframe!==s.timeframe||p.source!==s.source||!/^[a-f0-9]{64}$/.test(p.contentHash)
      ||!Number.isFinite(Date.parse(p.asOf))||Date.parse(p.asOf)>r.triggeredAt
      ||!Number.isFinite(Date.parse(p.createdAt))||Date.parse(p.createdAt)>r.triggeredAt)throw Error('信号快照身份、Hash或发布时点无法核验');
    // Outcome updates must not change the immutable decision linkage.
    const hash=digest({id:r.id,market:r.market,instrument:r.instrument,strategyId:r.strategyId,strategyVersion:r.strategyVersion,
      experimentId:r.experimentId,timeframe:r.timeframe,source:r.source,action:r.action,triggeredAt:r.triggeredAt,
      sessionId:r.forwardObservation.sessionId,barTime:r.forwardObservation.barTime,evidenceRefs:r.evidenceRefs});
    return {r,p,hash};
  }
  private validateQuote(s:any,q:Quote,at=this.now()){
    const price=q?.quote,t=stockQuoteObservationTime(price?.asOf||null);
    if(!q||q.status!=='live'||!q.source?.trim()||!price||price.symbol!==s.instrument.slice(9)||price.currency!=='USD'||price.isRealTime!==true
      ||t==null||t>at||at-t>30_000||!Number.isFinite(price.bestBid)||!Number.isFinite(price.bestAsk)
      ||price.bestBid!<=0||price.bestAsk!<price.bestBid!||!Number.isFinite(price.price)||price.price<=0)throw Error('报价来源、身份、币种、双边价格或实时源时间不合格；不使用缓存或历史价成交');
  }
  private account(s:any){
    const a=this.deps.ledger.getRunnerAccount(accountFor(s.id));
    this.healthy();
    if(a&&(a.runnerId!==s.id||a.accountId!==accountFor(s.id)||a.startingCash!==1000
      ||a.orders.some(o=>o.instrumentId!==s.instrument||o.strategyVersion!==s.strategyHash||o.experimentId!==s.experimentId)))throw Error('独立模拟账户身份或旧订单血缘不可核验');
    return a;
  }
  private companyActions(s:any){
    if(this.deps.actions().some(a=>a.market==='stocks'&&[s.instrument,s.instrument.slice(9)].includes(a.instrument)
      &&(!Number.isFinite(Date.parse(a.effectiveAt))||Date.parse(a.effectiveAt)>=s.startedAt&&Date.parse(a.effectiveAt)<=this.now())))throw Error('观察区间存在公司行动，需要重新核验收益口径；未自动调整或继续执行');
  }
  private read(id:string):Round{
    const r=this.stored<Round>('restricted-paper:round:'+id);
    if(!r||!/^rfexec_[a-f0-9]{64}$/.test(id)||r.id!==id)throw Error('纸面执行预览不存在');
    const {hash,...payload}=r;if(digest(payload)!==hash||digest(r.quote)!==r.quoteHash)throw Error('纸面执行证据Hash核验失败，不猜测恢复');
    return structuredClone(r);
  }
  async preview(id:string,input:{market:string;signalId:string;requestId:string},load:(instrument:string)=>Promise<Quote>){
    if(input.market!=='stocks'||!/^[a-f0-9-]{36}$/.test(input.requestId))throw Error('需要明确市场和有效幂等请求ID');
    const {s,v}=this.context(id),key='rfexec_'+digest([id,input.requestId]);
    const old=this.stored<Round>('restricted-paper:round:'+key);
    if(old){const r=this.read(key);if(r.observationId!==id||r.signalId!==input.signalId)throw Error('请求ID已绑定其他信号');return r;}
    const signal=this.signal(s,input.signalId);this.companyActions(s);
    if(this.stored('restricted-paper:consumed:'+input.signalId))throw Error('此信号已确认纸面执行，不重复成交');
    const q=await load(s.instrument);this.validateQuote(s,q);
    return this.state.transaction(()=>{
      const current=this.context(id).s;if(current.revision!==s.revision)throw Error('读取报价期间观察状态已变化，迟到结果未接纳');
      const duplicate=this.stored<Round>('restricted-paper:round:'+key);if(duplicate)return this.read(key);
      if(this.signal(current,input.signalId).hash!==signal.hash)throw Error('信号已变化，请重新核验');
      this.companyActions(current);this.validateQuote(current,q);const account=this.account(s),index=this.index(id);
      if(index.length>=200)throw Error('此观察已达到200次预览上限，保留旧记录');
      const existing=account?.positions.find(p=>p.instrumentId===s.instrument),held=existing?.quantity||0;
      if(!Number.isSafeInteger(held)||held<0)throw Error('持仓单位不可核验');
      const price=signal.r.action==='BUY'?q.quote!.bestAsk!:q.quote!.bestBid!,cash=account?.cash??1000;
      const costs=v.definition.costs,allocation=v.definition.position.maxAllocationPct;
      if(![costs.feeBps,costs.slippageBps,allocation,cash].every(Number.isFinite)||costs.feeBps<0||costs.slippageBps<0||allocation<=0||allocation>100||costs.feeBps+costs.slippageBps>=10000)throw Error('成本或预算配置不可核验');
      const room=Math.min(cash,Math.max(0,(cash+held*q.quote!.bestBid!)*allocation/100-held*q.quote!.bestBid!));
      const quantity=signal.r.action==='SELL'?held:Math.floor(room/(price*(1+(costs.feeBps+costs.slippageBps)/10000)));
      if(quantity<1)throw Error(signal.r.action==='SELL'?'没有可卖持仓':'预算或仓位上限不足一整股');
      const createdAt=this.now(),quoteHash=digest(q),snapshotId='rfquote_'+quoteHash;
      const order:UnifiedPaperOrder={id:'rforder_'+digest([id,input.signalId]),accountId:accountFor(id),runnerId:id,
        instrumentId:s.instrument,instrumentType:'stock',side:signal.r.action,price,quantity,timestamp:new Date(createdAt).toISOString(),
        strategy:s.strategyId,strategyVersion:s.strategyHash,experimentId:s.experimentId,signalId:input.signalId,dataSnapshotId:snapshotId,
        feeUsd:money(price*quantity*costs.feeBps/10000),slippageUsd:money(price*quantity*costs.slippageBps/10000),
        spreadUsd:money((q.quote!.bestAsk!-q.quote!.bestBid!)*quantity/2),reason:'手动确认的双边报价纸面模型；不是交易所成交或排队/深度证明'};
      const base={id:key,observationId:id,market:'stocks' as const,instrument:s.instrument,strategyId:s.strategyId,strategyHash:s.strategyHash,
        experimentId:s.experimentId,signalId:input.signalId,signalHash:signal.hash,snapshotId,barSnapshotId:signal.p.id,barHash:signal.p.contentHash,
        accountId:accountFor(id),runnerId:id,accountHash:digest(account),sessionRevision:s.revision,createdAt,expiresAt:createdAt+30_000,
        quote:q,quoteHash,order,status:'preview' as const};
      const round={...base,hash:digest(base)};this.state.set('restricted-paper:round:'+key,round);this.state.set('restricted-paper:index:'+id,[...index,key]);
      this.audit('preview',round);return structuredClone(round);
    });
  }
  private index(id:string){const rows=this.stored<string[]>('restricted-paper:index:'+id)||[];if(!Array.isArray(rows)||rows.length>200||new Set(rows).size!==rows.length)throw Error('纸面执行证据目录不可核验');return rows;}
  confirm(id:string,roundId:string,expectedHash:string){return this.state.transaction(()=>{
    const {s}=this.context(id,false),r=this.read(roundId);
    if(r.observationId!==id||r.instrument!==s.instrument||r.strategyHash!==s.strategyHash)throw Error('预览与观察身份不一致');
    if(r.status==='confirmed'){if(r.previewHash!==expectedHash)throw Error('原预览Hash不匹配');this.evidence(id);return r;}
    if(r.hash!==expectedHash)throw Error('预览Hash不匹配，请重新核验');
    this.context(id);if(s.revision!==r.sessionRevision||this.now()<r.createdAt||this.now()>r.expiresAt)throw Error('预览已过期或观察状态变化，请重新预览');
    this.companyActions(s);this.validateQuote(s,r.quote);const signal=this.signal(s,r.signalId);
    if(signal.hash!==r.signalHash||signal.p.contentHash!==r.barHash||signal.p.id!==r.barSnapshotId)throw Error('信号或K线快照已修订，不执行旧预览');
    if(this.stored('restricted-paper:consumed:'+r.signalId))throw Error('此信号已被其他确认消费，不重复成交');
    const account=this.account(s);if(digest(account)!==r.accountHash)throw Error('模拟账户已变化，请重新预览');
    // Both ledger and immutable evidence use the same SQLite transaction.
    const confirmedAt=this.now(),order={...r.order,timestamp:new Date(confirmedAt).toISOString()};
    this.deps.ledger.applyRunnerOrder(r.accountId,id,order,1000);
    const {hash:_old,...base}=r,confirmed={...base,order,status:'confirmed' as const,confirmedAt,previewHash:r.hash};
    const receipt={...confirmed,hash:digest(confirmed)};this.state.set('restricted-paper:round:'+r.id,receipt);this.state.set('restricted-paper:consumed:'+r.signalId,r.id);this.audit('confirmed',receipt);return structuredClone(receipt);
  });}
  evidence(id:string){
    const {s}=this.context(id,false),account=this.account(s),rounds=this.index(id).map(key=>this.read(key));
    const filled=rounds.filter(r=>r.status==='confirmed'),orders=account?.orders||[];
    if(filled.length!==orders.length)throw Error('账户包含未关联订单或执行证据缺失');
    let units=0,closedTrades=0,totalFees=0,totalSlippage=0,cycleCash=0,realizedNetPnl=0,wins=0;
    // Unified ledger stores newest first. Reverse rather than sort, preserving
    // actual commit order even when two confirmations have the same timestamp.
    for(const order of orders.slice().reverse()){
      const matches=filled.filter(r=>r.order.id===order.id),r=matches[0];
      if(matches.length!==1||!r||r.observationId!==id||r.accountId!==accountFor(id)||r.runnerId!==id||r.instrument!==s.instrument
        ||r.strategyHash!==s.strategyHash||r.experimentId!==s.experimentId||r.order.signalId!==r.signalId||r.order.dataSnapshotId!==r.snapshotId
        ||r.snapshotId!=='rfquote_'+r.quoteHash||this.stored('restricted-paper:consumed:'+r.signalId)!==r.id)throw Error('纸面成交证据血缘不可核验');
      const comparable={...order};delete comparable.pnlUsd;
      if(digest(comparable)!==digest(r.order))throw Error('账本订单与不可变执行证据不一致');
      const signal=this.signal(s,r.signalId,false);if(signal.hash!==r.signalHash||signal.p.contentHash!==r.barHash)throw Error('成交信号或快照证据发生修订，等待复查');
      this.validateQuote(s,r.quote,r.confirmedAt);
      units+=order.side==='BUY'?order.quantity:-order.quantity;
      if(!Number.isSafeInteger(units)||units<0)throw Error('成交数量或配对不可核验');
      cycleCash+=(order.side==='BUY'?-1:1)*order.price*order.quantity-(order.feeUsd||0)-(order.slippageUsd||0);
      if(order.side==='SELL'&&units===0){closedTrades++;realizedNetPnl+=cycleCash;if(cycleCash>0)wins++;cycleCash=0;}
      totalFees+=order.feeUsd||0;totalSlippage+=order.slippageUsd||0;
    }
    return {model:'bilateral-quote-paper-v1',accountId:accountFor(id),market:s.market,instrument:s.instrument,strategyHash:s.strategyHash,
      observationId:id,orders:orders.length,closedTrades,pairedFills:closedTrades,reliableWinRate:closedTrades>=20?100*wins/closedTrades:null,realizedNetPnl:money(realizedNetPnl),totalFees:money(totalFees),totalSlippage:money(totalSlippage),
      evidenceRefs:filled.map(r=>r.id),receipts:filled.map(r=>({id:r.id,signalId:r.signalId,orderId:r.order.id,side:r.order.side,snapshotId:r.snapshotId,confirmedAt:r.confirmedAt,feeUsd:r.order.feeUsd??null,slippageUsd:r.order.slippageUsd??null})),reason:'核验同一观察的显式订单/信号/快照引用；纸面报价模型，不是实盘成交或深度保证；少于20笔不排名'};
  }
  view(id:string){const {s}=this.context(id,false);return {evidence:this.evidence(id),account:this.account(s),rounds:this.index(id).map(key=>this.read(key)),warning:'手动研究，1000 USD独立虚拟预算；不会启动自动调度、调用模型或修改已有跑单'};}
  private audit(action:string,r:Round){this.state.appendAudit({id:randomUUID(),action:'restricted-paper-'+action,at:new Date(this.now()).toISOString(),detail:JSON.stringify({id:r.id,observationId:r.observationId,hash:r.hash,signalId:r.signalId,orderId:r.status==='confirmed'?r.order.id:null})});}
}
