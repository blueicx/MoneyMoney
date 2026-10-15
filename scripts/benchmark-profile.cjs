// Local isolated diagnostics only; never persist page contents, credentials or query strings.
function summarizeCpuProfile(profile) {
  const nodes = new Map((profile.nodes || []).map(row => [row.id, row]));
  const parents = new Map();
  for (const row of nodes.values()) for (const child of row.children || []) parents.set(child, row.id);
  const totals = new Map();
  const frame = id => {
    if (!totals.has(id)) {
      const call = nodes.get(id)?.callFrame || {};
      let path = '';
      try { path = new URL(call.url).pathname; } catch {}
      totals.set(id, { functionName: call.functionName || '(anonymous)', path, selfMs: 0, inclusiveMs: 0 });
    }
    return totals.get(id);
  };
  let sampledMs = 0;
  for (const [index, id] of (profile.samples || []).entries()) {
    const delta = Number(profile.timeDeltas?.[index]);
    if (!nodes.has(id) || !Number.isFinite(delta) || delta < 0) continue;
    const ms = delta / 1000;
    sampledMs += ms;
    frame(id).selfMs += ms;
    const seen = new Set();
    for (let cursor = id; cursor !== undefined && !seen.has(cursor); cursor = parents.get(cursor)) {
      seen.add(cursor);
      frame(cursor).inclusiveMs += ms;
    }
  }
  return { sampledMs, frames: [...totals.values()].sort((a, b) => b.inclusiveMs - a.inclusiveMs).slice(0, 35) };
}
function summarizeTimeline(events) {
  const allowed = new Set(['Layout', 'UpdateLayoutTree', 'ParseHTML', 'EvaluateScript', 'FunctionCall']);
  const origin = events.reduce((min, row) => Number.isFinite(row.ts) ? Math.min(min, row.ts) : min, Infinity);
  const rows = events.filter(row => allowed.has(row.name) && row.ph === 'X' && Number.isFinite(row.dur) && row.dur >= 0).map(row => ({
    name: row.name, durationMs: row.dur / 1000, atMs: (row.ts - origin) / 1000,
    dirtyObjects:row.args?.beginData?.dirtyObjects, totalObjects:row.args?.beginData?.totalObjects,
    stack: (row.args?.beginData?.stackTrace || row.args?.data?.stackTrace || []).slice(0, 5).map(frame => {
      let path = ''; try { path = new URL(frame.url).pathname; } catch {}
      return { functionName: frame.functionName || '(anonymous)', path, lineNumber: frame.lineNumber, columnNumber: frame.columnNumber };
    }),
  }));
  const totals = [...allowed].map(name => ({ name, durationMs: rows.filter(row => row.name === name).reduce((sum, row) => sum + row.durationMs, 0) }));
  return { totals, longest: rows.sort((a, b) => b.durationMs - a.durationMs).slice(0, 20) };
}
module.exports = { summarizeCpuProfile, summarizeTimeline };
