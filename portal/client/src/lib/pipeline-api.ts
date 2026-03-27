// FastAPI backend URL — the pipeline service
export const PIPELINE_API = import.meta.env.VITE_PIPELINE_API || "https://alpha-pipeline-api.onrender.com";

export const GATE_APPROVALS: Record<string, { endpoint: string; body: object }> = {
  review_country_report: { endpoint: "feedback/country-report", body: { approved: true } },
  review_education_report: { endpoint: "feedback/education-report", body: { approved: true } },
  review_strategy: { endpoint: "feedback/strategy", body: { approved: true } },
  review_assumptions: { endpoint: "feedback/assumptions", body: { approved: true, adjustments: {} } },
  review_model: { endpoint: "feedback/model", body: { locked: true } },
  review_term_sheet_assumptions: { endpoint: "feedback/term-sheet-assumptions", body: { approved: true, adjustments: {} } },
  review_documents: { endpoint: "feedback/documents", body: { approved: true } },
};

export const STAGE_LABELS: Record<string, string> = {
  pending: "Initializing...",
  researching_country: "Researching country profile...",
  review_country_report: "Processing country research...",
  researching_education: "Analyzing education system...",
  review_education_report: "Processing education analysis...",
  strategizing: "Developing partnership strategy...",
  review_strategy: "Processing strategy...",
  presenting_assumptions: "Building financial assumptions...",
  review_assumptions: "Processing assumptions...",
  building_model: "Computing financial model...",
  review_model: "Processing financial model...",
  presenting_term_sheet_assumptions: "Preparing term sheet...",
  review_term_sheet_assumptions: "Processing term sheet...",
  generating_documents: "Generating investor deck & documents...",
  review_documents: "Finalizing documents...",
  completed: "Complete",
  error: "Error",
};

export const STAGE_ORDER = [
  "pending", "researching_country", "review_country_report",
  "researching_education", "review_education_report",
  "strategizing", "review_strategy",
  "presenting_assumptions", "review_assumptions",
  "building_model", "review_model",
  "presenting_term_sheet_assumptions", "review_term_sheet_assumptions",
  "generating_documents", "review_documents", "completed",
];

export async function createPipelineRun(target: string): Promise<string> {
  const res = await fetch(`${PIPELINE_API}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw new Error(`Failed to create run: ${res.status}`);
  const data = await res.json();
  return data.run_id;
}

export async function getPipelineRun(runId: string) {
  const res = await fetch(`${PIPELINE_API}/api/runs/${runId}`);
  if (!res.ok) throw new Error(`Failed to get run: ${res.status}`);
  return res.json();
}

export async function approveGate(runId: string, status: string): Promise<boolean> {
  const gate = GATE_APPROVALS[status];
  if (!gate) return false;
  try {
    const res = await fetch(`${PIPELINE_API}/api/runs/${runId}/${gate.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gate.body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
