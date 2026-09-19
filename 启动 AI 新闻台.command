#!/bin/zsh
set -euo pipefail
project_path="${0:A:h}"
app_path="$HOME/Applications/AI 新闻台.app"
if [[ ! -d "$app_path" ]]; then "$project_path/scripts/build-mac-app.sh"; fi
open "$app_path"
