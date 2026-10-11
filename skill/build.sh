#!/bin/sh
# Packages skill/SKILL.md and bin/scout as dist/luddite-scout.skill, a zip
# with one folder, luddite-scout/, as Claude Code and the Claude apps expect.
# File times come from the last commit, so the same commit gives the same zip.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

skill="$stage/luddite-scout"
mkdir -p "$skill/scripts" "$out"
cp "$root/skill/SKILL.md" "$skill/SKILL.md"
cp "$root/LICENSE" "$skill/LICENSE"
cp "$root/bin/scout" "$skill/scripts/scout"
chmod 644 "$skill/SKILL.md" "$skill/LICENSE"
chmod 755 "$skill/scripts/scout"

epoch=$(git -C "$root" log -1 --format=%ct 2>/dev/null || echo 315532800)
find "$skill" -exec touch -h -d "@$epoch" {} +

rm -f "$out/luddite-scout.skill"
(cd "$stage" && find luddite-scout | LC_ALL=C sort | TZ=UTC zip -X -q -@ "$out/luddite-scout.skill")
echo "$out/luddite-scout.skill"
