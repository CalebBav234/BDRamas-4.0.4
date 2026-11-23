import { getRemoteUrl } from './gitContext.js';
import { collectSyncPayload, computePushCommitShas, readPrePushRefsFromStdin } from './sync-to-remote.js';
import { branchForApi, commitsForApi, mergesForApi, repositoryFromRemote } from './branch-push-payload.js';

export async function collectBranchPush(localStore, stdinText, remote = 'origin', cwd = process.cwd()) {
  const updates = readPrePushRefsFromStdin(stdinText)
    .filter(ref => ref.remoteRef.startsWith('refs/heads/') && !/^0+$/.test(ref.localSha));
  if (!updates.length) {
    return null;
  }

  const repository = repositoryFromRemote(getRemoteUrl({ remote, cwd }) || remote);
  const branchesBySha = new Map();
  for (const ref of updates) {
    const name = ref.remoteRef.slice('refs/heads/'.length);
    for (const sha of computePushCommitShas([ref], cwd, remote)) {
      if (!branchesBySha.has(sha)) {
        branchesBySha.set(sha, name);
      }
    }
  }

  const rows = await collectSyncPayload(localStore, [...branchesBySha.keys()]);
  const commits = commitsForApi(repository.slug, rows, branchesBySha, cwd);
  const merges = mergesForApi(repository.slug, rows.merges, branchesBySha);
  const observed = new Map();
  function observe(name, date) {
    if (!observed.has(name) || date < observed.get(name)) {
      observed.set(name, date);
    }
  }
  for (const commit of commits) {
    observe(commit.branch, commit.commitedAt);
  }
  for (const merge of merges) {
    observe(merge.sourceBranch, merge.mergedAt);
    observe(merge.targetBranch, merge.mergedAt);
  }
  const datesBySha = new Map(commits.map(c => [c.commitSha, c.commitedAt]));
  for (const ref of updates) {
    observe(ref.remoteRef.slice('refs/heads/'.length), datesBySha.get(ref.localSha));
  }

  const branches = [];
  const stored = new Map(rows.branches.map(row => [row.name, row]));
  for (const [name, date] of observed) {
    const row = stored.get(name) || await localStore.getBranch(name) || { name };
    branches.push(branchForApi(repository.slug, row, date, cwd));
  }
  return { repository, branches, commits, merges };
}
