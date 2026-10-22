const ts = require('typescript');

// Build-time declaration ownership only. State, initialization and public names
// stay in the original classic-script scope. Unknown consumers remain in core.
function inferWorkspaceHelpers(code, knownGroups, externalTexts = []) {
  const ast = ts.createSourceFile('workspace.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) return new Map();
  const functions = new Map(), duplicates = new Set();
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name) continue;
    if (functions.has(node.name.text)) duplicates.add(node.name.text);
    functions.set(node.name.text, node);
  }
  const labels = new Map([...functions.keys()].map(name => [name, new Set(knownGroups.has(name) ? [knownGroups.get(name)] : [])]));
  // Preserve last-declaration-wins semantics and every duplicate body's deps.
  for (const name of duplicates) labels.get(name).add('core');
  const edges = new Map([...functions.keys()].map(name => [name, new Set()]));
  let unsafe = false;
  const pin = name => { if (functions.has(name) && !knownGroups.has(name)) labels.get(name).add('core'); };
  const pinText = text => { for (const token of text.match(/[A-Za-z_$][\w$]*/g) || []) pin(token); };
  function visit(node, owner) {
    if (!node) return;
    const global = expression => expression.kind === ts.SyntaxKind.ThisKeyword || ts.isIdentifier(expression) && ['window','globalThis','self'].includes(expression.text);
    if (ts.isElementAccessExpression(node) && global(node.expression) && !ts.isStringLiteralLike(node.argumentExpression)) unsafe = true;
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && (ts.isIdentifier(node.expression) && ['eval','Function'].includes(node.expression.text)
      || ts.isPropertyAccessExpression(node.expression) && global(node.expression.expression) && ['eval','Function'].includes(node.expression.name.text))) unsafe = true;
    if (ts.isIdentifier(node) && functions.has(node.text)) {
      if (owner) edges.get(owner).add(node.text); else pin(node.text);
    }
    if (ts.isStringLiteralLike(node)) pinText(node.text);
    ts.forEachChild(node, child => visit(child, owner));
  }
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name) { for (const parameter of node.parameters) visit(parameter,node.name.text); visit(node.body, node.name.text); }
    else visit(node, null);
  }
  if (unsafe) return new Map();
  for (const text of externalTexts) pinText(text);
  function propagate() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [owner, references] of edges) for (const name of references) {
      // Existing lazy entries are already a loading boundary; a core caller
      // does not make their private synchronous descendants initial code.
        if (knownGroups.has(name)) continue;
        for (const label of labels.get(owner)) if (!labels.get(name).has(label)) {
          labels.get(name).add(label); changed = true;
        }
      }
    }
  }
  propagate();
  // An otherwise unreferenced legacy public function is retained, not deleted;
  // preserve synchronous calls made from it even if no current handler names it.
  for (const owners of labels.values()) if (!owners.size) owners.add('core');
  propagate();
  const result = new Map();
  for (const [name, owners] of labels) if (!knownGroups.has(name) && owners.size === 1 && !owners.has('core')) result.set(name, [...owners][0]);
  return result;
}

module.exports = { inferWorkspaceHelpers };
