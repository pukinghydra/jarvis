#!/usr/bin/env bash
# Apply the migration to a throwaway local Postgres database (with small
# stand-ins for Supabase's auth/storage/roles) and run the behaviour checks.
# Needs a local Postgres you can reach as the `postgres` user.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
db=jarvis_test
dropdb --if-exists "$db" -U postgres 2>/dev/null || true
createdb "$db" -U postgres
# One -f per migration, in name (= version) order.
files=(-f "$here/tests/sql/supabase-stubs.sql")
for m in "$here"/supabase/migrations/*.sql; do files+=(-f "$m"); done
files+=(-f "$here/tests/sql/checks.sql")
psql -q -v ON_ERROR_STOP=1 -U postgres -d "$db" "${files[@]}" | tail -6
