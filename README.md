# GrowthOS FINAL V6

A from-scratch, no-dependency prototype for the NxtWave Growth Challenge: **Build Your First AI Project in 60 Minutes**.

## Architecture

- **3000 — Admin Command Center**: registrations, real registry, XLSX export, AI Strategist, referral graph, leaderboard, budget.
- **3001 — Student Build Lab**: registration, personalized dashboard, student details, project workspace, checkpoints, streak, referral code, project-aware AI Mentor.
- **4000 — API**: persistent JSON data store, all workflows, strategy engine, mentor engine, Excel export, health.

## Important data rule

The database starts empty. There are **no seeded students, registrations, referrals, streaks, scores or fake campaign results**. Empty states are intentional.

## Challenge alignment

The campaign target is configurable but defaults to 500 registrations, 7 days and a ₹2,000 maximum budget. The Admin AI Strategist recalculates its recommendations from actual registrations, referrals and spend.

The Student AI Mentor is a separate role: it helps students solve doubts about the project they are building. It uses their project goal, project name, stack, progress and saved Build Lab code. If `OPENAI_API_KEY` is configured, it can use the OpenAI Responses API; otherwise a deterministic project-aware fallback keeps the prototype functional offline.

## Run

Requires only Node.js 18+.

```powershell
npm run dev
```

Open:

- http://localhost:3000 — Admin
- http://localhost:3001 — Student
- http://localhost:4000/api/health — API

No Python, Visual Studio, native SQLite module, or `npm install` is required.

## End-to-end demo

1. Open 3001 and register Student A with complete details.
2. Verify Student A's personalized dashboard and stored profile.
3. Save code and a real checkpoint in Build Lab.
4. Ask the AI Mentor a project question.
5. Copy Student A's referral code.
6. Use another browser/incognito window on 3001 and register Student B with Student A's code.
7. Open 3000: the registry, referral graph and leaderboard should update.
8. Download the real `.xlsx` registry.
9. Add a real budget spend and verify the ₹2,000 cap blocks an over-budget entry.
10. Run AI Strategist. Its output must reflect the current registration, referral and spend counts.
