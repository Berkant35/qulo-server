# API — question-based dating

Node.js and TypeScript backend for a dating app where people match by answering each other's questions. It serves the mobile apps and the website, runs scheduled jobs and hosts a small admin backoffice.

## What's inside

- **Express + TypeScript** with **Zod** request validation, JWT access and refresh tokens, helmet and rate limiting
- **24 route modules** in `src/routes/` (auth, users, questions, quiz, matches, chat, subscriptions, in-app currency, reports, notifications, referrals and more), backed by about 50 services
- **PostgreSQL on Supabase**, with versioned SQL migrations and rollback scripts in `migrations/` and `supabase/migrations/`
- **Payments:** RevenueCat webhooks keep subscriptions and the in-app currency in sync
- **Scheduled jobs** in `src/cron/`: a timezone-aware notification engine, campaign dispatch, presence, analytics and the web quiz
- **Messaging:** FCM push through firebase-admin and transactional email, with push and email copy in 18 languages (`src/locales/`, `src/templates/`)
- **Admin backoffice** with server-rendered views in `src/admin/`
- Deployed on **Railway**

## Run it

```bash
cp .env.example .env   # fill in your own Supabase, Firebase and RevenueCat values
npm ci
npm run dev            # tsx watch
npx vitest run         # tests
npm run build && npm start
```

Requires Node.js 20+.

## Quality

- 800+ tests with Vitest
- GitHub Actions runs type-checking, the test suite and the build on every push

---

Built and run end to end by [@Berkant35](https://github.com/Berkant35) — see also the [mobile app](https://github.com/Berkant35/qulov2) and the [website](https://github.com/Berkant35/qulo_web).
