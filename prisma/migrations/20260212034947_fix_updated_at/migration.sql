/*
  Warnings:

  - You are about to drop the column `is_run` on the `Job` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "is_run",
ADD COLUMN     "queued" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
