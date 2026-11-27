#!/usr/bin/env bash
# Kompiluje i uruchamia LeagueHub.
#
#   DB_PASSWORD=... ./run.sh             # build + start
#   DB_PASSWORD=... ./run.sh --init-db   # najpierw utwórz bazę i użytkownika (sudo)
#   DB_PASSWORD=... ./run.sh --migrate   # najpierw zaktualizuj istniejącą bazę do aktualnego schematu (sudo)
#
# Zmienne (opcjonalne): DB_HOST, DB_PORT, DB_USER, DB_NAME, APP_URL
set -euo pipefail
cd "$(dirname "$0")"

: "${DB_PASSWORD:?Ustaw DB_PASSWORD — hasło użytkownika bazy aplikacji}"
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-3306}
DB_USER=${DB_USER:-leaguehub_app}
DB_NAME=${DB_NAME:-leaguehub}
APP_URL=${APP_URL:-http://localhost:5000}

command -v dotnet >/dev/null || { echo "Brak .NET SDK (dotnet)." >&2; exit 1; }

if [[ ${1:-} == --init-db || ${1:-} == --migrate ]]; then
  client=$(command -v mariadb || command -v mysql) || { echo "Brak klienta mariadb/mysql." >&2; exit 1; }
  systemctl is-active --quiet mariadb || systemctl is-active --quiet mysqld || {
    echo "Serwer bazy nie działa. Uruchom: sudo systemctl enable --now mariadb" >&2; exit 1; }
fi

if [[ ${1:-} == --migrate ]]; then
  echo "Aktualizacja schematu bazy (sudo — konto root bazy loguje się przez socket)…"
  for migration in database/migrations/*.sql; do
    echo "  $migration"
    sudo "$client" < "$migration"
  done
fi

if [[ ${1:-} == --init-db ]]; then
  pw=${DB_PASSWORD//\\/\\\\}; pw=${pw//\'/\\\'}   # escapowanie do literału SQL
  echo "Tworzenie schematu i użytkownika $DB_USER (sudo — konto root bazy loguje się przez socket)…"
  { cat database/schema.sql
    echo "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$pw';"
    echo "GRANT SELECT, INSERT, UPDATE, DELETE ON $DB_NAME.* TO '$DB_USER'@'localhost';"
  } | sudo "$client"
fi

dotnet publish src/LeagueHub.Api -c Release -o build --nologo -v quiet

# Hasło trafia do procesu przez środowisko — nie jest zapisywane w plikach.
export ConnectionStrings__Default="Server=$DB_HOST;Port=$DB_PORT;Database=$DB_NAME;User ID=$DB_USER;Password=$DB_PASSWORD;"
export ASPNETCORE_URLS=$APP_URL
echo "LeagueHub: $APP_URL"
cd build && exec dotnet LeagueHub.Api.dll
