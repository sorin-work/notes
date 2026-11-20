-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('read', 'edit');

-- CreateTable
CREATE TABLE "notebook_members" (
    "notebook_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "member_role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notebook_members_pkey" PRIMARY KEY ("notebook_id","user_id")
);

-- CreateTable
CREATE TABLE "notebook_invites" (
    "id" UUID NOT NULL,
    "notebook_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "member_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notebook_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notebook_members_user_id_idx" ON "notebook_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notebook_invites_token_hash_key" ON "notebook_invites"("token_hash");

-- CreateIndex
CREATE INDEX "notebook_invites_email_idx" ON "notebook_invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "notebook_invites_notebook_id_email_key" ON "notebook_invites"("notebook_id", "email");

-- AddForeignKey
ALTER TABLE "notebook_members" ADD CONSTRAINT "notebook_members_notebook_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "notebooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notebook_members" ADD CONSTRAINT "notebook_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notebook_invites" ADD CONSTRAINT "notebook_invites_notebook_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "notebooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notebook_invites" ADD CONSTRAINT "notebook_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
