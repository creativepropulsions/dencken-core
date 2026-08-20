/*
# Create ledger_entries and constitution_records tables

1. New Tables
- `ledger_entries`: Stores signed ledger records for the Dencken network node.
  - id (text, primary key)
  - created_at (timestamptz, not null)
  - record_type (text, not null) - e.g. constitution_update, initiator_proposal, synthesis
  - brief_version (text)
  - content_hash (text) - SHA-256 hex digest of content
  - content_encrypted (text) - base64-encoded content
  - author_pubkey (text) - PEM public key of signing node
  - signature (text) - base64 Ed25519 signature
  - prev_hash (text) - hash of previous entry for chain integrity
  - status (text) - e.g. pending_review
  - board_note (text)
- `constitution_records`: Stores encrypted constitution versions.
  - id (text, primary key)
  - created_at (timestamptz, not null)
  - content_hash (text, not null)
  - content_plain (text, not null) - encrypted constitution content
  - prev_hash (text)
  - status (text)
  - board_note (text)

2. Security
- Enable RLS on both tables.
- Single-tenant node app (no Supabase auth sign-in screen); admin auth is handled by the app via ADMIN_TOKEN.
- Allow anon + authenticated CRUD on both tables since the server node uses the anon key.

3. Important Notes
- These tables replace local SQLite/file storage that was lost on every page refresh in the Bolt environment.
- The server signs entries with an Ed25519 key before storing them; signatures are verified on read.
*/

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  record_type TEXT NOT NULL,
  brief_version TEXT,
  content_hash TEXT,
  content_encrypted TEXT,
  author_pubkey TEXT,
  signature TEXT,
  prev_hash TEXT,
  status TEXT,
  board_note TEXT
);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ledger" ON ledger_entries;
CREATE POLICY "anon_select_ledger" ON ledger_entries FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_ledger" ON ledger_entries;
CREATE POLICY "anon_insert_ledger" ON ledger_entries FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_ledger" ON ledger_entries;
CREATE POLICY "anon_update_ledger" ON ledger_entries FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_ledger" ON ledger_entries;
CREATE POLICY "anon_delete_ledger" ON ledger_entries FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS constitution_records (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  content_hash TEXT NOT NULL,
  content_plain TEXT NOT NULL,
  prev_hash TEXT,
  status TEXT,
  board_note TEXT
);

ALTER TABLE constitution_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_constitution" ON constitution_records;
CREATE POLICY "anon_select_constitution" ON constitution_records FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_constitution" ON constitution_records;
CREATE POLICY "anon_insert_constitution" ON constitution_records FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_constitution" ON constitution_records;
CREATE POLICY "anon_update_constitution" ON constitution_records FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_constitution" ON constitution_records;
CREATE POLICY "anon_delete_constitution" ON constitution_records FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_created_at ON ledger_entries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_constitution_records_created_at ON constitution_records (created_at DESC);
