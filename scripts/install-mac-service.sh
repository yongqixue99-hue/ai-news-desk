#!/bin/zsh
set -euo pipefail

project_path="${0:A:h:h}"
template_path="$project_path/scripts/cn.ai-news-desk.plist.template"
launch_agent_path="$HOME/Library/LaunchAgents/cn.ai-news-desk.plist"
node_path="$(command -v node)"
path_value="$(dirname "$node_path"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
user_domain="gui/$(id -u)"

mkdir -p "$project_path/.workflow/logs" "$HOME/Library/LaunchAgents"
npm --prefix "$project_path" run build

sed \
  -e "s|__PROJECT_PATH__|$project_path|g" \
  -e "s|__NODE_PATH__|$node_path|g" \
  -e "s|__PATH_VALUE__|$path_value|g" \
  "$template_path" > "$launch_agent_path"

plutil -lint "$launch_agent_path"
launchctl bootout "$user_domain" "$launch_agent_path" >/dev/null 2>&1 || true
launchctl bootstrap "$user_domain" "$launch_agent_path"
launchctl enable "$user_domain/cn.ai-news-desk"
launchctl kickstart -k "$user_domain/cn.ai-news-desk"

printf 'AI 新闻台后台服务已安装：%s\n' "$launch_agent_path"
printf '控制台：http://127.0.0.1:4317\n'

