// ============================================
// SCHEDULED DAILY REPORT
// ============================================

import { telegram } from './telegram';
import { paperEngine } from './paper-trading';
import { priceTracker } from './price-tracker';
import { newsFeed, settingsManager } from './news-settings';

export class ReportScheduler {
  private interval: NodeJS.Timeout | null = null;
  private lastReportDate: string = '';

  start(): void {
    if (this.interval) return;
    // Check every 30 minutes if it's time for daily report (at 08:00)
    this.interval = setInterval(() => this.checkAndSend(), 30 * 60 * 1000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private checkAndSend(): void {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const hour = now.getHours();

    // Send at 08:00 local time once per day
    if (hour === 8 && this.lastReportDate !== today) {
      this.lastReportDate = today;
      this.sendDailyReport();
    }
  }

  async sendDailyReport(): Promise<string> {
    const portfolio = paperEngine.getPortfolio();
    const settings = settingsManager.get();
    const correlations = priceTracker.allCorrelations();
    const news = await newsFeed.getNews();

    let report = `📊 <b>Predict.fun 每日报告</b>\n`;
    report += `${new Date().toLocaleDateString()}\n\n`;
    report += `<b>模拟盘资产：</b>\n`;
    report += `💰 净值：$${portfolio.equity.toFixed(2)}\n`;
    report += `📈 总盈亏：${portfolio.totalPnl >= 0 ? '+' : ''}$${portfolio.totalPnl.toFixed(2)}\n`;
    report += `🎯 胜率：${(portfolio.winRate * 100).toFixed(0)}%\n`;
    report += `📉 最大回撤：${portfolio.maxDrawdownPct.toFixed(1)}%\n\n`;

    const openPositions = paperEngine.getOpenPositions();
    report += `📋 当前持仓数：${openPositions.length}\n`;
    if (openPositions.length > 0) {
      openPositions.slice(0, 5).forEach(p => {
        report += `   • ${p.outcomeName} on "${p.marketTitle.substring(0, 30)}" @ ${p.entryPrice}\n`;
      });
    }

    if (correlations.length > 0) {
      report += `\n🔗 最强相关性：\n`;
      report += `   ${correlations[0].titleA.substring(0, 20)} ↔ ${correlations[0].titleB.substring(0, 20)}: ${correlations[0].corr}\n`;
    }

    if (news.length > 0) {
      report += `\n📰 重点新闻：\n`;
      news.slice(0, 3).forEach(n => {
        const icon = (n.sentimentScore || 0) > 0 ? '🟢' : (n.sentimentScore || 0) < 0 ? '🔴' : '⚪';
        report += `   ${icon} ${n.title.substring(0, 50)}...\n`;
      });
    }

    await telegram.notifyDailyReport(report);
    return report;
  }
}

export const reportScheduler = new ReportScheduler();
