import fs from 'node:fs';
import path from 'node:path';

const fontsDir = path.resolve('public/assets/fonts');
fs.mkdirSync(fontsDir, { recursive: true });

async function getFontUrl(cssUrl, fontFamily, isItalic = false) {
  const res = await fetch(cssUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  const text = await res.text();
  // split into @font-face blocks
  const blocks = text.split('@font-face');
  for (const block of blocks) {
    if (block.includes(fontFamily) && block.includes('latin')) {
      if (isItalic && !block.includes('italic')) continue;
      if (!isItalic && block.includes('italic')) continue;
      const m = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^\)]+)\)/);
      if (m) return m[1];
    }
  }
  return null;
}

async function download(url, dest) {
  console.log(`Downloading ${url} -> ${dest}`);
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`Saved ${dest} (${buf.length} bytes)`);
}

async function run() {
  const bricolageUrl = await getFontUrl(
    'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&display=swap',
    'Bricolage Grotesque'
  );
  if (bricolageUrl) await download(bricolageUrl, path.join(fontsDir, 'bricolage-grotesque-latin.woff2'));

  const instrumentUrl = await getFontUrl(
    'https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap',
    'Instrument Serif',
    false
  );
  if (instrumentUrl) await download(instrumentUrl, path.join(fontsDir, 'instrument-serif-latin.woff2'));

  const instrumentItalicUrl = await getFontUrl(
    'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&display=swap',
    'Instrument Serif',
    true
  );
  if (instrumentItalicUrl) await download(instrumentItalicUrl, path.join(fontsDir, 'instrument-serif-italic-latin.woff2'));

  const manropeUrl = await getFontUrl(
    'https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&display=swap',
    'Manrope'
  );
  if (manropeUrl) await download(manropeUrl, path.join(fontsDir, 'manrope-latin.woff2'));

  console.log('Fonts setup complete.');
}

run().catch(console.error);
