import { createHash } from 'node:crypto';
export interface RelationshipQuote {
  market: string; instrument: string; probability: number; observedAt: string;
  source: string; ruleHash: string | null; evidenceRef: string | null;
}

type SavedRelationship={id:string;market:'prediction';left:RelationshipQuote;right:RelationshipQuote;relationship:string;reason:string;attestedAt:string;semanticStatus:'human-attested';executionEnabled:false;hash:string};
const graphHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Append-only human attestations. A stored relationship is not automatic semantic verification. */
export class PredictionRelationshipStore {
  constructor(private readonly store:{get<T>(key:string):T|null;set<T>(key:string,value:T):void;transaction<T>(fn:()=>T):T}){}
  save(input:{left:RelationshipQuote;right:RelationshipQuote;relationship:string;confirmed:boolean;reason:string},now=new Date().toISOString()):SavedRelationship {
    if(!input||input.confirmed!==true||typeof input.reason!=='string'||input.reason.trim().length<8||input.reason.length>600)throw Error('需人工核对官方规则并保存至少8字的关系依据');
    const audit=auditPredictionRelationship({...input,now:Date.parse(now)});
    if(audit.dataStatus!=='cached')throw Error(audit.reason);
    const quote=(row:RelationshipQuote):RelationshipQuote=>({market:row.market,instrument:row.instrument,probability:row.probability,observedAt:row.observedAt,source:row.source.slice(0,160),ruleHash:row.ruleHash,evidenceRef:row.evidenceRef});
    const content={market:'prediction' as const,left:quote(input.left),right:quote(input.right),relationship:input.relationship,reason:input.reason.trim(),attestedAt:now,semanticStatus:'human-attested' as const,executionEnabled:false as const};
    const id='prg_'+graphHash(content),record={id,...content,hash:graphHash({id,...content})};
    return this.store.transaction(()=>{
      const key='prediction:manual-relationship-graph',rows=this.store.get<SavedRelationship[]>(key)||[];
      if(!Array.isArray(rows))throw Error('关系图存储损坏，不覆盖原件');
      const previous=rows.find(row=>row.id===id);if(previous){const {hash,...saved}=previous;if(graphHash(saved)!==hash)throw Error('旧关系证据Hash冲突，不覆盖');return structuredClone(previous);}
      if(rows.length>=500||JSON.stringify([record,...rows]).length>2000000)throw Error('关系图历史容量已满，不自动删除证据');
      this.store.set(key,[record,...rows]);return structuredClone(record);
    });
  }
  list(input:{market:string;now?:string;ruleHash:(instrument:string)=>string|null}) {
    if(input.market!=='prediction')return [];
    const now=Date.parse(input.now||new Date().toISOString()),rows=this.store.get<SavedRelationship[]>('prediction:manual-relationship-graph');
    if(!Number.isFinite(now)||!Array.isArray(rows))return [];
    return rows.slice(0,500).filter(record=>{
      try{const {hash,...content}=record;return graphHash(content)===hash&&record.market==='prediction'&&record.semanticStatus==='human-attested'&&Number.isFinite(Date.parse(record.attestedAt))&&Date.parse(record.attestedAt)<=now;}catch{return false;}
    }).map(record=>{
      const a=input.ruleHash(record.left.instrument),b=input.ruleHash(record.right.instrument),ruleStatus=!a||!b?'missing':a===record.left.ruleHash&&b===record.right.ruleHash?'unchanged':'changed';
      return {record:structuredClone(record),ruleStatus,probabilityConclusion:null,reason:ruleStatus==='unchanged'?'人工声明关系及原证据，非自动语义核验；历史概率不当作当前报价':'官方规则Hash变化或缺少当前证据，原关系须人工重新核对；不自动继承结论'};
    });
  }
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
