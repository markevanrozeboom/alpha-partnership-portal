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
  submitTermSheetAssumptionsFeedback,
  recalculateTermSheetImpact,
  submitDocumentFeedback,
  recalculateModel,
  rewindToStage,
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
  { key: "term_sheet", label: "Deal Terms", statuses: ["presenting_term_sheet_assumptions", "review_term_sheet_assumptions"], icon: "📋" },
  { key: "documents", label: "Documents", statuses: ["generating_documents", "review_documents"], icon: "📄" },
  { key: "complete", label: "Complete", statuses: ["completed"], icon: "✅" },
];

function getActiveStageIndex(status: PipelineStatus): number {
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].statuses.includes(status)) return i;
  }
  return -1;
}

function isWorkingStatus(status: PipelineStatus): boolean {
  return [
    "researching_country", "researching_education", "strategizing",
    "presenting_assumptions", "building_model",
    "presenting_term_sheet_assumptions", "generating_documents",
  ].includes(status);
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

  // Navigation: which stage the user is viewing (null = current active stage)
  const [viewingStageKey, setViewingStageKey] = useState<string | null>(null);

  // For interactive model recalculation
  const [liveModel, setLiveModel] = useState<FinancialModel | null>(null);
  const [liveAssumptions, setLiveAssumptions] = useState<FinancialAssumption[] | null>(null);

  // Refs to track whether live model/assumptions have been initialised yet,
  // so fetchStatus doesn't need them as dependencies (avoiding interval restarts).
  const liveModelInitRef = useRef(false);
  const liveAssumptionsInitRef = useRef(false);

  // For term sheet deal terms recalculation
  const [termSheetImpactWarning, setTermSheetImpactWarning] = useState<string[] | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await getRunStatus(runId);
      setData(res);
      if (res.financial_model && !liveModelInitRef.current) {
        liveModelInitRef.current = true;
        setLiveModel(res.financial_model);
      }
      if (res.financial_assumptions?.assumptions && !liveAssumptionsInitRef.current) {
        liveAssumptionsInitRef.current = true;
        setLiveAssumptions(res.financial_assumptions.assumptions);
      }
    } catch (err) {
      setError(String(err));
    }
  }, [runId]);

  // Start polling on mount
  useEffect(() => {
    const initialTimer = setTimeout(fetchStatus, 0);
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => {
      clearTimeout(initialTimer);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  // Stop polling at review gates, completed, or error
  useEffect(() => {
    if (data && (isReviewStatus(data.status) || data.status === "completed" || data.status === "error")) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, [data]);

  // Restart polling (called after submitting feedback)
  const restartPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setViewingStageKey(null); // Return to active view when pipeline moves
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
  }, [fetchStatus]);

  // --- Feedback handlers ---

  const handleCountryApprove = useCallback(async () => {
    setLoading(true);
    try {
      await submitCountryReportFeedback(runId, true);
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleCountryRevise = useCallback(async (feedback: string) => {
    setLoading(true);
    try {
      await submitCountryReportFeedback(runId, false, feedback);
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleEducationApprove = useCallback(async () => {
    setLoading(true);
    try {
      await submitEducationReportFeedback(runId, true);
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleEducationRevise = useCallback(async (feedback: string) => {
    setLoading(true);
    try {
      await submitEducationReportFeedback(runId, false, feedback);
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleStrategyApprove = useCallback(async () => {
    setLoading(true);
    try {
      await submitStrategyFeedback(runId, true);
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleStrategyRevise = useCallback(async (feedback: string) => {
    setLoading(true);
    try {
      await submitStrategyFeedback(runId, false, feedback);
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleAssumptionsConfirm = useCallback(async (adjustments: Record<string, number>) => {
    setLoading(true);
    try {
      await submitAssumptionsFeedback(runId, true, adjustments);
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

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
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleTermSheetAssumptionsConfirm = useCallback(async (adjustments: Record<string, number>) => {
    setLoading(true);
    try {
      // First check if changes impact the financial model
      if (Object.keys(adjustments).length > 0) {
        const impact = await recalculateTermSheetImpact(runId, adjustments);
        if (impact.has_financial_impact) {
          setTermSheetImpactWarning(impact.impacted_fields);
          // Update live model if it was recalculated
          if (impact.financial_model) {
            setLiveModel(impact.financial_model);
          }
          if (impact.financial_assumptions?.assumptions) {
            setLiveAssumptions(impact.financial_assumptions.assumptions);
          }
        }
      }
      // Submit the term sheet assumptions feedback
      await submitTermSheetAssumptionsFeedback(runId, true, adjustments);
      setTermSheetImpactWarning(null);
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleDocumentsApprove = useCallback(async () => {
    setLoading(true);
    try {
      await submitDocumentFeedback(runId, true, "investor");
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleDocumentsRevise = useCallback(async (feedback: string) => {
    setLoading(true);
    try {
      await submitDocumentFeedback(runId, false, "investor", feedback);
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  // --- Rewind handlers (go back and re-edit earlier stages) ---

  const handleRewindToAssumptions = useCallback(async () => {
    setLoading(true);
    try {
      await rewindToStage(runId, "review_assumptions");
      // Clear local live model/assumptions so they refresh from server
      setLiveModel(null);
      setLiveAssumptions(null);
      restartPolling(); // sets viewingStageKey to null + restarts polling
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

  const handleRewindToTermSheet = useCallback(async () => {
    setLoading(true);
    try {
      await rewindToStage(runId, "review_term_sheet_assumptions");
      restartPolling();
    } catch (err) { setError(String(err)); }
    setLoading(false);
  }, [runId, restartPolling]);

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

  // Determine which stage's content to show
  const isViewingPrevious = viewingStageKey !== null;
  const viewingStageIndex = isViewingPrevious
    ? STAGES.findIndex((s) => s.key === viewingStageKey)
    : activeStage;

  // Can the user click on a stage? Only completed stages + the active stage
  function canClickStage(stageIndex: number): boolean {
    if (data!.status === "completed") return stageIndex < STAGES.length; // all stages clickable when complete
    return stageIndex < activeStage || stageIndex === activeStage;
  }

  // Check if a stage has viewable content
  function hasStageContent(stageKey: string): boolean {
    switch (stageKey) {
      case "country": return !!data!.country_report;
      case "education": return !!data!.education_report;
      case "strategy": return !!data!.strategy_report;
      case "assumptions": return !!data!.financial_assumptions?.assumptions?.length;
      case "model": return !!data!.financial_model;
      case "term_sheet": return !!data!.term_sheet_assumptions?.assumptions?.length;
      case "documents": return !!(data!.gamma_url || data!.pptx_path || data!.docx_path || data!.xlsx_path || data!.term_sheet_docx_path);
      case "complete": return data!.status === "completed";
      default: return false;
    }
  }

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

      {/* Pipeline Progress — clickable stepper */}
      <div className="max-w-7xl mx-auto px-4 pt-6 pb-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {STAGES.map((stage, i) => {
            const isComplete = i < activeStage || data.status === "completed";
            const isActive = i === activeStage && !isViewingPrevious;
            const isViewing = i === viewingStageIndex && isViewingPrevious;
            const isPending = i > activeStage && data.status !== "completed";
            const clickable = canClickStage(i) && hasStageContent(stage.key);

            return (
              <div key={stage.key} className="flex items-center">
                <button
                  onClick={() => {
                    if (!clickable) return;
                    if (i === activeStage && !isViewingPrevious) {
                      // Clicking the active stage when already viewing it → no-op
                      return;
                    }
                    if (i === activeStage) {
                      // Return to current active view
                      setViewingStageKey(null);
                    } else {
                      setViewingStageKey(stage.key);
                    }
                  }}
                  disabled={!clickable}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all
                    ${clickable ? "cursor-pointer" : "cursor-default"}
                    ${isComplete && !isViewing ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : ""}
                    ${isActive ? "bg-[#006D77]/30 text-[#00d4aa] ring-1 ring-[#006D77]/50" : ""}
                    ${isViewing ? "bg-blue-500/30 text-blue-400 ring-2 ring-blue-500/60" : ""}
                    ${isPending ? "bg-white/5 text-gray-500" : ""}
                  `}
                >
                  <span>{isComplete && !isViewing && !isActive ? "✓" : stage.icon}</span>
                  <span className="hidden sm:inline">{stage.label}</span>
                </button>
                {i < STAGES.length - 1 && (
                  <div className={`w-4 h-px mx-1 ${isComplete ? "bg-emerald-500/40" : "bg-white/10"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* "Viewing previous step" banner */}
      {isViewingPrevious && (
        <div className="max-w-7xl mx-auto px-4 py-2">
          <div className="flex items-center justify-between rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm text-blue-300">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Viewing: <strong>{STAGES[viewingStageIndex]?.label}</strong> (completed)
            </div>
            <button
              onClick={() => setViewingStageKey(null)}
              className="text-sm text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
            >
              Return to current step →
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* Error state */}
        {data.status === "error" && !isViewingPrevious && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6">
            <h2 className="text-lg font-bold text-red-400 mb-2">Pipeline Error</h2>
            <p className="text-gray-300">{data.error_message || "An unknown error occurred."}</p>
            <AgentLog logs={data.agent_logs} />
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEWING PREVIOUS: Country Research (read-only) */}
        {/* ============================================================ */}
        {isViewingPrevious && viewingStageKey === "country" && data.country_report && (
          <div className="space-y-6">
            <ReportViewer
              title="🌍 Country Research Report"
              report={data.country_report}
              downloadUrl={data.country_report_docx_path ? getDownloadUrl(runId, "country_report") : undefined}
            />
            <ReadOnlyBanner stage="Country Research" />
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEWING PREVIOUS: Education Analysis (read-only) */}
        {/* ============================================================ */}
        {isViewingPrevious && viewingStageKey === "education" && data.education_report && (
          <div className="space-y-6">
            <ReportViewer
              title="📚 Education System Analysis"
              report={data.education_report}
              downloadUrl={data.education_report_docx_path ? getDownloadUrl(runId, "education_report") : undefined}
            />
            <ReadOnlyBanner stage="Education Analysis" />
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEWING PREVIOUS: Strategy (read-only) */}
        {/* ============================================================ */}
        {isViewingPrevious && viewingStageKey === "strategy" && data.strategy_report && (
          <div className="space-y-6">
            <ReportViewer
              title="🎯 Market Entry Strategy"
              report={data.strategy_report}
              downloadUrl={data.strategy_report_docx_path ? getDownloadUrl(runId, "strategy_report") : undefined}
            />
            <ReadOnlyBanner stage="Strategy" />
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEWING PREVIOUS: Assumptions (with rewind option) */}
        {/* ============================================================ */}
        {isViewingPrevious && viewingStageKey === "assumptions" && data.financial_assumptions?.assumptions && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">⚙️ Financial Assumptions</h2>
              <RewindButton
                label="Edit & Re-run from Assumptions"
                warning="This will clear the financial model, deal terms, and generated documents. The pipeline will re-run from this point."
                onClick={handleRewindToAssumptions}
                loading={loading}
              />
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 overflow-auto max-h-[70vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.financial_assumptions.assumptions.map((a) => (
                  <div key={a.key} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-white">{a.label}</div>
                      <div className="text-xs text-gray-500">{a.category}</div>
                    </div>
                    <div className="text-sm font-semibold text-[#00d4aa]">
                      {a.unit === "$" ? `$${a.value.toLocaleString()}` :
                       a.unit === "%" ? `${a.value}%` :
                       a.unit === "x" ? `${a.value}x` :
                       `${a.value.toLocaleString()} ${a.unit}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEWING PREVIOUS: Financial Model (with rewind option) */}
        {/* ============================================================ */}
        {isViewingPrevious && viewingStageKey === "model" && data.financial_model && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">📊 Financial Model</h2>
              <RewindButton
                label="Edit Assumptions & Rebuild"
                warning="This will clear the financial model, deal terms, and generated documents. You'll return to the assumption editor."
                onClick={handleRewindToAssumptions}
                loading={loading}
              />
            </div>
            <FinancialSummaryCards model={data.financial_model} />
            <PnLTable model={data.financial_model} />
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEWING PREVIOUS: Term Sheet Deal Terms (with rewind options) */}
        {/* ============================================================ */}
        {isViewingPrevious && viewingStageKey === "term_sheet" && data.term_sheet_assumptions?.assumptions && (
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-2xl font-bold text-white">📋 Deal Term Assumptions</h2>
              <div className="flex gap-2">
                <RewindButton
                  label="Edit Deal Terms & Re-generate"
                  warning="This will clear the generated documents. The pipeline will re-run from deal terms."
                  onClick={handleRewindToTermSheet}
                  loading={loading}
                />
                <RewindButton
                  label="Back to Assumptions"
                  warning="This will clear the financial model, deal terms, and all documents. You'll return to the assumption editor."
                  onClick={handleRewindToAssumptions}
                  loading={loading}
                  variant="secondary"
                />
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 overflow-auto max-h-[70vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.term_sheet_assumptions.assumptions.map((a) => (
                  <div key={a.key} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-white">{a.label}</div>
                      <div className="text-xs text-gray-500">{a.category}</div>
                    </div>
                    <div className="text-sm font-semibold text-[#00d4aa]">
                      {a.unit === "$" ? `$${a.value.toLocaleString()}` :
                       a.unit === "$M" ? `$${a.value}M` :
                       a.unit === "%" ? `${a.value}%` :
                       a.unit === "x" ? `${a.value}x` :
                       `${a.value.toLocaleString()} ${a.unit}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEWING PREVIOUS: Documents (read-only downloads) */}
        {/* ============================================================ */}
        {isViewingPrevious && viewingStageKey === "documents" && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">📄 Generated Documents</h2>
            <DocumentDownloadGrid runId={runId} data={data} />
            <ReadOnlyBanner stage="Documents" />
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEWING PREVIOUS: Complete (read-only) */}
        {/* ============================================================ */}
        {isViewingPrevious && viewingStageKey === "complete" && (
          <CompletedView
            runId={runId}
            data={data}
            onRewindToAssumptions={handleRewindToAssumptions}
            onRewindToTermSheet={handleRewindToTermSheet}
            loading={loading}
          />
        )}

        {/* ============================================================ */}
        {/* ACTIVE CONTENT — only shown when NOT viewing a previous stage */}
        {/* ============================================================ */}
        {!isViewingPrevious && (
          <>
            {/* Working / Loading states */}
            {isWorkingStatus(data.status) && (
              <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-8 text-center space-y-4">
                <div className="animate-pulse">
                  <div className="text-4xl mb-4">
                    {STAGES[activeStage]?.icon || "⏳"}
                  </div>
                  <h2 className="text-xl font-bold">
                    {STAGES[activeStage]?.label || "Processing"}...
                  </h2>
                  <p className="text-gray-400 text-sm mt-2">
                    {data.status === "researching_country" && "Conducting investment-bank quality country research with live data... This may take 2-4 minutes."}
                    {data.status === "researching_education" && "Performing McKinsey-quality education sector deep-dive... This may take 2-4 minutes."}
                    {data.status === "strategizing" && "Developing comprehensive market-entry strategy... This may take 2-4 minutes."}
                    {data.status === "presenting_assumptions" && "Generating financial model assumptions..."}
                    {data.status === "building_model" && "Building the financial model..."}
                    {data.status === "presenting_term_sheet_assumptions" && "Preparing deal term assumptions for your review..."}
                    {data.status === "generating_documents" && "Generating Gamma slide deck, term sheet, investment memo, and financial model... This may take 3-5 minutes."}
                  </p>
                </div>
                <div className="flex justify-center">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#006D77] opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#006D77]" />
                    </span>
                    Pipeline running...
                  </div>
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
            {/* GATE 6: Term Sheet Deal Assumptions Review */}
            {/* ============================================================ */}
            {data.status === "review_term_sheet_assumptions" && data.term_sheet_assumptions?.assumptions && (
              <div className="space-y-6">
                {termSheetImpactWarning && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <div className="flex items-center gap-2 text-amber-400 font-medium mb-2">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      Financial Model Impact Detected
                    </div>
                    <p className="text-sm text-gray-300">
                      Your deal term changes affect the financial model. The following fields were recalculated:
                      <span className="font-mono text-amber-300 ml-1">{termSheetImpactWarning.join(", ")}</span>
                    </p>
                  </div>
                )}
                <TermSheetAssumptionEditor
                  assumptions={data.term_sheet_assumptions.assumptions}
                  onConfirm={handleTermSheetAssumptionsConfirm}
                  loading={loading}
                />
              </div>
            )}

            {/* ============================================================ */}
            {/* GATE 7: Document Review */}
            {/* ============================================================ */}
            {data.status === "review_documents" && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-white">📄 Generated Documents</h2>
                <DocumentDownloadGrid runId={runId} data={data} />
                <FeedbackForm
                  title="Review Documents"
                  description="Review the generated documents. Approve to complete the pipeline, or request changes."
                  onApprove={handleDocumentsApprove}
                  onRequestChanges={handleDocumentsRevise}
                  loading={loading}
                />
                {/* Quick rewind options */}
                <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                  <p className="text-xs text-gray-400 mb-3">Or go back to an earlier stage to make changes:</p>
                  <div className="flex flex-wrap gap-2">
                    <RewindButton
                      label="Edit Financial Assumptions"
                      warning="This will clear the financial model, deal terms, and all documents. You'll return to the assumption editor."
                      onClick={handleRewindToAssumptions}
                      loading={loading}
                      variant="secondary"
                    />
                    <RewindButton
                      label="Edit Deal Terms"
                      warning="This will clear the generated documents. The pipeline will re-run from deal terms."
                      onClick={handleRewindToTermSheet}
                      loading={loading}
                      variant="secondary"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* COMPLETED */}
            {/* ============================================================ */}
            {data.status === "completed" && (
              <CompletedView
                runId={runId}
                data={data}
                onRewindToAssumptions={handleRewindToAssumptions}
                onRewindToTermSheet={handleRewindToTermSheet}
                loading={loading}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Read-only banner shown when viewing a previous step */
function ReadOnlyBanner({ stage }: { stage: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-center text-sm text-gray-400">
      <svg className="h-4 w-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      This is a read-only view of the approved <strong className="text-white">{stage}</strong> step. Click the stepper above to navigate between steps.
    </div>
  );
}

/** Rewind button with confirmation — lets user go back and re-edit */
function RewindButton({
  label,
  warning,
  onClick,
  loading,
  variant = "primary",
}: {
  label: string;
  warning: string;
  onClick: () => void;
  loading: boolean;
  variant?: "primary" | "secondary";
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
        <svg className="h-4 w-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <span className="text-xs text-amber-200 max-w-xs">{warning}</span>
        <button
          onClick={() => { setConfirming(false); onClick(); }}
          disabled={loading}
          className="rounded-md bg-amber-600 hover:bg-amber-700 px-3 py-1 text-xs font-medium text-white whitespace-nowrap transition-colors disabled:opacity-50"
        >
          {loading ? "Rewinding..." : "Confirm"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50
        ${variant === "primary"
          ? "bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 border border-amber-500/30"
          : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10"
        }`}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
      </svg>
      {label}
    </button>
  );
}

/** Financial summary cards (reused in read-only and completed views) */
function FinancialSummaryCards({ model }: { model: FinancialModel }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[
        { label: "Y5 Revenue", value: fmtMoney(model.pnl_projection[4]?.revenue), color: "text-emerald-400" },
        { label: "Y5 EBITDA", value: fmtMoney(model.pnl_projection[4]?.ebitda), color: "text-blue-400" },
        { label: "IRR", value: model.returns_analysis.irr ? `${model.returns_analysis.irr}%` : "—", color: "text-purple-400" },
        { label: "MOIC", value: model.returns_analysis.moic ? `${model.returns_analysis.moic}x` : "—", color: "text-amber-400" },
      ].map((m) => (
        <div key={m.label} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-4 text-center">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{m.label}</div>
          <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Simple P&L table for read-only viewing */
function PnLTable({ model }: { model: FinancialModel }) {
  if (!model.pnl_projection?.length) return null;

  const rows = [
    { label: "Students", key: "students", fmt: (n: number) => n.toLocaleString() },
    { label: "Schools", key: "schools", fmt: (n: number) => n.toLocaleString() },
    { label: "Revenue", key: "revenue", fmt: fmtMoney },
    { label: "COGS", key: "cogs", fmt: fmtMoney },
    { label: "Gross Margin", key: "gross_margin", fmt: fmtMoney },
    { label: "OPEX", key: "opex", fmt: fmtMoney },
    { label: "EBITDA", key: "ebitda", fmt: fmtMoney },
    { label: "Net Income", key: "net_income", fmt: fmtMoney },
    { label: "FCF", key: "free_cash_flow", fmt: fmtMoney },
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#1a1a2e]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">Metric</th>
              {model.pnl_projection.map((p) => (
                <th key={p.year} className="px-4 py-3 text-right text-xs font-semibold text-white uppercase tracking-wider">
                  Year {p.year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5 text-sm font-medium text-gray-300">{row.label}</td>
                {model.pnl_projection.map((p) => (
                  <td key={p.year} className="px-4 py-2.5 text-sm text-gray-400 text-right font-mono">
                    {row.fmt((p as unknown as Record<string, number>)[row.key] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Document download grid (reused in documents gate and completed view) */
function DocumentDownloadGrid({ runId, data }: { runId: string; data: RunStatus }) {
  const isState = data.target_type === "us_state";
  const deckLabel = isState ? "Governor Pitch Deck" : "Investor Deck";
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Slide Deck (Gamma or local fallback) */}
      <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 text-center space-y-3">
        <div className="text-4xl">📊</div>
        <h3 className="font-semibold">{deckLabel}</h3>
        <div className="flex flex-col items-center gap-2">
          {data.gamma_url ? (
            <a
              href={data.gamma_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#006D77] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#005a63]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              View in Gamma
            </a>
          ) : !data.pptx_path && !data.gamma_export_url ? (
            <span className="text-gray-500 text-sm">Not available</span>
          ) : null}
          {(data.pptx_path || data.gamma_export_url) && (
            <a
              href={data.pptx_path ? getDownloadUrl(runId, "pptx") : data.gamma_export_url!}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                data.gamma_url
                  ? "border border-white/10 text-gray-300 hover:bg-white/5"
                  : "bg-[#006D77] text-white hover:bg-[#005a63]"
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download PPTX
            </a>
          )}
        </div>
      </div>

      {/* Other documents */}
      {[
        { label: "Term Sheet", type: "term_sheet", icon: "📋", path: data.term_sheet_docx_path },
        { label: "Investment Memorandum", type: "docx", icon: "📝", path: data.docx_path },
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
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </a>
          ) : (
            <span className="text-gray-500 text-sm">Not available</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Completed view with all downloads */
function CompletedView({
  runId,
  data,
  onRewindToAssumptions,
  onRewindToTermSheet,
  loading,
}: {
  runId: string;
  data: RunStatus;
  onRewindToAssumptions?: () => void;
  onRewindToTermSheet?: () => void;
  loading?: boolean;
}) {
  const [expandedReport, setExpandedReport] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center space-y-4">
        <div className="text-5xl">🎉</div>
        <h2 className="text-2xl font-bold text-emerald-400">Pipeline Complete</h2>
        <p className="text-gray-400 max-w-lg mx-auto">
          All deliverables for <strong className="text-white">{data.target}</strong> have been generated
          and approved. Download your documents below.
        </p>
      </div>

      {/* Rewind options */}
      {(onRewindToAssumptions || onRewindToTermSheet) && (
        <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            <h3 className="text-sm font-semibold text-white">Want to make changes?</h3>
          </div>
          <p className="text-xs text-gray-400">
            Go back to an earlier stage to adjust assumptions or deal terms. The pipeline will regenerate
            all downstream outputs from that point.
          </p>
          <div className="flex flex-wrap gap-2">
            {onRewindToAssumptions && (
              <RewindButton
                label="Edit Financial Assumptions"
                warning="This will clear the financial model, deal terms, and all documents. You'll return to the assumption editor."
                onClick={onRewindToAssumptions}
                loading={loading || false}
              />
            )}
            {onRewindToTermSheet && (
              <RewindButton
                label="Edit Deal Terms"
                warning="This will clear the generated documents. The pipeline will re-run from deal terms."
                onClick={onRewindToTermSheet}
                loading={loading || false}
              />
            )}
          </div>
        </div>
      )}

      {/* All Research Reports with expand/collapse */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold flex items-center gap-2">
          <span>📋</span> Research Reports
        </h3>
        <p className="text-sm text-gray-400">Click to expand and read in-app, or download as DOCX.</p>

        {[
          { key: "country", label: "🌍 Country Research Report", report: data.country_report, docxPath: data.country_report_docx_path, type: "country_report" },
          { key: "education", label: "📚 Education System Analysis", report: data.education_report, docxPath: data.education_report_docx_path, type: "education_report" },
          { key: "strategy", label: "🎯 Market Entry Strategy", report: data.strategy_report, docxPath: data.strategy_report_docx_path, type: "strategy_report" },
        ].map((item) => (
          <div key={item.key} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 overflow-hidden">
            <button
              onClick={() => setExpandedReport(expandedReport === item.key ? null : item.key)}
              className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex items-center gap-3">
                <h4 className="font-semibold text-white">{item.label}</h4>
                {item.report && (
                  <span className="text-xs text-gray-500">~{item.report.split(/\s+/).length.toLocaleString()} words</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {item.docxPath && (
                  <a
                    href={getDownloadUrl(runId, item.type)}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20 transition-colors"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    DOCX
                  </a>
                )}
                <svg
                  className={`h-5 w-5 text-gray-400 transition-transform ${expandedReport === item.key ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {expandedReport === item.key && item.report && (
              <div className="border-t border-white/10">
                <ReportViewer title="" report={item.report} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Primary Deliverables (Term Sheet + Deck) */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold flex items-center gap-2">
          <span>⭐</span> Primary Deliverables
        </h3>
        <p className="text-sm text-gray-400">These are the two key documents to present to the country/state.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Slide Deck (Gamma or local fallback) */}
          <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 text-center space-y-3">
            <div className="text-4xl">📊</div>
            <div className="h-1 w-16 mx-auto rounded-full bg-gradient-to-r from-purple-500 to-blue-500" />
            <h4 className="font-semibold text-lg">
              {data.target_type === "us_state" ? "Governor Pitch Deck" : "Investor Deck"}
            </h4>
            <div className="flex flex-col items-center gap-2">
              {data.gamma_url ? (
                <a href={data.gamma_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#006D77] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#005a63] transition-colors">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View in Gamma
                </a>
              ) : !data.pptx_path && !data.gamma_export_url ? (
                <span className="text-gray-500 text-sm">Not available</span>
              ) : null}
              {(data.pptx_path || data.gamma_export_url) && (
                <a href={data.pptx_path ? getDownloadUrl(runId, "pptx") : data.gamma_export_url!}
                  className={`inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors ${
                    data.gamma_url
                      ? "border border-white/10 text-gray-300 hover:bg-white/5 text-xs px-4 py-2"
                      : "bg-[#006D77] text-white hover:bg-[#005a63]"
                  }`}>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>
              )}
            </div>
          </div>

          {/* Term Sheet */}
          <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 text-center space-y-3">
            <div className="text-4xl">📋</div>
            <div className="h-1 w-16 mx-auto rounded-full bg-gradient-to-r from-amber-500 to-orange-500" />
            <h4 className="font-semibold text-lg">Term Sheet (DOCX)</h4>
            {data.term_sheet_docx_path ? (
              <a href={getDownloadUrl(runId, "term_sheet")}
                className="inline-flex items-center gap-2 rounded-lg bg-[#006D77] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#005a63] transition-colors">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </a>
            ) : <span className="text-gray-500 text-sm">Not available</span>}
          </div>
        </div>
      </div>

      {/* Supporting Documents */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold flex items-center gap-2">
          <span>📦</span> Supporting Documents
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: "Investment Memorandum (DOCX)", type: "docx", path: data.docx_path, accent: "from-blue-500 to-teal-500" },
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

      {/* Financial Summary */}
      {data.financial_model && (
        <div className="space-y-4">
          <h3 className="text-xl font-bold">Financial Summary</h3>
          <FinancialSummaryCards model={data.financial_model} />
        </div>
      )}

      <AgentLog logs={data.agent_logs} />
    </div>
  );
}

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
    presenting_term_sheet_assumptions: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Loading Deal Terms..." },
    review_term_sheet_assumptions: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Review Deal Terms" },
    generating_documents: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Generating..." },
    review_documents: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Review Documents" },
    completed: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Complete" },
    error: { bg: "bg-red-500/20", text: "text-red-400", label: "Error" },
  };

  const c = config[status] || config.pending;
  const isWorking = ["researching_country", "researching_education", "strategizing",
    "presenting_assumptions", "building_model",
    "presenting_term_sheet_assumptions", "generating_documents"].includes(status);

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${c.bg} ${c.text}`}>
      {isWorking && (
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

/** Term Sheet Assumption Editor — similar to financial assumptions but for deal terms */
function TermSheetAssumptionEditor({
  assumptions,
  onConfirm,
  loading,
}: {
  assumptions: FinancialAssumption[];
  onConfirm: (adjustments: Record<string, number>) => void;
  loading: boolean;
}) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const v: Record<string, number> = {};
    assumptions.forEach((a) => { v[a.key] = a.value; });
    return v;
  });

  const handleChange = useCallback((key: string, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  const adjustments = (() => {
    const adj: Record<string, number> = {};
    assumptions.forEach((a) => {
      if (values[a.key] !== a.value) adj[a.key] = values[a.key];
    });
    return adj;
  })();

  const grouped = (() => {
    const g: Record<string, FinancialAssumption[]> = {};
    assumptions.forEach((a) => {
      if (!g[a.category]) g[a.category] = [];
      g[a.category].push(a);
    });
    return g;
  })();

  const DEAL_CATEGORY_LABELS: Record<string, string> = {
    deal_structure: "🤝 Deal Structure",
    ip_fees: "💎 IP & Licensing Fees",
    revenue_share: "💰 Revenue Sharing",
    commitments: "📋 Country Commitments",
    timeline: "📅 Timeline & Milestones",
    pricing: "💰 Pricing",
    scale: "📈 Scale & Growth",
    costs: "🏗️ Cost Structure",
    fees: "🤝 Alpha Fee Structure",
    returns: "📊 Returns & Valuation",
  };

  const categoryOrder = Object.keys(grouped);
  const hasChanges = Object.keys(adjustments).length > 0;

  function formatValue(value: number, unit: string): string {
    if (unit === "$M") return `$${value.toLocaleString()}M`;
    if (unit === "$") return `$${value.toLocaleString()}`;
    if (unit === "%") return `${value}%`;
    if (unit === "x") return `${value}x`;
    if (unit === "students") return value.toLocaleString();
    if (unit === "years") return `${value} yrs`;
    return value.toLocaleString();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">📋 Deal Term Assumptions</h2>
          <p className="text-sm text-gray-400 mt-1">
            Review and adjust the key deal terms for the Heads of Terms / Term Sheet.
            Changes to financial terms will automatically recalculate the financial model.
          </p>
        </div>
        {hasChanges && (
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-400">
            {Object.keys(adjustments).length} changed
          </span>
        )}
      </div>

      {categoryOrder.map((cat) => {
        const items = grouped[cat];
        if (!items || items.length === 0) return null;
        return (
          <div key={cat} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-5 space-y-4">
            <h3 className="text-lg font-semibold text-white">
              {DEAL_CATEGORY_LABELS[cat] || cat}
            </h3>
            <div className="space-y-5">
              {items.map((a) => {
                const isChanged = values[a.key] !== a.value;
                return (
                  <div key={a.key} className={`rounded-lg p-3 transition-colors ${isChanged ? "bg-amber-500/5 ring-1 ring-amber-500/20" : ""}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-200">{a.label}</span>
                        {a.locked && (
                          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400 uppercase tracking-wider">
                            locked
                          </span>
                        )}
                        {isChanged && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                            modified
                          </span>
                        )}
                      </div>
                      <span className={`text-lg font-bold tabular-nums ${isChanged ? "text-amber-400" : "text-white"}`}>
                        {formatValue(values[a.key], a.unit)}
                      </span>
                    </div>
                    {a.description && (
                      <p className="text-xs text-gray-500 mb-2">{a.description}</p>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-16 text-right tabular-nums">
                        {formatValue(a.min_val, a.unit)}
                      </span>
                      <input
                        type="range"
                        value={values[a.key]}
                        onChange={(e) => !a.locked && handleChange(a.key, Number(e.target.value))}
                        min={a.min_val}
                        max={a.max_val}
                        step={a.step}
                        disabled={a.locked}
                        className={`flex-1 accent-[#006D77] ${a.locked ? "opacity-50" : ""}`}
                      />
                      <span className="text-xs text-gray-500 w-16 tabular-nums">
                        {formatValue(a.max_val, a.unit)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex gap-3">
        <button
          onClick={() => onConfirm(adjustments)}
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? "Processing Deal Terms..." : "Confirm Deal Terms & Generate Documents"}
        </button>
        {hasChanges && (
          <button
            onClick={() => {
              const reset: Record<string, number> = {};
              assumptions.forEach((a) => { reset[a.key] = a.value; });
              setValues(reset);
            }}
            className="border border-white/20 text-gray-400 hover:text-white px-4 py-2.5 rounded-lg transition-colors"
          >
            Reset to Defaults
          </button>
        )}
      </div>
    </div>
  );
}

function fmtMoney(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
