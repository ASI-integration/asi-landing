"""Read-only full-row witnesses for the fixed old incident, never public data."""
import json
from pathlib import Path
import re
import tempfile
import c4_dependency_readonly as dep

PLAN = json.loads(Path(__file__).with_name("c4_retained_fixture.json").read_text(encoding="utf-8"))


def snapshot_sql(catalog, missing):
    """Hash every column of every scoped row, with stable full-PK ordering."""
    census = dep.census_sql(missing)
    prefix = census.rsplit("\nSELECT jsonb_build_object(", 1)[0]
    branches = []
    for name in sorted(set(dep.TABLES)-missing):
        branches.append(f"SELECT {dep.literal(name)} t,coalesce(jsonb_agg("
            f"encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') "
            f"ORDER BY {dep.key(name,'r')}),'[]'::jsonb) hashes FROM {dep.table(name)} r "
            f"JOIN nodes n ON n.t={dep.literal(name)} AND n.k={dep.key(name,'r')}")
    query = prefix + ", row_hashes AS (" + " UNION ALL ".join(branches) + ") "
    query += "SELECT jsonb_build_object('census',(" + census + ")::jsonb,"
    query += "'digest',encode(sha256(convert_to((SELECT jsonb_object_agg(t,hashes)::text FROM row_hashes),'UTF8')),'hex'))::text"
    return dep.guarded_sql(catalog, missing).replace(census+";\nROLLBACK;", query+";\nROLLBACK;")


def validate_snapshot(data, missing, new_fixture=False):
    """Known audit/physical evidence is mandatory; optional absence stays explicit."""
    dep.require(type(data) is dict and set(data)=={"census","digest"},"SNAPSHOT_SHAPE")
    dep.require(type(data['digest']) is str and re.fullmatch(r'[0-9a-f]{64}',data['digest']),"SNAPSHOT_DIGEST")
    receipt = dep.receipt(data['census'], missing)
    dep.require(receipt['status']=='C4_DEPENDENCY_READONLY_SCOPED_PASS','OLD_SCOPE_BLOCK')
    expected = {'booking_ops_events':24,'booking_cleaning_tasks':1,'booking_linen_tasks':1,
                'booking_supplies_tasks':1,'booking_physical_readiness':1}
    if new_fixture:
        expected.pop('booking_ops_events')
        for name in ('booking_ops_communication_auto_send_attempts','booking_ops_communication_deliveries','operational_payments','payments'):
            if name not in missing:
                dep.require(receipt['tables'][name]['incidentLinked']==0,'NEW_EXTERNAL_EFFECT_RECORD')
        dep.require(receipt['tables']['booking_ops_events']['incidentLinked'] > 0,'NEW_AUDIT_MISSING')
    for table, count in expected.items():
        dep.require(receipt['tables'][table]['incidentLinked']==count,'OLD_EVIDENCE_COUNT')
    return {'digest':data['digest'],'counts':receipt['tables'],'notDeployed':receipt['notDeployed']}


def unchanged(before, after):
    """No public hashes or row contents; any difference requires reconciliation."""
    dep.require(before == after, 'OLD_EVIDENCE_CHANGED_RECONCILE')


def scope_new_query(query, owned):
    """Replace only fixed literal root values, never identifiers or caller SQL."""
    dep.require(type(owned) is dict,'NEW_SCOPE_SHAPE')
    for key in ('userId','accountId','propertyId'):
        dep.require(owned.get(key)==PLAN[key],'NEW_ROOT_IDENTITY')
    ids={key:owned.get(key) for key in ('userId','accountId','propertyId')}
    for name in ('bookingIds','intakeIds'):
        values=owned.get(name)
        dep.require(type(values) is list and len(values)==1,'NEW_RESULT_IDENTITIES')
        ids[name]=values[0]
    dep.require(all(type(v) is str and re.fullmatch(
        r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',v) for v in ids.values()),'NEW_UUID')
    dep.require(len(set(ids.values()))==5 and not set(ids.values()) & set(dep.prior.OWNED.values()),'NEW_ID_COLLISION')
    run=owned.get('runId')
    dep.require(type(run) is str and re.fullmatch(r'[1-9][0-9]{0,19}',run),'NEW_RUN')
    for old, name in [('user','userId'),('account','accountId'),('property','propertyId'),('booking','bookingIds'),('intake','intakeIds')]:
        query=query.replace(dep.literal(dep.prior.OWNED[old]),dep.literal(ids[name]))
    query=query.replace("'staging-acceptance@asi.local'",dep.literal(PLAN['email']))
    for prefix in ('C4 staging isolated account ','C4 isolated property ','C4 synthetic guest '):
        query=query.replace(dep.literal(prefix+'39047710115'),dep.literal(prefix+run))
    return query


def capture(url, owned=None):
    """Use the existing pinned PG17/TLS client in read-only transactions only."""
    prior=dep.prior
    dep.require(prior.pg.preflight.target_valid(url),'STAGING_TARGET')
    with tempfile.TemporaryDirectory(prefix='c4-retention-') as dirname:
        folder=Path(dirname);folder.chmod(0o700)
        cert=folder/'roots.pem'
        cert.write_bytes(Path('/etc/ssl/certs/ca-certificates.crt').read_bytes()+b'\n'+prior.tls_guard.ca_bytes())
        cert.chmod(0o600)
        env=prior.pg.db_environment(url,cert,True)
        dep.require('default_transaction_read_only=on' in env['PGOPTIONS'],'READ_ONLY_REQUIRED')
        cmd=prior.pg.postgres_client_command(folder,'postcheck')
        dep.require(cmd[-2]=='-c','PSQL_SHAPE')
        cmd[-2:]=['-q','--set','VERBOSITY=sqlstate','--file','/work/retention.sql']
        query=folder/'retention.sql'
        query.write_text('BEGIN READ ONLY; SET LOCAL row_security=off;'+dep.catalog_sql()+';ROLLBACK;',encoding='utf-8')
        query.chmod(0o600)
        catalog=dep.execute(cmd,env)
        missing=dep.schema_check(catalog)
        sql=snapshot_sql(catalog,missing)
        if owned is not None: sql=scope_new_query(sql,owned)
        query.write_text(sql,encoding='utf-8')
        return validate_snapshot(dep.execute(cmd,env),missing,new_fixture=owned is not None)
