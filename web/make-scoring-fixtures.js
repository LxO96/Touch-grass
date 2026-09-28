/* ==========================================================
   Regenerates android/app/src/test/resources/scoring_fixtures.csv.

       node web/make-scoring-fixtures.js

   Keeps every input row exactly as it is and recomputes only the
   expected score, by running the real scoring.js under node — the same
   V8 engine as Chrome. ScoringEngineTest then replays every row through
   Rhino and demands the same number, which is how the two runtimes are
   held to one definition of the score.

   Run it only when the formula changes on purpose, and read the diff:
   rows that move should be exactly the ones the change was meant to move.
   (Replaces _fixgen.html, which was never committed.)
   ========================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { Math, JSON, isFinite, parseInt, parseFloat, Number, String, Object, Array };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'scoring.js'), 'utf8'), sandbox);

const CSV = path.join(__dirname, '..', 'android', 'app', 'src', 'test', 'resources', 'scoring_fixtures.csv');
const lines = fs.readFileSync(CSV, 'utf8').split(/\r?\n/);

let changed = 0;
const out = lines.map((line) => {
  if (!line.trim() || line.startsWith('#')) {
    return line.replace('by _fixgen.html', 'by web/make-scoring-fixtures.js');
  }
  const f = line.split(',');
  const score = sandbox.tgScoreHour(
    { hour: +f[0], feels: +f[1], pop: +f[2], precip: +f[3], wind: +f[4],
      isDay: f[5] === '1', code: +f[6] },
    { rain: +f[7], cold: +f[8], heat: +f[9], wind: +f[10], dark: +f[11] }
  );
  if (String(score) !== f[12]) changed++;
  f[12] = String(score);
  return f.join(',');
});

fs.writeFileSync(CSV, out.join('\n'));
console.log(`rewrote ${CSV}: ${changed} of ${lines.filter((l) => l && !l.startsWith('#')).length} scores changed`);
