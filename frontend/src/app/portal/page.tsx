"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createExpressRun } from "@/lib/api";

export default function PortalPage() {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { run_id } = await createExpressRun(target.trim());
      router.push(`/portal/${run_id}`);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white flex flex-col">
      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="max-w-2xl w-full space-y-8 text-center">
          {/* Brand */}
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#006D77]/20 px-5 py-2 text-sm font-medium text-[#00d4aa]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d4aa] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d4aa]" />
              </span>
              Alpha Holdings, Inc. Partnership Portal
            </div>

            <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
              Generate Your
              <br />
              <span className="text-[#006D77]">Partnership Proposal</span>
            </h1>

            <p className="text-gray-400 max-w-lg mx-auto text-lg leading-relaxed">
              Enter your country or US state below. We&apos;ll generate a
              customized term sheet and proposal deck tailored to your market.
            </p>
          </div>

          {/* Input + Button */}
          <div className="space-y-4 max-w-lg mx-auto">
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Enter country or US state name..."
              className="w-full rounded-2xl border border-white/10 bg-[#1a1a2e] px-6 py-4 text-white text-lg placeholder-gray-500 focus:border-[#006D77] focus:outline-none focus:ring-2 focus:ring-[#006D77]/50 transition-all"
              disabled={loading}
            />
            <button
              onClick={handleGenerate}
              disabled={loading || !target.trim()}
              className="w-full rounded-2xl bg-[#006D77] hover:bg-[#005a63] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-8 py-4 text-lg transition-all duration-200 flex items-center justify-center gap-3"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Launching...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  Generate Term Sheet &amp; Proposal Deck
                </>
              )}
            </button>
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
        </div>
      </div>

      {/* What You Get Section */}
      <div className="border-t border-white/5 bg-[#0d0d1a]/50 py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-center text-xl font-bold mb-8">
            What You&apos;ll Receive
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 space-y-3">
              <div className="text-3xl">📋</div>
              <h3 className="font-semibold text-lg">Term Sheet</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                A professional, indicative term sheet outlining partnership
                structure, fee arrangements, school portfolio, and counterparty
                commitments — ready for discussion.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 space-y-3">
              <div className="text-3xl">📄</div>
              <h3 className="font-semibold text-lg">Proposal Deck</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                A comprehensive proposal deck with market analysis,
                financial projections, deal structure, implementation roadmap,
                and risk assessment.
              </p>
            </div>
          </div>

          <div className="mt-8 text-center">
            <div className="inline-flex items-center gap-2 text-sm text-gray-500">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Documents are generated in approximately 3–5 minutes
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 py-4 px-4 text-center text-xs text-gray-600">
        CONFIDENTIAL — Alpha Holdings, Inc. — Partnership Portal
      </footer>
    </div>
  );
}
