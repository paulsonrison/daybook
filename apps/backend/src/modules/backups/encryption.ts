import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface BackupIdentity {
  agencyId: string;
  backupId: string;
}
const MAGIC = Buffer.from('DAYBKP01');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + NONCE_BYTES;
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parameters(key: Uint8Array, scope: BackupIdentity, limit: number) {
  if (key.byteLength !== 32)
    throw new Error('Backup encryption requires a 32-byte key.');
  if (!UUID.test(scope.agencyId) || !UUID.test(scope.backupId))
    throw new Error('Invalid backup identity.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BACKUP_BYTES)
    throw new Error('Invalid backup byte limit.');
  return Buffer.from(
    JSON.stringify([
      'daybook-backup',
      1,
      scope.agencyId.toLowerCase(),
      scope.backupId.toLowerCase(),
    ]),
  );
}
/** Ciphertext can stream to storage. Only a fully consumed stream has a valid tag. */
export async function* encryptBackup(
  source: AsyncIterable<Uint8Array>,
  key: Uint8Array,
  scope: BackupIdentity,
  limit = MAX_BACKUP_BYTES,
): AsyncGenerator<Buffer> {
  const aad = parameters(key, scope, limit);
  const nonce = randomBytes(NONCE_BYTES);
  const header = Buffer.concat([MAGIC, nonce]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.concat([header, aad]));
  yield header;
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > limit) throw new Error('Backup exceeds byte limit.');
    // Bound each emitted chunk even if the upstream provides a large buffer.
    for (let offset = 0; offset < chunk.byteLength; offset += 65536)
      yield cipher.update(chunk.subarray(offset, offset + 65536));
  }
  yield cipher.final();
  yield cipher.getAuthTag();
}
/** Return no plaintext until authentication succeeds. Restores are strictly size-bounded. */
export async function decryptBackup(
  source: AsyncIterable<Uint8Array>,
  key: Uint8Array,
  scope: BackupIdentity,
  limit = MAX_BACKUP_BYTES,
): Promise<Buffer> {
  const aad = parameters(key, scope, limit);
  const storage = Buffer.allocUnsafe(limit + HEADER_BYTES + TAG_BYTES);
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > limit + HEADER_BYTES + TAG_BYTES)
      throw new Error('Backup exceeds byte limit.');
    storage.set(chunk, size - chunk.byteLength);
  }
  const sealed = storage.subarray(0, size);
  if (
    size < HEADER_BYTES + TAG_BYTES ||
    !sealed.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new Error('Unsupported or incomplete encrypted backup.');
  const header = sealed.subarray(0, HEADER_BYTES);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    header.subarray(MAGIC.length),
    { authTagLength: TAG_BYTES },
  );
  decipher.setAAD(Buffer.concat([header, aad]));
  decipher.setAuthTag(sealed.subarray(size - TAG_BYTES));
  const plain = decipher.update(
    sealed.subarray(HEADER_BYTES, size - TAG_BYTES),
  );
  try {
    const final = decipher.final();
    return Buffer.concat([plain, final]);
  } catch {
    plain.fill(0);
    throw new Error('Backup authentication failed.');
  }
}
