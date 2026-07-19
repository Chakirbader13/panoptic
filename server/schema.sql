-- Panoptic - schema d'audit multi-tenant pour Supabase (Postgres).
-- Applique via le SQL editor Supabase, ou `supabase db push`.
-- Le serveur bascule automatiquement sur Supabase si SUPABASE_URL + SUPABASE_SERVICE_KEY sont definis.

create schema if not exists panoptic;

-- Tenants (une organisation cliente = un tenant, resolu depuis une cle d'API).
create table if not exists panoptic.tenants (
  id          text primary key,               -- ex: t_ab12cd (hash de la cle API)
  name        text,
  created_at  timestamptz not null default now()
);

-- Audits.
create table if not exists panoptic.audits (
  id          text primary key,               -- ex: aud_xxxxx
  tenant      text not null,
  target      text not null,
  repo_path   text,
  status      text not null default 'queued',  -- queued | running | done | error
  score       int,
  summary     jsonb,
  agents      jsonb,
  scope       jsonb,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists audits_tenant_idx on panoptic.audits (tenant, created_at desc);

-- Findings (un audit -> N findings, format canonique).
create table if not exists panoptic.findings (
  id          bigint generated always as identity primary key,
  audit_id    text not null references panoptic.audits(id) on delete cascade,
  agent       text not null,
  family      text,
  rule        text,
  cwe         text,
  title       text not null,
  severity    text not null,                   -- critical | high | medium | low | info
  priority    int default 0,
  location    jsonb,
  business    jsonb,
  fix         jsonb,
  effort      numeric,
  evidence    jsonb,
  "check"     jsonb
);
create index if not exists findings_audit_idx on panoptic.findings (audit_id, priority desc);
create index if not exists findings_sev_idx on panoptic.findings (audit_id, severity);

-- ---------------------------------------------------------------------------
-- Isolation multi-tenant par Row Level Security.
-- Le service key du serveur bypass RLS; ces regles protegent les acces cote client
-- (anon/authenticated) qui doivent porter le claim tenant.
-- ---------------------------------------------------------------------------
alter table panoptic.audits   enable row level security;
alter table panoptic.findings enable row level security;

-- Le tenant courant est lu depuis un claim JWT 'tenant' (ou request header configure).
create or replace function panoptic.current_tenant() returns text
  language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant', '')
$$;

drop policy if exists audits_tenant_isolation on panoptic.audits;
create policy audits_tenant_isolation on panoptic.audits
  using (tenant = panoptic.current_tenant());

drop policy if exists findings_tenant_isolation on panoptic.findings;
create policy findings_tenant_isolation on panoptic.findings
  using (exists (
    select 1 from panoptic.audits a
    where a.id = findings.audit_id and a.tenant = panoptic.current_tenant()
  ));
