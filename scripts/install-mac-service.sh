#!/bin/zsh
set -euo pipefail

project_path="${0:A:h:h}"
template_path="$project_path/scripts/cn.ai-news-desk.plist.template"
launch_agent_path="$HOME/Library/LaunchAgents/cn.ai-news-desk.plist"
node_path="$(command -v node)"
"$node_path" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major !== 22 || minor < 16) { console.error("安装需要 Node.js 22.16 或更新的 22.x；请先将符合要求的 Node 加入 PATH。"); process.exit(1); }'
npm_version="$(npm --version)"
if [[ ! "$npm_version" =~ '^10\.9\.[0-9]+$' ]]; then
  printf '安装需要 npm 10.9.x，当前为 %s。\n' "$npm_version" >&2
  exit 1
fi
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
