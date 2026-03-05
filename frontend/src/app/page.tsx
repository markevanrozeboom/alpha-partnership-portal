"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Globe,
  MapPin,
  ArrowRight,
  Search,
  TrendingUp,
  DollarSign,
  Users,
  Sparkles,
} from "lucide-react";
import {
  getCountries,
  getStates,
  createRun,
  type CountryOption,
  type StateOption,
} from "@/lib/api";

const TIER_COLORS: Record<number, string> = {
  1: "bg-amber-100 text-amber-800 border-amber-300",
  2: "bg-blue-100 text-blue-800 border-blue-300",
  3: "bg-emerald-100 text-emerald-800 border-emerald-300",
};

const TIER_LABELS: Record<number, string> = {
  1: 'Tier 1 — "UAE-Scale"',
  2: 'Tier 2 — "Mid-Market"',
  3: 'Tier 3 — "Emerging"',
};

export default function Home() {
  const router = useRouter();
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [states, setStates] = useState<StateOption[]>([]);
  const [customTarget, setCustomTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [countriesRes, statesRes] = await Promise.all([
          getCountries(),
          getStates(),
        ]);
        setCountries(countriesRes.countries);
        setStates(statesRes.states);
      } catch {
        // Use built-in data if API is unavailable
        setCountries([
          { name: "Saudi Arabia", tier: 1, region: "Middle East", potential: "$1B+", key_factors: "Vision 2030. 10.8M school-age pop." },
          { name: "Qatar", tier: 1, region: "Middle East", potential: "$300M–$500M", key_factors: "100% foreign ownership. GDP/cap ~$85K." },
          { name: "Singapore", tier: 1, region: "Asia Pacific", potential: "$200M–$400M", key_factors: "Premium market ($35K–$52K tuition)." },
          { name: "Switzerland", tier: 1, region: "Europe", potential: "$200M–$500M", key_factors: "Highest tuition globally." },
          { name: "India", tier: 3, region: "South Asia", potential: "$50M–$200M", key_factors: "250M K-12 students." },
          { name: "Brazil", tier: 2, region: "Latin America", potential: "$100M–$300M", key_factors: "47.3M K-12 students." },
          { name: "South Korea", tier: 2, region: "Asia Pacific", potential: "$100M–$250M", key_factors: "$35K–$54K premium tuition." },
          { name: "United Kingdom", tier: 2, region: "Europe", potential: "$100M–$200M", key_factors: "Fully open. No curriculum mandates." },
          { name: "Nigeria", tier: 3, region: "Africa", potential: "$25M–$75M", key_factors: "220M+ population." },
          { name: "Kenya", tier: 3, region: "Africa", potential: "$25M–$50M", key_factors: "Growing middle class." },
        ]);
        setStates([
          { name: "Florida", rank: 1, esa_amount: "$9,500–$10,700", students_on_vouchers: "500,000+", key_factors: "Largest school choice market." },
          { name: "Texas", rank: 2, esa_amount: "~$10,000–$10,200", students_on_vouchers: "~95,000", key_factors: "ESA launches 2026-27." },
          { name: "Arizona", rank: 3, esa_amount: "$7,000–$8,000", students_on_vouchers: "83,819", key_factors: "Pioneer ESA state." },
          { name: "Indiana", rank: 4, esa_amount: "$6,100–$7,400", students_on_vouchers: "79,448", key_factors: "Universal July 2026." },
          { name: "North Carolina", rank: 5, esa_amount: "$3,000–$7,000", students_on_vouchers: "103,400", key_factors: "Fastest growing ESA." },
        ]);
      }
    }
    loadData();
  }, []);

  async function handleStartRun(target: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await createRun(target);
      router.push(`/run/${result.run_id}`);
    } catch (err: any) {
      setError(err.message || "Failed to start pipeline");
      setLoading(false);
    }
  }

  async function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (customTarget.trim()) {
      await handleStartRun(customTarget.trim());
    }
  }

  return (
    <div className="container mx-auto px-6 py-10 max-w-7xl">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 text-sm text-amber-800 mb-6">
          <Sparkles className="h-4 w-4" />
          AI-Powered Proposal Generation
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-4">
          Global Expansion Pipeline
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Select a target country or US state to generate a customized education
          partnership proposal — complete with financial model, pitch deck, and
          narrative document.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <Card className="border-slate-200">
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center">
              <Globe className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">10</p>
              <p className="text-sm text-slate-500">Priority Countries</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="h-12 w-12 rounded-xl bg-emerald-50 flex items-center justify-center">
              <MapPin className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">5</p>
              <p className="text-sm text-slate-500">Priority US States</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="h-12 w-12 rounded-xl bg-amber-50 flex items-center justify-center">
              <DollarSign className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">$10B+</p>
              <p className="text-sm text-slate-500">Addressable Pipeline</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Custom Target */}
      <Card className="mb-8 border-slate-200">
        <CardContent className="pt-6">
          <form onSubmit={handleCustomSubmit} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Enter any country or US state name..."
                value={customTarget}
                onChange={(e) => setCustomTarget(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              type="submit"
              disabled={loading || !customTarget.trim()}
              className="bg-[#0A1F3C] hover:bg-[#0A1F3C]/90"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Starting...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Generate Proposal
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>
          {error && (
            <p className="text-sm text-red-600 mt-2">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Tabs: Countries / US States */}
      <Tabs defaultValue="countries">
        <TabsList className="mb-6">
          <TabsTrigger value="countries" className="gap-2">
            <Globe className="h-4 w-4" />
            Countries
          </TabsTrigger>
          <TabsTrigger value="states" className="gap-2">
            <MapPin className="h-4 w-4" />
            US States
          </TabsTrigger>
        </TabsList>

        <TabsContent value="countries">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {countries.map((country) => (
              <Card
                key={country.name}
                className="hover:shadow-lg transition-all cursor-pointer border-slate-200 hover:border-slate-300 group"
                onClick={() => !loading && handleStartRun(country.name)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg group-hover:text-blue-600 transition-colors">
                        {country.name}
                      </CardTitle>
                      <CardDescription>{country.region}</CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className={TIER_COLORS[country.tier]}
                    >
                      {TIER_LABELS[country.tier]}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm mb-3">
                    <div className="flex items-center gap-1.5 text-emerald-600">
                      <TrendingUp className="h-3.5 w-3.5" />
                      <span className="font-semibold">
                        {country.potential}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-500">
                    {country.key_factors}
                  </p>
                  <div className="mt-4 flex items-center text-xs text-blue-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    Generate Proposal
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="states">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {states.map((state) => (
              <Card
                key={state.name}
                className="hover:shadow-lg transition-all cursor-pointer border-slate-200 hover:border-slate-300 group"
                onClick={() => !loading && handleStartRun(state.name)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg group-hover:text-blue-600 transition-colors">
                        {state.name}
                      </CardTitle>
                      <CardDescription>US State — Rank #{state.rank}</CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className="bg-violet-100 text-violet-800 border-violet-300"
                    >
                      US State
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                    <div>
                      <p className="text-slate-500 text-xs">ESA Amount</p>
                      <p className="font-semibold text-slate-700">
                        {state.esa_amount}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs">
                        Students on Vouchers
                      </p>
                      <p className="font-semibold text-slate-700">
                        {state.students_on_vouchers}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-500">
                    {state.key_factors}
                  </p>
                  <div className="mt-4 flex items-center text-xs text-blue-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    Generate Proposal
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <footer className="mt-16 border-t pt-8 pb-12 text-center">
        <p className="text-sm text-slate-400">
          Alpha | 2hr Learning | Trilogy — Confidential & Proprietary
        </p>
      </footer>
    </div>
  );
}
