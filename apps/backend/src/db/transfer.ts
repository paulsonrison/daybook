import pg from 'pg';
import { createHash } from 'node:crypto';

type Table = {
  name: string;
  tenant: boolean;
  keys: string[];
  columns: string[];
  identity: boolean;
};
type Grant = {
  object: string;
  privilege: string;
  column: string | null;
  kind: 'TABLE' | 'FUNCTION';
  grantable: boolean;
};
export interface TransferResult {
  tables: number;
  rows: number;
  sha256: string;
}
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const fingerprint = (url: string) => {
  const parsed = new URL(url);
  return createHash('sha256')
    .update(`${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`)
    .digest('hex');
};
async function tables(c: pg.Client): Promise<Table[]> {
  return (
    await c.query(`SELECT quote_ident(n.nspname)||'.'||quote_ident(t.relname) AS name,
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attname='agency_id' AND NOT a.attisdropped) AS tenant,
    ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' ORDER BY a.attnum) AS columns,
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped AND (a.attidentity<>'' OR pg_get_expr((SELECT d.adbin FROM pg_attrdef d WHERE d.adrelid=t.oid AND d.adnum=a.attnum),t.oid) LIKE 'nextval(%')) AS identity,
    ARRAY(SELECT a.attname FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum WHERE i.indrelid=t.oid AND i.indisprimary ORDER BY k.ord)::text[] AS keys
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE t.relkind='r' AND (n.nspname='daybook' OR(n.nspname='public' AND t.relname='daybook_migrations')) ORDER BY n.nspname,t.relname`)
  ).rows;
}
async function grants(c: pg.Client): Promise<Grant[]> {
  return (
    await c.query(`SELECT quote_ident(n.nspname)||'.'||quote_ident(t.relname) AS object,x.privilege_type AS privilege,NULL::text AS column,'TABLE' AS kind,x.is_grantable AS grantable
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN LATERAL aclexplode(t.relacl) x JOIN pg_roles r ON r.oid=x.grantee WHERE n.nspname='daybook' AND t.relkind='r' AND r.rolname='daybook_app'
    UNION ALL SELECT quote_ident(n.nspname)||'.'||quote_ident(t.relname),x.privilege_type,a.attname,'TABLE',x.is_grantable FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid=x.grantee WHERE n.nspname='daybook' AND NOT a.attisdropped AND r.rolname='daybook_app'
    UNION ALL SELECT quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||pg_get_function_identity_arguments(p.oid)||')',x.privilege_type,NULL,'FUNCTION',x.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) x JOIN pg_roles r ON r.oid=x.grantee WHERE n.nspname='daybook' AND r.rolname='daybook_app'`)
  ).rows;
}
async function applyGrants(c: pg.Client, items: Grant[], restore: boolean) {
  for (const item of items) {
    // All fragments originate in pg_catalog, never in a request/document.
    if (
      ![
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
        'EXECUTE',
        'MAINTAIN',
      ].includes(item.privilege)
    )
      throw new Error('Unsupported source privilege.');
    const privilege =
      item.privilege + (item.column ? ` (${identifier(item.column)})` : '');
    await c.query(
      `${restore ? 'GRANT' : 'REVOKE'} ${privilege} ON ${item.kind} ${item.object} ${restore ? 'TO' : 'FROM'} daybook_app${restore && item.grantable ? ' WITH GRANT OPTION' : ''}`,
    );
  }
}
async function hashRows(
  c: pg.Client,
  list: Table[],
  consume?: (
    table: Table,
    payloads: string[],
    agency: string,
    agent: string,
  ) => Promise<void>,
) {
  const agencies = (
    await c.query('SELECT id FROM daybook.agencies ORDER BY id')
  ).rows.map((r) => r.id as string);
  const hash = createHash('sha256');
  let rows = 0;
  for (const table of list) {
    if (!table.keys.length)
      throw new Error(
        'Transfer requires a stable primary key for every table.',
      );
    hash.update(table.name + '\n');
    const scopes =
      table.name === 'daybook.agent_preferences'
        ? (
            await c.query(
              'SELECT agency_id AS agency,id AS agent FROM daybook.agents ORDER BY agency_id,id',
            )
          ).rows
        : (table.tenant ? agencies : ['']).map((agency) => ({
            agency,
            agent: '',
          }));
    for (const { agency, agent } of scopes) {
      await c.query("SELECT set_config('daybook.agency_id',$1,true)", [agency]);
      await c.query("SELECT set_config('app.agent_id',$1,true)", [agent]);
      await c.query(
        `DECLARE daybook_transfer_cursor NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS payload FROM ${table.name} t ${table.tenant ? "WHERE agency_id=current_setting('daybook.agency_id')::uuid" : ''} ${table.name === 'daybook.agent_preferences' ? "AND agent_id=current_setting('app.agent_id')::uuid" : ''} ORDER BY ${table.keys.map(identifier).join(',')}`,
      );
      try {
        while (true) {
          const batch = (
            await c.query('FETCH 1 FROM daybook_transfer_cursor')
          ).rows.map((r) => r.payload as string);
          if (!batch.length) break;
          if (batch.some((payload) => Buffer.byteLength(payload) > 33554432))
            throw new Error('A source row exceeds the bounded migration size.');
          for (const payload of batch) {
            hash.update(payload);
            hash.update('\n');
            rows++;
          }
          if (consume) await consume(table, batch, agency, agent);
        }
      } finally {
        await c.query('CLOSE daybook_transfer_cursor');
      }
    }
  }
  return { tables: list.length, rows, sha256: hash.digest('hex') };
}
/** Only an empty, bootstrapped target is eligible. The completed journal prevents startup recopy. */
export async function transferDatabase(
  sourceUrl: string,
  targetUrl: string,
  options: { id: string; cutover: boolean },
): Promise<TransferResult> {
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(options.id) ||
    fingerprint(sourceUrl) === fingerprint(targetUrl)
  )
    throw new Error('Invalid database transfer identity.');
  const target = new pg.Client({
    connectionString: targetUrl,
    connectionTimeoutMillis: 15000,
    query_timeout: 120000,
  });
  target.on('error', (error) => {
    if (process.env.DAYBOOK_MIGRATION_DEBUG === 'true')
      console.error('target idle disconnect:', error.message);
  });
  // pg also emits an idle error after a disconnected query rejects.
  // Keep control in the awaited-query/journal recovery path.
  target.on('error', () => {});
  await target.connect();
  let source: pg.Client | undefined,
    oldGrants: Grant[] | undefined,
    targetCommitted = false,
    commitAttempted = false,
    targetClosed = false;
  try {
    await target.query('SELECT pg_advisory_lock(78130422)');
    await target.query(
      'CREATE TABLE IF NOT EXISTS public.daybook_transfer_results(id text PRIMARY KEY,source_hash text NOT NULL,result jsonb NOT NULL,completed_at timestamptz NOT NULL DEFAULT now())',
    );
    const old = (
      await target.query(
        'SELECT source_hash,result FROM public.daybook_transfer_results WHERE id=$1',
        [options.id],
      )
    ).rows[0];
    if (old) {
      if (old.source_hash !== fingerprint(sourceUrl))
        throw new Error(
          'Transfer source does not match the completed destination.',
        );
      return old.result;
    }
    const destinationTables = await tables(target);
    if (
      (await target.query('SELECT count(*)::text AS n FROM daybook.agencies'))
        .rows[0].n !== '0'
    )
      throw new Error(
        'Destination must be empty; existing records are never replaced.',
      );
    for (const table of destinationTables.filter(
      (t) => t.name !== 'public.daybook_migrations',
    )) {
      if (
        (
          await target.query(
            `SELECT EXISTS(SELECT 1 FROM ${table.name}) AS populated`,
          )
        ).rows[0].populated
      )
        throw new Error('Destination must be empty.');
    }
    source = new pg.Client({
      connectionString: sourceUrl,
      connectionTimeoutMillis: 15000,
      query_timeout: 120000,
    });
    source.on('error', (error) => {
      if (process.env.DAYBOOK_MIGRATION_DEBUG === 'true')
        console.error('source idle disconnect:', error.message);
    });
    source.on('error', () => {});
    await source.connect();
    await source.query('SELECT pg_advisory_lock(78130423)');
    const list = await tables(source);
    if (JSON.stringify(list) !== JSON.stringify(destinationTables))
      throw new Error(
        'Source and destination schemas differ. Apply matching migrations first.',
      );
    if (list.some((t) => t.identity))
      throw new Error(
        'Identity/sequence columns need an explicit sequence migration before transfer.',
      );
    const lock = `LOCK TABLE ${list.map((t) => t.name).join(',')} IN SHARE MODE`;
    if (options.cutover) {
      await source.query(
        'CREATE TABLE IF NOT EXISTS public.daybook_transfer_maintenance(id text PRIMARY KEY,grants jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())',
      );
      const saved = (
        await source.query(
          'SELECT grants FROM public.daybook_transfer_maintenance WHERE id=$1',
          [options.id],
        )
      ).rows[0];
      oldGrants = saved?.grants ?? (await grants(source));
      await source.query('BEGIN');
      await source.query("SET LOCAL lock_timeout='30s'");
      await source.query(lock);
      if (!saved)
        await source.query(
          'INSERT INTO public.daybook_transfer_maintenance(id,grants) VALUES($1,$2::jsonb)',
          [options.id, JSON.stringify(oldGrants)],
        );
      await applyGrants(source, oldGrants!, false);
      await source.query('COMMIT');
    }
    await source.query('BEGIN');
    await source.query("SET LOCAL lock_timeout='30s'");
    await source.query("SET LOCAL TIME ZONE 'UTC'");
    await source.query(lock);
    await target.query('BEGIN');
    await target.query("SET LOCAL TIME ZONE 'UTC'");
    const foreignKeys = (
      await target.query(
        `SELECT quote_ident(n.nspname)||'.'||quote_ident(t.relname) AS object,c.conname AS name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='daybook' AND c.contype='f' ORDER BY t.relname,c.conname`,
      )
    ).rows;
    for (const table of list) {
      await target.query(`ALTER TABLE ${table.name} DISABLE TRIGGER USER`);
      if (table.name === 'public.daybook_migrations')
        await target.query('DELETE FROM public.daybook_migrations');
    }
    for (const fk of foreignKeys)
      await target.query(
        `ALTER TABLE ${fk.object} DROP CONSTRAINT ${identifier(fk.name)}`,
      );
    const result = await hashRows(
      source,
      list,
      async (table, payloads, agency, agent) => {
        // Preserve raw PostgreSQL JSON text: parsing bigint JSON in JS would lose paise.
        if (table.name === 'daybook.agencies') {
          for (const payload of payloads) {
            const id = (
              await target.query("SELECT $1::json->>'id' AS id", [payload])
            ).rows[0].id;
            await target.query(
              "SELECT set_config('daybook.agency_id',$1,true)",
              [id],
            );
            await target.query(
              `INSERT INTO ${table.name} (${table.columns.map(identifier).join(',')}) SELECT ${table.columns.map(identifier).join(',')} FROM json_populate_recordset(NULL::${table.name},$1::json)`,
              [`[${payload}]`],
            );
          }
        } else {
          await target.query("SELECT set_config('daybook.agency_id',$1,true)", [
            agency,
          ]);
          await target.query("SELECT set_config('app.agent_id',$1,true)", [
            agent,
          ]);
          await target.query(
            `INSERT INTO ${table.name} (${table.columns.map(identifier).join(',')}) SELECT ${table.columns.map(identifier).join(',')} FROM json_populate_recordset(NULL::${table.name},$1::json)`,
            [`[${payloads.join(',')}]`],
          );
        }
      },
    );
    for (const fk of foreignKeys)
      await target.query(
        `ALTER TABLE ${fk.object} ADD CONSTRAINT ${identifier(fk.name)} ${fk.definition}`,
      );
    for (const table of list)
      await target.query(`ALTER TABLE ${table.name} ENABLE TRIGGER USER`);
    const verified = await hashRows(target, list);
    if (JSON.stringify(verified) !== JSON.stringify(result))
      throw new Error(
        'Destination verification failed; original source is retained.',
      );
    await target.query(
      'INSERT INTO public.daybook_transfer_results(id,source_hash,result) VALUES($1,$2,$3::jsonb)',
      [options.id, fingerprint(sourceUrl), JSON.stringify(result)],
    );
    commitAttempted = true;
    await target.query('COMMIT');
    targetCommitted = true;
    await source.query('COMMIT');
    return result;
  } catch (error) {
    if (process.env.DAYBOOK_MIGRATION_DEBUG === 'true')
      console.error('transfer catch phase:', {
        commitAttempted,
        targetCommitted,
      });
    if (commitAttempted && !targetCommitted) {
      // A lost COMMIT reply is not proof of rollback. End the old session and
      // wait on its migration lock before consulting a fresh committed journal.
      await target.end().catch(() => {});
      targetClosed = true;
      const confirmation = new pg.Client({
        connectionString: targetUrl,
        connectionTimeoutMillis: 15000,
        query_timeout: 15000,
      });
      try {
        confirmation.on('error', (error) => {
          if (process.env.DAYBOOK_MIGRATION_DEBUG === 'true')
            console.error('confirmation idle disconnect:', error.message);
        });
        confirmation.on('error', () => {});
        await confirmation.connect();
        await confirmation.query("SET statement_timeout='10s'");
        await confirmation.query('SELECT pg_advisory_lock(78130422)');
        const completed = (
          await confirmation.query(
            'SELECT source_hash,result FROM public.daybook_transfer_results WHERE id=$1',
            [options.id],
          )
        ).rows[0];
        if (process.env.DAYBOOK_MIGRATION_DEBUG === 'true')
          console.error('reconciliation marker found:', !!completed);
        if (completed) {
          if (completed.source_hash !== fingerprint(sourceUrl))
            throw new Error('Committed transfer identity differs.');
          targetCommitted = true;
          await source?.query('ROLLBACK').catch(() => {});
          return completed.result;
        }
      } catch {
        await source?.query('ROLLBACK').catch(() => {});
        throw new Error(
          'Migration commit outcome is unknown. Source remains fenced; verify the destination journal before operator recovery.',
        );
      } finally {
        await confirmation.end().catch(() => {});
      }
    }
    if (!targetClosed) await target.query('ROLLBACK').catch(() => {});
    if (source) {
      await source.query('ROLLBACK').catch(() => {});
      if (oldGrants && !targetCommitted) {
        await source.query('BEGIN');
        try {
          await applyGrants(source, oldGrants, true);
          await source.query(
            'DELETE FROM public.daybook_transfer_maintenance WHERE id=$1',
            [options.id],
          );
          await source.query('COMMIT');
        } catch {
          await source.query('ROLLBACK');
          throw new Error(
            'Migration failed; source maintenance needs operator recovery.',
          );
        }
      }
    }
    throw error;
  } finally {
    await source?.end();
    if (!targetClosed) await target.end();
  }
}
