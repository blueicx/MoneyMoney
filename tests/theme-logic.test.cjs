const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const indexHtml = require('./helpers/dashboard-source.cjs').readDashboardSource();

function extractCode(html) {
  const match = html.match(/function applyUiPreferences\(\)[\s\S]*?function toggleTheme\(\) {[\s\S]*?\n}/);
  return match ? match[0] : '';
}

test('Theme CSS Variables exist', () => {
  assert.match(indexHtml, /\[data-theme="dark"\]\s*\{/);
  assert.match(indexHtml, /\[data-theme="money"\]\s*\{/);
});

test('UI density and text preferences persist and apply through root attributes', () => {
  assert.match(indexHtml, /function applyUiPreferences\(\)/);
  assert.match(indexHtml, /function saveUiPreference\(key, value\)/);
  assert.match(indexHtml, /id="ui-density"/);
  assert.match(indexHtml, /id="ui-text-size"/);
  assert.match(indexHtml, /data-ui-density="compact"/);
  assert.match(indexHtml, /data-ui-text="large"/);

  const start = indexHtml.indexOf('function applyUiPreferences()');
  const end = indexHtml.indexOf('function updateThemeButtons', start);
  const code = indexHtml.slice(start, end);
  const context = {
    localStorage: {
      data: { 'mm-ui-density': 'compact', 'mm-ui-text-size': 'large' },
      getItem(key) { return this.data[key] || null; },
      setItem(key, value) { this.data[key] = String(value); },
    },
    document: { documentElement: {
      attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
    } },
  };
  vm.createContext(context);
  vm.runInContext(code + 'applyUiPreferences()', context);
  assert.equal(context.document.documentElement.attributes['data-ui-density'], 'compact');
  assert.equal(context.document.documentElement.attributes['data-ui-text'], 'large');
  context.localStorage.data['mm-ui-density'] = 'invalid';
  context.localStorage.data['mm-ui-text-size'] = 'invalid';
  vm.runInContext('applyUiPreferences()', context);
  assert.equal(context.document.documentElement.attributes['data-ui-density'], undefined);
  assert.equal(context.document.documentElement.attributes['data-ui-text'], undefined);
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
  assert.equal(context.document.getElementById('theme-toggle').textContent, '🌙');
  
  // Test 2: Cycle Sequence (dark -> money)
  vm.runInContext('toggleTheme()', context);
  assert.equal(context.document.documentElement.getAttribute('data-theme'), 'money');
  assert.equal(context.localStorage.data['theme'], 'money');
  assert.equal(context.document.getElementById('theme-toggle').textContent, '🪙');
  
  // Test 3: Cycle Sequence (money -> light)
  vm.runInContext('toggleTheme()', context);
  assert.equal(context.document.documentElement.getAttribute('data-theme'), null);
  assert.equal(context.localStorage.data['theme'], 'light');
  assert.equal(context.document.getElementById('theme-toggle').textContent, '☀️');
  
  // Test 4: Cycle Sequence (light -> dark)
  vm.runInContext('toggleTheme()', context);
  assert.equal(context.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(context.localStorage.data['theme'], 'dark');
  assert.equal(context.document.getElementById('theme-toggle').textContent, '🌙');
  
  // Test 5: Fallback logic for unsupported old value
  context.localStorage.data['mm-theme'] = 'purple';
  context.localStorage.data['theme'] = 'purple';
  vm.runInContext('initTheme()', context);
  assert.equal(context.document.documentElement.getAttribute('data-theme'), null);
  assert.equal(context.localStorage.data['theme'], 'light');
});
