// ==========================================
// LOGIKA RIWAYAT ABSEN, EXPORT & EDIT V2
// ==========================================

let riwayatData = [];

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('filterTanggal').valueAsDate = new Date();
    muatIdentitasLaporan();
    loadRiwayatData();

    // Tambahkan event listener change agar otomatis memfilter saat tanggal diubah
    document.getElementById('filterTanggal').addEventListener('change', () => {
        jalankanFilterDanSortRiwayat();
    });
});

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

async function loadRiwayatData() {
    const loading = document.getElementById('loadingOverlay');
    loading.classList.remove('hidden');
    
    try {
        const res = await supabaseFetch(await terapkanFilterLokasi('log_absensi?select=*&order=id.desc'), 'GET');
        if (res.status === "success") {
            riwayatData = res.data;
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

function terapkanFilterRiwayat() {
    jalankanFilterDanSortRiwayat();
}

function resetFilter() {
    document.getElementById('filterTanggal').value = '';
    document.getElementById('filterCari').value = '';
    activeExcelFilters = {};
    activeSortColumn = null;
    jalankanFilterDanSortRiwayat();
}

function jalankanFilterDanSortRiwayat() {
    const filterTgl = document.getElementById('filterTanggal').value;
    const globalKey = document.getElementById('filterCari').value.toLowerCase();

    let filtered = riwayatData.filter(r => {
        let matchTgl = filterTgl ? r.tanggal === filterTgl : true;
        let matchGlobal = globalKey ? 
            (r.nama && r.nama.toLowerCase().includes(globalKey)) ||
            (r.organisasi && r.organisasi.toLowerCase().includes(globalKey)) ||
            (r.lokasi && r.lokasi.toLowerCase().includes(globalKey)) : true;
        return matchTgl && matchGlobal;
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
}

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
        // Escape data untuk atribut HTML (onclick)
        const lokasiAmanAttr = r.lokasi ? r.lokasi.replace(/'/g, "\\'") : '';
        const orgAmanAttr = r.organisasi ? r.organisasi.replace(/'/g, "\\'") : '';
        
        // Escape data untuk tampilan teks (Mencegah XSS)
        const namaTampil = escapeHTML(r.nama);
        const lokasiTampil = escapeHTML(r.lokasi);
        const orgTampil = escapeHTML(r.organisasi);
        
        html += `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="no-print px-4 py-3 text-center bg-slate-50 border-r border-slate-100">
                    <input type="checkbox" class="log-checkbox w-4 h-4 accent-primary cursor-pointer" value="${r.id}" onchange="toggleBulkActionBanner()">
                </td>
                <td class="px-4 py-3 text-center font-bold text-slate-400 bg-slate-50 border-r border-slate-100">${noUrut}</td>
                <td class="px-4 py-3 text-xs text-slate-500 font-mono">${r.tanggal || '-'}</td>
                <td class="px-4 py-3 font-bold text-slate-800">${namaTampil}</td>
                <td class="px-4 py-3 font-bold ${r.sesi === 'Siang' ? 'text-orange-500' : 'text-indigo-600'}">${r.sesi}</td>
                <td class="px-4 py-3 text-slate-600 text-xs">${lokasiTampil}</td>
                <td class="px-4 py-3 text-slate-600 text-xs font-semibold">${orgTampil}</td>
                <td class="no-print px-4 py-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="bukaModalEditLog('${r.id}', '${r.tanggal}', '${r.sesi}', '${lokasiAmanAttr}', '${orgAmanAttr}')" class="bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-bold p-2 rounded-lg transition-colors shadow-sm" title="Edit">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button onclick="deleteSingleLog('${r.id}')" class="bg-red-100 text-red-700 hover:bg-red-200 text-xs font-bold p-2 rounded-lg transition-colors shadow-sm" title="Hapus">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// ------------------------------------------
// ZONA EDIT DATA RIWAYAT
// ------------------------------------------

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
        const res = await supabaseFetch(`log_absensi?id=eq.${id}`, 'PATCH', payload);
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

// ------------------------------------------
// ZONA HAPUS MASSAL & EXPORT CSV
// ------------------------------------------

function toggleAll(source) { 
    document.querySelectorAll('.log-checkbox').forEach(cb => cb.checked = source.checked); 
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
        if(checkAllBtn) checkAllBtn.checked = false; 
    }
}

async function deleteSingleLog(id) {
    if (!confirm("Hapus data absen ini secara permanen?")) return;
    let loading = showToast("Menghapus data...", "loading");
    try {
        const res = await supabaseFetch(`log_absensi?id=eq.${id}`, 'DELETE');
        loading.remove();
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            showToast("Data absen berhasil dihapus!", "success");
            loadRiwayatData();
        }
    } catch (err) {
        if(loading) loading.remove();
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

async function deleteBulkLogs() {
    const checked = document.querySelectorAll('.log-checkbox:checked');
    if(checked.length === 0) return;
    const konfirmasi = confirm(`⚠️ Yakin ingin menghapus ${checked.length} riwayat absen terpilih?`);
    if(!konfirmasi) return;

    let loading = showToast(`Menghapus ${checked.length} data...`, "loading");
    try {
        const ids = Array.from(checked).map(cb => cb.value);
        const deletePromises = ids.map(id => supabaseFetch(`log_absensi?id=eq.${id}`, 'DELETE'));
        await Promise.all(deletePromises);
        loading.remove();
        showToast(`${checked.length} data berhasil dihapus!`, "success");
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
        if(cols.length > 0) {
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

        // Beri waktu browser menyelesaikan layout dan paint tabel sebelum mencetak.
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

    // Nama & NIP sisi kanan tetap kosong agar bisa ditulis tangan saat dicetak
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
    if (filterCari) periode += ` • Kata kunci: "${filterCari}"`;

    setText('printMetaInfo', `${periode} • Jumlah Data: ${jumlahData} • Dicetak: ${tglCetakStr}`, `${periode} • Dicetak: ${tglCetakStr}`);
}