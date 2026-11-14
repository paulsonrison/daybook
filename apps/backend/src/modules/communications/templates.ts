import { formatMoney } from '@daybook/ui/money';
import type { Locale } from './service.js';
import type { PreparedMessage } from './providers.js';
export type NoticeKind = 'INVOICE' | 'REMINDER' | 'CREDIT_HOLD';
export interface NoticeValues {
  agency: string;
  resident: string;
  amount: string;
  reference?: string;
  documentUrl?: string;
  paymentUrl?: string;
}
export interface ApprovedTemplate {
  kind: NoticeKind;
  locale: Locale;
  name: string;
  language: string;
  qrHeader: boolean;
}
export function approvedTemplate(value: unknown): ApprovedTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Choose a valid approved template.');
  const input = value as Record<string, unknown>;
  if (!['INVOICE', 'REMINDER', 'CREDIT_HOLD'].includes(String(input.kind)))
    throw new Error('Choose a supported template kind.');
  if (
    !['en', 'ml', 'hi'].includes(String(input.locale)) ||
    typeof input.language !== 'string' ||
    !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(input.language) ||
    input.language.split('_')[0] !== input.locale
  )
    throw new Error(
      'Approved template language must match its message language.',
    );
  if (typeof input.name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(input.name))
    throw new Error('Enter the provider-approved template name.');
  if (typeof input.qrHeader !== 'boolean')
    throw new Error(
      'Confirm whether the approved template has a QR image header.',
    );
  return {
    kind: input.kind as NoticeKind,
    locale: input.locale as Locale,
    name: input.name,
    language: input.language,
    qrHeader: input.qrHeader,
  };
}
export function providerTemplate(
  settings: ApprovedTemplate,
  values: NoticeValues,
  qrUrl?: string,
): NonNullable<PreparedMessage['template']> {
  const checked = approvedTemplate(settings);
  if (
    !values.agency ||
    !values.resident ||
    !/^\d+(?:\.\d{1,2})?$/.test(values.amount)
  )
    throw new Error('Complete the financial message snapshot.');
  if (!values.documentUrl || new URL(values.documentUrl).protocol !== 'https:')
    throw new Error('A secure document link is required.');
  if (checked.qrHeader && (!qrUrl || new URL(qrUrl).protocol !== 'https:'))
    throw new Error('The approved template requires a secure QR image.');
  const amount = formatMoney(values.amount);
  let parameters: string[];
  if (checked.kind === 'INVOICE') {
    if (!values.reference || !values.paymentUrl)
      throw new Error('Invoice reference and payment link are required.');
    parameters = [
      values.resident,
      values.agency,
      values.reference,
      amount,
      values.documentUrl,
      values.paymentUrl,
    ];
  } else if (checked.kind === 'REMINDER') {
    if (!values.paymentUrl)
      throw new Error('A reminder payment link is required.');
    parameters = [
      values.resident,
      values.agency,
      amount,
      values.documentUrl,
      values.paymentUrl,
    ];
  } else
    parameters = [values.resident, values.agency, amount, values.documentUrl];
  return {
    name: checked.name,
    language: checked.language,
    parameters,
    ...(checked.qrHeader ? { qrUrl } : {}),
  };
}
const labels = {
  en: {
    INVOICE: 'Invoice',
    REMINDER: 'Payment reminder',
    CREDIT_HOLD: 'Delivery paused for outstanding balance',
    greeting: 'Hello',
    due: 'Outstanding at preparation',
    document: 'Document',
    payment: 'Payment link',
    note: 'Later payments may change this amount. Contact the agency if already paid.',
  },
  ml: {
    INVOICE: 'ബിൽ',
    REMINDER: 'പണമടയ്ക്കാനുള്ള ഓർമ്മപ്പെടുത്തൽ',
    CREDIT_HOLD: 'കുടിശ്ശിക കാരണം വിതരണം നിർത്തിവച്ചിരിക്കുന്നു',
    greeting: 'നമസ്കാരം',
    due: 'തയ്യാറാക്കിയ സമയത്തെ കുടിശ്ശിക',
    document: 'രേഖ',
    payment: 'പണമടയ്ക്കാനുള്ള ലിങ്ക്',
    note: 'പിന്നീട് അടച്ച തുക മൂലം കുടിശ്ശിക മാറാം. ഇതിനകം അടച്ചിട്ടുണ്ടെങ്കിൽ ഏജൻസിയെ ബന്ധപ്പെടുക.',
  },
  hi: {
    INVOICE: 'बिल',
    REMINDER: 'भुगतान अनुस्मारक',
    CREDIT_HOLD: 'बकाया राशि के कारण वितरण रोका गया',
    greeting: 'नमस्ते',
    due: 'तैयार करते समय बकाया',
    document: 'दस्तावेज़',
    payment: 'भुगतान लिंक',
    note: 'बाद के भुगतान से यह राशि बदल सकती है। पहले ही भुगतान किया हो तो एजेंसी से संपर्क करें।',
  },
} satisfies Record<Locale, Record<string, string>>;

export function noticeText(
  kind: NoticeKind,
  locale: Locale,
  values: NoticeValues,
): string {
  if (
    !Object.hasOwn(labels, locale) ||
    !Object.hasOwn(labels.en, kind) ||
    !['INVOICE', 'REMINDER', 'CREDIT_HOLD'].includes(kind)
  )
    throw new Error('Choose a supported message kind and language.');
  const text = labels[locale];
  return [
    `${text.greeting} ${values.resident},`,
    `${values.agency} — ${text[kind]}${values.reference ? ` ${values.reference}` : ''}`,
    `${text.due}: ${formatMoney(values.amount)}`,
    values.documentUrl ? `${text.document}: ${values.documentUrl}` : '',
    values.paymentUrl ? `${text.payment}: ${values.paymentUrl}` : '',
    text.note,
  ]
    .filter(Boolean)
    .join('\n');
}
