# src/app Folder Structure & Routes

```
src/app/
├── layout.tsx              # Root layout
├── page.tsx                # / (home)
├── globals.css
├── api/
│   ├── auth/
│   │   ├── login/route.ts
│   │   ├── logout/route.ts
│   │   ├── session/route.ts
│   │   └── signup/route.ts
│   ├── cron/
│   │   └── check-trial/route.ts
│   └── yookassa/
│       ├── create-payment/route.ts
│       └── webhook/route.ts
├── dashboard/
│   ├── layout.tsx
│   ├── page.tsx            # /dashboard
│   ├── automations/page.tsx # /dashboard/automations
│   ├── billing/page.tsx    # /dashboard/billing
│   ├── properties/page.tsx # /dashboard/properties
│   └── settings/page.tsx   # /dashboard/settings
├── legal/
│   └── page.tsx            # /legal
├── login/
│   └── page.tsx            # /login
└── signup/
    └── page.tsx            # /signup
```

## Public Routes

| Route | Page |
|-------|------|
| / | Home (landing) |
| /signup | Signup form |
| /login | Login form |
| /legal | Legal page |
| /dashboard | Dashboard overview |
| /dashboard/properties | Properties |
| /dashboard/automations | Automations |
| /dashboard/settings | Settings |
| /dashboard/billing | Billing |

## Link References

- /signup: Hero, Header, Pricing, FinalCTA, Login page
- /login: Signup page
- /dashboard: Dashboard layout sidebar, AuthGuard redirect
- /dashboard/billing: DashboardAuthGuard (past_due)
- /: Header logo, Legal page
- /legal: LegalFooter
