// ==========================================
// LOGIKA MASTER DATA, PAGINATION, & MERGE ENGINE
// ==========================================

let masterData = [];
let filteredData = []; // Menyimpan data setelah difilter/search
let currentPage = 1;
let rowsPerPage = 50;
let masterSortMode = 'nama';
let duplikatMasterGroups = [];
let duplikatMasterMirip = [];
let manualMergeSelectedNips = new Set();
let manualMergeTargetNip = '';
let organisasiData = [];
let organisasiTerpilih = new Set();
let riwayatMergeData = [];
let currentEditMode = 'edit';
let currentDetailPersonel = null;
let pendingDeleteNips = [];
let pendingDeleteImpact = {};

function normalisasiKunciMaster(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalisasiNamaMaster(value) {
    return normalisasiKunciMaster(value).replace(/[^A-Z0-9]/g, '');
}

const ALIAS_ORGANISASI_MASTER = new Map([
    ['DCP PLOSO', 'DPC PLOSO'],
    ['MQ12', 'MQ 12'],
    ['MQ13', 'MQ 13'],
    ['IMQ25', 'IMQ 25']
]);

function rapikanNamaMaster(value) {
    return normalisasiKunciMaster(value);
}

function rapikanOrganisasiMaster(value) {
    const key = normalisasiKunciMaster(value);
    return ALIAS_ORGANISASI_MASTER.get(key) || key;
}

const ORGANISASI_JOMBANG_MASTER = new Set([
    'PUSAT', 'DPD JOMBANG', 'DPC KABUH', 'OPSHID KABUH', 'DPC PLOSO',
    'DCP PLOSO', 'DPC KUDU', 'DPC PLANDAAN', 'DPC TEMBELANG',
    'DPC NGUSIKAN', 'DPC MEGALUH', 'DPC KESAMBEN', 'DPC DADITUNGGAL',
    'DPC GABUS BANARAN', 'DPC JATIROWO', 'DPC KLECO'
]);

function kabupatenMaster(row) {
    const tersimpan = normalisasiKunciMaster(row?.kabupaten_normalisasi);
    if (tersimpan) return tersimpan;
    const org = normalisasiKunciMaster(row?.asal_organisasi);
    if (ORGANISASI_JOMBANG_MASTER.has(org)) return 'JOMBANG';
    if (/^DPD\s+/.test(org) && org !== 'DPD ORSHID') {
        return org.replace(/^DPD\s+(?:KAB(?:UPATEN)?\s+)?/, '').trim();
    }
    return normalisasiKunciMaster(row?.asal_daerah);
}

function kunciIdentitasMaster(row) {
    const nama = normalisasiNamaMaster(row?.nama);
    const kabupaten = kabupatenMaster(row);
    if (!nama || !kabupaten) return '';
    return `${nama}\u241F${kabupaten}`;
}

function jarakNamaMaksimalSatu(a, b) {
    const kiri = normalisasiNamaMaster(a);
    const kanan = normalisasiNamaMaster(b);
    if (!kiri || !kanan || kiri === kanan || Math.abs(kiri.length - kanan.length) > 1) return false;
    let i = 0;
    let j = 0;
    let beda = 0;
    while (i < kiri.length && j < kanan.length) {
        if (kiri[i] === kanan[j]) { i += 1; j += 1; continue; }
        beda += 1;
        if (beda > 1) return false;
        if (kiri.length > kanan.length) i += 1;
        else if (kanan.length > kiri.length) j += 1;
        else { i += 1; j += 1; }
    }
    if (i < kiri.length || j < kanan.length) beda += 1;
    return beda === 1;
}

function kategoriWilayahEfektif(row) {
    if (normalisasiKunciMaster(row?.asal_organisasi) === 'PUSAT') return 'jombang';
    return row?.kategori_wilayah || 'belum_dilengkapi';
}

const LABEL_ZONA_MASTER = Object.fromEntries(
    Object.entries(globalThis.RelawanDomain?.ZONA || {
        zona_1: { label: 'Zona 1 — Jawa Timur & Bali' },
        zona_2: { label: 'Zona 2 — Jawa Tengah & DIY' },
        zona_3: { label: 'Zona 3 — Jawa Barat, Jakarta & Banten' },
        zona_4: { label: 'Zona 4 — Sumatera & Kalimantan' }
    }).map(([key, value]) => [key, value.label])
);

function zonaAsalEfektif(row) {
    const zona = String(row?.zona_asal || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(LABEL_ZONA_MASTER, zona) ? zona : '';
}

function zonaDariProvinsiMaster(value) {
    const provinsi = normalisasiKunciMaster(value);
    if (['JAWA TIMUR', 'BALI'].includes(provinsi)) return 'zona_1';
    if (['JAWA TENGAH', 'DI YOGYAKARTA', 'DAERAH ISTIMEWA YOGYAKARTA', 'DIY', 'YOGYAKARTA'].includes(provinsi)) return 'zona_2';
    if (['JAWA BARAT', 'DKI JAKARTA', 'JAKARTA', 'BANTEN'].includes(provinsi)) return 'zona_3';
    if (['ACEH', 'SUMATERA UTARA', 'SUMATERA BARAT', 'RIAU', 'KEPULAUAN RIAU', 'JAMBI', 'SUMATERA SELATAN', 'KEPULAUAN BANGKA BELITUNG', 'BENGKULU', 'LAMPUNG', 'KALIMANTAN BARAT', 'KALIMANTAN TENGAH', 'KALIMANTAN SELATAN', 'KALIMANTAN TIMUR', 'KALIMANTAN UTARA'].includes(provinsi)) return 'zona_4';
    return '';
}

function normalisasiJabatanMaster(value) {
    const trimmed = String(value || '').trim();
    const key = normalisasiKunciMaster(trimmed).replace(/\s*\/\s*/g, '/');
    if (['PJ', 'ADMIN', 'PJ/ADMIN', 'ADMIN/PJ'].includes(key)) return 'PJ / Admin';
    return trimmed;
}

document.addEventListener("DOMContentLoaded", async () => {
    const akses = await getAksesUser();
    if (akses.role !== 'admin') return;
    loadMasterData();
});

document.addEventListener('keydown', event => {
    const modalEdit = document.getElementById('modalEdit');
    const modalMergeManual = document.getElementById('modalMergeManual');
    const modalOrganisasi = document.getElementById('modalOrganisasi');
    const modalRiwayatMerge = document.getElementById('modalRiwayatMerge');
    const modalDetailPersonel = document.getElementById('modalDetailPersonel');
    const modalHapusPermanen = document.getElementById('modalHapusPermanen');
    if (event.key === 'Escape' && modalEdit && !modalEdit.classList.contains('hidden')) {
        tutupModalEdit();
    }
    if (event.key === 'Escape' && modalMergeManual && !modalMergeManual.classList.contains('hidden')) {
        tutupModalMergeManual();
    }
    if (event.key === 'Escape' && modalOrganisasi && !modalOrganisasi.classList.contains('hidden')) tutupModalOrganisasi();
    if (event.key === 'Escape' && modalRiwayatMerge && !modalRiwayatMerge.classList.contains('hidden')) tutupRiwayatMerge();
    if (event.key === 'Escape' && modalDetailPersonel && !modalDetailPersonel.classList.contains('hidden')) tutupDetailPersonel();
    if (event.key === 'Escape' && modalHapusPermanen && !modalHapusPermanen.classList.contains('hidden')) tutupHapusPermanen();
    if (event.ctrlKey && event.key === 'Enter' && modalEdit && !modalEdit.classList.contains('hidden')) {
        event.preventDefault();
        simpanEditMaster();
    }
});

// 1. Tarik Data Master Sekali di Awal
async function loadMasterData() {
    try {
        const res = await supabaseFetchAll('v_personel_terpadu_v3?select=*&order=nama.asc');
        if (res.status === "success") {
            masterData = Array.isArray(res.data) ? res.data : [];
            renderRingkasanMaster();
            document.getElementById('totalMasterInfo').innerText = `Total: ${masterData.length} Personel`;
            terapkanFilterDanPaginasi();
        } else {
            showToast(res.message || "Gagal mengambil data Master terpadu. Pastikan Fase 20 sudah diterapkan.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

// 2. Fungsi Saat Pilihan Dropdown Diubah
function gantiBatasData() {
    const val = document.getElementById('limitData').value;
    rowsPerPage = Math.max(25, Number.parseInt(val, 10) || 50);
    currentPage = 1; 
    terapkanFilterDanPaginasi();
}

// 3. Fungsi Saat Mengetik di Kolom Pencarian Global
function filterTabelMaster() {
    currentPage = 1; 
    terapkanFilterDanPaginasi();
}

function ubahFilterMaster() {
    currentPage = 1;
    terapkanFilterDanPaginasi();
}

// 4. Inti Mesin Penyaringan, Excel Filter, & Pengurutan Data
function terapkanFilterDanPaginasi() {
    const keyword = (document.getElementById('cariData')?.value || '').trim().toLowerCase();
    const zonaFilter = document.getElementById('filterZonaMaster')?.value || '';
    const jenisFilter = document.getElementById('filterJenisMaster')?.value || '';
    
    // Filter Pencarian Global
    filteredData = masterData.filter(r => {
        const zona = zonaAsalEfektif(r);
        const cocokZona = !zonaFilter || (zonaFilter === 'belum' ? !zona : zona === zonaFilter);
        const cocokJenis = !jenisFilter || (r.kategori_personel || 'reguler') === jenisFilter;
        const cocokKata = !keyword || [
            r.nama, r.nip, r.asal_organisasi, r.asal_daerah, r.kabupaten_normalisasi,
            r.jabatan, r.jabatan_khusus, zona,
            LABEL_ZONA_MASTER[zona], r.ukuran_atasan_efektif, r.ukuran_bawahan_efektif,
            r.status_seragam, r.status_proses, r.status_penguasaan
        ].some(value => String(value || '').toLowerCase().includes(keyword));
        return cocokZona && cocokJenis && cocokKata;
    });

    // Filter berdasarkan pop-up Excel (Checkbox kolom aktif)
    Object.keys(activeExcelFilters).forEach(col => {
        const allowedVals = activeExcelFilters[col];
        if (allowedVals && allowedVals.length > 0) {
            filteredData = filteredData.filter(item => {
                const itemValue = item[col];
                const val = (itemValue !== null && itemValue !== undefined && itemValue !== "") ? String(itemValue) : '-';
                return allowedVals.includes(val);
            });
        }
    });

    // Sorting Kolom (A-Z / Z-A) atau Default Nama
    if (activeSortColumn) {
        filteredData.sort((a, b) => {
            let valA = (a[activeSortColumn] !== null && a[activeSortColumn] !== undefined) ? String(a[activeSortColumn]).toLowerCase() : '';
            let valB = (b[activeSortColumn] !== null && b[activeSortColumn] !== undefined) ? String(b[activeSortColumn]).toLowerCase() : '';
            if (valA < valB) return activeSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return activeSortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    } else {
        filteredData.sort((a, b) => {
            if (masterSortMode === 'nama_desc') return String(b.nama || '').localeCompare(String(a.nama || ''), 'id');
            if (masterSortMode === 'total_hari') return Number(b.total_hari || 0) - Number(a.total_hari || 0) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
            if (masterSortMode === 'persentase_hari') return Number(b.persentase_hari || 0) - Number(a.persentase_hari || 0) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
            if (masterSortMode === 'hadir_pertama') return String(a.hadir_pertama || '9999-12-31').localeCompare(String(b.hadir_pertama || '9999-12-31')) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
            if (masterSortMode === 'hadir_terakhir') return String(b.hadir_terakhir || '').localeCompare(String(a.hadir_terakhir || '')) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
            if (masterSortMode === 'nip') return String(a.nip || '').localeCompare(String(b.nip || ''), 'id');
            return String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
        });
    }

    renderTabelMaster(filteredData);
}

// 5. Fungsi Pindah Halaman (Next / Prev)
function ubahHalaman(arah) {
    currentPage += arah;
    renderTabelMaster(filteredData);
}

// 6. Mesin Render HTML & Kalkulasi Baris
function renderTabelMaster(data) {
    const tbody = document.getElementById('tabelMasterBody');
    const info = document.getElementById('infoPaginasi');
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center p-8 text-slate-400 font-medium">Data tidak ditemukan.</td></tr>';
        info.innerText = "Menampilkan 0 data";
        btnPrev.disabled = true;
        btnNext.disabled = true;
        toggleMasterBulkAction();
        return;
    }

    const totalPages = Math.ceil(data.length / rowsPerPage);
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, data.length);
    const dataPaginated = data.slice(startIndex, endIndex);

    let html = '';
    dataPaginated.forEach((r, idx) => {
        const noUrut = startIndex + idx + 1;
        const nipAttr = escapeAttribute(r.nip);
        const zonaEfektif = zonaAsalEfektif(r);
        const nipTampil = escapeHTML(r.nip);
        const namaTampil = escapeHTML(r.nama);
        const orgTampil = escapeHTML(r.asal_organisasi);
        const bidangTampil = escapeHTML(normalisasiJabatanMaster(r.jabatan));
        const daerahTampil = escapeHTML(r.kabupaten_normalisasi || r.asal_daerah || 'Belum diisi');
        const ukuranTampil = escapeHTML(`${r.ukuran_atasan_efektif || r.ukuran_seragam || '-'} / ${r.ukuran_bawahan_efektif || r.ukuran_bawahan_seragam || '-'}`);
        const labelZona = LABEL_ZONA_MASTER[zonaEfektif] || 'Zona belum diisi';

        html += `
            <tr class="hover:bg-indigo-50/50 transition-colors">
                <td class="px-4 py-3 text-center bg-slate-50 border-r border-slate-100">
                    <input type="checkbox" class="master-checkbox w-4 h-4 accent-primary cursor-pointer" value="${nipAttr}" onchange="toggleMasterBulkAction()">
                </td>
                <td class="px-4 py-3 text-center text-slate-400 font-bold bg-slate-50 border-r border-slate-100">${noUrut}</td>
                <td class="px-5 py-3 font-mono text-xs text-slate-500">${nipTampil}</td>
                <td class="px-5 py-3 font-bold text-slate-800">${namaTampil}${r.kategori_personel === 'khusus' ? `<span class="ml-2 inline-flex px-2 py-0.5 rounded-full text-[9px] font-black bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title="Tidak ikut ranking dan syarat kehadiran otomatis">KHUSUS</span><p class="text-[10px] text-violet-600 mt-1">${escapeHTML(r.jabatan_khusus || normalisasiJabatanMaster(r.jabatan) || 'Personel khusus')}</p>` : ''}</td>
                <td class="px-5 py-3 text-slate-600 font-medium">${orgTampil}</td>
                <td class="px-5 py-3 text-slate-600"><span class="bg-slate-100 px-2 py-1 rounded-md text-xs font-bold border border-slate-200">${bidangTampil}</span></td>
                <td class="px-5 py-3"><span class="inline-flex px-2 py-1 rounded-full text-[10px] font-black ${zonaEfektif ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'}">${escapeHTML(labelZona)}</span><p class="text-[10px] text-slate-400 mt-1">${daerahTampil}</p></td>
                <td class="px-5 py-3 text-center"><p class="font-black text-slate-700">${Number(r.total_hari || 0).toLocaleString('id-ID')} hari</p><p class="text-[10px] text-slate-400">${Number(r.total_sesi || 0).toLocaleString('id-ID')} sesi • ${Number(r.jumlah_proyek || 0)} proyek</p></td>
                <td class="px-5 py-3 text-center"><p class="font-black text-indigo-600">${Number(r.persentase_hari || 0).toFixed(1)}%</p><p class="text-[10px] text-slate-400">${Number(r.persentase_sesi || 0).toFixed(1)}% sesi</p></td>
                <td class="px-5 py-3 text-xs text-slate-500">${r.hadir_pertama ? formatTanggalMaster(r.hadir_pertama) : '-'}<p class="text-[10px] text-slate-400 mt-1">Terakhir: ${r.hadir_terakhir ? formatTanggalMaster(r.hadir_terakhir) : '-'}</p></td>
                <td class="px-5 py-3 font-black text-center">${ukuranTampil}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    info.innerText = `Baris ${startIndex + 1}-${endIndex} dari ${data.length.toLocaleString('id-ID')} Data (Hal ${currentPage}/${totalPages})`;
    btnPrev.disabled = currentPage === 1;
    btnNext.disabled = currentPage === totalPages;
    toggleMasterBulkAction();
}

function formatTanggalMaster(value) {
    if (!value) return '-';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function skorProfilMaster(row) {
    const kolomTerisi = ['nama', 'asal_organisasi', 'jabatan', 'asal_daerah', 'kategori_wilayah', 'ukuran_seragam', 'catatan_seragam']
        .filter(key => String(row?.[key] || '').trim() && row[key] !== 'belum_dilengkapi').length;
    return [
        Number(row?.persentase_hari || 0),
        Number(row?.total_hari || 0),
        Number(row?.total_sesi || 0),
        kolomTerisi,
        String(row?.nip || '')
    ];
}

function bandingkanProfilMaster(a, b) {
    const skorA = skorProfilMaster(a);
    const skorB = skorProfilMaster(b);
    return skorB[0] - skorA[0]
        || skorB[1] - skorA[1]
        || skorB[2] - skorA[2]
        || skorB[3] - skorA[3]
        || skorA[4].localeCompare(skorB[4], 'id');
}

function buatGrupDuplikatAman() {
    const groups = new Map();
    masterData.forEach(row => {
        const key = kunciIdentitasMaster(row);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });
    return [...groups.entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([key, rows]) => ({ key, rows: rows.sort(bandingkanProfilMaster) }))
        .sort((a, b) => String(a.rows[0]?.nama || '').localeCompare(String(b.rows[0]?.nama || ''), 'id'));
}

function buatKandidatNamaMirip() {
    const perKabupaten = new Map();
    masterData.forEach(row => {
        const kabupaten = kabupatenMaster(row);
        const nama = normalisasiNamaMaster(row?.nama);
        if (!kabupaten || !nama) return;
        if (!perKabupaten.has(kabupaten)) perKabupaten.set(kabupaten, []);
        perKabupaten.get(kabupaten).push(row);
    });
    const hasil = [];
    perKabupaten.forEach((rows, kabupaten) => {
        for (let i = 0; i < rows.length; i += 1) {
            for (let j = i + 1; j < rows.length; j += 1) {
                if (normalisasiNamaMaster(rows[i].nama) === normalisasiNamaMaster(rows[j].nama)) continue;
                if (jarakNamaMaksimalSatu(rows[i].nama, rows[j].nama)) {
                    hasil.push({ key: `${rows[i].nip}\u241F${rows[j].nip}`, kabupaten, rows: [rows[i], rows[j]].sort(bandingkanProfilMaster) });
                }
            }
        }
    });
    return hasil.sort((a, b) => String(a.rows[0]?.nama || '').localeCompare(String(b.rows[0]?.nama || ''), 'id'));
}

function ringkasJaringanKandidatNamaMirip(groups = duplikatMasterMirip) {
    const rowsByNip = new Map();
    const adjacency = new Map();

    (groups || []).forEach(group => {
        const rows = (group?.rows || []).filter(row => row?.nip);
        rows.forEach(row => {
            rowsByNip.set(row.nip, row);
            if (!adjacency.has(row.nip)) adjacency.set(row.nip, new Set());
        });
        for (let i = 0; i < rows.length; i += 1) {
            for (let j = i + 1; j < rows.length; j += 1) {
                adjacency.get(rows[i].nip).add(rows[j].nip);
                adjacency.get(rows[j].nip).add(rows[i].nip);
            }
        }
    });

    const visited = new Set();
    const components = [];
    adjacency.forEach((_, startNip) => {
        if (visited.has(startNip)) return;
        const queue = [startNip];
        const members = [];
        visited.add(startNip);
        while (queue.length) {
            const nip = queue.shift();
            members.push(rowsByNip.get(nip));
            (adjacency.get(nip) || []).forEach(nextNip => {
                if (visited.has(nextNip)) return;
                visited.add(nextNip);
                queue.push(nextNip);
            });
        }
        components.push(members.filter(Boolean));
    });

    components.sort((a, b) => b.length - a.length
        || String(a[0]?.nama || '').localeCompare(String(b[0]?.nama || ''), 'id'));
    const terbesar = components[0] || [];
    const ukuranJaringanPerNip = new Map();
    components.forEach(component => component.forEach(row => ukuranJaringanPerNip.set(row.nip, component.length)));
    return {
        pasangan: (groups || []).length,
        profil: rowsByNip.size,
        jaringan: components.length,
        terbesar: terbesar.length,
        ukuranJaringanPerNip,
        contohTerbesar: terbesar
            .map(row => String(row?.nama || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'id'))
            .slice(0, 8)
    };
}

function profilUtamaDuplikat(group) {
    return [...(group?.rows || [])].sort(bandingkanProfilMaster)[0] || null;
}

function perbaruiRingkasanDuplikat() {
    duplikatMasterGroups = buatGrupDuplikatAman();
    duplikatMasterMirip = buatKandidatNamaMirip();
    const jumlahProfil = duplikatMasterGroups.reduce((total, group) => total + group.rows.length, 0);
    const duplicateCard = document.getElementById('ringkasanMasterDuplikat');
    const duplicateBadge = document.getElementById('badgeDuplikatMaster');
    if (duplicateCard) duplicateCard.textContent = Number(jumlahProfil).toLocaleString('id-ID');
    if (duplicateBadge) duplicateBadge.textContent = Number(duplikatMasterGroups.length + duplikatMasterMirip.length).toLocaleString('id-ID');
}

function bukaModalRapikanMaster() {
    duplikatMasterGroups = buatGrupDuplikatAman();
    duplikatMasterMirip = buatKandidatNamaMirip();
    renderDuplikatMaster();
    document.getElementById('modalRapikanMaster')?.classList.remove('hidden');
}

function tutupModalRapikanMaster() {
    document.getElementById('modalRapikanMaster')?.classList.add('hidden');
}

function renderDuplikatMaster() {
    const list = document.getElementById('duplikatMasterList');
    const count = document.getElementById('jumlahGrupDuplikat');
    const bulkButton = document.getElementById('btnGabungSemuaDuplikat');
    const miripList = document.getElementById('duplikatMasterMiripList');
    const miripCount = document.getElementById('jumlahKandidatMirip');
    const miripRisk = document.getElementById('risikoKandidatMirip');
    const mergeAllSimilarButton = document.getElementById('btnGabungSemuaMirip');
    const miripFilter = document.getElementById('filterKandidatMirip')?.value || 'prioritas';
    if (!list) return;
    if (count) count.textContent = `${duplikatMasterGroups.length.toLocaleString('id-ID')} kelompok identik`;
    const ringkasanMirip = ringkasJaringanKandidatNamaMirip();
    const kandidatDenganMeta = duplikatMasterMirip.map((group, index) => {
        const organisasiSama = normalisasiKunciMaster(group.rows[0].asal_organisasi) === normalisasiKunciMaster(group.rows[1].asal_organisasi);
        const namaCukupPanjang = Math.min(...group.rows.map(row => normalisasiNamaMaster(row.nama).length)) >= 5;
        const ukuranJaringan = ringkasanMirip.ukuranJaringanPerNip.get(group.rows[0].nip) || 2;
        return { group, index, organisasiSama, ukuranJaringan, prioritas: organisasiSama && namaCukupPanjang && ukuranJaringan === 2 };
    });
    const jumlahPrioritas = kandidatDenganMeta.filter(item => item.prioritas).length;
    if (miripCount) miripCount.textContent = `${jumlahPrioritas.toLocaleString('id-ID')} prioritas / ${ringkasanMirip.pasangan.toLocaleString('id-ID')} pasangan`;
    if (miripRisk) {
        if (!ringkasanMirip.profil) {
            miripRisk.classList.add('hidden');
            miripRisk.innerHTML = '';
        } else {
            const contoh = ringkasanMirip.contohTerbesar.map(escapeHTML).join(', ');
            miripRisk.classList.remove('hidden');
            miripRisk.innerHTML = `<p class="font-black"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Merge massal akan menggabungkan setiap jaringan kandidat menjadi satu profil.</p><p class="mt-1">${ringkasanMirip.pasangan.toLocaleString('id-ID')} pasangan melibatkan ${ringkasanMirip.profil.toLocaleString('id-ID')} profil dalam ${ringkasanMirip.jaringan.toLocaleString('id-ID')} jaringan. Jaringan terbesar berisi ${ringkasanMirip.terbesar.toLocaleString('id-ID')} profil${contoh ? ` seperti ${contoh}${ringkasanMirip.terbesar > ringkasanMirip.contohTerbesar.length ? ', dan lainnya' : ''}` : ''}.</p><p class="mt-1">Profil berpersentase tertinggi dipertahankan; jika sama, sistem memilih hari lalu sesi terbanyak. Setiap batch disimpan agar dapat dipisahkan kembali.</p>`;
        }
    }
    if (bulkButton) bulkButton.disabled = duplikatMasterGroups.length === 0;
    if (mergeAllSimilarButton) mergeAllSimilarButton.disabled = duplikatMasterMirip.length === 0;
    if (!duplikatMasterGroups.length) {
        list.innerHTML = '<div class="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 p-5 text-sm text-emerald-700 dark:text-emerald-300"><i class="fa-solid fa-circle-check mr-2"></i>Tidak ada nama identik dalam kabupaten yang sama.</div>';
    } else {
        list.innerHTML = duplikatMasterGroups.map((group, index) => {
            const target = profilUtamaDuplikat(group);
            const nama = escapeHTML(target?.nama || '-');
            const kabupaten = escapeHTML(kabupatenMaster(target) || '-');
            const anggota = group.rows.map(row => {
                const isTarget = row.nip === target?.nip;
                return `<li class="py-2 border-b border-slate-100 dark:border-slate-700 last:border-0"><div class="flex items-center justify-between gap-3"><span><strong>${escapeHTML(row.nip)}</strong><span class="text-slate-500 dark:text-slate-400 ml-2">${Number(row.total_hari || 0)} hari</span></span><span class="text-[10px] font-black ${isTarget ? 'text-emerald-600' : 'text-amber-600'}">${isTarget ? 'DIPERTAHANKAN' : 'DIGABUNG'}</span></div><p class="text-[10px] text-slate-400 mt-1">${escapeHTML(row.asal_organisasi || '-')} • ${escapeHTML(row.jabatan || '-')}</p></li>`;
            }).join('');
            return `<article class="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800"><div class="flex flex-wrap items-start justify-between gap-3"><div><p class="font-black">${nama}</p><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Kabupaten: ${kabupaten}</p><p class="text-[10px] text-slate-400 mt-1">Bidang boleh berbeda; persentase tertinggi dipertahankan. Jika sama, dipilih hari lalu sesi terbanyak.</p></div><button onclick="gabungkanKelompokAman(${index})" class="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-black"><i class="fa-solid fa-code-merge mr-1"></i>Gabungkan kelompok</button></div><ul class="mt-3 text-xs">${anggota}</ul></article>`;
        }).join('');
    }

    if (miripList) {
        const kandidatTampil = kandidatDenganMeta
            .filter(item => miripFilter === 'semua'
                || (miripFilter === 'prioritas' && item.prioritas)
                || (miripFilter === 'organisasi_berbeda' && !item.organisasiSama))
            .sort((a, b) => Number(b.prioritas) - Number(a.prioritas)
                || String(a.group.rows[0]?.nama || '').localeCompare(String(b.group.rows[0]?.nama || ''), 'id'));
        miripList.innerHTML = kandidatTampil.length
            ? kandidatTampil.map(item => {
                const { group, index, organisasiSama, ukuranJaringan, prioritas } = item;
                const badge = prioritas
                    ? '<span class="text-[10px] font-black px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Prioritas review, bukan auto-merge</span>'
                    : organisasiSama
                        ? `<span class="text-[10px] font-black px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">Jaringan ${ukuranJaringan} profil</span>`
                        : '<span class="text-[10px] font-black px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300">Organisasi berbeda</span>';
                return `<article class="rounded-xl border border-violet-200 dark:border-violet-500/30 p-4 bg-violet-50/60 dark:bg-violet-500/5"><div class="flex flex-wrap items-center justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><p class="font-black">${escapeHTML(group.rows[0].nama)} <span class="text-slate-400">↔</span> ${escapeHTML(group.rows[1].nama)}</p>${badge}</div><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Kabupaten ${escapeHTML(group.kabupaten)} • ${escapeHTML(group.rows[0].asal_organisasi || '-')} / ${escapeHTML(group.rows[1].asal_organisasi || '-')}</p><p class="text-[10px] text-violet-600 dark:text-violet-300 mt-1">Kemiripan satu karakter hanya petunjuk, bukan bukti bahwa keduanya satu orang.</p></div><button onclick="tinjauKandidatNamaMirip(${index})" class="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-black"><i class="fa-solid fa-magnifying-glass mr-1"></i>Periksa 2 Profil</button></div></article>`;
            }).join('')
            : `<p class="text-sm text-slate-400">Tidak ada kandidat pada filter ${miripFilter === 'prioritas' ? 'prioritas review' : 'yang dipilih'}.</p>`;
    }
}

async function gabungkanKelompokAman(index, tampilkanKonfirmasi = true) {
    const group = duplikatMasterGroups[index];
    const target = profilUtamaDuplikat(group);
    const sources = (group?.rows || []).filter(row => row.nip !== target?.nip);
    if (!target || !sources.length) return { berhasil: 0, gagal: 0 };
    if (tampilkanKonfirmasi && !confirm(`Gabungkan ${sources.length} profil duplikat untuk ${target.nama} dari ${target.asal_organisasi}?\n\nNIP ${target.nip} dipertahankan. Data sumber dipindahkan ke profil utama dan salinan sebelum merge disimpan agar dapat dipisahkan kembali.`)) return { dibatalkan: true };
    try {
        const res = await callSupabaseRpc('merge_relawan_terpadu_v3', {
            p_nips: group.rows.map(row => row.nip),
            p_target_nip: target.nip,
            p_profile: {
                nama: rapikanNamaMaster(target.nama),
                asal_organisasi: rapikanOrganisasiMaster(target.asal_organisasi),
                jabatan: normalisasiJabatanMaster(target.jabatan),
                asal_daerah: target.kabupaten_normalisasi || target.asal_daerah || null,
                kabupaten_normalisasi: kabupatenMaster(target) || null,
                kategori_wilayah: kategoriWilayahEfektif(target),
                zona_asal: zonaAsalEfektif(target) || null,
                ukuran_seragam: target.ukuran_seragam || null,
                ukuran_bawahan_seragam: target.ukuran_bawahan_efektif || target.ukuran_bawahan_seragam || null,
                catatan_seragam: target.catatan_seragam || null
            },
            p_alasan: 'Nama identik dan kabupaten sama'
        });
        if (res.status !== 'success') throw new Error(res.message || 'Merge ditolak server');
        return { berhasil: sources.length, gagal: 0 };
    } catch (error) {
        console.error('Merge duplikat kabupaten:', error);
        if (tampilkanKonfirmasi) showToast(error.message || 'Merge gagal.', 'error');
        return { berhasil: 0, gagal: sources.length };
    }
}

function tinjauKandidatNamaMirip(index) {
    const group = duplikatMasterMirip[index];
    if (!group || group.rows.length < 2) return;
    manualMergeSelectedNips = new Set(group.rows.map(row => row.nip));
    const target = profilUtamaDuplikat(group);
    manualMergeTargetNip = target.nip;
    renderPengaturanMergeManual();
    isiFormMergeManual(target);
    tutupModalRapikanMaster();
    document.getElementById('modalMergeManual')?.classList.remove('hidden');
}

async function gabungkanSemuaDuplikat() {
    if (!duplikatMasterGroups.length) return;
    const konfirmasi = confirm(`Gabungkan ${duplikatMasterGroups.length} kelompok nama identik dalam kabupaten yang sama?\n\nBidang boleh berbeda. Kandidat nama berbeda satu huruf tidak ikut digabung otomatis dan tetap harus ditinjau manual.`);
    if (!konfirmasi) return;
    const groups = [...duplikatMasterGroups];
    let berhasil = 0;
    let gagal = 0;
    for (let index = 0; index < groups.length; index += 1) {
        const hasil = await gabungkanKelompokAman(index, false);
        berhasil += hasil.berhasil || 0;
        gagal += hasil.gagal || 0;
    }
    showToast(`Perapian selesai: ${berhasil} profil digabung${gagal ? `, ${gagal} gagal` : ''}.`, gagal ? 'error' : 'success');
    tutupModalRapikanMaster();
    await loadMasterData();
}

async function gabungkanSemuaKandidatMirip() {
    const ringkasan = ringkasJaringanKandidatNamaMirip();
    if (!ringkasan.pasangan) return;
    const konfirmasi = confirm(`GABUNGKAN SELURUH KANDIDAT NAMA MIRIP\n\n${ringkasan.pasangan} pasangan akan dilebur menjadi ${ringkasan.jaringan} jaringan. Setiap jaringan menjadi satu profil dan profil dengan persentase kehadiran tertinggi dipertahankan.\n\nSistem akan menyimpan jurnal lengkap agar setiap batch dapat dipisahkan kembali. Lanjutkan?`);
    if (!konfirmasi) return;

    const button = document.getElementById('btnGabungSemuaMirip');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menggabungkan...';
    try {
        const res = await callSupabaseRpc('gabungkan_semua_kandidat_mirip', {});
        if (res.status !== 'success') throw new Error((res.result && res.result.message) || res.message || 'Merge massal ditolak server');
        showToast(`Selesai: ${Number(res.profil_sumber_digabung || 0)} profil digabung dalam ${Number(res.jaringan_digabung || 0)} batch.`, 'success');
        tutupModalRapikanMaster();
        await loadMasterData();
    } catch (error) {
        showToast(error.message || 'Merge seluruh kandidat gagal.', 'error');
        console.error('Merge seluruh kandidat gagal:', error);
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-network-wired mr-1"></i>Gabungkan Semua Kandidat';
    }
}

// ==========================================
// FUNGSI KHUSUS POP-UP EXCEL FILTER MASTER (DENGAN SEARCH & SELECT/DESELECT ALL)
// ==========================================

function bukaExcelFilterMaster(columnKey, event) {
    event.stopPropagation();
    const popup = document.getElementById('excelFilterPopup');
    if (!popup) return;
    
    const rect = event.currentTarget.getBoundingClientRect();
    popup.style.top = `${rect.bottom + window.scrollY + 5}px`;
    popup.style.left = `${rect.left + window.scrollX - 180}px`;
    popup.style.width = '280px';

    // Ambil nilai unik dari seluruh masterData berdasarkan key kolom
    const uniqueValues = [...new Set(masterData.map(item => {
        let val = item[columnKey];
        return (val !== null && val !== undefined && val !== "") ? String(val) : '-';
    }))].sort();

    const currentSelected = activeExcelFilters[columnKey] || [];

    let html = `
        <div class="font-bold text-slate-700 dark:text-slate-200 mb-2 pb-1 border-b border-slate-100 dark:border-slate-600 flex justify-between items-center text-xs">
            <span>Filter & Urutkan</span>
            <span class="text-primary cursor-pointer underline hover:text-indigo-700" onclick="resetFilterKolomMaster('${columnKey}')">Reset</span>
        </div>
        
        <div class="space-y-1 mb-2 text-xs">
            <button onclick="sortDataKolomMaster('${columnKey}', 'asc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2"><i class="fa-solid fa-arrow-down-a-z text-primary"></i> Urutkan A ke Z</button>
            <button onclick="sortDataKolomMaster('${columnKey}', 'desc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2"><i class="fa-solid fa-arrow-up-z-a text-primary"></i> Urutkan Z ke A</button>
        </div>

        <!-- KOTAK PENCARIAN DI DALAM FILTER MASTER -->
        <div class="mb-2 relative">
            <i class="fa-solid fa-search absolute left-2.5 top-2 text-slate-400 text-[10px]"></i>
            <input type="text" id="searchPopupInput" onkeyup="filterListPopupMaster(this)" placeholder="Cari data..." class="w-full bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none text-slate-800 dark:text-slate-100 focus:border-primary dark:placeholder-slate-400">
        </div>

        <!-- TOMBOL PILIH SEMUA / HAPUS SEMUA MASTER -->
        <div class="flex justify-between items-center mb-1 text-[11px] font-bold text-indigo-600 px-1">
            <span class="cursor-pointer hover:underline" onclick="toggleAllPopupCheckboxMaster(true)">Pilih Semua</span>
            <span class="text-slate-300 dark:text-slate-500">|</span>
            <span class="cursor-pointer hover:underline text-red-500" onclick="toggleAllPopupCheckboxMaster(false)">Hapus Semua</span>
        </div>

        <div class="max-h-44 overflow-y-auto space-y-1 pr-1 custom-scroll border border-slate-100 dark:border-slate-600 p-1 rounded-lg bg-slate-50/50 dark:bg-slate-700/50" id="excelCheckboxList">
    `;

    uniqueValues.forEach(val => {
        const isChecked = currentSelected.length === 0 || currentSelected.includes(val) ? 'checked' : '';
        const valueAttr = escapeAttribute(val);
        const valueText = escapeHTML(val);
        html += `
            <label class="popup-item-label-master flex items-center gap-2 p-1 hover:bg-white dark:hover:bg-slate-600 rounded cursor-pointer text-xs">
                <input type="checkbox" value="${valueAttr}" data-col="${columnKey}" class="excel-filter-chk-master w-3.5 h-3.5 accent-primary rounded shrink-0" ${isChecked} onchange="terapkanExcelFilterMaster()">
                <span class="truncate text-slate-700 dark:text-slate-200 font-medium">${valueText}</span>
            </label>
        `;
    });

    html += `</div>`;
    popup.innerHTML = html;
    popup.classList.remove('hidden');
}

// FUNGSI PENDUKUNG PENCARIAN DI POP-UP MASTER
function filterListPopupMaster(input) {
    const keyword = input.value.toLowerCase();
    const labels = document.querySelectorAll('.popup-item-label-master');
    
    labels.forEach(lbl => {
        const text = lbl.innerText.toLowerCase();
        if (text.includes(keyword)) {
            lbl.style.display = "flex";
        } else {
            lbl.style.display = "none";
        }
    });
}

// FUNGSI PENDUKUNG PILIH/HAPUS SEMUA DI POP-UP MASTER
function toggleAllPopupCheckboxMaster(status) {
    const checkboxes = document.querySelectorAll('.excel-filter-chk-master');
    checkboxes.forEach(chk => {
        if (chk.closest('label').style.display !== 'none') {
            chk.checked = status;
        }
    });
    terapkanExcelFilterMaster();
}

function terapkanExcelFilterMaster() {
    const checkboxes = document.querySelectorAll('.excel-filter-chk-master');
    if (checkboxes.length === 0) return;
    const colKey = checkboxes[0].dataset.col;

    let selectedVals = [];
    checkboxes.forEach(chk => {
        if (chk.checked) selectedVals.push(chk.value);
    });

    activeExcelFilters[colKey] = selectedVals;
    currentPage = 1;
    terapkanFilterDanPaginasi();
}

function sortDataKolomMaster(columnKey, direction) {
    activeSortColumn = columnKey;
    activeSortDirection = direction;
    currentPage = 1;
    terapkanFilterDanPaginasi();
    const popup = document.getElementById('excelFilterPopup');
    if (popup) popup.classList.add('hidden');
}

function resetFilterKolomMaster(columnKey) {
    delete activeExcelFilters[columnKey];
    currentPage = 1;
    terapkanFilterDanPaginasi();
    const popup = document.getElementById('excelFilterPopup');
    if (popup) popup.classList.add('hidden');
}

// ------------------------------------------
// FUNGSI HAPUS MASSAL & TUNGGAL MASTER DATA
// ------------------------------------------

function toggleAllMaster(source) { 
    document.querySelectorAll('.master-checkbox').forEach(cb => cb.checked = source.checked); 
    toggleMasterBulkAction(); 
}

function toggleMasterBulkAction() {
    const checkboxes = [...document.querySelectorAll('.master-checkbox')];
    const count = checkboxes.filter(checkbox => checkbox.checked).length;
    const actions = document.getElementById('masterSelectionActions');
    const detailButton = document.getElementById('btnDetailMasterTerpilih');
    const editButton = document.getElementById('btnEditMasterTerpilih');
    const mergeButton = document.getElementById('btnMergeMasterTerpilih');
    const checkAll = document.getElementById('checkAllMaster');

    actions?.classList.toggle('hidden', count === 0);
    actions?.classList.toggle('flex', count > 0);
    const selectedCount = document.getElementById('selectedMasterCount');
    if (selectedCount) selectedCount.innerText = count;
    detailButton?.classList.toggle('hidden', count !== 1);
    editButton?.classList.toggle('hidden', count !== 1);
    mergeButton?.classList.toggle('hidden', count < 2);
    if (checkAll) {
        checkAll.checked = checkboxes.length > 0 && count === checkboxes.length;
        checkAll.indeterminate = count > 0 && count < checkboxes.length;
    }
}

function bersihkanPilihanMaster() {
    document.querySelectorAll('.master-checkbox').forEach(checkbox => { checkbox.checked = false; });
    const checkAll = document.getElementById('checkAllMaster');
    if (checkAll) {
        checkAll.checked = false;
        checkAll.indeterminate = false;
    }
    toggleMasterBulkAction();
}

function profilMasterTerpilihTunggal() {
    const selected = masterTerpilih();
    if (selected.length !== 1) {
        showToast('Pilih tepat satu personel untuk aksi ini.', 'error');
        return null;
    }
    return selected[0];
}

function bukaDetailMasterTerpilih() {
    const row = profilMasterTerpilihTunggal();
    if (row) bukaDetailPersonel(row.nip);
}

function bukaEditMasterTerpilih() {
    const row = profilMasterTerpilihTunggal();
    if (!row) return;
    bukaModalEdit(
        row.nip,
        row.nama,
        row.jabatan,
        row.asal_organisasi,
        row.kabupaten_normalisasi || row.asal_daerah || '',
        zonaAsalEfektif(row),
        row.ukuran_atasan_efektif || row.ukuran_seragam || '',
        row.ukuran_bawahan_efektif || row.ukuran_bawahan_seragam || '',
        row.catatan_seragam || '',
        row.kategori_personel || 'reguler',
        row.jabatan_khusus || '',
        row.alasan_khusus || ''
    );
}

async function deleteBulkMaster() {
    const checked = document.querySelectorAll('.master-checkbox:checked');
    if (checked.length === 0) return;
    await bukaHapusPermanen(Array.from(checked).map(cb => cb.value));
}

function renderRingkasanMaster() {
    const countZona = key => masterData.filter(row => zonaAsalEfektif(row) === key).length;
    const values = {
        ringkasanMasterGlobal: masterData.length,
        ringkasanMasterZona1: countZona('zona_1'),
        ringkasanMasterZona2: countZona('zona_2'),
        ringkasanMasterZona3: countZona('zona_3'),
        ringkasanMasterZona4: countZona('zona_4'),
        ringkasanMasterBelum: masterData.filter(row => !zonaAsalEfektif(row)).length
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = Number(value).toLocaleString('id-ID');
    });
    perbaruiRingkasanDuplikat();
}

function ubahUrutanMaster() {
    masterSortMode = document.getElementById('sortMaster')?.value || 'nama';
    activeSortColumn = '';
    activeSortDirection = 'asc';
    currentPage = 1;
    terapkanFilterDanPaginasi();
}

function resetKontrolMaster() {
    const values = {
        cariData: '',
        filterZonaMaster: '',
        filterJenisMaster: '',
        sortMaster: 'nama',
        limitData: '50'
    };
    Object.entries(values).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
    rowsPerPage = 50;
    masterSortMode = 'nama';
    activeExcelFilters = {};
    activeSortColumn = '';
    activeSortDirection = 'asc';
    currentPage = 1;
    terapkanFilterDanPaginasi();
}

function filterMasterWilayahKosong() {
    const zona = document.getElementById('filterZonaMaster');
    if (zona) zona.value = 'belum';
    delete activeExcelFilters.zona_asal;
    currentPage = 1;
    terapkanFilterDanPaginasi();
    showToast('Menampilkan personel yang zona asalnya belum dilengkapi.', 'info');
}

function filterMasterZona(zona) {
    const select = document.getElementById('filterZonaMaster');
    if (select) select.value = zona || '';
    delete activeExcelFilters.zona_asal;
    currentPage = 1;
    terapkanFilterDanPaginasi();
    showToast(zona ? `Menampilkan ${LABEL_ZONA_MASTER[zona] || zona}.` : 'Menampilkan seluruh zona.', 'info');
}

async function bukaHapusPermanen(nips) {
    pendingDeleteNips = [...new Set((nips || []).filter(Boolean))];
    pendingDeleteImpact = {};
    if (!pendingDeleteNips.length) return;
    document.getElementById('hapusPermanenAlasan').value = '';
    document.getElementById('hapusPermanenFrasa').value = '';
    document.getElementById('hapusPermanenSeragam').checked = false;
    document.getElementById('hapusPermanenSeragamWrap').classList.add('hidden');
    document.getElementById('hapusPermanenDampak').innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Memeriksa data terkait...';
    document.getElementById('modalHapusPermanen').classList.remove('hidden');
    try {
        const res = await callSupabaseRpc('pratinjau_hapus_personel', { p_nips: pendingDeleteNips });
        if (res.status !== 'success') throw new Error(res.message || 'Pratinjau penghapusan gagal');
        pendingDeleteImpact = res.result && typeof res.result === 'object' ? res.result : res;
        const d = pendingDeleteImpact;
        document.getElementById('hapusPermanenDampak').innerHTML = `<p class="font-black mb-2">Dampak untuk ${Number(d.profil || pendingDeleteNips.length)} profil:</p><div class="grid grid-cols-2 gap-2 text-xs"><span>Absensi: <b>${Number(d.absensi || 0).toLocaleString('id-ID')}</b></span><span>Kredit historis: <b>${Number(d.historis || 0).toLocaleString('id-ID')}</b></span><span>Status seragam: <b>${Number(d.status_seragam || 0).toLocaleString('id-ID')}</b></span><span>Riwayat seragam: <b>${Number(d.riwayat_seragam || 0).toLocaleString('id-ID')}</b></span><span>Mutasi stok dianonimkan: <b>${Number(d.mutasi_stok || 0).toLocaleString('id-ID')}</b></span><span class="${Number(d.seragam_belum_selesai || 0) ? 'text-amber-700 font-black' : ''}">Seragam belum selesai: <b>${Number(d.seragam_belum_selesai || 0).toLocaleString('id-ID')}</b></span></div>`;
        document.getElementById('hapusPermanenSeragamWrap').classList.toggle('hidden', !Number(d.seragam_belum_selesai || 0));
    } catch (error) {
        document.getElementById('hapusPermanenDampak').innerHTML = `<p class="text-red-600 font-bold">${escapeHTML(error.message || 'Pratinjau gagal.')}</p>`;
    }
}

function tutupHapusPermanen() {
    document.getElementById('modalHapusPermanen')?.classList.add('hidden');
    pendingDeleteNips = [];
    pendingDeleteImpact = {};
}

async function eksekusiHapusPermanen() {
    const frasa = document.getElementById('hapusPermanenFrasa').value;
    const alasan = document.getElementById('hapusPermanenAlasan').value.trim();
    const seragamBelum = Number(pendingDeleteImpact.seragam_belum_selesai || 0);
    const seragamSelesai = document.getElementById('hapusPermanenSeragam').checked;
    if (frasa !== 'HAPUS PERMANEN') { showToast('Ketik HAPUS PERMANEN dengan tepat.', 'error'); return; }
    if (!alasan) { showToast('Alasan penghapusan wajib diisi.', 'error'); return; }
    if (seragamBelum && !seragamSelesai) { showToast('Selesaikan dan konfirmasi status fisik seragam terlebih dahulu.', 'error'); return; }
    const btn = document.getElementById('btnEksekusiHapusPermanen');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menghapus...';
    try {
        const res = await callSupabaseRpc('hapus_personel_permanen', {
            p_nips: pendingDeleteNips, p_frasa: frasa, p_alasan: alasan,
            p_selesaikan_seragam: seragamSelesai
        });
        if (res.status !== 'success' || res.ok === false) throw new Error(res.message || 'Penghapusan ditolak database');
        showToast(`${Number(res.profil_dihapus || 0)} profil dan data terkait berhasil dihapus permanen.`, 'success');
        tutupHapusPermanen();
        document.getElementById('checkAllMaster').checked = false;
        toggleMasterBulkAction();
        await loadMasterData();
    } catch (error) {
        showToast(error.message || 'Hapus permanen gagal.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-trash mr-1"></i>Hapus Permanen';
    }
}

// ------------------------------------------
// ZONA EDIT MASTER DATA
// ------------------------------------------

let currentEditNip = "";

function kategoriWilayahOtomatisMaster(organisasi, daerah, zonaAsal) {
    const org = normalisasiKunciMaster(organisasi);
    const kabupaten = normalisasiKunciMaster(daerah);
    if (zonaAsal === 'zona_4') return 'zona_4';
    if (org === 'PUSAT' || /(^|\s)JOMBANG(\s|$)/.test(kabupaten)) return 'jombang';
    if (kabupaten || zonaAsal) return 'luar_jombang';
    return 'belum_dilengkapi';
}

function bukaModalEdit(nip, nama, bidang, org, daerah = '', zonaAsal = '', ukuran = '', ukuranBawahan = '', catatanSeragam = '', kategoriPersonel = 'reguler', jabatanKhusus = '', alasanKhusus = '') {
    currentEditMode = 'edit';
    currentEditNip = nip;
    document.getElementById('judulModalEdit').innerHTML = '<i class="fa-solid fa-pen-to-square mr-2"></i>Edit Data Personel';
    document.getElementById('subjudulModalEdit').textContent = 'Ubah seluruh profil, termasuk status personel khusus dan wilayah.';
    document.getElementById('labelEditNip').textContent = 'NIP / ID (Tidak bisa diubah)';
    document.getElementById('editNip').readOnly = true;
    document.getElementById('editNip').classList.add('cursor-not-allowed');
    document.getElementById('editNip').value = nip;
    document.getElementById('editNama').value = nama;
    document.getElementById('editBidang').value = normalisasiJabatanMaster(bidang);
    document.getElementById('editOrg').value = org;
    document.getElementById('editDaerah').value = daerah;
    document.getElementById('editZonaAsal').value = zonaAsal || '';
    document.getElementById('editUkuranSeragam').value = ukuran;
    document.getElementById('editUkuranBawahan').value = ukuranBawahan;
    document.getElementById('editCatatanSeragam').value = catatanSeragam;
    document.getElementById('editKategoriPersonel').value = kategoriPersonel || 'reguler';
    document.getElementById('editJabatanKhusus').value = jabatanKhusus;
    document.getElementById('editAlasanKhusus').value = alasanKhusus;
    ubahKategoriPersonelEdit();
    
    document.getElementById('modalEdit').classList.remove('hidden');
}

function bukaModalTambahPersonel() {
    currentEditMode = 'add';
    currentEditNip = '';
    document.getElementById('judulModalEdit').innerHTML = '<i class="fa-solid fa-user-plus mr-2"></i>Tambah Personel Manual';
    document.getElementById('subjudulModalEdit').textContent = 'Tambahkan personel reguler atau jabatan khusus. ID boleh dikosongkan agar dibuat otomatis.';
    document.getElementById('labelEditNip').textContent = 'NIP / ID (Opsional — otomatis jika kosong)';
    const nipInput = document.getElementById('editNip');
    nipInput.readOnly = false;
    nipInput.classList.remove('cursor-not-allowed');
    nipInput.value = '';
    ['editNama','editBidang','editOrg','editDaerah','editJabatanKhusus','editAlasanKhusus','editCatatanSeragam'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('editZonaAsal').value = '';
    document.getElementById('editUkuranSeragam').value = '';
    document.getElementById('editUkuranBawahan').value = '';
    document.getElementById('editKategoriPersonel').value = 'reguler';
    ubahKategoriPersonelEdit();
    document.getElementById('modalEdit').classList.remove('hidden');
    setTimeout(() => document.getElementById('editNama')?.focus(), 50);
}

function ubahKategoriPersonelEdit() {
    const khusus = document.getElementById('editKategoriPersonel')?.value === 'khusus';
    document.getElementById('editPersonelKhususFields')?.classList.toggle('hidden', !khusus);
}

function tutupModalEdit() {
    document.getElementById('modalEdit').classList.add('hidden');
}

async function simpanEditMaster() {
    const namaBaru = rapikanNamaMaster(document.getElementById('editNama').value);
    const bidangBaru = normalisasiJabatanMaster(document.getElementById('editBidang').value);
    const orgBaru = rapikanOrganisasiMaster(document.getElementById('editOrg').value);
    const daerahBaru = document.getElementById('editDaerah').value.trim();
    const zonaAsalBaru = document.getElementById('editZonaAsal').value;
    const kategoriWilayahBaru = kategoriWilayahOtomatisMaster(orgBaru, daerahBaru, zonaAsalBaru);
    const ukuranSeragamBaru = document.getElementById('editUkuranSeragam').value;
    const ukuranBawahanBaru = document.getElementById('editUkuranBawahan').value;
    const catatanSeragamBaru = document.getElementById('editCatatanSeragam').value.trim();
    const kategoriPersonelBaru = document.getElementById('editKategoriPersonel').value;
    const jabatanKhususBaru = document.getElementById('editJabatanKhusus').value.trim();
    const alasanKhususBaru = document.getElementById('editAlasanKhusus').value.trim();
    
    if(!namaBaru) {
        showToast("Nama personel tidak boleh kosong!", "error");
        return;
    }

    const btn = document.getElementById('btnSimpanEdit');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    btn.disabled = true;

    const payloadUpdate = {
        nama: namaBaru,
        jabatan: bidangBaru,
        asal_organisasi: orgBaru,
        asal_daerah: daerahBaru || null,
        kabupaten_normalisasi: normalisasiKunciMaster(daerahBaru) || kabupatenMaster({ asal_organisasi: orgBaru }) || null,
        kategori_wilayah: kategoriWilayahBaru,
        zona_asal: zonaAsalBaru || null,
        ukuran_seragam: ukuranSeragamBaru || null,
        ukuran_bawahan_seragam: ukuranBawahanBaru || null,
        catatan_seragam: catatanSeragamBaru || null,
        kategori_personel: kategoriPersonelBaru,
        jabatan_khusus: kategoriPersonelBaru === 'khusus' ? (jabatanKhususBaru || bidangBaru || null) : null,
        alasan_khusus: kategoriPersonelBaru === 'khusus' ? (alasanKhususBaru || null) : null
    };

    try {
        const res = await callSupabaseRpc('simpan_personel_v3', {
            p_nip: currentEditMode === 'add' ? (document.getElementById('editNip').value.trim() || null) : currentEditNip,
            p_nama: namaBaru, p_jabatan: bidangBaru, p_asal_organisasi: orgBaru,
            p_asal_daerah: daerahBaru || null, p_kabupaten: payloadUpdate.kabupaten_normalisasi,
            p_kategori_wilayah: kategoriWilayahBaru, p_zona_asal: zonaAsalBaru || null,
            p_ukuran_atasan: ukuranSeragamBaru || null, p_ukuran_bawahan: ukuranBawahanBaru || null,
            p_catatan_seragam: catatanSeragamBaru || null, p_kategori_personel: kategoriPersonelBaru,
            p_jabatan_khusus: payloadUpdate.jabatan_khusus, p_alasan_khusus: payloadUpdate.alasan_khusus,
            p_buat_baru: currentEditMode === 'add'
        });
        
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            showToast(currentEditMode === 'add' ? `Personel berhasil ditambahkan${res.nip ? ` dengan ID ${res.nip}` : ''}.` : "Data profil berhasil diperbarui!", "success");
            tutupModalEdit();
            loadMasterData(); 
        } else {
            throw new Error(res.message || "Gagal mengupdate ke database.");
        }
    } catch (err) {
        showToast(err.message || "Terjadi kesalahan saat mengupdate data.", "error");
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan';
        btn.disabled = false;
    }
}

// ------------------------------------------
// ZONA MERGE ENGINE (PENGGABUNGAN DATA)
// ------------------------------------------

function masterTerpilih() {
    const nips = [...document.querySelectorAll('.master-checkbox:checked')].map(checkbox => checkbox.value);
    return nips.map(nip => masterData.find(row => row.nip === nip)).filter(Boolean);
}

function bukaModalMergeTerpilih() {
    const rows = masterTerpilih();
    if (rows.length < 2) {
        showToast('Pilih sedikitnya 2 profil untuk digabung.', 'error');
        return;
    }

    manualMergeSelectedNips = new Set(rows.map(row => row.nip));
    const target = [...rows].sort(bandingkanProfilMaster)[0];
    manualMergeTargetNip = target.nip;
    renderPengaturanMergeManual();
    isiFormMergeManual(target);
    document.getElementById('modalMergeManual')?.classList.remove('hidden');
}

function tutupModalMergeManual() {
    document.getElementById('modalMergeManual')?.classList.add('hidden');
    manualMergeSelectedNips = new Set();
    manualMergeTargetNip = '';
}

function renderPengaturanMergeManual() {
    const rows = masterData
        .filter(row => manualMergeSelectedNips.has(row.nip))
        .sort(bandingkanProfilMaster);
    const select = document.getElementById('targetMergeManual');
    const list = document.getElementById('manualMergeSelectedList');
    const count = document.getElementById('manualMergeSelectedCount');
    if (!select || !list || !count) return;

    count.textContent = `${rows.length} profil akan menjadi 1`;
    select.innerHTML = rows.map(row => `<option value="${escapeAttribute(row.nip)}" ${row.nip === manualMergeTargetNip ? 'selected' : ''}>${escapeHTML(row.nama)} — ${escapeHTML(row.nip)} (${Number(row.persentase_hari || 0).toFixed(1)}% • ${Number(row.total_hari || 0)} hari)</option>`).join('');
    list.innerHTML = rows.map(row => `<div class="rounded-xl border ${row.nip === manualMergeTargetNip ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'} p-3">
        <div class="flex items-start justify-between gap-3"><div><p class="font-black text-sm text-slate-800 dark:text-slate-100">${escapeHTML(row.nama)}</p><p class="text-[10px] text-slate-500 dark:text-slate-400 mt-1">${escapeHTML(row.nip)} • ${escapeHTML(row.asal_organisasi || 'Asal belum diisi')}</p></div><span class="text-[10px] font-black ${row.nip === manualMergeTargetNip ? 'text-emerald-600' : 'text-amber-600'}">${row.nip === manualMergeTargetNip ? 'ID UTAMA' : 'AKAN DIGABUNG'}</span></div>
        <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-2"><strong>${Number(row.persentase_hari || 0).toFixed(1)}%</strong> • ${Number(row.total_hari || 0)} hari • ${Number(row.total_sesi || 0)} sesi • ${escapeHTML(normalisasiJabatanMaster(row.jabatan) || 'Jabatan belum diisi')}</p>
    </div>`).join('');
}

function isiFormMergeManual(row) {
    if (!row) return;
    document.getElementById('mergeNama').value = row.nama || '';
    document.getElementById('mergeOrg').value = row.asal_organisasi || '';
    document.getElementById('mergeBidang').value = normalisasiJabatanMaster(row.jabatan);
    document.getElementById('mergeDaerah').value = row.kabupaten_normalisasi || row.asal_daerah || '';
    document.getElementById('mergeZonaAsal').value = zonaAsalEfektif(row);
    document.getElementById('mergeUkuranSeragam').value = row.ukuran_seragam || '';
    document.getElementById('mergeUkuranBawahan').value = row.ukuran_bawahan_efektif || row.ukuran_bawahan_seragam || '';
    document.getElementById('mergeCatatanSeragam').value = row.catatan_seragam || '';
}

function pilihTargetMergeManual() {
    manualMergeTargetNip = document.getElementById('targetMergeManual')?.value || '';
    const target = masterData.find(row => row.nip === manualMergeTargetNip);
    renderPengaturanMergeManual();
    isiFormMergeManual(target);
}

async function eksekusiMergeManual() {
    const rows = masterData.filter(row => manualMergeSelectedNips.has(row.nip));
    const target = rows.find(row => row.nip === manualMergeTargetNip);
    if (!target || rows.length < 2) {
        showToast('Pilihan merge tidak lengkap. Pilih ulang dari tabel.', 'error');
        return;
    }

    const nama = rapikanNamaMaster(document.getElementById('mergeNama').value);
    const asalOrganisasi = rapikanOrganisasiMaster(document.getElementById('mergeOrg').value);
    const jabatan = normalisasiJabatanMaster(document.getElementById('mergeBidang').value);
    const asalDaerah = document.getElementById('mergeDaerah').value.trim();
    const zonaAsal = document.getElementById('mergeZonaAsal').value;
    const kategoriWilayah = kategoriWilayahOtomatisMaster(asalOrganisasi, asalDaerah, zonaAsal);
    const ukuranSeragam = document.getElementById('mergeUkuranSeragam').value;
    const ukuranBawahan = document.getElementById('mergeUkuranBawahan').value;
    const catatanSeragam = document.getElementById('mergeCatatanSeragam').value.trim();

    if (!nama || !asalOrganisasi) {
        showToast('Nama akhir dan asal organisasi wajib diisi.', 'error');
        return;
    }

    const sumber = rows.filter(row => row.nip !== target.nip);
    const daftar = rows.map(row => `• ${row.nama} — ${row.asal_organisasi || 'asal belum diisi'}`).join('\n');
    if (!confirm(`MERGE MANUAL ${rows.length} PROFIL\n\n${daftar}\n\nHasil akhir:\n${nama} — ${asalOrganisasi}\nID utama: ${target.nip}\n\nRiwayat duplikat pada tanggal, sesi, dan proyek yang sama akan dihitung satu kali. ${sumber.length} profil sumber dinonaktifkan dari Master dan dapat dipulihkan lewat Riwayat Merge.`)) return;

    const button = document.getElementById('btnEksekusiMergeManual');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menggabungkan...';

    try {
        const res = await callSupabaseRpc('merge_relawan_terpadu_v3', {
            p_nips: rows.map(row => row.nip),
            p_target_nip: target.nip,
            p_profile: {
                nama,
                asal_organisasi: asalOrganisasi,
                jabatan,
                asal_daerah: asalDaerah || null,
                kabupaten_normalisasi: normalisasiKunciMaster(asalDaerah) || kabupatenMaster({ asal_organisasi: asalOrganisasi }) || null,
                kategori_wilayah: kategoriWilayah,
                zona_asal: zonaAsal || null,
                ukuran_seragam: ukuranSeragam || null,
                ukuran_bawahan_seragam: ukuranBawahan || null,
                catatan_seragam: catatanSeragam || null
            },
            p_alasan: 'Merge manual dari pilihan Master Data'
        });
        if (res.status !== 'success') {
            const pesanServer = (res.result && res.result.message) || res.message || 'Merge ditolak server.';
            throw new Error(pesanServer);
        }

        showToast(`${rows.length} profil berhasil digabung menjadi ${nama}.`, 'success');
        tutupModalMergeManual();
        document.querySelectorAll('.master-checkbox').forEach(checkbox => { checkbox.checked = false; });
        document.getElementById('checkAllMaster').checked = false;
        toggleMasterBulkAction();
        await loadMasterData();
    } catch (error) {
        showToast(error.message || 'Gagal menggabungkan profil.', 'error');
        console.error('Merge manual gagal:', error);
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-code-merge"></i> Gabungkan & Simpan';
    }
}

// ==========================================
// ORGANISASI, ZONA, DAN RIWAYAT MERGE
// ==========================================

async function bukaModalOrganisasi() {
    document.getElementById('modalOrganisasi')?.classList.remove('hidden');
    resetFormOrganisasi();
    await muatOrganisasi();
}

function tutupModalOrganisasi() {
    document.getElementById('modalOrganisasi')?.classList.add('hidden');
    organisasiTerpilih.clear();
}

async function muatOrganisasi() {
    const list = document.getElementById('organisasiList');
    if (list) list.innerHTML = '<div class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat...</div>';
    const res = await supabaseFetchAll('v_organisasi_admin?select=*&order=organisasi_asli.asc');
    if (res.status !== 'success') {
        if (list) list.innerHTML = `<div class="p-6 text-center text-rose-500">${escapeHTML(res.message || 'Gagal memuat organisasi')}</div>`;
        return;
    }
    organisasiData = res.data || [];
    organisasiTerpilih.clear();
    renderOrganisasi();
}

async function sinkronkanZonaOtomatis() {
    const button = document.getElementById('btnSinkronZona');
    if (!button) return;
    const labelAwal = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyinkronkan...';
    try {
        const res = await callSupabaseRpc('sinkronkan_zona_otomatis', {});
        if (res.status !== 'success' || res.ok === false) {
            throw new Error(res.message || 'Sinkronisasi zona ditolak database.');
        }
        showToast(
            `${Number(res.personel_diperbarui || 0).toLocaleString('id-ID')} personel dipetakan; ${Number(res.personel_belum_dipetakan || 0).toLocaleString('id-ID')} masih perlu diisi manual.`,
            'success'
        );
        await Promise.all([muatOrganisasi(), loadMasterData()]);
    } catch (error) {
        showToast(error.message || 'Zona otomatis gagal diterapkan.', 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = labelAwal;
    }
}

function renderOrganisasi() {
    const list = document.getElementById('organisasiList');
    if (!list) return;
    const keyword = String(document.getElementById('cariOrganisasi')?.value || '').trim().toLowerCase();
    const rows = organisasiData.filter(row => [row.organisasi_asli, row.kabupaten, row.provinsi, row.zona_asal]
        .some(value => String(value || '').toLowerCase().includes(keyword)));
    list.innerHTML = rows.length ? rows.map(row => {
        const key = escapeAttribute(row.organisasi_key);
        const selected = organisasiTerpilih.has(row.organisasi_key) ? 'checked' : '';
        const zona = LABEL_ZONA_MASTER[row.zona_asal] || 'Zona belum diisi';
        return `<div class="grid grid-cols-[36px_minmax(180px,1.4fr)_minmax(120px,1fr)_100px_90px] gap-2 items-center px-3 py-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/40">
            <input type="checkbox" class="w-4 h-4 accent-cyan-600" value="${key}" ${selected} onchange="toggleOrganisasiTerpilih(this)">
            <div><p class="font-black text-slate-800 dark:text-slate-100">${escapeHTML(row.organisasi_asli)}</p><p class="text-[10px] text-slate-400 mt-1">${escapeHTML(zona)}${row.provinsi ? ` • ${escapeHTML(row.provinsi)}` : ''}</p></div>
            <div><p class="font-bold">${escapeHTML(row.kabupaten || 'Belum diisi')}</p><p class="text-[10px] text-slate-400">${escapeHTML(row.catatan || '')}</p></div>
            <span class="font-black text-center">${Number(row.jumlah_personel || 0).toLocaleString('id-ID')}</span>
            <div class="flex justify-end gap-1"><button data-key="${key}" onclick="editOrganisasi(this.dataset.key)" class="w-8 h-8 rounded-lg bg-blue-100 text-blue-700" title="Edit"><i class="fa-solid fa-pen"></i></button><button data-key="${key}" onclick="hapusOrganisasi(this.dataset.key)" class="w-8 h-8 rounded-lg bg-rose-100 text-rose-700" title="Hapus"><i class="fa-solid fa-trash"></i></button></div>
        </div>`;
    }).join('') : '<div class="p-6 text-center text-slate-400">Organisasi tidak ditemukan.</div>';
    perbaruiTargetMergeOrganisasi();
}

function toggleOrganisasiTerpilih(checkbox) {
    if (checkbox.checked) organisasiTerpilih.add(checkbox.value);
    else organisasiTerpilih.delete(checkbox.value);
    perbaruiTargetMergeOrganisasi();
}

function perbaruiTargetMergeOrganisasi() {
    const select = document.getElementById('targetMergeOrganisasi');
    const button = document.getElementById('btnMergeOrganisasi');
    if (!select || !button) return;
    const previous = select.value;
    const selectedRows = organisasiData.filter(row => organisasiTerpilih.has(row.organisasi_key));
    select.innerHTML = '<option value="">Pilih organisasi utama</option>' + selectedRows.map(row => `<option value="${escapeAttribute(row.organisasi_key)}">${escapeHTML(row.organisasi_asli)} (${Number(row.jumlah_personel || 0)})</option>`).join('');
    if (selectedRows.some(row => row.organisasi_key === previous)) select.value = previous;
    button.disabled = selectedRows.length < 2;
}

function resetFormOrganisasi() {
    ['organisasiKeyLama', 'organisasiNama', 'organisasiKabupaten', 'organisasiProvinsi', 'organisasiCatatan'].forEach(id => {
        const input = document.getElementById(id); if (input) input.value = '';
    });
    const zona = document.getElementById('organisasiZona'); if (zona) zona.value = '';
    const title = document.getElementById('judulFormOrganisasi'); if (title) title.textContent = 'Tambah Organisasi';
}

function editOrganisasi(key) {
    const row = organisasiData.find(item => item.organisasi_key === key);
    if (!row) return;
    document.getElementById('organisasiKeyLama').value = row.organisasi_key;
    document.getElementById('organisasiNama').value = row.organisasi_asli || '';
    document.getElementById('organisasiKabupaten').value = row.kabupaten || '';
    document.getElementById('organisasiProvinsi').value = row.provinsi || '';
    document.getElementById('organisasiZona').value = row.zona_asal || '';
    document.getElementById('organisasiCatatan').value = row.catatan || '';
    document.getElementById('judulFormOrganisasi').textContent = `Edit ${row.organisasi_asli}`;
}

function sarankanZonaOrganisasi() {
    const zona = zonaDariProvinsiMaster(document.getElementById('organisasiProvinsi')?.value);
    if (zona) document.getElementById('organisasiZona').value = zona;
}

async function simpanOrganisasi() {
    const nama = normalisasiKunciMaster(document.getElementById('organisasiNama')?.value);
    const kabupaten = normalisasiKunciMaster(document.getElementById('organisasiKabupaten')?.value);
    if (!nama || !kabupaten) {
        showToast('Nama organisasi dan kabupaten/kota wajib diisi.', 'error');
        return;
    }
    const button = document.getElementById('btnSimpanOrganisasi');
    button.disabled = true;
    try {
        const res = await callSupabaseRpc('simpan_organisasi', {
            p_key_lama: document.getElementById('organisasiKeyLama').value || null,
            p_nama: nama,
            p_kabupaten: kabupaten,
            p_provinsi: normalisasiKunciMaster(document.getElementById('organisasiProvinsi').value) || null,
            p_zona_asal: document.getElementById('organisasiZona').value || null,
            p_catatan: document.getElementById('organisasiCatatan').value.trim() || null
        });
        if (res.status !== 'success') throw new Error(res.message || 'Organisasi gagal disimpan');
        showToast('Organisasi dan zona berhasil disimpan.', 'success');
        resetFormOrganisasi();
        await Promise.all([muatOrganisasi(), loadMasterData()]);
    } catch (error) {
        showToast(error.message || 'Gagal menyimpan organisasi.', 'error');
    } finally {
        button.disabled = false;
    }
}

async function hapusOrganisasi(key) {
    const row = organisasiData.find(item => item.organisasi_key === key);
    if (!row || !confirm(`Hapus organisasi ${row.organisasi_asli}?\n\nPenghapusan hanya diizinkan jika tidak ada personel yang masih memakai organisasi ini.`)) return;
    const res = await callSupabaseRpc('hapus_organisasi', { p_organisasi_key: key });
    if (res.status !== 'success') {
        showToast(res.message || 'Organisasi tidak dapat dihapus.', 'error');
        return;
    }
    showToast('Organisasi berhasil dihapus.', 'success');
    await muatOrganisasi();
}

async function mergeOrganisasiTerpilih() {
    const target = document.getElementById('targetMergeOrganisasi')?.value;
    const keys = [...organisasiTerpilih];
    const targetRow = organisasiData.find(row => row.organisasi_key === target);
    if (!target || keys.length < 2 || !targetRow) {
        showToast('Pilih minimal dua organisasi dan organisasi utama.', 'error');
        return;
    }
    if (!confirm(`Gabungkan ${keys.length} organisasi menjadi ${targetRow.organisasi_asli}?\n\nSeluruh personel dan riwayat absensi akan memakai nama organisasi utama.`)) return;
    const res = await callSupabaseRpc('merge_organisasi', { p_source_keys: keys, p_target_key: target });
    if (res.status !== 'success') {
        showToast(res.message || 'Merge organisasi gagal.', 'error');
        return;
    }
    showToast(`${Number(res.personel_diperbarui || 0)} personel diperbarui ke ${targetRow.organisasi_asli}.`, 'success');
    organisasiTerpilih.clear();
    await Promise.all([muatOrganisasi(), loadMasterData()]);
}

async function bukaRiwayatMerge() {
    document.getElementById('modalRiwayatMerge')?.classList.remove('hidden');
    const list = document.getElementById('riwayatMergeList');
    list.innerHTML = '<div class="p-8 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat...</div>';
    const res = await supabaseFetchAll('v_riwayat_merge_personel?select=*&order=id.desc');
    if (res.status !== 'success') {
        list.innerHTML = `<div class="p-8 text-center text-rose-500">${escapeHTML(res.message || 'Gagal memuat riwayat merge')}</div>`;
        return;
    }
    riwayatMergeData = res.data || [];
    renderRiwayatMerge();
}

function tutupRiwayatMerge() {
    document.getElementById('modalRiwayatMerge')?.classList.add('hidden');
}

function renderRiwayatMerge() {
    const list = document.getElementById('riwayatMergeList');
    if (!list) return;
    list.innerHTML = riwayatMergeData.length ? riwayatMergeData.map(row => {
        const aktif = row.status === 'aktif';
        const bisa = aktif && row.dapat_dipisahkan;
        return `<article class="rounded-xl border ${aktif ? 'border-violet-200 dark:border-violet-500/30' : 'border-slate-200 dark:border-slate-700'} p-4 bg-white dark:bg-slate-800">
            <div class="flex flex-wrap items-start justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><p class="font-black text-slate-800 dark:text-slate-100">#${Number(row.id)} · ${escapeHTML(row.target_nama)}</p><span class="text-[10px] font-black px-2 py-1 rounded-full ${aktif ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700'}">${aktif ? 'TERGABUNG' : 'SUDAH DIPISAHKAN'}</span></div><p class="text-xs text-slate-500 mt-1">${Number(row.jumlah_profil)} profil · ${escapeHTML(row.profil_digabung || '-')} → ${escapeHTML(row.target_nip)}</p><p class="text-[10px] text-slate-400 mt-1">${escapeHTML(row.alasan || 'Merge Master Data')} · ${new Date(row.dibuat_pada).toLocaleString('id-ID')}</p></div>${aktif ? `<button onclick="pisahkanMerge(${Number(row.id)})" ${bisa ? '' : 'disabled'} class="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-black disabled:opacity-40" title="${bisa ? 'Pulihkan data sebelum merge' : 'Pisahkan merge yang lebih baru terlebih dahulu'}"><i class="fa-solid fa-object-ungroup mr-1"></i>Pisahkan</button>` : ''}</div>
        </article>`;
    }).join('') : '<div class="p-8 text-center text-slate-400">Belum ada merge tercatat setelah Fase 13.</div>';
}

async function pisahkanMerge(batchId) {
    const row = riwayatMergeData.find(item => Number(item.id) === Number(batchId));
    if (!row || !confirm(`Pisahkan batch #${batchId}?\n\n${row.profil_digabung || 'Profil sumber'} akan dipulihkan bersama data sebelum merge. Kehadiran baru setelah merge tetap berada pada profil utama.`)) return;
    const res = await callSupabaseRpc('pisahkan_merge_personel', { p_batch_id: Number(batchId) });
    if (res.status !== 'success') {
        showToast(res.message || 'Hasil merge tidak dapat dipisahkan.', 'error');
        return;
    }
    showToast(`${Number(res.profil_dipulihkan || 0)} profil berhasil dipulihkan.`, 'success');
    await Promise.all([bukaRiwayatMerge(), loadMasterData()]);
}

// ==========================================
// ZONA IMPORT CSV
// ==========================================
let importCSVData = [];

function bukaModalImportCSV() {
    importCSVData = [];
    document.getElementById('importStepUpload').classList.remove('hidden');
    document.getElementById('importStepPreview').classList.add('hidden');
    document.getElementById('fileCSV').value = '';
    document.getElementById('importTotalInfo').textContent = 'Belum ada data';
    document.getElementById('btnSubmitImport').disabled = true;
    document.getElementById('modalImportCSV').classList.remove('hidden');
}

function tutupModalImportCSV() {
    document.getElementById('modalImportCSV').classList.add('hidden');
    importCSVData = [];
}

function resetImportCSV() {
    importCSVData = [];
    document.getElementById('importStepUpload').classList.remove('hidden');
    document.getElementById('importStepPreview').classList.add('hidden');
    document.getElementById('fileCSV').value = '';
    document.getElementById('importTotalInfo').textContent = 'Belum ada data';
    document.getElementById('btnSubmitImport').disabled = true;
}

function handleFileCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.csv')) {
        showToast("File harus berformat .csv!", "error");
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        parseCSV(content);
    };
    reader.readAsText(file);
}

function parseCSVRows(content) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const text = String(content || '').replace(/^\uFEFF/, '');

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            } else {
                quoted = !quoted;
            }
        } else if (ch === ',' && !quoted) {
            row.push(cell.trim());
            cell = '';
        } else if ((ch === '\n' || ch === '\r') && !quoted) {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell.trim());
            if (row.some(value => value !== '')) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += ch;
        }
    }

    row.push(cell.trim());
    if (row.some(value => value !== '')) rows.push(row);
    return rows;
}

function parseCSV(content) {
    const rows = parseCSVRows(content);
    if (rows.length === 0) {
        showToast("File CSV kosong!", "error");
        return;
    }

    importCSVData = [];
    let startIndex = 0;
    
    const firstLine = rows[0].join(',').toLowerCase();
    if (firstLine.includes('nama') || firstLine.includes('name') || firstLine.includes('nip') || firstLine.includes('jabatan') || firstLine.includes('organisasi')) {
        startIndex = 1;
    }
    
    for (let i = startIndex; i < rows.length; i++) {
        const cols = rows[i].map(c => c.trim());
        
        if (cols.length < 2) continue;
        
        let nip, nama, jabatan, organisasi;
        
        if (cols.length >= 4) {
            nip = cols[0] || '';
            nama = cols[1] || '';
            jabatan = cols[2] || '';
            organisasi = cols[3] || '';
        } else if (cols.length === 3) {
            nip = '';
            nama = cols[0] || '';
            jabatan = cols[1] || '';
            organisasi = cols[2] || '';
        } else {
            nip = '';
            nama = cols[0] || '';
            jabatan = '';
            organisasi = '';
        }
        
        if (!nama || nama === '') continue;
        
        nama = rapikanNamaMaster(nama);
        organisasi = rapikanOrganisasiMaster(organisasi);
        
        const existing = masterData.find(r => r.nama === nama);
        const nipFinal = nip || (existing ? existing.nip : `REL-${nama.replace(/\s+/g, '').substring(0,10)}${Math.floor(1000 + Math.random() * 9000)}`);
        
        importCSVData.push({
            nip: nipFinal,
            nama: nama,
            jabatan: normalisasiJabatanMaster(jabatan || (existing ? existing.jabatan : 'Helper')),
            asal_organisasi: organisasi || (existing ? existing.asal_organisasi : 'Umum'),
            isDuplicate: !!existing
        });
    }
    
    if (importCSVData.length === 0) {
        showToast("Tidak ada data valid ditemukan di CSV!", "error");
        return;
    }
    
    renderImportPreview();
}

function renderImportPreview() {
    document.getElementById('importStepUpload').classList.add('hidden');
    document.getElementById('importStepPreview').classList.remove('hidden');
    
    const tbody = document.getElementById('importPreviewBody');
    const newCount = importCSVData.filter(d => !d.isDuplicate).length;
    const dupeCount = importCSVData.filter(d => d.isDuplicate).length;
    
    document.getElementById('importInfo').textContent = `${importCSVData.length} data ditemukan (${newCount} baru, ${dupeCount} sudah ada)`;
    document.getElementById('importTotalInfo').textContent = `${importCSVData.length} data siap diimport`;
    document.getElementById('btnSubmitImport').disabled = false;
    
    let html = '';
    importCSVData.forEach((row, idx) => {
        const statusBadge = row.isDuplicate 
            ? '<span class="bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] px-2 py-0.5 rounded font-bold">Sudah Ada</span>'
            : '<span class="bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] px-2 py-0.5 rounded font-bold">Baru</span>';
        
        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <td class="px-4 py-2 text-center text-slate-400 font-bold">${idx + 1}</td>
                <td class="px-4 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">${escapeHTML(row.nip)}</td>
                <td class="px-4 py-2 font-bold text-slate-800 dark:text-slate-100">${escapeHTML(row.nama)}</td>
                <td class="px-4 py-2 text-slate-600 dark:text-slate-300">${escapeHTML(row.jabatan)}</td>
                <td class="px-4 py-2 text-slate-600 dark:text-slate-300">${escapeHTML(row.asal_organisasi)}</td>
                <td class="px-4 py-2 text-center">${statusBadge}</td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

async function submitImportCSV() {
    if (importCSVData.length === 0) return;
    
    const btn = document.getElementById('btnSubmitImport');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengimport...';
    btn.disabled = true;
    
    const newData = importCSVData.filter(d => !d.isDuplicate);
    
    try {
        if (newData.length > 0) {
            const rows = newData.map(d => ({
                    nip: d.nip,
                    nama: d.nama,
                    jabatan: d.jabatan,
                    asal_organisasi: d.asal_organisasi
                }));
            let inserted = 0;
            let skipped = 0;

            if (FASE5_ENABLED) {
                const res = await callSupabaseRpc('import_master_batch', { p_rows: rows });
                if (res.status !== 'success') {
                    throw new Error(res.message || 'Database menolak import Master Data');
                }
                inserted = res.inserted != null ? res.inserted : 0;
                skipped = res.skipped != null ? res.skipped : 0;
            } else {
                // Kompatibel dengan database lama. Setiap batch diverifikasi,
                // tetapi keseluruhan import belum menjadi satu transaksi.
                const batchSize = 50;
                for (let i = 0; i < rows.length; i += batchSize) {
                    const batch = rows.slice(i, i + batchSize);
                    const res = await supabaseFetch('master_relawan', 'POST', batch);
                    if (res.status !== 'success') {
                        throw new Error(`Import berhenti setelah ${inserted} data tersimpan. ${res.message || 'Database menolak batch berikutnya.'}`);
                    }
                    inserted += batch.length;
                }
            }
            showToast(`${inserted} data baru berhasil diimport${skipped ? `, ${skipped} dilewati` : ''}.`, "success");
        } else {
            showToast("Tidak ada data baru untuk diimport.", "info");
        }
        tutupModalImportCSV();
        loadMasterData();
        
    } catch (err) {
        showToast(err.message || "Gagal mengimport data. Silakan coba lagi.", "error");
        console.error("Import Error:", err);
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Import ke Database';
        btn.disabled = false;
    }
}

// ------------------------------------------
// DETAIL PERSONEL & EKSPOR
// ------------------------------------------

async function bukaDetailPersonel(nip) {
    if (!nip) return;
    const modal = document.getElementById('modalDetailPersonel');
    const content = document.getElementById('detailPersonelIsi');
    currentDetailPersonel = null;
    document.getElementById('detailPersonelJudul').textContent = nip;
    content.innerHTML = '<div class="p-10 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat detail...</div>';
    modal.classList.remove('hidden');
    try {
        const res = await callSupabaseRpc('detail_personel_v3', { p_nip: nip });
        if (res.status !== 'success' || !res.profile) throw new Error(res.message || 'Detail personel tidak tersedia');
        currentDetailPersonel = res;
        renderDetailPersonel();
    } catch (error) {
        content.innerHTML = `<div class="p-8 text-center text-red-600 font-bold">${escapeHTML(error.message || 'Gagal memuat detail personel.')}</div>`;
    }
}

function tutupDetailPersonel() {
    document.getElementById('modalDetailPersonel')?.classList.add('hidden');
    currentDetailPersonel = null;
}

function renderDetailPersonel() {
    const data = currentDetailPersonel || {};
    const p = data.profile || {};
    const projects = Array.isArray(data.projects) ? data.projects : [];
    const attendance = Array.isArray(data.attendance) ? data.attendance : [];
    const uniform = Array.isArray(data.uniform_history) ? data.uniform_history : [];
    document.getElementById('detailPersonelJudul').textContent = `${p.nama || '-'} • ${p.nip || '-'}`;
    const projectRows = projects.length ? projects.map(row => `<tr><td class="px-3 py-2 font-bold">${escapeHTML(row.nama_proyek || '-')}</td><td class="px-3 py-2">${escapeHTML(row.kategori === 'khususul_khusus' ? '5 Proyek Khususul Khusus' : 'Proyek Lainnya')}</td><td class="px-3 py-2 text-center font-black">${Number(row.total_hari_proyek || 0)}</td><td class="px-3 py-2 text-center">${Number(row.total_sesi_proyek || 0)}</td><td class="px-3 py-2">${formatTanggalMaster(row.hadir_pertama_proyek)}</td><td class="px-3 py-2">${formatTanggalMaster(row.hadir_terakhir_proyek)}</td></tr>`).join('') : '<tr><td colspan="6" class="p-5 text-center text-slate-400">Belum ada kehadiran proyek.</td></tr>';
    const attendanceRows = attendance.length ? attendance.map(row => `<tr><td class="px-3 py-2">${formatTanggalMaster(row.tanggal)}</td><td class="px-3 py-2 font-bold">${escapeHTML(row.sesi || '-')}</td><td class="px-3 py-2">${escapeHTML(row.lokasi || '-')}</td></tr>`).join('') : '<tr><td colspan="3" class="p-5 text-center text-slate-400">Belum ada riwayat absensi.</td></tr>';
    const uniformRows = uniform.length ? uniform.slice(0, 20).map(row => `<tr><td class="px-3 py-2">${new Date(row.dibuat_pada).toLocaleString('id-ID')}</td><td class="px-3 py-2">${escapeHTML(row.status_proses || '-')}</td><td class="px-3 py-2">${escapeHTML(row.status_penguasaan || '-')}</td><td class="px-3 py-2">${escapeHTML(`${row.ukuran_atasan || row.ukuran || '-'} / ${row.ukuran_bawahan || '-'}`)}</td><td class="px-3 py-2">${escapeHTML(row.catatan || '-')}</td></tr>`).join('') : '<tr><td colspan="5" class="p-5 text-center text-slate-400">Belum ada riwayat seragam.</td></tr>';
    document.getElementById('detailPersonelIsi').innerHTML = `
        <section class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div class="rounded-xl bg-slate-50 dark:bg-slate-700/50 p-3"><p class="text-[10px] uppercase font-black text-slate-400">Jenis</p><p class="font-black mt-1">${p.kategori_personel === 'khusus' ? 'Personel Khusus' : 'Reguler'}</p></div>
            <div class="rounded-xl bg-slate-50 dark:bg-slate-700/50 p-3"><p class="text-[10px] uppercase font-black text-slate-400">Kehadiran</p><p class="font-black mt-1">${Number(p.total_hari || 0)} hari / ${Number(p.total_sesi || 0)} sesi</p></div>
            <div class="rounded-xl bg-slate-50 dark:bg-slate-700/50 p-3"><p class="text-[10px] uppercase font-black text-slate-400">Pertama Hadir</p><p class="font-black mt-1">${formatTanggalMaster(p.hadir_pertama)}</p></div>
            <div class="rounded-xl bg-slate-50 dark:bg-slate-700/50 p-3"><p class="text-[10px] uppercase font-black text-slate-400">Terakhir Hadir</p><p class="font-black mt-1">${formatTanggalMaster(p.hadir_terakhir)}</p></div>
        </section>
        <section class="rounded-xl border border-slate-200 dark:border-slate-700 p-4 mb-5"><h4 class="font-black mb-2">Profil Terpadu</h4><div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm"><p><span class="text-slate-400">ID:</span> <b>${escapeHTML(p.nip || '-')}</b></p><p><span class="text-slate-400">Jenis:</span> <b>${escapeHTML(p.jenis_personel_label || 'Reguler')}</b></p><p><span class="text-slate-400">Jabatan:</span> <b>${escapeHTML(p.jabatan_khusus || p.jabatan || '-')}</b></p><p><span class="text-slate-400">Organisasi:</span> <b>${escapeHTML(p.asal_organisasi || '-')}</b></p><p><span class="text-slate-400">Kabupaten/Kota:</span> <b>${escapeHTML(p.kabupaten_normalisasi || p.asal_daerah || '-')}</b></p><p><span class="text-slate-400">Zona:</span> <b>${escapeHTML(p.zona_label || LABEL_ZONA_MASTER[p.zona_asal] || 'Belum diisi')}</b></p><p><span class="text-slate-400">Ukuran atasan/bawahan:</span> <b>${escapeHTML(`${p.ukuran_atasan_efektif || '-'} / ${p.ukuran_bawahan_efektif || '-'}`)}</b></p><p><span class="text-slate-400">Status seragam:</span> <b>${escapeHTML(p.status_seragam || 'Belum tercatat')}</b></p><p><span class="text-slate-400">Persentase:</span> <b>${Number(p.persentase_hari || 0).toFixed(1)}%</b></p></div></section>
        <section class="mb-5"><h4 class="font-black mb-2"><i class="fa-solid fa-location-dot text-indigo-600 mr-2"></i>Lokasi/Proyek yang Pernah Dihadiri</h4><div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><table class="w-full text-xs"><thead class="bg-slate-100 dark:bg-slate-700"><tr><th class="px-3 py-2 text-left">Lokasi</th><th class="px-3 py-2 text-left">Kelompok</th><th class="px-3 py-2">Hari</th><th class="px-3 py-2">Sesi</th><th class="px-3 py-2 text-left">Pertama</th><th class="px-3 py-2 text-left">Terakhir</th></tr></thead><tbody>${projectRows}</tbody></table></div></section>
        <details open class="mb-5"><summary class="font-black cursor-pointer mb-2">Riwayat Kehadiran (${attendance.length})</summary><div class="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700"><table class="w-full text-xs"><thead class="sticky top-0 bg-slate-100 dark:bg-slate-700"><tr><th class="px-3 py-2 text-left">Tanggal</th><th class="px-3 py-2 text-left">Sesi</th><th class="px-3 py-2 text-left">Lokasi</th></tr></thead><tbody>${attendanceRows}</tbody></table></div></details>
        <details><summary class="font-black cursor-pointer mb-2">Riwayat Seragam (${uniform.length})</summary><div class="max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700"><table class="w-full text-xs"><thead class="sticky top-0 bg-slate-100 dark:bg-slate-700"><tr><th class="px-3 py-2 text-left">Waktu</th><th class="px-3 py-2 text-left">Proses</th><th class="px-3 py-2 text-left">Keberadaan</th><th class="px-3 py-2 text-left">Ukuran</th><th class="px-3 py-2 text-left">Catatan</th></tr></thead><tbody>${uniformRows}</tbody></table></div></details>`;
}

function dataExportMaster() {
    return (filteredData || []).map((r, index) => ({
        No: index + 1, ID: r.nip || '', Nama: r.nama || '',
        'Jenis Personel': r.kategori_personel === 'khusus' ? 'Khusus' : 'Reguler',
        Jabatan: r.jabatan_khusus || r.jabatan || '', Organisasi: r.asal_organisasi || '',
        'Kabupaten/Kota': r.kabupaten_normalisasi || r.asal_daerah || '',
        Zona: LABEL_ZONA_MASTER[zonaAsalEfektif(r)] || 'Belum diisi',
        'Total Hari': Number(r.total_hari || 0), 'Total Sesi': Number(r.total_sesi || 0),
        'Jumlah Proyek': Number(r.jumlah_proyek || 0), 'Persentase Hari': Number(r.persentase_hari || 0),
        'Pertama Hadir': r.hadir_pertama || '', 'Terakhir Hadir': r.hadir_terakhir || '',
        'Ukuran Atasan': r.ukuran_atasan_efektif || r.ukuran_seragam || '',
        'Ukuran Bawahan': r.ukuran_bawahan_efektif || r.ukuran_bawahan_seragam || '',
        'Status Seragam': r.status_seragam || '',
        Catatan: r.catatan_seragam || r.alasan_khusus || ''
    }));
}

function exportMasterExcel() {
    if (!window.XLSX) { showToast('Pustaka Excel belum termuat. Periksa koneksi lalu muat ulang.', 'error'); return; }
    const rows = dataExportMaster();
    if (!rows.length) { showToast('Tidak ada data sesuai filter untuk diekspor.', 'error'); return; }
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = Object.keys(rows[0]).map(key => ({ wch: Math.min(42, Math.max(12, key.length + 3)) }));
    XLSX.utils.book_append_sheet(book, sheet, 'Master Personel');
    XLSX.writeFile(book, `master-personel-${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast(`${rows.length} personel diekspor ke Excel.`, 'success');
}

function cetakLaporanHtml(judul, subjudul, isi) {
    const popup = window.open('', '_blank', 'width=1100,height=800');
    if (!popup) { showToast('Izinkan pop-up untuk membuat PDF.', 'error'); return; }
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(judul)}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:28px}h1{font-size:20px;margin:0}p.meta{font-size:11px;color:#64748b;margin:6px 0 18px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:top}th{background:#eef2ff}h2{font-size:14px;margin-top:22px}@page{size:A4 landscape;margin:10mm}</style></head><body><h1>${escapeHTML(judul)}</h1><p class="meta">${escapeHTML(subjudul)} • Dibuat ${new Date().toLocaleString('id-ID')}</p>${isi}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
    popup.document.close();
}

function exportMasterPdf() {
    const rows = dataExportMaster();
    if (!rows.length) { showToast('Tidak ada data sesuai filter untuk diekspor.', 'error'); return; }
    const columns = ['No','ID','Nama','Jenis Personel','Jabatan','Organisasi','Kabupaten/Kota','Zona','Total Hari','Total Sesi','Persentase Hari','Pertama Hadir','Terakhir Hadir'];
    const head = columns.map(key => `<th>${escapeHTML(key)}</th>`).join('');
    const body = rows.map(row => `<tr>${columns.map(key => `<td>${escapeHTML(row[key] ?? '')}</td>`).join('')}</tr>`).join('');
    cetakLaporanHtml('Master Data Personel', `${rows.length} data sesuai pencarian dan filter aktif`, `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
}

function exportDetailPersonelExcel() {
    if (!currentDetailPersonel || !window.XLSX) { showToast('Detail atau pustaka Excel belum tersedia.', 'error'); return; }
    const p = currentDetailPersonel.profile || {};
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([dataExportMaster().find(r => r.ID === p.nip) || p]), 'Profil');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(currentDetailPersonel.projects || []), 'Lokasi Proyek');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(currentDetailPersonel.attendance || []), 'Riwayat Kehadiran');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(currentDetailPersonel.uniform_history || []), 'Riwayat Seragam');
    XLSX.writeFile(book, `detail-${String(p.nama || p.nip || 'personel').replace(/[^A-Za-z0-9]+/g,'-')}.xlsx`);
}

function exportDetailPersonelPdf() {
    if (!currentDetailPersonel) { showToast('Detail personel belum tersedia.', 'error'); return; }
    const p = currentDetailPersonel.profile || {};
    const projects = currentDetailPersonel.projects || [];
    const attendance = currentDetailPersonel.attendance || [];
    const projectBody = projects.map(r => `<tr><td>${escapeHTML(r.nama_proyek || '-')}</td><td>${escapeHTML(r.kategori || '-')}</td><td>${Number(r.total_hari_proyek || 0)}</td><td>${Number(r.total_sesi_proyek || 0)}</td><td>${formatTanggalMaster(r.hadir_pertama_proyek)}</td><td>${formatTanggalMaster(r.hadir_terakhir_proyek)}</td></tr>`).join('');
    const attendanceBody = attendance.map(r => `<tr><td>${formatTanggalMaster(r.tanggal)}</td><td>${escapeHTML(r.sesi || '-')}</td><td>${escapeHTML(r.lokasi || '-')}</td></tr>`).join('');
    cetakLaporanHtml(`Detail Personel — ${p.nama || '-'}`, `ID ${p.nip || '-'} • ${Number(p.total_hari || 0)} hari • ${Number(p.total_sesi || 0)} sesi`, `<h2>Profil</h2><table><tbody><tr><th>Jabatan</th><td>${escapeHTML(p.jabatan_khusus || p.jabatan || '-')}</td><th>Organisasi</th><td>${escapeHTML(p.asal_organisasi || '-')}</td></tr><tr><th>Daerah</th><td>${escapeHTML(p.kabupaten_normalisasi || p.asal_daerah || '-')}</td><th>Jenis</th><td>${p.kategori_personel === 'khusus' ? 'Khusus' : 'Reguler'}</td></tr></tbody></table><h2>Lokasi/Proyek</h2><table><thead><tr><th>Lokasi</th><th>Kelompok</th><th>Hari</th><th>Sesi</th><th>Pertama</th><th>Terakhir</th></tr></thead><tbody>${projectBody}</tbody></table><h2>Riwayat Kehadiran</h2><table><thead><tr><th>Tanggal</th><th>Sesi</th><th>Lokasi</th></tr></thead><tbody>${attendanceBody}</tbody></table>`);
}
