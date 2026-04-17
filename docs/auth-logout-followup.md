# Auth / Logout Follow-up Issues

Documented separately from the homepage location-module work.

## Observed problems

1. **Logout not always visible** — the logout button lives inside a click-toggled
   dropdown in `src/app/dashboard/layout.tsx:124`. On some menu states (e.g. mobile
   sidebar open vs. closed) the dropdown may not render the logout item. Needs a
   review of all menu-open paths to confirm logout is reachable in every state.

2. **Google login/logout loop** — after using Google OAuth, returning to the
   login page or navigating directly to `/connect` can loop between the Google
   consent screen and the callback without completing the session. Likely cause:
   session cookie not being set before the redirect chain completes, or
   `GOOGLE_CLIENT_SECRET` is set in one environment but not another (causes
   mismatch between `redirect` and `gis` modes).

3. **Manual URL workaround required** — at least one case where the user had to
   manually navigate to `/connect` or `/dashboard` to re-enter after logout.

## Key files

- `src/app/api/auth/logout/route.ts` — POST handler; destroys session, returns `{ok: true}`.
  Does NOT redirect — client-side redirect happens in `dashboard/layout.tsx:94`.
- `src/app/api/auth/google/callback/route.ts` — Google OAuth callback; may loop if
  session secret is not consistent across server instances.
- `src/app/api/public-config/route.ts` — Runtime config for Google OAuth mode
  (`redirect` | `gis` | `disabled`). Check `googleOAuthMode` in browser console.
- `src/components/OnboardingPageContent.tsx` — Client-side Google sign-in flow;
  fetches `/api/public-config` on mount to determine mode.

## Suggested investigation

```
# Check which mode is active on production
curl https://<your-domain>/api/public-config | jq .
# → googleOAuthMode should be "redirect" or "gis", not "disabled"

# Check for missing env vars
echo $GOOGLE_CLIENT_SECRET   # should be non-empty for redirect mode
echo $SESSION_SECRET          # must be set for any OAuth flow
```

## Priority

Low — does not affect the homepage demo. Address after location module is stable.
