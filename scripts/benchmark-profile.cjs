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
module.exports = { summarizeCpuProfile };
