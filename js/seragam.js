// ================================================================
// KONTROL SERAGAM
// ================================================================

let dataStatusSeragam = [];
let dataStokSeragam = [];
let dataPenerimaTersimpan = [];
let kehadiranProyekSeragam = [];
let nipSeragamAktif = '';
let parameterSeragamSudahDibuka = false;

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

document.addEventListener('DOMContentLoaded', loadSeragam);

async function loadSeragam() {
    const tbody = document.getElementById('tabelSeragam');
    const errorBox = document.getElementById('seragamError');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="p-10 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat kontrol seragam...</td></tr>';
    if (errorBox) errorBox.classList.add('hidden');

    try {
        const [statusRes, stokRes, penerimaRes, proyekRes] = await Promise.all([
            supabaseFetchAll('v_status_seragam_operasional?select=*&order=memenuhi_syarat.desc,peringkat.asc.nullslast,nama.asc'),
            supabaseFetchAll('stok_seragam?select=*&order=ukuran.asc'),
            supabaseFetchAll('seragam_penerima?select=*&order=updated_at.desc'),
            supabaseFetchAll('v_kehadiran_proyek_personel?select=*&order=kategori.asc,nama_proyek.asc')
        ]);
        if (statusRes.status !== 'success' || stokRes.status !== 'success' || penerimaRes.status !== 'success' || proyekRes.status !== 'success') {
            throw new Error(statusRes.message || stokRes.message || penerimaRes.message || proyekRes.message || 'Gagal membaca data seragam');
        }
        dataStatusSeragam = statusRes.data || [];
        dataStokSeragam = stokRes.data || [];
        dataPenerimaTersimpan = penerimaRes.data || [];
        kehadiranProyekSeragam = proyekRes.data || [];
        siapkanFilterProyekSeragam();
        renderKpiSeragam();
        renderSeragam();
        tampilkanNotifikasiSeragam();
        bukaDariParameter();
    } catch (error) {
        console.error('Kontrol Seragam:', error);
        if (errorBox) {
            errorBox.textContent = 'Fitur seragam belum dapat dibaca. Pastikan migrasi Fase 6 dan Fase 7 sudah diterapkan di database, lalu muat ulang halaman.';
            errorBox.classList.remove('hidden');
        }
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="p-10 text-center text-red-500 font-bold">Data seragam belum tersedia.</td></tr>';
    }
}

function uniqueNip(rows) { return new Set(rows.map(r => r.nip).filter(Boolean)).size; }
function setKpi(id, value) { const el = document.getElementById(id); if (el) el.textContent = Number(value || 0).toLocaleString('id-ID'); }

function renderKpiSeragam() {
    setKpi('kpiSeragamMemenuhi', uniqueNip(dataStatusSeragam.filter(r => r.memenuhi_syarat)));
    setKpi('kpiSeragamRencana', uniqueNip(dataStatusSeragam.filter(r => r.status_proses === 'direncanakan')));
    setKpi('kpiSeragamTunggu', uniqueNip(dataStatusSeragam.filter(r => r.status_proses === 'menunggu_stok')));
    setKpi('kpiSeragamSelesai', uniqueNip(dataStatusSeragam.filter(r => r.status_proses === 'sudah_diserahkan')));
    setKpi('kpiSeragamTitip', uniqueNip(dataStatusSeragam.filter(r => r.status_penguasaan === 'dititipkan_kantor')));
    setKpi('kpiSeragamKembali', uniqueNip(dataStatusSeragam.filter(r => r.status_penguasaan === 'perlu_diserahkan_kembali')));
    setKpi('kpiSeragamAbsenLama', uniqueNip(dataStatusSeragam.filter(r => r.tidak_hadir_30_hari)));
}

function tampilkanNotifikasiSeragam() {
    const alerts = dataStatusSeragam.filter(r => r.notifikasi_pengembalian || r.status_penguasaan === 'perlu_diserahkan_kembali');
    const box = document.getElementById('notifikasiSeragam');
    if (box) {
        if (!alerts.length) box.classList.add('hidden');
        else {
            document.getElementById('notifikasiSeragamText').textContent = `${alerts.length} personel luar Jombang kembali hadir saat seragamnya masih tercatat dititipkan di kantor. Buka data personel tersebut dan ubah menjadi “Dipegang personel” setelah seragam diserahkan kembali.`;
            box.classList.remove('hidden');
        }
    }
    const absenLama = dataStatusSeragam.filter(r => r.tidak_hadir_30_hari);
    const absenBox = document.getElementById('notifikasiAbsenLama');
    if (absenBox) {
        if (!absenLama.length) absenBox.classList.add('hidden');
        else {
            document.getElementById('notifikasiAbsenLamaText').textContent = `${absenLama.length} penerima tercatat sudah menerima seragam, tetapi tidak memiliki kehadiran selama lebih dari 30 hari. Periksa status keberadaan dan hubungi petugas wilayah bila perlu.`;
            absenBox.classList.remove('hidden');
        }
    }
}

function siapkanFilterProyekSeragam() {
    const select = document.getElementById('filterProyekSeragam');
    const group = document.getElementById('opsiLainnyaSeragam');
    if (!select || !group) return;
    const selected = select.value || 'semua';
    const names = [...new Set(kehadiranProyekSeragam
        .filter(row => row.kategori === 'lainnya' && row.nama_proyek)
        .map(row => row.nama_proyek))]
        .filter(name => !PROYEK_KHUSUS_SERAGAM.includes(name))
        .sort((a, b) => a.localeCompare(b, 'id'));
    group.innerHTML = names.map(name => `<option value="${escapeAttribute(`proyek:${name}`)}">${escapeHTML(name)}</option>`).join('');
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
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

function renderSeragam() {
    const tbody = document.getElementById('tabelSeragam');
    if (!tbody) return;
    const proses = document.getElementById('filterProsesSeragam')?.value || 'semua';
    const penguasaan = document.getElementById('filterPenguasaanSeragam')?.value || 'semua';
    const proyekFilter = document.getElementById('filterProyekSeragam')?.value || 'semua';
    const keyword = (document.getElementById('cariSeragam')?.value || '').trim().toLowerCase();
    let rows = [...dataStatusSeragam];
    rows = rows.filter(r => cocokFilterProyekSeragam(r, proyekFilter));
    if (proses !== 'semua') rows = rows.filter(r => r.status_proses === proses);
    if (penguasaan !== 'semua') rows = rows.filter(r => r.status_penguasaan === penguasaan);
    if (keyword) rows = rows.filter(r => [r.nama,r.nip,r.asal_daerah,r.asal_organisasi,r.ukuran_dibutuhkan,r.kode_seragam].some(v => String(v || '').toLowerCase().includes(keyword)));

    rows.sort((a, b) => {
        if (Boolean(a.notifikasi_pengembalian) !== Boolean(b.notifikasi_pengembalian)) return a.notifikasi_pengembalian ? -1 : 1;
        if (Boolean(a.tidak_hadir_30_hari) !== Boolean(b.tidak_hadir_30_hari)) return a.tidak_hadir_30_hari ? -1 : 1;
        if (Boolean(a.memenuhi_syarat) !== Boolean(b.memenuhi_syarat)) return a.memenuhi_syarat ? -1 : 1;
        return Number(a.peringkat || 999999) - Number(b.peringkat || 999999) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
    });

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-10 text-center text-slate-400 font-bold">Tidak ada data sesuai filter.</td></tr>';
        document.getElementById('infoSeragam').textContent = '0 personel';
        return;
    }

    tbody.innerHTML = rows.map(r => {
        const kelayakan = r.memenuhi_syarat
            ? `<span class="font-black text-emerald-600 dark:text-emerald-300">Memenuhi</span><p class="text-[10px] text-slate-400">${escapeHTML(labelJalur(r.jalur_kelayakan))} • ${formatTanggalSeragam(r.tanggal_memenuhi)}</p>`
            : '<span class="font-bold text-slate-400">Belum memenuhi</span>';
        const alertIcon = r.notifikasi_pengembalian ? '<i class="fa-solid fa-bell text-amber-500 mr-1" title="Perlu diserahkan kembali"></i>' : (r.tidak_hadir_30_hari ? '<i class="fa-solid fa-user-clock text-rose-500 mr-1" title="Tidak hadir lebih dari 30 hari"></i>' : '');
        const rowClass = r.notifikasi_pengembalian ? 'bg-amber-50/70 dark:bg-amber-500/5' : (r.tidak_hadir_30_hari ? 'bg-rose-50/70 dark:bg-rose-500/5' : 'hover:bg-indigo-50/40 dark:hover:bg-indigo-500/5');
        return `<tr class="${rowClass}">
            <td class="px-4 py-3"><p class="font-extrabold">${alertIcon}${escapeHTML(r.nama)}</p><p class="text-[10px] text-slate-400 font-mono">${escapeHTML(r.nip)} • ${escapeHTML(labelWilayahSeragam(r.kategori_wilayah))}</p><p class="text-[10px] text-slate-400">${escapeHTML(r.asal_daerah || 'Daerah belum diisi')}</p></td>
            <td class="px-4 py-3 text-xs">${kelayakan}</td>
            <td class="px-4 py-3"><p class="font-black">${escapeHTML(r.ukuran_dibutuhkan || 'Belum diisi')}</p><p class="text-[10px] text-slate-400 font-mono">${escapeHTML(r.kode_seragam || 'Tanpa kode')}</p></td>
            <td class="px-4 py-3"><span class="inline-flex px-2 py-1 rounded-full text-[10px] font-black ${warnaProses(r.status_proses)}">${escapeHTML(LABEL_PROSES[r.status_proses] || r.status_proses)}</span></td>
            <td class="px-4 py-3 text-xs font-bold ${warnaPenguasaan(r.status_penguasaan)}">${escapeHTML(LABEL_PENGUASAAN[r.status_penguasaan] || r.status_penguasaan)}</td>
            <td class="px-4 py-3 text-xs"><p>${r.tanggal_diserahkan ? `Diserahkan ${formatTanggalSeragam(r.tanggal_diserahkan)}` : '-'}</p><p class="text-[10px] text-slate-400 mt-1">Hadir ${formatTanggalSeragam(r.tanggal_hadir_terakhir)}</p>${r.tidak_hadir_30_hari ? `<p class="text-[10px] font-black text-rose-600 dark:text-rose-300 mt-1">Tidak hadir ${Number(r.hari_tidak_hadir || 0)} hari</p>` : ''}</td>
            <td class="px-4 py-3 text-xs text-slate-500 max-w-[180px]"><p class="line-clamp-2">${escapeHTML(r.catatan || '-')}</p></td>
            <td class="px-4 py-3 text-center"><button data-nip="${escapeAttribute(r.nip)}" onclick="bukaKelolaSeragamDariTombol(this)" class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"><i class="fa-solid fa-pen-to-square mr-1"></i> Kelola</button></td>
        </tr>`;
    }).join('');
    document.getElementById('infoSeragam').textContent = `${rows.length.toLocaleString('id-ID')} personel ditampilkan • ${labelFilterProyekSeragam(proyekFilter)}`;
}

function labelJalur(value) {
    return { khususul_khusus: '5 Proyek Khususul Khusus', lainnya: 'Proyek Lainnya', zona_4: 'Zona 4' }[value] || '-';
}
function labelWilayahSeragam(value) {
    return { jombang:'Jombang', luar_jombang:'Luar Jombang', zona_4:'Zona 4', belum_dilengkapi:'Wilayah belum diisi' }[value] || 'Wilayah belum diisi';
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
    document.getElementById('modalSeragamNama').textContent = `${row.nama || '-'} • ${nip} • ${labelWilayahSeragam(row.kategori_wilayah)}`;
    document.getElementById('seragamStatusProses').value = row.status_proses || 'belum_memenuhi';
    document.getElementById('seragamUkuran').value = row.ukuran_dibutuhkan || '';
    document.getElementById('seragamStatusPenguasaan').value = row.status_penguasaan || 'belum_memiliki';
    document.getElementById('seragamKode').value = row.kode_seragam || '';
    document.getElementById('seragamTanggalRencana').value = String(row.tanggal_rencana || '').slice(0,10);
    document.getElementById('seragamTanggalDiserahkan').value = String(row.tanggal_diserahkan || '').slice(0,10);
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
    const ukuran = document.getElementById('seragamUkuran').value;
    const dataLama = document.getElementById('seragamDataLama').checked;
    if (status === 'sudah_diserahkan' && !ukuran) { showToast('Ukuran seragam wajib diisi.', 'error'); return; }
    if (status === 'sudah_diserahkan' && document.getElementById('seragamStatusPenguasaan').value === 'belum_memiliki') { showToast('Pilih keberadaan seragam setelah diserahkan.', 'error'); return; }
    if (status === 'sudah_diserahkan' && !dataLama && !document.getElementById('seragamAturan').checked) { showToast('Konfirmasi ketentuan seragam terlebih dahulu.', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    try {
        const res = await callSupabaseRpc('simpan_status_seragam', {
            p_nip: nipSeragamAktif,
            p_status_proses: status,
            p_ukuran: ukuran,
            p_status_penguasaan: document.getElementById('seragamStatusPenguasaan').value,
            p_tanggal_rencana: document.getElementById('seragamTanggalRencana').value || null,
            p_tanggal_diserahkan: document.getElementById('seragamTanggalDiserahkan').value || null,
            p_kode_seragam: document.getElementById('seragamKode').value.trim().toUpperCase() || null,
            p_catatan: document.getElementById('seragamCatatan').value.trim() || null,
            p_aturan_disetujui: document.getElementById('seragamAturan').checked,
            p_data_lama: dataLama,
            p_kurangi_stok: document.getElementById('seragamKurangiStok').checked && !dataLama
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
    const sizes = ['S','M','L','XL','XXL','XXXL','Khusus'];
    document.getElementById('formStokSeragam').innerHTML = sizes.map(size => {
        const row = dataStokSeragam.find(item => item.ukuran === size) || {};
        return `<label class="rounded-xl border border-slate-200 dark:border-slate-700 p-3"><span class="text-xs font-black">Ukuran ${escapeHTML(size)}</span><input data-ukuran="${escapeAttribute(size)}" type="number" min="0" value="${Number(row.jumlah_tersedia || 0)}" class="stok-input mt-2 w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 font-black"></label>`;
    }).join('');
    document.getElementById('modalStokSeragam').classList.remove('hidden');
}
function tutupModalStok() { document.getElementById('modalStokSeragam')?.classList.add('hidden'); }

async function simpanStokSeragam(event) {
    event.preventDefault();
    const btn = document.getElementById('btnSimpanStok');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';
    try {
        for (const input of document.querySelectorAll('.stok-input')) {
            const ukuran = input.dataset.ukuran;
            const jumlah = Math.max(0, Number.parseInt(input.value, 10) || 0);
            const exists = dataStokSeragam.some(row => row.ukuran === ukuran);
            const res = exists
                ? await supabaseFetch(`stok_seragam?ukuran=eq.${encodeURIComponent(ukuran)}`, 'PATCH', { jumlah_tersedia: jumlah })
                : await supabaseFetch('stok_seragam', 'POST', { ukuran, jumlah_tersedia: jumlah });
            if (res.status !== 'success') throw new Error(res.message || `Gagal menyimpan stok ${ukuran}`);
        }
        showToast('Stok seragam berhasil diperbarui.', 'success');
        tutupModalStok();
        await loadSeragam();
    } catch (error) { showToast(error.message || 'Gagal menyimpan stok.', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Simpan Stok'; }
}

function bukaDariParameter() {
    const nip = new URLSearchParams(window.location.search).get('nip');
    if (!nip || nipSeragamAktif || parameterSeragamSudahDibuka) return;
    if (dataStatusSeragam.some(r => r.nip === nip)) {
        parameterSeragamSudahDibuka = true;
        bukaKelolaSeragam(nip);
    }
}
