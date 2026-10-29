import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const installer=fileURLToPath(new URL('./beget-install.py',import.meta.url));
const fixture=String.raw`
import importlib.util,sys,json
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1])
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
mode=sys.argv[2];sha='a'*40
review=dict(mode='OWNER_VERIFIED_CI',sourceSha=sha,result='PASS',findings=0,
  independent=False,ownerId=207600140,scope='BEGET_G2_TWO_DRAFT_WITNESSES',
  validationRunId=1001,governanceRunId=1002)
manifest={'sourceSha':sha}
if mode=='independent':
 review={'sourceSha':sha,'result':'PASS','findings':0,'independent':True}
if mode=='no-owner':review['ownerId']=42
if mode=='claimed-independent':review['independent']=True
if mode=='missing-run':review['validationRunId']=None
if mode=='wrong-sha':review['sourceSha']='b'*40
if mode=='unverified-run':review['governanceRunId']=9999
if mode=='provider-down':review['governanceRunId']=9999
calls=[]
def source(run_id,workflow_id,source_sha,event):
 calls.append((run_id,workflow_id,source_sha,event))
 if mode=='unverified-run' and run_id==9999:raise m.Block('OWNER_CI_EXACT_HEAD_FAILED')
 if mode=='provider-down' and run_id==9999:raise m.Block('OWNER_CI_PROVIDER_UNVERIFIED')
with patch.object(m,'verified_owner_ci_run',side_effect=source):
 try:m.source_review_preclaim(review,manifest)
 except m.Block as exc:
  assert mode in ('no-owner','claimed-independent','missing-run','wrong-sha','unverified-run','provider-down'),(mode,str(exc))
  assert str(exc) in ('OWNER_CI_SCOPE','SOURCE_REVIEW_NOT_PROVEN','OWNER_CI_EXACT_HEAD_FAILED','OWNER_CI_PROVIDER_UNVERIFIED')
 else:
  assert mode in ('owner','independent'),mode
  if mode=='owner':
   assert calls==[(1001,311380800,sha,'pull_request'),(1002,390653294,sha,'pull_request_target')]
  else:assert calls==[]
`;

for(const mode of ['owner','independent','no-owner','claimed-independent','missing-run','wrong-sha','unverified-run','provider-down']){
  test('source review admission: '+mode,()=>{
    assert.doesNotThrow(()=>execFileSync('/usr/bin/python3',['-I','-S','-B','-c',fixture,installer,mode],{encoding:'utf8',timeout:7000}));
  });
}
test('provider run validator rejects forged external results',()=>{
const code=String.raw`
import importlib.util,io,json,sys
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def result(**kw):
 return dict(id=11,workflow_id=311380800,event='pull_request',head_sha='a'*40,
 status='completed',conclusion='success',repository={'full_name':'ASI-integration/asi-landing'},**kw)
class Response:
 status=200
 def __init__(self,v):self.v=v
 def __enter__(self):return self
 def __exit__(self,*a):pass
 def read(self,n):return json.dumps(self.v).encode()
with patch.object(m.urllib.request,'urlopen',return_value=Response(result())):
 m.verified_owner_ci_run(11,311380800,'a'*40,'pull_request')
for invalid in [
 {'conclusion':'failure'}, {'status':'in_progress'}, {'head_sha':'b'*40},
 {'workflow_id':123},{'event':'workflow_dispatch'},
 {'repository':{'full_name':'other/repo'}},
]:
 base=result();base.update(invalid)
 with patch.object(m.urllib.request,'urlopen',return_value=Response(base)):
  try:m.verified_owner_ci_run(11,311380800,'a'*40,'pull_request')
  except m.Block as e:assert str(e)=='OWNER_CI_EXACT_HEAD_FAILED'
  else:raise AssertionError('forged run accepted')
with patch.object(m.urllib.request,'urlopen',side_effect=OSError('network down')):
 try:m.verified_owner_ci_run(11,311380800,'a'*40,'pull_request')
 except m.Block as e:assert str(e)=='OWNER_CI_PROVIDER_UNVERIFIED'
 else:raise AssertionError('provider error was accepted')
`;
assert.doesNotThrow(()=>execFileSync('/usr/bin/python3',['-I','-S','-B','-c',code,installer],{timeout:7000}));
});
