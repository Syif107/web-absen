#!/usr/bin/env bash
# ============================================================
# Backup harian database RelawanSync.
# ------------------------------------------------------------
# Hasil per hari:
#   backup/harian/YYYYmmdd-HHMMSS/public.dump
#   backup/harian/YYYYmmdd-HHMMSS/auth_users.sql
#   backup/harian/YYYYmmdd-HHMMSS/counts.txt
#   backup/harian/YYYYmmdd-HHMMSS/sha256.txt
#
# Variabel opsional:
#   BACKUP_DIR      (default: deploy/backup/harian)
#   RETENSI_HARI    (default: 14)
#   BACKUP_SALINAN  (contoh: /mnt/nas/relawansync)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE=(docker compose --env-file "$DEPLOY_DIR/.env" -f "$DEPLOY_DIR/docker-compose.yml")

BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backup/harian}"
RETENSI_HARI="${RETENSI_HARI:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
STAMP_DIR="$BACKUP_DIR/$STAMP"

umask 077
mkdir -p "$STAMP_DIR"

echo "==> Backup ke $STAMP_DIR"

"${COMPOSE[@]}" exec -T db pg_dump \
    -U postgres -d postgres \
    --schema=public --format=custom --no-owner --no-privileges \
    --no-publications --no-subscriptions \
    > "$STAMP_DIR/public.dump"

"${COMPOSE[@]}" exec -T db pg_dump \
    -U postgres -d postgres \
    --data-only --table=auth.users --table=auth.identities --column-inserts \
    > "$STAMP_DIR/auth_users.sql"

"${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -At -F '|' -c "
select 'master_relawan', count(*) from public.master_relawan
union all select 'log_absensi', count(*) from public.log_absensi
union all select 'profil', count(*) from public.profil
union all select 'auth_users', count(*) from auth.users
union all select 'auth_identities', count(*) from auth.identities
order by 1" > "$STAMP_DIR/counts.txt"

if [[ ! -s "$STAMP_DIR/public.dump" || ! -s "$STAMP_DIR/auth_users.sql" ]]; then
    echo "GAGAL: hasil backup kosong. Periksa container db."
    exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
    (cd "$STAMP_DIR" && sha256sum public.dump auth_users.sql > sha256.txt)
fi

echo "==> Menghapus backup lebih dari $RETENSI_HARI hari"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENSI_HARI" -print -exec rm -rf {} +

if [[ -n "${BACKUP_SALINAN:-}" ]]; then
    mkdir -p "$BACKUP_SALINAN"
    cp -a "$STAMP_DIR" "$BACKUP_SALINAN/"
    echo "==> Salinan dibuat di $BACKUP_SALINAN/$STAMP"
fi

echo "==> Selesai"
du -sh "$STAMP_DIR" 2>/dev/null || true
