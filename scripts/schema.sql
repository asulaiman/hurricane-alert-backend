create table if not exists subscribers (
  id serial primary key,
  email text unique,
  phone text unique,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id serial primary key,
  subscriber_id integer not null references subscribers(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  label text,
  channels jsonb not null default '{"push": false, "email": false, "sms": false}',
  push_subscription_json jsonb,
  consent_text text,
  consent_at timestamptz,
  last_computed_level integer not null default 0,
  last_notified_level integer not null default 0,
  notified_official_alerts jsonb not null default '[]',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_active_idx on subscriptions (active);

create table if not exists verification_tokens (
  id serial primary key,
  subscriber_id integer not null references subscribers(id) on delete cascade,
  -- set for 'unsubscribe' tokens (targets one saved location's subscription),
  -- null for 'email_verify' tokens (verification is subscriber-wide, not per-location)
  subscription_id integer references subscriptions(id) on delete cascade,
  kind text not null check (kind in ('email_verify', 'unsubscribe')),
  token text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists verification_tokens_subscriber_idx on verification_tokens (subscriber_id, kind, created_at);
