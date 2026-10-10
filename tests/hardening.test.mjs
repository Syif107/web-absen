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

test('frontend memakai CSS produksi lokal dan cache ukuran dinamis versi 34', () => {
    const htmlFiles = readdirSync(root).filter(name => name.endsWith('.html'));
    for (const file of htmlFiles) {
        const html = read(file);
        assert.match(html, /css\/tailwind\.min\.css/, `${file} belum memakai Tailwind lokal`);
        assert.doesNotMatch(html, /cdn\.tailwindcss\.com/, `${file} masih memakai Tailwind CDN`);
        assert.doesNotMatch(html, /tailwind\.config/, `${file} masih membawa konfigurasi runtime`);
    }
    assert.match(read('sw.js'), /relawansync-v34-ukuran-dinamis-cache/);
    assert.match(read('package.json'), /build:css/);
});

test('token sesi tidak disimpan permanen dan laporan memakai log kanonis', () => {
    const config = read('js/supabase-config.js');
    assert.match(config, /sessionStorage\.setItem\(RELAWAN_TOKEN_KEY/);
    assert.match(config, /localStorage\.removeItem\(RELAWAN_TOKEN_KEY/);
    for (const file of ['js/dashboard.js', 'js/riwayat.js', 'js/kalender.js', 'js/statistik.js', 'js/export-rekap.js']) {
        assert.match(read(file), /v_log_absensi_operasional/, `${file} belum memakai log kanonis`);
    }
});

test('fase 14 menyediakan kanonisasi, audit kualitas, pagination, dan zona tunggal', () => {
    const source = read('db/fase14_integritas_operasional.sql');
    assert.match(source, /CREATE OR REPLACE VIEW public\.v_log_absensi_operasional/);
    assert.match(source, /CREATE OR REPLACE VIEW public\.v_audit_kualitas_absensi/);
    assert.match(source, /CREATE TRIGGER trg_cegah_absensi_ganda_baru/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.daftar_peringkat_v2/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.daftar_seragam_v2/);
    assert.match(source, /m\.zona_asal = 'zona_4'/);
    assert.doesNotMatch(source, /DELETE\s+FROM\s+public\.log_absensi/i);
});

test('fase 15 bootstrap aman dan tidak menimpa fungsi bisnis Fase 14', () => {
    const source = read('db/fase15_multi_user_aman.sql');
    const config = read('js/supabase-config.js');
    assert.match(source, /v_jumlah <> 1/);
    assert.match(source, /'blocked'/);
    assert.match(source, /log_koordinator_insert/);
    assert.match(source, /lokasi = \(SELECT public\.akun_lokasi\(\)\)/);
    assert.match(source, /riwayat_merge_admin_read/);
    assert.match(config, /const FASE4_ENABLED = true/);
    assert.doesNotMatch(source, /CREATE OR REPLACE FUNCTION public\.insert_absensi_batch/);
    assert.doesNotMatch(source, /GANTI_EMAIL_ADMIN/);
});

test('fase 16 mempercepat RPC admin tanpa melewati pembatasan koordinator', () => {
    const source = read('db/fase16_performa_rpc_aman.sql');
    assert.match(source, /daftar_peringkat_operator_v2/);
    assert.match(source, /daftar_seragam_operator_v2/);
    assert.match(source, /daftar_peringkat_admin_v2/);
    assert.match(source, /daftar_seragam_admin_v2/);
    assert.match(source, /SECURITY DEFINER/);
    assert.match(source, /public\.akun_role\(\) <> 'admin'/);
    assert.match(source, /ELSIF v_role = 'koordinator'/);
    assert.match(source, /SECURITY INVOKER/);
    assert.match(source, /REVOKE ALL ON FUNCTION public\.daftar_peringkat_admin_v2/);
    assert.match(source, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon/);
    assert.match(source, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public/);
});

test('fase 17 menyediakan personel khusus, stok massal bertanggal, detail, dan hapus permanen aman', () => {
    const sql = read('db/fase17_personel_khusus_stok_massal.sql');
    const master = read('js/master.js');
    const seragam = read('js/seragam.js');
    assert.match(sql, /kategori_personel/);
    assert.match(sql, /catat_mutasi_stok_batch_v2/);
    assert.match(sql, /proses_mutasi_stok_terjadwal/);
    assert.match(sql, /ubah_tanggal_mutasi_stok/);
    assert.match(sql, /pratinjau_hapus_personel/);
    assert.match(sql, /p_frasa <> 'HAPUS PERMANEN'/);
    assert.match(sql, /detail_personel_v2/);
    assert.match(master, /bukaModalTambahPersonel/);
    assert.match(master, /exportMasterExcel/);
    assert.match(master, /hapus_personel_permanen/);
    assert.match(seragam, /catat_mutasi_stok_batch_v2/);
    assert.match(seragam, /stokBatchRows/);
    assert.match(seragam, /ubah_tanggal_mutasi_stok/);
});

test('fase 18 menerapkan empat zona tanpa menimpa zona manual', () => {
    const sql = read('db/fase18_penerapan_zona_otomatis.sql');
    const masterHtml = read('master.html');
    const masterJs = read('js/master.js');
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.provinsi_dari_daerah/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.zona_otomatis_dari_daerah/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.sinkronkan_zona_otomatis/);
    assert.match(sql, /WHERE m\.zona_asal IS NULL/);
    assert.match(sql, /Zona 4: Sumatera dan Kalimantan/);
    assert.match(masterHtml, /Isi Zona Otomatis/);
    assert.match(masterHtml, /Zona 4 — Sumatera, Kalimantan/);
    assert.match(masterJs, /async function sinkronkanZonaOtomatis/);
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

test('input memakai transaksi atomik Fase 14 dengan jembatan kompatibilitas', () => {
    const config = read('js/supabase-config.js');
    const source = read('js/input.js');
    const fase14 = read('db/fase14_integritas_operasional.sql');
    assert.match(config, /const FASE5_ENABLED = true/);
    assert.match(config, /const FASE14_ENABLED = true/);
    assert.match(source, /if \(FASE5_ENABLED\)/);
    assert.match(source, /callSupabaseRpc\(['"]insert_absensi_batch['"]/);
    assert.match(source, /p_master_baru:\s*arrayDataMasterBaru/);
    assert.match(source, /supabaseFetch\(['"]master_relawan['"],\s*['"]POST['"]/);
    assert.match(read('js/master.js'), /if \(FASE5_ENABLED\)/);
    assert.match(fase14, /insert_absensi_batch\(jsonb, boolean\)/);
    assert.match(fase14, /insert_absensi_batch\(jsonb, boolean, jsonb\)/);
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
    assert.match(peringkatJs, /daftar_peringkat_v2/);
    assert.match(peringkatJs, /indeks_keaktifan/);
    assert.match(seragamJs, /daftar_seragam_v2/);
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
    assert.match(peringkat, /v_daftar_proyek_absensi/);
    assert.match(seragam, /daftar_seragam_v2/);
    assert.match(seragam, /kpiSeragamAbsenLama/);
    assert.match(seragam, /filterProyekSeragam/);
    assert.match(master, /v_personel_terpadu_v3/);
    assert.match(master, /ubahUrutanMaster/);
    assert.match(masterHtml, /ringkasanMasterGlobal/);
    assert.match(masterHtml, /Kehadiran terbanyak/);
    assert.match(masterHtml, /Persentase tertinggi/);
});

test('fase 8 tetap aman dan UI terbaru mengelompokkan nama identik per kabupaten', () => {
    const source = read('db/fase8_master_data_rapi.sql');
    const master = read('js/master.js');
    const masterHtml = read('master.html');

    assert.match(source, /CREATE OR REPLACE FUNCTION public\.merge_relawan/);
    assert.match(source, /Hanya admin yang boleh menggabungkan relawan/);
    assert.match(source, /hanya nama dan asal organisasi yang sama yang boleh digabung/);
    assert.match(master, /normalisasiKunciMaster/);
    assert.match(master, /buatGrupDuplikatAman/);
    assert.match(master, /bukaModalMergeTerpilih/);
    assert.match(master, /manualMergeSelectedNips/);
    assert.match(master, /kategoriWilayahEfektif/);
    assert.match(master, /normalisasiJabatanMaster/);
    assert.match(masterHtml, /Gabungkan Semua Aman/);
    assert.match(masterHtml, /modalRapikanMaster/);
    assert.match(masterHtml, /Nama identik setelah normalisasi tanda baca dan kapitalisasi/i);
    assert.match(masterHtml, /perlu diperiksa manual/i);
    assert.match(masterHtml, /Kemiripan nama bukan bukti/i);
    assert.match(masterHtml, /risikoKandidatMirip/);
    assert.match(masterHtml, /filterKandidatMirip/);
    assert.match(masterHtml, /editDaerah/);
    assert.match(source, /= 'PUSAT'/);
    assert.match(source, /PJ \/ Admin/);
});

test('fase 9 menyediakan merge checkbox dengan editor profil dan transaksi server', () => {
    const source = read('db/fase9_merge_manual_terpilih.sql');
    const master = read('js/master.js');
    const masterHtml = read('master.html');

    assert.match(source, /CREATE OR REPLACE FUNCTION public\.merge_relawan_manual/);
    assert.match(source, /Hanya admin yang boleh melakukan merge manual/);
    assert.match(source, /row_number\(\) OVER/);
    assert.match(source, /log_duplikat_dihapus/);
    assert.match(source, /COMMIT;/);
    assert.match(master, /callSupabaseRpc\('merge_relawan_terpadu_v3'/);
    assert.match(master, /p_profile:/);
    assert.match(masterHtml, /masterSelectionActions/);
    assert.match(masterHtml, /btnMergeMasterTerpilih/);
    assert.match(masterHtml, /Ekspor/);
    assert.match(masterHtml, /Kelola Data/);
    assert.match(masterHtml, /centang minimal dua untuk Gabungkan/i);
    assert.match(masterHtml, /Pengaturan Hasil Merge/);
    assert.match(masterHtml, /mergeNama/);
    assert.match(masterHtml, /mergeOrg/);
    assert.match(masterHtml, /mergeDaerah/);
    assert.doesNotMatch(masterHtml, /bulkMasterBanner/);
    assert.doesNotMatch(masterHtml, /<th[^>]*>Aksi<\/th>/i);
    assert.doesNotMatch(masterHtml, /id="editKategoriWilayah"/);
    assert.doesNotMatch(masterHtml, /id="mergeKategoriWilayah"/);
    assert.doesNotMatch(masterHtml, /Kategori Wilayah/i);
    assert.doesNotMatch(read('panduan.html'), /<strong>Kategori Wilayah<\/strong>/i);
    assert.doesNotMatch(master, /bukaModalMergeDariTombol/);
    assert.doesNotMatch(read('js/app.js'), /function bukaExcelFilterMaster/);
    for (const helper of ['normalizeNama', 'bersihkanTitel', 'levenshtein', 'similarityRasio']) {
        assert.doesNotMatch(read('js/input.js'), new RegExp(`function ${helper}\\s*\\(`), `${helper} terduplikasi di input.js`);
    }
});

test('fase 13 menyediakan merge reversibel, CRUD organisasi, dan empat zona asal', () => {
    const source = read('db/fase13_merge_reversibel_organisasi_zona.sql');
    const master = read('js/master.js');
    const masterHtml = read('master.html');

    assert.match(source, /CREATE TABLE IF NOT EXISTS public\.riwayat_merge_personel/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.merge_relawan_tercatat/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.pisahkan_merge_personel/);
    assert.match(source, /snapshot_log/);
    assert.match(source, /snapshot_historis/);
    assert.match(source, /snapshot_seragam/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.simpan_organisasi/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.merge_organisasi/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.hapus_organisasi/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.gabungkan_semua_kandidat_mirip/);
    assert.match(source, /WHEN 'JAWA TIMUR' THEN 'zona_1'/);
    assert.match(source, /WHEN 'JAWA TENGAH' THEN 'zona_2'/);
    assert.match(source, /WHEN 'JAWA BARAT' THEN 'zona_3'/);
    assert.match(source, /WHEN 'KALIMANTAN TIMUR' THEN 'zona_4'/);
    assert.match(master, /callSupabaseRpc\('pisahkan_merge_personel'/);
    assert.match(master, /callSupabaseRpc\('merge_organisasi'/);
    assert.match(master, /zonaDariProvinsiMaster/);
    assert.match(masterHtml, /Organisasi & Zona/);
    assert.match(masterHtml, /Riwayat Merge/);
    assert.match(masterHtml, /Gabungkan Semua Kandidat/);
    assert.match(masterHtml, /Zona 1 — Jawa Timur, Bali/);
    assert.match(masterHtml, /Zona 4 — Sumatera, Kalimantan/);
});

test('normalisasi Master hanya memetakan PUSAT dan menyatukan PJ dengan Admin', () => {
    const context = {
        console,
        document: { addEventListener() {} }
    };
    vm.createContext(context);
    vm.runInContext(read('js/master.js'), context);

    assert.equal(context.kategoriWilayahEfektif({ asal_organisasi: ' pusat ', kategori_wilayah: 'zona_4' }), 'jombang');
    assert.equal(context.kategoriWilayahEfektif({ asal_organisasi: 'DPD JOMBANG', kategori_wilayah: 'luar_jombang' }), 'luar_jombang');
    assert.equal(context.normalisasiJabatanMaster('PJ'), 'PJ / Admin');
    assert.equal(context.normalisasiJabatanMaster('admin'), 'PJ / Admin');
    assert.equal(context.normalisasiJabatanMaster('Koordinator'), 'Koordinator');
    assert.equal(context.normalisasiNamaMaster('  A. Gunawan '), 'AGUNAWAN');
    assert.equal(context.rapikanNamaMaster('  a. gunawan  '), 'A. GUNAWAN');
    assert.equal(context.rapikanOrganisasiMaster(' dcp   ploso '), 'DPC PLOSO');
    assert.equal(context.rapikanOrganisasiMaster('mq13'), 'MQ 13');
    assert.equal(context.kabupatenMaster({ asal_organisasi: 'DPC PLOSO' }), 'JOMBANG');
    assert.equal(context.jarakNamaMaksimalSatu('TEGUH', 'TEGU'), true);
    assert.equal(context.jarakNamaMaksimalSatu('TEGUH', 'GUNAWAN'), false);
    assert.ok(context.bandingkanProfilMaster(
        { nip: 'TINGGI', persentase_hari: 80, total_hari: 8, total_sesi: 8 },
        { nip: 'RENDAH', persentase_hari: 70, total_hari: 40, total_sesi: 40 }
    ) < 0, 'persentase lebih tinggi harus dipertahankan walau total harinya lebih kecil');
    assert.ok(context.bandingkanProfilMaster(
        { nip: 'BANYAK', persentase_hari: 50, total_hari: 20, total_sesi: 21 },
        { nip: 'SEDIKIT', persentase_hari: 50, total_hari: 10, total_sesi: 30 }
    ) < 0, 'jika persentase sama, total hari menjadi pengikat pertama');
    const ringkasan = context.ringkasJaringanKandidatNamaMirip([
        { rows: [{ nip: '1', nama: 'ADI' }, { nip: '2', nama: 'ABDI' }] },
        { rows: [{ nip: '1', nama: 'ADI' }, { nip: '3', nama: 'AJI' }] }
    ]);
    assert.equal(ringkasan.pasangan, 2);
    assert.equal(ringkasan.profil, 3);
    assert.equal(ringkasan.jaringan, 1);
    assert.equal(ringkasan.terbesar, 3);
});

test('fase 10 menyediakan koreksi kehadiran, peringkat umum, dan stok seragam set', () => {
    const source = read('db/fase10_koreksi_stok_dan_deduplikasi.sql');
    const riwayat = read('js/riwayat.js');
    const riwayatHtml = read('riwayat.html');
    const peringkat = read('js/peringkat.js');
    const seragam = read('js/seragam.js');
    const seragamHtml = read('seragam.html');

    assert.match(source, /BEGIN;/);
    assert.match(source, /COMMIT;/);
    assert.match(source, /backup_fase10_master_relawan_20261002/);
    assert.match(source, /CREATE OR REPLACE VIEW public\.v_kandidat_duplikat_personel/);
    assert.match(source, /CREATE OR REPLACE VIEW public\.v_peringkat_personel_umum/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS public\.kehadiran_historis/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.simpan_koreksi_kehadiran/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.simpan_kehadiran_historis/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS public\.stok_item_seragam/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS public\.mutasi_stok_seragam/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.catat_mutasi_stok_seragam/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.simpan_status_seragam_set/);
    assert.match(source, /ukuran_atasan/);
    assert.match(source, /ukuran_bawahan/);
    assert.match(riwayat, /simpan_koreksi_kehadiran/);
    assert.match(riwayat, /simpan_kehadiran_historis/);
    assert.match(riwayatHtml, /Kelola Kehadiran/);
    assert.match(riwayatHtml, /Kehadiran historis tanpa tanggal pasti/);
    assert.match(peringkat, /daftar_peringkat_v2/);
    assert.match(seragam, /catat_mutasi_stok_seragam/);
    assert.match(seragam, /simpan_status_seragam_set/);
    assert.match(seragamHtml, /Ukuran Atasan/);
    assert.match(seragamHtml, /Ukuran Bawahan/);
    assert.match(seragamHtml, /Riwayat Mutasi Terakhir/);
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

test('fase 11 merapikan teks dan memulihkan log yatim tanpa menghapus data', () => {
    const source = read('db/fase11_perapian_aman_master.sql');
    const riwayat = read('js/riwayat.js');
    const riwayatHtml = read('riwayat.html');
    assert.match(source, /BEGIN;/);
    assert.match(source, /COMMIT;/);
    assert.match(source, /backup_fase11_master_relawan_20261002/);
    assert.match(source, /backup_fase11_log_absensi_20261002/);
    assert.match(source, /WITH master_norm AS/);
    assert.match(source, /HAVING count\(\*\) = 1/);
    assert.match(source, /existing\.tanggal = l\.tanggal/);
    assert.doesNotMatch(source, /DELETE\s+FROM\s+public\.log_absensi/i);
    assert.doesNotMatch(source, /DELETE\s+FROM\s+public\.master_relawan/i);
    assert.match(riwayat, /riwayatMasterNips/);
    assert.match(riwayat, /sinkronkanPersonelEditLog/);
    assert.match(riwayat, /payload\.nip = personel\.nip/);
    assert.match(riwayatHtml, /filterYatim/);
    assert.match(riwayatHtml, /summaryYatim/);
    assert.match(riwayatHtml, /editLogPersonel/);
});

test('fase 12 memilih lebih dari setengah kandidat tanpa merge berantai', () => {
    const source = read('db/fase12_merge_lebih_50_persen.sql');
    const master = read('js/master.js');

    assert.match(source, /BEGIN;/);
    assert.match(source, /COMMIT;/);
    assert.match(source, /backup_fase12_master_relawan_20261003/);
    assert.match(source, /audit_merge_fase12_20261003/);
    assert.match(source, /ALTER TABLE public\.backup_fase12_master_relawan_20261003 ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /ALTER TABLE public\.audit_merge_fase12_20261003 ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /CREATE TEMP TABLE fase12_nip_terpakai/);
    assert.match(source, /EXIT WHEN v_jumlah >= 250/);
    assert.match(source, /IF v_jumlah < 242/);
    assert.match(source, /kandidat\.pct_a > kandidat\.pct_b/);
    assert.match(source, /source_nip text NOT NULL UNIQUE/);
    assert.match(source, /target_nip text NOT NULL UNIQUE/);
    assert.match(source, /v_sumber_tersisa <> 0/);
    assert.match(master, /Number\(row\?\.persentase_hari \|\| 0\)/);
    assert.match(master, /persentase tertinggi dipertahankan/i);
});

test('fase 19 memulihkan router cepat peringkat tanpa memasukkan personel khusus', () => {
    const source = read('db/fase19_performa_peringkat_reguler.sql');
    const peringkat = read('js/peringkat.js');
    const sw = read('sw.js');

    assert.match(source, /pg_get_functiondef/);
    assert.match(source, /FUNCTION public\.daftar_peringkat_operator_v2\(/);
    assert.match(source, /position\('kategori_personel' IN v_def\) > 0/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.daftar_peringkat_admin_v2/);
    assert.match(source, /SECURITY DEFINER/);
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.daftar_peringkat_v2/);
    assert.match(source, /ELSIF v_role = 'koordinator'/);
    assert.match(source, /NOTIFY pgrst, 'reload schema'/);
    assert.doesNotMatch(peringkat, /Terapkan migrasi Fase 14/);
    assert.match(peringkat, /statement timeout\|57014/);
    assert.match(sw, /relawansync-v34-ukuran-dinamis-cache/);
});

test('fase 20 menyeragamkan profil, zona, seragam, sumber frontend, dan export', () => {
    const sql = read('db/fase20_penyeragaman_sistem.sql');
    const master = read('js/master.js');
    const input = read('js/input.js');
    const dashboard = read('js/dashboard.js');
    const statistik = read('js/statistik.js');
    const seragam = read('js/seragam.js');
    const app = read('js/app.js');
    const domain = read('js/domain.js');

    assert.match(sql, /backup_fase20_master_relawan_20261005/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS ukuran_bawahan_seragam/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.wilayah_personel_terpadu/);
    assert.match(sql, /CREATE OR REPLACE VIEW public\.v_personel_terpadu_v3/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.simpan_personel_v3/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.merge_relawan_terpadu_v3/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.detail_personel_v3/);
    assert.match(sql, /CREATE OR REPLACE VIEW public\.v_audit_konsistensi_personel_v3/);
    assert.match(master, /simpan_personel_v3/);
    assert.match(master, /detail_personel_v3/);
    assert.match(input, /v_personel_terpadu_v3\?[^'\n]*kategori_personel=eq\.reguler/);
    assert.match(dashboard, /v_personel_terpadu_v3\?[^'\n]*kategori_personel=eq\.reguler/);
    assert.match(statistik, /v_personel_terpadu_v3\?[^'\n]*kategori_personel=eq\.reguler/);
    assert.match(seragam, /ambilSemuaSeragamUntukExport/);
    assert.match(app, /proses_mutasi_stok_terjadwal/);
    assert.match(domain, /PROYEK_KHUSUS/);
    assert.match(domain, /UKURAN_BAWAHAN/);

    for (const page of ['index.html', 'input.html', 'riwayat.html', 'kalender.html', 'statistik.html', 'master.html', 'peringkat.html', 'seragam.html', 'panduan.html']) {
        const html = read(page);
        assert.match(html, /<script src="js\/domain\.js"><\/script>/, `${page} belum memuat kontrak domain`);
        assert.ok(html.indexOf('js/domain.js') < html.indexOf('js/app.js'), `${page}: domain harus dimuat sebelum app`);
    }

    for (const file of ['js/input.js', 'js/riwayat.js', 'js/seragam.js']) {
        assert.doesNotMatch(read(file), /v_status_seragam\?/i, `${file} masih memakai view seragam lama`);
    }
});

test('fase 21 menyeragamkan pencarian filter urutan batas baris dan export daftar', () => {
    const sql = read('db/fase21_kontrol_daftar_terpadu.sql');
    const peringkat = read('js/peringkat.js');
    const seragam = read('js/seragam.js');
    const riwayat = read('js/riwayat.js');

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.daftar_peringkat_operator_v3/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.daftar_peringkat_admin_v3/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.daftar_peringkat_v3/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.daftar_seragam_operator_v3/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.daftar_seragam_admin_v3/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.daftar_seragam_v3/);
    assert.match(sql, /greatest\(1, least\(coalesce\(p_limit, 50\), 200\)\)/i);
    assert.match(sql, /SECURITY INVOKER/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.daftar_peringkat_v3[^;]+FROM PUBLIC, anon/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.daftar_seragam_v3[^;]+FROM PUBLIC, anon/);
    assert.match(peringkat, /daftar_peringkat_v3/);
    assert.match(peringkat, /p_urut: urut/);
    assert.match(seragam, /daftar_seragam_v3/);
    assert.match(seragam, /p_urut: urut/);
    assert.match(riwayat, /riwayatFilteredData\.forEach/);
    assert.match(riwayat, /renderTabelRiwayat\(riwayatFilteredData, true\)/);

    const controlContracts = [
        ['master.html', ['cariData', 'filterZonaMaster', 'filterJenisMaster', 'sortMaster', 'limitData', 'resetKontrolMaster']],
        ['peringkat.html', ['cariPeringkat', 'filterProyekPeringkat', 'filterStatusPeringkat', 'sortPeringkat', 'limitPeringkat', 'resetKontrolPeringkat']],
        ['seragam.html', ['cariSeragam', 'filterProyekSeragam', 'filterProsesSeragam', 'filterPenguasaanSeragam', 'sortSeragam', 'limitSeragam', 'resetKontrolSeragam']],
        ['statistik.html', ['searchVolunteer', 'filterBulanRekap', 'sortVolunteer', 'limitVolunteer', 'resetKontrolStatistik']],
        ['riwayat.html', ['filterCari', 'filterTanggal', 'sortRiwayat', 'limitRiwayat', 'resetFilter']]
    ];
    for (const [file, markers] of controlContracts) {
        const html = read(file);
        assert.match(html, /data-toolbar/, `${file} belum memakai toolbar terpadu`);
        for (const marker of markers) assert.match(html, new RegExp(marker), `${file}: ${marker} belum tersedia`);
    }
});

test('fase 22 menyediakan master jenis ukuran seragam dinamis di seluruh alur', () => {
    const sql = read('db/fase22_jenis_ukuran_seragam.sql');
    const html = read('seragam.html');
    const seragam = read('js/seragam.js');
    const master = read('js/master.js');

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.tambah_jenis_ukuran_seragam/);
    assert.match(sql, /IF NOT public\.fase17_admin\(\)/);
    assert.match(sql, /jumlah_tersedia, catatan\)\s*\n\s*VALUES \(v_jenis, v_ukuran, 0/);
    assert.match(sql, /upper\(regexp_replace\(trim\(ukuran\)/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.tambah_jenis_ukuran_seragam\(text,text,text\) FROM PUBLIC, anon/);
    assert.match(html, /id="ukuranBaruJenis"/);
    assert.match(html, /id="ukuranBaruNama"/);
    assert.match(html, /onclick="tambahJenisUkuranSeragam\(\)"/);
    assert.match(seragam, /callSupabaseRpc\('tambah_jenis_ukuran_seragam'/);
    assert.match(seragam, /function daftarUkuranSeragam/);
    assert.match(seragam, /segarkanOpsiUkuranSeragam\(\)/);
    assert.match(master, /stok_item_seragam\?select=jenis,ukuran/);
    assert.match(master, /function isiOpsiUkuranMaster/);
});
