// ================================================================
// PERINGKAT & REWARD PERSONEL — sumber server-side Fase 14
// ================================================================

let peringkatRows = [];
let peringkatTotal = 0;
let peringkatKpi = {};
let peringkatPage = 1;
const peringkatPageSize = 50;
let peringkatTimer = null;

const PROYEK_KHUSUS_PERINGKAT = [
    'Perpustakaan Tashawwuf',
    "Masjid Raya Fatchan Mubiina Chaddun 'Adhiim",
    'Monumen Semboyan Sang Mursyid',
    "Kanal Ta'at",
    'Gapura Syukur'
];

document.addEventListener('DOMContentLoaded', async () => {
    await siapkanFilterProyekPeringkat();
    await muatPeringkat(1);
});

async function siapkanFilterProyekPeringkat() {
    const select = document.getElementById('filterProyekPeringkat');
    const group = document.getElementById('opsiLainnyaPeringkat');
    if (!select || !group) return;
    const res = await supabaseFetchAll('v_daftar_proyek_absensi?select=kategori,nama_proyek&order=nama_proyek.asc');
    if (res.status !== 'success') return;
    const names = [...new Set((res.data || [])
        .filter(row => row.kategori === 'lainnya' && row.nama_proyek)
        .map(row => row.nama_proyek))]
        .filter(name => !PROYEK_KHUSUS_PERINGKAT.includes(name));
    group.innerHTML = names.map(name => `<option value="${escapeAttribute(`proyek:${name}`)}">${escapeHTML(name)}</option>`).join('');
}

function jadwalkanPeringkat() {
    clearTimeout(peringkatTimer);
    peringkatTimer = setTimeout(() => muatPeringkat(1), 300);
}

function renderPeringkat() {
    return muatPeringkat(1);
}

function loadPeringkat() {
    return muatPeringkat(peringkatPage);
}

async function muatPeringkat(page = peringkatPage) {
    const tbody = document.getElementById('tabelPeringkat');
    const errorBox = document.getElementById('peringkatError');
    peringkatPage = Math.max(1, Number(page) || 1);
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="p-10 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat peringkat...</td></tr>';
    if (errorBox) errorBox.classList.add('hidden');

    const proyek = document.getElementById('filterProyekPeringkat')?.value || 'semua';
    const status = document.getElementById('filterStatusPeringkat')?.value || 'semua';
    const cari = (document.getElementById('cariPeringkat')?.value || '').trim();
    const res = await callSupabaseRpc('daftar_peringkat_v2', {
        p_proyek: proyek,
        p_status: status,
        p_cari: cari,
        p_limit: peringkatPageSize,
        p_offset: (peringkatPage - 1) * peringkatPageSize
    });

    if (res.status !== 'success') {
        if (errorBox) {
            const pesan = `${res.message || ''} ${res.details || ''}`;
            errorBox.textContent = /statement timeout|57014/i.test(pesan)
                ? 'Waktu pemrosesan peringkat habis. Terapkan migrasi Fase 19 lalu segarkan halaman.'
                : 'Peringkat gagal dimuat. Periksa koneksi dan migrasi database terbaru, lalu segarkan halaman.';
            errorBox.classList.remove('hidden');
        }
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="p-10 text-center text-red-500 font-bold">Data peringkat belum tersedia.</td></tr>';
        return;
    }

    peringkatRows = Array.isArray(res.rows) ? res.rows : [];
    peringkatTotal = Number(res.total || 0);
    peringkatKpi = res.kpi || {};
    renderKpiPeringkat();
    gambarTabelPeringkat(proyek);
    gambarPaginationPeringkat(proyek);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = Number(value || 0).toLocaleString('id-ID');
}

function renderKpiPeringkat() {
    setText('kpiPersonel', peringkatKpi.personel);
    setText('kpiMemenuhi', peringkatKpi.memenuhi);
    setText('kpiZona4', peringkatKpi.zona4);
    setText('kpiMendekati', peringkatKpi.mendekati);
    setText('kpiWilayahKosong', peringkatKpi.zona_kosong);
}

function labelKategori(kategori) {
    if (kategori === 'khususul_khusus') return '5 Proyek Khususul Khusus';
    if (kategori === 'lainnya') return 'Proyek Lainnya';
    return 'Semua Proyek';
}

function labelZona(zona) {
    return {
        zona_1: 'Zona 1 — Jawa Timur & Bali',
        zona_2: 'Zona 2 — Jawa Tengah & DIY',
        zona_3: 'Zona 3 — Jawa Barat, Jakarta & Banten',
        zona_4: 'Zona 4 — Sumatera & Kalimantan'
    }[zona] || 'Zona belum diisi';
}

function labelFilterProyekPeringkat(value) {
    if (value === 'semua') return 'Semua Proyek';
    if (value === 'khususul_khusus') return '5 Proyek Khususul Khusus';
    if (value === 'lainnya') return 'Semua Proyek Lainnya';
    return String(value || '').replace(/^proyek:/, '');
}

function warnaAktif(tingkat) {
    if (tingkat === 'Sangat Aktif') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
    if (tingkat === 'Aktif') return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
    if (tingkat === 'Cukup Aktif') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
    return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}

function gambarTabelPeringkat(proyekFilter) {
    const tbody = document.getElementById('tabelPeringkat');
    if (!tbody) return;
    if (!peringkatRows.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-10 text-center text-slate-400 font-bold">Tidak ada data sesuai filter.</td></tr>';
        return;
    }

    tbody.innerHTML = peringkatRows.map(r => {
        const target = Number(r.target_hari || 40);
        const hariKelayakan = proyekFilter === 'semua' ? Number(r.hari_menuju_syarat || 0) : Number(r.total_hari || 0);
        const progress = Math.min(100, Math.round(100 * hariKelayakan / Math.max(1, target)));
        const rank = r.memenuhi_syarat ? `#${Number(r.peringkat || 0)}` : '—';
        const statusHtml = r.memenuhi_syarat
            ? '<span class="inline-flex px-2 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">MEMENUHI</span>'
            : '<span class="inline-flex px-2 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">BELUM</span>';
        const zonaClass = r.zona_asal === 'zona_4' ? 'text-violet-600 dark:text-violet-300' : (!r.zona_asal ? 'text-rose-600 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300');
        return `<tr class="hover:bg-indigo-50/40 dark:hover:bg-indigo-500/5">
            <td class="px-4 py-3 text-center font-black text-lg ${r.memenuhi_syarat ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-300 dark:text-slate-600'}">${rank}</td>
            <td class="px-4 py-3"><p class="font-extrabold text-slate-800 dark:text-slate-100">${escapeHTML(r.nama)}</p><p class="text-[10px] text-slate-400 font-mono mt-0.5">${escapeHTML(r.nip)} • ${escapeHTML(r.asal_organisasi || '-')}</p></td>
            <td class="px-4 py-3"><p class="font-bold text-xs ${zonaClass}">${escapeHTML(labelZona(r.zona_asal))}</p><p class="text-[10px] text-slate-400 mt-0.5">${escapeHTML(r.asal_daerah || 'Daerah belum diisi')}</p></td>
            <td class="px-4 py-3 min-w-[150px]"><div class="flex justify-between text-xs font-bold mb-1"><span>${Number(r.total_hari || 0)} hari tercatat</span><span>${target} hari</span></div><div class="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div class="h-full ${r.memenuhi_syarat ? 'bg-emerald-500' : 'bg-indigo-500'}" style="width:${progress}%"></div></div>${proyekFilter === 'semua' ? `<p class="text-[10px] text-slate-400 mt-1">${hariKelayakan} hari pada jalur kelayakan terbaik</p>` : ''}${Number(r.hari_historis || 0) > 0 ? `<p class="text-[10px] text-amber-600 dark:text-amber-300 mt-1">Termasuk ${Number(r.hari_historis)} hari historis</p>` : ''}</td>
            <td class="px-4 py-3"><p class="font-black">${Number(r.total_sesi || 0)}</p><p class="text-[10px] text-slate-400">${Number(r.persentase_sesi_90 || 0).toFixed(1)}% / 90 hari</p></td>
            <td class="px-4 py-3"><p class="font-black text-lg">${Number(r.indeks_keaktifan || 0).toFixed(1)}</p><span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black ${warnaAktif(r.tingkat_keaktifan)}">${escapeHTML(r.tingkat_keaktifan || '-')}</span></td>
            <td class="px-4 py-3 text-xs"><p><strong>${Number(r.streak_terpanjang || 0)}</strong> hari terpanjang</p><p class="text-slate-400 mt-1"><strong>${Number(r.minggu_aktif_12 || 0)}</strong> minggu aktif</p></td>
            <td class="px-4 py-3">${statusHtml}<p class="text-[10px] text-slate-400 mt-1">${r.tanggal_memenuhi ? formatTanggal(r.tanggal_memenuhi) : `${Math.max(0, target - hariKelayakan)} hari lagi`}</p></td>
            <td class="px-4 py-3 text-center whitespace-nowrap"><button data-nip="${escapeAttribute(r.nip)}" onclick="bukaDetailPeringkatDariTombol(this)" class="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-primary" title="Lihat rincian"><i class="fa-solid fa-eye"></i></button><a href="seragam.html?nip=${encodeURIComponent(r.nip)}" class="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200 ml-1" title="Kelola seragam"><i class="fa-solid fa-shirt"></i></a></td>
        </tr>`;
    }).join('');
}

function gambarPaginationPeringkat(proyekFilter) {
    const pages = Math.max(1, Math.ceil(peringkatTotal / peringkatPageSize));
    if (peringkatPage > pages) return muatPeringkat(pages);
    const start = peringkatTotal ? (peringkatPage - 1) * peringkatPageSize + 1 : 0;
    const end = Math.min(peringkatPage * peringkatPageSize, peringkatTotal);
    const info = document.getElementById('infoPeringkat');
    if (info) info.textContent = `${start}-${end} dari ${peringkatTotal.toLocaleString('id-ID')} personel • ${labelFilterProyekPeringkat(proyekFilter)}`;
    const pageInfo = document.getElementById('peringkatPageInfo');
    if (pageInfo) pageInfo.textContent = `Halaman ${peringkatPage} / ${pages}`;
    const prev = document.getElementById('btnPeringkatPrev');
    const next = document.getElementById('btnPeringkatNext');
    if (prev) prev.disabled = peringkatPage <= 1;
    if (next) next.disabled = peringkatPage >= pages;
}

function gantiHalamanPeringkat(delta) {
    return muatPeringkat(peringkatPage + Number(delta || 0));
}

function formatTanggal(value) {
    if (!value) return '-';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function bukaDetailPeringkatDariTombol(button) {
    const r = peringkatRows.find(item => String(item.nip) === String(button.dataset.nip || ''));
    if (!r) return;
    document.getElementById('detailNama').textContent = r.nama || '-';
    document.getElementById('detailSub').textContent = `${r.nip || '-'} • ${labelKategori(r.kategori)} • ${labelZona(r.zona_asal)}`;
    const items = [
        ['Total hari tercatat', `${Number(r.total_hari || 0)} hari`],
        ['Jalur kelayakan', `${Number(r.hari_menuju_syarat || 0)} dari ${Number(r.target_hari || 40)} hari`],
        ['Kehadiran historis', `${Number(r.hari_historis || 0)} hari tanpa tanggal pasti`],
        ['Total sesi', `${Number(r.total_sesi || 0)} sesi`],
        ['Kehadiran 90 hari', `${Number(r.persentase_hari_90 || 0).toFixed(1)}%`],
        ['Partisipasi sesi 90 hari', `${Number(r.persentase_sesi_90 || 0).toFixed(1)}%`],
        ['Streak saat ini', `${Number(r.streak_saat_ini || 0)} hari proyek`],
        ['Streak terpanjang', `${Number(r.streak_terpanjang || 0)} hari proyek`],
        ['Hadir pertama', formatTanggal(r.hadir_pertama)],
        ['Hadir terakhir', formatTanggal(r.hadir_terakhir)],
        ['Indeks keaktifan', `${Number(r.indeks_keaktifan || 0).toFixed(1)} • ${r.tingkat_keaktifan || '-'}`],
        ['Kelayakan', r.memenuhi_syarat ? `Memenuhi sejak ${formatTanggal(r.tanggal_memenuhi)}` : 'Belum memenuhi']
    ];
    document.getElementById('detailIsi').innerHTML = items.map(([label, value]) => `<div class="rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 p-3"><p class="text-[10px] uppercase font-black text-slate-400">${escapeHTML(label)}</p><p class="font-bold mt-1">${escapeHTML(value)}</p></div>`).join('');
    document.getElementById('modalDetailPeringkat').classList.remove('hidden');
}

function tutupDetailPeringkat() {
    document.getElementById('modalDetailPeringkat')?.classList.add('hidden');
}
