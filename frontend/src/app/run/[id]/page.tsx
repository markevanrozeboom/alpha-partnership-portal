"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getRunStatus,
  submitCountryReportFeedback,
  submitEducationReportFeedback,
  submitStrategyFeedback,
  submitAssumptionsFeedback,
  submitModelFeedback,
  submitDocumentFeedback,
  recalculateModel,
  getDownloadUrl,
  type RunStatus,
  type PipelineStatus,
  type FinancialModel,
  type FinancialAssumption,
} from "@/lib/api";
import { ReportViewer } from "@/components/report-viewer";
import { FeedbackForm } from "@/components/feedback-form";
import { AssumptionEditor } from "@/components/assumption-editor";
import { FinancialModelViewer } from "@/components/financial-model-viewer";

// ---------------------------------------------------------------------------
// Pipeline stages definition
// ---------------------------------------------------------------------------

interface Stage {
  key: string;
  label: string;
  statuses: PipelineStatus[];
  icon: string;
}

const STAGES: Stage[] = [
  { key: "country", label: "Country Research", statuses: ["researching_country", "review_country_report"], icon: "🌍" },
  { key: "education", label: "Education Analysis", statuses: ["researching_education", "review_education_report"], icon: "📚" },
  { key: "strategy", label: "Strategy", statuses: ["strategizing", "review_strategy"], icon: "🎯" },
  { key: "assumptions", label: "Assumptions", statuses: ["presenting_assumptions", "review_assumptions"], icon: "⚙️" },
  { key: "model", label: "Financial Model", statuses: ["building_model", "review_model"], icon: "📊" },
  { key: "documents", label: "Documents", statuses: ["generating_documents", "review_documents"], icon: "📄" },
  { key: "complete", label: "Complete", statuses: ["completed"], icon: "✅" },
];

function getActiveStageIndex(status: PipelineStatus): number {
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].statuses.includes(status)) return i;
  }
  return -1;
}

function isReviewStatus(status: PipelineStatus): boolean {
  return status.startsWith("review_");
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function RunPage() {
  const params = useParams();
  const runId = params.id as string;

  const [data, setData] = useState<RunStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For interactive model recalculation
  const [liveModel, setLiveModel] = useState<FinancialModel | null>(null);
  const [liveAssumptions, setLiveAssumptions] = useState<FinancialAssumption[] | null>(null);

  // When true, we've submitted feedback and are waiting for the status to change.
  // Prevents the "stop polling on review status" logic from firing prematurely.
  const waitingForTransition = useRef(false);
  const lastSubmittedStatus = useRef<PipelineStatus | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await getRunStatus(runId);
      setData(res);
      if (res.financial_model && !liveModel) setLiveModel(res.financial_model);
      if (res.financial_assumptions?.assumptions && !liveAssumptions) setLiveAssumptions(res.financial_assumptions.assumptions);

      // If we were waiting for a transition and the status has changed, clear the flag
      if (waitingForTransition.current && lastSubmittedStatus.current && res.status !== lastSubmittedStatus.current) {
        waitingForTransition.current = false;
        lastSubmittedStatus.current = null;
      }
    } catch (err) {
      setError(String(err));
    }
  }, [runId, liveModel, liveAssumptions]);

  // Poll while pipeline is running
  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  // Stop polling when at a review gate or completed — but NOT if we just submitted feedback
  useEffect(() => {
    if (waitingForTransition.current) return; // don't stop polling while waiting for backend
    if (data && (isReviewStatus(data.status) || data.status === "completed" || data.status === "error")) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, [data]);

  // Resume polling after submitting feedback
  const startPolling = useCallback((currentStatus: PipelineStatus) => {
    waitingForTransition.current = true;
    lastSubmittedStatus.current = currentStatus;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchStatus, 3000);
  }, [fetchStatus]);

  // --- Feedback handlers ---

  const handleCountryApprove = useCallback(async () => {
    setLoading(true);
    try {
      await submitCountryReportFeedback(runId, true);
      startPolling("review_country_report");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  const handleCountryRevise = useCallback(async (feedback: string) => {
    setLoading(true);
    try {
      await submitCountryReportFeedback(runId, false, feedback);
      startPolling("review_country_report");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  const handleEducationApprove = useCallback(async () => {
    setLoading(true);
    try {
      await submitEducationReportFeedback(runId, true);
      startPolling("review_education_report");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  const handleEducationRevise = useCallback(async (feedback: string) => {
    setLoading(true);
    try {
      await submitEducationReportFeedback(runId, false, feedback);
      startPolling("review_education_report");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  const handleStrategyApprove = useCallback(async () => {
    setLoading(true);
    try {
      await submitStrategyFeedback(runId, true);
      startPolling("review_strategy");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  const handleStrategyRevise = useCallback(async (feedback: string) => {
    setLoading(true);
    try {
      await submitStrategyFeedback(runId, false, feedback);
      startPolling("review_strategy");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  const handleAssumptionsConfirm = useCallback(async (adjustments: Record<string, number>) => {
    setLoading(true);
    try {
      await submitAssumptionsFeedback(runId, true, adjustments);
      startPolling("review_assumptions");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  const handleModelRecalculate = useCallback(async (adjustments: Record<string, number>) => {
    setLoading(true);
    try {
      const result = await recalculateModel(runId, adjustments);
      setLiveModel(result.financial_model);
      setLiveAssumptions(result.financial_assumptions.assumptions);
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId]);

  const handleModelLock = useCallback(async (adjustments: Record<string, number>) => {
    setLoading(true);
    try {
      await submitModelFeedback(runId, true, adjustments);
      startPolling("review_model");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  const handleDocumentsApprove = useCallback(async () => {
    setLoading(true);
    try {
      await submitDocumentFeedback(runId, true, "investor");
      startPolling("review_documents");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  const handleDocumentsRevise = useCallback(async (feedback: string) => {
    setLoading(true);
    try {
      await submitDocumentFeedback(runId, false, "investor", feedback);
      startPolling("review_documents");
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, startPolling]);

  // --- Render ---

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-2 border-[#006D77] border-t-transparent rounded-full mx-auto" />
          <p className="text-gray-400">Loading pipeline...</p>
        </div>
      </div>
    );
  }

  const activeStage = getActiveStageIndex(data.status);

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0d0d1a]/80 backdrop-blur-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">
              ← Back
            </Link>
            <div>
              <h1 className="text-lg font-bold">{data.target}</h1>
              <p className="text-xs text-gray-500">
                {data.target_type === "us_state" ? "US State" : "Sovereign Nation"}
                {data.tier && ` • Tier ${data.tier}`}
              </p>
            </div>
          </div>
          <StatusBadge status={data.status} />
        </div>
      </header>

      {/* Pipeline Progress */}
      <div className="max-w-7xl mx-auto px-4 pt-6 pb-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {STAGES.map((stage, i) => {
            const isComplete = i < activeStage || data.status === "completed";
            const isActive = i === activeStage;
            const isPending = i > activeStage;

            return (
              <div key={stage.key} className="flex items-center">
                <div
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all
                    ${isComplete ? "bg-emerald-500/20 text-emerald-400" : ""}
                    ${isActive ? "bg-[#006D77]/30 text-[#00d4aa] ring-1 ring-[#006D77]/50" : ""}
                    ${isPending ? "bg-white/5 text-gray-500" : ""}
                  `}
                >
                  <span>{isComplete ? "✓" : stage.icon}</span>
                  <span className="hidden sm:inline">{stage.label}</span>
                </div>
                {i < STAGES.length - 1 && (
                  <div className={`w-4 h-px mx-1 ${isComplete ? "bg-emerald-500/40" : "bg-white/10"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* Error state */}
        {data.status === "error" && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6">
            <h2 className="text-lg font-bold text-red-400 mb-2">Pipeline Error</h2>
            <p className="text-gray-300">{data.error_message || "An unknown error occurred."}</p>
          </div>
        )}

        {/* Working / Loading states */}
        {!isReviewStatus(data.status) && data.status !== "completed" && data.status !== "error" && (
          <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-8 text-center space-y-4">
            <div className="animate-pulse">
              <div className="text-4xl mb-4">
                {STAGES[activeStage]?.icon || "⏳"}
              </div>
              <h2 className="text-xl font-bold">
                {STAGES[activeStage]?.label || "Processing"}...
              </h2>
              <p className="text-gray-400 text-sm mt-2">
                {data.status === "researching_country" && "Conducting investment-bank quality country research with live data..."}
                {data.status === "researching_education" && "Performing McKinsey-quality education sector deep-dive..."}
                {data.status === "strategizing" && "Developing comprehensive market-entry strategy..."}
                {data.status === "presenting_assumptions" && "Generating financial model assumptions..."}
                {data.status === "building_model" && "Building the financial model..."}
                {data.status === "generating_documents" && "Generating investor deck, proposal, and spreadsheet..."}
              </p>
            </div>
            <AgentLog logs={data.agent_logs} />
          </div>
        )}

        {/* ============================================================ */}
        {/* GATE 1: Country Research Report Review */}
        {/* ============================================================ */}
        {data.status === "review_country_report" && data.country_report && (
          <div className="space-y-6">
            <ReportViewer
              title="🌍 Country Research Report"
              report={data.country_report}
              downloadUrl={data.country_report_docx_path ? getDownloadUrl(runId, "country_report") : undefined}
            />
            <FeedbackForm
              title="Review Country Research"
              description="Review the country research report above. Approve to proceed to education analysis, or request changes."
              onApprove={handleCountryApprove}
              onRequestChanges={handleCountryRevise}
              loading={loading}
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* GATE 2: Education Report Review */}
        {/* ============================================================ */}
        {data.status === "review_education_report" && data.education_report && (
          <div className="space-y-6">
            <ReportViewer
              title="📚 Education System Analysis"
              report={data.education_report}
              downloadUrl={data.education_report_docx_path ? getDownloadUrl(runId, "education_report") : undefined}
            />
            <FeedbackForm
              title="Review Education Analysis"
              description="Review the education system analysis. Approve to proceed to strategy development, or request changes."
              onApprove={handleEducationApprove}
              onRequestChanges={handleEducationRevise}
              loading={loading}
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* GATE 3: Strategy Report Review */}
        {/* ============================================================ */}
        {data.status === "review_strategy" && data.strategy_report && (
          <div className="space-y-6">
            <ReportViewer
              title="🎯 Market Entry Strategy"
              report={data.strategy_report}
              downloadUrl={data.strategy_report_docx_path ? getDownloadUrl(runId, "strategy_report") : undefined}
            />
            <FeedbackForm
              title="Review Strategy"
              description="Review the market-entry strategy. Approve to proceed to financial modelling, or request changes."
              onApprove={handleStrategyApprove}
              onRequestChanges={handleStrategyRevise}
              loading={loading}
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* GATE 4: Financial Assumptions Review */}
        {/* ============================================================ */}
        {data.status === "review_assumptions" && data.financial_assumptions?.assumptions && (
          <AssumptionEditor
            assumptions={data.financial_assumptions.assumptions}
            onConfirm={handleAssumptionsConfirm}
            loading={loading}
          />
        )}

        {/* ============================================================ */}
        {/* GATE 5: Financial Model Review */}
        {/* ============================================================ */}
        {data.status === "review_model" && (liveModel || data.financial_model) && (
          <FinancialModelViewer
            model={liveModel || data.financial_model!}
            assumptions={liveAssumptions || data.financial_assumptions?.assumptions || []}
            onLock={handleModelLock}
            onRecalculate={handleModelRecalculate}
            loading={loading}
          />
        )}

        {/* ============================================================ */}
        {/* GATE 6: Document Review */}
        {/* ============================================================ */}
        {data.status === "review_documents" && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">📄 Generated Documents</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: "Investor Deck", type: "pptx", icon: "📊", path: data.pptx_path },
                { label: "Proposal Document", type: "docx", icon: "📝", path: data.docx_path },
                { label: "Financial Model", type: "xlsx", icon: "📈", path: data.xlsx_path },
              ].map((doc) => (
                <div key={doc.type} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 text-center space-y-3">
                  <div className="text-4xl">{doc.icon}</div>
                  <h3 className="font-semibold">{doc.label}</h3>
                  {doc.path ? (
                    <a
                      href={getDownloadUrl(runId, doc.type)}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#006D77] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#005a63]"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="text-gray-500 text-sm">Not available</span>
                  )}
                </div>
              ))}
            </div>
            <FeedbackForm
              title="Review Documents"
              description="Review the generated documents. Approve to complete the pipeline, or request changes."
              onApprove={handleDocumentsApprove}
              onRequestChanges={handleDocumentsRevise}
              loading={loading}
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* COMPLETED */}
        {/* ============================================================ */}
        {data.status === "completed" && (
          <div className="space-y-8">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center space-y-4">
              <div className="text-5xl">🎉</div>
              <h2 className="text-2xl font-bold text-emerald-400">Pipeline Complete</h2>
              <p className="text-gray-400 max-w-lg mx-auto">
                All deliverables for <strong className="text-white">{data.target}</strong> have been generated
                and approved. Download your documents below.
              </p>
            </div>

            {/* All reports */}
            <div className="space-y-6">
              <h3 className="text-xl font-bold">Research Reports</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: "Country Research", type: "country_report", path: data.country_report_docx_path },
                  { label: "Education Analysis", type: "education_report", path: data.education_report_docx_path },
                  { label: "Strategy Report", type: "strategy_report", path: data.strategy_report_docx_path },
                ].map((doc) => (
                  <div key={doc.type} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-5 text-center space-y-3">
                    <h4 className="font-semibold">{doc.label}</h4>
                    {doc.path ? (
                      <a href={getDownloadUrl(runId, doc.type)}
                        className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition-colors">
                        Download DOCX
                      </a>
                    ) : <span className="text-gray-500 text-sm">Not available</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-xl font-bold">Final Deliverables</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: "Investor Deck (PPTX)", type: "pptx", path: data.pptx_path, accent: "from-purple-500 to-blue-500" },
                  { label: "Proposal Document (DOCX)", type: "docx", path: data.docx_path, accent: "from-blue-500 to-teal-500" },
                  { label: "Financial Model (XLSX)", type: "xlsx", path: data.xlsx_path, accent: "from-emerald-500 to-green-500" },
                ].map((doc) => (
                  <div key={doc.type} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 text-center space-y-3">
                    <div className={`h-1 w-16 mx-auto rounded-full bg-gradient-to-r ${doc.accent}`} />
                    <h4 className="font-semibold text-lg">{doc.label}</h4>
                    {doc.path ? (
                      <a href={getDownloadUrl(runId, doc.type)}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#006D77] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#005a63] transition-colors">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                    ) : <span className="text-gray-500 text-sm">Not available</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Show financial model summary at completion */}
            {data.financial_model && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold">Financial Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Y5 Revenue", value: fmtMoney(data.financial_model.pnl_projection[4]?.revenue), color: "text-emerald-400" },
                    { label: "Y5 EBITDA", value: fmtMoney(data.financial_model.pnl_projection[4]?.ebitda), color: "text-blue-400" },
                    { label: "IRR", value: data.financial_model.returns_analysis.irr ? `${data.financial_model.returns_analysis.irr}%` : "—", color: "text-purple-400" },
                    { label: "MOIC", value: data.financial_model.returns_analysis.moic ? `${data.financial_model.returns_analysis.moic}x` : "—", color: "text-amber-400" },
                  ].map((m) => (
                    <div key={m.label} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-4 text-center">
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{m.label}</div>
                      <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <AgentLog logs={data.agent_logs} />
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: PipelineStatus }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: "bg-gray-500/20", text: "text-gray-400", label: "Pending" },
    researching_country: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Researching..." },
    review_country_report: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Review Required" },
    researching_education: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Researching..." },
    review_education_report: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Review Required" },
    strategizing: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Strategizing..." },
    review_strategy: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Review Required" },
    presenting_assumptions: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Loading..." },
    review_assumptions: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Validate Assumptions" },
    building_model: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Building Model..." },
    review_model: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Review Model" },
    generating_documents: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Generating..." },
    review_documents: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Review Documents" },
    completed: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Complete" },
    error: { bg: "bg-red-500/20", text: "text-red-400", label: "Error" },
  };

  const c = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${c.bg} ${c.text}`}>
      {(status.includes("researching") || status.includes("building") || status.includes("generating") || status === "strategizing") && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      )}
      {c.label}
    </span>
  );
}

function AgentLog({ logs }: { logs: string[] }) {
  if (!logs || logs.length === 0) return null;
  return (
    <details className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-4">
      <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300">
        Agent Log ({logs.length} entries)
      </summary>
      <div className="mt-3 space-y-1 max-h-48 overflow-y-auto text-xs font-mono text-gray-500">
        {logs.map((log, i) => (
          <div key={i} className={log.includes("ERROR") ? "text-red-400" : ""}>{log}</div>
        ))}
      </div>
    </details>
  );
}

function fmtMoney(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
