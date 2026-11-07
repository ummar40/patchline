import { describe, expect, it } from "vitest";
import { type CategoryEvidence, evaluateGate } from "./policy";

const evidence = (
  category: CategoryEvidence["category"],
  baseline: CategoryEvidence["baseline"],
  candidate: CategoryEvidence["candidate"],
): CategoryEvidence => ({ category, baseline, candidate });

describe("verification gate", () => {
  it("passes when everything that ran passes", () => {
    expect(
      evaluateGate([
        evidence("TEST", "PASSED", "PASSED"),
        evidence("LINT", "PASSED", "PASSED"),
        evidence("BUILD", null, null),
      ]),
    ).toEqual({ verdict: "pass", passed: ["TEST", "LINT"], preExistingFailures: [] });
  });

  it("passes when a failing test suite is fixed by the change", () => {
    expect(evaluateGate([evidence("TEST", "FAILED", "PASSED")])).toMatchObject({ verdict: "pass" });
  });

  it("blocks when tests fail after the change, even if they failed before", () => {
    expect(
      evaluateGate([evidence("TEST", "FAILED", "FAILED"), evidence("BUILD", "PASSED", "PASSED")]),
    ).toEqual({
      verdict: "fail",
      blocking: ["TEST"],
      preExistingFailures: [],
    });
  });

  it("blocks a regression in lint, type check or build", () => {
    expect(
      evaluateGate([
        evidence("TEST", "PASSED", "PASSED"),
        evidence("TYPECHECK", "PASSED", "FAILED"),
      ]),
    ).toMatchObject({
      verdict: "fail",
      blocking: ["TYPECHECK"],
    });
  });

  it("reports but does not block on lint that was already failing", () => {
    expect(
      evaluateGate([evidence("TEST", "PASSED", "PASSED"), evidence("LINT", "FAILED", "FAILED")]),
    ).toEqual({
      verdict: "pass",
      passed: ["TEST"],
      preExistingFailures: ["LINT"],
    });
  });

  it("treats timeouts and commands that could not run as failures", () => {
    expect(evaluateGate([evidence("TEST", "PASSED", "TIMED_OUT")])).toMatchObject({
      verdict: "fail",
      blocking: ["TEST"],
    });
    expect(evaluateGate([evidence("BUILD", "PASSED", "ERRORED")])).toMatchObject({
      verdict: "fail",
      blocking: ["BUILD"],
    });
  });

  it("blocks a category that fails now and has no baseline to compare with", () => {
    expect(evaluateGate([evidence("LINT", null, "FAILED")])).toMatchObject({
      verdict: "fail",
      blocking: ["LINT"],
    });
  });

  it("finds no evidence when nothing ran", () => {
    expect(evaluateGate([])).toEqual({ verdict: "no_evidence", preExistingFailures: [] });
    expect(evaluateGate([evidence("TEST", null, null)])).toEqual({
      verdict: "no_evidence",
      preExistingFailures: [],
    });
  });

  it("finds no evidence when the only results are pre-existing failures", () => {
    expect(evaluateGate([evidence("LINT", "FAILED", "FAILED")])).toEqual({
      verdict: "no_evidence",
      preExistingFailures: ["LINT"],
    });
  });
});
