import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'js/table-core.js'), 'utf8');
const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'js/table-core.js' });
const table = context.window.RelawanTable;

test('table-core memfilter berdasarkan keyword dan filter kolom', () => {
    const rows = [
        { nama: 'Budi Santoso', status: 'Aktif', desa: 'Sukamaju' },
        { nama: 'Siti Aminah', status: 'Nonaktif', desa: 'Sukamaju' },
        { nama: 'Agus', status: null, desa: 'Mekarsari' }
    ];

    assert.deepEqual(
        table.filterRows(rows, { keyword: 'suka', fields: ['nama', 'desa'] }).map(row => row.nama),
        ['Budi Santoso', 'Siti Aminah']
    );
    assert.deepEqual(
        table.filterRows(rows, { columnFilters: { status: ['-'] } }).map(row => row.nama),
        ['Agus']
    );
    assert.deepEqual(
        table.filterRows(rows, { keyword: 'agus', fields: ['nama'], columnFilters: { desa: ['Mekarsari'] } }).map(row => row.nama),
        ['Agus']
    );
});

test('table-core mengurutkan angka dan teks tanpa mengubah array asli', () => {
    const rows = [
        { nama: 'Budi', poin: 20 },
        { nama: 'Agus', poin: 5 },
        { nama: 'Siti', poin: 100 }
    ];

    assert.deepEqual(Array.from(table.sortRows(rows, 'poin', 'asc')).map(row => row.poin), [5, 20, 100]);
    assert.deepEqual(Array.from(table.sortRows(rows, 'poin', 'desc')).map(row => row.poin), [100, 20, 5]);
    assert.deepEqual(Array.from(table.sortRows(rows, 'nama', 'asc')).map(row => row.nama), ['Agus', 'Budi', 'Siti']);
    assert.deepEqual(rows.map(row => row.nama), ['Budi', 'Agus', 'Siti']);
});

test('table-core memotong halaman dan menjepit nomor halaman', () => {
    const rows = Array.from({ length: 23 }, (_, index) => ({ id: index + 1 }));

    assert.deepEqual(table.paginate(rows, 2, 10).rows.map(row => row.id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    assert.deepEqual(table.paginate(rows, 99, 10).rows.map(row => row.id), [21, 22, 23]);
    assert.deepEqual(table.paginate(rows, 99, 10).page, 3);
    assert.deepEqual(table.paginate(rows, 99, 10).totalPages, 3);
    assert.equal(table.paginate(rows, 1, 10).startLabel, 1);
    assert.equal(table.paginate([], 1, 10).startLabel, 0);
});

test('table-core memperbarui kontrol paginasi tanpa DOM nyata', () => {
    const controls = {
        info: { textContent: '' },
        pageInfo: { textContent: '' },
        prev: { disabled: false },
        next: { disabled: false }
    };

    const state = table.updatePagination({
        ...controls,
        total: 45,
        page: 2,
        pageSize: 10,
        label: 'relawan'
    });

    assert.equal(controls.info.textContent, 'Baris 11-20 dari 45 relawan');
    assert.equal(controls.pageInfo.textContent, 'Halaman 2 / 5');
    assert.equal(controls.prev.disabled, false);
    assert.equal(controls.next.disabled, false);
    assert.equal(state.totalPages, 5);

    table.updatePagination({
        ...controls,
        total: 0,
        page: 1,
        pageSize: 10,
        label: 'relawan'
    });
    assert.equal(controls.prev.disabled, true);
    assert.equal(controls.next.disabled, true);
});

test('table-core meng-escape CSV dengan benar', () => {
    assert.equal(table.csvCell('Budi'), '"Budi"');
    assert.equal(table.csvCell('Nama "Lengkap"'), '"Nama ""Lengkap"""');
    assert.equal(table.csvCell(null), '""');
    assert.equal(table.csvCell(12), '"12"');
});

test('table-core menyediakan state baris kosong, loading, dan error', () => {
    assert.match(table.emptyRow(4, 'Tidak ada data'), /colspan="4"/);
    assert.match(table.emptyRow(4, 'Tidak ada data'), /Tidak ada data/);
    assert.match(table.loadingRow(3), /fa-spinner/);
    assert.match(table.errorRow(2, 'Gagal memuat'), /text-red-500/);
});

test('table-core merender baris generik dan state kosong', () => {
    const html = table.renderRows([{ nama: 'Budi' }], {
        columns: [
            { className: 'nomor', render: (row, index) => index + 1 },
            { className: 'nama', key: 'nama' }
        ]
    });
    assert.match(html, /<tr class="hover:bg-slate-50/);
    assert.match(html, /<td class="nomor">1<\/td>/);
    assert.match(html, /<td class="nama">Budi<\/td>/);
    assert.match(table.renderRows([], { colspan: 3, emptyMessage: 'Kosong' }), /colspan="3"/);
    assert.match(table.renderRows([], { colspan: 3, emptyMessage: 'Kosong' }), /Kosong/);
});

test('halaman tabel memuat table-core sebelum skrip halamannya', () => {
    const pages = {
        'index.html': 'js/dashboard.js',
        'input.html': 'js/input.js',
        'kalender.html': 'js/kalender.js',
        'laporan.html': 'js/laporan.js',
        'master.html': 'js/master.js',
        'peringkat.html': 'js/peringkat.js',
        'riwayat.html': 'js/riwayat.js',
        'seragam.html': 'js/seragam.js',
        'statistik.html': 'js/statistik.js'
    };

    for (const [page, script] of Object.entries(pages)) {
        const html = readFileSync(resolve(root, page), 'utf8');
        const coreIndex = html.indexOf('js/table-core.js');
        const pageIndex = html.indexOf(script);
        assert.notEqual(coreIndex, -1, `${page} belum memuat table-core.js`);
        assert.notEqual(pageIndex, -1, `${page} belum memuat ${script}`);
        assert.ok(coreIndex < pageIndex, `${page} memuat table-core.js setelah skrip halaman`);
    }

    assert.match(readFileSync(resolve(root, 'sw.js'), 'utf8'), /"js\/table-core\.js"/);
});
