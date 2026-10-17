"""Package an existing credential-free build; no build/deploy/SQL/network actions."""
import hashlib,json,os,subprocess,tarfile,io
from pathlib import Path
ENV_TEMPLATE_BLOB='0ccdeebbd94e2cf576af1bee0b5926516ae8becf'
G0='334d93fc39d2ea51ba283dd0314bbc239ff49707'
def require(ok,message):
 if not ok:raise ValueError(message)
def package(root,output,sha,source_tree):
 root=Path(root).resolve();output=Path(output).resolve()
 require(len(sha)==40 and all(c in '0123456789abcdef' for c in sha),'invalid_sha')
 require(len(source_tree)==40 and all(c in '0123456789abcdef' for c in source_tree),'invalid_source_tree')
 require(not any(p.name != '.env.example' for p in root.glob('.env*')),'credential_file_at_build_root')
 template=root/'.env.example'
 if template.exists():
  raw=template.read_bytes();blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
  require(blob==ENV_TEMPLATE_BLOB,'unreviewed_environment_template')
 required=['.next','node_modules','package.json','package-lock.json','next.config.js']
 require(all((root/p).exists() for p in required),'incomplete_build')
 require((root/'.next/BUILD_ID').is_file(),'build_id_missing')
 require(not output.exists(),'output_already_exists')
 selected=required+(['public'] if (root/'public').exists() else [])
 entries=[]
 for name in selected:
  p=root/name;entries.append(p)
  if p.is_dir():entries.extend(sorted(p.rglob('*')))
 entries=[p for p in entries if p.relative_to(root).parts[:2] != ('.next','cache')]
 for p in entries:
  require(p.is_file() or p.is_dir() or p.is_symlink(),'special_file')
  if p.is_symlink():
   target=os.readlink(p)
   require(not os.path.isabs(target) and p.resolve().is_relative_to(root),'escaping_symlink')
  require(not p.name.startswith('.env'),'credential_file_in_release')
 output.mkdir(parents=True)
 meta={'gitSha':sha,'sourceTreeSha':source_tree,'g0SourceSha':G0,'environment':'staging','appVersion':json.loads((root/'package.json').read_text())['version']}
 archive=output/f'asi-staging-{sha}.tgz';metadata=(json.dumps(meta,indent=2)+'\n').encode()
 with tarfile.open(archive,'w:gz',dereference=False) as tar:
  for p in entries:tar.add(p,arcname=p.relative_to(root).as_posix(),recursive=False)
  info=tarfile.TarInfo('release-meta.json');info.size=len(metadata);info.mode=0o644;tar.addfile(info,io.BytesIO(metadata))
 with archive.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
 receipt={**meta,'sourceLockSha256':hashlib.sha256((root/'package-lock.json').read_bytes()).hexdigest(),'archive':archive.name,'sha256':digest,'bytes':archive.stat().st_size,'activationPerformed':False}
 (output/'artifact-manifest.json').write_text(json.dumps(receipt,indent=2)+'\n')
 return receipt
if __name__=='__main__':
 root=Path(__file__).resolve().parents[2];sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
 require(os.environ.get('REVIEWED_SOURCE_SHA')==sha,'reviewed_source_mismatch')
 require(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=root,text=True).strip()=='','dirty_tracked_source')
 source_tree=subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=root,text=True).strip()
 print(json.dumps(package(root,root/'g0-release-artifact',sha,source_tree)))
