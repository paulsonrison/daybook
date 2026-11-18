import { randomUUID } from 'node:crypto';
export type BackupOperation = 'status' | 'tick';
export type BackupReply = { state: string; [key: string]: unknown };
export type BackupRequest = (
  operation: BackupOperation,
) => Promise<BackupReply>;
const pending = new Map<
  string,
  { done: (result: BackupReply) => void; timer: ReturnType<typeof setTimeout> }
>();
function finish(id: string, result: BackupReply) {
  const item = pending.get(id);
  if (!item) return;
  pending.delete(id);
  clearTimeout(item.timer);
  item.done(result);
}
process.on('message', (message) => {
  const reply = message as { type?: string; id?: string; result?: BackupReply };
  if (
    reply?.type === 'daybook.backup.response' &&
    typeof reply.id === 'string' &&
    reply.result &&
    typeof reply.result.state === 'string' &&
    JSON.stringify(reply.result).length <= 8192
  )
    finish(reply.id, reply.result);
});
process.on('disconnect', () => {
  for (const id of pending.keys()) finish(id, { state: 'UNAVAILABLE' });
});
export const requestBackup: BackupRequest = async (operation) => {
  if (!process.connected || !process.send) return { state: 'UNAVAILABLE' };
  if (pending.size >= 8) return { state: 'BUSY' };
  return new Promise((resolve) => {
    const id = randomUUID();
    const timer = setTimeout(
      () => finish(id, { state: 'UNAVAILABLE' }),
      operation === 'status' ? 45000 : 380000,
    );
    pending.set(id, { done: resolve, timer });
    process.send!(
      { type: 'daybook.backup.request', id, operation },
      (error) => {
        if (error) finish(id, { state: 'UNAVAILABLE' });
      },
    );
  });
};
