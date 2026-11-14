import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScratchGitConfig} from './change-preparer.mjs';

// Reproduces the .git/config written by a clean detached clone --no-tags.
// Only an inert fetch-policy flag is admitted, not arbitrary remote options.
const base='[core]\n\trepositoryformatversion = 0\n\tbare = false\n' +
  '[remote "origin"]\n\turl = https://example.invalid/repo.git\n' +
  '\tfetch = +refs/heads/*:refs/remotes/origin/*\n';

test('source reader accepts exact Git clone --no-tags origin config',()=>{
  assert.doesNotThrow(()=>validateScratchGitConfig(base+'\ttagOpt = --no-tags\n'));
  assert.doesNotThrow(()=>validateScratchGitConfig(base+'\tTAGOPT = --no-tags\n'));
});

test('source reader rejects all other tagOpt values and executable git settings',()=>{
  for(const line of [
    'tagOpt = --tags',
    'tagOpt = --no-tags --upload-pack=/tmp/hook',
    'tagOpt = --no-tags # extra',
    'tagOpt = --no-tags;evil',
    'tagOpt = ',
    'uploadpack = /tmp/hook',
    'proxy = http://example.invalid',
  ]) {
    assert.throws(()=>validateScratchGitConfig(base+'\t'+line+'\n'),
      /UNTRUSTED_GIT_CONFIG/,line);
  }
  assert.throws(()=>validateScratchGitConfig(
    base+'\ttagOpt = --no-tags\n[include]\npath = /tmp/evil\n'),
    /UNTRUSTED_GIT_CONFIG/);
});
