// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../', import.meta.url);
const hookPath = new URL('.githooks/post-checkout', repoRoot);

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function createFixture(nodeVersion = 'v22.20.0') {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-community-worktree-hook-'));
  const bin = join(root, 'bin');
  const log = join(root, 'commands.log');
  mkdirSync(bin);
  writeExecutable(
    join(bin, 'git'),
    String.raw`#!/bin/bash
set -euo pipefail
case "$1 $2" in
  "rev-parse --show-toplevel") printf '%s\n' "$FAKE_ROOT" ;;
  "rev-parse --absolute-git-dir") printf '%s\n' "$FAKE_GIT_DIR" ;;
  "rev-parse --path-format=absolute") printf '%s\n' "$FAKE_COMMON_DIR" ;;
  *) printf 'git %s\n' "$*" >> "$FAKE_LOG" ;;
esac
`,
  );
  writeExecutable(
    join(bin, 'npm'),
    String.raw`#!/bin/bash
set -euo pipefail
printf 'npm %s\n' "$*" >> "$FAKE_LOG"
`,
  );
  writeExecutable(
    join(bin, 'node'),
    String.raw`#!/bin/bash
set -euo pipefail
printf '%s\n' "$FAKE_NODE_VERSION"
`,
  );
  return {
    root,
    log,
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      FAKE_ROOT: root,
      FAKE_GIT_DIR: join(root, 'common.git/worktrees/linked'),
      FAKE_COMMON_DIR: join(root, 'common.git'),
      FAKE_LOG: log,
      FAKE_NODE_VERSION: nodeVersion,
    },
  };
}

function runHook(fixture, previousHead = '0'.repeat(40), profile) {
  const env = { ...fixture.env };
  if (profile !== undefined) env.VULCAN_WORKTREE_PROFILE = profile;
  return spawnSync(
    '/bin/bash',
    [hookPath.pathname, previousHead, '1'.repeat(40), '1'],
    { cwd: fixture.root, env, encoding: 'utf8' },
  );
}

test('raw Community worktrees initialise submodules and npm dependencies', () => {
  const fixture = createFixture();
  try {
    const result = runHook(fixture);
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(fixture.log, 'utf8');
    assert.match(commands, /git submodule update --init --recursive/);
    assert.match(commands, /npm ci --no-audit --no-fund/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('source-only and ordinary checkouts avoid setup', () => {
  const fixture = createFixture();
  try {
    assert.equal(runHook(fixture, '0'.repeat(40), 'code').status, 0);
    assert.equal(existsSync(fixture.log), false);
    assert.equal(runHook(fixture, '1'.repeat(40), 'test').status, 0);
    assert.equal(existsSync(fixture.log), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('test-ready setup rejects an unsupported Node.js version', () => {
  const fixture = createFixture('v20.19.4');
  try {
    const result = runHook(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires Node\.js 22\.19 or newer/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the creator installs hooks and delegates profiles', () => {
  const creator = readFileSync(new URL('scripts/new-worktree.sh', repoRoot), 'utf8');
  assert.match(creator, /--profile/);
  assert.match(creator, /install-git-hooks\.sh/);
  assert.match(creator, /VULCAN_WORKTREE_PROFILE="\$profile"/);
});
