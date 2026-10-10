// ================================================================
// KONTRAK DOMAIN TERPUSAT RELAWANSYNC
// Satu sumber istilah untuk proyek, sesi, zona, personel, dan seragam.
// ================================================================
(function pasangKontrakDomain(global) {
    'use strict';

    const PROYEK_KHUSUS = Object.freeze([
        'Perpustakaan Tashawwuf',
        "Masjid Raya Fatchan Mubiina Chaddun 'Adhiim",
        'Monumen Semboyan Sang Mursyid',
        "Kanal Ta'at",
        'Gapura Syukur'
    ]);

    const SESI = Object.freeze(['Pagi', 'Malam']);
    const ZONA = Object.freeze({
        zona_1: Object.freeze({ label: 'Zona 1 — Jawa Timur & Bali', wilayah: 'Jawa Timur, Bali' }),
        zona_2: Object.freeze({ label: 'Zona 2 — Jawa Tengah & DIY', wilayah: 'Jawa Tengah, DI Yogyakarta' }),
        zona_3: Object.freeze({ label: 'Zona 3 — Jawa Barat, Jakarta & Banten', wilayah: 'Jawa Barat, DKI Jakarta, Banten' }),
        zona_4: Object.freeze({ label: 'Zona 4 — Sumatera & Kalimantan', wilayah: 'Sumatera, Kalimantan' })
    });
    const STATUS_SERAGAM = Object.freeze({
        belum_memenuhi: 'Belum memenuhi',
        memenuhi_syarat: 'Memenuhi syarat',
        direncanakan: 'Direncanakan',
        menunggu_stok: 'Menunggu stok/ukuran',
        siap_diserahkan: 'Siap diserahkan',
        sudah_diserahkan: 'Sudah diserahkan'
    });
    const PENGUASAAN_SERAGAM = Object.freeze({
        belum_memiliki: 'Belum memiliki',
        dipegang_personel: 'Dipegang personel',
        dititipkan_kantor: 'Dititipkan di kantor',
        perlu_diserahkan_kembali: 'Perlu diserahkan kembali',
        rusak_hilang: 'Rusak/hilang',
        menunggu_penggantian: 'Menunggu penggantian'
    });
    const UKURAN_ATASAN = Object.freeze(['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Khusus']);
    const UKURAN_BAWAHAN = Object.freeze(['20', '22', '24', '26', '28', '30', '32', '34', '36', '38', '40', 'Khusus']);

    function normalisasiKunci(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
    }

    function normalisasiSesi(value) {
        const sesi = normalisasiKunci(value);
        if (sesi === 'PAGI' || sesi === 'SIANG') return 'Pagi';
        if (sesi === 'MALAM') return 'Malam';
        return String(value || '').trim();
    }

    function kategoriProyek(value) {
        return PROYEK_KHUSUS.includes(String(value || '').trim()) ? 'khususul_khusus' : 'lainnya';
    }

    function labelZona(value) {
        return ZONA[String(value || '').trim().toLowerCase()]?.label || 'Zona belum diisi';
    }

    function personelReguler(row) {
        return String(row?.kategori_personel || 'reguler').toLowerCase() !== 'khusus';
    }

    function urutkanUkuranSeragam(jenis, values = []) {
        const unik = new Map();
        values.forEach(value => {
            const label = String(value || '').trim();
            const key = normalisasiKunci(label);
            if (label && !unik.has(key)) unik.set(key, label);
        });

        function peringkatAtasan(value) {
            const key = normalisasiKunci(value).replace(/\s+/g, '');
            if (key === 'XS') return 10;
            if (key === 'S') return 20;
            if (key === 'M') return 30;
            if (key === 'L') return 40;
            if (/^X+L$/.test(key)) return 40 + ((key.length - 1) * 10);
            const angkaXL = key.match(/^(\d+)XL$/);
            if (angkaXL) return 40 + (Number(angkaXL[1]) * 10);
            return 500;
        }

        return Array.from(unik.values()).sort((a, b) => {
            const keyA = normalisasiKunci(a);
            const keyB = normalisasiKunci(b);
            if (keyA === 'KHUSUS') return keyB === 'KHUSUS' ? 0 : 1;
            if (keyB === 'KHUSUS') return -1;

            if (jenis === 'bawahan') {
                const angkaA = /^\d+(?:[.,]\d+)?$/.test(keyA) ? Number(keyA.replace(',', '.')) : null;
                const angkaB = /^\d+(?:[.,]\d+)?$/.test(keyB) ? Number(keyB.replace(',', '.')) : null;
                if (angkaA !== null && angkaB !== null && angkaA !== angkaB) return angkaA - angkaB;
                if (angkaA !== null && angkaB === null) return -1;
                if (angkaA === null && angkaB !== null) return 1;
            } else {
                const rankA = peringkatAtasan(a);
                const rankB = peringkatAtasan(b);
                if (rankA !== rankB) return rankA - rankB;
            }

            return String(a).localeCompare(String(b), 'id-ID', { numeric: true, sensitivity: 'base' });
        });
    }

    global.RelawanDomain = Object.freeze({
        PROYEK_KHUSUS,
        SESI,
        ZONA,
        STATUS_SERAGAM,
        PENGUASAAN_SERAGAM,
        UKURAN_ATASAN,
        UKURAN_BAWAHAN,
        normalisasiKunci,
        normalisasiSesi,
        kategoriProyek,
        labelZona,
        personelReguler,
        urutkanUkuranSeragam,
        SUMBER_PERSONEL: 'v_personel_terpadu_v3',
        SUMBER_SERAGAM: 'v_status_seragam_set_v2'
    });
})(window);
