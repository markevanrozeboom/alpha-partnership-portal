# 2hr Learning Partnership Intelligence Portal

Simplified customer-facing portal. Enter a country or US state → get an instant briefing with 5 key data points, a partnership narrative, and fixed deal economics.

## Architecture

- **Frontend**: React + Tailwind + shadcn/ui (dark mode, teal/gold palette)
- **Backend**: Express.js with Claude API for instant data generation
- **No HITL gates** — fully automated, instant results

## What You Get

1. **School-Age Population** — children aged 5-18
2. **GDP per Capita** — current USD
3. **Government Education Spend** — % of GDP and per-student
4. **National Education Vision** — country's stated education reform goals
5. **Key Opportunity** — specific AI-education opportunity in this market
6. **Partnership Narrative** — contextual sales pitch
7. **Fixed Deal Economics** — Flagship ($40-100K), National ($25K), $750M dev investment, 100/0 equity

## Running Locally

```bash
cd portal
npm install
npm run dev
```

Requires `ANTHROPIC_API_KEY` environment variable for the Claude API backend.

## Building for Production

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```
