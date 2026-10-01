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

test('tema light dan dark tersimpan serta light mode memakai off-white', () => {
    const theme = read('js/theme.js');
    const style = read('css/style.css');
    const htmlFiles = readdirSync(root).filter(name => name.endsWith('.html'));
    assert.match(theme, /relawan_theme/);
    assert.match(theme, /classList\.toggle\(['"]dark['"]/);
    assert.match(theme, /data-theme-toggle/);
    assert.match(style, /--theme-page:\s*#[0-9a-f]{6}/i);
    assert.match(style, /--theme-surface:\s*#[0-9a-f]{6}/i);
    assert.match(style, /html:not\(\.dark\) \.bg-white/);
    assert.doesNotMatch(style, /--theme-(?:page|surface):\s*#(?:fff|ffffff)\b/i);

    for (const file of htmlFiles) {
        assert.match(read(file), /<script src=["']js\/theme\.js["']><\/script>/, `${file} belum memuat tema global`);
    }
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

test('fitur peringkat dan seragam mempunyai halaman, navigasi, dan kontrak database', () => {
    const app = read('js/app.js');
    const peringkatHtml = read('peringkat.html');
    const seragamHtml = read('seragam.html');
    const peringkatJs = read('js/peringkat.js');
    const seragamJs = read('js/seragam.js');

    assert.match(app, /injectFeatureNavigation/);
    assert.match(app, /peringkat\.html/);
    assert.match(app, /seragam\.html/);
    assert.match(peringkatHtml, /Peringkat & Reward/);
    assert.match(seragamHtml, /Kontrol Seragam/);
    assert.match(peringkatJs, /v_peringkat_personel/);
    assert.match(peringkatJs, /indeks_keaktifan/);
    assert.match(seragamJs, /v_status_seragam/);
    assert.match(seragamJs, /simpan_status_seragam/);
    assert.match(seragamJs, /notifikasi_pengembalian/);
});

test('migrasi fase 6 aman, dapat diulang, dan memisahkan dua kategori ranking', () => {
    const source = read('db/fase6_ranking_seragam.sql');
    assert.match(source, /BEGIN;/);
    assert.match(source, /COMMIT;/);
    assert.match(source, /backup_fase6_master_relawan_20261002/);
    assert.match(source, /ADD COLUMN IF NOT EXISTS asal_daerah/);
    assert.match(source, /ADD COLUMN IF NOT EXISTS kategori_wilayah/);
    assert.match(source, /'khususul_khusus', 'lainnya'/);
    assert.match(source, /CREATE VIEW public\.v_peringkat_personel/);
    assert.match(source, /CREATE VIEW public\.v_status_seragam/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.simpan_status_seragam/);
    assert.match(source, /CREATE TRIGGER trg_catat_riwayat_seragam/);
    assert.match(source, /ALTER TABLE public\.seragam_penerima ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /WHEN l\.sesi = 'Siang' THEN 'Pagi'/);
});

test('fase 7 menyediakan rincian proyek, ringkasan direktori, dan peringatan absen lama', () => {
    const source = read('db/fase7_operasional_optimasi.sql');
    const peringkat = read('js/peringkat.js');
    const seragam = read('js/seragam.js');
    const master = read('js/master.js');
    const masterHtml = read('master.html');

    assert.match(source, /CREATE OR REPLACE VIEW public\.v_kehadiran_proyek_personel/);
    assert.match(source, /CREATE OR REPLACE VIEW public\.v_ringkasan_personel/);
    assert.match(source, /CREATE OR REPLACE VIEW public\.v_status_seragam_operasional/);
    assert.match(source, /tidak_hadir_30_hari/);
    assert.match(peringkat, /filterProyekPeringkat/);
    assert.match(peringkat, /v_kehadiran_proyek_personel/);
    assert.match(seragam, /v_status_seragam_operasional/);
    assert.match(seragam, /kpiSeragamAbsenLama/);
    assert.match(seragam, /filterProyekSeragam/);
    assert.match(master, /v_ringkasan_personel/);
    assert.match(master, /ubahUrutanMaster/);
    assert.match(masterHtml, /ringkasanMasterGlobal/);
    assert.match(masterHtml, /Kehadiran terbanyak/);
    assert.match(masterHtml, /Persentase hadir/);
});

test('input menggunakan Pagi dan nama baku lima proyek', () => {
    const html = read('input.html');
    const source = read('js/input.js');
    assert.match(html, /option value="Pagi"/);
    assert.match(html, /Monumen Semboyan Sang Mursyid/);
    assert.match(html, /Chaddun 'Adhiim/);
    assert.match(html, /Gapura Syukur/);
    assert.match(source, /startsWith\('PAG'\)/);
    assert.match(source, /startsWith\('SIA'\).*'Pagi'/);
});
