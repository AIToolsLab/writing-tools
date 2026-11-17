#!/usr/bin/env bash
# Interactively review and prune git stashes, oldest first.
set -euo pipefail

n=$(git stash list | wc -l | tr -d ' ')
if [[ "$n" -eq 0 ]]; then
  echo "No stashes."
  exit 0
fi

for ((i = n - 1; i >= 0; i--)); do
  ref="stash@{$i}"
  # Skip if this index no longer exists (shouldn't happen given the
  # oldest-first order, but be defensive).
  git rev-parse --verify -q "$ref" >/dev/null || continue

  echo
  echo "==================================================================="
  git log -1 --format="%C(yellow)$ref%Creset  %ad  %s" --date=format:'%Y-%m-%d %H:%M' "$ref"
  echo "-------------------------------------------------------------------"
  git stash show "$ref"
  echo "==================================================================="

  while true; do
    read -r -p "[k]eep / [d]rop / [f]ull diff / [q]uit ? " ans </dev/tty
    case "$ans" in
      k|K) break ;;
      d|D) git stash drop "$ref"; break ;;
      f|F) git stash show -p "$ref" | less || true ;;
      q|Q) echo "Stopping."; exit 0 ;;
      *) echo "Please answer k, d, f, or q." ;;
    esac
  done
done

echo
echo "Done. Remaining stashes:"
git stash list --date=format:'%Y-%m-%d' --pretty=format:'%gd  %ad  %s'
