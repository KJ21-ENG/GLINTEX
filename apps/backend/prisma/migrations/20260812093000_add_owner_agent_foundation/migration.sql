-- Production foundation for the owner-only OpenClaw integration.
-- No existing business table or human authentication record is modified.

CREATE TABLE "OwnerTask" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "area" TEXT NOT NULL DEFAULT 'GENERAL',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "dueDate" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "completedAt" TIMESTAMP(3),
  "createdByAgentId" TEXT,
  "updatedByAgentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentLearningCandidate" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "evidence" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "proposedByAgentId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentLearningCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentOperation" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "sessionKey" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PREPARED',
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "result" JSONB,
  "verification" JSONB,
  "confirmationHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "expectedVersion" INTEGER,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "executedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentAccessLog" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "sessionKey" TEXT,
  "resource" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "filtersHash" TEXT NOT NULL,
  "resultCount" INTEGER,
  "outcome" TEXT NOT NULL,
  "durationMs" INTEGER,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OwnerTask_status_priority_idx" ON "OwnerTask"("status", "priority");
CREATE INDEX "OwnerTask_area_status_idx" ON "OwnerTask"("area", "status");
CREATE INDEX "OwnerTask_dueDate_idx" ON "OwnerTask"("dueDate");

CREATE INDEX "AgentLearningCandidate_status_createdAt_idx" ON "AgentLearningCandidate"("status", "createdAt");
CREATE INDEX "AgentLearningCandidate_category_status_idx" ON "AgentLearningCandidate"("category", "status");

CREATE UNIQUE INDEX "AgentOperation_agentId_action_idempotencyKey_key"
  ON "AgentOperation"("agentId", "action", "idempotencyKey");
CREATE INDEX "AgentOperation_status_expiresAt_idx" ON "AgentOperation"("status", "expiresAt");
CREATE INDEX "AgentOperation_entityType_entityId_idx" ON "AgentOperation"("entityType", "entityId");
CREATE INDEX "AgentOperation_requesterId_createdAt_idx" ON "AgentOperation"("requesterId", "createdAt");

CREATE INDEX "AgentAccessLog_agentId_createdAt_idx" ON "AgentAccessLog"("agentId", "createdAt");
CREATE INDEX "AgentAccessLog_resource_createdAt_idx" ON "AgentAccessLog"("resource", "createdAt");
CREATE INDEX "AgentAccessLog_outcome_createdAt_idx" ON "AgentAccessLog"("outcome", "createdAt");
