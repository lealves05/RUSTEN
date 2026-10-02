-- RUSTEN — 009: vendas feitas direto na maquininha (fora do RUSTEN), importadas do relatório da InfinitePay.
-- Cada importação guarda o resumo do período, os valores por dia e por forma; cancelar não apaga (fica no histórico).
-- Rollback: migrations/rollback/009_vendas_maquininha.down.sql
create table if not exists pos_sales_imports (
  id              bigserial primary key,
  company_id      bigint not null references companies(id),
  provider        text not null default 'infinitepay',
  mode            text not null check (mode in ('externa','conferencia')), -- externa: soma ao faturamento; conferencia: só compara
  file_name       text not null,
  file_sha256     text not null,
  file_data       bytea,                                -- relatório original (para conferência)
  account_label   text,
  period_from     date not null,
  period_to       date not null check (period_to >= period_from),
  generated_on    date,
  gross_cents     bigint not null check (gross_cents >= 0),
  net_cents       bigint not null check (net_cents >= 0 and net_cents <= gross_cents),
  fee_cents       bigint not null check (fee_cents >= 0),
  tx_count        int not null check (tx_count >= 0),
  methods         jsonb not null default '[]'::jsonb,   -- [{method, label, gross_cents}]
  products        jsonb not null default '[]'::jsonb,   -- [{name, qty}] (ranking do relatório; pode ser parcial)
  categories      jsonb not null default '[]'::jsonb,   -- [{name, qty}]
  notes           jsonb not null default '[]'::jsonb,   -- observações do próprio relatório
  status          text not null default 'ativo' check (status in ('ativo','cancelado')),
  created_by      bigint,
  created_at      timestamptz not null default now(),
  canceled_by     bigint,
  canceled_at     timestamptz,
  cancel_reason   text
);
-- o mesmo arquivo não entra duas vezes enquanto a importação estiver ativa
create unique index if not exists pos_sales_imports_file_uq on pos_sales_imports (company_id, file_sha256) where status = 'ativo';
create index if not exists pos_sales_imports_company_idx on pos_sales_imports (company_id, period_from desc);

create table if not exists pos_sales_days (
  id          bigserial primary key,
  company_id  bigint not null references companies(id),
  import_id   bigint not null references pos_sales_imports(id),
  provider    text not null,
  day         date not null,
  gross_cents bigint not null check (gross_cents >= 0),
  net_cents   bigint not null check (net_cents >= 0),
  tx_count    int not null check (tx_count >= 0),
  active      boolean not null default true
);
-- um dia só pode estar em uma importação ativa (evita somar a mesma venda duas vezes)
create unique index if not exists pos_sales_days_uq on pos_sales_days (company_id, provider, day) where active;
create index if not exists pos_sales_days_import_idx on pos_sales_days (import_id);

-- valores importados não são editados: só cancelados (com motivo) e reimportados
create or replace function pos_sales_imports_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;
    raise exception 'Importação de vendas não pode ser apagada; cancele-a';
  end if;
  if (new.gross_cents, new.net_cents, new.fee_cents, new.tx_count, new.period_from, new.period_to, new.mode, new.file_sha256, new.company_id)
     is distinct from (old.gross_cents, old.net_cents, old.fee_cents, old.tx_count, old.period_from, old.period_to, old.mode, old.file_sha256, old.company_id) then
    raise exception 'Valores importados não podem ser alterados; cancele e importe de novo';
  end if;
  return new;
end $$;
create or replace function pos_sales_days_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;
    raise exception 'Importação de vendas não pode ser apagada; cancele-a';
  end if;
  if (new.gross_cents, new.net_cents, new.tx_count, new.day, new.import_id, new.company_id) is distinct from (old.gross_cents, old.net_cents, old.tx_count, old.day, old.import_id, old.company_id) then
    raise exception 'Valores importados não podem ser alterados; cancele e importe de novo';
  end if;
  if new.active and not old.active then raise exception 'Dia cancelado não volta a valer; importe de novo'; end if;
  return new;
end $$;
drop trigger if exists pos_sales_imports_guard on pos_sales_imports;
create trigger pos_sales_imports_guard before update or delete on pos_sales_imports for each row execute function pos_sales_imports_guard();
drop trigger if exists pos_sales_days_guard on pos_sales_days;
create trigger pos_sales_days_guard before update or delete on pos_sales_days for each row execute function pos_sales_days_guard();

-- remoção da demonstração
create or replace function purge_pos_sales() returns trigger language plpgsql as $$
begin
  if current_setting('rusten.purge_demo', true) = old.id::text then
    delete from pos_sales_days where company_id = old.id;
    delete from pos_sales_imports where company_id = old.id;
  end if;
  return old;
end $$;
drop trigger if exists companies_purge_pos_sales on companies;
create trigger companies_purge_pos_sales before delete on companies for each row execute function purge_pos_sales();
