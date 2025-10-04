-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL DEFAULT 'lot_sequence',
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);
