import type { PoolClient } from 'pg';
export interface Job {
  payload: Record<string, unknown>;
  id: string;
  kind: string;
  date: string;
  attempts: number;
}
export async function latestJobDate(client: PoolClient) {
  return (
    await client.query<{ date: string | null }>(
      "SELECT to_char(max(run_date),'YYYY-MM-DD') AS date FROM daybook.job_runs WHERE kind='MARK'",
    )
  ).rows[0].date;
}
export async function enqueueJob(
  client: PoolClient,
  agencyId: string,
  date: string,
  kind: string,
  now: Date,
  payload: Record<string, unknown> = {},
) {
  await client.query(
    "INSERT INTO daybook.job_runs(id,agency_id,job_key,kind,run_date,status,available_at,payload) VALUES(gen_random_uuid(),$1,$2,$3,$4,'PENDING',$5,$6) ON CONFLICT(agency_id,job_key) DO NOTHING",
    [
      agencyId,
      `${kind}:${date}`,
      kind,
      date,
      now.toISOString(),
      JSON.stringify(payload),
    ],
  );
}
export async function claimJob(client: PoolClient, now: Date) {
  return (await claimJobWithOutcome(client, now)).job;
}
export async function claimJobWithOutcome(client: PoolClient, now: Date) {
  const expired = await client.query(
    "UPDATE daybook.job_runs SET status='FAILED',last_error='Retry limit reached after an expired lease',lease_until=NULL WHERE status='RUNNING' AND lease_until<=$1 AND attempts>=5 RETURNING id",
    [now.toISOString()],
  );
  const job = (
    await client.query<Job>(
      `UPDATE daybook.job_runs j SET status='RUNNING',attempts=j.attempts+1,lease_until=$1::timestamptz+interval '60 seconds' WHERE id=(SELECT id FROM daybook.job_runs WHERE attempts<5 AND ((status IN('PENDING','FAILED') AND available_at<=$1) OR (status='RUNNING' AND lease_until<=$1)) ORDER BY run_date,kind,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,kind,payload,to_char(run_date,'YYYY-MM-DD') AS date,attempts`,
      [now.toISOString()],
    )
  ).rows[0];
  return { job, exhausted: expired.rowCount ?? 0 };
}
export async function lockClaim(client: PoolClient, job: Job, now: Date) {
  return Boolean(
    (
      await client.query(
        "SELECT id FROM daybook.job_runs WHERE id=$1 AND attempts=$2 AND status='RUNNING' AND lease_until>$3 FOR UPDATE",
        [job.id, job.attempts, now.toISOString()],
      )
    ).rowCount,
  );
}
export async function finishJob(
  client: PoolClient,
  id: string,
  now: Date,
  attempt: number,
) {
  await client.query(
    "UPDATE daybook.job_runs SET status='SUCCEEDED',completed_at=$2,lease_until=NULL,last_error=NULL WHERE id=$1 AND attempts=$3 AND status='RUNNING'",
    [id, now.toISOString(), attempt],
  );
}
export async function failJob(client: PoolClient, job: Job, now: Date) {
  await client.query(
    "UPDATE daybook.job_runs SET status='FAILED',lease_until=NULL,last_error='Job execution failed; retry is bounded',available_at=$2::timestamptz+($3::integer * interval '1 second') WHERE id=$1 AND attempts=$4 AND status='RUNNING'",
    [job.id, now.toISOString(), Math.min(300, 2 ** job.attempts), job.attempts],
  );
}
