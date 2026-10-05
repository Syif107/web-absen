// ==========================================
// LOGIKA EXPORT REKAP KEHADIRAN (EXCEL)
// KELOMPOKKAN PER NIP (kanonik), deteksi duplikat, % hadir
// ==========================================

const NAMA_BULAN_REKAP = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function labelBulanRekap(prefix) {
    const [y, m] = String(prefix || '').split('-');
    return `${NAMA_BULAN_REKAP[Number(m) - 1] || m} ${y}`;
}

function awalBulanRekap(prefix) {
    return `${prefix}-01`;
}

function akhirBulanRekap(prefix) {
    const [y, m] = String(prefix).split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

// ==========================================
// 1. BUKA / TUTUP MODAL
// ==========================================

function bukaModalExportRekap() {
    isiOpsiBulanRekap();
    isiOpsiLokasiRekap();
    document.getElementById('rekapSortTotal').checked = true;
    document.getElementById('modalExportRekap').classList.remove('hidden');
    document.getElementById('modalExportRekap').classList.add('flex');
    perbaruiInfoExportRekap();
}

function tutupModalExportRekap() {
    document.getElementById('modalExportRekap').classList.add('hidden');
    document.getElementById('modalExportRekap').classList.remove('flex');
}

// ==========================================
// 2. ISI PILIHAN BULAN & LOKASI
// ==========================================

function isiOpsiBulanRekap() {
    const selDari = document.getElementById('rekapBulanDari');
    const selSampai = document.getElementById('rekapBulanSampai');
    if (!selDari || !selSampai) return;

    const bulanSet = new Set();
    (allLogData || []).forEach(l => {
        if (l.tanggal && String(l.tanggal).length >= 7) {
            bulanSet.add(String(l.tanggal).slice(0, 7));
        }
    });

    const bulanList = [...bulanSet].sort();
    let html = '';
    bulanList.forEach(m => { html += `<option value="${m}">${labelBulanRekap(m)}</option>`; });

    if (!html) {
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const mFallback = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            bulanList.push(mFallback);
        }
        bulanList.forEach(m => { html += `<option value="${m}">${labelBulanRekap(m)}</option>`; });
    }

    selDari.innerHTML = html;
    selSampai.innerHTML = html;

    const defaultBulan = (typeof rekapBulan !== 'undefined' && rekapBulan)
        ? rekapBulan
        : bulanList[bulanList.length - 1] || '';
    if (defaultBulan) {
        selDari.value = defaultBulan;
        selSampai.value = defaultBulan;
    }
}

function isiOpsiLokasiRekap() {
    const sel = document.getElementById('rekapLokasi');
    if (!sel) return;

    const lokasiSet = new Set();
    (allLogData || []).forEach(l => {
        const lok = String(l.lokasi || '').trim();
        if (lok) lokasiSet.add(lok);
    });

    let html = '<option value="Semua">Semua Lokasi</option>';
    [...lokasiSet].sort((a, b) => a.localeCompare(b, 'id')).forEach(l => {
        html += `<option value="${escapeHTML(l)}">${escapeHTML(l)}</option>`;
    });
    sel.innerHTML = html;
    sel.value = 'Semua';
}

// ==========================================
// 3. PRATINJAU INFO (DARI CACHE ALL LOG/MASTER)
// ==========================================

function perbaruiInfoExportRekap() {
    const el = document.getElementById('rekapExportInfo');
    if (!el) return;

    const dari = document.getElementById('rekapBulanDari').value;
    const sampai = document.getElementById('rekapBulanSampai').value;
    const lokasi = document.getElementById('rekapLokasi').value;

    if (!dari || !sampai) {
        el.innerHTML = '<span class="text-xs font-bold text-slate-400 col-span-full">Pilih periode dulu...</span>';
        return;
    }
    if (dari > sampai) {
        el.innerHTML = '<span class="text-xs font-bold text-red-500 col-span-full"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Bulan "Dari" harus lebih awal atau sama dengan "Sampai".</span>';
        return;
    }

    const hasil = bangunRekap(
        allLogData || [],
        allMasterData || [],
        awalBulanRekap(dari),
        akhirBulanRekap(sampai),
        lokasi,
        document.querySelector('input[name="rekapSortBasis"]:checked').value
    );

    const chip = (label, nilai, warna) => `
        <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 rounded-xl p-3 flex flex-col gap-0.5">
            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">${label}</span>
            <span class="text-lg font-black ${warna} leading-none mt-1">${nilai}</span>
        </div>`;

    el.innerHTML =
        chip('Periode', `${labelBulanRekap(dari)} – ${labelBulanRekap(sampai)}`, 'text-primary') +
        chip('Lokasi', lokasi === 'Semua' ? 'Semua' : escapeHTML(lokasi), 'text-primary') +
        chip('Hari Operasional', hasil.hariOperasional, 'text-emerald-600 dark:text-emerald-400') +
        chip('Total Sesi', hasil.totalKehadiran, 'text-slate-800 dark:text-slate-100') +
        chip('Total Personel', hasil.rows.length, 'text-indigo-600 dark:text-indigo-400') +
        chip('Kandidat Duplikat', hasil.dups.length, hasil.dups.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400');
}

// ==========================================
// 4. MESIN REKAP UTAMA (MURNI, TANPA SIDE-EFFECT)
// ==========================================

function bangunRekap(logs, masters, tglAwal, tglAkhir, lokasi, sortBasis) {
    const masterByNip = new Map();
    (masters || []).forEach(m => {
        if (m.nip) masterByNip.set(String(m.nip), m);
    });

    const logsFilter = (logs || []).filter(l => {
        if (!l.tanggal) return false;
        if (String(l.tanggal) < tglAwal || String(l.tanggal) > tglAkhir) return false;
        if (lokasi !== 'Semua' && String(l.lokasi || '').trim() !== lokasi) return false;
        if (l.nip && !masterByNip.has(String(l.nip))) return false;
        return true;
    });

    const map = new Map();
    const hariOperasionalSet = new Set();

    logsFilter.forEach(l => {
        const tgl = String(l.tanggal);
        if (tgl) hariOperasionalSet.add(tgl);

        const nip = String(l.nip || '').trim();
        const kunci = nip ? `N:${nip}` : `X:${normalizeNama(l.nama || '')}`;

        let rec = map.get(kunci);
        if (!rec) {
            const master = nip ? masterByNip.get(nip) : null;
            rec = {
                kunci: kunci,
                nip: nip,
                nama: master ? master.nama : (l.nama || '').trim(),
                org: master ? (master.asal_organisasi || '') : (l.organisasi || ''),
                bidang: master ? (master.jabatan || '') : (l.bidang || ''),
                daerah: master ? (master.kabupaten_normalisasi || master.asal_daerah || '') : '',
                zona: master ? (master.zona_label || window.RelawanDomain?.labelZona(master.zona_asal) || '') : '',
                jenis: master ? (master.jenis_personel_label || 'Reguler') : 'Belum terhubung',
                total: 0,
                hariSet: new Set()
            };
            map.set(kunci, rec);
        }
        rec.total += 1;
        if (tgl) rec.hariSet.add(tgl);
    });

    const hariOperasional = hariOperasionalSet.size;

    let rows = [...map.values()].map(r => ({
        nama: r.nama || '-',
        nip: r.nip,
        org: r.org || '-',
        bidang: r.bidang || 'Helper',
        daerah: r.daerah || '-',
        zona: r.zona || 'Zona belum diisi',
        jenis: r.jenis || 'Reguler',
        total: r.total,
        hariHadir: r.hariSet.size,
        persen: hariOperasional > 0 ? Number(((r.hariSet.size / hariOperasional) * 100).toFixed(1)) : 0
    }));

    rows.sort((a, b) => {
        const samaNama = String(a.nama).localeCompare(String(b.nama), 'id');
        if (sortBasis === 'persen') {
            return (b.persen - a.persen) || (b.total - a.total) || samaNama;
        }
        return (b.total - a.total) || (b.persen - a.persen) || samaNama;
    });

    const dups = deteksiDuplikatRekap(rows);
    const totalKehadiran = rows.reduce((s, r) => s + r.total, 0);

    return { rows: rows, dups: dups, hariOperasional: hariOperasional, totalKehadiran: totalKehadiran };
}

// ==========================================
// 5. DETEKSI KANDIDAT DUPLIKAT (HANYA FLAG, TIDAK MERGE)
//     Amankah untuk kasus 2 "Yanto" beda NIP di DPD/tim sama:
//     yang berbeda NIP DIANGGAP orang berbeda, hanya ditandai.
// ==========================================

function deteksiDuplikatRekap(rows) {
    const dups = [];
    const byNorm = new Map();

    rows.forEach(r => {
        const n = normalizeNama(r.nama);
        if (!n) return;
        if (!byNorm.has(n)) byNorm.set(n, []);
        byNorm.get(n).push(r);
    });

    // a) Nama ternormalisasi IDENTIK tapi NIP beda
    byNorm.forEach((list) => {
        const nipSet = new Set(list.map(r => r.nip || ''));
        if (nipSet.size < 2) return;
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                if (a.nip && b.nip && a.nip === b.nip) continue;
                dups.push({ a: a, b: b, ket: 'Nama identik, NIP berbeda' });
            }
        }
    });

    // b) Nama MIRIP (>= 90%) di bucket org + huruf awal yang sama, NIP beda
    //    Dibatasi ukuran bucket agar tidak membebani kalkulasi.
    const bucketMap = new Map();
    rows.forEach(r => {
        const n = normalizeNama(r.nama);
        if (!n) return;
        const kunci = `${normalizeNama(r.org)}|${n.charAt(0)}`;
        if (!bucketMap.has(kunci)) bucketMap.set(kunci, []);
        bucketMap.get(kunci).push(r);
    });

    bucketMap.forEach((list) => {
        if (list.length < 2 || list.length > 80) return;
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                if (a.nip && b.nip && a.nip === b.nip) continue;
                const nA = normalizeNama(a.nama), nB = normalizeNama(b.nama);
                if (!nA || !nB || nA === nB) continue;
                const sim = similarityRasio(nA, nB);
                if (sim >= 0.9) {
                    dups.push({ a: a, b: b, ket: `Nama mirip (${Math.round(sim * 100)}%)` });
                }
            }
        }
    });

    // Hapus pasangan duplikat yang berulang (urutan tak tentu)
    const seen = new Set();
    return dups.filter(d => {
        const key = [d.a.kunci, d.b.kunci].sort().join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ==========================================
// 6. EXPORT KE EXCEL (.XLSX)
// ==========================================

async function exportRekapExcel() {
    const dari = document.getElementById('rekapBulanDari').value;
    const sampai = document.getElementById('rekapBulanSampai').value;
    const lokasi = document.getElementById('rekapLokasi').value;
    const sortBasis = document.querySelector('input[name="rekapSortBasis"]:checked').value;

    if (!dari || !sampai) { showToast("Pilih periode bulan dulu.", "error"); return; }
    if (dari > sampai) { showToast("Bulan 'Dari' harus lebih awal atau sama dengan 'Sampai'.", "error"); return; }
    if (typeof XLSX === 'undefined') { showToast("Lib Excel belum dimuat, coba muat ulang halaman.", "error"); return; }

    const tglAwal = awalBulanRekap(dari);
    const tglAkhir = akhirBulanRekap(sampai);

    let queryLokasi = '';
    if (lokasi !== 'Semua') queryLokasi = `&lokasi=eq.${encodeURIComponent(lokasi)}`;

    const btn = document.getElementById('btnExportRekapExec');
    const teksAsli = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyusun...';
    btn.disabled = true;

    try {
        let urlLog = `v_log_absensi_operasional?select=*&terhubung=eq.true&order=nama.asc,id.asc&tanggal=gte.${tglAwal}&tanggal=lte.${tglAkhir}${queryLokasi}`;
        urlLog = await terapkanFilterLokasi(urlLog);

        const [logRes, masterRes] = await Promise.all([
            supabaseFetchAll(urlLog),
            supabaseFetchAll('v_personel_terpadu_v3?select=nip,nama,jabatan,asal_organisasi,kabupaten_normalisasi,asal_daerah,zona_asal,zona_label,kategori_personel,jenis_personel_label&kategori_personel=eq.reguler&order=nip.asc')
        ]);

        if (logRes.status !== "success" || masterRes.status !== "success") {
            throw new Error("Gagal mengambil data dari server.");
        }

        const hasil = bangunRekap(logRes.data || [], masterRes.data || [], tglAwal, tglAkhir, lokasi, sortBasis);

        if (hasil.rows.length === 0) {
            showToast("Tidak ada data pada periode & lokasi tersebut.", "error");
            return;
        }

        const wb = susunWorkbookRekap(hasil, {
            dari: dari, sampai: sampai, lokasi: lokasi,
            sortBasisLabel: sortBasis === 'persen' ? '% Hari Hadir' : 'Total Sesi'
        });

        const labelLokasi = lokasi === 'Semua' ? 'SemuaLokasi' : lokasi.replace(/[^A-Za-z0-9_\-]+/g, '_');
        const namaFile = `Rekap_Kehadiran_${labelLokasi}_${dari}sd${sampai}.xlsx`;
        XLSX.writeFile(wb, namaFile);

        const pesanDup = hasil.dups.length > 0 ? ` (${hasil.dups.length} kandidat duplikat ditandai)` : '';
        showToast(`Rekap ${hasil.rows.length} relawan diunduh!${pesanDup}`, "success");
        tutupModalExportRekap();
    } catch (err) {
        console.error("Export Rekap Error:", err);
        showToast("Gagal menyusun rekap.", "error");
    } finally {
        btn.innerHTML = teksAsli;
        btn.disabled = false;
    }
}

// ==========================================
// 7. SUSUN WORKBOOK (.XLSX)
// ==========================================

function susunWorkbookRekap(hasil, meta) {
    const namaBulanAwal = labelBulanRekap(meta.dari);
    const namaBulanAkhir = labelBulanRekap(meta.sampai);

    const aoaMeta = [
        ['LAPORAN REKAPITULASI KEHADIRAN RELAWAN'],
        [],
        ['Periode', `${namaBulanAwal} – ${namaBulanAkhir}`],
        ['Lokasi Proyek', meta.lokasi],
        ['Dasar Peringkat', meta.sortBasisLabel],
        ['Hari Operasional', hasil.hariOperasional],
        ['Total Sesi Kehadiran', hasil.totalKehadiran],
        ['Total Personel', hasil.rows.length],
        ['Tanggal Cetak', new Date().toLocaleString('id-ID')],
        [],
        ['No', 'Nama Personel', 'Asal Organisasi', 'Bidang Utama', 'Kabupaten/Kota', 'Zona', 'Jenis', 'Total Sesi', 'Hari Hadir', '% Hari Hadir']
    ];

    const aoaData = hasil.rows.map((r, i) => [
        { t: 'n', v: i + 1 },
        { t: 's', v: r.nama },
        { t: 's', v: r.org },
        { t: 's', v: r.bidang },
        { t: 's', v: r.daerah },
        { t: 's', v: r.zona },
        { t: 's', v: r.jenis },
        { t: 'n', v: r.total },
        { t: 'n', v: r.hariHadir },
        { t: 'n', v: r.persen }
    ]);

    const ws = XLSX.utils.aoa_to_sheet([...aoaMeta, ...aoaData]);

    ws['!cols'] = [
        { wch: 5 }, { wch: 32 }, { wch: 28 }, { wch: 26 }, { wch: 24 }, { wch: 30 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 10 }
    ];

    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rekap Kehadiran');

    if (hasil.dups.length > 0) {
        const aoaDup = [
            ['KANDIDAT DUPLIKAT (TIDAK DIGABUNG OTOMATIS)'],
            [],
            ['No', 'Nama A', 'NIP A', 'Nama B', 'NIP B', 'Organisasi', 'Total A', 'Total B', 'Keterangan']
        ];
        hasil.dups.forEach((d, i) => {
            aoaDup.push([
                { t: 'n', v: i + 1 },
                { t: 's', v: d.a.nama }, { t: 's', v: d.a.nip || '-' },
                { t: 's', v: d.b.nama }, { t: 's', v: d.b.nip || '-' },
                { t: 's', v: d.a.org || d.b.org || '-' },
                { t: 'n', v: d.a.total }, { t: 'n', v: d.b.total },
                { t: 's', v: d.ket }
            ]);
        });
        const wsDup = XLSX.utils.aoa_to_sheet(aoaDup);
        wsDup['!cols'] = [
            { wch: 5 }, { wch: 28 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 24 }, { wch: 9 }, { wch: 9 }, { wch: 32 }
        ];
        wsDup['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
        XLSX.utils.book_append_sheet(wb, wsDup, 'Kandidat Duplikat');
    }

    return wb;
}
