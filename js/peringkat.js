// ================================================================
// PERINGKAT & REWARD PERSONEL
// ================================================================

let semuaPeringkat = [];
let kehadiranProyekPeringkat = [];

const PROYEK_KHUSUS_PERINGKAT = [
    'Perpustakaan Tashawwuf',
    "Masjid Raya Fatchan Mubiina Chaddun 'Adhiim",
    'Monumen Semboyan Sang Mursyid',
    "Kanal Ta'at",
    'Gapura Syukur'
];

document.addEventListener('DOMContentLoaded', loadPeringkat);

async function loadPeringkat() {
    const tbody = document.getElementById('tabelPeringkat');
    const errorBox = document.getElementById('peringkatError');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="p-10 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat peringkat...</td></tr>';
    if (errorBox) errorBox.classList.add('hidden');

    try {
        const [res, proyekRes] = await Promise.all([
            supabaseFetchAll('v_peringkat_personel?select=*&order=kategori.asc,memenuhi_syarat.desc,peringkat.asc.nullslast,indeks_keaktifan.desc'),
            supabaseFetchAll('v_kehadiran_proyek_personel?select=*&order=kategori.asc,nama_proyek.asc')
        ]);
        if (res.status !== 'success' || proyekRes.status !== 'success') throw new Error(res.message || proyekRes.message || 'Gagal membaca rincian peringkat');
        semuaPeringkat = Array.isArray(res.data) ? res.data : [];
        kehadiranProyekPeringkat = Array.isArray(proyekRes.data) ? proyekRes.data : [];
        siapkanFilterProyekPeringkat();
        renderKpiPeringkat();
        renderPeringkat();
    } catch (error) {
        console.error('Peringkat:', error);
        if (errorBox) {
            errorBox.textContent = 'Fitur peringkat belum dapat dibaca. Pastikan migrasi Fase 6 dan Fase 7 sudah diterapkan di database, lalu muat ulang halaman.';
            errorBox.classList.remove('hidden');
        }
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="p-10 text-center text-red-500 font-bold">Data peringkat belum tersedia.</td></tr>';
    }
}

function uniquePersonCount(rows) {
    return new Set(rows.map(r => r.nip).filter(Boolean)).size;
}

function renderKpiPeringkat() {
    const eligible = semuaPeringkat.filter(r => r.memenuhi_syarat);
    const zona4 = semuaPeringkat.filter(r => r.kategori_wilayah === 'zona_4');
    const mendekati = semuaPeringkat.filter(r => !r.memenuhi_syarat && Number(r.total_hari) >= 30 && Number(r.total_hari) < 40);
    const wilayahKosong = semuaPeringkat.filter(r => !r.kategori_wilayah || r.kategori_wilayah === 'belum_dilengkapi');

    setText('kpiPersonel', uniquePersonCount(semuaPeringkat));
    setText('kpiMemenuhi', uniquePersonCount(eligible));
    setText('kpiZona4', uniquePersonCount(zona4));
    setText('kpiMendekati', uniquePersonCount(mendekati));
    setText('kpiWilayahKosong', uniquePersonCount(wilayahKosong));
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = Number(value || 0).toLocaleString('id-ID');
}

function labelKategori(kategori) {
    return kategori === 'khususul_khusus' ? '5 Proyek Khususul Khusus' : 'Proyek Lainnya';
}

function labelWilayah(kategori) {
    return {
        jombang: 'Jombang',
        luar_jombang: 'Luar Jombang',
        zona_4: 'Zona 4',
        belum_dilengkapi: 'Belum dilengkapi'
    }[kategori] || 'Belum dilengkapi';
}

function warnaAktif(tingkat) {
    if (tingkat === 'Sangat Aktif') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
    if (tingkat === 'Aktif') return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
    if (tingkat === 'Cukup Aktif') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
    return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}

function siapkanFilterProyekPeringkat() {
    const select = document.getElementById('filterProyekPeringkat');
    const group = document.getElementById('opsiLainnyaPeringkat');
    if (!select || !group) return;
    const selected = select.value || 'semua';
    const names = [...new Set(kehadiranProyekPeringkat
        .filter(row => row.kategori === 'lainnya' && row.nama_proyek)
        .map(row => row.nama_proyek))]
        .filter(name => !PROYEK_KHUSUS_PERINGKAT.includes(name))
        .sort((a, b) => a.localeCompare(b, 'id'));
    group.innerHTML = names.map(name => `<option value="${escapeAttribute(`proyek:${name}`)}">${escapeHTML(name)}</option>`).join('');
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

function labelFilterProyekPeringkat(value) {
    if (value === 'semua') return 'Semua Proyek';
    if (value === 'khususul_khusus') return '5 Proyek Khususul Khusus';
    if (value === 'lainnya') return 'Semua Proyek Lainnya';
    return String(value || '').replace(/^proyek:/, '');
}

function cocokFilterProyekPeringkat(row, value) {
    if (!value || value === 'semua') return true;
    if (value === 'khususul_khusus' || value === 'lainnya') return row.kategori === value;
    if (!value.startsWith('proyek:')) return true;
    const namaProyek = value.slice('proyek:'.length);
    return kehadiranProyekPeringkat.some(proyek =>
        proyek.nip === row.nip && proyek.kategori === row.kategori && proyek.nama_proyek === namaProyek
    );
}

function statistikProyekPeringkat(row, value) {
    if (!value || !value.startsWith('proyek:')) return null;
    const namaProyek = value.slice('proyek:'.length);
    return kehadiranProyekPeringkat.find(proyek =>
        proyek.nip === row.nip && proyek.kategori === row.kategori && proyek.nama_proyek === namaProyek
    ) || null;
}

function renderPeringkat() {
    const tbody = document.getElementById('tabelPeringkat');
    if (!tbody) return;
    const proyekFilter = document.getElementById('filterProyekPeringkat')?.value || 'semua';
    const status = document.getElementById('filterStatusPeringkat')?.value || 'semua';
    const keyword = (document.getElementById('cariPeringkat')?.value || '').trim().toLowerCase();

    let rows = semuaPeringkat.filter(r => cocokFilterProyekPeringkat(r, proyekFilter));
    if (status === 'memenuhi') rows = rows.filter(r => r.memenuhi_syarat);
    if (status === 'belum') rows = rows.filter(r => !r.memenuhi_syarat);
    if (status === 'mendekati') rows = rows.filter(r => !r.memenuhi_syarat && Number(r.total_hari) >= 30 && Number(r.total_hari) < 40);
    if (keyword) {
        rows = rows.filter(r => [r.nama, r.nip, r.asal_organisasi, r.asal_daerah].some(v => String(v || '').toLowerCase().includes(keyword)));
    }

    rows.sort((a, b) => {
        if (Boolean(a.memenuhi_syarat) !== Boolean(b.memenuhi_syarat)) return a.memenuhi_syarat ? -1 : 1;
        if (a.memenuhi_syarat && b.memenuhi_syarat) return Number(a.peringkat || 999999) - Number(b.peringkat || 999999);
        return Number(b.total_hari || 0) - Number(a.total_hari || 0) || Number(b.indeks_keaktifan || 0) - Number(a.indeks_keaktifan || 0);
    });

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-10 text-center text-slate-400 font-bold">Tidak ada data sesuai filter.</td></tr>';
        document.getElementById('infoPeringkat').textContent = '0 personel';
        return;
    }

    tbody.innerHTML = rows.map(r => {
        const statistikProyek = statistikProyekPeringkat(r, proyekFilter);
        const target = r.kategori_wilayah === 'zona_4' ? 1 : 40;
        const progress = Math.min(100, Math.round(100 * Number(r.total_hari || 0) / target));
        const rank = r.memenuhi_syarat ? `#${Number(r.peringkat || 0)}` : '—';
        const statusHtml = r.memenuhi_syarat
            ? `<span class="inline-flex px-2 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">MEMENUHI</span>`
            : `<span class="inline-flex px-2 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">BELUM</span>`;
        const wilayahClass = r.kategori_wilayah === 'zona_4' ? 'text-violet-600 dark:text-violet-300' : (r.kategori_wilayah === 'belum_dilengkapi' ? 'text-rose-600 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300');
        return `<tr class="hover:bg-indigo-50/40 dark:hover:bg-indigo-500/5">
            <td class="px-4 py-3 text-center font-black text-lg ${r.memenuhi_syarat ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-300 dark:text-slate-600'}">${rank}</td>
            <td class="px-4 py-3"><p class="font-extrabold text-slate-800 dark:text-slate-100">${escapeHTML(r.nama)}</p><p class="text-[10px] text-slate-400 font-mono mt-0.5">${escapeHTML(r.nip)} • ${escapeHTML(r.asal_organisasi)}</p></td>
            <td class="px-4 py-3"><p class="font-bold text-xs ${wilayahClass}">${escapeHTML(labelWilayah(r.kategori_wilayah))}</p><p class="text-[10px] text-slate-400 mt-0.5">${escapeHTML(r.asal_daerah || 'Daerah belum diisi')}</p></td>
            <td class="px-4 py-3 min-w-[140px]"><div class="flex justify-between text-xs font-bold mb-1"><span>${Number(r.total_hari || 0)} hari kumulatif</span><span>${target} hari</span></div><div class="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div class="h-full ${r.memenuhi_syarat ? 'bg-emerald-500' : 'bg-indigo-500'}" style="width:${progress}%"></div></div>${statistikProyek ? `<p class="text-[10px] text-slate-400 mt-1">${Number(statistikProyek.total_hari_proyek || 0)} hari di proyek terpilih</p>` : ''}</td>
            <td class="px-4 py-3"><p class="font-black">${Number(r.total_sesi || 0)}</p><p class="text-[10px] text-slate-400">${Number(r.persentase_sesi_90 || 0).toFixed(1)}% / 90 hari</p></td>
            <td class="px-4 py-3"><p class="font-black text-lg">${Number(r.indeks_keaktifan || 0).toFixed(1)}</p><span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black ${warnaAktif(r.tingkat_keaktifan)}">${escapeHTML(r.tingkat_keaktifan)}</span></td>
            <td class="px-4 py-3 text-xs"><p><strong>${Number(r.streak_terpanjang || 0)}</strong> hari terpanjang</p><p class="text-slate-400 mt-1"><strong>${Number(r.minggu_aktif_12 || 0)}</strong> minggu aktif</p></td>
            <td class="px-4 py-3">${statusHtml}<p class="text-[10px] text-slate-400 mt-1">${r.tanggal_memenuhi ? formatTanggal(r.tanggal_memenuhi) : `${Math.max(0, 40 - Number(r.total_hari || 0))} hari lagi`}</p></td>
            <td class="px-4 py-3 text-center whitespace-nowrap"><button data-nip="${escapeAttribute(r.nip)}" data-kategori="${escapeAttribute(r.kategori)}" onclick="bukaDetailPeringkatDariTombol(this)" class="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-primary" title="Lihat rincian"><i class="fa-solid fa-eye"></i></button><a href="seragam.html?nip=${encodeURIComponent(r.nip)}" class="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200 ml-1" title="Kelola seragam"><i class="fa-solid fa-shirt"></i></a></td>
        </tr>`;
    }).join('');

    document.getElementById('infoPeringkat').textContent = `${rows.length.toLocaleString('id-ID')} personel • ${labelFilterProyekPeringkat(proyekFilter)}`;
}

function formatTanggal(value) {
    if (!value) return '-';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function bukaDetailPeringkatDariTombol(button) {
    const nip = button.dataset.nip || '';
    const kategoriBaris = button.dataset.kategori || '';
    const proyekFilter = document.getElementById('filterProyekPeringkat')?.value || 'semua';
    const r = semuaPeringkat.find(item => item.nip === nip && (!kategoriBaris || item.kategori === kategoriBaris) && cocokFilterProyekPeringkat(item, proyekFilter));
    if (!r) return;
    document.getElementById('detailNama').textContent = r.nama || '-';
    document.getElementById('detailSub').textContent = `${r.nip || '-'} • ${labelKategori(r.kategori)} • ${labelFilterProyekPeringkat(proyekFilter)}`;
    const items = [
        ['Total hari unik', `${Number(r.total_hari || 0)} hari`],
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
