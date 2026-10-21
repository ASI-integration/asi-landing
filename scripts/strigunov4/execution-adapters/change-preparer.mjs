import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { atomicWrite, digest, must, regular } from './state.mjs';

function command(exe,args,cwd,input='') {
  return new Promise((resolve,reject) => {
    const child = execFile(exe,args,{cwd,timeout:15000,killSignal:'SIGKILL',maxBuffer:1000000,
      env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
        GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'}},(err,stdout)=>err?reject(Error('STATIC_COMMAND_FAILED')):resolve(stdout));
    child.stdin.on('error',()=>{}); child.stdin.end(input);
  });
}
const git = (cwd,args) => command('/usr/bin/git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],cwd);
function safePath(p) {
  must(typeof p === 'string' && /^[a-zA-Z0-9_./-]+$/.test(p) && !p.startsWith('/') &&
    p.split('/').every(c=>c && c!=='.' && c!=='..' && c!=='.git') && !p.startsWith('-'), 'PATH_NOT_ALLOWED');
}
/** Inventory names may contain valid tracked characters such as spaces or brackets.
 * This validator does NOT authorize those paths as writable change targets.
 */
export function inventoryPath(p) {
  must(typeof p === 'string' && p.length > 0 && !p.startsWith('/') &&
    !p.includes('\\') && !p.includes('\0') &&
    p.split('/').every(c => c && c !== '.' && c !== '..' && c !== '.git'),
    'INVENTORY_PATH_NOT_ALLOWED');
}
async function target(root,relative) {
  safePath(relative); const full = path.join(root,relative);
  let dir = root;
  for (const part of relative.split('/').slice(0,-1)) {
    dir = path.join(dir,part);
    const st = await fs.lstat(dir);
    must(st.isDirectory() && !st.isSymbolicLink(), 'ANCESTOR_NOT_DIRECTORY');
  }
  await regular(full); return full;
}
async function inventory(root,prefix='') {
  const out = {};
  for (const item of await fs.readdir(path.join(root,prefix),{withFileTypes:true})) {
    if (!prefix && item.name === '.git') continue;
    const name = prefix ? `${prefix}/${item.name}` : item.name; inventoryPath(name);
    const full = path.join(root,name), st = await fs.lstat(full);
    must(!st.isSymbolicLink(), 'SCRATCH_SYMLINK');
    if (st.isDirectory()) Object.assign(out,await inventory(root,name));
    else {
      must(st.isFile() && st.nlink===1 && st.size <= 2_000_000, 'SCRATCH_ENTRY_UNSAFE');
      out[name] = {hash:digest(await fs.readFile(full)),mode:st.mode & 0o777};
    }
    must(Object.keys(out).length <= 10000, 'SCRATCH_TOO_LARGE');
  }
  return out;
}
// Only JSON is eligible for JSON normalization. JSON is not a trusted YAML
// syntax check, even when a particular YAML document happens to be JSON-shaped.
// Until a pinned/approved YAML parser exists, reject YAML before any writes.
export function normalizeProposedContent(file,content) {
  if (/\.(yml|yaml)$/.test(file)) throw Error('NO_APPROVED_SYNTAX_CHECKER');
  if (file.endsWith('.json')) return JSON.stringify(JSON.parse(content),null,2)+'\n';
  return content;
}
async function syntax(file,content,cwd) {
  if (/\.(mjs|js)$/.test(file)) await command(process.execPath,['--input-type=module','--check'],cwd,content);
  else if (file.endsWith('.py')) await command('/usr/bin/python3',['-I','-S','-c','import ast,sys; ast.parse(sys.stdin.read())'],cwd,content);
  else if (file.endsWith('.json')) JSON.parse(content);
  else throw Error('NO_APPROVED_SYNTAX_CHECKER');
}

// Git clone may retain a local branch stanza even after checkout --detach.
// A branch stanza is data, not an admission to use a remote or run commands.
function safeBranchName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.\/-]{0,150}$/.test(name) &&
    name.split('/').every(part=>part!=='' && part!=='.' && part!=='..' &&
      !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock')) &&
    !name.includes('..');
}
export function validateScratchGitConfig(config) {
  must(typeof config === 'string' && config.length < 100000, 'UNTRUSTED_GIT_CONFIG');
  let section = '';
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    if (line.startsWith('[')) {
      const branch=/^\[branch "([^"]+)"\]$/.exec(line);
      if (branch && safeBranchName(branch[1])) { section='branch'; continue; }
      must(/^\[(?:core|remote "origin")\]$/.test(line),'UNTRUSTED_GIT_CONFIG');
      section=line; continue;
    }
    const separator=line.indexOf('=');
    must(separator>0,'UNTRUSTED_GIT_CONFIG');
    const key=line.slice(0,separator).trim().toLowerCase();
    const value=line.slice(separator+1).trim();
    const allowed=section==='[core]'?
      ['repositoryformatversion','filemode','bare','logallrefupdates','ignorecase','precomposeunicode'].includes(key):
      section==='[remote "origin"]'?['url','fetch'].includes(key):
      section==='branch'?['remote','merge'].includes(key):false;
    must(allowed,'UNTRUSTED_GIT_CONFIG');
    if (section==='branch') {
      must(key==='remote'?value==='origin':
        value.startsWith('refs/heads/') && safeBranchName(value.slice('refs/heads/'.length)),
        'UNTRUSTED_GIT_CONFIG');
    }
  }
}

/** Existing files only, explicit before-hashes, no patch commands or repository scripts.
 * Admission must come from the trusted host, never from the queue decision or an issue body.
 * Scratch must be a private independent detached clone; caller creates it without executing hooks.
 */
export async function prepareDelta(store,task,{ admission, changes }) {
  must(admission?.taskId === task.id && admission.head === task.sha && admission.stage === 'S4-G1' &&
    admission.mode === 'ISOLATED_PREPARE_ONLY' && Array.isArray(admission.paths) && admission.paths.length > 0 &&
    admission.paths.length <= 3, 'TRUSTED_ADMISSION_REQUIRED');
  must(Array.isArray(changes) && changes.length > 0 && changes.length <= 3 &&
    new Set(changes.map(c=>c.path)).size === changes.length, 'CHANGE_SET_INVALID');
  const cwd = path.join(store.root,'scratchpads',task.id);
  must((await fs.realpath(cwd))===cwd, 'SCRATCH_REDIRECTED');
  const st = await fs.stat(cwd);
  must(st.uid===process.getuid() && !(st.mode & 0o077), 'SCRATCH_NOT_PRIVATE');
  const gitDir = await fs.lstat(path.join(cwd,'.git'));
  must(gitDir.isDirectory() && !gitDir.isSymbolicLink(), 'LINKED_WORKTREE_NOT_ALLOWED');
  // Git can execute clean filters even for diff/status. Reject executable/local includes
  // before invoking git, in addition to disabling hooks, fsmonitor, textconv and ext-diff.
  const configFile = path.join(cwd,'.git','config'); await regular(configFile);
  const config = await fs.readFile(configFile,'utf8');
  validateScratchGitConfig(config);
  must((await git(cwd,['rev-parse','--show-toplevel'])).trim() === cwd, 'WRONG_WORKTREE');
  must((await git(cwd,['rev-parse','--git-dir'])).trim() === '.git', 'FOREIGN_GIT_DIR');
  must((await git(cwd,['rev-parse','HEAD'])).trim() === task.sha, 'WRONG_BASE_SHA');
  must((await git(cwd,['rev-parse','--abbrev-ref','HEAD'])).trim() === 'HEAD', 'DETACHED_COPY_REQUIRED');
  must(!(await git(cwd,['status','--porcelain=v1','--untracked-files=all'])).trim(), 'SCRATCH_DIRTY');
  const baseline = await inventory(cwd), prepared = [];
  for (const change of changes) {
    safePath(change.path);
    must(admission.paths.includes(change.path) && typeof change.content === 'string' &&
      Buffer.byteLength(change.content) <= 200000 && /^[a-f0-9]{64}$/.test(change.beforeSha256), 'CHANGE_NOT_ADMITTED');
    const file = await target(cwd,change.path);
    const source = await fs.readFile(file,'utf8');
    must(digest(source)===change.beforeSha256 && baseline[change.path].hash===change.beforeSha256, 'PRECONDITION_CHANGED');
    const content = normalizeProposedContent(change.path,change.content);
    must(content!==source, 'EMPTY_CHANGE');
    await syntax(change.path,content,cwd);
    prepared.push({file,path:change.path,content,beforeSha256:change.beforeSha256,afterSha256:digest(content)});
  }
  // Validate all proposals before the first write; partial mutation on I/O error is quarantined by ledger.
  for (const p of prepared) {
    await target(cwd,p.path);
    must(digest(await fs.readFile(p.file))===p.beforeSha256, 'CONCURRENT_CHANGE');
    await atomicWrite(p.file,p.content,{mode:baseline[p.path].mode});
  }
  const after = await inventory(cwd);
  must(Object.keys(baseline).sort().join('\0')===Object.keys(after).sort().join('\0'), 'FILE_SET_CHANGED');
  const expected = new Map(prepared.map(p=>[p.path,p.afterSha256]));
  must(Object.keys(after).every(p=>after[p].hash===(expected.get(p)??baseline[p].hash) && after[p].mode===baseline[p].mode), 'DELTA_OUTSIDE_SCOPE');
  must((await git(cwd,['rev-parse','HEAD'])).trim()===task.sha, 'HEAD_MOVED');
  must(!(await git(cwd,['diff','--cached','--name-only'])).trim(), 'INDEX_CHANGED');
  await git(cwd,['diff','--no-ext-diff','--no-textconv','--check']);
  const diff = await git(cwd,['diff','--no-ext-diff','--no-textconv','--',...prepared.map(p=>p.path)]);
  must(diff.length > 0 && diff.length <= 500000, 'DIFF_SIZE');
  return { status:'PASS',head:task.sha,preparedOnly:true,commitCreated:false,
    deltaSha256:digest(diff),files:prepared.map(({path,beforeSha256,afterSha256})=>({path,beforeSha256,afterSha256})) };
}
export function prepareChange({store,github,task,admission,changes}) {
  return store.execute('change-preparer',task,github,()=>prepareDelta(store,task,{admission,changes}));
}
