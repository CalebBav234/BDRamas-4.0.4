import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computePushCommitShas } from '../sync-to-remote.js';

import { branchForApi, commitsForApi, mergesForApi, repositoryFromRemote } from '../branch-push-payload.js';

const zeroSha = '0'.repeat(40);

function createRepo(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'ramas-tdd-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.name', 'Prueba');
  git('config', 'user.email', 'prueba@example.org');
  git('config', 'commit.gpgsign', 'false');
  const commit = message => {
    git('commit', '--quiet', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { cwd, git, commit };
}

test('el primer push incluye los dos commits nuevos de la rama', t => {
  const { cwd, git, commit } = createRepo(t);
  git('update-ref', 'refs/remotes/origin/main', commit('base'));
  git('switch', '--quiet', '-c', 'suma');
  const first = commit('sumar');
  const last = commit('restar');
  const ref = { remoteRef: 'refs/heads/suma', localSha: last, remoteSha: zeroSha };
  assert.deepEqual(computePushCommitShas([ref], cwd), [first, last]);
});

test('identifica el mismo repositorio por SSH y por HTTPS sin incluir credenciales', () => {
  const expected = { slug: 'equipo/base', remoteUrl: 'https://github.com/equipo/base' };
  assert.deepEqual(repositoryFromRemote('git@github.com:equipo/base.git'), expected);
  assert.deepEqual(repositoryFromRemote('https://usuario@github.com/equipo/base.git'), expected);
});

test('conserva el punto de creación de la rama aunque SQLite tenga el último commit', t => {
  const { cwd, git, commit } = createRepo(t);
  const fork = commit('inicio');
  git('switch', '--quiet', '-c', 'suma');
  const tip = commit('otro cambio');
  const branch = branchForApi('equipo/base', { name: 'suma', fork_commit_sha: tip }, null, cwd);
  assert.equal(branch.forkCommitSha, fork);
  assert.ok(Number.isFinite(Date.parse(branch.createdAt)));
  const deleted = branchForApi('equipo/base', { name: 'borrada', created_at: '2026-10-01 11:00:00' }, null, cwd);
  assert.equal(deleted.createdAt, '2026-10-01T11:00:00.000Z');
  assert.equal(deleted.forkCommitSha, undefined);
});

test('asocia cada ejecución al SHA que le corresponde y completa los commits desde Git', t => {
  const { cwd, commit } = createRepo(t);
  const first = commit('inicio');
  const second = commit('suma');
  const shas = new Map([[first, 'main'], [second, 'main']]);
  const rows = {
    commits: [{ sha: second, parent_sha: first, branch: 'main', author: null }],
    executions: [{ commit_sha: second, tests_total: 2, tests_passed: 1, tests_failed: 1, executed_at: '2026-11-01 12:00:00' }],
  };
  const [root, next] = commitsForApi('equipo/base', rows, shas, cwd);
  assert.deepEqual(root.tddExecutions, []);
  assert.equal(root.parentCommitSha, undefined);
  assert.deepEqual(next, {
    repositorySlug: 'equipo/base', commitSha: second, parentCommitSha: first, branch: 'main',
    authorName: 'Prueba', message: 'suma', commitedAt: new Date(next.commitedAt).toISOString(),
    tddExecutions: [{ testsTotal: 2, testsPassed: 1, testsFailed: 1, executedAt: '2026-11-01T12:00:00.000Z' }],
  });
});

test('incluye los merges del rango con su indicador de fast-forward', () => {
  const row = { source_branch: 'suma', target_branch: 'main', source_commit_sha: 'a', merge_commit_sha: 'b',
    is_fast_forward: 0, merged_at: '2026-11-01 12:00:00' };
  const ff = { ...row, source_commit_sha: 'c', merge_commit_sha: 'c', is_fast_forward: 1 };
  const merges = mergesForApi('equipo/base', [row, ff, { ...row, merge_commit_sha: 'otro' }], new Map([['b', 'main'], ['c', 'main']]));
  assert.equal(merges.length, 2);
  assert.deepEqual(merges[0], { repositorySlug: 'equipo/base', sourceBranch: 'suma', targetBranch: 'main',
    sourceCommitSha: 'a', mergeCommitSha: 'b', isFastForward: false, mergedAt: '2026-11-01T12:00:00.000Z' });
  assert.equal(merges[1].isFastForward, true);
});
