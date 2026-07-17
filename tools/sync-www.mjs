// Mirrors the web app's static files from the project root into www/,
// which is what Capacitor bundles into the APK. Keeping the source at the
// root means the `npx serve` dev workflow (and the phone test link) still
// works unchanged; run this before packaging to refresh the bundle.
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wwwDir = join(root, 'www');

// The exact set of files the app needs at runtime — nothing else.
const FILES = [
  'index.html', 'style.css', 'audio.js', 'sequencer.js', 'ui.js',
  'manifest.json', 'sw.js', 'icon.svg', 'favicon.svg',
  'icon-192.png', 'icon-512.png'
];

await rm(wwwDir, { recursive: true, force: true });
await mkdir(wwwDir, { recursive: true });
for (const f of FILES) {
  await copyFile(join(root, f), join(wwwDir, f));
}
console.log(`Synced ${FILES.length} files into www/`);
