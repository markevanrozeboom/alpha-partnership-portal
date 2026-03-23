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
  localizedProgramName: string; // e.g. "Ed71" for UAE — brand name for the country-owned school network
  localizedLifeSkillsName: string; // e.g. "AsasCore" for UAE — brand name for the life-skills curriculum (must differ from localizedProgramName)
  localLifeSkillsFocus: string; // what life skills matter most in this culture
  languageApps: string; // what localized AI apps would be needed
  addressableStudentPopulation: string; // estimated students in families with AGI > $250k
  addressableMethodology: string; // brief explanation of how estimate was derived
}

// ─── Financial Model Types (Dual-School Model) ─────────────────────────────────

/** Metro-level financial data for flagship optimization */
export interface MetroFinancialData {
  name: string;
  isCapital: boolean;
  childrenInFamiliesAbove200kUsd: number;
  childrenInFamiliesAbove300kUsd: number;
  childrenInFamiliesAbove400kUsd: number;
  childrenInFamiliesAbove500kUsd: number;
  mostExpensiveNonBoardingSchoolTuition: number;
}

/** Input data for financial model computation */
export interface FinancialResearchData {
  topMetros: MetroFinancialData[];
  mostExpensiveNonBoardingTuitionUsd: number;
  currentPublicFundingPerStudent: number;
  gdpPerCapitaUsd: number;
}

/** Allocation of flagship schools to a metro area */
export interface FlagshipSchoolAllocation {
  metro: string;
  isCapital: boolean;
  count: number;
  tuitionPerYear: number;
  capacityPerSchool: number;
}

/** Flagship: Alpha Flagship schools model result */
export interface FlagshipModel {
  schools: FlagshipSchoolAllocation[];
  tuitionPerYear: number;
  capacityPerSchool: number;
  totalStudents: number;
  totalAnnualRevenue: number;
  operatingMarginPct: number;
  totalSchoolCount: number;
  scholarshipNote: string | null;
}

/** National: Counterparty (country-owned) schools model */
export interface CounterpartyModel {
  minStudentsPerYear: number;
  perStudentBudget: number;
  costBreakdown: { item: string; amount: number; note: string }[];
}

/** Upfront investment breakdown */
export interface UpfrontInvestment {
  fixedItems: { item: string; amountUsd: number; recipient: string }[];
  variableItems: { item: string; amountUsd: number; recipient: string; note?: string }[];
  totalUsd: number;
}

/** Ongoing annual investment items */
export interface OngoingInvestment {
  items: { item: string; amount: string; recipient: string }[];
}

/** Scholarship / funding gap analysis */
export interface ScholarshipGap {
  perStudentGap: number;
  totalAnnual: number;
  currentFunding: number;
  note: string;
}

/** Complete financial model output */
export interface FinancialModel {
  flagship: FlagshipModel;
  counterparty: CounterpartyModel;
  upfront: UpfrontInvestment;
  ongoing: OngoingInvestment;
  scholarshipGap: ScholarshipGap;
}

// The full generation result
export interface GenerationResult {
  context: CountryContext;
  termSheetHtml: string;
  pitchDeckHtml: string;
  termSheetDocxBase64: string; // base64-encoded DOCX file
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
