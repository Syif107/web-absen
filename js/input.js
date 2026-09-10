// ==========================================
// LOGIKA SMART PARSER & BULK INPUT ABSENSI
// FASE 1: PASTE PINTAR + DETEKSI TYPO/DUPLIKAT + TEMPLATE
// ==========================================

let masterDataCache = [];
let knownOrgs = new Set();
let knownBidangs = new Set();

// Set nama (ternormalisasi) yang sudah absen pada tanggal+sesi ini (dari DB & dari input)
let logHariIniSet = new Set();
let logHariIniTanggal = null;

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('inputTanggal').valueAsDate = new Date();
    muatDaftarPreset();
    muatPengaturanGelar();
    pulihkanDraft();
    loadMasterDataUntukStaging().then(() => {
        if (perluPulihkanPreview) generateStagingGrid();
    });
});

// ==========================================
// 0. DRAFT: AUTO-SAVE KE localStorage (tidak hilang saat pindah halaman)
// ==========================================

const DRAFT_KEY = 'relawan_draft';
const PERTAHANKAN_GELAR_KEY = 'relawan_pertahankan_gelar';
let perluPulihkanPreview = false;

function getPertahankanGelar() {
    try {
        return localStorage.getItem(PERTAHANKAN_GELAR_KEY) !== '0';
    } catch (e) {
        return true;
    }
}

function ubahPengaturanGelar() {
    const cek = elById('pertahankanGelar');
    const nilai = cek && cek.checked ? '1' : '0';
    try {
        localStorage.setItem(PERTAHANKAN_GELAR_KEY, nilai);
    } catch (e) { }
    // Bila pratinjau sedang terbuka, parse ulang agar status sesuai
    if (elById('step-review') && !elById('step-review').classList.contains('hidden') && elById('daftarNama').value.trim()) {
        generateStagingGrid();
    }
}

function muatPengaturanGelar() {
    const cek = elById('pertahankanGelar');
    if (cek) cek.checked = getPertahankanGelar();
}

function elById(id) {
    return document.getElementById(id);
}

function simpanDraft() {
    const text = elById('daftarNama') ? elById('daftarNama').value : '';
    const draft = {
        text: text,
        tanggal: elById('inputTanggal') ? elById('inputTanggal').value : '',
        sesi: elById('inputSesi') ? elById('inputSesi').value : '',
        lokasi: elById('inputLokasi') ? elById('inputLokasi').value : '',
        lokasiCustom: elById('inputLokasiCustom') ? elById('inputLokasiCustom').value : '',
        org: elById('inputOrgDefault') ? elById('inputOrgDefault').value : '',
        view: elById('step-review') ? (elById('step-review').classList.contains('hidden') ? 'paste' : 'review') : 'paste',
        waktu: Date.now()
    };
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) { /* localStorage penuh / private mode */ }
}

function pulihkanDraft() {
    let draft = null;
    try {
        draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch (e) {
        draft = null;
    }
    if (!draft) return;

    const setVal = (id, v) => {
        const el = elById(id);
        if (el && v) el.value = v;
    };
    setVal('daftarNama', draft.text);
    setVal('inputTanggal', draft.tanggal);
    setVal('inputSesi', draft.sesi);
    setVal('inputLokasiCustom', draft.lokasiCustom);
    setVal('inputOrgDefault', draft.org);

    // Pastikan lokasi ada di dropdown (termasuk lokasi custom dari template)
    const lok = elById('inputLokasi');
    if (lok && draft.lokasi) {
        if (!Array.from(lok.options).some(o => o.value === draft.lokasi)) {
            const opt = document.createElement('option');
            opt.value = draft.lokasi;
            opt.textContent = draft.lokasi;
            lok.appendChild(opt);
        }
        lok.value = draft.lokasi;
    }

    const custom = elById('inputLokasiCustom');
    if (custom && lok && lok.value === 'Lainnya') custom.classList.remove('hidden');

    perluPulihkanPreview = draft.view === 'review' && !!draft.text;
}

function hapusDraft() {
    try {
        localStorage.removeItem(DRAFT_KEY);
    } catch (e) { }
    perluPulihkanPreview = false;
}

// ==========================================
// 1. DATA MASTER: CACHE + DATALIST
// ==========================================

async function loadMasterDataUntukStaging() {
    try {
        const res = await supabaseFetch('master_relawan?select=nip,nama,jabatan,asal_organisasi', 'GET');
        if (res.status === "success") {
            masterDataCache = res.data;
            bangunSetDikenal();
            populateDatalists();
        } else {
            showToast("Gagal memuat data master.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

function bangunSetDikenal() {
    knownOrgs.clear();
    knownBidangs.clear();
    masterDataCache.forEach(r => {
        if (r.asal_organisasi) knownOrgs.add(normalizeNama(r.asal_organisasi));
        if (r.jabatan) knownBidangs.add(normalizeNama(r.jabatan));
    });
}

function populateDatalists() {
    const orgSet = new Set();
    const bidangSet = new Set();

    masterDataCache.forEach(r => {
        if (r.asal_organisasi && r.asal_organisasi !== '-') orgSet.add(r.asal_organisasi);
        if (r.jabatan && r.jabatan !== '-') bidangSet.add(r.jabatan);
    });

    let orgHtml = '';
    Array.from(orgSet).sort().forEach(org => orgHtml += `<option value="${org}">`);
    document.getElementById('listOrgData').innerHTML = orgHtml;

    let bidangHtml = '';
    Array.from(bidangSet).sort().forEach(b => bidangHtml += `<option value="${b}">`);
    document.getElementById('listBidangData').innerHTML = bidangHtml;
}

// ==========================================
// 2. UTILITAS NORMALISASI & FUZZY MATCH
// ==========================================

function normalizeNama(s) {
    return String(s || '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function bersihkanTitel(s) {
    let t = String(s || '').trim();
    const titel = ['BAPAK', 'PAK', 'IBU', 'BU', 'SDR', 'SDRI', 'SAUDARA', 'SAUDARI', 'H.', 'HJ.', 'A.N.'];
    for (const k of titel) {
        if (t.startsWith(k + ' ')) {
            t = t.slice(k.length).trim();
        }
    }
    return t;
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    if (Math.abs(m - n) > 6) return Math.max(m, n);
    const dp = [];
    for (let i = 0; i <= m; i++) dp.push([i]);
    for (let j = 1; j <= n; j++) dp[0].push(j);
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function similarityRasio(a, b) {
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

// Cari cocokkan paling mirip di Master (sinkron, pakai cache)
function cariPencocok(kata) {
    let exact = null;
    let mirip = null;
    let bestScore = 0;
    for (const r of masterDataCache) {
        const n = normalizeNama(r.nama);
        if (!n) continue;
        if (n === kata) {
            exact = { nama: r.nama, nip: r.nip, jabatan: r.jabatan, org: r.asal_organisasi, score: 1 };
            mirip = exact;
            bestScore = 1;
            break;
        }
        const sc = similarityRasio(kata, n);
        if (sc > bestScore && sc >= 0.6) {
            bestScore = sc;
            mirip = { nama: r.nama, nip: r.nip, jabatan: r.jabatan, org: r.asal_organisasi, score: sc };
        }
    }
    return { exact: exact, mirip: mirip, bestScore: bestScore };
}

function buatNipSementara(nama) {
    return `REL-${normalizeNama(nama).replace(/\s+/g, '').substring(0, 10)}${Math.floor(1000 + Math.random() * 9000)}`;
}

// ==========================================
// 3. MENGAMBIL LOG HARI INI (untuk deteksi duplikat)
// ==========================================

async function muatLogHariIni(tanggal) {
    if (logHariIniTanggal === tanggal) return;
    logHariIniSet = new Set();
    logHariIniTanggal = tanggal;
    if (!tanggal) return;
    try {
        const res = await supabaseFetch(await terapkanFilterLokasi(`log_absensi?select=nama,sesi&tanggal=eq.${tanggal}`), 'GET');
        if (res.status === "success") {
            res.data.forEach(r => {
                if (r.nama) logHariIniSet.add(normalizeNama(r.nama) + '|' + (r.sesi || ''));
            });
        }
    } catch (e) { /* non-fatal: lanjut tanpa deteksi duplikat */ }
}

// ==========================================
// 4. SMART PARSER SATU BARIS (WA / EXCEL)
// ==========================================

function ekstrakBaris(line) {
    let s = String(line || '');
    s = s.replace(/^\*{1,2}[^*]*\*{1,2}\s*/, '');  // header bold semacam "📋 ABSENSI"
    s = s.replace(/\*/g, ' ');
    s = s.replace(/^\d{1,2}[:\.]\d{2}\s*/, '');      // awalan jam "10:32"
    s = s.replace(/^(\d+[\.\-\)]\s*|[\-\u2022\u00B7\*]\s*)+/, ''); // nomor/bullet
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return null;

    let nama = "", bidang = "", org = "";

    const paren = s.match(/^(.*?)[\(\[（](.+?)[\)\]）]$/);
    if (paren) {
        nama = paren[1].trim();
        org = paren[2].trim();
    } else {
        let cols;
        if (s.includes('\t')) {
            cols = s.split('\t').map(c => c.trim()).filter(Boolean);
        } else if (/\s{2,}/.test(s)) {
            cols = s.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
        } else if (/[-,\/;\|]/.test(s)) {
            cols = s.split(/[-,\/;\|]/).map(c => c.trim()).filter(Boolean);
        } else {
            cols = [s];
        }

        if (cols.length >= 3) {
            nama = cols[0]; bidang = cols[1]; org = cols[2];
        } else if (cols.length === 2) {
            nama = cols[0];
            if (knownOrgs.has(normalizeNama(cols[1]))) org = cols[1];
            else bidang = cols[1];
        } else {
            nama = cols[0];
        }
    }

    const namaKotor = nama.toUpperCase().replace(/\s+/g, ' ').trim();
    const displayNama = getPertahankanGelar() ? namaKotor : bersihkanTitel(namaKotor);
    if (!displayNama) return null;

    return { nama: displayNama, kata: normalizeNama(displayNama), bidang: bidang, org: org };
}

// ==========================================
// 4b. PENGENAL BARIS META FORMAT WA ADMIN (ABSENSI)
//     LeWATkan: kalimat sakral, *ABSENSI (loKASI)*, Hari/Tgl, Nama PJ
//     Tangkap:  Waktu : Siang / Malam  -> sesi
// ==========================================

function klasifikasiGarisWA(line) {
    const up = String(line || '').trim().toUpperCase();
    if (!up) return { tipe: 'skip' };

    if (up.includes('ATAS BERKAT')) return { tipe: 'skip' };
    if (up.startsWith('ABSENSI') || up.startsWith('*ABSENSI')) return { tipe: 'skip' };
    if (/^HARI\s*:/.test(up)) return { tipe: 'skip' };
    if (up.includes('TGL') || up.includes('TANGGAL')) return { tipe: 'skip' };
    if (/^NAMA\s+PJ\s*:/.test(up) || up.startsWith('NAMA PJ')) return { tipe: 'skip' };
    if (/^NAMA\s*[\/\-|\u00B7]\s*BIDANG/.test(up)) return { tipe: 'skip' };
    if (/^NAMA\/BIDANG/.test(up)) return { tipe: 'skip' };

    const mWaktu = up.match(/^WAKTU\s*:\s*(\S+)/);
    if (mWaktu) {
        const k = mWaktu[1].toUpperCase();
        const sesi = k.startsWith('SIA') ? 'Siang' : k.startsWith('MAL') ? 'Malam' : mWaktu[1];
        return { tipe: 'sesi', sesi: sesi };
    }

    return null;
}

// ==========================================
// 5. GENERATE STAGING GRID + STATUS
// ==========================================

async function generateStagingGrid() {
    const globalOrg = document.getElementById('inputOrgDefault').value;
    const rawText = document.getElementById('daftarNama').value;
    const lines = rawText.split('\n');

    const barisValid = [];
    let sesiTerdeteksi = null;
    lines.forEach(l => {
        const meta = klasifikasiGarisWA(l);
        if (meta && meta.tipe === 'skip') return;
        if (meta && meta.tipe === 'sesi') {
            sesiTerdeteksi = meta.sesi;
            return;
        }
        const p = ekstrakBaris(l);
        if (p) barisValid.push(p);
    });

    if (sesiTerdeteksi) {
        const elSesi = document.getElementById('inputSesi');
        if (elSesi && elSesi.value !== sesiTerdeteksi) {
            elSesi.value = sesiTerdeteksi;
            showToast(`Sesi otomatis disesuaikan: ${sesiTerdeteksi}.`, "info");
        }
    }

    if (barisValid.length === 0) {
        showToast("Teks data masih kosong / tidak dapat dibaca!", "error");
        return;
    }

    const tanggal = document.getElementById('inputTanggal').value;
    const sesi = document.getElementById('inputSesi').value;

    await muatLogHariIni(tanggal);

    const tbody = document.getElementById('stagingBody');
    const dilihat = new Set();
    let htmlBuffer = '';

    barisValid.forEach((p, idx) => {
        const kata = p.kata;
        const match = cariPencocok(kata);

        let statusMode, matchedNip, isNew;
        let namaRender = p.nama;
        let bidangFinal, orgFinal;

        if (match.exact) {
            statusMode = 'exact';
            isNew = false;
            matchedNip = match.exact.nip;
            namaRender = match.exact.nama;
            bidangFinal = p.bidang || match.exact.jabatan || 'Helper';
            orgFinal = p.org || match.exact.org || globalOrg || 'Umum';
        } else if (match.mirip) {
            statusMode = 'typo';
            isNew = true;
            matchedNip = buatNipSementara(p.nama);
            bidangFinal = p.bidang || match.mirip.jabatan || 'Helper';
            orgFinal = p.org || globalOrg || 'Umum';
        } else {
            statusMode = 'baru';
            isNew = true;
            matchedNip = buatNipSementara(p.nama);
            bidangFinal = p.bidang || 'Helper';
            orgFinal = p.org || globalOrg || 'Umum';
        }

        const dupDb = logHariIniSet.has(kata + '|' + sesi);
        const dupInput = dilihat.has(kata);
        dilihat.add(kata);

        const flag = dupDb ? 'dupdb' : dupInput ? 'dupinput' : 'none';

        htmlBuffer += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                data-idx="${idx}" data-nip="${escapeHTML(matchedNip)}"
                data-isnew="${isNew}" data-status="${statusMode}" data-flag="${flag}">
                <td class="px-4 py-2 text-center font-bold text-slate-400 bg-slate-50 dark:bg-slate-700/40 border-r border-slate-100 dark:border-slate-700/50">${idx + 1}</td>
                <td class="px-4 py-2">
                    <input type="text" id="nama-${idx}" value="${escapeHTML(namaRender)}" oninput="revalBaris(${idx})"
                        class="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-sm font-bold text-primary outline-none uppercase focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">
                </td>
                <td class="px-4 py-2">
                    <input list="listBidangData" id="bidang-${idx}" value="${escapeHTML(bidangFinal)}" placeholder="Ketik/Pilih Bidang..."
                        class="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">
                </td>
                <td class="px-4 py-2">
                    <input list="listOrgData" id="org-${idx}" value="${escapeHTML(orgFinal)}" placeholder="Ketik/Pilih Organisasi..."
                        class="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">
                </td>
                <td class="px-4 py-2">${statusCellHtml(statusMode, dupDb, dupInput, match.mirip)}</td>
                <td class="px-4 py-2 text-center">
                    <button type="button" onclick="hapusBarisStaging(this)" title="Hapus baris"
                        class="text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 w-8 h-8 rounded-lg transition-colors flex items-center justify-center mx-auto">
                        <i class="fa-solid fa-trash-can text-sm"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = htmlBuffer;
    hitungRingkasan();
    document.getElementById('step-paste').classList.add('hidden');
    document.getElementById('step-review').classList.remove('hidden');
    simpanDraft();
}

function statusCellHtml(statusMode, dupDb, dupInput, mirip) {
    const pill = (txt, colorCls) =>
        `<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border whitespace-nowrap ${colorCls}">${txt}</span>`;

    let list = '';
    if (dupDb) list += pill('<i class="fa-solid fa-triangle-exclamation"></i> Sudah Absen', 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20');
    else if (dupInput) list += pill('<i class="fa-solid fa-triangle-exclamation"></i> Duplikat Input', 'bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 border-orange-200 dark:border-orange-500/20');

    if (statusMode === 'exact') {
        list += pill('<i class="fa-solid fa-user-check"></i> Terdaftar', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20');
    } else if (statusMode === 'typo') {
        list += pill('<i class="fa-solid fa-circle-question"></i> Mirip Master', 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20');
        list += `<button type="button" onclick="terapkanSaranNama(this)"
            data-saran="${escapeHTML(mirip.nama)}" data-nip="${escapeHTML(mirip.nip)}"
            data-bidang="${escapeHTML(mirip.jabatan || 'Helper')}" data-org="${escapeHTML(mirip.org || '')}"
            class="mt-1 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20 border-indigo-200 dark:border-indigo-500/20 whitespace-nowrap transition-colors">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Perbaiki</button>`;
    } else {
        list += pill('<i class="fa-solid fa-user-plus"></i> Relawan Baru', 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-500/20');
    }
    return list;
}

// ==========================================
// 6. AKSI BARIS: PERBAIKI NAMA / HAPUS / RE-EVALUASI
// ==========================================

function terapkanSaranNama(btn) {
    const tr = btn.closest('tr');
    const idx = tr.getAttribute('data-idx');
    const namaInput = document.getElementById('nama-' + idx);
    if (!namaInput) return;

    namaInput.value = btn.dataset.saran || namaInput.value;
    if (btn.dataset.bidang) {
        const bid = document.getElementById('bidang-' + idx);
        if (bid && !triadImplicit(bid.value)) bid.value = btn.dataset.bidang;
    }
    if (btn.dataset.org) {
        const org = document.getElementById('org-' + idx);
        if (org && !org.value) org.value = btn.dataset.org;
    }

    tr.setAttribute('data-nip', btn.dataset.nip || tr.getAttribute('data-nip'));
    tr.setAttribute('data-isnew', 'false');
    tr.setAttribute('data-status', 'exact');

    const statusTd = tr.querySelectorAll('td')[4];
    if (statusTd) statusTd.innerHTML = statusCellHtml('exact', false, false, null);
    hitungRingkasan();
    showToast(`Nama diperbaiki menjadi "${btn.dataset.saran}"`, "success");
}

function triadImplicit(v) {
    return String(v || '').trim() !== '';
}

function hapusBarisStaging(btn) {
    const tr = btn.closest('tr');
    if (tr) tr.remove();
    hitungRingkasan();
}

// Re-evaluasi status baris saat admin mengubah nama secara manual
function revalBaris(idx) {
    const namaInput = document.getElementById('nama-' + idx);
    if (!namaInput) return;
    const tr = namaInput.closest('tr');
    if (!tr) return;
    const kata = normalizeNama(namaInput.value);
    if (!kata) return;

    const match = cariPencocok(kata);
    const sesi = document.getElementById('inputSesi').value;
    const dupDb = logHariIniSet.has(kata + '|' + sesi);

    let statusMode, isNew, nip;
    if (match.exact) {
        statusMode = 'exact';
        isNew = false;
        nip = match.exact.nip;
    } else if (match.mirip) {
        statusMode = 'typo';
        isNew = true;
        nip = tr.getAttribute('data-nip') || buatNipSementara(namaInput.value);
    } else {
        statusMode = 'baru';
        isNew = true;
        nip = tr.getAttribute('data-nip') || buatNipSementara(namaInput.value);
    }

    tr.setAttribute('data-status', statusMode);
    tr.setAttribute('data-isnew', isNew ? 'true' : 'false');
    tr.setAttribute('data-nip', nip);
    tr.setAttribute('data-flag', dupDb ? 'dupdb' : 'none');

    const statusTd = tr.querySelectorAll('td')[4];
    if (statusTd) statusTd.innerHTML = statusCellHtml(statusMode, dupDb, false, match.mirip);
    hitungRingkasan();
}

function hitungRingkasan() {
    const el = document.getElementById('stagingSummary');
    if (!el) return;
    const rows = document.querySelectorAll('#stagingBody tr');
    let total = 0, exact = 0, typo = 0, baru = 0, duplikat = 0;
    rows.forEach(tr => {
        const st = tr.getAttribute('data-status');
        const fl = tr.getAttribute('data-flag');
        if (fl && fl !== 'none') duplikat++;
        if (st === 'exact') exact++;
        else if (st === 'typo') typo++;
        else if (st === 'baru') baru++;
        total++;
    });

    const chip = (txt, colorCls, icon) =>
        `<span class="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border ${colorCls}"><i class="fa-solid ${icon}"></i> ${txt}</span>`;

    let html = chip(`Total: ${total} baris`, 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 border-slate-200 dark:border-slate-600', 'fa-list');
    html += chip(`Terdaftar: ${exact}`, 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20', 'fa-user-check');
    if (typo > 0) html += chip(`Perlu dicek: ${typo}`, 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20', 'fa-circle-question');
    html += chip(`Baru: ${baru}`, 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-500/20', 'fa-user-plus');
    if (duplikat > 0) html += chip(`Duplikat: ${duplikat}`, 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20', 'fa-triangle-exclamation');
    el.innerHTML = html;
}

// ==========================================
// 7. TEMPLATE PRESET & ULANG BATCH KEMARIN
// ==========================================

function getLokasiTerpilih() {
    const dropdown = document.getElementById('inputLokasi');
    const custom = document.getElementById('inputLokasiCustom');
    if (dropdown.value === 'Lainnya') return (custom.value || '').trim();
    return dropdown.value;
}

function simpanPreset() {
    const sesi = document.getElementById('inputSesi').value;
    const lokasi = getLokasiTerpilih();
    const org = document.getElementById('inputOrgDefault').value.trim();

    if (lokasi === '') {
        showToast("Pilih atau ketik lokasi proyek dulu.", "error");
        return;
    }

    const judul = prompt("Nama template (misal: Sesi Siang Monumen):", `${lokasi} - ${sesi}`);
    if (!judul) return;

    const presets = getPresets();
    presets.push({ id: Date.now().toString(), judul: judul.trim(), sesi: sesi, lokasi: lokasi, org: org });
    localStorage.setItem('relawan_input_presets', JSON.stringify(presets));
    muatDaftarPreset();
    showToast("Template berhasil disimpan!", "success");
}

function getPresets() {
    try {
        return JSON.parse(localStorage.getItem('relawan_input_presets') || '[]');
    } catch (e) {
        return [];
    }
}

function muatDaftarPreset() {
    const sel = document.getElementById('presetList');
    if (!sel) return;
    const presets = getPresets();
    if (presets.length === 0) {
        sel.innerHTML = `<option value="">Belum ada template</option>`;
        return;
    }
    sel.innerHTML = presets.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.judul)}</option>`).join('');
}

function terapkanPreset() {
    const sel = document.getElementById('presetList');
    const preset = getPresets().find(p => p.id === sel.value);
    if (!preset) {
        showToast("Pilih template terlebih dahulu.", "error");
        return;
    }
    document.getElementById('inputSesi').value = preset.sesi;
    document.getElementById('inputOrgDefault').value = preset.org || '';

    const dropdown = document.getElementById('inputLokasi');
    const custom = document.getElementById('inputLokasiCustom');
    const sudahAda = Array.from(dropdown.options).some(o => o.value === preset.lokasi);

    if (sudahAda) {
        dropdown.value = preset.lokasi;
        custom.classList.add('hidden');
        custom.value = '';
    } else {
        const opt = document.createElement('option');
        opt.value = preset.lokasi;
        opt.textContent = preset.lokasi;
        dropdown.appendChild(opt);
        dropdown.value = preset.lokasi;
        custom.classList.add('hidden');
        custom.value = '';
    }
    showToast(`Template "${preset.judul}" diterapkan.`, "success");
    simpanDraft();
}

async function ulangBatchKemarin() {
    const tanggal = document.getElementById('inputTanggal').value;
    const sesi = document.getElementById('inputSesi').value;

    if (!tanggal) {
        showToast("Isi tanggal dulu.", "error");
        return;
    }

    const kemarin = new Date(tanggal + 'T00:00:00');
    kemarin.setDate(kemarin.getDate() - 1);
    const yyyy = kemarin.getFullYear();
    const mm = String(kemarin.getMonth() + 1).padStart(2, '0');
    const dd = String(kemarin.getDate()).padStart(2, '0');
    const tglKemarin = `${yyyy}-${mm}-${dd}`;

    const btn = event && event.target ? event.target.closest('button') : null;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ambil data...';
    }

    try {
        const res = await supabaseFetch(await terapkanFilterLokasi(`log_absensi?select=nama&tanggal=eq.${tglKemarin}&sesi=eq.${sesi}&order=nama.asc`), 'GET');
        if (res.status !== "success" || !Array.isArray(res.data) || res.data.length === 0) {
            showToast(`Tidak ada data absensi kemarin (${tglKemarin}, sesi ${sesi}).`, "error");
            return;
        }

        const namaList = res.data
            .map(r => (r.nama || '').toUpperCase().trim())
            .filter((v, i, arr) => v !== '' && arr.indexOf(v) === i);
        document.getElementById('daftarNama').value = namaList.join('\n');
        simpanDraft();

        showToast(`${namaList.length} nama dari batch kemarin dimuat. Klik "Pratinjau" bila perlu.`, "success");
        generateStagingGrid();
    } catch (err) {
        showToast("Gagal mengambil data kemarin.", "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Ulang Batch Kemarin';
        }
    }
}

// ==========================================
// 8. EKSEKUSI MASSAL + VALIDASI SEBELUM SIMPAN
// ==========================================

function toggleCustomLokasi() {
    const dropdown = document.getElementById('inputLokasi');
    const custom = document.getElementById('inputLokasiCustom');
    if (!custom) return;
    const isCustom = dropdown.value === 'Lainnya';
    custom.classList.toggle('hidden', !isCustom);
    if (isCustom) custom.focus();
}

function cancelStaging() {
    document.getElementById('step-review').classList.add('hidden');
    document.getElementById('step-paste').classList.remove('hidden');
    simpanDraft();
}

async function submitDataToServer() {
    const inputTanggal = document.getElementById('inputTanggal').value;
    const globalSesi = document.getElementById('inputSesi').value;

    const dropdownLokasi = document.getElementById('inputLokasi').value;
    const customLokasi = document.getElementById('inputLokasiCustom').value.trim();

    if (dropdownLokasi === 'Lainnya' && customLokasi === '') {
        showToast("Tuliskan spesifik lokasi proyeknya jika memilih 'Lainnya'!", "error");
        document.getElementById('inputLokasiCustom').focus();
        return;
    }

    const globalLokasi = (dropdownLokasi === 'Lainnya') ? customLokasi : dropdownLokasi;

    if (!inputTanggal) {
        showToast("Tanggal absensi tidak boleh kosong!", "error");
        return;
    }

    const tbody = document.getElementById('stagingBody');
    const rows = tbody.querySelectorAll('tr');

    const arrayDataAbsensi = [];
    const arrayDataMasterBaru = [];
    const namaSudahDitambahkan = new Set();

    let namaTypo = [];
    let namaDuplikat = [];

    rows.forEach(tr => {
        const idx = tr.getAttribute('data-idx');
        const valNama = document.getElementById(`nama-${idx}`).value.trim().toUpperCase();
        if (valNama === "") return;

        const nip = tr.getAttribute('data-nip');
        const isNew = tr.getAttribute('data-isnew') === 'true';
        const bidang = document.getElementById(`bidang-${idx}`).value || 'Helper';
        const organisasi = document.getElementById(`org-${idx}`).value || 'Umum';
        const st = tr.getAttribute('data-status');
        const fl = tr.getAttribute('data-flag');

        if (st === 'typo') namaTypo.push(valNama);
        if (fl === 'dupdb' || fl === 'dupinput') namaDuplikat.push(valNama);

        if (isNew && !namaSudahDitambahkan.has(valNama)) {
            arrayDataMasterBaru.push({
                nip: nip,
                nama: valNama,
                jabatan: bidang,
                asal_organisasi: organisasi
            });
            namaSudahDitambahkan.add(valNama);
        }

        arrayDataAbsensi.push({
            tanggal: inputTanggal,
            sesi: globalSesi,
            lokasi: globalLokasi,
            nip: nip,
            nama: valNama,
            bidang: bidang,
            organisasi: organisasi
        });
    });

    if (arrayDataAbsensi.length === 0) {
        showToast("Tidak ada data valid yang bisa dikirim.", "error");
        return;
    }

    // Konfirmasi bila ada nama yang mirip Master atau sudah tercatat
    if (namaTypo.length > 0) {
        const contoh = namaTypo.slice(0, 6).map(n => `  • ${n}`).join('\n');
        const ok = confirm(
            `⚠ Sebagian nama KEMIRIPAN dengan data Master:\n${contoh}\n\n` +
            `Sebaiknya klik tombol "Perbaiki" pada baris tersebut.\n\n` +
            `Pilih "OK" HANYA jika nama tersebut memang relawan BARU yang berbeda.\n` +
            `Pilih "Batal" untuk kembali meninjau.`
        );
        if (!ok) return;
    }

    if (namaDuplikat.length > 0) {
        const contoh = namaDuplikat.slice(0, 6).map(n => `  • ${n}`).join('\n');
        const ok = confirm(
            `❕ Sebagian nama sudah tercatat pada tanggal/sesi ini:\n${contoh}\n\n` +
            `Pilih "OK" hanya jika ingin menyimpan ulang (misal koreksi data).`
        );
        if (!ok) return;
    }

    const btn = document.getElementById('btnSubmitFinal');
    const teksAsli = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyinkronkan...`;
    btn.disabled = true;

    try {
        if (arrayDataMasterBaru.length > 0) {
            await supabaseFetch('master_relawan', 'POST', arrayDataMasterBaru);
        }

        // Simpan via fungsi server agar duplikat DB otomatis dilewati
        const resRpc = await callSupabaseRpc('insert_absensi_batch', {
            p_logs: arrayDataAbsensi,
            p_skip_duplikat: true
        });

        if (resRpc.status === "success") {
            const inserted = resRpc.inserted != null ? resRpc.inserted : arrayDataAbsensi.length;
            const skipped = resRpc.skipped != null ? resRpc.skipped : 0;

            let pesanBerhasil = `${inserted} data absensi berhasil dicatat!`;
            if (skipped > 0) pesanBerhasil += ` (${skipped} dilewati karena sudah ada).`;
            if (arrayDataMasterBaru.length > 0) {
                pesanBerhasil += ` ${arrayDataMasterBaru.length} Relawan baru otomatis ditambahkan ke Master Data.`;
            }
            showToast(pesanBerhasil, "success");

            document.getElementById('daftarNama').value = "";
            cancelStaging();
            hapusDraft();
            loadMasterDataUntukStaging();
        } else {
            const pesanServer = resRpc.result && resRpc.result.message ? resRpc.result.message : (resRpc.message || "Gagal menyimpan data absensi.");
            console.error("Insert RPC Gagal:", resRpc);
            showToast(pesanServer, "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
        console.error("Submit Error:", err);
    } finally {
        btn.innerHTML = teksAsli;
        btn.disabled = false;
    }
}