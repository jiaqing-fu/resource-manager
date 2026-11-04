-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT,
    "contentJson" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "signature" TEXT,
    "documentDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "fromAddress" TEXT,
    "sentAt" DATETIME,
    "sentById" TEXT,
    "sentByName" TEXT,
    "messageId" TEXT,
    "docxPath" TEXT,
    "docxFilename" TEXT,
    "lastError" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Notification_status_updatedAt_idx" ON "Notification"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Notification_sentAt_idx" ON "Notification"("sentAt");

-- CreateIndex
CREATE INDEX "Notification_createdById_idx" ON "Notification"("createdById");
