#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OGOJ 启停脚本
#
#   ./scripts/ogoj.sh start     后台启动（独立进程，关掉终端也不会退出）
#   ./scripts/ogoj.sh run       前台运行（Ctrl+C 停止，适合交给 systemd / launchd）
#   ./scripts/ogoj.sh stop      停止
#   ./scripts/ogoj.sh restart   重启
#   ./scripts/ogoj.sh status    查看状态与端口
#   ./scripts/ogoj.sh logs      跟踪日志（Ctrl+C 退出）
#
# 端口、数据库位置等请在仓库根目录的 .env 中配置（见 .env.example）。
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="data/ogoj.pid"
LOG_DIR="data/logs"
LOG_FILE="$LOG_DIR/ogoj.log"
ENTRY="apps/server/dist/index.js"

# 优先使用项目自带的 Node（如果存在），否则用 PATH 里的 node
if [ -x "$HOME/.local/ogoj-toolchain/node-v22.20.0-darwin-arm64/bin/node" ]; then
  NODE_BIN="$HOME/.local/ogoj-toolchain/node-v22.20.0-darwin-arm64/bin/node"
else
  NODE_BIN="$(command -v node || true)"
fi

port() {
  if [ -f .env ]; then
    # shellcheck disable=SC1091
    grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '[:space:]'
  fi
}
PORT="$(port)"; PORT="${PORT:-8080}"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# 端口上是否有 OGOJ 在监听（不依赖 PID 文件，比如用 run 模式或其它方式启动时）
listening_pid() {
  lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
}

start() {
  if is_running || [ -n "$(listening_pid)" ]; then
    echo "OGOJ 已在运行（PID $(is_running && cat "$PID_FILE" || listening_pid)，端口 ${PORT}）"
    return 0
  fi
  if [ ! -f "$ENTRY" ]; then
    echo "缺少构建产物 ${ENTRY}，请先执行：npm install && npm run build" >&2
    exit 1
  fi
  if [ -z "$NODE_BIN" ]; then
    echo "未找到 node，请安装 Node.js 20+ 后重试" >&2
    exit 1
  fi
  mkdir -p "$LOG_DIR"
  echo "正在启动 OGOJ …"
  NODE_ENV=production nohup "$NODE_BIN" "$ENTRY" >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2
  if curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    echo "✔ 启动成功：http://localhost:$PORT  （PID $(cat "$PID_FILE")）"
    echo "  日志：$LOG_FILE"
  else
    echo "✘ 启动失败，最近日志：" >&2
    tail -20 "$LOG_FILE" >&2 || true
    exit 1
  fi
}

stop() {
  local pid
  if is_running; then
    pid="$(cat "$PID_FILE")"
  else
    pid="$(listening_pid)"
  fi
  if [ -z "$pid" ]; then
    echo "OGOJ 当前未运行"
    rm -f "$PID_FILE"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.3
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "已停止 OGOJ（PID ${pid}）"
}

status() {
  if is_running; then
    echo "运行中：PID $(cat "$PID_FILE")，端口 $PORT"
  elif [ -n "$(listening_pid)" ]; then
    echo "运行中：PID $(listening_pid)，端口 ${PORT}（非本脚本后台启动）"
  else
    echo "未运行"
  fi
  echo "健康检查：$(curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || echo '无响应')"
  echo "端口监听："
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +1 || echo "  (无)"
}

case "${1:-start}" in
  start) start ;;
  run)
    if [ ! -f "$ENTRY" ]; then
      echo "缺少构建产物 ${ENTRY}，请先执行：npm install && npm run build" >&2
      exit 1
    fi
    mkdir -p "$LOG_DIR"
    echo "前台运行 OGOJ（端口 ${PORT}），Ctrl+C 停止"
    exec env NODE_ENV=production "$NODE_BIN" "$ENTRY"
    ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) tail -f "$LOG_FILE" ;;
  *) echo "用法: $0 {start|stop|restart|status|logs}" >&2; exit 1 ;;
esac
