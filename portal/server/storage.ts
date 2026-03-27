import type { GenerationResult, FullGenerationResult, PipelineStatus } from "@shared/schema";

export interface RunData {
  id: string;
  target: string;
  status: "pending" | "generating" | "completed" | "error";
  result: GenerationResult | null;
  error: string | null;
  createdAt: Date;
}

export interface PipelineRunData {
  id: string;
  target: string;
  pipelineRunId: string | null;
  pipelineStatus: PipelineStatus;
  pipelineLabel: string;
  result: FullGenerationResult | null;
  error: string | null;
  agentLogs: string[];
  createdAt: Date;
}

export interface IStorage {
  createRun(target: string): RunData;
  getRun(id: string): RunData | undefined;
  updateRun(id: string, updates: Partial<RunData>): void;
  createPipelineRun(target: string): PipelineRunData;
  getPipelineRun(id: string): PipelineRunData | undefined;
  updatePipelineRun(id: string, updates: Partial<PipelineRunData>): void;
}

class MemStorage implements IStorage {
  private runs: Map<string, RunData> = new Map();
  private pipelineRuns: Map<string, PipelineRunData> = new Map();
  private nextId = 1;
  private nextPipelineId = 1;

  createRun(target: string): RunData {
    const id = String(this.nextId++);
    const run: RunData = {
      id,
      target,
      status: "pending",
      result: null,
      error: null,
      createdAt: new Date(),
    };
    this.runs.set(id, run);
    return run;
  }

  getRun(id: string): RunData | undefined {
    return this.runs.get(id);
  }

  updateRun(id: string, updates: Partial<RunData>): void {
    const run = this.runs.get(id);
    if (run) {
      Object.assign(run, updates);
    }
  }

  createPipelineRun(target: string): PipelineRunData {
    const id = `p${this.nextPipelineId++}`;
    const run: PipelineRunData = {
      id,
      target,
      pipelineRunId: null,
      pipelineStatus: "pending",
      pipelineLabel: "Initializing...",
      result: null,
      error: null,
      agentLogs: [],
      createdAt: new Date(),
    };
    this.pipelineRuns.set(id, run);
    return run;
  }

  getPipelineRun(id: string): PipelineRunData | undefined {
    return this.pipelineRuns.get(id);
  }

  updatePipelineRun(id: string, updates: Partial<PipelineRunData>): void {
    const run = this.pipelineRuns.get(id);
    if (run) {
      Object.assign(run, updates);
    }
  }
}

export const storage = new MemStorage();
