-- RUSTEN — 010: produtos vendidos na maquininha → saída no estoque.
-- Cada linha do relatório (ou acrescentada à mão) é ligada a um produto do cardápio; ao lançar, o estoque sai pela
-- ficha técnica/produto acabado (movimento "venda" com ref_type 'pos_sales_item'). Cancelar a importação estorna.
-- Rollback: migrations/rollback/010_maquininha_estoque.down.sql
create table if not exists pos_sales_items (
  id           bigserial primary key,
  company_id   bigint not null references companies(id),
  import_id    bigint not null references pos_sales_imports(id),
  report_name  text not null,
  source       text not null default 'relatorio' check (source in ('relatorio','manual')),
  qty          numeric(14,3) not null check (qty > 0),
  product_id   bigint,
  status       text not null default 'pendente' check (status in ('pendente','ignorado','baixado','estornado')),
  posted_at    timestamptz,
  posted_by    bigint,
  created_at   timestamptz not null default now()
);
create index if not exists pos_sales_items_import_idx on pos_sales_items (import_id, id);

-- nomes da maquininha já ligados a um produto (a próxima importação reconhece sozinha)
create table if not exists pos_product_aliases (
  company_id  bigint not null references companies(id),
  provider    text not null default 'infinitepay',
  alias_norm  text not null,
  product_id  bigint not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, provider, alias_norm)
);

-- uma única baixa por linha e insumo
create unique index if not exists stock_mov_pos_uq on stock_movements (company_id, ref_type, ref_id, stock_item_id, kind)
  where ref_type = 'pos_sales_item';

-- linha baixada não muda (só estorna)
create or replace function pos_sales_items_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;
    if old.status in ('baixado','estornado') then raise exception 'Linha já lançada no estoque não pode ser apagada; cancele a importação'; end if;
    return old;
  end if;
  if old.status in ('baixado','estornado') and (new.qty, new.product_id, new.import_id, new.company_id) is distinct from (old.qty, old.product_id, old.import_id, old.company_id) then
    raise exception 'Linha já lançada no estoque não pode ser alterada';
  end if;
  if old.status = 'estornado' and new.status <> 'estornado' then raise exception 'Linha estornada não volta'; end if;
  return new;
end $$;
drop trigger if exists pos_sales_items_guard on pos_sales_items;
create trigger pos_sales_items_guard before update or delete on pos_sales_items for each row execute function pos_sales_items_guard();

create or replace function purge_pos_sales_items() returns trigger language plpgsql as $$
begin
  if current_setting('rusten.purge_demo', true) = old.id::text then
    delete from pos_sales_items where company_id = old.id;
    delete from pos_product_aliases where company_id = old.id;
  end if;
  return old;
end $$;
-- roda antes da limpeza das importações (ordem alfabética dos gatilhos)
drop trigger if exists companies_purge_pos_items on companies;
create trigger companies_purge_pos_items before delete on companies for each row execute function purge_pos_sales_items();
