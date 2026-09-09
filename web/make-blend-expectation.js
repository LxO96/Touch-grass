/* ==========================================================
   TOUCH GRASS — the browser's answer, written down

       node web/make-blend-expectation.js

   web/blend.js is evaluated by two engines: V8 in the page, Rhino in the
   Android worker. The whole point of sharing the file is that the page and
   the home-screen widget cannot disagree, and that invariant was assumed
   rather than checked — the JVM test asserted a source count and an hour,
   which a blend that disagreed on every reading and every code would have
   passed. It did in fact disagree: enumeration order differs between the
   engines, and a tied code vote picked a different winner in each.

   So this runs the real blend.js under V8 over the committed fixtures and
   writes the full JSON out. ScoringEngineTest replays the same fixtures
   through Rhino and asserts byte equality with this file. Regenerate it
   deliberately, by running this, whenever the blend's output shape
   legitimately changes — never by pasting in what Rhino produced.
   ========================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = __dirname;
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');

const sandbox = {
  Math, Date, JSON, isFinite, isNaN, parseInt, parseFloat,
  Number, String, Object, Array, Error, RegExp, Boolean
};
vm.createContext(sandbox);
for (const f of ['scoring.js', 'blend.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}

const om = read('fixtures-om.json');
const met = read('fixtures-met.json');
const smhi = read('fixtures-smhi.json');

/* Two cases, and the second is the one that matters. All three sources is
   the happy path. Open-Meteo and SMHI alone is MET timed out or rate
   limited — the degraded path the design plans for — and it is exactly
   there that the weights renormalise to 0.5/0.5 and a code vote can tie. */
const cases = {
  allThree: JSON.parse(sandbox.tgForecastJson(om, met, smhi)),
  metMissing: JSON.parse(sandbox.tgForecastJson(om, null, smhi))
};

const out = path.join(WEB, 'expected-blend.json');
fs.writeFileSync(out, JSON.stringify(cases, null, 2) + '\n');
console.log('wrote ' + out);
