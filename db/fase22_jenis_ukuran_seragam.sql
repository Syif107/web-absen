-- FASE 22: master jenis ukuran seragam dinamis.
-- Jalankan setelah Fase 17. Ukuran baru disimpan dengan saldo awal 0 dan
-- selanjutnya dapat dipakai oleh transaksi stok serta profil personel.

BEGIN;

CREATE OR REPLACE FUNCTION public.tambah_jenis_ukuran_seragam(
    p_jenis text,
    p_ukuran text,
    p_catatan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_jenis text := lower(trim(coalesce(p_jenis, '')));
    v_input text := regexp_replace(trim(coalesce(p_ukuran, '')), '\s+', ' ', 'g');
    v_ukuran text;
    v_existing text;
BEGIN
    IF NOT public.fase17_admin() THEN
        RAISE EXCEPTION 'Hanya admin yang boleh menambah jenis ukuran seragam';
    END IF;
    IF v_jenis NOT IN ('atasan', 'bawahan') THEN
        RAISE EXCEPTION 'Jenis seragam harus Atasan atau Bawahan';
    END IF;
    IF v_input = '' THEN
        RAISE EXCEPTION 'Nama ukuran wajib diisi';
    END IF;
    IF char_length(v_input) > 30 THEN
        RAISE EXCEPTION 'Nama ukuran maksimal 30 karakter';
    END IF;

    -- Cegah ukuran ganda hanya karena perbedaan kapitalisasi atau spasi.
    SELECT ukuran INTO v_existing
    FROM public.stok_item_seragam
    WHERE jenis = v_jenis
      AND upper(regexp_replace(trim(ukuran), '\s+', ' ', 'g')) = upper(v_input)
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'dibuat', false,
            'jenis', v_jenis,
            'ukuran', v_existing,
            'pesan', 'Ukuran sudah tersedia'
        );
    END IF;

    v_ukuran := CASE WHEN upper(v_input) = 'KHUSUS' THEN 'Khusus' ELSE upper(v_input) END;
    INSERT INTO public.stok_item_seragam (jenis, ukuran, jumlah_tersedia, catatan)
    VALUES (v_jenis, v_ukuran, 0, nullif(trim(p_catatan), ''));

    INSERT INTO public.audit_operasional_fase17 (aksi, referensi_hash, ringkasan, alasan)
    VALUES (
        'tambah_jenis_ukuran_seragam',
        md5(v_jenis || '|' || v_ukuran),
        jsonb_build_object('jenis', v_jenis, 'ukuran', v_ukuran, 'saldo_awal', 0),
        coalesce(nullif(trim(p_catatan), ''), 'Menambah jenis ukuran seragam')
    );

    RETURN jsonb_build_object(
        'ok', true,
        'dibuat', true,
        'jenis', v_jenis,
        'ukuran', v_ukuran,
        'saldo', 0
    );
END;
$$;

REVOKE ALL ON FUNCTION public.tambah_jenis_ukuran_seragam(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tambah_jenis_ukuran_seragam(text,text,text) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

SELECT jenis, ukuran, jumlah_tersedia
FROM public.stok_item_seragam
ORDER BY jenis, ukuran;
