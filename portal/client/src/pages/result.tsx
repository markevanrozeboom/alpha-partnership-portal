import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Loader2,
  Users,
  DollarSign,
  GraduationCap,
  Landmark,
  Lightbulb,
  Handshake,
  Building2,
  TrendingUp,
  Shield,
  Briefcase,
  RefreshCw,
} from "lucide-react";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import type { CountryFacts } from "@shared/schema";

interface RunData {
  id: string;
  target: string;
  status: "pending" | "generating" | "completed" | "error";
  result: CountryFacts | null;
  error: string | null;
}

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = params.id;

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
  const facts = data?.result;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-destructive text-sm">Failed to load run data.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => navigate("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            New Search
          </Button>
          <span className="text-xs text-muted-foreground font-medium tracking-wide">
            2hr Learning
          </span>
        </div>
      </header>

      <main className="flex-1 px-6 py-10">
        <div className="max-w-3xl mx-auto space-y-8">
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
                <p className="text-sm font-medium">Generating briefing for {data?.target}...</p>
                <p className="text-xs text-muted-foreground">This typically takes 10-15 seconds</p>
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
                  {data?.error || "An unexpected error occurred. Please try again."}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Try Again
              </Button>
            </div>
          )}

          {/* Results */}
          {isComplete && facts && (
            <div className="space-y-8 animate-in fade-in duration-500" data-testid="status-completed">
              {/* Country header */}
              <div className="text-center space-y-2">
                <span className="text-4xl" data-testid="text-flag">{facts.flagEmoji}</span>
                <h1 className="text-xl font-semibold tracking-tight" data-testid="text-country">
                  {facts.formalName}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {facts.headOfStateTitle}: {facts.headOfState}
                </p>
              </div>

              <Separator />

              {/* 5 Key Data Points */}
              <section className="space-y-4">
                <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                  Market Snapshot
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FactCard
                    icon={Users}
                    label="School-Age Population"
                    value={facts.facts.schoolAgePopulation}
                  />
                  <FactCard
                    icon={DollarSign}
                    label="GDP per Capita"
                    value={facts.facts.gdpPerCapita}
                  />
                  <FactCard
                    icon={GraduationCap}
                    label="Government Education Spend"
                    value={facts.facts.govEducationSpend}
                  />
                  <FactCard
                    icon={Landmark}
                    label="National Education Vision"
                    value={facts.facts.nationalEdVision}
                  />
                  <FactCard
                    icon={Lightbulb}
                    label="Key Opportunity"
                    value={facts.facts.keyOpportunity}
                    className="sm:col-span-2"
                  />
                </div>
              </section>

              <Separator />

              {/* Sales Pitch */}
              <section className="space-y-3">
                <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                  Partnership Narrative
                </h2>
                <Card className="bg-primary/5 border-primary/15">
                  <CardContent className="p-5">
                    <div className="flex gap-3">
                      <Handshake className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                      <p className="text-sm leading-relaxed" data-testid="text-pitch">
                        {facts.salesPitch}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <Separator />

              {/* Fixed Economics */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                    Deal Economics
                  </h2>
                  <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                    Fixed structure
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <EconCard
                    icon={Building2}
                    label="Flagship School"
                    value={facts.economics.flagshipSchoolFee}
                  />
                  <EconCard
                    icon={Shield}
                    label="National Program"
                    value={facts.economics.nationalProgramFee}
                  />
                  <EconCard
                    icon={Briefcase}
                    label="Development Investment"
                    value={facts.economics.devInvestment}
                  />
                  <EconCard
                    icon={Handshake}
                    label="Equity Model"
                    value={facts.economics.equityModel}
                  />
                </div>

                {/* Upside narrative */}
                <Card className="bg-accent/5 border-accent/15">
                  <CardContent className="p-5">
                    <div className="flex gap-3">
                      <TrendingUp className="h-5 w-5 text-accent flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-accent mb-1">Upside Potential</p>
                        <p className="text-sm leading-relaxed" data-testid="text-upside">
                          {facts.economics.upsideNarrative}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <Separator />

              {/* Generate another */}
              <div className="text-center py-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/")}
                  data-testid="button-new-search"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Generate Another Briefing
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-4 px-6 text-center">
        <p className="text-xs text-muted-foreground mb-2">
          CONFIDENTIAL — 2hr Learning (Alpha) — Partnership Portal
        </p>
        <PerplexityAttribution />
      </footer>
    </div>
  );
}

/* -- Data point card -- */
function FactCard({
  icon: Icon,
  label,
  value,
  className = "",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <Card className={`${className}`}>
      <CardContent className="p-4 flex gap-3">
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">
            {label}
          </p>
          <p className="text-sm leading-snug" data-testid={`text-fact-${label.toLowerCase().replace(/\s+/g, "-")}`}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* -- Economics card -- */
function EconCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex gap-3">
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">
            {label}
          </p>
          <p className="text-sm leading-snug" data-testid={`text-econ-${label.toLowerCase().replace(/\s+/g, "-")}`}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
