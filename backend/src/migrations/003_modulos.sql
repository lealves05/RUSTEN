-- RUSTEN — 003: clientes e fidelidade, cozinha (KDS), estoque e fichas técnicas, compras, delivery e cardápio digital,
-- marketing (campanhas e avaliações) e agente de atendimento por WhatsApp.
-- Rollback: migrations/rollback/003_modulos.down.sql

-- Permissões novas entram nos perfis já existentes ------------------------------------------
create or replace function rusten_grant(p_keys text[], p_perms text[]) returns void language sql as $$
  update roles set permissions = (select array(select distinct unnest(permissions || p_perms)))
   where key = any(p_keys);
$$;
select rusten_grant(array['owner','admin','gerente'], array['clientes.visualizar','clientes.gerenciar','cozinha.operar',
  'delivery.gerenciar','estoque.visualizar','compras.gerenciar','marketing.gerenciar','agente.gerenciar','agente.atender']);
select rusten_grant(array['caixa','garcom'], array['clientes.visualizar','clientes.gerenciar']);
select rusten_grant(array['cozinha','bar'], array['cozinha.operar']);
select rusten_grant(array['estoque'], array['estoque.visualizar','compras.gerenciar']);
select rusten_grant(array['financeiro'], array['estoque.visualizar','clientes.visualizar']);
select rusten_grant(array['entregador'], array['delivery.entregar']);
select rusten_grant(array['owner','admin','gerente'], array['delivery.entregar']);
drop function rusten_grant(text[], text[]);

-- Endereço público da empresa (cardápio digital e avaliações)
alter table companies add column if not exists slug text;
create unique index if not exists companies_slug_uq on companies (slug) where slug is not null;

-- Clientes -----------------------------------------------------------------------------------
create table if not exists customers (
  id            bigserial primary key,
  company_id    bigint not null references companies(id),
  cpf           text check (cpf ~ '^[0-9]{11}$'),
  name          text not null,
  phone         text,
  email         text,
  birthday      date,
  address       jsonb not null default '{}'::jsonb,
  tags          text[] not null default '{}',
  preferences   text,
  notes         text,
  consent_whatsapp boolean not null default false,
  consent_email    boolean not null default false,
  consent_at    timestamptz,
  unsubscribed_at timestamptz,
  points        int not null default 0,
  anonymized_at timestamptz,
  created_by    bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id)
);
create unique index if not exists customers_cpf_uq on customers (company_id, cpf) where cpf is not null;
create index if not exists customers_phone_idx on customers (company_id, phone);
create index if not exists customers_name_idx on customers (company_id, lower(name));

alter table consumption_sessions add column if not exists customer_id bigint;
alter table consumption_sessions drop constraint if exists consumption_sessions_customer_fk;
alter table consumption_sessions add constraint consumption_sessions_customer_fk
  foreign key (company_id, customer_id) references customers(company_id, id);
create index if not exists sessions_customer_idx on consumption_sessions (company_id, customer_id) where customer_id is not null;

-- Extrato de pontos: somente inclusão; o saldo em customers.points é mantido pela mesma transação
create table if not exists loyalty_ledger (
  id           bigserial primary key,
  company_id   bigint not null,
  customer_id  bigint not null,
  session_id   bigint,
  kind         text not null check (kind in ('ganho','resgate','estorno','expiracao','ajuste')),
  points       int not null check (points <> 0),
  expires_at   date,
  reason       text,
  reverses_id  bigint references loyalty_ledger(id),
  payment_id   bigint,
  user_id      bigint,
  created_at   timestamptz not null default now(),
  foreign key (company_id, customer_id) references customers(company_id, id)
);
create index if not exists loyalty_customer_idx on loyalty_ledger (company_id, customer_id, id);
create unique index if not exists loyalty_reverse_once_uq on loyalty_ledger (reverses_id) where reverses_id is not null;

create table if not exists reviews (
  id           bigserial primary key,
  company_id   bigint not null references companies(id),
  session_id   bigint,
  customer_id  bigint,
  score        smallint not null check (score between 1 and 5),
  comment      text,
  handled_at   timestamptz,
  handled_by   bigint,
  created_at   timestamptz not null default now()
);
create unique index if not exists reviews_session_uq on reviews (company_id, session_id) where session_id is not null;

-- Cozinha / KDS ------------------------------------------------------------------------------
alter table production_sectors add column if not exists target_minutes int not null default 15 check (target_minutes between 1 and 240);
alter table order_items add column if not exists priority boolean not null default false;
alter table order_items add column if not exists accepted_at timestamptz;
alter table order_items add column if not exists ready_at timestamptz;
alter table order_items add column if not exists delivered_at timestamptz;
alter table order_items add column if not exists cancel_ack_at timestamptz;
alter table order_items add column if not exists sent_at timestamptz;
alter table order_items drop constraint if exists order_items_launch_mode_check;
alter table order_items add constraint order_items_launch_mode_check
  check (launch_mode in ('manual','continua','dupla','excecao','balcao','delivery'));
update order_items set sent_at = created_at where sent_at is null and kitchen_status <> 'nao_produz';
-- Envio por lote: itens aguardando confirmação (sent_at nulo) não aparecem na fila
create index if not exists items_kitchen_idx on order_items (company_id, sector_id, kitchen_status) where kitchen_status not in ('entregue','nao_produz');

-- Eventos de produção (somente inclusão): toda transição registrada uma vez
create table if not exists kitchen_events (
  id          bigserial primary key,
  company_id  bigint not null,
  item_id     bigint not null references order_items(id),
  from_status text,
  to_status   text not null,
  user_id     bigint,
  created_at  timestamptz not null default now()
);
create index if not exists kitchen_events_item_idx on kitchen_events (item_id);

-- Estoque ------------------------------------------------------------------------------------
create table if not exists stock_items (
  id            bigserial primary key,
  company_id    bigint not null references companies(id),
  name          text not null,
  unit          text not null check (unit in ('un','kg','g','L','ml')),
  min_qty       numeric(14,3) not null default 0,
  reorder_qty   numeric(14,3) not null default 0,
  avg_cost_cents numeric(16,4) not null default 0 check (avg_cost_cents >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (company_id, id)
);
create unique index if not exists stock_items_name_uq on stock_items (company_id, lower(name));

-- Estratégia por produto: nenhuma, ficha técnica (insumos) ou produto acabado — nunca as duas
alter table products add column if not exists stock_mode text not null default 'nenhum' check (stock_mode in ('nenhum','ficha','acabado'));
alter table products add column if not exists stock_item_id bigint;
alter table products drop constraint if exists products_stock_item_fk;
alter table products add constraint products_stock_item_fk foreign key (company_id, stock_item_id) references stock_items(company_id, id);
alter table products drop constraint if exists products_stock_mode_chk;
alter table products add constraint products_stock_mode_chk check (stock_mode <> 'acabado' or stock_item_id is not null);

-- Fichas técnicas versionadas: só uma vigente por produto
create table if not exists recipes (
  id          bigserial primary key,
  company_id  bigint not null,
  product_id  bigint not null,
  version     int not null,
  yield_qty   numeric(12,3) not null default 1 check (yield_qty > 0),
  notes       text,
  active      boolean not null default true,
  created_by  bigint,
  created_at  timestamptz not null default now(),
  foreign key (company_id, product_id) references products(company_id, id),
  unique (company_id, id),
  unique (product_id, version)
);
create unique index if not exists recipes_active_uq on recipes (product_id) where active;

create table if not exists recipe_lines (
  id            bigserial primary key,
  company_id    bigint not null,
  recipe_id     bigint not null,
  stock_item_id bigint not null,
  qty           numeric(14,4) not null check (qty > 0),
  loss_pct      numeric(5,2) not null default 0 check (loss_pct >= 0 and loss_pct < 100),
  foreign key (company_id, recipe_id) references recipes(company_id, id) on delete cascade,
  foreign key (company_id, stock_item_id) references stock_items(company_id, id)
);

-- Adicional que consome insumo (ex.: bacon extra)
alter table modifier_options add column if not exists stock_item_id bigint;
alter table modifier_options add column if not exists stock_qty numeric(14,4);

-- Movimentos imutáveis. Saldo = soma das quantidades. Reversões apontam para o original.
create table if not exists stock_movements (
  id            bigserial primary key,
  company_id    bigint not null,
  stock_item_id bigint not null,
  kind          text not null check (kind in ('entrada','venda','estorno_venda','perda','ajuste','inventario','producao_consumo','producao_entrada','reversao')),
  qty           numeric(14,4) not null check (qty <> 0),
  unit_cost_cents numeric(16,4),
  ref_type      text,
  ref_id        bigint,
  reverses_id   bigint references stock_movements(id),
  reason        text,
  user_id       bigint,
  created_at    timestamptz not null default now(),
  foreign key (company_id, stock_item_id) references stock_items(company_id, id)
);
create index if not exists stock_mov_item_idx on stock_movements (company_id, stock_item_id, created_at);
-- impede baixa dupla de um mesmo item vendido
create unique index if not exists stock_mov_sale_uq on stock_movements (company_id, ref_type, ref_id, stock_item_id, kind)
  where ref_type = 'order_item';
create unique index if not exists stock_mov_reverse_uq on stock_movements (reverses_id) where reverses_id is not null;

create or replace function stock_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;
  raise exception 'movimentos de estoque são imutáveis: registre uma reversão';
end $$;
drop trigger if exists stock_mov_immutable on stock_movements;
create trigger stock_mov_immutable before update or delete on stock_movements for each row execute function stock_immutable();

create table if not exists purchases (
  id           bigserial primary key,
  company_id   bigint not null references companies(id),
  supplier     text not null,
  document     text,
  status       text not null default 'aberta' check (status in ('aberta','parcial','recebida','cancelada')),
  due_date     date,
  notes        text,
  total_cents  bigint not null default 0,
  created_by   bigint,
  created_at   timestamptz not null default now(),
  unique (company_id, id)
);
create table if not exists purchase_lines (
  id             bigserial primary key,
  company_id     bigint not null,
  purchase_id    bigint not null,
  stock_item_id  bigint not null,
  qty            numeric(14,3) not null check (qty > 0),
  received_qty   numeric(14,3) not null default 0 check (received_qty >= 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  foreign key (company_id, purchase_id) references purchases(company_id, id) on delete cascade,
  foreign key (company_id, stock_item_id) references stock_items(company_id, id),
  check (received_qty <= qty)
);

create table if not exists inventory_counts (
  id          bigserial primary key,
  company_id  bigint not null references companies(id),
  status      text not null default 'aberto' check (status in ('aberto','aprovado','descartado')),
  lines       jsonb not null default '[]'::jsonb,
  notes       text,
  created_by  bigint,
  approved_by bigint,
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Delivery e cardápio digital ---------------------------------------------------------------
alter table consumption_sessions drop constraint if exists consumption_sessions_kind_check;
alter table consumption_sessions add constraint consumption_sessions_kind_check check (kind in ('comanda','mesa','balcao','retirada','delivery'));
alter table consumption_sessions add column if not exists delivery_fee_cents bigint not null default 0 check (delivery_fee_cents >= 0);

create table if not exists delivery_orders (
  id            bigserial primary key,
  company_id    bigint not null references companies(id),
  unit_id       bigint not null,
  session_id    bigint not null,
  number        int not null,
  public_token  text not null unique,
  channel       text not null default 'site' check (channel in ('site','whatsapp','telefone','balcao','marketplace')),
  mode          text not null check (mode in ('entrega','retirada')),
  status        text not null default 'recebido'
                check (status in ('recebido','confirmado','em_preparo','pronto','saiu','entregue','cancelado')),
  customer_id   bigint,
  customer_name text not null,
  phone         text not null,
  address       jsonb not null default '{}'::jsonb,
  payment_hint  text,
  change_for_cents bigint,
  notes         text,
  eta_minutes   int,
  courier_id    bigint,
  proof         text,
  cancel_reason text,
  client_key    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (company_id, session_id) references consumption_sessions(company_id, id),
  unique (company_id, number),
  unique (company_id, client_key)
);
create index if not exists delivery_status_idx on delivery_orders (company_id, status, created_at desc);

create table if not exists delivery_events (
  id         bigserial primary key,
  company_id bigint not null,
  order_id   bigint not null references delivery_orders(id),
  status     text not null,
  user_id    bigint,
  note       text,
  created_at timestamptz not null default now()
);

-- Marketing ----------------------------------------------------------------------------------
create table if not exists campaigns (
  id           bigserial primary key,
  company_id   bigint not null references companies(id),
  name         text not null,
  channel      text not null check (channel in ('whatsapp','email')),
  segment      jsonb not null default '{}'::jsonb,
  message      text not null,
  status       text not null default 'rascunho' check (status in ('rascunho','preparada','enviada','cancelada')),
  recipients   int not null default 0,
  prepared_at  timestamptz,
  created_by   bigint,
  created_at   timestamptz not null default now()
);
create table if not exists campaign_recipients (
  id           bigserial primary key,
  company_id   bigint not null,
  campaign_id  bigint not null references campaigns(id) on delete cascade,
  customer_id  bigint not null,
  status       text not null default 'pendente' check (status in ('pendente','enviado','falhou','descadastrado')),
  sent_at      timestamptz,
  error        text,
  unique (campaign_id, customer_id)
);

-- Agente WhatsApp ----------------------------------------------------------------------------
-- Credenciais da integração oficial: nunca devolvidas ao navegador
create table if not exists company_secrets (
  company_id  bigint not null references companies(id),
  key         text not null,
  value       text not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, key)
);
create table if not exists conversations (
  id           bigserial primary key,
  company_id   bigint not null references companies(id),
  channel      text not null check (channel in ('whatsapp','simulador')),
  contact      text not null,
  contact_name text,
  customer_id  bigint,
  mode         text not null default 'agente' check (mode in ('agente','humano','pausado')),
  assigned_to  bigint,
  state        jsonb not null default '{}'::jsonb,
  needs_human  boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (company_id, channel, contact)
);
create table if not exists conversation_messages (
  id              bigserial primary key,
  company_id      bigint not null,
  conversation_id bigint not null references conversations(id) on delete cascade,
  direction       text not null check (direction in ('in','out')),
  author          text not null check (author in ('cliente','agente','equipe','sistema')),
  body            text not null,
  external_id     text,
  delivery_status text not null default 'ok' check (delivery_status in ('ok','pendente','falhou','simulado')),
  error           text,
  user_id         bigint,
  created_at      timestamptz not null default now()
);
create unique index if not exists conv_msg_external_uq on conversation_messages (company_id, external_id) where external_id is not null;
create index if not exists conv_msg_conv_idx on conversation_messages (conversation_id, id);

-- Reservas (pedidas pelo agente ou registradas pela equipe)
create table if not exists reservations (
  id           bigserial primary key,
  company_id   bigint not null references companies(id),
  unit_id      bigint not null,
  customer_name text not null,
  phone        text,
  customer_id  bigint,
  people       int not null check (people between 1 and 100),
  starts_at    timestamptz not null,
  table_id     bigint,
  status       text not null default 'confirmada' check (status in ('pendente','confirmada','cancelada','chegou','nao_compareceu')),
  source       text not null default 'equipe' check (source in ('equipe','agente','site')),
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists reservations_day_idx on reservations (company_id, starts_at);

-- Demonstração: limpeza também dos módulos novos
create or replace function purge_demo_company(p_company bigint) returns void language plpgsql as $$
begin
  if not exists (select 1 from companies where id = p_company and is_demo) then
    raise exception 'empresa % não é de demonstração', p_company;
  end if;
  perform set_config('rusten.purge_demo', p_company::text, true);
  delete from conversation_messages where company_id = p_company;
  delete from conversations where company_id = p_company;
  delete from company_secrets where company_id = p_company;
  delete from reservations where company_id = p_company;
  delete from campaign_recipients where company_id = p_company;
  delete from campaigns where company_id = p_company;
  delete from delivery_events where company_id = p_company;
  delete from delivery_orders where company_id = p_company;
  delete from inventory_counts where company_id = p_company;
  delete from purchase_lines where company_id = p_company;
  delete from purchases where company_id = p_company;
  delete from stock_movements where company_id = p_company and reverses_id is not null;
  delete from stock_movements where company_id = p_company;
  delete from recipe_lines where company_id = p_company;
  delete from recipes where company_id = p_company;
  update modifier_options set stock_item_id = null where company_id = p_company;
  update products set stock_mode = 'nenhum', stock_item_id = null where company_id = p_company;
  delete from stock_items where company_id = p_company;
  delete from kitchen_events where company_id = p_company;
  delete from reviews where company_id = p_company;
  delete from loyalty_ledger where company_id = p_company and reverses_id is not null;
  delete from loyalty_ledger where company_id = p_company;
  delete from payments where company_id = p_company;
  delete from cash_movements where company_id = p_company;
  delete from cash_sessions where company_id = p_company;
  delete from order_items where company_id = p_company;
  delete from consumption_sessions where company_id = p_company;
  delete from customers where company_id = p_company;
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
