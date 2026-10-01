// ==============================================
// TEMA GLOBAL RELAWANSYNC
// ----------------------------------------------
// Dijalankan dari <head> agar tema terpasang sebelum halaman dirender dan
// tidak menimbulkan kilatan warna terang saat mode gelap dipilih.
// ==============================================
(function setupTheme() {
    const STORAGE_KEY = 'relawan_theme';
    const LEGACY_KEY = 'relawan_dark_mode';
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    function readTheme() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved === 'light' || saved === 'dark') return saved;

            const legacy = localStorage.getItem(LEGACY_KEY);
            if (legacy === 'true') return 'dark';
            if (legacy === 'false') return 'light';
        } catch (error) {
            console.warn('Preferensi tema tidak dapat dibaca:', error);
        }
        return media.matches ? 'dark' : 'light';
    }

    function updateThemeControls() {
        const isDark = document.documentElement.classList.contains('dark');
        const nextTheme = isDark ? 'terang' : 'gelap';

        document.querySelectorAll('[data-theme-toggle], button[onclick="toggleDarkMode()"]')
            .forEach(button => {
            button.setAttribute('aria-pressed', String(isDark));
            button.setAttribute('aria-label', `Aktifkan mode ${nextTheme}`);
            button.title = `Aktifkan mode ${nextTheme}`;
        });

        document.querySelectorAll('[data-theme-label], #darkModeLabel').forEach(label => {
            label.textContent = isDark ? 'Mode Terang' : 'Mode Gelap';
        });

        document.querySelectorAll('[data-theme-icon], button[onclick="toggleDarkMode()"] > i:first-child')
            .forEach(icon => {
            icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        });
    }

    function applyTheme(theme, persist) {
        const isDark = theme === 'dark';
        document.documentElement.classList.toggle('dark', isDark);
        document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
        document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';

        if (persist) {
            try {
                localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
                // Dipertahankan untuk kompatibilitas dengan versi lama.
                localStorage.setItem(LEGACY_KEY, String(isDark));
            } catch (error) {
                console.warn('Preferensi tema tidak dapat disimpan:', error);
            }
        }

        updateThemeControls();

        if (typeof Chart !== 'undefined') {
            Chart.defaults.color = isDark ? '#cbd5e1' : '#475569';
            Chart.defaults.scale.grid.color = isDark ? '#334155' : '#d6d0c4';
        }

        window.dispatchEvent(new CustomEvent('relawan:themechange', {
            detail: { theme: isDark ? 'dark' : 'light' }
        }));
    }

    window.toggleDarkMode = function toggleDarkMode() {
        const nextTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        applyTheme(nextTheme, true);
    };

    window.updateDarkModeLabel = updateThemeControls;

    applyTheme(readTheme(), false);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateThemeControls, { once: true });
    } else {
        updateThemeControls();
    }

    media.addEventListener('change', event => {
        let hasSavedPreference = false;
        try {
            hasSavedPreference = localStorage.getItem(STORAGE_KEY) !== null ||
                localStorage.getItem(LEGACY_KEY) !== null;
        } catch (error) {
            console.warn('Preferensi tema tidak dapat diperiksa:', error);
        }
        if (!hasSavedPreference) applyTheme(event.matches ? 'dark' : 'light', false);
    });
})();
