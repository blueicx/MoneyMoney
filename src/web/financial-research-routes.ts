import express from 'express';
import {
  FinancialTextIndex,
  filingHtmlText,
  usFilingInstrument,
  type FilingTextInput,
} from '../storage/financial-text-index';
import { fetchSecText, loadSecSubmissions } from '../features/sec-edgar-client';

/** Only a directory-verified filing is fetched; no URL, HTML or CIK from a request is trusted. */
export async function loadOfficialFilingText(instrument: string, accession?: string): Promise<FilingTextInput> {
  usFilingInstrument(instrument);
  const submissions = await loadSecSubmissions(instrument.slice('stock:us:'.length));
  const filing = submissions.filings.find(row =>
    ['10-K', '10-Q', '10-K/A', '10-Q/A'].includes(row.form)
    && (!accession || row.accessionNumber === accession));
  if (!filing
    || !/^\d{10}-\d{2}-\d{6}$/.test(filing.accessionNumber)
    || !/^[\w.-]{1,128}\.html?$/i.test(filing.primaryDocument || '')) {
    throw new Error('SEC 目录没有可核验的 10-K/10-Q 原文');
  }
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${Number(submissions.cik)}/${filing.accessionNumber.replace(/-/g, '')}/${filing.primaryDocument}`;
  const boundedFetch: typeof fetch = async (url, init) => {
    const response = await fetch(url, { ...init, redirect: 'error' });
    if (!response.ok) return response;
    if (Number(response.headers.get('content-length') || 0) > 4 * 1024 * 1024) {
      await response.body?.cancel();
      throw new Error('SEC 文件超过 4MB 下载预算');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('SEC 原文响应为空');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('SEC 文件超过 4MB 下载预算');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };
  const text = filingHtmlText(await fetchSecText(sourceUrl, boundedFetch));
  return {
    instrument,
    accession: filing.accessionNumber,
    form: filing.form,
    sourceUrl,
    text,
    publishedAt: filing.acceptedAt || filing.filingDate + 'T23:59:59.999Z',
    retrievedAt: new Date().toISOString(),
    publicationPrecision: filing.acceptedAt
      ? 'verified-acceptance-time'
      : 'filing-date-conservative-end-of-day',
  };
}

function requestFields(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input || {}).some(field => !allowed.includes(field))) {
    throw new Error('请求包含未允许字段，不接受任意 URL、原文或客户端计算结果');
  }
}

function idempotencyKey(req: express.Request): string {
  const value = String(req.get('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new Error('写请求需要有效 Idempotency-Key');
  return value;
}

function expectedVersion(req: express.Request, body: Record<string, unknown>): number {
  const header = String(req.get('if-match') || '').trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  if (!/^\d+$/.test(header)) throw new Error('写请求需要有效 If-Match 批注版本');
  const value = Number(header);
  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== value) {
    throw new Error('If-Match 与请求版本不一致');
  }
  return value;
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : '';
  if (/未找到/.test(message)) return 404;
  if (/版本冲突|幂等键已用于/.test(message)) return 409;
  return 400;
}

export function createFinancialResearchRouter(deps: {
  index: () => FinancialTextIndex;
  load?: typeof loadOfficialFilingText;
  csrfValid: (req: express.Request) => boolean;
}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if ((req as any).user?.role !== 'admin') {
      res.status(403).json({ success: false, reason: '仅管理员可访问私人财报检索' });
      return;
    }
    if (req.method !== 'GET' && !deps.csrfValid(req)) {
      res.status(403).json({ success: false, dataStatus: 'failed', reason: 'CSRF 校验失败' });
      return;
    }
    next();
  });
  const inFlight = new Set<string>();
  const envelope = (
    instrument: string | null,
    data: unknown,
    dataStatus: string,
    reason: string | null,
    evidenceRefs: string[] = [],
    source = 'SEC EDGAR 官方原文 / 本地 SQLite FTS5 BM25',
  ) => ({
    success: true,
    market: 'stocks',
    instrument,
    data,
    dataStatus,
    reason,
    source,
    updatedAt: new Date().toISOString(),
    evidenceRefs,
  });
  const fail = (res: express.Response, error: unknown, fallback: string) => {
    res.status(errorStatus(error)).json({
      success: false,
      dataStatus: 'failed',
      reason: error instanceof Error ? error.message : fallback,
    });
  };
  router.get('/', (req, res) => {
    try {
      requestFields(req.query as Record<string, unknown>, ['instrument', 'asOf']);
      const instrument = usFilingInstrument(String(req.query.instrument || ''));
      const data = deps.index().list(instrument, String(req.query.asOf || new Date().toISOString()));
      res.json(envelope(
        instrument,
        data,
        data.length ? 'historical' : 'empty',
        data.length ? null : '尚未手动索引该股票的官方文件',
        data.map(row => row.id),
      ));
    } catch (error) {
      fail(res, error, '检索失败');
    }
  });
  router.get('/search', (req, res) => {
    try {
      requestFields(req.query as Record<string, unknown>, ['instrument', 'q', 'asOf', 'limit']);
      const instrument = usFilingInstrument(String(req.query.instrument || ''));
      const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
      const data = deps.index().search({
        instrument,
        query: String(req.query.q || ''),
        asOf: String(req.query.asOf || new Date().toISOString()),
        ...(limit === undefined ? {} : { limit }),
      });
      res.json(envelope(
        instrument,
        data,
        data.length ? 'historical' : 'empty',
        data.length ? null : '所选标的与时点没有匹配段落；不生成回答或伪造引用',
        data.map(row => row.citation),
      ));
    } catch (error) {
      fail(res, error, '检索失败');
    }
  });
  router.get('/compare', (req, res) => {
    try {
      requestFields(req.query as Record<string, unknown>, ['base', 'current']);
      const data = deps.index().compare(String(req.query.base || ''), String(req.query.current || ''));
      res.json(envelope(
        data.instrument === 'unknown' ? null : data.instrument,
        data,
        data.status === 'comparable' ? 'historical' : 'partial',
        data.reasons.length ? data.reasons.join('；') : null,
        data.evidenceRefs,
        'SEC 官方原文 / 稳定章节对齐与段落级差异',
      ));
    } catch (error) {
      fail(res, error, '财报版本对照失败');
    }
  });
  router.get('/:id/sections', (req, res) => {
    try {
      requestFields(req.query as Record<string, unknown>, []);
      const document = deps.index().document(String(req.params.id));
      if (!document) throw new Error('未找到已索引财报');
      const data = deps.index().sections(document.id);
      res.json(envelope(
        document.instrument,
        data,
        data.length ? 'historical' : 'partial',
        data.length ? null : '未解析出稳定章节；保留整份原文但不声称章节可对齐',
        data.map(row => row.citation),
        'SEC 官方原文 / 可重建章节索引',
      ));
    } catch (error) {
      fail(res, error, '章节读取失败');
    }
  });
  router.get('/:id/annotations', (req, res) => {
    try {
      requestFields(req.query as Record<string, unknown>, []);
      const document = deps.index().document(String(req.params.id));
      if (!document) throw new Error('未找到已索引财报');
      const data = deps.index().annotations(String(req.params.id));
      res.json(envelope(
        document.instrument,
        data,
        data.length ? 'historical' : 'empty',
        data.length ? null : '这份财报尚无人工批注',
        data.map(row => row.citation),
        'SEC 官方原文定位 / 追加式人工批注',
      ));
    } catch (error) {
      fail(res, error, '批注读取失败');
    }
  });
  router.post('/:id/annotations', (req, res) => {
    try {
      requestFields(req.body || {}, ['sectionKey', 'startParagraph', 'endParagraph', 'body', 'expectedVersion']);
      const key = idempotencyKey(req);
      const version = expectedVersion(req, req.body || {});
      const user = (req as any).user || {};
      const author = String(user.username || user.user || user.name || 'admin').slice(0, 120);
      const data = deps.index().annotate({
        documentId: String(req.params.id),
        sectionKey: String(req.body.sectionKey || ''),
        startParagraph: Number(req.body.startParagraph),
        endParagraph: Number(req.body.endParagraph),
        body: String(req.body.body || ''),
        author,
        expectedVersion: version,
        idempotencyKey: key,
      });
      const document = deps.index().document(data.documentId)!;
      res.status(201).json(envelope(
        document.instrument,
        data,
        'historical',
        null,
        [data.citation],
        'SEC 官方原文定位 / 追加式人工批注',
      ));
    } catch (error) {
      fail(res, error, '批注写入失败');
    }
  });
  router.post('/index', async (req, res) => {
    let key: string | null = null;
    try {
      requestFields(req.body || {}, ['instrument', 'accession']);
      idempotencyKey(req);
      const instrument = usFilingInstrument(String(req.body.instrument || ''));
      const accession = req.body.accession == null ? undefined : String(req.body.accession);
      if (accession && !/^\d{10}-\d{2}-\d{6}$/.test(accession)) throw new Error('申报编号无效');
      key = instrument;
      if (inFlight.size >= 1) {
        res.status(409).json({ success: false, dataStatus: 'partial', reason: '已有索引任务在运行，请稍后重试' });
        key = null;
        return;
      }
      inFlight.add(key);
      const loaded = await (deps.load || loadOfficialFilingText)(instrument, accession);
      if (loaded.instrument !== instrument || (accession && loaded.accession !== accession)) {
        throw new Error('来源申报身份与所选标的不一致');
      }
      const data = deps.index().index(loaded);
      res.status(201).json(envelope(instrument, data, 'historical', null, [data.id]));
    } catch (error) {
      res.status(errorStatus(error)).json({
        success: false,
        dataStatus: 'unavailable',
        reason: error instanceof Error ? error.message : 'SEC 原文不可用',
      });
    } finally {
      if (key) inFlight.delete(key);
    }
  });
  return router;
}
