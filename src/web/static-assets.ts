import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';

function sendPrecompressed(req: Request, res: Response, file: string, cache: string): void {
  const encoding = req.acceptsEncodings('br', 'gzip', 'identity');
  if (!encoding) { res.status(406).end(); return; }
  const suffix = encoding === 'br' ? '.br' : encoding === 'gzip' ? '.gz' : '';
  const selected = suffix && fs.existsSync(file + suffix) ? file + suffix : file;
  res.setHeader('Cache-Control', cache);
  res.vary('Accept-Encoding');
  res.type(path.extname(file));
  if (selected !== file) res.setHeader('Content-Encoding', encoding);
  // Express sendFile supplies ETag/Last-Modified and handles conditional and
  // HEAD requests. Compression is built once, never on the request hot path.
  res.sendFile(path.basename(selected), { root: path.dirname(selected) });
}

export function sendBuiltPage(req: Request, res: Response, directory: string, page: 'index.html' | 'login.html'): void {
  sendPrecompressed(req, res, path.join(directory, page), 'no-cache');
}

export function registerBuiltAssets(app: Express, directory: string): void {
  app.get(/^\/assets\/[a-zA-Z0-9_-]+\.[a-f0-9]{16}\.(?:js|css)$/, (req, res, next) => {
    const file = path.join(directory, 'assets', path.basename(req.path));
    if (!fs.existsSync(file)) { next(); return; }
    sendPrecompressed(req, res, file, 'public, max-age=31536000, immutable');
  });
}
