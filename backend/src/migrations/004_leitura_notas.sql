-- RUSTEN — 004: leitura de notas e pedidos de compra (foto ou XML da NF-e) para lançar no estoque.
-- Rollback: migrations/rollback/004_leitura_notas.down.sql

-- Como cada fornecedor escreve o insumo na nota → insumo do estoque (aprendido a cada confirmação)
create table if not exists stock_aliases (
  company_id    bigint not null references companies(id),
  alias         text not null,
  stock_item_id bigint not null,
  factor        numeric(14,4) not null default 1 check (factor > 0),
  updated_at    timestamptz not null default now(),
  primary key (company_id, alias),
  foreign key (company_id, stock_item_id) references stock_items(company_id, id) on delete cascade
);

-- Origem da compra (lançada à mão, por foto ou por XML) e chave da NF-e para não lançar a mesma nota duas vezes
alter table purchases add column if not exists source text not null default 'manual' check (source in ('manual','foto','xml'));
alter table purchases add column if not exists nfe_key text;
create unique index if not exists purchases_nfe_key_uq on purchases (company_id, nfe_key) where nfe_key is not null and status <> 'cancelada';
