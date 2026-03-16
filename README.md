# Alpha Market Entry Intelligence System

An AI-powered agentic pipeline that produces **investment-bank quality research**, **McKinsey-grade strategy**, **interactive financial models**, and **boardroom-ready documents** for country and US state market-entry analysis.

Built for [2hr Learning](https://2hrlearning.com) to evaluate and structure education market-entry deals across sovereign nations and US ESA/voucher states.

---

## Overview

Enter a target **country** (e.g. Saudi Arabia, Singapore) or **US state** (e.g. Texas, Arizona) and the system's AI agents will autonomously:

1. **Research** the market — demographics, economy, education system, regulatory landscape, competitive environment
2. **Analyze** the education sector — pain points, reform landscape, 2hr Learning product fit
3. **Develop strategy** — entry mode, partnership structure, brand positioning, phased rollout plan
4. **Build a financial model** — 5-year P&L, unit economics, capital deployment, returns analysis, sensitivity tables
5. **Structure deal terms** — term sheet with IP fees, management fees, licensing terms
6. **Generate executive documents** — investor/government presentation deck, formal proposal, Excel model, narrative reports

Each stage includes a **Human-in-the-Loop (HITL) review gate** where the user can approve, revise, or provide feedback before the pipeline advances.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 16)                 │
│         React 19 · Tailwind CSS · shadcn/ui             │
│                  Deployed on Vercel                      │
└──────────────────────┬──────────────────────────────────┘
                       │  REST API
┌──────────────────────▼──────────────────────────────────┐
│                   Backend (FastAPI)                      │
│               Python 3.12 · Uvicorn                     │
│                  Deployed on Render                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              AI Agent Pipeline                   │    │
│  │                                                  │    │
│  │  Country Research → Education Research →         │    │
│  │  Strategy → Financial Assumptions →              │    │
│  │  Financial Model → Term Sheet →                  │    │
│  │  Document Generation → Finalize                  │    │
│  │                                                  │    │
│  │  (HITL review gate after each stage)             │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────┐  ┌────────────┐  ┌────────────────┐   │
│  │  LLM Layer  │  │  External  │  │ Config / Rules │   │
│  │  Anthropic  │  │  Services  │  │  YAML-based    │   │
│  │  OpenAI     │  │  Perplexity│  │  business rules│   │
│  │  LangChain  │  │  Gamma API │  │  country tiers │   │
│  │             │  │  World Bank│  │  scaling        │   │
│  └─────────────┘  └────────────┘  └────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Backend
| Technology | Purpose |
|---|---|
| **FastAPI** | REST API framework |
| **LangChain + LangGraph** | AI agent orchestration |
| **Anthropic Claude** | Primary LLM for research & generation |
| **OpenAI GPT** | Secondary LLM |
| **Perplexity API** | Real-time web research |
| **Gamma API** | AI-generated slide decks |
| **python-docx / python-pptx** | Document generation (DOCX, PPTX) |
| **openpyxl** | Excel financial model generation |
| **fpdf2** | PDF generation |
| **Pydantic** | Data validation & schemas |

### Frontend
| Technology | Purpose |
|---|---|
| **Next.js 16** | React framework |
| **React 19** | UI library |
| **Tailwind CSS 4** | Styling |
| **shadcn/ui** | Component library |
| **Lucide React** | Icons |
| **react-markdown** | Markdown rendering for reports |

---

## Features

### Standard Pipeline (Internal)
- **7-stage agentic pipeline** with HITL review gates at every step
- **Interactive financial assumption sliders** with real-time model recalculation
- **Term sheet structuring** with deal term negotiation support
- **Pipeline rewind** — go back to re-edit earlier stages without restarting
- **Multiple document outputs**: PPTX deck, DOCX proposal, XLSX financial model, narrative reports
- **Country tier classification** (Tier 1/2/3) with tier-specific business rules
- **US state ESA/voucher market** analysis with Spending Spotlight data integration

### Express Pipeline (Customer Portal)
- **One-click execution** — no review gates, runs end-to-end automatically
- **PDF deliverables** — term sheet and proposal generated as PDFs
- Designed for external stakeholders (heads of state, ministers, investors)

### Data Sources
- **Perplexity AI** for real-time market research
- **World Bank API** for economic indicators
- **Reason Foundation Spending Spotlight** for US state K-12 spending data (auto-refreshes weekly)
- **YAML-based rules engine** for business rules, scaling formulas, and country tier logic

---

## Project Structure

```
alpha_country_state_app/
├── backend/
│   ├── main.py                     # FastAPI app & endpoints
│   ├── agents/                     # AI agent modules
│   │   ├── country_research.py     # Market research agent
│   │   ├── education_research.py   # Education sector analysis agent
│   │   ├── strategy.py             # Strategy development agent
│   │   ├── financial.py            # Financial model builder
│   │   ├── term_sheet.py           # Term sheet structuring agent
│   │   ├── state_deck.py           # US state deck generator
│   │   └── document_generation.py  # Document generation agent
│   ├── config/
│   │   ├── rules/                  # YAML business rules
│   │   │   ├── business_rules.yaml
│   │   │   ├── country_tiers.yaml
│   │   │   ├── scaling_formulas.yaml
│   │   │   ├── us_state_rules.yaml
│   │   │   ├── proposal_structure.yaml
│   │   │   └── k12_spending_spotlight.yaml
│   │   └── rules_loader.py         # Rules engine
│   ├── graph/
│   │   ├── pipeline.py             # Standard HITL pipeline orchestrator
│   │   ├── express_pipeline.py     # Express pipeline (no HITL)
│   │   └── state.py                # Pipeline state management
│   ├── models/
│   │   └── schemas.py              # Pydantic models & API schemas
│   ├── services/
│   │   ├── llm.py                  # LLM client (Anthropic/OpenAI)
│   │   ├── perplexity.py           # Perplexity research API
│   │   ├── gamma.py                # Gamma slide deck API
│   │   ├── world_bank.py           # World Bank data API
│   │   ├── pdf_generator.py        # DOCX/PPTX to PDF converter
│   │   ├── spending_spotlight.py   # K-12 spending data scraper
│   │   └── humanizer.py            # Text humanization service
│   ├── skills/
│   │   ├── build_model.py          # Financial model computation
│   │   └── generate_xlsx.py        # Excel export
│   ├── requirements.txt
│   ├── Procfile
│   └── runtime.txt                 # Python 3.12.3
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx            # Home — target selection
│   │   │   ├── run/[id]/page.tsx   # Pipeline dashboard (HITL)
│   │   │   └── portal/             # Customer portal (express)
│   │   ├── components/
│   │   │   ├── assumption-editor.tsx
│   │   │   ├── feedback-form.tsx
│   │   │   ├── financial-model-viewer.tsx
│   │   │   ├── report-viewer.tsx
│   │   │   └── ui/                 # shadcn/ui components
│   │   └── lib/
│   │       ├── api.ts              # API client
│   │       └── utils.ts
│   ├── package.json
│   └── vercel.json
├── render.yaml                     # Render deployment config
└── .gitignore
```

---

## Getting Started

### Prerequisites

- **Python 3.12+**
- **Node.js 20+**
- API keys for: Anthropic, OpenAI, Perplexity, Gamma

### Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Create .env file with your API keys
echo ANTHROPIC_API_KEY=your_key_here > .env
echo OPENAI_API_KEY=your_key_here >> .env
echo PERPLEXITY_API_KEY=your_key_here >> .env
echo GAMMA_API_KEY=your_key_here >> .env

# Start the server
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env.local
echo NEXT_PUBLIC_API_URL=http://localhost:8000 > .env.local

# Start the dev server
npm run dev
```

The app will be available at `http://localhost:3000`.

---

## API Endpoints

### Pipeline Management
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/runs` | Create a new pipeline run |
| `GET` | `/api/runs/{run_id}` | Get run status and all data |

### HITL Feedback Gates
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/runs/{id}/feedback/country-report` | Review country research |
| `POST` | `/api/runs/{id}/feedback/education-report` | Review education analysis |
| `POST` | `/api/runs/{id}/feedback/strategy` | Review strategy |
| `POST` | `/api/runs/{id}/feedback/assumptions` | Review financial assumptions |
| `POST` | `/api/runs/{id}/feedback/model` | Review financial model |
| `POST` | `/api/runs/{id}/feedback/term-sheet-assumptions` | Review term sheet |
| `POST` | `/api/runs/{id}/feedback/documents` | Review final documents |

### Financial Model
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/runs/{id}/recalculate` | Real-time model recalculation |
| `POST` | `/api/runs/{id}/recalculate-term-sheet` | Term sheet impact analysis |
| `POST` | `/api/runs/{id}/rewind` | Rewind pipeline to earlier stage |

### Downloads
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/runs/{id}/download/{type}` | Download generated files (pptx, docx, xlsx, term_sheet, etc.) |

### Express Pipeline (Customer Portal)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/portal/runs` | Start express pipeline run |
| `GET` | `/api/portal/runs/{id}` | Get express run status |
| `GET` | `/api/portal/runs/{id}/download/{type}` | Download PDF deliverables |

### Data Feeds
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/data/spending-spotlight/refresh` | Refresh K-12 spending data |
| `GET` | `/api/data/spending-spotlight/status` | Get data feed status |
| `GET` | `/api/data/spending-spotlight/{state}` | Get state spending data |

---

## Deployment

### Backend (Render)

Configured via `render.yaml`:
- **Runtime**: Python 3.12.3
- **Start command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Environment variables**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `GAMMA_API_KEY`

### Frontend (Vercel)

Configured via `vercel.json`:
- **Framework**: Next.js
- **Environment variable**: `NEXT_PUBLIC_API_URL` (set to your Render backend URL)

---

## Pipeline Stages

| # | Stage | Agent | Output | HITL Gate |
|---|---|---|---|---|
| 1 | Country Research | `country_research.py` | Country profile + narrative report | Approve / Revise |
| 2 | Education Research | `education_research.py` | Education analysis + narrative report | Approve / Revise |
| 3 | Strategy | `strategy.py` | Entry strategy + narrative report | Approve / Revise |
| 4 | Financial Assumptions | `financial.py` | Interactive assumption sliders | Adjust & Approve |
| 5 | Financial Model | `financial.py` | 5-year P&L, unit economics, returns | Lock / Adjust |
| 6 | Term Sheet | `term_sheet.py` | Deal term assumptions | Adjust & Approve |
| 7 | Document Generation | `document_generation.py` | PPTX, DOCX, XLSX, narrative reports | Approve / Revise |
| 8 | Finalize | — | Pipeline complete | — |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for primary LLM |
| `OPENAI_API_KEY` | Yes | OpenAI API key for secondary LLM |
| `PERPLEXITY_API_KEY` | Yes | Perplexity API key for web research |
| `GAMMA_API_KEY` | Yes | Gamma API key for slide deck generation |
| `NEXT_PUBLIC_API_URL` | Yes (frontend) | Backend API URL |

---

## License

**CONFIDENTIAL** — 2hr Learning (Alpha). All rights reserved.
