# `src/app` structure & routes

Next.js maps folders under `src/app/` to URL paths. Below matches the current tree.

```
src/app/
├── layout.tsx
├── page.tsx                 # /
├── globals.css
├── api/
│   ├── auth/
│   │   ├── login/route.ts
│   │   ├── logout/route.ts
│   │   ├── session/route.ts
│   │   ├── signup/route.ts
│   │   └── onboarding/route.ts
│   ├── cron/
│   │   └── check-trial/route.ts
│   └── yookassa/
│       ├── create-payment/route.ts
│       └── webhook/route.ts
├── connect/
│   └── page.tsx             # /connect (onboarding / start flow)
├── dashboard/
│   ├── layout.tsx
│   ├── page.tsx             # /dashboard
│   ├── automations/page.tsx # /dashboard/automations
│   ├── billing/page.tsx     # /dashboard/billing
│   ├── properties/page.tsx  # /dashboard/properties
│   └── settings/page.tsx    # /dashboard/settings
├── legal/
│   └── page.tsx             # /legal
├── login/
│   └── page.tsx             # /login
├── offer/
│   └── page.tsx             # /offer
├── privacy/
│   └── page.tsx             # /privacy
├── signup/
│   └── page.tsx             # /signup → redirects to /connect
└── strategic-partnerships/
    └── page.tsx             # /strategic-partnerships
```

## Page routes (user-facing)

| Route | Purpose |
|-------|---------|
| `/` | Home (landing) |
| `/connect` | Onboarding / start-trial flow |
| `/signup` | Client redirect to `/connect` |
| `/login` | Login |
| `/legal` | Legal |
| `/offer` | Public offer (RU) |
| `/privacy` | Privacy policy (RU) |
| `/strategic-partnerships` | Strategic participation landing |
| `/dashboard` | Dashboard overview |
| `/dashboard/properties` | Properties |
| `/dashboard/automations` | Automations |
| `/dashboard/settings` | Settings |
| `/dashboard/billing` | Billing |

## API routes (`src/app/api`)

| Path | Role |
|------|------|
| `/api/auth/login` | Login |
| `/api/auth/logout` | Logout |
| `/api/auth/session` | Session |
| `/api/auth/signup` | Signup |
| `/api/auth/onboarding` | Onboarding |
| `/api/cron/check-trial` | Cron (trial check) |
| `/api/yookassa/create-payment` | YooKassa payment creation |
| `/api/yookassa/webhook` | YooKassa webhook |

## Primary internal links (for maintenance)

- `/` — header logo; back links from `/legal`, `/offer`, `/privacy`; post-onboarding in onboarding UI
- `/connect` — hero and pricing CTAs, header “start trial”, final CTA, login page secondary link
- `/strategic-partnerships` — header nav, `StrategicTeaser`
- `/legal`, `/offer`, `/privacy` — footer and `LegalFooter`
- `/dashboard` — sidebar logo; login success redirect; onboarding completion redirect
- `/dashboard/billing` — linked from `DashboardAuthGuard` when billing action required
