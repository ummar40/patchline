import { describe, expect, it } from "vitest";
import { JobStatus } from "@/db/generated/enums";
import {
  TERMINAL_STATUSES,
  allowedSources,
  canTransition,
  isCancellable,
  isTerminal,
} from "./state-machine";

const ALL = Object.values(JobStatus);
const PIPELINE: JobStatus[] = [
  "QUEUED",
  "PREPARING",
  "CLONING",
  "ANALYZING",
  "REPRODUCING",
  "PLANNING",
  "IMPLEMENTING",
  "VERIFYING",
  "REVIEWING",
  "CREATING_PR",
  "COMPLETED",
];

describe("job state machine", () => {
  it("allows the pipeline to advance one step at a time", () => {
    for (let index = 0; index + 1 < PIPELINE.length; index += 1) {
      expect(canTransition(PIPELINE[index]!, PIPELINE[index + 1]!)).toBe(true);
    }
  });

  it("rejects skipping steps", () => {
    expect(canTransition("QUEUED", "CLONING")).toBe(false);
    expect(canTransition("ANALYZING", "IMPLEMENTING")).toBe(false);
    expect(canTransition("IMPLEMENTING", "CREATING_PR")).toBe(false);
    expect(canTransition("VERIFYING", "CREATING_PR")).toBe(false);
    expect(canTransition("IMPLEMENTING", "COMPLETED")).toBe(false);
  });

  it("rejects moving backwards except for repair iterations", () => {
    expect(canTransition("VERIFYING", "IMPLEMENTING")).toBe(true);
    expect(canTransition("REVIEWING", "IMPLEMENTING")).toBe(true);
    expect(canTransition("PLANNING", "ANALYZING")).toBe(false);
    expect(canTransition("CREATING_PR", "REVIEWING")).toBe(false);
  });

  it("never leaves a terminal status", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("rejects self transitions", () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("lets every non-terminal status fail", () => {
    for (const from of ALL.filter((status) => !isTerminal(status))) {
      expect(canTransition(from, "FAILED")).toBe(true);
    }
  });

  it("allows cancellation until publishing starts", () => {
    expect(canTransition("QUEUED", "CANCELLED")).toBe(true);
    expect(canTransition("IMPLEMENTING", "CANCELLED")).toBe(true);
    expect(canTransition("CREATING_PR", "CANCELLED")).toBe(false);
    expect(isCancellable("CREATING_PR")).toBe(false);
    expect(isCancellable("COMPLETED")).toBe(false);
  });

  it("only escalates to a human once work has started", () => {
    expect(canTransition("QUEUED", "NEEDS_HUMAN")).toBe(false);
    expect(canTransition("ANALYZING", "NEEDS_HUMAN")).toBe(true);
    expect(canTransition("CREATING_PR", "NEEDS_HUMAN")).toBe(true);
  });

  it("derives allowed sources consistently with canTransition", () => {
    for (const to of ALL) {
      const sources = allowedSources(to);
      for (const from of ALL) {
        expect(sources.includes(from)).toBe(canTransition(from, to));
      }
    }
  });

  it("only reaches COMPLETED from CREATING_PR", () => {
    expect(allowedSources("COMPLETED")).toEqual(["CREATING_PR"]);
  });
});
