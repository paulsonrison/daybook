import type { ReactNode } from 'react';
import type { IconName } from '../assets';
import { BrandMark, Icon } from './icon';
export interface NavigationGroup {
  label: string;
  items: readonly {
    label: string;
    href: string;
    icon?: IconName;
    active?: boolean;
    disabled?: boolean;
  }[];
}
export function AppShell({
  name = 'daybook',
  tagline = 'The agency workspace',
  navigation,
  header,
  footer,
  children,
}: {
  name?: string;
  tagline?: string;
  navigation: readonly NavigationGroup[];
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="db-app-shell">
      <a className="db-skip-link" href="#db-workspace">
        Skip to content
      </a>
      <aside className="db-sidebar db-no-print">
        <div className="db-brand">
          <BrandMark />
          <div>
            <strong>{name}</strong>
            <p>{tagline}</p>
          </div>
        </div>
        <nav aria-label="Workspace">
          {navigation.map((group) => (
            <div key={group.label} className="db-nav-group">
              <p className="db-eyebrow">{group.label}</p>
              {group.items.map((item) =>
                item.disabled ? (
                  <span
                    key={item.href}
                    className="db-nav-link"
                    aria-disabled="true"
                  >
                    {item.icon && <Icon name={item.icon} size={24} />}
                    <span>{item.label}</span>
                  </span>
                ) : (
                  <a
                    key={item.href}
                    href={item.href}
                    className="db-nav-link"
                    aria-current={item.active ? 'page' : undefined}
                  >
                    {item.icon && <Icon name={item.icon} size={24} />}
                    <span>{item.label}</span>
                  </a>
                ),
              )}
            </div>
          ))}
        </nav>
        {footer && <footer className="db-sidebar-footer">{footer}</footer>}
      </aside>
      <div className="db-workspace">
        <header className="db-workspace-bar db-no-print">{header}</header>
        <main id="db-workspace" className="db-workspace-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
