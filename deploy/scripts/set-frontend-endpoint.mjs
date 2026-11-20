#!/usr/bin/env node
/**
 * Mengarahkan frontend GitHub Pages ke server database kantor.
 *
 * Yang diubah:
 *   - js/supabase-config.js : SUPABASE_URL + SUPABASE_ANON_KEY
 *   - sw.js                 : versi cache dinaikkan agar config baru dipakai
 *   - tests/hardening.test.mjs : assertion versi cache disesuaikan
 *
 * Pemakaian:
 *   node deploy/scripts/set-frontend-endpoint.mjs \
 *     --url https://pc-kantor.tailxxxx.ts.net \
 *     --anon-key "eyJhbGciOi..."
 *
 * Cek dulu tanpa menulis:
 *   node deploy/scripts/set-frontend-endpoint.mjs ... --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const args = process.argv.slice(2);
const valueOf = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};

const rawUrl = valueOf('--url');
const anonKey = valueOf('--anon-key') || process.env.ANON_KEY;
const dryRun = args.includes('--dry-run');

if (!rawUrl || !anonKey) {
    console.error(`Pemakaian:
  node deploy/scripts/set-frontend-endpoint.mjs --url https://host.tailxxxx.ts.net --anon-key "eyJ..."

Opsi:
  --dry-run   tampilkan rencana tanpa menulis file`);
    process.exit(1);
}

let url;
try {
    url = new URL(rawUrl).origin;
} catch {
    console.error(`URL tidak valid: ${rawUrl}`);
    process.exit(1);
}

if (!url.startsWith('https://')) {
    console.warn('PERINGATAN: URL bukan HTTPS. Frontend GitHub Pages akan memblokirnya sebagai mixed content.');
}
if (!anonKey.startsWith('eyJ')) {
    console.warn('PERINGATAN: anon key bukan JWT (tidak diawali "eyJ"). Pastikan memakai ANON_KEY dari deploy/.env.');
}

const configPath = resolve(ROOT, 'js', 'supabase-config.js');
const swPath = resolve(ROOT, 'sw.js');
const testPath = resolve(ROOT, 'tests', 'hardening.test.mjs');

const config = readFileSync(configPath, 'utf8');
const urlPattern = /const SUPABASE_URL = "([^"]*)";/;
const keyPattern = /const SUPABASE_ANON_KEY = "([^"]*)";[ \t]*\r?\n/;

const oldUrl = config.match(urlPattern)?.[1];
const oldKey = config.match(keyPattern)?.[1];

if (!oldUrl || !oldKey) {
    console.error('Pola SUPABASE_URL / SUPABASE_ANON_KEY tidak ditemukan di js/supabase-config.js.');
    process.exit(1);
}

const configChanged = oldUrl !== url || oldKey !== anonKey;
const nextConfig = config
    .replace(urlPattern, `const SUPABASE_URL = ${JSON.stringify(url)};`)
    .replace(keyPattern, `const SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};\n`);

const sw = readFileSync(swPath, 'utf8');
const cachePattern = /relawansync-v(\d+)-[a-z0-9-]+-cache/;
const cacheMatch = sw.match(cachePattern);
if (!cacheMatch) {
    console.error('Nama cache service worker tidak ditemukan di sw.js.');
    process.exit(1);
}

const oldCache = cacheMatch[0];
const newCache = configChanged
    ? `relawansync-v${Number(cacheMatch[1]) + 1}-self-host-cache`
    : oldCache;

console.log('URL lama      :', oldUrl);
console.log('URL baru      :', url);
console.log('Anon key lama :', `${oldKey.slice(0, 18)}...`);
console.log('Anon key baru :', `${anonKey.slice(0, 18)}...`);
console.log('Cache lama    :', oldCache);
console.log('Cache baru    :', newCache);

if (!configChanged) {
    console.log('\nKonfigurasi sudah sama. Tidak ada file yang diubah.');
    process.exit(0);
}

if (dryRun) {
    console.log('\n--dry-run: tidak ada file yang ditulis.');
    process.exit(0);
}

const testSource = readFileSync(testPath, 'utf8');
if (!testSource.includes(oldCache)) {
    console.error(`Assertion cache "${oldCache}" tidak ditemukan di tests/hardening.test.mjs.`);
    console.error('Perbarui test secara manual agar cocok dengan sw.js.');
    process.exit(1);
}

const nextTest = testSource.split(oldCache).join(newCache);
const nextSw = sw.split(oldCache).join(newCache);

writeFileSync(configPath, nextConfig, 'utf8');
writeFileSync(swPath, nextSw, 'utf8');
writeFileSync(testPath, nextTest, 'utf8');

console.log(`
Selesai. Langkah berikutnya:
  1. npm test
  2. git add js/supabase-config.js sw.js tests/hardening.test.mjs
  3. git commit -m "Arahkan frontend ke database server kantor"
  4. git push
  5. Buka web dua kali, pastikan service worker ${newCache} aktif.
`);
