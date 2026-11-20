-- CreateTable
CREATE TABLE "invite_sends" (
    "id" UUID NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invite_sends_invited_by_id_sent_at_idx" ON "invite_sends"("invited_by_id", "sent_at");

-- CreateIndex
CREATE INDEX "invite_sends_email_sent_at_idx" ON "invite_sends"("email", "sent_at");

-- AddForeignKey
ALTER TABLE "invite_sends" ADD CONSTRAINT "invite_sends_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
