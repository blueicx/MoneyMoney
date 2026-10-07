import express from 'express';
import { FinancialTextIndex, filingHtmlText, usFilingInstrument, type FilingTextInput } from '../storage/financial-text-index';
import { fetchSecText, loadSecSubmissions } from '../features/sec-edgar-client';

/** Only a directory-verified filing is fetched; no URL, HTML or CIK from a request is trusted. */
export async function loadOfficialFilingText(instrument: string, accession?: string): Promise<FilingTextInput> {
  usFilingInstrument(instrument);
  const submissions = await loadSecSubmissions(instrument.slice('stock:us:'.length));
  const filing = submissions.filings.find(row => ['10-K','10-Q','10-K/A','10-Q/A'].includes(row.form) && (!accession || row.accessionNumber === accession));
  if (!filing || !/^\d{10}-\d{2}-\d{6}$/.test(filing.accessionNumber) || !/^[\w.-]{1,128}\.html?$/i.test(filing.primaryDocument || '')) throw new Error('SEC 目录没有可核验的 10-K/10-Q 原文');
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${Number(submissions.cik)}/${filing.accessionNumber.replace(/-/g, '')}/${filing.primaryDocument}`;
  const boundedFetch: typeof fetch = async (url, init) => {
    const response = await fetch(url, {...init, redirect:'error'});
    if (!response.ok) return response;
    if (Number(response.headers.get('content-length') || 0) > 4 * 1024 * 1024) { await response.body?.cancel(); throw new Error('SEC 文件超过 4MB 下载预算'); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('SEC 原文响应为空');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('SEC 文件超过 4MB 下载预算'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return new Response(Buffer.concat(chunks), {status:response.status,headers:response.headers});
  };
  const text = filingHtmlText(await fetchSecText(sourceUrl, boundedFetch));
  return {instrument,accession:filing.accessionNumber,form:filing.form,sourceUrl,text,
    publishedAt:filing.acceptedAt || filing.filingDate + 'T23:59:59.999Z',retrievedAt:new Date().toISOString(),
    publicationPrecision:filing.acceptedAt ? 'verified-acceptance-time':'filing-date-conservative-end-of-day'};
}

export function createFinancialResearchRouter(deps: {index: () => FinancialTextIndex; load?: typeof loadOfficialFilingText}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control','private, no-store');
    if ((req as any).user?.role !== 'admin') { res.status(403).json({success:false,reason:'仅管理员可访问私人财报检索'}); return; }
    next();
  });
  const inFlight = new Set<string>();
  const envelope = (instrument: string, data: unknown, dataStatus: string, reason: string | null, evidenceRefs: string[] = []) => ({success:true,market:'stocks',instrument,data,dataStatus,reason,source:'SEC EDGAR 官方原文 / 本地 SQLite FTS5 BM25',updatedAt:new Date().toISOString(),evidenceRefs});
  router.get('/', (req,res) => {
    try {const instrument=usFilingInstrument(String(req.query.instrument || ''));const data=deps.index().list(instrument,String(req.query.asOf || new Date().toISOString()));res.json(envelope(instrument,data,data.length?'historical':'empty',data.length?null:'尚未手动索引该股票的官方文件',data.map(row=>row.id)));}
    catch(error) {res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'检索失败'});}
  });
  router.get('/search', (req,res) => {
    try {const instrument=usFilingInstrument(String(req.query.instrument || ''));const data=deps.index().search({instrument,query:String(req.query.q || ''),asOf:String(req.query.asOf || new Date().toISOString())});res.json(envelope(instrument,data,data.length?'historical':'empty',data.length?null:'所选标的与时点没有匹配段落；不生成回答或伪造引用',data.map(row=>row.documentId+':'+row.contentHash+':'+row.paragraph)));}
    catch(error) {res.status(400).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'检索失败'});}
  });
  router.post('/index', async(req,res) => {
    let key: string | null = null;
    try {
      const body=req.body || {};
      if (Object.keys(body).some(field=>!['instrument','accession'].includes(field))) throw new Error('只接受标的及可选申报编号，不接受任意 URL 或原文');
      const instrument=usFilingInstrument(String(body.instrument || ''));
      const accession=body.accession == null ? undefined:String(body.accession);
      if (accession && !/^\d{10}-\d{2}-\d{6}$/.test(accession)) throw new Error('申报编号无效');
      key=instrument;
      if (inFlight.size >= 1) {res.status(409).json({success:false,dataStatus:'partial',reason:'已有索引任务在运行，请稍后重试'});key=null;return;}
      inFlight.add(key);
      const loaded=await (deps.load || loadOfficialFilingText)(instrument,accession);
      if (loaded.instrument !== instrument || (accession && loaded.accession !== accession)) throw new Error('来源申报身份与所选标的不一致');
      const data=deps.index().index(loaded);
      res.status(201).json(envelope(instrument,data,'historical',null,[data.id]));
    } catch(error) {res.status(400).json({success:false,dataStatus:'unavailable',reason:error instanceof Error?error.message:'SEC 原文不可用'});}
    finally {if(key)inFlight.delete(key);}
  });
  return router;
}
