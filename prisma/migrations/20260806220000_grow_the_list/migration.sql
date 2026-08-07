-- Consent as an event log, not a flag: SUBSCRIBED without a recorded basis is
-- a claim, and a claim is what a regulator or mailbox provider asks us to
-- substantiate. Plus signup forms and double opt-in tokens.
-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "state" "ConsentState" NOT NULL,
    "basis" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "sourceId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupForm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "blurb" TEXT,
    "consentText" TEXT NOT NULL,
    "askPhone" BOOLEAN NOT NULL DEFAULT false,
    "smsConsentText" TEXT,
    "doubleOptIn" BOOLEAN NOT NULL DEFAULT true,
    "redirectUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfirmationToken" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfirmationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_organizationId_contactId_idx" ON "ConsentRecord"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "ConsentRecord_contactId_channel_at_idx" ON "ConsentRecord"("contactId", "channel", "at");

-- CreateIndex
CREATE UNIQUE INDEX "SignupForm_slug_key" ON "SignupForm"("slug");

-- CreateIndex
CREATE INDEX "SignupForm_organizationId_idx" ON "SignupForm"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmationToken_tokenHash_key" ON "ConfirmationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ConfirmationToken_contactId_channel_idx" ON "ConfirmationToken"("contactId", "channel");

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupForm" ADD CONSTRAINT "SignupForm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupForm" ADD CONSTRAINT "SignupForm_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfirmationToken" ADD CONSTRAINT "ConfirmationToken_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

