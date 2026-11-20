-- A counter of the changes to a note's title and content. A save says which
-- revision it was based on, and is refused when the note has moved on.
-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- The counting is done here and not in the services, so that every statement
-- that changes the title or the content bumps the revision, in that same
-- statement, including the ones nobody has written yet. Prisma cannot express
-- a trigger, so this part is written by hand, like the one for search_vector.
CREATE FUNCTION notes_revision_bump() RETURNS trigger AS $$
BEGIN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.content IS DISTINCT FROM OLD.content THEN
        NEW.revision := OLD.revision + 1;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER notes_revision_trigger
    BEFORE UPDATE OF title, content ON "notes"
    FOR EACH ROW EXECUTE FUNCTION notes_revision_bump();
