// ==========================================
// LOGIKA EXECUTIVE DASHBOARD DENGAN DRILL-DOWN & LEADERBOARD (V4)
// ==========================================

let chartTrendInst = null;
let chartOrgInst = null;
let chartLokasiInst = null;

let globalMasterData = [];
let globalLogData = [];
let logsThisMonth = []; 

let currentTodayStr = "";
let selectedYear = "";
let selectedMonth = "";

Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#94a3b8'; 
Chart.defaults.scale.grid.color = '#f1f5f9'; 

// Apply dark mode chart colors if needed
if (document.documentElement.classList.contains('dark')) {
    Chart.defaults.scale.grid.color = '#1e293b';
}

document.addEventListener("DOMContentLoaded", () => {
    siapkanFilterWaktu();
    loadDashboardData();
});

function siapkanFilterWaktu() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    
    currentTodayStr = `${yyyy}-${mm}-${dd}`;
    
    const elTahun = document.getElementById('filterTahun');
    for(let i = 0; i <= 5; i++) {
        let y = yyyy - i;
        elTahun.innerHTML += `<option value="${y}">${y}</option>`;
    }

    document.getElementById('filterBulan').value = mm;
    document.getElementById('filterTahun').value = yyyy;
}

function resetFilterDashboard() {
    const now = new Date();
    document.getElementById('filterBulan').value = String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('filterTahun').value = now.getFullYear();
    terapkanFilterDashboard();
}

async function loadDashboardData() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.remove('hidden');

    try {
        const [masterRes, logRes] = await Promise.all([
            supabaseFetch('master_relawan?select=*', 'GET'), 
            supabaseFetch(await terapkanFilterLokasi('log_absensi?select=*&order=id.desc'), 'GET') 
        ]);

        if (masterRes.status === "success" && logRes.status === "success") {
            globalMasterData = masterRes.data;
            globalLogData = logRes.data;
            terapkanFilterDashboard();
            cekNotifikasiReminder();
        } else {
            showToast("Gagal menarik data", "error");
        }
    } catch (error) {
        showToast("Terjadi kesalahan jaringan", "error");
    } finally {
        overlay.classList.add('hidden');
    }
}

// ==========================================
// NOTIFIKASI REMINDER - Cek absensi hari ini
// ==========================================
function cekNotifikasiReminder() {
    const logsToday = globalLogData.filter(r => r.tanggal === currentTodayStr);
    const now = new Date();
    const jam = now.getHours();
    
    if (logsToday.length === 0 && jam >= 9) {
        const btnNotif = document.getElementById('btnNotifikasi');
        if (btnNotif) btnNotif.classList.add('pulse-ring');
        
        if ('Notification' in window && Notification.permission === 'granted') {
            kirimNotifikasiJudul(
                'RelawanSync - Belum Ada Absensi Hari Ini',
                `Belum ada data kehadiran yang tercatat untuk hari ini (${currentTodayStr}). Segera lakukan input absensi.`,
                'assets/icon.png'
            );
        }
    } else {
        const btnNotif = document.getElementById('btnNotifikasi');
        if (btnNotif) btnNotif.classList.remove('pulse-ring');
    }
}

function terapkanFilterDashboard() {
    selectedMonth = document.getElementById('filterBulan').value;
    selectedYear = document.getElementById('filterTahun').value;
    const filterPrefix = `${selectedYear}-${selectedMonth}`; 

    const namaBulan = document.getElementById('filterBulan').options[document.getElementById('filterBulan').selectedIndex].text;
    document.getElementById('headerDateText').innerText = `DATA UPDATE TERAKHIR: ${currentTodayStr} | TAMPILAN: ${namaBulan.toUpperCase()} ${selectedYear}`;

    logsThisMonth = globalLogData.filter(r => r.tanggal && r.tanggal.startsWith(filterPrefix));
    const logsToday = globalLogData.filter(r => r.tanggal === currentTodayStr);

    const uniqueDaysThisMonth = new Set(logsThisMonth.map(r => r.tanggal)).size;
    const avgDaily = uniqueDaysThisMonth > 0 ? Math.round(logsThisMonth.length / uniqueDaysThisMonth) : 0;

    document.getElementById('kpi-master').innerText = globalMasterData.length.toLocaleString('id-ID');
    document.getElementById('kpi-today').innerText = logsToday.length.toLocaleString('id-ID');
    document.getElementById('kpi-month').innerText = logsThisMonth.length.toLocaleString('id-ID');
    document.getElementById('kpi-avg').innerText = avgDaily.toLocaleString('id-ID');

    renderTrendChart(logsThisMonth);
    renderOrgChart(logsThisMonth);
    renderLokasiChart(logsThisMonth);
    renderLiveFeed(logsToday);

    setupFilterTopLokasi();
    renderTopRelawan();
}

// ------------------------------------------
// ZONA LEADERBOARD TOP RELAWAN
// ------------------------------------------

function setupFilterTopLokasi() {
    const filterEl = document.getElementById('filterTopLokasi');
    if (!filterEl) return; 
    
    const uniqueLocations = [...new Set(logsThisMonth.map(r => r.lokasi).filter(Boolean))].sort();
    
    let html = `<option value="Semua">Semua Lokasi Proyek</option>`;
    uniqueLocations.forEach(loc => {
        html += `<option value="${loc}">${loc}</option>`;
    });
    
    filterEl.innerHTML = html;
}

// Variabel penyimpan data relawan teraktif yang sedang difilter
let cachedTopRelawanList = [];

function renderTopRelawan() {
    const filterEl = document.getElementById('filterTopLokasi');
    const container = document.getElementById('containerTopRelawan');
    if (!filterEl || !container) return;

    const selectedLoc = filterEl.value;
    
    let filteredLogs = logsThisMonth;
    if (selectedLoc !== "Semua") {
        filteredLogs = logsThisMonth.filter(r => r.lokasi === selectedLoc);
    }

    if (filteredLogs.length === 0) {
        container.innerHTML = `<div class="col-span-full p-6 text-center text-slate-400 font-medium">Belum ada data kehadiran pada pilihan ini.</div>`;
        cachedTopRelawanList = [];
        return;
    }

    const countMap = {};
    filteredLogs.forEach(r => {
        const key = r.nama;
        if (!countMap[key]) countMap[key] = { nama: r.nama, org: r.organisasi, total: 0 };
        countMap[key].total += 1;
    });

    // Urutkan dari yang terbanyak secara menyeluruh
    cachedTopRelawanList = Object.values(countMap).sort((a, b) => b.total - a.total);
    
    // Ambil top 9 untuk ditampilkan di halaman utama dashboard
    const topRelawanTampil = cachedTopRelawanList.slice(0, 9);
    
    let html = '';
    const warnaMedali = ['text-yellow-400', 'text-slate-300', 'text-amber-600']; 
    
    topRelawanTampil.forEach((item, index) => {
        let badgeIcon = index < 3 
            ? `<i class="fa-solid fa-medal text-xl ${warnaMedali[index]}"></i>` 
            : `<div class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-400 border border-slate-200">#${index+1}</div>`;

        html += `
            <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center justify-between gap-3 shadow-sm hover:shadow-md transition-shadow">
                <div class="flex items-center gap-3 w-full min-w-0">
                    <div class="shrink-0 flex items-center justify-center w-8">
                        ${badgeIcon}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="font-bold text-sm text-slate-800 truncate">${item.nama}</p>
                        <p class="text-[10px] text-slate-500 font-semibold truncate uppercase">${item.org || '-'}</p>
                    </div>
                </div>
                <div class="bg-primary/10 text-primary px-3 py-1.5 rounded-lg text-sm font-black text-center shrink-0 border border-primary/20">
                    ${item.total} <span class="text-[10px] font-bold opacity-70">x</span>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Fungsi untuk Membuka Modal Daftar Peringkat Menyeluruh
function bukaModalLeaderboardSemua() {
    const tbody = document.getElementById('tbodyLeaderboardSemua');
    document.getElementById('totalRelawanLeaderboard').innerText = `Total: ${cachedTopRelawanList.length} Relawan`;

    if (cachedTopRelawanList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-slate-400 font-medium">Belum ada data peringkat untuk ditampilkan.</td></tr>`;
    } else {
        let html = '';
        cachedTopRelawanList.forEach((item, index) => {
            const rank = index + 1;
            let rankBadge = `<span class="font-bold text-slate-600">#${rank}</span>`;
            if (rank === 1) rankBadge = `<span class="bg-yellow-100 text-yellow-700 font-black px-2.5 py-1 rounded-lg text-xs"><i class="fa-solid fa-medal mr-1"></i> #1 Emas</span>`;
            else if (rank === 2) rankBadge = `<span class="bg-slate-100 text-slate-700 font-black px-2.5 py-1 rounded-lg text-xs"><i class="fa-solid fa-medal mr-1"></i> #2 Perak</span>`;
            else if (rank === 3) rankBadge = `<span class="bg-amber-50 text-amber-700 font-black px-2.5 py-1 rounded-lg text-xs"><i class="fa-solid fa-medal mr-1"></i> #3 Perunggu</span>`;

            html += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-4 py-3 text-center">${rankBadge}</td>
                    <td class="px-4 py-3 font-bold text-slate-800">${item.nama}</td>
                    <td class="px-4 py-3 text-slate-600 uppercase text-xs font-semibold">${item.org || '-'}</td>
                    <td class="px-4 py-3 text-center"><span class="bg-indigo-50 text-primary font-black px-3 py-1 rounded-lg text-xs border border-indigo-100">${item.total} Hadir</span></td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }

    document.getElementById('modalLeaderboardSemua').classList.remove('hidden');
}

function tutupModalLeaderboardSemua() {
    document.getElementById('modalLeaderboardSemua').classList.add('hidden');
}

// ------------------------------------------
// ZONA RENDER CHART & DRILL DOWN
// ------------------------------------------

function renderTrendChart(logsThisMonth) {
    const dailyCount = {};
    logsThisMonth.forEach(r => { dailyCount[r.tanggal] = (dailyCount[r.tanggal] || 0) + 1; });
    const sortedDates = Object.keys(dailyCount).sort();
    
    const chartLabels = sortedDates; 
    const chartLabelsTampil = sortedDates.map(d => d.slice(-2)); 
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
            fullDates: chartLabels, 
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
                tooltip: { callbacks: { label: function(context) { return ` ${context.label}: ${context.raw} Total Kehadiran`; } } }
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

function bukaModalRincian(tipe, judul, sub, parameter = null) {
    document.getElementById('modalRincianJudul').innerText = judul;
    document.getElementById('modalRincianSub').innerText = sub;
    
    const thead = document.getElementById('modalThead');
    const tbody = document.getElementById('modalTbody');
    let htmlHead = ''; let htmlBody = '';
    let dataSumber = [];
    
    const filterPrefix = `${selectedYear}-${selectedMonth}`;

    if (tipe === 'master') {
        dataSumber = globalMasterData;
        htmlHead = `<tr><th class="px-4 py-3 w-12 text-center">No</th><th class="px-4 py-3">NIP / ID</th><th class="px-4 py-3">Nama Relawan</th><th class="px-4 py-3">Organisasi Terdaftar</th><th class="px-4 py-3">Bidang Utama</th></tr>`;
        dataSumber.forEach((r, i) => {
            htmlBody += `<tr class="hover:bg-slate-50"><td class="px-4 py-2 text-center text-slate-500">${i+1}</td><td class="px-4 py-2 font-mono text-xs text-slate-400">${r.nip}</td><td class="px-4 py-2 font-bold">${r.nama}</td><td class="px-4 py-2 text-slate-600">${r.asal_organisasi}</td><td class="px-4 py-2 text-slate-600">${r.jabatan}</td></tr>`;
        });
    } else {
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

// ==========================================
// REKAP HARIAN WA-READY (FASE 3)
// ==========================================

function bukaModalRekapHarian() {
    const modal = document.getElementById('modalRekapHarian');
    const tgl = document.getElementById('rekapTanggal');

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    if (!tgl.value) tgl.value = `${yyyy}-${mm}-${dd}`;
    modal.classList.remove('hidden');
    generateRekapHarian();
}

function tutupModalRekapHarian() {
    document.getElementById('modalRekapHarian').classList.add('hidden');
}

async function generateRekapHarian() {
    const tgl = document.getElementById('rekapTanggal').value;
    const sertakanNama = document.getElementById('rekapSertakanNama').checked;
    const preview = document.getElementById('rekapPreview');

    if (!tgl) {
        preview.value = 'Pilih tanggal terlebih dahulu.';
        return;
    }

    preview.value = "Menyusun rekap...";
    try {
        const res = await supabaseFetch(
            `log_absensi?select=nama,sesi,lokasi,organisasi&tanggal=eq.${tgl}&order=sesi.asc,lokasi.asc`,
            'GET'
        );
        if (res.status !== "success") {
            preview.value = 'Gagal memuat data rekap.';
            return;
        }
        preview.value = susunPesanRekap(res.data || [], tgl, sertakanNama);
    } catch (err) {
        preview.value = 'Terjadi kesalahan jaringan.';
    }
}

function formatHariTanggalID(dateStr) {
    const hari = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const bulan = {
        '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April',
        '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus',
        '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember'
    };
    const [y, m, d] = String(dateStr).split('-');
    if (!y || !m || !d) return dateStr;
    const tglObj = new Date(y, m - 1, d);
    return `${hari[tglObj.getDay()]}, ${parseInt(d, 10)} ${bulan[m] || m} ${y}`;
}

function urutSesi(sesi) {
    const prioritas = { 'Siang': 0, 'Malam': 1 };
    if (prioritas[sesi] !== undefined) return prioritas[sesi];
    return 99;
}

function susunPesanRekap(logs, tanggal, sertakanNama) {
    if (logs.length === 0) {
        return `📊 *REKAP KEHADIRAN RELAWAN*\n📅 ${formatHariTanggalID(tanggal)}\n\nBelum ada data kehadiran yang tercatat pada tanggal ini.`;
    }

    const grup = {};
    logs.forEach(l => {
        const lok = (l.lokasi || 'Lainnya').trim() || 'Lainnya';
        const ses = (l.sesi || '').trim() || '-';
        if (!grup[lok]) grup[lok] = {};
        if (!grup[lok][ses]) grup[lok][ses] = [];
        grup[lok][ses].push(l);
    });

    const baris = [];
    baris.push(`📊 *REKAP KEHADIRAN RELAWAN*`);
    baris.push(`📅 ${formatHariTanggalID(tanggal)}`);
    baris.push(`━━━━━━━━━━━━━━━`);

    const emojiSesi = { 'Siang': '☀️', 'Malam': '🌙' };

    Object.keys(grup)
        .sort((a, b) => a.localeCompare(b, 'id'))
        .forEach(lok => {
            const sesiKeys = Object.keys(grup[lok]).sort((a, b) => urutSesi(a) - urutSesi(b) || a.localeCompare(b, 'id'));

            baris.push('');
            baris.push(`🏗️ *${lok.toUpperCase()}*`);

            let totalLokasi = 0;
            sesiKeys.forEach(ses => {
                const list = grup[lok][ses];
                const unik = [];
                const seen = new Set();
                list.forEach(l => {
                    const k = (l.nama || '').trim();
                    if (k && !seen.has(k)) {
                        seen.add(k);
                        unik.push(l);
                    }
                });
                totalLokasi += unik.length;

                const emoji = emojiSesi[ses] || '✳️';
                baris.push(`${emoji} *${ses}* — ${unik.length} Relawan`);

                if (sertakanNama) {
                    unik.forEach(l => baris.push(`   • ${l.nama.trim()}`));
                }

                const orgCounts = {};
                unik.forEach(l => {
                    const o = (l.organisasi || '').trim();
                    if (o && o !== 'Umum') orgCounts[o] = (orgCounts[o] || 0) + 1;
                });
                const orgKeys = Object.keys(orgCounts);
                if (orgKeys.length > 0) {
                    baris.push(`   ✅ ${orgKeys.map(o => `${o} (${orgCounts[o]})`).join(', ')}`);
                }
            });

            baris.push(`   ⭐ Total ${lok}: ${totalLokasi} Relawan`);
        });

    baris.push('');
    baris.push(`━━━━━━━━━━━━━━━`);
    baris.push(`🚩 *TOTAL: ${logs.length} Relawan*`);
    baris.push(`— disusun via RelawanSync —`);

    return baris.join('\n');
}

function salinRekapWa() {
    const preview = document.getElementById('rekapPreview');
    const teks = preview.value;
    if (!teks || teks.startsWith('Pilih tanggal')) {
        showToast("Buat rekap terlebih dahulu.", "error");
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(teks)
            .then(() => showToast("Rekap disalin ke clipboard!", "success"))
            .catch(() => salinRekapFallback(preview));
    } else {
        salinRekapFallback(preview);
    }
}

function salinRekapFallback(preview) {
    preview.removeAttribute('readonly');
    preview.select();
    preview.setSelectionRange(0, preview.value.length);
    let ok = false;
    try {
        ok = document.execCommand('copy');
    } catch (e) {
        ok = false;
    }
    preview.setAttribute('readonly', '');
    preview.blur();
    showToast(ok ? "Rekap disalin ke clipboard!" : "Gagal menyalin otomatis, silakan salin manual.", ok ? "success" : "error");
}

function kirimRekapViaWa() {
    const teks = document.getElementById('rekapPreview').value;
    if (!teks || teks.startsWith('Pilih tanggal') || teks.startsWith('Gagal')) {
        showToast("Buat rekap terlebih dahulu.", "error");
        return;
    }
    const url = 'https://wa.me/?text=' + encodeURIComponent(teks);
    window.open(url, '_blank');
}