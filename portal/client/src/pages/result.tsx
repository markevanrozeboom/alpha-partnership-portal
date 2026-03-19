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
    downloadHtml(result.termSheetHtml, `${name}-Term-Sheet.html`);
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 bg-background">
        <p className="text-destructive text-sm">Failed to load.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b px-6 py-3 bg-card">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => navigate("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            New Country
          </Button>
          <span className="text-xs text-muted-foreground font-medium tracking-wide">
            Alpha Holdings, Inc. — National Partnership Portal
          </span>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-5xl mx-auto">
          {/* Generating state */}
          {isGenerating && (
            <div className="flex flex-col items-center justify-center py-24 gap-5" data-testid="status-generating">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                <div className="relative w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 text-primary animate-spin" />
                </div>
              </div>
              <div className="text-center space-y-1.5">
                <p className="text-sm font-medium">Generating documents for {data?.target}...</p>
                <p className="text-xs text-muted-foreground">Researching country context and building term sheet & pitch deck</p>
              </div>
            </div>
          )}

          {/* Error state */}
          {isError && (
            <div className="flex flex-col items-center justify-center py-24 gap-5" data-testid="status-error">
              <div className="w-14 h-14 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center">
                <RefreshCw className="h-6 w-6 text-destructive" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm font-medium text-destructive">Generation failed</p>
                <p className="text-xs text-muted-foreground max-w-sm">
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{result.context.flagEmoji}</span>
                  <div>
                    <h1 className="text-lg font-semibold tracking-tight" data-testid="text-country">
                      {result.context.localizedProgramName || result.context.country}
                    </h1>
                    <p className="text-xs text-muted-foreground">
                      {result.context.formalName} — {result.context.headOfStateTitle}: {result.context.headOfState}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadDocx}
                    data-testid="button-download-docx"
                  >
                    <FileDown className="h-3.5 w-3.5 mr-1.5" />
                    Term Sheet (.docx)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadTermSheet}
                    data-testid="button-download-termsheet"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Term Sheet (.html)
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleDownloadPitchDeck}
                    data-testid="button-download-pitchdeck"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Pitch Deck
                  </Button>
                </div>
              </div>

              {/* Tabs: Preview */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex items-center justify-between mb-3">
                  <TabsList>
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
                    className="text-xs text-muted-foreground"
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
                  <Card className="overflow-hidden">
                    <CardContent className="p-0">
                      <iframe
                        srcDoc={result.termSheetHtml}
                        className="w-full border-0"
                        style={{ height: "700px" }}
                        title="Term Sheet Preview"
                        data-testid="iframe-termsheet"
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="pitchdeck">
                  <Card className="overflow-hidden">
                    <CardContent className="p-0">
                      <iframe
                        srcDoc={result.pitchDeckHtml}
                        className="w-full border-0"
                        style={{ height: "700px" }}
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
      <footer className="border-t py-4 px-6 text-center">
        <p className="text-xs text-muted-foreground mb-2">
          CONFIDENTIAL — Alpha Holdings, Inc. — National Partnership Portal
        </p>
        <PerplexityAttribution />
      </footer>
    </div>
  );
}
