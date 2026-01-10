-- Prisma only knows this column as Unsupported("tsvector"), so the column
-- and the trigger that keeps it up to date are written by hand. Title words
-- weigh more than body words when ranking results.
-- AlterTable
ALTER TABLE "notes" ADD COLUMN "search_vector" tsvector;

CREATE FUNCTION notes_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER notes_search_vector_trigger
    BEFORE INSERT OR UPDATE OF title, content ON "notes"
    FOR EACH ROW EXECUTE FUNCTION notes_search_vector_update();

-- Fill the column for notes that already exist.
UPDATE "notes" SET "title" = "title";

-- CreateIndex
CREATE INDEX "notes_search_vector_idx" ON "notes" USING GIN ("search_vector");
