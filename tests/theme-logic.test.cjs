const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'index.html'), 'utf8');

function extractCode(html) {
  const match = html.match(/function updateThemeButtons[\s\S]*?function toggleTheme\(\) {[\s\S]*?\n}/);
  return match ? match[0] : '';
}

test('Theme CSS Variables exist', () => {
  assert.match(indexHtml, /\[data-theme="dark"\]\s*\{/);
  assert.match(indexHtml, /\[data-theme="money"\]\s*\{/);
});

test('Theme toggle logic: 3 states loop, old values, icon sync', () => {
  const code = extractCode(indexHtml);
  assert.ok(code, 'Theme functions not found');

  let toastCalled = false;
  
  const context = {
    localStorage: {
      data: {},
      getItem(k) { return this.data[k] || null; },
      setItem(k, v) { this.data[k] = String(v); },
      clear() { this.data = {}; }
    },
    document: {
      documentElement: {
        attributes: {},
        getAttribute(k) { return this.attributes[k] || null; },
        setAttribute(k, v) { this.attributes[k] = v; },
        removeAttribute(k) { delete this.attributes[k]; }
      },
      elements: {},
      getElementById(id) {
        if (!this.elements[id]) {
          this.elements[id] = {
            id,
            textContent: '',
            title: '',
            attrs: {},
            setAttribute(k, v) { this.attrs[k] = v; }
          };
        }
        return this.elements[id];
      }
    },
    window: {
      matchMedia() { return { matches: false }; }
    },
    showToast() { toastCalled = true; }
  };
  
  vm.createContext(context);
  vm.runInContext(code, context);
  
  // Test 1: Old value compatibility (mm-theme='dark')
  context.localStorage.data['mm-theme'] = 'dark';
  vm.runInContext('initTheme()', context);
  assert.equal(context.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(context.document.getElementById('theme-toggle-btn').textContent, '🌙');
  assert.equal(context.document.getElementById('theme-toggle').textContent, '🌙');
  
  // Test 2: Cycle Sequence (dark -> money)
  vm.runInContext('toggleTheme()', context);
  assert.equal(context.document.documentElement.getAttribute('data-theme'), 'money');
  assert.equal(context.localStorage.data['theme'], 'money');
  assert.equal(context.document.getElementById('theme-toggle-btn').textContent, '🪙');
  
  // Test 3: Cycle Sequence (money -> light)
  vm.runInContext('toggleTheme()', context);
  assert.equal(context.document.documentElement.getAttribute('data-theme'), null);
  assert.equal(context.localStorage.data['theme'], 'light');
  assert.equal(context.document.getElementById('theme-toggle-btn').textContent, '☀️');
  
  // Test 4: Cycle Sequence (light -> dark)
  vm.runInContext('toggleTheme()', context);
  assert.equal(context.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(context.localStorage.data['theme'], 'dark');
  assert.equal(context.document.getElementById('theme-toggle-btn').textContent, '🌙');
  
  // Test 5: Fallback logic for unsupported old value
  context.localStorage.data['mm-theme'] = 'purple';
  context.localStorage.data['theme'] = 'purple';
  vm.runInContext('initTheme()', context);
  assert.equal(context.document.documentElement.getAttribute('data-theme'), null);
  assert.equal(context.localStorage.data['theme'], 'light');
});
