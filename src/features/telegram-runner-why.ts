import type { reviewAiRunnerDecisions } from './ai-runner-diagnostics';

type SavedReview=ReturnType<typeof reviewAiRunnerDecisions>;
interface RunnerSummary {title:string;mode:string;report:Pick<SavedReview,'rows'>;callsToday:number|null;sharedQuota?:boolean}
const text=(value:unknown,max=120)=>String(value??'未关联').slice(0,max).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/** Read-only, bounded Telegram text built from saved facts, not a new model decision. */
export function formatTelegramRunnerWhy(runners:RunnerSummary[]):string {
  let result='<b>为何未下单 · 已保存记录</b>';
  const append=(block:string)=>{if(result.length+block.length>3450)return false;result+=block;return true;};
  for(const runner of runners.slice(0,3)){
    const count=Number.isSafeInteger(runner.callsToday)&&Number(runner.callsToday)>=0?String(runner.callsToday):'未核验';
    if(!append('\n\n'+text(runner.title,60)+' · '+text(runner.mode,40)+'\n'+(runner.mode==='rules'?'规则模式不调用模型':runner.sharedQuota?'对照组共享额度：以网页原子额度账本为准；跑单保存调用 '+count+' 次':'本跑单UTC今日保存调用 '+count+'/24（含失败记录；不是新调用许可）')))break;
    const rows=runner.report.rows.slice(0,2);
    if(!rows.length){append('\n尚无决策记录');continue;}
    for(const row of rows){const block='\n'+text(row.at,35)+' · '+text(row.instrument,65)+' · '+text(row.action,20)+
      '\n来源 '+text(row.dataGate.source,70)+' · '+text(row.dataGate.dataStatus,20)+' · 数据时间 '+text(row.dataGate.dataAt,35)+
      '\n策略 '+text(row.strategyVersion,40)+' · 模型 '+text(row.modelVersion,50)+' / '+text(row.model.status,25)+
      '\n门控 '+text(row.blockedChecks.join('；')||'未记录失败条件，不代表应当下单',140)+'\n原因 '+text(row.reason,140)+
      '\n决策 '+text(row.decisionId,70)+' · 快照 '+text(row.snapshotHash,70);
      if(!append(block)){append('\n更多详情请查看网页保存的决策时间线。');break;}}
  }
  return result+'\n\n仅查看已有记录，不调用模型、不改配置、不创建订单；未列出记录不代表没有失败。';
}
