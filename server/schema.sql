-- Panoptic - schema d'audit multi-tenant pour Supabase (Postgres).
-- Applique via le SQL editor Supabase, ou `supabase db push`.
-- Le serveur bascule automatiquement sur Supabase si SUPABASE_URL + SUPABASE_SERVICE_KEY sont definis.
--
-- IMPORTANT: les tables vivent dans le schema `public`. PostgREST (l'API REST de
-- Supabase utilisee par store.js) expose `public` par defaut; store.js interroge
-- /rest/v1/audits sans prefixe de schema. Ne pas deplacer ces tables ailleurs sans
-- exposer le schema correspondant et ajouter les en-tetes Accept-Profile/Content-Profile.
-- Projet dedie: panoptic-audit (ref hbhtlyagsrrwyosuthjb, region eu-west-3).

-- Tenants (une organisation cliente = un tenant, resolu depuis une cle d'API).
create table if not exists public.tenants (
  id          text primary key,               -- ex: t_ab12cd (hash de la cle API)
  name        text,
  created_at  timestamptz not null default now()
);

-- Audits.
create table if not exists public.audits (
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
create index if not exists audits_tenant_idx on public.audits (tenant, created_at desc);

-- Findings (un audit -> N findings, format canonique).
create table if not exists public.findings (
  id          bigint generated always as identity primary key,
  audit_id    text not null references public.audits(id) on delete cascade,
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
create index if not exists findings_audit_idx on public.findings (audit_id, priority desc);
create index if not exists findings_sev_idx on public.findings (audit_id, severity);

-- ---------------------------------------------------------------------------
-- Isolation multi-tenant par Row Level Security.
-- Le service key du serveur bypass RLS; ces regles protegent les acces cote client
-- (anon/authenticated) qui doivent porter le claim tenant.
-- ---------------------------------------------------------------------------
alter table public.audits   enable row level security;
alter table public.findings enable row level security;

-- Le tenant courant est lu depuis un claim JWT 'tenant' (ou request header configure).
create or replace function public.current_tenant() returns text
  language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant', '')
$$;

drop policy if exists audits_tenant_isolation on public.audits;
create policy audits_tenant_isolation on public.audits
  using (tenant = public.current_tenant());

drop policy if exists findings_tenant_isolation on public.findings;
create policy findings_tenant_isolation on public.findings
  using (exists (
    select 1 from public.audits a
    where a.id = findings.audit_id and a.tenant = public.current_tenant()
  ));
