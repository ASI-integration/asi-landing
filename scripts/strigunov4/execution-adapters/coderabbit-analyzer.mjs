import { must } from './state.mjs';
import { BOT_ID } from './github-readonly.mjs';

export async function inspectCodeRabbit(github, task) {
  must(Number.isSafeInteger(task.pr) && task.pr > 0, 'REVIEW_REQUIRES_PR');
  async function observe() {
    const [statuses,reviews,threads,comments] = await Promise.all([
      github.pages(`commits/${task.sha}/statuses`), github.pages(`pulls/${task.pr}/reviews`),
      github.threads(task), github.pages(`issues/${task.pr}/comments`),
    ]);
    const bot = x => x?.user?.id === BOT_ID;
    const latestStatus = statuses.filter(s => s.context === 'CodeRabbit' && s.creator?.id === BOT_ID).sort((a,b)=>b.id-a.id)[0];
    const latestReview = reviews.filter(bot).sort((a,b)=>b.id-a.id)[0];
    // Outdated unresolved threads still block. Resolution is not inferred from text.
    const unresolved = threads.filter(t => !t.isResolved);
    const summaries = comments.filter(bot).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at));
    return { latestStatus, latestReview, unresolved, summaries };
  }
  const first = await observe();
  const { latestStatus:s, latestReview:r, unresolved, summaries } = first;
  const second = await observe();
  must(JSON.stringify(first) === JSON.stringify(second), 'REVIEW_CHANGED_DURING_READ');
  if (unresolved.length || r?.state === 'CHANGES_REQUESTED') return { status:'FAILED',head:task.sha,completed:false,actionable:true };
  if (!s || s.state === 'pending') return { status:'WAITING',head:task.sha,completed:false,actionable:null };
  // skipped/paused/ambiguous success is NOT completed review.
  if (s.state !== 'success' || s.description !== 'Review completed') return { status:'FAILED',head:task.sha,completed:false,actionable:null };
  // Some CodeRabbit installations only publish a status plus an issue summary.
  // Never promote a missing review without independent, exact-head bot evidence.
  if (!r) {
    const c = summaries[0];
    const when = Date.parse(c?.updated_at);
    const finished = Date.parse(s.created_at);
    const shaMatch = typeof task.sha === 'string' && /^[a-f0-9]{40}$/.test(task.sha) &&
      typeof c?.body === 'string' &&
      c.body.split(/\r?\n/).some(line => line.trim() === 'Head: ' + task.sha);
    const explicitClean = typeof c?.body === 'string' &&
      /^No actionable comments were generated in the recent review\.\s*$/im.test(c.body);
    const outside = typeof c?.body === 'string' &&
      /Outside diff range comments[^\n(]*\([1-9][0-9]*\)/i.test(c.body);
    if (!c || summaries.length !== 1 || !shaMatch || !explicitClean || outside ||
      !Number.isFinite(when) || !Number.isFinite(finished) || when <= finished)
      return { status:'FAILED',head:task.sha,completed:false,actionable:null };
    return { status:'PASS', head:task.sha, completed:true, actionable:false,
      evidence:{ statusId:s.id,summaryId:c.id,reviewId:null,unresolvedThreads:0 } };
  }
  if (r.commit_id !== task.sha || !['APPROVED','COMMENTED'].includes(r.state))
    return { status:'FAILED',head:task.sha,completed:false,actionable:null };
  const body = String(r.body ?? '');
  const count = body.match(/^(?:\*\*)?Actionable comments posted:[ \t]*(\d+)(?:\*\*)?[ \t]*$/im);
  const outside = [...body.matchAll(/Outside diff range comments[^\n(]*\((\d+)\)/gi)];
  if (outside.some(m => Number(m[1]) > 0) || count && Number(count[1]) > 0) return { status:'FAILED',head:task.sha,completed:false,actionable:true };
  // An approval or the bot's structured zero-finding summary is necessary; arbitrary prose is not approval.
  const clear = r.state === 'APPROVED' || count && Number(count[1]) === 0;
  if (!clear) return { status:'FAILED',head:task.sha,completed:false,actionable:null };
  // Newer ambiguous bot updates require human reconciliation, never infer a green from free text.
  if (summaries.some(c => Date.parse(c.updated_at) > Date.parse(s.created_at)))
    return { status:'FAILED',head:task.sha,completed:false,actionable:null };
  return { status:'PASS', head:task.sha, completed:true, actionable:false,
    evidence:{ statusId:s.id,reviewId:r.id,unresolvedThreads:0 } };
}
export function analyzeCodeRabbit({ store, github, task }) {
  return store.execute('coderabbit-analyzer',task,github,()=>inspectCodeRabbit(github,task));
}
