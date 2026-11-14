'use client';
import { Icon } from './icon';
export interface ContactActionsProps {
  tel?: string | null;
  whatsapp?: string | null;
  onAttempt?: (channel: 'CALL' | 'WHATSAPP') => void;
  labels?: { call: string; whatsapp: string; unavailable: string };
}
export function ContactActions({
  tel,
  whatsapp,
  onAttempt,
  labels = {
    call: 'Call',
    whatsapp: 'WhatsApp',
    unavailable: 'Contact unavailable',
  },
}: ContactActionsProps) {
  const call =
    typeof tel === 'string' && /^tel:\+[1-9]\d{7,14}$/.test(tel) ? tel : null;
  let chat: string | null = null;
  try {
    const url = new URL(whatsapp ?? '');
    if (
      url.origin === 'https://wa.me' &&
      !url.username &&
      !url.password &&
      /^\/[1-9]\d{7,14}$/.test(url.pathname) &&
      !url.hash &&
      [...url.searchParams.keys()].every((key) => key === 'text')
    )
      chat = url.href;
  } catch {
    /* Missing contact information is a visible empty state. */
  }
  if (!call && !chat)
    return <span className="db-muted">{labels.unavailable}</span>;
  return (
    <span className="db-row">
      {call ? (
        <a
          className="db-button db-button--secondary db-button--small"
          href={call}
          onClick={() => onAttempt?.('CALL')}
        >
          <Icon name="call" size={14} />
          {labels.call}
        </a>
      ) : null}
      {chat ? (
        <a
          className="db-button db-button--secondary db-button--small"
          href={chat}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onAttempt?.('WHATSAPP')}
        >
          <Icon name="messages" size={14} />
          {labels.whatsapp}
        </a>
      ) : null}
    </span>
  );
}
