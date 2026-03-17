import { pgTable, text, serial, integer, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Country data points returned by the backend
export interface CountryFacts {
  country: string;
  formalName: string;
  headOfState: string;
  headOfStateTitle: string;
  flagEmoji: string;
  facts: {
    schoolAgePopulation: string;
    gdpPerCapita: string;
    govEducationSpend: string;
    nationalEdVision: string;
    keyOpportunity: string;
  };
  salesPitch: string;
  economics: {
    flagshipSchoolFee: string;
    nationalProgramFee: string;
    devInvestment: string;
    equityModel: string;
    upsideNarrative: string;
  };
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
