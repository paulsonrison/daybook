'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  PreferencesProvider,
  PreferenceNotices,
  WorkspaceLanguage,
  WorkspaceShell,
  WorkspaceSignOut,
} from '../preferences/provider';
import {
  BrandMark,
  Button,
  Card,
  Field,
  Notification,
  Skeleton,
  Theme,
} from '@daybook/ui';

export interface Agent {
  id: string;
  agencyId: string;
  name: string;
  email: string;
  agency: { id: string; name: string };
}
export function AgencyEntry({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [checking, setChecking] = useState(true);
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          setAgent(null);
          return;
        }
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || 'Unable to check your session.');
        setAgent(data.agent);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/auth/${register ? 'register' : 'login'}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to sign in.');
      setAgent(result.agent);
      form.reset();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Unable to sign in.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('Unable to sign out. Try again.');
      setAgent(null);
      setRegister(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Theme>
      {checking ? (
        <main className="agency-auth">
          <Card>
            <Skeleton height={32} />
            <Skeleton />
            <p role="status">Checking your session…</p>
          </Card>
        </main>
      ) : agent ? (
        <PreferencesProvider
          key={`${agent.agencyId}:${agent.id}`}
          scope={{ agencyId: agent.agencyId, agentId: agent.id }}
        >
          <WorkspaceShell
            navigation={[
              {
                label: 'Workspace',
                items: [
                  {
                    label: 'Overview',
                    href: '/',
                    icon: 'dashboard',
                    active: pathname === '/',
                  },
                  {
                    label: 'Agency analytics',
                    href: '/analytics',
                    icon: 'dashboard',
                    active: pathname === '/analytics',
                  },
                  {
                    label: 'Agency assistant',
                    href: '/assistant',
                    icon: 'dashboard',
                    active: pathname === '/assistant',
                  },
                  {
                    label: 'Residents & subscriptions',
                    href: '/residents',
                    icon: 'nav-residents',
                    active: pathname === '/residents',
                  },
                  {
                    label: 'Publications & pricing',
                    href: '/publications',
                    icon: 'publications',
                    active: pathname === '/publications',
                  },
                  {
                    label: 'Routes & delivery',
                    href: '/routes',
                    icon: 'nav-route',
                    active: pathname === '/routes',
                  },
                  {
                    label: 'Field workspace',
                    href: '/field.html',
                    icon: 'nav-route',
                    active: false,
                  },
                  {
                    label: 'Daily delivery log',
                    href: '/delivery',
                    icon: 'nav-route',
                    active: pathname === '/delivery',
                  },
                ],
              },
              {
                label: 'Operations',
                items: [
                  {
                    label: 'Collections',
                    href: '/collections',
                    icon: 'ledger',
                    active: pathname === '/collections',
                  },
                  {
                    label: 'Route collection sheets',
                    href: '/collection-sheets',
                    icon: 'ledger',
                    active: pathname === '/collection-sheets',
                  },
                  {
                    label: 'Payments & accounts',
                    href: '/payments',
                    icon: 'ledger',
                    active: pathname === '/payments',
                  },
                  {
                    label: 'Publishers & returns',
                    href: '/publishers',
                    icon: 'publications',
                    active: pathname === '/publishers',
                  },
                  {
                    label: 'Seasonal stock',
                    href: '/inventory',
                    icon: 'ledger',
                    active: pathname === '/inventory',
                  },
                  {
                    label: 'Advertisers & inserts',
                    href: '/advertisers',
                    icon: 'share',
                    active: pathname === '/advertisers',
                  },
                  {
                    label: 'Staff & payroll',
                    href: '/staff',
                    icon: 'staff',
                    active: pathname === '/staff',
                  },
                  {
                    label: 'Staff pay & attendance',
                    href: '/payroll',
                    icon: 'staff',
                    active: pathname === '/payroll',
                  },
                  {
                    label: 'Cash handover & closing',
                    href: '/cash',
                    icon: 'ledger',
                    active: pathname === '/cash',
                  },
                  {
                    label: 'Communications',
                    href: '/communications',
                    icon: 'messages',
                    active: pathname === '/communications',
                  },
                  {
                    label: 'Settings',
                    href: '/settings/territory',
                    icon: 'nav-settings',
                    active: pathname.startsWith('/settings'),
                  },
                  {
                    label: 'Appearance',
                    href: '/settings/appearance',
                    icon: 'settings',
                    active: pathname === '/settings/appearance',
                  },
                ],
              },
            ]}
            header={
              <div
                className="db-row"
                style={{ justifyContent: 'space-between', width: '100%' }}
              >
                <div>
                  <strong aria-label="Current agency">
                    {agent.agency.name}
                  </strong>
                  <span className="db-muted"> · {agent.name}</span>
                </div>
                <WorkspaceSignOut busy={busy} onLogout={logout} />
                <WorkspaceLanguage />
              </div>
            }
            footer={<span>{agent.agency.name}</span>}
          >
            <PreferenceNotices />
            {error && (
              <Notification
                tone="error"
                title="Unable to complete the action"
                description={error}
              />
            )}
            {children ?? (
              <Card>
                <h2>Set up your delivery territory</h2>
                <p>Your agency has no delivery territory yet.</p>
              </Card>
            )}
          </WorkspaceShell>
        </PreferencesProvider>
      ) : (
        <main className="agency-auth">
          <Card>
            <BrandMark />
            <p className="db-eyebrow">The agency workspace</p>
            <h1>{register ? 'Create your agency' : 'Sign in to Daybook'}</h1>
            <p className="db-muted">
              Manage your newspaper agency in one place.
            </p>
            {error && (
              <Notification
                tone="error"
                title="Unable to continue"
                description={error}
              />
            )}
            <form onSubmit={submit} className="agency-auth-form">
              {register && (
                <>
                  <Field
                    label="Agency name"
                    name="agencyName"
                    required
                    maxLength={120}
                    autoComplete="organization"
                    disabled={busy}
                  />
                  <Field
                    label="Your name"
                    name="name"
                    required
                    maxLength={100}
                    autoComplete="name"
                    disabled={busy}
                  />
                </>
              )}
              <Field
                label="Email address"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="username"
                disabled={busy}
              />
              <Field
                label="Password"
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                hint="Use 12–128 characters."
                autoComplete={register ? 'new-password' : 'current-password'}
                disabled={busy}
              />
              <Button type="submit" loading={busy}>
                {register ? 'Create agency' : 'Sign in'}
              </Button>
            </form>
            <Button
              variant="tertiary"
              disabled={busy}
              onClick={() => {
                setRegister((value) => !value);
                setError('');
              }}
            >
              {register ? 'Back to sign in' : 'Create an agency'}
            </Button>
          </Card>
        </main>
      )}
    </Theme>
  );
}
