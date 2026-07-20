#!/bin/bash
# ===== QQ Music Cookie 自动刷新 =====
# 用法:
#   ./refresh-cookie.sh           # 交互式刷新（会打开浏览器窗口）
#   ./refresh-cookie.sh --auto    # 自动模式（需要之前已保存登录态）
#   ./refresh-cookie.sh --force   # 强制重新登录
#
# 定时任务（macOS）:
#   此脚本配合 launchd 可每天自动刷新，详见同目录下的 launchd plist
#
# 定时任务（Linux cron）:
#   0 9 * * * cd /path/to/meting-server && ./scripts/refresh-cookie.sh --auto >> /tmp/cookie-refresh.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

MODE="${1:-}"

echo "🎵 Firefly QQ Music Cookie 刷新"
echo "================================"
echo ""

case "$MODE" in
	--auto)
		echo "🤖 自动模式：无头浏览器 + 已保存的登录态..."
		node scripts/refresh-cookie.mjs --headless --update
		;;
	--force)
		echo "🔄 强制模式：清除旧登录态，需要重新扫码..."
		node scripts/refresh-cookie.mjs --force-login --update
		;;
	*)
		echo "🖥️  交互模式：打开浏览器，如需登录请扫码..."
		node scripts/refresh-cookie.mjs --update
		;;
esac

echo ""
echo "================================"
echo "✅ 刷新完成"
