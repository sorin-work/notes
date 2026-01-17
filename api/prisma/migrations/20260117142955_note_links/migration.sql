-- CreateTable
CREATE TABLE "note_links" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "target_title" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,

    CONSTRAINT "note_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_links_target_key_idx" ON "note_links"("target_key");

-- CreateIndex
CREATE UNIQUE INDEX "note_links_source_id_target_key_key" ON "note_links"("source_id", "target_key");

-- AddForeignKey
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
