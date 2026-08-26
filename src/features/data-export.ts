import fs from 'fs';
import path from 'path';
import { DATA_ROOT } from '../utils/paths';
import { getAssistantCalibration } from './assistant-journal';

type CsvValue = string | number | null | undefined;

function csvCell(value: CsvValue): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: CsvValue[][]): string {
  return '\uFEFF' + [headers, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n');
}

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_ROOT, name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function exportJournalCsv(): string {
  const file = readJson<{ trades?: any[] }>('assistant-journal.json', {});
  const rows = (file.trades || []).map(item => [
    item.openedAt,
    item.venue,
    item.symbol,
    item.title,
    item.direction,
    item.actionZh,
    item.confidencePct ?? '',
    item.probabilityPct ?? '',
    item.entryPrice ?? '',
    item.stopLoss ?? '',
    item.takeProfit ?? '',
    item.regimeLabel,
    item.status,
    item.result,
    item.pnlPct ?? '',
    item.rMultiple ?? '',
    item.closedAt ?? '',
    item.closeReason,
  ]);
  return toCsv([
    '开仓时间', '平台', '标的', '标题', '方向', '建议', '信心%', '概率%',
    '入场价', '止损', '止盈', '环境', '状态', '结果', '收益%', 'R值', '结算时间', '结算说明',
  ], rows);
}

export function exportPaperCsv(): string {
  const file = readJson<{ positions?: any[]; tradeLog?: any[] }>('paper-portfolio.json', { positions: [], tradeLog: [] });
  const rows = (file.positions || []).map(item => [
    item.entryTime,
    item.marketTitle,
    item.outcomeName,
    item.side,
    item.entryPrice,
    item.quantity,
    item.exitPrice ?? '',
    item.status,
    item.pnlUsd ?? '',
    item.pnlPct ?? '',
  ]);
  return toCsv([
    '开仓时间', '市场', '方向', '操作', '买入价', '数量',
    '卖出价', '状态', '盈亏$', '收益%', '交易日志数',
  ].slice(0, 10), rows);
}

export function exportCalibrationCsv(): string {
  const data = getAssistantCalibration();
  const rows = data.buckets.map(item => [
    data.updatedAt,
    item.label,
    item.count,
    item.avgForecastPct,
    item.hitRatePct,
    item.brierScore,
    data.brierScore,
    data.logLoss,
  ]);
  return toCsv([
    '更新时间', '预测区间', '数量', '平均预测%', '实际命中%', '区间Brier', '整体Brier', 'LogLoss',
  ], rows);
}
