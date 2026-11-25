import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const iconDir = path.join(rootDir, 'public', 'icon');
const storeDir = path.join(rootDir, 'docs', 'store');
const svgPath = path.join(iconDir, 'logo.svg');
const sizes = [16, 32, 48, 128];

// The promo tile embeds the extension icon itself.
const promoSvg = (logoInner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 280" width="440" height="280">
  <rect width="440" height="280" fill="#F1EBDF" />
  <rect x="20" y="20" width="400" height="240" rx="18" fill="#FFFDF8" stroke="#E4D9C3" stroke-width="2" />

  <!-- Extension icon -->
  <svg x="50" y="94" width="92" height="92" viewBox="0 0 128 128">${logoInner}</svg>

  <!-- Bilingual reading visual mockup (pure vector, font-independent) -->
  <text x="166" y="118" fill="#24211C" font-family="Georgia, serif" font-size="30" font-weight="700">BiText</text>
  <text x="166" y="146" fill="#6B6355" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="16" font-weight="500">Web Translator</text>

  <!-- Mini bilingual paragraph bars -->
  <rect x="166" y="168" width="184" height="7" rx="3.5" fill="#24211C" fill-opacity="0.78" />
  <rect x="166" y="182" width="136" height="7" rx="3.5" fill="#24211C" fill-opacity="0.55" />
  <rect x="166" y="200" width="4" height="24" rx="2" fill="#0F6E66" />
  <rect x="178" y="201" width="166" height="7" rx="3.5" fill="#0F6E66" fill-opacity="0.85" />
  <rect x="178" y="215" width="122" height="7" rx="3.5" fill="#0F6E66" fill-opacity="0.62" />
</svg>`;

async function main() {
  const svgBuffer = await fs.readFile(svgPath);
  for (const size of sizes) {
    const outPath = path.join(iconDir, `${size}.png`);
    await sharp(svgBuffer, { density: 384 })
      .resize(size, size, { fit: 'contain' })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    console.log(`Generated ${path.relative(rootDir, outPath)} (${size}x${size})`);
  }

  const logoInner = svgBuffer
    .toString('utf8')
    .replace(/^[\s\S]*?<svg[^>]*>/u, '')
    .replace(/<\/svg>\s*$/u, '')
    .replace(/<title[\s\S]*?<\/title>/u, '');

  await fs.mkdir(storeDir, { recursive: true });
  const promoPath = path.join(storeDir, 'promo-small-440x280.png');
  await sharp(Buffer.from(promoSvg(logoInner)), { density: 192 })
    .resize(440, 280, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(promoPath);
  console.log(`Generated ${path.relative(rootDir, promoPath)} (440x280)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
