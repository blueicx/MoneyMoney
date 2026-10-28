import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SQLiteStateStore } from '../storage/sqlite-state';

/**
 * Local-only scheduled reports. A schedule pins a project and the explicit
 * 2–6 references required by the existing report builder, generates HTML and
 * JSON into the local reports directory and never sends a notification.
 */

type Store = Pick<SQLiteStateStore, 'get' | 'set' | 'transaction' | 'appendAudit' | 'health'>;

export type ReportCadence = 'daily' | 'weekly';

export interface ReportSchedule {
  id: string;
  projectId: string;
  linkIds: string[];
  cadence: ReportCadence;
  timeOfDay: string;
  timezone: 'Asia/Shanghai';
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastRunWindow: string | null;
  lastGeneratedAt: string | null;
  lastFailureWindow: string | null;
  failureCount: number;
  deleted: boolean;
  contentHash: string;
}

export interface ReportGeneration {
  html: string;
  json: string;
}

const INDEX_KEY = 'report-schedule:index:v1';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const projectPattern = /^project_[a-f0-9-]{36}$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function assertHealth(state: Store): void {
  if (!state.health.ok) throw new Error('报告计划存储不可用');
}

function shanghaiClock(now: number): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date(now));
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: weekdayMap[get('weekday')] ?? 0, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function windowKey(schedule: ReportSchedule, now: number): string {
  const clock = shanghaiClock(now);
  const weeklyStart = new Date(Date.parse(`${clock.date}T00:00:00+08:00`) - ((clock.weekday + 6) % 7) * 86_400_000);
  const week = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(weeklyStart);
  return schedule.cadence === 'weekly' ? `${week}:weekly` : `${clock.date}:daily`;
}

function isDue(schedule: ReportSchedule, now: number): boolean {
  if (!schedule.enabled || schedule.deleted) return false;
  const clock = shanghaiClock(now);
  const [hour, minute] = schedule.timeOfDay.split(':').map(Number);
  if (clock.minutes < hour * 60 + minute) return false;
  if (schedule.cadence === 'weekly' && clock.weekday !== 1) return false;
  return schedule.lastRunWindow !== windowKey(schedule, now);
}

export class ReportScheduleStore {
  constructor(private state: Store, private root: string, private generate: (projectId: string, linkIds: string[]) => ReportGeneration, private now = Date.now) {}

  private index(): string[] {
    assertHealth(this.state);
    const value = this.state.get<string[]>(INDEX_KEY) || [];
    if (!Array.isArray(value) || value.some(id => !/^report_schedule_[a-f0-9-]{36}$/.test(id))) throw new Error('报告计划目录不可核验');
    return [...value];
  }

  private read(id: string): ReportSchedule {
    if (!/^report_schedule_[a-f0-9-]{36}$/.test(id)) throw new Error('报告计划身份无效');
    const row = this.state.get<ReportSchedule>('report-schedule:record:' + id);
    if (!row || row.id !== id) throw new Error('报告计划不存在或损坏');
    const { contentHash, ...payload } = row;
    if (contentHash !== digest(payload)) throw new Error('报告计划内容Hash不一致');
    return structuredClone(row);
  }

  private write(record: ReportSchedule): ReportSchedule {
    this.state.set('report-schedule:record:' + record.id, record, 1);
    return structuredClone(record);
  }

  private validateProject(projectId: string): void {
    if (typeof projectId !== 'string' || !projectPattern.test(projectId)) throw new Error('报告计划项目身份无效');
  }

  private validateLinks(linkIds: unknown): string[] {
    if (!Array.isArray(linkIds) || linkIds.length < 2 || linkIds.length > 6 || linkIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 240) || new Set(linkIds).size !== linkIds.length) throw new Error('报告计划必须明确选择 2–6 项互不重复的引用');
    return linkIds.map(id => String(id).trim());
  }

  list() {
    return this.index().map(id => this.read(id)).filter(row => !row.deleted).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  get(id: string) {
    return this.read(id);
  }

  create(input: { projectId: string; linkIds: string[]; cadence: ReportCadence; timeOfDay: string; requestId: string }) {
    this.validateProject(input?.projectId);
    const linkIds = this.validateLinks(input.linkIds);
    if (!['daily', 'weekly'].includes(String(input.cadence))) throw new Error('报告频率无效');
    if (typeof input.timeOfDay !== 'string' || !timePattern.test(input.timeOfDay)) throw new Error('报告时间必须是 HH:MM');
    if (typeof input.requestId !== 'string' || !/^[\w-]{16,128}$/.test(input.requestId)) throw new Error('报告计划请求ID无效');
    const requestHash = digest({ projectId: input.projectId, linkIds, cadence: input.cadence, timeOfDay: input.timeOfDay });
    return this.state.transaction(() => {
      const requests = this.state.get<Record<string, { requestHash: string; id: string }>>('report-schedule:requests:v1') || {};
      const prior = requests[input.requestId];
      if (prior) {
        if (prior.requestHash !== requestHash) throw Error('请求ID已绑定其他报告计划');
        return this.read(prior.id);
      }
      const ids = this.index();
      if (ids.length >= 200) throw Error('报告计划已达上限，未删除旧记录');
      const at = new Date(this.now()).toISOString();
      const payload = {
        id: 'report_schedule_' + randomUUID(),
        projectId: input.projectId,
        linkIds,
        cadence: input.cadence,
        timeOfDay: input.timeOfDay,
        timezone: 'Asia/Shanghai' as const,
        enabled: true,
        version: 1,
        createdAt: at,
        updatedAt: at,
        lastRunWindow: null,
        lastGeneratedAt: null,
        lastFailureWindow: null,
        failureCount: 0,
        deleted: false,
      };
      const record: ReportSchedule = { ...payload, contentHash: digest(payload) };
      this.write(record);
      this.state.set(INDEX_KEY, [...ids, record.id], 1);
      this.state.set('report-schedule:requests:v1', { ...requests, [input.requestId]: { requestHash, id: record.id } }, 1);
      this.state.appendAudit({ id: randomUUID(), at, action: 'report-schedule-created', detail: JSON.stringify({ id: record.id, projectId: record.projectId, timezone: record.timezone }) });
      return record;
    });
  }

  update(id: string, expectedVersion: number, patch: { enabled?: boolean; linkIds?: string[]; cadence?: ReportCadence; timeOfDay?: string }) {
    return this.state.transaction(() => {
      const current = this.read(id);
      if (current.deleted) throw Error('报告计划已删除');
      if (current.version !== expectedVersion) throw Error('报告计划版本已变化，请刷新重试');
      const next = { ...current };
      if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== 'boolean') throw Error('启用状态无效');
        next.enabled = patch.enabled;
      }
      if (patch.linkIds !== undefined) next.linkIds = this.validateLinks(patch.linkIds);
      if (patch.cadence !== undefined) {
        if (!['daily', 'weekly'].includes(String(patch.cadence))) throw Error('报告频率无效');
        next.cadence = patch.cadence;
      }
      if (patch.timeOfDay !== undefined) {
        if (!timePattern.test(String(patch.timeOfDay))) throw Error('报告时间必须是 HH:MM');
        next.timeOfDay = patch.timeOfDay;
      }
      next.version = current.version + 1;
      next.updatedAt = new Date(this.now()).toISOString();
      const { contentHash: _ignored, ...payload } = next;
      void _ignored;
      const record: ReportSchedule = { ...next, contentHash: digest(payload) };
      this.write(record);
      this.state.appendAudit({ id: randomUUID(), at: record.updatedAt, action: 'report-schedule-updated', detail: JSON.stringify({ id, version: record.version }) });
      return record;
    });
  }

  remove(id: string, expectedVersion: number) {
    return this.state.transaction(() => {
      const current = this.read(id);
      if (current.version !== expectedVersion) throw Error('报告计划版本已变化，请刷新重试');
      const next = { ...current, deleted: true, enabled: false, version: current.version + 1, updatedAt: new Date(this.now()).toISOString() };
      const { contentHash: _ignored, ...payload } = next;
      void _ignored;
      const record: ReportSchedule = { ...next, contentHash: digest(payload) };
      this.write(record);
      this.state.appendAudit({ id: randomUUID(), at: record.updatedAt, action: 'report-schedule-deleted', detail: JSON.stringify({ id }) });
      return record;
    });
  }

  preview(id: string, now = this.now()) {
    const record = this.read(id);
    return { id, due: isDue(record, now), window: windowKey(record, now), timezone: record.timezone, wouldWrite: isDue(record, now) };
  }

  runDue(now = this.now()): { generated: string[]; skipped: string[]; failed: Array<{ id: string; reason: string }> } {
    const generated: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const pointer of this.list()) {
      if (!isDue(pointer, now)) continue;
      const window = windowKey(pointer, now);
      if (pointer.lastFailureWindow === window && pointer.failureCount >= 3) {
        skipped.push(pointer.id);
        continue;
      }
      const folder = path.resolve(this.root, pointer.id);
      const target = path.resolve(folder, `${window.replace(/[^0-9A-Za-z-]/g, '_')}`);
      if (!target.startsWith(path.resolve(this.root) + path.sep)) {
        failed.push({ id: pointer.id, reason: '报告路径越界' });
        continue;
      }
      const manifestPath = target + '.manifest.json';
      if (fs.existsSync(manifestPath)) {
        this.state.transaction(() => {
          const current = this.read(pointer.id);
          const next = { ...current, lastRunWindow: window, lastGeneratedAt: new Date(now).toISOString(), failureCount: 0, lastFailureWindow: null };
          const { contentHash: _ignored, ...payload } = next;
          void _ignored;
          this.write({ ...next, contentHash: digest(payload) });
        });
        skipped.push(pointer.id);
        continue;
      }
      try {
        const output = this.generate(pointer.projectId, pointer.linkIds);
        if (typeof output.html !== 'string' || typeof output.json !== 'string' || !output.html || !output.json) throw Error('报告生成器返回空内容');
        fs.mkdirSync(folder, { recursive: true });
        const writeAtomic = (file: string, content: string) => {
          const temp = file + '.' + randomUUID() + '.tmp';
          fs.writeFileSync(temp, content, 'utf8');
          fs.renameSync(temp, file);
        };
        writeAtomic(target + '.html', output.html);
        writeAtomic(target + '.json', output.json);
        const manifest = {
          scheduleId: pointer.id,
          projectId: pointer.projectId,
          linkIds: pointer.linkIds,
          window,
          generatedAt: new Date(now).toISOString(),
          htmlHash: createHash('sha256').update(output.html).digest('hex'),
          jsonHash: createHash('sha256').update(output.json).digest('hex'),
        };
        writeAtomic(manifestPath, JSON.stringify(manifest, null, 2));
        this.state.transaction(() => {
          const current = this.read(pointer.id);
          const next = { ...current, lastRunWindow: window, lastGeneratedAt: manifest.generatedAt, failureCount: 0, lastFailureWindow: null };
          const { contentHash: _ignored, ...payload } = next;
          void _ignored;
          this.write({ ...next, contentHash: digest(payload) });
          this.state.appendAudit({ id: randomUUID(), at: manifest.generatedAt, action: 'report-schedule-generated', detail: JSON.stringify({ id: pointer.id, window, htmlHash: manifest.htmlHash, jsonHash: manifest.jsonHash }) });
        });
        generated.push(pointer.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : '报告生成失败';
        failed.push({ id: pointer.id, reason });
        this.state.transaction(() => {
          const current = this.read(pointer.id);
          const next = { ...current, failureCount: current.lastFailureWindow === window ? current.failureCount + 1 : 1, lastFailureWindow: window };
          const { contentHash: _ignored, ...payload } = next;
          void _ignored;
          this.write({ ...next, contentHash: digest(payload) });
          this.state.appendAudit({ id: randomUUID(), at: new Date(now).toISOString(), action: 'report-schedule-failed', detail: JSON.stringify({ id: pointer.id, window, reason }) });
        });
      }
    }
    return { generated, skipped, failed };
  }
}
