#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'web', 'public');
const target = path.join(root, 'dist', 'web', 'public');

if (!fs.existsSync(source)) {
  console.error(`Missing web asset source: ${source}`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

console.log('Web assets copied to dist');
