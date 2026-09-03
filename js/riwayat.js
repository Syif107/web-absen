// ==========================================
// LOGIKA RIWAYAT ABSEN, EXPORT & EDIT V2
// ==========================================

let riwayatData = [];

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('filterTanggal').valueAsDate = new Date();
    loadRiwayatData();
});

async function loadRiwayatData() {
    const loading = document.getElementById('loadingOverlay');
    loading.classList.remove('hidden');
    
    try {
        const res = await supabaseFetch('log_absensi?select=*&order=id.desc', 'GET');
        if (res.status === "success") {
            riwayatData = res.data;
            jalankanFilterDanSortRiwayat(); 
        } else {
            showToast("Gagal mengambil data riwayat.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
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
        const lokasiAman = r.lokasi ? r.lokasi.replace(/'/g, "\\'") : '';
        const orgAman = r.organisasi ? r.organisasi.replace(/'/g, "\\'") : '';
        
        html += `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3 text-center bg-slate-50 border-r border-slate-100">
                    <input type="checkbox" class="log-checkbox w-4 h-4 accent-primary cursor-pointer" value="${r.id}" onchange="toggleBulkActionBanner()">
                </td>
                <td class="px-4 py-3 text-center font-bold text-slate-400 bg-slate-50 border-r border-slate-100">${noUrut}</td>
                <td class="px-4 py-3 text-xs text-slate-500 font-mono">${r.tanggal || '-'}</td>
                <td class="px-4 py-3 font-bold text-slate-800">${r.nama}</td>
                <td class="px-4 py-3 font-bold ${r.sesi === 'Siang' ? 'text-orange-500' : 'text-indigo-600'}">${r.sesi}</td>
                <td class="px-4 py-3 text-slate-600 text-xs">${r.lokasi || '-'}</td>
                <td class="px-4 py-3 text-slate-600 text-xs font-semibold">${r.organisasi || '-'}</td>
                <td class="px-4 py-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="bukaModalEditLog('${r.id}', '${r.tanggal}', '${r.sesi}', '${lokasiAman}', '${orgAman}')" class="bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-bold p-2 rounded-lg transition-colors shadow-sm" title="Edit">
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