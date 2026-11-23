import 'dotenv/config';
import fs from 'fs';
import LocalTddStore from './localTddStore.js';
import { collectBranchPush } from './collect-branch-push.js';
import { postBranchActivity, useBranchApi } from './branch-api.js';
import { syncLocalToRemote, redactError } from './sync-to-remote.js';

async function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

async function main() {
  if (process.env.HUSKY_SKIP_TRACK === '1' || process.env.SKIP_DB_SYNC === '1') {
    process.exit(0);
  }
  const localStore = new LocalTddStore();
  const remote = process.argv[2];
  try {
    const stdinText = await readStdin();
    if (remote && useBranchApi()) {
      const body = await collectBranchPush(localStore, stdinText, remote);
      if (body) {
        const saved = await postBranchActivity(body);
        console.log(`[pre-push] API: ${saved.branchesSaved} ramas, ${saved.commitsSaved} commits, ${saved.mergesSaved} merges y ${saved.executionsSaved} ejecuciones.`);
      }
      return;
    }
    const result = await syncLocalToRemote({ localStore, stdinText });
    const commits = result.payload?.commits?.length || 0;
    const execs = result.payload?.executions?.length || 0;
    const merges = result.payload?.merges?.length || 0;
    if (result.skipped) {
      console.log(`[pre-push-sync] Sin datos nuevos para sincronizar (${result.reason || 'omitido'}).`);
    } else {
      console.log(`[pre-push-sync] Sincronizado a BD remota: commits=${commits}, ejecuciones=${execs}, merges=${merges}.`);
    }
  } catch (error) {
    console.error('[pre-push] Sincronización pendiente:', redactError(error));
    console.error('[pre-push] Revisa la conexión y repite el push. Los datos siguen en SQLite.');
    process.exitCode = 1;
  } finally {
    await localStore.close();
  }
}

main();
