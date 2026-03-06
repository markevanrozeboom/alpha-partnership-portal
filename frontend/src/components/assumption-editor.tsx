"use client";

import { useState, useCallback, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { FinancialAssumption } from "@/lib/api";

interface AssumptionEditorProps {
  assumptions: FinancialAssumption[];
  onConfirm: (adjustments: Record<string, number>) => void;
  loading?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  pricing: "💰 Pricing",
  scale: "📈 Scale & Growth",
  costs: "🏗️ Cost Structure",
  fees: "🤝 Alpha Fee Structure",
  returns: "📊 Returns & Valuation",
};

const CATEGORY_ORDER = ["pricing", "scale", "costs", "fees", "returns"];

function formatValue(value: number, unit: string): string {
  if (unit === "$M") return `$${value.toLocaleString()}M`;
  if (unit === "$") return `$${value.toLocaleString()}`;
  if (unit === "%") return `${value}%`;
  if (unit === "x") return `${value}x`;
  if (unit === "students") return value.toLocaleString();
  if (unit === "years") return `${value} yrs`;
  return value.toLocaleString();
}

export function AssumptionEditor({ assumptions, onConfirm, loading }: AssumptionEditorProps) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const v: Record<string, number> = {};
    assumptions.forEach((a) => { v[a.key] = a.value; });
    return v;
  });

  const handleChange = useCallback((key: string, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  const adjustments = useMemo(() => {
    const adj: Record<string, number> = {};
    assumptions.forEach((a) => {
      if (values[a.key] !== a.value) adj[a.key] = values[a.key];
    });
    return adj;
  }, [values, assumptions]);

  const grouped = useMemo(() => {
    const g: Record<string, FinancialAssumption[]> = {};
    assumptions.forEach((a) => {
      if (!g[a.category]) g[a.category] = [];
      g[a.category].push(a);
    });
    return g;
  }, [assumptions]);

  const hasChanges = Object.keys(adjustments).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Financial Assumptions</h2>
          <p className="text-sm text-gray-400 mt-1">
            Review and adjust the key assumptions driving the financial model. Locked items are non-negotiable fee floors.
          </p>
        </div>
        {hasChanges && (
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-400">
            {Object.keys(adjustments).length} changed
          </span>
        )}
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const items = grouped[cat];
        if (!items || items.length === 0) return null;
        return (
          <div key={cat} className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-5 space-y-4">
            <h3 className="text-lg font-semibold text-white">
              {CATEGORY_LABELS[cat] || cat}
            </h3>
            <div className="space-y-5">
              {items.map((a) => (
                <AssumptionSlider
                  key={a.key}
                  assumption={a}
                  value={values[a.key]}
                  onChange={(v) => handleChange(a.key, v)}
                />
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex gap-3">
        <Button
          onClick={() => onConfirm(adjustments)}
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6"
        >
          {loading ? "Building Model..." : "Confirm Assumptions & Build Model"}
        </Button>
        {hasChanges && (
          <Button
            variant="outline"
            onClick={() => {
              const reset: Record<string, number> = {};
              assumptions.forEach((a) => { reset[a.key] = a.value; });
              setValues(reset);
            }}
            className="border-white/20 text-gray-400 hover:text-white"
          >
            Reset to Defaults
          </Button>
        )}
      </div>
    </div>
  );
}

function AssumptionSlider({
  assumption,
  value,
  onChange,
}: {
  assumption: FinancialAssumption;
  value: number;
  onChange: (v: number) => void;
}) {
  const isChanged = value !== assumption.value;

  return (
    <div className={`rounded-lg p-3 transition-colors ${isChanged ? "bg-amber-500/5 ring-1 ring-amber-500/20" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">{assumption.label}</span>
          {assumption.locked && (
            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400 uppercase tracking-wider">
              locked
            </span>
          )}
          {isChanged && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
              modified
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold tabular-nums ${isChanged ? "text-amber-400" : "text-white"}`}>
            {formatValue(value, assumption.unit)}
          </span>
        </div>
      </div>

      {assumption.description && (
        <p className="text-xs text-gray-500 mb-2">{assumption.description}</p>
      )}

      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 w-16 text-right tabular-nums">
          {formatValue(assumption.min_val, assumption.unit)}
        </span>
        <Slider
          value={[value]}
          onValueChange={(v) => !assumption.locked && onChange(v[0])}
          min={assumption.min_val}
          max={assumption.max_val}
          step={assumption.step}
          disabled={assumption.locked}
          className={`flex-1 ${assumption.locked ? "opacity-50" : ""}`}
        />
        <span className="text-xs text-gray-500 w-16 tabular-nums">
          {formatValue(assumption.max_val, assumption.unit)}
        </span>
      </div>
    </div>
  );
}
