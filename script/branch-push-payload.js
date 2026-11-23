import { execFileSync } from 'node:child_process';

export function repositoryFromRemote(remoteUrl) {
  const url = new URL((remoteUrl || '').replace(/^git@([^:]+):(.+)$/, 'ssh://git@$1/$2'));
  const slug = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || !slug.includes('/')) {
    throw new Error('Se necesita la URL del repositorio con su propietario y nombre.');
  }
  const host = url.protocol === 'ssh:' || url.protocol === 'git:' ? `https://${url.hostname}` : url.origin;
  return { slug, remoteUrl: `${host}/${slug}` };
}

function isoDate(value) {
  // SQLite usa UTC cuando escribe datetime('now') sin zona horaria.
  const timestamp = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  return new Date(timestamp).toISOString();
}

export function branchForApi(slug, row, observedAt, cwd) {
  // Un checkout puede actualizar fork_commit_sha en las bases antiguas.
  // El reflog conserva el SHA original mientras exista la entrada de creación.
  let creation;
  try {
    const log = execFileSync('git', [
      'reflog', 'show', '--date=unix', '--format=%gD%x00%H%x00%gs', `refs/heads/${row.name}`,
    ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    creation = log.trimEnd().split('\n').at(-1)?.match(/@\{(\d+)\}\0([0-9a-f]+)\0branch: Created from /);
  } catch {
    // Una rama ya borrada todavía puede estar registrada en SQLite.
  }
  return {
    repositorySlug: slug, name: row.name,
    createdAt: creation ? new Date(Number(creation[1]) * 1000).toISOString() : isoDate(row.created_at || observedAt),
    ...(creation && { forkCommitSha: creation[2] }),
  };
}
