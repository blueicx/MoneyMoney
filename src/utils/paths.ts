// Shared writable-data path resolution.
// Works both in development (project root) and inside a packaged executable
// (resolves next to the .exe / current working directory).
import path from 'path';
import fs from 'fs';

declare global {
  namespace NodeJS {
    interface Process {
      pkg?: unknown;
    }
  }
}

// src/utils -> project root in development; package output stays beside the exe.
export const PROJECT_ROOT = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..', '..');
export const DATA_ROOT = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..', '..', 'data');

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
