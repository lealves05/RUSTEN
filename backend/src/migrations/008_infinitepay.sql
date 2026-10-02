-- RUSTEN — 008: integração com a InfinitePay (Checkout Integrado: link Pix/cartão, confirmação por webhook e consulta).
-- Rollback: migrations/rollback/008_infinitepay.down.sql
create table if not exists infinitepay_charges (
  id               bigserial primary key,
  company_id       bigint not null references companies(id),
  session_id       bigint,
  cash_session_id  bigint,
  order_nsu        text not null unique,          -- identificador do RUSTEN enviado à InfinitePay
  token            text not null unique,          -- segredo do retorno/webhook desta cobrança
  amount_cents     bigint not null check (amount_cents > 0),
  description      text not null,
  link_url         text,
  status           text not null default 'pendente' check (status in ('pendente','pago','cancelado','divergente','erro')),
  capture_method   text,                          -- pix | credit_card
  installments     int,
  paid_amount_cents bigint,                       -- valor pago pelo cliente (inclui juros do parcelamento, se houver)
  transaction_nsu  text,
  invoice_slug     text,
  receipt_url      text,
  payment_id       bigint,
  confirmed_by     text check (confirmed_by in ('webhook','retorno','consulta')),
  note             text,
  created_by       bigint,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz,
  canceled_at      timestamptz
);
create index if not exists infinitepay_charges_company_idx on infinitepay_charges (company_id, created_at desc);
create index if not exists infinitepay_charges_session_idx on infinitepay_charges (session_id) where session_id is not null;

-- tudo o que chega da InfinitePay fica registrado (conferência e auditoria)
create table if not exists infinitepay_events (
  id          bigserial primary key,
  company_id  bigint not null,
  charge_id   bigint references infinitepay_charges(id) on delete cascade,
  kind        text not null,                      -- link_criado | webhook | retorno | consulta | erro
  ok          boolean not null default true,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists infinitepay_events_charge_idx on infinitepay_events (charge_id, id);

-- remoção da demonstração
create or replace function purge_infinitepay() returns trigger language plpgsql as $$
begin
  if current_setting('rusten.purge_demo', true) = old.id::text then
    delete from infinitepay_events where company_id = old.id;
    delete from infinitepay_charges where company_id = old.id;
  end if;
  return old;
end $$;
drop trigger if exists companies_purge_infinitepay on companies;
create trigger companies_purge_infinitepay before delete on companies for each row execute function purge_infinitepay();
