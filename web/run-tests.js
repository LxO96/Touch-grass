/* ==========================================================
   TOUCH GRASS — the logic tests, without a browser

       node web/run-tests.js

   test.html is the real harness and stays the readable one; this
   runs the identical script over the identical files and exits
   non-zero on a failure, so a terminal or a CI job can tell.

   It shims only what core.js and lang.js actually reach for:
   localStorage, a document that returns inert elements, and a
   navigator with a language. Nothing here is a test double for
   the code under test — the scoring, blending and log code runs
   exactly as it does in the page.
   ========================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = __dirname;

/* ---------- the smallest browser that will do ---------- */

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

const element = () => ({
  textContent: '', innerHTML: '', className: '', hidden: false,
  style: {}, dataset: {}, disabled: false, title: '',
  classList: { add() {}, remove() {}, toggle() {} },
  append() {}, appendChild() {}, addEventListener() {},
  setAttribute() {}, querySelectorAll: () => []
});

/* The report element is the one the tests actually read back. */
let report = '';
const out = {
  set innerHTML(v) { report = v; },
  get innerHTML() { return report; },
  set textContent(v) { report = v; },
  get textContent() { return report; },
  className: '', style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  append() {}, addEventListener() {}
};

const sandbox = {
  localStorage,
  console,
  navigator: { language: 'en-US', languages: ['en-US'] },
  document: {
    getElementById: (id) => (id === 'out' ? out : element()),
    createElement: () => element(),
    querySelectorAll: () => [],
    documentElement: {},
    addEventListener() {},
    title: ''
  },
  window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
  Math, Date, JSON, isFinite, isNaN, parseInt, parseFloat,
  Number, String, Object, Array, Error, RegExp, Boolean,
  Set, Map, encodeURIComponent, decodeURIComponent
};
sandbox.window.localStorage = localStorage;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ---------- the same files, in the same order ---------- */

const HTML = fs.readFileSync(path.join(WEB, 'test.html'), 'utf8');

// Whatever test.html loads, load — so adding a <script> there is all
// it takes for this runner to pick the file up too.
const sources = [...HTML.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
for (const src of sources) {
  vm.runInContext(fs.readFileSync(path.join(WEB, src), 'utf8'), sandbox, { filename: src });
}

// The tests themselves are the last inline block.
const blocks = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const body = blocks[blocks.length - 1];

try {
  vm.runInContext(body, sandbox, { filename: 'test.html' });
} catch (e) {
  console.error('THREW: ' + e.message);
  console.error((e.stack || '').split('\n').slice(1, 4).join('\n'));
  process.exit(2);
}

/* ---------- what happened ---------- */

const plain = report.replace(/<[^>]*>/g, '');
const failures = plain.split('\n').filter((l) => l.startsWith('FAIL'));

if (failures.length) {
  console.log(plain);
  process.exit(1);
}

console.log(plain.split('\n').filter((l) => l.startsWith('===')).join('\n') ||
            `${plain.split('\n').filter((l) => l.startsWith('PASS')).length} passed`);
