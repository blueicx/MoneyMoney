import type { compareAiRunnerReports } from './ai-runner-comparison';

/** Formats an already-derived private report; no model, quote or order access. */
export function formatTelegramComparisonSummary(report: ReturnType<typeof compareAiRunnerReports>): string {
  const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
  const number=(value:number|null)=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(2):'不可用';
  return ['<b>已保存的模拟对照结果</b>',escape(report.market)+' · 共同快照 '+report.pairedSnapshotCount,
    report.fairComparison?'实验条件一致；仍需核对成熟样本，不提供自动排名':'实验条件未完整匹配，不作优劣排名',
    ...report.rows.map(row=>`${escape(row.title)} · ${escape(row.mode)}\n${row.equity===null?'估值不可用':'保存估值 '+number(row.equity)+' USD'} · 来源状态 ${escape(row.valuationStatus)} · 时间 ${escape(row.valuationAt||'未知')}\n已实现 ${number(row.realizedPnl)} · 成本 ${number(row.recordedCosts)} USD · 平仓 ${row.closedCount}${row.mode==='ai-review'?'\nAI研究只读，不参与收益排名':''}`),
    ...report.warnings.slice(0,8).map(reason=>'⚠ '+escape(reason)),
    '仅查看已有记录，不执行新轮次、不调用模型、不创建订单；保存估值不是当前可成交净值。',escape(report.reason)].join('\n\n');
}
