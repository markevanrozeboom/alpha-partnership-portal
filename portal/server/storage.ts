import type { CountryFacts } from "@shared/schema";

export interface RunData {
  id: string;
  target: string;
  status: "pending" | "generating" | "completed" | "error";
  result: CountryFacts | null;
  error: string | null;
  createdAt: Date;
}

export interface IStorage {
  createRun(target: string): RunData;
  getRun(id: string): RunData | undefined;
  updateRun(id: string, updates: Partial<RunData>): void;
}

class MemStorage implements IStorage {
  private runs: Map<string, RunData> = new Map();
  private nextId = 1;

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
}

export const storage = new MemStorage();
