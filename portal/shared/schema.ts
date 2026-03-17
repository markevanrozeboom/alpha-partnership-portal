import { pgTable, text, serial, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Country research context returned by AI
export interface CountryContext {
  country: string;
  formalName: string;
  headOfState: string;
  headOfStateTitle: string;
  flagEmoji: string;
  population: string;
  gdpPerCapita: string;
  schoolAgePopulation: string;
  currentEdSpendPerStudent: string;
  nationalEdVision: string;
  culturalNarrative: string; // 2-3 sentences about why this country + education transformation
  keyStrengths: string[]; // 3 bullet points about country's strengths for this partnership
  localizedProgramName: string; // e.g. "Ed71" for UAE, suggested local brand name
  localLifeSkillsFocus: string; // what life skills matter most in this culture
  languageApps: string; // what localized AI apps would be needed
}

// The full generation result
export interface GenerationResult {
  context: CountryContext;
  termSheetHtml: string;
  pitchDeckHtml: string;
}

// In-memory only — no DB needed
export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  target: text("target").notNull(),
  status: text("status").notNull().default("pending"),
  result: json("result"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRunSchema = createInsertSchema(runs).omit({ id: true, createdAt: true });
export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runs.$inferSelect;
