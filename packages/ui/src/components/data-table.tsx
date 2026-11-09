import type { Key, ReactNode } from 'react';
import { Button } from './button';
import {
  DataState,
  Notification,
  TableSkeleton,
  type DataStateKind,
} from './feedback';
import { pageWindow } from '../utils';
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  sort?: 'ascending' | 'descending' | 'none';
  onSort?: () => void;
}
export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => Key;
  caption: string;
  state?: 'ready' | DataStateKind;
  onRetry?: () => void;
  emptyAction?: ReactNode;
  emptyTitle?: string;
  partialMessage?: string;
  showCaption?: boolean;
}
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  state = 'ready',
  onRetry,
  emptyAction,
  emptyTitle,
  partialMessage,
  showCaption = false,
}: DataTableProps<T>) {
  if (state === 'loading') return <TableSkeleton columns={columns.length} />;
  if (state !== 'ready' && state !== 'partial' && state !== 'offline')
    return (
      <DataState
        kind={state}
        title={state === 'empty' ? emptyTitle : undefined}
        onRetry={state === 'error' || state === 'slow' ? onRetry : undefined}
        action={state === 'empty' ? emptyAction : undefined}
      />
    );
  if (rows.length === 0 && state === 'ready')
    return <DataState kind="empty" title={emptyTitle} action={emptyAction} />;
  return (
    <div className="db-stack">
      {(state === 'partial' || state === 'offline') && (
        <Notification
          tone="warning"
          title={
            state === 'offline'
              ? 'Offline · saved records'
              : 'Some records are unavailable'
          }
          description={
            partialMessage ??
            'Loaded records remain visible. Totals are not finalized.'
          }
          action={
            onRetry && (
              <Button size="small" variant="secondary" onClick={onRetry}>
                Retry table
              </Button>
            )
          }
        />
      )}
      <div
        className="db-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={caption}
      >
        <table className="db-table">
          <caption className={showCaption ? undefined : 'db-sr-only'}>
            {caption}
          </caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  data-align={column.align}
                  aria-sort={
                    column.onSort ? (column.sort ?? 'none') : undefined
                  }
                >
                  {column.onSort ? (
                    <button
                      className="db-table-sort"
                      onClick={column.onSort}
                      type="button"
                    >
                      {column.header}{' '}
                      <span aria-hidden="true">
                        {column.sort === 'ascending'
                          ? '↑'
                          : column.sort === 'descending'
                            ? '↓'
                            : '↕'}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} data-align={column.align}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  loading = false,
  label = 'records',
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  label?: string;
}) {
  const range = pageWindow(total, page, pageSize);
  if (range.total === 0)
    return (
      <p role="status" className="db-muted">
        0 results · pagination hidden
      </p>
    );
  return (
    <nav
      className="db-pagination"
      aria-label="Pagination"
      aria-busy={loading || undefined}
    >
      <span role="status">
        Showing {range.start}–{range.end} of {range.total} {label}
        {page > range.pages ? ' · page adjusted' : ''}
      </span>
      <div className="db-row">
        <Button
          variant="secondary"
          size="small"
          disabled={loading || range.current === 1}
          onClick={() => onPageChange(range.current - 1)}
        >
          Previous
        </Button>
        <span
          aria-current="page"
          aria-label={`Page ${range.current} of ${range.pages}`}
        >
          {range.current}
        </span>
        <Button
          variant="secondary"
          size="small"
          disabled={loading || range.current === range.pages}
          onClick={() => onPageChange(range.current + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
