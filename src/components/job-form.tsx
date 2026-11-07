"use client";

import { useActionState } from "react";
import { JOB_INPUT_LIMITS } from "@/core/jobs/limits";
import { jobFormCopy } from "@/web/copy";
import { type JobFormState, createJobAction } from "@/web/jobs/actions";
import { Button, ButtonLink } from "./ui/button";
import { Field, Input, Select, Textarea } from "./ui/form";
import { Notice } from "./ui/layout";

type RepositoryOption = { id: string; fullName: string };

export function JobForm(props: {
  repositories: RepositoryOption[];
  defaults: Record<string, string | undefined>;
  cancelHref: string;
}) {
  const [state, action, pending] = useActionState<JobFormState, FormData>(createJobAction, {});
  const value = (name: string) => state.values?.[name] ?? props.defaults[name] ?? "";
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="max-w-2xl space-y-6" noValidate>
      {state.message ? (
        <Notice role="alert" tone="danger">
          {state.message}
        </Notice>
      ) : null}

      {props.defaults.retryOfJobId ? (
        <input name="retryOfJobId" type="hidden" value={props.defaults.retryOfJobId} />
      ) : null}

      <Field error={errors.repositoryId} id="repositoryId" label="Repository">
        <Select
          aria-invalid={errors.repositoryId ? true : undefined}
          defaultValue={value("repositoryId")}
          id="repositoryId"
          key={value("repositoryId")}
          name="repositoryId"
          required
        >
          <option value="">Choose a repository</option>
          {props.repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repository.fullName}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        error={errors.title}
        hint={jobFormCopy.title.hint}
        id="title"
        label={jobFormCopy.title.label}
      >
        <Input
          aria-describedby={errors.title ? "title-error" : "title-hint"}
          aria-invalid={errors.title ? true : undefined}
          defaultValue={value("title")}
          id="title"
          maxLength={JOB_INPUT_LIMITS.titleMax}
          name="title"
          required
        />
      </Field>

      <Field
        error={errors.problemDescription}
        hint={jobFormCopy.problemDescription.hint}
        id="problemDescription"
        label={jobFormCopy.problemDescription.label}
      >
        <Textarea
          aria-describedby={
            errors.problemDescription ? "problemDescription-error" : "problemDescription-hint"
          }
          aria-invalid={errors.problemDescription ? true : undefined}
          className="min-h-40"
          defaultValue={value("problemDescription")}
          id="problemDescription"
          maxLength={JOB_INPUT_LIMITS.descriptionMax}
          name="problemDescription"
          required
        />
      </Field>

      <Field
        error={errors.reproductionSteps}
        hint={jobFormCopy.reproductionSteps.hint}
        id="reproductionSteps"
        label={jobFormCopy.reproductionSteps.label}
        optional
      >
        <Textarea
          aria-describedby={
            errors.reproductionSteps ? "reproductionSteps-error" : "reproductionSteps-hint"
          }
          aria-invalid={errors.reproductionSteps ? true : undefined}
          className="font-mono text-[13px]"
          defaultValue={value("reproductionSteps")}
          id="reproductionSteps"
          maxLength={JOB_INPUT_LIMITS.reproductionMax}
          name="reproductionSteps"
        />
      </Field>

      <Field
        error={errors.expectedBehavior}
        hint={jobFormCopy.expectedBehavior.hint}
        id="expectedBehavior"
        label={jobFormCopy.expectedBehavior.label}
        optional
      >
        <Textarea
          aria-describedby={
            errors.expectedBehavior ? "expectedBehavior-error" : "expectedBehavior-hint"
          }
          aria-invalid={errors.expectedBehavior ? true : undefined}
          defaultValue={value("expectedBehavior")}
          id="expectedBehavior"
          maxLength={JOB_INPUT_LIMITS.expectedBehaviorMax}
          name="expectedBehavior"
        />
      </Field>

      <div className="flex items-center gap-2 border-t border-border pt-5">
        <Button disabled={pending} type="submit" variant="primary">
          {pending ? "Creating job" : "Create job"}
        </Button>
        <ButtonLink href={props.cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
