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
    const status = '<div id="stock-chart-mount-status" class="workspace-empty" role="status" data-market-scopes="stocks" data-workspace-ids="stock-quotes radar"><span data-stock-chart-mount-message>正在加载图表工作区…</span> <button type="button" class="tab" onclick="mountStockChartWorkspace()">重试</button></div>';
    return html.slice(0, location.startOffset) + status + '<template id="stock-chart-template">' + content + '</template>' + html.slice(location.endOffset);
  } finally { dom.window.close(); }
}
module.exports = { deferStockChartMarkup };
