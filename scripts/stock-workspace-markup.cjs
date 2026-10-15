const { JSDOM } = require('jsdom');

// Build-time only: retain exact source bytes and handlers, not serialized DOM.
function deferStockChartMarkup(html) {
  const dom = new JSDOM(html, { includeNodeLocations: true });
  try {
    const sections = dom.window.document.querySelectorAll('#stocks-tab details[data-collapse-key="stocks-market"]');
    if (sections.length !== 1) throw new Error('Expected exactly one stocks-market section');
    const location = dom.nodeLocation(sections[0]);
    if (!location?.endOffset) throw new Error('Missing stocks-market source location');
    const content = html.slice(location.startOffset, location.endOffset);
    return html.slice(0, location.startOffset) + '<template id="stock-chart-template">' + content + '</template>' + html.slice(location.endOffset);
  } finally { dom.window.close(); }
}
module.exports = { deferStockChartMarkup };
