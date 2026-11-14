'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import {
  defaultPreferences,
  validatePreferences,
  type PreferenceValues,
} from '@daybook/ui/preferences';
import { graphqlRequest, UnconfirmedRequestError } from '@/lib/graphql/client';
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Choice = PreferenceValues & { version: number };
type Envelope = {
  requestId: string;
  version: number;
  choice: PreferenceValues;
  source: 'appearance' | 'language';
};
const fields =
  'version locale mode scheme layout typography{family size weight style lineHeight}';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function choice(value: unknown): Choice {
  const row = value as Choice;
  if (!row || !Number.isInteger(row.version) || row.version < 0)
    throw new Error('Saved preferences could not be read.');
  return { ...validatePreferences(row), version: row.version };
}
export class PreferencesStore {
  values: Choice = {
    ...defaultPreferences,
    typography: { ...defaultPreferences.typography },
    version: 0,
  };
  state: 'loading' | 'ready' | 'error' = 'loading';
  pending: Envelope | null = null;
  busy = false;
  error = '';
  deviceWarning = '';
  recoveryUnavailable = false;
  lastSaved = '';
  deviceLayout: PreferenceValues['layout'] | null = null;
  private active = false;
  private epoch = 0;
  constructor(
    readonly scope: { agencyId: string; agentId: string },
    readonly storage: { session: StorageAccess; device: StorageAccess },
  ) {
    if (!uuid.test(scope.agencyId) || !uuid.test(scope.agentId))
      throw new Error('Invalid preference scope.');
    makeAutoObservable(
      this,
      { scope: false, storage: false },
      { autoBind: true },
    );
  }
  get key() {
    return `daybook:preferences:${this.scope.agencyId}:${this.scope.agentId}`;
  }
  get recoveryKey() {
    return this.key + ':pending';
  }
  get locked() {
    return (
      this.busy ||
      Boolean(this.pending) ||
      this.recoveryUnavailable ||
      this.state !== 'ready'
    );
  }
  get effectiveLayout() {
    return this.deviceLayout ?? this.values.layout;
  }
  resume() {
    this.active = true;
    this.epoch++;
    this.busy = false;
    this.restoreRecovery();
    this.readDeviceLayout();
  }
  dispose() {
    this.active = false;
    this.epoch++;
  }
  private current(epoch: number) {
    return this.active && this.epoch === epoch;
  }
  private restoreRecovery() {
    try {
      const raw = this.storage.session.getItem(this.recoveryKey);
      if (raw) {
        if (raw.length > 16384)
          throw new Error('Invalid preference recovery record.');
        const row = JSON.parse(raw) as Envelope;
        if (
          !uuid.test(row.requestId) ||
          !Number.isInteger(row.version) ||
          row.version < 0 ||
          !['appearance', 'language'].includes(row.source)
        )
          throw new Error('Invalid preference recovery record.');
        this.pending = {
          requestId: row.requestId,
          version: row.version,
          choice: validatePreferences(row.choice),
          source: row.source,
        };
      } else this.pending = null;
      this.recoveryUnavailable = false;
    } catch {
      this.recoveryUnavailable = true;
      this.error =
        'Restore access to the original preference recovery record before saving.';
    }
  }
  retryRecovery() {
    this.restoreRecovery();
  }
  private readDeviceLayout() {
    this.deviceLayout = null;
    this.deviceWarning = '';
    try {
      const raw = this.storage.device.getItem(this.key);
      if (raw) {
        const row = JSON.parse(raw);
        if (!['TABLE', 'CARDS', 'ROUTE'].includes(row.layout))
          throw new Error('Invalid layout.');
        this.deviceLayout = row.layout;
      }
    } catch {
      this.deviceWarning =
        'Device layout could not be read; your saved profile is used.';
    }
  }
  async load() {
    const epoch = ++this.epoch;
    this.state = 'loading';
    try {
      const result = await graphqlRequest<{ agentPreferences: Choice }>(
        `{agentPreferences{${fields}}}`,
      );
      if (!this.current(epoch)) return;
      const saved = choice(result.agentPreferences);
      runInAction(() => {
        this.values = saved;
        this.readDeviceLayout();
        this.state = 'ready';
      });
    } catch (error) {
      if (this.current(epoch))
        runInAction(() => {
          this.error = (error as Error).message;
          this.state = 'error';
        });
    }
  }
  async save(
    value: PreferenceValues,
    source: Envelope['source'] = 'appearance',
  ) {
    if (this.locked || !this.active) return false;
    let selected: PreferenceValues;
    try {
      selected = validatePreferences(value);
    } catch (error) {
      this.error = (error as Error).message;
      return false;
    }
    this.pending = {
      requestId: crypto.randomUUID(),
      version: this.values.version,
      choice: selected,
      source,
    };
    return this.send(this.pending);
  }
  async checkOriginal() {
    if (!this.pending || this.busy || !this.active) return false;
    return this.send(this.pending);
  }
  private async send(original: Envelope) {
    const epoch = ++this.epoch,
      raw = JSON.stringify(original);
    this.busy = true;
    this.error = '';
    this.lastSaved = '';
    try {
      const existing = this.storage.session.getItem(this.recoveryKey);
      if (existing && existing !== raw)
        throw new Error(
          'Another original preference save needs review before continuing.',
        );
      this.storage.session.setItem(this.recoveryKey, raw);
    } catch (error) {
      this.recoveryUnavailable = true;
      this.error = (error as Error).message;
      this.busy = false;
      if (this.state === 'loading') this.state = 'error';
      return false;
    }
    const v = original.choice,
      t = v.typography;
    try {
      const result = await graphqlRequest<{ saveAgentPreferences: Choice }>(
        `mutation($input:AgentPreferencesInput!){saveAgentPreferences(input:$input){${fields}}}`,
        {
          input: {
            requestId: original.requestId,
            version: original.version,
            locale: v.locale,
            mode: v.mode,
            scheme: v.scheme,
            layout: v.layout,
            fontFamily: t.family,
            fontSize: t.size,
            fontWeight: t.weight,
            fontStyle: t.style,
            lineHeight: t.lineHeight,
          },
        },
      );
      if (!this.current(epoch)) return false;
      const saved = choice(result.saveAgentPreferences);
      runInAction(() => {
        this.values = saved;
        this.state = 'ready';
        if (original.source === 'appearance') {
          try {
            this.storage.device.setItem(
              this.key,
              JSON.stringify({ layout: saved.layout }),
            );
            this.deviceLayout = saved.layout;
            this.deviceWarning = '';
          } catch {
            this.deviceWarning =
              'Profile saved, but this device could not retain its layout choice.';
          }
        }
        if (this.storage.session.getItem(this.recoveryKey) === raw)
          this.storage.session.removeItem(this.recoveryKey);
        this.pending = null;
        this.restoreRecovery();
        this.lastSaved = original.requestId;
      });
      return true;
    } catch (error) {
      if (!this.current(epoch)) return false;
      runInAction(() => {
        this.error = (error as Error).message;
        if (this.state === 'loading') this.state = 'error';
        if (!(error instanceof UnconfirmedRequestError)) {
          try {
            if (this.storage.session.getItem(this.recoveryKey) === raw)
              this.storage.session.removeItem(this.recoveryKey);
            this.pending = null;
            this.restoreRecovery();
          } catch {
            this.recoveryUnavailable = true;
          }
        }
      });
      return false;
    } finally {
      if (this.current(epoch))
        runInAction(() => {
          this.busy = false;
        });
    }
  }
}
