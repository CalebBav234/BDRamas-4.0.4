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

async function main(store = new LocalTddStore(), recordOnly = false) {
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
    if (recordOnly) {
      result = await readAndSaveExecution(reportFile, store);
    } else {
      result = await extractAndAddObject(reportFile, store);
    }

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
  const recordOnly = process.argv.includes('--record-only');
  main(undefined, recordOnly).catch((error) => {
    console.error('Unhandled TDD runner error:');
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  extractAndAddObject,
  readAndSaveExecution,
  TddStore,
  main
};
