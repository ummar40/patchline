// Kept free of runtime dependencies so the browser bundle can share these numbers.
export const JOB_INPUT_LIMITS = {
  titleMin: 5,
  titleMax: 160,
  descriptionMin: 20,
  descriptionMax: 20_000,
  reproductionMax: 10_000,
  expectedBehaviorMax: 5_000,
} as const;
