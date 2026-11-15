import { read, update, clear } from './database.js';
const $ = (id) => document.getElementById(id);
let agent = null,
  scope = null,
  verifiedAt = 0,
  authEpoch = 0,
  busy = false,
  installPrompt;
const channel =
  'BroadcastChannel' in self ? new BroadcastChannel('daybook-field') : null;
function notice(message) {
  $('notice').textContent = message;
}
function lock() {
  authEpoch++;
  agent = null;
  scope = null;
  verifiedAt = 0;
  $('workspace').hidden = true;
  $('locked').hidden = false;
  $('residents').replaceChildren();
  $('pending').replaceChildren();
  $('receipts').replaceChildren();
}
function unlocked() {
  if (!agent || Date.now() - verifiedAt > 8 * 60 * 60 * 1000) {
    lock();
    throw new Error('Reconnect to verify your account.');
  }
}
function element(tag, text, cls) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function network() {
  $('network').textContent = navigator.onLine
    ? 'Connected · downloaded details may be out of date'
    : 'Offline · new entries remain pending on this device';
}
async function gql(query, variables = {}) {
  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error('Cannot reach Daybook. Pending entries are preserved.');
  const result = await response.json();
  if (result.errors?.length) {
    const error = new Error(result.errors[0].message);
    error.code = result.errors[0].extensions?.code;
    if (error.code === 'UNAUTHENTICATED') lock();
    throw error;
  }
  return result.data;
}
async function verify() {
  lock();
  const epoch = authEpoch;
  const current = () => {
    if (authEpoch !== epoch) throw new Error('Account changed. Verify again.');
  };
  const response = await fetch('/api/auth/me', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  current();
  if (!response.ok)
    throw new Error(
      'Sign in to verify your account. Pending entries stay locked.',
    );
  const next = (await response.json()).agent;
  current();
  const nextScope = `${next.agencyId}:${next.id}`;
  await update((state) => {
    current();
    return state.scope === nextScope
      ? state
      : { scope: nextScope, snapshot: null, queue: [], receipts: [] };
  });
  current();
  agent = next;
  scope = nextScope;
  verifiedAt = Date.now();
  $('identity').textContent = `${agent.agency.name} · ${agent.name}`;
  const routes = (await gql('{routes{id name active}}')).routes.filter(
    (r) => r.active,
  );
  current();
  $('route').replaceChildren(
    ...routes.map((r) => {
      const option = element('option', r.name);
      option.value = r.id;
      return option;
    }),
  );
  const state = await read();
  current();
  if (state?.scope !== scope) {
    lock();
    throw new Error('Account changed. Verify again.');
  }
  if (state.snapshot) {
    $('route').value = state.snapshot.routeId;
    $('date').value = state.snapshot.date;
  }
  $('workspace').hidden = false;
  $('locked').hidden = true;
  await render();
  current();
  notice('Account verified. Download a route or review pending entries.');
}
function scoped(state) {
  unlocked();
  if (state?.scope !== scope) throw new Error('Account changed. Verify again.');
  return state;
}
async function addAction(action) {
  unlocked();
  const active = scope;
  await update((state) => {
    scoped(state);
    if (state.queue.length >= 100)
      throw new Error('Sync pending entries before saving more.');
    if (
      state.queue.some(
        (a) =>
          a.input.kind === action.kind && a.input.recordId === action.recordId,
      )
    )
      throw new Error(
        'This record already has a pending entry. Review it before adding another.',
      );
    state.queue.push({
      input: {
        ...action,
        requestId: crypto.randomUUID(),
        agencyId: agent.agencyId,
        agentId: agent.id,
        occurredAt: new Date().toISOString(),
      },
      error: null,
    });
    return state;
  });
  channel?.postMessage({ scope: active });
  await render();
  notice('Saved on this device. Pending until the server confirms it.');
}
function field(label, type = 'text') {
  const wrapper = element('label', label),
    input = element('input');
  input.type = type;
  input.required = true;
  wrapper.append(input);
  return { wrapper, input };
}
async function render() {
  unlocked();
  const state = scoped(await read());
  $('pending').replaceChildren();
  $('receipts').replaceChildren();
  $('residents').replaceChildren();
  $('downloaded').textContent = state.snapshot
    ? `Downloaded ${state.snapshot.routeName} · ${state.snapshot.date} · ${new Date(state.snapshot.downloadedAt).toLocaleString()}. Balances and delivery status reflect that download.`
    : 'No route downloaded. Choose a route and date while connected.';
  for (const item of state.queue) {
    const panel = element(
      'article',
      null,
      `panel${item.error ? ' review' : ''}`,
    );
    panel.append(
      element(
        'h3',
        `Pending ${item.input.kind} · ${item.input.amount ?? item.input.status}`,
      ),
      element(
        'p',
        `Saved ${new Date(item.input.occurredAt).toLocaleString()} · ${item.input.reason}`,
      ),
    );
    if (item.error) {
      panel.append(
        element('p', `Needs review · ${item.error}`),
        element(
          'p',
          'Compare this proposal with the current account or delivery. Discard only after checking whether the original action was already recorded. Download fresh details before re-entering.',
        ),
      );
      const discard = element('button', 'Discard reviewed proposal');
      discard.onclick = () =>
        run(async () => {
          if (
            !confirm(
              'Discard this proposal from this device? This does not reverse any server receipt or delivery.',
            )
          )
            return;
          await update((s) => {
            scoped(s);
            s.queue = s.queue.filter(
              (a) => a.input.requestId !== item.input.requestId,
            );
            return s;
          });
          channel?.postMessage({ scope });
          await render();
        });
      panel.append(discard);
    }
    $('pending').append(panel);
  }
  for (const receipt of state.receipts) {
    const panel = element('article', null, 'panel receipt');
    panel.append(
      element(
        'p',
        `Confirmed ${receipt.kind} · ${receipt.receiptCode ?? receipt.status}`,
      ),
    );
    $('receipts').append(panel);
  }
  for (const person of state.snapshot?.residents ?? []) {
    const panel = element('article', null, 'panel');
    panel.append(
      element('h2', person.name),
      element('p', person.address),
      element('p', `Downloaded balance · ₹${person.balance}`),
    );
    const cashForm = element('form');
    const amount = field(`Cash amount for ${person.name}`);
    amount.input.inputMode = 'decimal';
    amount.input.pattern = '[0-9]+([.][0-9]{1,2})?';
    amount.input.maxLength = 14;
    const evidence = field(`Cash evidence for ${person.name}`);
    evidence.input.maxLength = 500;
    const date = field(`Cash received date for ${person.name}`, 'date');
    date.input.value = $('date').value;
    const save = element('button', 'Save pending cash');
    save.type = 'submit';
    cashForm.className = 'controls';
    cashForm.append(amount.wrapper, evidence.wrapper, date.wrapper, save);
    cashForm.onsubmit = (event) => {
      event.preventDefault();
      run(() =>
        addAction({
          kind: 'CASH',
          recordId: person.id,
          expectedVersion: person.cashVersion,
          amount: amount.input.value,
          date: date.input.value,
          reason: evidence.input.value,
        }),
      );
    };
    panel.append(cashForm);
    for (const row of state.snapshot.deliveries.filter(
      (r) => r.residentId === person.id,
    )) {
      const form = element('form', null, 'delivery');
      form.append(
        element('h3', row.publicationName),
        element(
          'p',
          `${row.quantity} copies · downloaded status ${row.status}`,
        ),
      );
      const reason = field(
        `Delivery evidence for ${person.name} · ${row.publicationName}`,
      );
      reason.input.maxLength = 500;
      form.append(reason.wrapper);
      const actions = element('div', null, 'actions');
      for (const status of ['DELIVERED', 'MISSED', 'DAMAGED']) {
        const button = element(
          'button',
          status.charAt(0) + status.slice(1).toLowerCase(),
        );
        button.type = 'submit';
        button.value = status;
        actions.append(button);
      }
      form.append(actions);
      form.onsubmit = (event) => {
        event.preventDefault();
        run(() =>
          addAction({
            kind: 'DELIVERY',
            recordId: row.id,
            expectedVersion: String(row.version),
            status: event.submitter.value,
            reason: reason.input.value,
          }),
        );
      };
      panel.append(form);
    }
    $('residents').append(panel);
  }
}
async function download() {
  unlocked();
  if (scoped(await read()).queue.length)
    throw new Error(
      'Sync or review pending entries before replacing the downloaded route.',
    );
  const active = scope,
    routeId = $('route').value,
    date = $('date').value;
  if (!routeId || !date) throw new Error('Choose a route and date.');
  const { fieldSnapshot: snapshot } = await gql(
    'query($date:String!,$routeId:ID!){fieldSnapshot(date:$date,routeId:$routeId){agencyId agentId routeName date downloadedAt residents{id name address balance cashVersion} deliveries{id residentId publicationName quantity status version}}}',
    { date, routeId },
  );
  if (
    scope !== active ||
    snapshot.agencyId !== agent?.agencyId ||
    snapshot.agentId !== agent?.id
  )
    throw new Error('Account changed. Verify again.');
  await update((state) => {
    scoped(state);
    if (state.queue.length)
      throw new Error(
        'Another tab added pending entries. Sync or review those first.',
      );
    state.snapshot = { ...snapshot, routeId };
    return state;
  });
  channel?.postMessage({ scope });
  await render();
  notice('Route downloaded. Keep this screen open to use it offline.');
}
async function sync() {
  unlocked();
  // Revalidate before replay; the server also checks the actor on every action.
  const active = scope;
  await verify();
  if (active !== scope)
    throw new Error('Account changed. Old entries cannot be submitted.');
  const queue = scoped(await read()).queue;
  for (const item of queue) {
    if (item.error) continue;
    try {
      const data = await gql(
        'mutation($input:FieldActionInput!){syncFieldAction(input:$input){requestId kind status receiptCode}}',
        { input: item.input },
      );
      if (scope !== active) throw new Error('Account changed. Verify again.');
      await update((state) => {
        scoped(state);
        state.queue = state.queue.filter(
          (a) => a.input.requestId !== item.input.requestId,
        );
        state.receipts = [data.syncFieldAction, ...state.receipts].slice(0, 20);
        return state;
      });
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED' || !scope) throw error;
      if (
        ['CONFLICT', 'BAD_USER_INPUT', 'NOT_FOUND', 'FORBIDDEN'].includes(
          error.code,
        )
      ) {
        await update((state) => {
          scoped(state);
          const current = state.queue.find(
            (a) => a.input.requestId === item.input.requestId,
          );
          if (current) current.error = error.message;
          return state;
        });
      } else throw error;
    }
  }
  channel?.postMessage({ scope });
  await render();
  notice(
    'Synchronization finished. Review any remaining entries, then download fresh route details before entering more.',
  );
}
async function run(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await work();
  } catch (error) {
    notice(
      error.message ??
        'Unable to complete this step. Pending entries are preserved.',
    );
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
}
$('date').value = new Date().toLocaleDateString('en-CA', {
  timeZone: 'Asia/Kolkata',
});
$('verify').onclick = () => run(verify);
$('download').onclick = () => run(download);
$('sync').onclick = () => run(sync);
$('signout').onclick = () =>
  run(async () => {
    if (
      !confirm(
        'Sign out and clear all downloaded details and pending entries from this device?',
      )
    )
      return;
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error('Unable to sign out. Reconnect and try again.');
    lock();
    channel?.postMessage({ signedOut: true });
    try {
      await clear();
      notice('Signed out. Device details cleared.');
    } catch {
      notice(
        'Signed out. Device storage could not be cleared. Clear Daybook site data in your browser before sharing this device.',
      );
    }
  });
addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  $('install').hidden = false;
});
$('install').onclick = () =>
  run(async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      $('install').hidden = true;
    }
  });
addEventListener('online', network);
addEventListener('offline', network);
channel?.addEventListener('message', (event) => {
  if (event.data.signedOut || event.data.scope !== scope) lock();
  else if (scope && !busy) run(render);
});
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'DAYBOOK_ACCOUNT_CHANGED') lock();
  if (event.data?.type === 'DAYBOOK_DEVICE_CLEANUP_FAILED') {
    lock();
    notice(
      'Signed out. Device storage could not be cleared. Clear Daybook site data in your browser before sharing this device.',
    );
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && agent && navigator.onLine && !busy) run(verify);
});
setInterval(() => {
  if (agent && Date.now() - verifiedAt > 8 * 60 * 60 * 1000) lock();
}, 60000);
network();
if ('serviceWorker' in navigator)
  navigator.serviceWorker
    .register('/sw.js', { type: 'module', updateViaCache: 'none' })
    .catch(() =>
      notice('Offline setup failed. Reconnect and reopen this screen.'),
    );
run(verify);
