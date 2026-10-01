// ==========================================
// LOGIKA RIWAYAT ABSEN, EXPORT & EDIT V2
// ==========================================

let riwayatData = [];

document.addEventListener("DOMContentLoaded", async () => {
    await getAksesUser();
    document.getElementById('filterTanggal').valueAsDate = new Date();
    muatIdentitasLaporan();
    loadRiwayatData();

    // Event listener untuk filter tanggal
    document.getElementById('filterTanggal').addEventListener('change', () => {
        jalankanFilterDanSortRiwayat();
    });

    // Event listener untuk filter bulan, tahun, lokasi, organisasi
    ['filterBulan', 'filterTahun', 'filterLokasi', 'filterOrganisasi'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            jalankanFilterDanSortRiwayat();
        });
    });

    // Event listener untuk pencarian real-time
    document.getElementById('filterCari').addEventListener('input', () => {
        jalankanFilterDanSortRiwayat();
    });
});

// ==========================================
// POPULATE FILTER DROPDOWNS
// ==========================================
function populateFilterDropdowns() {
    // Populate tahun dari data yang ada
    const tahunSelect = document.getElementById('filterTahun');
    tahunSelect.innerHTML = '<option value="">Semua Tahun</option>';
    const tahunSet = new Set();
    riwayatData.forEach(r => {
        if (r.tanggal) {
            tahunSet.add(r.tanggal.split('-')[0]);
        }
    });
    const tahunList = Array.from(tahunSet).sort().reverse();
    tahunList.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        tahunSelect.appendChild(opt);
    });

    // Populate lokasi
    const lokasiSelect = document.getElementById('filterLokasi');
    lokasiSelect.innerHTML = '<option value="">Semua Lokasi</option>';
    const lokasiSet = new Set();
    riwayatData.forEach(r => {
        if (r.lokasi) lokasiSet.add(r.lokasi);
    });
    const lokasiList = Array.from(lokasiSet).sort();
    lokasiList.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = l;
        lokasiSelect.appendChild(opt);
    });

    // Populate organisasi
    const orgSelect = document.getElementById('filterOrganisasi');
    orgSelect.innerHTML = '<option value="">Semua Organisasi</option>';
    const orgSet = new Set();
    riwayatData.forEach(r => {
        if (r.organisasi) orgSet.add(r.organisasi);
    });
    const orgList = Array.from(orgSet).sort();
    orgList.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        orgSelect.appendChild(opt);
    });
}

// ==========================================
// IDENTITAS LAPORAN RESMI (KOP & TTD)
// ==========================================

const IDENTITAS_LAPORAN_KEY = 'relawan_laporan_identitas';

function getIdentitasLaporan() {
    try {
        return JSON.parse(localStorage.getItem(IDENTITAS_LAPORAN_KEY) || 'null') || {};
    } catch (e) {
        return {};
    }
}

function simpanIdentitasLaporan() {
    const data = {
        lembaga: document.getElementById('identLemBaga').value.trim(),
        pjNama: document.getElementById('identPjNama').value.trim(),
        pjJabatan: document.getElementById('identPjJabatan').value.trim(),
        ttdJabatan: document.getElementById('identNipJabatan').value.trim()
    };
    localStorage.setItem(IDENTITAS_LAPORAN_KEY, JSON.stringify(data));
    showToast("Identitas laporan tersimpan.", "success");
    tutupModalIdentitas();
}

function muatIdentitasLaporan() {
    const data = getIdentitasLaporan();
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el && v) el.value = v;
    };
    set('identLemBaga', data.lembaga);
    set('identPjNama', data.pjNama);
    set('identPjJabatan', data.pjJabatan);
    set('identNipJabatan', data.ttdJabatan);
}

function bukaModalIdentitas() {
    muatIdentitasLaporan();
    document.getElementById('modalIdentitas').classList.remove('hidden');
}

function tutupModalIdentitas() {
    document.getElementById('modalIdentitas').classList.add('hidden');
}

function formatTanggalID(dateStr) {
    const bulan = {
        '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April',
        '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus',
        '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember'
    };
    if (!dateStr) return dateStr;
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(d, 10)} ${bulan[m] || m} ${y}`;
}

// ==========================================
// LOAD DATA RIWAYAT
// ==========================================
async function loadRiwayatData() {
    const loading = document.getElementById('loadingOverlay');
    loading.classList.remove('hidden');

    try {
        const res = await supabaseFetchAll(await terapkanFilterLokasi('log_absensi?select=*&order=id.desc'));
        if (res.status === "success") {
            riwayatData = res.data;
            populateFilterDropdowns();
            jalankanFilterDanSortRiwayat();
            return true;
        } else {
            showToast("Gagal mengambil data riwayat.", "error");
            return false;
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
        return false;
    } finally {
        loading.classList.add('hidden');
    }
}

// ==========================================
// FILTER & SORT
// ==========================================
function terapkanFilterRiwayat() {
    jalankanFilterDanSortRiwayat();
}

function resetFilter() {
    document.getElementById('filterTanggal').value = '';
    document.getElementById('filterBulan').value = '';
    document.getElementById('filterTahun').value = '';
    document.getElementById('filterLokasi').value = '';
    document.getElementById('filterOrganisasi').value = '';
    document.getElementById('filterCari').value = '';
    activeExcelFilters = {};
    activeSortColumn = null;
    jalankanFilterDanSortRiwayat();
}

function jalankanFilterDanSortRiwayat() {
    const filterTgl = document.getElementById('filterTanggal').value;
    const filterBln = document.getElementById('filterBulan').value;
    const filterThn = document.getElementById('filterTahun').value;
    const filterLok = document.getElementById('filterLokasi').value;
    const filterOrg = document.getElementById('filterOrganisasi').value;
    const globalKey = document.getElementById('filterCari').value.toLowerCase();

    let filtered = riwayatData.filter(r => {
        // Filter tanggal spesifik
        let matchTgl = filterTgl ? r.tanggal === filterTgl : true;

        // Filter bulan
        let matchBln = true;
        if (filterBln && r.tanggal) {
            matchBln = r.tanggal.split('-')[1] === filterBln;
        }

        // Filter tahun
        let matchThn = true;
        if (filterThn && r.tanggal) {
            matchThn = r.tanggal.split('-')[0] === filterThn;
        }

        // Filter lokasi
        let matchLok = filterLok ? (r.lokasi === filterLok) : true;

        // Filter organisasi
        let matchOrg = filterOrg ? (r.organisasi === filterOrg) : true;

        // Pencarian global
        let matchGlobal = globalKey ?
            (r.nama && r.nama.toLowerCase().includes(globalKey)) ||
            (r.organisasi && r.organisasi.toLowerCase().includes(globalKey)) ||
            (r.lokasi && r.lokasi.toLowerCase().includes(globalKey)) : true;

        return matchTgl && matchBln && matchThn && matchLok && matchOrg && matchGlobal;
    });

    // Filter berdasarkan pop-up Excel (Checkbox kolom aktif)
    Object.keys(activeExcelFilters).forEach(col => {
        const allowedVals = activeExcelFilters[col];
        filtered = filtered.filter(item => allowedVals.includes(item[col] || '-'));
    });

    // Sorting A-Z / Z-A
    if (activeSortColumn) {
        filtered.sort((a, b) => {
            let valA = (a[activeSortColumn] || '').toString().toLowerCase();
            let valB = (b[activeSortColumn] || '').toString().toLowerCase();
            if (valA < valB) return activeSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return activeSortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    renderTabelRiwayat(filtered);
    updateSummaryCards(filtered);
}

// ==========================================
// SUMMARY CARDS
// ==========================================
function updateSummaryCards(data) {
    // Total data
    document.getElementById('summaryTotal').textContent = data.length.toLocaleString('id-ID');

    // Relawan unik
    const namaUnik = new Set();
    data.forEach(r => {
        if (r.nama) namaUnik.add(r.nama);
    });
    document.getElementById('summaryUnik').textContent = namaUnik.size.toLocaleString('id-ID');

    // Lokasi unik
    const lokasiUnik = new Set();
    data.forEach(r => {
        if (r.lokasi) lokasiUnik.add(r.lokasi);
    });
    document.getElementById('summaryLokasi').textContent = lokasiUnik.size.toLocaleString('id-ID');

    // Periode
    if (data.length > 0) {
        const tanggalList = data.map(r => r.tanggal).filter(t => t).sort();
        const tglAwal = tanggalList[0];
        const tglAkhir = tanggalList[tanggalList.length - 1];
        if (tglAwal === tglAkhir) {
            document.getElementById('summaryPeriode').textContent = formatTanggalID(tglAwal);
        } else {
            document.getElementById('summaryPeriode').textContent = `${formatTanggalID(tglAwal)} - ${formatTanggalID(tglAkhir)}`;
        }
    } else {
        document.getElementById('summaryPeriode').textContent = '-';
    }
}

// ==========================================
// RENDER TABEL
// ==========================================
function renderTabelRiwayat(data) {
    const tbody = document.getElementById('riwayatBody');
    document.getElementById('totalDataInfo').innerText = `Menampilkan ${data.length.toLocaleString('id-ID')} riwayat absen`;

    const checkAllBtn = document.getElementById('checkAll');
    if (checkAllBtn) checkAllBtn.checked = false;
    toggleBulkActionBanner();

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-slate-400 font-medium">Tidak ada data absensi yang sesuai filter.</td></tr>';
        return;
    }

    let html = '';
    data.forEach((r, idx) => {
        const noUrut = idx + 1;
        const idAttr = escapeAttribute(r.id);
        const tanggalAttr = escapeAttribute(r.tanggal);
        const sesiNormal = r.sesi === 'Siang' ? 'Pagi' : r.sesi;
        const sesiAttr = escapeAttribute(sesiNormal);
        const lokasiAttr = escapeAttribute(r.lokasi);
        const orgAttr = escapeAttribute(r.organisasi);
        const tanggalTampil = escapeHTML(r.tanggal);
        const sesiTampil = escapeHTML(sesiNormal);
        const namaTampil = escapeHTML(r.nama);
        const lokasiTampil = escapeHTML(r.lokasi);
        const orgTampil = escapeHTML(r.organisasi);

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <td class="admin-only no-print px-4 py-3 text-center bg-slate-50 dark:bg-slate-800/50 border-r border-slate-100 dark:border-slate-700/50">
                    <input type="checkbox" class="log-checkbox w-4 h-4 accent-primary cursor-pointer" value="${idAttr}" onchange="toggleBulkActionBanner()">
                </td>
                <td class="px-4 py-3 text-center font-bold text-slate-400 bg-slate-50 dark:bg-slate-800/50 border-r border-slate-100 dark:border-slate-700/50">${noUrut}</td>
                <td class="px-4 py-3 text-xs text-slate-500 font-mono">${tanggalTampil}</td>
                <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">${namaTampil}</td>
                <td class="px-4 py-3 font-bold ${(r.sesi === 'Pagi' || r.sesi === 'Siang') ? 'text-orange-500' : 'text-indigo-600'}">${sesiTampil}</td>
                <td class="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs">${lokasiTampil}</td>
                <td class="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs font-semibold">${orgTampil}</td>
                <td class="admin-only no-print px-4 py-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="bukaModalEditLogDariTombol(this)" data-id="${idAttr}" data-tanggal="${tanggalAttr}" data-sesi="${sesiAttr}" data-lokasi="${lokasiAttr}" data-org="${orgAttr}" class="bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-bold p-2 rounded-lg transition-colors shadow-sm" title="Edit">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button onclick="deleteSingleLogDariTombol(this)" data-id="${idAttr}" class="bg-red-100 text-red-700 hover:bg-red-200 text-xs font-bold p-2 rounded-lg transition-colors shadow-sm" title="Hapus">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// ==========================================
// ZONA EDIT DATA RIWAYAT
// ==========================================
function bukaModalEditLogDariTombol(button) {
    bukaModalEditLog(
        button.dataset.id || '',
        button.dataset.tanggal || '',
        button.dataset.sesi || '',
        button.dataset.lokasi || '',
        button.dataset.org || ''
    );
}

function bukaModalEditLog(id, tgl, sesi, lokasi, org) {
    document.getElementById('editLogId').value = id;
    document.getElementById('editLogTanggal').value = tgl;
    document.getElementById('editLogSesi').value = sesi;
    document.getElementById('editLogLokasi').value = lokasi;
    document.getElementById('editLogOrg').value = org;

    document.getElementById('modalEditLog').classList.remove('hidden');
}

function tutupModalEditLog() {
    document.getElementById('modalEditLog').classList.add('hidden');
}

async function simpanEditLog() {
    if (!userIsAdmin()) {
        showToast("Hanya admin yang boleh mengubah riwayat.", "error");
        return;
    }
    const id = document.getElementById('editLogId').value;
    const tgl = document.getElementById('editLogTanggal').value;
    const sesi = document.getElementById('editLogSesi').value;
    const lokasi = document.getElementById('editLogLokasi').value;
    const org = document.getElementById('editLogOrg').value;

    const btn = document.getElementById('btnSimpanEditLog');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    btn.disabled = true;

    const payload = { tanggal: tgl, sesi: sesi, lokasi: lokasi, organisasi: org };

    try {
        const res = await supabaseFetch(`log_absensi?id=eq.${encodeURIComponent(id)}`, 'PATCH', payload);
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            showToast("Riwayat absen berhasil diperbarui!", "success");
            tutupModalEditLog();
            loadRiwayatData();
        } else {
            throw new Error("Gagal update");
        }
    } catch (err) {
        showToast("Terjadi kesalahan saat mengupdate.", "error");
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan';
        btn.disabled = false;
    }
}

// ==========================================
// ZONA HAPUS MASSAL & EXPORT CSV
// ==========================================
function toggleAll(source) {
    document.querySelectorAll('.log-checkbox').forEach(cb => cb.checked = source.checked);
    toggleBulkActionBanner();
}

function batalkanSeleksi() {
    document.querySelectorAll('.log-checkbox').forEach(cb => cb.checked = false);
    const checkAllBtn = document.getElementById('checkAll');
    if (checkAllBtn) checkAllBtn.checked = false;
    toggleBulkActionBanner();
}

function toggleBulkActionBanner() {
    const count = document.querySelectorAll('.log-checkbox:checked').length;
    const banner = document.getElementById('bulkActionBanner');
    if (count > 0) {
        banner.classList.remove('hidden');
        document.getElementById('selectedCount').innerText = count;
    } else {
        banner.classList.add('hidden');
        const checkAllBtn = document.getElementById('checkAll');
        if (checkAllBtn) checkAllBtn.checked = false;
    }
}

async function deleteSingleLog(id) {
    if (!userIsAdmin()) {
        showToast("Hanya admin yang boleh menghapus riwayat.", "error");
        return;
    }
    if (!confirm("Hapus data absen ini secara permanen?")) return;
    let loading = showToast("Menghapus data...", "loading");
    try {
        const res = await supabaseFetch(`log_absensi?id=eq.${encodeURIComponent(id)}`, 'DELETE');
        loading.remove();
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            showToast("Data absen berhasil dihapus!", "success");
            loadRiwayatData();
        } else {
            throw new Error(res.message || "Database menolak penghapusan");
        }
    } catch (err) {
        if (loading) loading.remove();
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

function deleteSingleLogDariTombol(button) {
    deleteSingleLog(button.dataset.id || '');
}

async function deleteBulkLogs() {
    if (!userIsAdmin()) {
        showToast("Hanya admin yang boleh menghapus riwayat.", "error");
        return;
    }
    const checked = document.querySelectorAll('.log-checkbox:checked');
    if (checked.length === 0) return;
    const konfirmasi = confirm(`Yakin ingin menghapus ${checked.length} riwayat absen terpilih?`);
    if (!konfirmasi) return;

    let loading = showToast(`Menghapus ${checked.length} data...`, "loading");
    try {
        const ids = Array.from(checked).map(cb => cb.value);
        const results = await Promise.all(ids.map(id => supabaseFetch(`log_absensi?id=eq.${encodeURIComponent(id)}`, 'DELETE')));
        const berhasil = results.filter(r => r.status === 'success').length;
        const gagal = results.length - berhasil;
        loading.remove();
        if (gagal > 0) {
            showToast(`${berhasil} berhasil dihapus, ${gagal} gagal. Data dimuat ulang.`, "error");
        } else {
            showToast(`${berhasil} data berhasil dihapus!`, "success");
        }
        loadRiwayatData();
    } catch (e) {
        loading.remove();
        showToast("Gagal menghapus beberapa data.", "error");
    }
}

function exportToCSV() {
    const barisTabel = document.querySelectorAll('#riwayatBody tr');
    if (barisTabel.length === 0 || barisTabel[0].innerText.includes("Tidak ada data")) {
        showToast("Tidak ada data untuk diekspor!", "error");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,No,Tanggal,Nama Relawan,Sesi,Lokasi Proyek,Organisasi\n";
    barisTabel.forEach(row => {
        let cols = row.querySelectorAll("td");
        if (cols.length > 0) {
            let rowArray = [
                cols[1].innerText, cols[2].innerText, `"${cols[3].innerText}"`,
                cols[4].innerText, `"${cols[5].innerText}"`, `"${cols[6].innerText}"`
            ];
            csvContent += rowArray.join(",") + "\n";
        }
    });
    const filterTgl = document.getElementById('filterTanggal').value || 'SemuaTanggal';
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Laporan_Absen_${filterTgl}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportToXLSX() {
    const barisTabel = document.querySelectorAll('#riwayatBody tr');
    if (barisTabel.length === 0 || barisTabel[0].innerText.includes("Tidak ada data")) {
        showToast("Tidak ada data untuk diekspor!", "error");
        return;
    }

    if (typeof XLSX === 'undefined') {
        showToast("Lib Excel belum dimuat, beralih ke CSV.", "info");
        setTimeout(exportToCSV, 50);
        return;
    }

    const aoa = [[
        { t: 's', v: 'No' },
        { t: 's', v: 'Tanggal' },
        { t: 's', v: 'Nama Relawan' },
        { t: 's', v: 'Sesi' },
        { t: 's', v: 'Lokasi Proyek' },
        { t: 's', v: 'Organisasi' }
    ]];

    barisTabel.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length < 7) return;
        aoa.push([
            { t: 'n', v: Number(cols[1].innerText) || 0 },
            { t: 's', v: cols[2].innerText },
            { t: 's', v: cols[3].innerText },
            { t: 's', v: cols[4].innerText },
            { t: 's', v: cols[5].innerText },
            { t: 's', v: cols[6].innerText }
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
        { wch: 5 }, { wch: 14 }, { wch: 30 }, { wch: 9 }, { wch: 30 }, { wch: 25 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Absensi');

    const filterTgl = document.getElementById('filterTanggal').value || 'SemuaTanggal';
    XLSX.writeFile(wb, `Laporan_Absen_${filterTgl}.xlsx`);
    showToast("Export Excel berhasil.", "success");
}

// ==========================================
// FITUR CETAK LAPORAN & PDF
// ==========================================
async function cetakLaporanAbsen() {
    let loading = showToast("Menyiapkan lembar cetak...", "loading");

    try {
        const hasilPembaruan = await loadRiwayatData();
        if (hasilPembaruan === false) {
            throw new Error("Data riwayat tidak berhasil diperbarui");
        }

        isiElemenLaporan();

        if (loading) loading.remove();

        setTimeout(() => {
            window.print();
        }, 400);

    } catch (error) {
        if (loading) loading.remove();
        showToast("Gagal menyiapkan cetakan laporan.", "error");
        console.error("Print Error:", error);
    }
}

// Isi kop, meta info dan blok TTD dengan identitas + filter terkini
function isiElemenLaporan() {
    const ident = getIdentitasLaporan();
    const setText = (id, v, fallback) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v || fallback || '';
    };

    setText('kopLembaga', ident.lembaga, 'Lembaga / Panitia');
    setText('ttdLeftJabatan', ident.pjJabatan, 'Ketua Panitia');
    setText('ttdLeftNama', ident.pjNama ? ident.pjNama : '(_______________)');
    setText('ttdRightJabatan', ident.ttdJabatan, 'Koordinator Lapangan');

    const ttdNama = document.getElementById('ttdRightNama');
    if (ttdNama) ttdNama.textContent = '(_______________)';

    const tglCetak = new Date();
    const tglCetakStr = tglCetak.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    setText('ttdRightTanggal', tglCetakStr, tglCetakStr);

    // Meta laporan berdasarkan filter
    const filterTgl = document.getElementById('filterTanggal').value;
    const filterCari = document.getElementById('filterCari').value.trim();
    const jumlahData = document.querySelectorAll('#riwayatBody tr').length;

    let periode = 'Semua Periode';
    if (filterTgl) periode = `Periode: ${formatTanggalID(filterTgl)}`;
    if (filterCari) periode += ` - Kata kunci: "${filterCari}"`;

    setText('printMetaInfo', `${periode} - Jumlah Data: ${jumlahData} - Dicetak: ${tglCetakStr}`, `${periode} - Dicetak: ${tglCetakStr}`);
}
