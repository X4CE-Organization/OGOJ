#!/bin/sh
set -eu

config_dir=/var/lib/pgadmin
server_json="$config_dir/servers.generated.json"
mkdir -p "$config_dir"

export PGADMIN_SERVER_JSON_FILE="$server_json"
export PGPASS_FILE="$config_dir/pgpass"

/venv/bin/python3 - <<'PY'
import json
import os

password = os.environ.get("POSTGRES_PASSWORD", "ogoj-change-me")
path = os.environ["PGADMIN_SERVER_JSON_FILE"]
data = {
    "Servers": {
        "1": {
            "Name": "OGOJ PostgreSQL",
            "Group": "OGOJ",
            "Host": "db",
            "Port": 5432,
            "MaintenanceDB": "ogoj",
            "Username": "ogoj",
            "PasswordExecCommand": "cat /var/lib/pgadmin/dbpass",
            "ConnectionParameters": {"sslmode": "prefer"},
        }
    }
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle)

# pgAdmin's servers.json loader does not overwrite a server that was already
# imported. Recreate the managed OGOJ entry so password/config changes apply.
import sqlite3

db_path = "/var/lib/pgadmin/pgadmin4.db"
if os.path.exists(db_path):
    connection = sqlite3.connect(db_path)
    connection.execute("DELETE FROM server WHERE name = 'OGOJ PostgreSQL'")
    email = os.environ.get("PGADMIN_DEFAULT_EMAIL", "admin@ogoj.dev")
    user = connection.execute(
        "SELECT id FROM user WHERE email = ?", (email,)
    ).fetchone()
    preference = connection.execute(
        "SELECT id FROM preferences WHERE name = 'user_language'"
    ).fetchone()
    if user and preference:
        connection.execute(
            "DELETE FROM user_preferences WHERE pid = ? AND uid = ?",
            (preference[0], user[0]),
        )
        connection.execute(
            "INSERT INTO user_preferences (pid, uid, value) VALUES (?, ?, ?)",
            (preference[0], user[0], "zh_Hans_CN"),
        )
    if user:
        connection.execute(
            "UPDATE user SET masterpass_check = NULL WHERE id = ?", (user[0],)
        )
    connection.commit()
    connection.close()
PY

umask 077
printf 'db:5432:*:ogoj:%s\n' "${POSTGRES_PASSWORD:-ogoj-change-me}" > "$config_dir/pgpass"
printf '%s' "${POSTGRES_PASSWORD:-ogoj-change-me}" > "$config_dir/dbpass"
printf '%s' "${PGADMIN_MASTER_PASSWORD:-ogoj-pgadmin-master-change-me}" > "$config_dir/masterpass"
chown pgadmin:root "$server_json" "$config_dir/pgpass" "$config_dir/dbpass" "$config_dir/masterpass"
chmod 600 "$config_dir/pgpass" "$config_dir/dbpass" "$config_dir/masterpass"

(
  sleep 15
  cd /pgadmin4
  /venv/bin/python3 setup.py load-servers "$server_json" --user "$PGADMIN_DEFAULT_EMAIL" --replace
) &

exec /entrypoint.sh
