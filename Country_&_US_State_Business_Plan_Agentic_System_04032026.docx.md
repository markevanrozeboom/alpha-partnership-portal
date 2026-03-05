

CONFIDENTIAL & PROPRIETARY

**2hr Learning Global Expansion**

Agentic System Design

Alpha | 2hr Learning | Trilogy

March 2026

# **Table of Contents**

[Table of Contents	2](#heading=)

[1\. System Purpose	4](#heading=)

[Why Now	4](#heading=)

[Deliverables from this System	4](#heading=)

[2\. The Business Rules	5](#heading=)

[2A. Country Tiering System	5](#heading=)

[Tier 1 — “UAE-Scale” (GDP per capita \>$30K, population \>1M)	5](#heading=)

[Tier 2 — “Mid-Market” (GDP/cap $10K–$30K, or pop \>50M w/ private market)	5](#heading=)

[Tier 3 — “Emerging / Government” (GDP per capita \<$10K)	6](#heading=)

[2B. US State Rules	6](#heading=)

[Revenue Model	6](#heading=)

[School Types (US)	6](#heading=)

[Key US Metrics	7](#heading=)

[US State ESA Summary (Top 5\)	7](#heading=)

[2C. Universal Deal Structure Rules	7](#heading=)

[2D. Scaling Formula	8](#heading=)

[2E. Proposal Output Requirements	8](#heading=)

[3\. Architecture Overview	9](#heading=)

[Pipeline Diagram	9](#heading=)

[Shared Context Store	10](#heading=)

[4\. Agent Definitions	11](#heading=)

[4.1 Orchestrator Agent	11](#heading=)

[Responsibilities	11](#heading=)

[Decision Gates (Human-in-the-Loop)	11](#heading=)

[4.2 Country Research Agent	11](#heading=)

[Data Sources	11](#heading=)

[Output → country\_profile object	12](#heading=)

[Key Research Tasks	12](#heading=)

[4.3 Education System Research Agent	13](#heading=)

[Output → education\_analysis object	13](#heading=)

[4.4 Strategy Agent	13](#heading=)

[Key Decisions (Proposed for Human Approval)	13](#heading=)

[Strategy Output	13](#heading=)

[Business Rule Enforcement	14](#heading=)

[4.5 Financial Modelling Agent	14](#heading=)

[A. Input Assumptions (User-Configurable)	14](#heading=)

[B. Model Outputs	16](#heading=)

[C. PPP Adjustment Logic	16](#heading=)

[4.6 Document Generation Agent	17](#heading=)

[Deck Outline (PPTX)	17](#heading=)

[Standard Deck Structure	17](#heading=)

[5\. Input Assumptions Master List	18](#heading=)

[Tier 1: Must-Have (System Cannot Run Without These)	18](#heading=)

[Tier 2: Important (Improve Quality Significantly)	18](#heading=)

[Tier 3: Nice-to-Have (Enrich the Narrative)	19](#heading=)

[6\. Execution Flow	20](#heading=)

[Phase 1: Research (Parallel)	20](#heading=)

[Phase 2: Strategy	20](#heading=)

[Phase 3: Output Generation	20](#heading=)

[Final Deliverables	20](#heading=)

[7\. Implementation Recommendation	21](#heading=)

[Recommended Technology Stack	21](#heading=)

[Why This Stack	21](#heading=)

[Prompt Architecture (Per Agent)	22](#heading=)

[8\. Priority Target Markets	23](#heading=)

[8A. Countries (Top 10\)	23](#heading=)

[8B. US States (Top 5\)	23](#heading=)

[8C. Combined Priority Matrix	24](#heading=)

[9\. Quality Controls	25](#heading=)

[10\. Scaling Across Countries	25](#heading=)

[12\. Appendix: UAE Reference Parameters	26](#heading=)

[13\. Timeline & Next Steps	27](#heading=)

[Immediate Action Items	27](#heading=)

# **1\. System Purpose**

An agentic pipeline that accepts a target country or US state and produces three deliverables:

1. High-Level Proposition — an executive document modelled on the UAE/Ed71 royal proposal  
     
2. Financial Model — a country-specific or state-specific spreadsheet with unit economics, phased rollout, and returns  
     
3. Investor / Government Presentation Deck — a slide-by-slide deck generator

The system is built around the assumption that 2hr Learning (Alpha) can deploy its complete education operating system — Timeback, AlphaCore, Guide School, Incept eduLLM — either as a private-school rollout, a government public-system partnership, or a hybrid of both, depending on market conditions.

The UAE deal (Ed71) serves as the gold standard: $1.5B upfront, 200K students over 5 years, $25K per-student budget, with Alpha retaining IP ownership and earning a 10% management fee plus 20% Timeback license fee. This system codifies and scales that model across every viable market on earth.

## **Why Now**

McKenzie speaks before dozens of first ladies and heads-of-state delegations in Washington, D.C. on March 24, 2026\. After that presentation, Alpha will need to respond instantly to country-level and state-level demand with customized proposals. The global K-12 private education market stands at $397 billion and is growing at 9.5% CAGR. At least 16 US states now have universal or near-universal ESA/voucher programs. The window is open.

## **Deliverables from this System**

For every target market, the system generates a downloadable package of three files:

* Narrative proposal document (DOCX) — the full Ed71-style written proposal  
    
* Financial model (XLSX) — 5-year P\&L, unit economics, capital deployment, returns analysis  
    
* Executive pitch deck (PPTX) — following the UAE deck template, localised for the target market

# **2\. The Business Rules**

These are the rules the AI system will enforce when generating every proposal. They encode Alpha’s deal structure, pricing philosophy, and non-negotiable terms.

## **2A. Country Tiering System**

Every country is automatically classified into one of three tiers based on GDP per capita, population, and private-school market maturity. The tier determines the deal structure, pricing range, and partnership model.

### **Tier 1 — “UAE-Scale” (GDP per capita \>$30K, population \>1M)**

Full joint-venture model. The local entity owns schools; Alpha operates and licenses IP. Examples: Saudi Arabia, Qatar, Singapore, Switzerland.

| Parameter | Range / Detail |
| :---- | :---- |
| Upfront IP \+ Management Fee | $500M – $1.5B (scaled by school-age population) |
| Management Fee | 10% of per-student budget (minimum) |
| Timeback License Fee | 20% of per-student budget |
| Target Students (5 yr) | 50,000 – 200,000 |
| Per-Student Budget | $20,000 – $30,000 |
| Structure | Local entity owns schools; Alpha operates & licenses IP |
| Local IP Layer | Equivalent of AsasOne — 100% owned by local JV entity |

### **Tier 2 — “Mid-Market” (GDP/cap $10K–$30K, or pop \>50M w/ private market)**

Scaled JV or licensing model. Same fee percentages on a lower per-student budget, adjusted for purchasing power parity. Examples: Brazil, Mexico, UK, South Korea.

| Parameter | Range / Detail |
| :---- | :---- |
| Upfront | $100M – $500M (PPP-adjusted) |
| Fees | Same % as Tier 1, applied to lower per-student budget |
| Target Students (5 yr) | 20,000 – 100,000 |
| Per-Student Budget | $8,000 – $20,000 (PPP-adjusted) |
| Structure | JV with local partner or pure licensing |

### 

### 

### 

### **Tier 3 — “Emerging / Government” (GDP per capita \<$10K)**

Licensing or government partnership model. Government pays; Alpha provides the system. Scale is potentially massive. Examples: India.

| Parameter | Range / Detail |
| :---- | :---- |
| Upfront | $25M – $100M (mostly IP licensing \+ development) |
| Per-Student License Fee | $50 – $200/year (based on local economics) |
| Target Students (5 yr) | 100,000 – 1,000,000+ |
| Structure | Government operates schools; Alpha licenses IP \+ manages |
| Guide School | Established locally; trains government teachers as Guides |

## **2B. US State Rules**

US states follow a fundamentally different model from countries. There is no upfront government payment, no JV, and no billion-dollar asks. Revenue comes from per-student tuition (private pay), ESA/voucher capture, and potential state contracts.

### **Revenue Model**

* **In-Person Schools:** Micro schools (12–25 students) and 250-student campuses. Tuition priced at or near the ESA amount where available ($7K–$10K in AZ/FL/TX), with premium tiers at $15K–$25K for families who can supplement.  
    
* **Virtual Product (GT School model):** $3K–$5K per student. High margin, scales fast, and aligns with homeschool/ESA use cases.  
    
* **ESA/Voucher Capture:** In the top 5 priority states, ESA covers 55–82% of average private school tuition. Systems priced at the ESA floor maximize addressable market.

### **School Types (US)**

| Type | Size | Tuition | Target Family |
| :---- | :---- | :---- | :---- |
| Micro School | 12–25 students | $7K–$10K (at ESA level) | ESA families, first-time school choice |
| Flagship Campus | 250 students | $15K–$25K | Upper-middle income, supplementing ESA |
| Virtual (GT School) | Unlimited | $3K–$5K | Homeschool, rural, ESA-funded |
| STEM / Sports Academy | 100–250 students | $12K–$20K | Specialty demand |

### 

### 

### 

### **Key US Metrics**

* CAC (Customer Acquisition Cost) vs. LTV (Lifetime Value): The primary unit economics driver. Target CAC \< $500; LTV at ESA-level tuition over 5-year retention \= $35K–$50K.  
    
* Priority States: Florida (\#1), Texas (\#2), Arizona (\#3), Indiana (\#4), North Carolina (\#5). Selection based on ESA amount, market size, regulatory environment, and school-choice culture.

### **US State ESA Summary (Top 5\)**

| State | ESA Amount | Students on Vouchers | Avg. Private Tuition | ESA Coverage |
| :---- | :---- | :---- | :---- | :---- |
| Florida | $9,500–$10,700 | 500,000+ | $13,859 | \~72% |
| Texas (2026-27) | \~$10,000–$10,200 | \~95,000 (Y1 est.) | $13,995 | \~73% |
| Arizona | $7,000–$8,000 | 83,819 | $12,314 | \~57–65% |
| Indiana | $6,100–$7,400 | 79,448 | $10,330 | \~63% |
| North Carolina | $3,000–$7,000 | 103,400 | $11,105 | \~25–63% |

## **2C. Universal Deal Structure Rules**

These rules apply to every proposal the system generates — country or state, Tier 1 or Tier 3\. They are non-negotiable.

1. Alpha ALWAYS retains IP ownership of Timeback, AlphaCore, Guide School, and Incept eduLLM. No exceptions.  
     
2. Local partners or government funds real estate, marketing, and enrollment infrastructure.  
     
3. A local IP layer (equivalent of AsasOne in UAE) is always created and 100% owned by the local entity. It covers national identity, cultural values, and mandatory local curriculum.  
     
4. Management fee floor: 10% of per-student budget. This is non-negotiable.  
     
5. Timeback license fee floor: 20% of per-student budget. This is non-negotiable.  
     
6. Upfront IP development fee: minimum $25M for any country deal. Covers localization, eduLLM training, curriculum adaptation, and Guide School setup.  
     
7. Management fee prepayment: minimum 2 years prepaid before Alpha begins operations.  
     
8. Every proposal offers at least two school types (e.g., Flagship \+ Virtual, STEM \+ Sports).  
     
9. Guide School must be established locally within the first 12 months. Local educators are trained as Guides before student enrollment begins.  
     
10. All proposals include the three commitments: (i) Children will love school, (ii) Children will learn 2x faster, (iii) Children will develop life skills for the AI age.

## **2D. Scaling Formula**

The system uses these formulas to calculate the headline numbers for any country. All are user-overridable at HITL decision gates.

| Variable | Formula |
| :---- | :---- |
| PPP Factor | min(1.0, GDP\_per\_capita / $30,000) |
| Upfront Ask | max($25M, school\_age\_pop × $2 × PPP\_factor) |
| Student Target (5yr) | max(5,000, school\_age\_pop × 0.01 × demand\_factor) |
| Per-Student Budget | max($5,000, min($30,000, private\_school\_avg\_tuition × 0.8)) |
| Management Fee Rev. | Students × Per-Student Budget × 10% × 5 years |
| Timeback License Rev. | Students × Per-Student Budget × 20% × 5 years |

***demand\_factor*** is derived from the country’s private school enrollment rate, government reform appetite, and competitive density. Default \= 1.0 for Tier 1, 0.5 for Tier 2, 0.2 for Tier 3\.

## **2E. Proposal Output Requirements**

Every generated proposal must include the following six sections:

1. **Executive Summary:** with the three commitments and a headline financial ask.  
     
2. **Country/State Education System Diagnosis:** What is broken, what the government is trying to fix, where Alpha’s model creates the sharpest wedge.  
     
3. **The Alpha Education Stack:** How Timeback, AlphaCore, Guide School, and Incept eduLLM solve their specific problems. Includes the local IP layer concept.  
     
4. **Proposed Deal Structure:** School types, phased rollout plan (Phase 0 through Phase 3), and ownership/partnership structure.  
     
5. **Financial Summary:** Upfront ask, ongoing fee structure, projected student enrollment, revenue at scale, and return profile (IRR/MOIC for investor audiences).  
     
6. **The Ask:** Exactly what Alpha needs from the counterparty — regulatory access, tuition/subsidy approval, real estate, scholarship funding, and sovereign/political sponsorship.

# **3\. Architecture Overview**

The system uses a sequential multi-agent pipeline built on LangGraph. Each agent produces structured output that flows into the next. Human decision gates between phases allow executives to review and override AI-generated assumptions.

## **Pipeline Diagram**

![][image1]

ORCHESTRATOR AGENT → receives target (country/state) \+ user overrides, sequences agents, resolves conflicts, assembles final outputs.

Downstream agents (all read from and write to a shared context store):

* **Country/State Research Agent** — builds the comprehensive country/state profile  
    
* **Education System Research Agent** — deep-dives into education-specific data  
    
* **Strategy Agent** — formulates go-to-market strategy and applies business rules  
    
* **Financial Modelling Agent** — builds the complete financial model from strategy assumptions  
    
* **Document Generation Agent** — produces PPTX, DOCX, and XLSX deliverables from agent outputs

## **Shared Context Store**

All agents read from and write to a structured JSON/state object containing: country profile, education data, regulatory findings, strategic decisions, financial assumptions, and tier classification. This ensures consistency across all three output deliverables.

# **4\. Agent Definitions**

## **4.1 Orchestrator Agent**

**Role:** The conductor. Accepts user input, sequences agent execution, handles retries, applies the country tiering system, and manages human-in-the-loop checkpoints.

### **Responsibilities**

* Parse the target (e.g. “Saudi Arabia”, “India — Andhra Pradesh”, “Texas”)  
    
* Determine whether this is a sovereign nation or a US state (triggers fundamentally different model — see Section 2B)  
    
* Automatically classify countries into Tier 1, Tier 2, or Tier 3 using the tiering rules in Section 2A  
    
* Trigger agents in dependency order (research → strategy → financial → document generation)  
    
* Enforce all Universal Deal Structure Rules (Section 2C) across agent outputs  
    
* Apply the Scaling Formula (Section 2D) to calculate headline financial numbers  
    
* Surface key decision points to the user before proceeding  
    
* Assemble final deliverables from agent outputs

### **Decision Gates (Human-in-the-Loop)**

| Gate | Trigger | What the User Decides |
| :---- | :---- | :---- |
| 1 — Market Mode | After Research Agents complete | Private schools, government partnership, or hybrid? |
| 2 — Scale & Pricing | After Strategy Agent proposes scenarios | Confirm target student count, pricing tiers, school types, and audience |
| 3 — Output Review | After documents are generated | Approve, request revisions, or override specific sections |

## **4.2 Country Research Agent**

**Role:** Build a comprehensive country/state profile that every downstream agent depends on. This agent also determines the country tier classification.

### **Data Sources**

Perplexity Sonar Deep Research API ($0.41/query, synthesises 18+ live web sources with citations), World Bank Open Data (GDP, poverty, FDI via api.worldbank.org), IMF (macroeconomic indicators), UNESCO UIS (education/literacy data), OECD Education at a Glance, local government open data, news. For US states: NCES, EdChoice, and state-level education agencies.

### **Output → country\_profile object**

The Country Research Agent produces a structured JSON object containing the following sections:

* **target:** name, type (sovereign\_nation or us\_state), region, tier classification (1/2/3)  
    
* **demographics:** total population, population 0-18, growth rate, urbanisation, median age, median household income, Gini coefficient, top 10% household income, middle-class income range  
    
* **economy:** GDP, GDP per capita, GDP growth rate, currency, FX rate, inflation, sovereign wealth fund details, SWF AUM, credit rating  
    
* **education:** K-12 enrolled students, public/private split, average public spend per student, average private tuition, premium private tuition range, teacher count, student-teacher ratio, PISA scores, literacy rate, net enrollment rate, dropout rate, education budget as % GDP, language of instruction, national curriculum requirements, mandatory subjects  
    
* **regulatory:** ministry of education, key regulators, private school licensing process and timeline, foreign ownership rules and caps, charter school equivalents, PPP framework, curriculum flexibility  
    
* **political\_context:** government type, head of state, key education decision maker, national vision plan, education reform priority, reform themes, geopolitical risk, corruption index  
    
* **competitive\_landscape:** major private operators (name, students, tuition range), international school chains present, edtech penetration, market gaps

### **Key Research Tasks**

* Population pyramid and school-age cohort sizing  
    
* Income distribution (to size the addressable market at different tuition points)  
    
* Existing private school landscape, pricing tiers, and occupancy rates  
    
* Government education reform agenda and appetite for PPPs  
    
* Regulatory pathway: licensing, foreign ownership rules, curriculum mandates  
    
* Cultural and political considerations (language, religion, national identity)  
    
* Competitive operators and their weaknesses  
    
* Relevant sovereign wealth funds or government investment vehicles  
    
* For US states: ESA/voucher program details, amounts, eligibility, student counts, regulatory environment

## **4.3 Education System Research Agent**

**Role:** Deep-dive into the education system specifically — what’s broken, what’s being attempted, and where 2hr Learning’s model creates the sharpest wedge.

### **Output → education\_analysis object**

The Education System Research Agent produces a structured JSON object containing:

* **system\_diagnosis:** primary pain points, parent pain points, government pain points  
    
* **reform\_landscape:** active reforms, reform budget, appetite for foreign models, prior edtech initiatives, failed reforms and why  
    
* **2hr\_learning\_fit:** unique value propositions, localisation requirements, model recommendation (private/government/hybrid), rationale

## **4.4 Strategy Agent**

**Role:** Takes research outputs, applies the business rules from Section 2, and formulates the go-to-market strategy, partnership structure, and value proposition narrative.

### **Key Decisions (Proposed for Human Approval)**

| Decision | Options | Depends On |
| :---- | :---- | :---- |
| Entry mode | Private-only / Gov partnership / Hybrid | Tier classification, regulatory environment, reform appetite |
| Partnership structure | JV (UAE model) / Licensing / Franchise / Direct | Foreign ownership rules, capital availability, tier |
| Localisation entity | Equivalent of AsasOne — local IP layer | Cultural requirements, national identity priorities |
| School types | Which Alpha school types to deploy (min 2\) | Market demand, competitive gaps, regulatory fit |
| Scale target | Student count at Year 1 / 3 / 5 | Market size, capital, operational capacity |
| Pricing strategy | Tuition by school type and income tier | Income distribution, competitor pricing, ESA amounts (US) |
| Capital structure | Who funds what | Government willingness, SWF availability, debt markets |
| Pitch angle | Nation-building / ROI / Social impact / Workforce | Audience (royal, minister, PE fund, etc.) |

### **Strategy Output**

The Strategy Agent produces a structured JSON object containing: entry mode, partnership structure (type, local partner, ownership split, IP structure), brand (JV name suggestion, positioning, tagline), school types to deploy (with focus and target market for each), phased rollout (Phase 0 through Phase 3 with student counts and milestones), value proposition pillars (with proof points), pitch angle, and key asks from the government or counterparty.

### **Business Rule Enforcement**

The Strategy Agent MUST enforce all rules from Section 2C when generating its output. Specifically:

* Alpha IP ownership is never transferred or diluted  
    
* Management fee ≥ 10% of per-student budget  
    
* Timeback license fee ≥ 20% of per-student budget  
    
* Minimum $25M upfront IP development fee for any country deal  
    
* Minimum 2 years management fee prepaid  
    
* At least two school types in every proposal  
    
* Guide School established locally within 12 months  
    
* Three commitments always included

## **4.5 Financial Modelling Agent**

**Role:** Builds a complete financial model from the strategy assumptions. Outputs structured data for XLSX generation. Applies the Scaling Formula (Section 2D) and PPP Adjustment Logic.

### **A. Input Assumptions (User-Configurable)**

These are the levers the user can adjust before the model runs. Defaults are populated from research and strategy agents via the Scaling Formula, but all are overridable.

**Market & Scale**

| Assumption | Default / Range |
| :---- | :---- |
| Target student count (Year 5\) | Per Scaling Formula: max(5K, school\_age\_pop × 0.01 × demand\_factor) |
| Phase 1 students | 5,000 |
| Phase 2 students | 50,000 |
| Annual enrollment growth rate | 60–80% (early), 30–40% (mature) |
| Average school size | 500 students (country) / 12–250 (US state by type) |
| Number of schools at scale | Calculated from target students / avg school size |

**Pricing & Revenue**

| Assumption | Default / Range |
| :---- | :---- |
| Tuition — Premium tier | Per Scaling Formula, Tier 1: $20K–$30K |
| Tuition — Mid tier | Per Scaling Formula, Tier 2: $8K–$20K |
| Tuition — Gov/scholarship | Tier 3: $50–$200/yr license; US: ESA amount |
| Blended average tuition | Calculated from student mix |
| Ancillary revenue per student | $500 (uniforms, transport, meals) |
| Enrollment fill rate Year 1 | 60% |
| Enrollment fill rate Year 3+ | 90% |

**Cost Structure (Per Student at Scale)**

| Cost Category | % of Tuition |
| :---- | :---- |
| Personnel (Guides) | 24% |
| Timeback platform license | 20% |
| Real estate lease | 20–25% |
| Ministry/national curriculum delivery | 8–12% |
| Specialised afternoon programs | 10–16% |
| Admin, marketing, G\&A | 10–15% |
| Target EBITDA margin | 10–20% |

**Alpha Fee Structure (Non-Negotiable)**

| Fee | Amount / Calculation |
| :---- | :---- |
| Management Fee | 10% of per-student budget (floor) × students × years |
| Timeback License Fee | 20% of per-student budget (floor) × students × years |
| Upfront IP Development | Minimum $25M; scaled by Scaling Formula |
| Management Fee Prepayment | Minimum 2 years prepaid before operations begin |

**Capital Requirements**

| Category | Range |
| :---- | :---- |
| IP development & localisation | $200M–$1B (scales with country) |
| Management fee (5-yr prepaid) | $100M–$250M |
| Annual launch capital | $50M–$250M/yr |
| Real estate buildout (if applicable) | $1B–$5B (via dev partners) |
| Annual lease cost | 8–12% of buildout value |
| Government scholarship funding | $X per scholarship student/yr |

**Valuation & Returns**

| Metric | Range |
| :---- | :---- |
| EBITDA multiple (education sector) | 12–20x |
| Discount rate | 10–15% |
| Target IRR for investor/government | 20–30% |
| Exit timeline | Year 10 |

### **B. Model Outputs**

| Sheet | Contents |
| :---- | :---- |
| P\&L Projection | 10-year income statement: Revenue, COGS, gross margin, opex, EBITDA, net income |
| Student Rollout | Phased enrollment by school type, fill rates, new schools opened per year |
| Unit Economics | Per-student revenue, cost breakdown, contribution margin by school type and tier |
| Capital Deployment | IP spend, management fees, launch capital, real estate — by year |
| Cash Flow | Free cash flow, cumulative investment, payback period |
| Returns Analysis | IRR, MOIC, enterprise value at exit, sensitivity tables |
| Sensitivity Analysis | Tornado chart inputs: tuition ±20%, enrollment ±30%, margin ±5pp, multiple ±5x |
| Country Comparison | If multiple countries modelled: side-by-side key metrics |

### **C. PPP Adjustment Logic**

The agent must adjust all dollar-denominated assumptions for purchasing power parity when modelling lower-income countries:

* **High-income country (GDP per capita \> $30K / Tier 1):** Use UAE-comparable assumptions (tuition $20–$30K, margins 15–20%). PPP Factor \= 1.0.  
    
* **Upper-middle-income ($10K–$30K / Tier 2):** Apply PPP factor to tuition (typically 40–60% of US levels). Costs also adjust (labor cheaper, real estate varies). Margins may compress (5–15%) unless government subsidises.  
    
* **Lower-middle or low-income (\<$10K / Tier 3):** Government partnership is likely primary mode. Tuition/subsidy levels set by government budget per student. IP licensing fee model may replace JV economics.

## **4.6 Document Generation Agent**

**Role:** Produces the three final deliverables from the structured agent outputs: PPTX pitch deck, DOCX narrative proposal, and XLSX financial model.

### **Deck Outline (PPTX)**

Adapts based on audience type, country context, and entry mode:

* **Royal/head of state:** Nation-building language, sovereignty emphasis  
    
* **Minister of Education:** System reform language, outcomes data  
    
* **PE/SWF investor:** Returns, growth metrics, IRR/MOIC

### **Standard Deck Structure**

| Slide | Title Pattern | Content Varies By |
| :---- | :---- | :---- |
| 0 | Title | Country branding, partnership name, audience |
| 1 | Vision & Executive Summary | National vision alignment, three commitments |
| 2 | Proof — Alpha Outcomes | Same global proof points, contextualised for local concerns |
| 3 | The System | IP stack \+ local sovereignty layer (equivalent of AsasOne) |
| 4 | Scope, Timeline & Economics | Country-specific financials from Financial Agent |
| 5 | The Ask & Next Steps | Tailored asks (regulatory, funding, partnership terms) |
| A1–A10 | Appendix | Country-specific deep dives |

# **5\. Input Assumptions Master List**

These are all the variables the system needs. They are populated automatically by research agents but can be overridden by the user at any decision gate.

## **Tier 1: Must-Have (System Cannot Run Without These)**

| \# | Assumption | Source | Override? |
| :---- | :---- | :---- | :---- |
| 1 | Target country or US state | User input | — |
| 2 | School-age population (ages 5–18) | Country Research Agent | Yes |
| 3 | GDP per capita (USD) | Country Research Agent | Yes |
| 4 | Average household income by decile | Country Research Agent | Yes |
| 5 | Existing private school tuition range | Education Research Agent | Yes |
| 6 | Government education spend per student | Education Research Agent | Yes |
| 7 | Foreign ownership rules for schools | Country Research Agent | Yes |
| 8 | Entry mode (private / gov / hybrid) | Strategy Agent → User confirms | Decision gate |
| 9 | Target student count at Year 5 | Strategy Agent → User confirms | Decision gate |
| 10 | Tuition / price per student | Financial Agent → User confirms | Decision gate |
| 11 | Audience for deck (gov / investor / royal) | User input | — |

## **Tier 2: Important (Improve Quality Significantly)**

| \# | Assumption | Source |
| :---- | :---- | :---- |
| 12 | PISA or equivalent test scores | Education Research Agent |
| 13 | National vision plan / reform agenda | Country Research Agent |
| 14 | Sovereign wealth fund or investment vehicle | Country Research Agent |
| 15 | Local construction cost per sqm | Country Research Agent |
| 16 | Local teacher/guide salary benchmark | Education Research Agent |
| 17 | Competitor operators and market share | Education Research Agent |
| 18 | Licensing/regulatory timeline | Country Research Agent |
| 19 | Mandatory national curriculum subjects | Education Research Agent |
| 20 | Language of instruction \+ ESL needs | Education Research Agent |
| 21 | FX rate and inflation forecast | Country Research Agent |
| 22 | Local real estate lease yields | Country Research Agent |

## **Tier 3: Nice-to-Have (Enrich the Narrative)**

| \# | Assumption | Source |
| :---- | :---- | :---- |
| 23 | Key political figure bios / quotes | Country Research Agent |
| 24 | Cultural attitudes toward education | Education Research Agent |
| 25 | Brain drain statistics | Education Research Agent |
| 26 | University admission patterns | Education Research Agent |
| 27 | Comparable successful foreign school entries | Education Research Agent |
| 28 | EdTech adoption and infrastructure | Education Research Agent |
| 29 | Relevant diplomatic relationships with US | Country Research Agent |
| 30 | Tax incentives for education investment | Country Research Agent |

# **6\. Execution Flow**

## **Phase 1: Research (Parallel)**

Country Research Agent and Education System Research Agent run in parallel. Both write to the shared context store.

**↓ DECISION GATE 1:** User reviews research, confirms entry mode (private / government / hybrid).

## **Phase 2: Strategy**

Strategy Agent reads the shared context, applies business rules from Section 2, determines tier, partnership structure, school types, pricing, and phased rollout.

**↓ DECISION GATE 2:** User confirms scale, pricing, school types, and audience.

## **Phase 3: Output Generation**

Financial Model Agent builds the 5-year P\&L, unit economics, capital deployment, cash flow, and returns analysis. Document Generation Agent produces the three deliverables (PPTX, DOCX, XLSX) from the structured agent outputs.

**↓ DECISION GATE 3:** User reviews outputs, requests revisions or approves.

## **Final Deliverables**

Downloadable .pptx \+ .docx \+ .xlsx package, stored in /outputs/{country}/ or /outputs/{state}/.

# **7\. Implementation Recommendation**

## **Recommended Technology Stack**

| Component | Technology | Role |
| :---- | :---- | :---- |
| Frontend | Next.js 15 on Vercel \+ shadcn/ui | Executive-grade web UI: country selector, progress tracker, approval gates, document download |
| Agent Framework | LangGraph (open-source, Python) | Stateful multi-agent pipeline with checkpoint-based human-in-the-loop |
| LLM Backbone | Anthropic Claude Sonnet (primary) \+ GPT-4o (fallback) | Strategy reasoning, financial modeling, narrative generation |
| Research Engine | Perplexity Sonar Deep Research API | Live web research with citations — $0.41/query, 18+ sources |
| Data APIs | World Bank, IMF, UNESCO (direct REST) | Structured economic and education data for financial models |
| Document Generation | Python FastAPI microservice (python-pptx, openpyxl, python-docx) | Generates PPTX, XLSX, DOCX from agent-produced structured data |
| Checkpoint Store | PostgreSQL (Neon.tech or Vercel Postgres) | Persists workflow state for HITL pause/resume |
| Observability | LangSmith (free tier) | Agent trace logging, debugging, evaluation |

## **Why This Stack**

* **Best human-in-the-loop:** LangGraph’s checkpoint-based HITL is the most sophisticated available. If an executive reviews a strategy draft on Tuesday and approves on Thursday, the workflow resumes exactly where it left off.

* **Best research quality:** A single Perplexity Sonar Deep Research call synthesizes 18+ live web sources in seconds with full citations.

* **Lowest cost:** No managed-platform overhead. The dominant cost is pure LLM token usage.

* **No vendor lock-in:** Swap LLM providers, add models, or migrate hosting without renegotiating enterprise contracts.

* **Fastest to MVP:** LangGraph \+ Next.js \+ Sonar has extensive documentation. A functional 4-agent pipeline with HITL in 5 days is realistic.

## **Prompt Architecture (Per Agent)**

Each agent receives:

1. **System prompt** — role definition, output schema, quality standards, business rules from Section 2  
     
2. **Shared context** — the accumulated state object from prior agents, including tier classification  
     
3. **Tools** — web search (Perplexity Sonar), calculator, data APIs, file creation  
     
4. **Output schema** — strict JSON schema the agent must conform to  
     
5. **Few-shot examples** — the UAE proposal serves as the gold-standard reference  
     
6. **Business rule enforcement** — explicit guardrails ensuring fee floors, IP ownership, and deal structure constraints are never violated

# **8\. Priority Target Markets**

## **8A. Countries (Top 10\)**

| \# | Country | Tier | Potential | Key Factors |
| :---- | :---- | :---- | :---- | :---- |
| 1 | Saudi Arabia | 1 | $1B+ | 100% foreign ownership. Vision 2030\. 10.8M school-age pop. |
| 2 | Qatar | 1 | $300M–$500M | 100% foreign ownership. 228K private school students. GDP/cap \~$85K. |
| 3 | Singapore | 1 | $200M–$400M | No ownership restriction. Premium market ($35K–$52K tuition). |
| 4 | Switzerland | 1 | $200M–$500M | Highest tuition globally. Cantonal regulation. Expat \+ domestic market. |
| 5 | India | 3 | $50M–$200M | 100% FDI allowed but NFP structure. 250M K-12 students. State-level reg. |
| 6 | Brazil | 2 | $100M–$300M | No foreign ownership restriction. For-profit allowed. 47.3M K-12 students. |
| 7 | South Korea | 2 | $100M–$250M | Foreign foundations can establish schools. $35K–$54K premium tuition. |
| 8 | UK | 2 | $100M–$200M | Fully open. No curriculum mandates for independents. 20% VAT on fees. |
| 9 | Nigeria | 3 | $25M–$75M | Foreign ownership permitted. 220M+ population. Enormous scale potential. |
| 10 | Kenya | 3 | $25M–$50M | Any person may establish a school. Growing middle class. |

## **8B. US States (Top 5\)**

* **\#1 Florida:** Largest school choice market. 500K+ on vouchers. $3.9B annual spend. Universal eligibility. Light-touch regulation.  
    
* **\#2 Texas:** Most powerful emerging market. 5.5M public school students. ESA launches 2026–27 with \~$10K/student. First-mover advantage.  
    
* **\#3 Arizona:** Pioneer ESA state. 83,819 participants. Highest charter penetration outside DC at 20.5%. Strong micro-school culture.  
    
* **\#4 Indiana:** \#1-ranked charter law. 79,448 voucher users. Fully universal July 2026\. Affordable market.  
    
* **\#5 North Carolina:** Fastest growing ESA participation. 103,400 students (nearly 3x growth). 77% of charter schools have waitlists.

## **8C. Combined Priority Matrix**

| Market | Type | Est. Revenue (5yr) | Urgency | Complexity |
| :---- | :---- | :---- | :---- | :---- |
| Saudi Arabia | Tier 1 | $1B+ upfront \+ ongoing | High — Vision 2030 | Medium |
| Qatar | Tier 1 | $300M–$500M | High | Low |
| Florida | US State | Per-student at scale | Immediate — 500K+ on vouchers | Low |
| Texas | US State | Per-student at scale | High — SB 2 launches 2026-27 | Low |
| Singapore | Tier 1 | $200M–$400M | Medium | Medium |
| India | Tier 3 | $50M–$200M (licensing) | Medium — Scale play | High |
| Brazil | Tier 2 | $100M–$300M | Medium | Medium |
| Arizona | US State | Per-student at scale | Immediate — 84K ESA users | Low |
| Indiana | US State | Per-student at scale | High — Universal July 2026 | Low |
| North Carolina | US State | Per-student at scale | High — 3x growth | Low |

# **9\. Quality Controls**

| Check | When | How |
| :---- | :---- | :---- |
| Data freshness | Research phase | Agents must cite sources and dates; reject data older than 2 years |
| Business rule compliance | Strategy \+ Financial phases | Automated check: fee floors met? IP ownership preserved? Min 2 school types? |
| Financial model balancing | After Financial Agent | Automated: revenue \= students × tuition? Costs sum correctly? Fee floors enforced? |
| Narrative consistency | After all outputs | Orchestrator cross-checks: proposition, model, and deck tell the same story |
| Cultural sensitivity | Strategy \+ Deck phases | Agent prompt includes explicit cultural guardrails per region |
| Assumption audit trail | Throughout | Every assumption logged with source, confidence level, and whether user-overridden |
| Tier classification validation | After Research phase | Confirm tier matches GDP/cap and population thresholds before proceeding |

# **10\. Scaling Across Countries**

The system is designed to be run-once-per-country but the outputs accumulate into a portfolio view:

* Each country run produces a folder: /outputs/{country}/

* The Financial Agent can produce a cross-country comparison sheet when 2+ countries have been modelled

* The Orchestrator maintains a registry of completed country analyses

# **12\. Appendix: UAE Reference Parameters**

For calibration, the UAE proposal used these specific numbers:

| Parameter | UAE Value |
| :---- | :---- |
| Target students (Year 5\) | 200,000 |
| Tuition per student | $25,000 |
| Annual revenue at scale | $5B |
| EBITDA margin | 10–20% |
| Enterprise value | $10–20B (15–20x EBITDA) |
| Program capital (IP \+ mgmt fee) | $1.5B |
| Real estate buildout | \~$5B |
| Annual lease | \~$500M |
| Scholarship cost | \~$1B/yr per 100K students |
| Return multiple | 7–13x |
| Partnership | JV, 100% owned by local partner (Next71) |
| Alpha role | Operator and licensor |
| Management fee | 10% of per-student budget |
| Timeback license fee | 20% of per-student budget |
| Local IP layer | AsasOne (Emirati values, national identity) |
| Regulatory bodies | MoE, ADEK, KHDA |
| Mandatory subjects | Arabic, Islamic Studies, Moral Education, Social Studies |
| School types | STEM, Sports, Waypoint, GT, National Identity |

# **13\. Timeline & Next Steps**

The timeline is driven by one hard deadline: McKenzie presents to first ladies and heads-of-state delegations on March 24, 2026\. The tool must be ready to generate proposals on demand by that date.

| Week | Milestone | Detail |
| :---- | :---- | :---- |
| Mar 3–7 | Finalize Rules \+ Begin MVP | Lock business rules. Begin LangGraph pipeline. Set up Vercel, Sonar API, PostgreSQL. |
| Mar 10–14 | Working MVP | 4-agent pipeline functional. Basic HITL gates. Draft PPTX and XLSX. Test on 5–10 countries. |
| Mar 17–21 | Polished Version | Executive-grade UI. Refined templates matching UAE deck quality. Full financial model. US state support. |
| Mar 24 | McKenzie Presentation | Tool is live. If a head of state expresses interest, a proposal can be generated within hours. |
| Apr–May | Iterate & Expand | More countries and states. Refine prompts. Cross-country comparison dashboard. Versioning and history. |

## **Immediate Action Items**

* Review and approve the business rules in Section 2\. Flag any overrides to the tiering system, fee floors, or deal structure constraints.  
    
* Stand up LangGraph \+ Vercel \+ Sonar project skeleton. Target: Research Agent producing country profiles by end of Week 1\.  
    
* Validate the Scaling Formula (Section 2D) against the UAE deal economics. Confirm fee floors are aligned with margin targets.

[image1]: <data:image/png;base64,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>