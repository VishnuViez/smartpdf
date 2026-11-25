#!/usr/bin/env node
/**
 * The single entry point for verification.  `npm test`
 *
 * Regenerates fixtures if missing, then runs every suite under .claude/tests.
 * Exits non-zero on any failure so it can gate a commit or a claim of "done".
 *
 * Optional: SMARTPDF_CORPUS=/path/to/real/pdfs npm test
 *   Adds a real-world corpus for coverage the generated fixtures can't provide
 *   (embedded subset fonts, exotic producers). Never required, never committed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, '.claude', 'fixtures');
const TESTS = path.join(ROOT, '.claude', 'tests');

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });

if (!existsSync(FIXTURES) || readdirSync(FIXTURES).filter(f => f.endsWith('.pdf')).length === 0) {
  console.log('Fixtures missing — generating.\n');
  const gen = run(process.execPath, ['.claude/testkit/make-fixtures.mjs']);
  if (gen.status !== 0) { console.error('\nFixture generation failed.'); process.exit(1); }
  console.log('');
}

if (process.env.SMARTPDF_CORPUS) {
  console.log(`Extra corpus: ${process.env.SMARTPDF_CORPUS}\n`);
}

const suites = readdirSync(TESTS)
  .filter(f => f.endsWith('.test.mjs'))
  .sort()
  .map(f => path.join('.claude', 'tests', f));

const result = run(process.execPath, ['--test', ...suites]);

if (result.status !== 0) {
  console.error('\n❌ Tests failed. Do not proceed until this is green.');
  process.exit(result.status || 1);
}
console.log('\n✅ All suites passed.');
