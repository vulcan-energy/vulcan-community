#!/bin/bash
# SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

usage() {
    cat >&2 <<'USAGE'
Usage: scripts/new-worktree.sh <lowercase-slug> [options] [base-branch]

  --profile <profile>  test (default) or code

Profiles:
  code     initialise submodules for source-only work
  test     initialise submodules and install the locked npm workspace
USAGE
}

slug="${1:-}"
if [ "$slug" = "-h" ] || [ "$slug" = "--help" ]; then
    usage
    exit 0
fi
if ! [[ "$slug" =~ ^[a-z0-9][a-z0-9._-]*$ ]]; then
    usage
    exit 1
fi
shift

profile="test"
base="origin/main"
base_set=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --profile)
            if [ "$#" -lt 2 ]; then
                usage
                exit 1
            fi
            profile="$2"
            shift 2
            ;;
        --profile=*)
            profile="${1#--profile=}"
            shift
            ;;
        --)
            shift
            if [ "$#" -ne 1 ] || [ "$base_set" = true ]; then
                usage
                exit 1
            fi
            base="$1"
            base_set=true
            shift
            ;;
        -*)
            usage
            exit 1
            ;;
        *)
            if [ "$base_set" = true ]; then
                usage
                exit 1
            fi
            base="$1"
            base_set=true
            shift
            ;;
    esac
done

case "$profile" in
    code|test) ;;
    *)
        echo "Unknown Community worktree profile: $profile" >&2
        usage
        exit 1
        ;;
esac

current_root="$(git rev-parse --show-toplevel)"
if [ "$base" = "origin/main" ]; then
    git -C "$current_root" fetch --quiet origin main
fi
primary_root="$(git worktree list --porcelain | awk '/^worktree / { sub(/^worktree /, ""); print; exit }')"
repo_name="$(basename "$primary_root")"
target="$(dirname "$primary_root")/${repo_name}-${slug}"
branch="codex/$slug"

if [ -e "$target" ]; then
    echo "Worktree path already exists: $target" >&2
    exit 1
fi
if git show-ref --verify --quiet "refs/heads/$branch"; then
    echo "Branch already exists: $branch" >&2
    exit 1
fi

"$current_root/scripts/install-git-hooks.sh"
VULCAN_WORKTREE_PROFILE="$profile" \
    git -C "$current_root" worktree add -b "$branch" "$target" "$base"
echo "Created $target on $branch with the '$profile' profile"
