-- A share link can point at a notebook instead of a note. It points at
-- exactly one of the two, which the check at the end holds the table to.
-- The new column starts out empty, so the unique index has nothing to trip
-- over, and every link that exists has a note and passes the check.
-- AlterTable
ALTER TABLE "share_links" ADD COLUMN     "notebook_id" UUID,
ALTER COLUMN "note_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "share_links_notebook_id_key" ON "share_links"("notebook_id");

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_notebook_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "notebooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Written by hand: Prisma has no way to say this in the schema.
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_note_or_notebook" CHECK (("note_id" IS NULL) <> ("notebook_id" IS NULL));
