import fs from 'fs';
import path from 'path';
import { DATA_ROOT, ensureDir } from '../utils/paths';
import { pushNotification } from './notifications';
import { settingsManager } from './news-settings';
import { notificationChannelsConfigured, sendNotificationChannels } from './notification-channels';
import type { AssistantReport } from './trade-assistant';

const STATE_FILE = path.join(DATA_ROOT, 'high-success-notifier.json');
const WIN_RATE_THRESHOLD = Number(process.env.HIGH_SUCCESS_WIN_RATE || 65);
const MAX_SIGNALS_PER_DIGEST = 3;

let sentSignatures = new Set<string>();

try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Array.isArray(saved?.sentSignatures)) {
      sentSignatures = new Set(saved.sentSignatures);
    }
  }
} catch {
  sentSignatures = new Set();
}

function saveState(): void {
  ensureDir(DATA_ROOT);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    sentSignatures: [...sentSignatures].slice(-200),
  }, null, 2));
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Notify only signals whose confidence is high *and* whose simulated history
 * supports it. Requiring both prevents a fresh high-confidence guess from
 * being marketed as a proven high-success result.
 */
export async function notifyHighSuccessResults(report: AssistantReport): Promise<void> {
  const configured = notificationChannelsConfigured();
  if (!settingsManager.get().telegramEnabled
    || (!configured.telegram && !configured.wecom && !configured.bark)) return;

  const confidenceThreshold = Math.round(settingsManager.get().confidenceThreshold * 100);
  const candidates = [
    ...report.reminders,
    ...report.predictionPicks,
    ...report.cryptoActions,
    ...report.stockActions,
    ...report.macroActions,
    ...report.sectorActions,
    ...report.optionActions,
  ]
    .filter(item => item.action !== 'WAIT')
    .filter(item => (item.historicalWinRatePct ?? 0) >= WIN_RATE_THRESHOLD)
    .filter(item => item.confidencePct >= confidenceThreshold)
    .sort((a, b) => (b.historicalWinRatePct ?? 0) - (a.historicalWinRatePct ?? 0)
      || b.confidencePct - a.confidencePct);

  const fresh = candidates.filter(item => {
    const signature = `${item.id}:${item.action}:${item.confidencePct}:${item.historicalWinRatePct}`;
    return !sentSignatures.has(signature);
  }).slice(0, MAX_SIGNALS_PER_DIGEST);

  if (!fresh.length) return;

  const lines = fresh.map(item => {
    const direction = item.direction || (item.action === 'BUY' ? 'LONG' : 'SHORT');
    return [
      `📌 <b>${escapeHtml(item.title)}</b>`,
      `🏷️ ${escapeHtml(item.venue)} · ${escapeHtml(item.symbol)} · ${escapeHtml(direction)}`,
      `🧭 建议：${escapeHtml(item.actionZh)} · 信心 <b>${item.confidencePct}%</b> · 保守胜率 <b>${item.historicalWinRatePct}%</b>`,
      item.reasons.length ? `📝 ${escapeHtml(item.reasons[item.reasons.length - 1])}` : '',
    ].filter(Boolean).join('\n');
  });

  const telegramMessage = `🏆 <b>MoneyMoney 高成功率信号</b>\n\n${lines.join('\n\n')}\n\n⚠️ 历史胜率来自模拟账本，不构成投资建议。`;
  const wecomMessage = [
    '### 🏆 MoneyMoney 高成功率信号',
    ...fresh.map(item => {
      const direction = item.direction || (item.action === 'BUY' ? 'LONG' : 'SHORT');
      const reason = item.reasons.length ? `\n> ${item.reasons[item.reasons.length - 1]}` : '';
      return `**${item.title}**\n${item.venue} · ${item.symbol} · ${direction}\n${item.actionZh} · 信心 **${item.confidencePct}%** · 保守胜率 **${item.historicalWinRatePct}%**${reason}`;
    }),
    '\n⚠️ 历史胜率来自模拟账本，不构成投资建议。',
  ].join('\n\n');
  const result = await sendNotificationChannels({
    telegramHtml: telegramMessage,
    wecomMarkdown: wecomMessage,
    barkTitle: 'MoneyMoney 高胜率信号',
  });
  const sent = result.any;
  if (!sent) return;

  for (const item of fresh) {
    const signature = `${item.id}:${item.action}:${item.confidencePct}:${item.historicalWinRatePct}`;
    sentSignatures.add(signature);
    pushNotification(
      'high-success',
      `${item.venue} ${item.symbol}：${item.actionZh}，信心 ${item.confidencePct}%，保守胜率 ${item.historicalWinRatePct}%`,
    );
  }
  saveState();
}
