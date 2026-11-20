-- Login tokens carry this number. Changing the password or signing out
-- everywhere raises it, and tokens with an older number stop working.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0;
