-- RUSTEN — 006: conta do cliente (crédito antecipado e fiado) vinculada ao CPF, integrada ao recebimento da comanda.
-- Rollback: migrations/rollback/006_conta_cliente.down.sql

-- novas formas de recebimento: "fiado" (vira débito do cliente) e "saldo_cliente" (usa crédito antecipado)
alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('dinheiro','pix','debito','credito','vale','outro','fiado','saldo_cliente'));

-- limite de fiado por cliente (0 = só com gerente)
alter table customers add column if not exists fiado_limit_cents bigint not null default 0 check (fiado_limit_cents >= 0);

-- Conta corrente do cliente: saldo = soma dos valores. Positivo = crédito do cliente; negativo = fiado em aberto.
create table if not exists customer_account (
  id              bigserial primary key,
  company_id      bigint not null,
  customer_id     bigint not null,
  kind            text not null check (kind in ('credito','uso_credito','fiado','pagamento_fiado','estorno','ajuste')),
  amount_cents    bigint not null check (amount_cents <> 0),
  method          text check (method in ('dinheiro','pix','debito','credito')), -- dinheiro que entrou no caixa (crédito e pagamento de fiado)
  cash_session_id bigint,
  session_id      bigint,
  payment_id      bigint,
  reverses_id     bigint references customer_account(id),
  over_limit      boolean not null default false,  -- fiado acima do limite liberado por gerente
  reason          text,
  idempotency_key text,
  user_id         bigint,
  created_at      timestamptz not null default now(),
  foreign key (company_id, customer_id) references customers(company_id, id)
);
create index if not exists customer_account_idx on customer_account (company_id, customer_id, id);
create index if not exists customer_account_cash_idx on customer_account (cash_session_id) where cash_session_id is not null;
create unique index if not exists customer_account_reverse_uq on customer_account (reverses_id) where reverses_id is not null;
create unique index if not exists customer_account_payment_uq on customer_account (payment_id, kind) where payment_id is not null;
create unique index if not exists customer_account_idem_uq on customer_account (company_id, idempotency_key) where idempotency_key is not null;

create or replace function customer_account_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;
  raise exception 'lançamentos da conta do cliente são imutáveis: registre um estorno';
end $$;
drop trigger if exists customer_account_immutable on customer_account;
create trigger customer_account_immutable before update or delete on customer_account for each row execute function customer_account_immutable();

-- a remoção da demonstração apaga a conta antes dos clientes
create or replace function purge_customer_account() returns trigger language plpgsql as $$
begin
  if current_setting('rusten.purge_demo', true) = old.company_id::text then
    delete from customer_account where company_id = old.company_id and customer_id = old.id;
  end if;
  return old;
end $$;
drop trigger if exists customers_purge_account on customers;
create trigger customers_purge_account before delete on customers for each row execute function purge_customer_account();
