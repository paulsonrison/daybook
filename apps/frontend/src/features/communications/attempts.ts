export interface ContactAttemptInput {
  requestId: string;
  residentId: string;
  channel: 'CALL' | 'WHATSAPP';
}
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function valid(value: unknown): value is ContactAttemptInput {
  if (!value || typeof value !== 'object') return false;
  const item = value as ContactAttemptInput;
  return (
    typeof item.requestId === 'string' &&
    uuid.test(item.requestId) &&
    typeof item.residentId === 'string' &&
    uuid.test(item.residentId) &&
    ['CALL', 'WHATSAPP'].includes(item.channel)
  );
}
const copy = (item: ContactAttemptInput): ContactAttemptInput => ({
  requestId: item.requestId,
  residentId: item.residentId,
  channel: item.channel,
});
export class ContactAttemptQueue {
  available = true;
  private pending: ContactAttemptInput[] = [];
  private readonly key: string;
  constructor(
    agencyId: string,
    private storage: RecoveryStorage,
  ) {
    if (!uuid.test(agencyId)) throw new Error('Invalid agency recovery scope.');
    this.key = `daybook:contact-attempts:${agencyId}`;
    try {
      this.pending = this.read();
    } catch {
      this.available = false;
    }
  }
  get items() {
    return this.pending.map(copy);
  }
  private read(): ContactAttemptInput[] {
    const raw = this.storage.getItem(this.key);
    if (!raw) return [];
    if (raw.length > 1048576)
      throw new Error('Contact recovery record is too large.');
    const value: unknown = JSON.parse(raw);
    if (
      !Array.isArray(value) ||
      !value.every(valid) ||
      new Set(value.map((item) => item.requestId)).size !== value.length
    )
      throw new Error('Invalid contact recovery record.');
    return value.map(copy);
  }
  private write(items: ContactAttemptInput[]) {
    if (!this.available)
      throw new Error('Restore contact recovery storage before retrying.');
    try {
      this.storage.setItem(this.key, JSON.stringify(items));
    } catch {
      this.available = false;
      throw new Error(
        'Contact recovery storage is unavailable. This attempt has not been submitted.',
      );
    }
  }
  private current() {
    try {
      return this.read();
    } catch {
      this.available = false;
      throw new Error(
        'Restore the original contact recovery record before retrying.',
      );
    }
  }
  add(input: ContactAttemptInput) {
    if (!valid(input)) throw new Error('Invalid contact attempt.');
    const previous = this.pending.find(
      (item) => item.requestId === input.requestId,
    );
    if (previous && JSON.stringify(previous) !== JSON.stringify(copy(input)))
      throw new Error('Retain the original contact attempt.');
    if (!previous) this.pending.push(copy(input));
    if (!this.available)
      throw new Error('Restore contact recovery storage before retrying.');
    const stored = this.current();
    const original = stored.find((item) => item.requestId === input.requestId);
    if (original && JSON.stringify(original) !== JSON.stringify(copy(input)))
      throw new Error('Retain the original contact attempt.');
    if (!original) stored.push(copy(input));
    this.write(stored);
    this.pending = stored;
  }
  acknowledge(requestId: string) {
    const next = this.current().filter((item) => item.requestId !== requestId);
    this.write(next);
    this.pending = next;
  }
  retryPersistence() {
    try {
      const stored = this.read();
      for (const item of this.pending) {
        const previous = stored.find((row) => row.requestId === item.requestId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(item))
          throw new Error('Original contact recovery conflict.');
        if (!previous) stored.push(copy(item));
      }
      this.available = true;
      this.write(stored);
      this.pending = stored;
    } catch {
      this.available = false;
      throw new Error(
        'Restore access to the original contact recovery record before retrying.',
      );
    }
  }
}
