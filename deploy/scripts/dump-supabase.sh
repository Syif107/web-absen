#!/usr/bin/env bash
# ============================================================
# Dump database Supabase cloud untuk dipindahkan ke server Linux.
# ------------------------------------------------------------
# Jalankan dari mesin yang punya internet dan kredensial Supabase.
# Hasil:
#   public.dump      -> skema + data schema public (format custom)
#   auth_users.sql   -> data auth.users + auth.identities
#   extensions.txt   -> daftar extension yang dipakai
#   counts.txt       -> jumlah baris pembanding
#   versi.txt        -> versi PostgreSQL sumber
#
# Pemakaian:
#   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
#   bash deploy/scripts/dump-supabase.sh
#   bash deploy/scripts/dump-supabase.sh /path/backup/tujuan
# ============================================================
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
    cat <<'MSG'
SUPABASE_DB_URL belum diisi.

Ambil connection string dari Supabase Dashboard > Connect > Session pooler,
lalu jalankan:

  export SUPABASE_DB_URL='postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

Jangan memakai port 6543 (transaction pooler) untuk pg_dump.
MSG
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${1:-$DEPLOY_DIR/backup/supabase-$STAMP}"

mkdir -p "$OUT_DIR"
OUT_ABS="$(cd "$OUT_DIR" && pwd)"

export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"

DOCKER_NET=()
if [[ "$(uname -s)" == "Linux" ]]; then
    DOCKER_NET=(--network host)
fi

# Naikkan ke postgres:18 bila server Supabase sudah PG18.
PG_CLIENT_IMAGE="${PG_CLIENT_IMAGE:-postgres:17}"

MODE="${PG_DUMP_MODE:-auto}"
case "$MODE" in
    auto)
        if command -v pg_dump >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then
            MODE="lokal"
        else
            MODE="docker"
            echo "pg_dump/psql lokal tidak ditemukan; memakai container $PG_CLIENT_IMAGE."
        fi
        ;;
    docker)
        echo "PG_DUMP_MODE=docker: memakai container $PG_CLIENT_IMAGE."
        ;;
    lokal)
        if ! command -v pg_dump >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
            echo "PG_DUMP_MODE=lokal tetapi pg_dump/psql tidak ditemukan."
            exit 1
        fi
        ;;
    *)
        echo "PG_DUMP_MODE harus auto, docker, atau lokal (sekarang: $MODE)."
        exit 1
        ;;
esac

if [[ "$MODE" == "docker" ]] && ! command -v docker >/dev/null 2>&1; then
    echo "Docker tidak ditemukan. Instal Docker atau sediakan pg_dump/psql versi 17+."
    exit 1
fi

run_pg_dump() {
    if [[ "$MODE" == "lokal" ]]; then
        pg_dump "$SUPABASE_DB_URL" "$@"
    else
        docker run --rm "${DOCKER_NET[@]}" \
            -e SUPABASE_DB_URL -e PGSSLMODE -e PGCONNECT_TIMEOUT \
            -v "$OUT_ABS:/out" "$PG_CLIENT_IMAGE" \
            sh -c 'pg_dump "$SUPABASE_DB_URL" "$@"' _ "$@"
    fi
}

run_psql_at() {
    if [[ "$MODE" == "lokal" ]]; then
        psql "$SUPABASE_DB_URL" -At "$@"
    else
        docker run --rm "${DOCKER_NET[@]}" \
            -e SUPABASE_DB_URL -e PGSSLMODE -e PGCONNECT_TIMEOUT \
            "$PG_CLIENT_IMAGE" \
            sh -c 'psql "$SUPABASE_DB_URL" -At "$@"' _ "$@"
    fi
}

echo "==> Mengambil skema + data public"
# Publication Realtime tidak dipakai dan sudah dibuat oleh image server;
# jangan ikut di-dump agar restore tidak bentrok.
DUMP_PUBLIC_ARGS=(--schema=public --no-owner --no-privileges --no-publications --no-subscriptions)
if [[ "$MODE" == "lokal" ]]; then
    run_pg_dump "${DUMP_PUBLIC_ARGS[@]}" \
        --format=custom --file="$OUT_ABS/public.dump"
else
    run_pg_dump "${DUMP_PUBLIC_ARGS[@]}" \
        --format=custom --file=/out/public.dump
fi

echo "==> Mengambil data auth.users dan auth.identities"
if [[ "$MODE" == "lokal" ]]; then
    run_pg_dump --data-only \
        --table=auth.users --table=auth.identities \
        --column-inserts --no-owner --no-privileges \
        --file="$OUT_ABS/auth_users.sql"
else
    run_pg_dump --data-only \
        --table=auth.users --table=auth.identities \
        --column-inserts --no-owner --no-privileges \
        --file=/out/auth_users.sql
fi

echo "==> Mencatat extension"
run_psql_at -F '|' -c \
    "select extname, extnamespace::regnamespace::text from pg_extension order by 1" \
    > "$OUT_ABS/extensions.txt"

echo "==> Mencatat jumlah baris pembanding"
COUNTS_SQL="
select 'master_relawan', count(*) from public.master_relawan
union all select 'log_absensi', count(*) from public.log_absensi
union all select 'profil', count(*) from public.profil
union all select 'seragam_penerima', count(*) from public.seragam_penerima
union all select 'mutasi_stok_seragam', count(*) from public.mutasi_stok_seragam
union all select 'auth_users', count(*) from auth.users
union all select 'auth_identities', count(*) from auth.identities
order by 1"
run_psql_at -F '|' -c "$COUNTS_SQL" > "$OUT_ABS/counts.txt"

echo "==> Mencatat versi sumber"
run_psql_at -c "select version()" > "$OUT_ABS/versi.txt" || true

{
    echo "dibuat=$(date -Is)"
    echo "mode_dump=$MODE"
    echo "pg_dump=$(pg_dump --version 2>/dev/null || echo "container $PG_CLIENT_IMAGE")"
    echo "sumber=supabase-cloud"
} > "$OUT_ABS/manifest.txt"

# Jangan biarkan dump setengah jadi dipakai.
for file in public.dump auth_users.sql; do
    if [[ ! -s "$OUT_ABS/$file" ]]; then
        echo "GAGAL: $file kosong atau tidak terbentuk."
        exit 1
    fi
done

echo
echo "Selesai. Hasil dump ada di: $OUT_ABS"
echo "Lanjutkan dengan menyalin folder tersebut ke server, lalu:"
echo "  bash deploy/scripts/restore-server.sh \"$OUT_ABS\""
