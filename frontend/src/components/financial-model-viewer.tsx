"use client";

import { useState, useCallback, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { FinancialModel, FinancialAssumption } from "@/lib/api";

interface FinancialModelViewerProps {
  model: FinancialModel;
  assumptions: FinancialAssumption[];
  onLock: (adjustments: Record<string, number>) => void;
  onRecalculate: (adjustments: Record<string, number>) => void;
  loading?: boolean;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const KEY_ASSUMPTION_KEYS = new Set([
  "premium_tuition", "mid_tuition", "cogs_pct", "opex_pct", "students_year5", "exit_ebitda_multiple",
]);

export function FinancialModelViewer({
  model,
  assumptions,
  onLock,
  onRecalculate,
  loading,
}: FinancialModelViewerProps) {
  const [sliderValues, setSliderValues] = useState<Record<string, number>>(() => {
    const v: Record<string, number> = {};
    assumptions.forEach((a) => { v[a.key] = a.value; });
    return v;
  });

  const handleSliderChange = useCallback((key: string, val: number) => {
    setSliderValues((prev) => {
      const next = { ...prev, [key]: val };
      return next;
    });
  }, []);

  const getAdjustments = useCallback(() => {
    const adj: Record<string, number> = {};
    assumptions.forEach((a) => {
      if (sliderValues[a.key] !== a.value) adj[a.key] = sliderValues[a.key];
    });
    return adj;
  }, [sliderValues, assumptions]);

  // Key adjustable sliders for the model view — memoized to avoid re-filtering on every render
  const keyAssumptions = useMemo(
    () => assumptions.filter((a) => KEY_ASSUMPTION_KEYS.has(a.key)),
    [assumptions]
  );

  const y5 = model.pnl_projection[model.pnl_projection.length - 1];

  return (
    <div className="space-y-6">
      {/* Key Metrics Header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Y5 Revenue", value: fmt(y5?.revenue || 0), color: "text-emerald-400" },
          { label: "Y5 EBITDA", value: fmt(y5?.ebitda || 0), color: "text-blue-400" },
          { label: "IRR", value: model.returns_analysis.irr ? `${model.returns_analysis.irr}%` : "—", color: "text-purple-400" },
          { label: "MOIC", value: model.returns_analysis.moic ? `${model.returns_analysis.moic}x` : "—", color: "text-amber-400" },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-4 text-center">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{m.label}</div>
            <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* P&L Table */}
      <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-5 overflow-x-auto">
        <h3 className="text-lg font-semibold text-white mb-4">5-Year P&L Projection</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-2 px-3 text-gray-400 font-medium">Metric</th>
              {model.pnl_projection.map((p) => (
                <th key={p.year} className="text-right py-2 px-3 text-gray-400 font-medium">
                  Year {p.year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {([
              { label: "Students", key: "students", format: (n: number) => n.toLocaleString() },
              { label: "Schools", key: "schools", format: (n: number) => n.toLocaleString() },
              { label: "Revenue", key: "revenue", format: fmt },
              { label: "COGS", key: "cogs", format: fmt },
              { label: "Gross Margin", key: "gross_margin", format: fmt },
              { label: "OpEx", key: "opex", format: fmt },
              { label: "EBITDA", key: "ebitda", format: fmt },
              { label: "Net Income", key: "net_income", format: fmt },
              { label: "Free Cash Flow", key: "free_cash_flow", format: fmt },
              { label: "Cumulative Cash", key: "cumulative_cash", format: fmt },
            ] as { label: string; key: string; format: (n: number) => string }[]).map((row) => (
              <tr key={row.key} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-2 px-3 text-gray-300 font-medium">{row.label}</td>
                {model.pnl_projection.map((p) => (
                  <td key={p.year} className="text-right py-2 px-3 text-gray-200 tabular-nums">
                    {row.format((p as unknown as Record<string, number>)[row.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Unit Economics */}
      <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-5">
        <h3 className="text-lg font-semibold text-white mb-4">Unit Economics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {model.unit_economics.map((ue) => (
            <div key={ue.school_type} className="rounded-lg border border-white/5 bg-white/5 p-4">
              <div className="text-sm font-semibold text-white mb-2">{ue.school_type}</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-gray-400">Revenue/Student</div>
                <div className="text-right text-gray-200 tabular-nums">{fmt(ue.per_student_revenue)}</div>
                <div className="text-gray-400">Cost/Student</div>
                <div className="text-right text-gray-200 tabular-nums">{fmt(ue.per_student_cost)}</div>
                <div className="text-gray-400">Margin/Student</div>
                <div className="text-right text-emerald-400 tabular-nums">{fmt(ue.contribution_margin)}</div>
                <div className="text-gray-400">Margin %</div>
                <div className="text-right text-emerald-400 tabular-nums">{ue.margin_pct}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Returns Analysis */}
      <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-5">
        <h3 className="text-lg font-semibold text-white mb-4">Returns Analysis</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: "IRR", value: model.returns_analysis.irr ? `${model.returns_analysis.irr}%` : "—" },
            { label: "MOIC", value: model.returns_analysis.moic ? `${model.returns_analysis.moic}x` : "—" },
            { label: "Exit EV", value: model.returns_analysis.enterprise_value_at_exit ? fmt(model.returns_analysis.enterprise_value_at_exit) : "—" },
            { label: "Payback", value: model.returns_analysis.payback_period_years ? `${model.returns_analysis.payback_period_years} yrs` : "—" },
            { label: "Mgmt Fee Rev (5yr)", value: fmt(model.total_management_fee_revenue) },
            { label: "License Rev (5yr)", value: fmt(model.total_timeback_license_revenue) },
          ].map((r) => (
            <div key={r.label} className="rounded-lg border border-white/5 bg-white/5 p-3 text-center">
              <div className="text-xs text-gray-500 mb-1">{r.label}</div>
              <div className="text-lg font-bold text-white">{r.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sensitivity */}
      {model.sensitivity.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-5">
          <h3 className="text-lg font-semibold text-white mb-4">Sensitivity Analysis</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-2 px-3 text-gray-400">Variable</th>
                <th className="text-right py-2 px-3 text-red-400">Downside</th>
                <th className="text-right py-2 px-3 text-gray-400">Base</th>
                <th className="text-right py-2 px-3 text-emerald-400">Upside</th>
              </tr>
            </thead>
            <tbody>
              {model.sensitivity.map((s) => (
                <tr key={s.variable} className="border-b border-white/5">
                  <td className="py-2 px-3 text-gray-300">{s.variable}</td>
                  <td className="text-right py-2 px-3 text-red-400 tabular-nums">{s.downside.toLocaleString()}</td>
                  <td className="text-right py-2 px-3 text-gray-300 tabular-nums">{s.base_case.toLocaleString()}</td>
                  <td className="text-right py-2 px-3 text-emerald-400 tabular-nums">{s.upside.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Interactive Sliders */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Adjust Key Assumptions</h3>
          <p className="text-sm text-gray-400 mt-1">
            Use the sliders to adjust assumptions and see the impact on the model. Click &quot;Recalculate&quot; to update.
          </p>
        </div>

        <div className="space-y-4">
          {keyAssumptions.map((a) => (
            <div key={a.key} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-300">{a.label}</span>
                <span className="text-white font-mono font-bold">
                  {a.unit === "$" ? `$${(sliderValues[a.key] || a.value).toLocaleString()}` :
                   a.unit === "%" ? `${sliderValues[a.key] || a.value}%` :
                   a.unit === "x" ? `${sliderValues[a.key] || a.value}x` :
                   (sliderValues[a.key] || a.value).toLocaleString()}
                </span>
              </div>
              <Slider
                value={[sliderValues[a.key] ?? a.value]}
                onValueChange={(v) => handleSliderChange(a.key, v[0])}
                min={a.min_val}
                max={a.max_val}
                step={a.step}
                disabled={a.locked}
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            onClick={() => onRecalculate(getAdjustments())}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            {loading ? "Recalculating..." : "Recalculate Model"}
          </Button>
          <Button
            onClick={() => onLock(getAdjustments())}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6"
          >
            🔒 Lock Model & Generate Documents
          </Button>
        </div>
      </div>
    </div>
  );
}
