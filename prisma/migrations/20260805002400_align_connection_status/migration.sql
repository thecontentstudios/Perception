-- Align ConnectionStatus with the domain union in src/lib/types.ts.
-- A value rename preserves existing rows, unlike a drop-and-recreate.
ALTER TYPE "ConnectionStatus" RENAME VALUE 'DISCONNECTED' TO 'NOT_CONNECTED';
