import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {testApi} from './support.js';
import {withTenant} from '../../src/db/tenant.js';
import type {Pool,PoolClient} from 'pg';
import {runAgencyJobs} from '../../src/modules/jobs/service.js';
const api=testApi();
after(()=>api.pool.end());
test('scheduled agency slices cap claimed jobs and leave cancelled work untouched for later recovery',async()=>{
  const cookie=await api.agency(),agencyId=(await api.query(cookie,'{me{agencyId}}')).data.me.agencyId;
  const now=new Date('2026-11-18T04:30:00Z');
  const tenant={id:agencyId,timezone:'Asia/Kolkata',createdAt:'2026-11-18T00:00:00Z'};
  const counts=()=>withTenant(api.pool,agencyId,async client=>(await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE status='SUCCEEDED')::int AS done FROM daybook.job_runs")).rows[0]);
  await runAgencyJobs(api.pool,tenant,now,{maxJobs:1});
  assert.deepEqual(await counts(),{total:3,done:1});
  const stop=new AbortController();stop.abort();
  await runAgencyJobs(api.pool,tenant,now,{maxJobs:1,signal:stop.signal});
  assert.deepEqual(await counts(),{total:3,done:1});
  await runAgencyJobs(api.pool,tenant,now,{maxJobs:1});
  assert.deepEqual(await counts(),{total:3,done:2});
  await runAgencyJobs(api.pool,tenant,now,{maxJobs:1});
  assert.deepEqual(await counts(),{total:3,done:3});
});
test('a cancellation immediately after a durable claim prevents the job from starting',async()=>{
  const cookie=await api.agency(),agencyId=(await api.query(cookie,'{me{agencyId}}')).data.me.agencyId;
  const now=new Date('2026-11-18T04:30:00Z'),stop=new AbortController();
  const tenant={id:agencyId,timezone:'Asia/Kolkata',createdAt:'2026-11-18T00:00:00Z'};
  const pool=new Proxy(api.pool,{get(target,key,receiver){
    if(key!=='connect')return Reflect.get(target,key,receiver);
    return async()=>{
      const client=await target.connect();
      return new Proxy(client,{get(connection,property){
        if(property!=='query'){
          const value=Reflect.get(connection,property,connection);
          return typeof value==='function'?value.bind(connection):value;
        }
        return async(...args:Parameters<PoolClient['query']>)=>{
          const result=await connection.query(...args);
          if(typeof args[0]==='string'&&args[0].includes("UPDATE daybook.job_runs j SET status='RUNNING'"))stop.abort();
          return result;
        };
      }});
    };
  }}) as Pool;
  await runAgencyJobs(pool,tenant,now,{maxJobs:1,signal:stop.signal});
  const counts=await withTenant(api.pool,agencyId,async client=>(await client.query("SELECT count(*) FILTER(WHERE status='SUCCEEDED')::int AS done,count(*) FILTER(WHERE status='RUNNING')::int AS running FROM daybook.job_runs")).rows[0]);
  assert.deepEqual(counts,{done:0,running:1});
});
