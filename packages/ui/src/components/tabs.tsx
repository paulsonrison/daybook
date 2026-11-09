'use client';
import { useId, useRef, type ReactNode } from 'react';
export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}
export function Tabs({
  items,
  value,
  onValueChange,
  label = 'Sections',
}: {
  items: readonly TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  label?: string;
}) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const active =
    items.find((item) => item.id === value && !item.disabled)?.id ??
    items.find((item) => !item.disabled)?.id;
  return (
    <div>
      <div className="db-tabs-list" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="db-tab"
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={`${id}-tab-${item.id}`}
            aria-controls={`${id}-panel-${item.id}`}
            aria-selected={item.id === active}
            tabIndex={item.id === active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.id)}
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return;
              event.preventDefault();
              const enabled = items
                .map((entry, i) => (entry.disabled ? -1 : i))
                .filter((i) => i >= 0);
              const current = enabled.indexOf(index);
              const next =
                event.key === 'Home'
                  ? enabled[0]
                  : event.key === 'End'
                    ? enabled.at(-1)
                    : enabled[
                        (current +
                          (event.key === 'ArrowRight' ? 1 : -1) +
                          enabled.length) %
                          enabled.length
                      ];
              if (next !== undefined) {
                refs.current[next]?.focus();
                onValueChange(items[next].id);
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${id}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="db-tab-panel"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
