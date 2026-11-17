// ==========================================
// UTILITAS TABEL BERSAMA
// Dipakai bertahap oleh halaman daftar. Tidak mengambil data sendiri:
// setiap halaman tetap bertanggung jawab atas sumber data dan business logic.
// ==========================================
(function (global) {
    'use strict';

    function escapeHTML(value) {
        if (typeof global.escapeHTML === 'function') return global.escapeHTML(value);
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        if (typeof global.escapeAttribute === 'function') return global.escapeAttribute(value);
        return escapeHTML(value);
    }

    function normalizeText(value) {
        return String(value ?? '').toLowerCase().trim();
    }

    function filterValue(value) {
        return value === null || value === undefined || value === '' ? '-' : String(value);
    }

    function getField(row, key, accessor) {
        if (typeof accessor === 'function') return accessor(row, key);
        return row?.[key];
    }

    function compareValues(a, b, options = {}) {
        const aEmpty = a === null || a === undefined || a === '';
        const bEmpty = b === null || b === undefined || b === '';
        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return 1;
        if (bEmpty) return -1;

        // Angka asli diurutkan numerik; teks tetap mengikuti urutan lokal
        // seperti perilaku tabel lama agar NIP/tanggal tidak berubah urutan.
        if (typeof a === 'number' && typeof b === 'number') return a - b;

        return String(a).localeCompare(String(b), 'id', {
            numeric: Boolean(options.numeric),
            sensitivity: 'base'
        });
    }

    function filterRows(rows, options = {}) {
        const source = Array.isArray(rows) ? rows : [];
        const keyword = normalizeText(options.keyword);
        const fields = Array.isArray(options.fields) ? options.fields : [];
        const filters = options.columnFilters && typeof options.columnFilters === 'object'
            ? options.columnFilters
            : {};
        const accessor = options.accessor;

        return source.filter(row => {
            if (keyword) {
                const haystack = fields.map(field => normalizeText(getField(row, field, accessor))).join(' ');
                if (!haystack.includes(keyword)) return false;
            }

            for (const [key, allowed] of Object.entries(filters)) {
                if (!Array.isArray(allowed) || allowed.length === 0) continue;
                if (!allowed.includes(filterValue(getField(row, key, accessor)))) return false;
            }

            return true;
        });
    }

    function sortRows(rows, key, direction = 'asc', accessor, options = {}) {
        const result = Array.isArray(rows) ? [...rows] : [];
        if (!key) return result;
        if (accessor && typeof accessor === 'object' && typeof accessor !== 'function') {
            options = accessor;
            accessor = undefined;
        }
        const multiplier = direction === 'desc' ? -1 : 1;
        return result.sort((a, b) => {
            const resultCompare = compareValues(
                getField(a, key, accessor),
                getField(b, key, accessor),
                options
            );
            return resultCompare * multiplier;
        });
    }

    function paginate(rows, page = 1, pageSize = 50) {
        const source = Array.isArray(rows) ? rows : [];
        const total = source.length;
        const size = Math.max(1, Number(pageSize) || 50);
        const totalPages = Math.max(1, Math.ceil(total / size));
        const currentPage = Math.min(totalPages, Math.max(1, Number(page) || 1));
        const start = (currentPage - 1) * size;
        const end = Math.min(start + size, total);

        return {
            rows: source.slice(start, end),
            total,
            page: currentPage,
            pageSize: size,
            totalPages,
            start,
            end,
            startLabel: total ? start + 1 : 0
        };
    }

    function resolveElement(target) {
        if (!target) return null;
        if (typeof target === 'string') return global.document?.getElementById(target) || null;
        return target;
    }

    function updatePagination(options = {}) {
        const total = Math.max(0, Number(options.total) || 0);
        const pageSize = Math.max(1, Number(options.pageSize) || 50);
        const totalPages = Math.max(1, Number(options.totalPages) || Math.ceil(total / pageSize));
        const page = Math.min(totalPages, Math.max(1, Number(options.page) || 1));
        const start = total ? (page - 1) * pageSize + 1 : 0;
        const end = Math.min(page * pageSize, total);
        const label = options.label || 'data';
        const pageInfo = resolveElement(options.pageInfo);
        const info = resolveElement(options.info);
        const prev = resolveElement(options.prev);
        const next = resolveElement(options.next);
        const state = {
            total,
            page,
            pageSize,
            totalPages,
            start,
            end,
            startLabel: total ? start : 0,
            showAll: Boolean(options.showAll)
        };

        if (info) {
            if (typeof options.formatInfo === 'function') {
                info.textContent = options.formatInfo(state);
            } else if (options.showAll) {
                info.textContent = `${total.toLocaleString('id-ID')} ${label} • semua hasil terfilter`;
            } else {
                info.textContent = `Baris ${start.toLocaleString('id-ID')}-${end.toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')} ${label}`;
            }
        }

        if (pageInfo) {
            pageInfo.textContent = options.showAll
                ? 'Semua hasil terfilter'
                : `Halaman ${page} / ${totalPages}`;
        }

        if (prev) prev.disabled = Boolean(options.showAll) || page <= 1;
        if (next) next.disabled = Boolean(options.showAll) || page >= totalPages;

        return state;
    }

    function stateRow(type, colspan, message) {
        const safeMessage = escapeHTML(message || 'Tidak ada data.');
        if (type === 'loading') {
            return `<tr><td colspan="${Number(colspan) || 1}" class="p-8 text-center text-slate-400 font-medium"><i class="fa-solid fa-spinner fa-spin mr-2"></i>${safeMessage}</td></tr>`;
        }
        if (type === 'error') {
            return `<tr><td colspan="${Number(colspan) || 1}" class="p-8 text-center text-red-500 font-bold">${safeMessage}</td></tr>`;
        }
        return `<tr><td colspan="${Number(colspan) || 1}" class="p-8 text-center text-slate-400 font-medium">${safeMessage}</td></tr>`;
    }

    function emptyRow(colspan, message) {
        return stateRow('empty', colspan, message);
    }

    function loadingRow(colspan, message = 'Memuat data...') {
        return stateRow('loading', colspan, message);
    }

    function errorRow(colspan, message) {
        return stateRow('error', colspan, message);
    }

    function renderRows(rows, options = {}) {
        const source = Array.isArray(rows) ? rows : [];
        const columns = Array.isArray(options.columns) ? options.columns : [];
        if (!source.length) {
            return emptyRow(options.colspan || Math.max(1, columns.length), options.emptyMessage || 'Tidak ada data.');
        }

        const rowClass = typeof options.rowClass === 'function'
            ? options.rowClass
            : () => options.rowClass !== undefined
                ? options.rowClass
                : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors';

        return source.map((row, index) => {
            const cells = columns.map(column => {
                const value = typeof column.render === 'function'
                    ? column.render(row, index, options)
                    : escapeHTML(getField(row, column.key, options.accessor));
                return `<td class="${column.className || ''}">${value ?? ''}</td>`;
            }).join('');
            const rowAttributes = typeof options.rowAttributes === 'function'
                ? options.rowAttributes(row, index)
                : (options.rowAttributes || '');
            return `<tr class="${rowClass(row, index)}" ${rowAttributes}>${cells}</tr>`;
        }).join('');
    }

    function csvCell(value) {
        return `"${String(value ?? '').replace(/"/g, '""')}"`;
    }

    function downloadCsv(filename, headers, rows) {
        if (!global.document) return false;
        const headerLine = Array.isArray(headers) ? headers.map(csvCell).join(',') : '';
        const body = (Array.isArray(rows) ? rows : [])
            .map(row => (Array.isArray(row) ? row : []).map(csvCell).join(','))
            .join('\n');
        const csv = `\uFEFF${headerLine}${headerLine && body ? '\n' : ''}${body}`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = global.document.createElement('a');
        link.href = url;
        link.download = filename;
        global.document.body.appendChild(link);
        link.click();
        global.document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 0);
        return true;
    }

    function downloadXlsx(filename, sheets) {
        if (!global.document) return false;
        if (!global.XLSX) return false;
        const workbook = global.XLSX.utils.book_new();
        (Array.isArray(sheets) ? sheets : []).forEach(sheet => {
            const rows = Array.isArray(sheet.rows) ? sheet.rows : sheet.aoa;
            if (!Array.isArray(rows)) return;
            const worksheet = global.XLSX.utils.aoa_to_sheet(rows);
            if (Array.isArray(sheet.widths) && sheet.widths.length) {
                worksheet['!cols'] = sheet.widths.map(width => ({ wch: Number(width) || 10 }));
            }
            global.XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name || 'Sheet1');
        });
        global.XLSX.writeFile(workbook, filename);
        return true;
    }

    function openPrintWindow(title, bodyHtml, options = {}) {
        if (!global.document) return false;
        const popup = global.open('', '_blank', options.windowFeatures || 'width=1100,height=800');
        if (!popup) return false;
        const orientation = options.landscape ? 'landscape' : 'portrait';
        const subtitle = options.subtitle
            ? `<p class="meta">${escapeHTML(options.subtitle)}</p>`
            : '';
        const extraStyle = options.styles || '';
        popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(title)}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:28px}h1{font-size:20px;margin:0}.meta{font-size:11px;color:#64748b;margin:6px 0 18px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#f1f5f9}@page{size:A4 ${orientation};margin:10mm}${extraStyle}</style></head><body><h1>${escapeHTML(title)}</h1>${subtitle}${bodyHtml}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
        popup.document.close();
        return true;
    }

    function closeColumnFilter() {
        const popup = global.document?.getElementById('excelFilterPopup');
        if (popup) popup.classList.add('hidden');
    }

    function openColumnFilter(options = {}) {
        if (!global.document) return;
        const popup = global.document.getElementById(options.popupId || 'excelFilterPopup');
        if (!popup) return;

        const event = options.event;
        const trigger = event?.currentTarget;
        if (trigger && typeof trigger.getBoundingClientRect === 'function') {
            const rect = trigger.getBoundingClientRect();
            popup.style.top = `${rect.bottom + global.scrollY + 5}px`;
            popup.style.left = `${rect.left + global.scrollX - 180}px`;
            popup.style.width = '280px';
        }

        const columnKey = options.columnKey;
        const selected = Array.isArray(options.selected) ? options.selected : [];
        const sourceRows = Array.isArray(options.rows) ? options.rows : [];
        const values = Array.isArray(options.values)
            ? options.values
            : [...new Set(sourceRows.map(row => filterValue(getField(row, columnKey, options.accessor))))].sort((a, b) => String(a).localeCompare(String(b), 'id', { numeric: true }));

        let html = `
            <div class="font-bold text-slate-700 dark:text-slate-200 mb-2 pb-1 border-b border-slate-100 dark:border-slate-600 flex justify-between items-center text-xs">
                <span>${escapeHTML(options.title || 'Filter & Urutkan')}</span>
                <button type="button" data-filter-action="reset" class="text-primary cursor-pointer underline hover:text-indigo-700">Reset</button>
            </div>
            <div class="space-y-1 mb-2 text-xs">
                <button type="button" data-filter-action="sort-asc" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2"><i class="fa-solid fa-arrow-down-a-z text-primary"></i> Urutkan A ke Z</button>
                <button type="button" data-filter-action="sort-desc" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2"><i class="fa-solid fa-arrow-up-z-a text-primary"></i> Urutkan Z ke A</button>
            </div>
            <div class="mb-2 relative">
                <i class="fa-solid fa-search absolute left-2.5 top-2 text-slate-400 text-[10px]"></i>
                <input type="text" data-filter-action="search" placeholder="${escapeAttribute(options.placeholder || 'Cari data...')}" class="w-full bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none text-slate-800 dark:text-slate-100 focus:border-primary">
            </div>
            <div class="flex justify-between items-center mb-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 px-1">
                <button type="button" data-filter-action="select-all" class="cursor-pointer hover:underline">Pilih Semua</button>
                <span class="text-slate-300 dark:text-slate-600">|</span>
                <button type="button" data-filter-action="clear-all" class="cursor-pointer hover:underline text-red-500">Hapus Semua</button>
            </div>
            <div class="max-h-44 overflow-y-auto space-y-1 pr-1 custom-scroll border border-slate-100 dark:border-slate-600 p-1 rounded-lg bg-slate-50/50 dark:bg-slate-700/50" data-filter-list>
        `;

        values.forEach(value => {
            const checked = selected.length === 0 || selected.includes(value) ? 'checked' : '';
            html += `
                <label class="table-filter-item flex items-center gap-2 p-1 hover:bg-white dark:hover:bg-slate-600 rounded cursor-pointer text-xs">
                    <input type="checkbox" value="${escapeAttribute(value)}" class="table-filter-chk w-3.5 h-3.5 accent-primary rounded shrink-0" ${checked}>
                    <span class="truncate text-slate-700 dark:text-slate-200 font-medium">${escapeHTML(value)}</span>
                </label>
            `;
        });

        html += '</div>';
        popup.innerHTML = html;
        popup.classList.remove('hidden');

        const apply = () => {
            const checked = [...popup.querySelectorAll('.table-filter-chk')]
                .filter(checkbox => checkbox.checked)
                .map(checkbox => checkbox.value);
            options.onApply?.(checked, columnKey);
        };

        popup.querySelector('[data-filter-action="reset"]')?.addEventListener('click', () => {
            options.onReset?.(columnKey);
            closeColumnFilter();
        });

        popup.querySelector('[data-filter-action="sort-asc"]')?.addEventListener('click', () => {
            options.onSort?.(columnKey, 'asc');
            closeColumnFilter();
        });

        popup.querySelector('[data-filter-action="sort-desc"]')?.addEventListener('click', () => {
            options.onSort?.(columnKey, 'desc');
            closeColumnFilter();
        });

        popup.querySelector('[data-filter-action="search"]')?.addEventListener('input', eventInput => {
            const keyword = normalizeText(eventInput.target.value);
            popup.querySelectorAll('.table-filter-item').forEach(label => {
                label.style.display = normalizeText(label.textContent).includes(keyword) ? 'flex' : 'none';
            });
        });

        const toggleVisible = (status) => {
            popup.querySelectorAll('.table-filter-item').forEach(label => {
                if (label.style.display === 'none') return;
                const checkbox = label.querySelector('.table-filter-chk');
                if (checkbox) checkbox.checked = status;
            });
            apply();
        };

        popup.querySelector('[data-filter-action="select-all"]')?.addEventListener('click', () => toggleVisible(true));
        popup.querySelector('[data-filter-action="clear-all"]')?.addEventListener('click', () => toggleVisible(false));
        popup.querySelectorAll('.table-filter-chk').forEach(checkbox => {
            checkbox.addEventListener('change', apply);
        });
    }

    global.RelawanTable = {
        normalizeText,
        filterValue,
        getField,
        compareValues,
        filterRows,
        sortRows,
        paginate,
        updatePagination,
        emptyRow,
        loadingRow,
        errorRow,
        stateRow,
        renderRows,
        csvCell,
        downloadCsv,
        downloadXlsx,
        openPrintWindow,
        openColumnFilter,
        closeColumnFilter
    };
})(typeof window !== 'undefined' ? window : globalThis);
