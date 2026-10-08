/** An adjustment label describes stored/source prices, not permission to invent conversion. */
export function stockChartDisclosure(rows:{time:number}[],requested='source',declared?:string) {
  const actual=declared?.trim()||'unknown';
  const available=actual==='unknown'||actual==='mixed'?['source']:['source',actual];
  if(!available.includes(requested))throw new Error('当前来源没有可核验的 '+requested+' 复权数据；保持来源口径，不猜测转换');
  const times=rows.map(row=>row.time).filter(Number.isFinite);
  return {adjustment:{requested,actual,available,conversionEnabled:false,reason:actual==='unknown'?'来源未声明复权口径；前/后复权转换不可用':actual==='mixed'?'历史分区口径混合，禁止复权转换':'使用分区已声明口径；未进行额外转换'},coverage:{from:times.length?Math.min(...times):null,to:times.length?Math.max(...times):null,records:times.length}};
}
