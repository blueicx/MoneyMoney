import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FilingTextInput {
  instrument: string; accession: string; form: string; sourceUrl: string;
  publishedAt: string; retrievedAt: string; text: string; publicationPrecision?: string;
}
export interface FilingTextDocument {
  id: string; instrument: string; accession: string; form: string; sourceUrl: string;
  publishedAt: string; retrievedAt: string; contentHash: string; paragraphs: number; publicationPrecision: string;
}
export function usFilingInstrument(value: string): string {
  if (!/^stock:us:[A-Z][A-Z0-9.-]{0,14}$/.test(value)) throw new Error('原文检索只支持已核验的美国股票身份 stock:us:SYMBOL');
  return value;
}
function timestamp(value: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error('申报时间无效');
  return new Date(value).toISOString();
}

/** Plain text only: no fetched HTML, scripts, inline XBRL headers or styles reach the browser. */
export function filingHtmlText(html: string): string {
  if (Buffer.byteLength(html, 'utf8') > 4 * 1024 * 1024) throw new Error('文件超过 4MB 索引预算');
  return html.replace(/<(script|style|ix:header|ix:hidden)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[^]*?-->/g, '').replace(/<\/(p|div|tr|h[1-6])\s*>|<br\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
    }).replace(/&(amp|nbsp|lt|gt|quot|apos);/gi, (_, name: string) => ({amp:'&',nbsp:' ',lt:'<',gt:'>',quot:'"',apos:"'"}[name.toLowerCase()] || ' '))
    .split(/\n\s*\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n');
}

export class FinancialTextIndex {
  private readonly db: Database.Database;
  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS financial_text_documents (
      id TEXT PRIMARY KEY, instrument TEXT NOT NULL, accession TEXT NOT NULL, form TEXT NOT NULL,
      source_url TEXT NOT NULL, published_at TEXT NOT NULL, retrieved_at TEXT NOT NULL,
      content_hash TEXT NOT NULL, paragraphs INTEGER NOT NULL, publication_precision TEXT NOT NULL,
      UNIQUE(instrument, accession));
      CREATE INDEX IF NOT EXISTS financial_text_scope ON financial_text_documents(instrument, published_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS financial_text_chunks USING fts5(document_id UNINDEXED, paragraph UNINDEXED, text);`);
  }
  close(): void { this.db.close(); }
  index(input: FilingTextInput): FilingTextDocument {
    const instrument = usFilingInstrument(input.instrument);
    if (!/^\d{10}-\d{2}-\d{6}$/.test(input.accession) || !['10-K','10-Q','10-K/A','10-Q/A'].includes(input.form)) throw new Error('仅支持有效 SEC 10-K/10-Q 申报');
    const url = new URL(input.sourceUrl);
    const parts = url.pathname.match(/^\/Archives\/edgar\/data\/\d{1,10}\/(\d{18})\/([\w.-]{1,128}\.html?)$/i);
    if (url.protocol !== 'https:' || url.hostname !== 'www.sec.gov' || url.port || url.username || url.password || url.search || url.hash || !parts || parts[1] !== input.accession.replace(/-/g, '')) throw new Error('SEC 原文地址或申报身份不一致');
    const publishedAt = timestamp(input.publishedAt), retrievedAt = timestamp(input.retrievedAt);
    if (publishedAt > retrievedAt || Date.parse(retrievedAt) > Date.now() + 60_000) throw new Error('发布时间或抓取时间无法核验');
    const text = input.text.trim();
    if (text.length < 20 || Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('原文为空或超过 2MB 文本预算');
    const paragraphs = text.split(/\n\s*\n/).flatMap(paragraph => paragraph.match(/[\s\S]{1,2000}/g) || []).filter(value => value.trim());
    if (paragraphs.length > 1500) throw new Error('文件段落超过索引预算');
    const contentHash = crypto.createHash('sha256').update(text).digest('hex');
    const id = 'filing-text-' + crypto.createHash('sha256').update(instrument + '|' + input.accession).digest('hex').slice(0, 32);
    const record = {id,instrument,accession:input.accession,form:input.form,sourceUrl:input.sourceUrl,publishedAt,retrievedAt,contentHash,paragraphs:paragraphs.length,publicationPrecision:input.publicationPrecision || 'verified-acceptance-time'};
    return this.db.transaction(() => {
      const old = this.db.prepare('SELECT id,instrument,accession,form,source_url AS sourceUrl,published_at AS publishedAt,retrieved_at AS retrievedAt,content_hash AS contentHash,paragraphs,publication_precision AS publicationPrecision FROM financial_text_documents WHERE id=?').get(id) as FilingTextDocument | undefined;
      if (old) {
        if (old.contentHash !== contentHash || old.sourceUrl !== input.sourceUrl || old.publishedAt !== publishedAt) throw new Error('同一申报内容发生变化：请保留修订证据，不覆盖已索引文件');
        return old;
      }
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM financial_text_documents').get() as {n:number};
      if (count.n >= 500) throw new Error('本地财报索引已达 500 份预算，请先归档再索引');
      this.db.prepare('INSERT INTO financial_text_documents VALUES (@id,@instrument,@accession,@form,@sourceUrl,@publishedAt,@retrievedAt,@contentHash,@paragraphs,@publicationPrecision)').run(record);
      const insert = this.db.prepare('INSERT INTO financial_text_chunks(document_id,paragraph,text) VALUES (?,?,?)');
      paragraphs.forEach((paragraph, i) => insert.run(id, i + 1, paragraph));
      return record;
    })();
  }
  list(instrument: string, asOf = new Date().toISOString()): FilingTextDocument[] {
    usFilingInstrument(instrument);
    return this.db.prepare(`SELECT id,instrument,accession,form,source_url AS sourceUrl,published_at AS publishedAt,retrieved_at AS retrievedAt,content_hash AS contentHash,paragraphs,publication_precision AS publicationPrecision
      FROM financial_text_documents WHERE instrument=? AND published_at<=? ORDER BY published_at DESC,id LIMIT 100`).all(instrument, timestamp(asOf)) as FilingTextDocument[];
  }
  search(input: {instrument: string; query: string; asOf?: string; limit?: number}) {
    const instrument = usFilingInstrument(input.instrument), asOf = timestamp(input.asOf || new Date().toISOString());
    if (Date.parse(asOf) > Date.now() + 60_000) throw new Error('检索时点不能在未来');
    if (typeof input.query !== 'string' || input.query.length > 200) throw new Error('检索词最多 200 字符');
    const words = input.query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) || [];
    if (!words.length) throw new Error('请填写有效检索词');
    const limit = input.limit ?? 8;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('检索结果上限为 1–20');
    return this.db.prepare(`SELECT d.id AS documentId,d.instrument,d.accession,d.form,d.source_url AS sourceUrl,d.published_at AS publishedAt,d.retrieved_at AS retrievedAt,d.content_hash AS contentHash,d.publication_precision AS publicationPrecision,
      CAST(financial_text_chunks.paragraph AS INTEGER) AS paragraph, financial_text_chunks.text, NULL AS page,bm25(financial_text_chunks) AS rank
      FROM financial_text_chunks JOIN financial_text_documents d ON d.id=financial_text_chunks.document_id
      WHERE financial_text_chunks MATCH ? AND d.instrument=? AND d.published_at<=? ORDER BY rank,d.id,paragraph LIMIT ?`)
      .all(words.map(word => '"' + word + '"').join(' AND '), instrument, asOf, limit) as Array<{documentId:string;instrument:string;accession:string;form:string;sourceUrl:string;publishedAt:string;retrievedAt:string;contentHash:string;publicationPrecision:string;paragraph:number;text:string;page:null;rank:number}>;
  }
}
