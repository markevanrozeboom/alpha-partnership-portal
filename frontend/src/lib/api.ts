/**
 * API client for the Alpha Country/State Business Plan backend.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FinancialAssumption {
  key: string;
  label: string;
  value: number;
  min_val: number;
  max_val: number;
  step: number;
  unit: string;
  category: string;
  description: string;
  locked: boolean;
}

export interface YearProjection {
  year: number;
  students: number;
  schools: number;
  revenue: number;
  cogs: number;
  gross_margin: number;
  opex: number;
  ebitda: number;
  net_income: number;
  free_cash_flow: number;
  cumulative_cash: number;
}

export interface UnitEconomics {
  school_type: string;
  per_student_revenue: number;
  per_student_cost: number;
  contribution_margin: number;
  margin_pct: number;
}

export interface ReturnsAnalysis {
  irr: number | null;
  moic: number | null;
  enterprise_value_at_exit: number | null;
  payback_period_years: number | null;
  ebitda_multiple: number | null;
}

export interface SensitivityScenario {
  variable: string;
  base_case: number;
  downside: number;
  upside: number;
}

export interface FinancialModel {
  pnl_projection: YearProjection[];
  unit_economics: UnitEconomics[];
  returns_analysis: ReturnsAnalysis;
  sensitivity: SensitivityScenario[];
  ppp_factor: number;
  management_fee_pct: number;
  timeback_license_pct: number;
  upfront_ip_fee: number;
  total_management_fee_revenue: number;
  total_timeback_license_revenue: number;
}

export type PipelineStatus =
  | "pending"
  | "researching_country"
  | "review_country_report"
  | "researching_education"
  | "review_education_report"
  | "strategizing"
  | "review_strategy"
  | "presenting_assumptions"
  | "review_assumptions"
  | "building_model"
  | "review_model"
  | "presenting_term_sheet_assumptions"
  | "review_term_sheet_assumptions"
  | "generating_documents"
  | "review_documents"
  | "completed"
  | "error";

export interface RunStatus {
  run_id: string;
  status: PipelineStatus;
  target: string;
  tier: number | null;
  target_type: string | null;
  agent_logs: string[];

  // Narrative reports
  country_report: string | null;
  education_report: string | null;
  strategy_report: string | null;

  // Structured data
  country_profile: Record<string, unknown> | null;
  education_analysis: Record<string, unknown> | null;
  strategy: Record<string, unknown> | null;
  financial_assumptions: { assumptions: FinancialAssumption[] } | null;
  financial_model: FinancialModel | null;
  term_sheet_assumptions: { assumptions: FinancialAssumption[] } | null;

  // File paths
  pptx_path: string | null;
  docx_path: string | null;
  xlsx_path: string | null;
  term_sheet_docx_path: string | null;
  country_report_docx_path: string | null;
  education_report_docx_path: string | null;
  strategy_report_docx_path: string | null;

  error_message: string | null;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

export async function createRun(target: string): Promise<{ run_id: string }> {
  const res = await fetch(`${API_URL}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw new Error(`Failed to create run: ${res.statusText}`);
  return res.json();
}

export async function getRunStatus(runId: string): Promise<RunStatus> {
  const res = await fetch(`${API_URL}/api/runs/${runId}`);
  if (!res.ok) throw new Error(`Failed to get run: ${res.statusText}`);
  return res.json();
}

// --- Feedback endpoints ---

export async function submitCountryReportFeedback(
  runId: string,
  approved: boolean,
  feedback?: string,
  entryMode?: string
) {
  const res = await fetch(`${API_URL}/api/runs/${runId}/feedback/country-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, feedback, entry_mode: entryMode }),
  });
  if (!res.ok) throw new Error("Failed to submit feedback");
  return res.json();
}

export async function submitEducationReportFeedback(
  runId: string,
  approved: boolean,
  feedback?: string
) {
  const res = await fetch(`${API_URL}/api/runs/${runId}/feedback/education-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, feedback }),
  });
  if (!res.ok) throw new Error("Failed to submit feedback");
  return res.json();
}

export async function submitStrategyFeedback(
  runId: string,
  approved: boolean,
  feedback?: string
) {
  const res = await fetch(`${API_URL}/api/runs/${runId}/feedback/strategy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, feedback }),
  });
  if (!res.ok) throw new Error("Failed to submit feedback");
  return res.json();
}

export async function submitAssumptionsFeedback(
  runId: string,
  approved: boolean,
  adjustments: Record<string, number>,
  notes?: string
) {
  const res = await fetch(`${API_URL}/api/runs/${runId}/feedback/assumptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, adjustments, notes }),
  });
  if (!res.ok) throw new Error("Failed to submit assumptions");
  return res.json();
}

export async function submitModelFeedback(
  runId: string,
  locked: boolean,
  adjustments: Record<string, number>,
  notes?: string
) {
  const res = await fetch(`${API_URL}/api/runs/${runId}/feedback/model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locked, adjustments, notes }),
  });
  if (!res.ok) throw new Error("Failed to submit model feedback");
  return res.json();
}

export async function submitTermSheetAssumptionsFeedback(
  runId: string,
  approved: boolean,
  adjustments: Record<string, number>,
  notes?: string
) {
  const res = await fetch(`${API_URL}/api/runs/${runId}/feedback/term-sheet-assumptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, adjustments, notes }),
  });
  if (!res.ok) throw new Error("Failed to submit term sheet assumptions");
  return res.json();
}

export async function recalculateTermSheetImpact(
  runId: string,
  adjustments: Record<string, number>
): Promise<{
  has_financial_impact: boolean;
  impacted_fields: string[];
  financial_model?: FinancialModel;
  financial_assumptions?: { assumptions: FinancialAssumption[] };
}> {
  const res = await fetch(`${API_URL}/api/runs/${runId}/recalculate-term-sheet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments }),
  });
  if (!res.ok) throw new Error("Failed to check term sheet impact");
  return res.json();
}

export async function submitDocumentFeedback(
  runId: string,
  approved: boolean,
  audience: string,
  revisionNotes?: string
) {
  const res = await fetch(`${API_URL}/api/runs/${runId}/feedback/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, audience, revision_notes: revisionNotes }),
  });
  if (!res.ok) throw new Error("Failed to submit document feedback");
  return res.json();
}

// --- Real-time recalculation ---

export async function recalculateModel(
  runId: string,
  adjustments: Record<string, number>
): Promise<{
  financial_model: FinancialModel;
  financial_assumptions: { assumptions: FinancialAssumption[] };
}> {
  const res = await fetch(`${API_URL}/api/runs/${runId}/recalculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments }),
  });
  if (!res.ok) throw new Error("Failed to recalculate model");
  return res.json();
}

// --- Downloads ---

export function getDownloadUrl(runId: string, fileType: string): string {
  return `${API_URL}/api/runs/${runId}/download/${fileType}`;
}
