/**
 * Background Position Risk Patrol
 *
 * The advisor already computes an exit coach when the dashboard is open. This
 * scheduler keeps watching paper positions while the user is away and turns a
 * state change into one in-app/Telegram warning, instead of repeating it every
 * tick. It never places a live order.
 */

import {
  AssistantRiskPatrolResult,
  refreshAssistantRiskPatrol,
} from './assistant-journal';

export interface RiskPatrolStatus extends AssistantRiskPatrolResult {
  running: boolean;
  startedAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
}

class RiskPatrolScheduler {
  private interval: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private running = false;
  private nextRunAt: Date | null = null;
  private result: AssistantRiskPatrolResult = {
    updatedAt: '',
    openPositions: 0,
    dangerCount: 0,
    profitCount: 0,
    watchCount: 0,
    alerts: [],
  };
  private lastError: string | null = null;

  start(): void {
    if (this.interval || this.startupTimer) return;

    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.runOnce({ push: true });
      this.interval = setInterval(() => void this.runOnce({ push: true }), 90_000);
    }, 6_000);
  }

  stop(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.nextRunAt = null;
  }

  async runOnce(options: { push?: boolean } = {}): Promise<RiskPatrolStatus> {
    if (this.running) return this.status();

    this.running = true;
    try {
      this.result = await refreshAssistantRiskPatrol(options);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.running = false;
      this.nextRunAt = new Date(Date.now() + 90_000);
    }
    return this.status();
  }

  status(): RiskPatrolStatus {
    return {
      ...this.result,
      running: this.running,
      startedAt: this.result.updatedAt || null,
      nextRunAt: this.nextRunAt?.toISOString() || null,
      lastError: this.lastError,
    };
  }
}

export const riskPatrol = new RiskPatrolScheduler();
