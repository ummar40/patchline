-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GITHUB');

-- CreateEnum
CREATE TYPE "InstallationAccountType" AS ENUM ('USER', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "RepositorySelection" AS ENUM ('ALL', 'SELECTED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PREPARING', 'CLONING', 'ANALYZING', 'REPRODUCING', 'PLANNING', 'IMPLEMENTING', 'VERIFYING', 'REVIEWING', 'CREATING_PR', 'COMPLETED', 'FAILED', 'NEEDS_HUMAN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobErrorCategory" AS ENUM ('CONFIGURATION', 'GITHUB_ACCESS', 'CLONE_FAILED', 'SANDBOX', 'DEPENDENCY_INSTALL', 'UNSUPPORTED_REPOSITORY', 'MODEL_PROVIDER', 'MODEL_BEHAVIOR', 'LIMIT_EXCEEDED', 'NO_VERIFICATION', 'VERIFICATION_FAILED', 'REVIEW_REJECTED', 'POLICY_VIOLATION', 'AGENT_ESCALATION', 'PUBLISH_FAILED', 'WORKER_INTERRUPTED', 'INTERNAL');

-- CreateEnum
CREATE TYPE "JobEventType" AS ENUM ('JOB_CREATED', 'STATE_CHANGED', 'CANCEL_REQUESTED', 'OPERATION', 'COMMAND', 'MODEL_CALL', 'TOOL_CALL', 'VERIFICATION', 'DECISION', 'LIMIT', 'ERROR');

-- CreateEnum
CREATE TYPE "EventLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('DETECTION', 'ANALYSIS', 'REPRODUCTION', 'PLAN', 'IMPLEMENTATION', 'REVIEW', 'DIFF');

-- CreateEnum
CREATE TYPE "CommandSource" AS ENUM ('SYSTEM', 'AGENT', 'VERIFICATION');

-- CreateEnum
CREATE TYPE "VerificationStage" AS ENUM ('BASELINE', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "VerificationCategory" AS ENUM ('TEST', 'LINT', 'TYPECHECK', 'BUILD');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PASSED', 'FAILED', 'TIMED_OUT', 'ERRORED');

-- CreateEnum
CREATE TYPE "ModelInvocationStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "lastSignInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "githubInstallationId" BIGINT NOT NULL,
    "accountGithubId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" "InstallationAccountType" NOT NULL,
    "accountAvatarUrl" TEXT,
    "repositorySelection" "RepositorySelection" NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallationAccess" (
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallationAccess_pkey" PRIMARY KEY ("userId","installationId")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "githubRepoId" BIGINT NOT NULL,
    "ownerLogin" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "defaultBranch" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryAccess" (
    "userId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "canPush" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryAccess_pkey" PRIMARY KEY ("userId","repositoryId")
);

-- CreateTable
CREATE TABLE "MaintenanceJob" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "retryOfJobId" TEXT,
    "title" TEXT NOT NULL,
    "problemDescription" TEXT NOT NULL,
    "reproductionSteps" TEXT,
    "expectedBehavior" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCategory" "JobErrorCategory",
    "outcomeSummary" TEXT,
    "baseBranch" TEXT NOT NULL,
    "baseCommitSha" TEXT,
    "workBranch" TEXT,
    "repairIterations" INTEGER NOT NULL DEFAULT 0,
    "modelTurns" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(12,6),
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelRequestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" BIGSERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "JobEventType" NOT NULL,
    "level" "EventLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "fromStatus" "JobStatus",
    "toStatus" "JobStatus",
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobArtifact" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandExecution" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "source" "CommandSource" NOT NULL,
    "phase" "JobStatus" NOT NULL,
    "command" TEXT NOT NULL,
    "purpose" TEXT,
    "networkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "exitCode" INTEGER,
    "timedOut" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL,
    "output" TEXT NOT NULL,
    "outputTruncated" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "commandExecutionId" TEXT,
    "stage" "VerificationStage" NOT NULL,
    "iteration" INTEGER NOT NULL,
    "category" "VerificationCategory" NOT NULL,
    "command" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "exitCode" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelInvocation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "phase" "JobStatus" NOT NULL,
    "model" TEXT NOT NULL,
    "reasoningEffort" TEXT NOT NULL,
    "responseId" TEXT,
    "status" "ModelInvocationStatus" NOT NULL,
    "errorCategory" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(12,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "headBranch" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PullRequestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "installationId" BIGINT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerAccountId_key" ON "AuthIdentity"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_githubInstallationId_key" ON "GitHubInstallation"("githubInstallationId");

-- CreateIndex
CREATE INDEX "InstallationAccess_installationId_idx" ON "InstallationAccess"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubRepoId_key" ON "Repository"("githubRepoId");

-- CreateIndex
CREATE INDEX "Repository_installationId_idx" ON "Repository"("installationId");

-- CreateIndex
CREATE INDEX "Repository_fullName_idx" ON "Repository"("fullName");

-- CreateIndex
CREATE INDEX "RepositoryAccess_repositoryId_idx" ON "RepositoryAccess"("repositoryId");

-- CreateIndex
CREATE INDEX "MaintenanceJob_repositoryId_createdAt_idx" ON "MaintenanceJob"("repositoryId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MaintenanceJob_createdById_createdAt_idx" ON "MaintenanceJob"("createdById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MaintenanceJob_status_createdAt_idx" ON "MaintenanceJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_id_idx" ON "JobEvent"("jobId", "id");

-- CreateIndex
CREATE INDEX "JobArtifact_jobId_kind_createdAt_idx" ON "JobArtifact"("jobId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "CommandExecution_jobId_startedAt_idx" ON "CommandExecution"("jobId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRun_commandExecutionId_key" ON "VerificationRun"("commandExecutionId");

-- CreateIndex
CREATE INDEX "VerificationRun_jobId_stage_iteration_idx" ON "VerificationRun"("jobId", "stage", "iteration");

-- CreateIndex
CREATE INDEX "ModelInvocation_jobId_createdAt_idx" ON "ModelInvocation"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestResult_jobId_key" ON "PullRequestResult"("jobId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_receivedAt_idx" ON "WebhookDelivery"("receivedAt");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationAccess" ADD CONSTRAINT "InstallationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationAccess" ADD CONSTRAINT "InstallationAccess_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryAccess" ADD CONSTRAINT "RepositoryAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryAccess" ADD CONSTRAINT "RepositoryAccess_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceJob" ADD CONSTRAINT "MaintenanceJob_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceJob" ADD CONSTRAINT "MaintenanceJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceJob" ADD CONSTRAINT "MaintenanceJob_cancelRequestedById_fkey" FOREIGN KEY ("cancelRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceJob" ADD CONSTRAINT "MaintenanceJob_retryOfJobId_fkey" FOREIGN KEY ("retryOfJobId") REFERENCES "MaintenanceJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MaintenanceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobArtifact" ADD CONSTRAINT "JobArtifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MaintenanceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandExecution" ADD CONSTRAINT "CommandExecution_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MaintenanceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MaintenanceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_commandExecutionId_fkey" FOREIGN KEY ("commandExecutionId") REFERENCES "CommandExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelInvocation" ADD CONSTRAINT "ModelInvocation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MaintenanceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestResult" ADD CONSTRAINT "PullRequestResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MaintenanceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
