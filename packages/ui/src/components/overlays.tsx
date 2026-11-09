'use client';
import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'dialog',
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'dialog' | 'drawer';
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
    return () => {
      if (node.open) node.close();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`db-dialog db-dialog--${variant}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="db-dialog-layout">
        <header className="db-dialog-header">
          <h2 id={`${id}-title`}>{title}</h2>
          {description && (
            <p id={`${id}-description`} className="db-muted">
              {description}
            </p>
          )}
        </header>
        <div className="db-dialog-body">{children}</div>
        {footer && <footer className="db-dialog-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
export function Drawer(props: Omit<Parameters<typeof Dialog>[0], 'variant'>) {
  return <Dialog {...props} variant="drawer" />;
}
export function Tooltip({
  content,
  children,
}: {
  content: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({
    left: 8,
    top: 8,
    visibility: 'hidden',
  });
  function keepOpen() {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function closeAfterGap() {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (
        !anchor.current?.matches(':hover') &&
        !bubble.current?.matches(':hover') &&
        !anchor.current?.contains(document.activeElement)
      )
        setOpen(false);
    }, 200);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const rect = anchor.current?.getBoundingClientRect();
      const tip = bubble.current?.getBoundingClientRect();
      if (!rect || !tip) return;
      const left = Math.max(
        8,
        Math.min(
          window.innerWidth - tip.width - 8,
          rect.left + rect.width / 2 - tip.width / 2,
        ),
      );
      const top =
        rect.top - tip.height - 8 >= 8
          ? rect.top - tip.height - 8
          : rect.bottom + 8;
      setPosition({
        left,
        top: Math.max(8, Math.min(window.innerHeight - tip.height - 8, top)),
        visibility: 'visible',
      });
    }
    function dismiss(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        clearTimeout(closeTimer.current);
        setOpen(false);
      }
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('keydown', dismiss);
    };
  }, [open, content]);
  const description =
    [children.props['aria-describedby'], open ? id : undefined]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <span
      className="db-tooltip-anchor"
      ref={anchor}
      onMouseEnter={keepOpen}
      onMouseLeave={closeAfterGap}
      onFocus={keepOpen}
      onBlur={closeAfterGap}
    >
      {cloneElement(children, { 'aria-describedby': description })}
      {open &&
        createPortal(
          <div
            id={id}
            ref={bubble}
            role="tooltip"
            className="db-tooltip"
            style={position}
            onMouseEnter={keepOpen}
            onMouseLeave={closeAfterGap}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
