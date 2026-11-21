-- CreateTable
CREATE TABLE "note_tasks" (
    "id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "line" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL,

    CONSTRAINT "note_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_task_reads" (
    "note_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "readable" BOOLEAN NOT NULL,

    CONSTRAINT "note_task_reads_pkey" PRIMARY KEY ("note_id")
);

-- CreateIndex
CREATE INDEX "note_tasks_note_id_idx" ON "note_tasks"("note_id");

-- AddForeignKey
ALTER TABLE "note_tasks" ADD CONSTRAINT "note_tasks_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_task_reads" ADD CONSTRAINT "note_task_reads_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
