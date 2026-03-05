"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  FileText,
  Presentation,
  Sheet,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Globe,
  GraduationCap,
  Target,
  BarChart3,
  FileOutput,
} from "lucide-react";
import {
  getRunStatus,
  submitGate1,
  submitGate2,
  submitGate3,
  getDownloadUrl,
  type RunStatusResponse,
  type PipelineStatus,
  type EntryMode,
  type AudienceType,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

const PIPELINE_STEPS = [
  {
    key: "research",
    label: "Research Phase",
    description: "Country/state profile & education analysis",
    icon: Globe,
  },
  {
    key: "gate1",
    label: "Decision Gate 1",
    description: "Confirm entry mode",
    icon: Target,
  },
  {
    key: "strategy",
    label: "Strategy Phase",
    description: "Go-to-market strategy & business rules",
    icon: GraduationCap,
  },
  {
    key: "gate2",
    label: "Decision Gate 2",
    description: "Confirm scale, pricing & audience",
    icon: Target,
  },
  {
    key: "generation",
    label: "Output Generation",
    description: "Financial model & documents",
    icon: BarChart3,
  },
  {
    key: "gate3",
    label: "Final Review",
    description: "Review & approve deliverables",
    icon: Target,
  },
  {
    key: "complete",
    label: "Complete",
    description: "Deliverables ready for download",
    icon: FileOutput,
  },
];

function getStepIndex(status: PipelineStatus): number {
  switch (status) {
    case "pending":
    case "researching":
      return 0;
    case "awaiting_gate_1":
      return 1;
    case "strategizing":
      return 2;
    case "awaiting_gate_2":
      return 3;
    case "generating":
      return 4;
    case "awaiting_gate_3":
      return 5;
    case "completed":
      return 6;
    default:
      return 0;
  }
}

function getProgressPercent(status: PipelineStatus): number {
  const idx = getStepIndex(status);
  return Math.round((idx / (PIPELINE_STEPS.length - 1)) * 100);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RunPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.id as string;

  const [data, setData] = useState<RunStatusResponse | null>(null);
  const [polling, setPolling] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // Gate 1 state
  const [g1EntryMode, setG1EntryMode] = useState<EntryMode>("hybrid");
  const [g1Notes, setG1Notes] = useState("");

  // Gate 2 state
  const [g2StudentCount, setG2StudentCount] = useState("");
  const [g2Pricing, setG2Pricing] = useState("");
  const [g2Audience, setG2Audience] = useState<AudienceType>("investor");
  const [g2Notes, setG2Notes] = useState("");

  // Gate 3 state
  const [g3Notes, setG3Notes] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const result = await getRunStatus(runId);
      setData(result);

      // Stop polling when waiting for user input or done
      if (
        result.status === "awaiting_gate_1" ||
        result.status === "awaiting_gate_2" ||
        result.status === "awaiting_gate_3" ||
        result.status === "completed" ||
        result.status === "error"
      ) {
        setPolling(false);
      }

      // Pre-fill Gate 2 fields from strategy if available
      if (result.status === "awaiting_gate_2" && result.strategy) {
        if (result.strategy.target_student_count_year5 && !g2StudentCount) {
          setG2StudentCount(
            String(result.strategy.target_student_count_year5)
          );
        }
        if (result.strategy.per_student_budget && !g2Pricing) {
          setG2Pricing(String(result.strategy.per_student_budget));
        }
      }
    } catch {
      setPolling(false);
    }
  }, [runId, g2StudentCount, g2Pricing]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [polling, fetchStatus]);

  // ---------------------------------------------------------------------------
  // Gate handlers
  // ---------------------------------------------------------------------------

  async function handleGate1Submit() {
    setSubmitting(true);
    try {
      const result = await submitGate1(runId, {
        entry_mode: g1EntryMode,
        notes: g1Notes || undefined,
      });
      setData(result);
      setPolling(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGate2Submit() {
    setSubmitting(true);
    try {
      const result = await submitGate2(runId, {
        confirmed_student_count: g2StudentCount
          ? parseInt(g2StudentCount)
          : undefined,
        confirmed_pricing: g2Pricing ? parseFloat(g2Pricing) : undefined,
        audience: g2Audience,
        notes: g2Notes || undefined,
      });
      setData(result);
      setPolling(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGate3Submit(approved: boolean) {
    setSubmitting(true);
    try {
      const result = await submitGate3(runId, {
        approved,
        revision_notes: g3Notes || undefined,
      });
      setData(result);
      if (approved) {
        setPolling(true);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!data) {
    return (
      <div className="container mx-auto px-6 py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-slate-400" />
        <p className="mt-4 text-slate-500">Loading pipeline status...</p>
      </div>
    );
  }

  const currentStep = getStepIndex(data.status);
  const progressPercent = getProgressPercent(data.status);
  const isActive = [
    "researching",
    "strategizing",
    "generating",
  ].includes(data.status);

  return (
    <div className="container mx-auto px-6 py-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">{data.target}</h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge
              variant="outline"
              className={
                data.status === "completed"
                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                  : data.status === "error"
                  ? "bg-red-100 text-red-800 border-red-300"
                  : isActive
                  ? "bg-blue-100 text-blue-800 border-blue-300"
                  : "bg-amber-100 text-amber-800 border-amber-300"
              }
            >
              {isActive && (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              )}
              {data.status.replace(/_/g, " ").toUpperCase()}
            </Badge>
            {data.tier && (
              <Badge variant="outline">Tier {data.tier}</Badge>
            )}
            {data.target_type && (
              <Badge variant="secondary">
                {data.target_type === "us_state"
                  ? "US State"
                  : "Sovereign Nation"}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Progress */}
      <Card className="mb-8 border-slate-200">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
            <span>Pipeline Progress</span>
            <span>{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2 mb-6" />

          <div className="grid grid-cols-7 gap-1">
            {PIPELINE_STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isCompleted = idx < currentStep;
              const isCurrent = idx === currentStep;
              return (
                <div key={step.key} className="text-center">
                  <div
                    className={`mx-auto mb-2 h-10 w-10 rounded-full flex items-center justify-center ${
                      isCompleted
                        ? "bg-emerald-100 text-emerald-600"
                        : isCurrent
                        ? "bg-blue-100 text-blue-600 ring-2 ring-blue-300"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : isCurrent && isActive ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  <p
                    className={`text-xs font-medium ${
                      isCurrent
                        ? "text-blue-600"
                        : isCompleted
                        ? "text-emerald-600"
                        : "text-slate-400"
                    }`}
                  >
                    {step.label}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {data.status === "error" && data.error_message && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{data.error_message}</AlertDescription>
        </Alert>
      )}

      {/* Gate 1: Entry Mode Decision */}
      {data.status === "awaiting_gate_1" && (
        <Card className="mb-8 border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-amber-600" />
              Decision Gate 1 — Market Mode
            </CardTitle>
            <CardDescription>
              Research is complete. Review the findings below and confirm the
              entry mode.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Entry Mode</Label>
              <Select
                value={g1EntryMode}
                onValueChange={(v) => setG1EntryMode(v as EntryMode)}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">
                    Private Schools Only
                  </SelectItem>
                  <SelectItem value="government">
                    Government Partnership
                  </SelectItem>
                  <SelectItem value="hybrid">
                    Hybrid (Private + Government)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Any specific instructions or overrides..."
                value={g1Notes}
                onChange={(e) => setG1Notes(e.target.value)}
                className="bg-white"
              />
            </div>
            <Button
              onClick={handleGate1Submit}
              disabled={submitting}
              className="bg-[#0A1F3C] hover:bg-[#0A1F3C]/90"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Confirm & Proceed to Strategy
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Gate 2: Scale & Pricing */}
      {data.status === "awaiting_gate_2" && (
        <Card className="mb-8 border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-amber-600" />
              Decision Gate 2 — Scale & Pricing
            </CardTitle>
            <CardDescription>
              Strategy is complete. Confirm target student count, pricing, and
              audience for documents.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Target Student Count (Year 5)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 50000"
                  value={g2StudentCount}
                  onChange={(e) => setG2StudentCount(e.target.value)}
                  className="bg-white"
                />
              </div>
              <div>
                <Label>Per-Student Budget ($)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 15000"
                  value={g2Pricing}
                  onChange={(e) => setG2Pricing(e.target.value)}
                  className="bg-white"
                />
              </div>
              <div>
                <Label>Audience</Label>
                <Select
                  value={g2Audience}
                  onValueChange={(v) => setG2Audience(v as AudienceType)}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="royal">Royal / Head of State</SelectItem>
                    <SelectItem value="minister">
                      Minister of Education
                    </SelectItem>
                    <SelectItem value="investor">PE / SWF Investor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Any overrides to school types, pricing tiers, etc."
                value={g2Notes}
                onChange={(e) => setG2Notes(e.target.value)}
                className="bg-white"
              />
            </div>
            <Button
              onClick={handleGate2Submit}
              disabled={submitting}
              className="bg-[#0A1F3C] hover:bg-[#0A1F3C]/90"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Confirm & Generate Documents
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Gate 3: Output Review */}
      {data.status === "awaiting_gate_3" && (
        <Card className="mb-8 border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-amber-600" />
              Decision Gate 3 — Output Review
            </CardTitle>
            <CardDescription>
              Documents have been generated. Review the outputs below and
              approve or request revisions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Revision Notes (optional)</Label>
              <Textarea
                placeholder="Specific changes needed..."
                value={g3Notes}
                onChange={(e) => setG3Notes(e.target.value)}
                className="bg-white"
              />
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => handleGate3Submit(true)}
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Approve & Finalize
              </Button>
              <Button
                variant="outline"
                onClick={() => handleGate3Submit(false)}
                disabled={submitting}
              >
                Request Revisions
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Downloads (available after Gate 3 or completion) */}
      {(data.status === "awaiting_gate_3" || data.status === "completed") &&
        (data.pptx_path || data.docx_path || data.xlsx_path) && (
          <Card className="mb-8 border-emerald-200 bg-emerald-50/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-emerald-800">
                <Download className="h-5 w-5" />
                Deliverables
              </CardTitle>
              <CardDescription>
                Download your generated proposal package
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {data.pptx_path && (
                  <a
                    href={getDownloadUrl(runId, "pptx")}
                    className="flex items-center gap-3 p-4 rounded-lg border border-emerald-200 bg-white hover:bg-emerald-50 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
                      <Presentation className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-slate-900">
                        Pitch Deck
                      </p>
                      <p className="text-xs text-slate-500">.pptx</p>
                    </div>
                    <Download className="h-4 w-4 text-slate-400 ml-auto" />
                  </a>
                )}
                {data.docx_path && (
                  <a
                    href={getDownloadUrl(runId, "docx")}
                    className="flex items-center gap-3 p-4 rounded-lg border border-emerald-200 bg-white hover:bg-emerald-50 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-slate-900">
                        Narrative Proposal
                      </p>
                      <p className="text-xs text-slate-500">.docx</p>
                    </div>
                    <Download className="h-4 w-4 text-slate-400 ml-auto" />
                  </a>
                )}
                {data.xlsx_path && (
                  <a
                    href={getDownloadUrl(runId, "xlsx")}
                    className="flex items-center gap-3 p-4 rounded-lg border border-emerald-200 bg-white hover:bg-emerald-50 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <Sheet className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-slate-900">
                        Financial Model
                      </p>
                      <p className="text-xs text-slate-500">.xlsx</p>
                    </div>
                    <Download className="h-4 w-4 text-slate-400 ml-auto" />
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Research Data Display */}
      {data.country_profile && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Country Profile */}
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4 text-blue-600" />
                Country/State Profile
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-80">
                <div className="space-y-3 text-sm">
                  {data.country_profile.demographics?.total_population && (
                    <DataRow
                      label="Population"
                      value={formatNumber(
                        data.country_profile.demographics.total_population
                      )}
                    />
                  )}
                  {data.country_profile.demographics?.population_0_18 && (
                    <DataRow
                      label="School-Age Pop."
                      value={formatNumber(
                        data.country_profile.demographics.population_0_18
                      )}
                    />
                  )}
                  {data.country_profile.economy?.gdp_per_capita && (
                    <DataRow
                      label="GDP per Capita"
                      value={formatCurrency(
                        data.country_profile.economy.gdp_per_capita
                      )}
                    />
                  )}
                  {data.country_profile.economy?.gdp && (
                    <DataRow
                      label="GDP"
                      value={formatCurrency(
                        data.country_profile.economy.gdp,
                        true
                      )}
                    />
                  )}
                  {data.country_profile.education?.k12_enrolled && (
                    <DataRow
                      label="K-12 Students"
                      value={formatNumber(
                        data.country_profile.education.k12_enrolled
                      )}
                    />
                  )}
                  {data.country_profile.education?.avg_private_tuition && (
                    <DataRow
                      label="Avg Private Tuition"
                      value={formatCurrency(
                        data.country_profile.education.avg_private_tuition
                      )}
                    />
                  )}
                  {data.country_profile.education?.literacy_rate && (
                    <DataRow
                      label="Literacy Rate"
                      value={`${data.country_profile.education.literacy_rate}%`}
                    />
                  )}
                  {data.country_profile.regulatory?.foreign_ownership_rules && (
                    <DataRow
                      label="Foreign Ownership"
                      value={
                        data.country_profile.regulatory.foreign_ownership_rules
                      }
                    />
                  )}
                  {data.country_profile.political_context?.national_vision_plan && (
                    <DataRow
                      label="National Vision"
                      value={
                        data.country_profile.political_context
                          .national_vision_plan
                      }
                    />
                  )}
                  {data.country_profile.us_state_esa?.esa_amount && (
                    <>
                      <Separator className="my-2" />
                      <DataRow
                        label="ESA Amount"
                        value={data.country_profile.us_state_esa.esa_amount}
                      />
                      {data.country_profile.us_state_esa.students_on_vouchers && (
                        <DataRow
                          label="Students on Vouchers"
                          value={
                            data.country_profile.us_state_esa
                              .students_on_vouchers
                          }
                        />
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Education Analysis */}
          {data.education_analysis && (
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-emerald-600" />
                  Education Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-80">
                  <div className="space-y-4 text-sm">
                    {data.education_analysis.system_diagnosis
                      ?.primary_pain_points?.length > 0 && (
                      <div>
                        <p className="font-semibold text-slate-700 mb-1">
                          Primary Pain Points
                        </p>
                        <ul className="space-y-1">
                          {data.education_analysis.system_diagnosis.primary_pain_points.map(
                            (p: string, i: number) => (
                              <li
                                key={i}
                                className="text-slate-600 pl-3 border-l-2 border-red-200"
                              >
                                {p}
                              </li>
                            )
                          )}
                        </ul>
                      </div>
                    )}
                    {data.education_analysis.two_hr_learning_fit
                      ?.unique_value_propositions?.length > 0 && (
                      <div>
                        <p className="font-semibold text-slate-700 mb-1">
                          Alpha Value Propositions
                        </p>
                        <ul className="space-y-1">
                          {data.education_analysis.two_hr_learning_fit.unique_value_propositions.map(
                            (p: string, i: number) => (
                              <li
                                key={i}
                                className="text-slate-600 pl-3 border-l-2 border-emerald-200"
                              >
                                {p}
                              </li>
                            )
                          )}
                        </ul>
                      </div>
                    )}
                    {data.education_analysis.two_hr_learning_fit
                      ?.model_recommendation && (
                      <DataRow
                        label="Recommended Model"
                        value={
                          data.education_analysis.two_hr_learning_fit
                            .model_recommendation
                        }
                      />
                    )}
                    {data.education_analysis.two_hr_learning_fit?.rationale && (
                      <div>
                        <p className="font-semibold text-slate-700 mb-1">
                          Rationale
                        </p>
                        <p className="text-slate-600">
                          {
                            data.education_analysis.two_hr_learning_fit
                              .rationale
                          }
                        </p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Strategy Display */}
      {data.strategy && (
        <Card className="mb-8 border-slate-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-violet-600" />
              Strategy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
              <div className="space-y-2">
                <p className="font-semibold text-slate-700">Structure</p>
                {data.strategy.entry_mode && (
                  <DataRow
                    label="Entry Mode"
                    value={data.strategy.entry_mode}
                  />
                )}
                {data.strategy.partnership_structure?.type && (
                  <DataRow
                    label="Partnership"
                    value={data.strategy.partnership_structure.type.toUpperCase()}
                  />
                )}
                {data.strategy.upfront_ask > 0 && (
                  <DataRow
                    label="Upfront Ask"
                    value={formatCurrency(data.strategy.upfront_ask, true)}
                  />
                )}
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-slate-700">Scale</p>
                {data.strategy.target_student_count_year5 && (
                  <DataRow
                    label="Students (Y5)"
                    value={formatNumber(
                      data.strategy.target_student_count_year5
                    )}
                  />
                )}
                {data.strategy.per_student_budget && (
                  <DataRow
                    label="Per-Student Budget"
                    value={formatCurrency(data.strategy.per_student_budget)}
                  />
                )}
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-slate-700">School Types</p>
                {data.strategy.school_types?.map(
                  (st: any, i: number) => (
                    <div
                      key={i}
                      className="pl-3 border-l-2 border-violet-200"
                    >
                      <p className="font-medium text-slate-700">{st.name}</p>
                      <p className="text-slate-500">
                        {st.size} — {st.tuition}
                      </p>
                    </div>
                  )
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Financial Summary */}
      {data.financial_model && data.financial_model.pnl_projection?.length > 0 && (
        <Card className="mb-8 border-slate-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-amber-600" />
              Financial Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {data.financial_model.returns_analysis?.irr && (
                <div className="p-3 rounded-lg bg-slate-50 text-center">
                  <p className="text-2xl font-bold text-slate-900">
                    {data.financial_model.returns_analysis.irr}%
                  </p>
                  <p className="text-xs text-slate-500">Projected IRR</p>
                </div>
              )}
              {data.financial_model.returns_analysis?.moic && (
                <div className="p-3 rounded-lg bg-slate-50 text-center">
                  <p className="text-2xl font-bold text-slate-900">
                    {data.financial_model.returns_analysis.moic}x
                  </p>
                  <p className="text-xs text-slate-500">MOIC</p>
                </div>
              )}
              {data.financial_model.pnl_projection.length >= 5 && (
                <div className="p-3 rounded-lg bg-slate-50 text-center">
                  <p className="text-2xl font-bold text-slate-900">
                    {formatCurrency(
                      data.financial_model.pnl_projection[4].revenue,
                      true
                    )}
                  </p>
                  <p className="text-xs text-slate-500">Year 5 Revenue</p>
                </div>
              )}
              {data.financial_model.returns_analysis
                ?.enterprise_value_at_exit && (
                <div className="p-3 rounded-lg bg-slate-50 text-center">
                  <p className="text-2xl font-bold text-slate-900">
                    {formatCurrency(
                      data.financial_model.returns_analysis
                        .enterprise_value_at_exit,
                      true
                    )}
                  </p>
                  <p className="text-xs text-slate-500">Exit Value</p>
                </div>
              )}
            </div>

            {/* P&L Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="text-left py-2 pr-4 font-medium">Year</th>
                    <th className="text-right py-2 px-2 font-medium">
                      Students
                    </th>
                    <th className="text-right py-2 px-2 font-medium">
                      Revenue
                    </th>
                    <th className="text-right py-2 px-2 font-medium">
                      EBITDA
                    </th>
                    <th className="text-right py-2 pl-2 font-medium">
                      Net Income
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.financial_model.pnl_projection.map((yr: any) => (
                    <tr
                      key={yr.year}
                      className="border-b border-slate-100"
                    >
                      <td className="py-2 pr-4 font-medium text-slate-700">
                        Year {yr.year}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-600">
                        {formatNumber(yr.students)}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-600">
                        {formatCurrency(yr.revenue, true)}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-600">
                        {formatCurrency(yr.ebitda, true)}
                      </td>
                      <td className="py-2 pl-2 text-right text-slate-600">
                        {formatCurrency(yr.net_income, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent Logs */}
      {data.agent_logs && data.agent_logs.length > 0 && (
        <Card className="border-slate-200">
          <CardHeader
            className="cursor-pointer"
            onClick={() => setShowLogs(!showLogs)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-400" />
                Agent Logs ({data.agent_logs.length})
              </CardTitle>
              {showLogs ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </div>
          </CardHeader>
          {showLogs && (
            <CardContent>
              <ScrollArea className="h-48">
                <div className="space-y-1 font-mono text-xs">
                  {data.agent_logs.map((log, i) => (
                    <p key={i} className="text-slate-600">
                      {log}
                    </p>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utility components
// ---------------------------------------------------------------------------

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-900 font-medium text-right">{value}</span>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number, compact: boolean = false): string {
  if (compact) {
    if (Math.abs(n) >= 1_000_000_000)
      return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  }
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
