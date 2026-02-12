/*
  Warnings:

  - You are about to drop the column `queued` on the `Job` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Job" DROP COLUMN "queued",
ADD COLUMN     "is_run" BOOLEAN NOT NULL DEFAULT false;
