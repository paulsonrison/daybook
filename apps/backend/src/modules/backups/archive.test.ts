import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import { waitForBackupProcess } from './archive.js';
test('aborted backup process cannot report failure before child exit and transaction teardown', async () => {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperty(child, 'stderr', { value: Readable.from([]) });
  child.kill = () => true;
  let settled = false;
  const completed = waitForBackupProcess(child);
  completed.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  child.emit('error', new Error('AbortError: termination requested'));
  await setImmediate();
  try {
    assert.equal(settled, false, 'An abort request is not process exit');
  } finally {
    child.emit('close', 1, null);
    await completed.catch(() => {});
  }
  await assert.rejects(completed, /client/i);
});
