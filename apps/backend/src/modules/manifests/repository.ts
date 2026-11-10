import type { PoolClient } from 'pg';
export interface ManifestRow {
  residentId: string;
  publicationId: string;
  subscriptionId: string;
  routeId: string;
  staffId: string | null;
  residentName: string;
  address: string;
  publicationName: string;
  routeName: string;
  staffName: string | null;
  dropOrder: number;
  quantity: number;
  price: string;
}
export interface Manifest {
  id: string;
  date: string;
  dispatch: string;
  totalCopies: number;
  rows: ManifestRow[];
  publications: { publicationId: string; name: string; copies: number }[];
  averageCopies: number | null;
  deviation: boolean;
  version: number;
}
export async function readManifests(client: PoolClient, date?: string) {
  return (
    await client.query<{
      id: string;
      payload: Omit<Manifest, 'id' | 'version'>;
      version: number;
    }>(
      `SELECT id,payload,version FROM daybook.manifests ${date ? 'WHERE manifest_date=$1' : ''} ORDER BY manifest_date,dispatch`,
      date ? [date] : [],
    )
  ).rows.map((r) => ({ ...r.payload, id: r.id, version: r.version }));
}
export async function previousTotals(
  client: PoolClient,
  date: string,
  dispatch: string,
) {
  return (
    await client.query<{ total: number }>(
      "SELECT (payload->>'totalCopies')::integer AS total FROM daybook.manifests WHERE manifest_date<$1 AND dispatch=$2 ORDER BY manifest_date DESC LIMIT 7",
      [date, dispatch],
    )
  ).rows.map((r) => r.total);
}
export async function storeManifest(
  client: PoolClient,
  agencyId: string,
  manifest: Omit<Manifest, 'version'>,
) {
  const { id, ...payload } = manifest;
  const row = (
    await client.query<{ id: string; version: number }>(
      `INSERT INTO daybook.manifests(id,agency_id,manifest_date,dispatch,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(agency_id,manifest_date,dispatch) DO UPDATE SET payload=excluded.payload,generated_at=now(),version=CASE WHEN manifests.payload=excluded.payload THEN manifests.version ELSE manifests.version+1 END RETURNING id,version`,
      [id, agencyId, manifest.date, manifest.dispatch, JSON.stringify(payload)],
    )
  ).rows[0];
  return { ...payload, ...row };
}
