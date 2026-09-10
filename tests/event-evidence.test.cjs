const test = require('node:test');
const assert = require('node:assert');

test('event evidence', () => {
    const { buildEventEvidence } = require('../dist/features/event-evidence');
    const evidence = buildEventEvidence({ scope: 'stocks', instrumentId: 'stock:us:AAPL', actual: '105', forecast: '100', previous: '98', source: 'official', url: 'https://example.invalid' });
    assert.equal(evidence.direction, 'bullish');
    assert.equal(evidence.scope, 'stocks');
});
