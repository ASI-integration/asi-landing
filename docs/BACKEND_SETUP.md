# ASI SaaS Backend Setup

## Folder Structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── signup/route.ts
│   │   │   ├── login/route.ts
│   │   │   ├── logout/route.ts
│   │   │   └── session/route.ts
│   │   ├── yookassa/
│   │   │   ├── create-payment/route.ts
│   │   │   └── webhook/route.ts
│   │   └── cron/
│   │       └── check-trial/route.ts
│   ├── dashboard/
│   │   ├── billing/page.tsx
│   │   └── ...
│   ├── login/page.tsx
│   └── signup/page.tsx
├── lib/
│   ├── supabase.ts
│   ├── auth.ts
│   ├── telegram.ts
│   └── trial.ts
├── components/
│   └── DashboardAuthGuard.tsx
└── contexts/
    └── SessionContext.tsx

supabase/
└── migrations/
    └── 001_initial_schema.sql
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (never expose) |
| `SESSION_SECRET` | Min 32 chars for iron-session |
| `YOOKASSA_SHOP_ID` | YooKassa merchant ID |
| `YOOKASSA_SECRET_KEY` | YooKassa secret key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Chat ID for notifications |
| `NEXT_PUBLIC_APP_URL` | App URL (for payment return) |
| `CRON_SECRET` | Optional, for cron auth |

## Supabase Setup

1. Create a Supabase project at supabase.com
2. Run the SQL in `supabase/migrations/001_initial_schema.sql` in the SQL Editor
3. Copy the project URL and service role key to `.env.local`

## YooKassa Setup

1. Create a YooKassa merchant account
2. Get Shop ID and Secret Key from the dashboard
3. Configure webhook URL: `https://your-domain.com/api/yookassa/webhook`
4. Enable events: `payment.succeeded`

## Telegram Setup

1. Create a bot via @BotFather
2. Get the bot token
3. Add the bot to a chat and get the chat ID (e.g. via getUpdates)

## Cron (Trial Expiration)

Call `GET /api/cron/check-trial` daily. With Vercel:

```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/check-trial",
    "schedule": "0 0 * * *"
  }]
}
```

Set `CRON_SECRET` and add `Authorization: Bearer <CRON_SECRET>` header in Vercel cron config.
