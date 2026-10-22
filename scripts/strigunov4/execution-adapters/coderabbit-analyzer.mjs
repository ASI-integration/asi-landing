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
  if (!r || r.commit_id !== task.sha) {
    // Match the snapshot reader: a newer or ambiguously dated bot update
    // cannot be ignored in favor of an older marked summary.
    const marked = summaries.filter(x => typeof x?.body === 'string' &&
      x.body.includes('<!-- recent_review_start -->') &&
      x.body.includes('<!-- recent_review_end -->'));
    const c = marked[0];
    const when = Date.parse(c?.updated_at);
    const finished = Date.parse(s.created_at);
    const superseded = summaries.some(x => x !== c &&
      (!Number.isFinite(Date.parse(x.updated_at)) || Date.parse(x.updated_at) >= when));
    // The bot's actual summary identifies its reviewed HEAD as the *end* of the
    // commit range inside the bounded recent-review block (not as "Head: SHA").
    const block = typeof c?.body === 'string' ?
      /<!-- recent_review_start -->([\s\S]*?)<!-- recent_review_end -->/.exec(c.body)?.[1] : null;
    const ranges = block ? [...block.matchAll(
      /Reviewing files that changed from the base of the PR and between ([a-f0-9]{40}) and ([a-f0-9]{40})\./g
    )] : [];
    const shaMatch = typeof task.sha === 'string' && /^[a-f0-9]{40}$/.test(task.sha) &&
      ranges.length === 1 && ranges[0][2] === task.sha;
    const explicitClean = typeof block === 'string' &&
      /(?:^|\r?\n)[ \t]*No actionable comments were generated in the recent review\.[ \t]*(?:🎉)?[ \t]*(?=\r?\n|$)/.test(block);
    const outside = typeof block === 'string' &&
      /Outside diff range comments[^\n(]*\([1-9][0-9]*\)/i.test(block);
    const actionable = typeof block === 'string' &&
      /Actionable comments posted:[ \t]*[1-9][0-9]*/i.test(block);
    // In GitHub, the bot may update its summary a few seconds BEFORE it posts
    // the completed status. Require contemporaneous, nonidentical timestamps.
    const contemporaneous = Number.isFinite(when) && Number.isFinite(finished) &&
      when !== finished && Math.abs(when - finished) <= 300000;
    if (!c || marked.length !== 1 || !shaMatch || !explicitClean || outside ||
      actionable || !contemporaneous || superseded)
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
