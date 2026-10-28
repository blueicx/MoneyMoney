import { createHash } from 'node:crypto';

/**
 * Versioned, read-only methodology catalog.
 *
 * Results produced by research features reference an entry with `id@version`
 * so the assumptions shown to the user stay pinned even after this file
 * changes. Adding a new version never rewrites an older entry.
 */

export interface MethodologyEntry {
  id: string;
  version: number;
  name: string;
  summary: string;
  inputs: readonly string[];
  assumptions: readonly string[];
  limitations: readonly string[];
  evidenceRequirements: readonly string[];
  reviewedAt: string;
}

const ENTRIES: readonly MethodologyEntry[] = [
  {
    id: 'bsm-option-value',
    version: 1,
    name: 'Black-Scholes-Merton 欧式期权估值',
    summary: '在固定无风险利率与波动率下按连续复利计算欧式看涨/看跌理论价值与 Greeks。',
    inputs: ['标的现货价格', '执行价', '剩余期限', '无风险利率', '隐含波动率', '股息率'],
    assumptions: ['欧式行权', '价格连续不跳空', '波动率在存续期内恒定', '可连续对冲'],
    limitations: ['不适用于美式提前行权', '对深虚值、短期限与分红事件偏乐观', '无法反映盘口深度与流动性折价'],
    evidenceRequirements: ['同一合约身份的有效期权快照', '到期日与币种一致', '有可核验的 IV 观测'],
    reviewedAt: '2026-10-28',
  },
  {
    id: 'factor-cross-section',
    version: 1,
    name: '横截面因子分组与行业中性比较',
    summary: '按点时成员把因子值做全局分位，并在行业内部标准化后比较组间收益；缺失行业不参与中性化。',
    inputs: ['点时成员存档', '每只标的的因子观测', '前向收益观测'],
    assumptions: ['成员与因子观测在同一时点可获得', '行业分类来自已保存证据', '前向收益不与因子观测重叠'],
    limitations: ['缺失行业时只能使用全局分位', '观测稀疏时中性化样本不足', '不证明成员区间内连续'],
    evidenceRequirements: ['点时成员记录及其内容 Hash', '每只标的的因子证据', '不低于最小样本数'],
    reviewedAt: '2026-10-28',
  },
  {
    id: 'scenario-shock',
    version: 1,
    name: '多变量情景冲击',
    summary: '按价格、波动率、利率、资金费率和概率冲击逐头寸重估。',
    inputs: ['头寸与方向', '基准估值', '情景冲击列表'],
    assumptions: ['冲击作用于给定基准估值', '相关性隐含在用户选定的冲击组合中'],
    limitations: ['不推断缺失的汇率或相关性', '冲击间非线性交互未建模'],
    evidenceRequirements: ['每个头寸的基准估值证据', '明确情景定义与版本'],
    reviewedAt: '2026-10-28',
  },
  {
    id: 'stress-test',
    version: 1,
    name: '组合压力测试',
    summary: '在价格冲击与流动性退出假设下汇总逐头寸损益与集中度贡献。',
    inputs: ['已保存或手动组合', '情景冲击', '流动性假设'],
    assumptions: ['缺失估值的头寸不参与小计', '币种独立汇总'],
    limitations: ['部分覆盖时小计不是完整组合', '尾部风险需另行展示历史证据'],
    evidenceRequirements: ['每个头寸的快照引用', '按币种分组的估值证据'],
    reviewedAt: '2026-10-28',
  },
  {
    id: 'brier-score',
    version: 1,
    name: 'Brier 评分',
    summary: '按 (预测概率 - 实际结果)^2 的平均值评估概率预测，越低越好。',
    inputs: ['冻结预测概率', '已结算结果'],
    assumptions: ['同一冻结测试集与相同评分窗口', '失败与取消样本单独统计'],
    limitations: ['对罕见事件的区分度有限', '样本不足时不具统计意义'],
    evidenceRequirements: ['预测输入 Hash', '冻结测试集清单', '实际结果来源'],
    reviewedAt: '2026-10-28',
  },
  {
    id: 'kelly-sizing',
    version: 1,
    name: '分数 Kelly 与风险上限',
    summary: '由冻结回测的胜率与赔率推导全 Kelly 比例，再按风险档位折减并用上限截断。',
    inputs: ['冻结回测统计', '资金规模', '最大仓位上限'],
    assumptions: ['未来结果分布与冻结样本近似', '单次独立下注近似'],
    limitations: ['统计误差会放大 Kelly 波动', '不适用于尾部极端风险', '仅作预览，不产生执行指令'],
    evidenceRequirements: ['回测证据引用与样本数', '手续费与滑点口径', '资金与币种'],
    reviewedAt: '2026-10-28',
  },
  {
    id: 'correlation-matrix',
    version: 1,
    name: '跨资产滚动相关性矩阵',
    summary: '按精确时间戳对齐收益序列，成对计算 Pearson 相关系数并展示重叠样本。',
    inputs: ['多资产已保存序列', '窗口与最小样本'],
    assumptions: ['对齐只在完全相同的时间戳上进行', '缺失点不插补'],
    limitations: ['相关性对异常值敏感', '不证明因果或稳定领先滞后'],
    evidenceRequirements: ['每段序列的证据引用与内容 Hash', '两端重叠样本不少于门槛'],
    reviewedAt: '2026-10-28',
  },
  {
    id: 'rolling-oos',
    version: 1,
    name: '滚动样本外检验',
    summary: '按固定训练与检验窗口滚动评估因子或策略，避免使用训练窗之外的信息。',
    inputs: ['按时间排序的观测', '训练/检验窗口长度', '最小样本门槛'],
    assumptions: ['观测时点严格递增', '每个窗口的成员在当时可获得'],
    limitations: ['窗口重叠会产生自相关', '样本稀疏时结果标记未知'],
    evidenceRequirements: ['每个窗口的成员与因子证据', '前向收益证据'],
    reviewedAt: '2026-10-28',
  },
];

function clone(entry: MethodologyEntry): MethodologyEntry {
  return {
    ...entry,
    inputs: [...entry.inputs],
    assumptions: [...entry.assumptions],
    limitations: [...entry.limitations],
    evidenceRequirements: [...entry.evidenceRequirements],
  };
}

export function listMethodologies(): MethodologyEntry[] {
  return ENTRIES.map(clone);
}

export function methodologyRef(id: string, version = 1): string {
  return `${id}@${version}`;
}

/** Accepts `id` or `id@version` and returns null when the reference cannot be honoured. */
export function getMethodology(ref: string): MethodologyEntry | null {
  if (typeof ref !== 'string' || !ref.trim() || ref.length > 120) return null;
  const [id, rawVersion] = ref.trim().split('@');
  const version = rawVersion === undefined ? null : Number(rawVersion);
  const entry = ENTRIES.find(row => row.id === id && (version === null || row.version === version));
  return entry ? clone(entry) : null;
}

export function methodologyCatalogDigest(): string {
  return createHash('sha256').update(JSON.stringify(ENTRIES)).digest('hex');
}
