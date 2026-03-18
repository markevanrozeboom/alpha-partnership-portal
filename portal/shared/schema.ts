import { pgTable, text, serial, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Financial Research Data (from LLM) ─────────────────────────────────────

export interface MetroFinancialData {
  name: string;
  isCapital: boolean;
  estimatedK12Children: number;
  /** K-12 children in families with household income ≥ $200K USD equivalent */
  childrenInFamiliesAbove200kUsd: number;
  /** K-12 children in families with household income ≥ $300K USD equivalent */
  childrenInFamiliesAbove300kUsd: number;
  /** K-12 children in families with household income ≥ $400K USD equivalent */
  childrenInFamiliesAbove400kUsd: number;
  /** K-12 children in families with household income ≥ $500K USD equivalent */
  childrenInFamiliesAbove500kUsd: number;
}

export interface FinancialResearchData {
  gdpPerCapitaUsd: number;
  schoolAgePopulationNum: number;
  /** Current government per-student funding in USD */
  currentPublicFundingPerStudent: number;
  /** Most expensive non-boarding K-12 school annual tuition in USD */
  mostExpensiveNonBoardingTuitionUsd: number;
  topMetros: MetroFinancialData[];
}

// ─── Country Context (returned by LLM research) ─────────────────────────────

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
  culturalNarrative: string;
  keyStrengths: string[];
  localizedProgramName: string;
  localLifeSkillsFocus: string;
  languageApps: string;
  financialData: FinancialResearchData;
}

// ─── Computed Financial Model ────────────────────────────────────────────────

export interface FlagshipSchoolAllocation {
  metro: string;
  isCapital: boolean;
  count: number;
}

export interface FlagshipModel {
  schools: FlagshipSchoolAllocation[];
  tuitionPerYear: number;
  capacityPerSchool: number;
  totalStudents: number;
  totalAnnualRevenue: number;
  operatingMarginPct: number;
  totalSchoolCount: number;
  /** If no metros can support a flagship, describes required scholarship funding */
  scholarshipNote: string | null;
}

export interface CostBreakdownItem {
  item: string;
  amount: number;
  note: string;
}

export interface CounterpartyModel {
  minStudentsPerYear: number;
  perStudentBudget: number;
  costBreakdown: CostBreakdownItem[];
}

export interface UpfrontItem {
  item: string;
  amountUsd: number;
  recipient: string;
  note?: string;
}

export interface OngoingItem {
  item: string;
  amount: string;
  recipient: string;
}

export interface UpfrontInvestment {
  fixedItems: UpfrontItem[];
  variableItems: UpfrontItem[];
  totalUsd: number;
}

export interface OngoingInvestment {
  items: OngoingItem[];
}

export interface ScholarshipGap {
  perStudentGap: number;
  totalAnnual: number;
  currentFunding: number;
  note: string;
}

export interface FinancialModel {
  flagship: FlagshipModel;
  counterparty: CounterpartyModel;
  upfront: UpfrontInvestment;
  ongoing: OngoingInvestment;
  scholarshipGap: ScholarshipGap;
}

// ─── Generation Result ───────────────────────────────────────────────────────

export interface GenerationResult {
  context: CountryContext;
  financialModel: FinancialModel;
  termSheetHtml: string;
  pitchDeckHtml: string;
}

// ─── Database Schema ─────────────────────────────────────────────────────────

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
