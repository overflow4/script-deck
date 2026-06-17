// sync.mjs — fetches the Google Doc plain-text export, parses it into copy-ready
// script sections (passwords/internal sections stripped), and writes scripts.json.
// Runs in the GitHub Action on a schedule and can be run locally:  node sync/sync.mjs
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDoc } from './parse.mjs';

const DOC_ID =
  process.env.DOC_ID || '1YafTv6MHLYWOfrMnrct4bvU8zsfmnSjn_PwsnIUwY1w';
const EXPORT_URL = `https://docs.google.com/document/d/${DOC_ID}/export?format=txt`;

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'scripts.json');

async function main() {
  const res = await fetch(EXPORT_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Export fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.length < 200) throw new Error('Export looks empty — aborting to avoid wiping data.');

  const { sections } = parseDoc(text);
  if (!sections.length) throw new Error('No script sections found — aborting.');

  const data = {
    updated: new Date().toISOString(),
    source: `https://docs.google.com/document/d/${DOC_ID}/edit`,
    sections,
  };

  // Avoid a no-op commit (preserve the existing timestamp when content is identical).
  try {
    const prev = JSON.parse(await readFile(outPath, 'utf8'));
    const a = JSON.stringify({ ...prev, updated: 0 });
    const b = JSON.stringify({ ...data, updated: 0 });
    if (a === b) {
      console.log('No content change — leaving scripts.json untouched.');
      return;
    }
  } catch {
    /* no previous file */
  }

  await writeFile(outPath, JSON.stringify(data, null, 2) + '\n');
  const blocks = sections.reduce((n, s) => n + s.blocks.length, 0);
  console.log(`Wrote scripts.json — ${sections.length} scripts, ${blocks} blocks.`);
  console.log('Sections:', sections.map((s) => `${s.title} (${s.blocks.length})`).join(' | '));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
