// ==========================================
// LOGIKA RIWAYAT ABSEN & EXPORT V2
// ==========================================

let riwayatData = [];

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('filterTanggal').valueAsDate = new Date();
    loadRiwayatData();
});

// 1. Tarik Log Absensi dari Supabase (Diurutkan dari Terbaru)
async function loadRiwayatData() {
    const loading = document.getElementById('loadingOverlay');
    loading.classList.remove('hidden');
    
    try {
        const res = await supabaseFetch('log_absensi?select=*&order=id.desc', 'GET');
        if (res.status === "success") {
            riwayatData = res.data;
            terapkanFilterRiwayat(); 
        } else {
            showToast("Gagal mengambil data riwayat.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    } finally {
        loading.classList.add('hidden');
    }
}

// 2. Mesin Pencari & Filter
function terapkanFilterRiwayat() {
    const filterTgl = document.getElementById('filterTanggal').value;
    const keyword = document.getElementById('filterCari').value.toLowerCase();

    let filtered = riwayatData.filter(r => {
        let matchTgl = filterTgl ? r.tanggal === filterTgl : true;
        let matchKey = keyword ? 
            (r.nama && r.nama.toLowerCase().includes(keyword)) ||
            (r.organisasi && r.organisasi.toLowerCase().includes(keyword)) ||
            (r.lokasi && r.lokasi.toLowerCase().includes(keyword)) : true;
        
        return matchTgl && matchKey;
    });

    renderTabelRiwayat(filtered);
}

function resetFilter() {
    document.getElementById('filterTanggal').value = '';
    document.getElementById('filterCari').value = '';
    terapkanFilterRiwayat();
}

// 3. Render Tabel HTML
function renderTabelRiwayat(data) {
    const tbody = document.getElementById('riwayatBody');
    document.getElementById('totalDataInfo').innerText = `Menampilkan ${data.length.toLocaleString('id-ID')} riwayat absen`;
    
    // Reset status CheckAll
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
        // Asumsi kolom Primary Key di Supabase kamu adalah 'id'
        html += `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3 text-center bg-slate-50 border-r border-slate-100">
                    <input type="checkbox" class="log-checkbox w-4 h-4 accent-primary cursor-pointer" value="${r.id}" onchange="toggleBulkActionBanner()">
                </td>
                <td class="px-4 py-3 text-center font-bold text-slate-400 bg-slate-50 border-r border-slate-100">${noUrut}</td>
                <td class="px-4 py-3 text-xs text-slate-500 font-mono">${r.created_at ? new Date(r.created_at).toLocaleTimeString('id-ID') : '-'}</td>
                <td class="px-4 py-3 font-bold text-slate-800">${r.nama}</td>
                <td class="px-4 py-3 font-bold ${r.sesi === 'Siang' ? 'text-orange-500' : 'text-indigo-600'}">${r.sesi}</td>
                <td class="px-4 py-3 text-slate-600 text-xs">${r.lokasi || '-'}</td>
                <td class="px-4 py-3 text-slate-600 text-xs font-semibold">${r.organisasi || '-'}</td>
                <td class="px-4 py-3 text-center">
                    <button onclick="deleteSingleLog('${r.id}')" class="bg-red-100 text-red-700 hover:bg-red-200 text-xs font-bold p-2 rounded-lg transition-colors shadow-sm" title="Hapus">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
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

    let csvContent = "data:text/csv;charset=utf-8,No,Waktu Rekam,Nama Relawan,Sesi,Lokasi Proyek,Organisasi\n";
    
    barisTabel.forEach(row => {
        let cols = row.querySelectorAll("td");
        if(cols.length > 0) {
            let rowArray = [
                cols[1].innerText, // No
                cols[2].innerText, // Waktu
                `"${cols[3].innerText}"`, // Nama (diapit kutip agar koma nama aman)
                cols[4].innerText, // Sesi
                `"${cols[5].innerText}"`, // Lokasi
                `"${cols[6].innerText}"`  // Organisasi
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