export interface RelationshipQuote {
  market: string; instrument: string; probability: number; observedAt: string;
  source: string; ruleHash: string | null; evidenceRef: string | null;
}

/** A conditional research check, never automatic semantic matching or an arbitrage recommendation. */
export function auditPredictionRelationship(input: {
  left: RelationshipQuote; right: RelationshipQuote; relationship: string; confirmed: boolean; now?: number;
}) {
  const {left,right,relationship}=input,now=input.now??Date.now();
  const unavailable=(reason:string)=>({market:'prediction',dataStatus:'unavailable',reason,evidenceRefs:[] as string[],violated:null,violationProbability:null});
  if(input.confirmed!==true||!['mutually-exclusive','left-implies-right','equivalent'].includes(relationship))return unavailable('需明确确认关系假设；不从标题、主题或分组猜测关系');
  if(!left||!right||left.instrument===right.instrument)return unavailable('需要两个不同事件的明确身份');
  for(const quote of [left,right]) {
    const at=Date.parse(quote.observedAt);
    if(quote.market!=='prediction'||!/^prediction:(kalshi|polymarket):[^\s]+$/.test(quote.instrument))return unavailable('仅支持明确身份的预测市场，不跨市场补位');
    if(!Number.isFinite(quote.probability)||quote.probability<0||quote.probability>1)return unavailable('来源概率无效，禁止零值兜底');
    if(!Number.isFinite(now)||!Number.isFinite(at)||at>now||now-at>900000)return unavailable('快照超过15分钟或来源时间无效，不给出一致性结论');
    if(!quote.source||!quote.evidenceRef||!quote.ruleHash||!/^[a-f0-9]{64}$/.test(quote.ruleHash))return unavailable('缺少已保存的规则 Hash 或证据，不能检查关系');
  }
  if(Math.abs(Date.parse(left.observedAt)-Date.parse(right.observedAt))>60000)return unavailable('来源时间相差超过一分钟，不混合时点比较');
  const difference=relationship==='mutually-exclusive'?left.probability+right.probability-1:relationship==='left-implies-right'?left.probability-right.probability:Math.abs(left.probability-right.probability);
  const violationProbability=Math.max(0,difference),violated=violationProbability>1e-8;
  return {market:'prediction',dataStatus:'cached',relationship,left,right,violated,violationProbability,evidenceRefs:[left.evidenceRef!,right.evidenceRef!],
    reason:'仅在管理员声明的关系假设成立时进行数学一致性检查；关系未经自动核验。报价、流动性、手续费与结算规则差异可能影响解释，不构成套利或下单建议。'};
}
