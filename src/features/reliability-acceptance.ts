/** Build-time fixture evidence is separate from live-state restore drills. */
export function validateReliabilityReport(report:any,expectedCommit:string,now=new Date().toISOString()){
  const base={dataStatus:'unavailable',status:'unavailable',reason:'本构建未提供可核验的隔离演练报告；不据此判断生产恢复能力',tests:0,platform:null as string|null,completedAt:null as string|null,isolated:true};
  if(!report||report.version!==1||report.cleanTree!==true||!/^[a-f0-9]{40}$/.test(report.commit||'')||report.commit!==expectedCommit||report.isolated!==true||report.network!=='loopback-only'||report.modelCalls!==0||report.productionOrders!==0)return base;
  const at=Date.parse(report.completedAt),cut=Date.parse(now);if(!Number.isFinite(at)||!Number.isFinite(cut)||at>cut+300000)return base;
  if(!Array.isArray(report.cases)||!report.cases.length||report.cases.length>12)return base;
  const valid=report.status==='passed'&&report.cases.every((row:any)=>row.exitCode===0&&Number.isSafeInteger(row.passed)&&row.passed>0&&row.failed===0&&row.skipped===0);
  const dataStatus=!valid?'failed':cut-at>30*86400000?'stale':'historical';
  return {...base,dataStatus,status:valid?'passed':'failed',tests:report.cases.reduce((sum:number,row:any)=>sum+(Number.isSafeInteger(row.passed)?row.passed:0),0),platform:typeof report.platform==='string'?report.platform.slice(0,30):null,completedAt:report.completedAt,
    reason:'构建阶段隔离夹具演练，非生产故障注入；平台 '+String(report.platform||'未知')+'。覆盖过期报价、模型失败、多worker重复提交、重启状态与磁盘不足/备份恢复；不等于生产已完成这些故障演练。'+(dataStatus==='stale'?'报告超过30天，需要重新验证。':'')};
}
