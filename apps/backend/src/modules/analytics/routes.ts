import type { readAnalyticsAdvertiser } from './advertiser.js';
import type { readAnalyticsPayroll } from './payroll.js';
import type { PoolClient } from 'pg';
import type { reportMonth } from './model.js';
import { moneyString } from '../money.js';

/** Recorded delivery retail value and available procurement estimates; not invoiced revenue or net profit. */
export async function readAnalyticsRoutes(
  c: PoolClient,
  period: ReturnType<typeof reportMonth>,
  today: string,
  payroll: Awaited<ReturnType<typeof readAnalyticsPayroll>>,
  advertiser: Awaited<ReturnType<typeof readAnalyticsAdvertiser>>,
) {
  const rows = (
    await c.query<{
      routeId: string;
      snapshotNames: string[];
      retail: string;
      procurement: string;
      missing: string;
      fulfilled: string;
      missingPayroll: string;
      replacements: string;
      exceptionCopies: string;
    }>(
      `
    WITH replacements AS(
      SELECT source.agency_id,source.route_id,sum(q.replacement_copies::numeric) AS copies
      FROM daybook.complaints q JOIN daybook.delivery_logs source ON(source.agency_id,source.id)=(q.agency_id,q.delivery_id)
      WHERE q.status='REPLACEMENT' AND source.delivery_date>=$1::date AND source.delivery_date<$2::date AND source.delivery_date<=$3::date
      GROUP BY source.agency_id,source.route_id
    )
    SELECT coalesce(max(replacements.copies),0)::text AS replacements,d.route_id AS "routeId",array_agg(DISTINCT d.route_name ORDER BY d.route_name) AS "snapshotNames",
      coalesce(sum(d.price_paise::numeric*d.chargeable_quantity),0)::text AS retail,
      coalesce(sum(d.procurement_unit_paise::numeric*d.quantity) FILTER(WHERE d.status IN('DELIVERED','REPLACED')),0)::text AS procurement,
      coalesce(sum(d.quantity::numeric) FILTER(WHERE d.status IN('DELIVERED','REPLACED') AND d.procurement_unit_paise IS NULL),0)::text AS missing,
      coalesce(sum(d.quantity::numeric) FILTER(WHERE d.status IN('DELIVERED','REPLACED')),0)::text AS fulfilled,
      coalesce(sum(d.quantity::numeric) FILTER(WHERE d.status IN('MISSED','DAMAGED','CREDITED')),0)::text AS "exceptionCopies",
      coalesce(sum(d.quantity::numeric) FILTER(WHERE d.status IN('DELIVERED','REPLACED') AND NOT EXISTS(
        SELECT 1 FROM daybook.payroll_delivery_claims claim JOIN daybook.payslips slip ON(slip.agency_id,slip.id)=(claim.agency_id,claim.payslip_id)
        WHERE (claim.agency_id,claim.delivery_id)=(d.agency_id,d.id) AND slip.id=ANY($4::uuid[])
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(slip.snapshot->'deliveries') evidence WHERE evidence->>'id'=d.id::text AND evidence->>'route'=d.route_id::text)
      )),0)::text AS "missingPayroll"
    FROM daybook.delivery_logs d LEFT JOIN replacements ON(replacements.agency_id,replacements.route_id)=(d.agency_id,d.route_id)
    WHERE d.delivery_date>=$1::date AND d.delivery_date<$2::date AND d.delivery_date<=$3::date AND d.status<>'SKIPPED'
    GROUP BY d.route_id ORDER BY d.route_id
  `,
      [period.startDate, period.nextDate, today, payroll.supportedPayslips],
    )
  ).rows;
  const byRoute = new Map(rows.map((row) => [row.routeId, row]));
  for (const id of new Set([
    ...advertiser.routes.keys(),
    ...payroll.routes.keys(),
  ]))
    if (!byRoute.has(id))
      byRoute.set(id, {
        routeId: id,
        snapshotNames: [],
        retail: '0',
        procurement: '0',
        missing: '0',
        fulfilled: '0',
        missingPayroll: '0',
        replacements: '0',
        exceptionCopies: '0',
      });
  return [...byRoute.values()]
    .sort((a, b) => a.routeId.localeCompare(b.routeId))
    .map((row) => ({
      routeId: row.routeId,
      contributionBeforeShared: moneyString(
        BigInt(row.retail) +
          (advertiser.routes.get(row.routeId)?.amount ?? 0n) -
          BigInt(row.procurement) -
          (payroll.routes.get(row.routeId) ?? 0n),
      ),
      contributionCoverage:
        BigInt(row.fulfilled) === 0n
          ? 'UNAVAILABLE'
          : BigInt(row.missing) > 0n ||
              BigInt(row.missingPayroll) > 0n ||
              BigInt(row.replacements) > 0n ||
              BigInt(row.exceptionCopies) > 0n ||
              advertiser.summary.unsupportedInvoices !== '0'
            ? 'PARTIAL'
            : 'COMPLETE',
      replacementCopies: row.replacements,
      exceptionCopiesWithoutAttributedCost: row.exceptionCopies,
      postedPayroll: moneyString(payroll.routes.get(row.routeId) ?? 0n),
      payrollCopiesWithoutPostedCost: row.missingPayroll,
      payrollCoverage:
        BigInt(row.fulfilled) === 0n || row.missingPayroll === row.fulfilled
          ? 'UNAVAILABLE'
          : BigInt(row.missingPayroll) > 0n
            ? 'PARTIAL'
            : 'COMPLETE',
      advertiserSales: moneyString(
        advertiser.routes.get(row.routeId)?.amount ?? 0n,
      ),
      snapshotNames: [
        ...new Set([
          ...row.snapshotNames,
          ...(advertiser.routes.get(row.routeId)?.names ?? []),
        ]),
      ].sort(),
      chargeableRetail: moneyString(BigInt(row.retail)),
      procurementEstimate: moneyString(BigInt(row.procurement)),
      missingCostCopies: row.missing,
      fulfilledCopies: row.fulfilled,
      procurementCoverage:
        BigInt(row.fulfilled) === 0n || row.missing === row.fulfilled
          ? 'UNAVAILABLE'
          : BigInt(row.missing) > 0n
            ? 'PARTIAL'
            : 'COMPLETE',
    }));
}
