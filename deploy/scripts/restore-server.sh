#!/usr/bin/env bash
# ============================================================
# Restore hasil dump Supabase ke server Linux kantor.
# ------------------------------------------------------------
# Urutan penting:
#   1. Postgres + GoTrue hidup (GoTrue membuat skema auth)
#   2. auth.users + auth.identities
#   3. schema public (FK public.profil -> auth.users sudah aman)
#   4. grant + verifikasi
#
# Pemakaian:
#   bash deploy/scripts/restore-server.sh deploy/backup/supabase-YYYYmmdd-HHMMSS
#
# Skrip menolak menimpa database yang sudah berisi data. Untuk mengulang,
# kosongkan volume lebih dulu (lihat README bagian 5).
# ============================================================
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Pemakaian: bash $0 <folder-hasil-dump>"
    exit 1
fi

BACKUP_DIR="$(cd "$1" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE=(docker compose --env-file "$DEPLOY_DIR/.env" -f "$DEPLOY_DIR/docker-compose.yml")

for file in public.dump auth_users.sql; do
    if [[ ! -s "$BACKUP_DIR/$file" ]]; then
        echo "File $BACKUP_DIR/$file tidak ditemukan atau kosong."
        exit 1
    fi
done

if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
    echo "deploy/.env belum ada. Salin dari .env.example dan isi dulu."
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose plugin tidak tersedia."
    exit 1
fi

psql_db() {
    "${COMPOSE[@]}" exec -T db psql -U postgres -d postgres "$@"
}

echo "==> Menyalakan Postgres dan Auth (GoTrue)"
"${COMPOSE[@]}" up -d db auth

echo "==> Menunggu skema auth dibuat GoTrue"
for _ in $(seq 1 60); do
    if psql_db -Atc "select to_regclass('auth.users') is not null" 2>/dev/null | grep -q '^t$'; then
        break
    fi
    sleep 2
done

if ! psql_db -Atc "select to_regclass('auth.users') is not null" | grep -q '^t$'; then
    echo "Skema auth.users tidak muncul. Cek log: docker compose logs auth"
    exit 1
fi

AUTH_COUNT="$(psql_db -Atc 'select count(*) from auth.users' | tr -d '\r')"
PUBLIC_ADA="$(psql_db -Atc "select to_regclass('public.master_relawan') is not null" | tr -d '\r')"
PUBLIC_COUNT=0
if [[ "$PUBLIC_ADA" == "t" ]]; then
    PUBLIC_COUNT="$(psql_db -Atc 'select count(*) from public.master_relawan' | tr -d '\r')"
fi

if [[ "$AUTH_COUNT" != "0" || "$PUBLIC_COUNT" != "0" ]]; then
    cat <<MSG
Database sudah berisi data (auth.users=$AUTH_COUNT, master_relawan=$PUBLIC_COUNT).
Restore dibatalkan agar data tidak tertimpa.

Untuk mengulang dari kosong:
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
  docker volume rm relawansync_db_data relawansync_db_config
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d db auth
  bash deploy/scripts/restore-server.sh "$BACKUP_DIR"
MSG
    exit 1
fi

echo "==> Menghentikan layanan penulis selama restore"
"${COMPOSE[@]}" stop auth rest caddy >/dev/null 2>&1 || true

# Image Supabase membuat schema public kosong saat inisialisasi, sedangkan dump
# format custom juga membawa CREATE SCHEMA public. Hapus schema kosong tersebut
# agar pg_restore tidak berhenti dengan "schema public already exists".
echo "==> Menyiapkan schema public kosong"
psql_db -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE;'

echo "==> Memasang extension yang diperlukan"
if [[ -f "$BACKUP_DIR/extensions.txt" ]]; then
    while IFS='|' read -r ext schema; do
        ext="${ext%$'\r'}"
        schema="${schema%$'\r'}"
        [[ -z "$ext" ]] && continue
        if [[ ! "$ext" =~ ^[a-zA-Z0-9_]+$ || ! "$schema" =~ ^[a-zA-Z0-9_]+$ ]]; then
            echo "  lewati nama extension tidak valid: $ext / $schema"
            continue
        fi
        case "$ext" in
            pgcrypto|uuid-ossp|unaccent|pg_trgm|citext|btree_gin|btree_gist|pgjwt|pg_net)
                if psql_db -c \
                    "CREATE SCHEMA IF NOT EXISTS \"$schema\"; CREATE EXTENSION IF NOT EXISTS \"$ext\" WITH SCHEMA \"$schema\";" \
                    >/dev/null 2>&1; then
                    echo "  siap: $ext ($schema)"
                else
                    echo "  perhatian: gagal memasang '$ext'; lanjut, cek manual bila dipakai."
                fi
                ;;
            plpgsql|pg_stat_statements|supabase_vault|pgsodium)
                ;;
            *)
                echo "  perhatian: extension '$ext' tidak dipasang otomatis; cek manual bila dipakai."
                ;;
        esac
    done < "$BACKUP_DIR/extensions.txt"
fi

echo "==> Restore auth.users + auth.identities"
psql_db -v ON_ERROR_STOP=1 < "$BACKUP_DIR/auth_users.sql"

echo "==> Restore schema public"
"${COMPOSE[@]}" cp "$BACKUP_DIR/public.dump" db:/tmp/public.dump
"${COMPOSE[@]}" exec -T db pg_restore \
    -U postgres -d postgres --no-owner --role=postgres \
    --single-transaction --exit-on-error /tmp/public.dump
"${COMPOSE[@]}" exec -T db rm -f /tmp/public.dump

echo "==> Menerapkan hak akses"
psql_db -v ON_ERROR_STOP=1 < "$SCRIPT_DIR/grant-akses.sql"

echo "==> Menyalakan kembali layanan"
"${COMPOSE[@]}" up -d

echo "==> Verifikasi"
psql_db -v ON_ERROR_STOP=1 < "$SCRIPT_DIR/verifikasi.sql"

echo
echo "Restore selesai. Lanjutkan uji login dan endpoint dari README."
