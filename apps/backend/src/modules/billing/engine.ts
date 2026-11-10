import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { cleanText, fail, idValue, versionMatches } from '../context.js';
import { moneyString, parseMoney } from '../money.js';
import { agencyToday } from '../delivery/repository.js';
import { readLedger } from '../ledger/repository.js';
import { calendarDate } from '../scheduling/calendar.js';
import {
  correctedLine,
  monthPeriod,
  normalizePeriods,
  weeklyPeriod,
} from './periods.js';
import type {
  BillCorrection,
  BillInput,
  BillLine,
  BillPreview,
  DeliverySource,
  InvoicePayload,
} from './model.js';
import {
  billingResident,
  findInvoice,
  missingPreparation,
  readDeliverySources,
  readInvoicePayload,
  readMerchandiseSources,
  readPolicy,
} from './repository.js';
export async function buildBill(
  c: PoolClient,
  input: BillInput,
  now = new Date(),
  preparationStart?: string,
) {
  const today = await agencyToday(c, now),
    residentId = idValue(input.residentId),
    resident = await billingResident(c, residentId);
  if (!resident) return fail('Resident not found.', 'NOT_FOUND');
  if (resident.dropOrder === null)
    return fail(
      'The resident delivery point is missing. Restore it before billing.',
    );
  if (
    !['MONTHLY', 'WEEKLY', 'CUSTOM', 'SELECTED_MONTHS'].includes(
      input.periodMode,
    )
  )
    return fail('Choose a supported billing frequency.');
  const existing = input.invoiceId
    ? await findInvoice(c, idValue(input.invoiceId))
    : undefined;
  const periods = normalizePeriods(input.periods, today);
  if (
    input.periodMode === 'MONTHLY' &&
    (periods.length !== 1 ||
      JSON.stringify(
        monthPeriod(periods[0].from.slice(0, 7), existing?.issuedDate ?? today),
      ) !== JSON.stringify(periods[0]))
  )
    return fail(
      'Monthly billing needs a complete past month or the current month through today.',
    );
  if (
    input.periodMode === 'WEEKLY' &&
    (periods.length !== 1 ||
      JSON.stringify(weeklyPeriod(periods[0].from, today)) !==
        JSON.stringify(periods[0]))
  )
    return fail('Weekly billing needs seven consecutive recorded dates.');
  if (
    input.periodMode === 'SELECTED_MONTHS' &&
    input.periods.some(
      (p) =>
        p.to.slice(0, 7) >= today.slice(0, 7) ||
        p.from !== monthPeriod(p.from.slice(0, 7), today).from ||
        p.to !== monthPeriod(p.to.slice(0, 7), today).to,
    )
  )
    return fail('Select complete past calendar months.');
  if (input.invoiceId) {
    if (
      !existing ||
      existing.state !== 'ISSUED' ||
      existing.residentId !== residentId
    )
      return fail('Invoice not found.', 'NOT_FOUND');
    versionMatches(existing.version, input.version);
    if (existing.locked)
      return fail(
        'This bill is settled or its financial period is closed. Record a separate adjustment in an open period.',
        'CONFLICT',
      );
    if (
      existing.periodMode !== input.periodMode ||
      JSON.stringify(existing.periods.map((p) => [p.from, p.to])) !==
        JSON.stringify(periods.map((p) => [p.from, p.to]))
    )
      return fail(
        'Keep the saved invoice period unchanged. Generate a separate bill for additional periods.',
      );
  }
  const oldPayload = existing
      ? await readInvoicePayload(c, existing.id, existing.version)
      : undefined,
    corrections = input.corrections ?? oldPayload?.inputs.corrections ?? [],
    adjustments = input.adjustments ?? oldPayload?.inputs.adjustments ?? [];
  if (
    !Array.isArray(corrections) ||
    corrections.length > 1000 ||
    !Array.isArray(adjustments) ||
    adjustments.length > 100
  )
    return fail('Too many bill corrections or adjustments.');
  const correctionsByKey = new Map<string, (typeof corrections)[number]>();
  for (const correction of corrections) {
    if (
      typeof correction.key !== 'string' ||
      correctionsByKey.has(correction.key)
    )
      return fail('Correct each bill line only once.');
    correctionsByKey.set(correction.key, correction);
  }
  const policy = await readPolicy(c),
    sources = await readDeliverySources(c, residentId, periods, existing?.id),
    merchandise = await readMerchandiseSources(
      c,
      residentId,
      periods,
      existing?.id,
    ),
    ledger = await readLedger(c, residentId),
    missing = await missingPreparation(c, periods, preparationStart),
    groups = new Map<string, DeliverySource[]>();
  for (const source of sources) {
    const key = `DELIVERY:${source.publicationId}:${source.pricePaise}`;
    const group = groups.get(key) ?? [];
    group.push(source);
    groups.set(key, group);
  }
  const lines: BillLine[] = [],
    bindings: InvoicePayload['deliveryBindings'] = [];
  let currentAmount = 0n;
  for (const [key, group] of groups) {
    const baseQuantity = group.reduce(
        (sum, r) => sum + r.chargeableQuantity,
        0,
      ),
      baseRate = group[0].pricePaise,
      correction = correctionsByKey.get(key) ?? ({ key } as BillCorrection),
      memberMap = new Map<string, number>();
    if (correction.deliveryQuantities) {
      if (!Array.isArray(correction.deliveryQuantities))
        return fail('Choose valid delivery corrections.');
      for (const member of correction.deliveryQuantities) {
        const id = idValue(member.deliveryId);
        if (memberMap.has(id) || !group.some((r) => r.id === id))
          return fail(
            'A corrected delivery is not on this bill line.',
            'NOT_FOUND',
          );
        if (
          !Number.isInteger(member.quantity) ||
          member.quantity < 0 ||
          member.quantity > 2147483647
        )
          return fail('Enter a nonnegative corrected delivery quantity.');
        memberMap.set(id, member.quantity);
      }
    }
    const perDelivery = group.map((r) => ({
      id: r.id,
      date: r.date,
      sourceQuantity: r.chargeableQuantity,
      quantity: memberMap.get(r.id) ?? r.chargeableQuantity,
      status: r.status,
    }));
    let quantity =
      correction.quantity ??
      perDelivery.reduce((sum, r) => sum + r.quantity, 0);
    if (
      memberMap.size &&
      quantity !== perDelivery.reduce((sum, r) => sum + r.quantity, 0)
    )
      return fail('The line quantity must match its selected delivery dates.');
    if (quantity !== baseQuantity && !memberMap.size) {
      if (group.length !== 1)
        return fail(
          'Choose the delivery dates affected by this quantity correction.',
        );
      perDelivery[0].quantity = quantity;
    }
    const corrected = correctedLine(baseQuantity, baseRate, {
      ...correction,
      quantity,
    });
    currentAmount += corrected.amountPaise;
    lines.push({
      key,
      kind: 'DELIVERY',
      description: group[0].description,
      quantity: corrected.quantity,
      sourceQuantity: baseQuantity,
      rate: moneyString(corrected.ratePaise),
      sourceRate: moneyString(baseRate),
      amount: moneyString(corrected.amountPaise),
      reason: corrected.reason,
      from: group[0].date,
      to: group[group.length - 1].date,
      deliveryItems: perDelivery,
    });
    for (const member of perDelivery)
      bindings.push({
        deliveryId: member.id,
        quantity: member.quantity,
        rate: moneyString(corrected.ratePaise),
      });
    correctionsByKey.delete(key);
  }
  if (correctionsByKey.size)
    return fail(
      'A corrected publication is no longer available on this bill. Recalculate from the current records.',
      'CONFLICT',
    );
  for (const item of merchandise) {
    currentAmount += item.amountPaise;
    lines.push({
      key: `MERCHANDISE:${item.id}`,
      kind: 'MERCHANDISE',
      description: item.description,
      quantity: item.quantity,
      sourceQuantity: item.quantity,
      rate: moneyString(item.unitPaise),
      sourceRate: moneyString(item.unitPaise),
      amount: moneyString(item.amountPaise),
      reason: null,
      from: item.date,
      to: item.date,
      deliveryItems: [],
    });
  }
  const adjustmentIds = new Set<string>();
  let adjustmentsTotal = 0n;
  const cleanAdjustments = adjustments.map((adjustment) => {
    const id = idValue(adjustment.id);
    if (
      adjustmentIds.has(id) ||
      !['CREDIT', 'SURCHARGE'].includes(adjustment.kind)
    )
      return fail('Use distinct valid credit or surcharge adjustments.');
    adjustmentIds.add(id);
    const amount = parseMoney(adjustment.amount);
    if (amount === 0n) return fail('Enter an adjustment greater than zero.');
    const reason = cleanText(adjustment.reason, 'adjustment reason', 1000),
      signed = adjustment.kind === 'CREDIT' ? -amount : amount;
    adjustmentsTotal += signed;
    lines.push({
      key: `ADJUSTMENT:${id}`,
      kind: 'ADJUSTMENT',
      description: reason,
      quantity: 1,
      sourceQuantity: 0,
      rate: moneyString(amount),
      sourceRate: '0.00',
      amount: moneyString(signed),
      reason,
      from: today,
      to: today,
      deliveryItems: [],
    });
    return { ...adjustment, id, amount: moneyString(amount), reason };
  });
  const invoiceTotal = currentAmount + adjustmentsTotal;
  if (invoiceTotal < 0n)
    return fail(
      'Credits exceed current charges. Record the excess as a separate account credit.',
    );
  parseMoney(moneyString(invoiceTotal));
  let previousBalance = 0n,
    paymentsReceived = 0n;
  for (const entry of ledger) {
    if (
      entry.invoiceId === existing?.id ||
      ['MERCHANDISE_CASH', 'MERCHANDISE_CASH_PAYMENT'].includes(entry.kind)
    )
      continue;
    if (entry.date < periods[0].from) previousBalance += entry.amountPaise;
    else if (['PAYMENT', 'REFUND'].includes(entry.kind))
      paymentsReceived -= entry.amountPaise;
    else previousBalance += entry.amountPaise;
  }
  const due = invoiceTotal + previousBalance - paymentsReceived,
    issuedDate = existing?.issuedDate ?? today,
    dueDate =
      existing?.dueDate ??
      new Date(calendarDate(today).valueOf() + policy.defaultDueDays * 86400000)
        .toISOString()
        .slice(0, 10),
    rawNote = input.note ?? oldPayload?.inputs.note ?? '',
    note = rawNote ? cleanText(rawNote, 'invoice note', 2000) : '';
  const party = existing
    ? {
        id: residentId,
        name: existing.residentName,
        code: existing.residentCode,
        address: existing.address,
        routeId: existing.routeId,
        routeName: existing.routeName,
        dropOrder: existing.dropOrder,
      }
    : {
        id: residentId,
        name: resident.name,
        code: resident.code,
        address: resident.address,
        routeId: resident.routeId,
        routeName: resident.routeName,
        dropOrder: resident.dropOrder,
      };
  const resolved: BillInput = {
    residentId,
    periodMode: input.periodMode,
    periods,
    invoiceId: existing?.id ?? null,
    version: existing?.version ?? null,
    corrections,
    adjustments: cleanAdjustments,
    note,
  };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        resolved,
        policy,
        issuedDate,
        dueDate,
        party,
        sources: sources.map((r) => ({
          ...r,
          pricePaise: r.pricePaise.toString(),
        })),
        merchandise: merchandise.map((r) => ({
          ...r,
          unitPaise: r.unitPaise.toString(),
          amountPaise: r.amountPaise.toString(),
        })),
        ledger: ledger.map((r) => ({
          ...r,
          amountPaise: r.amountPaise.toString(),
          settledPaise: r.settledPaise.toString(),
        })),
        missing,
      }),
    )
    .digest('hex');
  const preview: BillPreview = {
    fingerprint,
    resident: party,
    periodMode: input.periodMode,
    periods,
    issuedDate,
    dueDate,
    lines,
    corrections,
    adjustments: cleanAdjustments,
    note,
    currentAmount: moneyString(currentAmount),
    adjustmentsTotal: moneyString(adjustmentsTotal),
    invoiceTotal: moneyString(invoiceTotal),
    previousBalance: moneyString(previousBalance),
    paymentsReceived: moneyString(paymentsReceived),
    totalDue: moneyString(due > 0n ? due : 0n),
    accountCredit: moneyString(due < 0n ? -due : 0n),
    tax: policy.taxTreatment === 'NO_TAX' ? '0.00' : null,
    taxTreatment: policy.taxTreatment,
    canIssue: policy.taxTreatment === 'NO_TAX',
    missingDayCount: missing.count,
    missingDays: missing.days,
  };
  return {
    preview,
    inputs: resolved,
    bindings,
    merchandiseIds: merchandise.map((r) => r.id),
    existing,
    policy,
    resident,
    invoiceTotal,
    hasActivity: sources.length + merchandise.length + adjustments.length > 0,
  };
}
