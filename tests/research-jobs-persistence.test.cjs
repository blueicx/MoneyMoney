const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('research jobs router does not use setTimeout', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/features/research-jobs-router.ts'), 'utf8');
  assert.doesNotMatch(source, /setTimeout\(/, 'Should not use setTimeout for job execution');
  assert.doesNotMatch(source, /\* 1\.02/, 'Should not use pseudo signal multiplier 1.02');
  assert.doesNotMatch(source, /UNKNOWN/, 'Should not use UNKNOWN for fake data');
  assert.doesNotMatch(source, /pseudo/, 'Should not use pseudo logic');
});

test('saveDataSnapshot and EvidenceBundle enforce integrity', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/features/research-repository.ts'), 'utf8');
  assert.match(source, /assertMarketContext\(/, 'Should call assertMarketContext');
  assert.match(source, /if \(\!snapshot\.id \|\| \!snapshot\.hash\) throw new Error\('Invalid DataSnapshot integrity'\)/, 'Should enforce DataSnapshot integrity');
  assert.match(source, /if \(\!bundle\.id \|\| \!Array\.isArray\(bundle\.artifacts\)\) throw new Error\('Invalid EvidenceBundle integrity'\)/, 'Should enforce EvidenceBundle integrity');
});

