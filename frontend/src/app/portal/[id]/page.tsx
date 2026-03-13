"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getExpressRunStatus,
  getExpressDownloadUrl,
  type ExpressRunStatus,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Step definitions for progress display
// ---------------------------------------------------------------------------

const STEP_CONFIG = [
  { label: "Market Research", icon: "🌍", description: "Analyzing country/state data, demographics, economy, and regulations" },
  { label: "Education Analysis", icon: "📚", description: "Deep-diving into the education sector, pain points, and reform landscape" },
  { label: "Strategy Development", icon: "🎯", description: "Developing market entry strategy, partnership model, and school portfolio" },
  { label: "Financial Modeling", icon: "📊", description: "Building 5-year P&L, unit economics, and returns analysis" },
  { label: "Document Generation", icon: "📄", description: "Creating term sheet and investment memorandum" },
  { label: "PDF Creation", icon: "🖨️", description: "Formatting professional PDF deliverables" },
];

// ---------------------------------------------------------------------------
// Portal Run Page
// ---------------------------------------------------------------------------

export default function PortalRunPage() {
  const params = useParams();
  const runId = params.id as string;

  const [data, setData] = useState<ExpressRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll for status updates
  const fetchStatus = useCallback(async () => {
    try {
      const status = await getExpressRunStatus(runId);
      setData(status);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [runId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Stop polling when complete or error
  useEffect(() => {
    if (data?.status === "completed" || data?.status === "error") {
      // No need to keep polling
    }
  }, [data?.status]);

  const isComplete = data?.status === "completed";
  const isError = data?.status === "error";
  const isRunning = !isComplete && !isError && data !== null;
  const currentStep = data?.step_index ?? 0;
  const progressPct = isComplete ? 100 : Math.round(((currentStep) / STEP_CONFIG.length) * 100);

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/5 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link
            href="/portal"
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to Portal
          </Link>
          <span className="text-xs text-gray-600">
            2hr Learning Partnership Portal
          </span>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="max-w-2xl w-full space-y-8">
          {/* Target Name */}
          {data && (
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold">
                {data.target}
              </h1>
              <p className="text-gray-400 text-sm">
                {isComplete
                  ? "Your documents are ready for download"
                  : isError
                  ? "An error occurred during generation"
                  : "Generating your partnership documents..."}
              </p>
            </div>
          )}

          {/* Progress Section */}
          {isRunning && (
            <div className="space-y-6">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">{data?.step_label}</span>
                  <span className="text-[#006D77] font-medium">{progressPct}%</span>
                </div>
                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#006D77] to-[#00d4aa] rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Step List */}
              <div className="space-y-3">
                {STEP_CONFIG.map((step, index) => {
                  const isDone = index < currentStep;
                  const isActive = index === currentStep;

                  return (
                    <div
                      key={step.label}
                      className={`flex items-start gap-4 rounded-xl px-4 py-3 transition-all duration-500 ${
                        isActive
                          ? "bg-[#006D77]/10 border border-[#006D77]/30"
                          : isDone
                          ? "opacity-60"
                          : "opacity-30"
                      }`}
                    >
                      {/* Step Indicator */}
                      <div className="flex-shrink-0 mt-0.5">
                        {isDone ? (
                          <div className="w-7 h-7 rounded-full bg-[#006D77] flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        ) : isActive ? (
                          <div className="w-7 h-7 rounded-full border-2 border-[#006D77] flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-[#006D77] animate-pulse" />
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-full border border-white/10 flex items-center justify-center">
                            <span className="text-xs text-gray-600">{index + 1}</span>
                          </div>
                        )}
                      </div>

                      {/* Step Content */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{step.icon}</span>
                          <span className={`font-medium text-sm ${isActive ? "text-white" : "text-gray-400"}`}>
                            {step.label}
                          </span>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 text-xs text-[#00d4aa]">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d4aa] opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#00d4aa]" />
                              </span>
                              In progress
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <p className="text-xs text-gray-500 mt-1">{step.description}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed — Download Section */}
          {isComplete && (
            <div className="space-y-6">
              {/* Success Banner */}
              <div className="rounded-2xl bg-[#006D77]/10 border border-[#006D77]/30 p-6 text-center space-y-3">
                <div className="text-4xl">✅</div>
                <h2 className="text-xl font-bold text-[#00d4aa]">Documents Ready</h2>
                <p className="text-gray-400 text-sm">
                  Your customized term sheet and proposal deck have been generated.
                  Download them below.
                </p>
              </div>

              {/* Download Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Term Sheet */}
                <a
                  href={getExpressDownloadUrl(runId, "term_sheet")}
                  className="group rounded-2xl border border-white/10 bg-[#1a1a2e] p-6 space-y-4 hover:border-[#006D77]/50 hover:bg-[#1a1a2e]/80 transition-all duration-200 block"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-white group-hover:text-[#00d4aa] transition-colors">
                        Term Sheet
                      </h3>
                      <p className="text-xs text-gray-500">PDF Document</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400">
                    Indicative term sheet with partnership structure, fee arrangements, and deal terms.
                  </p>
                  <div className="flex items-center gap-2 text-[#006D77] text-sm font-medium group-hover:text-[#00d4aa] transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download PDF
                  </div>
                </a>

                {/* Proposal Deck */}
                <a
                  href={getExpressDownloadUrl(runId, "proposal")}
                  className="group rounded-2xl border border-white/10 bg-[#1a1a2e] p-6 space-y-4 hover:border-[#006D77]/50 hover:bg-[#1a1a2e]/80 transition-all duration-200 block"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-white group-hover:text-[#00d4aa] transition-colors">
                        Proposal Deck
                      </h3>
                      <p className="text-xs text-gray-500">PDF Document</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400">
                    Investment memorandum with market analysis, financials, and implementation roadmap.
                  </p>
                  <div className="flex items-center gap-2 text-[#006D77] text-sm font-medium group-hover:text-[#00d4aa] transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download PDF
                  </div>
                </a>
              </div>

              {/* Generate Another */}
              <div className="text-center pt-4">
                <Link
                  href="/portal"
                  className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  Generate another proposal
                </Link>
              </div>
            </div>
          )}

          {/* Error State */}
          {isError && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-6 text-center space-y-3">
                <div className="text-4xl">⚠️</div>
                <h2 className="text-xl font-bold text-red-400">Generation Failed</h2>
                <p className="text-gray-400 text-sm">
                  {data?.error_message || "An unexpected error occurred. Please try again."}
                </p>
              </div>
              <div className="text-center">
                <Link
                  href="/portal"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#006D77] hover:bg-[#005a63] text-white font-medium px-6 py-3 text-sm transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                  Try Again
                </Link>
              </div>
            </div>
          )}

          {/* Loading placeholder */}
          {!data && !error && (
            <div className="text-center py-12">
              <svg className="animate-spin h-8 w-8 mx-auto text-[#006D77]" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-gray-500 mt-4 text-sm">Connecting...</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 py-4 px-4 text-center text-xs text-gray-600">
        CONFIDENTIAL — 2hr Learning (Alpha) — Partnership Portal
      </footer>
    </div>
  );
}
