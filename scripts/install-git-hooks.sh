#!/bin/bash
# SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
git config core.hooksPath .githooks
echo "Installed repository hooks via core.hooksPath=.githooks"
