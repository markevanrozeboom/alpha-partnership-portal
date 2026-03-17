import type { Express } from "express";
import type { Server } from "http";
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import type { CountryFacts } from "@shared/schema";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a research assistant for 2hr Learning, a revolutionary AI-powered education company. 
Your job is to produce 5 key data points about a country or US state, written for an executive audience.

CRITICAL: These materials may be presented to heads of state, sovereign rulers, and senior government officials.
- Use formal diplomatic names (e.g., "The United Arab Emirates" not "UAE")
- Use proper honorifics for leaders
- NEVER reference internal tiers, scores, or rankings
- Write with the voice of a trusted advisor presenting to royalty

Return valid JSON matching this exact structure:
{
  "country": "Display name",
  "formalName": "Official diplomatic name",
  "headOfState": "Full name with honorifics",
  "headOfStateTitle": "Their title",
  "flagEmoji": "🇺🇸",
  "facts": {
    "schoolAgePopulation": "X million children aged 5-18 (be specific with a number)",
    "gdpPerCapita": "$XX,XXX (current USD, be specific)",
    "govEducationSpend": "X.X% of GDP / $X,XXX per student",
    "nationalEdVision": "Brief 1-2 sentence summary of the country's stated education reform goals or national vision",
    "keyOpportunity": "1-2 sentence description of the specific opportunity for AI-powered education in this market"
  },
  "salesPitch": "A compelling 3-4 sentence pitch for why 2hr Learning is the ideal partner for this country's education transformation. Reference specific local context. Tone: confident, measured, advisory — NOT salesy.",
  "economics": {
    "flagshipSchoolFee": "$40,000 – $100,000 per school per year",
    "nationalProgramFee": "$25,000 per school per year (fixed)",
    "devInvestment": "$750M total development investment ($250M × 3 phases)",
    "equityModel": "100/0 — Counterparty retains full ownership; 2hr Learning operates as technology and curriculum partner",
    "upsideNarrative": "A brief 2-sentence description of the financial upside potential beyond the base economics — referencing scale, network effects, or strategic positioning specific to this market."
  }
}

IMPORTANT: The economics section is FIXED — the same deal structure for every country. Only the upsideNarrative changes per market.
The facts must be specific, quantitative where possible, and sourced from your training data.
Return ONLY the JSON object, no markdown fences or explanation.`;

async function generateCountryFacts(target: string): Promise<CountryFacts> {
  const message = await client.messages.create({
    model: "claude_sonnet_4_6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Generate the 5 key data points and sales pitch for: ${target}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  // Strip markdown fences if present
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned) as CountryFacts;
}

export function registerRoutes(server: Server, app: Express) {
  // Create a new run
  app.post("/api/generate", async (req, res) => {
    const { target } = req.body;
    if (!target || typeof target !== "string" || !target.trim()) {
      res.status(400).json({ error: "Target country or state is required" });
      return;
    }

    const run = storage.createRun(target.trim());
    storage.updateRun(run.id, { status: "generating" });

    // Generate in background
    generateCountryFacts(target.trim())
      .then((result) => {
        storage.updateRun(run.id, { status: "completed", result });
      })
      .catch((err) => {
        storage.updateRun(run.id, {
          status: "error",
          error: String(err),
        });
      });

    res.json({ id: run.id });
  });

  // Get run status
  app.get("/api/runs/:id", (req, res) => {
    const run = storage.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(run);
  });

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
}
