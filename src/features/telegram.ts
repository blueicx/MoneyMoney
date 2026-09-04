// ============================================
// TELEGRAM NOTIFICATIONS
// ============================================

import { curlCommand } from '../utils/platform-command';
import { getRuntimeTelegramConfig } from '../config/runtime-secrets';

const { execFile } = require('child_process');

let lastNotificationTime = 0;
const MIN_INTERVAL_MS = 30000; // Don't spam more than once per 30s

export class TelegramNotifier {

  get isConfigured(): boolean {
    const { botToken, chatId } = getRuntimeTelegramConfig();
    return !!(botToken && chatId);
  }

  async send(message: string): Promise<boolean> {
    const { botToken, chatId, proxyUrl } = getRuntimeTelegramConfig();
    if (!botToken || !chatId) return false;

    const now = Date.now();
    if (now - lastNotificationTime < MIN_INTERVAL_MS) return false;
    lastNotificationTime = now;

    const payload = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    });
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      // Some regions cannot reach Telegram directly. A local HTTP proxy can be
      // supplied without changing the dashboard code.
      if (!proxyUrl) return false;
      return await new Promise<boolean>((resolve) => {
        const command = curlCommand();
        const args = [
          '--silent', '--show-error', '--location', '--max-time', '25',
          '--request', 'POST', `https://api.telegram.org/bot${botToken}/sendMessage`,
          '--header', 'Content-Type: application/json',
          '--data', payload,
          '--proxy', proxyUrl,
        ];
        execFile(command, args, { windowsHide: true, timeout: 28_000 }, (error: Error | null, stdout: string | Buffer) => {
          if (error) { resolve(false); return; }
          try { resolve(Boolean(JSON.parse(stdout.toString())?.ok)); }
          catch { resolve(false); }
        });
      });
    }
  }

  async notifyOpportunity(title: string, action: string, confidence: number, reasons: string[]): Promise<void> {
    const icon = action.startsWith('BUY') ? '🟢' : '🔴';
    await this.send(
      `${icon} <b>Predict.fun 信号</b>\n\n` +
      `📊 市场：${title}\n` +
      `${icon} 操作建议：<b>${action}</b>\n` +
      `💪 置信度：${Math.round(confidence * 100)}%\n` +
      `📝 理由：${reasons.join(', ')}`
    );
  }

  async notifyTrade(action: string, detail: string): Promise<void> {
    const icon = action === 'BUY' ? '🛒' : '💰';
    await this.send(`${icon} <b>交易${action === 'BUY' ? '买入' : '卖出'}</b>\n\n${detail}`);
  }

  async notifyStopLoss(detail: string): Promise<void> {
    await this.send(`🛑 <b>已触发止损</b>\n\n${detail}`);
  }

  async notifyTakeProfit(detail: string): Promise<void> {
    await this.send(`🎯 <b>已触发止盈</b>\n\n${detail}`);
  }

  async notifyDailyReport(report: string): Promise<void> {
    await this.send(`📊 <b>每日报告</b>\n\n${report}`);
  }
}

export const telegram = new TelegramNotifier();
