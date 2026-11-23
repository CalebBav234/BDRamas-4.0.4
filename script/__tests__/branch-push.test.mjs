import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computePushCommitShas } from '../sync-to-remote.js';

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
