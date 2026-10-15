import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import pg from 'pg';
const dbUrl = new URL(process.env.TASK29B_DATABASE_URL || '');
if (process.env.CI !== 'true' || process.env.STRIGUNOV_SYNTHETIC_ONLY !== 'YES' || !['localhost','127.0.0.1'].includes(dbUrl.hostname) || dbUrl.pathname !== '/task29b') throw Error('Isolation gate denied');
const client = new pg.Client({connectionString: dbUrl.href});
const port = 33000;
const secret = 'task29b-ephemeral-jwt-only-123456789012345678901234';
const sign = (o) => {
  const b = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const data = b({alg:'HS256',typ:'JWT'}) + '.' + b(o);
  return data + '.' + createHmac('sha256',secret).update(data).digest('base64url');
};
await client.connect();
let contactId;
try {
  // The existing migration explicitly creates service_role_full_access policy via auth.role().
  await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='task29b_authenticator') THEN CREATE ROLE task29b_authenticator LOGIN NOINHERIT PASSWORD 'task29b_ci_only'; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$");
  await client.query('GRANT service_role TO task29b_authenticator');
  await client.query("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$");
  await client.query('GRANT USAGE ON SCHEMA public TO service_role');
  await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_contacts TO service_role');
  await client.query('GRANT USAGE ON SCHEMA auth TO service_role');
  await client.query('GRANT EXECUTE ON FUNCTION auth.role() TO service_role');
  const token = sign({role:'service_role', exp:Math.floor(Date.now()/1000)+300});
  const base = 'http://127.0.0.1:' + port + '/crm_contacts';
  let online = false;
  for (let i=0;i<30;i++) {
    try { const res = await fetch(base + '?select=id', {headers:{Authorization:'Bearer '+token,apikey:token}}); if(res.ok) {online=true; break;} } catch {}
    await new Promise(r=>setTimeout(r,1000));
  }
  assert.equal(online,true,'PostgREST failed health/readiness');
  const name = 'Task29B-only-public-route';
  const headers = {Authorization:'Bearer '+token, apikey:token,'Content-Type':'application/json',Prefer:'return=representation'};
  const insert = await fetch(base,{method:'POST',headers,body:JSON.stringify({name,source:'test',role:'owner',status:'new_lead',telegram_username:'task29b_only'})});
  if (insert.status !== 201) throw Error('PostgREST insert '+insert.status+': '+await insert.text()); 
  const body = await insert.json();
  contactId = body[0].id;
  const read = await fetch(base+'?id=eq.'+encodeURIComponent(contactId)+'&select=id,name,source,telegram_username',{headers});
  assert.equal(read.status,200);
  const rows = await read.json();
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,name);
  assert.equal(rows[0].telegram_username,'task29b_only');
  const unauthorized = await fetch(base+'?select=id',{headers:{Authorization:'Bearer invalid-token'}});
  assert.equal(unauthorized.status,401);
  await client.query('DELETE FROM public.crm_contacts WHERE id=$1',[contactId]);
  contactId=undefined;
  process.stdout.write('REAL_POSTGREST_TO_POSTGRES_INSERT_READBACK=PASS\\nINVALID_JWT_REJECTED=PASS\\nNEXTJS_API_TO_OPERATOR=NOT_RUN\\n');
} finally {
  if(contactId) await client.query('DELETE FROM public.crm_contacts WHERE id=$1',[contactId]).catch(()=>{});
  await client.end();
}
