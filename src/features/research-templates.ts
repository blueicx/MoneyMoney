import { createHash } from 'node:crypto';
import { EVIDENCE_MARKETS, type EvidenceMarket } from './evidence-contract';

/**
 * Versioned research templates. A template is a checklist of evidence that a
 * project should collect before it can claim a conclusion; it does not run
 * any calculation itself and cannot mark items complete on the user's behalf.
 */

export interface TemplateChecklistItem {
  id: string;
  label: string;
  required: boolean;
  evidenceKind: string | null;
}

export interface ResearchTemplate {
  id: string;
  version: number;
  market: EvidenceMarket;
  name: string;
  purpose: string;
  checklist: TemplateChecklistItem[];
}

const TEMPLATES: readonly ResearchTemplate[] = [
  {
    id: 'options-valuation',
    version: 1,
    market: 'options',
    name: '期权估值检查清单',
    purpose: '在计算理论价值前确认合约身份、时点、波动率与流动性证据齐备。',
    checklist: [
      { id: 'contract-identity', label: '合约身份（标的、到期、行权价、看涨/看跌）', required: true, evidenceKind: 'options-chain-snapshot' },
      { id: 'snapshot-iv', label: '同一快照内的隐含波动率观测', required: true, evidenceKind: 'options-chain-snapshot' },
      { id: 'fees-liquidity', label: '费用与流动性证据（价差、盘口深度或明确缺失）', required: true, evidenceKind: 'quote' },
      { id: 'expiry-currency', label: '到期日与币种一致', required: true, evidenceKind: 'contract-spec' },
      { id: 'conclusion-review', label: '结论引用固定快照版本并保留复查入口', required: false, evidenceKind: null },
    ],
  },
  {
    id: 'event-study',
    version: 1,
    market: 'stocks',
    name: '事件驱动研究检查清单',
    purpose: '固定事件定义与当时可获得证据，区分计划、公布、修订与最终结果。',
    checklist: [
      { id: 'event-definition', label: '事件定义、类型与公告时间', required: true, evidenceKind: 'event-evidence' },
      { id: 'pre-event-evidence', label: '事件前可获得的价格与基本面证据', required: true, evidenceKind: 'bars' },
      { id: 'benchmark-window', label: '基准与观察窗口', required: true, evidenceKind: 'bars' },
      { id: 'post-event-outcome', label: '事件后表现与同队列比较', required: true, evidenceKind: 'bars' },
      { id: 'similar-events', label: '相似事件队列（可标记缺失）', required: false, evidenceKind: 'event-evidence' },
    ],
  },
  {
    id: 'factor-validation',
    version: 1,
    market: 'stocks',
    name: '因子检验检查清单',
    purpose: '确保点时成员、行业证据与前向收益在滚动样本外检验中不发生未来泄漏。',
    checklist: [
      { id: 'universe-as-of', label: '点时成员存档及内容 Hash', required: true, evidenceKind: 'historical-universe' },
      { id: 'industry-evidence', label: '行业分类证据（缺失须保持未知）', required: true, evidenceKind: 'historical-universe' },
      { id: 'factor-observations', label: '逐标的因子观测与证据引用', required: true, evidenceKind: 'factor-evidence' },
      { id: 'forward-returns', label: '不与因子窗口重叠的前向收益', required: true, evidenceKind: 'bars' },
      { id: 'rolling-oos', label: '固定训练/检验窗口的滚动样本外结果', required: true, evidenceKind: null },
      { id: 'survivorship-note', label: '幸存者偏差与覆盖说明', required: true, evidenceKind: null },
    ],
  },
  {
    id: 'portfolio-stress',
    version: 1,
    market: 'stocks',
    name: '组合压力测试检查清单',
    purpose: '组合压力仅在没有缺失估值跨币种混算的前提下展示完整结果。',
    checklist: [
      { id: 'portfolio-snapshots', label: '每个头寸的已保存估值快照', required: true, evidenceKind: 'portfolio-snapshot' },
      { id: 'scenario-definition', label: '明确的情景冲击与版本', required: true, evidenceKind: null },
      { id: 'currency-grouping', label: '按原币种分组，不默认 USD＝USDT', required: true, evidenceKind: null },
      { id: 'unpriced-positions', label: '无法估值头寸的单列与覆盖率', required: true, evidenceKind: null },
      { id: 'tail-risk', label: '历史尾部风险与盘口退出压力单独展示', required: false, evidenceKind: 'bars' },
    ],
  },
  {
    id: 'prediction-settlement',
    version: 1,
    market: 'prediction',
    name: '预测市场结算检查清单',
    purpose: '保存规则修订、截止、结果提议、争议与最终结算的时间线证据。',
    checklist: [
      { id: 'rules-version', label: '市场规则与版本', required: true, evidenceKind: 'settlement-evidence' },
      { id: 'deadline', label: '截止时间与延长记录', required: true, evidenceKind: 'settlement-evidence' },
      { id: 'resolution-source', label: '结果提议与来源', required: true, evidenceKind: 'settlement-evidence' },
      { id: 'dispute-timeline', label: '争议与最终结算', required: true, evidenceKind: 'settlement-evidence' },
    ],
  },
];

function clone(template: ResearchTemplate): ResearchTemplate {
  return { ...template, checklist: template.checklist.map(item => ({ ...item })) };
}

export function listResearchTemplates(market?: string): ResearchTemplate[] {
  if (market !== undefined && !EVIDENCE_MARKETS.includes(market as EvidenceMarket)) throw new Error('模板市场无效');
  return TEMPLATES.filter(template => !market || template.market === market).map(clone);
}

export function getResearchTemplate(ref: string): ResearchTemplate | null {
  if (typeof ref !== 'string' || !ref.trim() || ref.length > 120) return null;
  const [id, rawVersion] = ref.trim().split('@');
  const version = rawVersion === undefined ? null : Number(rawVersion);
  const template = TEMPLATES.find(row => row.id === id && (version === null || row.version === version));
  return template ? clone(template) : null;
}

export function researchTemplateRef(template: ResearchTemplate): string {
  return `${template.id}@${template.version}`;
}

export interface TemplateChecklistResult {
  templateRef: string;
  status: 'ready' | 'missing';
  completed: string[];
  missing: Array<{ id: string; label: string; required: boolean }>;
  unknownCompleted: string[];
  contentHash: string;
}

export function checkResearchTemplate(ref: string, completed: readonly unknown[]): TemplateChecklistResult {
  const template = getResearchTemplate(ref);
  if (!template) throw new Error('研究模板不存在或版本不受支持');
  if (!Array.isArray(completed) || completed.length > 100 || completed.some(item => typeof item !== 'string' || !item.trim())) throw new Error('已完成项必须是字符串数组');
  const known = new Set(template.checklist.map(item => item.id));
  const completedIds = [...new Set(completed.map(item => String(item).trim()))];
  const unknownCompleted = completedIds.filter(id => !known.has(id)).sort();
  const missing = template.checklist.filter(item => item.required && !completedIds.includes(item.id)).map(item => ({ id: item.id, label: item.label, required: item.required }));
  const payload = {
    templateRef: researchTemplateRef(template),
    status: missing.length === 0 ? ('ready' as const) : ('missing' as const),
    completed: completedIds.filter(id => known.has(id)).sort(),
    missing,
    unknownCompleted,
  };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export function researchTemplateCatalogDigest(): string {
  return createHash('sha256').update(JSON.stringify(TEMPLATES)).digest('hex');
}
