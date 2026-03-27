import { useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Loader2, FileText, Presentation, Download,
  RefreshCw, ExternalLink, FileDown, Globe,
} from "lucide-react";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import type { FullGenerationResult, PipelineStatus } from "@shared/schema";

interface PipelineRunData {
  id: string;
  target: string;
  pipelineRunId: string | null;
  pipelineStatus: PipelineStatus;
  pipelineLabel: string;
  result: FullGenerationResult | null;
  error: string | null;
  agentLogs: string[];
}

const STAGE_ORDER: PipelineStatus[] = [
  "pending",
  "researching_country",
  "review_country_report",
  "researching_education",
  "review_education_report",
  "strategizing",
  "review_strategy",
  "presenting_assumptions",
  "review_assumptions",
  "building_model",
  "review_model",
  "presenting_term_sheet_assumptions",
  "review_term_sheet_assumptions",
  "generating_documents",
  "review_documents",
  "completed",
];

const STAGE_MILESTONES: { status: PipelineStatus; label: string }[] = [
  { status: "researching_country", label: "Country Research" },
  { status: "researching_education", label: "Education Analysis" },
  { status: "strategizing", label: "Strategy" },
  { status: "presenting_assumptions", label: "Financial Model" },
  { status: "generating_documents", label: "Documents" },
  { status: "completed", label: "Complete" },
];

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
  const id = params.id;
  const [activeTab, setActiveTab] = useState("termsheet");

  const { data, isLoading, error } = useQuery<PipelineRunData>({
    queryKey: ["/api/pipeline-runs", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pipeline-runs/${id}`);
      return res.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 2000;
      return (d.pipelineStatus === "completed" || d.pipelineStatus === "error") ? false : 3000;
    },
  });

  const isPending = data && data.pipelineStatus !== "completed" && data.pipelineStatus !== "error";
  const isComplete = data?.pipelineStatus === "completed";
  const isError = data?.pipelineStatus === "error";
  const result = data?.result;

  // Compute progress percentage from stage order
  const currentStageIndex = data ? STAGE_ORDER.indexOf(data.pipelineStatus) : 0;
  const progressPct = Math.round((Math.max(0, currentStageIndex) / (STAGE_ORDER.length - 1)) * 100);

  const handleDownloadTermSheet = useCallback(() => {
    if (!result?.termSheetHtml || !result.context) return;
    const name = result.context.localizedProgramName || result.context.country;
    downloadHtml(result.termSheetHtml, `${name}-Interactive-Term-Sheet.html`);
  }, [result]);

  const handleDownloadPitchDeck = useCallback(() => {
    if (!result?.pitchDeckHtml || !result.context) return;
    const name = result.context.localizedProgramName || result.context.country;
    downloadHtml(result.pitchDeckHtml, `${name}-Pitch-Deck.html`);
  }, [result]);

  const handleDownloadDocx = useCallback(() => {
    if (!result?.termSheetDocxBase64 || !result.context) return;
    const name = result.context.localizedProgramName || result.context.country;
    const byteChars = atob(result.termSheetDocxBase64);
    const byteNums = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNums)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}-Term-Sheet.docx`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [result]);

  const handleOpenTermSheetFullScreen = useCallback(() => {
    if (!result?.termSheetHtml) return;
    openInNewTab(result.termSheetHtml);
  }, [result]);

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
        <p className="text-red-600 text-sm">Failed to load.</p>
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
          <Button variant="ghost" size="sm" className="text-xs text-gray-500 hover:text-gray-700" onClick={() => navigate("/")} data-testid="button-back">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> New Country
          </Button>
          <img src="/assets/alpha-logo-blue.jpg" alt="Alpha Holdings" className="h-7 object-contain" />
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Pipeline Progress */}
          {isPending && (
            <div className="flex flex-col items-center justify-center py-16 gap-6" data-testid="status-pipeline">
              <div className="relative">
                <div className="absolute inset-0 rounded-full animate-ping" style={{ background: "rgba(0,0,229,0.15)" }} />
                <div className="relative w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,229,0.08)", border: "1px solid rgba(0,0,229,0.15)" }}>
                  <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#0000E5" }} />
                </div>
              </div>

              <div className="text-center space-y-1.5">
                <p className="text-sm font-semibold text-gray-800">
                  Building documents for {data?.target}
                </p>
                <p className="text-sm" style={{ color: "#0000E5" }}>
                  {data?.pipelineLabel}
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

                {/* Milestone dots */}
                <div className="flex justify-between px-1">
                  {STAGE_MILESTONES.map((m) => {
                    const mIdx = STAGE_ORDER.indexOf(m.status);
                    const done = currentStageIndex >= mIdx;
                    const active = currentStageIndex >= mIdx && currentStageIndex < (STAGE_ORDER.indexOf(STAGE_MILESTONES[STAGE_MILESTONES.indexOf(m) + 1]?.status) ?? STAGE_ORDER.length);
                    return (
                      <div key={m.status} className="flex flex-col items-center gap-1">
                        <div
                          className="w-3 h-3 rounded-full border-2 transition-colors"
                          style={{
                            borderColor: done ? "#0000E5" : "#d1d5db",
                            background: done ? "#0000E5" : "white",
                          }}
                        />
                        <span className={`text-[10px] ${active ? "font-semibold text-gray-800" : done ? "text-gray-600" : "text-gray-400"}`}>
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Agent logs (last 3) */}
              {data?.agentLogs && data.agentLogs.length > 0 && (
                <div className="w-full max-w-md mt-4 space-y-1">
                  {data.agentLogs.slice(-3).map((log, i) => (
                    <p key={i} className="text-[11px] text-gray-400 truncate">{log}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error State */}
          {isError && (
            <div className="flex flex-col items-center justify-center py-24 gap-5" data-testid="status-error">
              <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center">
                <RefreshCw className="h-6 w-6 text-red-600" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm font-semibold text-red-600">Pipeline failed</p>
                <p className="text-xs text-gray-500 max-w-sm">{data?.error || "An unexpected error occurred."}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Try Again
              </Button>
            </div>
          )}

          {/* Completed State */}
          {isComplete && result && (
            <div className="space-y-6 animate-in fade-in duration-500" data-testid="status-completed">
              {/* Header with country info */}
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  {result.context && (
                    <>
                      <span className="text-3xl">{result.context.flagEmoji}</span>
                      <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-900" data-testid="text-country">
                          {result.context.localizedProgramName || result.context.country}
                        </h1>
                        <p className="text-xs text-gray-500">
                          {result.context.formalName} — {result.context.headOfStateTitle}: {result.context.headOfState}
                        </p>
                      </div>
                    </>
                  )}
                  {!result.context && (
                    <div>
                      <h1 className="text-lg font-bold tracking-tight text-gray-900">{data?.target}</h1>
                      <p className="text-xs text-gray-500">Documents ready</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {result.termSheetDocxBase64 && (
                    <Button variant="outline" size="sm" onClick={handleDownloadDocx} className="text-xs border-gray-200 text-gray-600">
                      <FileDown className="h-3.5 w-3.5 mr-1.5" /> .docx
                    </Button>
                  )}
                  {result.termSheetHtml && (
                    <Button variant="outline" size="sm" onClick={handleDownloadTermSheet} className="text-xs border-gray-200 text-gray-600">
                      <Download className="h-3.5 w-3.5 mr-1.5" /> Term Sheet
                    </Button>
                  )}
                  {result.pitchDeckHtml && (
                    <Button variant="outline" size="sm" onClick={handleDownloadPitchDeck} className="text-xs border-gray-200 text-gray-600">
                      <Download className="h-3.5 w-3.5 mr-1.5" /> Pitch Deck
                    </Button>
                  )}
                </div>
              </div>

              {/* Gamma Deck CTA */}
              {result.gammaUrl && (
                <div className="rounded-xl p-4 flex items-center justify-between gap-4"
                  style={{ background: "linear-gradient(135deg, #0000E5 0%, #1a33ff 100%)", boxShadow: "0 4px 20px rgba(0,0,229,0.25)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
                      <Presentation className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Investor Deck (Gamma)</p>
                      <p className="text-xs text-white/70">AI-generated presentation deck — ready for investor meetings</p>
                    </div>
                  </div>
                  <a href={result.gammaUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" className="font-semibold bg-white hover:bg-gray-50" style={{ color: "#0000E5" }}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open Investor Deck
                    </Button>
                  </a>
                </div>
              )}

              {/* Interactive Term Sheet CTA */}
              {result.termSheetHtml && (
                <div className="rounded-xl p-4 flex items-center justify-between gap-4"
                  style={{ background: "linear-gradient(135deg, #0a1628 0%, #1a2a4a 100%)", boxShadow: "0 4px 20px rgba(10,22,40,0.25)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }}>
                      <Globe className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Interactive Term Sheet</p>
                      <p className="text-xs text-white/60">Full-screen website experience — ready for sovereign presentation</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={handleOpenTermSheetFullScreen}
                    className="font-semibold bg-white hover:bg-gray-50" style={{ color: "#0a1628" }}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open in New Tab
                  </Button>
                </div>
              )}

              {/* Tab previews */}
              {(result.termSheetHtml || result.pitchDeckHtml) && (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <div className="flex items-center justify-between mb-3">
                    <TabsList className="bg-white border border-gray-200">
                      {result.termSheetHtml && (
                        <TabsTrigger value="termsheet" className="text-xs gap-1.5"><FileText className="h-3.5 w-3.5" /> Term Sheet</TabsTrigger>
                      )}
                      {result.pitchDeckHtml && (
                        <TabsTrigger value="pitchdeck" className="text-xs gap-1.5"><Presentation className="h-3.5 w-3.5" /> Pitch Deck</TabsTrigger>
                      )}
                    </TabsList>
                    <Button variant="ghost" size="sm" className="text-xs text-gray-500"
                      onClick={() => {
                        const html = activeTab === "termsheet" ? result.termSheetHtml : result.pitchDeckHtml;
                        if (html) openInNewTab(html);
                      }}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open in New Tab
                    </Button>
                  </div>
                  {result.termSheetHtml && (
                    <TabsContent value="termsheet">
                      <Card className="overflow-hidden bg-white border-gray-200"><CardContent className="p-0">
                        <iframe srcDoc={result.termSheetHtml} className="w-full border-0" style={{ height: "800px" }} title="Term Sheet" />
                      </CardContent></Card>
                    </TabsContent>
                  )}
                  {result.pitchDeckHtml && (
                    <TabsContent value="pitchdeck">
                      <Card className="overflow-hidden bg-white border-gray-200"><CardContent className="p-0">
                        <iframe srcDoc={result.pitchDeckHtml} className="w-full border-0" style={{ height: "800px" }} title="Pitch Deck" />
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
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <img src="/assets/alpha-logo-blue.jpg" alt="Alpha" className="h-5 object-contain shrink-0" />
          <p className="text-[11px] text-gray-400 whitespace-nowrap">&copy; 2026. Confidential &amp; Proprietary.</p>
          <div className="shrink-0"><PerplexityAttribution /></div>
        </div>
      </footer>
    </div>
  );
}
