import { fail, idValue, type RequestContext } from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { readResidents } from '../residents/repository.js';
import { calendarDate } from '../scheduling/calendar.js';
export interface DocumentSourcesInput {
  kind: string;
  residentId?: string | null;
  staffId?: string | null;
  from?: string | null;
  to?: string | null;
  beforeDate?: string | null;
  beforeId?: string | null;
}
const sources = {
  INVOICE: {
    table: 'daybook.invoices',
    title: 'code',
    date: 'issued_date',
    version: 'version',
    party: 'resident_id',
    eligible: "state='ISSUED'",
  },
  PAYMENT_RECEIPT: {
    table: 'daybook.payments',
    title: 'receipt_code',
    date: 'received_date',
    version: 'version',
    party: 'resident_id',
    eligible:
      "status='CONFIRMED' AND receipt_code IS NOT NULL AND balance_after_paise IS NOT NULL",
  },
  PAYSLIP: {
    table: 'daybook.payslips',
    title: 'code',
    date: 'month',
    version: '1',
    party: 'staff_id',
    eligible: 'true',
  },
  CLEARANCE_REFUND: {
    table: 'daybook.clearance_refunds',
    title: 'receipt_code',
    date: 'posting_date',
    version: '1',
    party: 'resident_id',
    eligible: 'true',
  },
} as const;
export function documentSources(
  ctx: RequestContext,
  input: DocumentSourcesInput,
) {
  return financialRead(ctx, async (c) => {
    if (!Object.hasOwn(sources, input.kind))
      fail('Choose a supported financial document.');
    const spec = sources[input.kind as keyof typeof sources];
    let partyId: string;
    if (input.kind === 'PAYSLIP') {
      if (!input.staffId || input.residentId != null)
        fail('Choose a staff member for payslips.');
      partyId = idValue(input.staffId);
      if (
        !(await c.query('SELECT 1 FROM daybook.staff WHERE id=$1', [partyId]))
          .rowCount
      )
        fail('Staff member not found.', 'NOT_FOUND');
    } else {
      if (!input.residentId || input.staffId != null)
        fail('Choose a resident for these document sources.');
      partyId = idValue(input.residentId);
      if (!(await readResidents(c, partyId)).length)
        fail('Resident not found.', 'NOT_FOUND');
    }
    if (input.from != null) calendarDate(input.from);
    if (input.to != null) calendarDate(input.to);
    if (input.from && input.to && input.from > input.to)
      fail('Choose a source date range in chronological order.');
    if ((input.beforeDate != null) !== (input.beforeId != null))
      fail('Use the complete source pagination cursor.');
    if (input.beforeDate != null) {
      calendarDate(input.beforeDate);
      idValue(input.beforeId);
    }
    // Every interpolated identifier comes from the fixed source map above.
    const rows = (
      await c.query<{
        id: string;
        kind: string;
        title: string;
        date: string;
        version: number;
      }>(
        `SELECT id,$1::text AS kind,${spec.title} AS title,to_char(${spec.date},'YYYY-MM-DD') AS date,${spec.version} AS version FROM ${spec.table} WHERE ${spec.party}=$2 AND ${spec.eligible} AND ($3::date IS NULL OR ${spec.date}>=$3::date) AND ($4::date IS NULL OR ${spec.date}<=$4::date) AND ($5::date IS NULL OR (${spec.date},id)<($5::date,$6::uuid)) ORDER BY ${spec.date} DESC,id DESC LIMIT 201`,
        [
          input.kind,
          partyId,
          input.from ?? null,
          input.to ?? null,
          input.beforeDate ?? null,
          input.beforeId ?? null,
        ],
      )
    ).rows;
    return { items: rows.slice(0, 200), hasMore: rows.length > 200 };
  });
}
