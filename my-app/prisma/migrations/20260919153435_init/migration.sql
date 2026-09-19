-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "fileName" TEXT,
    "imagePath" TEXT,
    "markdown" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "latex" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "embedding" TEXT NOT NULL,
    "mastery" REAL NOT NULL DEFAULT 0,
    "encounterCount" INTEGER NOT NULL DEFAULT 1,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourcesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConceptSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conceptId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "quote" TEXT,
    "bbox" TEXT,
    CONSTRAINT "ConceptSource_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConceptSource_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConceptRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conceptId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConceptRevision_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Edge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "strength" REAL NOT NULL DEFAULT 0.5,
    "rationale" TEXT NOT NULL DEFAULT '',
    "resolved" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "LearnerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'me',
    "style" TEXT NOT NULL DEFAULT '{}',
    "confusion" TEXT NOT NULL DEFAULT '[]',
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Concept_status_idx" ON "Concept"("status");

-- CreateIndex
CREATE INDEX "ConceptSource_noteId_idx" ON "ConceptSource"("noteId");

-- CreateIndex
CREATE UNIQUE INDEX "ConceptSource_conceptId_noteId_key" ON "ConceptSource"("conceptId", "noteId");

-- CreateIndex
CREATE INDEX "ConceptRevision_conceptId_idx" ON "ConceptRevision"("conceptId");

-- CreateIndex
CREATE INDEX "Edge_sourceId_idx" ON "Edge"("sourceId");

-- CreateIndex
CREATE INDEX "Edge_targetId_idx" ON "Edge"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Edge_sourceId_targetId_relation_key" ON "Edge"("sourceId", "targetId", "relation");
