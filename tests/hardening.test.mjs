import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('seluruh JavaScript lolos pemeriksaan sintaks Node', () => {
    const files = [
        ...readdirSync(join(root, 'js')).filter(name => name.endsWith('.js')).map(name => join(root, 'js', name)),
        join(root, 'sw.js')
    ];

    for (const file of files) {
        const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        assert.equal(result.status, 0, `${file}\n${result.stderr}`);
    }
});

test('handler inline setiap halaman mempunyai implementasi', () => {
    const htmlFiles = readdirSync(root).filter(name => name.endsWith('.html'));
    for (const htmlFile of htmlFiles) {
        const html = read(htmlFile);
        const localScripts = Array.from(html.matchAll(/<script[^>]+src=["'](js\/[^"']+)["']/g), match => match[1]);
        const implementation = [html, ...localScripts.map(read)].join('\n');
        const handlers = Array.from(
            html.matchAll(/on(?:click|submit|change|input|keyup)=["']\s*([A-Za-z_$][\w$]*)\s*\(/g),
            match => match[1]
        );

        for (const handler of new Set(handlers)) {
            assert.match(
                implementation,
                new RegExp(`(?:function\\s+${handler}\\s*\\(|(?:const|let|var)\\s+${handler}\\s*=)`),
                `${htmlFile}: handler ${handler} tidak ditemukan`
            );
        }
    }
});

test('service worker hanya mencache GET dari origin aplikasi', () => {
    const source = read('sw.js');
    assert.match(source, /request\.method !== ["']GET["']/);
    assert.match(source, /url\.origin !== self\.location\.origin/);
    assert.match(source, /networkResponse\.type !== ["']basic["']/);
    assert.doesNotMatch(source, /cache\.put\(event\.request/);
});

test('input mendukung transaksi atomik dan mode kompatibilitas database lama', () => {
    const config = read('js/supabase-config.js');
    const source = read('js/input.js');
    assert.match(config, /const FASE5_ENABLED = false/);
    assert.match(source, /if \(FASE5_ENABLED\)/);
    assert.match(source, /callSupabaseRpc\(['"]insert_absensi_batch['"]/);
    assert.match(source, /p_master_baru:\s*arrayDataMasterBaru/);
    assert.match(source, /supabaseFetch\(['"]master_relawan['"],\s*['"]POST['"]/);
    assert.match(read('js/master.js'), /if \(FASE5_ENABLED\)/);
});

test('query daftar lengkap menggunakan pagination PostgREST', () => {
    const config = read('js/supabase-config.js');
    assert.match(config, /async function supabaseFetchAll/);
    assert.match(config, /limit=\$\{pageSize\}&offset=\$\{offset\}/);

    for (const file of ['js/dashboard.js', 'js/riwayat.js', 'js/kalender.js', 'js/statistik.js']) {
        assert.match(read(file), /supabaseFetchAll\(/, `${file} belum menggunakan pagination`);
    }
});

test('parser CSV mempertahankan koma, kutip ganda, dan baris dalam sel', () => {
    const context = {
        console,
        document: { addEventListener() {} }
    };
    vm.createContext(context);
    vm.runInContext(read('js/master.js'), context);

    const parsed = context.parseCSVRows(
        'NIP,Nama,Organisasi\r\n1,"DOE, JOHN","Tim ""A"""\r\n2,"ANI\nPUTRI",Umum'
    );
    const plain = Array.from(parsed, row => Array.from(row));
    assert.deepEqual(plain, [
        ['NIP', 'Nama', 'Organisasi'],
        ['1', 'DOE, JOHN', 'Tim "A"'],
        ['2', 'ANI\nPUTRI', 'Umum']
    ]);
});

test('migrasi integritas memiliki pagar transaksi dan unique index', () => {
    const source = read('db/fase5_integritas_transaksi.sql');
    assert.match(source, /BEGIN;/);
    assert.match(source, /COMMIT;/);
    assert.match(source, /uq_log_absensi_identitas/);
    assert.match(source, /uq_log_absensi_nama_fallback/);
    assert.match(source, /ON CONFLICT DO NOTHING/);
    assert.match(source, /auth\.uid\(\) IS NULL/);
    assert.match(source, /CREATE TRIGGER trg_cegah_hapus_master_berlog/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.import_master_batch/);
});

test('migrasi multi-user fail closed dan membatasi merge ke admin', () => {
    const source = read('db/fase4_multi_user.sql');
    assert.match(source, /'blocked'/);
    assert.match(source, /IF public\.akun_role\(\) <> 'admin'/);
    assert.match(source, /Hanya admin yang boleh menggabungkan relawan/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS public\.audit_perubahan/);
    assert.match(source, /CREATE TRIGGER trg_audit_log_absensi/);
    assert.match(source, /GANTI_EMAIL_ADMIN/);
    assert.doesNotMatch(source, /COALESCE\([\s\S]*?'admin'\s*-- belum dibuatkan profil/);
});
