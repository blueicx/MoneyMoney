import type { PortfolioRow } from './decision-intelligence';

interface CovarianceEvidence {dataStatus:string;instruments:string[];covariance:number[][]}
/** Hypothetical concentration cap; no orders, fees, prices, FX or allocation changes are inferred. */
export function previewPortfolioRiskBudget(rows:PortfolioRow[],capPct=20,evidence?:CovarianceEvidence) {
  if(!Number.isFinite(capPct)||capPct<5||capPct>100)throw new Error('单标的上限须为5–100%');
  const empty=(reason:string,dataStatus='unavailable')=>({dataStatus,reason,capPct,currency:null as string|null,totalValue:null as number|null,cashReserveAmount:null as number|null,
    positions:[] as Array<{instrument:string;currentPct:number;targetPct:number;reductionAmount:number}>,before:{largestWeightPct:null as number|null,dailyVolatilityPct:null as number|null},after:{largestWeightPct:null as number|null,dailyVolatilityPct:null as number|null},orderChanges:0,executionEnabled:false});
  if(!rows.length)return empty('所选账户没有仓位','empty');
  if(!rows.every(row=>['stocks','crypto'].includes(row.market)&&row.market===rows[0].market&&row.instrument.startsWith(row.market==='stocks'?'stock:':'crypto:')))return empty('仅适用于同市场现金股票或现货研究；其他市场缺少适用风险模型','unsupported');
  if(!rows[0].currency||rows[0].currency==='UNKNOWN'||rows.some(row=>row.currency!==rows[0].currency))return empty('币种未知或缺少已核验汇率，不合并不同币种');
  if(rows.some(row=>!Number.isFinite(row.quantity)||row.quantity<0||!Number.isFinite(row.price)||row.price<=0))return empty('仓位数量或保存估值无效');
  const values=rows.map(row=>row.quantity*row.price),total=values.reduce((sum,v)=>sum+v,0);
  if(!Number.isFinite(total)||total<=0)return empty('总估值无效');
  const totals=new Map<string,number>();rows.forEach((row,i)=>totals.set(row.instrument,(totals.get(row.instrument)||0)+values[i]));
  const positions=[...totals].map(([instrument,value])=>({instrument,currentPct:value/total*100,targetPct:Math.min(value/total*100,capPct),reductionAmount:Math.max(0,value-total*capPct/100)}));
  const before=values.map(value=>value/total),after=rows.map((row,i)=>before[i]*Math.min(1,total*capPct/100/(totals.get(row.instrument)||Infinity)));
  const matrix=evidence?.covariance;
  const valid=evidence?.dataStatus==='historical'&&JSON.stringify(evidence.instruments)===JSON.stringify(rows.map(row=>row.instrument))&&Array.isArray(matrix)&&matrix.length===rows.length&&matrix.every((r,i)=>Array.isArray(r)&&r.length===rows.length&&r.every((v,j)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v-(matrix[j]?.[i]??Infinity))<1e-10)&&(r[i]??-1)>=0);
  const volatility=(weights:number[])=>{if(!valid||!matrix)return null;const variance=weights.reduce((sum,w,i)=>sum+weights.reduce((s,v,j)=>s+w*v*matrix[i][j],0),0);return variance>=-1e-12?Math.sqrt(Math.max(0,variance))*100:null;};
  const first=volatility(before),last=volatility(after);
  return {...empty('假设减持超出单标的上限的部分并保留原币种现金；现金名义日收益假设为零，未计费用、利息、汇率与成交可行性。不是调仓推荐或订单。',first===null?'partial':'historical'),currency:rows[0].currency,totalValue:total,
    positions,cashReserveAmount:positions.reduce((sum,p)=>sum+p.reductionAmount,0),before:{largestWeightPct:Math.max(...positions.map(p=>p.currentPct)),dailyVolatilityPct:first},after:{largestWeightPct:Math.max(...positions.map(p=>p.targetPct)),dailyVolatilityPct:last},
    assumptions:['以所选保存仓位估值为分母；不包含未导入的账户现金、负债或汇率转换','估值可能过期；此预览不验证实时成交可行性，不修改持仓或创建订单'],
    riskReason:first===null?'需要与当前仓位顺序及身份一致的已核验日期对齐协方差；没有历史时不估计风险变化':'只改变假设权重，共用同一历史协方差和原始估值分母，不将减仓后权重重新归一化'};
}
