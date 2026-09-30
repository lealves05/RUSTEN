-- RUSTEN — 001: base multiempresa, perfis, cardápio, comandas/sessões, mesas, PDV, caixa, auditoria e central.
-- Somente criação de objetos. Rollback: migrations/rollback/001_base_pdv.down.sql

create table if not exists companies (
  id            bigserial primary key,
  name          text not null,
  segment       text not null default 'restaurante',
  document      text,
  email         text,
  phone         text,
  address       jsonb not null default '{}'::jsonb,
  timezone      text not null default 'America/Sao_Paulo',
  settings      jsonb not null default '{}'::jsonb,
  -- situação entregue pela central (MASTER do ORBI). Vazio = sem central configurada.
  access        jsonb not null default '{}'::jsonb,
  access_updated_at timestamptz,
  created_at    timestamptz not null default now(),
  last_access_at timestamptz
);

create table if not exists units (
  id          bigserial primary key,
  company_id  bigint not null references companies(id),
  name        text not null,
  active      boolean not null default true,
  -- jornada que atravessa a meia-noite: vendas antes deste horário contam no dia comercial anterior
  day_cutoff  smallint not null default 5 check (day_cutoff between 0 and 12),
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (company_id, id)
);

create table if not exists roles (
  id          bigserial primary key,
  company_id  bigint not null references companies(id),
  key         text not null,
  name        text not null,
  level       smallint not null default 10,
  permissions text[] not null default '{}',
  system      boolean not null default false,
  unique (company_id, key)
);

create table if not exists users (
  id            bigserial primary key,
  company_id    bigint not null references companies(id),
  unit_id       bigint,
  name          text not null,
  email         text not null,
  password_hash text not null,
  role_key      text not null,
  active        boolean not null default true,
  failed_attempts int not null default 0,
  locked_until  timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  foreign key (company_id, unit_id) references units(company_id, id),
  foreign key (company_id, role_key) references roles(company_id, key) on update cascade
);
create unique index if not exists users_email_uq on users (lower(email));
create unique index if not exists users_company_id_uq on users (company_id, id);

create table if not exists user_sessions (
  id           uuid primary key,
  user_id      bigint not null references users(id),
  refresh_hash text not null,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  rotated_at   timestamptz,
  ip           text,
  created_at   timestamptz not null default now()
);

create table if not exists terminals (
  id          bigserial primary key,
  company_id  bigint not null,
  unit_id     bigint not null,
  name        text not null,
  active      boolean not null default true,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  foreign key (company_id, unit_id) references units(company_id, id),
  unique (company_id, id)
);

create table if not exists audit_events (
  id          bigserial primary key,
  company_id  bigint not null references companies(id),
  unit_id     bigint,
  terminal_id bigint,
  user_id     bigint,
  action      text not null,
  entity      text,
  entity_id   text,
  reason      text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_company_idx on audit_events (company_id, created_at desc);

create or replace function audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'auditoria é somente inclusão';
end $$;
drop trigger if exists audit_no_change on audit_events;
create trigger audit_no_change before update or delete on audit_events
  for each row execute function audit_immutable();

-- Cardápio ---------------------------------------------------------------
create table if not exists production_sectors (
  id         bigserial primary key,
  company_id bigint not null references companies(id),
  name       text not null,
  active     boolean not null default true,
  unique (company_id, id)
);

create table if not exists categories (
  id         bigserial primary key,
  company_id bigint not null references companies(id),
  name       text not null,
  sort       int not null default 0,
  active     boolean not null default true,
  demo       boolean not null default false,
  unique (company_id, id)
);

create table if not exists products (
  id           bigserial primary key,
  company_id   bigint not null references companies(id),
  category_id  bigint,
  sector_id    bigint,
  name         text not null,
  description  text,
  sku          text,
  kind         text not null default 'resale'
               check (kind in ('resale','recipe','produced','combo','addon','weight')),
  unit         text not null default 'un' check (unit in ('un','kg','g','L','ml')),
  price_cents  bigint not null check (price_cents >= 0),
  cost_cents   bigint not null default 0 check (cost_cents >= 0),
  favorite     boolean not null default false,
  active       boolean not null default true,
  channels     text[] not null default '{pdv}',
  allergens    text,
  demo         boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (company_id, category_id) references categories(company_id, id),
  foreign key (company_id, sector_id) references production_sectors(company_id, id),
  unique (company_id, id)
);
create unique index if not exists products_sku_uq on products (company_id, sku) where sku is not null;

create table if not exists product_price_history (
  id          bigserial primary key,
  company_id  bigint not null,
  product_id  bigint not null,
  old_cents   bigint,
  new_cents   bigint not null,
  user_id     bigint,
  created_at  timestamptz not null default now(),
  foreign key (company_id, product_id) references products(company_id, id)
);

-- Códigos lidos pelo PDV. Texto (preserva zeros à esquerda). Um código pertence a UMA entidade da empresa.
create table if not exists scan_codes (
  id          bigserial primary key,
  company_id  bigint not null references companies(id),
  code        text not null,
  entity      text not null check (entity in ('PRODUTO','COMANDA','MESA','CLIENTE','FUNCIONARIO','PEDIDO')),
  entity_id   bigint not null,
  created_at  timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists scan_codes_entity_idx on scan_codes (company_id, entity, entity_id);

create table if not exists modifier_groups (
  id          bigserial primary key,
  company_id  bigint not null,
  product_id  bigint not null,
  name        text not null,
  min_select  int not null default 0 check (min_select >= 0),
  max_select  int not null default 1 check (max_select >= 1),
  sort        int not null default 0,
  foreign key (company_id, product_id) references products(company_id, id) on delete cascade,
  unique (company_id, id),
  check (min_select <= max_select)
);

create table if not exists modifier_options (
  id          bigserial primary key,
  company_id  bigint not null,
  group_id    bigint not null,
  name        text not null,
  price_cents bigint not null default 0 check (price_cents >= 0),
  active      boolean not null default true,
  foreign key (company_id, group_id) references modifier_groups(company_id, id) on delete cascade,
  unique (company_id, id)
);

-- Salão ------------------------------------------------------------------
create table if not exists dining_tables (
  id          bigserial primary key,
  company_id  bigint not null,
  unit_id     bigint not null,
  number      int not null,
  area        text not null default 'Salão',
  capacity    int not null default 4 check (capacity > 0),
  status      text not null default 'livre'
              check (status in ('livre','ocupada','reservada','conta','limpeza')),
  pos_x       int not null default 0,
  pos_y       int not null default 0,
  active      boolean not null default true,
  foreign key (company_id, unit_id) references units(company_id, id),
  unique (company_id, unit_id, number),
  unique (company_id, id)
);

-- Cartão físico reutilizável (não confundir com a sessão de consumo)
create table if not exists tab_cards (
  id           bigserial primary key,
  company_id   bigint not null,
  unit_id      bigint not null,
  number       int not null,
  status       text not null default 'ativo' check (status in ('ativo','bloqueado')),
  block_reason text,
  created_at   timestamptz not null default now(),
  foreign key (company_id, unit_id) references units(company_id, id),
  unique (company_id, unit_id, number),
  unique (company_id, id)
);

create table if not exists consumption_sessions (
  id             bigserial primary key,
  company_id     bigint not null,
  unit_id        bigint not null,
  kind           text not null default 'comanda' check (kind in ('comanda','mesa','balcao','retirada')),
  card_id        bigint,
  table_id       bigint,
  customer_name  text,
  label          text,
  status         text not null default 'aberta'
                 check (status in ('aberta','em_fechamento','encerrada','cancelada')),
  service_fee_bp int not null default 0 check (service_fee_bp between 0 and 3000),
  service_fee_removed_reason text,
  opened_by      bigint,
  opened_at      timestamptz not null default now(),
  closed_by      bigint,
  closed_at      timestamptz,
  business_date  date not null,
  version        int not null default 1,
  suspended      boolean not null default false,
  foreign key (company_id, unit_id) references units(company_id, id),
  foreign key (company_id, card_id) references tab_cards(company_id, id),
  foreign key (company_id, table_id) references dining_tables(company_id, id),
  unique (company_id, id)
);
-- no máximo uma sessão ativa por cartão
create unique index if not exists sessions_card_active_uq on consumption_sessions (card_id)
  where card_id is not null and status in ('aberta','em_fechamento');
create index if not exists sessions_open_idx on consumption_sessions (company_id, status);

create table if not exists order_items (
  id              bigserial primary key,
  company_id      bigint not null,
  session_id      bigint not null,
  product_id      bigint not null,
  description     text not null,
  qty             numeric(12,3) not null check (qty > 0),
  unit            text not null default 'un',
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  modifiers       jsonb not null default '[]'::jsonb,
  modifiers_cents bigint not null default 0,
  discount_cents  bigint not null default 0 check (discount_cents >= 0),
  total_cents     bigint not null check (total_cents >= 0),
  notes           text,
  sector_id       bigint,
  status          text not null default 'ativo' check (status in ('ativo','cancelado')),
  kitchen_status  text not null default 'novo'
                  check (kitchen_status in ('novo','aceito','preparando','pronto','entregue','cancelado','nao_produz')),
  launch_mode     text not null check (launch_mode in ('manual','continua','dupla','excecao','balcao')),
  terminal_id     bigint,
  user_id         bigint,
  idempotency_key text not null,
  transferred_from bigint,
  cancel_reason   text,
  canceled_by     bigint,
  canceled_at     timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (company_id, session_id) references consumption_sessions(company_id, id),
  foreign key (company_id, product_id) references products(company_id, id),
  unique (company_id, idempotency_key)
);
create index if not exists items_session_idx on order_items (session_id);

-- Caixa ------------------------------------------------------------------
create table if not exists cash_sessions (
  id              bigserial primary key,
  company_id      bigint not null,
  unit_id         bigint not null,
  terminal_id     bigint,
  user_id         bigint not null,
  status          text not null default 'aberto' check (status in ('aberto','fechado')),
  opening_cents   bigint not null default 0 check (opening_cents >= 0),
  opened_at       timestamptz not null default now(),
  business_date   date not null,
  closed_at       timestamptz,
  closed_by       bigint,
  counted         jsonb,
  expected        jsonb,
  difference_cents bigint,
  justification   text,
  foreign key (company_id, unit_id) references units(company_id, id),
  unique (company_id, id)
);
create unique index if not exists cash_open_terminal_uq on cash_sessions (company_id, terminal_id)
  where status = 'aberto' and terminal_id is not null;

create table if not exists cash_movements (
  id              bigserial primary key,
  company_id      bigint not null,
  cash_session_id bigint not null,
  kind            text not null check (kind in ('sangria','suprimento','despesa')),
  amount_cents    bigint not null check (amount_cents > 0),
  reason          text not null,
  user_id         bigint,
  created_at      timestamptz not null default now(),
  foreign key (company_id, cash_session_id) references cash_sessions(company_id, id)
);

create table if not exists payments (
  id              bigserial primary key,
  company_id      bigint not null,
  session_id      bigint not null,
  cash_session_id bigint,
  method          text not null check (method in ('dinheiro','pix','debito','credito','vale','outro')),
  amount_cents    bigint not null check (amount_cents > 0),
  tendered_cents  bigint,
  change_cents    bigint not null default 0 check (change_cents >= 0),
  status          text not null default 'confirmado' check (status in ('confirmado','estornado')),
  -- origem: informado pelo operador, importado de relatório ou confirmado por integração oficial
  source          text not null default 'operador' check (source in ('operador','importado','integracao')),
  business_date   date not null,
  idempotency_key text not null,
  user_id         bigint,
  refund_reason   text,
  refunded_by     bigint,
  refunded_at     timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (company_id, session_id) references consumption_sessions(company_id, id),
  unique (company_id, idempotency_key)
);
create index if not exists payments_session_idx on payments (session_id);

-- Autorização gerencial individual, de uso único e validade curta
create table if not exists manager_authorizations (
  id            bigserial primary key,
  company_id    bigint not null,
  requested_by  bigint not null,
  authorized_by bigint not null,
  action        text not null,
  scope         jsonb not null default '{}'::jsonb,
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists rate_limits (
  key       text primary key,
  count     int not null,
  reset_at  timestamptz not null
);

-- Central (MASTER do ORBI): proteção contra repetição de chamadas assinadas
create table if not exists platform_nonces (
  nonce      text primary key,
  created_at timestamptz not null default now()
);

create table if not exists platform_outbox (
  id          bigserial primary key,
  company_id  bigint,
  kind        text not null,
  payload     jsonb not null,
  attempts    int not null default 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
