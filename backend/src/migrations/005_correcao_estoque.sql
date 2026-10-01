-- RUSTEN — 005: correção de estoque com trilha de auditoria (motivo, justificativa, valor, aprovação por outra pessoa).
-- Rollback: migrations/rollback/005_correcao_estoque.down.sql

-- novo tipo de movimento: correção aprovada (nunca edita movimentos anteriores)
alter table stock_movements drop constraint if exists stock_movements_kind_check;
alter table stock_movements add constraint stock_movements_kind_check
  check (kind in ('entrada','venda','estorno_venda','perda','ajuste','inventario','producao_consumo','producao_entrada','reversao','correcao'));

create table if not exists stock_corrections (
  id               bigserial primary key,
  company_id       bigint not null references companies(id),
  stock_item_id    bigint not null,
  system_qty       numeric(14,4) not null,          -- saldo do sistema no pedido
  counted_qty      numeric(14,4) not null check (counted_qty >= 0), -- saldo real informado
  diff_qty         numeric(14,4) not null,          -- counted - system
  unit_cost_cents  numeric(16,4) not null default 0,
  value_cents      bigint not null,                 -- impacto financeiro (diferença × custo médio)
  reason_code      text not null check (reason_code in ('contagem','quebra','vencimento','erro_lancamento','consumo_interno','furto_desvio','devolucao','outro')),
  justification    text not null check (length(justification) >= 15),
  evidence         text,
  status           text not null default 'pendente' check (status in ('pendente','aplicada','rejeitada','expirada')),
  needs_approval   boolean not null,
  approval_rule    text,                            -- por que precisou de aprovação (limite, %, motivo, perfil)
  requested_by     bigint not null,
  requested_ip     text,
  decided_by       bigint,
  decided_at       timestamptz,
  decision_note    text,
  self_approved    boolean not null default false,  -- aprovado pelo próprio solicitante (só sem outro aprovador na empresa)
  movement_id      bigint,
  created_at       timestamptz not null default now(),
  foreign key (company_id, stock_item_id) references stock_items(company_id, id) on delete cascade
);
create index if not exists stock_corr_company_idx on stock_corrections (company_id, created_at desc);
create index if not exists stock_corr_item_idx on stock_corrections (company_id, stock_item_id, created_at desc);
-- uma correção pendente por insumo (evita pedidos duplicados e conflitantes)
create unique index if not exists stock_corr_pending_uq on stock_corrections (company_id, stock_item_id) where status = 'pendente';

-- registro decidido não muda mais; nada é apagado (exceto na remoção da demonstração)
create or replace function stock_corr_guard() returns trigger language plpgsql as $$
begin
  if current_setting('rusten.purge_demo', true) = old.company_id::text then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then raise exception 'correções de estoque não podem ser apagadas'; end if;
  if old.status <> 'pendente' then raise exception 'correção já decidida não pode ser alterada'; end if;
  if new.stock_item_id <> old.stock_item_id or new.counted_qty <> old.counted_qty or new.system_qty <> old.system_qty
     or new.diff_qty <> old.diff_qty or new.value_cents <> old.value_cents or new.reason_code <> old.reason_code
     or new.justification <> old.justification or new.requested_by <> old.requested_by or new.created_at <> old.created_at then
    raise exception 'os dados do pedido de correção não podem ser alterados';
  end if;
  return new;
end $$;
drop trigger if exists stock_corr_guard on stock_corrections;
create trigger stock_corr_guard before update or delete on stock_corrections for each row execute function stock_corr_guard();
