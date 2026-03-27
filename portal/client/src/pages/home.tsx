import { useState } from "react";
import { useLocation } from "wouter";
import { PORTAL_API, PIPELINE_API } from "@/lib/api-config";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowRight, Globe, FileText, Presentation, ExternalLink } from "lucide-react";

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
      // Use Render portal backend for full orchestration (includes term sheet generation)
      const backendUrl = PORTAL_API || PIPELINE_API;
      const endpoint = PORTAL_API ? `${PORTAL_API}/api/generate-full` : `${PIPELINE_API}/api/runs`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: trimmed }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText}`);
      }
      const data = await res.json();
      // Portal returns { id }, FastAPI returns { run_id }
      const runId = data.id || data.run_id;
      navigate(`/pipeline/${runId}`);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f7f9fc" }}>
      {/* Blue hero section */}
      <div
        className="relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #0000E5 0%, #0022FF 40%, #59BBF9 100%)",
          minHeight: "420px",
        }}
      >
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
          {/* Real Alpha logo - white SVG version on blue */}
          <img
            src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg"
            alt="Alpha Holdings"
            className="h-16 mb-6 object-contain"
          />

          <div className="w-24 h-px bg-white/30 mb-8" />

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

      {/* Content area */}
      <div className="flex-1 flex flex-col items-center px-6 -mt-12 relative z-20">
        <div
          className="w-full max-w-lg bg-white rounded-xl p-8 space-y-6"
          style={{ boxShadow: "0 8px 40px rgba(0, 0, 229, 0.08), 0 2px 8px rgba(0,0,0,0.06)" }}
        >
          <div className="text-center space-y-2">
            <p
              className="text-xs font-bold tracking-[0.2em] uppercase"
              style={{ color: "#0000E5" }}
            >
              GENERATE DOCUMENTS
            </p>
            <p className="text-sm text-gray-500">
              Enter a country or US state to build a Partnership Proposal
              and Interactive Term Sheet.
            </p>
          </div>

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
                  Generate Partnership Proposal
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

      {/* Footer */}
      <footer className="py-5 px-6" style={{ borderTop: "1px solid #e8ecf1" }}>
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-4">
          <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" className="h-5 object-contain" style={{filter:"brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%)"}} />
          <p className="text-[11px] text-gray-400">
            © 2026. Confidential &amp; Proprietary.
          </p>
        </div>
      </footer>
    </div>
  );
}
