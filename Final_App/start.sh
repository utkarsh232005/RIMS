#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start.sh — Start Backend, Frontend, and ML Inference for Final_app
#
# Usage:
#   cd Final_app
#   bash start.sh
#
# Stops all services on Ctrl+C.
# ---------------------------------------------------------------------------

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/Backend"
FRONTEND_DIR="$SCRIPT_DIR/Frontend"
ML_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/supply-chain-ml-models"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-8082}"
FRONTEND_URL="http://$FRONTEND_HOST:$FRONTEND_PORT"
ML_HOST="${ML_HOST:-127.0.0.1}"
ML_PORT="${ML_PORT:-7860}"
ML_URL="http://$ML_HOST:$ML_PORT"
BACKEND_DATA_URL="$BACKEND_URL/api/dashboard-summary"
BACKEND_STATUS_URL="$BACKEND_URL/api/databricks-status"
BACKEND_VENV_DIR="$BACKEND_DIR/.venv"
ML_VENV_DIR="$ML_DIR/.venv"

venv_python_bin() {
  local venv_dir="$1"
  if [ -x "$venv_dir/bin/python" ]; then
    echo "$venv_dir/bin/python"
    return 0
  fi

  if [ -x "$venv_dir/bin/python3" ]; then
    echo "$venv_dir/bin/python3"
    return 0
  fi

  if [ -x "$venv_dir/Scripts/python.exe" ]; then
    echo "$venv_dir/Scripts/python.exe"
    return 0
  fi

  if [ -x "$venv_dir/Scripts/python" ]; then
    echo "$venv_dir/Scripts/python"
    return 0
  fi

  return 1
}

# Track child PIDs so we can clean up on exit
BACKEND_PID=""
FRONTEND_PID=""
ML_PID=""

cleanup() {
  echo ""
  echo "[start.sh] Shutting down..."
  [ -n "$ML_PID" ]       && kill "$ML_PID"       2>/dev/null
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
    "joblib",
    "pandas",
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

  echo "[start.sh] WARNING: Databricks connection check failed or offline. Backend is running in fallback mode." >&2
  echo "$status" >&2
  echo "[start.sh] Check Backend/.env, SQL Warehouse status, token permissions, catalog, and schema." >&2
  return 0
}


# ── ML Model Dependencies ─────────────────────────────────────────────────
ml_dependencies_ready() {
  "$ML_PYTHON_BIN" - <<'PY' >/dev/null 2>&1
modules = [
    "pandas",
    "numpy",
    "sklearn",
    "joblib",
    "gradio",
]
for module in modules:
    __import__(module)
PY
}

install_ml_dependencies() {
  if ml_dependencies_ready; then
    echo "[start.sh] ML model dependencies already installed."
    return
  fi

  echo "[start.sh] Installing ML model dependencies..."
  (
    cd "$ML_DIR"
    "$ML_PYTHON_BIN" -m pip install --upgrade pip
    "$ML_PYTHON_BIN" -m pip install -r requirements.txt
    # Gradio is needed to run the inference app but may not be in requirements.txt
    "$ML_PYTHON_BIN" -m pip install gradio
  )
}

ensure_ollama_and_models() {
  if ! command -v ollama >/dev/null 2>&1; then
    echo "[start.sh] WARNING: 'ollama' CLI is not installed on this system." >&2
    echo "[start.sh]          Install Ollama from https://ollama.com to enable local AI RAG copilot." >&2
    return 0
  fi

  local ollama_url="${OLLAMA_BASE_URL:-$(env_value OLLAMA_BASE_URL)}"
  ollama_url="${ollama_url:-http://localhost:11434}"
  local llm_model="${OLLAMA_LLM_MODEL:-$(env_value OLLAMA_LLM_MODEL)}"
  llm_model="${llm_model:-gemma:2b}"
  local embed_model="${PINECONE_EMBEDDING_MODEL:-$(env_value PINECONE_EMBEDDING_MODEL)}"
  embed_model="${embed_model:-nomic-embed-text}"

  local tags
  tags="$(curl --max-time 3 -fsS "$ollama_url/api/tags" 2>/dev/null || true)"
  if [ -z "$tags" ]; then
    echo "[start.sh] Starting Ollama server (ollama serve)..."
    ollama serve >/dev/null 2>&1 &
    OLLAMA_PID=$!

    local retries=15
    while [ $retries -gt 0 ]; do
      sleep 1
      tags="$(curl --max-time 2 -fsS "$ollama_url/api/tags" 2>/dev/null || true)"
      if [ -n "$tags" ]; then
        echo "[start.sh] ✓ Ollama server started on $ollama_url."
        break
      fi
      retries=$((retries - 1))
    done
  else
    echo "[start.sh] ✓ Ollama server is already running on $ollama_url."
  fi

  if [ -z "$tags" ]; then
    echo "[start.sh] WARNING: Could not connect to Ollama server at $ollama_url." >&2
    return 0
  fi

  for model in "$llm_model" "$embed_model"; do
    [ -z "$model" ] && continue
    local prefix="${model%%:*}"
    if echo "$tags" | grep -q "\"${prefix}"; then
      echo "[start.sh] ✓ Ollama model '$model' is ready."
    else
      echo "[start.sh] Ollama model '$model' is missing. Auto-pulling model '$model'..."
      ollama pull "$model" || echo "[start.sh] WARNING: Failed to pull model '$model'." >&2
    fi
  done
}

free_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[start.sh] Clearing port $port (PIDs: $(echo "$pids" | tr '\n' ' '))..."
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

require_backend_env
ensure_ollama_and_models
SYSTEM_PYTHON_BIN="$(choose_python)"
PYTHON_BIN="$(venv_python_bin "$BACKEND_VENV_DIR" || echo "$BACKEND_VENV_DIR/bin/python")"
ML_PYTHON_BIN="$(venv_python_bin "$ML_VENV_DIR" || echo "$ML_VENV_DIR/bin/python")"

# ── ML Inference Server ───────────────────────────────────────────────────
if [ -d "$ML_DIR" ]; then
  echo "[start.sh] ML models directory found at $ML_DIR"

  if [ ! -f "$ML_VENV_DIR/Scripts/python.exe" ] && [ ! -f "$ML_VENV_DIR/bin/python" ] && [ ! -f "$ML_VENV_DIR/Scripts/python" ]; then
    echo "[start.sh] Creating ML virtual environment..."
    "$SYSTEM_PYTHON_BIN" -m venv "$ML_VENV_DIR"
  fi
  ML_PYTHON_BIN="$(venv_python_bin "$ML_VENV_DIR" || echo "$ML_VENV_DIR/bin/python")"

  install_ml_dependencies

  free_port "$ML_PORT"
  echo "[start.sh] Starting ML Inference Server (Gradio) on $ML_URL ..."
  (
    cd "$ML_DIR"
    GRADIO_SERVER_NAME="$ML_HOST" GRADIO_SERVER_PORT="$ML_PORT" "$ML_PYTHON_BIN" app.py >/dev/null 2>&1
  ) &
  ML_PID=$!

  # Give the Gradio server a moment to bind
  wait_for_url "$ML_URL/" "ML Inference Server" 30 2 || \
    echo "[start.sh] WARNING: ML Inference Server may not be fully ready yet, continuing..."
else
  echo "[start.sh] WARNING: ML models directory not found at $ML_DIR — skipping ML server."
fi

# ── Backend ────────────────────────────────────────────────────────────────
if [ ! -f "$BACKEND_VENV_DIR/Scripts/python.exe" ] && [ ! -f "$BACKEND_VENV_DIR/bin/python" ] && [ ! -f "$BACKEND_VENV_DIR/Scripts/python" ]; then
  echo "[start.sh] Creating Backend virtual environment..."
  "$SYSTEM_PYTHON_BIN" -m venv "$BACKEND_VENV_DIR"
fi
PYTHON_BIN="$(venv_python_bin "$BACKEND_VENV_DIR" || echo "$BACKEND_VENV_DIR/bin/python")"

install_backend_dependencies

free_port 8000
echo "[start.sh] Starting Backend (FastAPI) on $BACKEND_URL ..."
(
  cd "$BACKEND_DIR"
  ANONYMIZED_TELEMETRY=False "$PYTHON_BIN" main.py
) &
BACKEND_PID=$!

wait_for_url "$BACKEND_URL/" "Backend" 45 1
check_databricks_connection
echo "[start.sh] Checking Databricks-backed dashboard JSON..."
curl --max-time 120 -fsS "$BACKEND_DATA_URL" >/dev/null || true

# ── Frontend ───────────────────────────────────────────────────────────────
install_frontend_dependencies

free_port "$FRONTEND_PORT"
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
if [ -n "$ML_PID" ]; then
echo "  ML Inference (Gradio) → $ML_URL"
fi
echo "  Databricks data fetch → connected"
echo "  Press Ctrl+C to stop all services."
echo "============================================="
echo ""

# Wait for any child process to exit
wait
