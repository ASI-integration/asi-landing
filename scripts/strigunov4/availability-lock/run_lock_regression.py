"""Disposable PostgreSQL two-session regression; synthetic data only, own resources cleanup."""
import hashlib,json,os,selectors,subprocess,sys,time
NAME='asi-strigunov4-lock-regression-4b8d67e12a03'
VOLUME=NAME+'-data'
NONCE='4b8d67e12a034990b7de2fcf3a204936'
IMAGE='docker.io/supabase/postgres@sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b'
BIN='/nix/var/nix/profiles/default/bin'
def run(args,data=None,timeout=30):
 return subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
def require(ok,code):
 if not ok: raise RuntimeError(code)
def psql(sql,app='lock_control'):
 p=run(args(app),sql.encode());require(p.returncode==0,'SQL_FAILED');return p.stdout.decode().strip()
def args(app):
 return ['podman','exec','-i','--env','PGAPPNAME='+app,NAME,BIN+'/psql','-X','-qAt','-h','/lab','-U','lock_lab_admin','-d','postgres','-v','ON_ERROR_STOP=1']
def identity():
 p=run(['podman','inspect',NAME]);require(p.returncode==0,'INSPECT_FAILED');i=json.loads(p.stdout)[0]
 require(i['Config']['Labels'].get('asi.task')==NONCE and i['HostConfig']['NetworkMode']=='none' and not i['NetworkSettings'].get('Ports'),'TARGET_GUARD')
 require(i['Config']['User']=='100:101','USER_GUARD')
 require(i['HostConfig'].get('ReadonlyRootfs') is True and i['HostConfig'].get('PidsLimit')==128,'SANDBOX_LIMITS')
 require(any('no-new-privileges' in x for x in i['HostConfig'].get('SecurityOpt',[])),'NO_NEW_PRIVILEGES')
 require(not i.get('EffectiveCaps',['unknown']),'CAPABILITIES_GUARD')
 require(any(m.get('Name')==VOLUME and m.get('Destination')=='/lab' for m in i['Mounts']),'VOLUME_GUARD')
 q=run(['podman','image','inspect',i['Image']]);require(q.returncode==0 and IMAGE in json.loads(q.stdout)[0]['RepoDigests'],'IMAGE_GUARD')
 return i['Id']
def read_line(proc,timeout=10):
 with selectors.DefaultSelector() as s:
  s.register(proc.stdout,selectors.EVENT_READ)
  require(bool(s.select(timeout)),'SESSION_TIMEOUT')
  return proc.stdout.readline().decode().strip()
def call(setup,key):
 return "SELECT public.create_booking_availability_hold_atomic_account_v1('11111111-1111-4111-8111-111111111111',%s,%s,NULL,'internal','2030-01-01','2030-01-03',NULL,'Synthetic lock fixture','{}','%s')->>'status';"%("'33333333-3333-4333-8333-333333333333'" if setup else 'NULL', 'NULL' if setup else "'22222222-2222-4222-8222-222222222222'",key)
def scenario(fixed):
 psql('TRUNCATE public.booking_availability_holds,public.booking_overbooking_conflict_checks;')
 a=subprocess.Popen(args('lock_a'),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 b=None
 try:
  a.stdin.write(('BEGIN; SET LOCAL ROLE service_role; '+call(True,'setup-call')+'\n').encode());a.stdin.flush()
  require(read_line(a)=='active','A_NOT_ACTIVE')
  b=subprocess.Popen(args('lock_b'),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  b.stdin.write(('BEGIN; SET LOCAL ROLE service_role; '+call(False,'property-call')+' COMMIT;\n').encode());b.stdin.close()
  if fixed:
   waiting=False
   for _ in range(50):
    if b.poll() is not None: break
    if psql("SELECT count(*) FROM pg_stat_activity WHERE application_name='lock_b' AND wait_event_type='Lock' AND wait_event='advisory';")=='1': waiting=True;break
    time.sleep(.1)
   require(waiting,'FIXED_SECOND_DID_NOT_WAIT')
   a.stdin.write(b'COMMIT;\n');a.stdin.close();require(a.wait(10)==0,'A_COMMIT_FAILED')
   require(b.wait(10)==0,'B_FAILED');status=b.stdout.read().decode().strip()
   require(status=='conflict','FIXED_SECOND_NOT_CONFLICT')
   return {'first':'active','second_waited_on_advisory':True,'second_after_first_commit':status}
  require(b.wait(10)==0,'OLD_SECOND_FAILED');status=b.stdout.read().decode().strip();require(status=='active','OLD_RACE_NOT_REPRODUCED')
  require(a.poll() is None,'A_NOT_OPEN')
  a.stdin.write(b'COMMIT;\n');a.stdin.close();require(a.wait(10)==0,'A_COMMIT_FAILED')
  return {'first':'active','second_before_first_commit':status,'overlap_reproduced':True}
 finally:
  for proc in (a,b):
   if proc is not None and proc.poll() is None: proc.kill();proc.wait()
def main():
 payload=json.load(sys.stdin);report={'status':'BLOCK','target':NAME,'source_access':'NONE','existing_restore_access':'NONE'};owned_volume=False;owned_container=False
 try:
  require(os.getuid()==0,'ROOT_REQUIRED')
  for k in ('schema','old','forward'):
   require(hashlib.sha256(payload[k].encode()).hexdigest()==payload['hashes'][k],'INPUT_HASH')
  require(payload['hashes']['schema']=='c1dc98a1a3fb8d8421059b3e4a57b2274b456db1244dcc3a0663dee992aa17a1','SCHEMA_PIN')
  require(payload['hashes']['old']=='3cfe8b6a5c47996f8159739b4efb2e22dd9be150fc1f63613b067302676c551c','OLD_PIN')
  require(payload['hashes']['forward']=='782c83e99c20ef8882f7b6e428ad9287fd5b5d417f92697d98ef79c0da1f878c','FORWARD_PIN')
  require(run(['podman','container','exists',NAME]).returncode==1,'EXISTING_CONTAINER')
  require(run(['podman','volume','exists',VOLUME]).returncode==1,'EXISTING_VOLUME')
  p=run(['podman','volume','create','--label','asi.task='+NONCE,VOLUME]);require(p.returncode==0,'VOLUME_CREATE');owned_volume=True
  v=json.loads(run(['podman','volume','inspect',VOLUME]).stdout)[0];require(v.get('Labels',{}).get('asi.task')==NONCE,'VOLUME_LABEL')
  mount=v['Mountpoint'];require(mount.startswith('/var/lib/containers/storage/volumes/'+VOLUME+'/'),'VOLUME_PATH')
  os.chown(mount,100,101);os.chmod(mount,0o700)
  cmd=BIN+'/initdb -D /lab/data -U lock_lab_admin --auth-local=trust --auth-host=reject >/dev/null && exec '+BIN+"/postgres -D /lab/data -k /lab -c listen_addresses='' -c max_connections=12 -c shared_buffers=32MB"
  p=run(['podman','run','-d','--name',NAME,'--label','asi.task='+NONCE,'--network','none','--memory','512m','--read-only','--cap-drop=all','--security-opt=no-new-privileges','--pids-limit','128','--user','100:101','--mount','type=volume,source='+VOLUME+',destination=/lab','--entrypoint','/bin/sh',IMAGE,'-c',cmd]);require(p.returncode==0,'CONTAINER_CREATE');owned_container=True
  report['container_id']=identity()
  ready=False
  for _ in range(60):
   if run(['podman','exec',NAME,BIN+'/pg_isready','-h','/lab','-U','lock_lab_admin']).returncode==0:ready=True;break
   time.sleep(.2)
  require(ready,'DB_NOT_READY')
  psql(payload['schema']);psql(payload['old']);report['old']=scenario(False)
  before=psql("SELECT proowner::text||':'||coalesce(proacl::text,'NULL') FROM pg_proc WHERE proname='create_booking_availability_hold_atomic_account_v1';")
  psql(payload['forward']);after=psql("SELECT proowner::text||':'||coalesce(proacl::text,'NULL') FROM pg_proc WHERE proname='create_booking_availability_hold_atomic_account_v1';")
  require(before==after,'OWNER_ACL_CHANGED');report['owner_acl_unchanged']=True
  report['fixed']=scenario(True);report['input_hashes']=payload['hashes'];report['status']='TWO_SESSION_REGRESSION_PASS'
 except Exception as e:
  report['reason']=str(e) if isinstance(e,RuntimeError) else 'PRIVATE_REGRESSION_FAILURE'
 finally:
  if owned_container:
   try:
    ci=json.loads(run(['podman','inspect',NAME]).stdout)[0]
    require(ci['Config']['Labels'].get('asi.task')==NONCE,'CLEANUP_CONTAINER_LABEL')
    report['container_removed']=run(['podman','rm','-f',NAME]).returncode==0
   except Exception:report['container_removed']=False
  if owned_volume:
   try:
    v=json.loads(run(['podman','volume','inspect',VOLUME]).stdout)[0]
    require(v.get('Labels',{}).get('asi.task')==NONCE,'CLEANUP_VOLUME_LABEL')
    report['volume_removed']=run(['podman','volume','rm',VOLUME]).returncode==0
   except Exception:report['volume_removed']=False
  if not report.get('container_removed') or not report.get('volume_removed'):report['status']='BLOCK'
 print(json.dumps(report,sort_keys=True))
if __name__=='__main__':main()
