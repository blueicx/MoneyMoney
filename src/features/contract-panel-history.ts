/** Derive only sampled observations; do not invent missing intervals or source time. */
export async function loadContractPanelHistory(detail:any,selected:string[],read:()=>Promise<any>) {
  let history;
  try { history=await read(); }
  catch(error) { history={instrument:detail.instrument,dataStatus:'unavailable',rows:[],reason:'历史归档不可用：'+(error instanceof Error?error.message:'读取失败')}; }
  return withContractPanelHistory(detail,history,selected);
}

export function withContractPanelHistory(detail:any,history:any,selected:string[]) {
  if(detail.instrument!==history.instrument)throw Error('合约历史标的身份不一致');
  const series={...detail.series};
  for(const [key,field] of [['openInterest','openInterestUsd'],['basis','basisPct']]){
    if(!selected.includes(key))continue;
    const observations=(history.rows||[]).flatMap((row:any)=>Number.isFinite(Date.parse(row.retrievedAt))&&Number.isFinite(row[field])?[{time:Date.parse(row.retrievedAt),value:row[field],evidenceRef:row.evidenceRef,contentHash:row.contentHash,source:String(row.source||history.source||'来源未记录')}]:[]).sort((a:any,b:any)=>a.time-b.time);
    const sources=[...new Set(observations.map((point:any)=>point.source))];
    const selectedSource=observations.at(-1)?.source;
    const points=selectedSource?observations.filter((point:any)=>point.source===selectedSource):[];
    const gaps=points.slice(1).map((point:any,index:number)=>point.time-points[index].time);
    const sourceSwitch=sources.length>1;
    const status=history.dataStatus==='unavailable'?'unavailable':history.dataStatus==='partial'||sourceSwitch?'partial':points.length>=2?'historical':points.length?'partial':'empty';
    series[key]={...series[key],kind:'observations',timeBasis:'retrievedAt',source:selectedSource,points,coverage:{from:points[0]?.time??null,to:points.at(-1)?.time??null,records:points.length,maxObservedGapMs:gaps.length?Math.max(...gaps):null,sources,excludedSources:sources.filter(source=>source!==selectedSource)},
      dataStatus:status,
      reason:(history.reason||'同来源归档快照')+'；'+points.length+' 个有效点；来源：'+(selectedSource||'未知')+(sourceSwitch?'；检测到来源切换，仅显示最新同源区间':'')+'；源时间未提供时仅按抓取时间对齐，缺口不插值'+(points.length<2?'；不足两个点，不能判定趋势':'')};
  }
  return {...detail,series};
}
