// ==========================================
// LOGIKA EXECUTIVE DASHBOARD DENGAN DRILL-DOWN (INTERAKTIF)
// ==========================================

let chartTrendInst = null;
let chartOrgInst = null;
let chartLokasiInst = null;

// Cache data global agar saat filter tidak perlu tarik database lagi
let globalMasterData = [];
let globalLogData = [];

// Variabel Waktu
let currentTodayStr = "";
let selectedYear = "";
let selectedMonth = "";

Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#94a3b8'; 
Chart.defaults.scale.grid.color = '#f1f5f9'; 

document.addEventListener("DOMContentLoaded", () => {
    siapkanFilterWaktu();
    loadDashboardData();
});

// A. Siapkan Opsi Tahun dan Tetapkan Waktu "Hari Ini"
function siapkanFilterWaktu() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    
    currentTodayStr = `${yyyy}-${mm}-${dd}`;
    
    // Set Tahun ke Dropdown (Contoh: 5 tahun ke belakang)
    const elTahun = document.getElementById('filterTahun');
    for(let i = 0; i <= 5; i++) {
        let y = yyyy - i;
        elTahun.innerHTML += `<option value="${y}">${y}</option>`;
    }

    // Set Default Filter ke Bulan & Tahun Saat ini
    document.getElementById('filterBulan').value = mm;
    document.getElementById('filterTahun').value = yyyy;
}

function resetFilterDashboard() {
    const now = new Date();
    document.getElementById('filterBulan').value = String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('filterTahun').value = now.getFullYear();
    terapkanFilterDashboard();
}

// B. Tarik Data Database
async function loadDashboardData() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.remove('hidden');

    try {
        const [masterRes, logRes] = await Promise.all([
            supabaseFetch('master_relawan?select=*', 'GET'), 
            supabaseFetch('log_absensi?select=*&order=id.desc', 'GET') 
        ]);

        if (masterRes.status === "success" && logRes.status === "success") {
            globalMasterData = masterRes.data;
            globalLogData = logRes.data;
            terapkanFilterDashboard();
        } else {
            showToast("Gagal menarik data visualisasi", "error");
        }
    } catch (error) {
        showToast("Terjadi kesalahan jaringan", "error");
    } finally {
        overlay.classList.add('hidden');
    }
}

// C. Proses Data berdasarkan Filter Bulan & Tahun
function terapkanFilterDashboard() {
    selectedMonth = document.getElementById('filterBulan').value;
    selectedYear = document.getElementById('filterTahun').value;
    const filterPrefix = `${selectedYear}-${selectedMonth}`; // Contoh: "2026-08"

    const namaBulan = document.getElementById('filterBulan').options[document.getElementById('filterBulan').selectedIndex].text;
    document.getElementById('headerDateText').innerText = `DATA UPDATE TERAKHIR: ${currentTodayStr} | TAMPILAN: ${namaBulan.toUpperCase()} ${selectedYear}`;

    // Filter data log sesuai bulan terpilih
    const logsThisMonth = globalLogData.filter(r => r.tanggal && r.tanggal.startsWith(filterPrefix));
    const logsToday = globalLogData.filter(r => r.tanggal === currentTodayStr);

    // Update KPI Angka
    const uniqueDaysThisMonth = new Set(logsThisMonth.map(r => r.tanggal)).size;
    const avgDaily = uniqueDaysThisMonth > 0 ? Math.round(logsThisMonth.length / uniqueDaysThisMonth) : 0;

    document.getElementById('kpi-master').innerText = globalMasterData.length.toLocaleString('id-ID');
    document.getElementById('kpi-today').innerText = logsToday.length.toLocaleString('id-ID');
    document.getElementById('kpi-month').innerText = logsThisMonth.length.toLocaleString('id-ID');
    document.getElementById('kpi-avg').innerText = avgDaily.toLocaleString('id-ID');

    // Render ulang grafik menggunakan data bulan terpilih
    renderTrendChart(logsThisMonth);
    renderOrgChart(logsThisMonth);
    renderLokasiChart(logsThisMonth);
    
    // Live feed selalu menggunakan data murni HARI INI
    renderLiveFeed(logsToday);
}

// ------------------------------------------
// ZONA RENDER CHART & INTERAKSI KLIK (DRILL-DOWN)
// ------------------------------------------

function renderTrendChart(logsThisMonth) {
    const dailyCount = {};
    logsThisMonth.forEach(r => { dailyCount[r.tanggal] = (dailyCount[r.tanggal] || 0) + 1; });
    const sortedDates = Object.keys(dailyCount).sort();
    
    const chartLabels = sortedDates; // Simpan format penuh "YYYY-MM-DD"
    const chartLabelsTampil = sortedDates.map(d => d.slice(-2)); // Tampilkan cuma tanggalnya saja
    const chartData = sortedDates.map(d => dailyCount[d]);

    const ctx = document.getElementById('chartTrend').getContext('2d');
    if (chartTrendInst) chartTrendInst.destroy();
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.5)');
    gradient.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

    chartTrendInst = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabelsTampil,
            fullDates: chartLabels, // Custom property untuk menyimpan tanggal utuh
            datasets: [{
                label: 'Total Kehadiran', data: chartData,
                borderColor: '#4F46E5', backgroundColor: gradient, borderWidth: 3,
                pointBackgroundColor: '#ffffff', pointBorderColor: '#4F46E5', fill: true, tension: 0.4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { x: { grid: { display: false } }, y: { beginAtZero: true, border: { display: false } } },
            onClick: (event, elements, chart) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const tanggalPenuh = chart.config.data.fullDates[index];
                    bukaModalRincian('tanggal', `Kehadiran Tanggal: ${tanggalPenuh}`, 'Rincian relawan yang hadir pada hari tersebut.', tanggalPenuh);
                }
            }
        }
    });
}

function renderOrgChart(logsThisMonth) {
    const orgCount = {};
    logsThisMonth.forEach(r => { orgCount[r.organisasi || '-'] = (orgCount[r.organisasi || '-'] || 0) + 1; });
    const sortedOrgs = Object.entries(orgCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const ctx = document.getElementById('chartOrg').getContext('2d');
    if (chartOrgInst) chartOrgInst.destroy();

    chartOrgInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedOrgs.map(item => item[0]),
            datasets: [{ data: sortedOrgs.map(item => item[1]), backgroundColor: '#818CF8', borderRadius: 4 }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, border: { display: false } }, y: { grid: { display: false } } },
            onClick: (event, elements, chart) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const namaOrg = chart.data.labels[index];
                    bukaModalRincian('instansi', `Rincian Instansi: ${namaOrg}`, 'Daftar kehadiran anggota dari instansi ini pada bulan terpilih.', namaOrg);
                }
            }
        }
    });
}

function renderLokasiChart(logsThisMonth) {
    const locCount = {};
    logsThisMonth.forEach(r => { locCount[r.lokasi || '-'] = (locCount[r.lokasi || '-'] || 0) + 1; });
    const sortedLocs = Object.entries(locCount).sort((a, b) => b[1] - a[1]);
    
    let finalLabels = []; let finalData = [];
    if (sortedLocs.length > 5) {
        finalLabels = sortedLocs.slice(0, 5).map(item => item[0]);
        finalData = sortedLocs.slice(0, 5).map(item => item[1]);
    } else {
        finalLabels = sortedLocs.map(item => item[0]);
        finalData = sortedLocs.map(item => item[1]);
    }

    const ctx = document.getElementById('chartLokasi').getContext('2d');
    if (chartLokasiInst) chartLokasiInst.destroy();

    chartLokasiInst = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: finalLabels,
            datasets: [{ data: finalData, backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#F43F5E'], borderWidth: 2, borderColor: '#ffffff' }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, padding: 15, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: function(context) { return ` ${context.label}: ${context.raw} Total Kehadiran`; } // Penjelasan Tooltip
                    }
                }
            },
            onClick: (event, elements, chart) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const namaLokasi = chart.data.labels[index];
                    bukaModalRincian('lokasi', `Titik Proyek: ${namaLokasi}`, 'Daftar relawan yang ditugaskan di lokasi ini.', namaLokasi);
                }
            }
        }
    });
}

function renderLiveFeed(logsToday) {
    const container = document.getElementById('liveFeedContainer');
    document.getElementById('liveFeedStatus').innerText = logsToday.length === 0 ? "Belum ada yang absen hari ini." : `Total ${logsToday.length} kehadiran hari ini.`;
    
    let html = '';
    // Tampilkan log hari ini, batasi 50 terakhir agar tidak berat saat scroll
    logsToday.slice(0, 50).forEach(row => {
        const isSiang = row.sesi === 'Siang';
        const icon = isSiang ? '<i class="fa-solid fa-sun text-orange-500"></i>' : '<i class="fa-solid fa-moon text-indigo-500"></i>';
        const bgIcon = isSiang ? 'bg-orange-50 border-orange-100' : 'bg-indigo-50 border-indigo-100';

        html += `
            <li class="flex items-start gap-3">
                <div class="w-10 h-10 shrink-0 rounded-full border ${bgIcon} flex items-center justify-center text-lg">${icon}</div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-slate-800 truncate">${row.nama}</p>
                    <p class="text-[11px] text-slate-500 font-medium truncate">${row.organisasi} • ${row.lokasi}</p>
                </div>
                <div class="text-right shrink-0">
                    <span class="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-semibold border border-slate-200 mt-1 inline-block">${row.bidang}</span>
                </div>
            </li>
        `;
    });

    container.innerHTML = html || '<p class="text-xs text-slate-400 text-center py-4">Papan feed kosong.</p>';
}

// ------------------------------------------
// ZONA DRILL-DOWN (LOGIKA MODAL POP-UP)
// ------------------------------------------

function bukaModalRincian(tipe, judul, sub, parameter = null) {
    document.getElementById('modalRincianJudul').innerText = judul;
    document.getElementById('modalRincianSub').innerText = sub;
    
    const thead = document.getElementById('modalThead');
    const tbody = document.getElementById('modalTbody');
    let htmlHead = ''; let htmlBody = '';
    let dataSumber = [];
    
    const filterPrefix = `${selectedYear}-${selectedMonth}`;

    // Logika Pemilahan Data berdasarkan Tipe yang di-klik
    if (tipe === 'master') {
        dataSumber = globalMasterData;
        htmlHead = `<tr><th class="px-4 py-3 w-12 text-center">No</th><th class="px-4 py-3">NIP / ID</th><th class="px-4 py-3">Nama Relawan</th><th class="px-4 py-3">Organisasi Terdaftar</th><th class="px-4 py-3">Bidang Utama</th></tr>`;
        dataSumber.forEach((r, i) => {
            htmlBody += `<tr class="hover:bg-slate-50"><td class="px-4 py-2 text-center text-slate-500">${i+1}</td><td class="px-4 py-2 font-mono text-xs text-slate-400">${r.nip}</td><td class="px-4 py-2 font-bold">${r.nama}</td><td class="px-4 py-2 text-slate-600">${r.asal_organisasi}</td><td class="px-4 py-2 text-slate-600">${r.jabatan}</td></tr>`;
        });
    } else {
        // Tipe terkait Log Absensi
        if (tipe === 'hari_ini') {
            dataSumber = globalLogData.filter(r => r.tanggal === currentTodayStr);
        } else if (tipe === 'bulan_ini') {
            dataSumber = globalLogData.filter(r => r.tanggal && r.tanggal.startsWith(filterPrefix));
        } else if (tipe === 'tanggal') {
            dataSumber = globalLogData.filter(r => r.tanggal === parameter);
        } else if (tipe === 'instansi') {
            dataSumber = globalLogData.filter(r => r.tanggal && r.tanggal.startsWith(filterPrefix) && r.organisasi === parameter);
        } else if (tipe === 'lokasi') {
            dataSumber = globalLogData.filter(r => r.tanggal && r.tanggal.startsWith(filterPrefix) && r.lokasi === parameter);
        }

        htmlHead = `<tr><th class="px-4 py-3 w-12 text-center">No</th><th class="px-4 py-3">Tanggal & Sesi</th><th class="px-4 py-3">Nama Relawan</th><th class="px-4 py-3">Organisasi</th><th class="px-4 py-3">Bidang</th><th class="px-4 py-3">Lokasi</th></tr>`;
        dataSumber.forEach((r, i) => {
            htmlBody += `<tr class="hover:bg-slate-50">
                <td class="px-4 py-2 text-center text-slate-500">${i+1}</td>
                <td class="px-4 py-2 text-sm"><span class="font-bold text-slate-700">${r.tanggal}</span> <span class="text-xs bg-slate-100 border border-slate-200 px-1 rounded ml-1">${r.sesi}</span></td>
                <td class="px-4 py-2 font-bold text-primary">${r.nama}</td>
                <td class="px-4 py-2 text-slate-600">${r.organisasi}</td>
                <td class="px-4 py-2 text-slate-600">${r.bidang}</td>
                <td class="px-4 py-2 text-slate-600">${r.lokasi}</td>
            </tr>`;
        });
    }

    thead.innerHTML = htmlHead;
    tbody.innerHTML = htmlBody || '<tr><td colspan="6" class="p-8 text-center text-slate-400">Tidak ada rincian data ditemukan.</td></tr>';
    document.getElementById('modalTotalBaris').innerText = `Total: ${dataSumber.length.toLocaleString('id-ID')} Baris Data`;
    
    document.getElementById('modalRincian').classList.remove('hidden');
}

function tutupModalRincian() {
    document.getElementById('modalRincian').classList.add('hidden');
}