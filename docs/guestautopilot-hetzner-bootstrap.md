# Guest Autopilot (guestautopilot.com) — Hetzner production bootstrap

This is the runbook for provisioning and cutting over the dedicated Hetzner
VPS that will host `https://www.guestautopilot.com` in production. It is
entirely separate infrastructure from `asi-global.ru` (Timeweb) — see
[`docs/deployment-source-of-truth.md`](./deployment-source-of-truth.md) for
which property lives where.

**Nothing in this document has been executed.** No server has been
provisioned, no DNS has changed, no certificate has been requested. This is
preparation only, reviewed here before any of it happens.

## 1. Recommended server

| | |
|---|---|
| Location | Hetzner **EU** region (Falkenstein or Nuremberg, Germany — either is fine; Helsinki also acceptable). Pick whichever has current stock/lowest latency to your expected audience. |
| Class | **CX22** (shared vCPU, 2 vCPU, 4 GB RAM, 40 GB NVMe) |
| IPv4 | Required — nginx needs to terminate TLS on a public IPv4 the DNS A records point at |
| IPv6 | Enable it (Hetzner includes it at no extra cost) — add AAAA records too; no downside, some networks prefer it |

**Why CX22, not the cheaper CX11 (2 GB RAM):** the production `node_modules` after `npm prune --omit=dev` is still substantial (Supabase client, Stripe SDK, `google-auth-library`, `bcryptjs`, etc.) and Next.js SSR under load benefits from headroom beyond just the Node heap — nginx, systemd/journald, and OS overhead all share the box. 2 GB is workable but tight with no margin for traffic spikes or a stuck process before OOM-killer intervenes. CX22 gives real headroom without over-provisioning for what is, per the task brief, early-stage/low traffic.

**Why not bigger:** nothing in this codebase's Guest Autopilot surface is CPU-heavy per-request (no on-box video/image transcoding, no Chromium/Puppeteer — that's a devDependency for Playwright tests only and is pruned out of the production artifact). CX22 has room to grow into before a resize is needed; resizing later is a few minutes of downtime on Hetzner if it ever is needed, not a re-architecture.

Disk: 40 GB (CX22's default) is comfortable — the release retention policy in the deploy script keeps only the current + previous-7-days releases, and each release (`node_modules` + `.next` + assets) is on the order of several hundred MB, not multiple GB.

## 2. Server bootstrap (fresh Ubuntu 22.04/24.04 LTS)

Everything below is written to be run once, by hand, by whoever has root on
the new box. Root-only steps are marked **[root]**; everything after the
deploy user exists should run as that user.

### 2.1 Initial access & OS updates **[root]**

```bash
apt-get update && apt-get -y upgrade
apt-get -y install curl git ufw fail2ban
```

### 2.2 Create the dedicated service/deploy user **[root]**

One account does both jobs (SSH deploy target and systemd service owner),
matching the proven pattern already in production for asi-global.ru
(`project_ayfaar`) — a single well-scoped account is simpler to reason about
than splitting deploy vs. runtime identities without a concrete reason to.

```bash
adduser --disabled-password --gecos "" guestautopilot
mkdir -p /home/guestautopilot/.ssh
chmod 700 /home/guestautopilot/.ssh
# Paste the CI deploy key's PUBLIC half here:
printf '%s\n' '<PASTE PUBLIC KEY>' > /home/guestautopilot/.ssh/authorized_keys
chmod 600 /home/guestautopilot/.ssh/authorized_keys
chown -R guestautopilot:guestautopilot /home/guestautopilot/.ssh
```

### 2.3 SSH hardening **[root]**

```bash
# /etc/ssh/sshd_config
PasswordAuthentication no
PermitRootLogin prohibit-password
```
Reload sshd after editing. Do this only after confirming the new key-based
login for `guestautopilot` actually works from a second terminal — do not
lock yourself out.

### 2.4 Firewall — allow only SSH, HTTP, HTTPS **[root]**

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```

### 2.5 Passwordless restart rights for the deploy user, scoped to this one unit **[root]**

The deploy script calls `sudo -n /usr/bin/systemctl restart guestautopilot.service` —
this needs an explicit sudoers entry, scoped as tightly as possible:

```bash
# /etc/sudoers.d/guestautopilot-deploy  (create with `visudo -f`, mode 0440)
guestautopilot ALL=(root) NOPASSWD: /usr/bin/systemctl restart guestautopilot.service, /usr/bin/systemctl is-active --quiet guestautopilot.service
```

### 2.6 Node.js 20 LTS **[root]**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v   # expect v20.x
```
Package manager: **npm only** — the repo ships `package-lock.json`, no
`pnpm-lock.yaml`/`yarn.lock`. Nothing extra to install beyond what ships
with Node 20.

### 2.7 nginx + certbot **[root]**

```bash
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx
```

### 2.8 Directory structure & ownership **[root]**

```bash
mkdir -p /var/www/guestautopilot/{releases,shared}
mkdir -p /var/www/certbot
chown -R guestautopilot:guestautopilot /var/www/guestautopilot
```
`current` is intentionally **not** created here — the first deploy creates
it atomically via symlink (see `scripts/deploy-guestautopilot-production.sh`).

### 2.9 Install the systemd unit **[root]**

```bash
cp deploy/systemd/guestautopilot.service /etc/systemd/system/guestautopilot.service
systemctl daemon-reload
systemctl enable guestautopilot.service
# Do NOT start it yet — there is no release at /var/www/guestautopilot/current
# until the first deploy runs.
```

### 2.10 PM2?

**Not used.** This is a single Next.js process on a single dedicated host
with nothing else to multiplex against. PM2 earns its keep on the
asi-global.ru box because that box's `ecosystem.config.cjs` exists to give a
consistent process-management interface across whatever else might run
there. Here, systemd alone already provides process supervision,
restart-on-failure, structured logs via `journalctl -u guestautopilot`, and
boot-time startup — adding PM2 on top would be a second supervisor doing the
same job as the first, for no benefit. See `deploy/systemd/guestautopilot.service`
for the full unit (restart policy, sandboxing, env file).

### 2.11 nginx site **[root]**

Do this only once DNS actually points here (see §4) — nginx will fail to
obtain a cert for a hostname that doesn't resolve to this box yet, and even
the HTTP-only block is pointless to enable before then. Order matters; see
§5 (TLS cutover plan) for the exact sequence.

```bash
cp deploy/nginx/guestautopilot.com.conf /etc/nginx/sites-available/guestautopilot.com.conf
ln -s /etc/nginx/sites-available/guestautopilot.com.conf /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 3. GitHub secrets required (never committed, values never fabricated)

Set these in the repository's Settings → Environments → `guestautopilot-production`
(a dedicated GitHub Environment, not the existing `production` one used by
the RU deploy — keeping them separate means an RU deploy approval can never
accidentally authorize a Guest Autopilot deploy or vice versa):

| Secret | Purpose |
|---|---|
| `GUESTAUTOPILOT_SSH_HOST` | Hetzner VPS public IP or hostname |
| `GUESTAUTOPILOT_SSH_USER` | `guestautopilot` |
| `GUESTAUTOPILOT_SSH_PRIVATE_KEY` | Private half of the deploy keypair (public half goes in `authorized_keys`, §2.2) |
| `GUESTAUTOPILOT_SSH_PORT` | Optional, defaults to 22 if unset |
| `GUESTAUTOPILOT_SUPABASE_URL` | Supabase project URL for this environment |
| `GUESTAUTOPILOT_SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GUESTAUTOPILOT_SESSION_SECRET` | ≥32-char session secret (see `src/lib/auth.ts#isSessionSecretConfigured`) |
| `GUESTAUTOPILOT_GOOGLE_CLIENT_ID` / `GUESTAUTOPILOT_GOOGLE_CLIENT_SECRET` | Google OAuth for `/connect` signup |
| `GUESTAUTOPILOT_ADMIN_SECRET` | Ops-only endpoints (`requireAdminSecret`) |
| `GUESTAUTOPILOT_STRIPE_ONBOARDING_ENABLED` | Optional. Leave unset/`false` until explicitly approved to go live — see §6 |
| `GUESTAUTOPILOT_STRIPE_ONBOARDING_SECRET_KEY` | Optional. Must be `sk_test_...` — the workflow and the app both refuse `sk_live_...` |
| `GUESTAUTOPILOT_STRIPE_ONBOARDING_WEBHOOK_SECRET` | Optional, pairs with the above |

None of these exist yet. The workflow will fail with a clear "Missing
required secret" message until the required ones (everything except the
three Stripe onboarding secrets, which are genuinely optional) are set.

## 4. Production environment contract

Written by `.github/workflows/deploy-guestautopilot-production.yml` to
`/var/www/guestautopilot/shared/.env.production.local` on every deploy
(names only — see the workflow file for exactly which secret maps to which
name):

```
NODE_ENV=production
PORT=3000
ASI_DEPLOY_ENV=production
HOST_VARIANT=international
NEXT_PUBLIC_APP_URL=https://www.guestautopilot.com
NEXT_PUBLIC_URL=https://www.guestautopilot.com
SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SESSION_SECRET=...
GOOGLE_CLIENT_ID=...
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ADMIN_SECRET=...
STRIPE_ONBOARDING_ENABLED=...       (only written if configured)
STRIPE_ONBOARDING_SECRET_KEY=...    (only written if configured; sk_test_ only)
STRIPE_ONBOARDING_WEBHOOK_SECRET=... (only written if configured)
INTERNATIONAL_BILLING_ENABLED=false  (hardcoded by the workflow, always)
```

Deliberately **absent** — never written by this workflow, never inherited:
- Any RU/YooKassa credential (`YOOKASSA_*`)
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (the *other* Stripe
  integration — operational_payments/Telegram-pilot — is a different
  Stripe account and has no reason to exist on this box)
- Any `asi-global.ru` URL as a runtime config value
- `HOST_VARIANT=ru` — the deploy script (§7) and the workflow itself both
  hard-refuse to ship this

### On `HOST_VARIANT=international`

Verified safe by direct code inspection, not assumed:
`src/lib/runtimeHost.ts#isRuRuntimeHost` is
`process.env.HOST_VARIANT === 'ru' || hostname.endsWith('.ru')`. Only the
exact literal string `'ru'` does anything special; every other value —
unset, `'international'`, anything else — takes the same "not RU" branch.
Setting it to `'international'` is therefore purely documentary/defensive:
it makes the intent explicit in `ps`/`journalctl` output and gives a
concrete value for `grep` guards (both the deploy script and the GitHub
workflow check for it), but it changes no runtime behavior versus leaving
it unset. Leaving it unset would be equally safe today; setting it
explicitly is preferred because "explicit and inert" beats "implicit and
inert" for something this security-relevant.

## 5. DNS records needed for cutover (not applied — reporting only)

| Host | Type | Value |
|---|---|---|
| `guestautopilot.com` | A | `<HETZNER_IPV4>` |
| `guestautopilot.com` | AAAA | `<HETZNER_IPV6>` (if IPv6 enabled per §1) |
| `www.guestautopilot.com` | A | `<HETZNER_IPV4>` |
| `www.guestautopilot.com` | AAAA | `<HETZNER_IPV6>` (if IPv6 enabled) |

**A records for `www`, not a CNAME.** A CNAME at `www` would work too, but
since the apex also needs its own A/AAAA record anyway (CNAMEs are not
valid at a zone apex per the DNS spec, with the partial exception of
provider-specific "ALIAS"/"ANAME" records), using plain A/AAAA for both
names is simpler, has no indirection to debug, and matches exactly what the
existing `asi-global.ru.conf` pattern does for its own apex+www pair.

Current state (verified live, not assumed): both names currently resolve to
Vercel's edge IPs (`76.76.21.21` for apex, `76.76.21.98`/`66.33.60.67` for
`www`) — see §7 for why those stay untouched until the Hetzner target is
fully verified.

## 6. TLS cutover plan — exact order

Do not skip ahead. Each step depends on the previous one being actually
true, not just believed to be true.

1. **Prepare the app on Hetzner** — bootstrap (§2) complete through §2.10;
   first deploy run via the GitHub workflow (§3), landing a real release at
   `/var/www/guestautopilot/current`. `guestautopilot.service` running.
2. **Verify the app directly on localhost, on the box itself:**
   ```bash
   ssh guestautopilot@<hetzner-ip> 'curl -sS http://127.0.0.1:3000/api/health'
   ssh guestautopilot@<hetzner-ip> 'curl -sS http://127.0.0.1:3000/api/version'
   ```
3. **Verify nginx routing before DNS points here**, using SNI/Host override
   so real requests hit the new box without any public DNS change yet —
   see §8 for the exact commands, run from your own machine, against the
   Hetzner IP directly, before nginx even has a cert:
   ```bash
   curl -sS -H 'Host: www.guestautopilot.com' http://<hetzner-ip>/api/health
   ```
   (HTTP only at this point — the HTTPS server blocks in
   `guestautopilot.com.conf` need a cert that doesn't exist yet; step 6
   below is what gets one.)
4. **Change DNS** (§5) — owner-only action, not performed by this task.
5. **Verify DNS propagation:**
   ```bash
   dig +short guestautopilot.com
   dig +short www.guestautopilot.com
   # both should return the Hetzner IP, not Vercel's
   ```
   Propagation can take minutes to a few hours depending on the previous
   record's TTL. Do not proceed to certbot until this is confirmed —
   certbot's HTTP-01 challenge will fail (and can hit Let's Encrypt rate
   limits on retry) if DNS is still pointing at Vercel.
6. **Request the Let's Encrypt certificate:**
   ```bash
   certbot --nginx -d guestautopilot.com -d www.guestautopilot.com
   ```
7. **Reload nginx:**
   ```bash
   nginx -t && systemctl reload nginx
   ```
8. **Verify HTTPS:**
   ```bash
   curl -sSI https://www.guestautopilot.com/
   ```
9. **Verify the apex→www redirect:**
   ```bash
   curl -sSI https://guestautopilot.com/
   # expect: 301, Location: https://www.guestautopilot.com/
   ```

### Rollback if certificate issuance fails after DNS cutover

DNS having already moved does not mean traffic is broken — if certbot fails
at step 6, the HTTP (port 80) server block in `guestautopilot.com.conf`
still serves the ACME challenge path, but the HTTPS server blocks reference
a certificate that doesn't exist, so nginx will fail `nginx -t` and refuse
to reload with the new config active. Concretely:
- If `nginx -t` fails after a certbot failure, **do not run `systemctl reload nginx`** — the previous, still-valid nginx config (without the new HTTPS server blocks) stays active, so existing traffic (there shouldn't be any yet at this domain on this box, since this is the *first* cutover) is unaffected.
- Retry certbot once propagation is fully confirmed (`dig` from multiple resolvers, e.g. `dig @8.8.8.8` and `dig @1.1.1.1`).
- If DNS needs to be reverted back to Vercel temporarily while debugging, that's a safe, reversible DNS change — the Vercel deployment is explicitly being left attached and untouched for exactly this reason (see §7).

## 7. Current Vercel production — explicitly not being repaired

`guestautopilot.com` is live today on Vercel, serving a stale build with RU
identity/contact leakage (support@asi-global.ru, "ASI Integrations", RU
hreflang — all fixed in current `main`, none of those fixes are on the live
Vercel build). That domain attachment is being **left in place, untouched**,
until the Hetzner target is fully verified per §6 — removing it early would
create unnecessary downtime for zero benefit, since DNS cutover (§5/§6 step
4) is what actually replaces it. No attempt is made here to fix or redeploy
the Vercel build; it is being replaced, not repaired.

## 8. Pre-cutover testing (before any DNS change)

Run every check below with `--resolve` (or a Host-header override for plain
HTTP, once TLS isn't required yet) so requests hit the Hetzner IP directly
without needing public DNS to point there:

```bash
HETZNER_IP=<hetzner-ip>

for path in / /markets/japan /media /rental-autopilot /connect /legal /privacy /offer /contacts; do
  echo "=== $path ==="
  curl -s --resolve "www.guestautopilot.com:443:${HETZNER_IP}" \
    "https://www.guestautopilot.com${path}" \
    -o /tmp/page.html -w 'HTTP %{http_code}\n'
  grep -o 'support@asi-global.ru\|ASI Integrations\|Individual service provider\|asi-global\.ru' /tmp/page.html | sort -u
  echo '(clean if nothing printed above)'
done

# Canonical tag check
curl -s --resolve "www.guestautopilot.com:443:${HETZNER_IP}" https://www.guestautopilot.com/ \
  | grep -o '<link rel="canonical"[^>]*>'
# expect: href="https://www.guestautopilot.com/"

# Health / version
curl -s --resolve "www.guestautopilot.com:443:${HETZNER_IP}" https://www.guestautopilot.com/api/health
curl -s --resolve "www.guestautopilot.com:443:${HETZNER_IP}" https://www.guestautopilot.com/api/version

# Billing safety — confirm the deployed build cannot bill
curl -s --resolve "www.guestautopilot.com:443:${HETZNER_IP}" \
  -X POST https://www.guestautopilot.com/api/billing/activate-paid \
  -H 'content-type: application/json' -d '{"acceptedPlanId":"test"}' \
  -w '\nHTTP %{http_code}\n'
# expect: 401 (unauthenticated) — confirms the endpoint exists and requires
# a session; a full billing-disabled proof also requires an authenticated
# session and is covered by the automated test suite (scenario J), not a
# public curl check
```

`--resolve` requires a valid TLS cert already (it still does real TLS
verification against the hostname, it just skips DNS) — before certbot has
run (§6 step 6), use plain HTTP against port 80 with a `Host` header instead,
which only proves nginx routing, not the full HTTPS path:

```bash
curl -s -H 'Host: www.guestautopilot.com' "http://${HETZNER_IP}/api/health"
```

Also verify desktop + mobile visually via a real browser pointed at the
Hetzner IP with `/etc/hosts` temporarily overridden, or via the same
`--resolve` trick in a browser that supports it, before trusting the site
looks right pre-cutover.

## 9. Rollback procedure (post-cutover, ongoing operations)

Same atomic-symlink pattern as the RU deploy, and the deploy script already
rolls back automatically on a failed post-restart health check (see
`scripts/deploy-guestautopilot-production.sh`, the `start_app` /
`verify_release` / rollback block). For a **manual** rollback to a known-good
SHA after the fact:

```bash
gh workflow run deploy-guestautopilot-production.yml \
  -f confirm_production_deploy=DEPLOY_PRODUCTION \
  -f sha=<previous-good-sha>
```

The previous release directory stays on disk under
`/var/www/guestautopilot/releases/` for 7 days (same retention window as the
RU deploy script) before the cleanup step prunes it, so a same-day rollback
never needs a rebuild — though re-running the workflow with the old SHA
rebuilds it fresh anyway, which is simpler to reason about than manually
re-pointing the `current` symlink over SSH.
