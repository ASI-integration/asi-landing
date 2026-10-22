import { must, validateTask } from './state.mjs';
const REPO = 'ASI-integration/asi-landing';
const BASE = `https://api.github.com/repos/${REPO}/`;
const BOT_ID = 136622811;
export { BOT_ID };
const THREAD_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
repository(owner:$owner,name:$repo){pullRequest(number:$number){headRefOid
reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor}
nodes{id isResolved isOutdated comments(first:100){pageInfo{hasNextPage}
nodes{databaseId author{login} body commit{oid}}}}}}}}`;

/** Allow a completed, exact-SHA merged dependency to be *observed*, never
 * reopened or executed. Include lifecycle in both pre/post read identities.
 */
export function verifyPinnedReviewPr(p,task) {
  validateTask(task);
  must(task.pr !== null,'EXISTING_PR_REQUIRED');
  const lifecycle=(p?.state==='open' && p?.merged===false) ||
    (p?.state==='closed' && p?.merged===true);
  must(p?.number===task.pr && p.head?.sha===task.sha && p.head?.ref===task.branch &&
    p.head?.repo?.full_name===REPO && p.base?.repo?.full_name===REPO &&
    p.base?.ref==='main' && lifecycle, 'PR_SHA_OR_LIFECYCLE_CHANGED');
  return {number:p.number,head:p.head.sha,branch:p.head.ref,base:p.base.sha,
    state:p.state,merged:p.merged};
}

/** Fixed GitHub origin; GET REST + one fixed GraphQL QUERY, never a mutation.
 * Token is supplied by the host, never serialized. No retries or redirects.
 */
export function createGitHubReader({ token, timeoutMs = 10000 }) {
  must(typeof token==='function'||typeof token === 'string' && token.trim().length > 0, 'TOKEN_REQUIRED');
  async function request(url, body) {
    const credential=typeof token==='function'?await token():token;
    must(typeof credential==='string'&&credential.trim().length>0,'TOKEN_REQUIRED');
    const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs), headers: {
        Authorization: `Bearer ${credential}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
    must(response.ok, 'GITHUB_READ_FAILED');
    const reader = response.body.getReader(); let bytes = 0; const chunks = [];
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.length; must(bytes <= 4_000_000, 'GITHUB_RESPONSE_LIMIT'); chunks.push(next.value);
      }
    } finally { await reader.cancel(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    must(!data.errors, 'GITHUB_QUERY_INCOMPLETE'); return data;
  }
  async function get(route) {
    // No caller-supplied absolute URL, traversal, or arbitrary endpoint families.
    must(typeof route === 'string' && /^(pulls|commits|actions|issues|branches)(?:\/|\?)/.test(route) &&
      !route.includes('..') && !route.includes('\\') && !route.includes('#'), 'ENDPOINT_NOT_ALLOWED');
    return request(BASE + route);
  }
  async function pages(route, field = null) {
    const all = [], ids = new Set(); let expected;
    for (let page = 1; page <= 10; page++) {
      const data = await get(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = field ? data[field] : data;
      must(Array.isArray(items) && items.length <= 100, 'PAGINATION_SCHEMA');
      if (field) {
        must(Number.isSafeInteger(data.total_count) && data.total_count >= 0 && data.total_count <= 1000 &&
          (expected === undefined || expected === data.total_count), 'PAGINATION_COUNT');
        expected = data.total_count;
        must(items.length === Math.min(100, expected - all.length), 'PAGINATION_TRUNCATED');
      }
      for (const item of items) {
        must(Number.isSafeInteger(item?.id) && item.id > 0 && !ids.has(item.id), 'PAGINATION_DUPLICATE');
        ids.add(item.id); all.push(item);
      }
      if (field ? all.length === expected : items.length < 100) return all;
    }
    throw Error('PAGINATION_LIMIT');
  }
  async function verifyTask(task) {
    validateTask(task);
    if (task.pr === null) {
      const main = await get('branches/main');
      must(main.protected === true && main.commit?.sha === task.sha, 'PERMITTED_MAIN_SHA_CHANGED');
      const history = await pages(`pulls?state=all&head=ASI-integration:${encodeURIComponent(task.branch)}`);
      must(history.length === 0, 'EXISTING_PR_REQUIRES_VERIFICATION');
      return { number:null, head:task.sha, branch:task.branch, state:'PERMITTED_LOCAL_PREPARATION' };
    }
    const p = await get(`pulls/${task.pr}`);
    return verifyPinnedReviewPr(p,task);
  }
  async function threads(task) {
    const all = [], ids = new Set(); let cursor = null;
    for (let i = 0; i < 10; i++) {
      const d = await request('https://api.github.com/graphql', { query: THREAD_QUERY,
        variables: { owner: 'ASI-integration', repo: 'asi-landing', number: task.pr, cursor } });
      const pr = d.data?.repository?.pullRequest, conn = pr?.reviewThreads;
      must(pr?.headRefOid === task.sha && Array.isArray(conn?.nodes) && conn.nodes.length <= 100 &&
        typeof conn.pageInfo?.hasNextPage === 'boolean', 'THREADS_INCOMPLETE');
      for (const t of conn.nodes) {
        must(typeof t.id === 'string' && !ids.has(t.id) && typeof t.isResolved === 'boolean' &&
          t.comments?.pageInfo?.hasNextPage === false && Array.isArray(t.comments.nodes), 'THREADS_TRUNCATED');
        ids.add(t.id); all.push(t);
      }
      if (!conn.pageInfo.hasNextPage) return all;
      must(typeof conn.pageInfo.endCursor === 'string' && conn.pageInfo.endCursor !== cursor, 'THREAD_CURSOR');
      cursor = conn.pageInfo.endCursor;
    }
    throw Error('THREAD_PAGE_LIMIT');
  }
  return Object.freeze({ get, pages, verifyTask, threads });
}
