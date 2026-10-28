import { createHash } from 'node:crypto';
import { evidenceRefDigest, verifyEvidenceRef, type EvidenceRef } from './evidence-contract';
import { methodologyRef } from './methodology-catalog';

/**
 * Correlation matrix over saved series only. Timestamps must line up exactly;
 * nothing is interpolated. Pairs with too little overlap are returned as
 * unknown with an explicit reason.
 */

export interface CorrelationSeriesInput {
  instrument: string;
  evidence: EvidenceRef;
  points: Array<{ t: number; v: number }>;
}

export interface CorrelationMatrix {
  dataStatus: 'ready' | 'partial' | 'unavailable';
  labels: string[];
  values: Array<Array<number | null>>;
  overlap: Array<Array<number>>;
  minSamples: number;
  pairs: Array<{ left: string; right: string; value: number | null; overlap: number; reason: string | null }>;
  methodologyRef: string;
  evidenceHashes: Record<string, string>;
  contentHash: string;
}

function normalizeSeries(value: unknown): CorrelationSeriesInput & { returns: Array<{ t: number; v: number }> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('序列必须是对象');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['instrument', 'evidence', 'points'].includes(key))) throw new Error('序列包含未支持字段');
  if (typeof row.instrument !== 'string' || !row.instrument.trim() || row.instrument.length > 200) throw new Error('序列标的无效');
  if (!verifyEvidenceRef(row.evidence)) throw new Error(`序列 ${row.instrument} 的证据引用不可核验`);
  if (!Array.isArray(row.points) || row.points.length < 3 || row.points.length > 20000) throw new Error('序列点数必须在 3–20000 之间');
  const points: Array<{ t: number; v: number }> = row.points.map(point => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) throw new Error('序列点必须是对象');
    const item = point as Record<string, unknown>;
    if (Object.keys(item).some(key => !['t', 'v'].includes(key))) throw new Error('序列点包含未支持字段');
    if (typeof item.t !== 'number' || !Number.isSafeInteger(item.t) || item.t < 0 || typeof item.v !== 'number' || !Number.isFinite(item.v) || item.v <= 0) throw new Error('序列时间或数值无效');
    return { t: item.t, v: item.v };
  });
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].t <= points[index - 1].t) throw new Error('序列时间必须严格递增且不重复');
  }
  const returns = points.slice(1).map((point, index) => ({ t: point.t, v: point.v / points[index].v - 1 }));
  return { instrument: row.instrument.trim(), evidence: row.evidence as EvidenceRef, points, returns };
}

function pearson(left: readonly number[], right: readonly number[]): number | null {
  const n = left.length;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / n;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let leftVar = 0;
  let rightVar = 0;
  for (let index = 0; index < n; index += 1) {
    const dl = left[index] - leftMean;
    const dr = right[index] - rightMean;
    numerator += dl * dr;
    leftVar += dl * dl;
    rightVar += dr * dr;
  }
  if (!leftVar || !rightVar) return null;
  return numerator / Math.sqrt(leftVar * rightVar);
}

export function buildCorrelationMatrix(input: { series: readonly unknown[]; minSamples?: number }): CorrelationMatrix {
  if (!input || typeof input !== 'object' || !Array.isArray(input.series)) throw new Error('相关性请求必须包含序列数组');
  if (input.series.length < 2 || input.series.length > 12) throw new Error('相关性矩阵需要 2–12 段序列');
  const minSamples = input.minSamples === undefined ? 20 : input.minSamples;
  if (!Number.isSafeInteger(minSamples) || minSamples < 3 || minSamples > 5000) throw new Error('最小样本必须是 3–5000 的整数');
  const normalized = input.series.map(normalizeSeries);
  const labels = normalized.map(row => row.instrument);
  if (new Set(labels).size !== labels.length) throw new Error('序列标的必须唯一');
  const n = normalized.length;
  const values: Array<Array<number | null>> = Array.from({ length: n }, () => Array<number | null>(n).fill(null));
  const overlap: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const pairs: CorrelationMatrix['pairs'] = [];
  for (let left = 0; left < n; left += 1) {
    values[left][left] = 1;
    overlap[left][left] = normalized[left].returns.length;
    for (let right = left + 1; right < n; right += 1) {
      const rightMap = new Map(normalized[right].returns.map(point => [point.t, point.v]));
      const alignedLeft: number[] = [];
      const alignedRight: number[] = [];
      normalized[left].returns.forEach(point => {
        const other = rightMap.get(point.t);
        if (other !== undefined) {
          alignedLeft.push(point.v);
          alignedRight.push(other);
        }
      });
      overlap[left][right] = alignedLeft.length;
      overlap[right][left] = alignedLeft.length;
      if (alignedLeft.length < minSamples) {
        pairs.push({ left: labels[left], right: labels[right], value: null, overlap: alignedLeft.length, reason: `重叠样本 ${alignedLeft.length} 低于门槛 ${minSamples}` });
        continue;
      }
      const value = pearson(alignedLeft, alignedRight);
      if (value === null) {
        pairs.push({ left: labels[left], right: labels[right], value: null, overlap: alignedLeft.length, reason: '至少一段序列方差为零' });
        continue;
      }
      const rounded = Number(value.toFixed(4));
      values[left][right] = rounded;
      values[right][left] = rounded;
      pairs.push({ left: labels[left], right: labels[right], value: rounded, overlap: alignedLeft.length, reason: null });
    }
  }
  const evidenceHashes = Object.fromEntries(normalized.map(row => [row.instrument, evidenceRefDigest(row.evidence)]));
  const ready = pairs.every(pair => pair.value !== null);
  const dataStatus: CorrelationMatrix['dataStatus'] = ready ? 'ready' : pairs.some(pair => pair.value !== null) ? 'partial' : 'unavailable';
  const payload = {
    dataStatus,
    labels,
    values,
    overlap,
    minSamples,
    pairs,
    methodologyRef: methodologyRef('correlation-matrix'),
    evidenceHashes,
  };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export function renderCorrelationCsv(matrix: CorrelationMatrix): string {
  const header = ['left', 'right', 'correlation', 'overlap', 'reason'];
  const escape = (value: string | number | null | undefined) => {
    const text = value == null ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header.join(','), ...matrix.pairs.map(pair => [pair.left, pair.right, pair.value, pair.overlap, pair.reason].map(escape).join(','))].join('\n');
}
