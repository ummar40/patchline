import { z } from "zod";
import { JOB_INPUT_LIMITS } from "./limits";

const normalized = z.string().transform((value) => value.replace(/\r\n?/g, "\n").trim());

const optionalText = (max: number) =>
  normalized
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? undefined : value))
    .optional();

export const jobInputSchema = z.object({
  title: normalized.pipe(
    z
      .string()
      .min(JOB_INPUT_LIMITS.titleMin)
      .max(JOB_INPUT_LIMITS.titleMax)
      .refine((value) => !value.includes("\n"), "must be a single line"),
  ),
  problemDescription: normalized.pipe(
    z.string().min(JOB_INPUT_LIMITS.descriptionMin).max(JOB_INPUT_LIMITS.descriptionMax),
  ),
  reproductionSteps: optionalText(JOB_INPUT_LIMITS.reproductionMax),
  expectedBehavior: optionalText(JOB_INPUT_LIMITS.expectedBehaviorMax),
});

export type JobInput = z.output<typeof jobInputSchema>;
