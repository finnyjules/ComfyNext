-- frontend/server/db/schema.sql
-- Accounts spec §4. Idempotent (IF NOT EXISTS) so tests and boot can re-run it.
-- 1 credit = $0.01, integer credits only.

CREATE TABLE IF NOT EXISTS users (
  id         text PRIMARY KEY,          -- Clerk user id
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id          text PRIMARY KEY REFERENCES users(id),
  balance_credits  integer NOT NULL DEFAULT 0,
  reserved_credits integer NOT NULL DEFAULT 0,  -- sum of open holds
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Append-only double-entry log. Every balance change is a row here; wallets
-- carries a cached copy. `remaining_credits`/`expires_at` are credit-row-only:
-- debits consume credit rows FIFO by expiry so subscription grants (Phase 2+)
-- burn before purchased packs.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users(id),
  kind               text NOT NULL CHECK (kind IN ('credit', 'debit')),
  amount             integer NOT NULL CHECK (amount > 0),
  reason             text NOT NULL,
  idempotency_key    text NOT NULL,
  balance_after      integer NOT NULL,
  remaining_credits  integer,
  expires_at         timestamptz,
  price_book_version text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ledger_entries_fifo
  ON ledger_entries (user_id, expires_at, id)
  WHERE kind = 'credit' AND remaining_credits > 0;

CREATE TABLE IF NOT EXISTS holds (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  amount          integer NOT NULL CHECK (amount > 0),
  state           text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'settled', 'released')),
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS price_book (
  version text NOT NULL,
  action  text NOT NULL,
  credits integer NOT NULL,
  PRIMARY KEY (version, action)
);

CREATE TABLE IF NOT EXISTS stripe_customers (
  user_id            text PRIMARY KEY REFERENCES users(id),
  stripe_customer_id text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    text,
  provider   text NOT NULL,
  model      text,
  usd        numeric,
  job_id     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
