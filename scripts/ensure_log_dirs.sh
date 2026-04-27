#!/usr/bin/env bash

set -euo pipefail

group_name=${LOGS_GROUP_NAME:-writing-study-irb-approved}
dir_mode=${LOGS_DIR_MODE:-770}
fix_mode=${LOGS_FIX_MISMATCHES:-false}

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <dir> [<dir> ...]" >&2
  exit 64
fi

if ! getent group "$group_name" >/dev/null; then
  echo "required group '$group_name' does not exist on this host" >&2
  exit 1
fi

group_gid=$(getent group "$group_name" | cut -d: -f3)
echo "Validating log directories use group $group_name ($group_gid) and mode $dir_mode"

for dir_path in "$@"; do
  if [ ! -d "$dir_path" ]; then
    echo "directory '$dir_path' does not exist" >&2
    exit 1
  fi

  if [ "$fix_mode" = "true" ]; then
    chgrp "$group_name" "$dir_path"
    chmod "$dir_mode" "$dir_path"
  fi

  actual_group=$(stat -c '%G' "$dir_path")
  actual_mode=$(stat -c '%a' "$dir_path")

  if [ "$actual_group" != "$group_name" ]; then
    echo "directory '$dir_path' has group '$actual_group'; expected '$group_name'" >&2
    exit 1
  fi

  if [ "$actual_mode" != "$dir_mode" ]; then
    echo "directory '$dir_path' has mode '$actual_mode'; expected '$dir_mode'" >&2
    exit 1
  fi

  echo "Validated $dir_path"
done