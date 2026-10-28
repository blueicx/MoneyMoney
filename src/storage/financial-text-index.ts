import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SUPPORTED_FORMS = ['10-K', '10-Q', '10-K/A', '10-Q/A'] as const;
const SECTION_PARSER_VERSION = 'sec-sections-v1';
const MAX_CITATIONS_PER_COMPARISON_SECTION = 500;

export interface FilingTextInput {
  instrument: string;
  accession: string;
  form: string;
  sourceUrl: string;
  publishedAt: string;
  retrievedAt: string;
  text: string;
  publicationPrecision?: string;
}

export interface FilingTextDocument {
  id: string;
  instrument: string;
  accession: string;
  form: string;
  sourceUrl: string;
  publishedAt: string;
  retrievedAt: string;
  contentHash: string;
  paragraphs: number;
  publicationPrecision: string;
}

export interface FilingTextSection {
  documentId: string;
  instrument: string;
  accession: string;
  sectionKey: string;
  heading: string;
  ordinal: number;
  startParagraph: number;
  endParagraph: number;
  paragraphCount: number;
  contentHash: string;
  citation: string;
  citationHash: string;
}

export interface FilingTextParagraph {
  paragraph: number;
  text: string;
  paragraphHash: string;
  citation: string;
  citationHash: string;
}

export interface FilingDiffChange {
  kind: 'added' | 'removed' | 'changed';
  baseParagraph: number | null;
  currentParagraph: number | null;
  baseText: string | null;
  currentText: string | null;
  baseHash: string | null;
  currentHash: string | null;
  baseCitation: string | null;
  currentCitation: string | null;
}

export interface FilingTextComparisonSection {
  sectionKey: string;
  heading: string;
  status: 'aligned' | 'base-only' | 'current-only' | 'unchanged' | 'incomparable';
  reason: string | null;
  alignmentEvidence: string[];
  base: FilingTextSection | null;
  current: FilingTextSection | null;
  changes: FilingDiffChange[];
  changedParagraphs: number;
  truncated: boolean;
}

export interface FilingTextComparison {
  status: 'comparable' | 'incomparable';
  instrument: string;
  baseDocument: FilingTextDocument;
  currentDocument: FilingTextDocument;
  accountingScope: string;
  reasons: string[];
  summary: {
    alignedSections: number;
    changedSections: number;
    unchangedSections: number;
    baseOnlySections: number;
    currentOnlySections: number;
    incomparableSections: number;
  };
  sections: FilingTextComparisonSection[];
  evidenceRefs: string[];
  contentHash: string;
}

export interface FilingAnnotation {
  id: string;
  documentId: string;
  contentHash: string;
  sectionKey: string;
  startParagraph: number;
  endParagraph: number;
  body: string;
  author: string;
  revision: number;
  idempotencyKey: string;
  createdAt: string;
  citation: string;
  citationHash: string;
}

export interface FilingAnnotationInput {
  documentId: string;
  sectionKey: string;
  startParagraph: number;
  endParagraph: number;
  body: string;
  author: string;
  expectedVersion: number;
  idempotencyKey: string;
  createdAt?: string;
}

interface FilingParagraphRow {
  paragraph: number;
  text: string;
}

interface SectionCandidate {
  sectionKey: string;
  heading: string;
  startParagraph: number;
  endParagraph: number;
  score: number;
  evidenceText: string;
}

interface ParsedSection {
  sectionKey: string;
  heading: string;
  startParagraph: number;
  endParagraph: number;
  paragraphs: FilingParagraphRow[];
  contentHash: string;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedParagraph(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function citationFor(document: FilingTextDocument, sectionKey: string, paragraph: number | null): string {
  return `${document.id}:${document.contentHash}:${sectionKey}:p${paragraph == null ? '*' : paragraph}`;
}

function sectionCitationFor(document: FilingTextDocument, section: FilingTextSection | ParsedSection): string {
  return citationFor(document, section.sectionKey, null);
}

function sectionCitationHash(citation: string): string {
  return sha256(citation);
}

function safeControlText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new Error(`${label}为空、包含控制字符或超过长度预算`);
  }
  return text;
}

export function usFilingInstrument(value: string): string {
  if (!/^stock:us:[A-Z][A-Z0-9.-]{0,14}$/.test(value)) {
    throw new Error('原文检索只支持已核验的美国股票身份 stock:us:SYMBOL');
  }
  return value;
}

function timestamp(value: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error('申报时间无效');
  return new Date(value).toISOString();
}

function optionalDocumentId(value: string): string {
  if (!/^filing-text-[a-f0-9]{32}$/.test(value)) throw new Error('财报文档身份无效');
  return value;
}

function accessionUrlMatches(input: FilingTextInput): boolean {
  const url = new URL(input.sourceUrl);
  const parts = url.pathname.match(/^\/Archives\/edgar\/data\/\d{1,10}\/(\d{18})\/([\w.-]{1,128}\.html?)$/i);
  return url.protocol === 'https:'
    && url.hostname === 'www.sec.gov'
    && !url.port
    && !url.username
    && !url.password
    && !url.search
    && !url.hash
    && Boolean(parts)
    && parts![1] === input.accession.replace(/-/g, '');
}

/** Plain text only: no fetched HTML, scripts, inline XBRL headers or styles reach the browser. */
export function filingHtmlText(html: string): string {
  if (Buffer.byteLength(html, 'utf8') > 4 * 1024 * 1024) throw new Error('文件超过 4MB 索引预算');
  return html.replace(/<(script|style|ix:header|ix:hidden)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<\/(p|div|tr|h[1-6])\s*>|<br\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
    })
    .replace(/&(amp|nbsp|lt|gt|quot|apos);/gi, (_, name: string) => ({
      amp: '&',
      nbsp: ' ',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    }[name.toLowerCase()] || ' '))
    .split(/\n\s*\n/)
    .map(line => normalizedParagraph(line))
    .filter(Boolean)
    .join('\n\n');
}

function titleSlug(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.split('-').filter(Boolean).slice(0, 7).join('-') || 'untitled';
}

function canonicalSectionTitle(item: string, rawTitle: string): string {
  const title = normalizedParagraph(rawTitle)
    .replace(/(?:[.·•…]\s*){2,}\d+\s*$/g, '')
    .replace(/\s+\d{1,4}\s*$/g, '')
    .replace(/[.:;,\s]+$/g, '');
  const upper = title.toUpperCase();
  if (item === '1A' || upper.includes('RISK FACTORS')) return 'Risk Factors';
  if (item === '1' && upper.includes('FINANCIAL STATEMENTS')) return 'Financial Statements';
  if (item === '2' && upper.includes('MANAGEMENT') && upper.includes('DISCUSSION')) {
    return "Management's Discussion and Analysis";
  }
  if (item === '1' && upper.includes('BUSINESS')) return 'Business';
  if (upper.includes('QUANTITATIVE') && upper.includes('QUALITATIVE')) {
    return 'Quantitative and Qualitative Disclosures';
  }
  if (upper.includes('CONTROLS') && upper.includes('PROCEDURES')) return 'Controls and Procedures';
  if (item === '2' && upper.includes('PROPERTIES')) return 'Properties';
  if (item === '3' && upper.includes('LEGAL PROCEEDINGS')) return 'Legal Proceedings';
  if (item === '1C' && upper.includes('CYBERSECURITY')) return 'Cybersecurity';
  if (upper === 'SIGNATURES') return 'Signatures';
  if (upper === 'EXHIBITS' || upper === 'EXHIBIT INDEX') return 'Exhibits';
  return title;
}

function sectionHeading(paragraph: string): { heading: string; sectionKey: string } | null {
  const value = normalizedParagraph(paragraph);
  if (value.length < 5 || value.length > 180) return null;
  const item = value.match(/^ITEM\s+(\d{1,2}[A-Z]?)(?:\s*[.\-—:]?\s*)(.*)$/i);
  if (item) {
    const number = item[1].toUpperCase();
    const title = canonicalSectionTitle(number, item[2]);
    if (!title) return null;
    return {
      heading: `Item ${number}. ${title}`,
      sectionKey: `item-${number.toLowerCase()}-${titleSlug(title)}`,
    };
  }
  const upper = value.toUpperCase().replace(/[.:;,\s]+$/g, '');
  if (upper === 'SIGNATURES' || upper === 'EXHIBIT INDEX') {
    return { heading: upper, sectionKey: `document-${titleSlug(upper)}` };
  }
  return null;
}

function sectionizedRows(paragraphs: FilingParagraphRow[], form: string): ParsedSection[] {
  const candidates = paragraphs.flatMap((row, index) => {
    const heading = sectionHeading(row.text);
    if (!heading) return [];
    return [{
      ...heading,
      startParagraph: row.paragraph,
      endParagraph: row.paragraph,
      score: 0,
      evidenceText: '',
      index,
    }];
  });
  const selected = new Map<string, typeof candidates[number] & { evidenceParagraphs?: number }>();
  candidates.forEach((candidate, index) => {
    const next = candidates[index + 1];
    const endIndex = next ? next.index : paragraphs.length;
    const body = paragraphs.slice(candidate.index + 1, endIndex);
    const bodyText = body.map(row => row.text).join('\n');
    const inlineContentLength = Math.max(0, normalizedParagraph(paragraphs[candidate.index].text).length - candidate.heading.length);
    const scored = {
      ...candidate,
      endIndex,
      endParagraph: body.at(-1)?.paragraph || candidate.startParagraph,
      evidenceParagraphs: body.length,
      score: bodyText.length + body.length * 40 + inlineContentLength,
      evidenceText: bodyText,
    };
    const previous = selected.get(candidate.sectionKey);
    if (!previous || scored.score > previous.score) selected.set(candidate.sectionKey, scored);
  });
  const picked = [...selected.values()]
    .filter(candidate => candidate.evidenceParagraphs! > 0 || candidate.score > 0)
    .sort((a, b) => a.index - b.index);
  const sections: ParsedSection[] = [];
  if (picked.length && paragraphs[0].paragraph < picked[0].startParagraph) {
    const body = paragraphs.filter(row => row.paragraph < picked[0].startParagraph);
    if (body.length) {
      sections.push({
        sectionKey: 'document-preface',
        heading: 'Document preface',
        startParagraph: body[0].paragraph,
        endParagraph: body.at(-1)!.paragraph,
        paragraphs: body,
        contentHash: sha256(body.map(row => normalizedParagraph(row.text)).join('\n')),
      });
    }
  }
  for (const candidate of picked) {
    const body = paragraphs.filter(row => row.paragraph >= candidate.startParagraph && row.paragraph <= candidate.endParagraph);
    sections.push({
      sectionKey: candidate.sectionKey,
      heading: candidate.heading,
      startParagraph: candidate.startParagraph,
      endParagraph: candidate.endParagraph,
      paragraphs: body,
      contentHash: sha256(body.map(row => normalizedParagraph(row.text)).join('\n')),
    });
  }
  if (!sections.length) {
    const first = paragraphs[0]?.paragraph || 1;
    const last = paragraphs.at(-1)?.paragraph || first;
    sections.push({
      sectionKey: 'document-body',
      heading: `${form} document body`,
      startParagraph: first,
      endParagraph: last,
      paragraphs,
      contentHash: sha256(paragraphs.map(row => normalizedParagraph(row.text)).join('\n')),
    });
  }
  return sections;
}

function paragraphDiff(
  baseDocument: FilingTextDocument,
  currentDocument: FilingTextDocument,
  sectionKey: string,
  base: FilingParagraphRow[],
  current: FilingParagraphRow[],
): { changes: FilingDiffChange[]; changedParagraphs: number; truncated: boolean } {
  const baseNormalized = base.map(row => normalizedParagraph(row.text));
  const currentNormalized = current.map(row => normalizedParagraph(row.text));
  const ops: Array<{ kind: '=' | '-' | '+'; side: 'base' | 'current'; index: number }> = [];
  const cellCount = (base.length + 1) * (current.length + 1);
  if (cellCount <= 2_500_000) {
    const columns = current.length + 1;
    const table = new Uint16Array(cellCount);
    for (let i = base.length - 1; i >= 0; i -= 1) {
      for (let j = current.length - 1; j >= 0; j -= 1) {
        table[i * columns + j] = baseNormalized[i] === currentNormalized[j]
          ? table[(i + 1) * columns + j + 1] + 1
          : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < base.length && j < current.length) {
      if (baseNormalized[i] === currentNormalized[j]) {
        ops.push({ kind: '=', side: 'base', index: i });
        i += 1;
        j += 1;
      } else if (table[(i + 1) * columns + j] >= table[i * columns + j + 1]) {
        ops.push({ kind: '-', side: 'base', index: i });
        i += 1;
      } else {
        ops.push({ kind: '+', side: 'current', index: j });
        j += 1;
      }
    }
    while (i < base.length) ops.push({ kind: '-', side: 'base', index: i++ });
    while (j < current.length) ops.push({ kind: '+', side: 'current', index: j++ });
  } else {
    let prefix = 0;
    while (prefix < base.length && prefix < current.length && baseNormalized[prefix] === currentNormalized[prefix]) {
      ops.push({ kind: '=', side: 'base', index: prefix++ });
    }
    const baseTail: number[] = [];
    const currentTail: number[] = [];
    let baseEnd = base.length - 1;
    let currentEnd = current.length - 1;
    while (baseEnd >= prefix && currentEnd >= prefix && baseNormalized[baseEnd] === currentNormalized[currentEnd]) {
      baseTail.unshift(baseEnd--);
      currentTail.unshift(currentEnd--);
    }
    for (let index = prefix; index <= baseEnd; index += 1) ops.push({ kind: '-', side: 'base', index });
    for (let index = prefix; index <= currentEnd; index += 1) ops.push({ kind: '+', side: 'current', index });
    baseTail.forEach(index => ops.push({ kind: '=', side: 'base', index }));
  }
  const changes: FilingDiffChange[] = [];
  for (let index = 0; index < ops.length;) {
    if (ops[index].kind === '=') {
      index += 1;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (index < ops.length && ops[index].kind !== '=') {
      const op = ops[index++];
      if (op.kind === '-') removed.push(op.index);
      else added.push(op.index);
    }
    const changedPairs = Math.min(removed.length, added.length);
    for (let pair = 0; pair < changedPairs; pair += 1) {
      const baseIndex = removed[pair];
      const currentIndex = added[pair];
      const baseRow = base[baseIndex];
      const currentRow = current[currentIndex];
      changes.push({
        kind: 'changed',
        baseParagraph: baseRow.paragraph,
        currentParagraph: currentRow.paragraph,
        baseText: baseRow.text,
        currentText: currentRow.text,
        baseHash: sha256(normalizedParagraph(baseRow.text)),
        currentHash: sha256(normalizedParagraph(currentRow.text)),
        baseCitation: citationFor(baseDocument, sectionKey, baseRow.paragraph),
        currentCitation: citationFor(currentDocument, sectionKey, currentRow.paragraph),
      });
    }
    for (let pair = changedPairs; pair < removed.length; pair += 1) {
      const baseRow = base[removed[pair]];
      changes.push({
        kind: 'removed',
        baseParagraph: baseRow.paragraph,
        currentParagraph: null,
        baseText: baseRow.text,
        currentText: null,
        baseHash: sha256(normalizedParagraph(baseRow.text)),
        currentHash: null,
        baseCitation: citationFor(baseDocument, sectionKey, baseRow.paragraph),
        currentCitation: null,
      });
    }
    for (let pair = changedPairs; pair < added.length; pair += 1) {
      const currentRow = current[added[pair]];
      changes.push({
        kind: 'added',
        baseParagraph: null,
        currentParagraph: currentRow.paragraph,
        baseText: null,
        currentText: currentRow.text,
        baseHash: null,
        currentHash: sha256(normalizedParagraph(currentRow.text)),
        baseCitation: null,
        currentCitation: citationFor(currentDocument, sectionKey, currentRow.paragraph),
      });
    }
  }
  return {
    changes: changes.slice(0, MAX_CITATIONS_PER_COMPARISON_SECTION),
    changedParagraphs: changes.length,
    truncated: changes.length > MAX_CITATIONS_PER_COMPARISON_SECTION,
  };
}

function formFamily(form: string): '10-K' | '10-Q' | null {
  if (form === '10-K' || form === '10-K/A') return '10-K';
  if (form === '10-Q' || form === '10-Q/A') return '10-Q';
  return null;
}

function accountingScope(form: string): string {
  const family = formFamily(form);
  if (family === '10-K') return 'annual-financial-statements';
  if (family === '10-Q') return 'quarterly-financial-statements';
  return 'unknown';
}

export class FinancialTextIndex {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS financial_text_documents (
        id TEXT PRIMARY KEY,
        instrument TEXT NOT NULL,
        accession TEXT NOT NULL,
        form TEXT NOT NULL,
        source_url TEXT NOT NULL,
        published_at TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        paragraphs INTEGER NOT NULL,
        publication_precision TEXT NOT NULL,
        UNIQUE(instrument, accession)
      );
      CREATE INDEX IF NOT EXISTS financial_text_scope ON financial_text_documents(instrument, published_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS financial_text_chunks USING fts5(document_id UNINDEXED, paragraph UNINDEXED, text);
      CREATE TABLE IF NOT EXISTS financial_text_sections (
        document_id TEXT NOT NULL,
        section_key TEXT NOT NULL,
        heading TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        start_paragraph INTEGER NOT NULL,
        end_paragraph INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        PRIMARY KEY(document_id, section_key)
      );
      CREATE INDEX IF NOT EXISTS financial_text_section_order
        ON financial_text_sections(document_id, ordinal);
      CREATE TABLE IF NOT EXISTS financial_text_annotations (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        section_key TEXT NOT NULL,
        start_paragraph INTEGER NOT NULL,
        end_paragraph INTEGER NOT NULL,
        body TEXT NOT NULL,
        author TEXT NOT NULL,
        revision INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        citation TEXT NOT NULL,
        citation_hash TEXT NOT NULL,
        UNIQUE(document_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS financial_text_annotation_version
        ON financial_text_annotations(document_id, revision);
    `);
  }

  close(): void {
    this.db.close();
  }

  index(input: FilingTextInput): FilingTextDocument {
    const instrument = usFilingInstrument(input.instrument);
    if (!/^\d{10}-\d{2}-\d{6}$/.test(input.accession) || !SUPPORTED_FORMS.includes(input.form as typeof SUPPORTED_FORMS[number])) {
      throw new Error('仅支持有效 SEC 10-K/10-Q 申报');
    }
    if (!accessionUrlMatches(input)) throw new Error('SEC 原文地址或申报身份不一致');
    const publishedAt = timestamp(input.publishedAt);
    const retrievedAt = timestamp(input.retrievedAt);
    if (publishedAt > retrievedAt || Date.parse(retrievedAt) > Date.now() + 60_000) {
      throw new Error('发布时间或抓取时间无法核验');
    }
    const text = input.text.trim();
    if (text.length < 20 || Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('原文为空或超过 2MB 文本预算');
    const paragraphs = text
      .split(/\n\s*\n/)
      .flatMap(paragraph => paragraph.match(/[\s\S]{1,2000}/g) || [])
      .map(normalizedParagraph)
      .filter(Boolean)
      .map((paragraph, index) => ({ paragraph: index + 1, text: paragraph }));
    if (paragraphs.length > 1500) throw new Error('文件段落超过索引预算');
    const contentHash = sha256(text);
    const id = 'filing-text-' + sha256(instrument + '|' + input.accession).slice(0, 32);
    const record: FilingTextDocument = {
      id,
      instrument,
      accession: input.accession,
      form: input.form,
      sourceUrl: input.sourceUrl,
      publishedAt,
      retrievedAt,
      contentHash,
      paragraphs: paragraphs.length,
      publicationPrecision: input.publicationPrecision || 'verified-acceptance-time',
    };
    return this.db.transaction(() => {
      const old = this.document(id);
      if (old) {
        if (old.contentHash !== contentHash || old.sourceUrl !== input.sourceUrl || old.publishedAt !== publishedAt) {
          throw new Error('同一申报内容发生变化：请保留修订证据，不覆盖已索引文件');
        }
        this.ensureSections(old);
        return old;
      }
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM financial_text_documents').get() as { n: number };
      if (count.n >= 500) throw new Error('本地财报索引已达 500 份预算，请先归档再索引');
      this.db.prepare(`INSERT INTO financial_text_documents
        (id,instrument,accession,form,source_url,published_at,retrieved_at,content_hash,paragraphs,publication_precision)
        VALUES (@id,@instrument,@accession,@form,@sourceUrl,@publishedAt,@retrievedAt,@contentHash,@paragraphs,@publicationPrecision)`)
        .run(record);
      const insert = this.db.prepare('INSERT INTO financial_text_chunks(document_id,paragraph,text) VALUES (?,?,?)');
      paragraphs.forEach(paragraph => insert.run(id, paragraph.paragraph, paragraph.text));
      this.writeSections(record, paragraphs);
      return record;
    })();
  }

  document(id: string): FilingTextDocument | null {
    optionalDocumentId(id);
    return (this.db.prepare(`SELECT id,instrument,accession,form,source_url AS sourceUrl,
      published_at AS publishedAt,retrieved_at AS retrievedAt,content_hash AS contentHash,
      paragraphs,publication_precision AS publicationPrecision
      FROM financial_text_documents WHERE id=?`).get(id) as FilingTextDocument | undefined) || null;
  }

  list(instrument: string, asOf = new Date().toISOString()): FilingTextDocument[] {
    usFilingInstrument(instrument);
    return this.db.prepare(`SELECT id,instrument,accession,form,source_url AS sourceUrl,
      published_at AS publishedAt,retrieved_at AS retrievedAt,content_hash AS contentHash,
      paragraphs,publication_precision AS publicationPrecision
      FROM financial_text_documents WHERE instrument=? AND published_at<=?
      ORDER BY published_at DESC,id LIMIT 100`).all(instrument, timestamp(asOf)) as FilingTextDocument[];
  }

  sections(documentId: string): FilingTextSection[] {
    const document = this.document(documentId);
    if (!document) throw new Error('未找到已索引财报');
    this.ensureSections(document);
    const rows = this.db.prepare(`SELECT document_id AS documentId,section_key AS sectionKey,
      heading,ordinal,start_paragraph AS startParagraph,end_paragraph AS endParagraph,
      content_hash AS contentHash
      FROM financial_text_sections WHERE document_id=? ORDER BY ordinal`)
      .all(document.id) as Array<Omit<FilingTextSection,
      'instrument' | 'accession' | 'paragraphCount' | 'citation' | 'citationHash'>>;
    return rows.map(row => ({
      ...row,
      instrument: document.instrument,
      accession: document.accession,
      paragraphCount: row.endParagraph - row.startParagraph + 1,
      citation: citationFor(document, row.sectionKey, null),
      citationHash: sectionCitationHash(citationFor(document, row.sectionKey, null)),
    }));
  }

  search(input: { instrument: string; query: string; asOf?: string; limit?: number }) {
    const instrument = usFilingInstrument(input.instrument);
    const asOf = timestamp(input.asOf || new Date().toISOString());
    if (Date.parse(asOf) > Date.now() + 60_000) throw new Error('检索时点不能在未来');
    if (typeof input.query !== 'string' || input.query.length > 200) throw new Error('检索词最多 200 字符');
    const words = input.query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) || [];
    if (!words.length) throw new Error('请填写有效检索词');
    const limit = input.limit ?? 8;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('检索结果上限为 1–20');
    const rows = this.db.prepare(`SELECT d.id AS documentId,d.instrument,d.accession,d.form,
      d.source_url AS sourceUrl,d.published_at AS publishedAt,d.retrieved_at AS retrievedAt,
      d.content_hash AS contentHash,d.publication_precision AS publicationPrecision,
      CAST(financial_text_chunks.paragraph AS INTEGER) AS paragraph,
      financial_text_chunks.text,NULL AS page,bm25(financial_text_chunks) AS rank
      FROM financial_text_chunks JOIN financial_text_documents d ON d.id=financial_text_chunks.document_id
      WHERE financial_text_chunks MATCH ? AND d.instrument=? AND d.published_at<=?
      ORDER BY rank,d.id,paragraph LIMIT ?`)
      .all(words.map(word => '"' + word + '"').join(' AND '), instrument, asOf, limit) as Array<{
        documentId: string;
        instrument: string;
        accession: string;
        form: string;
        sourceUrl: string;
        publishedAt: string;
        retrievedAt: string;
        contentHash: string;
        publicationPrecision: string;
        paragraph: number;
        text: string;
        page: null;
        rank: number;
      }>;
    const documents = new Map<string, FilingTextDocument>();
    rows.forEach(row => {
      if (documents.has(row.documentId)) return;
      const document = this.document(row.documentId);
      if (document) {
        this.ensureSections(document);
        documents.set(document.id, document);
      }
    });
    return rows.map(row => {
      const document = documents.get(row.documentId)!;
      const section = this.sections(document.id).find(value =>
        row.paragraph >= value.startParagraph && row.paragraph <= value.endParagraph) || null;
      const citation = citationFor(document, section?.sectionKey || 'document-body', row.paragraph);
      return {
        ...row,
        sectionKey: section?.sectionKey || 'document-body',
        sectionHeading: section?.heading || `${row.form} document body`,
        citation,
        citationHash: sectionCitationHash(citation),
      };
    });
  }

  compare(baseId: string, currentId: string): FilingTextComparison {
    const baseDocument = this.document(baseId);
    const currentDocument = this.document(currentId);
    if (!baseDocument || !currentDocument) throw new Error('未找到用于对照的已索引财报');
    if (Date.parse(baseDocument.publishedAt) > Date.parse(currentDocument.publishedAt)) {
      throw new Error('基准文件必须早于对照文件');
    }
    const reasons: string[] = [];
    if (baseDocument.instrument !== currentDocument.instrument) reasons.push('申报主体或股票身份不一致');
    if (formFamily(baseDocument.form) !== formFamily(currentDocument.form)) {
      reasons.push(`表单口径不同：${baseDocument.form} 与 ${currentDocument.form} 不可直接对齐`);
    }
    if (!baseDocument.contentHash || !currentDocument.contentHash) reasons.push('原文内容 Hash 缺失');
    const baseSections = this.sections(baseDocument.id);
    const currentSections = this.sections(currentDocument.id);
    const sections: FilingTextComparisonSection[] = [];
    if (!reasons.length) {
      const baseByKey = new Map(baseSections.map(section => [section.sectionKey, section]));
      const currentByKey = new Map(currentSections.map(section => [section.sectionKey, section]));
      const keys = [...new Set([...baseByKey.keys(), ...currentByKey.keys()])].sort();
      for (const key of keys) {
        const base = baseByKey.get(key) || null;
        const current = currentByKey.get(key) || null;
        const heading = current?.heading || base?.heading || key;
        if (base && current && base.contentHash === current.contentHash) {
          sections.push({
            sectionKey: key,
            heading,
            status: 'unchanged',
            reason: null,
            alignmentEvidence: ['same-instrument', 'same-form-family', 'stable-section-key', 'equal-section-hash'],
            base,
            current,
            changes: [],
            changedParagraphs: 0,
            truncated: false,
          });
          continue;
        }
        if (base && current) {
          const baseRows = this.paragraphRows(baseDocument.id, base.startParagraph, base.endParagraph);
          const currentRows = this.paragraphRows(currentDocument.id, current.startParagraph, current.endParagraph);
          const diff = paragraphDiff(baseDocument, currentDocument, key, baseRows, currentRows);
          sections.push({
            sectionKey: key,
            heading,
            status: diff.changes.length ? 'aligned' : 'unchanged',
            reason: diff.truncated ? '段落差异达到单节展示上限，原始文件仍保留完整证据' : null,
            alignmentEvidence: ['same-instrument', 'same-form-family', 'stable-section-key'],
            base,
            current,
            changes: diff.changes,
            changedParagraphs: diff.changedParagraphs,
            truncated: diff.truncated,
          });
          continue;
        }
        const existing = base || current!;
        const rows = this.paragraphRows(existing.documentId, existing.startParagraph, existing.endParagraph);
        sections.push({
          sectionKey: key,
          heading,
          status: base ? 'base-only' : 'current-only',
          reason: base ? '对照文件缺少同一稳定章节，不能推断删除或保留' : '基准文件缺少同一稳定章节，不能推断新增或修订',
          alignmentEvidence: ['same-instrument', 'same-form-family', 'stable-section-key'],
          base,
          current,
          changes: rows.slice(0, MAX_CITATIONS_PER_COMPARISON_SECTION).map(row => ({
            kind: base ? 'removed' : 'added',
            baseParagraph: base ? row.paragraph : null,
            currentParagraph: current ? row.paragraph : null,
            baseText: base ? row.text : null,
            currentText: current ? row.text : null,
            baseHash: base ? sha256(normalizedParagraph(row.text)) : null,
            currentHash: current ? sha256(normalizedParagraph(row.text)) : null,
            baseCitation: base ? citationFor(baseDocument, key, row.paragraph) : null,
            currentCitation: current ? citationFor(currentDocument, key, row.paragraph) : null,
          })),
          changedParagraphs: rows.length,
          truncated: rows.length > MAX_CITATIONS_PER_COMPARISON_SECTION,
        });
      }
    }
    const status = reasons.length ? 'incomparable' : 'comparable';
    const value = {
      status,
      instrument: baseDocument.instrument === currentDocument.instrument ? baseDocument.instrument : 'unknown',
      baseDocument,
      currentDocument,
      accountingScope: accountingScope(baseDocument.form),
      reasons,
      summary: {
        alignedSections: sections.filter(section => section.status === 'aligned').length,
        changedSections: sections.filter(section => section.status === 'aligned' || section.status === 'base-only' || section.status === 'current-only').length,
        unchangedSections: sections.filter(section => section.status === 'unchanged').length,
        baseOnlySections: sections.filter(section => section.status === 'base-only').length,
        currentOnlySections: sections.filter(section => section.status === 'current-only').length,
        incomparableSections: reasons.length ? 1 : 0,
      },
      sections,
      evidenceRefs: [
        citationFor(baseDocument, 'document', null),
        citationFor(currentDocument, 'document', null),
      ],
    } as Omit<FilingTextComparison, 'contentHash'>;
    return { ...value, contentHash: sha256(JSON.stringify(value)) };
  }

  annotations(documentId: string): FilingAnnotation[] {
    const document = this.document(documentId);
    if (!document) throw new Error('未找到已索引财报');
    return this.db.prepare(`SELECT id,document_id AS documentId,content_hash AS contentHash,
      section_key AS sectionKey,start_paragraph AS startParagraph,end_paragraph AS endParagraph,
      body,author,revision,idempotency_key AS idempotencyKey,created_at AS createdAt,
      citation,citation_hash AS citationHash
      FROM financial_text_annotations WHERE document_id=? ORDER BY revision,id`)
      .all(document.id) as FilingAnnotation[];
  }

  annotate(input: FilingAnnotationInput): FilingAnnotation {
    const document = this.document(input.documentId);
    if (!document) throw new Error('未找到已索引财报');
    const idempotencyKey = String(input.idempotencyKey || '').trim();
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new Error('幂等键格式无效');
    const sectionKey = safeControlText(input.sectionKey, '章节', 160);
    const section = this.sections(document.id).find(value => value.sectionKey === sectionKey);
    if (!section) throw new Error('所选章节不存在于这份财报');
    const startParagraph = Number(input.startParagraph);
    const endParagraph = Number(input.endParagraph);
    if (!Number.isInteger(startParagraph) || !Number.isInteger(endParagraph)
      || startParagraph < section.startParagraph || endParagraph > section.endParagraph
      || startParagraph > endParagraph) {
      throw new Error('批注段落范围不在所选章节内');
    }
    const body = safeControlText(input.body, '批注', 4000);
    const author = safeControlText(input.author, '批注者', 120);
    const expectedVersion = Number(input.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('批注版本无效');
    const createdAt = timestamp(input.createdAt || new Date().toISOString());
    if (Date.parse(createdAt) > Date.now() + 60_000) throw new Error('批注时间不能在未来');
    const citation = citationFor(document, sectionKey, startParagraph)
      .replace(`p${startParagraph}`, startParagraph === endParagraph ? `p${startParagraph}` : `p${startParagraph}-${endParagraph}`);
    const id = 'filing-annotation-' + sha256(document.id + '|' + idempotencyKey).slice(0, 32);
    const previous = this.db.prepare(`SELECT id,document_id AS documentId,content_hash AS contentHash,
      section_key AS sectionKey,start_paragraph AS startParagraph,end_paragraph AS endParagraph,
      body,author,revision,idempotency_key AS idempotencyKey,created_at AS createdAt,
      citation,citation_hash AS citationHash
      FROM financial_text_annotations WHERE document_id=? AND idempotency_key=?`)
      .get(document.id, idempotencyKey) as FilingAnnotation | undefined;
    if (previous) {
      if (previous.sectionKey !== sectionKey || previous.startParagraph !== startParagraph
        || previous.endParagraph !== endParagraph || previous.body !== body
        || previous.author !== author) {
        throw new Error('幂等键已用于不同批注内容');
      }
      return previous;
    }
    const latest = this.db.prepare('SELECT MAX(revision) AS revision FROM financial_text_annotations WHERE document_id=?')
      .get(document.id) as { revision: number | null };
    const actualVersion = latest.revision || 0;
    if (actualVersion !== expectedVersion) {
      throw new Error(`批注版本冲突：期望 ${expectedVersion}，当前 ${actualVersion}`);
    }
    const annotation: FilingAnnotation = {
      id,
      documentId: document.id,
      contentHash: document.contentHash,
      sectionKey,
      startParagraph,
      endParagraph,
      body,
      author,
      revision: actualVersion + 1,
      idempotencyKey,
      createdAt,
      citation,
      citationHash: sectionCitationHash(citation),
    };
    this.db.prepare(`INSERT INTO financial_text_annotations
      (id,document_id,content_hash,section_key,start_paragraph,end_paragraph,body,author,
       revision,idempotency_key,created_at,citation,citation_hash)
      VALUES (@id,@documentId,@contentHash,@sectionKey,@startParagraph,@endParagraph,@body,@author,
       @revision,@idempotencyKey,@createdAt,@citation,@citationHash)`)
      .run(annotation);
    return annotation;
  }

  private paragraphRows(documentId: string, start: number, end: number): FilingParagraphRow[] {
    return this.db.prepare('SELECT CAST(paragraph AS INTEGER) AS paragraph,text FROM financial_text_chunks WHERE document_id=? AND paragraph>=? AND paragraph<=? ORDER BY paragraph')
      .all(documentId, start, end) as FilingParagraphRow[];
  }

  private ensureSections(document: FilingTextDocument): void {
    const existing = this.db.prepare('SELECT COUNT(*) AS n FROM financial_text_sections WHERE document_id=? AND parser_version=?')
      .get(document.id, SECTION_PARSER_VERSION) as { n: number };
    if (existing.n) return;
    const rows = this.db.prepare('SELECT CAST(paragraph AS INTEGER) AS paragraph,text FROM financial_text_chunks WHERE document_id=? ORDER BY paragraph')
      .all(document.id) as FilingParagraphRow[];
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM financial_text_sections WHERE document_id=?').run(document.id);
      this.writeSections(document, rows);
    })();
  }

  private writeSections(document: FilingTextDocument, paragraphs: FilingParagraphRow[]): void {
    const sections = sectionizedRows(paragraphs, document.form);
    const insert = this.db.prepare(`INSERT INTO financial_text_sections
      (document_id,section_key,heading,ordinal,start_paragraph,end_paragraph,content_hash,parser_version)
      VALUES (?,?,?,?,?,?,?,?)`);
    sections.forEach((section, index) => insert.run(
      document.id,
      section.sectionKey,
      section.heading,
      index,
      section.startParagraph,
      section.endParagraph,
      section.contentHash,
      SECTION_PARSER_VERSION,
    ));
  }
}
