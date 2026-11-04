// ==========================================
// LAPORAN PERIODE CUSTOM
// Rekap aktivitas kehadiran relawan berdasarkan rentang tanggal.
// Tidak memakai asumsi hari kerja wajib, alfa, izin, atau sakit.
// ==========================================

const LAP_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const LAP_HARI = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const LAP_TABS = ['personel', 'harian', 'lokasi', 'instansi'];

const lapState = {
    loading: false,
    requestId: 0,
    tab: 'personel',
    personelPage: 1,
    personelPerPage: 50,
    personelUrutan: 'total_desc'
};

let lapHasil = null;
let lapMeta = null;
let lapFilteredPersonel = [];

if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.scale.grid.color = document.documentElement.classList.contains('dark') ? '#1e293b' : '#f1f5f9';
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', async () => {
        aturPeriodeDefaultLaporan();
        await isiOpsiLokasiLaporan();
        perbaruiInfoFilterLaporan();
        gantiTabLaporan('personel');
        muatLaporan();
    });
}

// ==========================================
// 1. UTILITAS TANGGAL
// ==========================================

function duaAngkaLaporan(nilai) {
    return String(nilai).padStart(2, '0');
}

function tanggalLokalIsoLaporan(tanggal) {
    return `${tanggal.getFullYear()}-${duaAngkaLaporan(tanggal.getMonth() + 1)}-${duaAngkaLaporan(tanggal.getDate())}`;
}

function tanggalHariIniLaporan() {
    return tanggalLokalIsoLaporan(new Date());
}

function awalBulanLaporan(offsetBulan = 0) {
    const sekarang = new Date();
    return tanggalLokalIsoLaporan(new Date(sekarang.getFullYear(), sekarang.getMonth() + offsetBulan, 1));
}

function akhirBulanLaporan(offsetBulan = 0) {
    const sekarang = new Date();
    const akhir = new Date(sekarang.getFullYear(), sekarang.getMonth() + offsetBulan + 1, 0);
    return tanggalLokalIsoLaporan(akhir);
}

function parseTanggalLaporan(nilai) {
    const teks = String(nilai || '').slice(0, 10);
    const cocok = /^(\d{4})-(\d{2})-(\d{2})$/.exec(teks);
    if (!cocok) return null;

    const tahun = Number(cocok[1]);
    const bulan = Number(cocok[2]);
    const hari = Number(cocok[3]);
    const tanggal = new Date(Date.UTC(tahun, bulan - 1, hari));

    if (tanggal.getUTCFullYear() !== tahun ||
        tanggal.getUTCMonth() !== bulan - 1 ||
        tanggal.getUTCDate() !== hari) {
        return null;
    }

    return {
        iso: teks,
        tahun,
        bulan,
        hari,
        ms: tanggal.getTime()
    };
}

function normalisasiTanggalLaporan(nilai) {
    const hasil = parseTanggalLaporan(nilai);
    return hasil ? hasil.iso : '';
}

function selisihHariLaporan(tglAwal, tglAkhir) {
    const awal = parseTanggalLaporan(tglAwal);
    const akhir = parseTanggalLaporan(tglAkhir);
    if (!awal || !akhir) return 0;
    return Math.floor((akhir.ms - awal.ms) / 86400000);
}

function tambahHariLaporan(tanggalIso, jumlahHari) {
    const tanggal = parseTanggalLaporan(tanggalIso);
    if (!tanggal) return '';
    return new Date(tanggal.ms + (jumlahHari * 86400000)).toISOString().slice(0, 10);
}

function daftarTanggalRentangLaporan(tglAwal, tglAkhir) {
    const hasil = [];
    const jumlah = selisihHariLaporan(tglAwal, tglAkhir);
    if (jumlah < 0) return hasil;
    for (let i = 0; i <= jumlah; i++) {
        hasil.push(tambahHariLaporan(tglAwal, i));
    }
    return hasil;
}

function formatTanggalLaporan(nilai) {
    const tanggal = parseTanggalLaporan(nilai);
    if (!tanggal) return '-';
    return `${tanggal.hari} ${LAP_BULAN[tanggal.bulan - 1].slice(0, 3)} ${tanggal.tahun}`;
}

function formatTanggalPanjangLaporan(nilai) {
    const tanggal = parseTanggalLaporan(nilai);
    if (!tanggal) return '-';
    return `${LAP_HARI[new Date(tanggal.ms).getUTCDay()]}, ${tanggal.hari} ${LAP_BULAN[tanggal.bulan - 1]} ${tanggal.tahun}`;
}

function formatHariLaporan(nilai) {
    const tanggal = parseTanggalLaporan(nilai);
    return tanggal ? LAP_HARI[new Date(tanggal.ms).getUTCDay()] : '-';
}

function labelBulanPendekLaporan(kunciBulan) {
    const [tahun, bulan] = String(kunciBulan || '').split('-');
    const indeks = Number(bulan) - 1;
    return `${(LAP_BULAN[indeks] || bulan || '-').slice(0, 3)} ${String(tahun || '').slice(-2)}`;
}

function daftarBulanRentangLaporan(tglAwal, tglAkhir) {
    const awal = parseTanggalLaporan(tglAwal);
    const akhir = parseTanggalLaporan(tglAkhir);
    if (!awal || !akhir) return [];

    const hasil = [];
    let tahun = awal.tahun;
    let bulan = awal.bulan;
    while (tahun < akhir.tahun || (tahun === akhir.tahun && bulan <= akhir.bulan)) {
        hasil.push(`${tahun}-${duaAngkaLaporan(bulan)}`);
        bulan += 1;
        if (bulan > 12) {
            bulan = 1;
            tahun += 1;
        }
    }
    return hasil;
}

function daftarTahunRentangLaporan(tglAwal, tglAkhir) {
    const awal = parseTanggalLaporan(tglAwal);
    const akhir = parseTanggalLaporan(tglAkhir);
    if (!awal || !akhir) return [];

    const hasil = [];
    for (let tahun = awal.tahun; tahun <= akhir.tahun; tahun++) {
        hasil.push(String(tahun));
    }
    return hasil;
}

// ==========================================
// 2. FILTER & PRESET
// ==========================================

function aturPeriodeDefaultLaporan() {
    const awal = document.getElementById('lapTanggalAwal');
    const akhir = document.getElementById('lapTanggalAkhir');
    if (awal && !awal.value) awal.value = awalBulanLaporan();
    if (akhir && !akhir.value) akhir.value = tanggalHariIniLaporan();
}

async function isiOpsiLokasiLaporan() {
    const select = document.getElementById('lapLokasi');
    if (!select) return;

    const akses = await getAksesUser();
    const lokasiSet = new Set();

    // Koordinator tidak perlu membaca daftar seluruh proyek. Kunci pilihan ke
    // lokasi akun agar UI tidak membocorkan nama lokasi lain.
    if (akses.role === 'koordinator' && akses.lokasi) {
        select.innerHTML = `<option value="${escapeAttribute(akses.lokasi)}">${escapeHTML(akses.lokasi)}</option>`;
        select.value = akses.lokasi;
        select.disabled = true;
        return;
    }

    const proyekDomain = (typeof window !== 'undefined' && window.RelawanDomain && window.RelawanDomain.PROYEK_KHUSUS) || [];
    proyekDomain.forEach(lokasi => {
        const bersih = String(lokasi || '').trim();
        if (bersih) lokasiSet.add(bersih);
    });

    try {
        const hasil = await supabaseFetchAll('v_daftar_proyek_absensi?select=nama_proyek&order=nama_proyek.asc');
        if (hasil.status === 'success') {
            (hasil.data || []).forEach(row => {
                const lokasi = String(row.nama_proyek || '').trim();
                if (lokasi) lokasiSet.add(lokasi);
            });
        }
    } catch (error) {
        console.warn('Daftar lokasi laporan belum dapat dimuat:', error);
    }

    const daftar = [...lokasiSet].sort((a, b) => a.localeCompare(b, 'id'));
    let html = '<option value="Semua">Semua Lokasi</option>';
    daftar.forEach(lokasi => {
        html += `<option value="${escapeAttribute(lokasi)}">${escapeHTML(lokasi)}</option>`;
    });
    select.innerHTML = html;
    select.value = 'Semua';
    select.disabled = false;
}

function validasiPeriodeLaporan(tampilkanToast = false) {
    const awalEl = document.getElementById('lapTanggalAwal');
    const akhirEl = document.getElementById('lapTanggalAkhir');
    const awal = String(awalEl?.value || '');
    const akhir = String(akhirEl?.value || '');

    if (!parseTanggalLaporan(awal) || !parseTanggalLaporan(akhir)) {
        if (tampilkanToast) showToast('Tanggal awal dan akhir wajib diisi dengan benar.', 'error');
        return false;
    }
    if (awal > akhir) {
        if (tampilkanToast) showToast('Tanggal akhir tidak boleh lebih awal dari tanggal awal.', 'error');
        return false;
    }
    return true;
}

function perbaruiInfoFilterLaporan() {
    const info = document.getElementById('lapFilterInfo');
    if (!info) return false;

    const awal = document.getElementById('lapTanggalAwal')?.value || '';
    const akhir = document.getElementById('lapTanggalAkhir')?.value || '';
    const lokasi = document.getElementById('lapLokasi')?.value || 'Semua';

    if (!parseTanggalLaporan(awal) || !parseTanggalLaporan(akhir)) {
        info.innerHTML = '<span class="text-red-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Lengkapi tanggal awal dan akhir.</span>';
        return false;
    }
    if (awal > akhir) {
        info.innerHTML = '<span class="text-red-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Tanggal akhir harus sama atau setelah tanggal awal.</span>';
        return false;
    }

    info.innerHTML = `<i class="fa-solid fa-calendar-days text-primary mr-1.5"></i>Periode <b>${escapeHTML(formatTanggalLaporan(awal))}</b> sampai <b>${escapeHTML(formatTanggalLaporan(akhir))}</b> &bull; ${escapeHTML(lokasi === 'Semua' ? 'Semua Lokasi' : lokasi)}`;
    return true;
}

function terapkanPresetLaporan(preset) {
    const awalEl = document.getElementById('lapTanggalAwal');
    const akhirEl = document.getElementById('lapTanggalAkhir');
    if (!awalEl || !akhirEl) return;

    const hariIni = tanggalHariIniLaporan();
    if (preset === 'hari_ini') {
        awalEl.value = hariIni;
        akhirEl.value = hariIni;
    } else if (preset === '7') {
        awalEl.value = tambahHariLaporan(hariIni, -6);
        akhirEl.value = hariIni;
    } else if (preset === '30') {
        awalEl.value = tambahHariLaporan(hariIni, -29);
        akhirEl.value = hariIni;
    } else if (preset === 'bulan_lalu') {
        awalEl.value = awalBulanLaporan(-1);
        akhirEl.value = akhirBulanLaporan(-1);
    } else {
        awalEl.value = awalBulanLaporan();
        akhirEl.value = hariIni;
    }

    perbaruiInfoFilterLaporan();
    muatLaporan();
}

function resetLaporan() {
    const awalEl = document.getElementById('lapTanggalAwal');
    const akhirEl = document.getElementById('lapTanggalAkhir');
    const lokasiEl = document.getElementById('lapLokasi');
    const cariEl = document.getElementById('lapCariPersonel');
    const urutEl = document.getElementById('lapUrutPersonel');
    const limitEl = document.getElementById('lapLimitPersonel');
    const detailEl = document.getElementById('lapSertakanDetail');

    if (awalEl) awalEl.value = awalBulanLaporan();
    if (akhirEl) akhirEl.value = tanggalHariIniLaporan();
    if (lokasiEl && !lokasiEl.disabled) lokasiEl.value = 'Semua';
    if (cariEl) cariEl.value = '';
    if (urutEl) urutEl.value = 'total_desc';
    if (limitEl) limitEl.value = '50';
    if (detailEl) detailEl.checked = false;

    lapState.personelPage = 1;
    lapState.personelPerPage = 50;
    lapState.personelUrutan = 'total_desc';

    gantiTabLaporan('personel');
    perbaruiInfoFilterLaporan();
    muatLaporan();
}

// ==========================================
// 3. QUERY DATA
// ==========================================

function setLaporanLoading(aktif) {
    const tombol = document.getElementById('btnLapTampilkan');
    if (!tombol) return;

    if (aktif) {
        if (!tombol.dataset.teksAsli) tombol.dataset.teksAsli = tombol.innerHTML;
        tombol.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memuat...';
        tombol.disabled = true;
    } else {
        if (tombol.dataset.teksAsli) tombol.innerHTML = tombol.dataset.teksAsli;
        tombol.disabled = false;
    }
}

function aturTombolLaporan(aktif) {
    ['btnLapExcel', 'btnLapCSV', 'btnLapCetak'].forEach(id => {
        const tombol = document.getElementById(id);
        if (!tombol) return;
        tombol.disabled = !aktif;
    });
}

function renderInfoHasilLaporan() {
    const info = document.getElementById('lapFilterInfo');
    if (!info || !lapHasil || !lapMeta) return;

    let tambahan = '';
    if (lapHasil.duplikat > 0) {
        tambahan = ` &bull; <span class="text-amber-600 dark:text-amber-400">${lapHasil.duplikat} duplikat slot diabaikan</span>`;
    }

    info.innerHTML = `<i class="fa-solid fa-calendar-days text-primary mr-1.5"></i>Periode <b>${escapeHTML(formatTanggalLaporan(lapMeta.start))}</b> sampai <b>${escapeHTML(formatTanggalLaporan(lapMeta.end))}</b> &bull; ${escapeHTML(lapMeta.lokasi === 'Semua' ? 'Semua Lokasi' : lapMeta.lokasi)} &bull; <b>${lapHasil.totalSesi.toLocaleString('id-ID')}</b> sesi${tambahan}`;
}

async function muatLaporan() {
    if (!validasiPeriodeLaporan(true)) {
        perbaruiInfoFilterLaporan();
        return;
    }

    const awal = document.getElementById('lapTanggalAwal').value;
    const akhir = document.getElementById('lapTanggalAkhir').value;
    let lokasi = document.getElementById('lapLokasi')?.value || 'Semua';

    const requestId = ++lapState.requestId;
    lapState.loading = true;
    setLaporanLoading(true);
    aturTombolLaporan(false);
    const kosongEl = document.getElementById('lapKosong');
    if (kosongEl) kosongEl.classList.add('hidden');

    try {
        const akses = await getAksesUser();
        if (akses.role === 'koordinator' && akses.lokasi) {
            lokasi = akses.lokasi;
            const lokasiEl = document.getElementById('lapLokasi');
            if (lokasiEl) {
                if (!Array.from(lokasiEl.options).some(option => option.value === lokasi)) {
                    const option = document.createElement('option');
                    option.value = lokasi;
                    option.textContent = lokasi;
                    lokasiEl.appendChild(option);
                }
                lokasiEl.value = lokasi;
                lokasiEl.disabled = true;
            }
        }

        let urlLog = `v_log_absensi_operasional?select=id,tanggal,sesi,lokasi,nip,nama,bidang,organisasi,terhubung&terhubung=eq.true&order=tanggal.asc,id.asc&tanggal=gte.${encodeURIComponent(awal)}&tanggal=lte.${encodeURIComponent(akhir)}`;
        urlLog = await terapkanFilterLokasi(urlLog);
        if (lokasi !== 'Semua') {
            urlLog += `&lokasi=eq.${encodeURIComponent(lokasi)}`;
        }

        const urlMaster = 'v_personel_terpadu_v3?select=nip,nama,jabatan,asal_organisasi,kabupaten_normalisasi,asal_daerah,zona_asal,zona_label,kategori_personel,jenis_personel_label&kategori_personel=eq.reguler&order=nip.asc';

        const [logRes, masterRes] = await Promise.all([
            supabaseFetchAll(urlLog),
            supabaseFetchAll(urlMaster)
        ]);

        if (requestId !== lapState.requestId) return;

        if (logRes.status !== 'success' || masterRes.status !== 'success') {
            throw new Error(logRes.message || masterRes.message || 'Gagal mengambil data laporan.');
        }

        const hasil = bangunLaporan(logRes.data || [], masterRes.data || [], awal, akhir, lokasi);
        lapHasil = hasil;
        lapMeta = { start: awal, end: akhir, lokasi };

        renderSemuaLaporan();
        renderInfoHasilLaporan();
        aturTombolLaporan(hasil.totalSesi > 0);
    } catch (error) {
        if (requestId !== lapState.requestId) return;
        console.error('Laporan Load Error:', error);
        showToast(error.message || 'Gagal memuat laporan.', 'error');
        const info = document.getElementById('lapFilterInfo');
        if (info) {
            info.innerHTML = '<span class="text-red-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Gagal memuat laporan. Coba lagi.</span>';
        }
        aturTombolLaporan(false);
    } finally {
        if (requestId === lapState.requestId) {
            lapState.loading = false;
            setLaporanLoading(false);
        }
    }
}

// ==========================================
// 4. MESIN PERHITUNGAN (MURNI)
// ==========================================

function normalisasiNamaLaporan(nama) {
    return String(nama || '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalisasiSesiLaporan(sesi) {
    const nilai = String(sesi || '').trim().toUpperCase();
    if (nilai === 'PAGI' || nilai === 'SIANG') return 'Pagi';
    if (nilai === 'MALAM') return 'Malam';
    return String(sesi || '').trim() || '-';
}

function labelZonaLaporan(master) {
    if (!master) return 'Zona belum diisi';
    if (master.zona_label) return master.zona_label;
    const domain = (typeof window !== 'undefined' && window.RelawanDomain) ? window.RelawanDomain : null;
    if (domain && typeof domain.labelZona === 'function') {
        return domain.labelZona(master.zona_asal);
    }
    return String(master.zona_asal || '').trim() || 'Zona belum diisi';
}

function buatSeriTrenLaporan(logs, tglAwal, tglAkhir) {
    const perHari = new Map();
    (logs || []).forEach(log => {
        const tanggal = normalisasiTanggalLaporan(log.tanggal);
        if (!tanggal) return;
        perHari.set(tanggal, (perHari.get(tanggal) || 0) + 1);
    });

    const jumlahHari = selisihHariLaporan(tglAwal, tglAkhir) + 1;
    if (jumlahHari <= 62) {
        const labels = [];
        const data = [];
        const fullDates = [];
        daftarTanggalRentangLaporan(tglAwal, tglAkhir).forEach(tanggal => {
            labels.push(formatTanggalLaporan(tanggal));
            data.push(perHari.get(tanggal) || 0);
            fullDates.push(tanggal);
        });
        return { labels, data, fullDates, granularitas: 'Harian' };
    }

    const perBulan = new Map();
    (logs || []).forEach(log => {
        const tanggal = normalisasiTanggalLaporan(log.tanggal);
        if (!tanggal) return;
        const kunci = tanggal.slice(0, 7);
        perBulan.set(kunci, (perBulan.get(kunci) || 0) + 1);
    });

    const daftarBulan = daftarBulanRentangLaporan(tglAwal, tglAkhir);
    if (daftarBulan.length <= 24) {
        return {
            labels: daftarBulan.map(labelBulanPendekLaporan),
            data: daftarBulan.map(bulan => perBulan.get(bulan) || 0),
            fullDates: daftarBulan.map(() => ''),
            granularitas: 'Bulanan'
        };
    }

    const perTahun = new Map();
    (logs || []).forEach(log => {
        const tanggal = normalisasiTanggalLaporan(log.tanggal);
        if (!tanggal) return;
        const kunci = tanggal.slice(0, 4);
        perTahun.set(kunci, (perTahun.get(kunci) || 0) + 1);
    });

    const daftarTahun = daftarTahunRentangLaporan(tglAwal, tglAkhir);
    return {
        labels: daftarTahun,
        data: daftarTahun.map(tahun => perTahun.get(tahun) || 0),
        fullDates: daftarTahun.map(() => ''),
        granularitas: 'Tahunan'
    };
}

function bangunLaporan(logs, masters, tglAwal, tglAkhir, lokasi) {
    const awal = normalisasiTanggalLaporan(tglAwal);
    const akhir = normalisasiTanggalLaporan(tglAkhir);
    const masterByNip = new Map();

    (masters || []).forEach(master => {
        const nip = String(master.nip || '').trim();
        if (nip) masterByNip.set(nip, master);
    });

    const personelMap = new Map();
    const harianMap = new Map();
    const lokasiMap = new Map();
    const instansiMap = new Map();
    const hariAktifSet = new Set();
    const slotSet = new Set();
    const logsBersih = [];
    let duplikat = 0;
    let diabaikan = 0;

    (logs || []).forEach(logMentah => {
        const tanggal = normalisasiTanggalLaporan(logMentah.tanggal);
        if (!tanggal || tanggal < awal || tanggal > akhir) return;

        const lokasiLog = String(logMentah.lokasi || '').trim() || 'Lokasi belum diisi';
        if (lokasi && lokasi !== 'Semua' && lokasiLog !== lokasi) return;

        const nip = String(logMentah.nip || '').trim();
        if (nip && !masterByNip.has(nip)) {
            diabaikan += 1;
            return;
        }

        const sesi = normalisasiSesiLaporan(logMentah.sesi);
        const identitas = nip ? `N:${nip}` : `X:${normalisasiNamaLaporan(logMentah.nama)}`;
        const slot = `${identitas}|${tanggal}|${sesi}|${lokasiLog}`;
        if (slotSet.has(slot)) {
            duplikat += 1;
            return;
        }
        slotSet.add(slot);

        const log = {
            ...logMentah,
            tanggal,
            sesi,
            lokasi: lokasiLog,
            nip,
            _identitas: identitas
        };
        logsBersih.push(log);
        hariAktifSet.add(tanggal);

        const master = nip ? masterByNip.get(nip) : null;
        const nama = String(master?.nama || log.nama || '-').trim() || '-';
        const organisasi = String(master?.asal_organisasi || log.organisasi || '-').trim() || '-';
        const bidang = String(master?.jabatan || log.bidang || '-').trim() || '-';

        let personel = personelMap.get(identitas);
        if (!personel) {
            personel = {
                nip,
                nama,
                organisasi,
                bidang,
                zona: labelZonaLaporan(master),
                jenis: String(master?.jenis_personel_label || 'Reguler').trim() || 'Reguler',
                pagi: 0,
                malam: 0,
                total: 0,
                hariSet: new Set(),
                terakhir: ''
            };
            personelMap.set(identitas, personel);
        }
        personel.total += 1;
        if (sesi === 'Pagi') personel.pagi += 1;
        if (sesi === 'Malam') personel.malam += 1;
        personel.hariSet.add(tanggal);
        if (!personel.terakhir || tanggal > personel.terakhir) personel.terakhir = tanggal;

        let harian = harianMap.get(tanggal);
        if (!harian) {
            harian = {
                tanggal,
                pagi: 0,
                malam: 0,
                total: 0,
                personelSet: new Set(),
                lokasiSet: new Set()
            };
            harianMap.set(tanggal, harian);
        }
        harian.total += 1;
        if (sesi === 'Pagi') harian.pagi += 1;
        if (sesi === 'Malam') harian.malam += 1;
        harian.personelSet.add(identitas);
        harian.lokasiSet.add(lokasiLog);

        let lokasiRekap = lokasiMap.get(lokasiLog);
        if (!lokasiRekap) {
            lokasiRekap = { lokasi: lokasiLog, total: 0, personelSet: new Set(), hariSet: new Set() };
            lokasiMap.set(lokasiLog, lokasiRekap);
        }
        lokasiRekap.total += 1;
        lokasiRekap.personelSet.add(identitas);
        lokasiRekap.hariSet.add(tanggal);

        let instansi = instansiMap.get(organisasi);
        if (!instansi) {
            instansi = { organisasi, total: 0, personelSet: new Set(), hariSet: new Set() };
            instansiMap.set(organisasi, instansi);
        }
        instansi.total += 1;
        instansi.personelSet.add(identitas);
        instansi.hariSet.add(tanggal);
    });

    const hariAktif = hariAktifSet.size;
    const totalSesi = logsBersih.length;
    const totalPagi = logsBersih.filter(log => log.sesi === 'Pagi').length;
    const totalMalam = logsBersih.filter(log => log.sesi === 'Malam').length;

    const rows = [...personelMap.values()].map(row => ({
        nip: row.nip,
        nama: row.nama || '-',
        organisasi: row.organisasi || '-',
        bidang: row.bidang || '-',
        zona: row.zona || 'Zona belum diisi',
        jenis: row.jenis || 'Reguler',
        pagi: row.pagi,
        malam: row.malam,
        total: row.total,
        hariHadir: row.hariSet.size,
        rasio: hariAktif > 0 ? Number(((row.hariSet.size / hariAktif) * 100).toFixed(1)) : 0,
        terakhir: row.terakhir || ''
    }));

    rows.sort((a, b) => {
        return (b.total - a.total) ||
            (b.hariHadir - a.hariHadir) ||
            a.nama.localeCompare(b.nama, 'id');
    });

    const rowsHarian = [...harianMap.values()]
        .map(row => ({
            tanggal: row.tanggal,
            hari: formatHariLaporan(row.tanggal),
            pagi: row.pagi,
            malam: row.malam,
            total: row.total,
            personelUnik: row.personelSet.size,
            lokasi: [...row.lokasiSet].sort((a, b) => a.localeCompare(b, 'id')).join(', ')
        }))
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal));

    const rowsLokasi = [...lokasiMap.values()]
        .map(row => ({
            lokasi: row.lokasi,
            total: row.total,
            personelUnik: row.personelSet.size,
            hariAktif: row.hariSet.size
        }))
        .sort((a, b) => (b.total - a.total) || a.lokasi.localeCompare(b.lokasi, 'id'));

    const rowsInstansi = [...instansiMap.values()]
        .map(row => ({
            organisasi: row.organisasi,
            total: row.total,
            personelUnik: row.personelSet.size,
            hariAktif: row.hariSet.size
        }))
        .sort((a, b) => (b.total - a.total) || a.organisasi.localeCompare(b.organisasi, 'id'));

    return {
        rows,
        rowsHarian,
        rowsLokasi,
        rowsInstansi,
        logs: logsBersih,
        totalSesi,
        totalPagi,
        totalMalam,
        hariAktif,
        personelHadir: rows.length,
        rataRata: hariAktif > 0 ? Number((totalSesi / hariAktif).toFixed(1)) : 0,
        duplikat,
        diabaikan,
        tren: buatSeriTrenLaporan(logsBersih, awal, akhir)
    };
}

// ==========================================
// 5. RENDER RINGKASAN & TABEL
// ==========================================

function renderSemuaLaporan() {
    if (!lapHasil) return;

    lapState.personelPage = 1;
    lapFilteredPersonel = [...lapHasil.rows];

    document.getElementById('lap-total-sesi').textContent = lapHasil.totalSesi.toLocaleString('id-ID');
    document.getElementById('lap-personel-hadir').textContent = lapHasil.personelHadir.toLocaleString('id-ID');
    document.getElementById('lap-hari-aktif').textContent = lapHasil.hariAktif.toLocaleString('id-ID');
    document.getElementById('lap-rata-rata').textContent = lapHasil.rataRata.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    const kosong = document.getElementById('lapKosong');
    if (kosong) kosong.classList.toggle('hidden', lapHasil.totalSesi > 0);

    const countPersonel = document.getElementById('lapCountPersonel');
    const countHarian = document.getElementById('lapCountHarian');
    const countLokasi = document.getElementById('lapCountLokasi');
    const countInstansi = document.getElementById('lapCountInstansi');
    if (countPersonel) countPersonel.textContent = lapHasil.rows.length.toLocaleString('id-ID');
    if (countHarian) countHarian.textContent = lapHasil.rowsHarian.length.toLocaleString('id-ID');
    if (countLokasi) countLokasi.textContent = lapHasil.rowsLokasi.length.toLocaleString('id-ID');
    if (countInstansi) countInstansi.textContent = lapHasil.rowsInstansi.length.toLocaleString('id-ID');

    const granularitas = document.getElementById('lapTrenGranularitas');
    if (granularitas) granularitas.textContent = lapHasil.tren.granularitas;

    terapkanKontrolPersonelLaporan();
    renderTabelHarianLaporan();
    renderTabelLokasiLaporan();
    renderTabelInstansiLaporan();
    renderChartsLaporan();
}

function bandingkanNilaiLaporan(a, b, arah) {
    if (a < b) return arah === 'asc' ? -1 : 1;
    if (a > b) return arah === 'asc' ? 1 : -1;
    return 0;
}

function urutkanPersonelLaporan(rows) {
    const [kunci, arah] = String(lapState.personelUrutan || 'total_desc').split('_');
    const hasil = [...rows];

    hasil.sort((a, b) => {
        if (kunci === 'nama' || kunci === 'organisasi' || kunci === 'zona') {
            return bandingkanNilaiLaporan(String(a[kunci] || '').toLowerCase(), String(b[kunci] || '').toLowerCase(), arah) ||
                a.nama.localeCompare(b.nama, 'id');
        }
        if (kunci === 'terakhir') {
            return bandingkanNilaiLaporan(String(a.terakhir || ''), String(b.terakhir || ''), arah) ||
                a.nama.localeCompare(b.nama, 'id');
        }
        const properti = kunci === 'hari' ? 'hariHadir' : 'total';
        return bandingkanNilaiLaporan(Number(a[properti]) || 0, Number(b[properti]) || 0, arah) ||
            (b.total - a.total) ||
            a.nama.localeCompare(b.nama, 'id');
    });

    return hasil;
}

function terapkanKontrolPersonelLaporan() {
    if (!lapHasil) return;

    const kataKunci = String(document.getElementById('lapCariPersonel')?.value || '').toLowerCase().trim();
    let rows = [...lapHasil.rows];

    if (kataKunci) {
        rows = rows.filter(row => {
            return String(row.nama || '').toLowerCase().includes(kataKunci) ||
                String(row.nip || '').toLowerCase().includes(kataKunci) ||
                String(row.organisasi || '').toLowerCase().includes(kataKunci) ||
                String(row.zona || '').toLowerCase().includes(kataKunci);
        });
    }

    lapFilteredPersonel = urutkanPersonelLaporan(rows);
    renderTabelPersonelLaporan();
}

function renderTabelPersonelLaporan() {
    const tbody = document.getElementById('lapPersonelBody');
    if (!tbody) return;

    const total = lapFilteredPersonel.length;
    const perHalaman = Math.max(25, Number(lapState.personelPerPage) || 50);
    const totalHalaman = Math.max(1, Math.ceil(total / perHalaman));

    if (lapState.personelPage > totalHalaman) lapState.personelPage = totalHalaman;
    if (lapState.personelPage < 1) lapState.personelPage = 1;

    const mulai = (lapState.personelPage - 1) * perHalaman;
    const selesai = Math.min(mulai + perHalaman, total);
    const dataHalaman = lapFilteredPersonel.slice(mulai, selesai);

    if (!dataHalaman.length) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center p-8 text-slate-400 font-medium">Tidak ada personel yang sesuai filter.</td></tr>';
    } else {
        tbody.innerHTML = dataHalaman.map((row, indeks) => {
            const nomor = mulai + indeks + 1;
            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td class="px-4 py-3 text-center text-slate-500 text-xs">${nomor}</td>
                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">${escapeHTML(row.nama)}</td>
                    <td class="px-4 py-3 font-mono text-xs text-slate-500">${escapeHTML(row.nip || '-')}</td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-semibold uppercase">${escapeHTML(row.organisasi)}</td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-semibold">${escapeHTML(row.zona)}</td>
                    <td class="px-4 py-3 text-center text-xs font-bold text-orange-600 dark:text-orange-400">${row.pagi}</td>
                    <td class="px-4 py-3 text-center text-xs font-bold text-indigo-600 dark:text-indigo-400">${row.malam}</td>
                    <td class="px-4 py-3 text-center"><span class="bg-indigo-100 dark:bg-indigo-500/10 text-primary font-black px-3 py-1 rounded-lg text-xs border border-indigo-200 dark:border-indigo-500/20">${row.total}</span></td>
                    <td class="px-4 py-3 text-center"><span class="bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-black px-3 py-1 rounded-lg text-xs border border-emerald-200 dark:border-emerald-500/20">${row.hariHadir}</span></td>
                    <td class="px-4 py-3 text-center text-xs font-bold text-slate-600 dark:text-slate-300" title="Rasio hari hadir terhadap hari aktif pada periode ini">${row.rasio.toFixed(1)}%</td>
                    <td class="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs font-semibold">${escapeHTML(row.terakhir ? formatTanggalLaporan(row.terakhir) : '-')}</td>
                </tr>
            `;
        }).join('');
    }

    const labelAwal = total ? mulai + 1 : 0;
    const info = document.getElementById('lapPersonelInfo');
    if (info) {
        info.textContent = `Baris ${labelAwal}-${selesai} dari ${total.toLocaleString('id-ID')} data • Halaman ${lapState.personelPage}/${totalHalaman}`;
    }

    const prev = document.getElementById('btnLapPersonelPrev');
    const next = document.getElementById('btnLapPersonelNext');
    if (prev) prev.disabled = lapState.personelPage <= 1;
    if (next) next.disabled = lapState.personelPage >= totalHalaman;
}

function renderTabelHarianLaporan() {
    const tbody = document.getElementById('lapHarianBody');
    if (!tbody || !lapHasil) return;

    if (!lapHasil.rowsHarian.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-slate-400 font-medium">Belum ada data harian pada periode ini.</td></tr>';
        return;
    }

    tbody.innerHTML = lapHasil.rowsHarian.map((row, indeks) => `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer" onclick="bukaDetailTanggalLaporan('${row.tanggal}')">
            <td class="px-4 py-3 text-center text-slate-500 text-xs">${indeks + 1}</td>
            <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">${escapeHTML(formatTanggalLaporan(row.tanggal))}</td>
            <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-semibold">${escapeHTML(row.hari)}</td>
            <td class="px-4 py-3 text-center text-xs font-bold text-orange-600 dark:text-orange-400">${row.pagi}</td>
            <td class="px-4 py-3 text-center text-xs font-bold text-indigo-600 dark:text-indigo-400">${row.malam}</td>
            <td class="px-4 py-3 text-center"><span class="bg-indigo-100 dark:bg-indigo-500/10 text-primary font-black px-3 py-1 rounded-lg text-xs border border-indigo-200 dark:border-indigo-500/20">${row.total}</span></td>
            <td class="px-4 py-3 text-center text-xs font-bold text-slate-600 dark:text-slate-300">${row.personelUnik}</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs font-semibold">${escapeHTML(row.lokasi)}</td>
        </tr>
    `).join('');
}

function renderTabelLokasiLaporan() {
    const tbody = document.getElementById('lapLokasiBody');
    if (!tbody || !lapHasil) return;

    if (!lapHasil.rowsLokasi.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-slate-400 font-medium">Belum ada data lokasi pada periode ini.</td></tr>';
        return;
    }

    tbody.innerHTML = lapHasil.rowsLokasi.map((row, indeks) => `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
            <td class="px-4 py-3 text-center text-slate-500 text-xs">${indeks + 1}</td>
            <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">${escapeHTML(row.lokasi)}</td>
            <td class="px-4 py-3 text-center"><span class="bg-indigo-100 dark:bg-indigo-500/10 text-primary font-black px-3 py-1 rounded-lg text-xs border border-indigo-200 dark:border-indigo-500/20">${row.total}</span></td>
            <td class="px-4 py-3 text-center text-xs font-bold text-slate-600 dark:text-slate-300">${row.personelUnik}</td>
            <td class="px-4 py-3 text-center text-xs font-bold text-emerald-600 dark:text-emerald-400">${row.hariAktif}</td>
        </tr>
    `).join('');
}

function renderTabelInstansiLaporan() {
    const tbody = document.getElementById('lapInstansiBody');
    if (!tbody || !lapHasil) return;

    if (!lapHasil.rowsInstansi.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-slate-400 font-medium">Belum ada data instansi pada periode ini.</td></tr>';
        return;
    }

    tbody.innerHTML = lapHasil.rowsInstansi.map((row, indeks) => `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
            <td class="px-4 py-3 text-center text-slate-500 text-xs">${indeks + 1}</td>
            <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">${escapeHTML(row.organisasi)}</td>
            <td class="px-4 py-3 text-center text-xs font-bold text-slate-600 dark:text-slate-300">${row.personelUnik}</td>
            <td class="px-4 py-3 text-center"><span class="bg-indigo-100 dark:bg-indigo-500/10 text-primary font-black px-3 py-1 rounded-lg text-xs border border-indigo-200 dark:border-indigo-500/20">${row.total}</span></td>
            <td class="px-4 py-3 text-center text-xs font-bold text-emerald-600 dark:text-emerald-400">${row.hariAktif}</td>
        </tr>
    `).join('');
}

function filterPersonelLaporan() {
    lapState.personelPage = 1;
    terapkanKontrolPersonelLaporan();
}

function ubahUrutanPersonelLaporan() {
    const select = document.getElementById('lapUrutPersonel');
    lapState.personelUrutan = select?.value || 'total_desc';
    lapState.personelPage = 1;
    terapkanKontrolPersonelLaporan();
}

function ubahBatasPersonelLaporan() {
    const select = document.getElementById('lapLimitPersonel');
    lapState.personelPerPage = Math.max(25, Number(select?.value) || 50);
    lapState.personelPage = 1;
    renderTabelPersonelLaporan();
}

function ubahHalamanPersonelLaporan(delta) {
    const totalHalaman = Math.max(1, Math.ceil(lapFilteredPersonel.length / lapState.personelPerPage));
    lapState.personelPage += delta;
    if (lapState.personelPage < 1) lapState.personelPage = 1;
    if (lapState.personelPage > totalHalaman) lapState.personelPage = totalHalaman;
    renderTabelPersonelLaporan();
}

function resetKontrolPersonelLaporan() {
    const cari = document.getElementById('lapCariPersonel');
    const urut = document.getElementById('lapUrutPersonel');
    const limit = document.getElementById('lapLimitPersonel');
    if (cari) cari.value = '';
    if (urut) urut.value = 'total_desc';
    if (limit) limit.value = '50';
    lapState.personelUrutan = 'total_desc';
    lapState.personelPerPage = 50;
    lapState.personelPage = 1;
    terapkanKontrolPersonelLaporan();
}

function gantiTabLaporan(tab) {
    if (!LAP_TABS.includes(tab)) return;
    lapState.tab = tab;

    const label = {
        personel: 'lapTabPersonel',
        harian: 'lapTabHarian',
        lokasi: 'lapTabLokasi',
        instansi: 'lapTabInstansi'
    };
    const panel = {
        personel: 'lapPanelPersonel',
        harian: 'lapPanelHarian',
        lokasi: 'lapPanelLokasi',
        instansi: 'lapPanelInstansi'
    };

    LAP_TABS.forEach(nama => {
        const tombol = document.getElementById(label[nama]);
        const isi = document.getElementById(panel[nama]);
        if (tombol) {
            tombol.className = `rounded-lg px-4 py-2 text-xs font-bold transition-colors ${nama === tab ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`;
        }
        if (isi) isi.classList.toggle('hidden', nama !== tab);
    });
}

// ==========================================
// 6. DETAIL HARIAN
// ==========================================

function bukaDetailTanggalLaporan(tanggal) {
    if (!lapHasil) return;
    const tanggalBersih = normalisasiTanggalLaporan(tanggal);
    if (!tanggalBersih) return;

    const daftar = lapHasil.logs
        .filter(log => log.tanggal === tanggalBersih)
        .sort((a, b) => {
            const sesiA = a.sesi === 'Pagi' ? 0 : 1;
            const sesiB = b.sesi === 'Pagi' ? 0 : 1;
            return (sesiA - sesiB) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
        });

    const judul = document.getElementById('lapDetailJudul');
    const sub = document.getElementById('lapDetailSub');
    const body = document.getElementById('lapDetailBody');
    const totalEl = document.getElementById('lapDetailTotal');

    if (judul) judul.textContent = `Detail ${formatTanggalPanjangLaporan(tanggalBersih)}`;
    if (sub) sub.textContent = `${daftar.length.toLocaleString('id-ID')} catatan sesi kehadiran pada tanggal ini.`;
    if (totalEl) totalEl.textContent = `Total: ${daftar.length.toLocaleString('id-ID')} baris`;

    if (body) {
        body.innerHTML = daftar.length
            ? daftar.map((row, indeks) => `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td class="px-4 py-3 text-center text-slate-500 text-xs">${indeks + 1}</td>
                    <td class="px-4 py-3"><span class="text-xs font-bold px-2 py-1 rounded ${row.sesi === 'Pagi' ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400'}">${escapeHTML(row.sesi)}</span></td>
                    <td class="px-4 py-3 font-bold text-primary">${escapeHTML(row.nama)}</td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-semibold uppercase">${escapeHTML(row.organisasi)}</td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">${escapeHTML(row.bidang)}</td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">${escapeHTML(row.lokasi)}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="6" class="p-8 text-center text-slate-400 font-medium">Tidak ada catatan pada tanggal ini.</td></tr>';
    }

    const modal = document.getElementById('modalDetailLaporan');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function tutupDetailLaporan() {
    const modal = document.getElementById('modalDetailLaporan');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// ==========================================
// 7. GRAFIK
// ==========================================

const lapCharts = {
    tren: null,
    sesi: null,
    org: null,
    lokasi: null
};

function hancurkanChartLaporan(nama) {
    if (lapCharts[nama]) {
        lapCharts[nama].destroy();
        lapCharts[nama] = null;
    }
}

function dataLokasiChartLaporan(rows) {
    if (rows.length <= 8) return rows;
    const utama = rows.slice(0, 7).map(row => ({ lokasi: row.lokasi, total: row.total }));
    const lainnya = rows.slice(7).reduce((total, row) => total + row.total, 0);
    if (lainnya > 0) utama.push({ lokasi: 'Lainnya', total: lainnya });
    return utama;
}

function warnaChartLaporan(jumlah) {
    const dasar = ['#4F46E5', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#8B5CF6', '#14B8A6', '#F97316', '#EF4444', '#6366F1'];
    return Array.from({ length: jumlah }, (_, indeks) => dasar[indeks % dasar.length]);
}

function renderChartsLaporan() {
    if (typeof Chart === 'undefined' || !lapHasil) return;

    const gelap = document.documentElement.classList.contains('dark');
    const warnaGaris = gelap ? '#1e293b' : '#ffffff';
    const warnaGrid = gelap ? '#1e293b' : '#f1f5f9';
    const tren = lapHasil.tren;

    const canvasTren = document.getElementById('lapChartTrend');
    if (canvasTren) {
        hancurkanChartLaporan('tren');
        const ctx = canvasTren.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(79, 70, 229, 0.45)');
        gradient.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

        lapCharts.tren = new Chart(ctx, {
            type: 'line',
            data: {
                labels: tren.labels,
                fullDates: tren.fullDates,
                datasets: [{
                    label: 'Total Sesi',
                    data: tren.data,
                    borderColor: '#4F46E5',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#4F46E5',
                    pointBorderWidth: 2,
                    pointRadius: tren.granularitas === 'Harian' ? 4 : 3,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.35
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
                                if (!items.length) return '';
                                const indeks = items[0].dataIndex;
                                const lengkap = items[0].chart?.config?.data?.fullDates?.[indeks];
                                return lengkap ? formatTanggalPanjangLaporan(lengkap) : items[0].label;
                            },
                            label: function(context) {
                                return ` ${context.raw} sesi`;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, border: { display: false }, grid: { color: warnaGrid } }
                },
                onClick: function(event, elements, chart) {
                    if (!elements.length) return;
                    const indeks = elements[0].index;
                    const lengkap = chart.config.data.fullDates[indeks];
                    if (lengkap) bukaDetailTanggalLaporan(lengkap);
                }
            }
        });
    }

    const canvasSesi = document.getElementById('lapChartSesi');
    if (canvasSesi) {
        hancurkanChartLaporan('sesi');
        lapCharts.sesi = new Chart(canvasSesi.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Pagi', 'Malam'],
                datasets: [{
                    data: [lapHasil.totalPagi, lapHasil.totalMalam],
                    backgroundColor: ['#F97316', '#6366F1'],
                    borderWidth: 3,
                    borderColor: warnaGaris
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, font: { size: 12, weight: 'bold' } } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((jumlah, nilai) => jumlah + Number(nilai || 0), 0);
                                const persen = total > 0 ? ((Number(context.raw) / total) * 100).toFixed(1) : '0.0';
                                return ` ${context.label}: ${context.raw} (${persen}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    const canvasOrg = document.getElementById('lapChartOrg');
    if (canvasOrg) {
        hancurkanChartLaporan('org');
        const organisasi = lapHasil.rowsInstansi.slice(0, 10);
        lapCharts.org = new Chart(canvasOrg.getContext('2d'), {
            type: 'bar',
            data: {
                labels: organisasi.map(row => row.organisasi),
                datasets: [{
                    data: organisasi.map(row => row.total),
                    backgroundColor: warnaChartLaporan(organisasi.length),
                    borderRadius: 6,
                    barThickness: 18
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: function(context) { return ` ${context.raw} sesi`; } } }
                },
                scales: {
                    x: { beginAtZero: true, border: { display: false }, grid: { color: warnaGrid } },
                    y: { grid: { display: false } }
                }
            }
        });
    }

    const canvasLokasi = document.getElementById('lapChartLokasi');
    if (canvasLokasi) {
        hancurkanChartLaporan('lokasi');
        const lokasi = dataLokasiChartLaporan(lapHasil.rowsLokasi);
        lapCharts.lokasi = new Chart(canvasLokasi.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: lokasi.map(row => row.lokasi),
                datasets: [{
                    data: lokasi.map(row => row.total),
                    backgroundColor: warnaChartLaporan(lokasi.length),
                    borderWidth: 3,
                    borderColor: warnaGaris
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, padding: 14, font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((jumlah, nilai) => jumlah + Number(nilai || 0), 0);
                                const persen = total > 0 ? ((Number(context.raw) / total) * 100).toFixed(1) : '0.0';
                                return ` ${context.label}: ${context.raw} (${persen}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
}

// ==========================================
// 8. EXPORT EXCEL / CSV / CETAK
// ==========================================

function pastikanLaporanSiap() {
    if (!lapHasil || lapHasil.totalSesi === 0) {
        showToast('Tidak ada data laporan untuk diunduh pada periode ini.', 'error');
        return false;
    }
    return true;
}

function namaFileLaporan(ekstensi) {
    const awal = lapMeta?.start || 'awal';
    const akhir = lapMeta?.end || 'akhir';
    const lokasi = String(lapMeta?.lokasi || 'Semua').replace(/[^A-Za-z0-9_\-]+/g, '_');
    return `Laporan_Kehadiran_${lokasi}_${awal}_sd_${akhir}.${ekstensi}`;
}

function tambahSheetLaporan(workbook, nama, aoa, lebarKolom, jumlahKolomJudul) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = lebarKolom.map(wch => ({ wch }));
    if (jumlahKolomJudul) {
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: jumlahKolomJudul - 1 } }];
    }
    XLSX.utils.book_append_sheet(workbook, ws, nama);
    return ws;
}

function susunWorkbookLaporan(hasil, meta, sertakanDetail) {
    const workbook = XLSX.utils.book_new();
    const periode = `${formatTanggalLaporan(meta.start)} s.d. ${formatTanggalLaporan(meta.end)}`;

    tambahSheetLaporan(workbook, 'Ringkasan', [
        ['LAPORAN AKTIVITAS KEHADIRAN RELAWAN'],
        [],
        ['Periode', periode],
        ['Lokasi Proyek', meta.lokasi],
        ['Total Sesi', hasil.totalSesi],
        ['Sesi Pagi', hasil.totalPagi],
        ['Sesi Malam', hasil.totalMalam],
        ['Personel Hadir', hasil.personelHadir],
        ['Hari Aktif', hasil.hariAktif],
        ['Rata-Rata Sesi per Hari Aktif', hasil.rataRata],
        ['Tanggal Cetak', new Date().toLocaleString('id-ID')],
        [],
        ['Catatan', 'Laporan ini merekap aktivitas kehadiran relawan. Tidak ada status alfa, izin, atau sakit. Personel tanpa catatan tidak ditampilkan.'],
        ['Duplikat Slot Diabaikan', hasil.duplikat],
        ['Log Non-Reguler Diabaikan', hasil.diabaikan]
    ], [30, 76], 2);

    const aoaPersonel = [
        ['No', 'Nama Personel', 'NIP / ID', 'Organisasi', 'Zona', 'Pagi', 'Malam', 'Total Sesi', 'Hari Hadir', 'Rasio Hari Aktif (%)', 'Terakhir Hadir'],
        ...hasil.rows.map((row, indeks) => [
            indeks + 1,
            row.nama,
            row.nip || '-',
            row.organisasi,
            row.zona,
            row.pagi,
            row.malam,
            row.total,
            row.hariHadir,
            row.rasio,
            row.terakhir ? formatTanggalLaporan(row.terakhir) : '-'
        ])
    ];
    tambahSheetLaporan(workbook, 'Per Personel', aoaPersonel, [5, 32, 18, 28, 30, 9, 9, 12, 12, 18, 18], 0);

    const aoaHarian = [
        ['No', 'Tanggal', 'Hari', 'Pagi', 'Malam', 'Total Sesi', 'Personel Unik', 'Lokasi'],
        ...hasil.rowsHarian.map((row, indeks) => [
            indeks + 1,
            formatTanggalLaporan(row.tanggal),
            row.hari,
            row.pagi,
            row.malam,
            row.total,
            row.personelUnik,
            row.lokasi
        ])
    ];
    tambahSheetLaporan(workbook, 'Per Hari', aoaHarian, [5, 18, 12, 9, 9, 12, 14, 50], 0);

    const aaoLokasi = [
        ['No', 'Lokasi Proyek', 'Total Sesi', 'Personel Unik', 'Hari Aktif'],
        ...hasil.rowsLokasi.map((row, indeks) => [indeks + 1, row.lokasi, row.total, row.personelUnik, row.hariAktif])
    ];
    tambahSheetLaporan(workbook, 'Per Lokasi', aaoLokasi, [5, 48, 12, 14, 12], 0);

    const aaoInstansi = [
        ['No', 'Instansi / Organisasi', 'Personel Unik', 'Total Sesi', 'Hari Aktif'],
        ...hasil.rowsInstansi.map((row, indeks) => [indeks + 1, row.organisasi, row.personelUnik, row.total, row.hariAktif])
    ];
    tambahSheetLaporan(workbook, 'Per Instansi', aaoInstansi, [5, 40, 14, 12, 12], 0);

    if (sertakanDetail) {
        const aoaDetail = [
            ['No', 'Tanggal', 'Sesi', 'NIP / ID', 'Nama', 'Organisasi', 'Bidang', 'Lokasi'],
            ...hasil.logs.map((row, indeks) => [
                indeks + 1,
                formatTanggalLaporan(row.tanggal),
                row.sesi,
                row.nip || '-',
                row.nama || '-',
                row.organisasi || '-',
                row.bidang || '-',
                row.lokasi || '-'
            ])
        ];
        tambahSheetLaporan(workbook, 'Detail Log', aoaDetail, [5, 18, 10, 18, 30, 28, 26, 40], 0);
    }

    return workbook;
}

function exportLaporanExcel() {
    if (!pastikanLaporanSiap()) return;
    if (typeof XLSX === 'undefined') {
        showToast('Lib Excel belum dimuat, coba muat ulang halaman.', 'error');
        return;
    }

    try {
        const sertakanDetail = document.getElementById('lapSertakanDetail')?.checked === true;
        const workbook = susunWorkbookLaporan(lapHasil, lapMeta, sertakanDetail);
        XLSX.writeFile(workbook, namaFileLaporan('xlsx'));
        showToast(`Laporan ${lapHasil.personelHadir} personel berhasil diunduh.`, 'success');
    } catch (error) {
        console.error('Export Laporan Error:', error);
        showToast('Gagal menyusun file Excel laporan.', 'error');
    }
}

function selCsvLaporan(nilai) {
    return `"${String(nilai ?? '').replace(/"/g, '""')}"`;
}

function exportLaporanCSV() {
    if (!pastikanLaporanSiap()) return;
    if (!lapFilteredPersonel.length) {
        showToast('Tidak ada personel yang sesuai filter untuk diexport.', 'error');
        return;
    }

    const headers = ['No', 'Nama', 'NIP', 'Organisasi', 'Zona', 'Pagi', 'Malam', 'Total Sesi', 'Hari Hadir', 'Rasio Hari Aktif (%)', 'Terakhir Hadir'];
    const rows = lapFilteredPersonel.map((row, indeks) => [
        indeks + 1,
        selCsvLaporan(row.nama),
        selCsvLaporan(row.nip || '-'),
        selCsvLaporan(row.organisasi),
        selCsvLaporan(row.zona),
        row.pagi,
        row.malam,
        row.total,
        row.hariHadir,
        row.rasio,
        selCsvLaporan(row.terakhir ? formatTanggalLaporan(row.terakhir) : '-')
    ]);

    const csv = '\uFEFF' + headers.join(',') + '\n' + rows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = namaFileLaporan('csv');
    document.body.appendChild(anchor);
    anchor.click();

    setTimeout(() => {
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    }, 0);

    showToast('Rekap personel berhasil diunduh sebagai CSV.', 'success');
}

function barisTabelCetakLaporan(headers, rows) {
    return `<table><thead><tr>${headers.map(header => `<th>${escapeHTML(header)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function cetakLaporan() {
    if (!pastikanLaporanSiap()) return;

    const jendela = window.open('', '_blank', 'width=1200,height=850');
    if (!jendela) {
        showToast('Popup cetak diblokir browser. Izinkan popup untuk mencetak.', 'error');
        return;
    }

    const periode = `${formatTanggalPanjangLaporan(lapMeta.start)} s.d. ${formatTanggalPanjangLaporan(lapMeta.end)}`;
    const personelRows = lapHasil.rows.map((row, indeks) => `
        <tr>
            <td class="center">${indeks + 1}</td>
            <td>${escapeHTML(row.nama)}</td>
            <td>${escapeHTML(row.nip || '-')}</td>
            <td>${escapeHTML(row.organisasi)}</td>
            <td>${escapeHTML(row.zona)}</td>
            <td class="center">${row.pagi}</td>
            <td class="center">${row.malam}</td>
            <td class="center">${row.total}</td>
            <td class="center">${row.hariHadir}</td>
            <td class="center">${row.rasio.toFixed(1)}%</td>
            <td>${escapeHTML(row.terakhir ? formatTanggalLaporan(row.terakhir) : '-')}</td>
        </tr>
    `).join('');

    const harianRows = lapHasil.rowsHarian.map((row, indeks) => `
        <tr>
            <td class="center">${indeks + 1}</td>
            <td>${escapeHTML(formatTanggalLaporan(row.tanggal))}</td>
            <td>${escapeHTML(row.hari)}</td>
            <td class="center">${row.pagi}</td>
            <td class="center">${row.malam}</td>
            <td class="center">${row.total}</td>
            <td class="center">${row.personelUnik}</td>
            <td>${escapeHTML(row.lokasi)}</td>
        </tr>
    `).join('');

    const lokasiRows = lapHasil.rowsLokasi.map((row, indeks) => `
        <tr>
            <td class="center">${indeks + 1}</td>
            <td>${escapeHTML(row.lokasi)}</td>
            <td class="center">${row.total}</td>
            <td class="center">${row.personelUnik}</td>
            <td class="center">${row.hariAktif}</td>
        </tr>
    `).join('');

    const instansiRows = lapHasil.rowsInstansi.map((row, indeks) => `
        <tr>
            <td class="center">${indeks + 1}</td>
            <td>${escapeHTML(row.organisasi)}</td>
            <td class="center">${row.personelUnik}</td>
            <td class="center">${row.total}</td>
            <td class="center">${row.hariAktif}</td>
        </tr>
    `).join('');

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Laporan Kehadiran ${escapeHTML(lapMeta.start)} s.d. ${escapeHTML(lapMeta.end)}</title>
<style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; font-size: 11px; }
    h1 { font-size: 18px; margin: 0 0 4px; text-align: center; text-transform: uppercase; letter-spacing: .4px; }
    .sub { text-align: center; font-size: 12px; margin-bottom: 14px; color: #475569; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-bottom: 14px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
    .meta b { color: #334155; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
    .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
    .card span { display: block; color: #64748b; font-size: 9px; text-transform: uppercase; font-weight: bold; letter-spacing: .4px; }
    .card strong { display: block; font-size: 18px; margin-top: 2px; color: #1e293b; }
    h2 { font-size: 13px; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #cbd5e1; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 5px; vertical-align: top; }
    th { background: #eef2ff; color: #3730a3; font-size: 9px; text-transform: uppercase; text-align: left; }
    td { font-size: 9px; }
    .center { text-align: center; }
    .note { margin-top: 12px; padding: 8px 10px; border: 1px solid #fcd34d; background: #fffbeb; color: #92400e; border-radius: 6px; font-size: 9px; }
    .footer { margin-top: 12px; display: flex; justify-content: space-between; color: #64748b; font-size: 9px; }
</style>
</head>
<body>
    <h1>Laporan Aktivitas Kehadiran Relawan</h1>
    <div class="sub">RelawanSync V2</div>
    <div class="meta">
        <div><b>Periode:</b> ${escapeHTML(periode)}</div>
        <div><b>Lokasi:</b> ${escapeHTML(lapMeta.lokasi === 'Semua' ? 'Semua Lokasi' : lapMeta.lokasi)}</div>
        <div><b>Dicetak:</b> ${escapeHTML(new Date().toLocaleString('id-ID'))}</div>
    </div>
    <div class="cards">
        <div class="card"><span>Total Sesi</span><strong>${lapHasil.totalSesi}</strong></div>
        <div class="card"><span>Personel Hadir</span><strong>${lapHasil.personelHadir}</strong></div>
        <div class="card"><span>Hari Aktif</span><strong>${lapHasil.hariAktif}</strong></div>
        <div class="card"><span>Rata-rata / Hari</span><strong>${lapHasil.rataRata}</strong></div>
    </div>

    <h2>Rekap Per Personel</h2>
    ${barisTabelCetakLaporan(['No', 'Nama', 'NIP / ID', 'Organisasi', 'Zona', 'Pagi', 'Malam', 'Total', 'Hari Hadir', 'Rasio', 'Terakhir'], personelRows)}

    <h2>Rekap Per Hari</h2>
    ${barisTabelCetakLaporan(['No', 'Tanggal', 'Hari', 'Pagi', 'Malam', 'Total', 'Personel Unik', 'Lokasi'], harianRows)}

    <h2>Rekap Per Lokasi</h2>
    ${barisTabelCetakLaporan(['No', 'Lokasi', 'Total Sesi', 'Personel Unik', 'Hari Aktif'], lokasiRows)}

    <h2>Rekap Per Instansi</h2>
    ${barisTabelCetakLaporan(['No', 'Instansi', 'Personel Unik', 'Total Sesi', 'Hari Aktif'], instansiRows)}

    <div class="note">Laporan ini merekap aktivitas kehadiran relawan. Tidak ada status alfa, izin, atau sakit. Personel tanpa catatan tidak ditampilkan. Rasio hari aktif dihitung dari hari yang memiliki catatan, bukan jumlah hari kerja wajib.</div>
    <div class="footer"><span>RelawanSync V2</span><span>${escapeHTML(lapHasil.duplikat)} duplikat slot diabaikan</span></div>
</body>
</html>`;

    jendela.document.open();
    jendela.document.write(html);
    jendela.document.close();
    jendela.focus();
    setTimeout(() => jendela.print(), 350);
}

// ==========================================
// 9. DARK MODE CHART
// ==========================================

const _origToggleDarkModeLaporan = typeof toggleDarkMode === 'function' ? toggleDarkMode : null;
if (_origToggleDarkModeLaporan && typeof window !== 'undefined') {
    window.toggleDarkMode = function() {
        _origToggleDarkModeLaporan();
        if (typeof Chart !== 'undefined') {
            Chart.defaults.scale.grid.color = document.documentElement.classList.contains('dark') ? '#1e293b' : '#f1f5f9';
        }
        if (lapHasil) renderChartsLaporan();
    };
}
