import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

async function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    derive(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(password, salt)).toString('hex')}`;
}
export async function verifyPassword(
  password: string,
  encoded?: string,
): Promise<boolean> {
  const parts = encoded?.split('$');
  const valid =
    parts?.length === 3 &&
    parts[0] === 'scrypt' &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{128}$/.test(parts[2]);
  const actual = await scrypt(
    password,
    valid ? Buffer.from(parts![1], 'hex') : Buffer.alloc(16),
  );
  return Boolean(
    valid && timingSafeEqual(actual, Buffer.from(parts![2], 'hex')),
  );
}
export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
