import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'cross-spawn';
import { TddStore, nowIso } from './tddStore.js';
import LocalTddStore from './localTddStore.js';
import { captureGitContext } from './gitContext.js';
import { redactError } from './db-security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMAND = path.join(__dirname, '..', 'node_modules', '.bin', 'jest');
const args = ['--json', '--outputFile=./script/report.json'];
const TEMP_DIR = path.join(process.cwd(), '.tddlab', 'executions');

function logError(message, error) {
  console.error(`[TDD Logging] ${message}`);
  if (error) {
    console.error(`  ${error.message}`);
  }
}

function runCommand(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      resolve({ code });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

const readJSONFile = (filePath) => {
  const rawData = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(rawData);
};

function ensureTempDir() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function tempFileName() {
  const ts = Date.now();
  const counter = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return path.join(TEMP_DIR, `exec-${ts}-${counter}.json`);
}

function buildExecutionRecord(report) {
  let gitContext;

  try {
    gitContext = captureGitContext();
  } catch {
    gitContext = {
      repoRoot: null,
      headSha: null,
      branchName: null,
      isDetachedHead: false,
      parents: [],
      commitMessage: null,
      workingTreeDirty: false,
      workingTreeEntries: [],
      remoteUrl: null,
      gitAvailable: false,
      inGitRepo: false
    };
  }

  const testsPassed = report ? report.numPassedTests : 0;
  const testsFailed = report ? report.numFailedTests : 0;
  const testsTotal = report ? report.numTotalTests : 0;

  return {
    commitSha: gitContext.headSha || null,
    branch: gitContext.branchName || null,
    testsTotal,
    testsPassed,
    testsFailed,
    executedAt: nowIso(),
    report
  };
}

async function readAndSaveExecution(reportFile, store) {
  const endTime = nowIso();

  let report = null;

  try {
    if (fs.existsSync(reportFile)) {
      report = readJSONFile(reportFile);
    }
  } catch {}

  const testsPassed = report ? report.numPassedTests : 0;
  const testsFailed = report ? report.numFailedTests : 0;
  const testsTotal = report ? report.numTotalTests : 0;

  let gitContext;

  try {
    gitContext = captureGitContext();
  } catch {
    gitContext = {
      repoRoot: null,
      headSha: null,
      branchName: null,
      isDetachedHead: false,
      parents: [],
      commitMessage: null,
      workingTreeDirty: false,
      workingTreeEntries: [],
      remoteUrl: null,
      gitAvailable: false,
      inGitRepo: false
    };
  }

  let commitId = null;
  let executionId = null;
  let persistenceError = null;

  try {
    if (gitContext.headSha) {
      commitId = gitContext.headSha;

      const parents = gitContext.parents || [];
      const parentSha = parents.length > 0 ? parents[0] : null;

      await store.upsertCommit({
        sha: gitContext.headSha,
        parentSha: parentSha || null,
        branch: gitContext.branchName || null,
        author: null,
        message: gitContext.commitMessage || null,
        committedAt: null
      });

      if (gitContext.branchName) {
        await store.upsertBranch({
          name: gitContext.branchName,
          forkCommitSha: gitContext.headSha
        });
      }
    }

    executionId = await store.insertExecution({
      commitSha: commitId,
      testsTotal,
      testsPassed,
      testsFailed,
      executedAt: endTime
    });

    console.log(
      `[TDD Logging] Ejecución guardada: executionId=${executionId}, branch=${gitContext.branchName || '(no branch)'}, commit=${commitId || '(manual)'}, testsPassed=${testsPassed}, testsFailed=${testsFailed}, testsTotal=${testsTotal}`
    );
  } catch (persistError) {
    logError('No se pudo guardar la ejecución:', persistError);
    persistenceError = persistError;
  }

  return {
    executionId,
    commitId,
    exitCode: 0,
    success: true,
    testsPassed,
    testsFailed,
    testsTotal,
    durationMs: 0,
    report,
    jestError: null,
    persistenceError
  };
}

async function writeTempExecution(reportFile) {
  ensureTempDir();

  let report = null;

  try {
    if (fs.existsSync(reportFile)) {
      report = readJSONFile(reportFile);
    }
  } catch {}

  const record = buildExecutionRecord(report);
  const filePath = tempFileName();
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));

  console.log(
    `[TDD Logging] Ejecución temporal escrita: ${filePath}, testsPassed=${record.testsPassed}, testsFailed=${record.testsFailed}, testsTotal=${record.testsTotal}`
  );

  return {
    executionId: null,
    commitId: record.commitSha,
    exitCode: 0,
    success: true,
    testsPassed: record.testsPassed,
    testsFailed: record.testsFailed,
    testsTotal: record.testsTotal,
    durationMs: 0,
    report,
    jestError: null,
    persistenceError: null
  };
}

async function commitTemporals(store) {
  ensureTempDir();

  const files = fs.readdirSync(TEMP_DIR).filter(f => f.endsWith('.json')).sort();

  if (files.length === 0) {
    console.log('[post-commit] No hay ejecuciones temporales que subir.');
    return { processed: 0 };
  }

  let gitContext;

  try {
    gitContext = captureGitContext();
  } catch {
    gitContext = {
      repoRoot: null,
      headSha: null,
      branchName: null,
      isDetachedHead: false,
      parents: [],
      commitMessage: null,
      workingTreeDirty: false,
      workingTreeEntries: [],
      remoteUrl: null,
      gitAvailable: false,
      inGitRepo: false
    };
  }

  const commitSha = gitContext.headSha || null;
  const branchName = gitContext.branchName || null;

  if (!commitSha) {
    console.error('[post-commit] No se pudo determinar el commit HEAD para vincular las ejecuciones.');
    process.exitCode = 1;
    return { processed: 0, error: 'no commit sha' };
  }

  await store.initialize();

  let processed = 0;
  const errors = [];

  for (const file of files) {
    const filePath = path.join(TEMP_DIR, file);
    let record;

    try {
      record = readJSONFile(filePath);
    } catch (readError) {
      errors.push(`${file}: ${readError.message}`);
      continue;
    }

    try {
      await store.upsertCommit({
        sha: commitSha,
        parentSha: null,
        branch: branchName || null,
        author: null,
        message: null,
        committedAt: null
      });

      if (branchName) {
        await store.upsertBranch({
          name: branchName,
          forkCommitSha: commitSha
        });
      }

      await store.insertExecution({
        commitSha: commitSha,
        testsTotal: record.testsTotal || 0,
        testsPassed: record.testsPassed || 0,
        testsFailed: record.testsFailed || 0,
        executedAt: record.executedAt || nowIso()
      });

      processed += 1;

      fs.unlinkSync(filePath);
    } catch (persistError) {
      logError(`No se pudo subir la ejecución temporal ${file}:`, persistError);
      errors.push(`${file}: ${persistError.message}`);
    }
  }

  await store.close();

  console.log(`[post-commit] ${processed} ejecución(es) subida(s) a SQLite vinculada(s) al commit ${commitSha}.`);

  if (errors.length > 0) {
    console.error(`[post-commit] ${errors.length} ejecución(es) con error:`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
  }

  return { processed, errors };
}

async function extractAndAddObject(reportFile, store) {
  const startTime = nowIso();

  let childResult;
  let jestError = null;

  try {
    childResult = await runCommand(COMMAND, args);
  } catch (error) {
    jestError = error;
    childResult = { code: null };
  }

  const endTime = nowIso();

  const exitCode =
    childResult && typeof childResult.code === 'number'
      ? childResult.code
      : 1;

  const success = exitCode === 0;

  const durationMs =
    childResult && typeof childResult.code === 'number'
      ? Date.parse(endTime) - Date.parse(startTime)
      : 0;

  const result = await readAndSaveExecution(reportFile, store);

  return {
    ...result,
    exitCode,
    success,
    durationMs,
    jestError
  };
}

async function main(store = new LocalTddStore(), mode = 'record') {
  const reportFile = path.join(
    process.cwd(),
    'script',
    'report.json'
  );

  try {
    await store.initialize();
  } catch (initError) {
    logError('No se pudo inicializar la base de datos:', initError);
    process.exitCode = 1;
    return;
  }

  try {
    let result;
    if (mode === 'commit-temporals') {
      result = await commitTemporals(store);
      console.log('');
      console.log('TDD execution result:');
      console.log(`Procesadas: ${result.processed} ejecución(es)`);
      if (result.errors && result.errors.length > 0) {
        process.exitCode = 1;
      }
      return;
    }
    result = await writeTempExecution(reportFile);

    console.log('');
    console.log('TDD execution result:');
    console.log(`Passed: ${result.testsPassed}`);
    console.log(`Failed: ${result.testsFailed}`);
    console.log(`Total:  ${result.testsTotal}`);

    process.exitCode = result.exitCode === 0 && !result.persistenceError ? 0 : 1;
  } catch (error) {
    console.error('Error while executing the TDD test runner:');
    console.error(redactError(error));

    process.exitCode = 1;
  } finally {
    await store.close();
  }
}

if (process.argv[1] && path.basename(process.argv[1]) === 'tddScript.js') {
  const cliArgs = process.argv.slice(2);
  const mode = cliArgs.includes('--commit-temporals') ? 'commit-temporals' : 'record';
  main(undefined, mode).catch((error) => {
    console.error('Unhandled TDD runner error:');
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  extractAndAddObject,
  writeTempExecution,
  commitTemporals,
  TddStore,
  main
};
