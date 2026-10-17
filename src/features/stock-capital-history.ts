type Fact={start?:string;end:string;filed?:string;form?:string;fp?:string;val:number;accn?:string};
type Facts={cik?:number;facts?:Record<string,Record<string,{units?:Record<string,Fact[]>}>>};
type Evidence={tag:string;unit:string;start:string|null;end:string;filed:string;accession:string|null};
type Field={value:number|null;unit:string;reason:string|null;evidence:Evidence[]};
export type CapitalPoint={periodStart:string;periodEnd:string;operatingCashFlowUsd:Field;repurchasesUsd:Field;dividendsUsd:Field;cashUsd:Field;debtUsd:Field;shares:Field;shareChangePct:number|null};
type RevisionValue={value:number|null;filed:string;accession:string|null;form:string|null};
export type CapitalRevision={tag:string;unit:string;periodStart:string|null;periodEnd:string;before:RevisionValue;after:RevisionValue;change:number|null;reason:string};
export type CapitalHistory={points:CapitalPoint[];revisions?:CapitalRevision[];asOf:string;source:string;dataStatus:'historical'|'partial'|'empty';reason:string};

/** Exact annual windows only; no nearest-date, currency or missing-zero fallback. */
export function buildCapitalHistory(facts:Facts,asOf=new Date().toISOString()):CapitalHistory {
  const cutoff=Date.parse(asOf);if(!Number.isFinite(cutoff))throw Error('财务时点无效');
  const gaap=facts.facts?.['us-gaap']||{};
  const read=(tag:string,unit:string,instant=false)=> (gaap[tag]?.units?.[unit]||[]).filter(row=>{
    // SEC date-only fields lack acceptance time. Wait until 06:00 UTC the
    // next day, beyond the whole New York filing day in either DST regime.
    const end=Date.parse(row.end),filed=row.filed&&(/^\d{4}-\d{2}-\d{2}$/.test(row.filed)?Date.parse(row.filed+'T00:00:00Z')+30*3600000:Date.parse(row.filed));
    const duration=row.start?(end-Date.parse(row.start))/86400000:null;
    return typeof row.val==='number'&&Number.isFinite(row.val)&&Number.isFinite(end)&&end<=cutoff&&typeof filed==='number'&&Number.isFinite(filed)&&filed<=cutoff&&['10-K','10-K/A'].includes(row.form||'')&&row.fp==='FY'&&(instant?!row.start:duration!==null&&duration>=300&&duration<=400);
  });
  const anchor=read('NetCashProvidedByUsedInOperatingActivities','USD');
  const revisions:CapitalRevision[]=[];
  for(const [tag,unit,instant] of [['NetCashProvidedByUsedInOperatingActivities','USD',false],['PaymentsForRepurchaseOfCommonStock','USD',false],['PaymentsOfDividendsCommonStock','USD',false],['CashAndCashEquivalentsAtCarryingValue','USD',true],['LongTermDebtCurrent','USD',true],['LongTermDebtNoncurrent','USD',true],['CommonStockSharesOutstanding','shares',true]] as const){
    const periods=new Map<string,Fact[]>();
    for(const row of read(tag,unit,instant)){const key=JSON.stringify([instant?null:row.start,row.end]),rows=periods.get(key)||[];rows.push(row);periods.set(key,rows);}
    for(const rows of periods.values()){
      const filed=[...new Set(rows.map(row=>row.filed!))].sort();
      const value=(date:string):RevisionValue=>{const same=rows.filter(row=>row.filed===date),values=new Set(same.map(row=>row.val));return {value:values.size===1?same[0].val:null,filed:date,accession:same.length===1?same[0].accn||null:null,form:same.length===1?same[0].form||null:null};};
      for(let i=1;i<filed.length;i++){const before=value(filed[i-1]),after=value(filed[i]);if(before.value===after.value&&before.value!==null)continue;
        revisions.push({tag,unit,periodStart:instant?null:rows[0].start||null,periodEnd:rows[0].end,before,after,change:before.value!==null&&after.value!==null?after.value-before.value:null,
          reason:before.value===null||after.value===null?'同一申报日数值冲突，保留未知，不猜测修订幅度':'同字段、单位和报告区间的后续披露数值变化，不推断重述原因'});
      }
    }
  }
  const windows=[...new Set(anchor.map(row=>row.start+'|'+row.end))].sort().slice(-8);
  const select=(tags:string[],unit:string,start:string,end:string,instant=false,nonnegative=true):Field=>{
    for(const tag of tags){const candidates=read(tag,unit,instant).filter(row=>row.end===end&&(instant||row.start===start));if(!candidates.length)continue;
      const filed=candidates.map(row=>row.filed!).sort().at(-1)!;
      const latest=candidates.filter(row=>row.filed===filed),values=new Set(latest.map(row=>row.val));
      const evidence=latest.map(row=>({tag,unit,start:row.start||null,end:row.end,filed:row.filed!,accession:row.accn||null}));
      if(values.size!==1)return {value:null,unit,reason:'同一字段/报告期/申报日存在冲突，未取平均',evidence};
      const value=latest[0].val;if(nonnegative&&value<0)return {value:null,unit,reason:'字段出现不支持的负数，保留证据',evidence};
      return {value,unit,reason:null,evidence};
    }
    return {value:null,unit,reason:'该报告期缺少相同单位/口径的已发布披露',evidence:[]};
  };
  const points=windows.map(window=>{const [periodStart,periodEnd]=window.split('|'),current=select(['LongTermDebtCurrent'],'USD',periodStart,periodEnd,true),noncurrent=select(['LongTermDebtNoncurrent'],'USD',periodStart,periodEnd,true);
    const debtKnown=current.value!==null&&noncurrent.value!==null&&current.evidence[0]?.filed===noncurrent.evidence[0]?.filed;
    const debtUsd:Field={value:debtKnown?current.value!+noncurrent.value!:null,unit:'USD',evidence:[...current.evidence,...noncurrent.evidence],reason:debtKnown?null:'当期/非当期长期债务缺失或申报口径不一致；不是全部债务'};
    return {periodStart,periodEnd,operatingCashFlowUsd:select(['NetCashProvidedByUsedInOperatingActivities'],'USD',periodStart,periodEnd,false,false),repurchasesUsd:select(['PaymentsForRepurchaseOfCommonStock'],'USD',periodStart,periodEnd),dividendsUsd:select(['PaymentsOfDividendsCommonStock'],'USD',periodStart,periodEnd),cashUsd:select(['CashAndCashEquivalentsAtCarryingValue'],'USD',periodStart,periodEnd,true),debtUsd,shares:select(['CommonStockSharesOutstanding'],'shares',periodStart,periodEnd,true),shareChangePct:null as number|null};
  });
  for(let i=1;i<points.length;i++){const prior=points[i-1],row=points[i],gap=(Date.parse(row.periodEnd)-Date.parse(prior.periodEnd))/86400000;if(gap>=300&&gap<=400&&prior.shares.value!==null&&prior.shares.value>0&&row.shares.value!==null)row.shareChangePct=(row.shares.value/prior.shares.value-1)*100;}
  const complete=points.every(row=>[row.operatingCashFlowUsd,row.repurchasesUsd,row.dividendsUsd,row.cashUsd,row.debtUsd,row.shares].every(field=>field.value!==null));
  return {points,revisions:revisions.sort((a,b)=>a.after.filed.localeCompare(b.after.filed)).slice(-200),asOf,source:'SEC EDGAR XBRL companyfacts · us-gaap',dataStatus:points.length?(complete?'historical':'partial'):'empty',reason:'仅精确年报区间及USD/股数单位；股数变化不等于实际融资稀释，长期债务不等于全部债务。申报日期没有时分秒时，时点查询保守等待次日06:00 UTC（纽约整日结束之后）；保留后续修订证据，最多列出最近200项字段变化。'};
}

export function compareCapitalHistory(input:Array<{symbol:string;capitalHistory?:CapitalHistory;dataStatus?:string}>) {
  if(input.length<2||input.length>4||new Set(input.map(row=>row.symbol)).size!==input.length||input.some(row=>!/^[A-Z][A-Z0-9.-]{0,9}$/.test(row.symbol)))throw Error('请选择2–4个不同的明确美股标的');
  const keys=input.map(row=>new Set((row.capitalHistory?.points||[]).map(point=>point.periodStart+'|'+point.periodEnd)));
  const shared=[...keys[0]].filter(key=>keys.every(set=>set.has(key))).sort(),key=shared.at(-1);
  const rows=key?input.map(row=>({symbol:row.symbol,...row.capitalHistory!.points.find(point=>point.periodStart+'|'+point.periodEnd===key)!})):[];
  const missing=rows.some(row=>[row.operatingCashFlowUsd,row.repurchasesUsd,row.dividendsUsd,row.cashUsd,row.debtUsd,row.shares].some(field=>field.value===null));
  const failed=input.filter(row=>row.dataStatus==='failed').length;
  return {market:'stocks',dataStatus:failed===input.length?'failed':failed?'partial':rows.length?(missing?'partial':'historical'):'unavailable',rows,reason:failed?'部分或全部来源请求失败，保留各标的失败状态；不以缺少共同区间掩盖来源故障':rows.length?'相同起止日期与字段单位；逐项显示缺失，不作优劣排名':'没有精确一致的报告区间，不按财年名称或最近日期猜配对'};
}
