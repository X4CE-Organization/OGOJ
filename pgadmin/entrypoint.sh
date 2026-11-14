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
            "Password": password,
            "SavePassword": True,
            "SSLMode": "prefer",
        }
    }
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle)
PY

umask 077
printf 'db:5432:*:ogoj:%s\n' "${POSTGRES_PASSWORD:-ogoj-change-me}" > "$config_dir/pgpass"
chown pgadmin:root "$server_json" "$config_dir/pgpass"
chmod 600 "$config_dir/pgpass"

exec /entrypoint.sh
