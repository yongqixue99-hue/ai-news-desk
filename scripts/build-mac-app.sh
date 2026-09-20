#!/bin/zsh
set -euo pipefail
project_path="${0:A:h:h}"
app_path="${1:-$HOME/Applications/AI 新闻台.app}"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources"
cp "$project_path/desktop/assets/app-icon.icns" "$app_path/Contents/Resources/AppIcon.icns"
swiftc "$project_path/desktop/App.swift" -o "$app_path/Contents/MacOS/AI-News-Desk" -framework AppKit -framework WebKit
printf '%s' "$project_path" > "$app_path/Contents/Resources/project.txt"
cat > "$app_path/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>AI-News-Desk</string><key>CFBundleIdentifier</key><string>cn.ai-news-desk.desktop</string><key>CFBundleName</key><string>AI 新闻台</string><key>CFBundleDisplayName</key><string>AI 新闻工作台</string><key>CFBundleIconFile</key><string>AppIcon</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>2</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>
PLIST
codesign --force --sign - "$app_path"
printf '应用已生成：%s\n' "$app_path"
