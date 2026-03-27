import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Loader2, FileText, Presentation, Download,
  RefreshCw, ExternalLink, FileDown, Globe,
} from "lucide-react";
import { PIPELINE_API, PORTAL_API } from "@/lib/api-config";
import type { PipelineStatus, CountryContext } from "@shared/schema";

interface BackendRunResponse {
  status: PipelineStatus;
  target?: string;
  gamma_url?: string | null;
  gamma_export_url?: string | null;
  country_profile?: CountryContext | null;
  financial_model?: Record<string, unknown> | null;
  error_message?: string | null;
  agent_logs?: string[];
}

interface TermSheetResult {
  termSheetHtml: string;
  pitchDeckHtml: string;
  termSheetDocxBase64: string;
  context: CountryContext;
}

// ─── Stage labels — NO internal jargon, NO tool names ─────────────────────
const STAGE_LABELS: Record<string, string> = {
  pending: "Preparing your request...",
  researching_country: "Researching country profile...",
  review_country_report: "Compiling research findings...",
  researching_education: "Analyzing education landscape...",
  review_education_report: "Synthesizing education data...",
  strategizing: "Crafting partnership strategy...",
  review_strategy: "Refining strategic approach...",
  presenting_assumptions: "Modeling financial framework...",
  review_assumptions: "Optimizing financial parameters...",
  building_model: "Building financial projections...",
  review_model: "Validating financial model...",
  presenting_term_sheet_assumptions: "Structuring term sheet...",
  review_term_sheet_assumptions: "Finalizing term sheet structure...",
  generating_documents: "Generating partnership proposal & term sheet...",
  review_documents: "Preparing final documents...",
  completed: "Complete",
  error: "Error",
};

const GATE_APPROVALS: Record<string, { endpoint: string; body: object }> = {
  review_country_report: { endpoint: "feedback/country-report", body: { approved: true } },
  review_education_report: { endpoint: "feedback/education-report", body: { approved: true } },
  review_strategy: { endpoint: "feedback/strategy", body: { approved: true } },
  review_assumptions: { endpoint: "feedback/assumptions", body: { approved: true, adjustments: {} } },
  review_model: { endpoint: "feedback/model", body: { locked: true } },
  review_term_sheet_assumptions: { endpoint: "feedback/term-sheet-assumptions", body: { approved: true, adjustments: {} } },
  review_documents: { endpoint: "feedback/documents", body: { approved: true } },
};

const STAGE_ORDER: PipelineStatus[] = [
  "pending", "researching_country", "review_country_report",
  "researching_education", "review_education_report",
  "strategizing", "review_strategy",
  "presenting_assumptions", "review_assumptions",
  "building_model", "review_model",
  "presenting_term_sheet_assumptions", "review_term_sheet_assumptions",
  "generating_documents", "review_documents", "completed",
];

const STAGE_MILESTONES: { status: PipelineStatus; label: string }[] = [
  { status: "researching_country", label: "Research" },
  { status: "strategizing", label: "Strategy" },
  { status: "building_model", label: "Financials" },
  { status: "generating_documents", label: "Documents" },
  { status: "completed", label: "Complete" },
];

// ─── Clean agent logs: strip timestamps, filter out internal messages ─────
function cleanLog(raw: string): string | null {
  // Strip ISO timestamp prefix
  let cleaned = raw.replace(/^\[[\d\-T:.]+\]\s*/, "");
  // Filter out internal messages that shouldn't be shown to users
  const blacklist = [
    /user approved/i,
    /moving to \w+/i,
    /type:\s*sovereign/i,
    /type:\s*us_state/i,
    /no tiers/i,
    /unified model/i,
    /gamma/i,
    /pipeline started/i,
    /starting combined/i,
    /re-running/i,
    /feedback/i,
    /gate/i,
    /revenue:/i,
    /IRR:/i,
    /financial model built/i,
    /Y\d+ revenue/i,
    /margin/i,
    /language qa/i,
    /auto-fixed/i,
    /issue.*auto/i,
    /building financial/i,
  ];
  for (const pattern of blacklist) {
    if (pattern.test(cleaned)) return null;
  }
  return cleaned;
}

function downloadHtml(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function openInNewTab(html: string) {
  const blob = new Blob([html], { type: "text/html" });
  window.open(URL.createObjectURL(blob), "_blank");
}

export default function PipelineResultPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const runId = params.id;
  const [activeTab, setActiveTab] = useState("termsheet");
  const approvedGates = useRef(new Set<string>());
  const [termSheetData, setTermSheetData] = useState<TermSheetResult | null>(null);
  const [termSheetLoading, setTermSheetLoading] = useState(false);
  const termSheetRequested = useRef(false);

  // Use Render portal if available (returns term sheet HTML), else FastAPI directly
  const usePortal = !!PORTAL_API;
  const pollUrl = usePortal
    ? `${PORTAL_API}/api/pipeline-runs/${runId}`
    : `${PIPELINE_API}/api/runs/${runId}`;

  const { data: rawData, isLoading, error } = useQuery<any>({
    queryKey: ["pipeline-run", runId],
    queryFn: async () => {
      const res = await fetch(pollUrl);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 3000;
      const s = d.pipelineStatus || d.status;
      return (s === "completed" || s === "error") ? false : 3000;
    },
  });

  // Normalize data shape between Render portal and FastAPI responses
  const data: BackendRunResponse | null = rawData ? (rawData.pipelineStatus ? {
    status: rawData.pipelineStatus,
    target: rawData.target,
    gamma_url: rawData.result?.gammaUrl || null,
    gamma_export_url: rawData.result?.gammaExportUrl || null,
    country_profile: rawData.result?.context || null,
    financial_model: null,
    error_message: rawData.error || null,
    agent_logs: rawData.agentLogs || [],
  } : rawData) : null;

  // If using Render portal and pipeline completed, grab term sheet from result
  useEffect(() => {
    if (!usePortal || !rawData?.pipelineStatus || rawData.pipelineStatus !== "completed") return;
    if (!rawData.result || termSheetRequested.current) return;
    termSheetRequested.current = true;
    const r = rawData.result;
    if (r.termSheetHtml) {
      setTermSheetData({ termSheetHtml: r.termSheetHtml, pitchDeckHtml: r.pitchDeckHtml || "", termSheetDocxBase64: r.termSheetDocxBase64 || "", context: r.context });
    }
  }, [rawData, usePortal]);

  // Auto-approve gates
  useEffect(() => {
    if (!data || !runId) return;
    const status = data.status;
    if (!(status in GATE_APPROVALS)) return;
    if (approvedGates.current.has(status)) return;
    approvedGates.current.add(status);
    const gate = GATE_APPROVALS[status];
    fetch(`${PIPELINE_API}/api/runs/${runId}/${gate.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gate.body),
    }).catch(() => { approvedGates.current.delete(status); });
  }, [data, runId]);

  // (Term sheet data is now extracted from the Render portal pipeline result above)

  const status = data?.status ?? "pending";
  const stageLabel = STAGE_LABELS[status] || "Processing...";
  const isPending = data && status !== "completed" && status !== "error";
  const isComplete = status === "completed";
  const isError = status === "error";
  const currentStageIndex = STAGE_ORDER.indexOf(status as PipelineStatus);
  const progressPct = Math.round((Math.max(0, currentStageIndex) / (STAGE_ORDER.length - 1)) * 100);
  const gammaExportUrl = data?.gamma_export_url;
  const target = data?.target || "";

  // Clean logs for display
  const cleanedLogs = (data?.agent_logs || []).map(cleanLog).filter(Boolean) as string[];

  const handleDownloadTermSheet = useCallback(() => {
    if (!termSheetData) return;
    const name = termSheetData.context.localizedProgramName || termSheetData.context.country;
    downloadHtml(termSheetData.termSheetHtml, `${name}-Interactive-Term-Sheet.html`);
  }, [termSheetData]);

  const handleDownloadPitchDeck = useCallback(() => {
    if (!termSheetData) return;
    const name = termSheetData.context.localizedProgramName || termSheetData.context.country;
    downloadHtml(termSheetData.pitchDeckHtml, `${name}-Pitch-Deck.html`);
  }, [termSheetData]);

  const handleDownloadDocx = useCallback(() => {
    if (!termSheetData?.termSheetDocxBase64) return;
    const name = termSheetData.context.localizedProgramName || termSheetData.context.country;
    const byteChars = atob(termSheetData.termSheetDocxBase64);
    const byteNums = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNums)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${name}-Term-Sheet.docx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [termSheetData]);

  const handleOpenTermSheetFullScreen = useCallback(() => {
    if (!termSheetData?.termSheetHtml) return;
    openInNewTab(termSheetData.termSheetHtml);
  }, [termSheetData]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f7f9fc" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#0000E5" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6" style={{ background: "#f7f9fc" }}>
        <p className="text-red-600 text-sm">Something went wrong. Please try again.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f7f9fc" }}>
      {/* Header */}
      <header className="px-6 py-3" style={{ background: "white", borderBottom: "1px solid #e8ecf1", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Button variant="ghost" size="sm" className="text-xs text-gray-500 hover:text-gray-700" onClick={() => navigate("/")}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> New Country
          </Button>
          <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha Holdings" className="h-7 object-contain" style={{filter:"brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%)"}} />
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Pipeline Progress */}
          {isPending && (
            <div className="flex flex-col items-center justify-center py-16 gap-6">
              <div className="relative">
                <div className="absolute inset-0 rounded-full animate-ping" style={{ background: "rgba(0,0,229,0.15)" }} />
                <div className="relative w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,229,0.08)", border: "1px solid rgba(0,0,229,0.15)" }}>
                  <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#0000E5" }} />
                </div>
              </div>

              <div className="text-center space-y-1.5">
                <p className="text-sm font-semibold text-gray-800">
                  Preparing documents for {target}
                </p>
                <p className="text-sm" style={{ color: "#0000E5" }}>
                  {stageLabel}
                </p>
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-md space-y-3">
                <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #0000E5, #59BBF9)" }}
                  />
                </div>
                <div className="flex justify-between px-1">
                  {STAGE_MILESTONES.map((m) => {
                    const mIdx = STAGE_ORDER.indexOf(m.status);
                    const done = currentStageIndex >= mIdx;
                    const nextM = STAGE_MILESTONES[STAGE_MILESTONES.indexOf(m) + 1];
                    const nextIdx = nextM ? STAGE_ORDER.indexOf(nextM.status) : STAGE_ORDER.length;
                    const active = currentStageIndex >= mIdx && currentStageIndex < nextIdx;
                    return (
                      <div key={m.status} className="flex flex-col items-center gap-1">
                        <div className="w-3 h-3 rounded-full border-2 transition-colors"
                          style={{ borderColor: done ? "#0000E5" : "#d1d5db", background: done ? "#0000E5" : "white" }} />
                        <span className={`text-[10px] ${active ? "font-semibold text-gray-800" : done ? "text-gray-600" : "text-gray-400"}`}>
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cleaned agent logs — only show meaningful, user-friendly messages */}
              {cleanedLogs.length > 0 && (
                <div className="w-full max-w-md mt-4 space-y-1">
                  {cleanedLogs.slice(-3).map((log, i) => (
                    <p key={i} className="text-[11px] text-gray-400 truncate">{log}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error State */}
          {isError && (
            <div className="flex flex-col items-center justify-center py-24 gap-5">
              <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center">
                <RefreshCw className="h-6 w-6 text-red-600" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm font-semibold text-red-600">Something went wrong</p>
                <p className="text-xs text-gray-500 max-w-sm">We encountered an issue preparing your documents. Please try again.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Try Again
              </Button>
            </div>
          )}

          {/* Completed State */}
          {isComplete && (
            <div className="space-y-6 animate-in fade-in duration-500">
              {/* Header */}
              <div className="text-center space-y-2 py-4">
                <h1 className="text-xl font-bold tracking-tight text-gray-900">
                  {target} — Documents Ready
                </h1>
                <p className="text-sm text-gray-500">
                  Your partnership proposal and interactive term sheet are ready.
                </p>
              </div>

              {/* Primary CTAs — Two equal cards side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Interactive Term Sheet — LEFT */}
                {termSheetData?.termSheetHtml ? (
                  <div className="rounded-xl p-6 flex flex-col items-center text-center gap-4"
                    style={{ background: "linear-gradient(135deg, #0000E5 0%, #1a33ff 100%)", boxShadow: "0 4px 20px rgba(0,0,229,0.25)" }}>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
                      <Globe className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-white">Interactive Term Sheet</p>
                      <p className="text-xs text-white/60 mt-1">Full-screen presentation ready to share</p>
                    </div>
                    <Button size="sm" onClick={handleOpenTermSheetFullScreen} className="w-full font-semibold bg-white hover:bg-gray-50" style={{ color: "#0000E5" }}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open Term Sheet
                    </Button>
                  </div>
                ) : termSheetLoading ? (
                  <div className="rounded-xl p-6 flex flex-col items-center text-center gap-4"
                    style={{ background: "linear-gradient(135deg, #0000E5 0%, #1a33ff 100%)", boxShadow: "0 4px 20px rgba(0,0,229,0.25)" }}>
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                    <p className="text-sm text-white/80">Preparing interactive term sheet...</p>
                  </div>
                ) : (
                  <div className="rounded-xl p-6 flex flex-col items-center text-center gap-4"
                    style={{ background: "linear-gradient(135deg, #0000E5 0%, #1a33ff 100%)", boxShadow: "0 4px 20px rgba(0,0,229,0.25)" }}>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
                      <Globe className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-white">Interactive Term Sheet</p>
                      <p className="text-xs text-white/60 mt-1">Generating...</p>
                    </div>
                  </div>
                )}

                {/* Partnership Proposal — RIGHT */}
                {gammaExportUrl && (
                  <div className="rounded-xl p-6 flex flex-col items-center text-center gap-4"
                    style={{ background: "linear-gradient(135deg, #0000E5 0%, #1a33ff 100%)", boxShadow: "0 4px 20px rgba(0,0,229,0.25)" }}>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
                      <Presentation className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-white">Partnership Proposal</p>
                      <p className="text-xs text-white/60 mt-1">Partnership proposal ready for download</p>
                    </div>
                    <a href={gammaExportUrl} target="_blank" rel="noopener noreferrer" className="w-full">
                      <Button size="sm" className="w-full font-semibold bg-white hover:bg-gray-50" style={{ color: "#0000E5" }}>
                        <Download className="h-3.5 w-3.5 mr-1.5" /> Download Proposal
                      </Button>
                    </a>
                  </div>
                )}
              </div>

              {/* Additional downloads */}
              <div className="flex justify-center gap-3 flex-wrap">
                {termSheetData?.termSheetDocxBase64 && (
                  <Button variant="outline" size="sm" onClick={handleDownloadDocx} className="text-xs border-gray-200 text-gray-600">
                    <FileDown className="h-3.5 w-3.5 mr-1.5" /> Term Sheet (.docx)
                  </Button>
                )}

              </div>

              {/* Tab previews */}
              {(termSheetData?.termSheetHtml || termSheetData?.pitchDeckHtml) && (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <div className="flex items-center justify-between mb-3">
                    <TabsList className="bg-white border border-gray-200">
                      {termSheetData.termSheetHtml && (
                        <TabsTrigger value="termsheet" className="text-xs gap-1.5"><FileText className="h-3.5 w-3.5" /> Term Sheet</TabsTrigger>
                      )}
                      {termSheetData.pitchDeckHtml && (
                        <TabsTrigger value="pitchdeck" className="text-xs gap-1.5"><Presentation className="h-3.5 w-3.5" /> Pitch Deck</TabsTrigger>
                      )}
                    </TabsList>
                    <Button variant="ghost" size="sm" className="text-xs text-gray-500"
                      onClick={() => { const html = activeTab === "termsheet" ? termSheetData?.termSheetHtml : termSheetData?.pitchDeckHtml; if (html) openInNewTab(html); }}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open in New Tab
                    </Button>
                  </div>
                  {termSheetData.termSheetHtml && (
                    <TabsContent value="termsheet">
                      <Card className="overflow-hidden bg-white border-gray-200"><CardContent className="p-0">
                        <iframe srcDoc={termSheetData.termSheetHtml} className="w-full border-0" style={{ height: "800px" }} title="Term Sheet" />
                      </CardContent></Card>
                    </TabsContent>
                  )}
                  {termSheetData.pitchDeckHtml && (
                    <TabsContent value="pitchdeck">
                      <Card className="overflow-hidden bg-white border-gray-200"><CardContent className="p-0">
                        <iframe srcDoc={termSheetData.pitchDeckHtml} className="w-full border-0" style={{ height: "800px" }} title="Pitch Deck" />
                      </CardContent></Card>
                    </TabsContent>
                  )}
                </Tabs>
              )}

              <div className="text-center py-2">
                <Button variant="outline" size="sm" onClick={() => navigate("/")} className="text-xs border-gray-200 text-gray-600">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Generate for Another Country
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="py-5 px-6" style={{ borderTop: "1px solid #e8ecf1" }}>
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-4">
          <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" className="h-5 object-contain" style={{filter:"brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%)"}} />
          <p className="text-[11px] text-gray-400">&copy; 2026. Confidential &amp; Proprietary.</p>
        </div>
      </footer>
    </div>
  );
}
