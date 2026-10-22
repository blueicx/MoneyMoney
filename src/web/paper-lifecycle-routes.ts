import express from 'express';
import { randomUUID } from 'node:crypto';
import { pendingOptionSettlements, type PaperCorporateActionEvidence } from '../features/paper-account-lifecycle';
import { calculateUnifiedPerformance, type UnifiedPaperLedgerStore } from '../features/unified-paper-trading';
import { filterUnifiedPaperLedger } from '../features/market-scope-view';
import type { SQLiteStateStore } from '../storage/sqlite-state';

export function createPaperLifecycleRouter(deps: {
  ledger: Pick<UnifiedPaperLedgerStore, 'getAccount' | 'reconcileCorporateActions'>;
  state: Pick<SQLiteStateStore, 'transaction' | 'appendAudit'>;
  actions(): PaperCorporateActionEvidence[];
}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if ((req as any).user?.role !== 'admin') { res.status(403).json({ success: false, reason: '模拟账户生命周期仅管理员可读写' }); return; }
    next();
  });
  function view(accountId: string, market: string) {
    const account = deps.ledger.getAccount(accountId);
    if (!account) return null;
    const events = market === 'options' ? [] : account.lifecycleEvents || [];
    const receivables = market === 'options' ? [] : account.corporateReceivables || [];
    const costAdjustments = market === 'options' ? [] : account.corporateCostAdjustments || [];
    const pendingOptions = market === 'stocks' ? [] : pendingOptionSettlements(account.positions);
    const partial = pendingOptions.length || events.some(event => event.status === 'pending-review') || receivables.some(row => row.status !== 'paid');
    return {
      success: true, market, instrument: null, dataStatus: partial ? 'partial' : events.length || receivables.length ? 'historical' : 'empty',
      source: 'unified paper ledger + verified corporate-action registry', updatedAt: new Date().toISOString(),
      reason: partial ? '存在待核验的公司行动、付款日或官方期权结算证据；未推测入账' : events.length || receivables.length ? null : '暂无已关联账户生命周期事件；不代表没有发生',
      data: { accountId, events, receivables, costAdjustments, pendingOptionSettlements: pendingOptions, performance: calculateUnifiedPerformance(market === 'all' ? account : filterUnifiedPaperLedger(account, market as 'stocks' | 'options')) },
    };
  }
  const valid = (id: string, market: string) => id.length > 0 && id.length <= 200 && ['all', 'stocks', 'options'].includes(market);
  router.get('/:id/lifecycle', (req, res) => {
    const id = String(req.params.id), market = String(req.query.market || 'all');
    if (!valid(id, market)) { res.status(400).json({ success: false, reason: '账户 ID 或生命周期市场无效' }); return; }
    const data = view(id, market);
    if (!data) { res.status(404).json({ success: false, market, instrument: null, dataStatus: 'empty', reason: '模拟账户不存在' }); return; }
    res.json(data);
  });
  router.post('/:id/reconcile', (req, res) => {
    const id = String(req.params.id), market = String(req.body?.market || 'all');
    if (!valid(id, market) || market === 'options') { res.status(400).json({ success: false, reason: '只可按来源对账股票公司行动；期权缺少官方结算证据时不结算' }); return; }
    if (!deps.ledger.getAccount(id)) { res.status(404).json({ success: false, market, dataStatus: 'empty', reason: '模拟账户不存在' }); return; }
    try {
      const result = deps.state.transaction(() => {
        const { applied, pending, alreadyApplied, updated, blockedReason } = deps.ledger.reconcileCorporateActions(id, deps.actions());
        const counts = { applied, pending, alreadyApplied, updated, ...(blockedReason ? { blockedReason } : {}) };
        deps.state.appendAudit({ id: randomUUID(), action: 'paper_account_lifecycle_reconcile', detail: JSON.stringify({ accountId: id, market, ...counts }) });
        return counts;
      });
      if (result.blockedReason) { res.status(409).json({ success: false, market, dataStatus: 'unavailable', reason: result.blockedReason }); return; }
      const response = view(id, market)!;
      if (result.pending) { response.dataStatus = 'partial'; response.reason = '部分事件证据不足或修订冲突，未猜测股数、汇率或现金'; }
      res.json({ ...response, data: { ...response.data, ...result, ...(market === 'all' ? { ledger: deps.ledger.getAccount(id) } : {}) } });
    } catch { res.status(400).json({ success: false, market, dataStatus: 'failed', reason: '对账或审计写入失败，本次账本变更已回滚' }); }
  });
  return router;
}
