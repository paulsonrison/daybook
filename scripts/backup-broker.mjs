import { spawn } from 'node:child_process';
import { backupEnvironment } from './runtime-environment.mjs';

/** Fixed commands only: requests cannot supply arguments, paths, credentials or SQL. */
export function attachBackupBroker(
  peer,
  { env = process.env, cwd = process.cwd() } = {},
) {
  let worker;
  let closed = false;
  let nextTick = 0;
  function reply(id, result) {
    if (!closed && peer.connected)
      peer.send({ type: 'daybook.backup.response', id, result }, () => {});
  }
  function receive(message) {
    if (!message || message.type !== 'daybook.backup.request') return;
    const { id, operation } = message;
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return;
    if (
      Object.keys(message).sort().join(',') !== 'id,operation,type' ||
      !['tick', 'status'].includes(operation)
    ) {
      reply(id, { state: 'REJECTED' });
      return;
    }
    if (worker) {
      reply(id, { state: 'BUSY' });
      return;
    }
    if (operation === 'tick' && Date.now() < nextTick) {
      reply(id, { state: 'THROTTLED' });
      return;
    }
    if (operation === 'tick') nextTick = Date.now() + 15 * 60 * 1000;
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=96',
        'apps/backend/dist/backup-once.js',
        operation,
      ],
      {
        cwd,
        env: backupEnvironment(env),
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    worker = child;
    let result = { state: 'UNAVAILABLE' };
    const timer = setTimeout(
      () => child.kill('SIGTERM'),
      operation === 'status' ? 30000 : 6 * 60 * 1000,
    );
    const killTimer = setTimeout(
      () => child.kill('SIGKILL'),
      operation === 'status' ? 40000 : 6 * 60 * 1000 + 10000,
    );
    child.on('message', (message) => {
      if (
        message &&
        message.type === 'daybook.backup.result' &&
        JSON.stringify(message).length <= 8192 &&
        message.result &&
        typeof message.result.state === 'string'
      )
        result = message.result;
    });
    child.on('error', () => {});
    child.once('close', () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (worker === child) worker = undefined;
      reply(id, result);
    });
  }
  function detach() {
    closed = true;
    peer.removeListener('message', receive);
    peer.removeListener('disconnect', detach);
    peer.removeListener('exit', detach);
    if (worker) {
      const child = worker;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      timer.unref();
      child.once('close', () => clearTimeout(timer));
    }
  }
  peer.on('message', receive);
  peer.once('disconnect', detach);
  peer.once('exit', detach);
  return detach;
}
