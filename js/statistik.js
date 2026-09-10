// ==========================================
// LOGIKA HALAMAN STATISTIK KEHADIRAN
// ==========================================

let allMasterData = [];
let allLogData = [];
let volunteerStats = [];
let filteredStats = [];

let chartOrgInst = null;
let chartSesiInst = null;
let chartMonthlyInst = null;

let volCurrentPage = 1;
const volPerPage = 50;
let volSortKey = 'totalHadir';
let volSortDir = 'desc';
let rekapBulan = '';

Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#94a3b8';
Chart.defaults.scale.grid.color = '#f1f5f9';

document.addEventListener("DOMContentLoaded", () => {
    applyDarkModeChartDefaults();
    inisialisasiFilterBulanRekap();
    loadStatistikData();
});

function inisialisasiFilterBulanRekap() {
    const sel = document.getElementById('filterBulanRekap');
    if (!sel) return;
    const namaBulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const now = new Date();

    let html = '<option value="">Semua Periode</option>';
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        html += `<option value="${prefix}">${namaBulan[d.getMonth()]} ${d.getFullYear()}</option>`;
    }
    sel.innerHTML = html;

    sel.addEventListener('change', () => {
        rekapBulan = sel.value;
        computeVolunteerStats();
        renderVolunteerTable();
    });
}

function applyDarkModeChartDefaults() {
    const isDark = document.documentElement.classList.contains('dark');
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.scale.grid.color = isDark ? '#1e293b' : '#f1f5f9';
}

// ==========================================
// 1. LOAD DATA DARI SUPABASE
// ==========================================

async function loadStatistikData() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.remove('hidden');

    try {
        const [masterRes, logRes] = await Promise.all([
            supabaseFetch('master_relawan?select=*', 'GET'),
            supabaseFetch(await terapkanFilterLokasi('log_absensi?select=*&order=id.desc'), 'GET')
        ]);

        if (masterRes.status === "success" && logRes.status === "success") {
            allMasterData = masterRes.data;
            allLogData = logRes.data;
            computeAll();
        } else {
            showToast("Gagal menarik data dari server", "error");
        }
    } catch (error) {
        showToast("Terjadi kesalahan jaringan", "error");
        console.error("Statistik Load Error:", error);
    } finally {
        overlay.classList.add('hidden');
    }
}

// ==========================================
// 2. KALKULASI & RENDER SEMUA
// ==========================================

function computeAll() {
    renderSummaryCards();
    computeVolunteerStats();
    renderVolunteerTable();
    renderOrgChart();
    renderSesiChart();
    renderMonthlyTrend();
}

// ==========================================
// 3. SUMMARY CARDS
// ==========================================

function renderSummaryCards() {
    const totalRelawan = allMasterData.length;
    const totalKehadiran = allLogData.length;
    const uniqueDays = new Set(allLogData.map(r => r.tanggal).filter(Boolean)).size;
    const rataRata = uniqueDays > 0 ? (totalKehadiran / uniqueDays).toFixed(1) : '0';

    document.getElementById('stat-total-relawan').innerText = totalRelawan.toLocaleString('id-ID');
    document.getElementById('stat-total-kehadiran').innerText = totalKehadiran.toLocaleString('id-ID');
    document.getElementById('stat-hari-aktif').innerText = uniqueDays.toLocaleString('id-ID');
    document.getElementById('stat-rata-rata').innerText = rataRata;
}

// ==========================================
// 4. PER-VOLUNTEER STATISTICS
// ==========================================

function computeVolunteerStats() {
    const map = {};
    const periodePrefix = rekapBulan;
    const logs = periodePrefix
        ? allLogData.filter(l => l.tanggal && l.tanggal.slice(0, 7) === periodePrefix)
        : allLogData;

    logs.forEach(log => {
        const nama = log.nama || '-';
        if (!map[nama]) {
            map[nama] = {
                nama: nama,
                organisasi: log.organisasi || '-',
                totalHadir: 0,
                hariSet: new Set(),
                sesiTerakhir: log.tanggal || '-'
            };
        }
        map[nama].totalHadir += 1;
        if (log.tanggal) map[nama].hariSet.add(log.tanggal);
        if (log.tanggal && log.tanggal > (map[nama].sesiTerakhir || '')) {
            map[nama].sesiTerakhir = log.tanggal;
        }
    });

    volunteerStats = Object.values(map).map(v => ({
        nama: v.nama,
        organisasi: v.organisasi,
        totalHadir: v.totalHadir,
        hariAktif: v.hariSet.size,
        sesiTerakhir: v.sesiTerakhir
    }));

    filteredStats = [...volunteerStats];
    sortVolunteerStats();
}

function sortVolunteerStats() {
    filteredStats.sort((a, b) => {
        let valA = a[volSortKey];
        let valB = b[volSortKey];

        if (volSortKey === 'totalHadir' || volSortKey === 'hariAktif') {
            valA = Number(valA) || 0;
            valB = Number(valB) || 0;
        } else {
            valA = String(valA || '').toLowerCase();
            valB = String(valB || '').toLowerCase();
        }

        if (valA < valB) return volSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return volSortDir === 'asc' ? 1 : -1;
        return 0;
    });

    updateSortIcons();
}

function updateSortIcons() {
    ['nama', 'organisasi', 'totalHadir', 'hariAktif', 'sesiTerakhir'].forEach(key => {
        const icon = document.getElementById(`sort-icon-${key}`);
        if (!icon) return;
        icon.className = 'fa-solid text-[10px] text-slate-400';
        if (key === volSortKey) {
            icon.className = volSortDir === 'asc'
                ? 'fa-solid fa-sort-up text-[10px] text-primary'
                : 'fa-solid fa-sort-down text-[10px] text-primary';
        }
    });
}

function sortVolunteerTable(key) {
    if (volSortKey === key) {
        volSortDir = volSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        volSortKey = key;
        volSortDir = (key === 'totalHadir' || key === 'hariAktif') ? 'desc' : 'asc';
    }
    sortVolunteerStats();
    volCurrentPage = 1;
    renderVolunteerTable();
}

function filterVolunteerTable() {
    const keyword = (document.getElementById('searchVolunteer').value || '').toLowerCase().trim();
    if (!keyword) {
        filteredStats = [...volunteerStats];
    } else {
        filteredStats = volunteerStats.filter(v =>
            v.nama.toLowerCase().includes(keyword) ||
            v.organisasi.toLowerCase().includes(keyword)
        );
    }
    sortVolunteerStats();
    volCurrentPage = 1;
    renderVolunteerTable();
}

function renderVolunteerTable() {
    const tbody = document.getElementById('volunteerTableBody');
    const totalItems = filteredStats.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / volPerPage));

    if (volCurrentPage > totalPages) volCurrentPage = totalPages;

    const startIdx = (volCurrentPage - 1) * volPerPage;
    const endIdx = Math.min(startIdx + volPerPage, totalItems);
    const pageData = filteredStats.slice(startIdx, endIdx);

    let html = '';
    if (pageData.length === 0) {
        html = '<tr><td colspan="6" class="text-center p-8 text-slate-400 font-medium">Tidak ada data ditemukan.</td></tr>';
    } else {
        pageData.forEach((v, i) => {
            const no = startIdx + i + 1;
            html += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td class="px-4 py-3 text-center text-slate-500 text-xs">${no}</td>
                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">${escapeHTML(v.nama)}</td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-semibold uppercase">${escapeHTML(v.organisasi)}</td>
                    <td class="px-4 py-3 text-center"><span class="bg-indigo-100 dark:bg-indigo-500/10 text-primary font-black px-3 py-1 rounded-lg text-xs border border-indigo-200 dark:border-indigo-500/20">${v.totalHadir}</span></td>
                    <td class="px-4 py-3 text-center"><span class="bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-black px-3 py-1 rounded-lg text-xs border border-emerald-200 dark:border-emerald-500/20">${v.hariAktif}</span></td>
                    <td class="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs font-semibold">${escapeHTML(v.sesiTerakhir)}</td>
                </tr>
            `;
        });
    }

    tbody.innerHTML = html;

    document.getElementById('volunteerPaginationInfo').innerText = `Menampilkan ${startIdx + 1}-${endIdx} dari ${totalItems} data`;

    const btnPrev = document.getElementById('btnVolPrev');
    const btnNext = document.getElementById('btnVolNext');
    btnPrev.disabled = volCurrentPage <= 1;
    btnNext.disabled = volCurrentPage >= totalPages;
}

function changeVolunteerPage(delta) {
    const totalPages = Math.max(1, Math.ceil(filteredStats.length / volPerPage));
    volCurrentPage += delta;
    if (volCurrentPage < 1) volCurrentPage = 1;
    if (volCurrentPage > totalPages) volCurrentPage = totalPages;
    renderVolunteerTable();
}

// ==========================================
// 5. CHART: TOP 10 ORGANISASI
// ==========================================

function renderOrgChart() {
    const orgCount = {};
    allLogData.forEach(r => {
        const org = r.organisasi || '-';
        orgCount[org] = (orgCount[org] || 0) + 1;
    });

    const sortedOrgs = Object.entries(orgCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const ctx = document.getElementById('chartOrgStats').getContext('2d');
    if (chartOrgInst) chartOrgInst.destroy();

    chartOrgInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedOrgs.map(item => item[0]),
            datasets: [{
                data: sortedOrgs.map(item => item[1]),
                backgroundColor: [
                    '#4F46E5', '#818CF8', '#3B82F6', '#10B981', '#F59E0B',
                    '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'
                ],
                borderRadius: 6,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) { return ` ${ctx.raw} Kehadiran`; }
                    }
                }
            },
            scales: {
                x: { beginAtZero: true, border: { display: false } },
                y: { grid: { display: false } }
            }
        }
    });
}

// ==========================================
// 6. CHART: DISTRIBUSI SESI (SIANG vs MALAM)
// ==========================================

function renderSesiChart() {
    let siang = 0;
    let malam = 0;

    allLogData.forEach(r => {
        if (r.sesi === 'Siang') siang += 1;
        else if (r.sesi === 'Malam') malam += 1;
    });

    const ctx = document.getElementById('chartSesi').getContext('2d');
    if (chartSesiInst) chartSesiInst.destroy();

    chartSesiInst = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Siang', 'Malam'],
            datasets: [{
                data: [siang, malam],
                backgroundColor: ['#F97316', '#6366F1'],
                borderWidth: 3,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, padding: 16, font: { size: 12, weight: 'bold' } }
                },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                            return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ==========================================
// 7. CHART: MONTHLY TREND (6 BULAN TERAKHIR)
// ==========================================

function renderMonthlyTrend() {
    const now = new Date();
    const months = [];

    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const prefix = `${yyyy}-${mm}`;
        const label = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });

        const count = allLogData.filter(r => r.tanggal && r.tanggal.startsWith(prefix)).length;

        months.push({ prefix, label, count });
    }

    const ctx = document.getElementById('chartMonthlyTrend').getContext('2d');
    if (chartMonthlyInst) chartMonthlyInst.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.5)');
    gradient.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

    chartMonthlyInst = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months.map(m => m.label),
            datasets: [{
                label: 'Total Kehadiran',
                data: months.map(m => m.count),
                borderColor: '#4F46E5',
                backgroundColor: gradient,
                borderWidth: 3,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#4F46E5',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: function(items) {
                            const idx = items[0].dataIndex;
                            return months[idx].label;
                        },
                        label: function(ctx) {
                            return ` ${ctx.raw} Kehadiran`;
                        }
                    }
                }
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, border: { display: false } }
            }
        }
    });
}

// ==========================================
// 8. EXPORT CSV
// ==========================================

function exportTableCSV() {
    if (filteredStats.length === 0) {
        showToast("Tidak ada data untuk diexport", "error");
        return;
    }
    const headers = ['No', 'Nama', 'Organisasi', 'Total Hadir', 'Hari Aktif', 'Sesi Terakhir'];

    const rows = filteredStats.map((v, i) => [
        i + 1,
        `"${(v.nama || '').replace(/"/g, '""')}"`,
        `"${(v.organisasi || '').replace(/"/g, '""')}"`,
        v.totalHadir,
        v.hariAktif,
        v.sesiTerakhir
    ]);

    let csv = '\uFEFF' + headers.join(',') + '\n';
    rows.forEach(r => { csv += r.join(',') + '\n'; });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    a.download = `Statistik_Relawan_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);

    showToast("File CSV berhasil diunduh!", "success");
}

function exportTableXLSX() {
    if (filteredStats.length === 0) {
        showToast("Tidak ada data untuk diexport", "error");
        return;
    }
    if (typeof XLSX === 'undefined') {
        showToast("Lib Excel belum dimuat, beralih ke CSV.", "info");
        setTimeout(exportTableCSV, 50);
        return;
    }

    const aoa = [[
        { t: 's', v: 'No' },
        { t: 's', v: 'Nama' },
        { t: 's', v: 'Organisasi' },
        { t: 's', v: 'Total Hadir' },
        { t: 's', v: 'Hari Aktif' },
        { t: 's', v: 'Sesi Terakhir' }
    ]];

    filteredStats.forEach((v, i) => {
        aoa.push([
            { t: 'n', v: i + 1 },
            { t: 's', v: String(v.nama || '') },
            { t: 's', v: String(v.organisasi || '') },
            { t: 'n', v: Number(v.totalHadir) || 0 },
            { t: 'n', v: Number(v.hariAktif) || 0 },
            { t: 's', v: String(v.sesiTerakhir || '-') }
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
        { wch: 5 }, { wch: 30 }, { wch: 25 }, { wch: 11 }, { wch: 10 }, { wch: 14 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rekap Relawan');

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const label = rekapBulan || dateStr;
    XLSX.writeFile(wb, `Rekap_Relawan_${label}.xlsx`);
    showToast("Export Excel berhasil.", "success");
}

// ==========================================
// 9. RE-AAPPLY DARK MODE CHART DEFAULTS ON TOGGLE
// ==========================================

const _origToggleDarkMode = typeof toggleDarkMode === 'function' ? toggleDarkMode : null;
if (_origToggleDarkMode) {
    window.toggleDarkMode = function() {
        _origToggleDarkMode();
        applyDarkModeChartDefaults();
        if (chartOrgInst) chartOrgInst.update();
        if (chartSesiInst) chartSesiInst.update();
        if (chartMonthlyInst) chartMonthlyInst.update();
    };
}
