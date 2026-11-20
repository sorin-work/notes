-- A share link can run out and can ask readers for a password. Both are
-- optional, and links made before this have neither.
-- AlterTable
ALTER TABLE "share_links" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "password_hash" TEXT;
