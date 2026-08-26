/**
 * Unified keyless upcoming-event calendar: macro releases, central-bank
 * decisions, and US earnings in one research-friendly timeline.
 */

import fs from 'fs';
import path from 'path';
import { DATA_ROOT, ensureDir } from '../utils/paths';
import { getMacroCalendar } from './external-market-data';
import { getEarningsCalendar } from './earnings-calendar';
import { translateEnglishTitles } from './market-translation';

export type EventCategory = 'macro' | 'central-bank' | 'earnings';
export type EventImpact = 'high' | 'medium' | 'low' | 'holiday';

export interface UpcomingEvent {
  id: string;
  title: string;
  titleZh?: string;
  titleNote?: string;
  category: EventCategory;
  categoryLabel: string;
  date: string;
  impact: EventImpact;
  country: string;
  countryLabel: string;
  detail: string;
  detailZh?: string;
  detailNote?: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  source: string;
}

export interface UpcomingEventCalendar {
  source: 'ForexFactory + Nasdaq + MoneyMoney schedule';
  fetchedAt: string;
  startDate: string;
  endDate: string;
  count: number;
  events: UpcomingEvent[];
  warnings: string[];
  stale?: boolean;
}

interface MergeInput {
  referenceDate?: Date;
  days?: number;
  macro?: Awaited<ReturnType<typeof getMacroCalendar>> | null;
  earnings?: Array<Awaited<ReturnType<typeof getEarningsCalendar>>>;
}

const DISK_CACHE = path.join(DATA_ROOT, 'upcoming-events.cache.json');
const MEMORY_TTL_MS = 5 * 60_000;
const MAX_STALE_MS = 3 * 24 * 60 * 60_000;
// Published Federal Reserve policy-meeting dates. Statement time is represented
// as 19:00 UTC (2 p.m. Washington, D.C.). Extra years can be appended safely.
export const FOMC_MEETING_DATES = [
  '2026-09-15', '2026-10-27', '2026-12-08',
  '2027-01-26', '2027-03-16', '2027-04-27',
];

let memoryCache: { ts: number; value: UpcomingEventCalendar } | null = null;
let loading: Promise<UpcomingEventCalendar> | null = null;
let translationRefresh: Promise<void> | null = null;
let earningsCompanyLookup: Map<string, string> | null = null;

/**
 * ForexFactory uses compact English indicator names. A local dictionary keeps
 * the calendar fast and avoids spending public translation quota every week.
 */
export const MACRO_EVENT_ZH: Record<string, string> = {
  'adp weekly employment change': 'ADP每周就业人数变化',
  'adp nonfarm employment change': 'ADP非农就业人数变化',
  'api weekly statistical bulletin': '美国石油学会(API)每周统计公报',
  'average hourly earnings m/m': '平均时薪 月率',
  'belgian nbb business climate': '比利时国家银行商业景气指数',
  'boj core cpi y/y': '日本央行核心消费者物价指数(CPI) 年率',
  'building permits': '建筑许可',
  'cb consumer confidence': '美国谘商会消费者信心指数',
  'cb leading index m/m': '谘商会领先指标 月率',
  'cbi realized sales': '英国工业联合会(CBI)实际销售指数',
  'chicago pmi': '芝加哥采购经理人指数(PMI)',
  'construction work done q/q': '已完成建筑工程 季率',
  'core cpi m/m': '核心消费者物价指数(CPI) 月率',
  'core cpi y/y': '核心消费者物价指数(CPI) 年率',
  'core durable goods orders m/m': '核心耐用品订单 月率',
  'core pce price index m/m': '核心个人消费支出(PCE)物价指数 月率',
  'core pce price index y/y': '核心个人消费支出(PCE)物价指数 年率',
  'core retail sales m/m': '核心零售销售 月率',
  'core retail sales q/q': '核心零售销售 季率',
  'corporate profits q/q': '企业利润 季率',
  'cpi m/m': '消费者物价指数(CPI) 月率',
  'cpi y/y': '消费者物价指数(CPI) 年率',
  'crude oil inventories': '原油库存',
  'current account': '经常帐',
  'durable goods orders m/m': '耐用品订单 月率',
  'ecb monetary policy meeting accounts': '欧洲央行货币政策会议纪要',
  'flash manufacturing pmi': '初值制造业PMI',
  'flash services pmi': '初值服务业PMI',
  'french consumer spending m/m': '法国消费者支出 月率',
  'french final private payrolls q/q': '法国终值私营部门就业人数 季率',
  'french prelim cpi m/m': '法国初值消费者物价指数(CPI) 月率',
  'french prelim gdp q/q': '法国初值GDP 季率',
  'gdp m/m': 'GDP（国内生产总值） 月率',
  'gdp q/q': 'GDP（国内生产总值） 季率',
  'gdp y/y': 'GDP（国内生产总值） 年率',
  'german final gdp q/q': '德国终值GDP 季率',
  'german gfk consumer climate': '德国GfK消费者信心指数',
  'german ifo business climate': '德国伊弗(ifo)商业景气指数',
  'german import prices m/m': '德国进口物价指数 月率',
  'german unemployment change': '德国失业人数变化',
  'goods trade balance': '商品贸易帐',
  'household spending m/m': '家庭支出 月率',
  'hpi m/m': '房价指数(HPI) 月率',
  'industrial production m/m': '工业产出 月率',
  'interest rate decision': '利率决议',
  'ism manufacturing pmi': 'ISM制造业PMI',
  'ism services pmi': 'ISM服务业PMI',
  'italian 10-y bond auction': '意大利10年期国债拍卖',
  'jackson hole symposium': '杰克逊霍尔全球央行年会',
  'jolts job openings': 'JOLTS职位空缺',
  'kof economic barometer': '瑞士KOF经济晴雨表',
  'm3 money supply y/y': 'M3货币供应量 年率',
  'mi leading index m/m': '墨尔本研究院(MI)领先指标 月率',
  'monetary policy meeting minutes': '货币政策会议纪要',
  'monetary policy statement': '货币政策声明',
  'natural gas storage': '天然气库存',
  'new home sales': '新屋销售',
  'non-farm employment change': '非农就业人数变化',
  'personal income m/m': '个人收入 月率',
  'personal spending m/m': '个人支出 月率',
  'prelim benchmark payrolls revision': '初值非农就业基准修正',
  'prelim gdp price index q/q': '初值GDP物价指数 季率',
  'prelim gdp q/q': '初值GDP 季率',
  'prelim wholesale inventories m/m': '初值批发库存 月率',
  'private capital expenditure q/q': '私人资本支出 季率',
  'private loans y/y': '私人部门贷款 年率',
  'rba bulletin': '澳洲央行公报',
  'retail sales m/m': '零售销售 月率',
  'retail sales q/q': '零售销售 季率',
  'revised uom consumer sentiment': '终值密歇根大学消费者信心指数',
  'revised uom inflation expectations': '终值密歇根大学通胀预期',
  'richmond manufacturing index': '里奇蒙德制造业指数',
  's&p/cs composite-20 hpi y/y': '标普/Case-Shiller 20城房价指数 年率',
  'spanish flash cpi y/y': '西班牙初值消费者物价指数(CPI) 年率',
  'sppi y/y': '服务生产者物价指数(SPPI) 年率',
  'tokyo core cpi y/y': '东京核心消费者物价指数(CPI) 年率',
  'trimmed mean cpi m/m': '截尾平均消费者物价指数(CPI) 月率',
  'ubs economic expectations': '瑞银经济预期指数',
  'unemployment claims': '初请失业金人数',
  'unemployment rate': '失业率',
};

/** Well-known companies benefit from their established Chinese names. */
export const EARNINGS_COMPANY_ZH: Record<string, string> = {
  'abercrombie & fitch company': '阿贝克隆比&费奇（A&F）',
  'academy sports and outdoors': '学院运动户外',
  'affirm holdings': 'Affirm（先买后付平台）',
  'agilent technologies': '安捷伦科技',
  'airbnb': '爱彼迎（Airbnb）',
  'alibaba group holding': '阿里巴巴',
  'amazon com inc': '亚马逊',
  'apple inc': '苹果',
  'apartment investment and management company': '公寓投资管理公司',
  'autodesk': '欧特克（Autodesk）',
  'banco bbva argentina': '阿根廷BBVA银行',
  'bank of america': '美国银行',
  'bath & body works': 'Bath & Body Works（个护与家居香氛）',
  'best buy co': '百思买',
  'bilibili inc': '哔哩哔哩',
  'boeing': '波音',
  'boxabl': 'BOXABL（模块化住宅）',
  'broadcom': '博通',
  'burlington stores': '伯灵顿百货',
  'bw lpg limited': 'BW液化石油气航运',
  'canadian imperial bank of commerce': '加拿大帝国商业银行',
  'cbak energy technology limited': 'CBAK能源科技',
  'chagee holdings limited': '霸王茶姬',
  'chronoscale holdings corporation': 'ChronoScale控股',
  'cleancore solutions': 'CleanCore Solutions',
  'cmb tech nv': 'CMB.TECH（航运科技）',
  'credo technology group holding ltd': 'Credo科技集团',
  'crowdstrike holdings': 'CrowdStrike（网络安全）',
  'currenc group': 'Currenc集团',
  'dell technologies': '戴尔科技',
  'dollar general corporation': '达乐超市',
  'dollar tree': '美元树',
  'donaldson company': '唐纳森工业',
  'dycom industries': 'Dycom工业',
  'elastic n v': 'Elastic（搜索与数据分析）',
  'everpure': 'Everpure（净水业务）',
  'exxon mobil': '埃克森美孚',
  'freight technologies': 'Freight Technologies（货运科技）',
  'frontline plc': 'Frontline（油轮航运）',
  'gap': '盖璞（Gap）',
  'gitlab': 'GitLab',
  'global interactive technologies': '全球互动科技',
  'great elm group': 'Great Elm集团',
  'grifols': '基立福',
  'hafnia limited': 'Hafnia（油轮航运）',
  'harmony gold mining company limited': '哈莫尼黄金',
  'healthequity': 'HealthEquity（健康储蓄账户）',
  'heidmar maritime holdings corp': 'Heidmar海事控股',
  'home depot': '家得宝',
  'hormel foods corporation': '荷美尔食品',
  'hp inc': '惠普',
  'iren limited': 'IREN（数字基础设施）',
  'irsa inversiones y representaciones': 'IRSA（阿根廷地产）',
  'jiayin group': '嘉银科技',
  'johnson & johnson': '强生',
  'kenon holdings ltd': 'Kenon控股',
  'kohl s corporation': '科尔士百货',
  'lexinfintech holdings ltd': '乐信',
  'li auto inc': '理想汽车',
  'lunai bioworks': 'Lunai Bioworks（生物医药）',
  'marvell technology': '迈威尔科技',
  'medtronic plc': '美敦力',
  'mesoblast limited': 'Mesoblast（细胞治疗）',
  'minimed group': 'MiniMed（医疗器械）',
  'miniso group holding limited': '名创优品',
  'mongodb': 'MongoDB',
  'nano labs ltd': '纳米实验室',
  'netflix inc': '奈飞',
  'nio inc': '蔚来',
  'niocorp developments ltd': 'NioCorp（矿产开发）',
  'nvidia corporation': '英伟达',
  'nutanix': 'Nutanix（云计算架构）',
  'okta': 'Okta（身份认证）',
  'palo alto networks': '帕洛阿尔托网络',
  'pyxis tankers': 'Pyxis油轮航运',
  'regis corporation': 'Regis（美发连锁）',
  'rezolve ai plc': 'Rezolve AI',
  'royal bank of canada': '加拿大皇家银行',
  'rubrik': 'Rubrik（数据安全）',
  'salesforce': 'Salesforce（企业云软件）',
  'science applications international corporation': '科学应用国际公司（SAIC）',
  'sentinelone': 'SentinelOne（网络安全）',
  'so young international': '新氧',
  'sportsman s warehouse holdings': 'Sportsman’s Warehouse（户外用品零售）',
  'standard nuclear': 'Standard Nuclear（核能材料）',
  'synopsys': '新思科技',
  'tesla inc': '特斯拉',
  'the j m smucker company': 'J.M.斯马克食品',
  'the toronto dominion bank': '多伦多道明银行',
  'torm plc': 'TORM（油轮航运）',
  'transportadora de gas sa ord b': '阿根廷天然气运输公司（TGN）',
  'trip com group limited': '携程集团',
  'ulta beauty': 'Ulta Beauty（美妆零售）',
  'urban outfitters': 'Urban Outfitters（服饰零售）',
  'veeva systems': 'Veeva Systems（生命科学云）',
  'williams sonoma': '威廉索拿马（家居零售）',
  'workday': 'Workday（人力资源云）',
  'yext': 'Yext（数字搜索营销）',
  'zepp health corporation': '华米科技',
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, amount: number): Date {
  return new Date(value.getTime() + amount * 86_400_000);
}

function text(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.toUpperCase() !== 'N/A' ? normalized : '';
}

function countryLabel(value: string): string {
  const map: Record<string, string> = {
    USD: '美国', US: '美国', EUR: '欧元区', EU: '欧元区',
    CNY: '中国', CN: '中国', GBP: '英国', JPY: '日本',
    HKD: '香港', AUD: '澳大利亚', CAD: '加拿大', CHF: '瑞士',
    NZD: '新西兰', SGD: '新加坡', ZAR: '南非', MXN: '墨西哥',
  };
  return map[value.toUpperCase()] || value || '全球';
}

function normalizeTranslationKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[(),.]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\b(the|inc|corp|corporation|company|co|plc|ltd|limited|nv|sa|common stock)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function frequencySuffix(value: string): string {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/(\bm\/m|week over week)$/i.test(normalized)) return '月率';
  if (/(\bq\/q|quarter over quarter)$/i.test(normalized)) return '季率';
  if (/(\by\/y|year over year)$/i.test(normalized)) return '年率';
  return '';
}

export function translateMacroTitle(title: string): string | undefined {
  const raw = String(title || '').trim();
  if (!raw || /[\u3400-\u4dbf\u4e00-\u9fff]/.test(raw)) return undefined;
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ');
  if (MACRO_EVENT_ZH[normalized]) return MACRO_EVENT_ZH[normalized];

  const speakerPatterns: Array<[RegExp, string]> = [
    [/^fed (?:chairman|chair)\s+(.+)\sspeaks$/i, '美联储主席'],
    [/^fomc member\s+(.+)\sspeaks$/i, 'FOMC票委'],
    [/^treasury sec(?:retary)?\s+(.+)\sspeaks$/i, '美国财政部长'],
    [/^gov(?:ernor)? board member\s+(.+)\sspeaks$/i, '央行管委会成员'],
  ];
  for (const [pattern, role] of speakerPatterns) {
    const match = raw.match(pattern);
    if (match) return `${role}${match[1]}发表讲话`;
  }

  const suffix = frequencySuffix(raw);
  const base = normalized.replace(/\s+(m\/m|q\/q|y\/y|w\/w)$/i, '').trim();
  if (MACRO_EVENT_ZH[base]) {
    return suffix ? `${MACRO_EVENT_ZH[base]} ${suffix}` : MACRO_EVENT_ZH[base];
  }
  return undefined;
}

export function translateCompanyName(name: string): string | undefined {
  const raw = String(name || '').trim();
  if (!raw || /[\u3400-\u4dbf\u4e00-\u9fff]/.test(raw)) return undefined;
  const normalizedKey = normalizeTranslationKey(raw).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const shortKey = normalizedKey.replace(/\s+(holdings|group)$/g, '').trim();
  const legalSuffixKey = shortKey.replace(/\s+(s a|sa)$/g, '').trim();
  if (!earningsCompanyLookup) {
    earningsCompanyLookup = new Map(Object.entries(EARNINGS_COMPANY_ZH)
      .map(([key, value]) => [normalizeTranslationKey(key), value]));
  }
  return earningsCompanyLookup.get(legalSuffixKey) ||
    earningsCompanyLookup.get(shortKey) ||
    earningsCompanyLookup.get(normalizedKey);
}

function usMarketTimeToUtc(date: string, hourEastern: number): Date {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const nthSunday = (targetMonth: number, nth: number) => {
    const first = new Date(Date.UTC(year, targetMonth, 1));
    return 1 + ((7 - first.getUTCDay()) % 7) + 7 * (nth - 1);
  };
  const dstStart = new Date(Date.UTC(year, 2, nthSunday(2, 2), 7));
  const dstEnd = new Date(Date.UTC(year, 10, nthSunday(10, 1), 6));
  const utcHour = hourEastern + (new Date(Date.UTC(year, month, day)) >= dstStart && new Date(Date.UTC(year, month, day)) < dstEnd ? 4 : 5);
  return new Date(`${date}T${String(utcHour).padStart(2, '0')}:00:00Z`);
}

function normalizeMacroImpact(value: string): EventImpact {
  const normalized = value.toLowerCase();
  if (['high', 'medium', 'low', 'holiday'].includes(normalized)) return normalized as EventImpact;
  return 'low';
}

function mergeCalendarEvents(input: MergeInput): UpcomingEvent[] {
  const reference = input.referenceDate ? new Date(input.referenceDate) : new Date();
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  const end = addDays(start, Math.min(30, Math.max(1, input.days ?? 7)));
  const events: UpcomingEvent[] = [];

  for (const item of input.macro?.events || []) {
    const date = new Date(item.date);
    if (Number.isNaN(date.getTime()) || date < start || date >= end) continue;
    const isCentralBank = /fomc|fed|federal funds|rate decision/i.test(item.title);
    events.push({
      id: `macro-${date.getTime()}-${item.title}`,
      title: item.title,
      titleZh: translateMacroTitle(item.title),
      titleNote: item.title,
      category: isCentralBank ? 'central-bank' : 'macro',
      categoryLabel: isCentralBank ? '央行' : '经济数据',
      date: item.date,
      impact: normalizeMacroImpact(item.impact),
      country: item.country,
      countryLabel: countryLabel(item.country),
      detail: `${countryLabel(item.country)} · ${item.impactLabel}`,
      detailZh: `${countryLabel(item.country)} · ${item.impactLabel}`,
      forecast: item.forecast,
      previous: item.previous,
      actual: item.actual,
      source: input.macro?.source ?? 'ForexFactory',
    });
  }

  for (const day of input.earnings || []) {
    for (const item of day.items.slice(0, 24)) {
      // Nasdaq returns a date but not a reliable timestamp. Approximate the
      // usual session so the timeline does not show every report at midnight.
      const date = usMarketTimeToUtc(day.date, item.timing === 'after' ? 16 : 8);
      events.push({
        id: `earnings-${day.date}-${item.symbol}`,
        title: `${item.symbol} 财报`,
        category: 'earnings',
        categoryLabel: '财报',
        date: date.toISOString(),
        impact: (item.marketCapUsd || 0) >= 50_000_000_000 ? 'high'
          : (item.marketCapUsd || 0) >= 5_000_000_000 ? 'medium' : 'low',
        country: 'US',
        countryLabel: '美国',
        detail: [item.name, item.timingLabel, item.fiscalQuarter].filter(Boolean).join(' · '),
        detailZh: [
          translateCompanyName(item.name) || item.name,
          item.timingLabel,
          item.fiscalQuarter,
        ].filter(Boolean).join(' · '),
        detailNote: item.name,
        forecast: item.epsForecast || null,
        previous: item.lastYearEps || null,
        actual: null,
        source: day.source,
      });
    }
  }

  for (const meetingDate of FOMC_MEETING_DATES) {
    const date = new Date(`${meetingDate}T19:00:00Z`);
    if (date < start || date >= end) continue;
    events.push({
      id: `fomc-${meetingDate}`,
      title: 'FOMC 利率决议',
      category: 'central-bank',
      categoryLabel: '央行',
      date: date.toISOString(),
      impact: 'high',
      country: 'US',
      countryLabel: '美国',
      detail: '美联储公布利率决定、声明与经济预测，随后通常召开新闻发布会',
      forecast: null,
      previous: null,
      actual: null,
      source: 'Federal Reserve published calendar',
    });
  }

  return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function buildUpcomingEvents(input: MergeInput): UpcomingEventCalendar {
  const reference = input.referenceDate ? new Date(input.referenceDate) : new Date();
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  const days = Math.min(30, Math.max(1, input.days ?? 7));
  const events = mergeCalendarEvents({ ...input, referenceDate: start, days });
  const warnings: string[] = [];
  if (input.macro?.stale) warnings.push('宏观日历使用近期缓存');

  return {
    source: 'ForexFactory + Nasdaq + MoneyMoney schedule',
    fetchedAt: new Date().toISOString(),
    startDate: isoDate(start),
    endDate: isoDate(addDays(start, days)),
    count: events.length,
    events,
    warnings,
  };
}

async function enrichCalendarTranslations(value: UpcomingEventCalendar): Promise<void> {
  try {
    const macroTitles = [...new Set(value.events
      .filter(event => event.category !== 'earnings' && !event.titleZh && event.title)
      .map(event => event.title))];
    if (macroTitles.length) {
      const translations = await translateEnglishTitles(macroTitles, 36);
      for (const event of value.events) {
        if (event.titleZh || event.category === 'earnings') continue;
        event.titleZh = translations.get(event.title.toLowerCase()) || event.titleZh;
      }
    }

    const companyNames = [...new Set(value.events
      .filter(event => event.category === 'earnings' &&
        event.detailNote && event.detailZh?.startsWith(event.detailNote))
      .map(event => event.detailNote!)
      .filter(name => !translateCompanyName(name)))]
      .slice(0, 24);
    if (companyNames.length) {
      const translations = await translateEnglishTitles(companyNames, 24);
      for (const event of value.events) {
        if (event.category !== 'earnings' || !event.detailNote) continue;
        const translated = translations.get(event.detailNote.toLowerCase());
        if (!translated || translated === event.detailNote) continue;
        event.detailZh = [translated, ...event.detailZh?.split(' · ').slice(1) || []]
          .filter(Boolean).join(' · ');
      }
    }
  } catch {
    // Calendar remains usable with English titles if optional translation fails.
  }
}

function startTranslationRefresh(value: UpcomingEventCalendar): void {
  if (translationRefresh) return;
  translationRefresh = enrichCalendarTranslations(value)
    .catch(() => undefined)
    .then(() => {
      try {
        ensureDir(DATA_ROOT);
        return fs.promises.writeFile(DISK_CACHE, JSON.stringify(value), 'utf8');
      } catch {
        return undefined;
      }
    })
    .finally(() => {
      translationRefresh = null;
    });
}

async function fetchUpcomingEventCalendar(days: number): Promise<UpcomingEventCalendar> {
  const reference = new Date();
  const dates = Array.from({ length: days }, (_, index) => isoDate(addDays(reference, index)));
  const [macroResult, earningsResults] = await Promise.allSettled([
    getMacroCalendar(),
    Promise.allSettled(dates.map(date => getEarningsCalendar(date))),
  ]);

  const macro = macroResult.status === 'fulfilled' ? macroResult.value : null;
  const earningsDays = earningsResults.status === 'fulfilled' ? earningsResults.value : [];
  const earnings = earningsDays
    .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof getEarningsCalendar>>> =>
      item.status === 'fulfilled')
    .map(item => item.value);

  const result = buildUpcomingEvents({
    days,
    macro,
    earnings,
    referenceDate: dates[0] ? new Date(`${dates[0]}T00:00:00Z`) : reference,
  });
  if (!macro) result.warnings.unshift('宏观日历暂时不可用');
  if (!earnings.length) result.warnings.push('财报日历暂时不可用');
  return result;
}

export async function getUpcomingEventCalendar(requestedDays?: number, force = false): Promise<UpcomingEventCalendar> {
  const days = Math.min(30, Math.max(1, Number(requestedDays) || 7));
  if (!force && memoryCache && Date.now() - memoryCache.ts < MEMORY_TTL_MS && memoryCache.value.endDate === isoDate(new Date())) {
    return memoryCache.value;
  }
  if (loading) return loading;

  loading = fetchUpcomingEventCalendar(days).then(async value => {
    try {
      ensureDir(DATA_ROOT);
      await fs.promises.writeFile(DISK_CACHE, JSON.stringify(value), 'utf8');
    } catch {}
    memoryCache = { ts: Date.now(), value };
    startTranslationRefresh(value);
    return value;
  }).catch(async error => {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(DISK_CACHE, 'utf8')) as UpcomingEventCalendar;
      const age = Date.now() - new Date(parsed.fetchedAt).getTime();
      if (Array.isArray(parsed.events) && age >= 0 && age <= MAX_STALE_MS) {
        const value = { ...parsed, stale: true };
        memoryCache = { ts: Date.now(), value };
        return value;
      }
    } catch {}
    throw error;
  }).finally(() => {
    loading = null;
  });
  return loading;
}
