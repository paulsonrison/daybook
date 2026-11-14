import QRCode from 'qrcode';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import {
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  versionMatches,
  type RequestContext,
} from '../context.js';
import { moneyString } from '../money.js';
import { agencyToday } from '../delivery/repository.js';
import { financialRead } from '../billing/transactions.js';
import { readRoutes } from '../routes/repository.js';
import { financialResidents } from './financial-residents.js';
export async function readCollectionSettings(c: PoolClient) {
  return (
    (
      await c.query<{
        upiId: string | null;
        payeeName: string | null;
        version: number;
      }>(
        'SELECT upi_id AS "upiId",payee_name AS "payeeName",version FROM daybook.collection_settings',
      )
    ).rows[0] ?? { upiId: null, payeeName: null, version: 0 }
  );
}
export const collectionSettings = (ctx: RequestContext) =>
  financialRead(ctx, readCollectionSettings);
export function saveCollectionSettings(
  ctx: RequestContext,
  input: {
    upiId: string;
    payeeName: string;
    confirmOwnership: boolean;
    version?: number;
  },
) {
  return configMutation(ctx, async (c) => {
    const old = await readCollectionSettings(c);
    if (old.version) versionMatches(old.version, input.version);
    const upiId = cleanText(input.upiId, 'agency UPI address', 265),
      payeeName = cleanText(input.payeeName, 'UPI payee name', 120);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{1,199}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test(
        upiId,
      )
    )
      return fail('Enter a valid agency UPI address.');
    if (input.confirmOwnership !== true)
      return fail(
        'Confirm the UPI address belongs to this agency before generating collection QR codes.',
      );
    await c.query(
      'INSERT INTO daybook.collection_settings(agency_id,upi_id,payee_name,confirmed_by) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id) DO UPDATE SET upi_id=excluded.upi_id,payee_name=excluded.payee_name,confirmed_by=excluded.confirmed_by,confirmed_at=now(),version=collection_settings.version+1',
      [ctx.agent!.agencyId, upiId, payeeName, ctx.agent!.id],
    );
    await audit(
      c,
      ctx,
      'COLLECTION_SETTINGS',
      ctx.agent!.agencyId,
      'UPI_IDENTITY_CONFIGURED',
      { upiId, payeeName, confirmedOwnership: true },
    );
    return readCollectionSettings(c);
  });
}
export async function buildUpiIntent(
  settings: { upiId: string | null; payeeName: string | null },
  amountPaise: bigint,
  reference: string,
  note: string,
) {
  if (!settings.upiId || !settings.payeeName || amountPaise <= 0n)
    return { upiUri: null, qrDataUrl: null };
  const uri = new URL('upi://pay');
  uri.searchParams.set('pa', settings.upiId);
  uri.searchParams.set('pn', settings.payeeName);
  uri.searchParams.set('am', moneyString(amountPaise));
  uri.searchParams.set('cu', 'INR');
  uri.searchParams.set('tr', reference);
  uri.searchParams.set('tn', note);
  const upiUri = uri.toString(),
    qrDataUrl = await QRCode.toDataURL(upiUri, {
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 256,
    });
  return { upiUri, qrDataUrl };
}
export function buildCollectionSheet(
  ctx: RequestContext,
  input: { routeId: string; fromDrop?: number; toDrop?: number },
) {
  return financialRead(ctx, async (c) => {
    const routeId = idValue(input.routeId),
      route = (await readRoutes(c, routeId))[0];
    if (!route) return fail('Route not found.', 'NOT_FOUND');
    const from = input.fromDrop ?? 1,
      to = input.toDrop ?? 99999;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 1 ||
      to < from ||
      to > 99999
    )
      return fail('Choose an ordered route-door range.');
    const today = await agencyToday(c),
      settings = await readCollectionSettings(c),
      eligible = (await financialResidents(c, today)).filter(
        (r) =>
          r.routeId === routeId &&
          r.routeActive &&
          r.status === 'ACTIVE' &&
          r.sequence !== null &&
          r.sequence >= from &&
          r.sequence <= to &&
          r.balancePaise > 0n,
      );
    if (eligible.length > 500)
      return fail(
        'Generate large collection routes in ranges of at most 500 resident doors.',
      );
    const rows = [];
    for (const resident of eligible) {
      const { upiUri, qrDataUrl } = await buildUpiIntent(
        settings,
        resident.balancePaise,
        `COL${resident.residentId.replaceAll('-', '')}${today.replaceAll('-', '')}`,
        `Daybook ${resident.code}`,
      );
      rows.push({
        residentId: resident.residentId,
        name: resident.name,
        code: resident.code,
        phone: resident.phone,
        address: resident.address,
        door: resident.door,
        sequence: resident.sequence!,
        balance: moneyString(resident.balancePaise),
        overdueAmount: moneyString(resident.overduePaise),
        overdueDays: resident.overdueDays,
        oldestDueDate: resident.oldestDueDate,
        upiUri,
        qrDataUrl,
      });
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          routeId,
          today,
          settings,
          rows: rows.map(({ qrDataUrl: _, ...r }) => r),
        }),
      )
      .digest('hex');
    return {
      fingerprint,
      routeId,
      routeName: route.name,
      date: today,
      qrStatus: settings.upiId ? 'READY' : 'NOT_CONFIGURED',
      rows,
    };
  });
}
