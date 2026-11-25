/**
 * Copies pdf.js runtime assets out of node_modules into public/pdfjs/.
 *
 * These are needed for:
 *   - cmaps/          predefined CMaps (CJK encodings other than Identity-H)
 *   - standard_fonts/ the standard-14 fonts when a PDF doesn't embed them
 *
 * They are copied rather than fetched from a CDN so the app stays standalone:
 * it must work offline and must not tell a third party which files are opened.
 *
 * Run via `npm run sync:pdfjs` — and automatically on postinstall, so the
 * version can never drift from the installed pdfjs-dist.
 */
import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'node_modules', 'pdfjs-dist');
const dest = path.join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.error('[sync:pdfjs] pdfjs-dist not installed — skipping.');
  process.exit(0);
}

const { version } = JSON.parse(await readFile(path.join(src, 'package.json'), 'utf8'));

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

for (const dir of ['cmaps', 'standard_fonts']) {
  const from = path.join(src, dir);
  if (!existsSync(from)) {
    console.warn(`[sync:pdfjs] ${dir} not present in pdfjs-dist@${version}`);
    continue;
  }
  await cp(from, path.join(dest, dir), { recursive: true });
  console.log(`[sync:pdfjs] ${dir} -> public/pdfjs/${dir}`);
}

console.log(`[sync:pdfjs] synced from pdfjs-dist@${version}`);
