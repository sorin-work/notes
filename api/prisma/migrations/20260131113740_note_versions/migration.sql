-- CreateTable
CREATE TABLE "note_versions" (
    "id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_versions_note_id_created_at_idx" ON "note_versions"("note_id", "created_at");

-- AddForeignKey
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
