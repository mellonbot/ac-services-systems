#!/usr/bin/env bash
# Installs the AC Logins launcher to ~/.local/share/applications/ac-logins.desktop.
set -euo pipefail

app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="$HOME/.local/share/applications/ac-logins.desktop"

# The path sits inside a double-quoted bash string, inside a double-quoted Exec argument,
# inside a desktop-entry string value: escape \ " $ ` for each of the first two, then double
# the backslashes for the third, and % for field codes.
esc() { sed -e 's/[\\"$`]/\\&/g'; }
path="$(printf '%s' "$app_dir" | esc | esc | sed -e 's/\\/\\\\/g' -e 's/%/%%/g')"

mkdir -p "$(dirname "$dest")"
while IFS= read -r line; do
  printf '%s\n' "${line//<APP_DIR>/$path}"
done < "$app_dir/ac-logins.desktop" > "$dest"
command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$dest")" || true
echo "installed $dest"
