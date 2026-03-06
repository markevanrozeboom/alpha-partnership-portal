"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRun } from "@/lib/api";
import { Button } from "@/components/ui/button";

const PRIORITY_MARKETS = [
  { name: "Saudi Arabia", flag: "🇸🇦", tier: 1 },
  { name: "Qatar", flag: "🇶🇦", tier: 1 },
  { name: "Kuwait", flag: "🇰🇼", tier: 1 },
  { name: "Bahrain", flag: "🇧🇭", tier: 1 },
  { name: "Singapore", flag: "🇸🇬", tier: 1 },
  { name: "United Kingdom", flag: "🇬🇧", tier: 1 },
  { name: "India", flag: "🇮🇳", tier: 1 },
  { name: "Malaysia", flag: "🇲🇾", tier: 2 },
  { name: "Indonesia", flag: "🇮🇩", tier: 2 },
  { name: "South Korea", flag: "🇰🇷", tier: 2 },
  { name: "Japan", flag: "🇯🇵", tier: 2 },
  { name: "Mexico", flag: "🇲🇽", tier: 2 },
  { name: "Brazil", flag: "🇧🇷", tier: 2 },
  { name: "Nigeria", flag: "🇳🇬", tier: 3 },
  { name: "Kenya", flag: "🇰🇪", tier: 3 },
  { name: "Rwanda", flag: "🇷🇼", tier: 3 },
];

const US_STATES = [
  "Arizona", "Florida", "Texas", "Indiana", "Ohio",
  "North Carolina", "Tennessee", "Utah", "West Virginia", "Iowa",
];

export default function Home() {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { run_id } = await createRun(target.trim());
      router.push(`/run/${run_id}`);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  const handleQuickSelect = (name: string) => {
    setTarget(name);
  };

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="max-w-3xl w-full space-y-8 text-center">
          {/* Logo / Brand */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#006D77]/20 px-4 py-1.5 text-xs font-medium text-[#00d4aa]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d4aa] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d4aa]" />
              </span>
              Powered by AI Research Agents
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
              Alpha Market Entry
              <br />
              <span className="text-[#006D77]">Intelligence System</span>
            </h1>
            <p className="text-gray-400 max-w-xl mx-auto text-lg">
              Enter a target country or US state. Our AI agents will produce investment-bank quality
              research, McKinsey-grade strategy, and a complete financial model with investor deck.
            </p>
          </div>

          {/* Input */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="e.g. Saudi Arabia, Texas, Singapore..."
              className="flex-1 rounded-xl border border-white/10 bg-[#1a1a2e] px-5 py-3.5 text-white placeholder-gray-500 focus:border-[#006D77] focus:outline-none focus:ring-1 focus:ring-[#006D77] text-lg"
              disabled={loading}
            />
            <Button
              onClick={handleSubmit}
              disabled={loading || !target.trim()}
              className="bg-[#006D77] hover:bg-[#005a63] text-white font-semibold px-8 py-3.5 text-lg rounded-xl h-auto"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Launching...
                </span>
              ) : (
                "Launch Pipeline →"
              )}
            </Button>
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          {/* Quick Select */}
          <div className="space-y-6 pt-4">
            <div>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                Priority Sovereign Markets
              </h3>
              <div className="flex flex-wrap justify-center gap-2">
                {PRIORITY_MARKETS.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => handleQuickSelect(m.name)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all
                      ${target === m.name
                        ? "bg-[#006D77] text-white ring-1 ring-[#006D77]"
                        : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                      }
                    `}
                  >
                    <span>{m.flag}</span>
                    <span>{m.name}</span>
                    <span className={`text-[10px] rounded px-1 py-0.5 ${
                      m.tier === 1 ? "bg-emerald-500/20 text-emerald-400" :
                      m.tier === 2 ? "bg-blue-500/20 text-blue-400" :
                      "bg-gray-500/20 text-gray-400"
                    }`}>
                      T{m.tier}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                US States (ESA/Voucher Markets)
              </h3>
              <div className="flex flex-wrap justify-center gap-2">
                {US_STATES.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleQuickSelect(s)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all
                      ${target === s
                        ? "bg-[#006D77] text-white ring-1 ring-[#006D77]"
                        : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                      }
                    `}
                  >
                    🇺🇸 {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline explanation */}
      <div className="border-t border-white/5 bg-[#0d0d1a]/50 py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-center text-xl font-bold mb-8">
            What the Pipeline Produces
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: "🌍",
                title: "Research Reports",
                description: "Investment-bank quality country research and McKinsey-grade education sector analysis, with detailed data tables and citations.",
              },
              {
                icon: "📊",
                title: "Interactive Financial Model",
                description: "Configurable 5-year P&L with interactive assumption sliders, unit economics, returns analysis, and sensitivity tables.",
              },
              {
                icon: "📄",
                title: "Executive Documents",
                description: "Investor/government presentation deck, formal proposal document, and Excel financial model — ready for boardroom presentation.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 space-y-3">
                <div className="text-3xl">{item.icon}</div>
                <h3 className="font-semibold text-lg">{item.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 py-4 px-4 text-center text-xs text-gray-600">
        CONFIDENTIAL — 2hr Learning (Alpha) — Market Entry Intelligence System v2.0
      </footer>
    </div>
  );
}
