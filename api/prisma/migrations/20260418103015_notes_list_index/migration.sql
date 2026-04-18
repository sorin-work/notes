-- The note list always filters by owner and trash state and sorts by the
-- last edit.
-- CreateIndex
CREATE INDEX "notes_user_id_deleted_at_updated_at_idx" ON "notes"("user_id", "deleted_at", "updated_at");
