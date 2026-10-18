import { createHash,randomUUID } from 'node:crypto';
import type { AiRunner } from './ai-paper-runner';
import type { UnifiedPaperRunnerAccount } from './unified-paper-trading';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import { diagnosticRunnerMarket } from './ai-runner-diagnostics';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Dependencies {runner(id:string):AiRunner|null;account(id:string):UnifiedPaperRunnerAccount|null;resume(id:string):AiRunner|null;enabled():boolean}
type Store=Pick<SQLiteStateStore,'transaction'|'getIdempotent'|'setIdempotent'|'appendAudit'>;

/** Reconciliation and explicit resume only; never repairs balances or changes risk parameters. */
export class AiRunnerRecovery {
  constructor(private readonly store:Store,private readonly deps:Dependencies){}
  preview(id:string,reviewedAt=new Date().toISOString()) {
    const runner=this.deps.runner(id);if(!runner)throw Error('跑单不存在');
    const market=diagnosticRunnerMarket(runner),account=this.deps.account(runner.accountId||'ai-runner:'+id),blocked:string[]=[],warnings:string[]=[];
    if(!Number.isFinite(Date.parse(reviewedAt)))throw Error('复核时点无效');
    if(!this.deps.enabled())blocked.push('AI模拟跑单功能未开启；本向导不自动开启功能标志');
    if(!market||!runner.universe||runner.universe.market!==market||!runner.universe.hash)blocked.push('市场或冻结标的配置无法核验');
    if(runner.executionState!=='ready')blocked.push('旧账户未核验关联，只读保留，不猜测迁移或修复');
    if(runner.status!=='STOPPED')blocked.push('跑单不是停止状态，无需重复恢复');
    if(runner.comparisonControl)blocked.push('对照账户只能由原对照组协调器恢复，不能单独恢复');
    if(runner.circuitBreakerReason&&!runner.manualPaused)blocked.push('存在风险熔断，必须先使用既有人工复核流程，不自动清除');
    if(!runner.policy||![runner.policy.maxTradeUsd,runner.policy.maxBudgetUsd,runner.policy.maxDailyLossUsd,runner.policy.maxDrawdownPct,runner.policy.minFreshnessMs,runner.budgetUsd].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0))blocked.push('原风险参数或预算无效，不采用新默认值替代');
    const accountId='ai-runner:'+runner.id;
    if(!account||account.accountId!==accountId||account.runnerId!==id||runner.accountId!==accountId)blocked.push('账户身份未关联或不属于该跑单');
    if(!account||![account.cash,runner.cashUsd,account.startingCash].every(n=>typeof n==='number'&&Number.isFinite(n))||Math.abs(account.cash-runner.cashUsd)>.000001||account.cash<0||account.startingCash!==runner.budgetUsd)blocked.push('统一账本现金/初始预算与跑单不一致；仅报告，不覆盖余额');
    const orderIds=new Set<string>(),orders=account?.orders||[];
    const type=market?({stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'} as Record<string,string>)[market]:null;
    const validIdentity=(instrumentId:unknown)=>typeof instrumentId==='string'&&!!type&&new RegExp('^'+type+':[^:]+:.+$').test(instrumentId);
    if(orders.some(order=>!order.id||orderIds.has(order.id)||!orderIds.add(order.id)||order.accountId!==accountId||order.runnerId!==id||!validIdentity(order.instrumentId)||order.instrumentType!==type))blocked.push('订单身份重复、未关联、市场错误或属于其他账户');
    if(!Array.isArray(runner.trades)||runner.trades.some(t=>!t.orderId||!orderIds.has(t.orderId)))blocked.push('旧交易缺少明确订单关联');
    const group=(positions:Array<{instrumentId?:string;quantity:number;contractMultiplier?:number;outcome?:string;side?:string;instrumentType?:string}>,isRunner:boolean)=>{
      const map=new Map<string,number>();
      for(const p of positions){
        if(p.instrumentType!=null&&p.instrumentType!==type||market!=='prediction'&&p.side!=null&&p.side!=='LONG'){blocked.push('持仓类型或方向与有限损失买入账户不一致');continue;}
        if(!validIdentity(p.instrumentId)||!Number.isFinite(p.quantity)||p.quantity<=0||market==='options'&&p.contractMultiplier==null||p.contractMultiplier!=null&&(!Number.isFinite(p.contractMultiplier)||p.contractMultiplier<=0)){blocked.push('持仓市场、身份、单位或数量无法核验');continue;}
        const outcome=market==='prediction'?(isRunner?p.side:p.outcome):'';
        if(market==='prediction'&&!['YES','NO'].includes(outcome||'')){blocked.push('预测持仓缺少明确YES/NO身份');continue;}
        const key=JSON.stringify([p.instrumentId,outcome,p.contractMultiplier??null]);map.set(key,(map.get(key)||0)+p.quantity);
      }return map;
    };
    const expected=group((runner.positions||[]).filter(p=>p.status==='OPEN'),true),actual=group(account?.positions||[],false);
    if(expected.size!==actual.size||[...expected].some(([key,quantity])=>!actual.has(key)||Math.abs(actual.get(key)!-quantity)>1e-6))blocked.push('跑单持仓与统一账户数量/方向/乘数不一致，不自动调平');
    if(account?.lifecycleEvents?.some(e=>e.status==='pending-review')||account?.corporateReceivables?.length)warnings.push('存在待核验公司行动或应收权益；恢复不等于结算核验');
    if(!['live','delayed'].includes(account?.valuationStatus||runner.lastDataStatus||''))warnings.push('最近估值过期或新鲜度未知；下一轮必须重新通过报价、预算和模型额度门控，复核不创建订单');
    const config={runnerId:id,market,accountId:runner.accountId,status:runner.status,stoppedAt:runner.stoppedAt,manualPaused:runner.manualPaused,circuitBreakerReason:runner.circuitBreakerReason,budgetUsd:runner.budgetUsd,policy:runner.policy,universe:runner.universe,model:runner.model,modelSelection:runner.modelSelection,quoteSelection:runner.quoteSelection,mode:runner.mode,trigger:runner.trigger,strategyVersion:runner.strategyVersion};
    const economic={cash:account?.cash,startingCash:account?.startingCash,orders:orders.map(({id,instrumentId,quantity,price,side,outcome,contractMultiplier,feeUsd,slippageUsd})=>({id,instrumentId,quantity,price,side,outcome,contractMultiplier,feeUsd,slippageUsd})),positions:account?.positions.map(({instrumentId,quantity,outcome,contractMultiplier,averageEntryPrice})=>({instrumentId,quantity,outcome,contractMultiplier,averageEntryPrice})),lifecycleEvents:account?.lifecycleEvents,corporateReceivables:account?.corporateReceivables};
    const report={runnerId:id,market,accountId,canResume:blocked.length===0,blocked:[...new Set(blocked)],warnings,reviewedAt,expiresAt:new Date(Date.parse(reviewedAt)+300000).toISOString(),configurationHash:hash(config),ledgerHash:hash(economic),cash:account?.cash??null,runnerCash:runner.cashUsd,openPositions:account?.positions.length??null,orderCount:orders.length,riskParameters:runner.policy,modelCalls:0,orderChanges:0};
    return {...report,reviewHash:hash(report)};
  }
  confirm(id:string,input:{expectedHash:string;reviewedAt:string;confirmed:boolean},now=new Date().toISOString()) {
    if(!input||input.confirmed!==true||Object.keys(input).some(k=>!['expectedHash','reviewedAt','confirmed'].includes(k)))throw Error('必须明确人工确认，不能提交预算、风控或修复值');
    const elapsed=Date.parse(now)-Date.parse(input.reviewedAt);
    if(!Number.isFinite(elapsed)||elapsed<0||elapsed>300000||input.reviewedAt.slice(0,10)!==now.slice(0,10))throw Error('复核已经过期或跨越交易风险日期，请重新检查');
    return this.store.transaction(()=>{
      const key='ai-runner:recovery:'+id+':'+input.expectedHash;
      const prior=this.store.getIdempotent<{runnerId:string;configurationHash:string}>(key);if(prior)return {...prior,status:'duplicate' as const,modelCalls:0,orderChanges:0};
      const preview=this.preview(id,input.reviewedAt);
      if(preview.reviewHash!==input.expectedHash)throw Error('账户、来源或配置已有变化，请重新复核');
      if(!preview.canResume)throw Error('恢复条件不满足：'+preview.blocked.join('；'));
      const resumed=this.deps.resume(id);if(!resumed||resumed.status!=='RUNNING')throw Error('原恢复流程未允许恢复，不放宽风险限制');
      const result={runnerId:id,configurationHash:preview.configurationHash,reviewHash:preview.reviewHash,at:now,status:'resumed' as const,modelCalls:0,orderChanges:0};
      this.store.appendAudit({id:randomUUID(),action:'ai_runner_recovery_confirmed',detail:JSON.stringify({runnerId:id,reviewHash:preview.reviewHash,ledgerHash:preview.ledgerHash,configurationHash:preview.configurationHash}),at:now});
      this.store.setIdempotent(key,result);return result;
    });
  }
}
