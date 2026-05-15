#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start.sh — Start both Backend and Frontend for Final_app
#
# Usage:
#   cd Final_app
#   bash start.sh
#
# Stops both services on Ctrl+C.
# ---------------------------------------------------------------------------

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/Backend"
FRONTEND_DIR="$SCRIPT_DIR/Frontend"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-8082}"
FRONTEND_URL="http://$FRONTEND_HOST:$FRONTEND_PORT"
BACKEND_DATA_URL="$BACKEND_URL/api/dashboard-summary"
BACKEND_STATUS_URL="$BACKEND_URL/api/databricks-status"
BACKEND_VENV_DIR="$BACKEND_DIR/.venv"

# Track child PIDs so we can clean up on exit
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "[start.sh] Shutting down..."
  [ -n "$BACKEND_PID" ]  && kill "$BACKEND_PID"  2>/dev/null
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  wait 2>/dev/null
  echo "[start.sh] Done."
}
trap cleanup EXIT INT TERM

choose_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi

  if command -v python >/dev/null 2>&1; then
    command -v python
    return
  fi

  echo "[start.sh] Python 3 was not found. Install Python 3 and try again." >&2
  exit 1
}

env_value() {
  local key="$1"
  local env_file="$BACKEND_DIR/.env"
  grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d "=" -f 2-
}

require_backend_env() {
  local env_file="$BACKEND_DIR/.env"
  if [ ! -f "$env_file" ]; then
    echo "[start.sh] Missing Backend/.env. Create it from Backend/.env.example first." >&2
    exit 1
  fi

  local missing=""
  for key in DATABRICKS_SERVER_HOSTNAME DATABRICKS_HTTP_PATH DATABRICKS_ACCESS_TOKEN DATABRICKS_CATALOG DATABRICKS_SCHEMA; do
    local value
    value="$(env_value "$key")"
    if [ -z "$value" ] || echo "$value" | grep -Eq "your_|xxxxxxxx|dapi_your"; then
      missing="$missing $key"
    fi
  done

  if [ -n "$missing" ]; then
    echo "[start.sh] Backend/.env still needs real values for:$missing" >&2
    exit 1
  fi
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempts="${3:-30}"
  local delay="${4:-1}"

  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done

  echo "[start.sh] $label did not become ready at $url" >&2
  return 1
}

backend_dependencies_ready() {
  "$PYTHON_BIN" - <<'PY' >/dev/null 2>&1
modules = [
    "fastapi",
    "uvicorn",
    "dotenv",
    "databricks.sql",
    "pinecone",
    "sentence_transformers",
    "google.genai",
    "openai",
]
for module in modules:
    __import__(module)
PY
}

install_backend_dependencies() {
  if backend_dependencies_ready; then
    echo "[start.sh] Backend dependencies already installed."
    return
  fi

  echo "[start.sh] Installing Backend dependencies..."
  (
    cd "$BACKEND_DIR"
    "$PYTHON_BIN" -m pip install --upgrade pip
    "$PYTHON_BIN" -m pip install -r requirements.txt
  )
}

install_frontend_dependencies() {
  if [ -d "$FRONTEND_DIR/node_modules" ]; then
    echo "[start.sh] Frontend dependencies already installed."
    return
  fi

  echo "[start.sh] Installing Frontend dependencies..."
  (
    cd "$FRONTEND_DIR"
    npm install
  )
}

check_databricks_connection() {
  echo "[start.sh] Checking Databricks connection..."
  local status
  status="$(curl --max-time 120 -fsS "$BACKEND_STATUS_URL" 2>/dev/null || true)"

  if echo "$status" | grep -q '"status"[[:space:]]*:[[:space:]]*"connected"'; then
    echo "[start.sh] Databricks connection OK."
    return 0
  fi

  echo "[start.sh] Databricks connection failed. Backend response:" >&2
  echo "$status" >&2
  echo "[start.sh] Check Backend/.env, SQL Warehouse status, token permissions, catalog, and schema." >&2
  return 1
}

require_backend_env
SYSTEM_PYTHON_BIN="$(choose_python)"
PYTHON_BIN="$BACKEND_VENV_DIR/bin/python"

# ── Backend ────────────────────────────────────────────────────────────────
if [ ! -x "$PYTHON_BIN" ]; then
  echo "[start.sh] Creating Backend virtual environment..."
  "$SYSTEM_PYTHON_BIN" -m venv "$BACKEND_VENV_DIR"
fi

install_backend_dependencies

echo "[start.sh] Starting Backend (FastAPI) on $BACKEND_URL ..."
(
  cd "$BACKEND_DIR"
  ANONYMIZED_TELEMETRY=False "$PYTHON_BIN" main.py
) &
BACKEND_PID=$!

wait_for_url "$BACKEND_URL/" "Backend" 45 1
check_databricks_connection
echo "[start.sh] Checking Databricks-backed dashboard JSON..."
curl --max-time 120 -fsS "$BACKEND_DATA_URL" >/dev/null

# ── Frontend ───────────────────────────────────────────────────────────────
install_frontend_dependencies

echo "[start.sh] Starting Frontend (Vite) on $FRONTEND_URL ..."
(
  cd "$FRONTEND_DIR"
  VITE_API_BASE_URL="$BACKEND_URL" npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

echo ""
echo "============================================="
echo "  Frontend app          → $FRONTEND_URL"
echo "  Backend API health    → $BACKEND_STATUS_URL"
echo "  Backend live JSON     → $BACKEND_DATA_URL"
echo "  Databricks data fetch → connected"
echo "  Press Ctrl+C to stop both services."
echo "============================================="
echo ""

# Wait for either process to exit
wait
