-- RUSTEN — 002: ligação com a central da plataforma (MASTER do ORBI, contrato v1) e empresas de demonstração.
-- Rollback: migrations/rollback/002_central_demo.down.sql

-- Demonstração: nunca vai para a central, nunca é bloqueada e é apagada após 7 dias sem conversão
alter table companies add column if not exists is_demo boolean not null default false;
create index if not exists companies_demo_idx on companies (created_at) where is_demo;

-- Configuração da central quando não há variáveis de ambiente (Supabase Edge): platform_hub_url, platform_secret
create table if not exists platform_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Parâmetros do sistema (valem para todas as empresas), editáveis pelo MASTER da central
create table if not exists system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Auditoria segue somente inclusão; a única exceção é apagar uma empresa de demonstração inteira
create or replace function audit_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('rusten.purge_demo', true) = old.company_id::text then
    return old;
  end if;
  raise exception 'auditoria é somente inclusão';
end $$;

-- Apaga uma empresa de demonstração e tudo o que pertence a ela (recusa empresas reais)
create or replace function purge_demo_company(p_company bigint) returns void language plpgsql as $$
begin
  if not exists (select 1 from companies where id = p_company and is_demo) then
    raise exception 'empresa % não é de demonstração', p_company;
  end if;
  perform set_config('rusten.purge_demo', p_company::text, true);
  delete from payments where company_id = p_company;
  delete from cash_movements where company_id = p_company;
  delete from cash_sessions where company_id = p_company;
  delete from order_items where company_id = p_company;
  delete from consumption_sessions where company_id = p_company;
  delete from manager_authorizations where company_id = p_company;
  delete from scan_codes where company_id = p_company;
  delete from tab_cards where company_id = p_company;
  delete from dining_tables where company_id = p_company;
  delete from modifier_options where company_id = p_company;
  delete from modifier_groups where company_id = p_company;
  delete from product_price_history where company_id = p_company;
  delete from products where company_id = p_company;
  delete from categories where company_id = p_company;
  delete from production_sectors where company_id = p_company;
  delete from user_sessions where user_id in (select id from users where company_id = p_company);
  delete from users where company_id = p_company;
  delete from terminals where company_id = p_company;
  delete from roles where company_id = p_company;
  delete from units where company_id = p_company;
  delete from platform_outbox where company_id = p_company;
  delete from audit_events where company_id = p_company;
  delete from companies where id = p_company;
  perform set_config('rusten.purge_demo', '', true);
end $$;
revoke all on function purge_demo_company(bigint) from public;
