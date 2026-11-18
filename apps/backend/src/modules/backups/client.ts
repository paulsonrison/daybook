import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
/** Probe only a fixed --version argument; never include a connection or credentials. */
export async function backupClientMajor(
  path = 'pg_dump',
): Promise<number | null> {
  try {
    const { stdout } = await execute(path, ['--version'], {
      timeout: 5000,
      maxBuffer: 1024,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
      },
    });
    const match = /^pg_dump \(PostgreSQL\) (\d+)(?:\.|\s)/.exec(stdout);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
