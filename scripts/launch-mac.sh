#!/bin/zsh
set -euo pipefail
project_path="${0:A:h:h}"
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$project_path"
exec node scripts/desktop-launch.mjs "$@"
