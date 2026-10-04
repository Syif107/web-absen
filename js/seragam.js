// ================================================================
// KONTROL SERAGAM
// ================================================================

let dataStatusSeragam = [];
let dataStokSeragam = [];
let dataMutasiStokSeragam = [];
let dataPenerimaTersimpan = [];
let kehadiranProyekSeragam = [];
let nipSeragamAktif = '';
let parameterSeragamSudahDibuka = false;
let stokSeragamFase10Aktif = false;
let seragamKpi = {};
let seragamTotal = 0;
let seragamPage = 1;
const seragamPageSize = 50;
let seragamTimer = null;
let stokBatchCounter = 0;

const PROYEK_KHUSUS_SERAGAM = [
    'Perpustakaan Tashawwuf',
    "Masjid Raya Fatchan Mubiina Chaddun 'Adhiim",
    'Monumen Semboyan Sang Mursyid',
    "Kanal Ta'at",
    'Gapura Syukur'
];

const LABEL_PROSES = {
    belum_memenuhi: 'Belum memenuhi', memenuhi_syarat: 'Memenuhi syarat',
    direncanakan: 'Direncanakan', menunggu_stok: 'Menunggu stok/ukuran',
    siap_diserahkan: 'Siap diserahkan', sudah_diserahkan: 'Sudah diserahkan'
};

const LABEL_PENGUASAAN = {
    belum_memiliki: 'Belum memiliki', dipegang_personel: 'Dipegang personel',
    dititipkan_kantor: 'Dititipkan di kantor', perlu_diserahkan_kembali: 'Perlu diserahkan kembali',
    rusak_hilang: 'Rusak/hilang', menunggu_penggantian: 'Menunggu penggantian'
};

document.addEventListener('DOMContentLoaded', async () => {
    await siapkanFilterProyekSeragam();
    await loadSeragam(1);
});

async function loadSeragam(page = seragamPage) {
    const tbody = document.getElementById('tabelSeragam');
    const errorBox = document.getElementById('seragamError');
    seragamPage = Math.max(1, Number(page) || 1);
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="p-10 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat kontrol seragam...</td></tr>';
    if (errorBox) errorBox.classList.add('hidden');

    try {
        await callSupabaseRpc('proses_mutasi_stok_terjadwal', {});
        const proyek = document.getElementById('filterProyekSeragam')?.value || 'semua';
        const proses = document.getElementById('filterProsesSeragam')?.value || 'semua';
        const penguasaan = document.getElementById('filterPenguasaanSeragam')?.value || 'semua';
        const cari = (document.getElementById('cariSeragam')?.value || '').trim();
        const [statusRes, stokRes, mutasiRes] = await Promise.all([
            callSupabaseRpc('daftar_seragam_v2', {
                p_proyek: proyek, p_proses: proses, p_penguasaan: penguasaan,
                p_cari: cari, p_limit: seragamPageSize,
                p_offset: (seragamPage - 1) * seragamPageSize
            }),
            muatStokSeragamKompatibel(),
            supabaseFetch('mutasi_stok_seragam?select=*&order=tanggal_efektif.desc,dibuat_pada.desc&limit=100', 'GET')
        ]);
        if (statusRes.status !== 'success' || stokRes.status !== 'success') {
            throw new Error(statusRes.message || stokRes.message || 'Gagal membaca data seragam');
        }
        dataStatusSeragam = Array.isArray(statusRes.rows) ? statusRes.rows : [];
        seragamTotal = Number(statusRes.total || 0);
        seragamKpi = statusRes.kpi || {};
        dataStokSeragam = stokRes.data || [];
        dataMutasiStokSeragam = mutasiRes.status === 'success' ? (mutasiRes.data || []) : [];
        dataPenerimaTersimpan = dataStatusSeragam.filter(row => row.record_tersimpan);
        renderKpiSeragam();
        renderSeragam(true);
        tampilkanNotifikasiSeragam();
        bukaDariParameter();
    } catch (error) {
        console.error('Kontrol Seragam:', error);
        if (errorBox) {
            errorBox.textContent = 'Fitur seragam belum dapat dibaca. Pastikan migrasi Fase 17 sudah diterapkan lalu muat ulang halaman.';
            errorBox.classList.remove('hidden');
        }
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="p-10 text-center text-red-500 font-bold">Data seragam belum tersedia.</td></tr>';
    }
}

function jadwalkanSeragam() {
    clearTimeout(seragamTimer);
    seragamTimer = setTimeout(() => loadSeragam(1), 300);
}

async function muatStokSeragamKompatibel() {
    const fase10 = await supabaseFetchAll('stok_item_seragam?select=*&order=jenis.asc,ukuran.asc');
    if (fase10.status === 'success') {
        stokSeragamFase10Aktif = true;
        return fase10;
    }
    stokSeragamFase10Aktif = false;
    const lama = await supabaseFetchAll('stok_seragam?select=*&order=ukuran.asc');
    if (lama.status === 'success') lama.data = (lama.data || []).map(row => ({ ...row, jenis: 'atasan' }));
    return lama;
}

function uniqueNip(rows) { return new Set(rows.map(r => r.nip).filter(Boolean)).size; }
function setKpi(id, value) { const el = document.getElementById(id); if (el) el.textContent = Number(value || 0).toLocaleString('id-ID'); }

function renderKpiSeragam() {
    setKpi('kpiSeragamMemenuhi', seragamKpi.memenuhi);
    setKpi('kpiSeragamRencana', seragamKpi.direncanakan);
    setKpi('kpiSeragamTunggu', seragamKpi.menunggu);
    setKpi('kpiSeragamSelesai', seragamKpi.diserahkan);
    setKpi('kpiSeragamTitip', seragamKpi.dititipkan);
    setKpi('kpiSeragamKembali', seragamKpi.perlu_kembali);
    setKpi('kpiSeragamAbsenLama', seragamKpi.absen_lama);
}

function tampilkanNotifikasiSeragam() {
    const alerts = Number(seragamKpi.perlu_kembali || 0);
    const box = document.getElementById('notifikasiSeragam');
    if (box) {
        if (!alerts) box.classList.add('hidden');
        else {
            document.getElementById('notifikasiSeragamText').textContent = `${alerts} personel luar Jombang kembali hadir saat seragamnya masih tercatat dititipkan di kantor. Buka data personel tersebut dan ubah menjadi “Dipegang personel” setelah seragam diserahkan kembali.`;
            box.classList.remove('hidden');
        }
    }
    const absenLama = Number(seragamKpi.absen_lama || 0);
    const absenBox = document.getElementById('notifikasiAbsenLama');
    if (absenBox) {
        if (!absenLama) absenBox.classList.add('hidden');
        else {
            document.getElementById('notifikasiAbsenLamaText').textContent = `${absenLama} penerima tercatat sudah menerima seragam, tetapi tidak memiliki kehadiran selama lebih dari 30 hari. Periksa status keberadaan dan hubungi petugas wilayah bila perlu.`;
            absenBox.classList.remove('hidden');
        }
    }
}

async function siapkanFilterProyekSeragam() {
    const select = document.getElementById('filterProyekSeragam');
    const group = document.getElementById('opsiLainnyaSeragam');
    if (!select || !group) return;
    const res = await supabaseFetchAll('v_daftar_proyek_absensi?select=kategori,nama_proyek&order=nama_proyek.asc');
    if (res.status !== 'success') return;
    kehadiranProyekSeragam = res.data || [];
    const names = [...new Set(kehadiranProyekSeragam
        .filter(row => row.kategori === 'lainnya' && row.nama_proyek)
        .map(row => row.nama_proyek))]
        .filter(name => !PROYEK_KHUSUS_SERAGAM.includes(name))
        .sort((a, b) => a.localeCompare(b, 'id'));
    group.innerHTML = names.map(name => `<option value="${escapeAttribute(`proyek:${name}`)}">${escapeHTML(name)}</option>`).join('');
}

function labelFilterProyekSeragam(value) {
    if (value === 'semua') return 'Semua Proyek';
    if (value === 'khususul_khusus') return '5 Proyek Khususul Khusus';
    if (value === 'lainnya') return 'Semua Proyek Lainnya';
    return String(value || '').replace(/^proyek:/, '');
}

function cocokFilterProyekSeragam(row, value) {
    if (!value || value === 'semua') return true;
    if (value === 'khususul_khusus' || value === 'lainnya') return row.jalur_kelayakan === value || kehadiranProyekSeragam.some(proyek => proyek.nip === row.nip && proyek.kategori === value);
    if (!value.startsWith('proyek:')) return true;
    const namaProyek = value.slice('proyek:'.length);
    return kehadiranProyekSeragam.some(proyek => proyek.nip === row.nip && proyek.nama_proyek === namaProyek);
}

function warnaProses(status) {
    if (status === 'sudah_diserahkan') return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300';
    if (status === 'siap_diserahkan' || status === 'memenuhi_syarat') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
    if (status === 'menunggu_stok') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
    if (status === 'direncanakan') return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
    return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}

function warnaPenguasaan(status) {
    if (status === 'perlu_diserahkan_kembali' || status === 'rusak_hilang') return 'text-rose-600 dark:text-rose-300';
    if (status === 'dititipkan_kantor') return 'text-violet-600 dark:text-violet-300';
    if (status === 'dipegang_personel') return 'text-emerald-600 dark:text-emerald-300';
    return 'text-slate-500 dark:text-slate-400';
}

function renderSeragam(hanyaGambar = false) {
    if (!hanyaGambar) return loadSeragam(1);
    const tbody = document.getElementById('tabelSeragam');
    if (!tbody) return;
    const proyekFilter = document.getElementById('filterProyekSeragam')?.value || 'semua';
    let rows = [...dataStatusSeragam];

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-10 text-center text-slate-400 font-bold">Tidak ada data sesuai filter.</td></tr>';
        renderPaginationSeragam(proyekFilter);
        return;
    }

    tbody.innerHTML = rows.map(r => {
        const kelayakan = r.pengecualian_aturan
            ? `<span class="font-black text-violet-600 dark:text-violet-300">Personel khusus</span><p class="text-[10px] text-slate-400">Di luar syarat kehadiran otomatis</p>`
            : r.memenuhi_syarat
            ? `<span class="font-black text-emerald-600 dark:text-emerald-300">Memenuhi</span><p class="text-[10px] text-slate-400">${escapeHTML(labelJalur(r.jalur_kelayakan))} • ${formatTanggalSeragam(r.tanggal_memenuhi)}</p>`
            : '<span class="font-bold text-slate-400">Belum memenuhi</span>';
        const alertIcon = r.notifikasi_pengembalian ? '<i class="fa-solid fa-bell text-amber-500 mr-1" title="Perlu diserahkan kembali"></i>' : (r.tidak_hadir_30_hari ? '<i class="fa-solid fa-user-clock text-rose-500 mr-1" title="Tidak hadir lebih dari 30 hari"></i>' : '');
        const rowClass = r.notifikasi_pengembalian ? 'bg-amber-50/70 dark:bg-amber-500/5' : (r.tidak_hadir_30_hari ? 'bg-rose-50/70 dark:bg-rose-500/5' : 'hover:bg-indigo-50/40 dark:hover:bg-indigo-500/5');
        const ukuranAtasan = r.ukuran_atasan || r.ukuran_dibutuhkan || '';
        const kodeAtasan = r.kode_atasan || r.kode_seragam || '';
        const ukuranBawahan = r.ukuran_bawahan || '';
        const kodeBawahan = r.kode_bawahan || '';
        return `<tr class="${rowClass}">
            <td class="px-4 py-3"><p class="font-extrabold">${alertIcon}${escapeHTML(r.nama)}</p><p class="text-[10px] text-slate-400 font-mono">${escapeHTML(r.nip)} • ${escapeHTML(labelWilayahSeragam(r.zona_asal))}</p><p class="text-[10px] text-slate-400">${escapeHTML(r.asal_daerah || 'Daerah belum diisi')}</p></td>
            <td class="px-4 py-3 text-xs">${kelayakan}</td>
            <td class="px-4 py-3"><p class="font-black">Atasan: ${escapeHTML(ukuranAtasan || 'Belum diisi')}</p><p class="text-[10px] text-slate-400 font-mono">${escapeHTML(kodeAtasan || 'Tanpa kode')}</p><p class="font-black mt-1">Bawahan: ${escapeHTML(ukuranBawahan || 'Belum diisi')}</p><p class="text-[10px] text-slate-400 font-mono">${escapeHTML(kodeBawahan || 'Tanpa kode')}</p></td>
            <td class="px-4 py-3"><span class="inline-flex px-2 py-1 rounded-full text-[10px] font-black ${warnaProses(r.status_proses)}">${escapeHTML(LABEL_PROSES[r.status_proses] || r.status_proses)}</span>${r.status_terjadwal ? '<p class="text-[10px] font-black text-blue-600 mt-1"><i class="fa-solid fa-clock mr-1"></i>Terjadwal</p>' : ''}</td>
            <td class="px-4 py-3 text-xs font-bold ${warnaPenguasaan(r.status_penguasaan)}">${escapeHTML(LABEL_PENGUASAAN[r.status_penguasaan] || r.status_penguasaan)}</td>
            <td class="px-4 py-3 text-xs"><p>${r.tanggal_diserahkan ? `Diserahkan ${formatTanggalSeragam(r.tanggal_diserahkan)}` : '-'}</p><p class="text-[10px] text-slate-400 mt-1">Hadir ${formatTanggalSeragam(r.tanggal_hadir_terakhir)}</p>${r.tidak_hadir_30_hari ? `<p class="text-[10px] font-black text-rose-600 dark:text-rose-300 mt-1">Tidak hadir ${Number(r.hari_tidak_hadir || 0)} hari</p>` : ''}</td>
            <td class="px-4 py-3 text-xs text-slate-500 max-w-[180px]"><p class="line-clamp-2">${escapeHTML(r.catatan || '-')}</p></td>
            <td class="px-4 py-3 text-center"><button data-nip="${escapeAttribute(r.nip)}" onclick="bukaKelolaSeragamDariTombol(this)" class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"><i class="fa-solid fa-pen-to-square mr-1"></i> Kelola</button></td>
        </tr>`;
    }).join('');
    renderPaginationSeragam(proyekFilter);
}

function labelJalur(value) {
    return { khususul_khusus: '5 Proyek Khususul Khusus', lainnya: 'Proyek Lainnya', zona_4: 'Zona 4' }[value] || '-';
}
function labelWilayahSeragam(value) {
    return {
        zona_1:'Zona 1 — Jawa Timur & Bali',
        zona_2:'Zona 2 — Jawa Tengah & DIY',
        zona_3:'Zona 3 — Jawa Barat, Jakarta & Banten',
        zona_4:'Zona 4 — Sumatera & Kalimantan'
    }[value] || 'Zona belum diisi';
}

function renderPaginationSeragam(proyekFilter) {
    const pages = Math.max(1, Math.ceil(seragamTotal / seragamPageSize));
    if (seragamPage > pages) return loadSeragam(pages);
    const start = seragamTotal ? (seragamPage - 1) * seragamPageSize + 1 : 0;
    const end = Math.min(seragamPage * seragamPageSize, seragamTotal);
    const info = document.getElementById('infoSeragam');
    if (info) info.textContent = `${start}-${end} dari ${seragamTotal.toLocaleString('id-ID')} personel • ${labelFilterProyekSeragam(proyekFilter)}`;
    const pageInfo = document.getElementById('seragamPageInfo');
    if (pageInfo) pageInfo.textContent = `Halaman ${seragamPage} / ${pages}`;
    const prev = document.getElementById('btnSeragamPrev');
    const next = document.getElementById('btnSeragamNext');
    if (prev) prev.disabled = seragamPage <= 1;
    if (next) next.disabled = seragamPage >= pages;
}

function gantiHalamanSeragam(delta) {
    return loadSeragam(seragamPage + Number(delta || 0));
}
function formatTanggalSeragam(value) {
    if (!value) return '-';
    const d = new Date(`${String(value).slice(0,10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
}

function bukaKelolaSeragamDariTombol(button) { bukaKelolaSeragam(button.dataset.nip || ''); }

async function bukaKelolaSeragam(nip) {
    const row = dataStatusSeragam.find(r => r.nip === nip);
    if (!row) return;
    nipSeragamAktif = nip;
    const tersimpan = dataPenerimaTersimpan.find(r => r.nip === nip) || {};
    document.getElementById('seragamNip').value = nip;
    document.getElementById('modalSeragamNama').textContent = `${row.nama || '-'} • ${nip} • ${labelWilayahSeragam(row.zona_asal)}`;
    document.getElementById('seragamStatusProses').value = row.status_proses || 'belum_memenuhi';
    document.getElementById('seragamUkuranAtasan').value = row.ukuran_atasan || row.ukuran_dibutuhkan || '';
    document.getElementById('seragamUkuranBawahan').value = row.ukuran_bawahan || '';
    document.getElementById('seragamStatusPenguasaan').value = row.status_penguasaan || 'belum_memiliki';
    document.getElementById('seragamKodeAtasan').value = row.kode_atasan || row.kode_seragam || '';
    document.getElementById('seragamKodeBawahan').value = row.kode_bawahan || '';
    document.getElementById('seragamTanggalRencana').value = String(row.tanggal_rencana || '').slice(0,10);
    document.getElementById('seragamTanggalDiserahkan').value = String(row.tanggal_diserahkan || '').slice(0,10);
    document.getElementById('seragamTanggalEfektif').value = formatDatetimeLocal(row.tanggal_efektif_status || new Date());
    document.getElementById('seragamCatatan').value = row.catatan || '';
    document.getElementById('seragamAturan').checked = Boolean(row.aturan_disetujui);
    document.getElementById('seragamDataLama').checked = Boolean(row.data_lama);
    document.getElementById('seragamKurangiStok').checked = !tersimpan.nip;
    sesuaikanFormSeragam();
    document.getElementById('modalKelolaSeragam').classList.remove('hidden');
    await loadRiwayatMini(nip);
}

function tutupModalKelolaSeragam() { document.getElementById('modalKelolaSeragam')?.classList.add('hidden'); nipSeragamAktif = ''; }

function sesuaikanFormSeragam() {
    const lama = document.getElementById('seragamDataLama').checked;
    const selesai = document.getElementById('seragamStatusProses').value === 'sudah_diserahkan';
    document.getElementById('seragamKurangiStok').disabled = lama || !selesai;
    if (lama) document.getElementById('seragamKurangiStok').checked = false;
    if (selesai && !document.getElementById('seragamTanggalDiserahkan').value) {
        document.getElementById('seragamTanggalDiserahkan').value = new Date().toISOString().slice(0,10);
    }
}

async function loadRiwayatMini(nip) {
    const box = document.getElementById('riwayatSeragamMini');
    box.textContent = 'Memuat riwayat...';
    const res = await supabaseFetch(`seragam_riwayat?select=*&nip=eq.${encodeURIComponent(nip)}&order=dibuat_pada.desc&limit=5`, 'GET');
    if (res.status !== 'success' || !Array.isArray(res.data) || !res.data.length) { box.textContent = 'Belum ada riwayat.'; return; }
    box.innerHTML = res.data.map(item => `<div class="flex justify-between gap-3 border-b border-slate-200 dark:border-slate-600 pb-1"><span>${escapeHTML(LABEL_PROSES[item.status_proses] || item.status_proses)} • ${escapeHTML(LABEL_PENGUASAAN[item.status_penguasaan] || item.status_penguasaan)}</span><span class="text-slate-400 whitespace-nowrap">${new Date(item.dibuat_pada).toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short'})}</span></div>`).join('');
}

async function simpanSeragam(event) {
    event.preventDefault();
    const btn = document.getElementById('btnSimpanSeragam');
    const status = document.getElementById('seragamStatusProses').value;
    const ukuranAtasan = document.getElementById('seragamUkuranAtasan').value.trim();
    const ukuranBawahan = document.getElementById('seragamUkuranBawahan').value.trim();
    const dataLama = document.getElementById('seragamDataLama').checked;
    if (status === 'sudah_diserahkan' && !ukuranAtasan) { showToast('Ukuran atasan wajib diisi.', 'error'); return; }
    if (status === 'sudah_diserahkan' && !dataLama && !ukuranBawahan) { showToast('Ukuran bawahan wajib diisi untuk penyerahan baru.', 'error'); return; }
    if (status === 'sudah_diserahkan' && document.getElementById('seragamStatusPenguasaan').value === 'belum_memiliki') { showToast('Pilih keberadaan seragam setelah diserahkan.', 'error'); return; }
    if (status === 'sudah_diserahkan' && !dataLama && !document.getElementById('seragamAturan').checked) { showToast('Konfirmasi ketentuan seragam terlebih dahulu.', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    try {
        const res = await callSupabaseRpc('simpan_status_seragam_set_v2', {
            p_nip: nipSeragamAktif,
            p_status_proses: status,
            p_ukuran_atasan: ukuranAtasan,
            p_ukuran_bawahan: ukuranBawahan,
            p_status_penguasaan: document.getElementById('seragamStatusPenguasaan').value,
            p_tanggal_rencana: document.getElementById('seragamTanggalRencana').value || null,
            p_tanggal_diserahkan: document.getElementById('seragamTanggalDiserahkan').value || null,
            p_kode_atasan: document.getElementById('seragamKodeAtasan').value.trim().toUpperCase() || null,
            p_kode_bawahan: document.getElementById('seragamKodeBawahan').value.trim().toUpperCase() || null,
            p_catatan: document.getElementById('seragamCatatan').value.trim() || null,
            p_aturan_disetujui: document.getElementById('seragamAturan').checked,
            p_data_lama: dataLama,
            p_kurangi_stok: document.getElementById('seragamKurangiStok').checked && !dataLama,
            p_tanggal_efektif: datetimeLocalKeIso(document.getElementById('seragamTanggalEfektif').value)
        });
        if (res.status !== 'success' || res.ok === false) throw new Error(res.message || 'Database menolak perubahan status');
        showToast('Status seragam berhasil diperbarui.', 'success');
        tutupModalKelolaSeragam();
        await loadSeragam();
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Gagal menyimpan status seragam.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i> Simpan Status';
    }
}

function bukaModalStok() {
    renderRingkasanStok();
    renderMutasiStok();
    const tanggal = document.getElementById('stokTanggalEfektif');
    if (tanggal && !tanggal.value) tanggal.value = formatDatetimeLocal(new Date());
    const rows = document.getElementById('stokBatchRows');
    if (rows && !rows.children.length) {
        tambahBarisStok('atasan', 'M', 'masuk', 1);
        tambahBarisStok('bawahan', '30', 'masuk', 1);
    }
    if (!stokSeragamFase10Aktif) showToast('Saldo lama masih dapat dilihat. Terapkan migrasi Fase 10 untuk mencatat transaksi stok atasan dan bawahan.', 'warning');
    document.getElementById('modalStokSeragam').classList.remove('hidden');
}
function tutupModalStok() { document.getElementById('modalStokSeragam')?.classList.add('hidden'); }

function renderRingkasanStok() {
    const box = document.getElementById('ringkasanStokSeragam');
    if (!box) return;
    const rows = [...dataStokSeragam].sort((a, b) => String(a.jenis).localeCompare(String(b.jenis), 'id') || String(a.ukuran).localeCompare(String(b.ukuran), 'id', { numeric: true }));
    box.innerHTML = rows.length ? rows.map(row => `<div class="rounded-xl border border-slate-200 dark:border-slate-700 p-3"><p class="text-[9px] font-black uppercase text-slate-400">${row.jenis === 'bawahan' ? 'Bawahan' : 'Atasan'}</p><p class="font-black mt-1">${escapeHTML(row.ukuran)}</p><p class="text-lg font-black ${Number(row.jumlah_tersedia || 0) > 0 ? 'text-emerald-600' : 'text-rose-500'}">${Number(row.jumlah_tersedia || 0).toLocaleString('id-ID')}</p></div>`).join('') : '<p class="col-span-full text-xs text-slate-400">Belum ada saldo stok.</p>';
}

function labelTipeMutasi(value) {
    return {
        saldo_awal: 'Saldo awal', masuk: 'Stok masuk', keluar_penyerahan: 'Penyerahan',
        koreksi_tambah: 'Koreksi tambah', koreksi_kurang: 'Koreksi kurang',
        retur_permanen: 'Kembali ke stok', rusak_hilang: 'Rusak/hilang'
    }[value] || value || '-';
}

function renderMutasiStok() {
    const tbody = document.getElementById('riwayatMutasiStok');
    if (!tbody) return;
    const rows = dataMutasiStokSeragam.slice(0, 30);
    tbody.innerHTML = rows.length ? rows.map(row => {
        const status = row.status_transaksi || 'diterapkan';
        const statusClass = status === 'diterapkan' ? 'text-emerald-600' : status === 'terjadwal' ? 'text-blue-600' : 'text-rose-600';
        return `<tr class="border-t border-slate-100 dark:border-slate-700"><td class="p-2 whitespace-nowrap">${new Date(row.tanggal_efektif || row.dibuat_pada).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</td><td class="p-2 font-bold">${row.jenis === 'bawahan' ? 'Bawahan' : 'Atasan'} ${escapeHTML(row.ukuran)}</td><td class="p-2">${escapeHTML(labelTipeMutasi(row.tipe))}</td><td class="p-2 text-right font-black ${Number(row.perubahan) >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${Number(row.perubahan) >= 0 ? '+' : ''}${Number(row.perubahan || 0)}</td><td class="p-2 text-right font-black">${Number(row.saldo_setelah || 0)}</td><td class="p-2 font-black ${statusClass}">${escapeHTML(status)}</td><td class="p-2 text-slate-500">${escapeHTML(row.catatan || '-')}</td><td class="p-2"><div class="flex justify-center gap-1"><button type="button" onclick="editTanggalMutasiStok(${Number(row.id)})" class="w-8 h-8 rounded-lg bg-blue-100 text-blue-700" title="Edit tanggal"><i class="fa-solid fa-pen-to-square"></i></button><button type="button" onclick="hapusMutasiStok(${Number(row.id)})" class="w-8 h-8 rounded-lg bg-red-100 text-red-700" title="Hapus permanen"><i class="fa-solid fa-trash"></i></button></div></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="p-5 text-center text-slate-400">Belum ada riwayat mutasi.</td></tr>';
}

function pilihanUkuranStok(jenis, selected = '') {
    const values = jenis === 'bawahan'
        ? ['20','22','24','26','28','30','32','34','36','38','40','Khusus']
        : ['S','M','L','XL','XXL','XXXL','Khusus'];
    return values.map(value => `<option value="${escapeAttribute(value)}" ${value === selected ? 'selected' : ''}>${escapeHTML(value)}</option>`).join('');
}

function tambahBarisStok(jenis = 'atasan', ukuran = '', tipe = 'masuk', jumlah = 1, catatan = '') {
    const box = document.getElementById('stokBatchRows');
    if (!box) return;
    const id = ++stokBatchCounter;
    const row = document.createElement('div');
    row.className = 'stok-batch-row grid grid-cols-1 md:grid-cols-[120px_1fr_160px_100px_1fr_38px] gap-2 p-2 rounded-xl bg-white/70 dark:bg-slate-800/50 border border-amber-200 dark:border-amber-500/20';
    row.dataset.rowId = id;
    row.innerHTML = `<select data-field="jenis" onchange="ubahJenisBarisStok(this)" class="px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs font-bold"><option value="atasan" ${jenis === 'atasan' ? 'selected' : ''}>Atasan</option><option value="bawahan" ${jenis === 'bawahan' ? 'selected' : ''}>Bawahan</option></select><select data-field="ukuran" class="px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs font-bold">${pilihanUkuranStok(jenis, ukuran)}</select><select data-field="tipe" class="px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs font-bold"><option value="masuk" ${tipe === 'masuk' ? 'selected' : ''}>Stok masuk</option><option value="koreksi_tambah" ${tipe === 'koreksi_tambah' ? 'selected' : ''}>Koreksi tambah</option><option value="koreksi_kurang" ${tipe === 'koreksi_kurang' ? 'selected' : ''}>Koreksi kurang</option><option value="retur_permanen" ${tipe === 'retur_permanen' ? 'selected' : ''}>Kembali ke stok</option><option value="rusak_hilang" ${tipe === 'rusak_hilang' ? 'selected' : ''}>Rusak/hilang</option></select><input data-field="jumlah" type="number" min="1" value="${Number(jumlah) || 1}" class="px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs font-black"><input data-field="catatan" value="${escapeAttribute(catatan)}" placeholder="Opsional" class="px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs"><button type="button" onclick="hapusBarisStok(this)" class="w-9 h-9 rounded-lg text-red-600 hover:bg-red-100" title="Hapus baris"><i class="fa-solid fa-xmark"></i></button>`;
    box.appendChild(row);
}

function ubahJenisBarisStok(select) {
    const row = select.closest('.stok-batch-row');
    const ukuran = row?.querySelector('[data-field="ukuran"]');
    if (ukuran) ukuran.innerHTML = pilihanUkuranStok(select.value);
}

function hapusBarisStok(button) {
    const rows = document.querySelectorAll('.stok-batch-row');
    if (rows.length <= 1) { showToast('Sedikitnya satu baris stok harus tersedia.', 'error'); return; }
    button.closest('.stok-batch-row')?.remove();
}

function kumpulkanBarisStok() {
    return [...document.querySelectorAll('.stok-batch-row')].map(row => ({
        jenis: row.querySelector('[data-field="jenis"]').value,
        ukuran: row.querySelector('[data-field="ukuran"]').value.trim(),
        tipe: row.querySelector('[data-field="tipe"]').value,
        jumlah: Number.parseInt(row.querySelector('[data-field="jumlah"]').value, 10),
        catatan: row.querySelector('[data-field="catatan"]').value.trim() || null
    }));
}

async function simpanStokSeragam(event) {
    event.preventDefault();
    // Pengganti kompatibel catat_mutasi_stok_seragam: Fase 17 menyimpan banyak item atomik.
    const btn = document.getElementById('btnSimpanStok');
    if (!stokSeragamFase10Aktif) { showToast('Migrasi Fase 10 perlu diterapkan sebelum transaksi stok dapat disimpan.', 'error'); return; }
    const items = kumpulkanBarisStok();
    if (!items.length || items.some(item => !item.ukuran || !Number.isInteger(item.jumlah) || item.jumlah <= 0)) { showToast('Periksa ukuran dan jumlah pada setiap baris.', 'error'); return; }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    try {
        const res = await callSupabaseRpc('catat_mutasi_stok_batch_v2', {
            p_items: items,
            p_tanggal_efektif: datetimeLocalKeIso(document.getElementById('stokTanggalEfektif').value),
            p_catatan: document.getElementById('stokCatatan').value.trim() || null
        });
        if (res.status !== 'success' || res.ok === false) throw new Error(res.message || 'Database menolak transaksi stok');
        showToast(`${items.length} transaksi stok berhasil ${res.status_transaksi === 'terjadwal' ? 'dijadwalkan' : 'dicatat'}.`, 'success');
        tutupModalStok();
        await loadSeragam();
    } catch (error) { showToast(error.message || 'Gagal menyimpan stok.', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-right-left mr-1"></i> Catat Transaksi'; }
}

async function bukaDariParameter() {
    const nip = new URLSearchParams(window.location.search).get('nip');
    if (!nip || nipSeragamAktif || parameterSeragamSudahDibuka) return;
    if (!dataStatusSeragam.some(r => r.nip === nip)) {
        const res = await supabaseFetch(`v_status_seragam_set_v2?select=*&nip=eq.${encodeURIComponent(nip)}&limit=1`, 'GET');
        if (res.status === 'success' && Array.isArray(res.data) && res.data[0]) {
            dataStatusSeragam.push(res.data[0]);
            if (res.data[0].record_tersimpan) dataPenerimaTersimpan.push(res.data[0]);
        }
    }
    if (dataStatusSeragam.some(row => row.nip === nip)) {
        parameterSeragamSudahDibuka = true;
        await bukaKelolaSeragam(nip);
    }
}

function formatDatetimeLocal(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function datetimeLocalKeIso(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return new Date().toISOString();
    return date.toISOString();
}

async function editTanggalMutasiStok(id) {
    const row = dataMutasiStokSeragam.find(item => Number(item.id) === Number(id));
    if (!row) return;
    const tanggal = prompt('Tanggal & waktu efektif baru (format YYYY-MM-DDTHH:mm):', formatDatetimeLocal(row.tanggal_efektif || row.dibuat_pada));
    if (tanggal === null) return;
    const parsed = new Date(tanggal);
    if (Number.isNaN(parsed.getTime())) { showToast('Format tanggal tidak valid.', 'error'); return; }
    const alasan = prompt('Alasan perubahan tanggal (wajib):', 'Koreksi tanggal transaksi');
    if (alasan === null) return;
    if (!alasan.trim()) { showToast('Alasan perubahan wajib diisi.', 'error'); return; }
    try {
        const res = await callSupabaseRpc('ubah_tanggal_mutasi_stok', {
            p_id: Number(id), p_tanggal_efektif: parsed.toISOString(), p_alasan: alasan.trim()
        });
        if (res.status !== 'success' || res.ok === false) throw new Error(res.message || 'Perubahan tanggal ditolak');
        showToast('Tanggal transaksi dan saldo terkait berhasil disesuaikan.', 'success');
        await loadSeragam();
        renderRingkasanStok();
        renderMutasiStok();
    } catch (error) { showToast(error.message || 'Gagal mengubah tanggal transaksi.', 'error'); }
}

async function hapusMutasiStok(id) {
    const row = dataMutasiStokSeragam.find(item => Number(item.id) === Number(id));
    if (!row) return;
    const alasan = prompt(`Alasan menghapus transaksi ${labelTipeMutasi(row.tipe)} ${row.jenis} ${row.ukuran} (wajib):`);
    if (alasan === null) return;
    if (!alasan.trim()) { showToast('Alasan penghapusan wajib diisi.', 'error'); return; }
    const frasa = prompt('Tindakan ini akan menghitung ulang saldo. Ketik HAPUS PERMANEN untuk melanjutkan:');
    if (frasa !== 'HAPUS PERMANEN') { showToast('Frasa konfirmasi tidak sesuai.', 'error'); return; }
    try {
        const res = await callSupabaseRpc('hapus_mutasi_stok_permanen', {
            p_id: Number(id), p_frasa: frasa, p_alasan: alasan.trim()
        });
        if (res.status !== 'success' || res.ok === false) throw new Error(res.message || 'Penghapusan ditolak');
        showToast('Transaksi dihapus dan saldo dihitung ulang.', 'success');
        await loadSeragam();
        renderRingkasanStok();
        renderMutasiStok();
    } catch (error) { showToast(error.message || 'Transaksi tidak dapat dihapus.', 'error'); }
}

function exportSeragamExcel() {
    if (!window.XLSX) { showToast('Pustaka Excel belum termuat. Periksa koneksi lalu muat ulang.', 'error'); return; }
    const book = XLSX.utils.book_new();
    const penerima = dataStatusSeragam.map(row => ({
        ID: row.nip, Nama: row.nama,
        Jenis: row.pengecualian_aturan ? 'Personel Khusus' : 'Reguler',
        Organisasi: row.asal_organisasi, Daerah: row.asal_daerah,
        Zona: labelWilayahSeragam(row.zona_asal),
        Kelayakan: row.pengecualian_aturan ? 'Pengecualian aturan' : (row.memenuhi_syarat ? 'Memenuhi' : 'Belum memenuhi'),
        Proses: LABEL_PROSES[row.status_proses] || row.status_proses,
        Keberadaan: LABEL_PENGUASAAN[row.status_penguasaan] || row.status_penguasaan,
        'Ukuran Atasan': row.ukuran_atasan || row.ukuran_dibutuhkan || '',
        'Ukuran Bawahan': row.ukuran_bawahan || '',
        'Tanggal Diserahkan': row.tanggal_diserahkan || '',
        'Tanggal Efektif': row.tanggal_efektif_status || '', Catatan: row.catatan || ''
    }));
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(penerima), 'Penerima Halaman Ini');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(dataStokSeragam), 'Saldo Stok');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(dataMutasiStokSeragam), 'Mutasi Terakhir');
    XLSX.writeFile(book, `kontrol-seragam-${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast('Data penerima pada halaman ini, saldo, dan mutasi diekspor ke Excel.', 'success');
}

function cetakSeragamHtml(judul, subjudul, isi) {
    const popup = window.open('', '_blank', 'width=1100,height=800');
    if (!popup) { showToast('Izinkan pop-up untuk membuat PDF.', 'error'); return; }
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(judul)}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:28px}h1{font-size:20px;margin:0}.meta{font-size:11px;color:#64748b;margin:6px 0 18px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#fff7ed}@page{size:A4 landscape;margin:10mm}</style></head><body><h1>${escapeHTML(judul)}</h1><p class="meta">${escapeHTML(subjudul)} • Dibuat ${new Date().toLocaleString('id-ID')}</p>${isi}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
    popup.document.close();
}

function exportSeragamPdf() {
    if (!dataStatusSeragam.length) { showToast('Tidak ada data pada halaman ini untuk diekspor.', 'error'); return; }
    const body = dataStatusSeragam.map(row => `<tr><td>${escapeHTML(row.nip || '')}</td><td>${escapeHTML(row.nama || '')}</td><td>${row.pengecualian_aturan ? 'Khusus' : (row.memenuhi_syarat ? 'Memenuhi' : 'Belum')}</td><td>${escapeHTML(row.ukuran_atasan || row.ukuran_dibutuhkan || '-')} / ${escapeHTML(row.ukuran_bawahan || '-')}</td><td>${escapeHTML(LABEL_PROSES[row.status_proses] || row.status_proses || '-')}</td><td>${escapeHTML(LABEL_PENGUASAAN[row.status_penguasaan] || row.status_penguasaan || '-')}</td><td>${formatTanggalSeragam(row.tanggal_diserahkan)}</td><td>${escapeHTML(row.catatan || '-')}</td></tr>`).join('');
    cetakSeragamHtml('Kontrol Seragam', `Halaman ${seragamPage} • ${dataStatusSeragam.length} penerima ditampilkan`, `<table><thead><tr><th>ID</th><th>Nama</th><th>Kelayakan</th><th>Atasan/Bawahan</th><th>Proses</th><th>Keberadaan</th><th>Diserahkan</th><th>Catatan</th></tr></thead><tbody>${body}</tbody></table>`);
}
