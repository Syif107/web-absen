// ==========================================
// LOGIKA KALENDER KEHADIRAN RELAWAN V2
// ==========================================

let allLogData = [];
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedLocationFilter = 'Semua';

const MONTH_NAMES_ID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

document.addEventListener("DOMContentLoaded", () => {
    loadKalenderData();
});

async function loadKalenderData() {
    const loading = document.getElementById('loadingOverlay');
    loading.classList.remove('hidden');

    try {
        const res = await supabaseFetch(await terapkanFilterLokasi('log_absensi?select=*&order=tanggal.asc'), 'GET');
        if (res.status === "success") {
            allLogData = res.data;
            populateLocationFilter();
            renderKalender();
        } else {
            showToast("Gagal memuat data kalender.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    } finally {
        loading.classList.add('hidden');
    }
}

// ==========================================
// POPULATE LOCATION FILTER
// ==========================================
function populateLocationFilter() {
    const locations = [...new Set(allLogData.map(d => d.lokasi).filter(Boolean))].sort();
    const select = document.getElementById('filterLokasi');
    select.innerHTML = '<option value="Semua">Semua Lokasi</option>';
    locations.forEach(loc => {
        select.innerHTML += `<option value="${escapeHTML(loc)}">${escapeHTML(loc)}</option>`;
    });
}

// ==========================================
// NAVIGASI BULAN
// ==========================================
function prevMonth() {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderKalender();
}

function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderKalender();
}

function goToToday() {
    const today = new Date();
    currentYear = today.getFullYear();
    currentMonth = today.getMonth();
    renderKalender();
}

// ==========================================
// RENDER KALENDER UTAMA
// ==========================================
function renderKalender() {
    selectedLocationFilter = document.getElementById('filterLokasi').value;

    document.getElementById('kalenderTitle').textContent =
        `${MONTH_NAMES_ID[currentMonth]} ${currentYear}`;

    const filteredLogs = allLogData.filter(d => {
        if (selectedLocationFilter !== 'Semua' && d.lokasi !== selectedLocationFilter) return false;
        return true;
    });

    const monthLogs = filteredLogs.filter(d => {
        if (!d.tanggal) return false;
        const parts = d.tanggal.split('-');
        const yr = parseInt(parts[0]);
        const mo = parseInt(parts[1]) - 1;
        return yr === currentYear && mo === currentMonth;
    });

    const dayMap = {};
    monthLogs.forEach(log => {
        const day = parseInt(log.tanggal.split('-')[2]);
        if (!dayMap[day]) dayMap[day] = { siang: false, malam: false, records: [] };
        if (log.sesi === 'Siang') dayMap[day].siang = true;
        if (log.sesi === 'Malam') dayMap[day].malam = true;
        dayMap[day].records.push(log);
    });

    const today = new Date();
    const isCurrentMonth = (today.getFullYear() === currentYear && today.getMonth() === currentMonth);
    const todayDate = today.getDate();

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

    let html = '';

    for (let i = 0; i < firstDay; i++) {
        const dayNum = daysInPrevMonth - firstDay + i + 1;
        html += `<div class="calendar-day other-month"><span class="text-xs font-bold text-slate-400">${dayNum}</span></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const info = dayMap[d];
        let classes = 'calendar-day';
        let dots = '';

        if (isCurrentMonth && d === todayDate) classes += ' today';

        if (info) {
            if (info.siang && info.malam) {
                classes += ' has-both';
                dots = `<span class="text-[9px] font-bold text-violet-500 mt-0.5">2 Sesi</span>`;
            } else if (info.siang) {
                classes += ' has-siang';
                dots = `<span class="text-[9px] font-bold text-orange-500 mt-0.5">Siang</span>`;
            } else if (info.malam) {
                classes += ' has-malam';
                dots = `<span class="text-[9px] font-bold text-indigo-500 mt-0.5">Malam</span>`;
            }
        } else {
            classes += ' no-data';
        }

        const clickAction = info ? `onclick="bukaModalDetail(${d})"` : '';

        html += `
            <div class="${classes}" ${clickAction}>
                <span class="text-sm font-bold text-slate-700 dark:text-slate-200">${d}</span>
                ${dots}
            </div>
        `;
    }

    const totalCells = firstDay + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remainingCells; i++) {
        html += `<div class="calendar-day other-month"><span class="text-xs font-bold text-slate-400">${i}</span></div>`;
    }

    document.getElementById('kalenderGrid').innerHTML = html;

    updateStats(monthLogs);
}

// ==========================================
// UPDATE SUMMARY STATS
// ==========================================
function updateStats(monthLogs) {
    const uniqueDays = new Set();
    let countSiang = 0;
    let countMalam = 0;
    let countBoth = 0;

    const dayDetails = {};
    monthLogs.forEach(log => {
        const day = log.tanggal;
        if (!dayDetails[day]) dayDetails[day] = { siang: false, malam: false };
        if (log.sesi === 'Siang') dayDetails[day].siang = true;
        if (log.sesi === 'Malam') dayDetails[day].malam = true;
    });

    Object.values(dayDetails).forEach(d => {
        uniqueDays.add(true);
        if (d.siang && d.malam) countBoth++;
        else if (d.siang) countSiang++;
        else if (d.malam) countMalam++;
    });

    document.getElementById('statTotalHari').textContent = Object.keys(dayDetails).length;
    document.getElementById('statTotalSiang').textContent = countSiang + countBoth;
    document.getElementById('statTotalMalam').textContent = countMalam + countBoth;
    document.getElementById('statTotalBoth').textContent = countBoth;
}

// ==========================================
// MODAL DETAIL HARI
// ==========================================
function bukaModalDetail(day) {
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const dateKey = `${currentYear}-${monthStr}-${dayStr}`;

    const filteredLogs = allLogData.filter(d => {
        if (selectedLocationFilter !== 'Semua' && d.lokasi !== selectedLocationFilter) return false;
        return d.tanggal === dateKey;
    });

    const dateObj = new Date(currentYear, currentMonth, day);
    const dayName = dateObj.toLocaleDateString('id-ID', { weekday: 'long' });

    document.getElementById('modalDetailJudul').textContent =
        `${dayName}, ${day} ${MONTH_NAMES_ID[currentMonth]} ${currentYear}`;
    document.getElementById('modalDetailSub').textContent =
        `${filteredLogs.length} catatan kehadiran pada hari ini.`;

    const tbody = document.getElementById('modalDetailTbody');

    if (filteredLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center p-8 text-slate-400 font-medium">Tidak ada data kehadiran pada tanggal ini.</td></tr>`;
    } else {
        let html = '';
        filteredLogs.forEach((r, idx) => {
            const sesiColor = r.sesi === 'Siang' ? 'text-orange-500 bg-orange-50 dark:bg-orange-500/10' : 'text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10';
            html += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td class="px-4 py-3 text-center font-bold text-slate-400">${idx + 1}</td>
                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">${escapeHTML(r.nama)}</td>
                    <td class="px-4 py-3">
                        <span class="px-2.5 py-1 rounded-lg text-xs font-bold ${sesiColor}">${escapeHTML(r.sesi)}</span>
                    </td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">${escapeHTML(r.lokasi)}</td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-semibold">${escapeHTML(r.organisasi)}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }

    document.getElementById('modalDetailTotal').textContent = `Total: ${filteredLogs.length} Data`;
    document.getElementById('modalDetailHari').classList.remove('hidden');
}

function tutupModalDetail() {
    document.getElementById('modalDetailHari').classList.add('hidden');
}
