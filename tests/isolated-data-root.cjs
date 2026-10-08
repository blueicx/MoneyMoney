const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-test-data-'));
process.env.MONEYMONEY_DATA_DIR = dataRoot;

module.exports = dataRoot;
