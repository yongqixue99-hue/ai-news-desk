#!/bin/zsh
set -euo pipefail

launch_agent_path="$HOME/Library/LaunchAgents/cn.ai-news-desk.plist"
user_domain="gui/$(id -u)"

if [[ -f "$launch_agent_path" ]]; then
  launchctl bootout "$user_domain" "$launch_agent_path" >/dev/null 2>&1 || true
  mv "$launch_agent_path" "$HOME/.Trash/cn.ai-news-desk.plist.$(date +%Y%m%d%H%M%S)"
fi

printf 'AI 新闻台后台服务已停止；配置文件已移到废纸篓。\n'

