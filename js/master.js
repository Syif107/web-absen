// ==========================================
// LOGIKA MASTER DATA, PAGINATION, & MERGE ENGINE
// ==========================================

let masterData = [];
let filteredData = []; // Menyimpan data setelah difilter/search
let currentPage = 1;
let rowsPerPage = 50;
let isNewestFilter = false;
let masterSortMode = 'nama';
let duplikatMasterGroups = [];
let duplikatMasterMirip = [];
let manualMergeSelectedNips = new Set();
let manualMergeTargetNip = '';

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
    if (event.key === 'Escape' && modalEdit && !modalEdit.classList.contains('hidden')) {
        tutupModalEdit();
    }
    if (event.key === 'Escape' && modalMergeManual && !modalMergeManual.classList.contains('hidden')) {
        tutupModalMergeManual();
    }
    if (event.ctrlKey && event.key === 'Enter' && modalEdit && !modalEdit.classList.contains('hidden')) {
        event.preventDefault();
        simpanEditMaster();
    }
});

// 1. Tarik Data Master Sekali di Awal
async function loadMasterData() {
    try {
        const [res, ringkasanRes] = await Promise.all([
            supabaseFetchAll('master_relawan?select=*&order=nip.asc'),
            supabaseFetchAll('v_ringkasan_personel?select=*&order=nama.asc')
        ]);
        if (ringkasanRes.status === "success") {
            masterData = Array.isArray(ringkasanRes.data) ? ringkasanRes.data : [];
            renderRingkasanMaster();
            document.getElementById('totalMasterInfo').innerText = `Total: ${masterData.length} Relawan`;
            
            terapkanFilterDanPaginasi();
        } else if (res.status === "success") {
            masterData = res.data || [];
            renderRingkasanMaster();
            document.getElementById('totalMasterInfo').innerText = `Total: ${masterData.length} Relawan`;
            terapkanFilterDanPaginasi();
        } else {
            showToast("Gagal mengambil data master.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

// 2. Fungsi Saat Pilihan Dropdown Diubah
function gantiBatasData() {
    const val = document.getElementById('limitData').value;
    if(val === 'newest') {
        isNewestFilter = true;
        rowsPerPage = 50; 
    } else {
        isNewestFilter = false;
        rowsPerPage = parseInt(val);
    }
    currentPage = 1; 
    terapkanFilterDanPaginasi();
}

// 3. Fungsi Saat Mengetik di Kolom Pencarian Global
function filterTabelMaster() {
    currentPage = 1; 
    terapkanFilterDanPaginasi();
}

// 4. Inti Mesin Penyaringan, Excel Filter, & Pengurutan Data
function terapkanFilterDanPaginasi() {
    const keyword = document.getElementById('cariData').value.toLowerCase();
    
    // Filter Pencarian Global
    filteredData = masterData.filter(r => 
        (r.nama && r.nama.toLowerCase().includes(keyword)) || 
        (r.asal_organisasi && r.asal_organisasi.toLowerCase().includes(keyword)) ||
        (r.asal_daerah && r.asal_daerah.toLowerCase().includes(keyword)) ||
        (kategoriWilayahEfektif(r) && kategoriWilayahEfektif(r).toLowerCase().includes(keyword)) ||
        (r.nip && r.nip.toLowerCase().includes(keyword))
    );

    // Filter berdasarkan pop-up Excel (Checkbox kolom aktif)
    Object.keys(activeExcelFilters).forEach(col => {
        const allowedVals = activeExcelFilters[col];
        if (allowedVals && allowedVals.length > 0) {
            filteredData = filteredData.filter(item => {
                const itemValue = col === 'kategori_wilayah' ? kategoriWilayahEfektif(item) : item[col];
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
        if (isNewestFilter && keyword === "" && Object.keys(activeExcelFilters).length === 0) {
            filteredData = [...masterData].reverse();
        } else {
            filteredData.sort((a, b) => {
                if (masterSortMode === 'total_hari') return Number(b.total_hari || 0) - Number(a.total_hari || 0) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
                if (masterSortMode === 'persentase_hari') return Number(b.persentase_hari || 0) - Number(a.persentase_hari || 0) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
                if (masterSortMode === 'hadir_pertama') return String(a.hadir_pertama || '9999-12-31').localeCompare(String(b.hadir_pertama || '9999-12-31')) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
                if (masterSortMode === 'nip') return String(a.nip || '').localeCompare(String(b.nip || ''), 'id');
                return String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
            });
        }
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
        tbody.innerHTML = '<tr><td colspan="12" class="text-center p-8 text-slate-400 font-medium">Data tidak ditemukan.</td></tr>';
        info.innerText = "Menampilkan 0 data";
        btnPrev.disabled = true;
        btnNext.disabled = true;
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
        const namaAttr = escapeAttribute(r.nama);
        const bidangAttr = escapeAttribute(normalisasiJabatanMaster(r.jabatan));
        const orgAttr = escapeAttribute(r.asal_organisasi);
        const daerahAttr = escapeAttribute(r.asal_daerah);
        const kategoriEfektif = kategoriWilayahEfektif(r);
        const kategoriAttr = escapeAttribute(kategoriEfektif);
        const ukuranAttr = escapeAttribute(r.ukuran_seragam);
        const catatanSeragamAttr = escapeAttribute(r.catatan_seragam);
        const nipTampil = escapeHTML(r.nip);
        const namaTampil = escapeHTML(r.nama);
        const orgTampil = escapeHTML(r.asal_organisasi);
        const bidangTampil = escapeHTML(normalisasiJabatanMaster(r.jabatan));
        const daerahTampil = escapeHTML(r.asal_daerah || 'Belum diisi');
        const ukuranTampil = escapeHTML(r.ukuran_seragam || '-');
        const labelWilayah = {
            jombang: 'Jombang',
            luar_jombang: 'Luar Jombang',
            zona_4: 'Zona 4',
            belum_dilengkapi: 'Belum dilengkapi'
        }[kategoriEfektif] || 'Belum dilengkapi';
        const warnaWilayah = kategoriEfektif === 'zona_4'
            ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
            : kategoriEfektif === 'belum_dilengkapi'
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
        const mergeAction = pasanganDuplikatAman(r).length
            ? `<button onclick="bukaModalMergeDariTombol(this)" data-nip="${nipAttr}" data-nama="${namaAttr}" class="bg-amber-100 text-amber-700 hover:bg-amber-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border border-amber-200 shadow-sm flex items-center gap-1" title="Gabung dengan nama dan asal yang sama"><i class="fa-solid fa-code-merge"></i></button>`
            : '<span class="text-[10px] text-slate-300 dark:text-slate-600" title="Tidak ada pasangan aman untuk digabung"><i class="fa-solid fa-code-merge"></i></span>';
        
        html += `
            <tr class="hover:bg-indigo-50/50 transition-colors">
                <td class="px-4 py-3 text-center bg-slate-50 border-r border-slate-100">
                    <input type="checkbox" class="master-checkbox w-4 h-4 accent-primary cursor-pointer" value="${nipAttr}" onchange="toggleMasterBulkAction()">
                </td>
                <td class="px-4 py-3 text-center text-slate-400 font-bold bg-slate-50 border-r border-slate-100">${noUrut}</td>
                <td class="px-5 py-3 font-mono text-xs text-slate-500">${nipTampil}</td>
                <td class="px-5 py-3 font-bold text-slate-800">${namaTampil}</td>
                <td class="px-5 py-3 text-slate-600 font-medium">${orgTampil}</td>
                <td class="px-5 py-3 text-slate-600"><span class="bg-slate-100 px-2 py-1 rounded-md text-xs font-bold border border-slate-200">${bidangTampil}</span></td>
                <td class="px-5 py-3"><span class="inline-flex px-2 py-1 rounded-full text-[10px] font-black ${warnaWilayah}">${escapeHTML(labelWilayah)}</span><p class="text-[10px] text-slate-400 mt-1">${daerahTampil}</p></td>
                <td class="px-5 py-3 text-center"><p class="font-black text-slate-700">${Number(r.total_hari || 0).toLocaleString('id-ID')} hari</p><p class="text-[10px] text-slate-400">${Number(r.total_sesi || 0).toLocaleString('id-ID')} sesi • ${Number(r.jumlah_proyek || 0)} proyek</p></td>
                <td class="px-5 py-3 text-center"><p class="font-black text-indigo-600">${Number(r.persentase_hari || 0).toFixed(1)}%</p><p class="text-[10px] text-slate-400">${Number(r.persentase_sesi || 0).toFixed(1)}% sesi</p></td>
                <td class="px-5 py-3 text-xs text-slate-500">${r.hadir_pertama ? formatTanggalMaster(r.hadir_pertama) : '-'}<p class="text-[10px] text-slate-400 mt-1">Terakhir: ${r.hadir_terakhir ? formatTanggalMaster(r.hadir_terakhir) : '-'}</p></td>
                <td class="px-5 py-3 font-black text-center">${ukuranTampil}</td>
                <td class="px-5 py-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="bukaModalEditDariTombol(this)" data-nip="${nipAttr}" data-nama="${namaAttr}" data-bidang="${bidangAttr}" data-org="${orgAttr}" data-daerah="${daerahAttr}" data-kategori-wilayah="${kategoriAttr}" data-ukuran="${ukuranAttr}" data-catatan-seragam="${catatanSeragamAttr}" class="bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border border-blue-200 shadow-sm flex items-center gap-1" title="Edit Data">
                            <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                        ${mergeAction}
                        <button onclick="deleteSingleMasterDariTombol(this)" data-nip="${nipAttr}" data-nama="${namaAttr}" class="bg-red-100 text-red-700 hover:bg-red-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border border-red-200 shadow-sm flex items-center gap-1" title="Hapus">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    info.innerText = `Baris ${startIndex + 1}-${endIndex} dari ${data.length.toLocaleString('id-ID')} Data (Hal ${currentPage}/${totalPages})`;
    btnPrev.disabled = currentPage === 1;
    btnNext.disabled = currentPage === totalPages;
}

function formatTanggalMaster(value) {
    if (!value) return '-';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function skorProfilMaster(row) {
    const kolomTerisi = ['nama', 'asal_organisasi', 'jabatan', 'asal_daerah', 'kategori_wilayah', 'ukuran_seragam', 'catatan_seragam']
        .filter(key => String(row?.[key] || '').trim() && row[key] !== 'belum_dilengkapi').length;
    return [Number(row?.total_hari || 0), Number(row?.total_sesi || 0), kolomTerisi, String(row?.nip || '')];
}

function bandingkanProfilMaster(a, b) {
    const skorA = skorProfilMaster(a);
    const skorB = skorProfilMaster(b);
    return skorB[0] - skorA[0]
        || skorB[1] - skorA[1]
        || skorB[2] - skorA[2]
        || skorA[3].localeCompare(skorB[3], 'id');
}

function pasanganDuplikatAman(row) {
    const key = kunciIdentitasMaster(row);
    if (!key) return [];
    return masterData.filter(item => item.nip !== row.nip && kunciIdentitasMaster(item) === key);
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
            miripRisk.innerHTML = `<p class="font-black"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Kandidat bukan otomatis orang yang sama.</p><p class="mt-1">${ringkasanMirip.pasangan.toLocaleString('id-ID')} pasangan melibatkan ${ringkasanMirip.profil.toLocaleString('id-ID')} profil dalam ${ringkasanMirip.jaringan.toLocaleString('id-ID')} jaringan. Jika digabung berantai, jaringan terbesar dapat melebur ${ringkasanMirip.terbesar.toLocaleString('id-ID')} profil${contoh ? ` seperti ${contoh}${ringkasanMirip.terbesar > ringkasanMirip.contohTerbesar.length ? ', dan lainnya' : ''}` : ''}.</p><p class="mt-1">${jumlahPrioritas.toLocaleString('id-ID')} pasangan ditempatkan sebagai prioritas review karena organisasi sama, nama cukup panjang, dan tidak terhubung ke kandidat ketiga.</p><p class="mt-1 font-bold">Periksa identitas dan riwayat hadir. Jangan melakukan merge massal pada bagian ini.</p>`;
        }
    }
    if (bulkButton) bulkButton.disabled = duplikatMasterGroups.length === 0;
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
            return `<article class="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800"><div class="flex flex-wrap items-start justify-between gap-3"><div><p class="font-black">${nama}</p><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Kabupaten: ${kabupaten}</p><p class="text-[10px] text-slate-400 mt-1">Bidang boleh berbeda; profil dengan riwayat terbanyak dipertahankan.</p></div><button onclick="gabungkanKelompokAman(${index})" class="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-black"><i class="fa-solid fa-code-merge mr-1"></i>Gabungkan kelompok</button></div><ul class="mt-3 text-xs">${anggota}</ul></article>`;
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
    if (tampilkanKonfirmasi && !confirm(`Gabungkan ${sources.length} profil duplikat untuk ${target.nama} dari ${target.asal_organisasi}?\n\nNIP ${target.nip} dipertahankan. Riwayat absensi sumber dipindahkan lalu profil sumber dihapus.`)) return { dibatalkan: true };
    try {
        const res = await callSupabaseRpc('merge_relawan_manual', {
            p_nips: group.rows.map(row => row.nip),
            p_target_nip: target.nip,
            p_profile: {
                nama: rapikanNamaMaster(target.nama),
                asal_organisasi: rapikanOrganisasiMaster(target.asal_organisasi),
                jabatan: normalisasiJabatanMaster(target.jabatan),
                asal_daerah: target.asal_daerah || null,
                kabupaten_normalisasi: kabupatenMaster(target) || null,
                kategori_wilayah: kategoriWilayahEfektif(target),
                ukuran_seragam: target.ukuran_seragam || null,
                catatan_seragam: target.catatan_seragam || null
            }
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
    const count = document.querySelectorAll('.master-checkbox:checked').length; 
    const banner = document.getElementById('bulkMasterBanner');
    const mergeButton = document.getElementById('btnMergeMasterTerpilih');
    if (count > 0) { 
        banner.classList.remove('hidden'); 
        document.getElementById('selectedMasterCount').innerText = count; 
        if (mergeButton) mergeButton.classList.toggle('hidden', count < 2);
    } else { 
        banner.classList.add('hidden'); 
        if (mergeButton) mergeButton.classList.add('hidden');
        document.getElementById('checkAllMaster').checked = false; 
    }
}

async function deleteBulkMaster() {
    const checked = document.querySelectorAll('.master-checkbox:checked');
    if (checked.length === 0) return;
    
    const konfirmasi = confirm(`⚠️ PERINGATAN HAPUS MASSAL\n\nYakin ingin menghapus ${checked.length} data master terpilih secara permanen?`);
    if (!konfirmasi) return;

    let loading = showToast(`Menghapus ${checked.length} data...`, "loading");
    
    try {
        const nips = Array.from(checked).map(cb => cb.value);
        const results = await Promise.all(nips.map(nip => supabaseFetch(`master_relawan?nip=eq.${encodeURIComponent(nip)}`, 'DELETE')));
        const berhasil = results.filter(r => r.status === 'success').length;
        const gagal = results.length - berhasil;

        loading.remove();
        if (gagal > 0) {
            showToast(`${berhasil} berhasil dihapus, ${gagal} gagal. Data dimuat ulang.`, "error");
        } else {
            showToast(`${berhasil} data master berhasil dihapus!`, "success");
        }
        
        document.getElementById('checkAllMaster').checked = false;
        toggleMasterBulkAction();
        loadMasterData(); 
    } catch (e) {
        loading.remove();
        showToast("Gagal menghapus beberapa data.", "error");
    }
}

function renderRingkasanMaster() {
    const countWilayah = key => masterData.filter(row => kategoriWilayahEfektif(row) === key).length;
    const values = {
        ringkasanMasterGlobal: masterData.length,
        ringkasanMasterJombang: countWilayah('jombang'),
        ringkasanMasterLuarJombang: countWilayah('luar_jombang'),
        ringkasanMasterZona4: countWilayah('zona_4'),
        ringkasanMasterBelum: countWilayah('belum_dilengkapi')
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

function filterMasterWilayahKosong() {
    isNewestFilter = false;
    const limit = document.getElementById('limitData');
    if (limit) limit.value = '50';
    rowsPerPage = 50;
    activeExcelFilters.kategori_wilayah = ['belum_dilengkapi'];
    currentPage = 1;
    terapkanFilterDanPaginasi();
    showToast('Menampilkan personel yang wilayahnya belum dilengkapi.', 'info');
}

function deleteSingleMasterDariTombol(button) {
    deleteSingleMaster(button.dataset.nip || '', button.dataset.nama || '');
}

async function deleteSingleMaster(nip, nama) {
    const konfirmasi = confirm(`⚠️ PERINGATAN HAPUS DATA\n\nApakah Anda yakin ingin menghapus personel "${nama}" (NIP: ${nip}) dari Master Data secara permanen?`);
    if (!konfirmasi) return;

    let loading = showToast("Menghapus data master...", "loading");
    try {
        const res = await supabaseFetch(`master_relawan?nip=eq.${encodeURIComponent(nip)}`, 'DELETE');
        loading.remove();
        
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            showToast("Data master berhasil dihapus!", "success");
            loadMasterData(); 
        } else {
            throw new Error(res.message || "Gagal menghapus data");
        }
    } catch (err) {
        if (loading) loading.remove();
        showToast("Terjadi kesalahan saat menghapus data.", "error");
    }
}

// ------------------------------------------
// ZONA EDIT MASTER DATA
// ------------------------------------------

let currentEditNip = "";

function bukaModalEditDariTombol(button) {
    bukaModalEdit(
        button.dataset.nip || '',
        button.dataset.nama || '',
        button.dataset.bidang || '',
        button.dataset.org || '',
        button.dataset.daerah || '',
        button.dataset.kategoriWilayah || 'belum_dilengkapi',
        button.dataset.ukuran || '',
        button.dataset.catatanSeragam || ''
    );
}

function bukaModalEdit(nip, nama, bidang, org, daerah = '', kategoriWilayah = 'belum_dilengkapi', ukuran = '', catatanSeragam = '') {
    currentEditNip = nip;
    
    document.getElementById('editNip').value = nip;
    document.getElementById('editNama').value = nama;
    document.getElementById('editBidang').value = normalisasiJabatanMaster(bidang);
    document.getElementById('editOrg').value = org;
    document.getElementById('editDaerah').value = daerah;
    document.getElementById('editKategoriWilayah').value = normalisasiKunciMaster(org) === 'PUSAT'
        ? 'jombang'
        : (kategoriWilayah || 'belum_dilengkapi');
    document.getElementById('editUkuranSeragam').value = ukuran;
    document.getElementById('editCatatanSeragam').value = catatanSeragam;
    
    document.getElementById('modalEdit').classList.remove('hidden');
}

function sarankanKategoriWilayahPusat() {
    const org = document.getElementById('editOrg')?.value;
    const kategori = document.getElementById('editKategoriWilayah');
    if (kategori && normalisasiKunciMaster(org) === 'PUSAT') kategori.value = 'jombang';
}

function tutupModalEdit() {
    document.getElementById('modalEdit').classList.add('hidden');
}

async function simpanEditMaster() {
    const namaBaru = rapikanNamaMaster(document.getElementById('editNama').value);
    const bidangBaru = normalisasiJabatanMaster(document.getElementById('editBidang').value);
    const orgBaru = rapikanOrganisasiMaster(document.getElementById('editOrg').value);
    const daerahBaru = document.getElementById('editDaerah').value.trim();
    const kategoriWilayahBaru = normalisasiKunciMaster(orgBaru) === 'PUSAT'
        ? 'jombang'
        : document.getElementById('editKategoriWilayah').value;
    const ukuranSeragamBaru = document.getElementById('editUkuranSeragam').value;
    const catatanSeragamBaru = document.getElementById('editCatatanSeragam').value.trim();
    
    if(!namaBaru) {
        showToast("Nama Relawan tidak boleh kosong!", "error");
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
        ukuran_seragam: ukuranSeragamBaru || null,
        catatan_seragam: catatanSeragamBaru || null
    };

    try {
        let res = await supabaseFetch(`master_relawan?nip=eq.${encodeURIComponent(currentEditNip)}`, 'PATCH', payloadUpdate);
        if (res.status !== 'success' && /kabupaten_normalisasi|schema cache|column/i.test(String(res.message || ''))) {
            const payloadKompatibel = { ...payloadUpdate };
            delete payloadKompatibel.kabupaten_normalisasi;
            res = await supabaseFetch(`master_relawan?nip=eq.${encodeURIComponent(currentEditNip)}`, 'PATCH', payloadKompatibel);
        }
        
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            showToast("Data profil berhasil diperbarui!", "success");
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
    select.innerHTML = rows.map(row => `<option value="${escapeAttribute(row.nip)}" ${row.nip === manualMergeTargetNip ? 'selected' : ''}>${escapeHTML(row.nama)} — ${escapeHTML(row.nip)} (${Number(row.total_hari || 0)} hari)</option>`).join('');
    list.innerHTML = rows.map(row => `<div class="rounded-xl border ${row.nip === manualMergeTargetNip ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'} p-3">
        <div class="flex items-start justify-between gap-3"><div><p class="font-black text-sm text-slate-800 dark:text-slate-100">${escapeHTML(row.nama)}</p><p class="text-[10px] text-slate-500 dark:text-slate-400 mt-1">${escapeHTML(row.nip)} • ${escapeHTML(row.asal_organisasi || 'Asal belum diisi')}</p></div><span class="text-[10px] font-black ${row.nip === manualMergeTargetNip ? 'text-emerald-600' : 'text-amber-600'}">${row.nip === manualMergeTargetNip ? 'ID UTAMA' : 'AKAN DIGABUNG'}</span></div>
        <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-2">${Number(row.total_hari || 0)} hari • ${Number(row.total_sesi || 0)} sesi • ${escapeHTML(normalisasiJabatanMaster(row.jabatan) || 'Jabatan belum diisi')}</p>
    </div>`).join('');
}

function isiFormMergeManual(row) {
    if (!row) return;
    document.getElementById('mergeNama').value = row.nama || '';
    document.getElementById('mergeOrg').value = row.asal_organisasi || '';
    document.getElementById('mergeBidang').value = normalisasiJabatanMaster(row.jabatan);
    document.getElementById('mergeDaerah').value = row.asal_daerah || '';
    document.getElementById('mergeKategoriWilayah').value = kategoriWilayahEfektif(row);
    document.getElementById('mergeUkuranSeragam').value = row.ukuran_seragam || '';
    document.getElementById('mergeCatatanSeragam').value = row.catatan_seragam || '';
}

function pilihTargetMergeManual() {
    manualMergeTargetNip = document.getElementById('targetMergeManual')?.value || '';
    const target = masterData.find(row => row.nip === manualMergeTargetNip);
    renderPengaturanMergeManual();
    isiFormMergeManual(target);
}

function sarankanKategoriMergePusat() {
    const org = document.getElementById('mergeOrg')?.value;
    const kategori = document.getElementById('mergeKategoriWilayah');
    if (kategori && normalisasiKunciMaster(org) === 'PUSAT') kategori.value = 'jombang';
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
    const kategoriWilayah = normalisasiKunciMaster(asalOrganisasi) === 'PUSAT'
        ? 'jombang'
        : document.getElementById('mergeKategoriWilayah').value;
    const ukuranSeragam = document.getElementById('mergeUkuranSeragam').value;
    const catatanSeragam = document.getElementById('mergeCatatanSeragam').value.trim();

    if (!nama || !asalOrganisasi) {
        showToast('Nama akhir dan asal organisasi wajib diisi.', 'error');
        return;
    }

    const sumber = rows.filter(row => row.nip !== target.nip);
    const daftar = rows.map(row => `• ${row.nama} — ${row.asal_organisasi || 'asal belum diisi'}`).join('\n');
    if (!confirm(`MERGE MANUAL ${rows.length} PROFIL\n\n${daftar}\n\nHasil akhir:\n${nama} — ${asalOrganisasi}\nID utama: ${target.nip}\n\nRiwayat duplikat pada tanggal, sesi, dan proyek yang sama akan dihitung satu kali. ${sumber.length} profil sumber akan dihapus permanen.`)) return;

    const button = document.getElementById('btnEksekusiMergeManual');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menggabungkan...';

    try {
        const res = await callSupabaseRpc('merge_relawan_manual', {
            p_nips: rows.map(row => row.nip),
            p_target_nip: target.nip,
            p_profile: {
                nama,
                asal_organisasi: asalOrganisasi,
                jabatan,
                asal_daerah: asalDaerah || null,
                kabupaten_normalisasi: normalisasiKunciMaster(asalDaerah) || kabupatenMaster({ asal_organisasi: asalOrganisasi }) || null,
                kategori_wilayah: kategoriWilayah,
                ukuran_seragam: ukuranSeragam || null,
                catatan_seragam: catatanSeragam || null
            }
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

let currentSourceNip = "";
let currentSourceName = "";

function bukaModalMergeDariTombol(button) {
    bukaModalMerge(button.dataset.nip || '', button.dataset.nama || '');
}

function siapkanDropdownMerge(sourceNip = '') {
    const list = document.getElementById('dropdownMergeList');
    if (!list) return;
    let html = '';

    const source = masterData.find(row => row.nip === sourceNip);
    const sourceKey = kunciIdentitasMaster(source);
    const sortedMaster = [...masterData]
        .filter(row => row.nip !== sourceNip && sourceKey && kunciIdentitasMaster(row) === sourceKey)
        .sort(bandingkanProfilMaster);

    if (!sortedMaster.length) {
        list.innerHTML = '<li class="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">Tidak ada kandidat aman. Nama sama dengan asal organisasi berbeda tetap dipisahkan.</li>';
        return;
    }
    
    sortedMaster.forEach(r => {
        const nipAttr = escapeAttribute(r.nip);
        const namaAttr = escapeAttribute(r.nama);
        const orgAttr = escapeAttribute(r.asal_organisasi || 'Umum');
        const nipTampil = escapeHTML(r.nip);
        const namaTampil = escapeHTML(r.nama);
        const orgTampil = escapeHTML(r.asal_organisasi);
        
        html += `
            <li onclick="pilihTargetMergeDariElemen(this)" data-nip="${nipAttr}" data-nama="${namaAttr}" data-org="${orgAttr}" class="merge-option px-4 py-3 hover:bg-amber-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors">
                <p class="font-bold text-sm text-slate-800">${namaTampil}</p>
                <p class="text-[10px] text-slate-500 font-mono mt-0.5"><i class="fa-solid fa-sitemap mr-1"></i> ${orgTampil} | ${nipTampil}</p>
            </li>
        `;
    });
    list.innerHTML = html;
}

function filterDropdownMerge() {
    const input = document.getElementById('searchInputMerge');
    const filter = input.value.toLowerCase();
    const nodes = document.querySelectorAll('.merge-option');
    const btnClear = document.getElementById('clearSearchMerge');
    
    if (filter.length > 0) btnClear.classList.remove('hidden');
    else btnClear.classList.add('hidden');

    nodes.forEach(node => {
        if (node.innerText.toLowerCase().includes(filter)) {
            node.style.display = "block";
        } else {
            node.style.display = "none";
        }
    });
    toggleDropdownMerge(true);
}

function toggleDropdownMerge(show) {
    const list = document.getElementById('dropdownMergeList');
    if (!list) return;
    if (show) list.classList.remove('hidden');
    else list.classList.add('hidden');
}

function pilihTargetMergeDariElemen(element) {
    pilihTargetMerge(
        element.dataset.nip || '',
        element.dataset.nama || '',
        element.dataset.org || 'Umum'
    );
}

function pilihTargetMerge(nip, nama, org) {
    document.getElementById('targetMergeNip').value = nip; 
    document.getElementById('searchInputMerge').value = `${nama} — [${org}]`; 
    document.getElementById('clearSearchMerge').classList.remove('hidden');
    toggleDropdownMerge(false);
}

function resetInputMerge() {
    document.getElementById('targetMergeNip').value = "";
    const input = document.getElementById('searchInputMerge');
    input.value = "";
    input.focus();
    filterDropdownMerge(); 
}

function bukaModalMerge(nip, nama) {
    currentSourceNip = nip;
    currentSourceName = nama;
    
    document.getElementById('sumberNama').innerText = nama;
    document.getElementById('sumberNip').innerText = nip;
    
    siapkanDropdownMerge(nip);
    resetInputMerge(); 
    toggleDropdownMerge(false); 
    
    document.getElementById('modalMerge').classList.remove('hidden');
}

function tutupModalMerge() {
    document.getElementById('modalMerge').classList.add('hidden');
}

document.addEventListener('click', function(event) {
    const input = document.getElementById('searchInputMerge');
    const list = document.getElementById('dropdownMergeList');
    if (input && list && event.target !== input && !list.contains(event.target)) {
        toggleDropdownMerge(false);
    }
});

async function eksekusiMerge() {
    const targetNip = document.getElementById('targetMergeNip').value; 
    const btn = document.getElementById('btnEksekusiMerge');

    if (!targetNip) {
        showToast("Pilih profil tujuan terlebih dahulu!", "error");
        return;
    }
    
    if (targetNip === currentSourceNip) {
        showToast("Profil sumber dan tujuan tidak boleh sama!", "error");
        resetInputMerge();
        return;
    }

    const targetProfile = masterData.find(r => r.nip === targetNip);
    const sourceProfile = masterData.find(r => r.nip === currentSourceNip);

    if (!targetProfile) {
        showToast("Profil tujuan tidak ditemukan. Muat ulang data Master.", "error");
        resetInputMerge();
        return;
    }
    
    const konfirmasi = confirm(`🚨 PERINGATAN BENTURAN DATA 🚨\n\nApakah Anda yakin ingin memindahkan seluruh absen:\n[X] ${currentSourceName}\n\nKe profil yang benar:\n[✓] ${targetProfile.nama}\n\nProfil lama akan dihapus permanen!`);
    if (!konfirmasi) return;

    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    btn.disabled = true;

    try {
        const res = await callSupabaseRpc('merge_relawan', {
            p_sumber_nip: currentSourceNip,
            p_target_nip: targetNip
        });

        if (res.status !== "success") {
            const pesanServer = (res.result && res.result.message) || res.message;
            console.error("Merge RPC Gagal:", res);
            if (pesanServer && /tidak ditemukan|sama/.test(pesanServer)) {
                throw new Error(pesanServer);
            }
            throw new Error("Gagal melakukan merge dari server.");
        }

        showToast("Merge Data Berhasil! Riwayat disatukan.", "success");
        tutupModalMerge();
        
        document.getElementById('cariData').value = "";
        loadMasterData(); 
        
    } catch (err) {
        showToast(err.message || "Gagal melakukan Merge Data.", "error");
        console.error("Merge RPC Error:", err);
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Eksekusi Gabung';
        btn.disabled = false;
    }
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

    if (!sourceProfile || !kunciIdentitasMaster(sourceProfile) || kunciIdentitasMaster(sourceProfile) !== kunciIdentitasMaster(targetProfile)) {
        showToast("Merge hanya diizinkan untuk nama dan asal organisasi yang sama.", "error");
        resetInputMerge();
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
