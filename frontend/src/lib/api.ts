/**
 * API client for the Alpha Country/State Pipeline backend.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types (mirrors backend schemas)
// ---------------------------------------------------------------------------

export type PipelineStatus =
  | "pending"
  | "researching"
  | "awaiting_gate_1"
  | "strategizing"
  | "awaiting_gate_2"
  | "generating"
  | "awaiting_gate_3"
  | "completed"
  | "error";

export type EntryMode = "private" | "government" | "hybrid";
export type AudienceType = "royal" | "minister" | "investor";

export interface CountryOption {
  name: string;
  tier: number;
  region: string;
  potential: string;
  key_factors: string;
}

export interface StateOption {
  name: string;
  rank: number;
  esa_amount: string;
  students_on_vouchers: string;
  key_factors: string;
}

export interface RunStatusResponse {
  run_id: string;
  status: PipelineStatus;
  target: string;
  tier: number | null;
  target_type: string | null;
  agent_logs: string[];
  country_profile: any | null;
  education_analysis: any | null;
  strategy: any | null;
  financial_model: any | null;
  pptx_path: string | null;
  docx_path: string | null;
  xlsx_path: string | null;
  error_message: string | null;
}

export interface Gate1Decision {
  entry_mode: EntryMode;
  notes?: string;
}

export interface Gate2Decision {
  confirmed_student_count?: number;
  confirmed_pricing?: number;
  confirmed_school_types?: string[];
  audience: AudienceType;
  notes?: string;
}

export interface Gate3Decision {
  approved: boolean;
  revision_notes?: string;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API Error: ${res.status}`);
  }

  return res.json();
}

/** List priority countries */
export async function getCountries(): Promise<{ countries: CountryOption[] }> {
  return apiFetch("/api/countries");
}

/** List priority US states */
export async function getStates(): Promise<{ states: StateOption[] }> {
  return apiFetch("/api/states");
}

/** Start a new pipeline run */
export async function createRun(
  target: string,
  audience?: AudienceType
): Promise<RunStatusResponse> {
  return apiFetch("/api/runs", {
    method: "POST",
    body: JSON.stringify({ target, audience }),
  });
}

/** Get current status of a pipeline run */
export async function getRunStatus(
  runId: string
): Promise<RunStatusResponse> {
  return apiFetch(`/api/runs/${runId}`);
}

/** Submit Gate 1 decision */
export async function submitGate1(
  runId: string,
  decision: Gate1Decision
): Promise<RunStatusResponse> {
  return apiFetch(`/api/runs/${runId}/gate1`, {
    method: "POST",
    body: JSON.stringify(decision),
  });
}

/** Submit Gate 2 decision */
export async function submitGate2(
  runId: string,
  decision: Gate2Decision
): Promise<RunStatusResponse> {
  return apiFetch(`/api/runs/${runId}/gate2`, {
    method: "POST",
    body: JSON.stringify(decision),
  });
}

/** Submit Gate 3 decision */
export async function submitGate3(
  runId: string,
  decision: Gate3Decision
): Promise<RunStatusResponse> {
  return apiFetch(`/api/runs/${runId}/gate3`, {
    method: "POST",
    body: JSON.stringify(decision),
  });
}

/** Get download URL for a document */
export function getDownloadUrl(
  runId: string,
  docType: "pptx" | "docx" | "xlsx"
): string {
  return `${API_BASE}/api/runs/${runId}/download/${docType}`;
}

/** List all runs */
export async function listRuns(): Promise<{
  runs: { run_id: string; target: string; status: string }[];
}> {
  return apiFetch("/api/runs");
}
