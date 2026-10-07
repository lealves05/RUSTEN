// RUSTEN API — gerado por scripts/build-edge.mjs. Não editar à mão.
var Si=Object.defineProperty;var zi=(e,a,t)=>()=>{if(t)throw t[0];try{return e&&(a=e(e=0)),a}catch(n){throw t=[n],n}};var Ci=(e,a)=>{for(var t in a)Si(e,t,{get:a[t],enumerable:!0})};var Ka={};Ci(Ka,{MIGRATIONS:()=>Mi});var Mi,Xa=zi(()=>{Mi=[{name:"001_base_pdv.sql",sql:`-- RUSTEN \u2014 001: base multiempresa, perfis, card\xE1pio, comandas/sess\xF5es, mesas, PDV, caixa, \
auditoria e central.
-- Somente cria\xE7\xE3o de objetos. Rollback: migrations/rollback/001_base_pdv.down.sql

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
  -- situa\xE7\xE3o entregue pela central (MASTER do ORBI). Vazio = sem central configurada.
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
  -- jornada que atravessa a meia-noite: vendas antes deste hor\xE1rio contam no dia comercial anterior
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
  raise exception 'auditoria \xE9 somente inclus\xE3o';
end $$;
drop trigger if exists audit_no_change on audit_events;
create trigger audit_no_change before update or delete on audit_events
  for each row execute function audit_immutable();

-- Card\xE1pio ---------------------------------------------------------------
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

-- C\xF3digos lidos pelo PDV. Texto (preserva zeros \xE0 esquerda). Um c\xF3digo pertence a UMA entidade da empresa.
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

-- Sal\xE3o ------------------------------------------------------------------
create table if not exists dining_tables (
  id          bigserial primary key,
  company_id  bigint not null,
  unit_id     bigint not null,
  number      int not null,
  area        text not null default 'Sal\xE3o',
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

-- Cart\xE3o f\xEDsico reutiliz\xE1vel (n\xE3o confundir com a sess\xE3o de consumo)
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
-- no m\xE1ximo uma sess\xE3o ativa por cart\xE3o
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
  -- origem: informado pelo operador, importado de relat\xF3rio ou confirmado por integra\xE7\xE3o oficial
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

-- Autoriza\xE7\xE3o gerencial individual, de uso \xFAnico e validade curta
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

-- Central (MASTER do ORBI): prote\xE7\xE3o contra repeti\xE7\xE3o de chamadas assinadas
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
`},{name:"002_central_demo.sql",sql:`-- RUSTEN \u2014 002: liga\xE7\xE3o com a central da plataforma (MASTER do ORBI, contrato v1) e empresas de demonstra\xE7\xE3o.
-- Rollback: migrations/rollback/002_central_demo.down.sql

-- Demonstra\xE7\xE3o: nunca vai para a central, nunca \xE9 bloqueada e \xE9 apagada ap\xF3s 7 dias sem convers\xE3o
alter table companies add column if not exists is_demo boolean not null default false;
create index if not exists companies_demo_idx on companies (created_at) where is_demo;

-- Configura\xE7\xE3o da central quando n\xE3o h\xE1 vari\xE1veis de ambiente (Supabase Edge): platform_hub_url, platform_secret
create table if not exists platform_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Par\xE2metros do sistema (valem para todas as empresas), edit\xE1veis pelo MASTER da central
create table if not exists system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Auditoria segue somente inclus\xE3o; a \xFAnica exce\xE7\xE3o \xE9 apagar uma empresa de demonstra\xE7\xE3o inteira
create or replace function audit_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('rusten.purge_demo', true) = old.company_id::text then
    return old;
  end if;
  raise exception 'auditoria \xE9 somente inclus\xE3o';
end $$;

-- Apaga uma empresa de demonstra\xE7\xE3o e tudo o que pertence a ela (recusa empresas reais)
create or replace function purge_demo_company(p_company bigint) returns void language plpgsql as $$
begin
  if not exists (select 1 from companies where id = p_company and is_demo) then
    raise exception 'empresa % n\xE3o \xE9 de demonstra\xE7\xE3o', p_company;
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
`},{name:"003_modulos.sql",sql:`-- RUSTEN \u2014 003: clientes e fidelidade, cozinha (KDS), estoque e fichas t\xE9cnicas, compras, delivery e card\xE1pio digital,
-- marketing (campanhas e avalia\xE7\xF5es) e agente de atendimento por WhatsApp.
-- Rollback: migrations/rollback/003_modulos.down.sql

-- Permiss\xF5es novas entram nos perfis j\xE1 existentes ------------------------------------------
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

-- Endere\xE7o p\xFAblico da empresa (card\xE1pio digital e avalia\xE7\xF5es)
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

-- Extrato de pontos: somente inclus\xE3o; o saldo em customers.points \xE9 mantido pela mesma transa\xE7\xE3o
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
-- Envio por lote: itens aguardando confirma\xE7\xE3o (sent_at nulo) n\xE3o aparecem na fila
create index if not exists items_kitchen_idx on order_items (company_id, sector_id, kitchen_status) where kitchen_status not in ('entregue','nao_produz');

-- Eventos de produ\xE7\xE3o (somente inclus\xE3o): toda transi\xE7\xE3o registrada uma vez
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

-- Estrat\xE9gia por produto: nenhuma, ficha t\xE9cnica (insumos) ou produto acabado \u2014 nunca as duas
alter table products add column if not exists stock_mode text not null default 'nenhum' check (stock_mode in ('nenhum','ficha','acabado'));
alter table products add column if not exists stock_item_id bigint;
alter table products drop constraint if exists products_stock_item_fk;
alter table products add constraint products_stock_item_fk foreign key (company_id, stock_item_id) references stock_items(company_id, id);
alter table products drop constraint if exists products_stock_mode_chk;
alter table products add constraint products_stock_mode_chk check (stock_mode <> 'acabado' or stock_item_id is not null);

-- Fichas t\xE9cnicas versionadas: s\xF3 uma vigente por produto
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

-- Movimentos imut\xE1veis. Saldo = soma das quantidades. Revers\xF5es apontam para o original.
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
  raise exception 'movimentos de estoque s\xE3o imut\xE1veis: registre uma revers\xE3o';
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

-- Delivery e card\xE1pio digital ---------------------------------------------------------------
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
-- Credenciais da integra\xE7\xE3o oficial: nunca devolvidas ao navegador
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

-- Demonstra\xE7\xE3o: limpeza tamb\xE9m dos m\xF3dulos novos
create or replace function purge_demo_company(p_company bigint) returns void language plpgsql as $$
begin
  if not exists (select 1 from companies where id = p_company and is_demo) then
    raise exception 'empresa % n\xE3o \xE9 de demonstra\xE7\xE3o', p_company;
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
`},{name:"004_leitura_notas.sql",sql:`-- RUSTEN \u2014 004: leitura de notas e pedidos de compra (foto ou XML da NF-e) para lan\xE7ar no estoque.
-- Rollback: migrations/rollback/004_leitura_notas.down.sql

-- Como cada fornecedor escreve o insumo na nota \u2192 insumo do estoque (aprendido a cada confirma\xE7\xE3o)
create table if not exists stock_aliases (
  company_id    bigint not null references companies(id),
  alias         text not null,
  stock_item_id bigint not null,
  factor        numeric(14,4) not null default 1 check (factor > 0),
  updated_at    timestamptz not null default now(),
  primary key (company_id, alias),
  foreign key (company_id, stock_item_id) references stock_items(company_id, id) on delete cascade
);

-- Origem da compra (lan\xE7ada \xE0 m\xE3o, por foto ou por XML) e chave da NF-e para n\xE3o lan\xE7ar a mesma nota duas vezes
alter table purchases add column if not exists source text not null default 'manual' check (source in ('manual','foto','xml'));
alter table purchases add column if not exists nfe_key text;
create unique index if not exists purchases_nfe_key_uq on purchases (company_id, nfe_key) where nfe_key is not null and status <> 'cancelada';
`},{name:"005_correcao_estoque.sql",sql:`-- RUSTEN \u2014 005: corre\xE7\xE3o de estoque com trilha de auditoria (motivo, justificativa, valor, aprova\xE7\xE3o por outra pessoa).
-- Rollback: migrations/rollback/005_correcao_estoque.down.sql

-- novo tipo de movimento: corre\xE7\xE3o aprovada (nunca edita movimentos anteriores)
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
  value_cents      bigint not null,                 -- impacto financeiro (diferen\xE7a \xD7 custo m\xE9dio)
  reason_code      text not null check (reason_code in ('contagem','quebra','vencimento','erro_lancamento','consumo_interno','furto_desvio','devolucao','outro')),
  justification    text not null check (length(justification) >= 15),
  evidence         text,
  status           text not null default 'pendente' check (status in ('pendente','aplicada','rejeitada','expirada')),
  needs_approval   boolean not null,
  approval_rule    text,                            -- por que precisou de aprova\xE7\xE3o (limite, %, motivo, perfil)
  requested_by     bigint not null,
  requested_ip     text,
  decided_by       bigint,
  decided_at       timestamptz,
  decision_note    text,
  self_approved    boolean not null default false,  -- aprovado pelo pr\xF3prio solicitante (s\xF3 sem outro aprovador na empresa)
  movement_id      bigint,
  created_at       timestamptz not null default now(),
  foreign key (company_id, stock_item_id) references stock_items(company_id, id) on delete cascade
);
create index if not exists stock_corr_company_idx on stock_corrections (company_id, created_at desc);
create index if not exists stock_corr_item_idx on stock_corrections (company_id, stock_item_id, created_at desc);
-- uma corre\xE7\xE3o pendente por insumo (evita pedidos duplicados e conflitantes)
create unique index if not exists stock_corr_pending_uq on stock_corrections (company_id, stock_item_id) where status = 'pendente';

-- registro decidido n\xE3o muda mais; nada \xE9 apagado (exceto na remo\xE7\xE3o da demonstra\xE7\xE3o)
create or replace function stock_corr_guard() returns trigger language plpgsql as $$
begin
  if current_setting('rusten.purge_demo', true) = old.company_id::text then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then raise exception 'corre\xE7\xF5es de estoque n\xE3o podem ser apagadas'; end if;
  if old.status <> 'pendente' then raise exception 'corre\xE7\xE3o j\xE1 decidida n\xE3o pode ser alterada'; end if;
  if new.stock_item_id <> old.stock_item_id or new.counted_qty <> old.counted_qty or new.system_qty <> old.system_qty
     or new.diff_qty <> old.diff_qty or new.value_cents <> old.value_cents or new.reason_code <> old.reason_code
     or new.justification <> old.justification or new.requested_by <> old.requested_by or new.created_at <> old.created_at then
    raise exception 'os dados do pedido de corre\xE7\xE3o n\xE3o podem ser alterados';
  end if;
  return new;
end $$;
drop trigger if exists stock_corr_guard on stock_corrections;
create trigger stock_corr_guard before update or delete on stock_corrections for each row execute function stock_corr_guard();
`},{name:"006_conta_cliente.sql",sql:`-- RUSTEN \u2014 006: conta do cliente (cr\xE9dito antecipado e fiado) vinculada ao CPF, integrada ao recebimento da comanda.
-- Rollback: migrations/rollback/006_conta_cliente.down.sql

-- novas formas de recebimento: "fiado" (vira d\xE9bito do cliente) e "saldo_cliente" (usa cr\xE9dito antecipado)
alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('dinheiro','pix','debito','credito','vale','outro','fiado','saldo_cliente'));

-- limite de fiado por cliente (0 = s\xF3 com gerente)
alter table customers add column if not exists fiado_limit_cents bigint not null default 0 check (fiado_limit_cents >= 0);

-- Conta corrente do cliente: saldo = soma dos valores. Positivo = cr\xE9dito do cliente; negativo = fiado em aberto.
create table if not exists customer_account (
  id              bigserial primary key,
  company_id      bigint not null,
  customer_id     bigint not null,
  kind            text not null check (kind in ('credito','uso_credito','fiado','pagamento_fiado','estorno','ajuste')),
  amount_cents    bigint not null check (amount_cents <> 0),
  method          text check (method in ('dinheiro','pix','debito','credito')), -- dinheiro que entrou no caixa (cr\xE9dito e pagamento de fiado)
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
  raise exception 'lan\xE7amentos da conta do cliente s\xE3o imut\xE1veis: registre um estorno';
end $$;
drop trigger if exists customer_account_immutable on customer_account;
create trigger customer_account_immutable before update or delete on customer_account for each row execute function customer_account_immutable();

-- a remo\xE7\xE3o da demonstra\xE7\xE3o apaga a conta antes dos clientes
create or replace function purge_customer_account() returns trigger language plpgsql as $$
begin
  if current_setting('rusten.purge_demo', true) = old.company_id::text then
    delete from customer_account where company_id = old.company_id and customer_id = old.id;
  end if;
  return old;
end $$;
drop trigger if exists customers_purge_account on customers;
create trigger customers_purge_account before delete on customers for each row execute function purge_customer_account();
`},{name:"007_redefinir_senha.sql",sql:`-- RUSTEN \u2014 007: "Esqueci minha senha" com link de uso \xFAnico enviado pela central (remetente da plataforma).
-- Rollback: migrations/rollback/007_redefinir_senha.down.sql
create table if not exists password_resets (
  id          bigserial primary key,
  user_id     bigint not null references users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists password_resets_user_idx on password_resets (user_id, created_at desc);
`},{name:"008_infinitepay.sql",sql:`-- RUSTEN \u2014 008: integra\xE7\xE3o com a InfinitePay (Checkout Integrado: link Pix/cart\xE3o, confirma\xE7\xE3o por webhook e consulta).
-- Rollback: migrations/rollback/008_infinitepay.down.sql
create table if not exists infinitepay_charges (
  id               bigserial primary key,
  company_id       bigint not null references companies(id),
  session_id       bigint,
  cash_session_id  bigint,
  order_nsu        text not null unique,          -- identificador do RUSTEN enviado \xE0 InfinitePay
  token            text not null unique,          -- segredo do retorno/webhook desta cobran\xE7a
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

-- tudo o que chega da InfinitePay fica registrado (confer\xEAncia e auditoria)
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

-- remo\xE7\xE3o da demonstra\xE7\xE3o
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
`},{name:"009_vendas_maquininha.sql",sql:`-- RUSTEN \u2014 009: vendas feitas direto na maquininha (fora do RUSTEN), importadas do relat\xF3rio da InfinitePay.
-- Cada importa\xE7\xE3o guarda o resumo do per\xEDodo, os valores por dia e por forma; cancelar n\xE3o apaga (fica no hist\xF3rico).
-- Rollback: migrations/rollback/009_vendas_maquininha.down.sql
create table if not exists pos_sales_imports (
  id              bigserial primary key,
  company_id      bigint not null references companies(id),
  provider        text not null default 'infinitepay',
  mode            text not null check (mode in ('externa','conferencia')), -- externa: soma ao faturamento; conferencia: s\xF3 compara
  file_name       text not null,
  file_sha256     text not null,
  file_data       bytea,                                -- relat\xF3rio original (para confer\xEAncia)
  account_label   text,
  period_from     date not null,
  period_to       date not null check (period_to >= period_from),
  generated_on    date,
  gross_cents     bigint not null check (gross_cents >= 0),
  net_cents       bigint not null check (net_cents >= 0 and net_cents <= gross_cents),
  fee_cents       bigint not null check (fee_cents >= 0),
  tx_count        int not null check (tx_count >= 0),
  methods         jsonb not null default '[]'::jsonb,   -- [{method, label, gross_cents}]
  products        jsonb not null default '[]'::jsonb,   -- [{name, qty}] (ranking do relat\xF3rio; pode ser parcial)
  categories      jsonb not null default '[]'::jsonb,   -- [{name, qty}]
  notes           jsonb not null default '[]'::jsonb,   -- observa\xE7\xF5es do pr\xF3prio relat\xF3rio
  status          text not null default 'ativo' check (status in ('ativo','cancelado')),
  created_by      bigint,
  created_at      timestamptz not null default now(),
  canceled_by     bigint,
  canceled_at     timestamptz,
  cancel_reason   text
);
-- o mesmo arquivo n\xE3o entra duas vezes enquanto a importa\xE7\xE3o estiver ativa
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
-- um dia s\xF3 pode estar em uma importa\xE7\xE3o ativa (evita somar a mesma venda duas vezes)
create unique index if not exists pos_sales_days_uq on pos_sales_days (company_id, provider, day) where active;
create index if not exists pos_sales_days_import_idx on pos_sales_days (import_id);

-- valores importados n\xE3o s\xE3o editados: s\xF3 cancelados (com motivo) e reimportados
create or replace function pos_sales_imports_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;
    raise exception 'Importa\xE7\xE3o de vendas n\xE3o pode ser apagada; cancele-a';
  end if;
  if (new.gross_cents, new.net_cents, new.fee_cents, new.tx_count, new.period_from, new.period_to, new.mode, new.file_sha256, new.company_id)
     is distinct from (old.gross_cents, old.net_cents, old.fee_cents, old.tx_count, old.period_from, old.period_to, old.mode, old.file_sha256, old.company_id) then
    raise exception 'Valores importados n\xE3o podem ser alterados; cancele e importe de novo';
  end if;
  return new;
end $$;
create or replace function pos_sales_days_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;
    raise exception 'Importa\xE7\xE3o de vendas n\xE3o pode ser apagada; cancele-a';
  end if;
  if (new.gross_cents, new.net_cents, new.tx_count, new.day, new.import_id, new.company_id) is distinct from (old.gross_cents, old.net_cents, old.tx_count, old.day, old.import_id, \
old.company_id) then
    raise exception 'Valores importados n\xE3o podem ser alterados; cancele e importe de novo';
  end if;
  if new.active and not old.active then raise exception 'Dia cancelado n\xE3o volta a valer; importe de novo'; end if;
  return new;
end $$;
drop trigger if exists pos_sales_imports_guard on pos_sales_imports;
create trigger pos_sales_imports_guard before update or delete on pos_sales_imports for each row execute function pos_sales_imports_guard();
drop trigger if exists pos_sales_days_guard on pos_sales_days;
create trigger pos_sales_days_guard before update or delete on pos_sales_days for each row execute function pos_sales_days_guard();

-- remo\xE7\xE3o da demonstra\xE7\xE3o
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
`},{name:"010_maquininha_estoque.sql",sql:`-- RUSTEN \u2014 010: produtos vendidos na maquininha \u2192 sa\xEDda no estoque.
-- Cada linha do relat\xF3rio (ou acrescentada \xE0 m\xE3o) \xE9 ligada a um produto do card\xE1pio; ao lan\xE7ar, o estoque sai pela
-- ficha t\xE9cnica/produto acabado (movimento "venda" com ref_type 'pos_sales_item'). Cancelar a importa\xE7\xE3o estorna.
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

-- nomes da maquininha j\xE1 ligados a um produto (a pr\xF3xima importa\xE7\xE3o reconhece sozinha)
create table if not exists pos_product_aliases (
  company_id  bigint not null references companies(id),
  provider    text not null default 'infinitepay',
  alias_norm  text not null,
  product_id  bigint not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, provider, alias_norm)
);

-- uma \xFAnica baixa por linha e insumo
create unique index if not exists stock_mov_pos_uq on stock_movements (company_id, ref_type, ref_id, stock_item_id, kind)
  where ref_type = 'pos_sales_item';

-- linha baixada n\xE3o muda (s\xF3 estorna)
create or replace function pos_sales_items_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;
    if old.status in ('baixado','estornado') then raise exception 'Linha j\xE1 lan\xE7ada no estoque n\xE3o pode ser apagada; cancele a importa\xE7\xE3o'; end if;
    return old;
  end if;
  if old.status in ('baixado','estornado') and (new.qty, new.product_id, new.import_id, new.company_id) is distinct from (old.qty, old.product_id, old.import_id, old.company_id) th\
en
    raise exception 'Linha j\xE1 lan\xE7ada no estoque n\xE3o pode ser alterada';
  end if;
  if old.status = 'estornado' and new.status <> 'estornado' then raise exception 'Linha estornada n\xE3o volta'; end if;
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
-- roda antes da limpeza das importa\xE7\xF5es (ordem alfab\xE9tica dos gatilhos)
drop trigger if exists companies_purge_pos_items on companies;
create trigger companies_purge_pos_items before delete on companies for each row execute function purge_pos_sales_items();
`},{name:"011_compras_codigo_barras.sql",sql:`-- RUSTEN \u2014 011: entrada de compras pelo c\xF3digo de barras (chave da NF-e no DANFE ou pedido de compra impresso pelo RUSTEN).
-- CNPJ do fornecedor guardado na compra para reconhecer o fornecedor pela chave da pr\xF3xima nota.
-- Rollback: migrations/rollback/011_compras_codigo_barras.down.sql
alter table purchases add column if not exists supplier_doc text;
create index if not exists purchases_supplier_doc_idx on purchases (company_id, supplier_doc) where supplier_doc is not null;
`},{name:"012_foto_produto.sql",sql:`-- RUSTEN \u2014 012: foto opcional do produto (card\xE1pio digital). S\xF3 adiciona colunas; produtos existentes ficam sem foto.
-- A imagem fica no pr\xF3prio banco (data URL j\xE1 reduzida no navegador, at\xE9 ~300 KB) e \xE9 servida por /api/public/:slug/foto/:id.
-- Rollback: migrations/rollback/012_foto_produto.down.sql
alter table products add column if not exists photo text;
alter table products add column if not exists photo_updated_at timestamptz;
`},{name:"013_marca.sql",sql:`-- RUSTEN \u2014 013: marca do estabelecimento (logotipo e imagens de fundo do sistema e da TV).
-- Imagens reduzidas no navegador e guardadas como data URL (PNG/JPEG/WebP; nunca SVG). Uma por tipo e empresa.
-- Rollback: migrations/rollback/013_marca.down.sql
create table if not exists company_assets (
  company_id  bigint not null references companies(id) on delete cascade,
  kind        text not null check (kind in ('logo', 'fundo', 'tv_fundo')),
  data_url    text not null,
  bytes       int not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, kind)
);
`},{name:"014_excluir_empresa.sql",sql:`-- RUSTEN \u2014 014: exclus\xE3o de empresa pedida pela central da plataforma (MASTER do ORBI).
-- Apaga a empresa e tudo o que \xE9 dela, em todas as tabelas que t\xEAm company_id (lista lida do cat\xE1logo, ent\xE3o
-- tabelas novas entram sozinhas). As travas de registros imut\xE1veis (auditoria, estoque, conta do cliente, vendas
-- importadas) s\xF3 s\xE3o liberadas para esta empresa e s\xF3 dentro da transa\xE7\xE3o (rusten.purge_demo = id da empresa).
-- Todas as exclus\xF5es rodam num \xFAnico comando: as refer\xEAncias entre as tabelas da empresa s\xE3o checadas no fim dele.
-- Rollback: migrations/rollback/014_excluir_empresa.down.sql
create or replace function purge_company(p_company bigint) returns integer language plpgsql as $$
declare
  t record;
  parts text[] := '{}';
  n int := 0;
begin
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'empresa % n\xE3o encontrada', p_company;
  end if;
  perform set_config('rusten.purge_demo', p_company::text, true);
  delete from user_sessions where user_id in (select id from users where company_id = p_company);
  delete from password_resets where user_id in (select id from users where company_id = p_company);
  for t in
    select c.relname from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
     where ns.nspname = current_schema() and c.relkind in ('r', 'p')
       and c.relname not in ('companies', 'customer_account') -- conta do cliente sai pelo gatilho de customers
     order by c.relname
  loop
    n := n + 1;
    parts := parts || format('d%s as (delete from %I where company_id = $1)', n, t.relname);
  end loop;
  if n > 0 then
    execute 'with ' || array_to_string(parts, ', ') || ' select 1' using p_company;
  end if;
  delete from companies where id = p_company;
  perform set_config('rusten.purge_demo', '', true);
  return n;
end $$;
`}]});globalThis.__RUSTEN_ENV_DEFAULTS__={EDGE_RUNTIME:"1",NODE_ENV:"production",DB_SCHEMA:"rusten",DB_POOL_MAX:"3",PATH_PREFIX:"/rusten-api",CORS_ORIGINS:"https://rusten.lorler.com.br,h\
ttps://rusten.vercel.app"};import ac from"npm:express@5.2.1";import Ia from"npm:express@5.2.1";import Zr from"npm:helmet@8.3.0";import Qr from"npm:cors@2.8.6";import ec from"node:path";import{fileURLToPath as tc}from"node:url";import Zt from"npm:pg@8.23.1";import Rn from"node:crypto";import{Buffer as Ca}from"node:buffer";var qi=globalThis.__RUSTEN_ENV_DEFAULTS__||{},R=new Proxy({},{get:(e,a)=>{let t=typeof process<"u"?process.env[a]:void 0;return t!==void 0&&t!==""?t:qi[a]}});Zt.types.setTypeParser(20,e=>Number(e));Zt.types.setTypeParser(1700,e=>Number(e));Zt.types.setTypeParser(1082,e=>e);var Ei=e=>/localhost|127\.0\.0\.1|\/tmp/.test(e||""),An=R.DATABASE_URL||
R.SUPABASE_DB_URL,xt=new Zt.Pool({connectionString:An,ssl:An&&!Ei(An)?{rejectUnauthorized:!1}:void 0,max:Number(R.DB_POOL_MAX||10)}),Tn=R.DB_SCHEMA;if(Tn){if(!/^[a-z_][a-z0-9_]*$/.
test(Tn))throw new Error("DB_SCHEMA inv\xE1lido");xt.on("connect",e=>{e.query(`set search_path to ${Tn}, public`).catch(()=>{})})}var d=(e,a)=>xt.query(e,a);async function k(e){let a=await xt.
connect();try{await a.query("begin");let t=await e(a);return await a.query("commit"),t}catch(t){throw await a.query("rollback").catch(()=>{}),t}finally{a.release()}}var z=class extends Error{constructor(a,t,n,o){
super(t),this.status=a,this.code=n,this.extra=o}},f=(e,a="invalid")=>new z(400,e,a),G=(e="Sem permiss\xE3o para esta a\xE7\xE3o",a="forbidden")=>new z(403,e,a),v=(e="N\xE3o encontrado")=>new z(
404,e,"not_found"),b=(e,a="conflict",t)=>new z(409,e,a,t);function w(e,a){let t=e.safeParse(a??{});if(!t.success){let n=t.error.issues[0];throw f(`${n.path.join(".")||"dados"}: ${n.
message}`)}return t.data}var p=e=>(a,t,n)=>Promise.resolve(e(a,t,n)).catch(n);function Dt(e,a,t=0,n=0){let o=Math.round(Number(a)*1e3),i=Math.round((e+t)*o/1e3);return Math.max(0,i-
n)}function qa(e,a){let t=Math.floor(e/a),n=e-t*a;return Array.from({length:a},(o,i)=>t+(i<n?1:0))}function Ne(e,a="America/Sao_Paulo",t=5){let n=new Intl.DateTimeFormat("en-CA",{timeZone:a,
year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(e),o=s=>n.find(r=>r.type===s).value,i=new Date(Date.UTC(+o("year"),+o("month")-1,+o("day")));
return+o("hour")<t&&(i=new Date(i.getTime()-864e5)),i.toISOString().slice(0,10)}var qe=e=>Rn.createHash("sha256").update(String(e)).digest("hex"),Se=(e=32)=>Rn.randomBytes(e).toString(
"base64url");function Dn(e,a){let t=Ca.from(String(e)),n=Ca.from(String(a));return t.length===n.length&&Rn.timingSafeEqual(t,n)}function vt(e){let a=e==null?"":String(e);return/^[=+\-@\t\r]/.
test(a)&&(a=`'${a}`),/[";\n]/.test(a)?`"${a.replace(/"/g,'""')}"`:a}import Ai from"node:crypto";import{Buffer as Va}from"node:buffer";import Ha from"npm:jsonwebtoken@9.0.3";var _t={"pdv.lancar":"Lan\xE7ar itens","pdv.lancamento_manual":"Lan\xE7amento manual (busca, cat\xE1logo, c\xF3digo digitado)","pdv.alterar_modo":"Trocar modo de leitura no PDV","p\
dv.excecao_dupla_leitura":"Exce\xE7\xE3o manual na dupla leitura obrigat\xF3ria","pdv.autorizar":"Autorizar opera\xE7\xF5es de outros usu\xE1rios (gerente)","pdv.abrir_comanda":"Ab\
rir comanda/mesa/balc\xE3o","pdv.alterar_quantidade":"Alterar quantidade na leitura","pdv.alterar_preco":"Alterar pre\xE7o do item","pdv.desconto":"Conceder desconto","pdv.cancelar\
_item":"Cancelar item","pdv.cancelar_venda":"Cancelar consumo inteiro","pdv.transferir_item":"Transferir itens e consumos","pdv.reabrir_comanda":"Reabrir consumo encerrado","pdv.re\
ceber":"Receber pagamentos","pdv.taxa_servico":"Ajustar/remover taxa de servi\xE7o","caixa.abrir":"Abrir caixa","caixa.fechar":"Fechar caixa","caixa.sangria":"Sangria e despesa de \
caixa","caixa.suprimento":"Suprimento","caixa.reabrir":"Reabrir caixa","financeiro.visualizar":"Ver dados financeiros","financeiro.estornar":"Estornar pagamentos","salao.visualizar":"\
Ver sal\xE3o e mesas","salao.gerenciar":"Cadastrar mesas e mudar situa\xE7\xE3o","cardapio.visualizar":"Ver card\xE1pio","cardapio.gerenciar":"Cadastrar produtos, pre\xE7os e c\xF3digos",
"comandas.gerenciar":"Gerar, bloquear e substituir cart\xF5es de comanda","estoque.ajustar":"Ajustar estoque","relatorios.visualizar":"Ver relat\xF3rios","relatorios.cmv":"Ver CMV \
e margem","usuarios.gerenciar":"Gerenciar usu\xE1rios e perfis","configuracoes.gerenciar":"Alterar configura\xE7\xF5es","assinatura.gerenciar":"Gerenciar assinatura","auditoria.vis\
ualizar":"Ver auditoria","dados.pessoais":"Ver dados pessoais de clientes","clientes.visualizar":"Ver clientes","clientes.gerenciar":"Cadastrar e editar clientes, pontos e consenti\
mentos","cozinha.operar":"Operar a fila de produ\xE7\xE3o (KDS)","delivery.gerenciar":"Gerenciar pedidos de delivery e retirada","delivery.entregar":"Registrar sa\xEDda e entrega de p\
edidos","estoque.visualizar":"Ver estoque e fichas t\xE9cnicas","compras.gerenciar":"Registrar compras e recebimentos","marketing.gerenciar":"Campanhas e avalia\xE7\xF5es","agente.\
gerenciar":"Configurar o agente de atendimento","agente.atender":"Atender conversas da caixa de entrada"},Oa=Object.keys(_t),Ea=(...e)=>Oa.filter(a=>!e.includes(a)),Mn=[{key:"owner",
name:"Propriet\xE1rio",level:100,permissions:Oa},{key:"admin",name:"Administrador",level:90,permissions:Ea("assinatura.gerenciar")},{key:"gerente",name:"Gerente",level:70,permissions:Ea(
"assinatura.gerenciar","usuarios.gerenciar","configuracoes.gerenciar")},{key:"caixa",name:"Caixa",level:40,permissions:["pdv.lancar","pdv.lancamento_manual","pdv.abrir_comanda","pd\
v.receber","caixa.abrir","caixa.fechar","caixa.sangria","caixa.suprimento","salao.visualizar","cardapio.visualizar","clientes.visualizar","clientes.gerenciar"]},{key:"garcom",name:"\
Gar\xE7om",level:30,permissions:["pdv.lancar","pdv.lancamento_manual","pdv.abrir_comanda","salao.visualizar","cardapio.visualizar","clientes.visualizar","clientes.gerenciar"]},{key:"\
cozinha",name:"Cozinha",level:20,permissions:["cardapio.visualizar","cozinha.operar"]},{key:"bar",name:"Bar",level:20,permissions:["cardapio.visualizar","pdv.lancar","cozinha.opera\
r"]},{key:"estoque",name:"Estoque",level:30,permissions:["estoque.ajustar","estoque.visualizar","compras.gerenciar","cardapio.visualizar","relatorios.cmv"]},{key:"financeiro",name:"\
Financeiro",level:50,permissions:["financeiro.visualizar","financeiro.estornar","relatorios.visualizar","relatorios.cmv","caixa.reabrir","auditoria.visualizar","estoque.visualizar",
"clientes.visualizar"]},{key:"entregador",name:"Entregador",level:10,permissions:["delivery.entregar"]},{key:"consulta",name:"Consulta",level:5,permissions:["salao.visualizar","car\
dapio.visualizar","relatorios.visualizar"]}],kt={pdv:"PDV e comandas",salao:"Sal\xE3o, mesas e reservas",cozinha:"Cozinha, bar e KDS",delivery:"Delivery e card\xE1pio digital",cardapio:"\
Card\xE1pio",estoque:"Estoque, compras e fichas t\xE9cnicas",clientes:"Clientes e fidelidade",financeiro:"Caixa e financeiro",relatorios:"Relat\xF3rios",marketing:"Marketing",agente:"\
Agente WhatsApp",fiscal:"Fiscal",infinitepay:"Importa\xE7\xE3o e concilia\xE7\xE3o InfinitePay"},Qt={scanner_enabled:!0,mode:"manual",double_read_mandatory:!1,allow_manual:!0,allow_manual_exception:!0,
exception_requires_manager:!0,allow_mode_change:!0,product_timeout_s:15,open_free_card_on_scan:!1,feedback_sound:!0,qty_per_scan:1,max_qty_per_scan:20,terminator:"Enter",kitchen_send:"\
imediato",require_open_cash:!0,service_fee_bp:1e3,card_prefix:"CMD-"};import Ta from"node:crypto";import{Buffer as Pa}from"node:buffer";var Un="rusten",Ra=1,Da="2026.10",Oi=300,Pi=300*1e3,Aa=0,Ln={at:0,v:null};async function De(){if(Date.now()-Ln.at<6e4)return Ln.v;let e=R.PLATFORM_HUB_URL||"",a=R.PLATFORM_SECRET||
"",t=R.PLATFORM_PRODUCT||"";if(!e||!a)try{let{rows:o}=await d("select key, value from platform_config where key in ('platform_hub_url','platform_secret','platform_product')"),i=Object.
fromEntries(o.map(s=>[s.key,s.value]));e||=i.platform_hub_url||"",a||=i.platform_secret||"",t||=i.platform_product||""}catch{}let n=e&&a?{hub:e.replace(/\/+$/,""),secret:a,product:t||
Un}:null;return Ln={at:Date.now(),v:n},n}var Ma=(e,a,t,n,o)=>Ta.createHmac("sha256",e).update(`${a}
${String(t).toUpperCase()}
${n}
${qe(o||"")}`).digest("hex");async function Ee(e,a,t,n=1e4){let o=await De();if(!o)throw new z(503,"A assinatura ainda n\xE3o est\xE1 configurada nesta instala\xE7\xE3o. Fale com o suporte.",
"platform_not_configured");if(!/^https:\/\//.test(o.hub)&&R.NODE_ENV==="production")throw new z(503,"Endere\xE7o da central deve usar HTTPS","platform_not_configured");let i=t===void 0?
"":JSON.stringify(t),s=Math.floor(Date.now()/1e3),r;try{r=await fetch(`${o.hub}/api/hub/v1${a}`,{method:e,signal:AbortSignal.timeout(n),headers:{"Content-Type":"application/json","\
X-Platform-Product":o.product,"X-Platform-Timestamp":String(s),"X-Platform-Signature":Ma(o.secret,s,e,a,i)},body:i||void 0})}catch{throw new z(503,"A central de assinaturas n\xE3o res\
pondeu. Tente novamente em instantes.","platform_unavailable")}let c=await r.json().catch(()=>({}));if(!r.ok)throw new z(r.status===401?502:r.status,c?.error||`Central: erro ${r.status}`,
c?.code||"hub_error");return c}async function en(e){let{rows:a}=await d(`select c.id, c.name, c.email, c.phone, c.document, c.created_at, c.is_demo,
            (select u.name from users u where u.company_id = c.id and u.role_key = 'owner' order by u.id limit 1) as owner_name,
            (select u.email from users u where u.company_id = c.id and u.role_key = 'owner' order by u.id limit 1) as owner_email,
            greatest(c.last_access_at, (select max(s.created_at) from user_sessions s join users u on u.id = s.user_id where u.company_id = c.id)) as last_access_at,
            (select count(*)::int from users where company_id = c.id and active) as users,
            (select count(*)::int from units where company_id = c.id and active) as units,
            (select count(*)::int from terminals where company_id = c.id and active) as terminals,
            (select count(*)::int from dining_tables where company_id = c.id and active) as tables,
            (select count(*)::int from consumption_sessions where company_id = c.id and opened_at > now() - interval '30 days') as consumptions_30d,
            (select coalesce(sum(amount_cents),0)::bigint from payments where company_id = c.id and status = 'confirmado'
               and created_at > now() - interval '30 days') as revenue_30d_cents
       from companies c where c.id = $1`,[e]),t=a[0];return t?{remote_id:String(t.id),name:t.name,email:t.owner_email||t.email,phone:t.phone,document:t.document,owner_name:t.owner_name,
owner_email:t.owner_email,created_at:t.created_at,last_access_at:t.last_access_at,is_demo:t.is_demo,metrics:{users:t.users,units:t.units,terminals:t.terminals,tables:t.tables,consumptions_30d:t.
consumptions_30d,revenue_30d:Number(t.revenue_30d_cents)/100}}:null}async function Mt(e,a){await d("update companies set access = $2, access_updated_at = now() where id = $1",[e,a||
{}])}async function tn(e,a=1e4){if(!await De())return null;let t=await en(e);if(!t||t.is_demo)return null;let{is_demo:n,owner_email:o,...i}=t,s=await Ee("POST","/tenants",i,a);return s?.
access&&await Mt(e,s.access),s?.access||null}async function It(e,{fresh:a=!1}={}){if(!e||e.is_demo||!await De())return null;let n=e.access_updated_at?Date.now()-new Date(e.access_updated_at).
getTime():1/0,o=e.access&&Object.keys(e.access).length;if(!a&&o&&n<Pi)return e.access;if(!a&&Date.now()<Aa)return o?e.access:null;try{let i=await Ee("GET",`/tenants/${encodeURIComponent(
e.id)}/access`,void 0,4e3);return await Mt(e.id,i.access),i.access}catch(i){if(i.status===404)try{return await tn(e.id,4e3)}catch{}else Aa=Date.now()+6e4;return o?e.access:null}}async function Lt(e,a,t,n={}){
await De()&&await e.query("insert into platform_outbox (company_id, kind, payload) values ($1,$2,$3)",[a,t,n])}async function jt(e=20){if(!await De())return{sent:0,failed:0};let{rows:a}=await d(
"select * from platform_outbox where sent_at is null and attempts < 20 order by id limit $1",[e]),t=0,n=0;for(let o of a)try{(o.kind==="tenant.created"||o.kind==="tenant.updated")&&
await tn(o.company_id),await d("update platform_outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = $1",[o.id]),t++}catch(i){await d("update platform_\
outbox set attempts = attempts + 1, last_error = $2 where id = $1",[o.id,String(i.message).slice(0,300)]),n++}return{sent:t,failed:n}}async function La(e,a,t){try{let n=await De(),
o=()=>new z(401,"Chamada da central n\xE3o autenticada.","bad_signature");if(!n)throw new z(503,"Liga\xE7\xE3o com a central n\xE3o configurada.","platform_not_configured");let i=Number(
e.headers["x-platform-timestamp"]),s=String(e.headers["x-platform-signature"]||"");if(String(e.headers["x-platform-product"]||"")!==n.product||!Number.isFinite(i)||!/^[0-9a-f]{64}$/.
test(s)||Math.abs(Date.now()/1e3-i)>Oi)throw o();let r=Ma(n.secret,i,e.method,e.url,e.rawBody||"");if(!Ta.timingSafeEqual(Pa.from(r),Pa.from(s)))throw o();if(!(await d("insert into\
 platform_nonces (nonce) values ($1) on conflict do nothing returning nonce",[s])).rows[0])throw new z(401,"Chamada repetida.","replay");await d("delete from platform_nonces where \
created_at < now() - interval '1 day'"),t()}catch(n){t(n)}}var Ua=kt;var Ga=R.NODE_ENV==="production",nn=R.JWT_SECRET||R.SUPABASE_SERVICE_ROLE_KEY||(Ga?null:"dev-only-rusten-secret-not-for-production");if(!nn)throw new Error("JWT_SECRET \xE9 obrigat\xF3ri\
o em produ\xE7\xE3o");function Fa(e){return e?["changeme","secret","jwt_secret","dev-only-rusten-secret-not-for-production"].includes(e)?"valor de exemplo":Va.byteLength(e,"utf8")<
32?"curta (m\xEDnimo de 32 bytes aleat\xF3rios)":new Set(e).size<10?"pouca varia\xE7\xE3o de caracteres":null:"ausente"}if(Ga&&Fa(nn))throw new Error(`JWT_SECRET inseguro (${Fa(nn)}\
) \u2014 o servidor n\xE3o inicia em produ\xE7\xE3o.`);var Ut=e=>Va.from(Ai.hkdfSync("sha256",nn,"rusten",e,32)),Ja=Ut("access-token"),Ti=Number(R.ACCESS_TTL_S)||900,an=30;function Vn(e,a){
return Ha.sign({sub:String(e.id),cid:String(e.company_id),sid:a},Ja,{expiresIn:Ti,algorithm:"HS256"})}async function Wa(e,a){let{rows:t}=await d(`select u.id, u.company_id, u.unit_\
id, u.name, u.email, u.role_key, u.active, u.password_changed_at,
            r.name as role_name, r.level, r.permissions,
            c.name as company_name, c.segment, c.timezone, c.settings, c.access, c.access_updated_at, c.is_demo
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
       join companies c on c.id = u.company_id
      where u.id = $1 and u.company_id = $2`,[e,a]);return t[0]}function Xe(){return async(e,a,t)=>{try{let n=e.headers.authorization||"",o=n.startsWith("Bearer ")?n.slice(7):null;
if(!o)throw new z(401,"Sess\xE3o expirada. Entre novamente.","unauthenticated");let i;try{i=Ha.verify(o,Ja,{algorithms:["HS256"]})}catch{throw new z(401,"Sess\xE3o expirada. Entre nov\
amente.","unauthenticated")}let s=await Wa(Number(i.sub),Number(i.cid));if(!s||!s.active)throw new z(401,"Usu\xE1rio inativo","unauthenticated");let r=await d("select revoked_at fr\
om user_sessions where id = $1 and user_id = $2",[i.sid,s.id]);if(!r.rows[0]||r.rows[0].revoked_at)throw new z(401,"Sess\xE3o encerrada","unauthenticated");if(i.iat*1e3<new Date(s.
password_changed_at).getTime()-1e3)throw new z(401,"Senha alterada. Entre novamente.","unauthenticated");let c=await It({id:s.company_id,is_demo:s.is_demo,access:s.access,access_updated_at:s.
access_updated_at}),m={userId:s.id,companyId:s.company_id,unitId:s.unit_id,name:s.name,email:s.email,role:s.role_key,roleName:s.role_name,level:s.level,perms:new Set(s.permissions),
company:{id:s.company_id,name:s.company_name,segment:s.segment,timezone:s.timezone,settings:s.settings,is_demo:s.is_demo},access:s.is_demo?Bn(null,null,{demo:!0}):Bn(c??s.access,s.
access_updated_at),sessionId:i.sid,terminalId:null},u=Number(e.headers["x-terminal-id"]);if(u){let l=await d("select id, unit_id from terminals where id = $1 and company_id = $2 an\
d active",[u,m.companyId]);l.rows[0]&&(m.terminalId=l.rows[0].id,m.terminalUnitId=l.rows[0].unit_id)}m.can=l=>m.perms.has(l),e.ctx=m,t()}catch(n){t(n)}}}var y=(...e)=>(a,t,n)=>{let o=e.
find(i=>!a.ctx.can(i));if(o)return n(G(`Sem permiss\xE3o: ${o}`));n()};function Q(e,a){if(!e.can(a))throw G(`Sem permiss\xE3o: ${a}`)}async function g(e,a,t,{entity:n,entityId:o,reason:i,
data:s,unitId:r}={}){await e.query(`insert into audit_events (company_id, unit_id, terminal_id, user_id, action, entity, entity_id, reason, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[a.companyId,r??a.terminalUnitId??a.unitId??null,a.terminalId??null,a.userId??null,t,n??null,o!=null?String(o):null,i??null,Fn(s??{})])}var Ri=/pass|senha|token|secret|segredo|hash|card_number|cvv/i;
function Fn(e){return Array.isArray(e)?e.map(Fn):e&&typeof e=="object"?Object.fromEntries(Object.entries(e).map(([a,t])=>[a,Ri.test(a)?"[omitido]":Fn(t)])):e}var Di={ACTIVE:"Ativa",
TRIAL:"Em teste",PAYMENT_PENDING:"Aguardando pagamento",PAST_DUE:"Pagamento pendente",SUSPENDED:"Suspensa",CANCELED:"Cancelada",EXPIRED:"Expirada"},Ba={ADMINISTRATIVO:"O acesso des\
ta empresa foi bloqueado pela administra\xE7\xE3o da plataforma. Fale com o suporte.",TRIAL_EXPIRADO:"O per\xEDodo de teste terminou. Contrate um plano para continuar operando \u2014 seus \
dados est\xE3o preservados.",CANCELAMENTO:"A assinatura foi encerrada. Contrate novamente para voltar a operar \u2014 seus dados est\xE3o preservados.",FINANCEIRO:"Acesso suspenso \
por pend\xEAncia financeira. Regularize a assinatura \u2014 seus dados est\xE3o preservados."};function Bn(e,a,{demo:t=!1}={}){let n=e||{},o=Object.keys(kt);if(t)return{allowed:!0,
state:"DEMO",label:"Demonstra\xE7\xE3o",modules:o,warning:null,notices:[],managed:!1,demo:!0};if(!Object.keys(n).length||typeof n.blocked!="boolean")return{allowed:!0,state:"sem_ce\
ntral",label:"Sem central",modules:o,warning:null,notices:[],managed:!1};let i=n.features&&typeof n.features=="object"?n.features:{},r=o.filter(u=>u in i).length?o.filter(u=>i[u]!==
!1):o,c=Array.isArray(n.notices)?n.notices.filter(u=>u&&u.text).map(u=>({level:u.level==="danger"?"danger":"warn",text:String(u.text)})):[],m=!!n.admin_blocked||n.reason==="ADMINIS\
TRATIVO";return{allowed:!n.blocked,state:n.status,label:Di[n.status]||n.status,reasonCode:n.reason||null,reason:n.blocked?Ba[m?"ADMINISTRATIVO":n.reason]||Ba.FINANCEIRO:null,adminBlocked:m,
modules:r,notices:c,warning:c[0]?.text||null,plan:n.plan?.name||null,planId:n.plan?.id||null,cycle:n.cycle||null,validUntil:n.valid_until||null,trial:n.trial||null,support:n.support||
null,supportChannel:n.support_channel||null,managed:!0,updatedAt:a}}var ge=e=>(a,t,n)=>{let o=a.ctx.access;if(!o.allowed)return n(new z(402,o.reason,"access_blocked",{state:o.state}));
if(e&&!o.modules.includes(e))return n(G("M\xF3dulo n\xE3o inclu\xEDdo no plano","module_disabled"));n()};async function ae(e,a,t){let{rows:n}=await d(`insert into rate_limits(key, \
count, reset_at) values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update set
       count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => $2) else rate_limits.reset_at end
     returning count`,[e,t]);if(n[0].count>a)throw new z(429,"Muitas tentativas. Aguarde alguns minutos.","rate_limited")}import Ya from"node:fs";import on from"node:path";import{fileURLToPath as Qa}from"node:url";var Za=import.meta.url.startsWith("file:")?on.join(on.dirname(Qa(import.meta.url)),"migrations"):"migrations";async function Ft({log:e=console.log}={}){let a=await xt.connect();try{
await a.query("select pg_advisory_lock(424242)"),await a.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);let t=new Set((await a.query("select name from schema_migrations")).rows.map(o=>o.name)),n=R.EDGE_RUNTIME?
(await Promise.resolve().then(()=>(Xa(),Ka))).MIGRATIONS:Ya.readdirSync(Za).filter(o=>/^\d+_.+\.sql$/.test(o)).sort().map(o=>({name:o,sql:null}));for(let{name:o,sql:i}of n){if(t.has(
o))continue;let s=i??Ya.readFileSync(on.join(Za,o),"utf8");await a.query("begin");try{await a.query(s),await a.query("insert into schema_migrations(name) values ($1)",[o]),await a.
query("commit"),e(`migra\xE7\xE3o aplicada: ${o}`)}catch(r){throw await a.query("rollback"),new Error(`falha na migra\xE7\xE3o ${o}: ${r.message}`)}}}finally{await a.query("select \
pg_advisory_unlock(424242)").catch(()=>{}),a.release()}}!R.EDGE_RUNTIME&&process.argv[1]&&Qa(import.meta.url)===on.resolve(process.argv[1])&&Ft().then(()=>xt.end()).catch(e=>{console.
error(e.message),process.exit(1)});import{Router as as}from"npm:express@5.2.1";import{Buffer as Li}from"node:buffer";import{Router as Ui}from"npm:express@5.2.1";import{z as X}from"npm:zod@4.6.5";var st=Ui(),to={logo:400*1024,fundo:1600*1024,tv_fundo:1600*1024},Hn=e=>{if(!Object.prototype.hasOwnProperty.call(to,e))throw v("Imagem n\xE3o encontrada");return e};function Fi(e,a){
let t=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(e||""));if(!t)throw f("Envie uma imagem JPG, PNG ou WebP");let n=Li.from(t[2],"base64");if(n.length>a)
throw f(`Imagem grande demais (m\xE1x. ${Math.round(a/1024)} KB). Use uma imagem menor.`);let o=n.subarray(0,4).toString("hex");if(!{"image/png":o.startsWith("89504e47"),"image/jpe\
g":o.startsWith("ffd8"),"image/webp":n.subarray(8,12).toString()==="WEBP"}[t[1]])throw f("O conte\xFAdo do arquivo n\xE3o \xE9 uma imagem v\xE1lida");return n.length}async function Bt(e,a){
let t=await e.query("select kind, floor(extract(epoch from updated_at))::bigint v from company_assets where company_id = $1",[a]);return Object.fromEntries(t.rows.map(n=>[`${n.kind}\
_v`,Number(n.v)]))}st.get("/",p(async(e,a)=>{a.json(await Bt({query:d},e.ctx.companyId))}));var eo=X.string().regex(/^#[0-9a-fA-F]{6}$/),Bi=X.object({title:X.string().max(30),bg:X.
string().max(20),image:X.string().max(500).refine(e=>!e||/^https:\/\//.test(e),"Use um endere\xE7o https"),font:X.string().max(20),sound:X.string().max(20),volume:X.number().min(0).
max(1),voice:X.boolean(),seconds:X.number().int().min(3).max(60),fireworks:X.boolean(),fireworksSound:X.boolean(),showName:X.boolean(),showItems:X.boolean(),showQueue:X.boolean(),showLogo:X.
boolean(),showClock:X.boolean(),logoSize:X.number().min(4).max(20),scale:X.number().min(.7).max(1.6),overlay:X.number().min(0).max(.9),ink:eo.or(X.literal("")),accent:eo.or(X.literal(
"")),readyLabel:X.string().max(40),queueLabel:X.string().max(40),emptyLabel:X.string().max(60),ticker:X.string().max(200),voiceText:X.string().max(120),voiceRate:X.number().min(.6).
max(1.4),cardStyle:X.string().max(20)}).partial().strict();st.get("/tv",p(async(e,a)=>{let t=await d("select settings->'tv' as tv from companies where id = $1",[e.ctx.companyId]);a.
json(t.rows[0]?.tv||null)}));st.put("/tv",y("configuracoes.gerenciar"),p(async(e,a)=>{let t=w(Bi,e.body);await d("update companies set settings = jsonb_set(settings, '{tv}', $2::js\
onb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await g({query:d},e.ctx,"configuracoes.tv",{entity:"company",entityId:e.ctx.companyId,data:{keys:Object.keys(t)}}),a.json({
ok:!0})}));st.get("/:kind",p(async(e,a)=>{let t=await d("select data_url from company_assets where company_id = $1 and kind = $2",[e.ctx.companyId,Hn(e.params.kind)]);a.setHeader("\
cache-control","private, max-age=0"),a.json({data_url:t.rows[0]?.data_url||null})}));st.put("/:kind",y("configuracoes.gerenciar"),p(async(e,a)=>{let t=Hn(e.params.kind),n=Fi(e.body?.
data_url,to[t]);await d(`insert into company_assets (company_id, kind, data_url, bytes) values ($1,$2,$3,$4)
           on conflict (company_id, kind) do update set data_url = excluded.data_url, bytes = excluded.bytes, updated_at = now()`,[e.ctx.companyId,t,e.body.data_url,n]),await g({query:d},
e.ctx,"marca.imagem",{entity:"company",entityId:e.ctx.companyId,data:{kind:t,bytes:n}}),a.json(await Bt({query:d},e.ctx.companyId))}));st.delete("/:kind",y("configuracoes.gerenciar"),
p(async(e,a)=>{let t=Hn(e.params.kind);await d("delete from company_assets where company_id = $1 and kind = $2",[e.ctx.companyId,t]),await g({query:d},e.ctx,"marca.imagem_removida",
{entity:"company",entityId:e.ctx.companyId,data:{kind:t}}),a.json(await Bt({query:d},e.ctx.companyId))}));import dt from"npm:bcryptjs@3.0.3";import os from"node:crypto";import{z as A}from"npm:zod@4.6.5";var Vi=["scanner_enabled","allow_manual","allow_manual_exception","allow_mode_change","open_free_card_on_scan"],Hi=["double_read_mandatory","exception_requires_manager","require_op\
en_cash"],Gi=["max_qty_per_scan"];function Gn(e={},a={},t={}){let n=[Qt,e||{},a||{},t||{}],o={...Qt};for(let i of n.slice(1))for(let[s,r]of Object.entries(i))!(s in Qt)||r===void 0||
r===null||(Vi.includes(s)?o[s]=o[s]&&!!r:Hi.includes(s)?o[s]=o[s]||!!r:Gi.includes(s)?o[s]=Math.min(o[s],Number(r)):o[s]=r);return o.double_read_mandatory&&(o.mode="dupla"),o.scanner_enabled||
(o.mode="manual"),!o.scanner_enabled&&!o.allow_manual&&(o.allow_manual=!0),o.qty_per_scan=Math.min(Math.max(1,Number(o.qty_per_scan)||1),o.max_qty_per_scan),o}function Nt(e){if(e.scanner_enabled===
!1&&e.allow_manual===!1)throw f("Configura\xE7\xE3o eliminaria todos os meios de lan\xE7amento: mantenha o leitor ou o lan\xE7amento manual.");if(e.mode&&!["manual","continua","dup\
la"].includes(e.mode))throw f("Modo inv\xE1lido");if(e.double_read_mandatory&&e.scanner_enabled===!1)throw f("Dupla leitura obrigat\xF3ria exige o leitor habilitado.");if(e.product_timeout_s!=
null&&(e.product_timeout_s<3||e.product_timeout_s>120))throw f("Tempo de espera do produto deve ficar entre 3 e 120 segundos")}async function Ye(e,a,t){let n=await e.query("select \
settings from companies where id = $1",[a.companyId]),o=t?await e.query("select settings from units where id = $1 and company_id = $2",[t,a.companyId]):{rows:[]},i=a.terminalId?await e.
query("select settings from terminals where id = $1",[a.terminalId]):{rows:[]};return Gn(n.rows[0]?.settings?.pdv,o.rows[0]?.settings?.pdv,i.rows[0]?.settings?.pdv)}var yt=e=>String(
e??"").replace(/[\r\n\t]/g,"").trim();async function Vt(e,a,t){let n=yt(t);if(!n)return{type:"DESCONHECIDO",code:n};if(n.length>128)return{type:"DESCONHECIDO",code:n.slice(0,128)};
let{rows:o}=await e.query("select entity, entity_id from scan_codes where company_id = $1 and code = $2",[a,n]);if(!o[0])return{type:"DESCONHECIDO",code:n};let{entity:i,entity_id:s}=o[0];
if(i==="PRODUTO"){let r=await e.query(`select p.id, p.name, p.price_cents, p.kind, p.unit, p.active,
              exists(select 1 from modifier_groups g where g.product_id = p.id) as has_options,
              exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as has_required
         from products p where p.id = $1 and p.company_id = $2`,[s,a]);return r.rows[0]?{type:"PRODUTO",code:n,product:r.rows[0]}:{type:"DESCONHECIDO",code:n}}if(i==="COMANDA"){let r=await e.
query(`select c.id, c.number, c.unit_id, c.status, c.block_reason,
              (select s.id from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_id,
              (select s.status from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_status
         from tab_cards c where c.id = $1 and c.company_id = $2`,[s,a]);return r.rows[0]?{type:"COMANDA",code:n,card:r.rows[0]}:{type:"DESCONHECIDO",code:n}}if(i==="MESA"){let r=await e.
query("select id, number, unit_id, status, area from dining_tables where id = $1 and company_id = $2",[s,a]);return r.rows[0]?{type:"MESA",code:n,table:r.rows[0]}:{type:"DESCONHECI\
DO",code:n}}return{type:i,code:n,id:s}}async function rt(e,a,t,n,o){let i=yt(t);if(!i)throw f("C\xF3digo vazio");if(i.length>128)throw f("C\xF3digo muito longo");let s=await e.query(
"select entity, entity_id from scan_codes where company_id = $1 and code = $2",[a,i]);if(s.rows[0]){if(s.rows[0].entity===n&&Number(s.rows[0].entity_id)===Number(o))return;throw b(
`C\xF3digo ${i} j\xE1 est\xE1 em uso (${s.rows[0].entity.toLowerCase()} ${s.rows[0].entity_id}). Cadastros amb\xEDguos n\xE3o s\xE3o permitidos.`,"code_in_use")}await e.query("inse\
rt into scan_codes (company_id, code, entity, entity_id) values ($1,$2,$3,$4)",[a,i,n,o])}var no=(e,a,t)=>`${e}${a>1?`${a}-`:""}${String(t).padStart(6,"0")}`;async function se(e,a,t){
let{rows:n}=await e.query("select * from consumption_sessions where id = $1 and company_id = $2 for update",[t,a]);if(!n[0])throw v("Consumo n\xE3o encontrado");return n[0]}function ct(e){
if(e.status!=="aberta")throw b(`Consumo ${{em_fechamento:"em fechamento",encerrada:"encerrada",cancelada:"cancelada"}[e.status]||e.status}: n\xE3o aceita lan\xE7amentos`,"session_n\
ot_open")}function Oe(e,a){if(e.unitId&&Number(e.unitId)!==Number(a)&&e.level<90)throw G("Registro de outra unidade")}async function K(e,a){let t=await e.query("select service_fee_\
bp, delivery_fee_cents from consumption_sessions where id = $1",[a]),n=await e.query("select coalesce(sum(total_cents) filter (where status = 'ativo'), 0)::bigint as items from ord\
er_items where session_id = $1",[a]),o=await e.query("select coalesce(sum(amount_cents) filter (where status = 'confirmado'), 0)::bigint as paid from payments where session_id = $1",
[a]),i=Number(n.rows[0].items),s=Math.round(i*(t.rows[0]?.service_fee_bp||0)/1e4),r=Number(t.rows[0]?.delivery_fee_cents||0),c=i+s+r,m=Number(o.rows[0].paid);return{items:i,serviceFee:s,
serviceFeeBp:t.rows[0]?.service_fee_bp||0,deliveryFee:r,total:c,paid:m,balance:c-m}}async function Jn(e,a,t={}){let o=(await e.query("insert into units (company_id, name, day_cutoff) values ($1,$2,$3) returning id",[a,t.unit_name||"Matriz",t.day_cutoff??5])).rows[0].
id;await e.query("insert into terminals (company_id, unit_id, name) values ($1,$2,$3)",[a,o,"Caixa 1"]);let i={};for(let s of["Cozinha","Bar","Copa"]){let r=await e.query("insert i\
nto production_sectors (company_id, name) values ($1,$2) returning id",[a,s]);i[s]=r.rows[0].id}return await Wn(e,a,o,1,t.tables??10),await Kn(e,a,o,1,t.cards??50),t.demo&&await Wi(
e,a,i),{unitId:o,sectors:i}}async function Wn(e,a,t,n,o){let i=[];for(let s=n;s<n+o;s++){let r=await e.query(`insert into dining_tables (company_id, unit_id, number, pos_x, pos_y) \
values ($1,$2,$3,$4,$5)
       on conflict do nothing returning id`,[a,t,s,(s-1)%6,Math.floor((s-1)/6)]);r.rows[0]&&(await rt(e,a,`MESA-${String(t).padStart(2,"0")}-${String(s).padStart(3,"0")}`,"MESA",r.
rows[0].id),i.push(r.rows[0].id))}return i}async function Kn(e,a,t,n,o,i="CMD-"){let s=(await e.query("select count(*)::int as n from units where company_id = $1 and id <= $2",[a,t])).
rows[0].n,r=[];for(let c=n;c<n+o;c++){let m=await e.query("insert into tab_cards (company_id, unit_id, number) values ($1,$2,$3) on conflict do nothing returning id, number",[a,t,c]);
if(m.rows[0]){let u=no(i,s,c);await rt(e,a,u,"COMANDA",m.rows[0].id),r.push({...m.rows[0],code:u})}}return r}var Ji=[["Cervejas","Bar",[["Cerveja IPA 600 ml",2890,"7890000000011"],
["Pilsen long neck",1290,"7890000000028"],["Chope 300 ml",1190,null]]],["Drinks","Bar",[["Caipirinha",2400,null],["Gin t\xF4nica",3200,null]]],["Lanches","Cozinha",[["Hamb\xFArguer da\
 casa",3890,null],["Por\xE7\xE3o de fritas",2690,null]]],["Sem \xE1lcool","Bar",[["Refrigerante lata",700,"7890000000035"],["\xC1gua mineral",500,"7890000000042"]]]];async function Wi(e,a,t){
let n=0;for(let[o,i,s]of Ji){let r=await e.query("insert into categories (company_id, name, sort, demo) values ($1,$2,$3,true) returning id",[a,`${o} (demonstra\xE7\xE3o)`,n++]);for(let[
c,m,u]of s){let l=await e.query(`insert into products (company_id, category_id, sector_id, name, price_cents, kind, demo, favorite, channels)
         values ($1,$2,$3,$4,$5,$6,true,$7,'{pdv,delivery,cardapio_digital}') returning id`,[a,r.rows[0].id,t[i],c,m,i==="Cozinha"?"recipe":"resale",n===1]);if(u&&await rt(e,a,u,"P\
RODUTO",l.rows[0].id),c.startsWith("Hamb\xFArguer")){let _=await e.query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Ponto da\
 carne',1,1) returning id",[a,l.rows[0].id]);for(let $ of["Mal passado","Ao ponto","Bem passado"])await e.query("insert into modifier_options (company_id, group_id, name) values ($\
1,$2,$3)",[a,_.rows[0].id,$]);let h=await e.query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Adicionais',0,3) returning id",
[a,l.rows[0].id]);for(let[$,N]of[["Bacon",600],["Queijo extra",400],["Ovo",300]])await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2\
,$3,$4)",[a,h.rows[0].id,$,N])}}}}async function ao(e,a,t,n,o){let i=Object.fromEntries((await e.query("select id, name, price_cents, sector_id from products where company_id = $1",
[a])).rows.map($=>[$.name,$])),s=(await e.query("select id from dining_tables where company_id = $1 and number = 3",[a])).rows[0],r=(await e.query("select id from tab_cards where c\
ompany_id = $1 order by number limit 3",[a])).rows,c=0,m=4,u=()=>(m=m===4?9:m===9?18:4,m);async function l($,{tableId:N=null,cardId:P=null,label:T=null},q,E="aberta"){let W=(await e.
query(`insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, label, status, service_fee_bp, opened_by, business_date,
                                         opened_at, closed_at, closed_by)
       values ($1,$2,$3,$4,$5,$6,$7,1000,$8,$9, now() - interval '90 minutes', case when $7 = 'encerrada' then now() - interval '20 minutes' end,
               case when $7 = 'encerrada' then $8::bigint end) returning id`,[a,t,$,P,N,T,E,n,o])).rows[0].id,Y=0;for(let[U,H,de]of q){let I=i[U];if(!I)continue;let B=I.price_cents*
H;Y+=B,await e.query(`insert into order_items (company_id, session_id, product_id, description, qty, unit_price_cents, total_cents, sector_id,
                                  kitchen_status, launch_mode, user_id, idempotency_key, created_at, sent_at, accepted_at, ready_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11, now() - interval '${u()} minutes',
                 case when $9 <> 'nao_produz' then now() - interval '${u()} minutes' end,
                 case when $9 in ('aceito','preparando','pronto','entregue') then now() - interval '8 minutes' end,
                 case when $9 in ('pronto','entregue') then now() - interval '3 minutes' end)`,[a,W,I.id,I.name,H,I.price_cents,B,I.sector_id,de,n,`demo-${W}-${++c}`])}return{id:W,
total:Y}}s&&(await l("mesa",{tableId:s.id,label:"Mesa 3"},[["Hamb\xFArguer da casa",2,"preparando"],["Por\xE7\xE3o de fritas",1,"pronto"],["Chope 300 ml",4,"entregue"]]),await e.query(
"update dining_tables set status = 'ocupada' where id = $1",[s.id])),r[0]&&await l("comanda",{cardId:r[0].id},[["Cerveja IPA 600 ml",2,"nao_produz"],["Caipirinha",1,"novo"]]),r[1]&&
await l("comanda",{cardId:r[1].id},[["Gin t\xF4nica",2,"entregue"],["\xC1gua mineral",1,"nao_produz"]]);let _=await l("balcao",{label:"Balc\xE3o"},[["Pilsen long neck",3,"nao_produ\
z"],["Por\xE7\xE3o de fritas",1,"entregue"]],"encerrada"),h=_.total+Math.round(_.total*.1);await e.query(`insert into payments (company_id, session_id, method, amount_cents, busine\
ss_date, idempotency_key, user_id, created_at)
     values ($1,$2,'pix',$3,$4,$5,$6, now() - interval '20 minutes')`,[a,_.id,h,o,`demo-pay-${_.id}`,n]),await Ki(e,a,t,n,_.id)}async function Ki(e,a,t,n,o){let i={loyalty:{enabled:!0,
cents_per_point:100,point_value_cents:5,validity_days:365,min_redeem:100},delivery:{enabled:!0,accepting:!0,delivery:!0,pickup:!0,fee_cents:700,min_order_cents:3e3,eta_minutes:40,hours:"\
Ter a dom, 18h \xE0s 0h",areas:"Centro, Vila Nova e Jardim",payment_methods:["dinheiro","pix","cartao"],message:"Chope em dobro at\xE9 as 20h!"},agent:{enabled:!1,name:"R\xFAstica",
greeting:"Ol\xE1! Sou a R\xFAstica, atendente virtual do bar. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* ou fazer uma *reserva*. Para falar com a\
 equipe, digite *atendente*.",handoff_message:"Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA.",closed_message:"No momento n\xE3o estamos recebendo pedidos.",reservation_max_people:12,
reservation_min_hours:2}};await e.query("update companies set slug = $2, settings = settings || $3::jsonb where id = $1",[a,`demo-${a}`,JSON.stringify(i)]);let s=String(new Date().
getMonth()+1).padStart(2,"0"),r={};for(let[l,_,h,$,N,P,T]of[["Ana Souza","52998224725","11988887777","1990-03-12",["vip","chope"],!0,120],["Bruno Lima","39053344705","11977776666",
`1987-${s}-21`,["anivers\xE1rio"],!0,0],["Carla Dias",null,"11966665555","1995-08-02",[],!1,0]]){let q=await e.query(`insert into customers (company_id, cpf, name, phone, birthday,\
 tags, consent_whatsapp, consent_at, created_by)
      values ($1,$2,$3,$4,$5,$6,$7, case when $7 then now() end, $8) returning id`,[a,_,l,h,$,N,P,n]);r[l]=q.rows[0].id,T&&(await e.query("insert into loyalty_ledger (company_id, c\
ustomer_id, kind, points, expires_at, reason, user_id) values ($1,$2,'ganho',$3, current_date + 365, 'Consumos anteriores', $4)",[a,q.rows[0].id,T,n]),await e.query("update custome\
rs set points = $2 where id = $1",[q.rows[0].id,T]))}await e.query("update consumption_sessions set customer_id = $2, customer_name = $3 where id = $1",[o,r["Bruno Lima"],"Bruno Li\
ma"]);let c=(await e.query("select id from consumption_sessions where company_id = $1 and kind = 'mesa' limit 1",[a])).rows[0];c&&await e.query("update consumption_sessions set cus\
tomer_id = $2, customer_name = $3 where id = $1",[c.id,r["Ana Souza"],"Ana Souza"]),await e.query("insert into reviews (company_id, session_id, customer_id, score, comment) values \
($1,$2,$3,5,$4)",[a,o,r["Bruno Lima"],"Chope gelado e atendimento r\xE1pido!"]);let m={};for(let[l,_,h,$,N]of[["Carne mo\xEDda","kg",8,3200,2],["P\xE3o brioche","un",40,150,12],["B\
atata congelada","kg",12,900,4],["Pilsen long neck (garrafa)","un",48,450,24],["Chope (barril)","L",30,1200,10],["Lim\xE3o","kg",1.5,600,3],["Cacha\xE7a","L",4,2500,1]]){let P=await e.
query("insert into stock_items (company_id, name, unit, min_qty, reorder_qty, avg_cost_cents) values ($1,$2,$3,$4,$5,$6) returning id",[a,l,_,N,N*3,$]);m[l]=P.rows[0].id,await e.query(
"insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, reason, user_id) values ($1,$2,'entrada',$3,$4,'saldo_inicial','Saldo inicial',$5)",[
a,P.rows[0].id,h,$,n])}let u=Object.fromEntries((await e.query("select id, name from products where company_id = $1",[a])).rows.map(l=>[l.name,l.id]));for(let[l,_,h]of[["Hamb\xFArguer\
 da casa",[["Carne mo\xEDda",.18],["P\xE3o brioche",1]],726],["Por\xE7\xE3o de fritas",[["Batata congelada",.4]],360],["Chope 300 ml",[["Chope (barril)",.3]],360],["Caipirinha",[["\
Lim\xE3o",.12],["Cacha\xE7a",.06]],222]]){if(!u[l])continue;let $=await e.query("insert into recipes (company_id, product_id, version, yield_qty, created_by) values ($1,$2,1,1,$3) \
returning id",[a,u[l],n]);for(let[N,P]of _)await e.query("insert into recipe_lines (company_id, recipe_id, stock_item_id, qty) values ($1,$2,$3,$4)",[a,$.rows[0].id,m[N],P]);await e.
query("update products set stock_mode = 'ficha', cost_cents = $2 where id = $1",[u[l],h])}u["Pilsen long neck"]&&await e.query("update products set stock_mode = 'acabado', stock_it\
em_id = $2, cost_cents = 450 where id = $1",[u["Pilsen long neck"],m["Pilsen long neck (garrafa)"]]);for(let[l,_,h,$,N,P]of[["Diego Martins","11955554444",6,21,"confirmada","equipe"],
["Fernanda Alves","11944443333",4,22,"pendente","agente"]])await e.query(`insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source)
      values ($1,$2,$3,$4,$5, date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' + make_interval(hours => $6), $7, $8)`,[a,t,l,_,h,$,N,P])}var oo=[{value:"manual",label:"Manual (toque/busca)"},{value:"continua",label:"Leitura cont\xEDnua"},{value:"dupla",label:"Dupla leitura (comanda \u2192 produto)"}],Xi=["America/Sa\
o_Paulo","America/Manaus","America/Cuiaba","America/Belem","America/Fortaleza","America/Recife","America/Bahia","America/Porto_Velho","America/Rio_Branco","America/Noronha"].map(e=>({
value:e,label:e.replace("America/","").replace("_"," ")})),Xn=[{key:"signup_enabled",label:"Novos cadastros abertos",type:"boolean",group:"Cadastro e demonstra\xE7\xE3o",default:!0,
help:'Desligado, a tela "Criar conta" do RUSTEN fica fechada (empresas existentes seguem normalmente).'},{key:"demo_enabled",label:'Bot\xE3o "Experimentar demonstra\xE7\xE3o" no login',
type:"boolean",group:"Cadastro e demonstra\xE7\xE3o",default:!0},{key:"demo_days",label:"Dias at\xE9 apagar demonstra\xE7\xF5es n\xE3o ativadas",type:"number",group:"Cadastro e dem\
onstra\xE7\xE3o",min:1,max:30,step:1,unit:"dias",default:7},{key:"default_mode",label:"Modo do PDV em empresas novas",type:"select",group:"Padr\xF5es de empresas novas",options:oo,
default:"manual"},{key:"default_service_fee",label:"Taxa de servi\xE7o padr\xE3o",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:30,step:.5,unit:"%",default:10},{key:"\
default_tables",label:"Mesas criadas no cadastro",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:300,step:1,default:10},{key:"default_cards",label:"Cart\xF5es de comanda\
 criados no cadastro",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:2e3,step:1,default:50},{key:"default_day_cutoff",label:"Virada do dia comercial",type:"number",group:"\
Padr\xF5es de empresas novas",min:0,max:12,step:1,unit:"h",default:5,help:"Vendas antes deste hor\xE1rio contam no dia anterior."},{key:"notice_text",label:"Aviso para todos os usu\
\xE1rios",type:"textarea",group:"Comunica\xE7\xE3o",max:300,default:"",help:"Exibido no topo do RUSTEN para todas as empresas. Deixe vazio para n\xE3o mostrar."},{key:"notice_level",
label:"Tipo do aviso",type:"select",group:"Comunica\xE7\xE3o",default:"info",options:[{value:"info",label:"Informativo"},{value:"warn",label:"Aten\xE7\xE3o"}]}],io=[{key:"name",label:"\
Nome da empresa",type:"text",group:"Empresa",max:120},{key:"timezone",label:"Fuso hor\xE1rio",type:"select",group:"Empresa",options:Xi},{key:"pdv_mode",label:"Modo padr\xE3o do PDV",
type:"select",group:"PDV e leitor",options:oo},{key:"pdv_scanner_enabled",label:"Leitor de c\xF3digo habilitado",type:"boolean",group:"PDV e leitor"},{key:"pdv_double_read_mandator\
y",label:"Dupla leitura obrigat\xF3ria",type:"boolean",group:"PDV e leitor",help:"Exige ler a comanda e depois o produto em cada item; s\xF3 exce\xE7\xE3o autorizada sai dela."},{key:"\
pdv_allow_manual",label:"Permitir lan\xE7amento manual",type:"boolean",group:"PDV e leitor"},{key:"pdv_exception_requires_manager",label:"Exce\xE7\xE3o \xE0 dupla leitura exige gerente",
type:"boolean",group:"PDV e leitor"},{key:"pdv_product_timeout_s",label:"Tempo para ler o produto ap\xF3s a comanda",type:"number",group:"PDV e leitor",min:3,max:120,step:1,unit:"s"},
{key:"pdv_require_open_cash",label:"Exigir caixa aberto para receber",type:"boolean",group:"Caixa e cobran\xE7a"},{key:"pdv_service_fee",label:"Taxa de servi\xE7o",type:"number",group:"\
Caixa e cobran\xE7a",min:0,max:30,step:.5,unit:"%"},{key:"pdv_card_prefix",label:"Prefixo dos cart\xF5es de comanda",type:"text",group:"Caixa e cobran\xE7a",max:8,help:"Letras mai\xFA\
sculas, n\xFAmeros e h\xEDfen."}],Yi=({default:e,...a})=>a,so=()=>({system:Xn.map(Yi),tenant:io});function Zi(e,a){if(a!=null)switch(e.type){case"boolean":if(typeof a!="boolean")throw f(
`${e.label}: valor inv\xE1lido`);return a;case"number":{let t=Number(a);if(!Number.isFinite(t)||e.min!=null&&t<e.min||e.max!=null&&t>e.max)throw f(`${e.label}: use um valor entre ${e.
min} e ${e.max}`);return t}case"select":if(!e.options.some(t=>t.value===a))throw f(`${e.label}: op\xE7\xE3o inv\xE1lida`);return a;default:{let t=String(a).trim();if(e.max&&t.length>
e.max)throw f(`${e.label}: m\xE1ximo de ${e.max} caracteres`);return t}}}function ro(e,a){if(!a||typeof a!="object"||Array.isArray(a))throw f('Envie os par\xE2metros em "values"');
let t={};for(let[n,o]of Object.entries(a)){let i=e.find(r=>r.key===n);if(!i)throw f(`Par\xE2metro desconhecido: ${n}`);let s=Zi(i,o);s!==void 0&&(t[n]=s)}return t}var Ht={at:0,v:null};
async function Ze(){if(Ht.v&&Date.now()-Ht.at<3e4)return Ht.v;let e=Object.fromEntries(Xn.map(a=>[a.key,a.default]));try{let{rows:a}=await d("select key, value from system_settings");
for(let t of a)t.key in e&&(e[t.key]=t.value)}catch{}return Ht={at:Date.now(),v:e},e}async function co(e){let a=ro(Xn,e);for(let[t,n]of Object.entries(a))await d(`insert into syste\
m_settings (key, value, updated_at) values ($1, $2::jsonb, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`,[t,JSON.stringify(n)]);return Ht.at=0,Ze()}var mo={pdv_mode:"mode",pdv_scanner_enabled:"sca\
nner_enabled",pdv_double_read_mandatory:"double_read_mandatory",pdv_allow_manual:"allow_manual",pdv_exception_requires_manager:"exception_requires_manager",pdv_product_timeout_s:"p\
roduct_timeout_s",pdv_require_open_cash:"require_open_cash",pdv_card_prefix:"card_prefix"};async function Yn(e){let{rows:a}=await d("select name, timezone, settings from companies \
where id = $1",[e]),t=a[0];if(!t)return null;let n=t.settings?.pdv||{},o={name:t.name,timezone:t.timezone};for(let[i,s]of Object.entries(mo))o[i]=n[s]??null;return o.pdv_service_fee=
n.service_fee_bp!=null?n.service_fee_bp/100:null,o}async function uo(e,a,t){let n=ro(io,t);if(n.pdv_card_prefix!=null&&!/^[A-Z0-9-]{1,8}$/.test(n.pdv_card_prefix))throw f("Prefixo \
dos cart\xF5es: use letras mai\xFAsculas, n\xFAmeros e h\xEDfen (at\xE9 8)");if(n.name!=null&&n.name.length<2)throw f("Nome da empresa muito curto");let o={};for(let[r,c]of Object.
entries(mo))r in n&&(o[c]=n[r]);"pdv_service_fee"in n&&(o.service_fee_bp=Math.round(n.pdv_service_fee*100));let s={...(await e.query("select settings from companies where id = $1 f\
or update",[a])).rows[0]?.settings?.pdv||{},...o};return Nt(s),await e.query(`update companies set name = coalesce($2, name), timezone = coalesce($3, timezone),
                    settings = jsonb_set(settings, '{pdv}', $4::jsonb) where id = $1`,[a,n.name??null,n.timezone??null,JSON.stringify(s)]),n}function lo(e){if(e==null||e==="")return null;let a=typeof e=="number"?e:Number(String(e).replace(",","."));return!Number.isFinite(a)||a<=0||a>1e7?null:Math.round(a*100)}function Qi(e,a){
if(!e||!a)return null;let t=e*12;return a>=t?null:{cents:t-a,pct:Math.floor((t-a)/t*100)}}function es(e){if(!e||typeof e!="object")return null;let a=lo(e.monthly_price??(e.monthly_cents!=
null?e.monthly_cents/100:null)),t=lo(e.annual_price??(e.yearly_cents!=null?e.yearly_cents/100:null)),n=Qi(a,t);return{id:e.id??null,code:e.code??null,name:String(e.name??""),description:e.
description??null,features:e.features??null,max_users:e.max_users??null,monthly_cents:a,yearly_cents:t,annual_savings_cents:n?.cents??null,annual_savings_pct:n?.pct??null,monthly_price:a==
null?null:a/100,annual_price:t==null?null:t/100}}var sn=e=>Array.isArray(e)?e.map(es).filter(a=>a&&(a.monthly_cents||a.yearly_cents)):[];function po(e){return e==="15_DAYS"?{trial:!0,
trial_days:15,trial_label:"Per\xEDodo de teste de 15 dias"}:e==="30_DAYS"?{trial:!0,trial_days:30,trial_label:"Per\xEDodo de teste de 30 dias"}:e==="UNLIMITED"?{trial:!0,trial_days:null,
trial_label:"Per\xEDodo de teste com prazo definido pela administra\xE7\xE3o"}:{trial:!1,trial_days:null,trial_label:null}}var _o="__Host-rusten_rt",St=e=>String(e.get("x-session-mode")||"").toLowerCase()==="cookie";function ts(e,a=_o){for(let t of String(e.headers.cookie||"").split(";")){let n=t.indexOf(
"=");if(n>0&&t.slice(0,n).trim()===a)return decodeURIComponent(t.slice(n+1).trim())}return null}function ns(e){let a=String(e.get("origin")||"");if(!a)throw new z(403,"Origem da re\
quisi\xE7\xE3o n\xE3o informada.","csrf");let t;try{t=new URL(a).host}catch{throw new z(403,"Origem inv\xE1lida.","csrf")}let n=String(e.get("x-edge-site")||""),o=String(R.CORS_ORIGINS||
"").split(",").map(s=>s.trim()).filter(Boolean),i=R.NODE_ENV!=="production"&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(t);if(!(n&&t===n)&&!o.includes(a)&&!i)throw new z(403,"Origem \
n\xE3o autorizada.","csrf")}var yo=(e,a)=>`${_o}=${e?encodeURIComponent(e):""}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${a}`;function zt(e,a,t,n=200){if(!St(e))return a.
status(n).json(t);let{refresh_token:o,...i}=t;return a.append("Set-Cookie",yo(o,an*86400)),a.set("Cache-Control","no-store"),a.status(n).json({...i,session:"cookie"})}function Zn(e){
e.append("Set-Cookie",yo("",0))}function fo(e){let a=String(e.body?.refresh_token||"");return St(e)&&ns(e),a||(St(e)?String(ts(e)||""):"")}var ve=as(),is=["12345678","senha123","password","qwerty","123456789","rusten123","abc12345"];function mt(e){if(e.length<10)throw f("A senha precisa ter pelo menos 10 caracteres");
if(!/[a-zA-Z]/.test(e)||!/\d/.test(e))throw f("A senha precisa ter letras e n\xFAmeros");if(is.some(a=>e.toLowerCase().includes(a)))throw f("Senha muito comum")}var ss=["bar","rest\
aurante","lanchonete","cafeteria","pub","food_truck","hamburgueria","pizzaria","padaria","outro"],rs=A.object({company:A.object({name:A.string().trim().min(2).max(120),segment:A.enum(
ss).default("restaurante"),document:A.string().trim().max(20).optional(),phone:A.string().trim().max(30).optional(),email:A.string().trim().email().max(160).optional(),address:A.object(
{street:A.string().max(160).optional(),city:A.string().max(80).optional(),state:A.string().max(2).optional(),zip:A.string().max(10).optional()}).partial().optional()}),owner:A.object(
{name:A.string().trim().min(2).max(120),email:A.string().trim().toLowerCase().email().max(160),password:A.string().min(1).max(200)}),accept_terms:A.literal(!0,{message:"\xC9 preciso a\
ceitar os termos"}),plan:A.object({code:A.string().max(60).optional(),cycle:A.enum(["mensal","anual"]).optional(),trial:A.boolean().optional()}).optional(),setup:A.object({unit_name:A.
string().trim().max(80).optional(),tables:A.number().int().min(0).max(300).default(10),cards:A.number().int().min(0).max(2e3).default(50),mode:A.enum(["manual","continua","dupla"]).
default("manual"),demo:A.boolean().default(!1),day_cutoff:A.number().int().min(0).max(12).default(5)}).default({})});ve.post("/register",p(async(e,a)=>{let t=await Ze();if(R.ALLOW_SIGNUP===
"false"||t.signup_enabled===!1)throw new z(403,"Novos cadastros est\xE3o temporariamente fechados","signup_closed");await ae(`register:${e.ip}`,10,3600);let n=w(rs,e.body);if(mt(n.
owner.password),(await d("select 1 from users where lower(email) = $1",[n.owner.email])).rows[0])throw new z(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.',
"email_taken");let i=await dt.hash(n.owner.password,12),s=await k(async c=>{let u=(await c.query(`insert into companies (name, segment, document, phone, email, address, settings)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,[n.company.name,n.company.segment,n.company.document??null,n.company.phone??null,n.company.email??n.owner.email,n.company.address??
{},{pdv:{mode:n.setup.mode,service_fee_bp:Math.round(Number(t.default_service_fee??10)*100)},plan_request:n.plan??null}])).rows[0].id;for(let h of Mn)await c.query("insert into rol\
es (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",[u,h.key,h.name,h.level,h.permissions]);let l=await c.query("insert into users (company_id, nam\
e, email, password_hash, role_key) values ($1,$2,$3,$4,'owner') returning id",[u,n.owner.name,n.owner.email,i]),_={companyId:u,userId:l.rows[0].id};return await Jn(c,u,n.setup),await g(
c,_,"empresa.cadastrada",{entity:"company",entityId:u,data:{segment:n.company.segment,plan:n.plan??null}}),await Lt(c,u,"tenant.created"),{companyId:u,userId:l.rows[0].id}});try{await tn(
s.companyId,4e3)&&await d("update platform_outbox set sent_at = now() where company_id = $1 and sent_at is null",[s.companyId])}catch{}let r=await rn({id:s.userId,company_id:s.companyId},
e);zt(e,a,r,201)}));async function rn(e,a){let t=os.randomUUID(),n=Se(48);return await d(`insert into user_sessions (id, user_id, refresh_hash, expires_at, ip)
           values ($1,$2,$3, now() + make_interval(days => $4), $5)`,[t,e.id,qe(n),an,a.ip]),{access_token:Vn(e,t),refresh_token:`${t}.${n}`}}var cs,ds=()=>cs||=dt.hashSync("dummy-\
password-for-timing",12);ve.get("/plans",p(async(e,a)=>{let t=await Ze(),n={signup_open:R.ALLOW_SIGNUP!=="false"&&t.signup_enabled!==!1,demo_enabled:t.demo_enabled!==!1,defaults:{mode:t.
default_mode,tables:t.default_tables,cards:t.default_cards,day_cutoff:t.default_day_cutoff}};if(!await De())return a.json({...n,hub:!1,plans:[]});try{let o=await Ee("GET","/plans",
void 0,5e3);a.json({...n,hub:!0,plans:sn(o.plans),trial_default:o.trial_default||null,...po(o.trial_default),signup_open:n.signup_open&&o.signup_enabled!==!1})}catch{a.json({...n,hub:!0,
plans:[],unavailable:!0})}}));var ms=A.object({name:A.string().trim().min(2,"Informe seu nome").max(120),email:A.string().trim().toLowerCase().email("E-mail inv\xE1lido").max(160),
password:A.string().min(1,"Informe a senha").max(200),accept_terms:A.literal(!0,{message:"\xC9 preciso aceitar os termos"})});ve.post("/demo",p(async(e,a)=>{let t=await Ze();if(t.demo_enabled===
!1)throw new z(403,"A demonstra\xE7\xE3o est\xE1 desativada no momento.","demo_disabled");await ae(`demo:${e.ip}`,10,3600);let n=w(ms,e.body||{});if(mt(n.password),n.email.endsWith(
"@demo.rusten.app"))throw f("Use o seu e-mail");if((await d("select 1 from users where lower(email) = $1",[n.email])).rows[0])throw new z(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "\
Entrar" ou recupere a senha.',"email_taken");let i=await dt.hash(n.password,12),s=await d("select id from companies where is_demo and created_at < now() - make_interval(days => $1)\
 limit 20",[Number(t.demo_days)||7]);for(let c of s.rows)await k(m=>m.query("select purge_demo_company($1)",[c.id])).catch(()=>{});let r=await k(async c=>{let m=await c.query("inse\
rt into companies (name, segment, email, settings, is_demo) values ('Bar Demonstra\xE7\xE3o', 'bar', null, $1, true) returning id, timezone",[{pdv:{mode:"manual",service_fee_bp:1e3}}]),
u=m.rows[0].id;for(let h of Mn)await c.query("insert into roles (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",[u,h.key,h.name,h.level,h.permissions]);
let l=await c.query("insert into users (company_id, name, email, password_hash, role_key) values ($1,$2,$3,$4,'owner') returning id",[u,n.name,n.email,i]),{unitId:_}=await Jn(c,u,{
unit_name:"Matriz",tables:12,cards:30,demo:!0,day_cutoff:5});return await ao(c,u,_,l.rows[0].id,Ne(new Date,m.rows[0].timezone,5)),await g(c,{companyId:u,userId:l.rows[0].id},"demo\
nstracao.criada",{entity:"company",entityId:u}),{companyId:u,userId:l.rows[0].id}}).catch(c=>{throw c.code==="23505"?new z(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recu\
pere a senha.',"email_taken"):c});zt(e,a,await rn({id:r.userId,company_id:r.companyId},e),201)}));ve.post("/activate",Xe(),p(async(e,a)=>{let t=w(A.object({company_name:A.string().
trim().min(2).max(120),name:A.string().trim().min(2).max(120),email:A.string().trim().toLowerCase().email().max(160),password:A.string().min(1).max(200),phone:A.string().trim().max(
30).optional(),keep_data:A.boolean().default(!1),accept_terms:A.literal(!0,{message:"\xC9 preciso aceitar os termos"})}),e.body);if(e.ctx.role!=="owner")throw new z(403,"S\xF3 o propr\
iet\xE1rio pode ativar o sistema.","forbidden");if(!e.ctx.company.is_demo)throw f("Esta empresa j\xE1 est\xE1 em uso normal.");let n=await Ze();if(R.ALLOW_SIGNUP==="false"||n.signup_enabled===
!1)throw new z(403,"Novos cadastros est\xE3o temporariamente fechados","signup_closed");if(mt(t.password),(await d("select 1 from users where lower(email) = $1 and id <> $2",[t.email,
e.ctx.userId])).rows[0])throw new z(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.',"email_taken");let i=e.ctx.companyId;await k(async s=>{if(!t.keep_data){
await s.query("select set_config('rusten.purge_demo', $1, true)",[String(i)]);for(let r of["delete from reviews where company_id = $1","delete from loyalty_ledger where company_id \
= $1 and reverses_id is not null","delete from loyalty_ledger where company_id = $1","delete from delivery_events where company_id = $1","delete from delivery_orders where company_\
id = $1","delete from kitchen_events where company_id = $1","delete from stock_movements where company_id = $1 and reverses_id is not null","delete from stock_movements where compa\
ny_id = $1","delete from recipe_lines where company_id = $1","delete from recipes where company_id = $1","update products set stock_mode = 'nenhum', stock_item_id = null where comp\
any_id = $1","delete from purchase_lines where company_id = $1","delete from purchases where company_id = $1","delete from inventory_counts where company_id = $1","update modifier_\
options set stock_item_id = null where company_id = $1","delete from stock_items where company_id = $1","delete from reservations where company_id = $1","delete from conversation_m\
essages where company_id = $1","delete from conversations where company_id = $1"])await s.query(r,[i]);await s.query("delete from payments where company_id = $1",[i]),await s.query(
"delete from cash_movements where company_id = $1",[i]),await s.query("delete from cash_sessions where company_id = $1",[i]),await s.query("delete from order_items where company_id\
 = $1",[i]),await s.query("delete from consumption_sessions where company_id = $1",[i]),await s.query("delete from customers where company_id = $1",[i]),await s.query("select set_c\
onfig('rusten.purge_demo', '', true)"),await s.query("update dining_tables set status = 'livre' where company_id = $1",[i]),await s.query("delete from scan_codes where company_id =\
 $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo)",[i]),await s.query("delete from modifier_groups where company_id = $1 and prod\
uct_id in (select id from products where company_id = $1 and demo)",[i]),await s.query("delete from product_price_history where company_id = $1 and product_id in (select id from pr\
oducts where company_id = $1 and demo)",[i]),await s.query("delete from products where company_id = $1 and demo",[i]),await s.query("delete from categories where company_id = $1 an\
d demo",[i])}await s.query("update companies set name = $2, phone = coalesce($3, phone), email = $4, is_demo = false, created_at = now() where id = $1",[i,t.company_name,t.phone??null,
t.email]),await s.query("update users set name = $2, email = $3, password_hash = $4, password_changed_at = now() where id = $1",[e.ctx.userId,t.name,t.email,await dt.hash(t.password,
12)]),await s.query("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[e.ctx.userId]),await g(s,e.ctx,"demonstracao.ativada",{entity:"company",
entityId:i,data:{keep_data:t.keep_data}}),await Lt(s,i,"tenant.created")});try{await jt(5)}catch{}zt(e,a,await rn({id:e.ctx.userId,company_id:i},e))}));ve.post("/login",p(async(e,a)=>{
let t=w(A.object({email:A.string().trim().toLowerCase().max(160),password:A.string().max(200)}),e.body);await ae(`login:${e.ip}`,30,900),await ae(`login-user:${t.email}`,15,900);let{
rows:n}=await d("select * from users where lower(email) = $1",[t.email]),o=n[0],i=await dt.compare(t.password,o?.password_hash||ds()),s=new z(401,"E-mail ou senha incorretos","bad_\
credentials");if(!o||!o.active)throw s;if(o.locked_until&&new Date(o.locked_until)>new Date)throw new z(423,"Conta bloqueada temporariamente por tentativas inv\xE1lidas. Tente em 15 m\
inutos.","locked");if(!i)throw await d(`update users set failed_attempts = failed_attempts + 1,
               locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
             where id = $1`,[o.id]),await g({query:d},{companyId:o.company_id,userId:o.id},"login.falhou",{entity:"user",entityId:o.id}),s;await d("update users set failed_attempts\
 = 0, locked_until = null where id = $1",[o.id]),await d("update companies set last_access_at = now() where id = $1",[o.company_id]),await g({query:d},{companyId:o.company_id,userId:o.
id},"login",{entity:"user",entityId:o.id}),zt(e,a,await rn(o,e))}));var wo=60,Qn={ok:!0,message:"Se o e-mail estiver cadastrado, voc\xEA vai receber um link para criar uma nova senha \
em alguns minutos."},ea={at:0,v:!1};async function ho(){if(Date.now()-ea.at<6e4)return ea.v;let e=!1;try{e=!!(await Ee("GET","/mail/status",void 0,5e3)).available}catch{e=!1}return ea=
{at:Date.now(),v:e},e}ve.get("/reset-options",p(async(e,a)=>a.json({available:await ho()})));ve.post("/forgot",p(async(e,a)=>{let t=w(A.object({email:A.string().trim().toLowerCase().
email("E-mail inv\xE1lido").max(160)}),e.body);if(await ae(`forgot:${e.ip}`,20,3600),!await ho())throw new z(503,"A recupera\xE7\xE3o de senha por e-mail ainda n\xE3o est\xE1 ativa. Pe\xE7a ao pr\
opriet\xE1rio ou administrador da empresa para definir uma nova senha em Configura\xE7\xF5es \u203A Usu\xE1rios, ou fale com o suporte.","reset_unavailable");try{await ae(`forgot-u\
ser:${t.email}`,3,3600)}catch{return a.json(Qn)}let n=(await d(`select u.id, u.name, u.email, u.company_id, c.name as company_name, c.is_demo from users u join companies c on c.id \
= u.company_id
     where lower(u.email) = $1 and u.active`,[t.email])).rows[0];if(!n||n.is_demo&&n.email.endsWith("@demo.rusten.app"))return a.json(Qn);let o=Se(32);await d("update password_rese\
ts set used_at = now() where user_id = $1 and used_at is null",[n.id]),await d("insert into password_resets (user_id, token_hash, expires_at, ip) values ($1,$2, now() + make_interv\
al(mins => $3), $4)",[n.id,qe(o),wo,String(e.ip||"").slice(0,64)]);try{await Ee("POST","/mail/password-reset",{to:n.email,name:n.name,company:n.company_name,path:`/redefinir-senha?\
token=${o}`,minutes:wo},2e4)}catch(i){throw await d("update password_resets set used_at = now() where token_hash = $1",[qe(o)]),new z(i.status===429?429:502,i.status===429?i.message:
"N\xE3o foi poss\xEDvel enviar o e-mail agora. Tente novamente em alguns minutos.","mail_failed")}await g({query:d},{companyId:n.company_id,userId:n.id},"senha.redefinicao_pedida",
{entity:"user",entityId:n.id}),a.json(Qn)}));ve.post("/reset",p(async(e,a)=>{let t=w(A.object({token:A.string().trim().min(20).max(200),new_password:A.string().max(200)}),e.body);await ae(
`reset:${e.ip}`,30,3600),mt(t.new_password);let n=await k(async o=>{let i=(await o.query("update password_resets set used_at = now() where token_hash = $1 and used_at is null and e\
xpires_at > now() returning user_id",[qe(t.token)])).rows[0];if(!i)throw new z(400,"Este link expirou ou j\xE1 foi usado. Pe\xE7a um novo em \u201CEsqueci minha senha\u201D.","rese\
t_invalid");let s=(await o.query("select id, company_id from users where id = $1 and active",[i.user_id])).rows[0];if(!s)throw new z(400,"Conta indispon\xEDvel.","reset_invalid");return await o.
query("update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null where id = $1",[s.id,await dt.hash(t.new_password,10)]),await o.query(
"update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[s.id]),await g(o,{companyId:s.company_id,userId:s.id},"senha.redefinida_por_email",{entity:"\
user",entityId:s.id}),{ok:!0}});a.json(n)}));ve.post("/refresh",p(async(e,a)=>{try{await us(e,a)}catch(t){throw St(e)&&t?.status===401&&Zn(a),t}}));async function us(e,a){let t=fo(
e),[n,o]=t.split(".");if(!n||!o||!/^[0-9a-f-]{36}$/.test(n))throw new z(401,"Sess\xE3o inv\xE1lida","unauthenticated");let i=await k(async s=>{let{rows:r}=await s.query("select s.*\
, u.company_id, u.active from user_sessions s join users u on u.id = s.user_id where s.id = $1 for update of s",[n]),c=r[0];if(!c||c.revoked_at||new Date(c.expires_at)<new Date||!c.
active)throw new z(401,"Sess\xE3o expirada","unauthenticated");if(c.refresh_hash!==qe(o))return await s.query("update user_sessions set revoked_at = now() where user_id = $1 and re\
voked_at is null",[c.user_id]),await g(s,{companyId:c.company_id,userId:c.user_id},"sessao.reuso_detectado",{entity:"user",entityId:c.user_id}),null;let m=Se(48);return await s.query(
"update user_sessions set refresh_hash = $2, rotated_at = now() where id = $1",[n,qe(m)]),{access_token:Vn({id:c.user_id,company_id:c.company_id},n),refresh_token:`${n}.${m}`}});if(!i)
throw new z(401,"Sess\xE3o encerrada por seguran\xE7a. Entre novamente.","unauthenticated");zt(e,a,i)}ve.post("/logout",Xe(),p(async(e,a)=>{e.body?.all===!0?await d("update user_se\
ssions set revoked_at = now() where user_id = $1 and revoked_at is null",[e.ctx.userId]):await d("update user_sessions set revoked_at = now() where id = $1",[e.ctx.sessionId]),St(e)&&
Zn(a),a.json({ok:!0})}));ve.post("/password",Xe(),p(async(e,a)=>{let t=w(A.object({current:A.string().max(200),next:A.string().max(200)}),e.body);mt(t.next);let{rows:n}=await d("se\
lect password_hash from users where id = $1",[e.ctx.userId]);if(!await dt.compare(t.current,n[0].password_hash))throw f("Senha atual incorreta");await d("update users set password_\
hash = $2, password_changed_at = now() where id = $1",[e.ctx.userId,await dt.hash(t.next,12)]),await d("update user_sessions set revoked_at = now() where user_id = $1 and id <> $2 \
and revoked_at is null",[e.ctx.userId,e.ctx.sessionId]),await g({query:d},e.ctx,"senha.alterada",{entity:"user",entityId:e.ctx.userId}),a.json({ok:!0})}));ve.get("/me",Xe(),p(async(e,a)=>{
let t=e.ctx,n=await d("select id, name, day_cutoff from units where company_id = $1 and active order by id",[t.companyId]),o=t.terminalUnitId||t.unitId||n.rows[0]?.id;a.json({user:{
id:t.userId,name:t.name,email:t.email,role:t.role,roleName:t.roleName,level:t.level,unitId:t.unitId},company:t.company,brand:await Bt({query:d},t.companyId),permissions:[...t.perms],
access:t.access,units:n.rows,unitId:o,terminalId:t.terminalId,pdv:await Ye({query:d},t,o),catalog:{permissions:_t,modules:kt},notice:await ls()})}));async function ls(){let e=await Ze();
return e.notice_text?{text:e.notice_text,level:e.notice_level==="warn"?"warn":"info"}:null}import{Router as ps}from"npm:express@5.2.1";import ta from"npm:bcryptjs@3.0.3";import{z as j}from"npm:zod@4.6.5";var re=ps();async function go(e,a){let t=await d("select level from roles where company_id = $1 and key = $2",[e,a]);if(!t.rows[0])throw f("Perfil inexistente");return t.rows[0].level}
re.get("/users",y("usuarios.gerenciar"),p(async(e,a)=>{let{rows:t}=await d(`select u.id, u.name, u.email, u.role_key, r.name as role_name, r.level, u.unit_id, u.active, u.created_a\
t,
            u.locked_until > now() as locked
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by r.level desc, u.name`,[e.ctx.companyId]);a.json(t)}));var bo=j.object({name:j.string().trim().min(2).max(120),email:j.string().trim().toLowerCase().
email().max(160),password:j.string().max(200).optional(),role_key:j.string().max(40),unit_id:j.number().int().nullable().optional(),active:j.boolean().optional()});re.post("/users",
y("usuarios.gerenciar"),p(async(e,a)=>{let t=w(bo,e.body);if(await go(e.ctx.companyId,t.role_key)>e.ctx.level)throw G("N\xE3o \xE9 poss\xEDvel criar usu\xE1rio com perfil acima do seu");
if(!t.password)throw f("Informe a senha inicial");if(mt(t.password),t.unit_id&&await na(e.ctx.companyId,t.unit_id),(await d("select 1 from users where lower(email) = $1",[t.email])).
rows[0])throw b("E-mail j\xE1 cadastrado");let o=await d("insert into users (company_id, name, email, password_hash, role_key, unit_id) values ($1,$2,$3,$4,$5,$6) returning id",[e.
ctx.companyId,t.name,t.email,await ta.hash(t.password,12),t.role_key,t.unit_id??null]);await g({query:d},e.ctx,"usuario.criado",{entity:"user",entityId:o.rows[0].id,data:{role:t.role_key}}),
await Lt({query:d},e.ctx.companyId,"tenant.updated"),a.status(201).json({id:o.rows[0].id})}));re.put("/users/:id",y("usuarios.gerenciar"),p(async(e,a)=>{let t=Number(e.params.id),n=w(
bo.partial(),e.body),i=(await d(`select u.*, r.level from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                       where u.id = $1 and u.company_id = $2`,[t,e.ctx.companyId])).rows[0];if(!i)throw v("Usu\xE1rio n\xE3o encontrado");if(i.level>e.ctx.level||i.level===e.ctx.level&&
i.id!==e.ctx.userId&&e.ctx.role!=="owner")throw G("N\xE3o \xE9 poss\xEDvel alterar usu\xE1rio de n\xEDvel igual ou superior");if(n.role_key&&await go(e.ctx.companyId,n.role_key)>e.
ctx.level)throw G("Perfil acima do seu");if(i.role_key==="owner"&&n.role_key&&n.role_key!=="owner"&&(await d("select count(*)::int n from users where company_id = $1 and role_key =\
 'owner' and active",[e.ctx.companyId])).rows[0].n<=1)throw f("A empresa precisa de ao menos um propriet\xE1rio ativo");n.unit_id&&await na(e.ctx.companyId,n.unit_id);let s=null;n.
password&&(mt(n.password),s=await ta.hash(n.password,12)),await d(`update users set name = coalesce($3, name), email = coalesce($4, email), role_key = coalesce($5, role_key),
             unit_id = case when $6::boolean then $7 else unit_id end, active = coalesce($8, active),
             password_hash = coalesce($9, password_hash),
             password_changed_at = case when $9 is not null then now() else password_changed_at end
           where id = $1 and company_id = $2`,[t,e.ctx.companyId,n.name??null,n.email??null,n.role_key??null,"unit_id"in n,n.unit_id??null,n.active??null,s]),(n.active===!1||s)&&await d(
"update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[t]),await g({query:d},e.ctx,"usuario.alterado",{entity:"user",entityId:t,data:{...n,password:n.
password?"alterada":void 0}}),a.json({ok:!0})}));re.get("/roles",y("usuarios.gerenciar"),p(async(e,a)=>{let{rows:t}=await d("select key, name, level, permissions, system from roles\
 where company_id = $1 order by level desc",[e.ctx.companyId]);a.json({roles:t,catalog:_t})}));re.put("/roles/:key",y("usuarios.gerenciar"),p(async(e,a)=>{let t=w(j.object({name:j.
string().trim().min(2).max(60).optional(),permissions:j.array(j.string()).max(200).optional(),level:j.number().int().min(1).max(99).optional()}),e.body),n=(await d("select * from r\
oles where company_id = $1 and key = $2",[e.ctx.companyId,e.params.key])).rows[0];if(!n)throw v("Perfil n\xE3o encontrado");if(n.key==="owner")throw G("O perfil Propriet\xE1rio n\xE3o po\
de ser alterado");if(n.level>=e.ctx.level)throw G("S\xF3 \xE9 poss\xEDvel alterar perfis abaixo do seu n\xEDvel");if(t.level&&t.level>=e.ctx.level)throw G("N\xEDvel acima do seu");
if(t.permissions){let o=t.permissions.find(s=>!(s in _t));if(o)throw f(`Permiss\xE3o inv\xE1lida: ${o}`);let i=t.permissions.find(s=>!e.ctx.can(s));if(i)throw G(`Voc\xEA n\xE3o pode conc\
eder o que n\xE3o tem: ${i}`)}await d("update roles set name = coalesce($3,name), permissions = coalesce($4,permissions), level = coalesce($5,level) where company_id = $1 and key =\
 $2",[e.ctx.companyId,n.key,t.name??null,t.permissions??null,t.level??null]),await g({query:d},e.ctx,"perfil.alterado",{entity:"role",entityId:n.key,data:{before:n.permissions,after:t.
permissions}}),a.json({ok:!0})}));re.post("/roles",y("usuarios.gerenciar"),p(async(e,a)=>{let t=w(j.object({name:j.string().trim().min(2).max(60),level:j.number().int().min(1).max(
99),permissions:j.array(j.string()).max(200)}),e.body);if(t.level>=e.ctx.level)throw G("N\xEDvel acima do seu");let n=t.permissions.find(i=>!(i in _t)||!e.ctx.can(i));if(n)throw G(
`Permiss\xE3o inv\xE1lida ou n\xE3o conced\xEDvel: ${n}`);let o=`custom_${Se(4).toLowerCase().replace(/[^a-z0-9]/g,"x")}`;await d("insert into roles (company_id, key, name, level, \
permissions) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,o,t.name,t.level,t.permissions]),await g({query:d},e.ctx,"perfil.criado",{entity:"role",entityId:o,data:t}),a.status(201).json(
{key:o})}));async function na(e,a){if(!(await d("select id from units where id = $1 and company_id = $2",[a,e])).rows[0])throw f("Unidade inv\xE1lida")}re.get("/units",p(async(e,a)=>{
a.json((await d("select id, name, active, day_cutoff, settings from units where company_id = $1 order by id",[e.ctx.companyId])).rows)}));re.post("/units",y("configuracoes.gerencia\
r"),p(async(e,a)=>{let t=w(j.object({name:j.string().trim().min(2).max(80),day_cutoff:j.number().int().min(0).max(12).default(5)}),e.body),n=await d("insert into units (company_id,\
 name, day_cutoff) values ($1,$2,$3) returning id",[e.ctx.companyId,t.name,t.day_cutoff]);await g({query:d},e.ctx,"unidade.criada",{entity:"unit",entityId:n.rows[0].id,data:t}),a.status(
201).json({id:n.rows[0].id})}));re.put("/units/:id",y("configuracoes.gerenciar"),p(async(e,a)=>{let t=w(j.object({name:j.string().trim().min(2).max(80).optional(),day_cutoff:j.number().
int().min(0).max(12).optional(),active:j.boolean().optional()}),e.body);if(!(await d("update units set name = coalesce($3,name), day_cutoff = coalesce($4,day_cutoff), active = coal\
esce($5,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.day_cutoff??null,t.active??null])).rows[0])throw v();await g({query:d},
e.ctx,"unidade.alterada",{entity:"unit",entityId:e.params.id,data:t}),a.json({ok:!0})}));re.get("/terminals",p(async(e,a)=>{a.json((await d("select id, unit_id, name, active, setti\
ngs from terminals where company_id = $1 order by id",[e.ctx.companyId])).rows)}));re.post("/terminals",y("configuracoes.gerenciar"),p(async(e,a)=>{let t=w(j.object({name:j.string().
trim().min(2).max(60),unit_id:j.number().int()}),e.body);await na(e.ctx.companyId,t.unit_id);let n=await d("insert into terminals (company_id, unit_id, name) values ($1,$2,$3) retu\
rning id",[e.ctx.companyId,t.unit_id,t.name]);await g({query:d},e.ctx,"terminal.criado",{entity:"terminal",entityId:n.rows[0].id,data:t}),a.status(201).json({id:n.rows[0].id})}));re.
put("/terminals/:id",y("configuracoes.gerenciar"),p(async(e,a)=>{let t=w(j.object({name:j.string().trim().min(2).max(60).optional(),active:j.boolean().optional()}),e.body);if(!(await d(
"update terminals set name = coalesce($3,name), active = coalesce($4,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.active??
null])).rows[0])throw v();a.json({ok:!0})}));var _s=j.object({name:j.string().trim().min(2).max(120),segment:j.string().max(30),document:j.string().max(20).nullable(),phone:j.string().
max(30).nullable(),email:j.string().email().max(160).nullable(),timezone:j.string().max(60),address:j.record(j.string(),j.string().max(160)),appearance:j.object({theme:j.enum(["cla\
ro","escuro","auto"]).optional(),density:j.enum(["confortavel","compacta"]).optional(),menu:j.enum(["lateral","superior"]).optional(),accent:j.string().regex(/^#[0-9a-fA-F]{6}$/).or(
j.literal("")).optional(),font_display:j.enum(["bebas","oswald","anton","playfair","righteous","montserrat","lobster","inter"]).optional(),font_body:j.enum(["inter","roboto","nunit\
o","poppins","lato","source"]).optional(),radius:j.enum(["reto","padrao","arredondado"]).optional(),sidebar:j.enum(["padrao","cor","escura","transparente"]).optional(),logo_mode:j.
enum(["rusten","logo","logo_nome","nome"]).optional(),brand_title:j.string().max(40).optional(),brand_subtitle:j.string().max(60).optional(),logo_size:j.number().int().min(24).max(
96).optional(),bg_overlay:j.number().min(0).max(.95).optional(),bg_blur:j.boolean().optional(),bg_fit:j.enum(["cobrir","repetir","centro"]).optional()})}).partial();re.get("/settin\
gs",p(async(e,a)=>{let t=(await d("select id, name, segment, document, phone, email, timezone, address, settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json(t)}));
re.put("/settings",y("configuracoes.gerenciar"),p(async(e,a)=>{let t=w(_s,e.body);if(t.timezone)try{new Intl.DateTimeFormat("pt-BR",{timeZone:t.timezone})}catch{throw f("Fuso hor\xE1r\
io inv\xE1lido")}await d(`update companies set name = coalesce($2,name), segment = coalesce($3,segment), document = coalesce($4,document),
             phone = coalesce($5,phone), email = coalesce($6,email), timezone = coalesce($7,timezone), address = coalesce($8,address),
             settings = case when $9::jsonb is null then settings else jsonb_set(settings, '{appearance}', $9::jsonb) end
           where id = $1`,[e.ctx.companyId,t.name??null,t.segment??null,t.document??null,t.phone??null,t.email??null,t.timezone??null,t.address??null,t.appearance?JSON.stringify(t.
appearance):null]),await g({query:d},e.ctx,"configuracoes.empresa",{entity:"company",entityId:e.ctx.companyId,data:t}),a.json({ok:!0})}));var ys=j.object({scanner_enabled:j.boolean(),
mode:j.enum(["manual","continua","dupla"]),double_read_mandatory:j.boolean(),allow_manual:j.boolean(),allow_manual_exception:j.boolean(),exception_requires_manager:j.boolean(),allow_mode_change:j.
boolean(),product_timeout_s:j.number().int(),open_free_card_on_scan:j.boolean(),feedback_sound:j.boolean(),qty_per_scan:j.number().int().min(1).max(100),max_qty_per_scan:j.number().
int().min(1).max(100),terminator:j.enum(["Enter","Tab"]),kitchen_send:j.enum(["imediato","lote"]),require_open_cash:j.boolean(),service_fee_bp:j.number().int().min(0).max(3e3),card_prefix:j.
string().regex(/^[A-Z0-9-]{1,8}$/)}).partial();re.get("/pdv-settings",p(async(e,a)=>{let t=Number(e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId||null,n=await d("select setti\
ngs->'pdv' as s from companies where id = $1",[e.ctx.companyId]),o=t?await d("select settings->'pdv' as s from units where id = $1 and company_id = $2",[t,e.ctx.companyId]):{rows:[]},
i=Number(e.query.terminal_id)||e.ctx.terminalId,s=i?await d("select settings->'pdv' as s from terminals where id = $1 and company_id = $2",[i,e.ctx.companyId]):{rows:[]};a.json({company:n.
rows[0]?.s||{},unit:o.rows[0]?.s||{},terminal:s.rows[0]?.s||{},effective:Gn(n.rows[0]?.s,o.rows[0]?.s,s.rows[0]?.s)})}));re.put("/pdv-settings/:level",y("configuracoes.gerenciar"),
p(async(e,a)=>{let t=w(j.enum(["company","unit","terminal"]),e.params.level),n=w(ys,e.body?.settings);Nt(n);let o=Number(e.body?.id);await k(async i=>{let s;if(t==="company"){s=(await i.
query("select settings->'pdv' s, settings from companies where id = $1 for update",[e.ctx.companyId])).rows[0];let r={...s.s||{},...n};Nt(r),await i.query("update companies set set\
tings = jsonb_set(settings, '{pdv}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(r)])}else{let r=t==="unit"?"units":"terminals";if(s=(await i.query(`select settings->\
'pdv' s from ${r} where id = $1 and company_id = $2 for update`,[o,e.ctx.companyId])).rows[0],!s)throw v();let c={...s.s||{},...n};Nt(c),await i.query(`update ${r} set settings = j\
sonb_set(settings, '{pdv}', $3::jsonb) where id = $1 and company_id = $2`,[o,e.ctx.companyId,JSON.stringify(c)])}await g(i,e.ctx,"pdv.configuracao",{entity:t,entityId:o||e.ctx.companyId,
data:{before:s?.s||{},after:n}})}),a.json({ok:!0,effective:await Ye({query:d},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId)})}));re.get("/audit",y("auditoria.visualizar"),p(async(e,a)=>{
let t=Math.min(Number(e.query.limit)||50,500),n=Math.max(Number(e.query.offset)||0,0),o=[e.ctx.companyId],i="a.company_id = $1";e.query.action&&(o.push(`${String(e.query.action)}%`),
i+=` and a.action like $${o.length}`),e.query.entity&&(o.push(String(e.query.entity)),i+=` and a.entity = $${o.length}`),e.query.entity_id&&(o.push(String(e.query.entity_id)),i+=` \
and a.entity_id = $${o.length}`),o.push(t,n);let{rows:s}=await d(`select a.id, a.action, a.entity, a.entity_id, a.reason, a.data, a.created_at, a.terminal_id, a.unit_id, u.name as \
user_name
       from audit_events a left join users u on u.id = a.user_id
      where ${i} order by a.id desc limit $${o.length-1} offset $${o.length}`,o);if(e.query.format==="csv")return a.type("text/csv; charset=utf-8").attachment("auditoria.csv"),a.send(
["data;usuario;acao;entidade;id;motivo",...s.map(r=>[r.created_at.toISOString(),r.user_name,r.action,r.entity,r.entity_id,r.reason].map(vt).join(";"))].join(`
`));a.json(s)}));re.post("/authorizations",p(async(e,a)=>{let t=w(j.object({email:j.string().trim().toLowerCase().max(160),password:j.string().max(200),action:j.enum(["excecao_dupl\
a_leitura","cancelar_item","desconto","alterar_preco","reabrir_comanda","cancelar_venda","taxa_servico"]),reason:j.string().trim().min(3).max(300)}),e.body);await ae(`auth-mgr:${e.
ctx.companyId}:${t.email}`,5,600);let n={excecao_dupla_leitura:"pdv.excecao_dupla_leitura",cancelar_item:"pdv.cancelar_item",desconto:"pdv.desconto",alterar_preco:"pdv.alterar_prec\
o",reabrir_comanda:"pdv.reabrir_comanda",cancelar_venda:"pdv.cancelar_venda",taxa_servico:"pdv.taxa_servico"}[t.action],{rows:o}=await d(`select u.id, u.password_hash, r.permission\
s from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                             where lower(u.email) = $1 and u.company_id = $2 and u.active`,[t.email,e.ctx.companyId]),i=o[0];if(!(i&&await ta.compare(t.password,i.password_hash))||
!i.permissions.includes("pdv.autorizar")||!i.permissions.includes(n))throw await g({query:d},e.ctx,"autorizacao.negada",{data:{action:t.action,email:t.email}}),G("Autoriza\xE7\xE3o recus\
ada: credenciais inv\xE1lidas ou sem permiss\xE3o para autorizar esta a\xE7\xE3o");let r=Se(24);await d(`insert into manager_authorizations (company_id, requested_by, authorized_by\
, action, scope, token_hash, expires_at)
           values ($1,$2,$3,$4,$5,$6, now() + interval '2 minutes')`,[e.ctx.companyId,e.ctx.userId,i.id,t.action,{reason:t.reason,terminal:e.ctx.terminalId},qe(r)]),await g({query:d},
e.ctx,"autorizacao.concedida",{reason:t.reason,data:{action:t.action,authorized_by:i.id}}),a.json({authorization:r,expires_in:120})}));async function ut(e,a,t,n){if(!t)throw G("Est\
a a\xE7\xE3o exige autoriza\xE7\xE3o de um gerente","authorization_required");let{rows:o}=await e.query(`update manager_authorizations set used_at = now()
      where token_hash = $1 and company_id = $2 and requested_by = $3 and action = $4 and used_at is null and expires_at > now()
      returning authorized_by, scope`,[qe(t),a.companyId,a.userId,n]);if(!o[0])throw G("Autoriza\xE7\xE3o gerencial inv\xE1lida, expirada ou j\xE1 utilizada");return o[0]}import{Router as Ms}from"npm:express@5.2.1";import{z as S}from"npm:zod@4.6.5";var fs="https://loja.infinitepay.io";var xo=e=>/^[a-z0-9][a-z0-9_.-]{1,59}$/.test(e),ws=e=>{let a=String(e).match(/R\$\s*([\d.]+,\d{2})/);return a?Math.round(Number(a[1].replace(/\./g,"").replace(",","."))*100):null};
function hs(e,a){let t={store:null,categories:[],products:[]},n=e.match(/^# Loja:\s*(.+)$/m);n&&(t.store=n[1].trim().slice(0,120));let o=s=>{let r=e.match(new RegExp(`^## ${s}\\s*\\n\
([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,"m"));return r?r[1]:""};for(let s of o("Categories").split(`
`)){let r=s.match(/^-\s+(.+?)\s+\((\d+)-([a-z0-9-]*)\)\s*$/);r&&t.categories.push({ext_id:r[2],slug:`${r[2]}-${r[3]}`,name:r[1].trim().slice(0,80)})}let i=a.replace(/[.]/g,"\\.");for(let s of o(
"Catalog").split(`
`)){let r=s.match(new RegExp(`^-\\s+(.+)\\s+-\\s+(-?R\\$\\s*[\\d.]+,\\d{2})\\s+-\\s+([a-z_ ]+?)\\s+-\\s+https://loja\\.infinitepay\\.io/llms/${i}/([a-z0-9-]+)\\.md\\s*$`));r&&t.products.
push({slug:r[4],name:r[1].trim().slice(0,120),price_cents:ws(r[2]),available:r[3].trim()==="available"})}return t}var gs=e=>e.replace(/\\\\/g,"\0").replace(/\\"/g,'"').replace(/\u0000/g,
"\\"),bs=e=>{try{return JSON.parse(`"${e}"`)}catch{return e}};function $s(e,a){let t=gs(e),n=a.replace(/[.]/g,"\\."),o=new RegExp(`"path":"/${n}/([a-z0-9-]+)","info":\\{"sales_produ\
ct":\\{([\\s\\S]*?)"product_default_variation_index":(\\d+)`,"g"),i=[],s=new Set;for(let c of t.matchAll(o)){if(s.has(c[1]))continue;s.add(c[1]);let m=c[2],u=m.match(/"name":"((?:[^"\\]|\\.)*)"/),
l=[...m.matchAll(/\{"id":(\d+),"price":(\d+),"promotional_price":(null|\d+)[^}]*?"quantity":(null|-?\d+),"stock_control":(true|false)\}/g)].map(h=>({id:Number(h[1]),price_cents:Number(
h[2]),promo_cents:h[3]==="null"?null:Number(h[3]),quantity:h[4]==="null"?null:Number(h[4]),stock_control:h[5]==="true"})),_=l[Number(c[3])]||l[0];i.push({slug:c[1],name:u?bs(u[1]).
trim().slice(0,120):null,price_cents:_?_.promo_cents??_.price_cents:null,variations:l.length,available:!_||!_.stock_control||(_.quantity??1)>0})}let r=t.match(/"initialMeta":\{"current_page":(\d+),"next_page":(null|\d+)/);
return{products:i,page:r?Number(r[1]):1,next:r&&r[2]!=="null"?Number(r[2]):null}}async function vo(e,a){let t=new AbortController,n=setTimeout(()=>t.abort(),15e3);try{let o=await a(
fs+e,{headers:{"user-agent":"RUSTEN/1.0 (importacao de cardapio)",accept:"text/html,text/markdown,*/*"},redirect:"error",signal:t.signal});if(o.status===404)return null;if(!o.ok)throw Object.
assign(new Error(`InfinitePay respondeu ${o.status}`),{upstream:o.status});let i=await o.text();if(i.length>4194304)throw new Error("P\xE1gina da InfinitePay grande demais");return i}finally{
clearTimeout(n)}}async function $o(e,a,t){let n=new Map;for(let o=1;o<=15;o++){let i=new URLSearchParams(a);o>1&&i.set("page",String(o));let s=await vo(`/${e}${i.toString()?`?${i}`:
""}`,t);if(!s)break;let r=$s(s,e),c=0;for(let m of r.products)n.has(m.slug)||(n.set(m.slug,m),c++);if(!r.next||!c)break}return[...n.values()]}async function ko(e,a=globalThis.fetch){
let t=await vo(`/llms/${e}.md`,a);if(t==null)return null;let n=hs(t,e),o=[],i=new Map(n.products.map(m=>[m.slug,{...m,category:null,variations:1}]));try{for(let m of await $o(e,{},
a)){let u=i.get(m.slug);u?Object.assign(u,{variations:m.variations,price_cents:u.price_cents??m.price_cents}):m.name&&i.set(m.slug,{...m,category:null})}}catch{o.push("A vitrine n\xE3\
o respondeu; usei s\xF3 o resumo do cat\xE1logo.")}let s=n.categories.slice(0,80);n.categories.length>80&&o.push("S\xF3 as primeiras 80 categorias foram lidas.");let r=0;for(let m of s)
try{let u=await $o(e,{categories:m.slug},a);m.count=u.length;for(let l of u){let _=i.get(l.slug)||(l.name?i.set(l.slug,{...l,category:null}).get(l.slug):null);_&&!_.category&&(_.category=
m.name)}}catch{r++}r&&o.push(`${r} categoria(s) n\xE3o puderam ser lidas; os produtos delas v\xEAm sem categoria.`);let c=[...i.values()].filter(m=>m.name&&m.price_cents!=null);return{
store:n.store,categories:s.map(m=>({name:m.name,count:m.count??null})),products:c,warnings:o}}import vs from"node:crypto";import{Buffer as ks}from"node:buffer";import{Router as Is}from"npm:express@5.2.1";import{z as L}from"npm:zod@4.6.5";var xs={enabled:!0,allow_negative:!0,correction_limit_cents:5e3,correction_max_pct:20,correction_expire_days:7},Le=e=>({...xs,...e?.stock||{}});async function Qe(e,a,t){let n=await e.
query(`select stock_item_id, coalesce(sum(qty),0)::numeric as qty from stock_movements
    where company_id = $1 ${t?"and stock_item_id = any($2)":""} group by stock_item_id`,t?[a,t]:[a]);return Object.fromEntries(n.rows.map(o=>[o.stock_item_id,Number(o.qty)]))}var Io=e=>Math.
round(e*1e4)/1e4;async function ft(e,a,t,n,o=[]){let i=new Map,s=(r,c)=>i.set(Number(r),Io((i.get(Number(r))||0)+c));if(t.stock_mode==="acabado"&&t.stock_item_id&&s(t.stock_item_id,
Number(n)),t.stock_mode==="ficha"){let r=(await e.query(`select l.stock_item_id, l.qty, l.loss_pct, r.yield_qty from recipes r join recipe_lines l on l.recipe_id = r.id
      where r.company_id = $1 and r.product_id = $2 and r.active`,[a,t.id])).rows;for(let c of r)s(c.stock_item_id,Number(c.qty)*(1+Number(c.loss_pct)/100)/Number(c.yield_qty)*Number(
n))}if(o.length){let r=(await e.query("select stock_item_id, stock_qty from modifier_options where company_id = $1 and id = any($2) and stock_item_id is not null and stock_qty > 0",
[a,o])).rows;for(let c of r)s(c.stock_item_id,Number(c.stock_qty)*Number(n))}return i}async function cn(e,a,t,n,o){let i=(await e.query("select settings from companies where id = $\
1",[a.companyId])).rows[0],s=Le(i.settings);if(!s.enabled)return[];let r=await ft(e,a.companyId,n,t.qty,o);if(!r.size)return[];let c=[...r.keys()],m=(await e.query("select id, name\
, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2) order by id for update",[a.companyId,c])).rows;if(!s.allow_negative){let l=await Qe(e,a.companyId,c);
for(let _ of m)if((l[_.id]||0)-r.get(Number(_.id))<-1e-4)throw b(`Estoque insuficiente de ${_.name} (saldo ${(l[_.id]||0).toLocaleString("pt-BR")} ${_.unit})`,"stock_insufficient")}
let u=[];for(let l of m){let _=await e.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, user_id)
      values ($1,$2,'venda',$3,$4,'order_item',$5,$6) on conflict do nothing returning id`,[a.companyId,l.id,-r.get(Number(l.id)),l.avg_cost_cents,t.id,a.userId]);_.rows[0]&&u.push(
_.rows[0].id)}return u}async function Gt(e,a,t,n){let o=(await e.query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'order_item' and m.ref_id = $2 an\
d m.kind = 'venda'
    and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`,[a.companyId,t])).rows;for(let i of o)await e.query(`insert into stock_movements (company_id, stock\
_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
      values ($1,$2,'estorno_venda',$3,$4,'order_item_rev',$5,$6,$7,$8)`,[a.companyId,i.stock_item_id,-Number(i.qty),i.unit_cost_cents,t,i.id,n,a.userId]);return o.length}async function Ct(e,a,t,n,o,i,s){
let r=(await e.query("select avg_cost_cents from stock_items where id = $1 and company_id = $2 for update",[t,a.companyId])).rows[0],c=(await Qe(e,a.companyId,[t]))[t]||0,m=Math.max(
0,c),u=m+n>0?(m*Number(r.avg_cost_cents)+n*o)/(m+n):o;await e.query("update stock_items set avg_cost_cents = $3 where id = $1 and company_id = $2",[t,a.companyId,Io(u)]),await e.query(
`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
    values ($1,$2,'entrada',$3,$4,$5,$6,$7,$8)`,[a.companyId,t,n,o,i?.type??null,i?.id??null,s??null,a.userId])}async function aa(e,a,t){let n=await ft(e,a,t,1,[]);if(!n.size)return Number(
t.cost_cents||0);let o=(await e.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2)",[a,[...n.keys()]])).rows;return Math.round(o.reduce((i,s)=>i+
Number(s.avg_cost_cents)*n.get(Number(s.id)),0))}var Pe=Is(),dn=L.string().regex(/^\d{4}-\d{2}-\d{2}$/),qt=L.number().int().min(0).max(1e10),oa=L.string().trim().min(1).max(120),js=L.object({account:L.string().trim().max(120).nullish(),
generated_on:dn.nullish(),period_from:dn,period_to:dn,gross_cents:qt,net_cents:qt,fee_cents:qt,tx_count:L.number().int().min(0).max(1e6),days:L.array(L.object({day:dn,gross_cents:qt,
net_cents:qt,tx_count:L.number().int().min(0).max(1e6)})).min(1).max(400),methods:L.array(L.object({label:oa,gross_cents:qt})).max(20).default([]),products:L.array(L.object({name:oa,
qty:L.number().min(0).max(1e6)})).max(300).default([]),categories:L.array(L.object({name:oa,qty:L.number().min(0).max(1e6)})).max(100).default([]),notes:L.array(L.string().trim().max(
300)).max(10).default([])}),No=L.object({file_name:L.string().trim().min(1).max(200),file_b64:L.string().min(10).max(7e6),mode:L.enum(["externa","conferencia"]),replace:L.boolean().
default(!1),report:js}),Ns=e=>e.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();function Ss(e){let a=Ns(e);return/debito/.test(a)?"debito":/credito|parcelad/.test(a)?"\
credito":/pix/.test(a)?"pix":/money|dinheiro|especie/.test(a)?"dinheiro":"outro"}function So(e){let a=[],t=(c,m,u)=>Math.abs(c-m)<=u;e.period_from>e.period_to&&a.push("per\xEDodo com data inicial depois da final"),(new Date(e.period_to)-new Date(e.period_from))/
864e5>400&&a.push("per\xEDodo maior que 400 dias");let n=new Set;for(let c of e.days)n.has(c.day)&&a.push(`dia ${c.day} repetido`),n.add(c.day),(c.day<e.period_from||c.day>e.period_to)&&
a.push(`dia ${c.day} fora do per\xEDodo do relat\xF3rio`),c.net_cents>c.gross_cents&&a.push(`dia ${c.day}: l\xEDquido maior que o bruto`);let o=Math.max(2,e.days.length),i=e.days.reduce(
(c,m)=>c+m.gross_cents,0),s=e.days.reduce((c,m)=>c+m.net_cents,0),r=e.days.reduce((c,m)=>c+m.tx_count,0);if(t(i,e.gross_cents,o)||a.push(`soma dos dias (${i/100}) diferente da rece\
ita bruta (${e.gross_cents/100})`),t(s,e.net_cents,o)||a.push(`soma dos dias (${s/100}) diferente da receita l\xEDquida (${e.net_cents/100})`),r!==e.tx_count&&a.push(`soma das tran\
sa\xE7\xF5es por dia (${r}) diferente do total (${e.tx_count})`),e.net_cents>e.gross_cents&&a.push("receita l\xEDquida maior que a bruta"),t(e.gross_cents-e.net_cents,e.fee_cents,2)||
a.push("taxas diferentes de bruto \u2212 l\xEDquido"),e.methods.length){let c=e.methods.reduce((m,u)=>m+u.gross_cents,0);t(c,e.gross_cents,Math.max(2,e.methods.length))||a.push(`so\
ma das formas de pagamento (${c/100}) diferente da receita bruta (${e.gross_cents/100})`)}return a}async function zo(e,a,t){if(!t.length)return[];let n=(await e.query(`select p.bus\
iness_date as day, p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total
      from payments p where p.company_id = $1 and p.status = 'confirmado' and p.business_date = any($2::date[])
        and p.method in ('debito','credito','pix','dinheiro') group by 1, 2`,[a,t.map(o=>o.day)])).rows;return t.map(o=>{let i=n.filter(r=>r.day===o.day),s=i.filter(r=>r.method!=="\
dinheiro").reduce((r,c)=>r+Number(c.total),0);return{day:o.day,report_gross_cents:o.gross_cents,report_tx:o.tx_count,rusten_card_pix_cents:s,rusten_cash_cents:i.filter(r=>r.method===
"dinheiro").reduce((r,c)=>r+Number(c.total),0),rusten_card_pix_count:i.filter(r=>r.method!=="dinheiro").reduce((r,c)=>r+c.n,0)}})}async function Co(e,a,t){return(await e.query(`sel\
ect i.id, i.file_name, i.period_from, i.period_to, i.mode, count(d.id)::int as days
      from pos_sales_days d join pos_sales_imports i on i.id = d.import_id
     where d.company_id = $1 and d.provider = 'infinitepay' and d.active and d.day = any($2::date[])
     group by i.id order by i.id`,[a,t.map(n=>n.day)])).rows}function qo(e){let a=ks.from(e,"base64");if(a.length<100||a.length>5*1024*1024)throw f("Arquivo vazio ou maior que 5 MB");
if(a.subarray(0,5).toString("latin1")!=="%PDF-")throw f("O arquivo n\xE3o \xE9 um PDF");return{buf:a,sha:vs.createHash("sha256").update(a).digest("hex")}}Pe.post("/preview",y("fina\
nceiro.visualizar"),p(async(e,a)=>{let t=w(No.omit({mode:!0,replace:!0}),e.body),{sha:n}=qo(t.file_b64),o=(await d("select id, created_at from pos_sales_imports where company_id = \
$1 and file_sha256 = $2 and status = 'ativo'",[e.ctx.companyId,n])).rows[0];a.json({problems:So(t.report),duplicate:o||null,overlaps:await Co({query:d},e.ctx.companyId,t.report.days),
reconciliation:await zo({query:d},e.ctx.companyId,t.report.days)})}));Pe.post("/",y("financeiro.visualizar"),p(async(e,a)=>{let t=w(No,e.body),n=t.report,o=So(n);if(o.length)throw f(
`O relat\xF3rio n\xE3o fecha: ${o.slice(0,3).join("; ")}`,"report_inconsistent");let{buf:i,sha:s}=qo(t.file_b64),r=await k(async c=>{await c.query("select pg_advisory_xact_lock(has\
htext('pos-sales:' || $1::text))",[e.ctx.companyId]);let m=(await c.query("select id from pos_sales_imports where company_id = $1 and file_sha256 = $2 and status = 'ativo'",[e.ctx.
companyId,s])).rows[0];if(m)throw b("Este relat\xF3rio j\xE1 foi importado","duplicate",{import_id:m.id});let u=await Co(c,e.ctx.companyId,n.days);if(u.length&&!t.replace)throw b("\
J\xE1 existe importa\xE7\xE3o ativa para parte destes dias","overlap",{overlaps:u});if(u.length&&!e.ctx.can("financeiro.estornar"))throw G('Substituir uma importa\xE7\xE3o exige a permis\
s\xE3o "Estornar pagamentos"');let l=n.methods.map(h=>({method:Ss(h.label),label:h.label,gross_cents:h.gross_cents})),_=(await c.query(`insert into pos_sales_imports (company_id, m\
ode, file_name, file_sha256, file_data, account_label, period_from, period_to, generated_on,
          gross_cents, net_cents, fee_cents, tx_count, methods, products, categories, notes, created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,[e.ctx.companyId,t.mode,t.file_name,s,i,n.account||null,n.period_from,n.period_to,n.generated_on||
null,n.gross_cents,n.net_cents,n.fee_cents,n.tx_count,JSON.stringify(l),JSON.stringify(n.products),JSON.stringify(n.categories),JSON.stringify(n.notes),e.ctx.userId])).rows[0];for(let h of u)
await Eo(c,e.ctx,h.id,`Substitu\xEDda pela importa\xE7\xE3o #${_.id}`),await g(c,e.ctx,"maquininha.importacao_substituida",{entity:"pos_sales_import",entityId:h.id,reason:`nova imp\
orta\xE7\xE3o #${_.id}`});for(let h of n.days)await c.query("insert into pos_sales_days (company_id, import_id, provider, day, gross_cents, net_cents, tx_count) values ($1,$2,$3,$4\
,$5,$6,$7)",[e.ctx.companyId,_.id,"infinitepay",h.day,h.gross_cents,h.net_cents,h.tx_count]);return await g(c,e.ctx,"maquininha.importada",{entity:"pos_sales_import",entityId:_.id,
data:{file:t.file_name,sha256:s,mode:t.mode,period:[n.period_from,n.period_to],gross_cents:n.gross_cents,net_cents:n.net_cents,tx_count:n.tx_count,replaced:u.map(h=>h.id)}}),{id:_.
id,replaced:u.map(h=>h.id)}});a.status(201).json(r)}));Pe.get("/",y("financeiro.visualizar"),p(async(e,a)=>{let t=(await d(`select i.id, i.mode, i.file_name, i.account_label, i.per\
iod_from, i.period_to, i.generated_on, i.gross_cents, i.net_cents, i.fee_cents, i.tx_count,
      i.methods, i.status, i.created_at, i.canceled_at, i.cancel_reason, u.name as user_name, cu.name as canceled_by_name
    from pos_sales_imports i left join users u on u.id = i.created_by left join users cu on cu.id = i.canceled_by
    where i.company_id = $1 order by i.period_to desc, i.id desc limit 100`,[e.ctx.companyId])).rows,n=t.filter(i=>i.status==="ativo"),o=(i,s)=>n.filter(r=>!s||r.mode===s).reduce((r,c)=>r+
Number(c[i]),0);a.json({items:t,totals:{gross_cents:o("gross_cents","externa"),net_cents:o("net_cents","externa"),fee_cents:o("fee_cents","externa"),tx_count:o("tx_count","externa")}})}));
Pe.get("/:id",y("financeiro.visualizar"),p(async(e,a)=>{let t=(await d(`select i.id, i.mode, i.file_name, i.file_sha256, i.account_label, i.period_from, i.period_to, i.generated_on\
, i.gross_cents, i.net_cents, i.fee_cents, i.tx_count,
      i.methods, i.products, i.categories, i.notes, i.status, i.created_at, i.canceled_at, i.cancel_reason, u.name as user_name
    from pos_sales_imports i left join users u on u.id = i.created_by where i.id = $1 and i.company_id = $2`,[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw v("Importa\xE7\
\xE3o n\xE3o encontrada");let n=(await d("select day, gross_cents, net_cents, tx_count, active from pos_sales_days where import_id = $1 order by day",[t.id])).rows;a.json({...t,days:n,
reconciliation:await zo({query:d},e.ctx.companyId,n)})}));Pe.get("/:id/file",y("financeiro.visualizar"),p(async(e,a)=>{let t=(await d("select file_name, file_data from pos_sales_im\
ports where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t?.file_data)throw v("Arquivo n\xE3o encontrado");a.setHeader("content-type","applicati\
on/pdf"),a.setHeader("content-disposition",`attachment; filename="${t.file_name.replace(/[^\w.\- ]/g,"_")}"`),a.send(t.file_data)}));async function Eo(e,a,t,n){await e.query("updat\
e pos_sales_days set active = false where import_id = $1",[t]),await e.query("update pos_sales_imports set status = 'cancelado', canceled_by = $2, canceled_at = now(), cancel_reaso\
n = $3 where id = $1",[t,a.userId,n]);let o=(await e.query("select id from pos_sales_items where import_id = $1 and status = 'baixado' for update",[t])).rows;for(let i of o){let s=(await e.
query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'pos_sales_item' and m.ref_id = $2 and m.kind = 'venda'
      and not exists (select 1 from stock_movements x where x.reverses_id = m.id)`,[a.companyId,i.id])).rows;for(let r of s)await e.query(`insert into stock_movements (company_id, \
stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
        values ($1,$2,'estorno_venda',$3,$4,'pos_sales_item_rev',$5,$6,$7,$8)`,[a.companyId,r.stock_item_id,-Number(r.qty),r.unit_cost_cents,i.id,r.id,`Importa\xE7\xE3o da maquininha can\
celada: ${n}`.slice(0,300),a.userId]);await e.query("update pos_sales_items set status = 'estornado' where id = $1",[i.id])}return o.length}var zs=new Set(["de","da","do","das","do\
s","e","com","sem","ml","l","lt","un","und","g","kg","a","o"]),J=e=>String(e||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/(\d)([a-z])/g,"$1 $2").replace(
/([a-z])(\d)/g,"$1 $2").replace(/[^a-z0-9]+/g," ").trim(),jo=e=>[...new Set(J(e).split(" ").filter(a=>a&&!zs.has(a)))];function Cs(e,a){if(Math.abs(e.length-a.length)>2)return 3;let t=Array.
from({length:e.length+1},(n,o)=>[o,...Array(a.length).fill(0)]);for(let n=1;n<=a.length;n++)t[0][n]=n;for(let n=1;n<=e.length;n++)for(let o=1;o<=a.length;o++)t[n][o]=Math.min(t[n-1][o]+
1,t[n][o-1]+1,t[n-1][o-1]+(e[n-1]===a[o-1]?0:1));return t[e.length][a.length]}var qs=(e,a)=>e===a||e.length>=4&&a.length>=4&&(e.startsWith(a)||a.startsWith(e))||Math.min(e.length,a.
length)>=5&&Cs(e,a)<=(Math.min(e.length,a.length)>=8?2:1);function Es(e,a){let t=jo(e),n=jo(a);if(!t.length||!n.length)return 0;let o=new Set,i=0;for(let s of t){let r=n.findIndex(
(c,m)=>!o.has(m)&&qs(s,c));r>=0&&(o.add(r),i++)}return 2*i/(t.length+n.length)}function Os(e,a){let t=null;for(let n of a){let o=J(n.name)===J(e)?1:Es(e,n.name);(!t||o>t.score)&&(t=
{product_id:n.id,name:n.name,score:Math.round(o*100)/100})}return t&&t.score>=.5?t:null}async function mn(e,a,t,n=!1){let o=(await e.query(`select id, status, mode, period_from, pe\
riod_to, products, categories from pos_sales_imports where id = $1 and company_id = $2${n?" for update":""}`,[Number(t),a.companyId])).rows[0];if(!o)throw v("Importa\xE7\xE3o n\xE3o encontr\
ada");return o}async function Ps(e,a,t){if((await e.query("select 1 from pos_sales_items where import_id = $1 limit 1",[t.id])).rows[0]||!t.products?.length)return;let o=(await e.query(
"select id, name from products where company_id = $1 and active",[a.companyId])).rows,i=Object.fromEntries((await e.query("select alias_norm, product_id from pos_product_aliases wh\
ere company_id = $1 and provider = 'infinitepay'",[a.companyId])).rows.filter(s=>o.some(r=>Number(r.id)===Number(s.product_id))).map(s=>[s.alias_norm,s.product_id]));for(let s of t.
products){if(!(Number(s.qty)>0))continue;let r=o.find(m=>J(m.name)===J(s.name)),c=i[J(s.name)]??r?.id??null;await e.query("insert into pos_sales_items (company_id, import_id, repor\
t_name, qty, product_id) values ($1,$2,$3,$4,$5)",[a.companyId,t.id,s.name,s.qty,c])}}async function un(e,a,t){let n=(await e.query(`select i.id, i.report_name, i.source, i.qty::fl\
oat as qty, i.product_id, i.status, i.posted_at, u.name as posted_by_name
      from pos_sales_items i left join users u on u.id = i.posted_by where i.import_id = $1 order by i.source desc, i.qty desc, i.id`,[t.id])).rows,o=(await e.query("select id, nam\
e, stock_mode, stock_item_id, cost_cents from products where company_id = $1 and active order by name",[a.companyId])).rows,i=Object.fromEntries(o.map(m=>[Number(m.id),m])),s=Object.
fromEntries((await e.query("select id, name, unit from stock_items where company_id = $1",[a.companyId])).rows.map(m=>[Number(m.id),m]));for(let m of n){let u=i[Number(m.product_id)];
if(m.product_name=u?.name||null,m.untracked=u?u.stock_mode==="nenhum":!1,!u&&m.status==="pendente"&&(m.suggestion=Os(m.report_name,o)),u){let l=await ft(e,a.companyId,u,m.qty,[]);m.
stock=[...l.entries()].map(([_,h])=>({stock_item_id:_,name:s[_]?.name,unit:s[_]?.unit,qty:Math.round(h*1e3)/1e3}))}(m.status==="baixado"||m.status==="estornado")&&(m.moved=(await e.
query(`select s.name, s.unit, -m.qty::float as qty from stock_movements m join stock_items s on s.id = m.stock_item_id
        where m.company_id = $1 and m.ref_type = 'pos_sales_item' and m.ref_id = $2 and m.kind = 'venda'`,[a.companyId,m.id])).rows)}let r=(t.products||[]).reduce((m,u)=>m+Number(u.
qty||0),0),c=(t.categories||[]).reduce((m,u)=>m+Number(u.qty||0),0);return{rows:n,products:o.map(m=>({id:m.id,name:m.name,stock_mode:m.stock_mode})),summary:{report_qty:r,categories_qty:c,
missing_qty:Math.max(0,c-r)},can_post:t.status==="ativo"&&t.mode==="externa",mode:t.mode,status:t.status,can_edit:a.can("estoque.ajustar"),can_create:a.can("estoque.ajustar")&&a.can(
"cardapio.gerenciar")}}Pe.get("/:id/items",y("financeiro.visualizar"),p(async(e,a)=>{let t=await k(async n=>{let o=await mn(n,e.ctx,e.params.id,!0);return o.status==="ativo"&&await Ps(
n,e.ctx,o),un(n,e.ctx,o)});a.json(t)}));Pe.put("/:id/items",y("financeiro.visualizar"),p(async(e,a)=>{Q(e.ctx,"estoque.ajustar");let t=w(L.object({rows:L.array(L.object({id:L.number().
int().optional(),report_name:L.string().trim().min(1).max(120).optional(),qty:L.number().positive().max(1e5),product_id:L.number().int().nullable(),ignored:L.boolean().default(!1)})).
max(400)}),e.body),n=await k(async o=>{let i=await mn(o,e.ctx,e.params.id,!0);if(i.status!=="ativo")throw b("Importa\xE7\xE3o cancelada");let s=[...new Set(t.rows.map(m=>m.product_id).
filter(Boolean))];if(s.length&&(await o.query("select count(*)::int as n from products where company_id = $1 and id = any($2)",[e.ctx.companyId,s])).rows[0].n!==s.length)throw f("P\
roduto inv\xE1lido");let r=(await o.query("select id, source, status from pos_sales_items where import_id = $1 for update",[i.id])).rows,c=new Set;for(let m of t.rows){let u=m.ignored?
"ignorado":"pendente";if(m.id){let l=r.find(_=>Number(_.id)===m.id);if(!l)throw f("Linha inv\xE1lida");if(c.add(m.id),l.status==="baixado"||l.status==="estornado")continue;await o.
query("update pos_sales_items set qty = $2, product_id = $3, status = $4 where id = $1",[m.id,m.qty,m.product_id,u])}else{if(!m.product_id)throw f("Escolha o produto da linha acres\
centada");let l=(await o.query("select name from products where id = $1",[m.product_id])).rows[0];await o.query("insert into pos_sales_items (company_id, import_id, report_name, so\
urce, qty, product_id, status) values ($1,$2,$3,'manual',$4,$5,$6)",[e.ctx.companyId,i.id,(m.report_name||l.name).slice(0,120),m.qty,m.product_id,u])}}for(let m of r)m.source==="ma\
nual"&&!c.has(Number(m.id))&&(m.status==="pendente"||m.status==="ignorado")&&await o.query("delete from pos_sales_items where id = $1",[m.id]);return un(o,e.ctx,i)});a.json(n)}));async function Oo(e,a,t){
let n=(await e.query("select id from stock_items where company_id = $1 and lower(name) = lower($2)",[a.companyId,t.name.slice(0,80)])).rows[0];return n||(n=(await e.query("insert i\
nto stock_items (company_id, name, unit, avg_cost_cents) values ($1,$2,'un',$3) returning id",[a.companyId,t.name.slice(0,80),Number(t.cost_cents)||0])).rows[0]),await e.query("upd\
ate products set stock_mode = 'acabado', stock_item_id = $3, updated_at = now() where id = $1 and company_id = $2",[t.id,a.companyId,n.id]),await g(e,a,"estoque.produtos_controlado\
s",{entity:"product",entityId:t.id,data:{origem:"maquininha",stock_item_id:n.id}}),n.id}Pe.post("/:id/items/create-products",y("financeiro.visualizar"),p(async(e,a)=>{Q(e.ctx,"esto\
que.ajustar"),Q(e.ctx,"cardapio.gerenciar");let t=w(L.object({rows:L.array(L.object({id:L.number().int(),name:L.string().trim().min(1).max(120),price_cents:L.number().int().min(0).
max(1e8).nullable().default(null)})).min(1).max(200)}),e.body),n=await k(async o=>{let i=await mn(o,e.ctx,e.params.id,!0);if(i.status!=="ativo")throw b("Importa\xE7\xE3o cancelada");
let s=(await o.query("select id from categories where company_id = $1 and name = 'Maquininha' and not demo",[e.ctx.companyId])).rows[0];s||(s=(await o.query("insert into categories\
 (company_id, name, sort) values ($1,'Maquininha',999) returning id",[e.ctx.companyId])).rows[0]);let r=[];for(let c of t.rows){let m=(await o.query("select id, status from pos_sal\
es_items where id = $1 and import_id = $2 for update",[c.id,i.id])).rows[0];if(!m||m.status!=="pendente")throw f("Linha inv\xE1lida ou j\xE1 lan\xE7ada");let u=(await o.query("sele\
ct id, name, cost_cents, stock_mode from products where company_id = $1 and lower(name) = lower($2) and active",[e.ctx.companyId,c.name])).rows[0];u||(u=(await o.query(`insert into\
 products (company_id, name, description, kind, unit, price_cents, cost_cents, category_id, active, channels)
            values ($1,$2,$3,'resale','un',$4,0,$5,true,'{pdv}') returning id, name, cost_cents, stock_mode`,[e.ctx.companyId,c.name,"Cadastrado pela importa\xE7\xE3o da maquininha: conf\
ira pre\xE7o, categoria e ficha t\xE9cnica.",c.price_cents??0,s.id])).rows[0],await o.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_i\
d) values ($1,$2,null,$3,$4)",[e.ctx.companyId,u.id,c.price_cents??0,e.ctx.userId]),await g(o,e.ctx,"produto.criado",{entity:"product",entityId:u.id,data:{name:c.name,price_cents:c.
price_cents??0,origem:"maquininha"}}),r.push(c.name)),u.stock_mode==="nenhum"&&await Oo(o,e.ctx,u),await o.query("update pos_sales_items set product_id = $2 where id = $1",[c.id,u.
id])}return{created:r,view:await un(o,e.ctx,i)}});a.status(201).json(n)}));Pe.post("/:id/items/post",y("financeiro.visualizar"),p(async(e,a)=>{Q(e.ctx,"estoque.ajustar");let t=w(L.
object({control_untracked:L.boolean().default(!1)}),e.body||{}),n=await k(async o=>{let i=await mn(o,e.ctx,e.params.id,!0);if(i.status!=="ativo")throw b("Importa\xE7\xE3o cancelada");
if(i.mode!=="externa")throw b("Esta importa\xE7\xE3o \xE9 s\xF3 de confer\xEAncia: as vendas j\xE1 baixaram o estoque pelas comandas","conference_only");let s=(await o.query("selec\
t * from pos_sales_items where import_id = $1 and status = 'pendente' order by id for update",[i.id])).rows,r=s.filter(q=>!q.product_id);if(r.length)throw f(`Escolha o produto (ou \
marque "ignorar") para: ${r.slice(0,5).map(q=>q.report_name).join(", ")}`,"unmapped");if(!s.length)throw f("Nada pendente para lan\xE7ar");let c=[];if(t.control_untracked){let q=(await o.
query("select id, name, cost_cents from products where company_id = $1 and id = any($2) and stock_mode = 'nenhum' for update",[e.ctx.companyId,[...new Set(s.map(E=>Number(E.product_id)))]])).
rows;for(let E of q)await Oo(o,e.ctx,E);c=q.map(E=>E.name)}let m=(await o.query("select settings from companies where id = $1",[e.ctx.companyId])).rows[0],u=Le(m.settings),l=`${String(
i.period_from).split("-").reverse().join("/")} a ${String(i.period_to).split("-").reverse().join("/")}`,_=[],h=new Map;for(let q of s){let E=(await o.query("select id, name, stock_\
mode, stock_item_id, cost_cents from products where id = $1 and company_id = $2",[q.product_id,e.ctx.companyId])).rows[0],W=await ft(o,e.ctx.companyId,E,Number(q.qty),[]);_.push({r:q,
p:E,need:W});for(let[Y,U]of W)h.set(Y,(h.get(Y)||0)+U)}let $=[...h.keys()],N=$.length?(await o.query("select id, name, unit, avg_cost_cents from stock_items where company_id = $1 a\
nd id = any($2) order by id for update",[e.ctx.companyId,$])).rows:[];if(!u.allow_negative&&$.length){let q=await Qe(o,e.ctx.companyId,$),E=N.filter(W=>(q[W.id]||0)-h.get(Number(W.
id))<-1e-4);if(E.length)throw b(`Estoque insuficiente: ${E.map(W=>`${W.name} (saldo ${(q[W.id]||0).toLocaleString("pt-BR")} ${W.unit})`).join(", ")}. Lance a entrada antes ou permi\
ta estoque negativo.`,"stock_insufficient")}let P=Object.fromEntries(N.map(q=>[Number(q.id),q.avg_cost_cents])),T=0;for(let{r:q,p:E,need:W}of _){for(let[Y,U]of W){let H=await o.query(
`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
          values ($1,$2,'venda',$3,$4,'pos_sales_item',$5,$6,$7) on conflict do nothing returning id`,[e.ctx.companyId,Y,-U,P[Y],q.id,`Venda na maquininha (${l}): ${q.report_name} \
\xD7 ${Number(q.qty).toLocaleString("pt-BR")}`.slice(0,300),e.ctx.userId]);T+=H.rowCount}await o.query("update pos_sales_items set status = 'baixado', posted_at = now(), posted_by \
= $2 where id = $1",[q.id,e.ctx.userId]),q.source==="relatorio"&&await o.query(`insert into pos_product_aliases (company_id, provider, alias_norm, product_id) values ($1,'infinitep\
ay',$2,$3)
          on conflict (company_id, provider, alias_norm) do update set product_id = excluded.product_id, updated_at = now()`,[e.ctx.companyId,J(q.report_name),E.id])}return await g(
o,e.ctx,"maquininha.estoque_baixado",{entity:"pos_sales_import",entityId:i.id,data:{rows:s.length,movements:T,controlled:c,items:_.map(({r:q,p:E})=>({report:q.report_name,product:E.
name,qty:Number(q.qty)}))}}),{posted:s.length,movements:T,controlled:c,without_stock:_.filter(q=>!q.need.size).map(q=>q.p.name),view:await un(o,e.ctx,i)}});a.json(n)}));Pe.post("/:\
id/cancel",y("financeiro.estornar"),p(async(e,a)=>{let t=w(L.object({reason:L.string().trim().min(5,"informe o motivo (m\xEDnimo 5 caracteres)").max(200)}),e.body);await k(async n=>{
let o=(await n.query("select id, status from pos_sales_imports where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw v("Importa\xE7\
\xE3o n\xE3o encontrada");if(o.status!=="ativo")throw b("Importa\xE7\xE3o j\xE1 cancelada");let i=await Eo(n,e.ctx,o.id,t.reason);await g(n,e.ctx,"maquininha.importacao_cancelada",
{entity:"pos_sales_import",entityId:o.id,reason:t.reason,data:{stock_reversed_rows:i}})}),a.json({ok:!0})}));import As from"node:crypto";var Ts=()=>(R.INFINITEPAY_API_URL||"https://api.checkout.infinitepay.io").replace(/\/+$/,""),Et=e=>({enabled:!1,handle:"",...e?.infinitepay||{}}),ln=e=>String(e||"").trim().replace(
/^\$/,"").toLowerCase(),Rs=e=>e==="pix"?"pix":"credito";async function Po(e,a,t=12e3){let n;try{n=await fetch(`${Ts()}${e}`,{method:"POST",headers:{"content-type":"application/json",
accept:"application/json"},body:JSON.stringify(a),signal:AbortSignal.timeout(t)})}catch{throw new z(503,"A InfinitePay n\xE3o respondeu. Tente de novo em instantes ou receba de outra \
forma.","infinitepay_unavailable")}let o=await n.text(),i=null;try{i=o?JSON.parse(o):{}}catch{i={raw:o.slice(0,300)}}if(!n.ok){let s=i?.message||i?.error||i?.errors?.[0]?.message||
`erro ${n.status}`;throw new z(502,`InfinitePay recusou: ${String(s).slice(0,160)}`,"infinitepay_error",{status:n.status})}return i}async function Ao({handle:e,amount:a,description:t,
orderNsu:n,webhookUrl:o,redirectUrl:i,customer:s}){let r={handle:e,items:[{quantity:1,price:a,description:t.slice(0,120)}],order_nsu:n};o&&(r.webhook_url=o),i&&(r.redirect_url=i),s&&
(s.name||s.email||s.phone_number)&&(r.customer=s);let c=await Po("/links",r),m=c?.url||c?.link||c?.checkout_url||c?.data?.url||(typeof c?.raw=="string"&&/^https?:\/\//.test(c.raw)?
c.raw:null);if(!m)throw new z(502,"A InfinitePay n\xE3o devolveu o link de pagamento.","infinitepay_error");return{url:m,raw:c}}async function Ds({handle:e,orderNsu:a,transactionNsu:t,
slug:n}){return Po("/payment_check",{handle:e,order_nsu:a,transaction_nsu:t,slug:n},8e3)}var To=e=>`RST${e}-${Date.now().toString(36)}-${As.randomBytes(3).toString("hex")}`.toUpperCase();
async function et(e,a,t,n,o=!0){await e.query("insert into infinitepay_events (company_id, charge_id, kind, ok, payload) values ($1,$2,$3,$4,$5)",[a.company_id,a.id,t,o,JSON.stringify(
n??{})]).catch(()=>{})}async function Ot(e,a,t,n,o=Ds){return e(async i=>{let s=(await i.query("select * from infinitepay_charges where id = $1 for update",[a])).rows[0];if(!s)throw new z(
404,"Cobran\xE7a n\xE3o encontrada");if(s.status==="pago"||s.status==="divergente")return s;let r=(await i.query("select settings, timezone from companies where id = $1",[s.company_id])).
rows[0],c=Et(r.settings),m=String(t.transaction_nsu||s.transaction_nsu||"").slice(0,120),u=String(t.invoice_slug||t.slug||s.invoice_slug||"").slice(0,120);if(!m||!u)return await et(
i,s,n,{motivo:"sem transaction_nsu/slug",info:t},!1),s;let l;try{l=await o({handle:c.handle,orderNsu:s.order_nsu,transactionNsu:m,slug:u})}catch(Y){throw await et(i,s,"consulta",{erro:Y.
message},!1),Y}if(await et(i,s,"consulta",l,!!l?.paid),await i.query("update infinitepay_charges set transaction_nsu = $2, invoice_slug = $3 where id = $1",[s.id,m,u]),!l?.success||
!l?.paid)return{...s,transaction_nsu:m,invoice_slug:u};let _=Number(l.amount??s.amount_cents),h=Rs(l.capture_method||t.capture_method),$={capture_method:l.capture_method||t.capture_method||
null,installments:l.installments??null,paid_amount_cents:l.paid_amount??null,receipt_url:String(t.receipt_url||s.receipt_url||"").slice(0,500)||null},N={companyId:s.company_id,userId:s.
created_by};if(_!==Number(s.amount_cents)){let Y=(await i.query(`update infinitepay_charges set status = 'divergente', capture_method = $2, installments = $3, paid_amount_cents = $\
4, receipt_url = $5,
          paid_at = now(), confirmed_by = $6, note = $7 where id = $1 returning *`,[s.id,$.capture_method,$.installments,$.paid_amount_cents,$.receipt_url,n,`Valor pago (${_}) dife\
rente do cobrado (${s.amount_cents})`])).rows[0];return await g(i,N,"infinitepay.divergente",{entity:"infinitepay",entityId:s.id,data:{cobrado:Number(s.amount_cents),pago:_}}),Y}let P=null,
T=null,q=s.session_id?(await i.query("select * from consumption_sessions where id = $1 for update",[s.session_id])).rows[0]:null;if(q&&["aberta","em_fechamento"].includes(q.status)){
let Y=await K(i,q.id);if(_<=Y.balance){let U=(await i.query("select day_cutoff from units where id = $1",[q.unit_id])).rows[0];P=(await i.query(`insert into payments (company_id, s\
ession_id, cash_session_id, method, amount_cents, source, business_date, idempotency_key, user_id)
            values ($1,$2,$3,$4,$5,'integracao',$6,$7,$8) on conflict (company_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key returning id`,[s.company_id,
q.id,s.cash_session_id,h,_,Ne(new Date,r.timezone,U?.day_cutoff??5),`ip-${s.order_nsu}`.slice(0,80),s.created_by])).rows[0].id,await i.query("update consumption_sessions set versio\
n = version + 1 where id = $1",[q.id])}else T="Pago, mas o saldo da comanda j\xE1 era menor: confira e devolva a diferen\xE7a pelo app da InfinitePay."}else s.session_id&&(T="Pago \
depois que a comanda foi encerrada ou cancelada: confira.");let E=P||!s.session_id?"pago":"divergente",W=(await i.query(`update infinitepay_charges set status = $2, capture_method \
= $3, installments = $4, paid_amount_cents = $5, receipt_url = $6,
        payment_id = $7, paid_at = now(), confirmed_by = $8, note = $9 where id = $1 returning *`,[s.id,E,$.capture_method,$.installments,$.paid_amount_cents,$.receipt_url,P,n,T])).
rows[0];return await g(i,N,E==="pago"?"infinitepay.pago":"infinitepay.divergente",{entity:"infinitepay",entityId:s.id,data:{comanda:s.session_id,valor_cents:_,forma:$.capture_method,
parcelas:$.installments,pagamento:P,origem:n}}),W})}var ue=Ms();ue.get("/categories",y("cardapio.visualizar"),p(async(e,a)=>{a.json((await d("select id, name, sort, active, demo from categories where company_id = $1 order by sort, n\
ame",[e.ctx.companyId])).rows)}));ue.post("/categories",y("cardapio.gerenciar"),p(async(e,a)=>{let t=w(S.object({name:S.string().trim().min(1).max(80),sort:S.number().int().default(
0)}),e.body),n=await d("insert into categories (company_id, name, sort) values ($1,$2,$3) returning id",[e.ctx.companyId,t.name,t.sort]);a.status(201).json({id:n.rows[0].id})}));ue.
put("/categories/:id",y("cardapio.gerenciar"),p(async(e,a)=>{let t=w(S.object({name:S.string().trim().min(1).max(80),sort:S.number().int(),active:S.boolean()}).partial(),e.body);if(!(await d(
"update categories set name = coalesce($3,name), sort = coalesce($4,sort), active = coalesce($5,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,
t.name??null,t.sort??null,t.active??null])).rows[0])throw v();a.json({ok:!0})}));ue.get("/sectors",p(async(e,a)=>{a.json((await d("select id, name, active from production_sectors w\
here company_id = $1 order by id",[e.ctx.companyId])).rows)}));ue.post("/sectors",y("cardapio.gerenciar"),p(async(e,a)=>{let t=w(S.object({name:S.string().trim().min(2).max(60)}),e.
body),n=await d("insert into production_sectors (company_id, name) values ($1,$2) returning id",[e.ctx.companyId,t.name]);a.status(201).json({id:n.rows[0].id})}));ue.get("/products",
y("cardapio.visualizar"),p(async(e,a)=>{let t=[e.ctx.companyId],n="p.company_id = $1";e.query.active!=="all"&&(n+=" and p.active"),e.query.q&&(t.push(`%${String(e.query.q).slice(0,
60)}%`,yt(e.query.q)),n+=` and (p.name ilike $${t.length-1} or p.sku = $${t.length} or exists (select 1 from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO'\
 and s.entity_id = p.id and s.code = $${t.length}))`),e.query.category_id&&(t.push(Number(e.query.category_id)),n+=` and p.category_id = $${t.length}`);let o=e.ctx.can("relatorios.\
cmv")||e.ctx.can("cardapio.gerenciar"),{rows:i}=await d(`select p.id, p.name, p.description, p.sku, p.kind, p.unit, p.price_cents, ${o?"p.cost_cents,":""} p.favorite, p.active, p.d\
emo,
            p.category_id, p.sector_id, p.channels, p.allergens,
            case when p.photo is not null then floor(extract(epoch from coalesce(p.photo_updated_at, p.updated_at)))::bigint end as photo_v,
            coalesce((select array_agg(s.code order by s.id) from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.entity_id = p.id), '{}') as codes,
            coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
               'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                             from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id)
               from modifier_groups g where g.product_id = p.id), '[]') as groups
       from products p where ${n} order by p.favorite desc, p.name limit 500`,t);a.json(i)}));var Do=S.object({name:S.string().trim().min(1).max(120),description:S.string().max(500).
nullable().optional(),sku:S.string().trim().max(40).nullable().optional(),kind:S.enum(["resale","recipe","produced","combo","addon","weight"]).default("resale"),unit:S.enum(["un","\
kg","g","L","ml"]).default("un"),price_cents:S.number().int().min(0).max(1e8),cost_cents:S.number().int().min(0).max(1e8).default(0),category_id:S.number().int().nullable().optional(),
sector_id:S.number().int().nullable().optional(),favorite:S.boolean().default(!1),active:S.boolean().default(!0),channels:S.array(S.enum(["pdv","delivery","cardapio_digital"])).default(
["pdv"]),allergens:S.string().max(500).nullable().optional(),codes:S.array(S.string().max(128)).max(20).default([]),groups:S.array(S.object({name:S.string().trim().min(1).max(60),min:S.
number().int().min(0).max(20),max:S.number().int().min(1).max(20),options:S.array(S.object({name:S.string().trim().min(1).max(60),price_cents:S.number().int().min(0).max(1e6)})).min(
1).max(40)})).max(10).optional()});async function Mo(e,a,t){if(t.category_id&&!(await e.query("select 1 from categories where id = $1 and company_id = $2",[t.category_id,a])).rows[0])
throw f("Categoria inv\xE1lida");if(t.sector_id&&!(await e.query("select 1 from production_sectors where id = $1 and company_id = $2",[t.sector_id,a])).rows[0])throw f("Setor inv\xE1l\
ido");if(t.kind==="weight"&&t.unit==="un")throw f("Produto por peso precisa de unidade kg ou g");for(let n of t.groups||[])if(n.min>n.max)throw f(`Grupo ${n.name}: m\xEDnimo maior que\
 m\xE1ximo`)}async function Lo(e,a,t,n){if(!n)return;await e.query("delete from modifier_groups where product_id = $1 and company_id = $2",[t,a]);let o=0;for(let i of n){let s=await e.
query("insert into modifier_groups (company_id, product_id, name, min_select, max_select, sort) values ($1,$2,$3,$4,$5,$6) returning id",[a,t,i.name,i.min,i.max,o++]);for(let r of i.
options)await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)",[a,s.rows[0].id,r.name,r.price_cents])}}ue.post("/products",y("c\
ardapio.gerenciar"),p(async(e,a)=>{let t=w(Do,e.body),n=await k(async o=>{await Mo(o,e.ctx.companyId,t);let s=(await o.query(`insert into products (company_id, name, description, s\
ku, kind, unit, price_cents, cost_cents, category_id, sector_id, favorite, active, channels, allergens)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,[e.ctx.companyId,t.name,t.description??null,t.sku||null,t.kind,t.unit,t.price_cents,t.cost_cents,t.category_id??
null,t.sector_id??null,t.favorite,t.active,t.channels,t.allergens??null])).rows[0].id;for(let r of t.codes)await rt(o,e.ctx.companyId,r,"PRODUTO",s);return await Lo(o,e.ctx.companyId,
s,t.groups),await o.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)",[e.ctx.companyId,s,t.price_cents,e.ctx.
userId]),await g(o,e.ctx,"produto.criado",{entity:"product",entityId:s,data:{name:t.name,price_cents:t.price_cents}}),s}).catch(o=>{throw o.code==="23505"?b("SKU j\xE1 usado em outro \
produto"):o});a.status(201).json({id:n})}));ue.put("/products/:id",y("cardapio.gerenciar"),p(async(e,a)=>{let t=Number(e.params.id),n=w(Do.partial(),e.body);for(let o of Object.keys(
n))Object.prototype.hasOwnProperty.call(e.body||{},o)||delete n[o];await k(async o=>{let i=(await o.query("select * from products where id = $1 and company_id = $2 for update",[t,e.
ctx.companyId])).rows[0];if(!i)throw v("Produto n\xE3o encontrado");await Mo(o,e.ctx.companyId,{...i,...n});let s={...i,...n};if(await o.query(`update products set name=$3, descrip\
tion=$4, sku=$5, kind=$6, unit=$7, price_cents=$8, cost_cents=$9, category_id=$10, sector_id=$11,
         favorite=$12, active=$13, channels=$14, allergens=$15, updated_at=now() where id=$1 and company_id=$2`,[t,e.ctx.companyId,s.name,s.description,s.sku||null,s.kind,s.unit,s.
price_cents,s.cost_cents,s.category_id,s.sector_id,s.favorite,s.active,s.channels,s.allergens]),n.price_cents!=null&&n.price_cents!==i.price_cents&&(await o.query("insert into prod\
uct_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,t,i.price_cents,n.price_cents,e.ctx.userId]),await g(o,e.ctx,"pr\
oduto.preco",{entity:"product",entityId:t,data:{before:i.price_cents,after:n.price_cents}})),n.codes){let r=n.codes.map(yt).filter(Boolean);await o.query("delete from scan_codes wh\
ere company_id = $1 and entity = 'PRODUTO' and entity_id = $2 and not (code = any($3))",[e.ctx.companyId,t,r]);for(let c of r)await rt(o,e.ctx.companyId,c,"PRODUTO",t)}await Lo(o,e.
ctx.companyId,t,n.groups),await g(o,e.ctx,"produto.alterado",{entity:"product",entityId:t,data:{...n,groups:n.groups?"alterados":void 0}})}).catch(o=>{throw o.code==="23505"?b("SKU\
 j\xE1 usado em outro produto"):o}),a.json({ok:!0})}));function Ls(e){let a=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(e||""));if(!a)throw f("Envie um\
a imagem JPG, PNG ou WebP");let t=Buffer.from(a[2],"base64");if(t.length>300*1024)throw f("Imagem grande demais (m\xE1x. 300 KB). Use uma foto menor.");let n=t.subarray(0,4).toString(
"hex");if(!{"image/png":n.startsWith("89504e47"),"image/jpeg":n.startsWith("ffd8"),"image/webp":t.subarray(8,12).toString()==="WEBP"}[a[1]])throw f("O conte\xFAdo do arquivo n\xE3o \xE9 uma\
 imagem v\xE1lida");return{mime:a[1],buf:t}}ue.put("/products/:id/photo",y("cardapio.gerenciar"),p(async(e,a)=>{let t=Number(e.params.id);if(Ls(e.body?.data_url),!(await d("update \
products set photo = $3, photo_updated_at = now() where id = $1 and company_id = $2 returning id",[t,e.ctx.companyId,e.body.data_url])).rowCount)throw v("Produto n\xE3o encontrado");
await g({query:d},e.ctx,"produto.foto",{entity:"product",entityId:t,data:{size:e.body.data_url.length}}),a.json({ok:!0})}));ue.delete("/products/:id/photo",y("cardapio.gerenciar"),
p(async(e,a)=>{let t=Number(e.params.id);if(!(await d("update products set photo = null, photo_updated_at = now() where id = $1 and company_id = $2 returning id",[t,e.ctx.companyId])).
rowCount)throw v("Produto n\xE3o encontrado");await g({query:d},e.ctx,"produto.foto_removida",{entity:"product",entityId:t}),a.json({ok:!0})}));ue.get("/products/:id/photo",y("card\
apio.visualizar"),p(async(e,a)=>{let t=(await d("select photo from products where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];a.json({data_url:t?.photo||
null})}));ue.get("/products/:id/prices",y("cardapio.visualizar"),p(async(e,a)=>{a.json((await d(`select h.old_cents, h.new_cents, h.created_at, u.name as user_name from product_pri\
ce_history h left join users u on u.id = h.user_id
                      where h.product_id = $1 and h.company_id = $2 order by h.id desc`,[Number(e.params.id),e.ctx.companyId])).rows)}));ue.post("/import/infinitepay/fetch",y("card\
apio.gerenciar"),p(async(e,a)=>{let t=w(S.object({handle:S.string().trim().max(80).optional()}),e.body),n=String(t.handle||"").trim(),o=n.match(/infinitepay\.io\/(?:llms\/)?([^/?#\s]+)/i),
i=ln(o?o[1].replace(/\.md$/i,""):n);if(i||(i=Et((await d("select settings from companies where id = $1",[e.ctx.companyId])).rows[0]?.settings).handle||""),!xo(i))throw f("Informe a\
 InfiniteTag da loja (o endere\xE7o loja.infinitepay.io/SUA-TAG), sem o $");await ae(`menu-import:${e.ctx.companyId}`,20,600);let s;try{s=await ko(i)}catch(r){throw new z(502,r.upstream?
`A InfinitePay n\xE3o respondeu agora (c\xF3digo ${r.upstream}). Tente de novo em alguns minutos.`:"N\xE3o foi poss\xEDvel ler a loja da InfinitePay agora. Tente de novo em alguns minuto\
s.","upstream")}if(!s)throw v(`N\xE3o encontrei a loja loja.infinitepay.io/${i}. Confira a InfiniteTag e se a Loja Online est\xE1 publicada no app da InfinitePay.`);if(!s.products.
length)throw f("A loja foi encontrada, mas n\xE3o tem produtos publicados.");a.json({handle:i,...s})}));var Us=S.object({name:S.string().trim().min(1).max(120),category:S.string().
trim().max(80).nullable().optional(),price_cents:S.number().int().min(0).max(1e8),cost_cents:S.number().int().min(0).max(1e8).nullable().optional(),sku:S.string().trim().max(40).nullable().
optional(),codes:S.array(S.string().trim().max(128)).max(10).default([]),unit:S.enum(["un","kg","g","L","ml"]).nullable().optional(),sector:S.string().trim().max(60).nullable().optional(),
description:S.string().max(500).nullable().optional(),available:S.boolean().default(!0),line:S.number().int().positive().optional()}),Fs=S.object({source:S.enum(["infinitepay","pla\
nilha","arquivo"]).default("infinitepay"),dry_run:S.boolean().default(!1),items:S.array(Us).min(1).max(3e3),categories:S.array(S.string().trim().min(1).max(80)).max(300).default([]),
category_map:S.record(S.string(),S.union([S.object({category_id:S.number().int()}),S.object({create:S.literal(!0)})])).default({}),category_sectors:S.record(S.string(),S.number().int().
nullable()).default({}),update_prices:S.boolean().default(!0),update_costs:S.boolean().default(!0),update_categories:S.boolean().default(!0),inactive_unavailable:S.boolean().default(
!0)}),Bs=[[/\b(chop+e?s?|cervejas?|drinks?|doses?|bebidas?|caipirinhas?|coqueteis|vinhos?|destilados?|whisky|gin|bar|garrafas?)\b/,"bar"],[/\b(cozinha|porcoes|porcao|petiscos?|lanches?|pratos?|comidas?|refeicoes|executivos?|burgers?|hamburgueres|pizzas?|sobremesas?|entradas?|tira gostos?|espetos?|caldos?)\b/,
"cozinha"]];async function Ro(e,a,t){let n=t.source!=="infinitepay",o=(await e.query("select id, name, sort, active from categories where company_id = $1 order by id",[a])).rows,i=(await e.
query("select id, name, sku, price_cents, cost_cents, category_id, sector_id, active, demo from products where company_id = $1 order by active desc, demo, id",[a])).rows,s=(await e.
query("select id, name from production_sectors where company_id = $1 and active order by id",[a])).rows,r=(await e.query("select alias_norm, product_id from pos_product_aliases whe\
re company_id = $1 and provider = 'infinitepay'",[a])).rows,c=new Map((await e.query("select code, entity, entity_id from scan_codes where company_id = $1",[a])).rows.map(I=>[I.code,
I])),m=new Map;for(let I of o)m.has(J(I.name))||m.set(J(I.name),I);let u=new Map;for(let I of i)u.has(J(I.name))||u.set(J(I.name),I);for(let I of r){let B=i.find(oe=>Number(oe.id)===
Number(I.product_id));B&&!u.has(I.alias_norm)&&u.set(I.alias_norm,B)}let l=new Map(i.filter(I=>I.sku).map(I=>[String(I.sku).toLowerCase(),I])),_=o.reduce((I,B)=>Math.max(I,B.sort),
-1),h=[];for(let I of[...t.categories,...t.items.map(B=>B.category).filter(Boolean)])h.some(B=>J(B)===J(I))||h.push(I);let $=I=>{for(let[B,oe]of Object.entries(t.category_map))if(J(
B)===J(I))return oe;return null},N=null,P=[],T=h.map((I,B)=>{let oe=$(I),Z=oe&&oe.category_id?o.find(F=>Number(F.id)===Number(oe.category_id))||null:m.get(J(I));oe&&oe.category_id&&
!Z&&(Z=null),!Z&&n&&!oe&&P.push(I);let ne={};if(Z)for(let F of i)Number(F.category_id)===Number(Z.id)&&F.sector_id&&(ne[F.sector_id]=(ne[F.sector_id]||0)+1);let ot=Object.entries(ne).
sort((F,Tt)=>Tt[1]-F[1])[0]?.[0],pt=J(I).split(" "),Re=s.find(F=>pt.includes(J(F.name))||J(F.name)===J(I))||(Bs.some(([F,Tt])=>F.test(J(I))&&(N=s.find(Pn=>J(Pn.name)===Tt)))?N:null),
bt=ot?Number(ot):Re?Number(Re.id):null,Me=Object.prototype.hasOwnProperty.call(t.category_sectors,I)?t.category_sectors[I]:bt,_e=Me&&s.some(F=>Number(F.id)===Number(Me))?Number(Me):
null,me=[];Z&&!Z.active&&me.push("reativar"),Z&&!n&&Z.name!==I&&me.push("renomear"),Z&&!n&&Z.sort!==B&&me.push("ordem");let ye=!!(oe&&oe.category_id&&Z);return{name:I,id:Z?Number(Z.
id):null,current_name:Z?.name??null,mapped:ye,action:Z?me.length?"atualizar":"igual":"criar",changes:me,sort:!Z&&n?_+1+B:B,sector_id:_e}}),q=I=>I?T.find(B=>J(B.name)===J(I)):null,E=I=>I?
s.find(B=>J(B.name)===J(I)):null,W=new Set,Y=new Set,U=new Set,H=t.items.map(I=>{let B=J(I.name);if(!B)return{...I,action:"ignorar",reason:"nome vazio"};if(W.has(B))return{...I,action:"\
ignorar",reason:"repetido no arquivo"};W.add(B);let oe=[],Z=I.sku?String(I.sku).toLowerCase():null,ne=Z&&l.get(Z)||u.get(B)||null,ot=I.sku||null;Z&&(Y.has(Z)||l.get(Z)&&ne&&l.get(Z).
id!==ne.id)&&(ot=null,oe.push("c\xF3digo repetido: entra sem c\xF3digo")),Z&&Y.add(Z);let pt=[];for(let me of I.codes||[]){let ye=yt(me);if(!ye||/^0+$/.test(ye))continue;if(U.has(ye)){
oe.push(`c\xF3digo de barras ${ye} repetido na planilha`);continue}let F=c.get(ye);if(F&&!(F.entity==="PRODUTO"&&ne&&Number(F.entity_id)===Number(ne.id))){oe.push(`c\xF3digo de barras\
 ${ye} j\xE1 usado`);continue}U.add(ye),pt.push(ye)}let Re=q(I.category),bt=E(I.sector),Me={...I,sku:ot,codes:pt,category_resolved:Re?Re.current_name||Re.name:null,warnings:oe};if(!ne)
return{...Me,action:"criar",product_id:null,sector_id:bt?Number(bt.id):Re?.sector_id??null,active:I.available||!t.inactive_unavailable};let _e=[];return t.update_prices&&ne.price_cents!==
I.price_cents&&_e.push("preco"),n&&t.update_costs&&I.cost_cents!=null&&ne.cost_cents!==I.cost_cents&&_e.push("custo"),t.update_categories&&Re&&Number(ne.category_id)!==Re.id&&_e.push(
"categoria"),!ne.active&&I.available&&_e.push("reativar"),n&&ne.active&&!I.available&&t.inactive_unavailable&&_e.push("pausar"),ot&&!ne.sku&&_e.push("codigo"),pt.some(me=>!c.has(me))&&
_e.push("codigo_barras"),{...Me,action:_e.length?"atualizar":"igual",changes:_e,product_id:Number(ne.id),current_name:ne.name,current_price_cents:ne.price_cents,current_cost_cents:ne.
cost_cents,current_sku:ne.sku,demo:ne.demo}}),de=I=>H.filter(B=>B.action===I).length;return{categories:T,items:H,sectors:s,unresolved:P,existing_categories:o.filter(I=>I.active).map(
I=>({id:Number(I.id),name:I.name})),summary:{criar:de("criar"),atualizar:de("atualizar"),igual:de("igual"),ignorar:de("ignorar"),categorias_criar:T.filter(I=>I.action==="criar").length,
categorias_atualizar:T.filter(I=>I.action==="atualizar").length}}}ue.post("/import",y("cardapio.gerenciar"),p(async(e,a)=>{let t=w(Fs,e.body);if(t.dry_run){a.json(await Ro({query:d},
e.ctx.companyId,t));return}let n=await k(async o=>{await o.query("select id from companies where id = $1 for update",[e.ctx.companyId]);let i=await Ro(o,e.ctx.companyId,t);if(i.unresolved.
length)throw f(`Indique a categoria de: ${i.unresolved.slice(0,5).join(", ")}${i.unresolved.length>5?"\u2026":""}`,"category_unresolved");for(let l of i.categories)if(l.action==="c\
riar"){let _=await o.query("insert into categories (company_id, name, sort) values ($1,$2,$3) returning id",[e.ctx.companyId,l.name,l.sort]);l.id=Number(_.rows[0].id)}else l.action===
"atualizar"&&(t.source==="infinitepay"?await o.query("update categories set name = $3, sort = $4, active = true where id = $1 and company_id = $2",[l.id,e.ctx.companyId,l.name,l.sort]):
await o.query("update categories set active = true where id = $1 and company_id = $2",[l.id,e.ctx.companyId]));let s=l=>l?i.categories.find(_=>J(_.name)===J(l)):null,r=0,c=0,m=0;for(let l of i.
items){let _=s(l.category);if(l.action==="criar"){let h=await o.query(`insert into products (company_id, name, sku, description, kind, unit, price_cents, cost_cents, category_id, s\
ector_id, active, channels)
           values ($1,$2,$3,$4,'resale',$5,$6,$7,$8,$9,$10,'{pdv}') returning id`,[e.ctx.companyId,l.name,l.sku||null,l.description||null,l.unit||"un",l.price_cents,l.cost_cents??0,
_?.id??null,l.sector_id??null,l.active]);l.product_id=Number(h.rows[0].id),await o.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) \
values ($1,$2,null,$3,$4)",[e.ctx.companyId,l.product_id,l.price_cents,e.ctx.userId]),r++}else if(l.action==="atualizar"){let h=$=>l.changes.includes($);await o.query(`update produ\
cts set price_cents = case when $3 then $4 else price_cents end, category_id = case when $5 then $6 else category_id end,
                          cost_cents = case when $8 then $9 else cost_cents end, sku = case when $10 then $11 else sku end,
                          active = case when $7 then true when $12 then false else active end, updated_at = now() where id = $1 and company_id = $2`,[l.product_id,e.ctx.companyId,h(
"preco"),l.price_cents,h("categoria"),_?.id??null,h("reativar"),h("custo"),l.cost_cents??0,h("codigo"),l.sku||null,h("pausar")]),h("preco")&&(await o.query("insert into product_pri\
ce_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,l.product_id,l.current_price_cents,l.price_cents,e.ctx.userId]),m++),c++}
if(l.product_id&&l.action!=="ignorar")for(let h of l.codes||[])await rt(o,e.ctx.companyId,h,"PRODUTO",l.product_id);l.product_id&&l.action!=="ignorar"&&await o.query(`insert into p\
os_product_aliases (company_id, provider, alias_norm, product_id) values ($1,'infinitepay',$2,$3)
          on conflict (company_id, provider, alias_norm) do update set product_id = excluded.product_id, updated_at = now()`,[e.ctx.companyId,J(l.name),l.product_id])}let u={created:r,
updated:c,prices:m,unchanged:i.summary.igual,categories_created:i.summary.categorias_criar,categories_updated:i.summary.categorias_atualizar};return await g(o,e.ctx,"cardapio.impor\
tado",{data:{source:t.source,...u}}),u}).catch(o=>{throw o.code==="23505"?b("C\xF3digo (SKU) repetido entre produtos: confira a coluna de c\xF3digo"):o});a.json(n)}));ue.get("/expo\
rt",y("cardapio.gerenciar"),p(async(e,a)=>{let t=e.ctx.can("relatorios.cmv")||e.ctx.can("cardapio.gerenciar"),{rows:n}=await d(`select p.sku, p.name, c.name as category, ps.name as\
 sector, p.kind, p.unit, p.price_cents, ${t?"p.cost_cents":"null::bigint as cost_cents"}, p.active, p.description,
            coalesce((select string_agg(s.code, ' ' order by s.id) from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.entity_id = p.id), '') as code\
s
       from products p left join categories c on c.id = p.category_id left join production_sectors ps on ps.id = p.sector_id
      where p.company_id = $1 and not p.demo order by c.sort nulls last, c.name, p.name`,[e.ctx.companyId]);await g({query:d},e.ctx,"cardapio.exportado",{data:{count:n.length}}),a.
json(n)}));ue.delete("/demo",y("configuracoes.gerenciar"),p(async(e,a)=>{let t=await k(async n=>{let i=(await n.query("select distinct product_id from order_items where company_id \
= $1",[e.ctx.companyId])).rows.map(c=>c.product_id),s=await n.query("update products set active = false, name = name where company_id = $1 and demo and id = any($2) returning id",[
e.ctx.companyId,i]);await n.query("delete from scan_codes where company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo and \
not (id = any($2)))",[e.ctx.companyId,i]),await n.query("delete from product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 an\
d demo and not (id = any($2)))",[e.ctx.companyId,i]);let r=await n.query("delete from products where company_id = $1 and demo and not (id = any($2)) returning id",[e.ctx.companyId,
i]);return await n.query("delete from categories c where c.company_id = $1 and c.demo and not exists (select 1 from products p where p.category_id = c.id)",[e.ctx.companyId]),await g(
n,e.ctx,"demonstracao.removida",{data:{removed:r.rowCount,deactivated:s.rowCount}}),{removed:r.rowCount,deactivated:s.rowCount}});a.json(t)}));import{Router as Vs}from"npm:express@5.2.1";import{z as ce}from"npm:zod@4.6.5";var Ue=Vs(),Hs=e=>Number(e.query.unit_id||e.body?.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;async function pn(e){let a=Hs(e);return a?(Oe(e.ctx,a),a):(await d("select id from un\
its where company_id = $1 and active order by id limit 1",[e.ctx.companyId])).rows[0]?.id}Ue.get("/tables",y("salao.visualizar"),p(async(e,a)=>{let t=await pn(e),n=e.ctx.can("pdv.r\
eceber")||e.ctx.can("financeiro.visualizar")||e.ctx.can("pdv.lancar"),{rows:o}=await d(`select t.id, t.number, t.area, t.capacity, t.status, t.pos_x, t.pos_y, t.active,
            (select code from scan_codes s where s.company_id = t.company_id and s.entity = 'MESA' and s.entity_id = t.id limit 1) as code,
            (select count(*)::int from consumption_sessions s where s.table_id = t.id and s.status in ('aberta','em_fechamento')) as open_sessions,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status in ('novo','aceito','preparando')) as preparing,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status = 'pronto') as ready,
            (select string_agg(coalesce(s.customer_name, ''), ', ') filter (where s.customer_name is not null) from consumption_sessions s
              where s.table_id = t.id and s.status in ('aberta','em_fechamento')) as customer_names
            ${n?`, (select coalesce(sum(i.total_cents),0)::bigint from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo') as consumed_cents`:""}
       from dining_tables t where t.company_id = $1 and t.unit_id = $2 and t.active order by t.number`,[e.ctx.companyId,t]);a.json({unitId:t,tables:o})}));Ue.post("/tables",y("sala\
o.gerenciar"),p(async(e,a)=>{let t=w(ce.object({from:ce.number().int().min(1).max(9999),count:ce.number().int().min(1).max(200),area:ce.string().max(40).default("Sal\xE3o"),capacity:ce.
number().int().min(1).max(50).default(4)}),e.body),n=await pn(e),o=await k(async i=>{let s=await Wn(i,e.ctx.companyId,n,t.from,t.count);return s.length&&await i.query("update dinin\
g_tables set area = $2, capacity = $3 where id = any($1)",[s,t.area,t.capacity]),await g(i,e.ctx,"mesas.criadas",{unitId:n,data:{from:t.from,count:s.length}}),s});a.status(201).json(
{created:o.length})}));Ue.put("/tables/:id",y("salao.visualizar"),p(async(e,a)=>{let t=w(ce.object({status:ce.enum(["livre","ocupada","reservada","conta","limpeza"]).optional(),area:ce.
string().max(40).optional(),capacity:ce.number().int().min(1).max(50).optional(),pos_x:ce.number().int().min(0).max(40).optional(),pos_y:ce.number().int().min(0).max(40).optional(),
active:ce.boolean().optional()}),e.body);if(["area","capacity","pos_x","pos_y","active"].some(i=>i in t)&&!e.ctx.can("salao.gerenciar"))throw f("Sem permiss\xE3o para alterar a estrut\
ura do sal\xE3o");if(t.status&&!e.ctx.can("salao.gerenciar")&&!e.ctx.can("pdv.lancar"))throw f("Sem permiss\xE3o para mudar a situa\xE7\xE3o da mesa");if(t.status==="livre"&&(await d(
"select 1 from consumption_sessions where table_id = $1 and company_id = $2 and status in ('aberta','em_fechamento')",[Number(e.params.id),e.ctx.companyId])).rows[0])throw b("Mesa \
com consumo aberto n\xE3o pode ser liberada");if(!(await d(`update dining_tables set status = coalesce($3,status), area = coalesce($4,area), capacity = coalesce($5,capacity),
                       pos_x = coalesce($6,pos_x), pos_y = coalesce($7,pos_y), active = coalesce($8,active) where id = $1 and company_id = $2 returning unit_id`,[Number(e.params.id),
e.ctx.companyId,t.status??null,t.area??null,t.capacity??null,t.pos_x??null,t.pos_y??null,t.active??null])).rows[0])throw v("Mesa n\xE3o encontrada");await g({query:d},e.ctx,"mesa.a\
lterada",{entity:"table",entityId:e.params.id,data:t}),a.json({ok:!0})}));Ue.get("/cards",y("pdv.lancar"),p(async(e,a)=>{let t=await pn(e),{rows:n}=await d(`select c.id, c.number, \
c.status, c.block_reason,
            (select code from scan_codes s where s.company_id = c.company_id and s.entity = 'COMANDA' and s.entity_id = c.id order by s.id limit 1) as code,
            s.id as session_id, s.customer_name, s.opened_at, s.status as session_status, t.number as table_number,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count,
            (select coalesce(sum(i.total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
            s.customer_id,
            (select sum(a.amount_cents)::bigint from customer_account a where a.company_id = c.company_id and a.customer_id = s.customer_id) as account_cents
       from tab_cards c
       left join lateral (select * from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') order by s.id desc limit 1) s on true
       left join dining_tables t on t.id = s.table_id
      where c.company_id = $1 and c.unit_id = $2 order by c.number`,[e.ctx.companyId,t]);a.json({unitId:t,cards:n})}));Ue.post("/cards",y("comandas.gerenciar"),p(async(e,a)=>{let t=w(
ce.object({from:ce.number().int().min(1).max(999999),count:ce.number().int().min(1).max(1e3)}),e.body),n=await pn(e),o=await k(async i=>{let s=(await i.query("select coalesce(setti\
ngs->'pdv'->>'card_prefix','CMD-') p from companies where id = $1",[e.ctx.companyId])).rows[0].p,r=await Kn(i,e.ctx.companyId,n,t.from,t.count,s);return await g(i,e.ctx,"comandas.g\
eradas",{unitId:n,data:{from:t.from,count:r.length}}),r});a.status(201).json({created:o})}));Ue.post("/cards/:id/block",y("comandas.gerenciar"),p(async(e,a)=>{let t=w(ce.object({reason:ce.
string().trim().min(3).max(200)}),e.body);if(!(await d("update tab_cards set status = 'bloqueado', block_reason = $3 where id = $1 and company_id = $2 returning id",[Number(e.params.
id),e.ctx.companyId,t.reason])).rows[0])throw v();await g({query:d},e.ctx,"comanda.bloqueada",{entity:"card",entityId:e.params.id,reason:t.reason}),a.json({ok:!0})}));Ue.post("/car\
ds/:id/unblock",y("comandas.gerenciar"),p(async(e,a)=>{if(!(await d("update tab_cards set status = 'ativo', block_reason = null where id = $1 and company_id = $2 returning id",[Number(
e.params.id),e.ctx.companyId])).rows[0])throw v();await g({query:d},e.ctx,"comanda.desbloqueada",{entity:"card",entityId:e.params.id}),a.json({ok:!0})}));Ue.post("/cards/:id/replac\
e",y("comandas.gerenciar"),p(async(e,a)=>{let t=w(ce.object({new_card_id:ce.number().int(),reason:ce.string().trim().min(3).max(200)}),e.body);await k(async n=>{let o=(await n.query(
"select * from tab_cards where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0],i=(await n.query("select * from tab_cards where id = $1 and c\
ompany_id = $2 for update",[t.new_card_id,e.ctx.companyId])).rows[0];if(!o||!i)throw v("Cart\xE3o n\xE3o encontrado");if(i.status!=="ativo")throw f("O novo cart\xE3o est\xE1 bloqueado");
if(o.unit_id!==i.unit_id)throw f("Cart\xF5es de unidades diferentes");if((await n.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechament\
o')",[i.id])).rows[0])throw b("O novo cart\xE3o j\xE1 tem consumo em aberto");await n.query("update tab_cards set status = 'bloqueado', block_reason = $2 where id = $1",[o.id,`Subs\
titu\xEDdo pelo ${i.number}: ${t.reason}`]);let r=await n.query("update consumption_sessions set card_id = $2, version = version + 1 where card_id = $1 and status in ('aberta','em_\
fechamento') returning id",[o.id,i.id]);await g(n,e.ctx,"comanda.substituida",{entity:"card",entityId:o.id,reason:t.reason,data:{new_card:i.id,session:r.rows[0]?.id??null}})}),a.json(
{ok:!0})}));import{Router as Xs}from"npm:express@5.2.1";import{z as C}from"npm:zod@4.6.5";var ke=e=>String(e??"").replace(/\D/g,"");function Gs(e){let a=ke(e);if(a.length!==11||/^(\d)\1{10}$/.test(a))return!1;let t=n=>{let o=0;for(let s=0;s<n;s++)o+=Number(a[s])*(n+1-s);
let i=o*10%11;return i===10?0:i};return t(9)===Number(a[9])&&t(10)===Number(a[10])}function _n(e,{required:a=!1}={}){let t=ke(e);if(!t){if(a)throw f("Informe o CPF");return null}if(!Gs(
t))throw f("CPF inv\xE1lido","invalid_cpf");return t}var yn=e=>e?`${e.slice(0,3)}.${e.slice(3,6)}.${e.slice(6,9)}-${e.slice(9)}`:null,Js=e=>e?`***.${e.slice(3,6)}.${e.slice(6,9)}-*\
*`:null,Ws=e=>e?e.replace(/\d(?=\d{4})/g,"*"):null,Ks=e=>e?e.replace(/^(.).*(@.*)$/,"$1***$2"):null;function tt(e,a){if(!e)return e;let t=a.can("dados.pessoais");return{id:e.id,name:e.
name,cpf:t?yn(e.cpf):Js(e.cpf),phone:t?e.phone:Ws(e.phone),email:t?e.email:Ks(e.email),birthday:t?e.birthday:null,address:t?e.address:{},tags:e.tags,preferences:e.preferences,notes:e.
notes,consent_whatsapp:e.consent_whatsapp,consent_email:e.consent_email,unsubscribed:!!e.unsubscribed_at,points:e.points,anonymized:!!e.anonymized_at,created_at:e.created_at,masked:!t,
...e.visits!=null?{visits:e.visits,spent_cents:e.spent_cents,last_visit:e.last_visit}:{}}}var fn=e=>({enabled:!1,cents_per_point:100,point_value_cents:5,validity_days:365,min_redeem:100,
...e?.loyalty||{}});async function wt(e,a,t,n){let o=await e.query(`insert into loyalty_ledger (company_id, customer_id, session_id, kind, points, expires_at, reason, reverses_id, \
payment_id, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[a,t,n.session_id??null,n.kind,n.points,n.expires_at??null,n.reason??null,n.reverses_id??null,n.payment_id??null,n.user_id??
null]);return await e.query("update customers set points = points + $3, updated_at = now() where id = $1 and company_id = $2",[t,a,n.points]),o.rows[0]}async function ia(e,a,t){let n=await e.
query(`select
       coalesce(sum(l.points) filter (where (l.kind = 'ganho' or o.kind = 'ganho') and coalesce(l.expires_at, o.expires_at) < current_date), 0)::int as vencidos,
       coalesce(-sum(l.points) filter (where l.kind in ('resgate','expiracao') or (l.kind = 'ajuste' and l.points < 0) or o.kind = 'resgate'), 0)::int as usados
     from loyalty_ledger l left join loyalty_ledger o on o.id = l.reverses_id
     where l.company_id = $1 and l.customer_id = $2`,[a,t]),{vencidos:o,usados:i}=n.rows[0],s=o-i;s>0&&await wt(e,a,t,{kind:"expiracao",points:-s,reason:"Pontos vencidos"})}async function wn(e,a,t,n){
if(!t.customer_id)return null;let o=(await e.query("select settings from companies where id = $1",[a.companyId])).rows[0],i=fn(o.settings);if(!i.enabled)return null;let s=Math.floor(
n/Math.max(1,i.cents_per_point));if(s<=0||(await e.query(`select 1 from loyalty_ledger where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = loyalty_ledger.id)`,[a.companyId,t.id])).rows[0])return null;let c=new Date(Date.now()+i.validity_days*864e5).
toISOString().slice(0,10);return wt(e,a.companyId,t.customer_id,{session_id:t.id,kind:"ganho",points:s,expires_at:c,reason:`Consumo ${t.id}`,user_id:a.userId})}async function Uo(e,a,t,n){
let o=(await e.query(`select * from loyalty_ledger l where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = l.id)`,[a.companyId,t])).rows[0];return o?wt(e,a.companyId,o.customer_id,{session_id:t,kind:"estorno",points:-o.
points,reverses_id:o.id,reason:n,user_id:a.userId}):null}async function Fo(e,a,t,n,o,i){let s=(await e.query("select points from customers where id = $1 and company_id = $2 for upd\
ate",[t,a.companyId])).rows[0];if(!s)throw f("Cliente n\xE3o encontrado");if(s.points<n)throw b(`Saldo insuficiente: ${s.points} pontos`,"insufficient_points");return wt(e,a.companyId,
t,{session_id:i,kind:"resgate",points:-n,payment_id:o,reason:`Resgate no consumo ${i}`,user_id:a.userId})}async function Bo(e,a,t){let n=(await e.query(`select * from loyalty_ledge\
r l where company_id = $1 and payment_id = $2 and kind = 'resgate'
    and not exists (select 1 from loyalty_ledger x where x.reverses_id = l.id)`,[a.companyId,t])).rows[0];return n?wt(e,a.companyId,n.customer_id,{session_id:n.session_id,kind:"est\
orno",points:-n.points,reverses_id:n.id,reason:"Pagamento com pontos estornado",user_id:a.userId}):null}var Vo={credito:"Cr\xE9dito lan\xE7ado",uso_credito:"Uso de cr\xE9dito",fiado:"Fiado",pagamento_fiado:"Pagamento de fiado",estorno:"Estorno",ajuste:"Ajuste"};async function Ae(e,a,t){
let n=(await e.query(`select coalesce(sum(amount_cents),0)::bigint as balance,
      min(created_at) filter (where kind = 'fiado') as first_fiado, max(created_at) as last_entry
    from customer_account where company_id = $1 and customer_id = $2`,[a,t])).rows[0],o=Number(n.balance),i=null;if(o<0){let s=(await e.query("select amount_cents, created_at, kind\
 from customer_account where company_id = $1 and customer_id = $2 order by id",[a,t])).rows,r=s.filter(c=>Number(c.amount_cents)>0).reduce((c,m)=>c+Number(m.amount_cents),0);for(let c of s)
if(!(Number(c.amount_cents)>=0)&&(r+=Number(c.amount_cents),r<0)){i=c.created_at;break}}return{balance_cents:o,credit_cents:Math.max(0,o),debt_cents:Math.max(0,-o),open_since:i,last_entry:n.
last_entry}}async function Ho(e,a,t,n,o,i){if(!t.customer_id)throw b("Identifique o cliente pelo CPF na comanda para usar fiado ou cr\xE9dito","customer_required");let s=(await e.query(
"select id, name, cpf, fiado_limit_cents, anonymized_at from customers where id = $1 and company_id = $2 for update",[t.customer_id,a.companyId])).rows[0];if(!s||s.anonymized_at)throw b(
"Cliente indispon\xEDvel","customer_required");if(!s.cpf)throw b("Cadastre o CPF do cliente para lan\xE7ar fiado ou usar cr\xE9dito","cpf_required");let r=await Ae(e,a.companyId,s.
id),c=!1;if(n==="saldo_cliente"){if(o>r.credit_cents)throw b(`Cr\xE9dito dispon\xEDvel: R$ ${(r.credit_cents/100).toFixed(2).replace(".",",")}`,"insufficient_credit")}else{let l=r.
balance_cents-o,_=Number(s.fiado_limit_cents);if(-l>_){if(!a.can("pdv.autorizar"))throw G(`Fiado acima do limite do cliente (R$ ${(_/100).toFixed(2).replace(".",",")}). Pe\xE7a a um g\
erente ou receba de outra forma.`,"fiado_limit");c=!0}}let m=n==="fiado"?"fiado":"uso_credito";return{entry_id:(await e.query(`insert into customer_account (company_id, customer_id\
, kind, amount_cents, session_id, payment_id, over_limit, reason, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[a.companyId,s.id,m,-o,t.id,i,c,m==="fiado"?`Consumo #${t.id}`:`Uso de cr\xE9dito no consumo #${t.id}`,a.userId])).rows[0].id,
over_limit:c,customer_id:s.id,balance_after:r.balance_cents-o}}async function Go(e,a,t,n){let o=(await e.query(`select * from customer_account a where company_id = $1 and payment_i\
d = $2 and reverses_id is null
    and not exists (select 1 from customer_account x where x.reverses_id = a.id)`,[a.companyId,t])).rows[0];return o?(await e.query(`insert into customer_account (company_id, custo\
mer_id, kind, amount_cents, session_id, reverses_id, reason, user_id)
     values ($1,$2,'estorno',$3,$4,$5,$6,$7)`,[a.companyId,o.customer_id,-Number(o.amount_cents),o.session_id,o.id,n||"Estorno do pagamento",a.userId]),o.id):null}var te=Xs();async function Jo(e,a,t){let n=await e.query("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1 and u.company_id = $2",
[t,a]);if(!n.rows[0])throw f("Unidade inv\xE1lida");return n.rows[0]}async function Ys(e,a){let t=[];return a.card_id&&t.push(`Comanda ${(await e.query("select number from tab_card\
s where id = $1",[a.card_id])).rows[0]?.number??""}`.trim()),a.table_id&&t.push(`Mesa ${(await e.query("select number from dining_tables where id = $1",[a.table_id])).rows[0]?.number??
""}`.trim()),t.length?t.join(" \xB7 "):a.label?a.label:a.kind==="balcao"?"Balc\xE3o":`Consumo ${a.id}`}te.post("/resolve",y("pdv.lancar"),p(async(e,a)=>{let{code:t}=w(C.object({code:C.
string().max(256)}),e.body),n=await Vt({query:d},e.ctx.companyId,t);n.type==="DESCONHECIDO"&&await g({query:d},e.ctx,"leitura.desconhecida",{data:{code:n.code.slice(0,40)}}),a.json(
n)}));te.get("/sessions",y("pdv.lancar"),p(async(e,a)=>{let t=e.query.status==="all"?null:["aberta","em_fechamento"],n=[e.ctx.companyId],o="s.company_id = $1";t&&(n.push(t),o+=` an\
d s.status = any($${n.length})`);let i=Number(e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;i&&(n.push(i),o+=` and s.unit_id = $${n.length}`);let{rows:s}=await d(`select s.i\
d, s.kind, s.status, s.label, s.customer_name, s.opened_at, s.version, s.suspended, s.unit_id,
            c.number as card_number, t.number as table_number, s.table_id, s.card_id,
            (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
            (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = s.id and p.status = 'confirmado') as paid_cents,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
      where ${o} order by s.opened_at desc limit 300`,n);a.json(s)}));var Zs=C.object({kind:C.enum(["comanda","mesa","balcao","retirada"]),card_id:C.number().int().optional(),card_code:C.
string().max(128).optional(),table_id:C.number().int().optional(),customer_name:C.string().trim().max(80).optional(),customer_id:C.number().int().optional(),label:C.string().trim().
max(60).optional(),unit_id:C.number().int().optional()});async function sa(e,a,t){Q(a,"pdv.abrir_comanda");let n=t.unit_id||a.terminalUnitId||a.unitId,o=null,i=null;if(t.card_code&&
!t.card_id){let u=await Vt(e,a.companyId,t.card_code);if(u.type!=="COMANDA")throw f("C\xF3digo n\xE3o \xE9 de comanda");t.card_id=u.card.id}if(t.card_id){let u=(await e.query("sele\
ct * from tab_cards where id = $1 and company_id = $2 for update",[t.card_id,a.companyId])).rows[0];if(!u)throw v("Comanda n\xE3o encontrada");if(u.status!=="ativo")throw b(`Comand\
a ${u.number} bloqueada${u.block_reason?`: ${u.block_reason}`:""}`,"card_blocked");let l=await e.query("select id from consumption_sessions where card_id = $1 and status in ('abert\
a','em_fechamento')",[u.id]);if(l.rows[0])throw b(`Comanda ${u.number} j\xE1 est\xE1 em uso`,"card_busy",{session_id:l.rows[0].id});o=u.id,n=u.unit_id}if(t.table_id){let u=(await e.
query("select * from dining_tables where id = $1 and company_id = $2 and active",[t.table_id,a.companyId])).rows[0];if(!u)throw v("Mesa n\xE3o encontrada");if(n&&u.unit_id!==n)throw f(
"Mesa e comanda de unidades diferentes");i=u.id,n=u.unit_id}if(t.customer_id){let u=(await e.query("select id, name from customers where id = $1 and company_id = $2 and anonymized_\
at is null",[t.customer_id,a.companyId])).rows[0];if(!u)throw v("Cliente n\xE3o encontrado");t.customer_name=t.customer_name||u.name}if(t.kind==="comanda"&&!o)throw f("Informe a co\
manda");if(t.kind==="mesa"&&!i)throw f("Informe a mesa");n||(n=(await e.query("select id from units where company_id = $1 and active order by id limit 1",[a.companyId])).rows[0]?.id),
Oe(a,n);let s=await Ye(e,a,n),{day_cutoff:r,timezone:c}=await Jo(e,a.companyId,n),m=await e.query(`insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, c\
ustomer_name, label, service_fee_bp, opened_by, business_date, customer_id, delivery_fee_cents)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[a.companyId,n,t.kind,o,i,t.customer_name??null,t.label??null,["balcao","retirada","delivery"].includes(t.kind)?0:
s.service_fee_bp,a.userId,Ne(new Date,c,r),t.customer_id??null,t.delivery_fee_cents??0]);return i&&await e.query("update dining_tables set status = 'ocupada' where id = $1 and stat\
us in ('livre','reservada','limpeza')",[i]),await g(e,a,"consumo.aberto",{entity:"session",entityId:m.rows[0].id,unitId:n,data:{kind:t.kind,card:o,table:i}}),m.rows[0]}te.post("/se\
ssions",p(async(e,a)=>{let t=w(Zs,e.body),n=await k(o=>sa(o,e.ctx,t)).catch(o=>{throw o.code==="23505"?b("Comanda j\xE1 est\xE1 em uso","card_busy"):o});a.status(201).json(n)}));async function Qs(e,a,t){
let n=(await e.query(`select s.*, c.number as card_number, t.number as table_number, u.name as opened_by_name, cu.points as customer_points,
            cu.fiado_limit_cents as customer_fiado_limit, (cu.cpf is not null) as customer_has_cpf, cu.phone as customer_phone,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo' and i.sent_at is null and i.kitchen_status = 'novo') as pending_send
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join users u on u.id = s.opened_by left join customers cu on cu.id = s.customer_id where s.id = $1 and s.company_id = $2`,[t,a.companyId])).rows[0];if(!n)throw v("Consu\
mo n\xE3o encontrado");let o=(await e.query(`select i.id, i.product_id, i.description, i.qty, i.unit, i.unit_price_cents, i.modifiers, i.modifiers_cents, i.discount_cents,
            i.total_cents, i.notes, i.status, i.kitchen_status, i.launch_mode, i.created_at, i.cancel_reason, i.transferred_from, i.sent_at,
            u.name as user_name
       from order_items i left join users u on u.id = i.user_id where i.session_id = $1 order by i.id`,[t])).rows,i=(await e.query(`select p.id, p.method, p.amount_cents, p.tendere\
d_cents, p.change_cents, p.status, p.source, p.created_at, p.refund_reason, u.name as user_name
       from payments p left join users u on u.id = p.user_id where p.session_id = $1 order by p.id`,[t])).rows,s=n.customer_id?{...await Ae(e,a.companyId,n.customer_id),fiado_limit_cents:Number(
n.customer_fiado_limit||0),has_cpf:!!n.customer_has_cpf}:null;return{...n,items:o,payments:i,totals:await K(e,t),account:s}}te.get("/sessions/:id",y("pdv.lancar"),p(async(e,a)=>{a.
json(await Qs({query:d},e.ctx,Number(e.params.id)))}));var er=C.object({session_id:C.number().int(),product_id:C.number().int().optional(),qty:C.number().positive().max(9999).optional(),
option_ids:C.array(C.number().int()).max(40).default([]),notes:C.string().trim().max(200).optional(),launch_mode:C.enum(["manual","continua","dupla","excecao","balcao","delivery"]),
idempotency_key:C.string().regex(/^[A-Za-z0-9_-]{8,80}$/),scan:C.object({card_code:C.string().max(128).optional(),product_code:C.string().max(128).optional()}).optional(),price_override_cents:C.
number().int().min(0).max(1e8).optional(),discount_cents:C.number().int().min(0).max(1e8).optional(),authorization:C.string().max(100).optional(),exception_reason:C.string().trim().
max(200).optional()});te.post("/items",y("pdv.lancar"),p(async(e,a)=>{let t=w(er,e.body),n=e.ctx,o=await d("select * from order_items where company_id = $1 and idempotency_key = $2",
[n.companyId,t.idempotency_key]);if(o.rows[0]){if(Number(o.rows[0].session_id)!==t.session_id)throw b("Chave de opera\xE7\xE3o j\xE1 usada em outro lan\xE7amento","idempotency_mism\
atch");return a.json({item:o.rows[0],replay:!0,totals:await K({query:d},t.session_id)})}let i=await k(async s=>{let r=await se(s,n.companyId,t.session_id);Oe(n,r.unit_id),ct(r);let c=await Ye(
s,n,r.unit_id),m=t.product_id,u=null;if(t.launch_mode==="dupla"||t.launch_mode==="continua"){if(!c.scanner_enabled)throw G("Leitor desabilitado nesta configura\xE7\xE3o","scanner_d\
isabled");if(t.launch_mode==="continua"&&c.double_read_mandatory)throw G("Dupla leitura obrigat\xF3ria: leitura cont\xEDnua n\xE3o permitida","double_read_required");let U=await Vt(
s,n.companyId,t.scan?.product_code);if(U.type!=="PRODUTO")throw f("C\xF3digo lido n\xE3o \xE9 de produto","not_a_product");if(m&&m!==U.product.id)throw f("Produto informado difere \
do c\xF3digo lido");if(m=U.product.id,t.launch_mode==="dupla"){let H=await Vt(s,n.companyId,t.scan?.card_code);if(H.type!=="COMANDA")throw f("Dupla leitura exige a leitura da coman\
da antes do produto","card_required");if(Number(H.card.id)!==Number(r.card_id))throw b("Comanda lida n\xE3o corresponde ao consumo de destino","card_mismatch")}}else if(t.launch_mode===
"excecao"){if(!c.allow_manual_exception)throw G("Exce\xE7\xE3o manual desabilitada","exception_disabled");if(Q(n,"pdv.excecao_dupla_leitura"),!t.exception_reason)throw f("Informe o\
 motivo da exce\xE7\xE3o");c.exception_requires_manager&&(u=(await ut(s,n,t.authorization,"excecao_dupla_leitura")).authorized_by)}else if(t.launch_mode==="delivery"){if(Q(n,"deliv\
ery.gerenciar"),r.kind!=="delivery")throw f("Lan\xE7amento de delivery s\xF3 em pedidos de delivery")}else{if(c.double_read_mandatory)throw G("Dupla leitura obrigat\xF3ria: use a exce\
\xE7\xE3o autorizada para lan\xE7ar manualmente","double_read_required");if(!c.allow_manual)throw G("Lan\xE7amento manual desabilitado","manual_disabled");Q(n,"pdv.lancamento_manua\
l")}if(!m)throw f("Informe o produto");let l=(await s.query("select * from products where id = $1 and company_id = $2",[m,n.companyId])).rows[0];if(!l)throw v("Produto n\xE3o encontra\
do");if(!l.active)throw b(`${l.name} est\xE1 indispon\xEDvel`,"product_inactive");let _=t.qty,h=t.launch_mode==="dupla"||t.launch_mode==="continua";if(l.kind==="weight"){if(!_)throw f(
`${l.name} \xE9 vendido por peso: informe o peso`,"weight_required")}else{if(_=_??(h?c.qty_per_scan:1),!Number.isInteger(_))throw f("Quantidade deve ser inteira para este produto");
if(h&&_!==c.qty_per_scan&&(Q(n,"pdv.alterar_quantidade"),_>c.max_qty_per_scan))throw f(`Quantidade por leitura limitada a ${c.max_qty_per_scan}`)}let $=(await s.query(`select g.id,\
 g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active
        where g.product_id = $1 group by g.id order by g.sort, g.id`,[l.id])).rows,N=[];for(let U of $){let H=U.options.filter(de=>t.option_ids.includes(de.id));if(H.length<U.min_select)
throw f(`Escolha ${U.min_select===1?"uma op\xE7\xE3o":`${U.min_select} op\xE7\xF5es`} em "${U.name}"`,"options_required");if(H.length>U.max_select)throw f(`No m\xE1ximo ${U.max_select}\
 em "${U.name}"`);for(let de of H)N.push({group:U.name,id:de.id,name:de.name,price_cents:de.price_cents})}if(N.length!==new Set(t.option_ids).size)throw f("Op\xE7\xE3o inv\xE1lida para este\
 produto");let P=N.reduce((U,H)=>U+H.price_cents,0),T=l.price_cents,q={};t.price_override_cents!=null&&t.price_override_cents!==l.price_cents&&(n.can("pdv.alterar_preco")||await ut(
s,n,t.authorization,"alterar_preco"),T=t.price_override_cents,q.price={from:l.price_cents,to:T});let E=t.discount_cents||0;E&&(n.can("pdv.desconto")||await ut(s,n,t.authorization,"\
desconto"),q.discount=E);let W=Dt(T,_,P,E);if(E>Dt(T,_,P,0))throw f("Desconto maior que o valor do item");let Y=(await s.query(`insert into order_items (company_id, session_id, pro\
duct_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, case when $19::boolean then now() end) returning *`,[n.companyId,r.id,l.id,l.name,_,l.unit,T,JSON.stringify(
N),P,E,W,t.notes??null,l.sector_id,l.sector_id?"novo":"nao_produz",t.launch_mode,n.terminalId,n.userId,t.idempotency_key,!!l.sector_id&&c.kitchen_send!=="lote"&&r.kind!=="delivery"])).
rows[0];return await cn(s,n,Y,l,N.map(U=>U.id)),await s.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),(t.launch_mode==="excecao"||Object.keys(
q).length)&&await g(s,n,t.launch_mode==="excecao"?"pdv.excecao_manual":"pdv.item_ajustado",{entity:"item",entityId:Y.id,unitId:r.unit_id,reason:t.exception_reason,data:{session:r.id,
product:l.id,authorized_by:u,...q}}),{item:Y,totals:await K(s,r.id),confirmation:{product:l.name,qty:_,unit_price_cents:T+P,total_cents:W,destination:await Ys(s,r)}}}).catch(async s=>{
if(s.code==="23505"){let r=await d("select * from order_items where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(r.rows[0])return{item:r.rows[0],replay:!0,
totals:await K({query:d},r.rows[0].session_id)}}throw s});a.status(i.replay?200:201).json(i)}));te.get("/items/by-key/:key",y("pdv.lancar"),p(async(e,a)=>{let t=await d("select * f\
rom order_items where company_id = $1 and idempotency_key = $2",[e.ctx.companyId,String(e.params.key).slice(0,80)]);a.json({found:!!t.rows[0],item:t.rows[0]||null})}));te.post("/it\
ems/:id/cancel",y("pdv.lancar"),p(async(e,a)=>{let t=w(C.object({reason:C.string().trim().min(3).max(200),authorization:C.string().max(100).optional()}),e.body),n=await k(async o=>{
let i=(await o.query("select * from order_items where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Item n\xE3o encontrado");let s=await se(
o,e.ctx.companyId,i.session_id);ct(s);let r=(await o.query("select * from order_items where id = $1 for update",[i.id])).rows[0];if(r.status!=="ativo")throw b("Item j\xE1 cancelado");
let c=null;e.ctx.can("pdv.cancelar_item")||(c=(await ut(o,e.ctx,t.authorization,"cancelar_item")).authorized_by);let m=["preparando","pronto","entregue"].includes(r.kitchen_status);
if(await o.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where id = $1`,[r.id,t.reason,e.ctx.userId]),(await K(o,s.id)).
balance<0)throw b("Cancelar este item deixaria o consumo com pagamento maior que o total. Estorne o pagamento antes.","overpaid");return await o.query("update consumption_sessions \
set version = version + 1 where id = $1",[s.id]),m||await Gt(o,e.ctx,r.id,`Cancelamento: ${t.reason}`),await g(o,e.ctx,"pdv.item_cancelado",{entity:"item",entityId:r.id,unitId:s.unit_id,
reason:t.reason,data:{session:s.id,total_cents:r.total_cents,after_preparation:m,kitchen_status:r.kitchen_status,authorized_by:c}}),{ok:!0,after_preparation:m,totals:await K(o,s.id)}});
a.json(n)}));te.post("/items/transfer",y("pdv.transferir_item"),p(async(e,a)=>{let t=w(C.object({item_ids:C.array(C.number().int()).min(1).max(200),target_session_id:C.number().int(),
reason:C.string().trim().min(3).max(200)}),e.body);a.json(await k(n=>Wo(n,e.ctx,t.item_ids,t.target_session_id,t.reason)))}));async function Wo(e,a,t,n,o){let i=(await e.query("sel\
ect id, session_id from order_items where id = any($1) and company_id = $2 and status = 'ativo'",[t,a.companyId])).rows;if(i.length!==new Set(t).size)throw f("Itens inv\xE1lidos ou j\xE1\
 cancelados");let s=[...new Set(i.map(l=>Number(l.session_id)))],r=[...new Set([...s,n])].sort((l,_)=>l-_),c={};for(let l of r)c[l]=await se(e,a.companyId,l);let m=(await e.query("\
select * from order_items where id = any($1) and company_id = $2 and status = 'ativo' order by id for update",[t,a.companyId])).rows;if(m.length!==i.length)throw b("Itens j\xE1 transf\
eridos ou cancelados em outro terminal. Atualize e confira.","items_changed");let u=c[n];ct(u);for(let l of s){let _=c[l];if(ct(_),l===n)throw f("Origem e destino iguais");if(_.unit_id!==
u.unit_id)throw f("Transfer\xEAncia entre unidades n\xE3o permitida")}for(let l of m){let _=await e.query(`insert into order_items (company_id, session_id, product_id, description,\
 qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, transferred_from)
       select company_id, $2, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents, total_cents, notes,
              sector_id, kitchen_status, launch_mode, $3, $4, idempotency_key || '-t' || $5, id from order_items where id = $1 returning id`,[l.id,n,a.terminalId,a.userId,String(l.
id)]);await e.query("update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now() where id = $1",[l.id,`Transferido para consumo ${n} (ite\
m ${_.rows[0].id})`,a.userId])}for(let l of s){if((await K(e,l)).balance<0)throw b("A origem ficaria com pagamento maior que o consumo. Estorne antes de transferir.","overpaid");await e.
query("update consumption_sessions set version = version + 1 where id = $1",[l])}return await e.query("update consumption_sessions set version = version + 1 where id = $1",[n]),await g(
e,a,"pdv.itens_transferidos",{entity:"session",entityId:n,reason:o,data:{items:t,from:s}}),{ok:!0,moved:m.length}}te.post("/sessions/:id/merge",y("pdv.transferir_item"),p(async(e,a)=>{
let t=w(C.object({target_session_id:C.number().int(),reason:C.string().trim().min(3).max(200)}),e.body),n=Number(e.params.id);if(Number(t.target_session_id)===n)throw f("Escolha um\
 destino diferente da origem");a.json(await k(async o=>{for(let m of[n,Number(t.target_session_id)].sort((u,l)=>u-l))ct(await se(o,e.ctx.companyId,m));let i=(await o.query("select \
id from order_items where session_id = $1 and company_id = $2 and status = 'ativo'",[n,e.ctx.companyId])).rows.map(m=>m.id);if(!i.length)throw f("Consumo sem itens para juntar");if((await o.
query("select 1 from payments where session_id = $1 and status = 'confirmado'",[n])).rows[0])throw b("Consumo com pagamento registrado n\xE3o pode ser juntado; transfira os itens rest\
antes","has_payments");let r=await Wo(o,e.ctx,i,t.target_session_id,t.reason),c=(await o.query("select table_id, customer_name from consumption_sessions where id = $1",[n])).rows[0];
return await o.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2, label = coalesce(label,'') || ' (juntada)' where id = $1",[n,e.ctx.userId]),
c.customer_name&&await o.query("update consumption_sessions set customer_name = coalesce(customer_name, $2) where id = $1",[t.target_session_id,c.customer_name]),c.table_id&&await hn(
o,c.table_id),r}))}));te.post("/sessions/:id/move-table",y("pdv.transferir_item"),p(async(e,a)=>{let t=w(C.object({table_id:C.number().int(),reason:C.string().trim().min(3).max(200)}),
e.body);await k(async n=>{let o=await se(n,e.ctx.companyId,Number(e.params.id));ct(o);let i=(await n.query("select * from dining_tables where id = $1 and company_id = $2 and active",
[t.table_id,e.ctx.companyId])).rows[0];if(!i)throw v("Mesa n\xE3o encontrada");if(i.unit_id!==o.unit_id)throw f("Mesa de outra unidade");await n.query("update consumption_sessions \
set table_id = $2, version = version + 1 where id = $1",[o.id,i.id]),await n.query("update dining_tables set status = 'ocupada' where id = $1",[i.id]),o.table_id&&await hn(n,o.table_id),
await g(n,e.ctx,"pdv.mesa_trocada",{entity:"session",entityId:o.id,reason:t.reason,data:{from:o.table_id,to:i.id}})}),a.json({ok:!0})}));async function hn(e,a){await e.query(`updat\
e dining_tables set status = 'limpeza' where id = $1 and status in ('ocupada','conta')
                  and not exists (select 1 from consumption_sessions where table_id = $1 and status in ('aberta','em_fechamento'))`,[a])}te.post("/sessions/:id/service-fee",y("pdv.\
lancar"),p(async(e,a)=>{let t=w(C.object({bp:C.number().int().min(0).max(3e3),reason:C.string().trim().min(3).max(200),authorization:C.string().max(100).optional()}),e.body);a.json(
await k(async n=>{let o=await se(n,e.ctx.companyId,Number(e.params.id));if(!["aberta","em_fechamento"].includes(o.status))throw b("Consumo encerrado");e.ctx.can("pdv.taxa_servico")||
await ut(n,e.ctx,t.authorization,"taxa_servico");let i=(await K(n,o.id)).paid;await n.query("update consumption_sessions set service_fee_bp = $2, service_fee_removed_reason = $3, v\
ersion = version + 1 where id = $1",[o.id,t.bp,t.reason]);let s=await K(n,o.id);if(i>s.total)throw b("Pagamento registrado supera o novo total. Estorne antes.","overpaid");return await g(
n,e.ctx,"pdv.taxa_servico",{entity:"session",entityId:o.id,reason:t.reason,data:{from:o.service_fee_bp,to:t.bp}}),s}))}));te.post("/sessions/:id/request-close",y("pdv.lancar"),p(async(e,a)=>{
a.json(await k(async t=>{let n=await se(t,e.ctx.companyId,Number(e.params.id));return ct(n),await t.query("update consumption_sessions set status = 'em_fechamento', version = versi\
on + 1 where id = $1",[n.id]),n.table_id&&await t.query("update dining_tables set status = 'conta' where id = $1",[n.table_id]),{ok:!0}}))}));te.post("/sessions/:id/resume",y("pdv.\
lancar"),p(async(e,a)=>{a.json(await k(async t=>{let n=await se(t,e.ctx.companyId,Number(e.params.id));if(n.status!=="em_fechamento")throw b("Consumo n\xE3o est\xE1 em fechamento");
return await t.query("update consumption_sessions set status = 'aberta', version = version + 1 where id = $1",[n.id]),n.table_id&&await t.query("update dining_tables set status = '\
ocupada' where id = $1",[n.table_id]),{ok:!0}}))}));te.post("/sessions/:id/suspend",y("pdv.lancar"),p(async(e,a)=>{let t=w(C.object({suspended:C.boolean()}),e.body);await d("update\
 consumption_sessions set suspended = $3 where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId,t.suspended]),a.json({ok:!0})}));te.get("/sessions/:id/split",y("pd\
v.lancar"),p(async(e,a)=>{let t=Math.min(Math.max(Number(e.query.parts)||2,2),50),n=await K({query:d},Number(e.params.id));a.json({parts:qa(Math.max(n.balance,0),t),balance:n.balance})}));
te.post("/sessions/:id/close",y("pdv.receber"),p(async(e,a)=>{let t=w(C.object({version:C.number().int()}),e.body);a.json(await k(async n=>{let o=await se(n,e.ctx.companyId,Number(
e.params.id));if(!["aberta","em_fechamento"].includes(o.status))throw b("Consumo j\xE1 encerrado","already_closed");if(o.version!==t.version)throw b("O consumo foi alterado em outr\
o terminal. Confira antes de fechar.","version_conflict",{version:o.version});let i=await K(n,o.id);if(i.balance!==0)throw b(`Saldo pendente de ${(i.balance/100).toFixed(2)}. Receb\
a antes de encerrar.`,"balance_pending");if(i.items===0)throw f("Consumo sem itens: use cancelar");await n.query("update consumption_sessions set status = 'encerrada', closed_at = \
now(), closed_by = $2, version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await hn(n,o.table_id);let s=await wn(n,e.ctx,o,i.items);return await g(n,e.ctx,"consum\
o.encerrado",{entity:"session",entityId:o.id,unitId:o.unit_id,data:i}),{ok:!0,totals:i,points_earned:s?.points||0}}))}));te.post("/sessions/:id/cancel",y("pdv.lancar"),p(async(e,a)=>{
let t=w(C.object({reason:C.string().trim().min(3).max(200),authorization:C.string().max(100).optional()}),e.body);a.json(await k(async n=>{let o=await se(n,e.ctx.companyId,Number(e.
params.id));if(!["aberta","em_fechamento"].includes(o.status))throw b("Consumo j\xE1 encerrado");let i=await K(n,o.id);if(i.paid>0)throw b("H\xE1 pagamentos confirmados: estorne antes\
 de cancelar","has_payments");let s=null;i.items>0&&!e.ctx.can("pdv.cancelar_venda")&&(s=(await ut(n,e.ctx,t.authorization,"cancelar_venda")).authorized_by);let r=(await n.query("s\
elect id from order_items where session_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','nao_produz')",[o.id])).rows;for(let c of r)await Gt(n,e.ctx,c.id,`Consu\
mo cancelado: ${t.reason}`);return await n.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end
                    where session_id = $1 and status = 'ativo'`,[o.id,`Consumo cancelado: ${t.reason}`,e.ctx.userId]),await n.query("update consumption_sessions set status = 'cance\
lada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await hn(n,o.table_id),await g(n,e.ctx,"consumo.cancelado",{entity:"\
session",entityId:o.id,reason:t.reason,data:{items_cents:i.items,authorized_by:s}}),{ok:!0}}))}));te.post("/sessions/:id/reopen",y("pdv.lancar"),p(async(e,a)=>{let t=w(C.object({reason:C.
string().trim().min(3).max(200),authorization:C.string().max(100).optional()}),e.body);a.json(await k(async n=>{let o=await se(n,e.ctx.companyId,Number(e.params.id));if(o.status!==
"encerrada")throw b("S\xF3 consumos encerrados podem ser reabertos");let i=null;if(e.ctx.can("pdv.reabrir_comanda")||(i=(await ut(n,e.ctx,t.authorization,"reabrir_comanda")).authorized_by),
o.card_id&&(await n.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento') and id <> $2",[o.card_id,o.id])).rows[0])throw b("O cart\xE3o\
 j\xE1 est\xE1 em uso por outro consumo. Transfira os itens em vez de reabrir.","card_busy");return await n.query("update consumption_sessions set status = 'aberta', closed_at = nu\
ll, closed_by = null, version = version + 1 where id = $1",[o.id]),await Uo(n,e.ctx,o.id,"Consumo reaberto"),o.table_id&&await n.query("update dining_tables set status = 'ocupada' \
where id = $1",[o.table_id]),await g(n,e.ctx,"consumo.reaberto",{entity:"session",entityId:o.id,reason:t.reason,data:{authorized_by:i}}),{ok:!0}}))}));async function tr(e,a,t){let n=[
a.companyId],o="company_id = $1 and status = 'aberto'";return a.terminalId?(n.push(a.terminalId),o+=` and terminal_id = $${n.length}`):(n.push(a.userId,t),o+=` and user_id = $${n.length-
1} and unit_id = $${n.length} and terminal_id is null`),(await e.query(`select * from cash_sessions where ${o} order by id desc limit 1 for share`,n)).rows[0]}var nr=C.object({method:C.
enum(["dinheiro","pix","debito","credito","vale","outro","fiado","saldo_cliente"]),amount_cents:C.number().int().positive().max(1e8),tendered_cents:C.number().int().positive().max(
1e8).optional(),idempotency_key:C.string().regex(/^[A-Za-z0-9_-]{8,80}$/)});te.post("/sessions/:id/payments",y("pdv.receber"),p(async(e,a)=>{let t=w(nr,e.body),n=e.ctx,o=await d("s\
elect * from payments where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(o.rows[0])return a.json({payment:o.rows[0],replay:!0,totals:await K({query:d},
o.rows[0].session_id)});let i=await k(async s=>{let r=await se(s,n.companyId,Number(e.params.id));if(Oe(n,r.unit_id),!["aberta","em_fechamento"].includes(r.status))throw b("Consumo\
 encerrado","session_not_open");let c=await Ye(s,n,r.unit_id),m=await tr(s,n,r.unit_id);if(!m&&c.require_open_cash)throw b("Caixa fechado: abra o caixa antes de receber","cash_clos\
ed");let u=await K(s,r.id);if(t.amount_cents>u.balance)throw f(`Valor maior que o saldo (${(u.balance/100).toFixed(2)})`,"over_balance");let l=0;if(t.method==="outro")throw f('A fo\
rma "Outro" foi substitu\xEDda por "Fiado"',"method_retired");if(t.tendered_cents!=null){if(t.method!=="dinheiro")throw f("Troco s\xF3 \xE9 permitido em dinheiro","change_not_allow\
ed");if(t.tendered_cents<t.amount_cents)throw f("Valor entregue menor que o valor a pagar");l=t.tendered_cents-t.amount_cents}let{day_cutoff:_,timezone:h}=await Jo(s,n.companyId,r.
unit_id),$=(await s.query(`insert into payments (company_id, session_id, cash_session_id, method, amount_cents, tendered_cents, change_cents, business_date, idempotency_key, user_i\
d)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[n.companyId,r.id,m?.id??null,t.method,t.amount_cents,t.tendered_cents??null,l,Ne(new Date,h,_),t.idempotency_key,n.userId])).
rows[0],N=["fiado","saldo_cliente"].includes(t.method)?await Ho(s,n,r,t.method,t.amount_cents,$.id):null;return await s.query("update consumption_sessions set version = version + 1\
 where id = $1",[r.id]),await g(s,n,t.method==="fiado"?"pagamento.fiado":"pagamento.registrado",{entity:"payment",entityId:$.id,unitId:r.unit_id,data:{session:r.id,method:t.method,
amount_cents:t.amount_cents,change_cents:l,...N?{cliente:N.customer_id,acima_do_limite:N.over_limit,saldo_conta:N.balance_after}:{}}}),{payment:$,totals:await K(s,r.id),account:N}}).
catch(async s=>{if(s.code==="23505"){let r=await d("select * from payments where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(r.rows[0])return{payment:r.
rows[0],replay:!0,totals:await K({query:d},r.rows[0].session_id)}}throw s});a.status(i.replay?200:201).json(i)}));te.post("/payments/:id/refund",y("financeiro.estornar"),p(async(e,a)=>{
let t=w(C.object({reason:C.string().trim().min(3).max(200)}),e.body);a.json(await k(async n=>{let o=(await n.query("select * from payments where id = $1 and company_id = $2",[Number(
e.params.id),e.ctx.companyId])).rows[0];if(!o)throw v("Pagamento n\xE3o encontrado");let i=await se(n,e.ctx.companyId,o.session_id);if(!["aberta","em_fechamento"].includes(i.status))
throw b("Reabra o consumo antes de estornar","session_closed");if(!(await n.query(`update payments set status = 'estornado', refund_reason = $2, refunded_by = $3, refunded_at = now\
()
                              where id = $1 and status = 'confirmado' returning id`,[o.id,t.reason,e.ctx.userId])).rows[0])throw b("Pagamento j\xE1 estornado");return await n.query(
"update consumption_sessions set version = version + 1 where id = $1",[i.id]),await Bo(n,e.ctx,o.id),await Go(n,e.ctx,o.id,t.reason),await g(n,e.ctx,"pagamento.estornado",{entity:"\
payment",entityId:o.id,reason:t.reason,data:{amount_cents:o.amount_cents,method:o.method}}),{ok:!0,totals:await K(n,i.id)}}))}));te.post("/sessions/:id/send",y("pdv.lancar"),p(async(e,a)=>{
a.json(await k(async t=>{let n=await se(t,e.ctx.companyId,Number(e.params.id));Oe(e.ctx,n.unit_id);let o=await t.query(`update order_items set sent_at = now() where session_id = $1\
 and status = 'ativo' and sent_at is null
      and kitchen_status = 'novo' returning id`,[n.id]);return o.rowCount&&await g(t,e.ctx,"producao.lote_enviado",{entity:"session",entityId:n.id,data:{items:o.rowCount}}),{sent:o.
rowCount}}))}));te.post("/mode",y("pdv.lancar"),p(async(e,a)=>{let t=w(C.object({from:C.enum(["manual","continua","dupla"]),to:C.enum(["manual","continua","dupla"]),reason:C.string().
trim().max(200).optional()}),e.body),n=await Ye({query:d},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId);if(t.from!==t.to){if(Q(e.ctx,"pdv.alterar_modo"),!n.allow_mode_change)throw G("T\
roca de modo desabilitada nesta configura\xE7\xE3o","mode_locked");if(n.double_read_mandatory&&t.to!=="dupla")throw G("Dupla leitura obrigat\xF3ria: use a exce\xE7\xE3o autorizada",
"double_read_required");if(!n.scanner_enabled&&t.to!=="manual")throw G("Leitor desabilitado","scanner_disabled")}await g({query:d},e.ctx,"pdv.modo_alterado",{reason:t.reason,data:{
from:t.from,to:t.to}}),a.json({ok:!0,mode:t.to})}));import{Router as ar}from"npm:express@5.2.1";import{z as be}from"npm:zod@4.6.5";var nt=ar(),ra=["dinheiro","pix","debito","credito","vale","outro"],Ko=["fiado","saldo_cliente"];async function gn(e,a){let t=(await e.query("select opening_cents from cash_session\
s where id = $1",[a])).rows[0],n=(await e.query("select method, coalesce(sum(amount_cents),0)::bigint as total from payments where cash_session_id = $1 and status = 'confirmado' gr\
oup by method",[a])).rows,o=(await e.query("select kind, coalesce(sum(amount_cents),0)::bigint as total from cash_movements where cash_session_id = $1 group by kind",[a])).rows,i=(await e.
query("select method, coalesce(sum(amount_cents),0)::bigint as total from customer_account where cash_session_id = $1 and method is not null group by method",[a])).rows,s=Object.fromEntries(
ra.map(u=>[u,0])),r=Object.fromEntries(Ko.map(u=>[u,0]));for(let u of n)Ko.includes(u.method)?r[u.method]=Number(u.total):s[u.method]=Number(u.total);let c={};for(let u of i)s[u.method]+=
Number(u.total),c[u.method]=Number(u.total);let m=Object.fromEntries(o.map(u=>[u.kind,Number(u.total)]));return s.dinheiro=t.opening_cents+s.dinheiro+(m.suprimento||0)-(m.sangria||
0)-(m.despesa||0),{byMethod:s,opening:t.opening_cents,movements:m,info:r,account_in:c}}async function Xo(e){let a=[e.ctx.companyId],t="c.company_id = $1 and c.status = 'aberto'";return e.
ctx.terminalId?(a.push(e.ctx.terminalId),t+=` and c.terminal_id = $${a.length}`):(a.push(e.ctx.userId),t+=` and c.user_id = $${a.length} and c.terminal_id is null`),(await d(`selec\
t c.*, u.name as user_name from cash_sessions c join users u on u.id = c.user_id where ${t} order by c.id desc limit 1`,a)).rows[0]}nt.get("/current",p(async(e,a)=>{let t=await Xo(
e);if(!t)return a.json({open:!1});let n=e.ctx.can("financeiro.visualizar");a.json({open:!0,cash:{id:t.id,opened_at:t.opened_at,user_name:t.user_name,opening_cents:t.opening_cents,business_date:t.
business_date},expected:n?await gn({query:d},t.id):null})}));nt.post("/open",y("caixa.abrir"),p(async(e,a)=>{let t=w(be.object({opening_cents:be.number().int().min(0).max(1e7)}),e.
body),n=e.ctx.terminalUnitId||e.ctx.unitId||(await d("select id from units where company_id = $1 order by id limit 1",[e.ctx.companyId])).rows[0].id;if(!e.ctx.terminalId&&(await d(
"select 1 from terminals where company_id = $1 and active limit 1",[e.ctx.companyId])).rows[0])throw f("Identifique o terminal deste dispositivo antes de abrir o caixa","terminal_r\
equired");if(await Xo(e))throw b("J\xE1 existe caixa aberto neste terminal","cash_open");let o=(await d("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.c\
ompany_id where u.id = $1",[n])).rows[0],i=await d("insert into cash_sessions (company_id, unit_id, terminal_id, user_id, opening_cents, business_date) values ($1,$2,$3,$4,$5,$6) r\
eturning id",[e.ctx.companyId,n,e.ctx.terminalId,e.ctx.userId,t.opening_cents,Ne(new Date,o.timezone,o.day_cutoff)]).catch(s=>{throw s.code==="23505"?b("J\xE1 existe caixa aberto nest\
e terminal","cash_open"):s});await g({query:d},e.ctx,"caixa.aberto",{entity:"cash",entityId:i.rows[0].id,unitId:n,data:t}),a.status(201).json({id:i.rows[0].id})}));nt.post("/:id/mo\
vements",p(async(e,a)=>{let t=w(be.object({kind:be.enum(["sangria","suprimento","despesa"]),amount_cents:be.number().int().positive().max(1e7),reason:be.string().trim().min(3).max(
200)}),e.body);Q(e.ctx,t.kind==="suprimento"?"caixa.suprimento":"caixa.sangria");let n=await k(async o=>{let i=(await o.query("select * from cash_sessions where id = $1 and company\
_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Caixa n\xE3o encontrado");if(i.status!=="aberto")throw b("Caixa fechado");if(t.kind!=="supriment\
o"){let r=await gn(o,i.id);if(t.amount_cents>r.byMethod.dinheiro)throw f("Valor maior que o dinheiro esperado na gaveta")}let s=await o.query("insert into cash_movements (company_i\
d, cash_session_id, kind, amount_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,i.id,t.kind,t.amount_cents,t.reason,e.ctx.userId]);return await g(
o,e.ctx,`caixa.${t.kind}`,{entity:"cash",entityId:i.id,reason:t.reason,data:{amount_cents:t.amount_cents}}),{id:s.rows[0].id}});a.status(201).json(n)}));nt.post("/:id/close",y("cai\
xa.fechar"),p(async(e,a)=>{let t=w(be.object({counted:be.object(Object.fromEntries(ra.map(o=>[o,be.number().int().min(0).max(1e8).default(0)]))),notes:be.record(be.string(),be.number().
int().min(0).max(1e5)).optional(),justification:be.string().trim().max(300).optional()}),e.body),n=await k(async o=>{let i=(await o.query("select * from cash_sessions where id = $1\
 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Caixa n\xE3o encontrado");if(i.status!=="aberto")throw b("Caixa j\xE1 fechado");let s=await gn(
o,i.id),r=Object.fromEntries(ra.map(m=>[m,(t.counted[m]||0)-(s.byMethod[m]||0)])),c=Object.values(r).reduce((m,u)=>m+u,0);if(Object.values(r).some(m=>m!==0)&&!t.justification)throw f(
"H\xE1 diferen\xE7a na confer\xEAncia: informe a justificativa","justification_required");return await o.query(`update cash_sessions set status = 'fechado', closed_at = now(), clos\
ed_by = $2, counted = $3, expected = $4,
                      difference_cents = $5, justification = $6 where id = $1`,[i.id,e.ctx.userId,{...t.counted,notes:t.notes??null},s.byMethod,c,t.justification??null]),await g(o,
e.ctx,"caixa.fechado",{entity:"cash",entityId:i.id,reason:t.justification,data:{difference_cents:c,by_method:r}}),{ok:!0,expected:s.byMethod,counted:t.counted,difference_cents:c,by_method:r}});
a.json(n)}));nt.post("/:id/reopen",y("caixa.reabrir"),p(async(e,a)=>{let t=w(be.object({reason:be.string().trim().min(3).max(200)}),e.body);await k(async n=>{let o=(await n.query("\
select * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw v();if(o.status!=="fechado")throw b("Caixa n\xE3o\
 est\xE1 fechado");if(new Date(o.closed_at)<new Date(Date.now()-48*3600*1e3))throw f("Reabertura permitida at\xE9 48 horas ap\xF3s o fechamento");if((o.terminal_id?await n.query("s\
elect 1 from cash_sessions where terminal_id = $1 and status = 'aberto'",[o.terminal_id]):{rows:[]}).rows[0])throw b("J\xE1 existe outro caixa aberto neste terminal");await n.query(
"update cash_sessions set status = 'aberto', closed_at = null, closed_by = null where id = $1",[o.id]),await g(n,e.ctx,"caixa.reaberto",{entity:"cash",entityId:o.id,reason:t.reason,
data:{previous:{counted:o.counted,difference_cents:o.difference_cents,closed_at:o.closed_at}}})}),a.json({ok:!0})}));nt.get("/",y("financeiro.visualizar"),p(async(e,a)=>{a.json((await d(
`select c.id, c.status, c.opened_at, c.closed_at, c.business_date, c.opening_cents, c.difference_cents, c.justification,
                            u.name as user_name, t.name as terminal_name
                       from cash_sessions c join users u on u.id = c.user_id left join terminals t on t.id = c.terminal_id
                      where c.company_id = $1 order by c.id desc limit 100`,[e.ctx.companyId])).rows)}));nt.get("/:id/report",y("financeiro.visualizar"),p(async(e,a)=>{let t=(await d(
"select * from cash_sessions where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw v();let n=(await d("select m.kind, m.amount_cents, m.rea\
son, m.created_at, u.name user_name from cash_movements m left join users u on u.id = m.user_id where cash_session_id = $1 order by m.id",[t.id])).rows;a.json({cash:t,expected:await gn(
{query:d},t.id),movements:n})}));import{Router as or}from"npm:express@5.2.1";var bn=or();bn.get("/dashboard",p(async(e,a)=>{let t=e.ctx,n=(await d("select id, day_cutoff from units where company_id = $1 and ($2::bigint is null or id = $2) order by id limit \
1",[t.companyId,t.terminalUnitId||t.unitId||null])).rows[0],o=Ne(new Date,t.company.timezone,n?.day_cutoff??5),i=t.can("financeiro.visualizar"),s=(await d(`select
       (select coalesce(sum(i.total_cents),0)::bigint from order_items i join consumption_sessions s on s.id = i.session_id
         where s.company_id = $1 and s.business_date = $2 and i.status = 'ativo' and s.status <> 'cancelada') as consumed_cents,
       -- recebido de fato: fiado n\xE3o \xE9 dinheiro e o uso de cr\xE9dito j\xE1 entrou quando o cr\xE9dito foi lan\xE7ado
       ((select coalesce(sum(amount_cents),0)::bigint from payments where company_id = $1 and business_date = $2 and status = 'confirmado' and method not in ('fiado','saldo_cliente\
'))
        + (select coalesce(sum(a.amount_cents),0)::bigint from customer_account a join cash_sessions cs on cs.id = a.cash_session_id
            where a.company_id = $1 and cs.business_date = $2 and a.method is not null)) as received_cents,
       (select coalesce(sum(amount_cents),0)::bigint from payments where company_id = $1 and business_date = $2 and status = 'confirmado' and method = 'fiado') as fiado_cents,
       (select count(*)::int from consumption_sessions where company_id = $1 and status in ('aberta','em_fechamento')) as open_sessions,
       (select count(*)::int from dining_tables where company_id = $1 and active and status in ('ocupada','conta')) as busy_tables,
       (select count(*)::int from dining_tables where company_id = $1 and active) as total_tables,
       (select count(*)::int from order_items where company_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','preparando')) as preparing,
       (select count(*)::int from cash_sessions where company_id = $1 and business_date = $2 and status = 'fechado' and difference_cents <> 0) as cash_differences,
       (select count(*)::int from cash_sessions where company_id = $1 and status = 'aberto') as open_cash,
       (select count(*)::int from products where company_id = $1 and demo) as demo_products`,[t.companyId,o])).rows[0],r=i?(await d(`select extract(hour from p.created_at at time z\
one $3)::int as hour, sum(p.amount_cents)::bigint as cents
       from payments p where p.company_id = $1 and p.business_date = $2 and p.status = 'confirmado' and p.method not in ('fiado','saldo_cliente') group by 1 order by 1`,[t.companyId,
o,t.company.timezone])).rows:null,c=(await d(`select i.description, sum(i.qty)::numeric as qty ${i?", sum(i.total_cents)::bigint as cents":""}
       from order_items i join consumption_sessions s on s.id = i.session_id
      where s.company_id = $1 and s.business_date = $2 and i.status = 'ativo' group by 1 order by 2 desc limit 5`,[t.companyId,o])).rows;i||(delete s.consumed_cents,delete s.received_cents,
delete s.fiado_cents,delete s.cash_differences),a.json({business_date:o,...s,by_hour:r,top:c,access:t.access,pending_modules:["delivery","estoque","cozinha","clientes","marketing",
"agente","fiscal","relatorios"]})}));bn.get("/search",p(async(e,a)=>{let t=String(e.query.q||"").trim().slice(0,60);if(t.length<2)return a.json([]);let n=e.ctx,o=`%${t}%`,i=[];if(n.
can("cardapio.visualizar")){let s=await d("select id, name from products where company_id = $1 and (name ilike $2 or sku = $3) order by name limit 6",[n.companyId,o,t]);i.push(...s.
rows.map(r=>({type:"produto",id:r.id,label:r.name,to:`/cardapio?produto=${r.id}`})))}if(n.can("pdv.lancar")){let s=Number(t.replace(/\D/g,""));if(s){let c=await d(`select s.id, c.n\
umber card, t.number tbl, s.status from consumption_sessions s left join tab_cards c on c.id = s.card_id
                          left join dining_tables t on t.id = s.table_id
                          where s.company_id = $1 and (c.number = $2 or t.number = $2 or s.id = $2) and s.status in ('aberta','em_fechamento') limit 6`,[n.companyId,s]);i.push(...c.
rows.map(m=>({type:"consumo",id:m.id,label:m.card?`Comanda ${m.card}`:m.tbl?`Mesa ${m.tbl}`:`Consumo ${m.id}`,to:`/pdv?sessao=${m.id}`})))}let r=await d(`select s.id, s.customer_na\
me, s.label from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')
                         and (s.customer_name ilike $2 or s.label ilike $2) limit 5`,[n.companyId,o]);i.push(...r.rows.map(c=>({type:"consumo",id:c.id,label:c.customer_name||c.label,
to:`/pdv?sessao=${c.id}`})))}if(n.can("usuarios.gerenciar")){let s=await d("select id, name from users where company_id = $1 and name ilike $2 limit 4",[n.companyId,o]);i.push(...s.
rows.map(r=>({type:"usuario",id:r.id,label:r.name,to:"/configuracoes/usuarios"})))}a.json(i)}));import{Router as ir}from"npm:express@5.2.1";import{z as D}from"npm:zod@4.6.5";var $e=ir(),Zo=D.object({name:D.string().trim().min(2).max(100),cpf:D.string().max(20).optional().nullable(),phone:D.string().trim().max(30).optional().nullable(),email:D.string().
trim().email().max(120).optional().nullable().or(D.literal("")),birthday:D.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(D.literal("")),address:D.object({street:D.
string().max(120).optional(),number:D.string().max(20).optional(),district:D.string().max(80).optional(),city:D.string().max(80).optional(),complement:D.string().max(80).optional(),
reference:D.string().max(120).optional()}).partial().optional(),tags:D.array(D.string().trim().min(1).max(30)).max(20).optional(),preferences:D.string().max(300).optional().nullable(),
notes:D.string().max(500).optional().nullable(),consent_whatsapp:D.boolean().optional(),consent_email:D.boolean().optional()}),Qo=e=>{let a=ke(e);return a?a.slice(-13):null};async function ei(e,a,t){
if(!t.length)return{};let n=await e.query(`select s.customer_id, count(*)::int as visits, max(s.closed_at) as last_visit,
            coalesce(sum((select coalesce(sum(i.total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo')),0)::bigint as spent_cents
       from consumption_sessions s where s.company_id = $1 and s.customer_id = any($2) and s.status = 'encerrada' group by s.customer_id`,[a,t]);return Object.fromEntries(n.rows.map(
o=>[o.customer_id,o]))}$e.get("/lookup",y("clientes.visualizar"),p(async(e,a)=>{let t=_n(e.query.cpf,{required:!0}),n=(await d("select * from customers where company_id = $1 and cp\
f = $2 and anonymized_at is null",[e.ctx.companyId,t])).rows[0];if(!n)return a.json({found:!1,cpf:yn(t)});let o=(await d(`select s.id, s.kind, t.number as table_number, cd.number a\
s card_number from consumption_sessions s
      left join dining_tables t on t.id = s.table_id left join tab_cards cd on cd.id = s.card_id
     where s.company_id = $1 and s.customer_id = $2 and s.status in ('aberta','em_fechamento') limit 3`,[e.ctx.companyId,n.id])).rows;a.json({found:!0,customer:{id:n.id,name:n.name,
points:n.points,tags:n.tags,preferences:n.preferences},open_sessions:o})}));$e.get("/",y("clientes.visualizar"),p(async(e,a)=>{let t=[e.ctx.companyId],n="c.company_id = $1 and c.an\
onymized_at is null",o=String(e.query.q||"").trim().slice(0,80);if(o){let u=ke(o);t.push(`%${o.toLowerCase()}%`),n+=` and (lower(c.name) like $${t.length}`,u.length>=3&&(t.push(`%${u}\
%`),n+=` or c.cpf like $${t.length} or regexp_replace(coalesce(c.phone,''),'\\D','','g') like $${t.length}`),n+=")"}e.query.tag&&(t.push(String(e.query.tag)),n+=` and $${t.length} \
= any(c.tags)`),e.query.birthday==="mes"&&(n+=" and extract(month from c.birthday) = extract(month from current_date)");let i=Math.min(200,Number(e.query.limit)||50),s=Math.max(0,Number(
e.query.offset)||0),r=(await d(`select count(*)::int as n from customers c where ${n}`,t)).rows[0].n,c=(await d(`select c.* from customers c where ${n} order by lower(c.name) limit\
 ${i} offset ${s}`,t)).rows,m=await ei({query:d},e.ctx.companyId,c.map(u=>u.id));a.json({total:r,items:c.map(u=>tt({...u,...m[u.id]||{visits:0,spent_cents:0,last_visit:null}},e.ctx))})}));
$e.get("/summary",y("clientes.visualizar"),p(async(e,a)=>{let t=(await d(`select count(*)::int as total,
      count(*) filter (where extract(month from birthday) = extract(month from current_date))::int as birthdays,
      count(*) filter (where consent_whatsapp and unsubscribed_at is null)::int as whatsapp_ok,
      coalesce(sum(points),0)::int as points
    from customers where company_id = $1 and anonymized_at is null`,[e.ctx.companyId])).rows[0],n=(await d("select t as tag, count(*)::int as n from customers, unnest(tags) t where\
 company_id = $1 and anonymized_at is null group by t order by n desc limit 20",[e.ctx.companyId])).rows,o=(await d("select settings from companies where id = $1",[e.ctx.companyId])).
rows[0];a.json({...t,tags:n,loyalty:fn(o.settings)})}));$e.put("/loyalty",y("clientes.gerenciar","configuracoes.gerenciar"),p(async(e,a)=>{let t=w(D.object({enabled:D.boolean(),cents_per_point:D.
number().int().min(1).max(1e5),point_value_cents:D.number().int().min(1).max(1e4),validity_days:D.number().int().min(7).max(3650),min_redeem:D.number().int().min(1).max(1e5)}),e.body);
await d("update companies set settings = jsonb_set(settings, '{loyalty}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await g({query:d},e.ctx,"fidelidade.configu\
racao",{data:t}),a.json({ok:!0})}));$e.get("/:id",y("clientes.visualizar"),p(async(e,a)=>{let t=Number(e.params.id);await k(m=>ia(m,e.ctx.companyId,t));let n=(await d("select * fro\
m customers where id = $1 and company_id = $2",[t,e.ctx.companyId])).rows[0];if(!n)throw v("Cliente n\xE3o encontrado");let o=(await ei({query:d},e.ctx.companyId,[t]))[t]||{visits:0,
spent_cents:0,last_visit:null},i=(await d(`select s.id, s.kind, s.opened_at, s.closed_at, s.status,
       (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
       (select string_agg(i.description, ', ' order by i.id) from (select description, id from order_items where session_id = s.id and status = 'ativo' limit 6) i) as items
     from consumption_sessions s where s.company_id = $1 and s.customer_id = $2 order by s.opened_at desc limit 30`,[e.ctx.companyId,t])).rows,s=(await d("select id, kind, points, \
expires_at, reason, session_id, created_at from loyalty_ledger where company_id = $1 and customer_id = $2 order by id desc limit 50",[e.ctx.companyId,t])).rows,r=(await d("select i\
d, score, comment, created_at from reviews where company_id = $1 and customer_id = $2 order by id desc limit 10",[e.ctx.companyId,t])).rows,c=o.visits?Math.round(Number(o.spent_cents)/
o.visits):0;a.json({customer:tt({...n,...o},e.ctx),ticket_cents:c,history:i,ledger:s,reviews:r})}));function ti(e,a){return{cpf:e.cpf!==void 0?_n(e.cpf):void 0,phone:e.phone!==void 0?
e.phone||null:void 0,email:e.email!==void 0?e.email||null:void 0,birthday:e.birthday!==void 0?e.birthday||null:void 0,consent_at:e.consent_whatsapp||e.consent_email?new Date:void 0,
by:a.userId}}async function sr(e,a,t){let n=ti(t,a);if(n.phone&&Qo(n.phone).length<10)throw f("Telefone deve ter DDD");let o=await e.query(`insert into customers (company_id, cpf, \
name, phone, email, birthday, address, tags, preferences, notes, consent_whatsapp, consent_email, consent_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,[a.companyId,n.cpf??null,t.name,n.phone??null,n.email??null,n.birthday??null,t.address||{},t.tags||[],t.preferences??
null,t.notes??null,!!t.consent_whatsapp,!!t.consent_email,n.consent_at??null,a.userId]).catch(i=>{throw i.code==="23505"?b("J\xE1 existe cliente com este CPF","cpf_in_use"):i});return await g(
e,a,"cliente.criado",{entity:"customer",entityId:o.rows[0].id,data:{consent_whatsapp:!!t.consent_whatsapp,consent_email:!!t.consent_email}}),o.rows[0]}$e.post("/",y("clientes.geren\
ciar"),p(async(e,a)=>{let t=w(Zo,e.body),n=await k(o=>sr(o,e.ctx,t));a.status(201).json(tt(n,e.ctx))}));$e.put("/:id",y("clientes.gerenciar"),p(async(e,a)=>{let t=w(Zo.partial(),e.
body),n=Number(e.params.id),o=await k(async i=>{let s=(await i.query("select * from customers where id = $1 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!s)throw v(
"Cliente n\xE3o encontrado");if(s.anonymized_at)throw b("Cliente anonimizado n\xE3o pode ser editado");if(!e.ctx.can("dados.pessoais"))for(let u of["cpf","phone","email","birthday",
"address"])delete t[u];let r=ti(t,e.ctx),c=t.consent_whatsapp!==void 0&&t.consent_whatsapp!==s.consent_whatsapp||t.consent_email!==void 0&&t.consent_email!==s.consent_email,m=await i.
query(`update customers set name = coalesce($3,name), cpf = case when $4::boolean then $5 else cpf end, phone = case when $6::boolean then $7 else phone end,
         email = case when $8::boolean then $9 else email end, birthday = case when $10::boolean then $11::date else birthday end,
         address = coalesce($12,address), tags = coalesce($13,tags), preferences = coalesce($14,preferences), notes = coalesce($15,notes),
         consent_whatsapp = coalesce($16,consent_whatsapp), consent_email = coalesce($17,consent_email),
         consent_at = case when $18::boolean then now() else consent_at end,
         unsubscribed_at = case when coalesce($16,false) or coalesce($17,false) then null else unsubscribed_at end, updated_at = now()
       where id = $1 and company_id = $2 returning *`,[n,e.ctx.companyId,t.name??null,r.cpf!==void 0,r.cpf??null,r.phone!==void 0,r.phone??null,r.email!==void 0,r.email??null,r.birthday!==
void 0,r.birthday??null,t.address??null,t.tags??null,t.preferences??null,t.notes??null,t.consent_whatsapp??null,t.consent_email??null,c]).catch(u=>{throw u.code==="23505"?b("J\xE1 exi\
ste cliente com este CPF","cpf_in_use"):u});return await g(i,e.ctx,c?"cliente.consentimento":"cliente.alterado",{entity:"customer",entityId:n,data:{fields:Object.keys(t),consent_whatsapp:t.
consent_whatsapp,consent_email:t.consent_email}}),m.rows[0]});a.json(tt(o,e.ctx))}));$e.post("/:id/points",y("clientes.gerenciar","pdv.autorizar"),p(async(e,a)=>{let t=w(D.object({
points:D.number().int().refine(i=>i!==0).refine(i=>Math.abs(i)<=1e5),reason:D.string().trim().min(3).max(200)}),e.body),n=Number(e.params.id),o=await k(async i=>{let s=(await i.query(
"select points from customers where id = $1 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!s)throw v("Cliente n\xE3o encontrado");if(s.points+t.points<0)throw b(
"Saldo n\xE3o pode ficar negativo");let r=await wt(i,e.ctx.companyId,n,{kind:"ajuste",points:t.points,reason:t.reason,user_id:e.ctx.userId});return await g(i,e.ctx,"cliente.pontos_\
ajustados",{entity:"customer",entityId:n,reason:t.reason,data:{points:t.points}}),r});a.status(201).json(o)}));$e.post("/:id/redeem",y("pdv.receber"),p(async(e,a)=>{let t=w(D.object(
{session_id:D.number().int(),points:D.number().int().positive(),idempotency_key:D.string().regex(/^[A-Za-z0-9_-]{8,80}$/)}),e.body),n=Number(e.params.id),o=await d("select * from p\
ayments where company_id = $1 and idempotency_key = $2",[e.ctx.companyId,t.idempotency_key]);if(o.rows[0])return a.json({payment:o.rows[0],replay:!0});let i=await k(async s=>{let r=await se(
s,e.ctx.companyId,t.session_id);if(Oe(e.ctx,r.unit_id),!["aberta","em_fechamento"].includes(r.status))throw b("Consumo encerrado","session_not_open");if(Number(r.customer_id)!==n)throw b(
"O consumo n\xE3o est\xE1 identificado com este cliente","customer_mismatch");await ia(s,e.ctx.companyId,n);let c=(await s.query("select settings, timezone from companies where id \
= $1",[e.ctx.companyId])).rows[0],m=fn(c.settings);if(!m.enabled)throw b("Programa de fidelidade desligado");if(t.points<m.min_redeem)throw f(`Resgate m\xEDnimo de ${m.min_redeem} \
pontos`);let u=t.points*m.point_value_cents,l=await K(s,r.id);if(u>l.balance)throw f("Valor do resgate maior que o saldo do consumo","over_balance");let _=(await s.query("select da\
y_cutoff from units where id = $1",[r.unit_id])).rows[0],h=(await s.query(`insert into payments (company_id, session_id, method, amount_cents, business_date, idempotency_key, user_\
id)
       values ($1,$2,'vale',$3,$4,$5,$6) returning *`,[e.ctx.companyId,r.id,u,Ne(new Date,c.timezone,_.day_cutoff),t.idempotency_key,e.ctx.userId])).rows[0];return await Fo(s,e.ctx,
n,t.points,h.id,r.id),await s.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),await g(s,e.ctx,"cliente.pontos_resgatados",{entity:"payment",entityId:h.
id,unitId:r.unit_id,data:{customer:n,points:t.points,amount_cents:u}}),{payment:h,totals:await K(s,r.id)}});a.status(201).json(i)}));$e.post("/attach",y("pdv.lancar"),p(async(e,a)=>{
let t=w(D.object({session_id:D.number().int(),customer_id:D.number().int().nullable()}),e.body),n=await k(async o=>{let i=await se(o,e.ctx.companyId,t.session_id);if(Oe(e.ctx,i.unit_id),
!["aberta","em_fechamento"].includes(i.status))throw b("Consumo encerrado","session_not_open");let s=null;if(t.customer_id){let r=(await o.query("select name from customers where i\
d = $1 and company_id = $2 and anonymized_at is null",[t.customer_id,e.ctx.companyId])).rows[0];if(!r)throw v("Cliente n\xE3o encontrado");s=r.name}return await o.query("update con\
sumption_sessions set customer_id = $2, customer_name = coalesce($3, customer_name), version = version + 1 where id = $1",[i.id,t.customer_id,s]),await g(o,e.ctx,"consumo.cliente",
{entity:"session",entityId:i.id,data:{customer:t.customer_id}}),{ok:!0,customer_name:s}});a.json(n)}));$e.get("/export/csv",y("clientes.gerenciar"),p(async(e,a)=>{let t=(await d("s\
elect * from customers where company_id = $1 and anonymized_at is null order by name",[e.ctx.companyId])).rows,o=[["nome","cpf","telefone","email","aniversario","etiquetas","pontos",
"whatsapp","email_ok"].join(";")];for(let i of t){let s=tt(i,e.ctx);o.push([s.name,s.cpf,s.phone,s.email,s.birthday,(s.tags||[]).join("|"),s.points,s.consent_whatsapp?"sim":"nao",s.
consent_email?"sim":"nao"].map(vt).join(";"))}await g({query:d},e.ctx,"cliente.exportados",{data:{count:t.length,full:e.ctx.can("dados.pessoais")}}),a.setHeader("content-type","tex\
t/csv; charset=utf-8"),a.setHeader("content-disposition",'attachment; filename="clientes.csv"'),a.send(`\uFEFF${o.join(`
`)}`)}));var Yo=e=>String(e||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();function rr(e){let a=String(e||"").trim(),t=a.match(
/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);return t?`${t[3]}-${t[2].padStart(2,"0")}-${t[1].padStart(2,"0")}`:(t=a.match(/^(\d{4})-(\d{2})-(\d{2})/),t?`${t[1]}-${t[2]}-${t[3]}`:/^\d{4,5}(\.\d+)?$/.
test(a)&&Number(a)>1&&Number(a)<8e4?new Date(Math.round((Number(a)-25569)*864e5)).toISOString().slice(0,10):null)}$e.post("/import",y("clientes.gerenciar","dados.pessoais"),p(async(e,a)=>{
let t=w(D.object({rows:D.array(D.record(D.string(),D.any())).max(5e3),dry_run:D.boolean().default(!0)}),e.body),n=($,...N)=>{for(let P of Object.keys($))if(N.includes(P.toLowerCase().
trim())){let T=String($[P]??"").trim();if(T)return T}return""},o=(await d("select name, cpf, regexp_replace(coalesce(phone,''),'\\D','','g') as phone from customers where company_id\
 = $1 and anonymized_at is null",[e.ctx.companyId])).rows,i=new Set(o.map($=>$.cpf).filter(Boolean)),s=new Set(o.map($=>$.phone).filter(Boolean)),r=new Set(o.filter($=>!$.cpf).map(
$=>Yo($.name))),c=new Map,m=new Map,u=new Map,l=[],_=[];t.rows.forEach(($,N)=>{let P=Number.isInteger(Number($._line))&&Number($._line)>0?Number($._line):N+2,T=n($,"nome","name","c\
liente","nome do cliente","nome completo","razao social","raz\xE3o social"),q=n($,"cpf","documento","cpf ou cnpj","cpf/cnpj","cnpj"),E=Qo(n($,"telefone","celular","whatsapp","phone",
"telefone principal","fone","telefone 1")),W=n($,"email","e-mail","e mail"),Y=rr(n($,"aniversario","anivers\xE1rio","nascimento","data de nascimento","birthday")),U={line:P,name:T.
slice(0,100),cpf:null,phone:E||null};if(T.length<2)return l.push({...U,status:"erro",message:"Nome ausente"});let H=null,de=[],I=ke(q);if(I)if(I.length===14)de.push("CNPJ n\xE3o \xE9 gua\
rdado (entra sem documento)");else try{H=_n(I.padStart(11,"0"))}catch{de.push("CPF inv\xE1lido (entra sem CPF)")}U.cpf=H?yn(H):null;let B=Yo(T),oe=H&&c.get(H)||!H&&E&&m.get(E)||!H&&
!E&&u.get(B);if(oe)return l.push({...U,status:"repetido",message:`Igual \xE0 linha ${oe}`});if(H&&i.has(H))return l.push({...U,status:"duplicado",message:"CPF j\xE1 cadastrado"});if(!H&&
E&&s.has(E))return l.push({...U,status:"duplicado",message:"Telefone j\xE1 cadastrado"});if(!H&&!E&&r.has(B))return l.push({...U,status:"duplicado",message:"Nome j\xE1 cadastrado (sem\
 CPF nem telefone para diferenciar)"});H&&c.set(H,P),E&&m.set(E,P),u.has(B)||u.set(B,P),_.push({name:T.slice(0,100),cpf:H,phone:E,email:/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(W)?W.slice(
0,120):null,birthday:Y}),l.push({...U,status:de.length?"aviso":"ok",message:de.join("; ")||null})}),!t.dry_run&&_.length&&await k(async $=>{for(let N of _)await $.query("insert int\
o customers (company_id, cpf, name, phone, email, birthday, created_by) values ($1,$2,$3,$4,$5,$6,$7)",[e.ctx.companyId,N.cpf,N.name,N.phone,N.email,N.birthday,e.ctx.userId]);await g(
$,e.ctx,"cliente.importados",{data:{count:_.length,skipped:t.rows.length-_.length}})});let h=$=>l.filter(N=>N.status===$).length;a.json({dry_run:t.dry_run,valid:_.length,summary:{ok:h(
"ok"),aviso:h("aviso"),repetido:h("repetido"),duplicado:h("duplicado"),erro:h("erro")},report:l})}));$e.post("/:id/anonymize",y("clientes.gerenciar","dados.pessoais"),p(async(e,a)=>{
let t=w(D.object({reason:D.string().trim().min(3).max(200)}),e.body);Q(e.ctx,"pdv.autorizar");let n=Number(e.params.id);await k(async o=>{if(!(await o.query(`update customers set n\
ame = 'Cliente anonimizado', cpf = null, phone = null, email = null, birthday = null,
        address = '{}', tags = '{}', preferences = null, notes = null, consent_whatsapp = false, consent_email = false, anonymized_at = now(), updated_at = now()
      where id = $1 and company_id = $2 and anonymized_at is null returning id`,[n,e.ctx.companyId])).rows[0])throw v("Cliente n\xE3o encontrado");await o.query("update consumption\
_sessions set customer_name = null where company_id = $1 and customer_id = $2",[e.ctx.companyId,n]),await o.query("update delivery_orders set customer_name = 'Anonimizado', phone =\
 '', address = '{}' where company_id = $1 and customer_id = $2",[e.ctx.companyId,n]),await g(o,e.ctx,"cliente.anonimizado",{entity:"customer",entityId:n,reason:t.reason})}),a.json(
{ok:!0})}));import{Router as cr}from"npm:express@5.2.1";import{z as le}from"npm:zod@4.6.5";var Ie=cr(),ni=(...e)=>(a,t,n)=>e.some(o=>a.ctx.can(o))?n():n(G("Sem permiss\xE3o para o painel")),$n=["novo","aceito","preparando","pronto","entregue"];Ie.get("/sectors",y("cozinh\
a.operar"),p(async(e,a)=>{a.json((await d(`select s.id, s.name, s.target_minutes,
      (select count(*)::int from order_items i where i.sector_id = s.id and i.sent_at is not null and i.status = 'ativo'
         and i.kitchen_status in ('novo','aceito','preparando')) as open_count
    from production_sectors s where s.company_id = $1 and s.active order by s.id`,[e.ctx.companyId])).rows)}));Ie.put("/sectors/:id",y("cardapio.gerenciar"),p(async(e,a)=>{let t=w(
le.object({target_minutes:le.number().int().min(1).max(240)}),e.body);if(!(await d("update production_sectors set target_minutes = $3 where id = $1 and company_id = $2 returning id",
[Number(e.params.id),e.ctx.companyId,t.target_minutes])).rows[0])throw v();a.json({ok:!0})}));Ie.get("/queue",y("cozinha.operar"),p(async(e,a)=>{let t=[e.ctx.companyId],n=`i.compan\
y_id = $1 and i.sent_at is not null and i.kitchen_status <> 'nao_produz'
    and (i.kitchen_status in ('novo','aceito','preparando','pronto')
         or (i.kitchen_status = 'cancelado' and i.cancel_ack_at is null and i.accepted_at is not null)
         or (i.kitchen_status = 'cancelado' and i.cancel_ack_at is null and i.canceled_at > now() - interval '30 minutes'))`;e.query.sector_id&&(t.push(Number(e.query.sector_id)),n+=
` and i.sector_id = $${t.length}`);let o=e.ctx.terminalUnitId||e.ctx.unitId;o&&(t.push(o),n+=` and s.unit_id = $${t.length}`);let i=(await d(`select i.id, i.session_id, i.descripti\
on, i.qty, i.unit, i.modifiers, i.notes, i.kitchen_status, i.status, i.priority, i.sector_id,
            i.created_at, i.sent_at, i.accepted_at, i.ready_at, i.cancel_reason, i.canceled_at, i.launch_mode,
            s.kind, s.label, s.customer_name, c.number as card_number, t.number as table_number, d.number as delivery_number, d.mode as delivery_mode,
            ps.name as sector_name, ps.target_minutes, u.name as user_name,
            exists(select 1 from order_items o where o.session_id = i.session_id and o.id < i.id and o.sent_at < i.sent_at - interval '1 minute') as added_later
       from order_items i join consumption_sessions s on s.id = i.session_id
       left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join delivery_orders d on d.session_id = s.id left join production_sectors ps on ps.id = i.sector_id
       left join users u on u.id = i.user_id
      where ${n} order by i.priority desc, i.sent_at, i.id limit 400`,t)).rows,s=(await d("select coalesce(max(id),0)::bigint as id from kitchen_events where company_id = $1",[e.ctx.
companyId])).rows[0].id;a.json({now:new Date().toISOString(),last_event:s,items:i})}));Ie.post("/items/:id/status",y("cozinha.operar"),p(async(e,a)=>{let t=w(le.object({to:le.enum(
["aceito","preparando","pronto","entregue"]),from:le.string().optional()}),e.body),n=await k(async o=>{let i=(await o.query("select * from order_items where id = $1 and company_id \
= $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Item n\xE3o encontrado");if(i.kitchen_status===t.to)return{ok:!0,replay:!0,status:i.kitchen_status};
if(i.status!=="ativo"||i.kitchen_status==="cancelado")throw b("Item cancelado: confirme a ci\xEAncia do cancelamento","item_canceled");if(!i.sent_at)throw b("Item ainda n\xE3o enviado\
 \xE0 produ\xE7\xE3o","not_sent");if(t.from&&t.from!==i.kitchen_status)throw b(`O item j\xE1 est\xE1 "${i.kitchen_status}" (alterado em outra tela)`,"status_changed",{status:i.kitchen_status});
let s=$n.indexOf(i.kitchen_status);if($n.indexOf(t.to)<=s)throw b("N\xE3o \xE9 poss\xEDvel voltar a etapa anterior","invalid_transition");return await o.query(`update order_items s\
et kitchen_status = $2,
        accepted_at = coalesce(accepted_at, case when $2 in ('aceito','preparando','pronto','entregue') then now() end),
        ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
        delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`,[i.id,t.to]),await o.query("insert into kitchen_events (company_id, item_id, from_s\
tatus, to_status, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,i.id,i.kitchen_status,t.to,e.ctx.userId]),{ok:!0,status:t.to}});a.json(n)}));Ie.post("/sessions/:id/advance",y(
"cozinha.operar"),p(async(e,a)=>{let t=w(le.object({to:le.enum(["aceito","preparando","pronto","entregue"]),sector_id:le.number().int().optional()}),e.body),n=$n.indexOf(t.to),o=await k(
async i=>{let s=[Number(e.params.id),e.ctx.companyId,$n.slice(0,n)],r="";t.sector_id&&(s.push(t.sector_id),r=` and sector_id = $${s.length}`);let c=(await i.query(`select id, kitch\
en_status from order_items where session_id = $1 and company_id = $2 and status = 'ativo'
      and sent_at is not null and kitchen_status = any($3)${r} order by id for update`,s)).rows;for(let m of c)await i.query(`update order_items set kitchen_status = $2, accepted_a\
t = coalesce(accepted_at, now()),
          ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
          delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`,[m.id,t.to]),await i.query("insert into kitchen_events (company_id, item_id, from\
_status, to_status, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,m.id,m.kitchen_status,t.to,e.ctx.userId]);return{changed:c.length}});a.json(o)}));Ie.post("/items/refuse",y("\
cozinha.operar"),p(async(e,a)=>{let t=w(le.object({item_ids:le.array(le.number().int()).min(1).max(400),reason:le.string().trim().max(200).optional()}),e.body),n=await k(async o=>{
let i=(await o.query(`select id, session_id, description, qty, kitchen_status from order_items where company_id = $1 and id = any($2)
      and status = 'ativo' and sent_at is not null and kitchen_status in ('novo','aceito','preparando','pronto') order by id for update`,[e.ctx.companyId,t.item_ids])).rows;for(let s of i)
await o.query("update order_items set kitchen_status = 'nao_produz' where id = $1",[s.id]),await o.query("insert into kitchen_events (company_id, item_id, from_status, to_status, u\
ser_id) values ($1,$2,$3,'recusado',$4)",[e.ctx.companyId,s.id,s.kitchen_status,e.ctx.userId]);return i.length&&await g(o,e.ctx,"producao.recusado",{entity:"session",entityId:i[0].
session_id,reason:t.reason||null,data:{itens:i.map(s=>({id:s.id,item:`${Number(s.qty)}\xD7 ${s.description}`,etapa:s.kitchen_status}))}}),{refused:i.length}});a.json(n)}));Ie.post(
"/items/:id/ack-cancel",y("cozinha.operar"),p(async(e,a)=>{let t=await d("update order_items set cancel_ack_at = now() where id = $1 and company_id = $2 and kitchen_status = 'cance\
lado' and cancel_ack_at is null returning id",[Number(e.params.id),e.ctx.companyId]);t.rows[0]&&await d("insert into kitchen_events (company_id, item_id, from_status, to_status, us\
er_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,t.rows[0].id,"cancelado","cancelado_ciente",e.ctx.userId]),a.json({ok:!0})}));Ie.post("/items/:id/priority",y("cozinha.operar"),p(async(e,a)=>{
let t=w(le.object({priority:le.boolean(),reason:le.string().trim().min(3).max(200)}),e.body);Q(e.ctx,"pdv.autorizar");let n=await d("update order_items set priority = $3 where id =\
 $1 and company_id = $2 returning id, session_id",[Number(e.params.id),e.ctx.companyId,t.priority]);if(!n.rows[0])throw v();await g({query:d},e.ctx,"producao.prioridade",{entity:"i\
tem",entityId:n.rows[0].id,reason:t.reason,data:{priority:t.priority}}),a.json({ok:!0})}));Ie.get("/ready",y("pdv.lancar"),p(async(e,a)=>{a.json((await d(`select i.id, i.descriptio\
n, i.qty, i.ready_at, s.id as session_id, s.label, c.number as card_number, t.number as table_number
     from order_items i join consumption_sessions s on s.id = i.session_id left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
     where i.company_id = $1 and i.kitchen_status = 'pronto' and i.status = 'ativo' order by i.ready_at limit 100`,[e.ctx.companyId])).rows)}));Ie.get("/stats",y("cozinha.operar"),
p(async(e,a)=>{let t=(await d(`select ps.name as sector, count(*)::int as items,
      round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::numeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
     from order_items i join production_sectors ps on ps.id = i.sector_id
    where i.company_id = $1 and i.ready_at is not null and i.sent_at > now() - interval '24 hours' group by ps.name order by ps.name`,[e.ctx.companyId])).rows;a.json(t)}));Ie.get("\
/board",ni("pdv.lancar","cozinha.operar"),p(async(e,a)=>{let t=e.ctx.terminalUnitId||e.ctx.unitId,n=[e.ctx.companyId],o="";t&&(n.push(t),o=` and s.unit_id = $${n.length}`);let i=(await d(
`
    select s.id, s.kind, s.label, s.customer_name, c.number as card_number, t.number as table_number, d.number as delivery_number, d.mode as delivery_mode,
           i.sector_id, ps.name as sector_name,
           count(*) filter (where i.kitchen_status in ('novo','aceito','preparando'))::int as pending,
           count(*) filter (where i.kitchen_status = 'pronto')::int as ready,
           min(i.sent_at) as sent_at, max(i.ready_at) as ready_at,
           coalesce(json_agg(json_build_object('d', i.description, 'q', i.qty, 's', i.kitchen_status) order by i.id), '[]') as items,
           (select max(e.created_at) from kitchen_events e join order_items i2 on i2.id = e.item_id
             where i2.session_id = s.id and i2.sector_id is not distinct from i.sector_id and e.to_status = 'chamado') as called_at
      from order_items i join consumption_sessions s on s.id = i.session_id
      left join production_sectors ps on ps.id = i.sector_id
      left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id left join delivery_orders d on d.session_id = s.id
     where i.company_id = $1${o} and i.status = 'ativo' and i.sent_at is not null
       and i.kitchen_status in ('novo','aceito','preparando','pronto')
       and (s.status in ('aberta','em_fechamento') or (s.status = 'encerrada' and s.closed_at > now() - interval '6 hours')
            or exists (select 1 from kitchen_events e3 join order_items i3 on i3.id = e3.item_id
                        where i3.session_id = s.id and e3.to_status = 'chamado' and e3.created_at > now() - interval '15 minutes'))
       and coalesce(d.status, '') not in ('saiu','entregue','cancelado')
     group by s.id, c.number, t.number, d.number, d.mode, i.sector_id, ps.name
     order by min(i.sent_at)
     limit 240`,n)).rows,s=u=>u?String(u).trim().split(/\s+/)[0]:null,r=(await d("select coalesce(max(id),0)::bigint as id from kitchen_events where company_id = $1",[e.ctx.companyId])).
rows[0].id,c=u=>({id:u.id,key:`${u.id}-${u.sector_id??0}`,code:u.delivery_number?`#${u.delivery_number}`:u.card_number?String(u.card_number):u.table_number?String(u.table_number):String(
u.id),kind:u.delivery_number?u.delivery_mode==="retirada"?"retirada":"delivery":u.card_number?"comanda":u.table_number?"mesa":u.kind,table:u.card_number&&u.table_number?u.table_number:
null,name:s(u.customer_name),sector_id:u.sector_id,sector:u.sector_name||"Pedidos",status:u.ready>0?"pronto":"preparando",partial:u.pending>0&&u.ready>0,pending:u.pending,ready_count:u.
ready,sent_at:u.sent_at,ready_at:u.ready_at,called_at:u.called_at,items:u.items.map(l=>({d:l.d,q:Number(l.q),ready:l.s==="pronto"}))}),m=[];for(let u of i){let l=m.find(_=>_.id===(u.
sector_id??0));l||(l={id:u.sector_id??0,name:u.sector_name||"Pedidos",orders:[]},m.push(l)),l.orders.push(c(u))}m.sort((u,l)=>(u.id||1e9)-(l.id||1e9)),a.set("cache-control","no-sto\
re"),a.json({now:new Date().toISOString(),version:String(r),areas:m,orders:i.map(c)})}));Ie.post("/sessions/:id/call",ni("pdv.lancar","cozinha.operar"),p(async(e,a)=>{let t=w(le.object(
{sector_ids:le.array(le.number().int()).max(20).optional()}),e.body||{}),n=(await d(`select distinct on (i.sector_id) i.id, i.kitchen_status, i.sector_id from order_items i join co\
nsumption_sessions s on s.id = i.session_id
      where i.session_id = $1 and i.company_id = $2 and i.status = 'ativo' and i.sent_at is not null and i.kitchen_status in ('novo','aceito','preparando','pronto')
        and s.status <> 'cancelada'
        ${t.sector_ids?.length?"and i.sector_id = any($3)":""}
      order by i.sector_id, (i.kitchen_status = 'pronto') desc, i.id desc`,t.sector_ids?.length?[Number(e.params.id),e.ctx.companyId,t.sector_ids]:[Number(e.params.id),e.ctx.companyId])).
rows;if(!n.length)throw b("Este pedido n\xE3o est\xE1 mais no painel","nothing_to_call");let o=null;for(let i of n)o=(await d("insert into kitchen_events (company_id, item_id, from\
_status, to_status, user_id) values ($1,$2,$3,'chamado',$4) returning created_at",[e.ctx.companyId,i.id,i.kitchen_status,e.ctx.userId])).rows[0].created_at;a.json({ok:!0,called_at:o,
sectors:n.map(i=>i.sector_id)})}));import{Router as wr}from"npm:express@5.2.1";import{z as x}from"npm:zod@4.6.5";var ca=e=>String(e||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),da=e=>ca(e).slice(0,120);async function ai(e){let a=(await d("select\
 key, value from company_secrets where company_id = $1 and key in ('ai_api_key','ai_model')",[e])).rows,t=(await d("select key, value from platform_config where key in ('anthropic_\
api_key','ai_model')").catch(()=>({rows:[]}))).rows,n=(o,i)=>o.find(s=>s.key===i)?.value;return{key:n(a,"ai_api_key")||R.ANTHROPIC_API_KEY||n(t,"anthropic_api_key")||null,model:n(a,
"ai_model")||R.AI_MODEL||n(t,"ai_model")||"claude-sonnet-5-5",url:R.AI_API_URL||"https://api.anthropic.com/v1/messages"}}async function oi(e){return!!(await ai(e)).key}var dr=`Voc\xEA\
 l\xEA documentos de compra de bares e restaurantes no Brasil: nota fiscal (NF-e/DANFE, NFC-e, cupom), pedido de compra,
romaneio ou lista escrita \xE0 m\xE3o. Extraia SOMENTE o que est\xE1 escrito. Responda apenas com JSON v\xE1lido, sem texto antes ou depois, no formato:
{"supplier": string|null, "document": string|null, "date": "AAAA-MM-DD"|null, "total": number|null,
 "items": [{"description": string, "qty": number, "unit": string|null, "unit_price": number|null, "total": number|null}],
 "warnings": [string]}
Regras: n\xFAmeros com ponto decimal (12,50 \u2192 12.5); "unit" como est\xE1 na nota (UN, CX, KG, FD, PCT, L, GF...);
n\xE3o invente itens, pre\xE7os ou quantidades; se algo estiver ileg\xEDvel, deixe null e explique em "warnings";
ignore impostos, descontos gerais e totalizadores (eles n\xE3o s\xE3o itens).`;async function ii(e,a){let t=await ai(e);if(!t.key)throw new z(503,"Leitura por foto n\xE3o configurada:\
 informe a chave da API em Estoque \u203A Leitura de notas, ou use o XML da NF-e.","ai_not_configured");let n=String(a).match(/^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
if(!n)throw new z(400,"Envie uma foto (JPG, PNG ou WEBP) ou PDF","invalid");let o={type:"base64",media_type:n[1],data:n[2]},i=n[1]==="application/pdf"?{type:"document",source:o}:{type:"\
image",source:o},s;try{s=await fetch(t.url,{method:"POST",signal:AbortSignal.timeout(6e4),headers:{"content-type":"application/json","x-api-key":t.key,"anthropic-version":"2023-06-\
01"},body:JSON.stringify({model:t.model,max_tokens:4e3,messages:[{role:"user",content:[i,{type:"text",text:dr}]}]})})}catch(_){throw new z(502,`N\xE3o foi poss\xEDvel ler a foto agora (${String(
_.message||_).slice(0,80)}). Tente de novo.`,"ai_unavailable")}let r=await s.json().catch(()=>({}));if(!s.ok)throw new z(502,`Servi\xE7o de leitura recusou a foto: ${r?.error?.message?.
slice(0,160)||s.status}`,"ai_error");let c=(r.content||[]).filter(_=>_.type==="text").map(_=>_.text).join(""),m=c.slice(c.indexOf("{"),c.lastIndexOf("}")+1),u;try{u=JSON.parse(m)}catch{
throw new z(422,"N\xE3o consegui entender a foto. Tente outra mais n\xEDtida, com a nota inteira e bem iluminada.","ai_unreadable")}let l=_=>_==null||_===""||Number.isNaN(Number(_))?
null:Number(_);return{supplier:u.supplier?String(u.supplier).slice(0,100):null,document:u.document?String(u.document).slice(0,60):null,date:/^\d{4}-\d{2}-\d{2}$/.test(u.date||"")?u.
date:null,total:l(u.total),warnings:(u.warnings||[]).map(String).slice(0,10),items:(u.items||[]).filter(_=>_&&_.description).slice(0,150).map(_=>({description:String(_.description).
slice(0,120),qty:l(_.qty),unit:_.unit?String(_.unit).slice(0,10):null,unit_price:l(_.unit_price),total:l(_.total)}))}}var mr={un:"un",und:"un",unid:"un",pc:"un",p\u00E7:"un",kg:"kg",
g:"g",gr:"g",l:"L",lt:"L",ml:"ml"},ur=e=>mr[ca(e)]||null;async function ma(e,a){let t=(await d("select id, name, unit from stock_items where company_id = $1 and active",[e])).rows,
n=Object.fromEntries((await d("select alias, stock_item_id, factor from stock_aliases where company_id = $1",[e])).rows.map(o=>[o.alias,o]));return a.map(o=>{let i=da(o.description),
s=n[i];if(s&&t.find(u=>Number(u.id)===Number(s.stock_item_id)))return{...o,alias:i,stock_item_id:Number(s.stock_item_id),factor:Number(s.factor),match:"aprendido"};let r=i.split(" ").
filter(u=>u.length>2&&!/^\d+$/.test(u)),c=null,m=0;for(let u of t){let l=ca(u.name).split(" ").filter($=>$.length>2);if(!l.length)continue;let h=l.filter($=>r.some(N=>N.startsWith(
$)||$.startsWith(N))).length/l.length;h>m&&(m=h,c=u)}return{...o,alias:i,stock_item_id:m>.5?Number(c.id):null,factor:1,match:m>.5?"semelhante":"novo",suggested_unit:ur(o.unit)||"un"}})}var si={11:"RO",12:"AC",13:"AM",14:"RR",15:"PA",16:"AP",17:"TO",21:"MA",22:"PI",23:"CE",24:"RN",25:"PB",26:"PE",27:"AL",28:"SE",29:"BA",31:"MG",32:"ES",33:"RJ",35:"SP",41:"PR",42:"\
SC",43:"RS",50:"MS",51:"MT",52:"GO",53:"DF"};function lr(e){let a=0,t=2;for(let o=e.length-1;o>=0;o-=1)a+=Number(e[o])*t,t=t===9?2:t+1;let n=a%11;return n<2?0:11-n}function pr(e){return/^\d{44}$/.
test(e)&&lr(e.slice(0,43))===Number(e[43])&&!!si[e.slice(0,2)]}function _r(e){return{uf:si[e.slice(0,2)],issued:`20${e.slice(2,4)}-${e.slice(4,6)}`,cnpj:e.slice(6,20),model:e.slice(
20,22),series:Number(e.slice(22,25)),number:Number(e.slice(25,34))}}var ri=e=>{let a=0;for(let t=0;t<e.length;t+=1)a+=Number(e[e.length-1-t])*(t%2===0?3:1);return(10-a%10)%10},ua=e=>{
let a=String(e).padStart(8,"0");return`PC${a}${ri(a)}`};function la(e){let a=String(e||"").trim().toUpperCase(),t=a.replace(/\D/g,"");if(/^PC\d{9}$/.test(a.replace(/[\s-]/g,""))){let n=a.
replace(/[\s-]/g,""),o=n.slice(2,10);return ri(o)!==Number(n[10])?{kind:"invalido",message:"C\xF3digo do pedido com d\xEDgito inv\xE1lido. Leia de novo."}:{kind:"pedido",purchase_id:Number(
o)}}if(t.length===44&&/^[\d\s.-]+$/.test(a)){if(!pr(t))return{kind:"invalido",message:"Chave de acesso inv\xE1lida (d\xEDgito verificador n\xE3o confere). Leia de novo."};let n=_r(
t);return["55","65"].includes(n.model)?{kind:"nfe",key:t,info:n}:{kind:"invalido",message:"Este c\xF3digo n\xE3o \xE9 de uma NF-e."}}return{kind:"invalido",message:"C\xF3digo n\xE3o reco\
nhecido. Leia o c\xF3digo de barras do DANFE (44 d\xEDgitos) ou de um pedido de compra do RUSTEN."}}import{Buffer as yr}from"node:buffer";var fr=()=>String(process.env.FOCUS_API_URL||"https://api.focusnfe.com.br").replace(/\/$/,"");async function xn(e){return(await d("select value from company_secrets where company_i\
d = $1 and key = 'focus_token'",[e])).rows[0]?.value||null}async function ci(e,a,{method:t="GET",body:n}={}){let o;try{o=await fetch(`${fr()}${a}`,{method:t,signal:AbortSignal.timeout(
2e4),headers:{authorization:`Basic ${yr.from(`${e}:`).toString("base64")}`,...n?{"content-type":"application/json"}:{}},body:n?JSON.stringify(n):void 0})}catch{throw new z(502,"Foc\
us NFe n\xE3o respondeu. Tente de novo em instantes.","focus_unavailable")}let i=await o.text();return{status:o.status,text:i}}async function di(e,a){let t=await xn(e);if(!t)throw f(
"Busca do XML pela chave n\xE3o configurada. Informe o token da Focus NFe ou importe o arquivo XML.","focus_not_configured");let n=await ci(t,`/v2/nfes_recebidas/${a}.xml`);if(n.status===
200&&/<infNFe[\s>]/.test(n.text)&&n.text.includes(a))return{xml:n.text};if(n.status===401||n.status===403)throw f("A Focus NFe recusou o token. Confira em Estoque \u203A Lan\xE7ar nota.",
"focus_auth");let o=await ci(t,`/v2/nfes_recebidas/${a}/manifesto`,{method:"POST",body:{tipo:"ciencia"}});if(o.status>=500)throw new z(502,"Focus NFe indispon\xEDvel no momento.","\
focus_unavailable");let i=/j[aá] (foi )?(realizad|registrad|manifest)/i.test(o.text);if(o.status>=400&&!i){let s="";try{s=JSON.parse(o.text).mensagem||""}catch{}throw f(`A Focus N\
Fe n\xE3o encontrou esta nota para o CNPJ da empresa${s?`: ${s}`:""}. Importe o XML enviado pelo fornecedor.`,"focus_not_found")}return{pending:!0,message:"Ci\xEAncia da nota registra\
da na SEFAZ. O XML com os itens costuma ficar dispon\xEDvel em alguns minutos: leia o c\xF3digo de novo."}}var V=wr(),hr=["un","kg","g","L","ml"],_a=x.number().positive().max(1e6);V.get("/items",y("estoque.visualizar"),p(async(e,a)=>{let t=(await d(`select s.*, (select coalesce(sum(qty)\
,0) from stock_movements m where m.stock_item_id = s.id)::float as balance,
      (select coalesce(-sum(qty),0) from stock_movements m where m.stock_item_id = s.id and m.kind = 'venda' and m.created_at > now() - interval '30 days')::float as used_30d
    from stock_items s where s.company_id = $1 ${e.query.all?"":"and s.active"} order by lower(s.name)`,[e.ctx.companyId])).rows,n=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.g\
erenciar");a.json(t.map(o=>({...o,avg_cost_cents:n?Number(o.avg_cost_cents):null,status:o.balance<=0?"zerado":o.balance<=Number(o.min_qty)?"baixo":"ok",suggest:Math.max(0,Math.ceil(
(Number(o.reorder_qty)||Number(o.min_qty)*2)+o.used_30d/30*7-o.balance))})))}));var mi=x.object({name:x.string().trim().min(2).max(80),unit:x.enum(hr),min_qty:x.number().min(0).max(
1e6).default(0),reorder_qty:x.number().min(0).max(1e6).default(0),active:x.boolean().default(!0)});V.post("/items",y("estoque.ajustar"),p(async(e,a)=>{let t=w(mi.extend({initial_qty:x.
number().min(0).max(1e6).optional(),unit_cost_cents:x.number().int().min(0).max(1e8).optional()}),e.body),n=await k(async o=>{let i=await o.query("insert into stock_items (company_\
id, name, unit, min_qty, reorder_qty, active) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,t.name,t.unit,t.min_qty,t.reorder_qty,t.active]).catch(s=>{throw s.code==="2\
3505"?b("J\xE1 existe insumo com este nome"):s});return t.initial_qty&&await Ct(o,e.ctx,i.rows[0].id,t.initial_qty,t.unit_cost_cents||0,{type:"saldo_inicial"},"Saldo inicial"),await g(
o,e.ctx,"estoque.insumo_criado",{entity:"stock_item",entityId:i.rows[0].id,data:{name:t.name,initial:t.initial_qty}}),i.rows[0].id});a.status(201).json({id:n})}));V.put("/items/:id",
y("estoque.ajustar"),p(async(e,a)=>{let t=w(mi.partial(),e.body);if(!(await d(`update stock_items set name = coalesce($3,name), unit = coalesce($4,unit), min_qty = coalesce($5,min_\
qty), reorder_qty = coalesce($6,reorder_qty),
      active = coalesce($7,active) where id = $1 and company_id = $2 returning id`,[Number(e.params.id),e.ctx.companyId,t.name??null,t.unit??null,t.min_qty??null,t.reorder_qty??null,
t.active??null])).rows[0])throw v("Insumo n\xE3o encontrado");a.json({ok:!0})}));V.get("/items/:id/movements",y("estoque.visualizar"),p(async(e,a)=>{a.json((await d(`select m.id, m\
.kind, m.qty::float, m.unit_cost_cents, m.ref_type, m.ref_id, m.reverses_id, m.reason, m.created_at, u.name as user_name
     from stock_movements m left join users u on u.id = m.user_id where m.company_id = $1 and m.stock_item_id = $2 order by m.id desc limit 200`,[e.ctx.companyId,Number(e.params.id)])).
rows)}));V.post("/movements",y("estoque.ajustar"),p(async(e,a)=>{let t=w(x.object({stock_item_id:x.number().int(),kind:x.enum(["entrada","perda","ajuste"]),qty:x.number().refine(o=>o!==
0&&Math.abs(o)<=1e6),unit_cost_cents:x.number().int().min(0).max(1e8).optional(),reason:x.string().trim().min(3).max(200)}),e.body),n=await k(async o=>{let i=(await o.query("select\
 * from stock_items where id = $1 and company_id = $2 for update",[t.stock_item_id,e.ctx.companyId])).rows[0];if(!i)throw v("Insumo n\xE3o encontrado");if(t.kind==="entrada"){if(t.
qty<=0)throw f("Entrada deve ser positiva");await Ct(o,e.ctx,i.id,t.qty,t.unit_cost_cents??Math.round(Number(i.avg_cost_cents)),{type:"manual"},t.reason)}else{let s=t.kind==="perda"?
-Math.abs(t.qty):t.qty;await o.query("insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6,$7)",[e.ctx.companyId,
i.id,t.kind,s,i.avg_cost_cents,t.reason,e.ctx.userId])}return await g(o,e.ctx,`estoque.${t.kind}`,{entity:"stock_item",entityId:i.id,reason:t.reason,data:{qty:t.qty}}),{balance:(await Qe(
o,e.ctx.companyId,[i.id]))[i.id]||0}});a.status(201).json(n)}));V.post("/movements/:id/reverse",y("estoque.ajustar"),p(async(e,a)=>{let t=w(x.object({reason:x.string().trim().min(3).
max(200)}),e.body),n=await k(async o=>{let i=(await o.query("select * from stock_movements where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)
throw v("Movimento n\xE3o encontrado");if(!["entrada","perda","ajuste"].includes(i.kind)||i.reverses_id)throw b("Este movimento \xE9 revertido pelo fluxo de origem (venda, compra ou i\
nvent\xE1rio)");return await o.query("insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reverses_id, reason, user_id) values ($1,$2,'reversao',$3,\
$4,$5,$6,$7)",[e.ctx.companyId,i.stock_item_id,-Number(i.qty),i.unit_cost_cents,i.id,t.reason,e.ctx.userId]).catch(s=>{throw s.code==="23505"?b("Movimento j\xE1 revertido"):s}),await g(
o,e.ctx,"estoque.reversao",{entity:"stock_movement",entityId:i.id,reason:t.reason}),{ok:!0}});a.json(n)}));V.get("/recipes",y("estoque.visualizar"),p(async(e,a)=>{let t=(await d(`s\
elect p.id, p.name, p.price_cents, p.cost_cents, p.stock_mode, p.stock_item_id, p.kind, si.name as stock_item_name,
      r.id as recipe_id, r.version, r.yield_qty::float
    from products p left join recipes r on r.product_id = p.id and r.active left join stock_items si on si.id = p.stock_item_id
    where p.company_id = $1 and p.active order by p.name`,[e.ctx.companyId])).rows,n=(await d(`select l.recipe_id, l.stock_item_id, l.qty::float, l.loss_pct::float, s.name, s.unit \
from recipe_lines l join stock_items s on s.id = l.stock_item_id
    where l.company_id = $1 and l.recipe_id = any($2)`,[e.ctx.companyId,t.map(s=>s.recipe_id).filter(Boolean)])).rows,o=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.gerenciar"),
i=[];for(let s of t){let r=o?await aa({query:d},e.ctx.companyId,s):null;i.push({...s,lines:n.filter(c=>c.recipe_id===s.recipe_id),theoretical_cost_cents:r,margin_pct:r!=null&&s.price_cents?
Math.round((s.price_cents-r)/s.price_cents*1e3)/10:null})}a.json(i)}));V.get("/recipes/:productId/history",y("estoque.visualizar"),p(async(e,a)=>{a.json((await d(`select r.id, r.ve\
rsion, r.yield_qty::float, r.active, r.created_at, u.name as user_name,
      (select json_agg(json_build_object('name', s.name, 'qty', l.qty, 'unit', s.unit, 'loss_pct', l.loss_pct)) from recipe_lines l join stock_items s on s.id = l.stock_item_id whe\
re l.recipe_id = r.id) as lines
    from recipes r left join users u on u.id = r.created_by where r.company_id = $1 and r.product_id = $2 order by r.version desc`,[e.ctx.companyId,Number(e.params.productId)])).rows)}));
V.put("/recipes/:productId",y("estoque.ajustar"),p(async(e,a)=>{let t=w(x.object({stock_mode:x.enum(["nenhum","ficha","acabado"]),stock_item_id:x.number().int().nullable().optional(),
yield_qty:x.number().positive().max(1e4).default(1),lines:x.array(x.object({stock_item_id:x.number().int(),qty:x.number().positive().max(1e5),loss_pct:x.number().min(0).max(99).default(
0)})).max(60).default([]),notes:x.string().max(300).optional()}),e.body),n=Number(e.params.productId),o=await k(async i=>{let s=(await i.query("select * from products where id = $1\
 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!s)throw v("Produto n\xE3o encontrado");let r=[...new Set([...t.lines.map(u=>u.stock_item_id),...t.stock_item_id?[
t.stock_item_id]:[]])];if(r.length&&(await i.query("select count(*)::int as n from stock_items where company_id = $1 and id = any($2)",[e.ctx.companyId,r])).rows[0].n!==r.length)throw f(
"Insumo inv\xE1lido");if(t.stock_mode==="acabado"&&!t.stock_item_id)throw f("Escolha o item de estoque do produto acabado");if(t.stock_mode==="ficha"&&!t.lines.length)throw f("A fi\
cha t\xE9cnica precisa de ao menos um insumo");if(new Set(t.lines.map(u=>u.stock_item_id)).size!==t.lines.length)throw f("Insumo repetido na ficha");await i.query("update products \
set stock_mode = $3, stock_item_id = $4, updated_at = now() where id = $1 and company_id = $2",[n,e.ctx.companyId,t.stock_mode,t.stock_mode==="acabado"?t.stock_item_id:null]);let c=null;
if(t.lines.length&&t.stock_mode!=="nenhum"){c=Number((await i.query("select coalesce(max(version),0) as v from recipes where product_id = $1",[n])).rows[0].v)+1,await i.query("upda\
te recipes set active = false where product_id = $1 and active",[n]);let u=await i.query("insert into recipes (company_id, product_id, version, yield_qty, notes, created_by) values\
 ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,n,c,t.yield_qty,t.notes??null,e.ctx.userId]);for(let l of t.lines)await i.query("insert into recipe_lines (company_id, recipe_id\
, stock_item_id, qty, loss_pct) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,u.rows[0].id,l.stock_item_id,l.qty,l.loss_pct])}else await i.query("update recipes set active = false wher\
e product_id = $1 and active",[n]);let m=await aa(i,e.ctx.companyId,{...s,stock_mode:t.stock_mode,stock_item_id:t.stock_mode==="acabado"?t.stock_item_id:null});return t.stock_mode!==
"nenhum"&&await i.query("update products set cost_cents = $3 where id = $1 and company_id = $2",[n,e.ctx.companyId,m]),await g(i,e.ctx,"estoque.ficha",{entity:"product",entityId:n,
data:{mode:t.stock_mode,version:c,lines:t.lines.length}}),{ok:!0,version:c,cost_cents:m}});a.json(o)}));V.get("/purchases",y("estoque.visualizar"),p(async(e,a)=>{let t=(await d(`se\
lect p.*, u.name as user_name,
      (select json_agg(json_build_object('id', l.id, 'stock_item_id', l.stock_item_id, 'name', s.name, 'unit', s.unit, 'qty', l.qty, 'received_qty', l.received_qty,
         'unit_cost_cents', l.unit_cost_cents) order by l.id) from purchase_lines l join stock_items s on s.id = l.stock_item_id where l.purchase_id = p.id) as lines
    from purchases p left join users u on u.id = p.created_by where p.company_id = $1 order by p.id desc limit 100`,[e.ctx.companyId])).rows;a.json(t.map(n=>({...n,code:ua(n.id)})))}));
V.post("/purchases",y("compras.gerenciar"),p(async(e,a)=>{let t=w(x.object({supplier:x.string().trim().min(2).max(100),document:x.string().trim().max(60).optional(),due_date:x.string().
regex(/^\d{4}-\d{2}-\d{2}$/).optional(),notes:x.string().max(300).optional(),lines:x.array(x.object({stock_item_id:x.number().int(),qty:_a,unit_cost_cents:x.number().int().min(0).max(
1e8)})).min(1).max(100)}),e.body),n=await k(async o=>{let i=[...new Set(t.lines.map(m=>m.stock_item_id))];if((await o.query("select count(*)::int as n from stock_items where compan\
y_id = $1 and id = any($2)",[e.ctx.companyId,i])).rows[0].n!==i.length)throw f("Insumo inv\xE1lido");let r=t.lines.reduce((m,u)=>m+Math.round(u.qty*u.unit_cost_cents),0),c=await o.
query("insert into purchases (company_id, supplier, document, due_date, notes, total_cents, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",[e.ctx.companyId,t.supplier,t.document??
null,t.due_date??null,t.notes??null,r,e.ctx.userId]);for(let m of t.lines)await o.query("insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) v\
alues ($1,$2,$3,$4,$5)",[e.ctx.companyId,c.rows[0].id,m.stock_item_id,m.qty,m.unit_cost_cents]);return await g(o,e.ctx,"compra.criada",{entity:"purchase",entityId:c.rows[0].id,data:{
supplier:t.supplier,total_cents:r}}),c.rows[0].id});a.status(201).json({id:n})}));V.post("/purchases/:id/receive",y("compras.gerenciar"),p(async(e,a)=>{let t=w(x.object({lines:x.array(
x.object({line_id:x.number().int(),qty:_a,unit_cost_cents:x.number().int().min(0).max(1e8).optional()})).min(1).max(100)}),e.body),n=await k(async o=>{let i=(await o.query("select \
* from purchases where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Compra n\xE3o encontrada");if(["recebida","cancelada"].
includes(i.status))throw b(`Compra ${i.status}`);for(let c of t.lines){let m=(await o.query("select * from purchase_lines where id = $1 and purchase_id = $2 for update",[c.line_id,
i.id])).rows[0];if(!m)throw f("Linha inv\xE1lida");if(Number(m.received_qty)+c.qty>Number(m.qty)+1e-4)throw f("Quantidade recebida maior que a comprada");let u=c.unit_cost_cents??Number(
m.unit_cost_cents);await o.query("update purchase_lines set received_qty = received_qty + $2, unit_cost_cents = $3 where id = $1",[m.id,c.qty,u]),await Ct(o,e.ctx,m.stock_item_id,c.
qty,u,{type:"purchase",id:i.id},`Compra ${i.id} \u2014 ${i.supplier}`)}let r=(await o.query("select count(*)::int as n from purchase_lines where purchase_id = $1 and received_qty <\
 qty",[i.id])).rows[0].n?"parcial":"recebida";return await o.query(`update purchases set status = $2, total_cents = (select coalesce(sum(round(qty * unit_cost_cents)), 0) from purc\
hase_lines where purchase_id = $1)
      where id = $1`,[i.id,r]),await g(o,e.ctx,"compra.recebida",{entity:"purchase",entityId:i.id,data:{status:r,lines:t.lines.length}}),{status:r}});a.json(n)}));V.post("/purchase\
s/:id/cancel",y("compras.gerenciar"),p(async(e,a)=>{let t=w(x.object({reason:x.string().trim().min(3).max(200)}),e.body),n=await d("update purchases set status = 'cancelada', notes\
 = coalesce(notes,'') || ' [cancelada: ' || $3 || ']' where id = $1 and company_id = $2 and status = 'aberta' returning id",[Number(e.params.id),e.ctx.companyId,t.reason]);if(!n.rows[0])
throw b("S\xF3 compras ainda n\xE3o recebidas podem ser canceladas");await g({query:d},e.ctx,"compra.cancelada",{entity:"purchase",entityId:n.rows[0].id,reason:t.reason}),a.json({ok:!0})}));
V.get("/inventories",y("estoque.visualizar"),p(async(e,a)=>{a.json((await d(`select i.*, u.name as user_name, a.name as approved_name from inventory_counts i left join users u on u\
.id = i.created_by
    left join users a on a.id = i.approved_by where i.company_id = $1 order by i.id desc limit 30`,[e.ctx.companyId])).rows)}));V.post("/inventories",y("estoque.ajustar"),p(async(e,a)=>{
let t=w(x.object({counts:x.array(x.object({stock_item_id:x.number().int(),counted:x.number().min(0).max(1e6)})).min(1).max(500),notes:x.string().max(300).optional()}),e.body),n=await Qe(
{query:d},e.ctx.companyId,t.counts.map(r=>r.stock_item_id)),o=Object.fromEntries((await d("select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any\
($2)",[e.ctx.companyId,t.counts.map(r=>r.stock_item_id)])).rows.map(r=>[r.id,r])),i=t.counts.filter(r=>o[r.stock_item_id]).map(r=>{let c=Math.round((n[r.stock_item_id]||0)*1e3)/1e3,
m=Math.round((r.counted-c)*1e3)/1e3;return{stock_item_id:r.stock_item_id,name:o[r.stock_item_id].name,unit:o[r.stock_item_id].unit,system:c,counted:r.counted,diff:m,value_cents:Math.
round(m*Number(o[r.stock_item_id].avg_cost_cents))}}),s=await d("insert into inventory_counts (company_id, lines, notes, created_by) values ($1,$2,$3,$4) returning id",[e.ctx.companyId,
JSON.stringify(i),t.notes??null,e.ctx.userId]);a.status(201).json({id:s.rows[0].id,lines:i})}));V.post("/inventories/:id/approve",y("estoque.ajustar"),p(async(e,a)=>{Q(e.ctx,"pdv.a\
utorizar");let t=await k(async n=>{let o=(await n.query("select * from inventory_counts where id = $1 and company_id = $2 and status = 'aberto' for update",[Number(e.params.id),e.ctx.
companyId])).rows[0];if(!o)throw b("Invent\xE1rio n\xE3o est\xE1 aberto");if(Number(o.created_by)===Number(e.ctx.userId)&&e.ctx.level<100)throw b("A aprova\xE7\xE3o deve ser feita por ou\
tra pessoa","same_user");let i=await Qe(n,e.ctx.companyId,o.lines.map(r=>r.stock_item_id)),s=0;for(let r of o.lines){let c=Math.round(((i[r.stock_item_id]||0)-r.system)*1e3)/1e3,m=Math.
round((r.counted+c-(i[r.stock_item_id]||0))*1e3)/1e3;Math.abs(m)<5e-4||(await n.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type,\
 ref_id, reason, user_id)
        select $1, id, 'inventario', $3, avg_cost_cents, 'inventory', $4, 'Invent\xE1rio aprovado', $5 from stock_items where id = $2 and company_id = $1`,[e.ctx.companyId,r.stock_item_id,
m,o.id,e.ctx.userId]),s++)}return await n.query("update inventory_counts set status = 'aprovado', approved_by = $2, approved_at = now() where id = $1",[o.id,e.ctx.userId]),await g(
n,e.ctx,"estoque.inventario_aprovado",{entity:"inventory",entityId:o.id,data:{adjustments:s}}),{adjustments:s}});a.json(t)}));V.post("/inventories/:id/discard",y("estoque.ajustar"),
p(async(e,a)=>{if(!(await d("update inventory_counts set status = 'descartado' where id = $1 and company_id = $2 and status = 'aberto' returning id",[Number(e.params.id),e.ctx.companyId])).
rows[0])throw b("Invent\xE1rio n\xE3o est\xE1 aberto");a.json({ok:!0})}));V.post("/produce",y("estoque.ajustar"),p(async(e,a)=>{let t=w(x.object({product_id:x.number().int(),qty:_a}),
e.body),n=await k(async o=>{let i=(await o.query("select * from products where id = $1 and company_id = $2",[t.product_id,e.ctx.companyId])).rows[0];if(!i)throw v("Produto n\xE3o enco\
ntrado");if(i.stock_mode!=="acabado")throw f("Produ\xE7\xE3o pr\xF3pria vale para produtos com estoque de produto acabado");if(!(await o.query("select id from recipes where product\
_id = $1 and active",[i.id])).rows[0])throw f("Cadastre a ficha de produ\xE7\xE3o (insumos) deste produto acabado antes de produzir");let r=await ft(o,e.ctx.companyId,{...i,stock_mode:"\
ficha"},t.qty),c=(await o.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2) for update",[e.ctx.companyId,[...r.keys()]])).rows,m=0;for(let u of c){
let l=r.get(Number(u.id));m+=l*Number(u.avg_cost_cents),await o.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason,\
 user_id)
        values ($1,$2,'producao_consumo',$3,$4,'production',$5,$6,$7)`,[e.ctx.companyId,u.id,-l,u.avg_cost_cents,i.id,`Produ\xE7\xE3o de ${t.qty} ${i.name}`,e.ctx.userId])}return await Ct(
o,e.ctx,i.stock_item_id,t.qty,Math.round(m/t.qty),{type:"production",id:i.id},`Produ\xE7\xE3o de ${i.name}`),await g(o,e.ctx,"estoque.producao",{entity:"product",entityId:i.id,data:{
qty:t.qty,cost_cents:Math.round(m)}}),{ok:!0,cost_cents:Math.round(m)}});a.json(n)}));V.get("/settings",y("estoque.visualizar"),p(async(e,a)=>{let t=(await d("select settings from \
companies where id = $1",[e.ctx.companyId])).rows[0];a.json(Le(t.settings))}));V.put("/settings",y("configuracoes.gerenciar"),p(async(e,a)=>{let t=w(x.object({enabled:x.boolean().optional(),
allow_negative:x.boolean().optional(),correction_limit_cents:x.number().int().min(0).max(1e8).optional(),correction_max_pct:x.number().min(0).max(1e3).optional(),correction_expire_days:x.
number().int().min(1).max(60).optional()}),e.body),n=(await d("select settings from companies where id = $1",[e.ctx.companyId])).rows[0],o={...Le(n.settings),...Object.fromEntries(
Object.entries(t).filter(([,i])=>i!==void 0))};await d("update companies set settings = jsonb_set(settings, '{stock}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(o)]),
await g({query:d},e.ctx,"estoque.politica",{data:{antes:Le(n.settings),depois:o}}),a.json({ok:!0})}));var vn={contagem:"Diverg\xEAncia de contagem",quebra:"Quebra / avaria",vencimento:"\
Vencimento / validade",erro_lancamento:"Erro de lan\xE7amento",consumo_interno:"Consumo interno / cortesia",furto_desvio:"Furto ou desvio",devolucao:"Devolu\xE7\xE3o ao fornecedor",
outro:"Outro"},pa=e=>Math.round(Number(e)*1e4)/1e4,gr=`select c.*, c.system_qty::float as system_qty, c.counted_qty::float as counted_qty, c.diff_qty::float as diff_qty,
    s.name as item_name, s.unit, u.name as requested_name, d.name as decided_name,
    (select count(*)::int from stock_corrections x where x.company_id = c.company_id and x.stock_item_id = c.stock_item_id
       and x.status = 'aplicada' and x.created_at > c.created_at - interval '30 days' and x.id <> c.id) as recent_count
  from stock_corrections c join stock_items s on s.id = c.stock_item_id
  left join users u on u.id = c.requested_by left join users d on d.id = c.decided_by`;async function br(e,a){return(await e.query(`select count(*)::int as n from users u join role\
s r on r.company_id = u.company_id and r.key = u.role_key
     where u.company_id = $1 and u.active and u.id <> $2 and 'pdv.autorizar' = any(r.permissions) and 'estoque.ajustar' = any(r.permissions)`,[a.companyId,a.userId])).rows[0].n}async function ui(e,a,t,{
selfApproved:n=!1,note:o=null,auto:i=!1}={}){let s=(await e.query("select id, avg_cost_cents from stock_items where id = $1 and company_id = $2 for update",[t.stock_item_id,a.companyId])).
rows[0],r=await e.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
     values ($1,$2,'correcao',$3,$4,'stock_correction',$5,$6,$7) returning id`,[a.companyId,t.stock_item_id,t.diff_qty,s.avg_cost_cents,t.id,`Corre\xE7\xE3o #${t.id}: ${vn[t.reason_code]}`,
a.userId]);return await e.query("update stock_corrections set status = 'aplicada', decided_by = $2, decided_at = now(), decision_note = $3, self_approved = $4, movement_id = $5 whe\
re id = $1",[t.id,a.userId,o,n,r.rows[0].id]),await g(e,a,i?"estoque.correcao_aplicada_direto":"estoque.correcao_aprovada",{entity:"stock_correction",entityId:t.id,reason:o||t.justification,
data:{insumo:t.stock_item_id,saldo_sistema:Number(t.system_qty),saldo_real:Number(t.counted_qty),diferenca:Number(t.diff_qty),valor_cents:Number(t.value_cents),motivo:t.reason_code,
solicitado_por:t.requested_by,autoaprovado:n,movimento:r.rows[0].id}}),r.rows[0].id}V.get("/corrections",y("estoque.visualizar"),p(async(e,a)=>{let t=[e.ctx.companyId],n="c.company\
_id = $1";e.query.status&&(t.push(String(e.query.status)),n+=` and c.status = $${t.length}`),e.query.from&&(t.push(String(e.query.from)),n+=` and c.created_at >= $${t.length}::date`),
e.query.to&&(t.push(String(e.query.to)),n+=` and c.created_at < $${t.length}::date + 1`),e.query.item&&(t.push(Number(e.query.item)),n+=` and c.stock_item_id = $${t.length}`);let o=Le(
(await d("select settings from companies where id = $1",[e.ctx.companyId])).rows[0].settings);await d(`update stock_corrections set status = 'expirada', decided_at = now(), decisio\
n_note = 'Vencida sem decis\xE3o'
     where company_id = $1 and status = 'pendente' and created_at < now() - make_interval(days => $2)`,[e.ctx.companyId,o.correction_expire_days]);let i=(await d(`${gr} where ${n} \
order by c.id desc limit 500`,t)).rows,s=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.gerenciar")||e.ctx.can("pdv.autorizar"),r=i.map(c=>({...c,reason_label:vn[c.reason_code],value_cents:s?
Number(c.value_cents):null,unit_cost_cents:s?Number(c.unit_cost_cents):null,requested_ip:void 0,recurrent:c.recent_count>=2}));if(e.query.format==="csv"){let c=l=>{let _=l==null?"":
String(l);return`"${(/^[=+\-@\t\r]/.test(_)?`'${_}`:_).replace(/"/g,'""')}"`},m=["id","data","insumo","unidade","saldo_sistema","saldo_real","diferenca","valor_reais","motivo","jus\
tificativa","evidencia","situacao","solicitado_por","decidido_por","decidido_em","observacao_decisao","autoaprovado","movimento"],u=r.map(l=>[l.id,new Date(l.created_at).toISOString(),
l.item_name,l.unit,l.system_qty,l.counted_qty,l.diff_qty,l.value_cents==null?"":(l.value_cents/100).toFixed(2),l.reason_label,l.justification,l.evidence,l.status,l.requested_name,l.
decided_name,l.decided_at?new Date(l.decided_at).toISOString():"",l.decision_note,l.self_approved?"sim":"n\xE3o",l.movement_id].map(c).join(";"));return await g({query:d},e.ctx,"es\
toque.correcoes_exportadas",{data:{linhas:r.length}}),a.set("content-type","text/csv; charset=utf-8").set("content-disposition",'attachment; filename="correcoes-estoque.csv"'),a.send(
`\uFEFF${m.join(";")}
${u.join(`
`)}`)}a.json({reasons:vn,config:o,items:r})}));V.post("/corrections",y("estoque.ajustar"),p(async(e,a)=>{let t=w(x.object({stock_item_id:x.number().int(),counted_qty:x.number().min(
0).max(1e6),reason_code:x.enum(Object.keys(vn)),justification:x.string().trim().min(15,"Explique o motivo com pelo menos 15 caracteres").max(500),evidence:x.string().trim().max(300).
optional(),expected_system_qty:x.number().optional()}),e.body);await ae(`stock-corr:${e.ctx.userId}`,60,3600);let n=await k(async o=>{let i=(await o.query("select * from stock_item\
s where id = $1 and company_id = $2 for update",[t.stock_item_id,e.ctx.companyId])).rows[0];if(!i)throw v("Insumo n\xE3o encontrado");let s=Le((await o.query("select settings from \
companies where id = $1",[e.ctx.companyId])).rows[0].settings),r=(await o.query("select id from stock_corrections where company_id = $1 and stock_item_id = $2 and status = 'pendent\
e' and created_at >= now() - make_interval(days => $3)",[e.ctx.companyId,i.id,s.correction_expire_days])).rows[0];if(r)throw b(`J\xE1 existe a corre\xE7\xE3o #${r.id} pendente para\
 este insumo. Aprove ou rejeite antes de pedir outra.`,"correction_pending");await o.query(`update stock_corrections set status = 'expirada', decided_at = now(), decision_note = 'V\
encida sem decis\xE3o'
       where company_id = $1 and stock_item_id = $2 and status = 'pendente'`,[e.ctx.companyId,i.id]);let c=pa((await Qe(o,e.ctx.companyId,[i.id]))[i.id]||0);if(t.expected_system_qty!=
null&&Math.abs(pa(t.expected_system_qty)-c)>5e-4)throw b(`O saldo do sistema mudou para ${c} ${i.unit} enquanto voc\xEA contava. Confira e envie de novo.`,"balance_changed",{system_qty:c});
let m=pa(t.counted_qty-c);if(Math.abs(m)<5e-4)throw f("O saldo informado \xE9 igual ao do sistema: n\xE3o h\xE1 o que corrigir");let u=Number(i.avg_cost_cents)||0,l=Math.round(m*u),
_=(await o.query("select count(*)::int as n from stock_corrections where company_id = $1 and stock_item_id = $2 and status = 'aplicada' and created_at > now() - interval '30 days'",
[e.ctx.companyId,i.id])).rows[0].n,h=[];e.ctx.can("pdv.autorizar")||h.push("quem pediu n\xE3o tem permiss\xE3o de aprovar"),Math.abs(l)>s.correction_limit_cents&&h.push(`valor acim\
a do limite de R$ ${(s.correction_limit_cents/100).toFixed(2).replace(".",",")}`),c>0&&Math.abs(m)/c*100>s.correction_max_pct&&h.push(`diferen\xE7a acima de ${s.correction_max_pct}\
% do saldo`),t.reason_code==="furto_desvio"&&h.push("motivo furto/desvio sempre exige aprova\xE7\xE3o"),_>=2&&h.push(`${_+1}\xAA corre\xE7\xE3o deste insumo em 30 dias`);let N=(await o.
query(`insert into stock_corrections (company_id, stock_item_id, system_qty, counted_qty, diff_qty, unit_cost_cents, value_cents, reason_code,
        justification, evidence, needs_approval, approval_rule, requested_by, requested_ip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,[e.ctx.companyId,i.
id,c,t.counted_qty,m,u,l,t.reason_code,t.justification,t.evidence||null,h.length>0,h.join("; ")||null,e.ctx.userId,String(e.ip||"").slice(0,64)])).rows[0];return await g(o,e.ctx,"e\
stoque.correcao_solicitada",{entity:"stock_correction",entityId:N.id,reason:t.justification,data:{insumo:i.id,nome:i.name,saldo_sistema:c,saldo_real:t.counted_qty,diferenca:m,valor_cents:l,
motivo:t.reason_code,regras:h}}),h.length||await ui(o,e.ctx,N,{auto:!0,note:"Dentro dos limites: aplicada por quem tem permiss\xE3o de aprovar"}),{id:N.id,status:h.length?"pendente":
"aplicada",rules:h,diff_qty:m,value_cents:l,system_qty:c}});a.status(201).json(n)}));V.post("/corrections/:id/approve",y("estoque.ajustar"),p(async(e,a)=>{Q(e.ctx,"pdv.autorizar");
let t=w(x.object({note:x.string().trim().max(300).optional()}),e.body||{}),n=await k(async o=>{let i=(await o.query("select * from stock_corrections where id = $1 and company_id = \
$2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Corre\xE7\xE3o n\xE3o encontrada");if(i.status!=="pendente")throw b(`Esta corre\xE7\xE3o j\xE1 est\xE1 ${i.
status}`);let s=Le((await o.query("select settings from companies where id = $1",[e.ctx.companyId])).rows[0].settings);if(new Date(i.created_at).getTime()<Date.now()-s.correction_expire_days*
864e5)return await o.query("update stock_corrections set status = 'expirada', decided_at = now(), decision_note = 'Vencida sem decis\xE3o' where id = $1",[i.id]),{expired:!0};let r=!1;
if(Number(i.requested_by)===Number(e.ctx.userId)){if(await br(o,e.ctx)>0||e.ctx.level<100)throw b("A aprova\xE7\xE3o deve ser feita por outra pessoa (gerente ou propriet\xE1rio)","\
same_user");if(!t.note||t.note.length<10)throw f("Sem outro aprovador na empresa: registre uma observa\xE7\xE3o (m\xEDn. 10 caracteres) para aprovar o pr\xF3prio pedido");r=!0}return await ui(
o,e.ctx,i,{selfApproved:r,note:t.note||null}),{ok:!0,self_approved:r}});if(n.expired)throw b("Esta corre\xE7\xE3o venceu sem decis\xE3o. Conte de novo e fa\xE7a um novo pedido.","e\
xpired");a.json(n)}));V.post("/corrections/:id/reject",y("estoque.ajustar"),p(async(e,a)=>{Q(e.ctx,"pdv.autorizar");let t=w(x.object({note:x.string().trim().min(5,"Informe o motivo\
 da rejei\xE7\xE3o").max(300)}),e.body),n=await d(`update stock_corrections set status = 'rejeitada', decided_by = $3, decided_at = now(), decision_note = $4
     where id = $1 and company_id = $2 and status = 'pendente' returning id, stock_item_id, diff_qty, value_cents`,[Number(e.params.id),e.ctx.companyId,e.ctx.userId,t.note]);if(!n.
rows[0])throw b("Esta corre\xE7\xE3o n\xE3o est\xE1 pendente");await g({query:d},e.ctx,"estoque.correcao_rejeitada",{entity:"stock_correction",entityId:n.rows[0].id,reason:t.note,data:{
insumo:n.rows[0].stock_item_id,diferenca:Number(n.rows[0].diff_qty),valor_cents:Number(n.rows[0].value_cents)}}),a.json({ok:!0})}));V.post("/items/from-products",y("estoque.ajustar"),
p(async(e,a)=>{let t=w(x.object({product_ids:x.array(x.number().int()).min(1).max(300)}),e.body),n=await k(async o=>{let i=(await o.query("select id, name, cost_cents from products\
 where company_id = $1 and id = any($2) and active and stock_mode = 'nenhum' for update",[e.ctx.companyId,t.product_ids])).rows,s=0,r=0;for(let c of i){let m=(await o.query("select\
 id from stock_items where company_id = $1 and lower(name) = lower($2)",[e.ctx.companyId,c.name])).rows[0];m||(m=(await o.query("insert into stock_items (company_id, name, unit, av\
g_cost_cents) values ($1,$2,'un',$3) returning id",[e.ctx.companyId,c.name.slice(0,80),Number(c.cost_cents)||0])).rows[0],s++),await o.query("update products set stock_mode = 'acab\
ado', stock_item_id = $3, updated_at = now() where id = $1 and company_id = $2",[c.id,e.ctx.companyId,m.id]),r++}return await g(o,e.ctx,"estoque.produtos_controlados",{data:{produtos:i.
map(c=>c.id),criados:s}}),{created:s,linked:r}});a.status(201).json(n)}));V.get("/notes/status",y("compras.gerenciar"),p(async(e,a)=>{let t=(await d("select 1 from company_secrets \
where company_id = $1 and key = 'ai_api_key'",[e.ctx.companyId])).rows[0];a.json({photo:await oi(e.ctx.companyId),own_key:!!t,xml_by_key:!!await xn(e.ctx.companyId)})}));V.put("/no\
tes/key",y("compras.gerenciar","configuracoes.gerenciar"),p(async(e,a)=>{let t=w(x.object({api_key:x.string().trim().max(300)}),e.body);if(t.api_key&&!/^sk-ant-[A-Za-z0-9_-]{20,}$/.
test(t.api_key))throw f('Chave inv\xE1lida: ela come\xE7a com "sk-ant-"');t.api_key?await d("insert into company_secrets (company_id, key, value) values ($1,'ai_api_key',$2) on con\
flict (company_id, key) do update set value = excluded.value, updated_at = now()",[e.ctx.companyId,t.api_key]):await d("delete from company_secrets where company_id = $1 and key = \
'ai_api_key'",[e.ctx.companyId]),await g({query:d},e.ctx,"estoque.leitura_chave",{data:{removed:!t.api_key}}),a.json({ok:!0})}));V.put("/notes/focus",y("compras.gerenciar","configu\
racoes.gerenciar"),p(async(e,a)=>{let t=w(x.object({token:x.string().trim().max(200)}),e.body);if(t.token&&!/^[A-Za-z0-9_-]{16,200}$/.test(t.token))throw f("Token inv\xE1lido: copie o\
 token de produ\xE7\xE3o do painel da Focus NFe");t.token?await d("insert into company_secrets (company_id, key, value) values ($1,'focus_token',$2) on conflict (company_id, key) d\
o update set value = excluded.value, updated_at = now()",[e.ctx.companyId,t.token]):await d("delete from company_secrets where company_id = $1 and key = 'focus_token'",[e.ctx.companyId]),
await g({query:d},e.ctx,"estoque.focus_token",{data:{removed:!t.token}}),a.json({ok:!0})}));V.post("/barcode",y("compras.gerenciar"),p(async(e,a)=>{let t=w(x.object({code:x.string().
trim().min(4).max(80)}),e.body),n=la(t.code);if(n.kind==="invalido")throw f(n.message,"barcode_invalid");let o=e.ctx.companyId;if(n.kind==="pedido"){let r=(await d("select id, supp\
lier, document, due_date, status, total_cents from purchases where id = $1 and company_id = $2",[n.purchase_id,o])).rows[0];if(!r)throw v("Pedido de compra n\xE3o encontrado nesta emp\
resa");let c=(await d(`select l.id, l.stock_item_id, s.name, s.unit, l.qty, l.received_qty, l.unit_cost_cents, s.avg_cost_cents
      from purchase_lines l join stock_items s on s.id = l.stock_item_id where l.purchase_id = $1 order by l.id`,[r.id])).rows;return a.json({kind:"pedido",purchase:{...r,code:ua(r.
id),lines:c}})}let i=(await d("select id, status from purchases where company_id = $1 and nfe_key = $2 and status <> 'cancelada'",[o,n.key])).rows[0],s=(await d("select supplier fr\
om purchases where company_id = $1 and supplier_doc = $2 and status <> 'cancelada' order by id desc limit 1",[o,n.info.cnpj])).rows[0];a.json({kind:"nfe",key:n.key,info:n.info,duplicate:i?
i.id:null,supplier:s?.supplier||null,xml_by_key:!!await xn(o)})}));V.post("/notes/xml-by-key",y("compras.gerenciar"),p(async(e,a)=>{let t=w(x.object({key:x.string().regex(/^\d{44}$/)}),
e.body),n=la(t.key);if(n.kind!=="nfe")throw f("Chave de acesso inv\xE1lida","barcode_invalid");await ae(`nfexml:${e.ctx.companyId}`,120,3600),a.json(await di(e.ctx.companyId,n.key))}));
V.post("/notes/read",y("compras.gerenciar"),p(async(e,a)=>{let t=w(x.object({image:x.string().max(9e6)}),e.body);await ae(`notes:${e.ctx.companyId}`,60,3600);let n=await ii(e.ctx.companyId,
t.image);a.json({...n,items:await ma(e.ctx.companyId,n.items)})}));V.post("/notes/match",y("compras.gerenciar"),p(async(e,a)=>{let t=w(x.object({items:x.array(x.object({description:x.
string().max(120),qty:x.number().nullable().optional(),unit:x.string().max(10).nullable().optional(),unit_price:x.number().nullable().optional(),total:x.number().nullable().optional()})).
max(300)}),e.body);a.json({items:await ma(e.ctx.companyId,t.items)})}));V.post("/notes/confirm",y("compras.gerenciar"),p(async(e,a)=>{let t=w(x.object({supplier:x.string().trim().min(
2).max(100),document:x.string().trim().max(60).optional().nullable(),due_date:x.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),source:x.enum(["foto","xml","manual"]),nfe_key:x.
string().regex(/^\d{44}$/).optional().nullable(),receive:x.boolean().default(!0),supplier_doc:x.string().regex(/^\d{11}$|^\d{14}$/).optional().nullable(),lines:x.array(x.object({description:x.
string().max(120),alias:x.string().max(120).optional(),stock_item_id:x.number().int().optional().nullable(),new_item:x.object({name:x.string().trim().min(2).max(80),unit:x.enum(["u\
n","kg","g","L","ml"]),min_qty:x.number().min(0).max(1e6).default(0)}).optional().nullable(),qty:x.number().positive().max(1e6),factor:x.number().positive().max(1e4).default(1),unit_cost_cents:x.
number().int().min(0).max(1e8)})).min(1).max(150)}),e.body),n=await k(async o=>{if(t.nfe_key){let c=(await o.query("select id from purchases where company_id = $1 and nfe_key = $2 \
and status <> 'cancelada'",[e.ctx.companyId,t.nfe_key])).rows[0];if(c)throw b(`Esta NF-e j\xE1 foi lan\xE7ada (compra #${c.id})`,"nfe_duplicate")}let i=[];for(let c of t.lines){let m=c.
stock_item_id;if(!m&&c.new_item&&(m=(await o.query("select id from stock_items where company_id = $1 and lower(name) = lower($2)",[e.ctx.companyId,c.new_item.name])).rows[0]?.id??(await o.
query("insert into stock_items (company_id, name, unit, min_qty, reorder_qty) values ($1,$2,$3,$4,$5) returning id",[e.ctx.companyId,c.new_item.name,c.new_item.unit,c.new_item.min_qty,
c.new_item.min_qty*3])).rows[0].id),!m)throw f(`Escolha o insumo de "${c.description}" ou marque para criar`);if(!(await o.query("select 1 from stock_items where id = $1 and compan\
y_id = $2",[m,e.ctx.companyId])).rows[0])throw f("Insumo inv\xE1lido");i.push({...c,stock_item_id:Number(m),stock_qty:Math.round(c.qty*c.factor*1e3)/1e3,stock_cost:Math.round(c.unit_cost_cents/
c.factor)})}let s=t.lines.reduce((c,m)=>c+Math.round(m.qty*m.unit_cost_cents),0),r=(await o.query(`insert into purchases (company_id, supplier, document, due_date, total_cents, cre\
ated_by, source, nfe_key, notes, supplier_doc)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,[e.ctx.companyId,t.supplier,t.document??null,t.due_date??null,s,e.ctx.userId,t.source,t.nfe_key??null,{foto:"Lan\xE7ada pel\
a foto da nota (conferida)",xml:"Importada do XML da NF-e",manual:"Nota/pedido digitado manualmente"}[t.source],t.supplier_doc??(t.nfe_key?t.nfe_key.slice(6,20):null)])).rows[0];for(let c of i){
let m=(await o.query("insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) values ($1,$2,$3,$4,$5) returning id",[e.ctx.companyId,r.id,c.stock_item_id,
c.stock_qty,c.stock_cost])).rows[0];t.receive&&(await o.query("update purchase_lines set received_qty = qty where id = $1",[m.id]),await Ct(o,e.ctx,c.stock_item_id,c.stock_qty,c.stock_cost,
{type:"purchase",id:r.id},`Compra ${r.id} \u2014 ${t.supplier}`));let u=da(c.alias||c.description);u&&await o.query(`insert into stock_aliases (company_id, alias, stock_item_id, fa\
ctor) values ($1,$2,$3,$4)
        on conflict (company_id, alias) do update set stock_item_id = excluded.stock_item_id, factor = excluded.factor, updated_at = now()`,[e.ctx.companyId,u,c.stock_item_id,c.factor])}
return t.receive&&await o.query("update purchases set status = 'recebida' where id = $1",[r.id]),await g(o,e.ctx,"compra.nota_lancada",{entity:"purchase",entityId:r.id,data:{source:t.
source,lines:i.length,total_cents:s,received:t.receive}}),{purchase_id:r.id,lines:i.length,total_cents:s,received:t.receive}}).catch(o=>{throw o.code==="23505"?b("Esta NF-e j\xE1 foi \
lan\xE7ada","nfe_duplicate"):o});a.status(201).json(n)}));import{Router as $r}from"npm:express@5.2.1";import{z as Te}from"npm:zod@4.6.5";var at=$r(),xr=Te.number().int().positive().max(1e8),vr=Te.string().regex(/^[A-Za-z0-9_-]{8,80}$/),kr=e=>`R$ ${(e/100).toFixed(2).replace(".",",")}`;async function Ir(e,a){let t=[a.
companyId],n="company_id = $1 and status = 'aberto'";return a.terminalId?(t.push(a.terminalId),n+=` and terminal_id = $${t.length}`):(t.push(a.userId),n+=` and user_id = $${t.length}\
 and terminal_id is null`),(await e.query(`select id from cash_sessions where ${n} order by id desc limit 1 for update`,t)).rows[0]}async function ya(e,a,t){let n=(await e.query("s\
elect * from customers where id = $1 and company_id = $2 for update",[t,a.companyId])).rows[0];if(!n)throw v("Cliente n\xE3o encontrado");if(n.anonymized_at)throw b("Cliente anonim\
izado");return n}at.get("/open",y("clientes.visualizar"),p(async(e,a)=>{let n=(await d(`select c.id, c.name, c.cpf, c.phone, c.fiado_limit_cents, a.balance, a.last_entry,
       (select min(x.created_at) from customer_account x where x.company_id = c.company_id and x.customer_id = c.id and x.kind = 'fiado') as first_fiado
     from customers c join (select customer_id, sum(amount_cents)::bigint as balance, max(created_at) as last_entry from customer_account where company_id = $1 group by customer_id\
) a
       on a.customer_id = c.id
     where c.company_id = $1 and a.balance <> 0 order by a.balance`,[e.ctx.companyId])).rows.map(o=>({...tt(o,e.ctx),balance_cents:Number(o.balance),fiado_limit_cents:Number(o.fiado_limit_cents),
last_entry:o.last_entry,first_fiado:o.first_fiado}));a.json({items:n,debt_cents:n.filter(o=>o.balance_cents<0).reduce((o,i)=>o-i.balance_cents,0),credit_cents:n.filter(o=>o.balance_cents>
0).reduce((o,i)=>o+i.balance_cents,0)})}));at.get("/customers/:id",y("clientes.visualizar"),p(async(e,a)=>{let t=Number(e.params.id),n=(await d("select * from customers where id = \
$1 and company_id = $2",[t,e.ctx.companyId])).rows[0];if(!n)throw v("Cliente n\xE3o encontrado");let o=(await d(`select a.id, a.kind, a.amount_cents, a.method, a.session_id, a.paym\
ent_id, a.reverses_id, a.over_limit, a.reason, a.created_at, u.name as user_name,
       exists(select 1 from customer_account x where x.reverses_id = a.id) as reversed
     from customer_account a left join users u on u.id = a.user_id where a.company_id = $1 and a.customer_id = $2 order by a.id desc limit 200`,[e.ctx.companyId,t])).rows;a.json({customer:tt(
n,e.ctx),has_cpf:!!n.cpf,fiado_limit_cents:Number(n.fiado_limit_cents),...await Ae({query:d},e.ctx.companyId,t),entries:o.map(i=>({...i,amount_cents:Number(i.amount_cents),label:Vo[i.
kind]}))})}));async function li(e,a,t){let n=w(Te.object({amount_cents:xr,method:Te.enum(["dinheiro","pix","debito","credito"]),reason:Te.string().trim().max(200).optional(),idempotency_key:vr}),
e.body),o=Number(e.params.id),i=(await d("select id from customer_account where company_id = $1 and idempotency_key = $2",[e.ctx.companyId,n.idempotency_key])).rows[0];if(i)return a.
json({id:i.id,replay:!0,...await Ae({query:d},e.ctx.companyId,o)});let s=await k(async r=>{if(!(await ya(r,e.ctx,o)).cpf)throw b("Cadastre o CPF do cliente antes de lan\xE7ar na conta",
"cpf_required");let m=await Ir(r,e.ctx);if(!m)throw b("Abra o caixa antes de receber","cash_closed");let u=await Ae(r,e.ctx.companyId,o);if(t==="pagamento_fiado"){if(!u.debt_cents)
throw b("Este cliente n\xE3o tem fiado em aberto","no_debt");if(n.amount_cents>u.debt_cents)throw f(`Valor maior que o fiado em aberto (${kr(u.debt_cents)}). Para deixar cr\xE9dito, u\
se "Lan\xE7ar cr\xE9dito".`,"over_debt")}let l=(await r.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, method, cash_session_id, reason, idempoten\
cy_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[e.ctx.companyId,o,t,n.amount_cents,n.method,m.id,n.reason||null,n.idempotency_key,e.ctx.userId])).rows[0];return await g(r,
e.ctx,t==="credito"?"cliente.credito_lancado":"cliente.fiado_recebido",{entity:"customer",entityId:o,reason:n.reason,data:{lancamento:l.id,valor_cents:n.amount_cents,forma:n.method,
caixa:m.id,saldo_antes:u.balance_cents,saldo_depois:u.balance_cents+n.amount_cents}}),{id:l.id,...await Ae(r,e.ctx.companyId,o)}});a.status(201).json(s)}at.post("/customers/:id/cre\
dit",y("pdv.receber","clientes.visualizar"),p((e,a)=>li(e,a,"credito")));at.post("/customers/:id/settle",y("pdv.receber","clientes.visualizar"),p((e,a)=>li(e,a,"pagamento_fiado")));
at.post("/customers/:id/adjust",y("clientes.gerenciar","pdv.autorizar"),p(async(e,a)=>{let t=w(Te.object({amount_cents:Te.number().int().refine(i=>i!==0&&Math.abs(i)<=1e8),reason:Te.
string().trim().min(10,"Explique o ajuste (m\xEDn. 10 caracteres)").max(300)}),e.body),n=Number(e.params.id),o=await k(async i=>{await ya(i,e.ctx,n);let s=await Ae(i,e.ctx.companyId,
n),r=(await i.query("insert into customer_account (company_id, customer_id, kind, amount_cents, reason, user_id) values ($1,$2,'ajuste',$3,$4,$5) returning id",[e.ctx.companyId,n,t.
amount_cents,t.reason,e.ctx.userId])).rows[0];return await g(i,e.ctx,"cliente.conta_ajustada",{entity:"customer",entityId:n,reason:t.reason,data:{lancamento:r.id,valor_cents:t.amount_cents,
saldo_antes:s.balance_cents,saldo_depois:s.balance_cents+t.amount_cents}}),{id:r.id,...await Ae(i,e.ctx.companyId,n)}});a.status(201).json(o)}));at.post("/entries/:id/reverse",y("f\
inanceiro.estornar"),p(async(e,a)=>{let t=w(Te.object({reason:Te.string().trim().min(5).max(200)}),e.body),n=await k(async o=>{let i=(await o.query("select * from customer_account \
where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Lan\xE7amento n\xE3o encontrado");if(!["credito","pagamento_fiado","ajuste"].includes(
i.kind))throw b("Este lan\xE7amento \xE9 estornado pelo pagamento da comanda (Receber \u203A estornar)");if(await ya(o,e.ctx,i.customer_id),i.cash_session_id&&(await o.query("selec\
t status from cash_sessions where id = $1",[i.cash_session_id])).rows[0]?.status!=="aberto")throw b("O caixa deste recebimento j\xE1 foi fechado: registre um ajuste na conta com o mot\
ivo","cash_closed");let s=await Ae(o,e.ctx.companyId,i.customer_id);if(i.kind==="credito"&&s.balance_cents-Number(i.amount_cents)<0&&s.balance_cents>=0)throw b("Parte deste cr\xE9dito\
 j\xE1 foi usada: estorne o uso antes ou registre um ajuste","credit_used");return await o.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, method,\
 cash_session_id, reverses_id, reason, user_id)
       values ($1,$2,'estorno',$3,$4,$5,$6,$7,$8)`,[e.ctx.companyId,i.customer_id,-Number(i.amount_cents),i.method,i.cash_session_id,i.id,t.reason,e.ctx.userId]).catch(r=>{throw r.
code==="23505"?b("Lan\xE7amento j\xE1 estornado"):r}),await g(o,e.ctx,"cliente.conta_estorno",{entity:"customer",entityId:i.customer_id,reason:t.reason,data:{lancamento:i.id,valor_cents:-Number(
i.amount_cents)}}),Ae(o,e.ctx.companyId,i.customer_id)});a.json(n)}));at.put("/customers/:id/limit",y("clientes.gerenciar","pdv.autorizar"),p(async(e,a)=>{let t=w(Te.object({fiado_limit_cents:Te.
number().int().min(0).max(1e8)}),e.body),n=await d("update customers set fiado_limit_cents = $3, updated_at = now() where id = $1 and company_id = $2 returning id",[Number(e.params.
id),e.ctx.companyId,t.fiado_limit_cents]);if(!n.rows[0])throw v("Cliente n\xE3o encontrado");await g({query:d},e.ctx,"cliente.limite_fiado",{entity:"customer",entityId:n.rows[0].id,
data:t}),a.json({ok:!0})}));import jr from"node:crypto";import{Router as Nr}from"npm:express@5.2.1";import{z as Fe}from"npm:zod@4.6.5";var Be=Nr(),kn=e=>{try{let a=new URL(e);return a.protocol==="https:"||R.NODE_ENV!=="production"&&a.protocol==="http:"?a.origin+a.pathname.replace(/\/+$/,""):null}catch{return null}},
Sr=(e,a)=>kn(R.PUBLIC_API_URL||"")||kn(a||"")||`${e.protocol}://${e.get("host")}`,zr=e=>kn(R.APP_URL||"")||kn(e.get("origin")||"")||"https://rusten.vercel.app";Be.get("/settings",y(
"pdv.receber"),p(async(e,a)=>{let t=(await d("select settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json(Et(t.settings))}));Be.put("/settings",y("configuracoe\
s.gerenciar"),p(async(e,a)=>{let t=w(Fe.object({enabled:Fe.boolean(),handle:Fe.string().trim().max(60)}),e.body),n=ln(t.handle);if(t.enabled&&!/^[a-z0-9][a-z0-9_.-]{1,39}$/.test(n))
throw f("Informe a InfiniteTag (seu usu\xE1rio na InfinitePay, sem o $)");let o={enabled:t.enabled,handle:n};await d("update companies set settings = jsonb_set(settings, '{infinite\
pay}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(o)]),await g({query:d},e.ctx,"infinitepay.configurada",{data:o}),a.json(o)}));Be.post("/charges",y("pdv.receber"),p(
async(e,a)=>{let t=w(Fe.object({session_id:Fe.number().int(),amount_cents:Fe.number().int().positive().max(1e8),api_base:Fe.string().max(300).optional()}),e.body);await ae(`ip-char\
ge:${e.ctx.companyId}`,120,3600);let n=await k(async c=>{let m=(await c.query("select name, settings from companies where id = $1",[e.ctx.companyId])).rows[0],u=Et(m.settings);if(!u.
enabled||!u.handle)throw b("Ative a InfinitePay em Configura\xE7\xF5es \u203A Integra\xE7\xF5es","infinitepay_off");let l=await se(c,e.ctx.companyId,t.session_id);if(Oe(e.ctx,l.unit_id),
!["aberta","em_fechamento"].includes(l.status))throw b("Consumo encerrado","session_not_open");let _=await K(c,l.id);if(t.amount_cents>_.balance)throw f("Valor maior que o saldo da\
 comanda","over_balance");let h=(await c.query("select id from infinitepay_charges where session_id = $1 and status = 'pendente' and amount_cents = $2 and created_at > now() - inte\
rval '30 minutes' order by id desc limit 1",[l.id,t.amount_cents])).rows[0];if(h)return{reuse:h.id};let $=(await c.query(`select coalesce('Comanda ' || c.number, 'Mesa ' || t.numbe\
r, s.label, 'Consumo #' || s.id) as l from consumption_sessions s
       left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id where s.id = $1`,[l.id])).rows[0].l,N=l.customer_id?(await c.query("select name, ema\
il, phone from customers where id = $1",[l.customer_id])).rows[0]:null,P=e.ctx.terminalId?(await c.query("select id from cash_sessions where company_id = $1 and terminal_id = $2 an\
d status = 'aberto' limit 1",[e.ctx.companyId,e.ctx.terminalId])).rows[0]:(await c.query("select id from cash_sessions where company_id = $1 and user_id = $2 and terminal_id is nul\
l and status = 'aberto' limit 1",[e.ctx.companyId,e.ctx.userId])).rows[0],T=To(e.ctx.companyId),q=jr.randomBytes(18).toString("hex");return{c:(await c.query(`insert into infinitepa\
y_charges (company_id, session_id, cash_session_id, order_nsu, token, amount_cents, description, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[e.ctx.companyId,l.id,P?.id??null,T,q,t.amount_cents,`${$} \u2014 ${m.name}`.slice(0,120),e.ctx.userId])).rows[0],cfg:u,customer:N}});
if(n.reuse)return a.json(await In(e,n.reuse));let{c:o,cfg:i,customer:s}=n,r=String(s?.phone||"").replace(/\D/g,"");try{let c=await Ao({handle:i.handle,amount:Number(o.amount_cents),
description:o.description,orderNsu:o.order_nsu,webhookUrl:`${Sr(e,t.api_base)}/api/public/infinitepay/webhook/${o.token}`,redirectUrl:`${zr(e)}/pagamento/concluido?c=${o.token}`,customer:s?
{name:s.name||void 0,email:s.email||void 0,phone_number:r.length>=10?`+55${r.slice(-11)}`:void 0}:null});await d("update infinitepay_charges set link_url = $2 where id = $1",[o.id,
c.url]),await et({query:d},o,"link_criado",{url:c.url}),await g({query:d},e.ctx,"infinitepay.cobranca",{entity:"infinitepay",entityId:o.id,data:{comanda:o.session_id,valor_cents:Number(
o.amount_cents)}})}catch(c){throw await d("update infinitepay_charges set status = 'erro', note = $2 where id = $1",[o.id,String(c.message).slice(0,300)]),await et({query:d},o,"err\
o",{erro:c.message},!1),c}a.status(201).json(await In(e,o.id))}));async function In(e,a){let t=(await d(`select c.id, c.session_id, c.order_nsu, c.amount_cents, c.description, c.li\
nk_url, c.status, c.capture_method, c.installments,
      c.paid_amount_cents, c.receipt_url, c.payment_id, c.confirmed_by, c.note, c.created_at, c.paid_at, u.name as user_name
    from infinitepay_charges c left join users u on u.id = c.created_by where c.id = $1 and c.company_id = $2`,[a,e.ctx.companyId])).rows[0];if(!t)throw v("Cobran\xE7a n\xE3o encontrada");
return{...t,amount_cents:Number(t.amount_cents),paid_amount_cents:t.paid_amount_cents==null?null:Number(t.paid_amount_cents)}}Be.get("/charges/:id",y("pdv.receber"),p(async(e,a)=>{
let t=Number(e.params.id),n=(await d("select id, status, transaction_nsu, invoice_slug, created_at from infinitepay_charges where id = $1 and company_id = $2",[t,e.ctx.companyId])).
rows[0];if(!n)throw v("Cobran\xE7a n\xE3o encontrada");n.status==="pendente"&&n.transaction_nsu&&n.invoice_slug&&await Ot(k,t,{},"consulta").catch(()=>{}),a.json(await In(e,t))}));
Be.post("/charges/:id/cancel",y("pdv.receber"),p(async(e,a)=>{let t=await d("update infinitepay_charges set status = 'cancelado', canceled_at = now() where id = $1 and company_id =\
 $2 and status in ('pendente','erro') returning id",[Number(e.params.id),e.ctx.companyId]);if(!t.rows[0])throw b("Esta cobran\xE7a n\xE3o est\xE1 pendente");await g({query:d},e.ctx,
"infinitepay.cancelada",{entity:"infinitepay",entityId:t.rows[0].id}),a.json({ok:!0,note:'O link deixa de aparecer aqui. Se o cliente pagar mesmo assim, o pagamento chega como "par\
a conferir".'})}));Be.post("/charges/:id/confirm",y("pdv.receber"),p(async(e,a)=>{let t=w(Fe.object({transaction_nsu:Fe.string().trim().min(6).max(120),invoice_slug:Fe.string().trim().
min(3).max(120)}),e.body),n=Number(e.params.id);if(!(await d("select id from infinitepay_charges where id = $1 and company_id = $2",[n,e.ctx.companyId])).rows[0])throw v("Cobran\xE7a \
n\xE3o encontrada");await Ot(k,n,t,"consulta"),a.json(await In(e,n))}));Be.get("/charges",y("financeiro.visualizar"),p(async(e,a)=>{let t=[e.ctx.companyId],n="c.company_id = $1";e.
query.from&&(t.push(String(e.query.from)),n+=` and c.created_at >= $${t.length}::date`),e.query.to&&(t.push(String(e.query.to)),n+=` and c.created_at < $${t.length}::date + 1`),e.query.
status&&(t.push(String(e.query.status)),n+=` and c.status = $${t.length}`);let o=(await d(`select c.id, c.session_id, c.order_nsu, c.amount_cents::bigint, c.description, c.status, \
c.capture_method, c.installments, c.paid_amount_cents,
      c.receipt_url, c.transaction_nsu, c.confirmed_by, c.note, c.created_at, c.paid_at, u.name as user_name
    from infinitepay_charges c left join users u on u.id = c.created_by where ${n} order by c.id desc limit 500`,t)).rows.map(s=>({...s,amount_cents:Number(s.amount_cents),paid_amount_cents:s.
paid_amount_cents==null?null:Number(s.paid_amount_cents)})),i=s=>o.filter(s).reduce((r,c)=>r+c.amount_cents,0);a.json({items:o,totals:{pago:i(s=>s.status==="pago"),pix:i(s=>s.status===
"pago"&&s.capture_method==="pix"),cartao:i(s=>s.status==="pago"&&s.capture_method&&s.capture_method!=="pix"),pendente:i(s=>s.status==="pendente"),divergente:i(s=>s.status==="diverg\
ente"),count:o.length}})}));Be.get("/charges/:id/events",y("financeiro.visualizar"),p(async(e,a)=>{a.json((await d("select kind, ok, payload, created_at from infinitepay_events whe\
re charge_id = $1 and company_id = $2 order by id",[Number(e.params.id),e.ctx.companyId])).rows)}));import{Router as Cr}from"npm:express@5.2.1";import{z as jn}from"npm:zod@4.6.5";var Nn=Cr(),pi=e=>{let a=w(jn.object({from:jn.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:jn.string().regex(/^\d{4}-\d{2}-\d{2}$/),unit_id:jn.coerce.number().int().optional()}),e);if(a.
from>a.to)throw f("Data inicial depois da final");if((new Date(a.to)-new Date(a.from))/864e5>400)throw f("Per\xEDodo m\xE1ximo de 400 dias");return a};async function _i(e,a){let t=e.
can("financeiro.visualizar"),n=e.can("relatorios.cmv"),o=e.company.timezone,i=[e.companyId,a.from,a.to],s="";a.unit_id&&(i.push(a.unit_id),s=` and s.unit_id = $${i.length}`);let r=`\
s.company_id = $1 and s.business_date between $2 and $3${s}`,c=`${r} and s.status = 'encerrada'`,m=`from order_items i join consumption_sessions s on s.id = i.session_id where ${c}\
 and i.status = 'ativo'`,u=(await d(`with x as (
      select s.id, s.service_fee_bp, s.delivery_fee_cents, (select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo') as items
      from consumption_sessions s where ${c})
    select count(*)::int as sessions, coalesce(sum(items),0)::bigint as items_cents,
      coalesce(sum(round(items * service_fee_bp / 10000.0)),0)::bigint as service_fee_cents, coalesce(sum(delivery_fee_cents),0)::bigint as delivery_fee_cents from x`,i)).rows[0],l=Number(
u.items_cents)+Number(u.service_fee_cents)+Number(u.delivery_fee_cents),_=(await d(`select p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total, coalesce(\
sum(p.change_cents),0)::bigint as change
    from payments p join consumption_sessions s on s.id = p.session_id where p.company_id = $1 and p.business_date between $2 and $3${s} and p.status = 'confirmado' group by p.meth\
od order by total desc`,i)).rows,h=(await d(`select count(*)::int as n, coalesce(sum((select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status \
= 'ativo')
      - (select coalesce(sum(amount_cents),0) from payments p where p.session_id = s.id and p.status = 'confirmado')),0)::bigint as balance
    from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')${a.unit_id?" and s.unit_id = $2":""}`,a.unit_id?[e.companyId,a.unit_id]:[e.companyId])).
rows[0],$=(await d(`select s.business_date as day, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${m} group by 1 order by 1`,i)).rows,
N=(await d(`select extract(hour from i.created_at at time zone '${o.replace(/'/g,"")}')::int as hour, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${m}\
 group by 1 order by 1`,i)).rows,P=(await d(`select i.product_id, max(i.description) as name, max(c.name) as category, sum(i.qty)::float as qty, sum(i.total_cents)::bigint as items\
_cents,
      sum(coalesce((select -sum(m.qty * m.unit_cost_cents) from stock_movements m where m.ref_type = 'order_item' and m.ref_id = i.id and m.kind = 'venda'),
        p.cost_cents * i.qty))::bigint as cost_cents
    ${m.replace("where","join products p on p.id = i.product_id left join categories c on c.id = p.category_id where")} group by i.product_id order by items_cents desc`,i)).rows,T=Object.
values(P.reduce((O,fe)=>{let it=fe.category||"Sem categoria";return O[it]||={name:it,qty:0,items_cents:0,cost_cents:0},O[it].qty+=fe.qty,O[it].items_cents+=Number(fe.items_cents),O[it].
cost_cents+=Number(fe.cost_cents),O},{})).sort((O,fe)=>fe.items_cents-O.items_cents),q=P.reduce((O,fe)=>O+Number(fe.items_cents),0)||1,E=0;for(let O of P)E+=Number(O.items_cents),O.
abc=E/q<=.8?"A":E/q<=.95?"B":"C";let W=(await d(`select u.name, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${m.replace("where","left join users u\
 on u.id = i.user_id where")} group by u.name order by items_cents desc`,i)).rows,Y=(await d(`select t.number, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)\
::bigint as items_cents,
      round(avg(extract(epoch from (s.closed_at - s.opened_at)) / 60)::numeric)::int as avg_minutes
    ${m.replace("where","join dining_tables t on t.id = s.table_id where")} group by t.number order by t.number`,i)).rows,U=(await d(`select s.kind as channel, count(distinct s.id)\
::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${m} group by 1 order by 3 desc`,i)).rows,H=(await d(`select coalesce(tm.name, 'Sem terminal') as name, cou\
nt(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${m.replace("where","left join terminals tm on tm.id = i.terminal_id where")} group by 1 order by 3 desc`,
i)).rows,de=(await d(`select i.launch_mode, count(*)::int as n from order_items i join consumption_sessions s on s.id = i.session_id where ${r} group by 1`,i)).rows,I=(await d(`sel\
ect
      count(*) filter (where i.status = 'cancelado')::int as canceled_items, coalesce(sum(i.total_cents) filter (where i.status = 'cancelado'),0)::bigint as canceled_cents,
      coalesce(sum(i.discount_cents) filter (where i.status = 'ativo'),0)::bigint as discounts_cents, count(*) filter (where i.discount_cents > 0)::int as discounted_items
    from order_items i join consumption_sessions s on s.id = i.session_id where ${r}`,i)).rows[0],B=(await d(`select action, count(*)::int as n from audit_events where company_id =\
 $1 and created_at >= $2::date and created_at < $3::date + 1
      and action in ('consumo.reaberto','consumo.cancelado','pdv.itens_transferidos','pdv.mesa_trocada','autorizacao.concedida','autorizacao.negada','leitura.desconhecida','pdv.exc\
ecao_manual','pagamento.estornado','pdv.taxa_servico')
    group by action`,[e.companyId,a.from,a.to])).rows,oe=(await d(`select ps.name as sector, count(*)::int as items, round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::n\
umeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
    from order_items i join consumption_sessions s on s.id = i.session_id join production_sectors ps on ps.id = i.sector_id
    where ${r} and i.ready_at is not null and i.sent_at is not null group by ps.name order by ps.name`,i)).rows,Z=(await d(`select count(*)::int as orders, count(*) filter (where d\
.status = 'cancelado')::int as canceled,
      round(avg(extract(epoch from (e.created_at - d.created_at)) / 60)::numeric)::int as avg_minutes_to_deliver
    from delivery_orders d join consumption_sessions s on s.id = d.session_id
    left join lateral (select created_at from delivery_events where order_id = d.id and status = 'entregue' order by id limit 1) e on true where ${r}`,i)).rows[0],ne=(await d(`sele\
ct coalesce(sum(-m.qty * m.unit_cost_cents) filter (where m.kind = 'perda'),0)::bigint as losses_cents,
      coalesce(sum(m.qty * m.unit_cost_cents) filter (where m.kind = 'inventario'),0)::bigint as inventory_diff_cents
    from stock_movements m where m.company_id = $1 and m.created_at >= $2::date and m.created_at < $3::date + 1`,[e.companyId,a.from,a.to])).rows[0],ot=(await d(`select count(disti\
nct s.customer_id)::int as identified,
      count(distinct s.customer_id) filter (where exists (select 1 from consumption_sessions o where o.customer_id = s.customer_id and o.status = 'encerrada' and o.business_date < \
$2))::int as returning
    from consumption_sessions s where ${c} and s.customer_id is not null`,i)).rows[0],pt=(await d(`select coalesce(sum(points) filter (where kind = 'ganho'),0)::int as earned, coal\
esce(-sum(points) filter (where kind = 'resgate'),0)::int as redeemed
    from loyalty_ledger where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1`,[e.companyId,a.from,a.to])).rows[0],Re=(await d("select count(*)::int as n, \
round(avg(score)::numeric, 2)::float as average from reviews where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1",[e.companyId,a.from,a.to])).rows[0],bt=t?
(await d(`select count(*)::int as sessions, coalesce(sum(difference_cents),0)::bigint as difference_cents,
      count(*) filter (where difference_cents <> 0)::int as with_difference from cash_sessions where company_id = $1 and business_date between $2 and $3 and status = 'fechado'`,[e.
companyId,a.from,a.to])).rows[0]:null,Me=t?(await d(`select m.kind, coalesce(sum(m.amount_cents),0)::bigint as total from cash_movements m join cash_sessions c on c.id = m.cash_ses\
sion_id
      where m.company_id = $1 and c.business_date between $2 and $3 group by m.kind`,[e.companyId,a.from,a.to])).rows:null,_e=t?(await d(`select d.day, d.import_id, d.gross_cents, \
d.net_cents, d.tx_count from pos_sales_days d join pos_sales_imports i on i.id = d.import_id
      where d.company_id = $1 and d.active and i.mode = 'externa' and d.day between $2 and $3 order by d.day`,[e.companyId,a.from,a.to])).rows:[],me=null;if(t&&_e.length){let O=(await d(
"select id, period_from, period_to, gross_cents, methods from pos_sales_imports where id = any($1::bigint[])",[[...new Set(_e.map(ie=>ie.import_id))]])).rows,fe={},it=!0,za=0,ji=Object.
fromEntries((await d(`select i.import_id, coalesce(sum(-m.qty * m.unit_cost_cents),0)::float as cost
        from pos_sales_items i join stock_movements m on m.company_id = i.company_id and m.ref_type = 'pos_sales_item' and m.ref_id = i.id and m.kind = 'venda'
       where i.import_id = any($1::bigint[]) and i.status = 'baixado' group by i.import_id`,[O.map(ie=>ie.id)])).rows.map(ie=>[Number(ie.import_id),ie.cost]));for(let ie of O){let We=_e.
filter(Ke=>Ke.import_id===ie.id).reduce((Ke,Ni)=>Ke+Number(Ni.gross_cents),0);(ie.period_from<a.from||ie.period_to>a.to)&&(it=!1);let $t=ie.gross_cents?We/ie.gross_cents:0;for(let Ke of ie.
methods)fe[Ke.method]=(fe[Ke.method]||0)+Math.round(Ke.gross_cents*$t);za+=Math.round((ji[Number(ie.id)]||0)*$t)}let Rt=ie=>_e.reduce((We,$t)=>We+Number($t[ie]),0);me={gross_cents:Rt(
"gross_cents"),net_cents:Rt("net_cents"),fee_cents:Rt("gross_cents")-Rt("net_cents"),tx_count:Rt("tx_count"),by_day:_e.map(({day:ie,gross_cents:We,net_cents:$t,tx_count:Ke})=>({day:ie,
gross_cents:We,net_cents:$t,tx_count:Ke})),by_method:Object.entries(fe).map(([ie,We])=>({method:ie,total:We})).sort((ie,We)=>We.total-ie.total),methods_exact:it,imports:O.length,cmv_cents:n?
za:null}}let ye=P.reduce((O,fe)=>O+Number(fe.cost_cents),0),F=O=>t?O:null;if(!n)for(let O of[...P,...T])delete O.cost_cents;let Tt=_.reduce((O,fe)=>O+Number(fe.total),0),Pn=t&&n?{receita_bruta:l,
taxa_servico:Number(u.service_fee_cents),taxa_entrega:Number(u.delivery_fee_cents),cmv:ye,lucro_bruto:Number(u.items_cents)-ye,despesas_caixa:Number(Me?.find(O=>O.kind==="despesa")?.
total||0),maquininha_bruta:me?.gross_cents||0,maquininha_taxas:me?.fee_cents||0,maquininha_cmv:me?.cmv_cents||0,resultado:Number(u.items_cents)-ye-Number(Me?.find(O=>O.kind==="desp\
esa")?.total||0)+(me?.net_cents||0)-(me?.cmv_cents||0)}:null;return{period:{from:a.from,to:a.to},permissions:{financial:t,cmv:n},summary:{sessions:u.sessions,revenue_cents:F(l),items_cents:F(
Number(u.items_cents)),service_fee_cents:F(Number(u.service_fee_cents)),delivery_fee_cents:F(Number(u.delivery_fee_cents)),received_cents:F(Tt),ticket_cents:F(u.sessions?Math.round(
l/u.sessions):0),external_cents:t?me?.gross_cents||0:null,revenue_total_cents:t?l+(me?.gross_cents||0):null,open_sessions:h.n,open_balance_cents:F(Number(h.balance)),cmv_cents:n?ye:
null,margin_pct:n&&Number(u.items_cents)?Math.round((Number(u.items_cents)-ye)/Number(u.items_cents)*1e3)/10:null},by_day:$.map(O=>({...O,items_cents:F(Number(O.items_cents))})),by_hour:N.
map(O=>({...O,items_cents:F(Number(O.items_cents))})),by_product:P.map(O=>({...O,items_cents:F(Number(O.items_cents))})),by_category:T.map(O=>({...O,items_cents:F(O.items_cents)})),
by_user:W.map(O=>({...O,items_cents:F(Number(O.items_cents))})),by_table:Y.map(O=>({...O,items_cents:F(Number(O.items_cents))})),by_channel:U.map(O=>({...O,items_cents:F(Number(O.items_cents))})),
by_terminal:H.map(O=>({...O,items_cents:F(Number(O.items_cents))})),payments:t?_:null,cash:bt,movements:Me,dre:Pn,external:me,control:{...I,canceled_cents:F(Number(I.canceled_cents)),
discounts_cents:F(Number(I.discounts_cents)),launch_modes:Object.fromEntries(de.map(O=>[O.launch_mode,O.n])),events:Object.fromEntries(B.map(O=>[O.action,O.n]))},kitchen:oe,delivery:Z,
stock:n?ne:null,customers:{...ot,loyalty:pt,reviews:Re}}}Nn.get("/overview",y("relatorios.visualizar"),p(async(e,a)=>{a.json(await _i(e.ctx,pi(e.query)))}));var qr={produtos:["by_p\
roduct",[["name","Produto"],["category","Categoria"],["qty","Quantidade"],["items_cents","Vendido (R$)"],["cost_cents","CMV (R$)"],["abc","Curva ABC"]]],dias:["by_day",[["day","Dia\
 comercial"],["sessions","Consumos"],["items_cents","Vendido (R$)"]]],horas:["by_hour",[["hour","Hora"],["items","Itens"],["items_cents","Vendido (R$)"]]],garcons:["by_user",[["nam\
e","Usu\xE1rio"],["items","Itens"],["items_cents","Vendido (R$)"]]],mesas:["by_table",[["number","Mesa"],["sessions","Consumos"],["items_cents","Vendido (R$)"],["avg_minutes","Perm\
an\xEAncia m\xE9dia (min)"]]],pagamentos:["payments",[["method","Forma"],["n","Quantidade"],["total","Total (R$)"]]]};Nn.get("/export",y("relatorios.visualizar"),p(async(e,a)=>{let t=pi(
e.query),n=qr[e.query.section];if(!n)throw f("Se\xE7\xE3o inv\xE1lida");let i=(await _i(e.ctx,t))[n[0]]||[],s=n[1].filter(([m])=>i.some(u=>u[m]!==void 0&&u[m]!==null)),r=(m,u)=>/cents|^total$/.
test(m)&&u!=null?(Number(u)/100).toFixed(2).replace(".",","):u,c=[s.map(([,m])=>m).join(";"),...i.map(m=>s.map(([u])=>vt(r(u,m[u]))).join(";"))];await g({query:d},e.ctx,"relatorio.\
exportado",{data:{section:e.query.section,...t}}),a.setHeader("content-type","text/csv; charset=utf-8"),a.setHeader("content-disposition",`attachment; filename="rusten-${e.query.section}\
-${t.from}-${t.to}.csv"`),a.send(`\uFEFF${c.join(`
`)}`)}));import{Router as Ar}from"npm:express@5.2.1";import{z as M}from"npm:zod@4.6.5";import Er from"node:crypto";var ht=e=>({enabled:!1,accepting:!0,delivery:!0,pickup:!0,fee_cents:0,min_order_cents:0,eta_minutes:45,hours:"",areas:"",payment_methods:["dinheiro","pix","cartao"],message:"",...e?.
delivery||{}}),yi={recebido:["confirmado","cancelado"],confirmado:["em_preparo","pronto","cancelado"],em_preparo:["pronto","cancelado"],pronto:["saiu","entregue","cancelado"],saiu:[
"entregue","cancelado"],entregue:[],cancelado:[]},lt={recebido:"Recebido",confirmado:"Confirmado",em_preparo:"Em preparo",pronto:"Pronto",saiu:"Saiu para entrega",entregue:"Entregu\
e",cancelado:"Cancelado"},Or=e=>({companyId:e,userId:null,unitId:null,terminalId:null,level:0,can:a=>["pdv.abrir_comanda","delivery.gerenciar"].includes(a)});async function fa(e,a,t,{
channel:n="delivery"}={}){if(!Array.isArray(t)||!t.length)throw f("Carrinho vazio");let o=[...new Set(t.map(r=>Number(r.product_id)))],i=Object.fromEntries((await e.query("select *\
 from products where company_id = $1 and id = any($2)",[a,o])).rows.map(r=>[r.id,r])),s=[];for(let r of t){let c=i[Number(r.product_id)];if(!c||!c.active)throw b(`Produto indispon\xED\
vel${c?`: ${c.name}`:""}`,"product_unavailable");if(n!=="interno"&&!c.channels.includes("delivery")&&!c.channels.includes("cardapio_digital"))throw b(`${c.name} n\xE3o est\xE1 dispon\xEDvel\
 para delivery`,"product_unavailable");if(c.kind==="weight")throw b(`${c.name} \xE9 vendido por peso e n\xE3o pode ser pedido online`,"product_unavailable");let m=Number(r.qty);if(!Number.
isInteger(m)||m<1||m>50)throw f("Quantidade inv\xE1lida");let u=(r.option_ids||[]).map(Number),l=(await e.query(`select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active where g.product_id = $1 group by g.id order by g.sort, g.id`,[c.id])).rows,_=[];for(let $ of l){
let N=$.options.filter(P=>u.includes(P.id));if(N.length<$.min_select)throw f(`${c.name}: escolha ${$.min_select} em "${$.name}"`,"options_required");if(N.length>$.max_select)throw f(
`${c.name}: no m\xE1ximo ${$.max_select} em "${$.name}"`);for(let P of N)_.push({group:$.name,id:P.id,name:P.name,price_cents:P.price_cents})}if(_.length!==new Set(u).size)throw f(
"Op\xE7\xE3o inv\xE1lida");let h=_.reduce(($,N)=>$+N.price_cents,0);s.push({product:c,qty:m,chosen:_,mods:h,notes:r.notes?String(r.notes).slice(0,140):null,total:Dt(c.price_cents,m,
h,0)})}return{lines:s,subtotal:s.reduce((r,c)=>r+c.total,0)}}async function Pt(e,a,t,n){let o=(await e.query("select id, name, settings from companies where id = $1",[a])).rows[0];
if(!o)throw v();let i=ht(o.settings),s=t.channel==="telefone"||t.channel==="balcao";if(!s&&(!i.enabled||!i.accepting))throw b("O estabelecimento n\xE3o est\xE1 recebendo pedidos agora",
"closed");if(t.mode==="entrega"&&!i.delivery)throw f("Entrega indispon\xEDvel: escolha retirada");if(t.mode==="retirada"&&!i.pickup)throw f("Retirada indispon\xEDvel");if(t.mode===
"entrega"&&(!t.address?.street||!t.address?.number))throw f("Informe rua e n\xFAmero para entrega");let r=ke(t.phone);if(r.length<10)throw f("Telefone com DDD \xE9 obrigat\xF3rio");
await e.query("select pg_advisory_xact_lock(hashtext('delivery-orders:' || $1::text))",[a]);let c=(await e.query("select id, public_token, number from delivery_orders where company\
_id = $1 and client_key = $2",[a,t.client_key])).rows[0];if(c)return{replay:!0,...c};let{lines:m,subtotal:u}=await fa(e,a,t.cart,{channel:s?"interno":"delivery"});if(!s&&u<i.min_order_cents)
throw f(`Pedido m\xEDnimo de R$ ${(i.min_order_cents/100).toFixed(2).replace(".",",")}`,"min_order");let l=t.mode==="entrega"?i.fee_cents:0,_=(await e.query("select id from custome\
rs where company_id = $1 and anonymized_at is null and regexp_replace(coalesce(phone,''),'\\D','','g') = $2 limit 1",[a,r])).rows[0],h=n||Or(a),$=Number((await e.query("select coal\
esce(max(number),0)+1 as n from delivery_orders where company_id = $1",[a])).rows[0].n),N=await sa(e,{...h,companyId:a},{kind:"delivery",label:`Delivery #${$}`,customer_name:t.customer_name,
customer_id:_?.id,delivery_fee_cents:l});for(let[q,E]of m.entries()){let W=(await e.query(`insert into order_items (company_id, session_id, product_id, description, qty, unit, unit\
_price_cents, modifiers, modifiers_cents, discount_cents,
         total_cents, notes, sector_id, kitchen_status, launch_mode, user_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,'delivery',$14,$15) returning *`,[a,N.id,E.product.id,E.product.name,E.qty,E.product.unit,E.product.price_cents,JSON.stringify(
E.chosen),E.mods,E.total,E.notes,E.product.sector_id,E.product.sector_id?"novo":"nao_produz",h.userId,`dlv${N.id}x${q}`])).rows[0];await cn(e,{...h,companyId:a},W,E.product,E.chosen.
map(Y=>Y.id))}let P=Se(18),T=(await e.query(`insert into delivery_orders (company_id, unit_id, session_id, number, public_token, channel, mode, customer_id, customer_name, phone, a\
ddress,
       payment_hint, change_for_cents, notes, eta_minutes, client_key, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,[a,N.unit_id,N.id,$,P,t.channel,t.mode,_?.id??null,t.customer_name,r,t.address||{},t.payment_hint??
null,t.change_for_cents??null,t.notes??null,i.eta_minutes,t.client_key,s?"confirmado":"recebido"])).rows[0];return s&&await e.query("update order_items set sent_at = now() where se\
ssion_id = $1 and kitchen_status = 'novo'",[N.id]),await e.query("insert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",[a,T.id,T.status,
h.userId,`Pedido via ${t.channel}`]),{...T,subtotal:u,fee:l,total:u+l}}var Pr=()=>Ut("review-link"),Sn=e=>`${e}.${Er.createHmac("sha256",Pr()).update(String(e)).digest("base64url").
slice(0,16)}`;function wa(e){let[a,t]=String(e||"").split(".");return!/^\d+$/.test(a||"")||!t?null:Sn(a)===`${a}.${t}`?Number(a):null}var Ve=Ar(),Tr=e=>String(e).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40)||"loja";Ve.get("/settings",y("delivery\
.gerenciar"),p(async(e,a)=>{let t=(await d("select slug, name, settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json({slug:t.slug,suggested_slug:t.slug||Tr(t.name),
...ht(t.settings)})}));Ve.put("/settings",y("delivery.gerenciar","configuracoes.gerenciar"),p(async(e,a)=>{let t=w(M.object({slug:M.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
"use letras min\xFAsculas, n\xFAmeros e h\xEDfen (3 a 40)"),enabled:M.boolean(),accepting:M.boolean(),delivery:M.boolean(),pickup:M.boolean(),fee_cents:M.number().int().min(0).max(
1e5),min_order_cents:M.number().int().min(0).max(1e6),eta_minutes:M.number().int().min(5).max(300),hours:M.string().max(300).default(""),areas:M.string().max(500).default(""),message:M.
string().max(300).default(""),payment_methods:M.array(M.enum(["dinheiro","pix","cartao"])).min(1)}),e.body);if(!t.delivery&&!t.pickup)throw f("Habilite entrega, retirada ou ambos");
let{slug:n,...o}=t;await k(async i=>{if((await i.query("select 1 from companies where slug = $1 and id <> $2",[n,e.ctx.companyId])).rows[0])throw b("Este endere\xE7o j\xE1 est\xE1 em uso po\
r outra empresa","slug_taken");await i.query("update companies set slug = $2, settings = jsonb_set(settings, '{delivery}', $3::jsonb) where id = $1",[e.ctx.companyId,n,JSON.stringify(
o)]),await g(i,e.ctx,"delivery.configuracao",{data:{slug:n,...o}})}),a.json({ok:!0})}));Ve.get("/orders",y("delivery.gerenciar"),p(async(e,a)=>{let t=[e.ctx.companyId],n="d.company\
_id = $1";e.query.status==="abertos"?n+=" and d.status not in ('entregue','cancelado')":e.query.status==="hoje"&&(n+=" and d.created_at > now() - interval '24 hours'"),e.ctx.can("d\
elivery.gerenciar")||(t.push(e.ctx.userId),n+=` and d.courier_id = $${t.length}`);let o=(await d(`select d.*, u.name as courier_name, s.status as session_status,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') as items_cents,
      (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = d.session_id and p.status = 'confirmado') as paid_cents,
      s.delivery_fee_cents,
      (select json_agg(json_build_object('description', i.description, 'qty', i.qty, 'modifiers', i.modifiers, 'notes', i.notes, 'kitchen_status', i.kitchen_status, 'status', i.sta\
tus) order by i.id)
         from order_items i where i.session_id = d.session_id) as items
    from delivery_orders d join consumption_sessions s on s.id = d.session_id left join users u on u.id = d.courier_id
    where ${n} order by case when d.status in ('entregue','cancelado') then 1 else 0 end, d.created_at desc limit 200`,t)).rows;a.json(o)}));Ve.get("/my",y("delivery.entregar"),p(async(e,a)=>{
a.json((await d(`select d.id, d.number, d.status, d.customer_name, d.phone, d.address, d.payment_hint, d.change_for_cents, d.notes,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') + s.delivery_fee_cents as total_cents
    from delivery_orders d join consumption_sessions s on s.id = d.session_id where d.company_id = $1 and d.courier_id = $2 and d.status in ('pronto','saiu') order by d.id`,[e.ctx.
companyId,e.ctx.userId])).rows)}));var Rr=M.object({mode:M.enum(["entrega","retirada"]),channel:M.enum(["telefone","balcao"]).default("telefone"),customer_name:M.string().trim().min(
2).max(80),phone:M.string().trim().min(10).max(20),address:M.object({street:M.string().max(120),number:M.string().max(20),district:M.string().max(80).optional(),complement:M.string().
max(80).optional(),reference:M.string().max(120).optional()}).partial().optional(),payment_hint:M.enum(["dinheiro","pix","cartao"]).optional(),change_for_cents:M.number().int().min(
0).max(1e7).optional(),notes:M.string().max(300).optional(),cart:M.array(M.object({product_id:M.number().int(),qty:M.number().int().min(1).max(50),option_ids:M.array(M.number().int()).
max(40).default([]),notes:M.string().max(140).optional()})).min(1).max(60),client_key:M.string().regex(/^[A-Za-z0-9_-]{8,80}$/)});Ve.post("/orders",y("delivery.gerenciar"),p(async(e,a)=>{
let t=w(Rr,e.body),n=await k(o=>Pt(o,e.ctx.companyId,t,e.ctx));await g({query:d},e.ctx,"delivery.pedido_interno",{entity:"delivery",entityId:n.id,data:{number:n.number,mode:t.mode}}),
a.status(n.replay?200:201).json(n)}));Ve.post("/orders/:id/status",p(async(e,a)=>{let t=w(M.object({to:M.enum(["confirmado","em_preparo","pronto","saiu","entregue","cancelado"]),reason:M.
string().trim().max(200).optional(),proof:M.string().trim().max(200).optional(),eta_minutes:M.number().int().min(5).max(300).optional()}),e.body),n=await k(async o=>{let i=(await o.
query("select * from delivery_orders where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Pedido n\xE3o encontrado");if(["sa\
iu","entregue"].includes(t.to)&&!e.ctx.can("delivery.gerenciar")){if(Q(e.ctx,"delivery.entregar"),Number(i.courier_id)!==Number(e.ctx.userId))throw b("Pedido atribu\xEDdo a outro entr\
egador")}else Q(e.ctx,"delivery.gerenciar");if(i.status===t.to)return{ok:!0,replay:!0};if(!yi[i.status].includes(t.to))throw b(`N\xE3o \xE9 poss\xEDvel ir de "${lt[i.status]}" para\
 "${lt[t.to]}"`,"invalid_transition");if(t.to==="saiu"&&i.mode!=="entrega")throw f("Pedido de retirada n\xE3o sai para entrega");if(t.to==="cancelado"&&!t.reason)throw f("Informe o\
 motivo do cancelamento");if(t.to==="confirmado"&&await o.query("update order_items set sent_at = now() where session_id = $1 and kitchen_status = 'novo' and sent_at is null and st\
atus = 'ativo'",[i.session_id]),t.to==="cancelado"){if((await K(o,i.session_id)).paid>0)throw b("H\xE1 pagamento confirmado: estorne antes de cancelar","has_payments");let r=(await o.
query("select id, kitchen_status from order_items where session_id = $1 and status = 'ativo'",[i.session_id])).rows;for(let c of r)["novo","aceito","nao_produz"].includes(c.kitchen_status)&&
await Gt(o,e.ctx,c.id,`Delivery cancelado: ${t.reason}`);await o.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
          kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where session_id = $1 and status = 'ativo'`,[i.session_id,`Delivery canc\
elado: ${t.reason}`,e.ctx.userId]),await o.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2 where id = $1",[i.session_id,e.ctx.userId])}
if(t.to==="entregue"){let s=await K(o,i.session_id);if(s.balance>0&&!t.proof)throw b(`Saldo de R$ ${(s.balance/100).toFixed(2).replace(".",",")} em aberto: registre o pagamento ou \
informe o comprovante`,"balance_pending");let r=(await o.query("select * from consumption_sessions where id = $1 for update",[i.session_id])).rows[0];s.balance===0&&s.items>0&&["ab\
erta","em_fechamento"].includes(r.status)&&(await o.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2, version = version + 1 where id =\
 $1",[r.id,e.ctx.userId]),await wn(o,e.ctx,r,s.items))}return await o.query(`update delivery_orders set status = $2, cancel_reason = coalesce($3, cancel_reason), proof = coalesce($\
4, proof),
        eta_minutes = coalesce($5, eta_minutes), updated_at = now() where id = $1`,[i.id,t.to,t.to==="cancelado"?t.reason:null,t.proof??null,t.eta_minutes??null]),await o.query("in\
sert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,i.id,t.to,e.ctx.userId,t.reason||t.proof||null]),await g(o,e.ctx,`\
delivery.${t.to}`,{entity:"delivery",entityId:i.id,reason:t.reason,data:{from:i.status}}),{ok:!0,status:t.to}});a.json(n)}));Ve.post("/orders/:id/courier",y("delivery.gerenciar"),p(
async(e,a)=>{let t=w(M.object({courier_id:M.number().int().nullable()}),e.body);if(t.courier_id&&!(await d("select 1 from users where id = $1 and company_id = $2 and active",[t.courier_id,
e.ctx.companyId])).rows[0])throw f("Entregador inv\xE1lido");let n=await d("update delivery_orders set courier_id = $3, updated_at = now() where id = $1 and company_id = $2 returni\
ng id",[Number(e.params.id),e.ctx.companyId,t.courier_id]);if(!n.rows[0])throw v();await g({query:d},e.ctx,"delivery.entregador",{entity:"delivery",entityId:n.rows[0].id,data:t}),a.
json({ok:!0})}));Ve.get("/couriers",y("delivery.gerenciar"),p(async(e,a)=>{a.json((await d(`select u.id, u.name, u.role_key from users u join roles r on r.company_id = u.company_id\
 and r.key = u.role_key
    where u.company_id = $1 and u.active and 'delivery.entregar' = any(r.permissions) order by u.name`,[e.ctx.companyId])).rows)}));import Fr from"node:crypto";import{Router as Br}from"npm:express@5.2.1";import{z as xe}from"npm:zod@4.6.5";var Cn=e=>({enabled:!1,name:"Atendente virtual",greeting:"Ol\xE1! Sou o atendimento virtual. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* do ped\
ido ou fazer uma *reserva*. Para falar com a equipe, digite *atendente*.",handoff_message:"Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA. Aguarde um instante.",closed_message:"\
No momento n\xE3o estamos recebendo pedidos. Veja nossos hor\xE1rios digitando *hor\xE1rio*.",reservation_max_people:12,reservation_min_hours:2,...e?.agent||{}});function Dr(e,a){let t=new Date(
`${e}Z`);if(Number.isNaN(t.getTime()))return t;let n=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:a,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"\
2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(t).map(i=>[i.type,i.value])),o=Date.UTC(+n.year,+n.month-1,+n.day,+n.hour,+n.minute,+n.second);return new Date(t.getTime()-
(o-t.getTime()))}var zn=e=>String(e||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim(),gt=e=>`R$ ${(Number(e)/100).toFixed(2).replace(".",",")}`,we=(e,...a)=>a.some(
t=>new RegExp(`(^|\\W)${t}(\\W|$)`).test(e));async function Mr(e){return(await d(`select p.id, p.name, p.price_cents, c.name as category, p.kind,
      exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as required_opts
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and (('delivery' = any(p.channels)) or ('cardapio_digital' = any(p.channels)) or ('pdv' = any(p.channels)))
    order by c.sort nulls last, c.name, p.name limit 200`,[e])).rows}var Lr=new Set(["quanto","custa","valor","preco","qual","quero","uma","umas","uns","com","sem","por","favor","t\
em","voces","pra","para","mais","esta","esse","essa"]);function ha(e,a){let t=zn(a),n=null,o=0;for(let i of e){let s=zn(i.name);if(t.includes(s))return i;let r=s.split(/\s+/).filter(
_=>_.length>2),c=t.split(/\W+/).filter(_=>_.length>2&&!Lr.has(_)),m=r.filter(_=>t.includes(_)).length,u=c.filter(_=>r.some(h=>h.startsWith(_)||_.startsWith(h))).length,l=m?Math.max(
r.length?m/r.length:0,c.length?u/c.length:0):0;l>o&&(o=l,n=i)}return o>=.5?n:null}function fi(e,a){let t=zn(a),n=t.match(/^(\d{1,2})\s*(x\s*)?(.+)$/),o=n?Number(n[1]):1,i=ha(e,n?n[3]:
t);return i?{p:i,qty:Math.min(Math.max(o,1),50)}:null}var wi=(e,a)=>e.map(t=>{let n=a.find(o=>o.id===t.product_id);return`${t.qty}\xD7 ${n?.name} \u2014 ${gt((n?.price_cents||0)*t.
qty)}`}).join(`
`);async function Ur(e,a,t,{simulated:n}){let o=Cn(e.settings),i=ht(e.settings),s={...a.state||{}},r=zn(t),c=[],m=await Mr(e.id);if(we(r,"atendente","humano","pessoa","gerente","re\
clamacao","reclamar","problema","desconto","cobranca","estorno","reembolso"))return{replies:[o.handoff_message],state:{step:null},handoff:!0};if(we(r,"cancelar","cancela","sair","r\
ecomecar")&&s.step&&!we(r,"reserva"))return{replies:["Tudo bem, cancelei o que est\xE1vamos montando. Posso ajudar em algo mais?"],state:{step:null}};if(s.step==="pedido"){if(we(r,
"finalizar","fechar","pronto","so isso","e isso","acabou")){if(!s.cart?.length)return{replies:["Seu pedido ainda est\xE1 vazio. Envie, por exemplo: *2 pilsen*."],state:s};let h=[i.
delivery&&"*entrega*",i.pickup&&"*retirada*"].filter(Boolean).join(" ou ");return{replies:[`Seu pedido:
${wi(s.cart,m)}

Vai ser ${h}?`],state:{...s,step:"modo"}}}let _=[];for(let h of String(t).split(/\n|,| e (?=\d)/)){if(!h.trim())continue;let $=fi(m,h);if($){if($.p.required_opts){c.push(`*${$.p.name}\
* tem op\xE7\xF5es para escolher \u2014 pe\xE7a esse item pelo card\xE1pio digital${e.slug?`: /c/${e.slug}`:""}.`);continue}s.cart=[...s.cart||[],{product_id:$.p.id,qty:$.qty}],_.push(
`${$.qty}\xD7 ${$.p.name}`)}}return _.length?c.push(`Anotado: ${_.join(", ")}. Algo mais? Quando terminar, digite *finalizar*.`):c.length||c.push("N\xE3o encontrei esse item no card\xE1p\
io. Digite *card\xE1pio* para ver as op\xE7\xF5es ou envie como *2 pilsen*."),{replies:c,state:s}}if(s.step==="modo")return we(r,"entrega","entregar","delivery")&&i.delivery?{replies:[
"Qual o endere\xE7o? Envie *rua, n\xFAmero e bairro*."],state:{...s,step:"endereco",mode:"entrega"}}:we(r,"retirada","retirar","buscar","balcao")&&i.pickup?{replies:["Em nome de qu\
em fica o pedido?"],state:{...s,step:"nome",mode:"retirada"}}:{replies:["Responda *entrega* ou *retirada*."],state:s};if(s.step==="endereco"){let _=String(t).split(",").map(h=>h.trim());
return _.length<2||!/\d/.test(_[1])?{replies:["Preciso de rua e n\xFAmero, separados por v\xEDrgula. Ex.: *Rua das Flores, 120, Centro*."],state:s}:{replies:["Em nome de quem fica \
o pedido?"],state:{...s,step:"nome",address:{street:_[0],number:_[1],district:_[2]||""}}}}if(s.step==="nome"){let _=String(t).trim().slice(0,60);if(_.length<2)return{replies:["Qual\
 o nome?"],state:s};let{subtotal:h}=await fa({query:d},e.id,s.cart).catch(()=>({subtotal:0})),$=s.mode==="entrega"?i.fee_cents:0;return{replies:[`Confira:
${wi(s.cart,m)}
${$?`Taxa de entrega: ${gt($)}
`:""}*Total: ${gt(h+$)}*
${s.mode==="entrega"?`Entrega em: ${s.address.street}, ${s.address.number}`:"Retirada no balc\xE3o"} \xB7 Nome: ${_}
Pagamento na ${s.mode==="entrega"?"entrega":"retirada"}.

Responda *confirmar* para enviar ou *cancelar*.`],state:{...s,step:"confirmar",name:_}}}if(s.step==="confirmar"){if(!we(r,"confirmar","confirmo","sim","pode","ok"))return{replies:[
"Responda *confirmar* para enviar o pedido ou *cancelar*."],state:s};if(n)return{replies:["\u2705 (Simula\xE7\xE3o) Pedido montado corretamente. Nada foi enviado \xE0 cozinha nem registrado nas \
vendas."],state:{step:null}};try{let _=await k(h=>Pt(h,e.id,{channel:"whatsapp",mode:s.mode,customer_name:s.name,phone:a.contact,address:s.address,cart:s.cart,client_key:`wa${a.id}\
x${Se(6)}`},null));return{replies:[`\u2705 Pedido *#${_.number}* recebido! Total ${gt(_.total)}. Avisaremos quando for confirmado. Para acompanhar, digite *status*.`],state:{step:null}}}catch(_){
return{replies:[`N\xE3o consegui registrar o pedido: ${_.message}`],state:{step:null}}}}if(s.step==="reserva"){let _=String(t).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\D+(\d{1,2})(?:[:h](\d{2}))?\D+(\d{1,3})/i);
if(!_)return{replies:["Envie *dia/m\xEAs, hor\xE1rio e pessoas*. Ex.: *25/10 20:30 4 pessoas*."],state:s};let h=_[3]?_[3].length===2?2e3+Number(_[3]):Number(_[3]):new Date().getFullYear(),
$=e.timezone||"America/Sao_Paulo",N=`${h}-${String(_[2]).padStart(2,"0")}-${String(_[1]).padStart(2,"0")}T${String(_[4]).padStart(2,"0")}:${_[5]||"00"}:00`,P=Dr(N,$),T=Number(_[6]);
if(Number.isNaN(P.getTime()))return{replies:["Data inv\xE1lida. Ex.: *25/10 20:30 4 pessoas*."],state:s};if(P.getTime()<Date.now()+o.reservation_min_hours*36e5)return{replies:[`Res\
ervas precisam de pelo menos ${o.reservation_min_hours}h de anteced\xEAncia.`],state:s};if(T<1||T>o.reservation_max_people)return{replies:[`Para grupos acima de ${o.reservation_max_people}\
 pessoas, a equipe vai te atender.`],state:{step:null},handoff:!0};if(n)return{replies:[`\u2705 (Simula\xE7\xE3o) Reserva para ${T} pessoa(s) em ${_[1]}/${_[2]} \xE0s ${_[4]}:${_[5]||
"00"} \u2014 nada foi gravado.`],state:{step:null}};let q=(await d("select id from units where company_id = $1 and active order by id limit 1",[e.id])).rows[0];return await d("inse\
rt into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source) values ($1,$2,$3,$4,$5,$6,'pendente','agente')",[e.id,q.id,a.contact_name||"Clie\
nte WhatsApp",a.contact,T,P]),{replies:[`Pedido de reserva para *${T}* pessoa(s) em *${_[1]}/${_[2]} \xE0s ${_[4]}:${_[5]||"00"}* registrado. A equipe confirma em breve.`],state:{step:null}}}
if(we(r,"oi","ola","bom dia","boa tarde","boa noite","menu inicial","ajuda","opcoes")&&r.length<30)return{replies:[o.greeting],state:{step:null}};if(we(r,"horario","horarios","func\
iona","funcionamento","aberto","abre","fecha"))return{replies:[`${i.hours?`Nosso hor\xE1rio: ${i.hours}`:"Consulte nosso hor\xE1rio com a equipe."}${i.enabled?i.accepting?`
Estamos recebendo pedidos agora.`:`
No momento n\xE3o estamos recebendo pedidos.`:""}`],state:s};if(we(r,"cardapio","menu","opcoes de","o que tem","tem o que")){let _={};for(let $ of m)(_[$.category||"Outros"]||=[]).
push(`\u2022 ${$.name} \u2014 ${gt($.price_cents)}`);return{replies:[Object.entries(_).map(([$,N])=>`*${$}*
${N.slice(0,12).join(`
`)}`).join(`

`).slice(0,3500)||"Card\xE1pio indispon\xEDvel no momento.","Para pedir, digite *pedido*."],state:s}}if(we(r,"status","meu pedido","cade","acompanhar","demora")){let _=(await d("se\
lect number, status, mode, eta_minutes, created_at from delivery_orders where company_id = $1 and phone = $2 order by id desc limit 1",[e.id,ke(a.contact)])).rows[0];return _?{replies:[
`Pedido *#${_.number}*: *${lt[_.status]}*${["recebido","confirmado","em_preparo"].includes(_.status)&&_.eta_minutes?` \xB7 previs\xE3o de ${_.eta_minutes} min`:""}.`],state:s}:{replies:[
"N\xE3o encontrei pedidos feitos por este n\xFAmero. Se pediu por outro n\xFAmero, fale com um *atendente*."],state:s}}if(we(r,"reserva","reservar","mesa para"))return we(r,"cancel\
ar","cancela","desmarcar")?n?{replies:["\u2705 (Simula\xE7\xE3o) Reserva cancelada \u2014 nada foi alterado."],state:{step:null}}:{replies:[(await d(`update reservations set status\
 = 'cancelada' where id = (select id from reservations where company_id = $1 and phone = $2
          and status in ('pendente','confirmada') and starts_at > now() order by starts_at limit 1) returning starts_at`,[e.id,ke(a.contact)])).rows[0]?"Sua pr\xF3xima reserva foi can\
celada.":"N\xE3o encontrei reserva futura neste n\xFAmero."],state:{step:null}}:we(r,"remarcar","mudar","alterar")?{replies:["Para remarcar, cancele a atual (*cancelar reserva*) e \
fa\xE7a uma nova (*reserva*). Se preferir, chame um *atendente*."],state:s}:{replies:["Vamos reservar! Envie *dia/m\xEAs, hor\xE1rio e n\xFAmero de pessoas*. Ex.: *25/10 20:30 4 pessoas*."],
state:{step:"reserva"}};if(we(r,"pedido","pedir","quero","encomendar","delivery","entrega")){if(!i.enabled||!i.accepting)return{replies:[o.closed_message],state:s};let _=fi(m,r.replace(
/\b(quero|pedir|pedido|fazer|um|uma)\b/g," ").trim()),h=_&&!_.p.required_opts?[{product_id:_.p.id,qty:_.qty}]:[];return{replies:[`${h.length?`Anotado: ${h[0].qty}\xD7 ${_.p.name}. `:
""}Me diga os itens, um por linha, com a quantidade. Ex.:
*2 pilsen*
*1 batata frita*
Quando terminar, digite *finalizar*.`],state:{step:"pedido",cart:h}}}if(we(r,"preco","quanto","valor","custa")){let _=ha(m,r);return{replies:[_?`*${_.name}*: ${gt(_.price_cents)}.`:
"De qual item? Digite *card\xE1pio* para ver todos os pre\xE7os."],state:s}}let u=ha(m,r);if(u)return{replies:[`*${u.name}*: ${gt(u.price_cents)}. Para pedir, digite *pedido*.`],state:s};
let l=(s.misses||0)+1;return l>=3?{replies:[o.handoff_message],state:{step:null},handoff:!0}:{replies:[`N\xE3o entendi. ${o.greeting}`],state:{...s,misses:l}}}async function Wt(e,a,t){
let n=Object.fromEntries((await d("select key, value from company_secrets where company_id = $1 and key in ('wa_token','wa_phone_number_id')",[e])).rows.map(o=>[o.key,o.value]));if(!n.
wa_token||!n.wa_phone_number_id)return{ok:!1,error:"Integra\xE7\xE3o do WhatsApp n\xE3o configurada"};try{let o=await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(n.
wa_phone_number_id)}/messages`,{method:"POST",headers:{authorization:`Bearer ${n.wa_token}`,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:ke(
a),type:"text",text:{body:t.slice(0,4e3)}}),signal:AbortSignal.timeout(8e3)}),i=await o.json().catch(()=>({}));return o.ok?{ok:!0,id:i?.messages?.[0]?.id}:{ok:!1,error:i?.error?.message?.
slice(0,200)||`HTTP ${o.status}`}}catch(o){return{ok:!1,error:String(o.message||o).slice(0,200)}}}async function Jt(e,a,t,n){let o=await e.query(`insert into conversation_messages \
(company_id, conversation_id, direction, author, body, external_id, delivery_status, error, user_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,[a,t,n.direction,n.author,n.body,n.external_id??null,n.delivery_status||"ok",n.error??null,n.user_id??null]);
return await e.query("update conversations set last_message_at = now() where id = $1",[t]),o.rows[0]?.id||null}async function qn(e,{channel:a,contact:t,contactName:n,body:o,externalId:i}){
let s=a==="simulador",r=(await d(`insert into conversations (company_id, channel, contact, contact_name) values ($1,$2,$3,$4)
    on conflict (company_id, channel, contact) do update set contact_name = coalesce(excluded.contact_name, conversations.contact_name) returning *`,[e.id,a,t,n??null])).rows[0];if(!await Jt(
{query:d},e.id,r.id,{direction:"in",author:"cliente",body:String(o).slice(0,4e3),external_id:i}))return{duplicate:!0,conversation_id:r.id,replies:[]};let m=Cn(e.settings);if(r.mode!==
"agente"||!m.enabled&&!s)return{conversation_id:r.id,replies:[],mode:r.mode};let u=await Ur(e,r,o,{simulated:s});await d("update conversations set state = $2, needs_human = needs_h\
uman or $3, mode = case when $3 then 'humano' else mode end where id = $1",[r.id,JSON.stringify(u.state||{}),!!u.handoff]);for(let l of u.replies){let _=s?"simulado":"pendente",h=null,
$=null;if(!s){let N=await Wt(e.id,t,l);_=N.ok?"ok":"falhou",h=N.error||null,$=N.id||null}await Jt({query:d},e.id,r.id,{direction:"out",author:"agente",body:l,external_id:$,delivery_status:_,
error:h})}return{conversation_id:r.id,replies:u.replies,handoff:!!u.handoff}}var ze=Br(),ga=e=>`${e}.${Fr.createHmac("sha256",Ut("unsubscribe")).update(String(e)).digest("base64url").slice(0,16)}`;function hi(e){let[a]=String(e||"").split(".");return/^\d+$/.
test(a||"")&&ga(a)===e?Number(a):null}var gi=xe.object({birthday_month:xe.boolean().optional(),inactive_days:xe.number().int().min(1).max(3650).optional(),tag:xe.string().trim().max(
30).optional(),min_visits:xe.number().int().min(1).max(1e3).optional()}).default({});function bi(e,a,t){let n=`c.company_id = $1 and c.anonymized_at is null and c.unsubscribed_at i\
s null and ${a==="whatsapp"?"c.consent_whatsapp and c.phone is not null":"c.consent_email and c.email is not null"}`;return e.birthday_month&&(n+=" and extract(month from c.birthda\
y) = extract(month from current_date)"),e.tag&&(t.push(e.tag),n+=` and $${t.length} = any(c.tags)`),e.inactive_days&&(t.push(e.inactive_days),n+=` and not exists (select 1 from con\
sumption_sessions s where s.customer_id = c.id and s.opened_at > now() - make_interval(days => $${t.length}))`),e.min_visits&&(t.push(e.min_visits),n+=` and (select count(*) from c\
onsumption_sessions s where s.customer_id = c.id and s.status = 'encerrada') >= $${t.length}`),n}var $i=(e,a,t)=>e.replaceAll("{nome}",(a.name||"").split(" ")[0]).replaceAll("{empr\
esa}",t).replaceAll("{pontos}",String(a.points??0));ze.post("/segments/preview",y("marketing.gerenciar"),p(async(e,a)=>{let t=w(xe.object({channel:xe.enum(["whatsapp","email"]),segment:gi}),
e.body),n=[e.ctx.companyId],o=bi(t.segment,t.channel,n),i=(await d(`select count(*)::int as n from customers c where ${o}`,n)).rows[0].n,s=(await d("select count(*)::int as n from \
customers where company_id = $1 and anonymized_at is null",[e.ctx.companyId])).rows[0].n;a.json({recipients:i,without_consent:s-i})}));ze.get("/campaigns",y("marketing.gerenciar"),
p(async(e,a)=>{a.json((await d(`select c.*, u.name as user_name,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'enviado') as sent,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'falhou') as failed
    from campaigns c left join users u on u.id = c.created_by where c.company_id = $1 order by c.id desc limit 100`,[e.ctx.companyId])).rows)}));ze.post("/campaigns",y("marketing.g\
erenciar"),p(async(e,a)=>{let t=w(xe.object({name:xe.string().trim().min(3).max(80),channel:xe.enum(["whatsapp","email"]),segment:gi,message:xe.string().trim().min(10).max(1500)}),
e.body),n=await d("insert into campaigns (company_id, name, channel, segment, message, created_by) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,t.name,t.channel,t.segment,
t.message,e.ctx.userId]);a.status(201).json({id:n.rows[0].id})}));ze.post("/campaigns/:id/prepare",y("marketing.gerenciar"),p(async(e,a)=>{let t=await k(async n=>{let o=(await n.query(
"select * from campaigns where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw v("Campanha n\xE3o encontrada");if(o.status!=="ra\
scunho")throw b("Campanha j\xE1 preparada");let i=[e.ctx.companyId],s=bi(o.segment,o.channel,i);i.push(o.id);let r=await n.query(`insert into campaign_recipients (company_id, campa\
ign_id, customer_id) select $1, $${i.length}, c.id from customers c where ${s}`,i);return await n.query("update campaigns set status = 'preparada', recipients = $2, prepared_at = n\
ow() where id = $1",[o.id,r.rowCount]),await g(n,e.ctx,"marketing.campanha_preparada",{entity:"campaign",entityId:o.id,data:{recipients:r.rowCount}}),{recipients:r.rowCount}});a.json(
t)}));ze.get("/campaigns/:id/recipients",y("marketing.gerenciar","dados.pessoais"),p(async(e,a)=>{let t=(await d("select c.*, co.name as company from campaigns c join companies co \
on co.id = c.company_id where c.id = $1 and c.company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw v();let n=(await d(`select r.id, r.status, r.sent_at, r.e\
rror, cu.id as customer_id, cu.name, cu.phone, cu.email, cu.points, cu.unsubscribed_at
    from campaign_recipients r join customers cu on cu.id = r.customer_id where r.campaign_id = $1 order by cu.name limit 2000`,[t.id])).rows;a.json(n.map(o=>({...o,message:`${$i(t.
message,o,t.company)}

Para n\xE3o receber mais: ${e.query.base||""}/sair/${ga(o.customer_id)}`})))}));ze.post("/campaigns/:id/recipients/:rid/sent",y("marketing.gerenciar"),p(async(e,a)=>{let t=await d(
"update campaign_recipients set status = 'enviado', sent_at = now() where id = $1 and campaign_id = $2 and company_id = $3 and status in ('pendente','falhou') returning id",[Number(
e.params.rid),Number(e.params.id),e.ctx.companyId]);a.json({ok:!!t.rows[0]})}));ze.post("/campaigns/:id/send",y("marketing.gerenciar"),p(async(e,a)=>{let t=w(xe.object({base_url:xe.
string().url().max(200)}),e.body),n=(await d("select c.*, co.name as company from campaigns c join companies co on co.id = c.company_id where c.id = $1 and c.company_id = $2",[Number(
e.params.id),e.ctx.companyId])).rows[0];if(!n)throw v();if(n.channel!=="whatsapp")throw f("Envio autom\xE1tico dispon\xEDvel s\xF3 para WhatsApp; para e-mail, exporte a lista");if(n.
status!=="preparada")throw b("Prepare a campanha antes de enviar");let o=(await d(`select r.id, cu.id as customer_id, cu.name, cu.phone, cu.points from campaign_recipients r join c\
ustomers cu on cu.id = r.customer_id
    where r.campaign_id = $1 and r.status in ('pendente','falhou') and cu.unsubscribed_at is null and cu.consent_whatsapp limit 300`,[n.id])).rows,i=0,s=0;for(let r of o){let c=await Wt(
e.ctx.companyId,r.phone,`${$i(n.message,r,n.company)}

Para n\xE3o receber mais: ${t.base_url}/sair/${ga(r.customer_id)}`);if(await d("update campaign_recipients set status = $2, sent_at = case when $2 = 'enviado' then now() end, error\
 = $3 where id = $1",[r.id,c.ok?"enviado":"falhou",c.error||null]),c.ok?i++:s++,!c.ok&&/não configurada/.test(c.error))break}i&&!s&&await d("update campaigns set status = 'enviada\
' where id = $1",[n.id]),await g({query:d},e.ctx,"marketing.campanha_enviada",{entity:"campaign",entityId:n.id,data:{sent:i,failed:s}}),a.json({sent:i,failed:s})}));ze.post("/campa\
igns/:id/cancel",y("marketing.gerenciar"),p(async(e,a)=>{if(!(await d("update campaigns set status = 'cancelada' where id = $1 and company_id = $2 and status in ('rascunho','prepar\
ada') returning id",[Number(e.params.id),e.ctx.companyId])).rows[0])throw b("Campanha n\xE3o pode ser cancelada");a.json({ok:!0})}));ze.get("/reviews",y("marketing.gerenciar"),p(async(e,a)=>{
let t=Math.min(365,Number(e.query.days)||30),n=(await d(`select count(*)::int as total, round(avg(score)::numeric, 2)::float as average,
      count(*) filter (where score >= 4)::int as positive, count(*) filter (where score <= 2)::int as negative,
      count(*) filter (where score <= 2 and handled_at is null)::int as pending
    from reviews where company_id = $1 and created_at > now() - make_interval(days => $2)`,[e.ctx.companyId,t])).rows[0],o=(await d("select score, count(*)::int as n from reviews w\
here company_id = $1 and created_at > now() - make_interval(days => $2) group by score order by score",[e.ctx.companyId,t])).rows,i=(await d(`select r.id, r.score, r.comment, r.cre\
ated_at, r.handled_at, r.session_id, cu.name as customer_name, cu.id as customer_id, u.name as handled_name
    from reviews r left join customers cu on cu.id = r.customer_id left join users u on u.id = r.handled_by
    where r.company_id = $1 and r.created_at > now() - make_interval(days => $2) order by (r.score <= 2 and r.handled_at is null) desc, r.id desc limit 200`,[e.ctx.companyId,t])).rows;
a.json({stats:n,distribution:o,items:i})}));ze.post("/reviews/:id/handled",y("marketing.gerenciar"),p(async(e,a)=>{let t=w(xe.object({note:xe.string().trim().min(3).max(300)}),e.body),
n=await d("update reviews set handled_at = now(), handled_by = $3 where id = $1 and company_id = $2 and handled_at is null returning id",[Number(e.params.id),e.ctx.companyId,e.ctx.
userId]);if(!n.rows[0])throw b("Avalia\xE7\xE3o j\xE1 tratada");await g({query:d},e.ctx,"marketing.avaliacao_tratada",{entity:"review",entityId:n.rows[0].id,reason:t.note}),a.json(
{ok:!0})}));ze.get("/review-link/:sessionId",y("pdv.lancar"),p(async(e,a)=>{let t=(await d("select id from consumption_sessions where id = $1 and company_id = $2 and status = 'ence\
rrada'",[Number(e.params.sessionId),e.ctx.companyId])).rows[0];if(!t)throw v("Consumo encerrado n\xE3o encontrado");let n=(await d("select slug from companies where id = $1",[e.ctx.
companyId])).rows[0];a.json({token:Sn(t.id),path:`/avaliar/${Sn(t.id)}`,slug:n.slug})}));import{Router as Vr}from"npm:express@5.2.1";import{z as pe}from"npm:zod@4.6.5";var He=Vr(),ba=["wa_token","wa_phone_number_id","wa_app_secret","wa_verify_token"];He.get("/settings",y("agente.gerenciar"),p(async(e,a)=>{let t=(await d("select slug, settings fro\
m companies where id = $1",[e.ctx.companyId])).rows[0],n=(await d("select key, updated_at from company_secrets where company_id = $1 and key = any($2)",[e.ctx.companyId,ba])).rows,
o=(await d("select m.created_at, m.error from conversation_messages m where m.company_id = $1 and m.delivery_status = 'falhou' order by m.id desc limit 10",[e.ctx.companyId])).rows;
a.json({...Cn(t.settings),slug:t.slug,secrets:Object.fromEntries(ba.map(i=>[i,!!n.find(s=>s.key===i)])),webhook_path:t.slug?`/api/public/whatsapp/${t.slug}`:null,failures:o})}));He.
put("/settings",y("agente.gerenciar"),p(async(e,a)=>{let t=w(pe.object({enabled:pe.boolean(),name:pe.string().trim().min(2).max(40),greeting:pe.string().trim().min(5).max(600),handoff_message:pe.
string().trim().min(5).max(300),closed_message:pe.string().trim().min(5).max(300),reservation_max_people:pe.number().int().min(1).max(100),reservation_min_hours:pe.number().int().min(
0).max(72)}),e.body);await d("update companies set settings = jsonb_set(settings, '{agent}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await g({query:d},e.ctx,
"agente.configuracao",{data:{enabled:t.enabled}}),a.json({ok:!0})}));He.put("/secrets",y("agente.gerenciar","configuracoes.gerenciar"),p(async(e,a)=>{let t=w(pe.object(Object.fromEntries(
ba.map(n=>[n,pe.string().trim().max(600).optional()]))),e.body);await k(async n=>{for(let[o,i]of Object.entries(t))i!==void 0&&(i?await n.query(`insert into company_secrets (compan\
y_id, key, value) values ($1,$2,$3)
        on conflict (company_id, key) do update set value = excluded.value, updated_at = now()`,[e.ctx.companyId,o,i]):await n.query("delete from company_secrets where company_id =\
 $1 and key = $2",[e.ctx.companyId,o]));await g(n,e.ctx,"agente.credenciais",{data:{keys:Object.keys(t).filter(o=>t[o]!==void 0)}})}),a.json({ok:!0})}));He.get("/conversations",y("\
agente.atender"),p(async(e,a)=>{let t=e.query.channel==="simulador"?"simulador":"whatsapp";a.json((await d(`select c.id, c.channel, c.contact, c.contact_name, c.mode, c.needs_human\
, c.last_message_at, u.name as assigned_name,
      (select body from conversation_messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_body,
      (select count(*)::int from conversation_messages m where m.conversation_id = c.id and m.delivery_status = 'falhou') as failures
    from conversations c left join users u on u.id = c.assigned_to where c.company_id = $1 and c.channel = $2
    order by c.needs_human desc, c.last_message_at desc limit 100`,[e.ctx.companyId,t])).rows)}));He.get("/conversations/:id",y("agente.atender"),p(async(e,a)=>{let t=(await d("sel\
ect * from conversations where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw v("Conversa n\xE3o encontrada");let n=(await d(`select m.id,\
 m.direction, m.author, m.body, m.delivery_status, m.error, m.created_at, u.name as user_name
    from conversation_messages m left join users u on u.id = m.user_id where m.conversation_id = $1 order by m.id desc limit 200`,[t.id])).rows.reverse();a.json({conversation:t,messages:n})}));
He.post("/conversations/:id/mode",y("agente.atender"),p(async(e,a)=>{let t=w(pe.object({mode:pe.enum(["agente","humano","pausado"])}),e.body),n=await d(`update conversations set mo\
de = $3, assigned_to = case when $3 = 'humano' then $4 else null end,
      needs_human = case when $3 = 'agente' then false else needs_human end, state = case when $3 = 'agente' then '{}'::jsonb else state end
    where id = $1 and company_id = $2 returning id`,[Number(e.params.id),e.ctx.companyId,t.mode,e.ctx.userId]);if(!n.rows[0])throw v();await Jt({query:d},e.ctx.companyId,n.rows[0].
id,{direction:"out",author:"sistema",delivery_status:"simulado",body:{agente:"Conversa devolvida ao agente",humano:`${e.ctx.name} assumiu a conversa`,pausado:"Agente pausado nesta \
conversa"}[t.mode],user_id:e.ctx.userId}),a.json({ok:!0})}));He.post("/conversations/:id/reply",y("agente.atender"),p(async(e,a)=>{let t=w(pe.object({body:pe.string().trim().min(1).
max(2e3)}),e.body),n=(await d("select * from conversations where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!n)throw v();if(n.mode==="agente")throw b(
"Assuma a conversa antes de responder","not_assumed");let o="simulado",i=null,s=null;if(n.channel==="whatsapp"){let r=await Wt(e.ctx.companyId,n.contact,t.body);o=r.ok?"ok":"falhou",
i=r.error||null,s=r.id||null}await Jt({query:d},e.ctx.companyId,n.id,{direction:"out",author:"equipe",body:t.body,external_id:s,delivery_status:o,error:i,user_id:e.ctx.userId}),a.status(
201).json({ok:o!=="falhou",status:o,error:i})}));He.post("/simulate",y("agente.gerenciar"),p(async(e,a)=>{let t=w(pe.object({body:pe.string().trim().min(1).max(1e3),contact:pe.string().
trim().max(20).optional(),reset:pe.boolean().optional()}),e.body),n=(await d("select id, name, slug, timezone, settings from companies where id = $1",[e.ctx.companyId])).rows[0],o=`\
sim-${t.contact||e.ctx.userId}`;t.reset&&await d("delete from conversations where company_id = $1 and channel = 'simulador' and contact = $2",[e.ctx.companyId,o]);let i=await qn(n,
{channel:"simulador",contact:o,contactName:"Simula\xE7\xE3o",body:t.body,externalId:`sim-${Se(8)}`});a.json(i)}));import{Router as Hr}from"npm:express@5.2.1";import{z as Ge}from"npm:zod@4.6.5";var Kt=Hr();Kt.get("/",y("salao.visualizar"),p(async(e,a)=>{let t=/^\d{4}-\d{2}-\d{2}$/.test(String(e.query.day))?e.query.day:null,n=e.ctx.company.timezone,o=[e.ctx.companyId,n],i="\
r.company_id = $1";t?(o.push(t),i+=` and (r.starts_at at time zone $2)::date = $${o.length}`):i+=" and r.starts_at > now() - interval '3 hours'",a.json((await d(`select r.*, t.numb\
er as table_number from reservations r left join dining_tables t on t.id = r.table_id where ${i} order by r.starts_at limit 200`,o)).rows)}));Kt.post("/",y("salao.gerenciar"),p(async(e,a)=>{
let t=w(Ge.object({customer_name:Ge.string().trim().min(2).max(80),phone:Ge.string().trim().max(20).optional(),people:Ge.number().int().min(1).max(100),starts_at:Ge.string().datetime(
{offset:!0}),table_id:Ge.number().int().nullable().optional(),notes:Ge.string().max(300).optional()}),e.body);if(new Date(t.starts_at).getTime()<Date.now()-36e5)throw f("Hor\xE1rio j\xE1\
 passou");if(t.table_id&&!(await d("select 1 from dining_tables where id = $1 and company_id = $2",[t.table_id,e.ctx.companyId])).rows[0])throw f("Mesa inv\xE1lida");let n=e.ctx.unitId||
(await d("select id from units where company_id = $1 order by id limit 1",[e.ctx.companyId])).rows[0].id,o=await d(`insert into reservations (company_id, unit_id, customer_name, ph\
one, people, starts_at, table_id, notes, status, source)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmada','equipe') returning id`,[e.ctx.companyId,n,t.customer_name,t.phone?ke(t.phone):null,t.people,t.starts_at,t.table_id??null,t.notes??
null]);await g({query:d},e.ctx,"reserva.criada",{entity:"reservation",entityId:o.rows[0].id,data:{people:t.people,starts_at:t.starts_at}}),a.status(201).json({id:o.rows[0].id})}));
Kt.post("/:id/status",y("salao.gerenciar"),p(async(e,a)=>{let t=w(Ge.object({status:Ge.enum(["confirmada","cancelada","chegou","nao_compareceu"]),table_id:Ge.number().int().nullable().
optional()}),e.body),n=await d("update reservations set status = $3, table_id = coalesce($4, table_id) where id = $1 and company_id = $2 returning id, table_id",[Number(e.params.id),
e.ctx.companyId,t.status,t.table_id??null]);if(!n.rows[0])throw v("Reserva n\xE3o encontrada");t.status==="confirmada"&&n.rows[0].table_id&&await d("update dining_tables set status\
 = 'reservada' where id = $1 and status = 'livre'",[n.rows[0].table_id]),await g({query:d},e.ctx,`reserva.${t.status}`,{entity:"reservation",entityId:n.rows[0].id}),a.json({ok:!0})}));import Gr from"node:crypto";import{Router as Jr}from"npm:express@5.2.1";import{z as ee}from"npm:zod@4.6.5";var Ce=Jr();async function Xt(e){if(!/^[a-z0-9-]{3,40}$/.test(String(e)))throw v("Estabelecimento n\xE3o encontrado");let a=(await d("select id, name, slug, phone, address, timezon\
e, settings, is_demo from companies where slug = $1",[e])).rows[0];if(!a)throw v("Estabelecimento n\xE3o encontrado");return a}Ce.get("/:slug/menu",p(async(e,a)=>{let t=await Xt(e.
params.slug),n=ht(t.settings);if(!n.enabled)throw v("Card\xE1pio digital desativado");let o=(await d(`select p.id, p.name, p.description, p.price_cents, p.allergens, p.category_id,\
 c.name as category, c.demo as category_demo,
      case when p.photo is not null then floor(extract(epoch from coalesce(p.photo_updated_at, p.updated_at)))::bigint end as photo_v,
      coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
         'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                       from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id) from modifier_groups g where g.product_id = p.id), '[]') as groups
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and ('delivery' = any(p.channels) or 'cardapio_digital' = any(p.channels))
    order by c.sort nulls last, c.name, p.name`,[t.id])).rows;a.set("cache-control","public, max-age=30"),a.json({company:{name:t.name,slug:t.slug,phone:t.phone,address:t.address?.
city?`${t.address.street||""} ${t.address.number||""} \u2014 ${t.address.city}`:null},settings:{accepting:n.accepting,delivery:n.delivery,pickup:n.pickup,fee_cents:n.fee_cents,min_order_cents:n.
min_order_cents,eta_minutes:n.eta_minutes,hours:n.hours,areas:n.areas,message:n.message,payment_methods:n.payment_methods},products:o})}));Ce.get("/:slug/foto/:id",p(async(e,a)=>{let t=await Xt(
e.params.slug),n=(await d("select photo from products where id = $1 and company_id = $2 and active and photo is not null",[Number(e.params.id)||0,t.id])).rows[0];if(!n)throw v("Fot\
o n\xE3o encontrada");let o=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(n.photo);if(!o)throw v("Foto n\xE3o encontrada");a.set("cache-control","public, max-age=86400"),a.set(
"cross-origin-resource-policy","cross-origin"),a.type(o[1]).send(Buffer.from(o[2],"base64"))}));var Wr=ee.object({mode:ee.enum(["entrega","retirada"]),customer_name:ee.string().trim().
min(2).max(80),phone:ee.string().trim().min(10).max(20),address:ee.object({street:ee.string().trim().max(120),number:ee.string().trim().max(20),district:ee.string().trim().max(80).
optional(),complement:ee.string().trim().max(80).optional(),reference:ee.string().trim().max(120).optional()}).partial().optional(),payment_hint:ee.enum(["dinheiro","pix","cartao"]),
change_for_cents:ee.number().int().min(0).max(1e6).optional(),notes:ee.string().trim().max(300).optional(),cart:ee.array(ee.object({product_id:ee.number().int(),qty:ee.number().int().
min(1).max(50),option_ids:ee.array(ee.number().int()).max(40).default([]),notes:ee.string().trim().max(140).optional()})).min(1).max(40),client_key:ee.string().regex(/^[A-Za-z0-9_-]{12,80}$/),
website:ee.string().max(0).optional()});Ce.post("/:slug/orders",p(async(e,a)=>{let t=await Xt(e.params.slug),n=w(Wr,e.body);await ae(`pub-order:${t.id}:${e.ip}`,8,900),await ae(`pu\
b-order-phone:${t.id}:${n.phone.replace(/\D/g,"")}`,4,900);let o=await k(i=>Pt(i,t.id,{...n,channel:"site"},null));a.status(o.replay?200:201).json({number:o.number,token:o.public_token,
status:o.status})}));Ce.get("/orders/:token",p(async(e,a)=>{if(!/^[A-Za-z0-9_-]{16,40}$/.test(e.params.token))throw v("Pedido n\xE3o encontrado");let t=(await d(`select d.id, d.num\
ber, d.status, d.mode, d.eta_minutes, d.created_at, d.updated_at, d.session_id, d.customer_name, c.name as company, c.slug, c.phone as company_phone
    from delivery_orders d join companies c on c.id = d.company_id where d.public_token = $1`,[e.params.token])).rows[0];if(!t)throw v("Pedido n\xE3o encontrado");let n=(await d("s\
elect description, qty, modifiers, total_cents from order_items where session_id = $1 and status = 'ativo' order by id",[t.session_id])).rows,o=(await d("select status, created_at \
from delivery_events where order_id = $1 order by id",[t.id])).rows,i=await K({query:d},t.session_id);a.set("cache-control","no-store"),a.json({number:t.number,status:t.status,label:lt[t.
status],mode:t.mode,eta_minutes:t.eta_minutes,created_at:t.created_at,first_name:t.customer_name.split(" ")[0],company:t.company,slug:t.slug,company_phone:t.company_phone||null,items:n,
totals:{items:i.items,delivery_fee:i.deliveryFee,total:i.total},events:o.map(s=>({status:s.status,label:lt[s.status],at:s.created_at}))})}));Ce.get("/review/:token",p(async(e,a)=>{
let t=wa(e.params.token);if(!t)throw v("Link inv\xE1lido");let n=(await d(`select s.id, s.company_id, c.name as company, (select 1 from reviews r where r.session_id = s.id) as done\

    from consumption_sessions s join companies c on c.id = s.company_id where s.id = $1 and s.status = 'encerrada'`,[t])).rows[0];if(!n)throw v("Link inv\xE1lido");a.json({company:n.
company,already:!!n.done})}));Ce.post("/review/:token",p(async(e,a)=>{let t=wa(e.params.token);if(!t)throw v("Link inv\xE1lido");await ae(`pub-review:${e.ip}`,10,3600);let n=w(ee.object(
{score:ee.number().int().min(1).max(5),comment:ee.string().trim().max(600).optional()}),e.body),o=(await d("select id, company_id, customer_id from consumption_sessions where id = \
$1 and status = 'encerrada'",[t])).rows[0];if(!o)throw v("Link inv\xE1lido");await d("insert into reviews (company_id, session_id, customer_id, score, comment) values ($1,$2,$3,$4,\
$5)",[o.company_id,o.id,o.customer_id,n.score,n.comment||null]).catch(i=>{throw i.code==="23505"?b("Este consumo j\xE1 foi avaliado. Obrigado!","already_reviewed"):i}),a.status(201).
json({ok:!0})}));Ce.post("/unsubscribe/:token",p(async(e,a)=>{let t=hi(e.params.token);if(!t)throw v("Link inv\xE1lido");let n=await d("update customers set consent_whatsapp = fals\
e, consent_email = false, unsubscribed_at = now(), updated_at = now() where id = $1 returning company_id",[t]);n.rows[0]&&await d(`insert into audit_events (company_id, action, ent\
ity, entity_id, data) values ($1,'cliente.descadastro','customer',$2,'{"origem":"link"}')`,[n.rows[0].company_id,String(t)]),a.json({ok:!0})}));async function xi(e){return Object.fromEntries(
(await d("select key, value from company_secrets where company_id = $1 and key like 'wa_%'",[e])).rows.map(a=>[a.key,a.value]))}Ce.get("/whatsapp/:slug",p(async(e,a)=>{let t=await Xt(
e.params.slug),n=await xi(t.id);if(e.query["hub.mode"]==="subscribe"&&n.wa_verify_token&&Dn(String(e.query["hub.verify_token"]||""),n.wa_verify_token))return a.type("text/plain").send(
String(e.query["hub.challenge"]||"").slice(0,200));a.status(403).json({error:"Verifica\xE7\xE3o recusada"})}));Ce.post("/whatsapp/:slug",p(async(e,a)=>{let t=await Xt(e.params.slug),
n=await xi(t.id);if(!n.wa_app_secret)return a.status(403).json({error:"Integra\xE7\xE3o n\xE3o configurada"});let o=`sha256=${Gr.createHmac("sha256",n.wa_app_secret).update(e.rawBody||
"").digest("hex")}`;if(!Dn(String(e.headers["x-hub-signature-256"]||""),o))return a.status(401).json({error:"Assinatura inv\xE1lida"});let i=(await d("select id, name, slug, timezo\
ne, settings from companies where id = $1",[t.id])).rows[0];for(let s of e.body?.entry||[])for(let r of s.changes||[]){let c=r.value||{},m=Object.fromEntries((c.contacts||[]).map(u=>[
u.wa_id,u.profile?.name]));for(let u of c.messages||[]){let l=u.type==="text"?u.text?.body:u.type==="button"?u.button?.text:u.type==="interactive"?u.interactive?.button_reply?.title||
u.interactive?.list_reply?.title:null;!l||!u.from||await qn(i,{channel:"whatsapp",contact:String(u.from).slice(0,20),contactName:m[u.from]||null,body:l,externalId:u.id})}}a.json({ok:!0})}));
async function vi(e){return/^[0-9a-f]{36}$/.test(String(e))&&(await d("select * from infinitepay_charges where token = $1",[e])).rows[0]||null}Ce.post("/infinitepay/webhook/:token",
p(async(e,a)=>{let t=await vi(e.params.token);if(!t)return a.status(404).json({ok:!1});let n=e.body||{};if(await et({query:d},t,"webhook",n),n.order_nsu&&String(n.order_nsu)!==t.order_nsu)
return a.status(400).json({ok:!1,error:"pedido n\xE3o confere"});try{await Ot(k,t.id,{transaction_nsu:n.transaction_nsu,invoice_slug:n.invoice_slug,capture_method:n.capture_method,
receipt_url:n.receipt_url},"webhook"),a.json({ok:!0})}catch{a.status(400).json({ok:!1})}}));Ce.post("/infinitepay/return",p(async(e,a)=>{await ae(`ip-return:${e.ip}`,60,600);let t=e.
body||{},n=await vi(t.c);if(!n)return a.status(404).json({error:"Pagamento n\xE3o encontrado"});await et({query:d},n,"retorno",{...t,c:void 0});let o=n;try{o=await Ot(k,n.id,{transaction_nsu:t.
transaction_nsu,invoice_slug:t.slug,capture_method:t.capture_method,receipt_url:t.receipt_url},"retorno")}catch{}let i=(await d("select name from companies where id = $1",[n.company_id])).
rows[0];a.json({status:o.status==="divergente"?"pago":o.status,amount_cents:Number(n.amount_cents),description:n.description,company:i?.name,receipt_url:o.receipt_url||t.receipt_url||
null})}));import{Router as $a}from"npm:express@5.2.1";import Kr from"npm:bcryptjs@3.0.3";import ki from"node:crypto";import{z as he}from"npm:zod@4.6.5";var je=$a();je.use(La);je.use((e,a,t)=>{a.set("Cache-Control","no-store"),t()});var xa={companyId:null,userId:null};async function At(e){if(!/^\d{1,18}$/.test(String(e)))throw v("E\
mpresa n\xE3o encontrada.");let{rows:a}=await d("select id, is_demo from companies where id = $1",[e]);if(!a[0]||a[0].is_demo)throw v("Empresa n\xE3o encontrada.");return a[0]}je.get(
"/manifest",(e,a)=>a.json({code:Un,name:"RUSTEN",contract:Ra,contract_minor:1,version:Da,description:"Gest\xE3o e PDV para bares e restaurantes: comandas, mesas, dupla leitura e caixa\
.",features:Ua,settings:so()}));je.get("/tenants",p(async(e,a)=>{let{rows:t}=await d("select id from companies where not is_demo order by id limit 5000"),n=[];for(let o of t){let i=await en(
o.id);if(i){let{is_demo:s,owner_email:r,...c}=i;n.push(c)}}a.json({items:n})}));var Xr=(e,a)=>a||e;je.get("/tenants/:id",p(async(e,a)=>{let t=await At(e.params.id),{is_demo:n,...o}=await en(
t.id),{rows:i}=await d(`select u.name, u.email, u.role_key as role, r.name as role_name, u.active,
            (select max(s.created_at) from user_sessions s where s.user_id = u.id) as last_login_at
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by u.role_key = 'owner' desc, u.name limit 200`,[t.id]),{rows:s}=await d("select name, active from units where company_id = $1 order by id",[t.id]);
a.json({tenant:{...o,users:{n:i.length,active:i.filter(r=>r.active).length,list:i.map(({role_name:r,...c})=>({...c,role_label:Xr(c.role,r)}))},units:s}})}));je.post("/tenants/:id/a\
ccess",p(async(e,a)=>{let t=await At(e.params.id),n=w(he.object({access:he.object({status:he.string(),blocked:he.boolean()}).passthrough()}),e.body);await Mt(t.id,n.access),await g(
{query:d},{...xa,companyId:t.id},"central.situacao_recebida",{entity:"company",entityId:t.id,data:{status:n.access.status,blocked:n.access.blocked}}),a.json({ok:!0})}));je.post("/t\
enants/:id/owner-reset",p(async(e,a)=>{let t=await At(e.params.id),n=w(he.object({email:he.string().trim().toLowerCase().email().max(160).nullable().optional()}),e.body||{}),{rows:o}=await d(
"select id, email from users where company_id = $1 and role_key = 'owner' order by id limit 1",[t.id]),i=o[0];if(!i)throw new z(404,"Esta empresa n\xE3o tem usu\xE1rio respons\xE1vel.",
"not_found");let s=i.email;if(n.email&&n.email!==i.email.toLowerCase()){if((await d("select 1 from users where lower(email) = $1 and id <> $2",[n.email,i.id])).rows[0])throw new z(
409,"Este e-mail j\xE1 \xE9 usado por outro acesso.","email_taken");await d("update users set email = $1 where id = $2",[n.email,i.id]),s=n.email}let r=`Rs-${ki.randomBytes(6).toString(
"base64url")}-${ki.randomInt(10,99)}`;await d(`update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null, active = true
            where id = $1`,[i.id,await Kr.hash(r,12)]),await d("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[i.id]),await g({query:d},{...xa,
companyId:t.id},"central.senha_provisoria",{entity:"user",entityId:i.id,data:{email:s}}),a.json({ok:!0,user_id:String(i.id),email:s,temporary_password:r,message:"Senha provis\xF3ria c\
riada. Oriente o respons\xE1vel a troc\xE1-la em Configura\xE7\xF5es \u203A Meu acesso logo no primeiro acesso."})}));je.post("/tenants/:id/delete",p(async(e,a)=>{let t=await At(e.
params.id);w(he.object({confirm:he.literal(!0),reason:he.string().max(500).nullable().optional()}),e.body||{});let n=await k(async o=>{let{rows:[i]}=await o.query("select id from c\
ompanies where id = $1 for update",[t.id]);if(!i)throw v("Empresa n\xE3o encontrada.");let{rows:[s]}=await o.query("select count(*)::int as usuarios from users where company_id = $\
1",[t.id]),{rows:[r]}=await o.query("select purge_company($1) as tabelas",[t.id]);return{...s,tabelas:r.tabelas}});a.json({ok:!0,removed:n})}));je.get("/settings",p(async(e,a)=>a.json(
{values:await Ze()})));je.put("/settings",p(async(e,a)=>{let t=await co(e.body?.values);a.json({values:t})}));je.get("/tenants/:id/settings",p(async(e,a)=>{let t=await At(e.params.
id);a.json({values:await Yn(t.id)})}));je.put("/tenants/:id/settings",p(async(e,a)=>{let t=await At(e.params.id),n=await k(async o=>{let i=await uo(o,t.id,e.body?.values);return await g(
o,{...xa,companyId:t.id},"central.parametros_alterados",{entity:"company",entityId:t.id,reason:typeof e.body?.reason=="string"?e.body.reason.slice(0,300):null,data:i}),i});a.json({
ok:!0,changed:n,values:await Yn(t.id)})}));var va=$a();va.get("/platform",p(async(e,a)=>{let t=R.CRON_SECRET;if(!t||e.headers.authorization!==`Bearer ${t}`)return a.status(401).json(
{error:"n\xE3o autorizado"});a.json(await jt(50))}));var Je=$a();Je.use(Xe());var Yt=e=>encodeURIComponent(e.ctx.companyId),En=e=>({user_email:e.ctx.email,user_name:e.ctx.name}),On=(e,a,t)=>{
if(e.ctx.company.is_demo)return t(new z(400,"Na demonstra\xE7\xE3o n\xE3o h\xE1 assinatura. Ative sua conta para contratar.","demo"));t()};Je.get("/",p(async(e,a)=>a.json({access:e.
ctx.access,hub:!!await De()})));Je.get("/billing",p(async(e,a)=>{if(e.ctx.company.is_demo||!await De())return a.json({access:e.ctx.access,hub:!1,demo:!!e.ctx.company.is_demo});if(!e.
ctx.can("assinatura.gerenciar"))return a.json({access:e.ctx.access,restricted:!0,hub:!0});let t=await Ee("GET",`/tenants/${Yt(e)}/billing`);t.access&&await Mt(e.ctx.companyId,t.access),
a.json({...t,plans:sn(t.plans),hub:!0})}));Je.post("/billing/checkout",y("assinatura.gerenciar"),On,p(async(e,a)=>{let t=w(he.object({plan_id:he.string().uuid(),cycle:he.enum(["MON\
THLY","ANNUAL"])}),e.body),n=await Ee("POST",`/tenants/${Yt(e)}/billing/checkout`,{...t,...En(e)});await g({query:d},e.ctx,"assinatura.contratacao",{data:{plan_id:t.plan_id,cycle:t.
cycle}}),a.status(201).json(n)}));Je.post("/billing/renew",y("assinatura.gerenciar"),On,p(async(e,a)=>{let t=await Ee("POST",`/tenants/${Yt(e)}/billing/renew`,En(e));await g({query:d},
e.ctx,"assinatura.renovacao"),a.status(201).json(t)}));Je.post("/billing/change-plan",y("assinatura.gerenciar"),On,p(async(e,a)=>{let t=w(he.object({plan_id:he.string().uuid()}),e.
body),n=await Ee("POST",`/tenants/${Yt(e)}/billing/change-plan`,{...t,...En(e)});await It({id:e.ctx.companyId},{fresh:!0}),await g({query:d},e.ctx,"assinatura.troca_plano",{data:t}),
a.json(n)}));Je.post("/billing/cancel",y("assinatura.gerenciar"),On,p(async(e,a)=>{if(w(he.object({confirm:he.literal(!0,{message:"confirme o cancelamento"})}),e.body),e.ctx.role!==
"owner")throw new z(403,"S\xF3 o propriet\xE1rio pode cancelar a assinatura.","forbidden");let t=await Ee("POST",`/tenants/${Yt(e)}/billing/cancel`,{confirm:!0,...En(e)});await It(
{id:e.ctx.companyId},{fresh:!0}),await g({query:d},e.ctx,"assinatura.cancelamento"),a.json(t)}));Je.post("/verify",p(async(e,a)=>{let t=await It({id:e.ctx.companyId,is_demo:e.ctx.company.
is_demo},{fresh:!0});await g({query:d},e.ctx,"assinatura.verificacao"),a.json({ok:!0,refreshed:!!t})}));import ka from"node:crypto";var Yr=()=>globalThis.process?.env??{};function Ii(e,a,t){let n=Yr().EDGE_PROXY_KEY,o=e.headers["x-edge-proxy-key"],i=String(e.headers["x-edge-client-ip"]||
"").trim();if(delete e.headers["x-edge-proxy-key"],n&&typeof o=="string"&&i&&/^[0-9a-fA-F:.]{3,64}$/.test(i)){let s=ka.createHash("sha256").update(o).digest(),r=ka.createHash("sha2\
56").update(n).digest();ka.timingSafeEqual(s,r)&&Object.defineProperty(e,"ip",{value:i,configurable:!0})}t()}function ja(){let e=Ia();e.disable("x-powered-by"),e.set("trust proxy",1),e.use(Ii),e.use(Zr());let a=R.NODE_ENV==="production",t=(R.CORS_ORIGINS||(a?"":"http://localhost:5173")).split(
",").map(m=>m.trim()).filter(m=>m&&(!a||m!=="*")),n=m=>!m||t.includes(m)||!a&&(t.includes("*")||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(m));e.use(Qr({origin:(m,u)=>u(null,
n(m)),credentials:!1,maxAge:600,allowedHeaders:["content-type","authorization","x-terminal-id","x-session-mode"]})),e.use("/api",(m,u,l)=>{u.set("Cache-Control","no-store"),l()});let o=(m,u,l)=>{
m.rawBody=l.toString("utf8")},i=Ia.json({limit:"9mb",verify:o}),s=Ia.json({limit:"1mb",verify:o}),r=/^\/api\/(stock\/notes\/read|pos-sales(\/preview)?|brand\/(fundo|tv_fundo|logo))\/?$/;
e.use((m,u,l)=>(r.test(m.path)?i:s)(m,u,l)),e.get("/api/health",(m,u)=>u.json({ok:!0,service:"rusten-api"})),e.use("/api/auth",ve),e.use("/api/platform/v1",je),e.use("/api/cron",va),
e.use("/api/access",Je),e.use("/api/public",Ce);let c=[Xe(),ge()];return e.use("/api/admin",...c,re),e.use("/api/brand",...c,st),e.use("/api/home",...c,bn),e.use("/api/menu",...c,ge(
"cardapio"),ue),e.use("/api/floor",...c,Ue),e.use("/api/pdv",...c,ge("pdv"),te),e.use("/api/cash",...c,ge("pdv"),nt),e.use("/api/customers",...c,ge("clientes"),$e),e.use("/api/acco\
unts",...c,ge("clientes"),at),e.use("/api/infinitepay",...c,Be),e.use("/api/pos-sales",...c,ge("pdv"),Pe),e.use("/api/kitchen",...c,ge("cozinha"),Ie),e.use("/api/stock",...c,ge("es\
toque"),V),e.use("/api/reports",...c,ge("relatorios"),Nn),e.use("/api/delivery",...c,ge("delivery"),Ve),e.use("/api/marketing",...c,ge("marketing"),ze),e.use("/api/agent",...c,ge("\
agente"),He),e.use("/api/reservations",...c,ge("salao"),Kt),e.use("/api",(m,u,l)=>l(new z(404,"Rota n\xE3o encontrada","not_found"))),e.use((m,u,l,_)=>{if(m instanceof z)return l.status(
m.status).json({error:m.message,code:m.code,...m.extra||{}});if(m?.type==="entity.parse.failed")return l.status(400).json({error:"JSON inv\xE1lido",code:"invalid"});if(m?.type==="e\
ntity.too.large")return l.status(413).json({error:"Requisi\xE7\xE3o muito grande",code:"too_large"});if(m?.code==="22P02"||m?.code==="22003")return l.status(400).json({error:"Valor\
 inv\xE1lido",code:"invalid"});if(m?.code==="23503")return l.status(400).json({error:"Refer\xEAncia inv\xE1lida",code:"invalid_reference"});console.error(JSON.stringify({level:"err\
or",msg:m?.message,path:u.path,method:u.method,code:m?.code})),l.status(500).json({error:"Erro interno. Tente novamente.",code:"internal"})}),e}var nc=!R.EDGE_RUNTIME&&process.argv[1]&&
tc(import.meta.url)===ec.resolve(process.argv[1]);if(nc){let e=Number(R.PORT||3001);await Ft(),ja().listen(e,()=>console.log(`RUSTEN API na porta ${e}`)),setInterval(()=>jt().catch(
()=>{}),6e4).unref()}var Na=null,Sa=ac();Sa.use(async(e,a,t)=>{try{Na??=Ft({log:n=>console.log(`[migrate] ${n}`)}).catch(n=>{throw Na=null,n}),await Na,t()}catch(n){console.error("[boot]",n.message),a.
status(503).json({error:"Servi\xE7o iniciando. Tente novamente em instantes."})}});Sa.use([`${R.PATH_PREFIX}-cf`,R.PATH_PREFIX],ja());Sa.listen(8e3);
