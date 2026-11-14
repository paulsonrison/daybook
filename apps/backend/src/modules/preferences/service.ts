import type { PoolClient } from 'pg';
import {
  defaultPreferences,
  validatePreferences,
  type PreferenceValues,
} from '@daybook/ui/preferences';
import {
  audit,
  configMutation,
  fail,
  versionMatches,
  type RequestContext,
} from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { onceRequest } from '../requests.js';
export interface AgentPreferencesInput {
  requestId: string;
  version: number;
  locale: string;
  mode: string;
  scheme: string;
  layout: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: string;
  lineHeight: number;
}
export async function readAgentPreferences(
  c: PoolClient,
  agentId: string,
): Promise<PreferenceValues & { version: number }> {
  await c.query("SELECT set_config('app.agent_id',$1,true)", [agentId]);
  const row = (
    await c.query(
      'SELECT locale,mode,scheme,layout,font_family AS family,font_size AS size,font_weight AS weight,font_style AS style,line_height,version FROM daybook.agent_preferences WHERE agent_id=$1',
      [agentId],
    )
  ).rows[0];
  if (!row)
    return {
      ...defaultPreferences,
      typography: { ...defaultPreferences.typography },
      version: 0,
    };
  return {
    ...validatePreferences({
      ...row,
      typography: {
        family: row.family,
        size: row.size,
        weight: row.weight,
        style: row.style,
        lineHeight: Number(row.line_height),
      },
    }),
    version: row.version,
  };
}
export const agentPreferences = (ctx: RequestContext) =>
  financialRead(ctx, (c) => readAgentPreferences(c, ctx.agent!.id));
export function saveAgentPreferences(
  ctx: RequestContext,
  input: AgentPreferencesInput,
) {
  return configMutation(ctx, async (c) => {
    await onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      `preferences.save:${ctx.agent!.id}`,
      input,
      async () => {
        const old = await readAgentPreferences(c, ctx.agent!.id);
        versionMatches(old.version, input.version);
        let value: PreferenceValues;
        try {
          value = validatePreferences({
            locale: input.locale,
            mode: input.mode,
            scheme: input.scheme,
            layout: input.layout,
            typography: {
              family: input.fontFamily,
              size: input.fontSize,
              weight: input.fontWeight,
              style: input.fontStyle,
              lineHeight: input.lineHeight,
            },
          });
        } catch (error) {
          return fail((error as Error).message);
        }
        await c.query(
          'INSERT INTO daybook.agent_preferences(agency_id,agent_id,locale,mode,scheme,layout,font_family,font_size,font_weight,font_style,line_height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(agency_id,agent_id) DO UPDATE SET locale=excluded.locale,mode=excluded.mode,scheme=excluded.scheme,layout=excluded.layout,font_family=excluded.font_family,font_size=excluded.font_size,font_weight=excluded.font_weight,font_style=excluded.font_style,line_height=excluded.line_height,version=agent_preferences.version+1,updated_at=now()',
          [
            ctx.agent!.agencyId,
            ctx.agent!.id,
            value.locale,
            value.mode,
            value.scheme,
            value.layout,
            value.typography.family,
            value.typography.size,
            value.typography.weight,
            value.typography.style,
            value.typography.lineHeight,
          ],
        );
        await audit(c, ctx, 'agent_preferences', ctx.agent!.id, 'SAVED', value);
        return { agentId: ctx.agent!.id };
      },
    );
    return readAgentPreferences(c, ctx.agent!.id);
  });
}
