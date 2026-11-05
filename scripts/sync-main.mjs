#!/usr/bin/env node
/**
 * Rebuild the `main` branch as `dev` minus the dev-only test suite.
 *
 *   npm run sync:main
 *
 * Workflow:
 *   dev  — everything, including tests/ (develop here, run the suites here)
 *   main — what GitHub shows, what the hub installs, what npm publishes;
 *          identical to dev except tests/ is absent
 *
 * Run from a clean checkout on `main`. The script refuses when `main` has
 * source changes that are not on `dev` (that would mean someone edited the
 * release branch directly instead of `dev`).
 */
import { execFileSync } from 'node:child_process';

const git = (args, { inherit = false } = {}) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  }).trim();

const fail = (message) => {
  console.error(`sync-main: ${message}`);
  process.exit(1);
};

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
  fail(`run this from the main branch (currently on "${branch}").`);
}

if (git(['status', '--porcelain'])) {
  fail('the working tree is dirty; commit or stash first.');
}

try {
  git(['rev-parse', '--verify', 'dev']);
} catch {
  fail('the "dev" branch does not exist; there is nothing to sync from.');
}

// main must only ever differ from dev by the absence of tests/: its only
// commits of its own are previous sync commits. Anything else means someone
// committed to the release branch directly.
const strayCommits = git(['log', '--format=%h %s', 'dev..main'])
  .split('\n')
  .filter(Boolean)
  .filter((line) => !/\bchore: sync main from dev\b/.test(line));
if (strayCommits.length) {
  fail(
    'main has commits that are not on dev:\n' +
      strayCommits.map((line) => `  ${line}`).join('\n') +
      '\nMove them to dev first, then rerun.',
  );
}

// Index and worktree become dev's tree; tracked files that dev removed vanish.
git(['read-tree', '--reset', '-u', 'dev']);
// tests/ is staged as "added" by read-tree, so the removal has to be forced.
git(['rm', '-r', '-q', '-f', '--ignore-unmatch', 'tests']);

const staged = git(['status', '--porcelain']);
if (!staged) {
  console.log('sync-main: already up to date (main == dev minus tests).');
  process.exit(0);
}

git(['add', '-A']);
git(['commit', '-q', '-m', 'chore: sync main from dev (tests excluded)']);
console.log(`sync-main: main is now dev minus tests/ at ${git(['rev-parse', '--short', 'HEAD'])}.`);
console.log('Push both branches: git push origin main dev --tags');
