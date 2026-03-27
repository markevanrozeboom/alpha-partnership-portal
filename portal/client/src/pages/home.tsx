import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowRight, Globe, FileText, Presentation, ExternalLink } from "lucide-react";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

/* ─── Alpha bird logo (geometric wireframe style from the deck) ─── */
function AlphaBird({ className = "", style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style}>
      {/* Pixelated particles top-left */}
      <rect x="32" y="8" width="4" height="4" fill="currentColor" opacity="0.3" />
      <rect x="38" y="4" width="3" height="3" fill="currentColor" opacity="0.4" />
      <rect x="44" y="10" width="3" height="3" fill="currentColor" opacity="0.25" />
      <rect x="36" y="14" width="5" height="5" fill="currentColor" opacity="0.5" />
      <rect x="43" y="16" width="4" height="4" fill="currentColor" opacity="0.6" />
      <rect x="48" y="8" width="4" height="4" fill="currentColor" opacity="0.35" />
      <rect x="50" y="14" width="3" height="3" fill="currentColor" opacity="0.45" />
      {/* Main bird body — geometric origami */}
      <path d="M55 20 L80 55 L55 48 L30 55 Z" fill="currentColor" opacity="0.9" />
      {/* Wing — right */}
      <path d="M80 55 L110 40 L85 60 Z" fill="currentColor" opacity="0.7" />
      {/* Wing — left taper */}
      <path d="M30 55 L55 48 L45 65 Z" fill="currentColor" opacity="0.5" />
      {/* Tail */}
      <path d="M45 65 L55 48 L65 62 L55 80 Z" fill="currentColor" opacity="0.35" />
      {/* Head accent */}
      <path d="M55 20 L62 30 L55 28 Z" fill="currentColor" opacity="1" />
    </svg>
  );
}

export default function HomePage() {
  const [, navigate] = useLocation();
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    const trimmed = target.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/generate", { target: trimmed });
      const data = await res.json();
      navigate(`/result/${data.id}`);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f7f9fc" }}>
      {/* Blue hero section — matching the deck title slide */}
      <div
        className="relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #0000E5 0%, #0022FF 40%, #59BBF9 100%)",
          minHeight: "420px",
        }}
      >
        {/* Subtle decorative circles like the deck's market slide */}
        <div
          className="absolute rounded-full opacity-10"
          style={{
            width: "600px", height: "600px",
            background: "radial-gradient(circle, #ffffff 0%, transparent 70%)",
            top: "-200px", right: "-100px",
          }}
        />
        <div
          className="absolute rounded-full opacity-[0.07]"
          style={{
            width: "400px", height: "400px",
            background: "radial-gradient(circle, #ffffff 0%, transparent 70%)",
            bottom: "-150px", left: "-50px",
          }}
        />

        <div className="relative z-10 flex flex-col items-center justify-center px-6 py-16">
          {/* Logo + wordmark */}
          <div className="flex items-center gap-4 mb-8">
            <AlphaBird className="w-16 h-16 text-white" />
            <span
              className="text-white font-bold tracking-[0.25em] text-2xl"
              style={{ fontFamily: "'Montserrat', sans-serif" }}
            >
              ALPHA
            </span>
          </div>

          {/* Thin divider line like the deck */}
          <div className="w-24 h-px bg-white/30 mb-8" />

          {/* Tagline */}
          <h1
            className="text-white text-center font-light text-lg md:text-xl tracking-wide max-w-xl mb-3"
            style={{ fontFamily: "'Montserrat', sans-serif" }}
            data-testid="text-hero-title"
          >
            National Partnership Portal
          </h1>
          <p className="text-white/70 text-center text-sm max-w-md mb-1">
            Transforming education through AI-powered learning
          </p>
          <p className="text-white/40 text-center text-xs tracking-widest uppercase mt-4">
            Confidential &amp; Proprietary
          </p>
        </div>
      </div>

      {/* Content area — light background like the deck's content slides */}
      <div className="flex-1 flex flex-col items-center px-6 -mt-12 relative z-20">
        {/* Input card — elevated white card */}
        <div
          className="w-full max-w-lg bg-white rounded-xl p-8 space-y-6"
          style={{ boxShadow: "0 8px 40px rgba(0, 0, 229, 0.08), 0 2px 8px rgba(0,0,0,0.06)" }}
        >
          {/* Section eyebrow — matching deck style */}
          <div className="text-center space-y-2">
            <p
              className="text-xs font-bold tracking-[0.2em] uppercase"
              style={{ color: "#0000E5" }}
            >
              GENERATE DOCUMENTS
            </p>
            <p className="text-sm text-gray-500">
              Enter a country or US state to build an interactive Term Sheet
              website and Pitch Deck.
            </p>
          </div>

          {/* Input */}
          <div className="space-y-3">
            <div className="relative">
              <Globe className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="e.g. United Arab Emirates, Rwanda, Texas..."
                className="pl-11 pr-4 h-12 text-sm border-gray-200 focus:border-blue-600 focus:ring-blue-600 rounded-lg bg-gray-50"
                disabled={loading}
                data-testid="input-country"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || !target.trim()}
              className="w-full h-12 text-sm font-semibold rounded-lg tracking-wide flex items-center justify-center gap-2 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              style={{ background: "#0000E5" }}
              data-testid="button-generate"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Generating Documents...
                </>
              ) : (
                <>
                  Generate Term Sheet &amp; Pitch Deck
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </button>

            {error && (
              <p className="text-red-600 text-xs text-center" data-testid="text-error">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
          {[
            { icon: ExternalLink, label: "Interactive Website" },
            { icon: FileText, label: "Term Sheet" },
            { icon: Presentation, label: "Pitch Deck" },
            { icon: Globe, label: "Country-specific" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5"
              style={{ color: "#0000E5", background: "rgba(0, 0, 229, 0.06)" }}
            >
              <Icon className="h-3 w-3" />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Footer — matching deck footer style */}
      <footer className="py-5 px-6" style={{ borderTop: "1px solid #e8ecf1" }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <AlphaBird className="w-5 h-5" style={{ color: "#0000E5" }} />
            <span
              className="text-[11px] font-bold tracking-[0.15em] uppercase"
              style={{ color: "#0000E5" }}
            >
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
