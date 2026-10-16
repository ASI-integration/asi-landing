"""Staging-only activation candidate. Default read-only; reviewed protected backend required.
Assumes artifact has already been safely unpacked/verified into its immutable release.
Does not install packages, change env/unit files, extract archives, or migrate DB.
"""
import argparse,hashlib,json,os,subprocess,time,urllib.request
from pathlib import Path
BASE=Path('/var/www/asi-staging')
SERVICE='asi-landing-staging'
OLD='5c91b27bcde395f01cc078d1fbe454dd7436e1c6'
NEW='334d93fc39d2ea51ba283dd0314bbc239ff49707'
FLAGS={'EMAIL_AUTO_SEND':'false','EMAIL_DRAFT_ONLY':'true','DRY_RUN_TELEGRAM_OUTBOUND':'true','ALLOW_REAL_TELEGRAM_SYNTHETIC':'false','YOOKASSA_ENABLED':'false','ASI_SYNTHETIC_NO_SEND':'YES'}
UNIT_DIGEST='9072dd1a276c7bea2bb7d17031a51b250177e2806cd632e26728028c0a8a01d9'
def run(*args):return subprocess.check_output(args,text=True,stderr=subprocess.DEVNULL).strip()
def check(ok,code):
 if not ok:raise RuntimeError(code)
def endpoint(path):
 with urllib.request.urlopen('http://127.0.0.1:3001/api/'+path,timeout=4) as r:
  check(r.status==200,'http_status');return json.load(r)
def effective_flags(pid):
 pairs=Path('/proc',pid,'environ').read_bytes().split(b'\0')
 values={p.split(b'=',1)[0].decode():p.split(b'=',1)[1].decode() for p in pairs if b'=' in p}
 check(all(values.get(k)==v for k,v in FLAGS.items()),'unsafe_effective_flags')
def preflight(expected):
 check(os.uname().nodename=='asi-agent-runner','wrong_host')
 unit=Path('/etc/systemd/system/asi-landing-staging.service')
 check(hashlib.sha256(unit.read_bytes()).hexdigest()==UNIT_DIGEST,'unit_drift')
 props=dict(l.split('=',1) for l in run('systemctl','show',SERVICE,'--property=User,Group,WorkingDirectory,EnvironmentFiles,DropInPaths,MainPID,ActiveState').splitlines())
 check(props.get('User')=='asi-runtime' and props.get('Group')=='asi-runtime','runtime_identity')
 check(props.get('WorkingDirectory')==str(BASE/'current'),'working_directory')
 check(props.get('DropInPaths')=='','unit_dropins_require_review')
 check(str(BASE/'shared/.env.staging.local') in props.get('EnvironmentFiles',''),'env_path')
 check(props.get('ActiveState')=='active','service_inactive')
 check((BASE/'current').is_symlink() and (BASE/'current').resolve()==BASE/'releases'/expected,'release_drift')
 env=BASE/'shared/.env.staging.local';check(env.stat().st_mode&0o777==0o640,'env_permissions')
 effective_flags(props['MainPID'])
 check(endpoint('version').get('sha')==expected,'version_drift');endpoint('health')
 ports=run('ss','-ltnH','sport = :3001').splitlines()
 check(len(ports)==1 and ports[0].split()[3]=='127.0.0.1:3001','listen_mismatch')
def swap(sha):
 # Atomic link replacement; existing releases and configuration are retained.
 tmp=BASE/('.strigunov4-'+str(os.getpid()))
 check(not tmp.exists() and not tmp.is_symlink(),'temp_link_exists')
 os.symlink(BASE/'releases'/sha,tmp);os.replace(tmp,BASE/'current')
def ready(sha):
 for _ in range(15):
  try:preflight(sha);return
  except (OSError,RuntimeError,ValueError):time.sleep(1)
 raise RuntimeError('post_switch_verification_failed')
def validate_release_metadata(metadata):
 check(metadata.get('gitSha')==NEW,'artifact_sha_mismatch')
def main():
 p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--receipt',type=Path);a=p.parse_args()
 if a.execute:
  raise RuntimeError('PROTECTED_APPLY_BACKEND_NOT_INTEGRATED')
 preflight(OLD)
 release=BASE/'releases'/NEW
 check(release.is_dir() and not release.is_symlink(),'prepared_release_missing')
 check((release/'release-meta.json').is_file(),'release_meta_missing')
 validate_release_metadata(json.loads((release/'release-meta.json').read_text()))
 check((release/'.next/BUILD_ID').is_file() and (release/'node_modules/next/dist/bin/next').is_file(),'build_missing')
 if not a.execute:print('PREFLIGHT_PASS; no activation performed');return
 check(a.receipt is not None,'protected_execution_receipt_required')
 receipt=json.loads(a.receipt.read_text())
 check(receipt.get('source_sha')==NEW and receipt.get('target')=='meeravcldnmocjtlqoeu','receipt_target')
 check(all(receipt.get(k) is True for k in ['full_restore_pass','migration_apply_pass','independent_review_pass','protected_environment_approved','artifact_digest_verified','rollback_rehearsed']),'receipt_incomplete')
 # Receipt assertions alone are NOT authorization: protected caller must verify provenance.
 run('systemctl','stop',SERVICE)
 try:
  swap(NEW);run('systemctl','start',SERVICE);ready(NEW)
 except Exception:
  run('systemctl','stop',SERVICE);swap(OLD);run('systemctl','start',SERVICE);ready(OLD)
  raise RuntimeError('activation_failed_application_rollback_pass') from None
 print('ACTIVATION_PASS; database rollback was not performed')
if __name__=='__main__':
 try:main()
 except Exception as e:
  # Never emit subprocess output, env, or exception details that may contain secrets.
  print('BLOCK: activation/preflight failed; inspect protected evidence');raise SystemExit(2)
