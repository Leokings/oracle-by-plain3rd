CREATE TABLE IF NOT EXISTS decisions (
  network text NOT NULL,
  contract_address text NOT NULL,
  kind text NOT NULL,
  case_id text NOT NULL,
  source_name text NOT NULL,
  status text NOT NULL,
  decision text NOT NULL DEFAULT '',
  rule_version text NOT NULL DEFAULT '',
  support_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_at timestamptz,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, contract_address, kind, case_id)
);

CREATE INDEX IF NOT EXISTS decisions_updated_at_idx
  ON decisions (updated_at DESC);
CREATE INDEX IF NOT EXISTS decisions_kind_status_idx
  ON decisions (kind, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS decisions_search_idx
  ON decisions USING gin (
    to_tsvector(
      'english',
      coalesce(case_id, '') || ' ' || coalesce(title, '') || ' ' || coalesce(content, '')
    )
  );

CREATE TABLE IF NOT EXISTS case_transactions (
  tx_hash text PRIMARY KEY,
  network text NOT NULL,
  contract_address text NOT NULL,
  kind text NOT NULL,
  case_id text NOT NULL,
  operation text NOT NULL,
  actor text NOT NULL DEFAULT '',
  tx_status text NOT NULL DEFAULT 'UNKNOWN',
  tx_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_transactions_case_idx
  ON case_transactions (kind, case_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS case_transactions_status_idx
  ON case_transactions (tx_status, observed_at DESC);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id uuid PRIMARY KEY,
  url text NOT NULL UNIQUE,
  events jsonb NOT NULL DEFAULT '["decision.changed"]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id bigserial PRIMARY KEY,
  subscription_id uuid REFERENCES webhook_subscriptions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  case_key text NOT NULL,
  response_status integer,
  delivered boolean NOT NULL DEFAULT false,
  response_excerpt text NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_attempted_idx
  ON webhook_deliveries (attempted_at DESC);

CREATE TABLE IF NOT EXISTS registry_sync_runs (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  decisions_seen integer NOT NULL DEFAULT 0,
  decisions_changed integer NOT NULL DEFAULT 0,
  transactions_refreshed integer NOT NULL DEFAULT 0,
  error_text text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NOT NULL DEFAULT now()
);
