#!/usr/bin/env node
/**
 * Membuat JWT_SECRET, ANON_KEY, dan SERVICE_ROLE_KEY untuk stack
 * Supabase self-host di deploy/.
 *
 * Pemakaian:
 *   node deploy/scripts/generate-keys.mjs
 *   node deploy/scripts/generate-keys.mjs --write
 *
 * --write akan membuat/mengisi deploy/.env secara otomatis.
 * Tanpa --write, nilai hanya dicetak ke terminal.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(HERE, '..', '.env');
const ENV_EXAMPLE_PATH = resolve(HERE, '..', '.env.example');

const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');

const isPlaceholder = (value) =>
    !value || /GANTI|your-super-secret|GANTI_DENGAN/i.test(value);

const b64url = (value) => Buffer.from(value).toString('base64url');

function signJwt(secret, role, issuer) {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 60 * 60 * 24 * 365 * 10; // 10 tahun
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
        iss: issuer,
        ref: 'relawansync',
        role,
        iat,
        exp
    }));
    const data = `${header}.${payload}`;
    const signature = createHmac('sha256', secret).update(data).digest('base64url');
    return `${data}.${signature}`;
}

function readEnvValue(text, key) {
    const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
}

function verifyJwt(token, secret) {
    try {
        const [header, payload, signature] = token.split('.');
        const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
        if (expected !== signature) return null;
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
        return claims;
    } catch {
        return null;
    }
}

function setEnvValue(text, key, value) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(text)) return text.replace(pattern, `${key}=${value}`);
    return `${text.trimEnd()}\n${key}=${value}\n`;
}

let envText = '';
if (shouldWrite) {
    if (!existsSync(ENV_PATH)) {
        if (!existsSync(ENV_EXAMPLE_PATH)) {
            console.error('deploy/.env.example tidak ditemukan.');
            process.exit(1);
        }
        envText = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
        console.log('deploy/.env belum ada, dibuat dari .env.example.');
    } else {
        envText = readFileSync(ENV_PATH, 'utf8');
    }
}

let jwtSecret = shouldWrite ? readEnvValue(envText, 'JWT_SECRET') : process.env.JWT_SECRET || '';
let postgresPassword = shouldWrite
    ? readEnvValue(envText, 'POSTGRES_PASSWORD')
    : process.env.POSTGRES_PASSWORD || '';

if (isPlaceholder(jwtSecret) || jwtSecret.length < 32) {
    jwtSecret = randomBytes(48).toString('hex');
    console.log('JWT_SECRET baru dibuat (96 karakter).');
}

if (isPlaceholder(postgresPassword)) {
    postgresPassword = randomBytes(24).toString('hex');
    console.log('POSTGRES_PASSWORD baru dibuat (48 karakter).');
}

// Issuer dibuat tetap agar key tidak bergantung pada URL yang diisi belakangan.
// PostgREST hanya memeriksa signature/role/exp, bukan iss.
const issuerIndex = args.indexOf('--issuer');
const issuer = issuerIndex >= 0 ? args[issuerIndex + 1] : 'supabase';

const anonLama = shouldWrite ? readEnvValue(envText, 'ANON_KEY') : '';
const serviceLama = shouldWrite ? readEnvValue(envText, 'SERVICE_ROLE_KEY') : '';

const anonValid = anonLama && verifyJwt(anonLama, jwtSecret)?.role === 'anon';
const serviceValid = serviceLama && verifyJwt(serviceLama, jwtSecret)?.role === 'service_role';

const anonKey = anonValid ? anonLama : signJwt(jwtSecret, 'anon', issuer);
const serviceKey = serviceValid ? serviceLama : signJwt(jwtSecret, 'service_role', issuer);

if (shouldWrite) {
    if (anonValid && serviceValid) {
        console.log('ANON_KEY dan SERVICE_ROLE_KEY lama masih valid; dipertahankan.');
    }
}

if (shouldWrite) {
    envText = setEnvValue(envText, 'JWT_SECRET', jwtSecret);
    envText = setEnvValue(envText, 'POSTGRES_PASSWORD', postgresPassword);
    envText = setEnvValue(envText, 'ANON_KEY', anonKey);
    envText = setEnvValue(envText, 'SERVICE_ROLE_KEY', serviceKey);

    writeFileSync(ENV_PATH, envText, 'utf8');
    try {
        chmodSync(ENV_PATH, 0o600);
    } catch {
        // Windows tidak mendukung chmod penuh; abaikan.
    }

    console.log(`\ndeploy/.env diperbarui: ${ENV_PATH}`);
    console.log('ANON_KEY      :', anonKey);
    console.log('SERVICE_ROLE  :', `${serviceKey.slice(0, 24)}... (jangan dibagikan)`);
    console.log('\nLangkah berikutnya: isi API_EXTERNAL_URL, SITE_URL, dan CORS_ORIGIN di .env.');
} else {
    console.log('JWT_SECRET=' + jwtSecret);
    console.log('POSTGRES_PASSWORD=' + postgresPassword);
    console.log('ANON_KEY=' + anonKey);
    console.log('SERVICE_ROLE_KEY=' + serviceKey);
    console.log('\nSalin ke deploy/.env, atau jalankan ulang dengan --write.');
}
