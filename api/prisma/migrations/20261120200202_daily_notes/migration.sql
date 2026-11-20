-- The daily note of a day, and the choices that go with it.
-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "daily_date" DATE;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "preferences" JSONB NOT NULL DEFAULT '{}';

-- One daily note per user and day. The column is new and empty in every row,
-- so there is nothing in the way of the index, and rows without a date never
-- collide: NULLs are not equal to each other.
-- CreateIndex
CREATE UNIQUE INDEX "notes_user_id_daily_date_key" ON "notes"("user_id", "daily_date");
