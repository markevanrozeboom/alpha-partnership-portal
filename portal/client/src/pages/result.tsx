import { useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Loader2,
  FileText,
  Presentation,
  Download,
  RefreshCw,
  ExternalLink,
  FileDown,
  Globe,
} from "lucide-react";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import type { GenerationResult } from "@shared/schema";

interface RunData {
  id: string;
  target: string;
  status: "pending" | "generating" | "completed" | "error";
  result: GenerationResult | null;
  error: string | null;
}

function downloadHtml(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openInNewTab(html: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

/* ─── Alpha bird logo ─── */
function AlphaBird({ className = "", style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style}>
      <rect x="32" y="8" width="4" height="4" fill="currentColor" opacity="0.3" />
      <rect x="38" y="4" width="3" height="3" fill="currentColor" opacity="0.4" />
      <rect x="44" y="10" width="3" height="3" fill="currentColor" opacity="0.25" />
      <rect x="36" y="14" width="5" height="5" fill="currentColor" opacity="0.5" />
      <rect x="43" y="16" width="4" height="4" fill="currentColor" opacity="0.6" />
      <rect x="48" y="8" width="4" height="4" fill="currentColor" opacity="0.35" />
      <rect x="50" y="14" width="3" height="3" fill="currentColor" opacity="0.45" />
      <path d="M55 20 L80 55 L55 48 L30 55 Z" fill="currentColor" opacity="0.9" />
      <path d="M80 55 L110 40 L85 60 Z" fill="currentColor" opacity="0.7" />
      <path d="M30 55 L55 48 L45 65 Z" fill="currentColor" opacity="0.5" />
      <path d="M45 65 L55 48 L65 62 L55 80 Z" fill="currentColor" opacity="0.35" />
      <path d="M55 20 L62 30 L55 28 Z" fill="currentColor" opacity="1" />
    </svg>
  );
}

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = params.id;
  const [activeTab, setActiveTab] = useState("termsheet");

  const { data, isLoading, error } = useQuery<RunData>({
    queryKey: ["/api/runs", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}`);
      return res.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 2000;
      if (d.status === "completed" || d.status === "error") return false;
      return 2000;
    },
  });

  const isGenerating = data?.status === "pending" || data?.status === "generating";
  const isComplete = data?.status === "completed";
  const isError = data?.status === "error";
  const result = data?.result;

  const handleDownloadTermSheet = useCallback(() => {
    if (!result) return;
    const name = result.context.localizedProgramName || result.context.country;
    downloadHtml(result.termSheetHtml, `${name}-Interactive-Term-Sheet.html`);
  }, [result]);

  const handleDownloadPitchDeck = useCallback(() => {
    if (!result) return;
    const name = result.context.localizedProgramName || result.context.country;
    downloadHtml(result.pitchDeckHtml, `${name}-Pitch-Deck.html`);
  }, [result]);

  const handleDownloadDocx = useCallback(() => {
    if (!result?.termSheetDocxBase64) return;
    const name = result.context.localizedProgramName || result.context.country;
    const byteChars = atob(result.termSheetDocxBase64);
    const byteNums = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNums[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNums);
    const blob = new Blob([byteArray], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-Term-Sheet.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  const handleOpenTermSheetFullScreen = useCallback(() => {
    if (!result) return;
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
      {/* Header — light with blue accent, matching deck footer */}
      <header
        className="px-6 py-3"
        style={{
          background: "white",
          borderBottom: "1px solid #e8ecf1",
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-gray-500 hover:text-gray-700"
            onClick={() => navigate("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            New Country
          </Button>
          <div className="flex items-center gap-2">
            <AlphaBird className="w-6 h-6" style={{ color: "#0000E5" }} />
            <span
              className="text-xs font-bold tracking-[0.15em] uppercase"
              style={{ color: "#0000E5" }}
            >
              ALPHA
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Generating state */}
          {isGenerating && (
            <div className="flex flex-col items-center justify-center py-24 gap-5" data-testid="status-generating">
              <div className="relative">
                <div
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: "rgba(0, 0, 229, 0.15)" }}
                />
                <div
                  className="relative w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(0, 0, 229, 0.08)", border: "1px solid rgba(0, 0, 229, 0.15)" }}
                >
                  <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#0000E5" }} />
                </div>
              </div>
              <div className="text-center space-y-1.5">
                <p className="text-sm font-semibold text-gray-800">
                  Generating documents for {data?.target}...
                </p>
                <p className="text-xs text-gray-500">
                  Researching country context and building interactive term sheet &amp; pitch deck
                </p>
              </div>
            </div>
          )}

          {/* Error state */}
          {isError && (
            <div className="flex flex-col items-center justify-center py-24 gap-5" data-testid="status-error">
              <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center">
                <RefreshCw className="h-6 w-6 text-red-600" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm font-semibold text-red-600">Generation failed</p>
                <p className="text-xs text-gray-500 max-w-sm">
                  {data?.error || "An unexpected error occurred."}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Try Again
              </Button>
            </div>
          )}

          {/* Complete — show documents */}
          {isComplete && result && (
            <div className="space-y-6 animate-in fade-in duration-500" data-testid="status-completed">
              {/* Country header */}
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{result.context.flagEmoji}</span>
                  <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-900" data-testid="text-country">
                      {result.context.localizedProgramName || result.context.country}
                    </h1>
                    <p className="text-xs text-gray-500">
                      {result.context.formalName} — {result.context.headOfStateTitle}: {result.context.headOfState}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadDocx}
                    className="text-xs border-gray-200 text-gray-600 hover:text-gray-800"
                    data-testid="button-download-docx"
                  >
                    <FileDown className="h-3.5 w-3.5 mr-1.5" />
                    .docx
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadTermSheet}
                    className="text-xs border-gray-200 text-gray-600 hover:text-gray-800"
                    data-testid="button-download-termsheet"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Term Sheet
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadPitchDeck}
                    className="text-xs border-gray-200 text-gray-600 hover:text-gray-800"
                    data-testid="button-download-pitchdeck"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Pitch Deck
                  </Button>
                </div>
              </div>

              {/* Primary CTA — Open Interactive Term Sheet */}
              <div
                className="rounded-xl p-4 flex items-center justify-between gap-4"
                style={{
                  background: "linear-gradient(135deg, #0000E5 0%, #1a33ff 100%)",
                  boxShadow: "0 4px 20px rgba(0, 0, 229, 0.25)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.15)" }}
                  >
                    <Globe className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Interactive Term Sheet</p>
                    <p className="text-xs text-white/70">Full-screen website experience — ready for sovereign presentation</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={handleOpenTermSheetFullScreen}
                  data-testid="button-open-interactive"
                  className="font-semibold bg-white hover:bg-gray-50"
                  style={{ color: "#0000E5" }}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open in New Tab
                </Button>
              </div>

              {/* Tabs: Preview */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex items-center justify-between mb-3">
                  <TabsList className="bg-white border border-gray-200">
                    <TabsTrigger value="termsheet" className="text-xs gap-1.5" data-testid="tab-termsheet">
                      <FileText className="h-3.5 w-3.5" />
                      Term Sheet
                    </TabsTrigger>
                    <TabsTrigger value="pitchdeck" className="text-xs gap-1.5" data-testid="tab-pitchdeck">
                      <Presentation className="h-3.5 w-3.5" />
                      Pitch Deck
                    </TabsTrigger>
                  </TabsList>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-gray-500"
                    onClick={() => {
                      const html = activeTab === "termsheet" ? result.termSheetHtml : result.pitchDeckHtml;
                      openInNewTab(html);
                    }}
                    data-testid="button-open-new-tab"
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Open in New Tab
                  </Button>
                </div>

                <TabsContent value="termsheet">
                  <Card className="overflow-hidden bg-white border-gray-200">
                    <CardContent className="p-0">
                      <iframe
                        srcDoc={result.termSheetHtml}
                        className="w-full border-0"
                        style={{ height: "800px" }}
                        title="Interactive Term Sheet Preview"
                        data-testid="iframe-termsheet"
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="pitchdeck">
                  <Card className="overflow-hidden bg-white border-gray-200">
                    <CardContent className="p-0">
                      <iframe
                        srcDoc={result.pitchDeckHtml}
                        className="w-full border-0"
                        style={{ height: "800px" }}
                        title="Pitch Deck Preview"
                        data-testid="iframe-pitchdeck"
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {/* Generate another */}
              <div className="text-center py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/")}
                  className="text-xs border-gray-200 text-gray-600"
                  data-testid="button-new-search"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Generate for Another Country
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-5 px-6" style={{ borderTop: "1px solid #e8ecf1" }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <AlphaBird className="w-5 h-5" style={{ color: "#0000E5" }} />
            <span className="text-[11px] font-bold tracking-[0.15em] uppercase" style={{ color: "#0000E5" }}>
              ALPHA
            </span>
          </div>
          <p className="text-[11px] text-gray-400 whitespace-nowrap">
            © 2026. Confidential &amp; Proprietary.
          </p>
          <div className="shrink-0">
            <PerplexityAttribution />
          </div>
        </div>
      </footer>
    </div>
  );
}
