"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface FeedbackFormProps {
  title: string;
  description: string;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
  loading?: boolean;
  extraControls?: React.ReactNode;
}

export function FeedbackForm({
  title,
  description,
  onApprove,
  onRequestChanges,
  loading,
  extraControls,
}: FeedbackFormProps) {
  const [mode, setMode] = useState<"idle" | "feedback">("idle");
  const [feedback, setFeedback] = useState("");

  return (
    <div className="rounded-xl border border-white/10 bg-[#1a1a2e]/80 p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="text-sm text-gray-400 mt-1">{description}</p>
      </div>

      {extraControls && <div className="border-t border-white/10 pt-4">{extraControls}</div>}

      {mode === "idle" ? (
        <div className="flex gap-3 pt-2">
          <Button
            onClick={onApprove}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                Processing...
              </span>
            ) : (
              <>
                <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Approve & Continue
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setMode("feedback")}
            disabled={loading}
            className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10 font-medium"
          >
            <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Request Changes
          </Button>
        </div>
      ) : (
        <div className="space-y-3 pt-2">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe what changes you'd like to see..."
            className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-white placeholder-gray-500 focus:border-[#006D77] focus:outline-none focus:ring-1 focus:ring-[#006D77] min-h-[120px] resize-y"
          />
          <div className="flex gap-3">
            <Button
              onClick={() => {
                if (feedback.trim()) onRequestChanges(feedback.trim());
              }}
              disabled={loading || !feedback.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white font-medium"
            >
              {loading ? "Revising..." : "Submit Feedback & Revise"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => { setMode("idle"); setFeedback(""); }}
              disabled={loading}
              className="text-gray-400 hover:text-white"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
