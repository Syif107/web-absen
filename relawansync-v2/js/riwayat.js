// ==========================================
// LOGIKA HALAMAN RIWAYAT & EKSPOR DATA
// ==========================================

let logDataLokal = [];

document.addEventListener("DOMContentLoaded", () => {
    // Set default tanggal filter ke hari ini, lalu muat data
    document.getElementById('filterTanggal').valueAsDate = new Date();
    loadRiwayatData();
});

// 1. Tarik Data dari Supabase berdasarkan Filter
async function loadRiwayatData() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.remove('hidden');

    const tgl = document.getElementById('filterTanggal').value;
    const cari = document.getElementById('filterCari').value.toLowerCase();

    // Bangun Query Supabase
    // Kita filter langsung dari server agar tidak memberatkan browser jika data sudah puluhan ribu
    let query = 'log_absensi?select=*&order=id.desc';
    
    if (tgl) {
        query += `&tanggal=eq.${tgl}`; // Filter tanggal SQL
    }

    try {
        const res = await supabaseFetch(query, 'GET');
        
        if (res.status === 'success') {
            let data = res.data;
            
            // Filter pencarian teks (Nama/Organisasi) dilakukan di lokal browser
            if (cari) {
                data = data.filter(item => 
                    (item.nama && item.nama.toLowerCase().includes(cari)) || 
                    (item.organisasi && item.organisasi.toLowerCase().includes(cari))
                );
            }

            logDataLokal = data;
            renderRiwayatTable();
        } else {
            showToast("Gagal memuat riwayat", "error");
        }
    } catch (error) {
        showToast("Terjadi kesalahan jaringan", "error");
    } finally {
        overlay.classList.add('hidden');
    }
}

function resetFilter() {
    document.getElementById('filterTanggal').value = '';
    document.getElementById('filterCari').value = '';
    loadRiwayatData();
}

// 2. Tampilkan Data ke Tabel HTML
function renderRiwayatTable() {
    const tbody = document.getElementById('riwayatBody');
    const info = document.getElementById('totalDataInfo');
    let html = '';

    if (logDataLokal.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400 font-semibold"><i class="fa-solid fa-folder-open text-2xl mb-2 block"></i> Tidak ada data log ditemukan.</td></tr>`;
        info.innerText = `Menampilkan 0 data`;
        return;
    }

    logDataLokal.forEach((row, index) => {
        // Format jam (waktu_rekam) dari database utc ke waktu lokal
        const waktuStr = row.waktu_rekam ? new Date(row.waktu_rekam).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
        
        html += `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3 text-center text-slate-500 font-semibold">${index + 1}</td>
                <td class="px-4 py-3 text-slate-500"><span class="bg-slate-100 px-2 py-1 rounded-md text-xs font-bold border border-slate-200">${waktuStr}</span></td>
                <td class="px-4 py-3 font-bold text-slate-700">${row.nama}</td>
                <td class="px-4 py-3">
                    <span class="${row.sesi === 'Siang' ? 'text-orange-600 bg-orange-50 border-orange-200' : 'text-indigo-600 bg-indigo-50 border-indigo-200'} px-2 py-1 rounded-md text-xs font-bold border">
                        ${row.sesi}
                    </span>
                </td>
                <td class="px-4 py-3 text-slate-600">${row.lokasi || '-'}</td>
                <td class="px-4 py-3 text-slate-600">${row.organisasi || '-'}</td>
                <td class="px-4 py-3 text-center">
                    <button onclick="hapusLog(${row.id})" class="text-red-500 hover:text-white hover:bg-red-500 w-8 h-8 rounded-lg transition-colors" title="Hapus Data">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    info.innerText = `Menampilkan ${logDataLokal.length} baris rekapan`;
}

// 3. Menghapus Log yang Salah
async function hapusLog(id) {
    if (!confirm("Yakin ingin menghapus riwayat absen ini?")) return;

    // Munculkan toast loading
    showToast("Menghapus data...", "loading");

    try {
        const query = `log_absensi?id=eq.${id}`;
        const res = await supabaseFetch(query, 'DELETE');
        
        if (res.status === 'success') {
            showToast("Data log berhasil dihapus!", "success");
            loadRiwayatData(); // Muat ulang tabel
        } else {
            showToast("Gagal menghapus data", "error");
        }
    } catch (error) {
        showToast("Error saat menghapus", "error");
    }
}

// 4. Ekspor ke CSV / Excel
function exportToCSV() {
    if (logDataLokal.length === 0) {
        showToast("Tidak ada data untuk diekspor!", "error");
        return;
    }

    // Header Kolom
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ID,Waktu Rekam,Tanggal,Sesi,NIP,Nama,Keahlian,Organisasi,Lokasi\n";

    // Isi Baris Data
    logDataLokal.forEach(r => {
        // Hilangkan koma pada teks agar tidak merusak format CSV
        const bersih = (str) => str ? String(str).replace(/,/g, ' ') : '';
        
        const row = [
            r.id, 
            r.waktu_rekam, 
            r.tanggal, 
            r.sesi, 
            r.nip, 
            bersih(r.nama), 
            bersih(r.bidang), 
            bersih(r.organisasi), 
            bersih(r.lokasi)
        ].join(",");
        
        csvContent += row + "\n";
    });

    // Proses Download File Otomatis
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    // Nama file otomatis sesuai tanggal filter
    const tglFilter = document.getElementById('filterTanggal').value || 'Semua';
    link.setAttribute("download", `Laporan_Absensi_Relawan_${tglFilter}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("File Laporan berhasil diunduh!", "success");
}