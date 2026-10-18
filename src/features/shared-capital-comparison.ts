import { createHash } from 'node:crypto';
import type { ResearchExperimentInput } from './experiment-runner';
import { assertMarketContext } from './research-contracts';

type Saved = {experiment:{id:string;market:string;instrument?:string;timeframe?:string};input:ResearchExperimentInput};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Isolated close-price cash simulation. Never writes to the paper execution ledger. */
export function compareSharedCapital(saved:Saved[]){
  if(!Array.isArray(saved)||saved.length<2||saved.length>6)throw Error('请选择2–6个已保存实验');
  const rows=[...saved].sort((a,b)=>String(a?.experiment?.id).localeCompare(String(b?.experiment?.id)));
  if(new Set(rows.map(r=>r?.experiment?.id)).size!==rows.length)throw Error('实验ID不可重复');
  const first=rows[0]?.input,base=first?.context;
  if(!base||!['stocks','crypto'].includes(base.market)||(base.market==='crypto'&&base.parameters?.marketType!=='spot'))throw Error('仅支持身份明确的现金股票/现货实验，不套用期权、永续或预测结算模型');
  const basis=(input:ResearchExperimentInput)=>{const c=input.context;return {market:c.market,instrument:c.instrument,timeframe:c.timeframe,dataSource:c.dataSource,dataSnapshotHash:c.dataSnapshotHash,dataFrom:c.dataFrom??null,dataTo:c.dataTo??null,feeRate:c.feeRate,slippage:c.slippage,pricesHash:hash(input.prices)};};
  for(const row of rows){
    const input=row?.input,c=input?.context;
    if(!input||!c||typeof row.experiment.id!=='string'||!row.experiment.id||row.experiment.market!==c.market||row.experiment.instrument!==c.instrument||row.experiment.timeframe!==c.timeframe)throw Error('旧实验输入/身份/周期未关联，不能猜测组合路径');
    assertMarketContext(c);
    if(!c.instrument||!c.timeframe||!c.strategyVersion||!c.dataSource||!c.dataSnapshotHash||!/^[a-f0-9]{64}$/i.test(c.dataSnapshotHash))throw Error('缺少来源、策略版本或快照Hash');
    if(typeof c.feeRate!=='number'||typeof c.slippage!=='number'||!Number.isFinite(c.feeRate)||!Number.isFinite(c.slippage)||c.feeRate<0||c.slippage<0||c.feeRate>.03||c.slippage>.03)throw Error('需要明确且有效的共同费用和滑点假设');
    if(!Array.isArray(input.prices)||input.prices.length<2||input.prices.length>10000||input.prices.some(p=>!Number.isFinite(p)||p<=0||p>1e12)||!Array.isArray(input.signals)||input.signals.length>2000)throw Error('价格/信号路径无效或超过研究预算');
    const indexes=new Set<number>();
    for(const signal of input.signals){
      if(!Number.isInteger(signal.timeIndex)||signal.timeIndex<0||signal.timeIndex>=input.prices.length||indexes.has(signal.timeIndex)||!['buy','sell'].includes(signal.direction)||(signal.orderType!=null&&signal.orderType!=='market')||(signal.price!=null&&signal.price!==input.prices[signal.timeIndex])||!Number.isFinite(signal.volume??1)||(signal.volume??1)<=0||(signal.volume??1)>1e9)throw Error('信号索引/数量无效或成交条件不可核验；不合并同策略同根多单、限价或盘中路径');
      indexes.add(signal.timeIndex);
    }
    if(hash(basis(input))!==hash(basis(first)))throw Error('组合只比较同市场、标的、周期、来源、实际价格Hash及成本口径；当前实验口径不同');
  }
  const startingCash=100000,prices=first.prices,feeRate=Number(base.feeRate),slippage=Number(base.slippage);
  function simulate(selected:Saved[]){
    let cash=startingCash,totalFees=0,totalSlippage=0,peak=startingCash,maxDrawdownPct=0;
    const holdings=new Map<string,number>(),trades:Array<{experimentId:string;timeIndex:number;side:string;quantity:number;price:number;fee:number}>=[],rejections:Array<{experimentId:string;timeIndex:number;reason:string}>=[],equityCurve:number[]=[];
    const events=new Map<number,Array<{id:string;signal:ResearchExperimentInput['signals'][number]}>>();
    for(const row of selected)for(const signal of row.input.signals){const group=events.get(signal.timeIndex)||[];group.push({id:row.experiment.id,signal});events.set(signal.timeIndex,group);}
    for(let index=0;index<prices.length;index++){
      // Explicit research tie-break: exits before entries, then stable experiment ID. Not observed intrabar order.
      const current=events.get(index)||[];current.sort((a,b)=>(a.signal.direction==='sell'?0:1)-(b.signal.direction==='sell'?0:1)||a.id.localeCompare(b.id));
      for(const {id,signal} of current){
        const quantity=signal.volume??1,held=holdings.get(id)||0,price=prices[index]*(1+(signal.direction==='buy'?slippage:-slippage)),fee=prices[index]*quantity*feeRate;
        let reason='';
        if(signal.direction==='buy'&&held>0)reason='本策略已有仓位，未猜测加仓规则';
        else if(signal.direction==='buy'&&cash+1e-8<price*quantity+fee)reason='共享资金不足，整单拒绝；不自动缩量或借贷';
        else if(signal.direction==='sell'&&held<quantity)reason='本策略持仓不足，不能卖出其他策略仓位';
        if(reason){rejections.push({experimentId:id,timeIndex:index,reason});continue;}
        cash+=signal.direction==='buy'?-(price*quantity+fee):price*quantity-fee;
        holdings.set(id,held+(signal.direction==='buy'?quantity:-quantity));totalFees+=fee;totalSlippage+=prices[index]*quantity*slippage;
        trades.push({experimentId:id,timeIndex:index,side:signal.direction,quantity,price,fee});
      }
      const equity=cash+[...holdings.values()].reduce((sum,q)=>sum+q*prices[index],0);equityCurve.push(equity);peak=Math.max(peak,equity);maxDrawdownPct=Math.max(maxDrawdownPct,(peak-equity)/peak*100);
    }
    return {startingCash,endingCash:cash,endingEquity:equityCurve.at(-1)!,totalReturnPct:(equityCurve.at(-1)!/startingCash-1)*100,totalFees,totalSlippage,maxDrawdownPct,equityCurve,trades,rejections,openPositions:[...holdings].filter(([,q])=>q>0).map(([experimentId,quantity])=>({experimentId,quantity,markPrice:prices.at(-1)!}))};
  }
  const combined=simulate(rows),contributions=rows.map(row=>{const without=simulate(rows.filter(r=>r!==row));return {experimentId:row.experiment.id,withoutEndingEquity:without.endingEquity,withoutReturnPct:without.totalReturnPct,marginalEquity:combined.endingEquity-without.endingEquity,marginalReturnPoints:combined.totalReturnPct-without.totalReturnPct,withoutRejections:without.rejections.length};});
  return {market:base.market,instrument:base.instrument,timeframe:base.timeframe,dataStatus:'historical',source:base.dataSource,evidenceRefs:[base.dataSnapshotHash],executionEnabled:false,ranking:null,basis:basis(first),configurationHash:hash({version:1,basis:basis(first),runs:rows.map(r=>({id:r.experiment.id,signals:r.input.signals})),startingCash}),combined,contributions,
    reason:'同一笔100000现金、同收盘路径和成本下逐个移除策略；增量贡献不是收益相加。保留原数量，不重新分配预算。',
    warnings:['研究模拟不是实际成交；信号按本根收盘成交的假设未证明信号在收盘前已可知，不能当作无未来信息的执行回测。','同根先退出后买入、再按实验ID排序是明确的模拟优先级，不是已观察的盘中顺序。','快照引用来自保存声明，价格Hash核验仅证明输入一致，未独立核验上游来源。','不强制平仓；未平仓按末根收盘估值，未计未来退出成本。少于20个成熟样本不提供可靠胜率或排名。']};
}
