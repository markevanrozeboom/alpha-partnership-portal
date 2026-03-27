import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowRight, Globe, FileText, Presentation, ExternalLink } from "lucide-react";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

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
    <div className="min-h-screen flex flex-col bg-background">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-20">
        <div className="max-w-2xl w-full space-y-10 text-center">
          {/* Alpha bird logo */}
          <div className="flex items-center justify-center mb-2">
            <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 opacity-80">
              <polygon points="28,6 18,20 8,34 28,28 48,34 38,20" fill="currentColor" className="text-primary" opacity="0.9"/>
              <polygon points="8,34 28,28 20,44" fill="currentColor" className="text-primary" opacity="0.55"/>
              <polygon points="48,34 28,28 36,44" fill="currentColor" className="text-primary" opacity="0.55"/>
              <polygon points="20,44 28,28 36,44 28,52" fill="currentColor" className="text-primary" opacity="0.35"/>
            </svg>
          </div>

          {/* Brand mark */}
          <div className="inline-flex items-center gap-2.5 rounded-full bg-primary/10 border border-primary/20 px-5 py-2">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </div>
            <span className="text-sm font-semibold text-primary tracking-widest uppercase">
              Alpha Holdings, Inc.
            </span>
          </div>

          <div className="space-y-4">
            <h1
              className="text-2xl font-bold tracking-tight leading-tight"
              data-testid="text-hero-title"
            >
              National Partnership Portal
            </h1>
            <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed text-sm">
              Enter a country or US state. Receive an interactive Term Sheet
              website and Pitch Deck — built for sovereign presentation.
            </p>
          </div>

          {/* Input */}
          <div className="space-y-4 max-w-md mx-auto">
            <div className="relative">
              <Globe className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="e.g. United Arab Emirates, Rwanda, Texas..."
                className="pl-11 pr-4 h-12 text-sm bg-card border-border rounded-md"
                disabled={loading}
                data-testid="input-country"
              />
            </div>
            <Button
              onClick={handleGenerate}
              disabled={loading || !target.trim()}
              className="w-full h-12 text-sm font-semibold rounded-md tracking-wide"
              data-testid="button-generate"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Generating Documents...
                </>
              ) : (
                <>
                  Generate Term Sheet & Pitch Deck
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>

            {error && (
              <p className="text-destructive text-xs" data-testid="text-error">
                {error}
              </p>
            )}
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {[
              { icon: ExternalLink, label: "Interactive Website" },
              { icon: FileText, label: "Term Sheet" },
              { icon: Presentation, label: "Pitch Deck" },
              { icon: Globe, label: "Country-specific" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1.5"
              >
                <Icon className="h-3 w-3" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

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
