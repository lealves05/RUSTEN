// RUSTEN API — gerado por scripts/build-edge.mjs. Não editar à mão.
var Wa=Object.defineProperty;var Ka=(e,a,t)=>()=>{if(t)throw t[0];try{return e&&(a=e(e=0)),a}catch(n){throw t=[n],n}};var Za=(e,a)=>{for(var t in a)Wa(e,t,{get:a[t],enumerable:!0})};var Jn={};Za(Jn,{MIGRATIONS:()=>ro});var ro,Wn=Ka(()=>{ro=[{name:"001_base_pdv.sql",sql:`-- RUSTEN \u2014 001: base multiempresa, perfis, card\xE1pio, comandas/sess\xF5es, mesas, PDV, caixa, \
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
`}]});globalThis.__RUSTEN_ENV_DEFAULTS__={EDGE_RUNTIME:"1",NODE_ENV:"production",DB_SCHEMA:"rusten",DB_POOL_MAX:"3",PATH_PREFIX:"/rusten-api",CORS_ORIGINS:"*"};import ks from"npm:express@5.2.1";import jn from"npm:express@5.2.1";import gs from"npm:helmet@8.3.0";import bs from"npm:cors@2.8.6";import $s from"node:path";import{fileURLToPath as vs}from"node:url";import ft from"npm:pg@8.23.1";import Vt from"node:crypto";import{Buffer as Nn}from"node:buffer";var Xa=globalThis.__RUSTEN_ENV_DEFAULTS__||{},P=new Proxy({},{get:(e,a)=>{let t=typeof process<"u"?process.env[a]:void 0;return t!==void 0&&t!==""?t:Xa[a]}});ft.types.setTypeParser(20,e=>Number(e));ft.types.setTypeParser(1700,e=>Number(e));ft.types.setTypeParser(1082,e=>e);var Ya=e=>/localhost|127\.0\.0\.1|\/tmp/.test(e||""),Ft=P.DATABASE_URL||
P.SUPABASE_DB_URL,Fe=new ft.Pool({connectionString:Ft,ssl:Ft&&!Ya(Ft)?{rejectUnauthorized:!1}:void 0,max:Number(P.DB_POOL_MAX||10)}),Bt=P.DB_SCHEMA;if(Bt){if(!/^[a-z_][a-z0-9_]*$/.
test(Bt))throw new Error("DB_SCHEMA inv\xE1lido");Fe.on("connect",e=>{e.query(`set search_path to ${Bt}, public`).catch(()=>{})})}var c=(e,a)=>Fe.query(e,a);async function v(e){let a=await Fe.
connect();try{await a.query("begin");let t=await e(a);return await a.query("commit"),t}catch(t){throw await a.query("rollback").catch(()=>{}),t}finally{a.release()}}var N=class extends Error{constructor(a,t,n,o){
super(t),this.status=a,this.code=n,this.extra=o}},f=(e,a="invalid")=>new N(400,e,a),T=(e="Sem permiss\xE3o para esta a\xE7\xE3o",a="forbidden")=>new N(403,e,a),$=(e="N\xE3o encontrado")=>new N(
404,e,"not_found"),g=(e,a="conflict",t)=>new N(409,e,a,t);function w(e,a){let t=e.safeParse(a??{});if(!t.success){let n=t.error.issues[0];throw f(`${n.path.join(".")||"dados"}: ${n.
message}`)}return t.data}var l=e=>(a,t,n)=>Promise.resolve(e(a,t,n)).catch(n);function nt(e,a,t=0,n=0){let o=Math.round(Number(a)*1e3),s=Math.round((e+t)*o/1e3);return Math.max(0,s-
n)}function Cn(e,a){let t=Math.floor(e/a),n=e-t*a;return Array.from({length:a},(o,s)=>t+(s<n?1:0))}function le(e,a="America/Sao_Paulo",t=5){let n=new Intl.DateTimeFormat("en-CA",{timeZone:a,
year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(e),o=i=>n.find(r=>r.type===i).value,s=new Date(Date.UTC(+o("year"),+o("month")-1,+o("day")));
return+o("hour")<t&&(s=new Date(s.getTime()-864e5)),s.toISOString().slice(0,10)}var Se=e=>Vt.createHash("sha256").update(String(e)).digest("hex"),te=(e=32)=>Vt.randomBytes(e).toString(
"base64url");function Ht(e,a){let t=Nn.from(String(e)),n=Nn.from(String(a));return t.length===n.length&&Vt.timingSafeEqual(t,n)}function Be(e){let a=e==null?"":String(e);return/^[=+\-@\t\r]/.
test(a)&&(a=`'${a}`),/[";\n]/.test(a)?`"${a.replace(/"/g,'""')}"`:a}import to from"node:crypto";import{Buffer as no}from"node:buffer";import Fn from"npm:jsonwebtoken@9.0.3";var Pe={"pdv.lancar":"Lan\xE7ar itens","pdv.lancamento_manual":"Lan\xE7amento manual (busca, cat\xE1logo, c\xF3digo digitado)","pdv.alterar_modo":"Trocar modo de leitura no PDV","p\
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
gerenciar":"Configurar o agente de atendimento","agente.atender":"Atender conversas da caixa de entrada"},qn=Object.keys(Pe),En=(...e)=>qn.filter(a=>!e.includes(a)),Gt=[{key:"owner",
name:"Propriet\xE1rio",level:100,permissions:qn},{key:"admin",name:"Administrador",level:90,permissions:En("assinatura.gerenciar")},{key:"gerente",name:"Gerente",level:70,permissions:En(
"assinatura.gerenciar","usuarios.gerenciar","configuracoes.gerenciar")},{key:"caixa",name:"Caixa",level:40,permissions:["pdv.lancar","pdv.lancamento_manual","pdv.abrir_comanda","pd\
v.receber","caixa.abrir","caixa.fechar","caixa.sangria","caixa.suprimento","salao.visualizar","cardapio.visualizar","clientes.visualizar","clientes.gerenciar"]},{key:"garcom",name:"\
Gar\xE7om",level:30,permissions:["pdv.lancar","pdv.lancamento_manual","pdv.abrir_comanda","salao.visualizar","cardapio.visualizar","clientes.visualizar","clientes.gerenciar"]},{key:"\
cozinha",name:"Cozinha",level:20,permissions:["cardapio.visualizar","cozinha.operar"]},{key:"bar",name:"Bar",level:20,permissions:["cardapio.visualizar","pdv.lancar","cozinha.opera\
r"]},{key:"estoque",name:"Estoque",level:30,permissions:["estoque.ajustar","estoque.visualizar","compras.gerenciar","cardapio.visualizar","relatorios.cmv"]},{key:"financeiro",name:"\
Financeiro",level:50,permissions:["financeiro.visualizar","financeiro.estornar","relatorios.visualizar","relatorios.cmv","caixa.reabrir","auditoria.visualizar","estoque.visualizar",
"clientes.visualizar"]},{key:"entregador",name:"Entregador",level:10,permissions:["delivery.entregar"]},{key:"consulta",name:"Consulta",level:5,permissions:["salao.visualizar","car\
dapio.visualizar","relatorios.visualizar"]}],Ve={pdv:"PDV e comandas",salao:"Sal\xE3o, mesas e reservas",cozinha:"Cozinha, bar e KDS",delivery:"Delivery e card\xE1pio digital",cardapio:"\
Card\xE1pio",estoque:"Estoque, compras e fichas t\xE9cnicas",clientes:"Clientes e fidelidade",financeiro:"Caixa e financeiro",relatorios:"Relat\xF3rios",marketing:"Marketing",agente:"\
Agente WhatsApp",fiscal:"Fiscal",infinitepay:"Importa\xE7\xE3o e concilia\xE7\xE3o InfinitePay"},wt={scanner_enabled:!0,mode:"manual",double_read_mandatory:!1,allow_manual:!0,allow_manual_exception:!0,
exception_requires_manager:!0,allow_mode_change:!0,product_timeout_s:15,open_free_card_on_scan:!1,feedback_sound:!0,qty_per_scan:1,max_qty_per_scan:20,terminator:"Enter",kitchen_send:"\
imediato",require_open_cash:!0,service_fee_bp:1e3,card_prefix:"CMD-"};import Pn from"node:crypto";import{Buffer as An}from"node:buffer";var Wt="rusten",Dn=1,Tn="2026.10",Qa=300,eo=300*1e3,On=0,Jt={at:0,v:null};async function pe(){if(Date.now()-Jt.at<6e4)return Jt.v;let e=P.PLATFORM_HUB_URL||"",a=P.PLATFORM_SECRET||
"",t=P.PLATFORM_PRODUCT||"";if(!e||!a)try{let{rows:o}=await c("select key, value from platform_config where key in ('platform_hub_url','platform_secret','platform_product')"),s=Object.
fromEntries(o.map(i=>[i.key,i.value]));e||=s.platform_hub_url||"",a||=s.platform_secret||"",t||=s.platform_product||""}catch{}let n=e&&a?{hub:e.replace(/\/+$/,""),secret:a,product:t||
Wt}:null;return Jt={at:Date.now(),v:n},n}var Rn=(e,a,t,n,o)=>Pn.createHmac("sha256",e).update(`${a}
${String(t).toUpperCase()}
${n}
${Se(o||"")}`).digest("hex");async function ge(e,a,t,n=1e4){let o=await pe();if(!o)throw new N(503,"A assinatura ainda n\xE3o est\xE1 configurada nesta instala\xE7\xE3o. Fale com o suporte.",
"platform_not_configured");if(!/^https:\/\//.test(o.hub)&&P.NODE_ENV==="production")throw new N(503,"Endere\xE7o da central deve usar HTTPS","platform_not_configured");let s=t===void 0?
"":JSON.stringify(t),i=Math.floor(Date.now()/1e3),r;try{r=await fetch(`${o.hub}/api/hub/v1${a}`,{method:e,signal:AbortSignal.timeout(n),headers:{"Content-Type":"application/json","\
X-Platform-Product":o.product,"X-Platform-Timestamp":String(i),"X-Platform-Signature":Rn(o.secret,i,e,a,s)},body:s||void 0})}catch{throw new N(503,"A central de assinaturas n\xE3o res\
pondeu. Tente novamente em instantes.","platform_unavailable")}let d=await r.json().catch(()=>({}));if(!r.ok)throw new N(r.status===401?502:r.status,d?.error||`Central: erro ${r.status}`,
d?.code||"hub_error");return d}async function ht(e){let{rows:a}=await c(`select c.id, c.name, c.email, c.phone, c.document, c.created_at, c.is_demo,
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
consumptions_30d,revenue_30d:Number(t.revenue_30d_cents)/100}}:null}async function at(e,a){await c("update companies set access = $2, access_updated_at = now() where id = $1",[e,a||
{}])}async function gt(e,a=1e4){if(!await pe())return null;let t=await ht(e);if(!t||t.is_demo)return null;let{is_demo:n,owner_email:o,...s}=t,i=await ge("POST","/tenants",s,a);return i?.
access&&await at(e,i.access),i?.access||null}async function He(e,{fresh:a=!1}={}){if(!e||e.is_demo||!await pe())return null;let n=e.access_updated_at?Date.now()-new Date(e.access_updated_at).
getTime():1/0,o=e.access&&Object.keys(e.access).length;if(!a&&o&&n<eo)return e.access;if(!a&&Date.now()<On)return o?e.access:null;try{let s=await ge("GET",`/tenants/${encodeURIComponent(
e.id)}/access`,void 0,4e3);return await at(e.id,s.access),s.access}catch(s){if(s.status===404)try{return await gt(e.id,4e3)}catch{}else On=Date.now()+6e4;return o?e.access:null}}async function ot(e,a,t,n={}){
await pe()&&await e.query("insert into platform_outbox (company_id, kind, payload) values ($1,$2,$3)",[a,t,n])}async function Ge(e=20){if(!await pe())return{sent:0,failed:0};let{rows:a}=await c(
"select * from platform_outbox where sent_at is null and attempts < 20 order by id limit $1",[e]),t=0,n=0;for(let o of a)try{(o.kind==="tenant.created"||o.kind==="tenant.updated")&&
await gt(o.company_id),await c("update platform_outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = $1",[o.id]),t++}catch(s){await c("update platform_\
outbox set attempts = attempts + 1, last_error = $2 where id = $1",[o.id,String(s.message).slice(0,300)]),n++}return{sent:t,failed:n}}async function Mn(e,a,t){try{let n=await pe(),
o=()=>new N(401,"Chamada da central n\xE3o autenticada.","bad_signature");if(!n)throw new N(503,"Liga\xE7\xE3o com a central n\xE3o configurada.","platform_not_configured");let s=Number(
e.headers["x-platform-timestamp"]),i=String(e.headers["x-platform-signature"]||"");if(String(e.headers["x-platform-product"]||"")!==n.product||!Number.isFinite(s)||!/^[0-9a-f]{64}$/.
test(i)||Math.abs(Date.now()/1e3-s)>Qa)throw o();let r=Rn(n.secret,s,e.method,e.url,e.rawBody||"");if(!Pn.timingSafeEqual(An.from(r),An.from(i)))throw o();if(!(await c("insert into\
 platform_nonces (nonce) values ($1) on conflict do nothing returning nonce",[i])).rows[0])throw new N(401,"Chamada repetida.","replay");await c("delete from platform_nonces where \
created_at < now() - interval '1 day'"),t()}catch(n){t(n)}}var Ln=Ve;var ao=P.NODE_ENV==="production",Bn=P.JWT_SECRET||P.SUPABASE_SERVICE_ROLE_KEY||(ao?null:"dev-only-rusten-secret-not-for-production");if(!Bn)throw new Error("JWT_SECRET \xE9 obrigat\xF3ri\
o em produ\xE7\xE3o");var st=e=>no.from(to.hkdfSync("sha256",Bn,"rusten",e,32)),Vn=st("access-token"),oo=12*3600,Hn=30;function Xt(e,a){return Fn.sign({sub:String(e.id),cid:String(
e.company_id),sid:a},Vn,{expiresIn:oo,algorithm:"HS256"})}async function Gn(e,a){let{rows:t}=await c(`select u.id, u.company_id, u.unit_id, u.name, u.email, u.role_key, u.active, u\
.password_changed_at,
            r.name as role_name, r.level, r.permissions,
            c.name as company_name, c.segment, c.timezone, c.settings, c.access, c.access_updated_at, c.is_demo
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
       join companies c on c.id = u.company_id
      where u.id = $1 and u.company_id = $2`,[e,a]);return t[0]}function Ne(){return async(e,a,t)=>{try{let n=e.headers.authorization||"",o=n.startsWith("Bearer ")?n.slice(7):null;
if(!o)throw new N(401,"Sess\xE3o expirada. Entre novamente.","unauthenticated");let s;try{s=Fn.verify(o,Vn,{algorithms:["HS256"]})}catch{throw new N(401,"Sess\xE3o expirada. Entre nov\
amente.","unauthenticated")}let i=await Gn(Number(s.sub),Number(s.cid));if(!i||!i.active)throw new N(401,"Usu\xE1rio inativo","unauthenticated");let r=await c("select revoked_at fr\
om user_sessions where id = $1 and user_id = $2",[s.sid,i.id]);if(!r.rows[0]||r.rows[0].revoked_at)throw new N(401,"Sess\xE3o encerrada","unauthenticated");if(s.iat*1e3<new Date(i.
password_changed_at).getTime()-1e3)throw new N(401,"Senha alterada. Entre novamente.","unauthenticated");let d=await He({id:i.company_id,is_demo:i.is_demo,access:i.access,access_updated_at:i.
access_updated_at}),u={userId:i.id,companyId:i.company_id,unitId:i.unit_id,name:i.name,email:i.email,role:i.role_key,roleName:i.role_name,level:i.level,perms:new Set(i.permissions),
company:{id:i.company_id,name:i.company_name,segment:i.segment,timezone:i.timezone,settings:i.settings,is_demo:i.is_demo},access:i.is_demo?Zt(null,null,{demo:!0}):Zt(d??i.access,i.
access_updated_at),sessionId:s.sid,terminalId:null},m=Number(e.headers["x-terminal-id"]);if(m){let y=await c("select id, unit_id from terminals where id = $1 and company_id = $2 an\
d active",[m,u.companyId]);y.rows[0]&&(u.terminalId=y.rows[0].id,u.terminalUnitId=y.rows[0].unit_id)}u.can=y=>u.perms.has(y),e.ctx=u,t()}catch(n){t(n)}}}var p=(...e)=>(a,t,n)=>{let o=e.
find(s=>!a.ctx.can(s));if(o)return n(T(`Sem permiss\xE3o: ${o}`));n()};function J(e,a){if(!e.can(a))throw T(`Sem permiss\xE3o: ${a}`)}async function h(e,a,t,{entity:n,entityId:o,reason:s,
data:i,unitId:r}={}){await e.query(`insert into audit_events (company_id, unit_id, terminal_id, user_id, action, entity, entity_id, reason, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[a.companyId,r??a.terminalUnitId??a.unitId??null,a.terminalId??null,a.userId??null,t,n??null,o!=null?String(o):null,s??null,Kt(i??{})])}var so=/pass|senha|token|secret|segredo|hash|card_number|cvv/i;
function Kt(e){return Array.isArray(e)?e.map(Kt):e&&typeof e=="object"?Object.fromEntries(Object.entries(e).map(([a,t])=>[a,so.test(a)?"[omitido]":Kt(t)])):e}var io={ACTIVE:"Ativa",
TRIAL:"Em teste",PAYMENT_PENDING:"Aguardando pagamento",PAST_DUE:"Pagamento pendente",SUSPENDED:"Suspensa",CANCELED:"Cancelada",EXPIRED:"Expirada"},Un={ADMINISTRATIVO:"O acesso des\
ta empresa foi bloqueado pela administra\xE7\xE3o da plataforma. Fale com o suporte.",TRIAL_EXPIRADO:"O per\xEDodo de teste terminou. Contrate um plano para continuar operando \u2014 seus \
dados est\xE3o preservados.",CANCELAMENTO:"A assinatura foi encerrada. Contrate novamente para voltar a operar \u2014 seus dados est\xE3o preservados.",FINANCEIRO:"Acesso suspenso \
por pend\xEAncia financeira. Regularize a assinatura \u2014 seus dados est\xE3o preservados."};function Zt(e,a,{demo:t=!1}={}){let n=e||{},o=Object.keys(Ve);if(t)return{allowed:!0,
state:"DEMO",label:"Demonstra\xE7\xE3o",modules:o,warning:null,notices:[],managed:!1,demo:!0};if(!Object.keys(n).length||typeof n.blocked!="boolean")return{allowed:!0,state:"sem_ce\
ntral",label:"Sem central",modules:o,warning:null,notices:[],managed:!1};let s=n.features&&typeof n.features=="object"?n.features:{},r=o.filter(m=>m in s).length?o.filter(m=>s[m]!==
!1):o,d=Array.isArray(n.notices)?n.notices.filter(m=>m&&m.text).map(m=>({level:m.level==="danger"?"danger":"warn",text:String(m.text)})):[],u=!!n.admin_blocked||n.reason==="ADMINIS\
TRATIVO";return{allowed:!n.blocked,state:n.status,label:io[n.status]||n.status,reasonCode:n.reason||null,reason:n.blocked?Un[u?"ADMINISTRATIVO":n.reason]||Un.FINANCEIRO:null,adminBlocked:u,
modules:r,notices:d,warning:d[0]?.text||null,plan:n.plan?.name||null,planId:n.plan?.id||null,cycle:n.cycle||null,validUntil:n.valid_until||null,trial:n.trial||null,support:n.support||
null,supportChannel:n.support_channel||null,managed:!0,updatedAt:a}}var ae=e=>(a,t,n)=>{let o=a.ctx.access;if(!o.allowed)return n(new N(402,o.reason,"access_blocked",{state:o.state}));
if(e&&!o.modules.includes(e))return n(T("M\xF3dulo n\xE3o inclu\xEDdo no plano","module_disabled"));n()};async function oe(e,a,t){let{rows:n}=await c(`insert into rate_limits(key, \
count, reset_at) values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update set
       count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => $2) else rate_limits.reset_at end
     returning count`,[e,t]);if(n[0].count>a)throw new N(429,"Muitas tentativas. Aguarde alguns minutos.","rate_limited")}import Kn from"node:fs";import bt from"node:path";import{fileURLToPath as Xn}from"node:url";var Zn=import.meta.url.startsWith("file:")?bt.join(bt.dirname(Xn(import.meta.url)),"migrations"):"migrations";async function it({log:e=console.log}={}){let a=await Fe.connect();try{
await a.query("select pg_advisory_lock(424242)"),await a.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);let t=new Set((await a.query("select name from schema_migrations")).rows.map(o=>o.name)),n=P.EDGE_RUNTIME?
(await Promise.resolve().then(()=>(Wn(),Jn))).MIGRATIONS:Kn.readdirSync(Zn).filter(o=>/^\d+_.+\.sql$/.test(o)).sort().map(o=>({name:o,sql:null}));for(let{name:o,sql:s}of n){if(t.has(
o))continue;let i=s??Kn.readFileSync(bt.join(Zn,o),"utf8");await a.query("begin");try{await a.query(i),await a.query("insert into schema_migrations(name) values ($1)",[o]),await a.
query("commit"),e(`migra\xE7\xE3o aplicada: ${o}`)}catch(r){throw await a.query("rollback"),new Error(`falha na migra\xE7\xE3o ${o}: ${r.message}`)}}}finally{await a.query("select \
pg_advisory_unlock(424242)").catch(()=>{}),a.release()}}!P.EDGE_RUNTIME&&process.argv[1]&&Xn(import.meta.url)===bt.resolve(process.argv[1])&&it().then(()=>Fe.end()).catch(e=>{console.
error(e.message),process.exit(1)});import{Router as ho}from"npm:express@5.2.1";import Re from"npm:bcryptjs@3.0.3";import go from"node:crypto";import{z as q}from"npm:zod@4.6.5";var co=["scanner_enabled","allow_manual","allow_manual_exception","allow_mode_change","open_free_card_on_scan"],mo=["double_read_mandatory","exception_requires_manager","require_op\
en_cash"],uo=["max_qty_per_scan"];function Yt(e={},a={},t={}){let n=[wt,e||{},a||{},t||{}],o={...wt};for(let s of n.slice(1))for(let[i,r]of Object.entries(s))!(i in wt)||r===void 0||
r===null||(co.includes(i)?o[i]=o[i]&&!!r:mo.includes(i)?o[i]=o[i]||!!r:uo.includes(i)?o[i]=Math.min(o[i],Number(r)):o[i]=r);return o.double_read_mandatory&&(o.mode="dupla"),o.scanner_enabled||
(o.mode="manual"),!o.scanner_enabled&&!o.allow_manual&&(o.allow_manual=!0),o.qty_per_scan=Math.min(Math.max(1,Number(o.qty_per_scan)||1),o.max_qty_per_scan),o}function Je(e){if(e.scanner_enabled===
!1&&e.allow_manual===!1)throw f("Configura\xE7\xE3o eliminaria todos os meios de lan\xE7amento: mantenha o leitor ou o lan\xE7amento manual.");if(e.mode&&!["manual","continua","dup\
la"].includes(e.mode))throw f("Modo inv\xE1lido");if(e.double_read_mandatory&&e.scanner_enabled===!1)throw f("Dupla leitura obrigat\xF3ria exige o leitor habilitado.");if(e.product_timeout_s!=
null&&(e.product_timeout_s<3||e.product_timeout_s>120))throw f("Tempo de espera do produto deve ficar entre 3 e 120 segundos")}async function Ce(e,a,t){let n=await e.query("select \
settings from companies where id = $1",[a.companyId]),o=t?await e.query("select settings from units where id = $1 and company_id = $2",[t,a.companyId]):{rows:[]},s=a.terminalId?await e.
query("select settings from terminals where id = $1",[a.terminalId]):{rows:[]};return Yt(n.rows[0]?.settings?.pdv,o.rows[0]?.settings?.pdv,s.rows[0]?.settings?.pdv)}var We=e=>String(
e??"").replace(/[\r\n\t]/g,"").trim();async function rt(e,a,t){let n=We(t);if(!n)return{type:"DESCONHECIDO",code:n};if(n.length>128)return{type:"DESCONHECIDO",code:n.slice(0,128)};
let{rows:o}=await e.query("select entity, entity_id from scan_codes where company_id = $1 and code = $2",[a,n]);if(!o[0])return{type:"DESCONHECIDO",code:n};let{entity:s,entity_id:i}=o[0];
if(s==="PRODUTO"){let r=await e.query(`select p.id, p.name, p.price_cents, p.kind, p.unit, p.active,
              exists(select 1 from modifier_groups g where g.product_id = p.id) as has_options,
              exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as has_required
         from products p where p.id = $1 and p.company_id = $2`,[i,a]);return r.rows[0]?{type:"PRODUTO",code:n,product:r.rows[0]}:{type:"DESCONHECIDO",code:n}}if(s==="COMANDA"){let r=await e.
query(`select c.id, c.number, c.unit_id, c.status, c.block_reason,
              (select s.id from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_id,
              (select s.status from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_status
         from tab_cards c where c.id = $1 and c.company_id = $2`,[i,a]);return r.rows[0]?{type:"COMANDA",code:n,card:r.rows[0]}:{type:"DESCONHECIDO",code:n}}if(s==="MESA"){let r=await e.
query("select id, number, unit_id, status, area from dining_tables where id = $1 and company_id = $2",[i,a]);return r.rows[0]?{type:"MESA",code:n,table:r.rows[0]}:{type:"DESCONHECI\
DO",code:n}}return{type:s,code:n,id:i}}async function De(e,a,t,n,o){let s=We(t);if(!s)throw f("C\xF3digo vazio");if(s.length>128)throw f("C\xF3digo muito longo");let i=await e.query(
"select entity, entity_id from scan_codes where company_id = $1 and code = $2",[a,s]);if(i.rows[0]){if(i.rows[0].entity===n&&Number(i.rows[0].entity_id)===Number(o))return;throw g(
`C\xF3digo ${s} j\xE1 est\xE1 em uso (${i.rows[0].entity.toLowerCase()} ${i.rows[0].entity_id}). Cadastros amb\xEDguos n\xE3o s\xE3o permitidos.`,"code_in_use")}await e.query("inse\
rt into scan_codes (company_id, code, entity, entity_id) values ($1,$2,$3,$4)",[a,s,n,o])}var Yn=(e,a,t)=>`${e}${a>1?`${a}-`:""}${String(t).padStart(6,"0")}`;async function Z(e,a,t){
let{rows:n}=await e.query("select * from consumption_sessions where id = $1 and company_id = $2 for update",[t,a]);if(!n[0])throw $("Consumo n\xE3o encontrado");return n[0]}function Te(e){
if(e.status!=="aberta")throw g(`Consumo ${{em_fechamento:"em fechamento",encerrada:"encerrada",cancelada:"cancelada"}[e.status]||e.status}: n\xE3o aceita lan\xE7amentos`,"session_n\
ot_open")}function be(e,a){if(e.unitId&&Number(e.unitId)!==Number(a)&&e.level<90)throw T("Registro de outra unidade")}async function M(e,a){let t=await e.query("select service_fee_\
bp, delivery_fee_cents from consumption_sessions where id = $1",[a]),n=await e.query("select coalesce(sum(total_cents) filter (where status = 'ativo'), 0)::bigint as items from ord\
er_items where session_id = $1",[a]),o=await e.query("select coalesce(sum(amount_cents) filter (where status = 'confirmado'), 0)::bigint as paid from payments where session_id = $1",
[a]),s=Number(n.rows[0].items),i=Math.round(s*(t.rows[0]?.service_fee_bp||0)/1e4),r=Number(t.rows[0]?.delivery_fee_cents||0),d=s+i+r,u=Number(o.rows[0].paid);return{items:s,serviceFee:i,
serviceFeeBp:t.rows[0]?.service_fee_bp||0,deliveryFee:r,total:d,paid:u,balance:d-u}}async function Qt(e,a,t={}){let o=(await e.query("insert into units (company_id, name, day_cutoff) values ($1,$2,$3) returning id",[a,t.unit_name||"Matriz",t.day_cutoff??5])).rows[0].
id;await e.query("insert into terminals (company_id, unit_id, name) values ($1,$2,$3)",[a,o,"Caixa 1"]);let s={};for(let i of["Cozinha","Bar","Copa"]){let r=await e.query("insert i\
nto production_sectors (company_id, name) values ($1,$2) returning id",[a,i]);s[i]=r.rows[0].id}return await en(e,a,o,1,t.tables??10),await tn(e,a,o,1,t.cards??50),t.demo&&await po(
e,a,s),{unitId:o,sectors:s}}async function en(e,a,t,n,o){let s=[];for(let i=n;i<n+o;i++){let r=await e.query(`insert into dining_tables (company_id, unit_id, number, pos_x, pos_y) \
values ($1,$2,$3,$4,$5)
       on conflict do nothing returning id`,[a,t,i,(i-1)%6,Math.floor((i-1)/6)]);r.rows[0]&&(await De(e,a,`MESA-${String(t).padStart(2,"0")}-${String(i).padStart(3,"0")}`,"MESA",r.
rows[0].id),s.push(r.rows[0].id))}return s}async function tn(e,a,t,n,o,s="CMD-"){let i=(await e.query("select count(*)::int as n from units where company_id = $1 and id <= $2",[a,t])).
rows[0].n,r=[];for(let d=n;d<n+o;d++){let u=await e.query("insert into tab_cards (company_id, unit_id, number) values ($1,$2,$3) on conflict do nothing returning id, number",[a,t,d]);
if(u.rows[0]){let m=Yn(s,i,d);await De(e,a,m,"COMANDA",u.rows[0].id),r.push({...u.rows[0],code:m})}}return r}var lo=[["Cervejas","Bar",[["Cerveja IPA 600 ml",2890,"7890000000011"],
["Pilsen long neck",1290,"7890000000028"],["Chope 300 ml",1190,null]]],["Drinks","Bar",[["Caipirinha",2400,null],["Gin t\xF4nica",3200,null]]],["Lanches","Cozinha",[["Hamb\xFArguer da\
 oficina",3890,null],["Por\xE7\xE3o de fritas",2690,null]]],["Sem \xE1lcool","Bar",[["Refrigerante lata",700,"7890000000035"],["\xC1gua mineral",500,"7890000000042"]]]];async function po(e,a,t){
let n=0;for(let[o,s,i]of lo){let r=await e.query("insert into categories (company_id, name, sort, demo) values ($1,$2,$3,true) returning id",[a,`${o} (demonstra\xE7\xE3o)`,n++]);for(let[
d,u,m]of i){let y=await e.query(`insert into products (company_id, category_id, sector_id, name, price_cents, kind, demo, favorite, channels)
         values ($1,$2,$3,$4,$5,$6,true,$7,'{pdv,delivery,cardapio_digital}') returning id`,[a,r.rows[0].id,t[s],d,u,s==="Cozinha"?"recipe":"resale",n===1]);if(m&&await De(e,a,m,"P\
RODUTO",y.rows[0].id),d.startsWith("Hamb\xFArguer")){let _=await e.query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Ponto da\
 carne',1,1) returning id",[a,y.rows[0].id]);for(let x of["Mal passado","Ao ponto","Bem passado"])await e.query("insert into modifier_options (company_id, group_id, name) values ($\
1,$2,$3)",[a,_.rows[0].id,x]);let j=await e.query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Adicionais',0,3) returning id",
[a,y.rows[0].id]);for(let[x,S]of[["Bacon",600],["Queijo extra",400],["Ovo",300]])await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2\
,$3,$4)",[a,j.rows[0].id,x,S])}}}}async function Qn(e,a,t,n,o){let s=Object.fromEntries((await e.query("select id, name, price_cents, sector_id from products where company_id = $1",
[a])).rows.map(x=>[x.name,x])),i=(await e.query("select id from dining_tables where company_id = $1 and number = 3",[a])).rows[0],r=(await e.query("select id from tab_cards where c\
ompany_id = $1 order by number limit 3",[a])).rows,d=0,u=4,m=()=>(u=u===4?9:u===9?18:4,u);async function y(x,{tableId:S=null,cardId:A=null,label:D=null},L,U="aberta"){let fe=(await e.
query(`insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, label, status, service_fee_bp, opened_by, business_date,
                                         opened_at, closed_at, closed_by)
       values ($1,$2,$3,$4,$5,$6,$7,1000,$8,$9, now() - interval '90 minutes', case when $7 = 'encerrada' then now() - interval '20 minutes' end,
               case when $7 = 'encerrada' then $8::bigint end) returning id`,[a,t,x,A,S,D,U,n,o])).rows[0].id,we=0;for(let[V,ne,ze]of L){let he=s[V];if(!he)continue;let yt=he.price_cents*
ne;we+=yt,await e.query(`insert into order_items (company_id, session_id, product_id, description, qty, unit_price_cents, total_cents, sector_id,
                                  kitchen_status, launch_mode, user_id, idempotency_key, created_at, sent_at, accepted_at, ready_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11, now() - interval '${m()} minutes',
                 case when $9 <> 'nao_produz' then now() - interval '${m()} minutes' end,
                 case when $9 in ('aceito','preparando','pronto','entregue') then now() - interval '8 minutes' end,
                 case when $9 in ('pronto','entregue') then now() - interval '3 minutes' end)`,[a,fe,he.id,he.name,ne,he.price_cents,yt,he.sector_id,ze,n,`demo-${fe}-${++d}`])}return{
id:fe,total:we}}i&&(await y("mesa",{tableId:i.id,label:"Mesa 3"},[["Hamb\xFArguer da oficina",2,"preparando"],["Por\xE7\xE3o de fritas",1,"pronto"],["Chope 300 ml",4,"entregue"]]),
await e.query("update dining_tables set status = 'ocupada' where id = $1",[i.id])),r[0]&&await y("comanda",{cardId:r[0].id},[["Cerveja IPA 600 ml",2,"nao_produz"],["Caipirinha",1,"\
novo"]]),r[1]&&await y("comanda",{cardId:r[1].id},[["Gin t\xF4nica",2,"entregue"],["\xC1gua mineral",1,"nao_produz"]]);let _=await y("balcao",{label:"Balc\xE3o"},[["Pilsen long nec\
k",3,"nao_produz"],["Por\xE7\xE3o de fritas",1,"entregue"]],"encerrada"),j=_.total+Math.round(_.total*.1);await e.query(`insert into payments (company_id, session_id, method, amoun\
t_cents, business_date, idempotency_key, user_id, created_at)
     values ($1,$2,'pix',$3,$4,$5,$6, now() - interval '20 minutes')`,[a,_.id,j,o,`demo-pay-${_.id}`,n]),await _o(e,a,t,n,_.id)}async function _o(e,a,t,n,o){let s={loyalty:{enabled:!0,
cents_per_point:100,point_value_cents:5,validity_days:365,min_redeem:100},delivery:{enabled:!0,accepting:!0,delivery:!0,pickup:!0,fee_cents:700,min_order_cents:3e3,eta_minutes:40,hours:"\
Ter a dom, 18h \xE0s 0h",areas:"Centro, Vila Nova e Jardim",payment_methods:["dinheiro","pix","cartao"],message:"Chope em dobro at\xE9 as 20h!"},agent:{enabled:!1,name:"R\xFAstica",
greeting:"Ol\xE1! Sou a R\xFAstica, atendente virtual do bar. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* ou fazer uma *reserva*. Para falar com a\
 equipe, digite *atendente*.",handoff_message:"Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA.",closed_message:"No momento n\xE3o estamos recebendo pedidos.",reservation_max_people:12,
reservation_min_hours:2}};await e.query("update companies set slug = $2, settings = settings || $3::jsonb where id = $1",[a,`demo-${a}`,JSON.stringify(s)]);let i=String(new Date().
getMonth()+1).padStart(2,"0"),r={};for(let[y,_,j,x,S,A,D]of[["Ana Souza","52998224725","11988887777","1990-03-12",["vip","chope"],!0,120],["Bruno Lima","39053344705","11977776666",
`1987-${i}-21`,["anivers\xE1rio"],!0,0],["Carla Dias",null,"11966665555","1995-08-02",[],!1,0]]){let L=await e.query(`insert into customers (company_id, cpf, name, phone, birthday,\
 tags, consent_whatsapp, consent_at, created_by)
      values ($1,$2,$3,$4,$5,$6,$7, case when $7 then now() end, $8) returning id`,[a,_,y,j,x,S,A,n]);r[y]=L.rows[0].id,D&&(await e.query("insert into loyalty_ledger (company_id, c\
ustomer_id, kind, points, expires_at, reason, user_id) values ($1,$2,'ganho',$3, current_date + 365, 'Consumos anteriores', $4)",[a,L.rows[0].id,D,n]),await e.query("update custome\
rs set points = $2 where id = $1",[L.rows[0].id,D]))}await e.query("update consumption_sessions set customer_id = $2, customer_name = $3 where id = $1",[o,r["Bruno Lima"],"Bruno Li\
ma"]);let d=(await e.query("select id from consumption_sessions where company_id = $1 and kind = 'mesa' limit 1",[a])).rows[0];d&&await e.query("update consumption_sessions set cus\
tomer_id = $2, customer_name = $3 where id = $1",[d.id,r["Ana Souza"],"Ana Souza"]),await e.query("insert into reviews (company_id, session_id, customer_id, score, comment) values \
($1,$2,$3,5,$4)",[a,o,r["Bruno Lima"],"Chope gelado e atendimento r\xE1pido!"]);let u={};for(let[y,_,j,x,S]of[["Carne mo\xEDda","kg",8,3200,2],["P\xE3o brioche","un",40,150,12],["B\
atata congelada","kg",12,900,4],["Pilsen long neck (garrafa)","un",48,450,24],["Chope (barril)","L",30,1200,10],["Lim\xE3o","kg",1.5,600,3],["Cacha\xE7a","L",4,2500,1]]){let A=await e.
query("insert into stock_items (company_id, name, unit, min_qty, reorder_qty, avg_cost_cents) values ($1,$2,$3,$4,$5,$6) returning id",[a,y,_,S,S*3,x]);u[y]=A.rows[0].id,await e.query(
"insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, reason, user_id) values ($1,$2,'entrada',$3,$4,'saldo_inicial','Saldo inicial',$5)",[
a,A.rows[0].id,j,x,n])}let m=Object.fromEntries((await e.query("select id, name from products where company_id = $1",[a])).rows.map(y=>[y.name,y.id]));for(let[y,_,j]of[["Hamb\xFArguer\
 da oficina",[["Carne mo\xEDda",.18],["P\xE3o brioche",1]],726],["Por\xE7\xE3o de fritas",[["Batata congelada",.4]],360],["Chope 300 ml",[["Chope (barril)",.3]],360],["Caipirinha",
[["Lim\xE3o",.12],["Cacha\xE7a",.06]],222]]){if(!m[y])continue;let x=await e.query("insert into recipes (company_id, product_id, version, yield_qty, created_by) values ($1,$2,1,1,$\
3) returning id",[a,m[y],n]);for(let[S,A]of _)await e.query("insert into recipe_lines (company_id, recipe_id, stock_item_id, qty) values ($1,$2,$3,$4)",[a,x.rows[0].id,u[S],A]);await e.
query("update products set stock_mode = 'ficha', cost_cents = $2 where id = $1",[m[y],j])}m["Pilsen long neck"]&&await e.query("update products set stock_mode = 'acabado', stock_it\
em_id = $2, cost_cents = 450 where id = $1",[m["Pilsen long neck"],u["Pilsen long neck (garrafa)"]]);for(let[y,_,j,x,S,A]of[["Diego Martins","11955554444",6,21,"confirmada","equipe"],
["Fernanda Alves","11944443333",4,22,"pendente","agente"]])await e.query(`insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source)
      values ($1,$2,$3,$4,$5, date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' + make_interval(hours => $6), $7, $8)`,[a,t,y,_,j,x,S,A])}var ea=[{value:"manual",label:"Manual (toque/busca)"},{value:"continua",label:"Leitura cont\xEDnua"},{value:"dupla",label:"Dupla leitura (comanda \u2192 produto)"}],yo=["America/Sa\
o_Paulo","America/Manaus","America/Cuiaba","America/Belem","America/Fortaleza","America/Recife","America/Bahia","America/Porto_Velho","America/Rio_Branco","America/Noronha"].map(e=>({
value:e,label:e.replace("America/","").replace("_"," ")})),nn=[{key:"signup_enabled",label:"Novos cadastros abertos",type:"boolean",group:"Cadastro e demonstra\xE7\xE3o",default:!0,
help:'Desligado, a tela "Criar conta" do RUSTEN fica fechada (empresas existentes seguem normalmente).'},{key:"demo_enabled",label:'Bot\xE3o "Experimentar demonstra\xE7\xE3o" no login',
type:"boolean",group:"Cadastro e demonstra\xE7\xE3o",default:!0},{key:"demo_days",label:"Dias at\xE9 apagar demonstra\xE7\xF5es n\xE3o ativadas",type:"number",group:"Cadastro e dem\
onstra\xE7\xE3o",min:1,max:30,step:1,unit:"dias",default:7},{key:"default_mode",label:"Modo do PDV em empresas novas",type:"select",group:"Padr\xF5es de empresas novas",options:ea,
default:"manual"},{key:"default_service_fee",label:"Taxa de servi\xE7o padr\xE3o",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:30,step:.5,unit:"%",default:10},{key:"\
default_tables",label:"Mesas criadas no cadastro",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:300,step:1,default:10},{key:"default_cards",label:"Cart\xF5es de comanda\
 criados no cadastro",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:2e3,step:1,default:50},{key:"default_day_cutoff",label:"Virada do dia comercial",type:"number",group:"\
Padr\xF5es de empresas novas",min:0,max:12,step:1,unit:"h",default:5,help:"Vendas antes deste hor\xE1rio contam no dia anterior."},{key:"notice_text",label:"Aviso para todos os usu\
\xE1rios",type:"textarea",group:"Comunica\xE7\xE3o",max:300,default:"",help:"Exibido no topo do RUSTEN para todas as empresas. Deixe vazio para n\xE3o mostrar."},{key:"notice_level",
label:"Tipo do aviso",type:"select",group:"Comunica\xE7\xE3o",default:"info",options:[{value:"info",label:"Informativo"},{value:"warn",label:"Aten\xE7\xE3o"}]}],ta=[{key:"name",label:"\
Nome da empresa",type:"text",group:"Empresa",max:120},{key:"timezone",label:"Fuso hor\xE1rio",type:"select",group:"Empresa",options:yo},{key:"pdv_mode",label:"Modo padr\xE3o do PDV",
type:"select",group:"PDV e leitor",options:ea},{key:"pdv_scanner_enabled",label:"Leitor de c\xF3digo habilitado",type:"boolean",group:"PDV e leitor"},{key:"pdv_double_read_mandator\
y",label:"Dupla leitura obrigat\xF3ria",type:"boolean",group:"PDV e leitor",help:"Exige ler a comanda e depois o produto em cada item; s\xF3 exce\xE7\xE3o autorizada sai dela."},{key:"\
pdv_allow_manual",label:"Permitir lan\xE7amento manual",type:"boolean",group:"PDV e leitor"},{key:"pdv_exception_requires_manager",label:"Exce\xE7\xE3o \xE0 dupla leitura exige gerente",
type:"boolean",group:"PDV e leitor"},{key:"pdv_product_timeout_s",label:"Tempo para ler o produto ap\xF3s a comanda",type:"number",group:"PDV e leitor",min:3,max:120,step:1,unit:"s"},
{key:"pdv_require_open_cash",label:"Exigir caixa aberto para receber",type:"boolean",group:"Caixa e cobran\xE7a"},{key:"pdv_service_fee",label:"Taxa de servi\xE7o",type:"number",group:"\
Caixa e cobran\xE7a",min:0,max:30,step:.5,unit:"%"},{key:"pdv_card_prefix",label:"Prefixo dos cart\xF5es de comanda",type:"text",group:"Caixa e cobran\xE7a",max:8,help:"Letras mai\xFA\
sculas, n\xFAmeros e h\xEDfen."}],fo=({default:e,...a})=>a,na=()=>({system:nn.map(fo),tenant:ta});function wo(e,a){if(a!=null)switch(e.type){case"boolean":if(typeof a!="boolean")throw f(
`${e.label}: valor inv\xE1lido`);return a;case"number":{let t=Number(a);if(!Number.isFinite(t)||e.min!=null&&t<e.min||e.max!=null&&t>e.max)throw f(`${e.label}: use um valor entre ${e.
min} e ${e.max}`);return t}case"select":if(!e.options.some(t=>t.value===a))throw f(`${e.label}: op\xE7\xE3o inv\xE1lida`);return a;default:{let t=String(a).trim();if(e.max&&t.length>
e.max)throw f(`${e.label}: m\xE1ximo de ${e.max} caracteres`);return t}}}function aa(e,a){if(!a||typeof a!="object"||Array.isArray(a))throw f('Envie os par\xE2metros em "values"');
let t={};for(let[n,o]of Object.entries(a)){let s=e.find(r=>r.key===n);if(!s)throw f(`Par\xE2metro desconhecido: ${n}`);let i=wo(s,o);i!==void 0&&(t[n]=i)}return t}var ct={at:0,v:null};
async function Ee(){if(ct.v&&Date.now()-ct.at<3e4)return ct.v;let e=Object.fromEntries(nn.map(a=>[a.key,a.default]));try{let{rows:a}=await c("select key, value from system_settings");
for(let t of a)t.key in e&&(e[t.key]=t.value)}catch{}return ct={at:Date.now(),v:e},e}async function oa(e){let a=aa(nn,e);for(let[t,n]of Object.entries(a))await c(`insert into syste\
m_settings (key, value, updated_at) values ($1, $2::jsonb, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`,[t,JSON.stringify(n)]);return ct.at=0,Ee()}var sa={pdv_mode:"mode",pdv_scanner_enabled:"sca\
nner_enabled",pdv_double_read_mandatory:"double_read_mandatory",pdv_allow_manual:"allow_manual",pdv_exception_requires_manager:"exception_requires_manager",pdv_product_timeout_s:"p\
roduct_timeout_s",pdv_require_open_cash:"require_open_cash",pdv_card_prefix:"card_prefix"};async function an(e){let{rows:a}=await c("select name, timezone, settings from companies \
where id = $1",[e]),t=a[0];if(!t)return null;let n=t.settings?.pdv||{},o={name:t.name,timezone:t.timezone};for(let[s,i]of Object.entries(sa))o[s]=n[i]??null;return o.pdv_service_fee=
n.service_fee_bp!=null?n.service_fee_bp/100:null,o}async function ia(e,a,t){let n=aa(ta,t);if(n.pdv_card_prefix!=null&&!/^[A-Z0-9-]{1,8}$/.test(n.pdv_card_prefix))throw f("Prefixo \
dos cart\xF5es: use letras mai\xFAsculas, n\xFAmeros e h\xEDfen (at\xE9 8)");if(n.name!=null&&n.name.length<2)throw f("Nome da empresa muito curto");let o={};for(let[r,d]of Object.
entries(sa))r in n&&(o[d]=n[r]);"pdv_service_fee"in n&&(o.service_fee_bp=Math.round(n.pdv_service_fee*100));let i={...(await e.query("select settings from companies where id = $1 f\
or update",[a])).rows[0]?.settings?.pdv||{},...o};return Je(i),await e.query(`update companies set name = coalesce($2, name), timezone = coalesce($3, timezone),
                    settings = jsonb_set(settings, '{pdv}', $4::jsonb) where id = $1`,[a,n.name??null,n.timezone??null,JSON.stringify(i)]),n}var _e=ho(),bo=["12345678","senha123","password","qwerty","123456789","rusten123","abc12345"];function Ke(e){if(e.length<10)throw f("A senha precisa ter pelo menos 10 caracteres");
if(!/[a-zA-Z]/.test(e)||!/\d/.test(e))throw f("A senha precisa ter letras e n\xFAmeros");if(bo.some(a=>e.toLowerCase().includes(a)))throw f("Senha muito comum")}var $o=["bar","rest\
aurante","lanchonete","cafeteria","pub","food_truck","hamburgueria","pizzaria","padaria","outro"],vo=q.object({company:q.object({name:q.string().trim().min(2).max(120),segment:q.enum(
$o).default("restaurante"),document:q.string().trim().max(20).optional(),phone:q.string().trim().max(30).optional(),email:q.string().trim().email().max(160).optional(),address:q.object(
{street:q.string().max(160).optional(),city:q.string().max(80).optional(),state:q.string().max(2).optional(),zip:q.string().max(10).optional()}).partial().optional()}),owner:q.object(
{name:q.string().trim().min(2).max(120),email:q.string().trim().toLowerCase().email().max(160),password:q.string().min(1).max(200)}),accept_terms:q.literal(!0,{message:"\xC9 preciso a\
ceitar os termos"}),plan:q.object({code:q.string().max(60).optional(),cycle:q.enum(["mensal","anual"]).optional(),trial:q.boolean().optional()}).optional(),setup:q.object({unit_name:q.
string().trim().max(80).optional(),tables:q.number().int().min(0).max(300).default(10),cards:q.number().int().min(0).max(2e3).default(50),mode:q.enum(["manual","continua","dupla"]).
default("manual"),demo:q.boolean().default(!1),day_cutoff:q.number().int().min(0).max(12).default(5)}).default({})});_e.post("/register",l(async(e,a)=>{let t=await Ee();if(P.ALLOW_SIGNUP===
"false"||t.signup_enabled===!1)throw new N(403,"Novos cadastros est\xE3o temporariamente fechados","signup_closed");await oe(`register:${e.ip}`,10,3600);let n=w(vo,e.body);if(Ke(n.
owner.password),(await c("select 1 from users where lower(email) = $1",[n.owner.email])).rows[0])throw new N(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.',
"email_taken");let s=await Re.hash(n.owner.password,12),i=await v(async d=>{let m=(await d.query(`insert into companies (name, segment, document, phone, email, address, settings)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,[n.company.name,n.company.segment,n.company.document??null,n.company.phone??null,n.company.email??n.owner.email,n.company.address??
{},{pdv:{mode:n.setup.mode,service_fee_bp:Math.round(Number(t.default_service_fee??10)*100)},plan_request:n.plan??null}])).rows[0].id;for(let j of Gt)await d.query("insert into rol\
es (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",[m,j.key,j.name,j.level,j.permissions]);let y=await d.query("insert into users (company_id, nam\
e, email, password_hash, role_key) values ($1,$2,$3,$4,'owner') returning id",[m,n.owner.name,n.owner.email,s]),_={companyId:m,userId:y.rows[0].id};return await Qt(d,m,n.setup),await h(
d,_,"empresa.cadastrada",{entity:"company",entityId:m,data:{segment:n.company.segment,plan:n.plan??null}}),await ot(d,m,"tenant.created"),{companyId:m,userId:y.rows[0].id}});try{await gt(
i.companyId,4e3)&&await c("update platform_outbox set sent_at = now() where company_id = $1 and sent_at is null",[i.companyId])}catch{}let r=await $t({id:i.userId,company_id:i.companyId},
e);a.status(201).json(r)}));async function $t(e,a){let t=go.randomUUID(),n=te(48);return await c(`insert into user_sessions (id, user_id, refresh_hash, expires_at, ip)
           values ($1,$2,$3, now() + make_interval(days => $4), $5)`,[t,e.id,Se(n),Hn,a.ip]),{access_token:Xt(e,t),refresh_token:`${t}.${n}`}}var xo,ko=()=>xo||=Re.hashSync("dummy-\
password-for-timing",12);_e.get("/plans",l(async(e,a)=>{let t=await Ee(),n={signup_open:P.ALLOW_SIGNUP!=="false"&&t.signup_enabled!==!1,demo_enabled:t.demo_enabled!==!1,defaults:{mode:t.
default_mode,tables:t.default_tables,cards:t.default_cards,day_cutoff:t.default_day_cutoff}};if(!await pe())return a.json({...n,hub:!1,plans:[]});try{let o=await ge("GET","/plans",
void 0,5e3);a.json({...n,hub:!0,plans:o.plans||[],trial_default:o.trial_default||null,signup_open:n.signup_open&&o.signup_enabled!==!1})}catch{a.json({...n,hub:!0,plans:[],unavailable:!0})}}));
_e.post("/demo",l(async(e,a)=>{let t=await Ee();if(t.demo_enabled===!1)throw new N(403,"A demonstra\xE7\xE3o est\xE1 desativada no momento.","demo_disabled");await oe(`demo:${e.ip}`,
10,3600);let n=await c("select id from companies where is_demo and created_at < now() - make_interval(days => $1) limit 20",[Number(t.demo_days)||7]);for(let i of n.rows)await v(r=>r.
query("select purge_demo_company($1)",[i.id])).catch(()=>{});let o=te(6).toLowerCase().replace(/[^a-z0-9]/g,"x"),s=await v(async i=>{let r=await i.query("insert into companies (nam\
e, segment, email, settings, is_demo) values ('Bar Demonstra\xE7\xE3o', 'bar', null, $1, true) returning id, timezone",[{pdv:{mode:"manual",service_fee_bp:1e3}}]),d=r.rows[0].id;for(let y of Gt)
await i.query("insert into roles (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",[d,y.key,y.name,y.level,y.permissions]);let u=await i.query("inse\
rt into users (company_id, name, email, password_hash, role_key) values ($1,'Visitante',$2,$3,'owner') returning id",[d,`demo-${o}@demo.rusten.app`,await Re.hash(te(24),8)]),{unitId:m}=await Qt(
i,d,{unit_name:"Matriz",tables:12,cards:30,demo:!0,day_cutoff:5});return await Qn(i,d,m,u.rows[0].id,le(new Date,r.rows[0].timezone,5)),await h(i,{companyId:d,userId:u.rows[0].id},
"demonstracao.criada",{entity:"company",entityId:d}),{companyId:d,userId:u.rows[0].id}});a.status(201).json(await $t({id:s.userId,company_id:s.companyId},e))}));_e.post("/activate",
Ne(),l(async(e,a)=>{let t=w(q.object({company_name:q.string().trim().min(2).max(120),name:q.string().trim().min(2).max(120),email:q.string().trim().toLowerCase().email().max(160),password:q.
string().min(1).max(200),phone:q.string().trim().max(30).optional(),keep_data:q.boolean().default(!1),accept_terms:q.literal(!0,{message:"\xC9 preciso aceitar os termos"})}),e.body);
if(e.ctx.role!=="owner")throw new N(403,"S\xF3 o propriet\xE1rio pode ativar o sistema.","forbidden");if(!e.ctx.company.is_demo)throw f("Esta empresa j\xE1 est\xE1 em uso normal.");
let n=await Ee();if(P.ALLOW_SIGNUP==="false"||n.signup_enabled===!1)throw new N(403,"Novos cadastros est\xE3o temporariamente fechados","signup_closed");if(Ke(t.password),(await c(
"select 1 from users where lower(email) = $1 and id <> $2",[t.email,e.ctx.userId])).rows[0])throw new N(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.',
"email_taken");let s=e.ctx.companyId;await v(async i=>{if(!t.keep_data){await i.query("select set_config('rusten.purge_demo', $1, true)",[String(s)]);for(let r of["delete from revi\
ews where company_id = $1","delete from loyalty_ledger where company_id = $1 and reverses_id is not null","delete from loyalty_ledger where company_id = $1","delete from delivery_e\
vents where company_id = $1","delete from delivery_orders where company_id = $1","delete from kitchen_events where company_id = $1","delete from stock_movements where company_id = \
$1 and reverses_id is not null","delete from stock_movements where company_id = $1","delete from recipe_lines where company_id = $1","delete from recipes where company_id = $1","up\
date products set stock_mode = 'nenhum', stock_item_id = null where company_id = $1","delete from purchase_lines where company_id = $1","delete from purchases where company_id = $1",
"delete from inventory_counts where company_id = $1","update modifier_options set stock_item_id = null where company_id = $1","delete from stock_items where company_id = $1","delet\
e from reservations where company_id = $1","delete from conversation_messages where company_id = $1","delete from conversations where company_id = $1"])await i.query(r,[s]);await i.
query("delete from payments where company_id = $1",[s]),await i.query("delete from cash_movements where company_id = $1",[s]),await i.query("delete from cash_sessions where company\
_id = $1",[s]),await i.query("delete from order_items where company_id = $1",[s]),await i.query("delete from consumption_sessions where company_id = $1",[s]),await i.query("delete \
from customers where company_id = $1",[s]),await i.query("select set_config('rusten.purge_demo', '', true)"),await i.query("update dining_tables set status = 'livre' where company_\
id = $1",[s]),await i.query("delete from scan_codes where company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo)",[s]),await i.
query("delete from modifier_groups where company_id = $1 and product_id in (select id from products where company_id = $1 and demo)",[s]),await i.query("delete from product_price_h\
istory where company_id = $1 and product_id in (select id from products where company_id = $1 and demo)",[s]),await i.query("delete from products where company_id = $1 and demo",[s]),
await i.query("delete from categories where company_id = $1 and demo",[s])}await i.query("update companies set name = $2, phone = coalesce($3, phone), email = $4, is_demo = false, \
created_at = now() where id = $1",[s,t.company_name,t.phone??null,t.email]),await i.query("update users set name = $2, email = $3, password_hash = $4, password_changed_at = now() w\
here id = $1",[e.ctx.userId,t.name,t.email,await Re.hash(t.password,12)]),await i.query("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[e.ctx.
userId]),await h(i,e.ctx,"demonstracao.ativada",{entity:"company",entityId:s,data:{keep_data:t.keep_data}}),await ot(i,s,"tenant.created")});try{await Ge(5)}catch{}a.json(await $t(
{id:e.ctx.userId,company_id:s},e))}));_e.post("/login",l(async(e,a)=>{let t=w(q.object({email:q.string().trim().toLowerCase().max(160),password:q.string().max(200)}),e.body);await oe(
`login:${e.ip}`,30,900),await oe(`login-user:${t.email}`,15,900);let{rows:n}=await c("select * from users where lower(email) = $1",[t.email]),o=n[0],s=await Re.compare(t.password,o?.
password_hash||ko()),i=new N(401,"E-mail ou senha incorretos","bad_credentials");if(!o||!o.active)throw i;if(o.locked_until&&new Date(o.locked_until)>new Date)throw new N(423,"Cont\
a bloqueada temporariamente por tentativas inv\xE1lidas. Tente em 15 minutos.","locked");if(!s)throw await c(`update users set failed_attempts = failed_attempts + 1,
               locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
             where id = $1`,[o.id]),await h({query:c},{companyId:o.company_id,userId:o.id},"login.falhou",{entity:"user",entityId:o.id}),i;await c("update users set failed_attempts\
 = 0, locked_until = null where id = $1",[o.id]),await c("update companies set last_access_at = now() where id = $1",[o.company_id]),await h({query:c},{companyId:o.company_id,userId:o.
id},"login",{entity:"user",entityId:o.id}),a.json(await $t(o,e))}));_e.post("/refresh",l(async(e,a)=>{let t=String(e.body?.refresh_token||""),[n,o]=t.split(".");if(!n||!o||!/^[0-9a-f-]{36}$/.
test(n))throw new N(401,"Sess\xE3o inv\xE1lida","unauthenticated");let s=await v(async i=>{let{rows:r}=await i.query("select s.*, u.company_id, u.active from user_sessions s join u\
sers u on u.id = s.user_id where s.id = $1 for update of s",[n]),d=r[0];if(!d||d.revoked_at||new Date(d.expires_at)<new Date||!d.active)throw new N(401,"Sess\xE3o expirada","unauth\
enticated");if(d.refresh_hash!==Se(o))return await i.query("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[d.user_id]),await h(i,{companyId:d.
company_id,userId:d.user_id},"sessao.reuso_detectado",{entity:"user",entityId:d.user_id}),null;let u=te(48);return await i.query("update user_sessions set refresh_hash = $2, rotate\
d_at = now() where id = $1",[n,Se(u)]),{access_token:Xt({id:d.user_id,company_id:d.company_id},n),refresh_token:`${n}.${u}`}});if(!s)throw new N(401,"Sess\xE3o encerrada por seguran\xE7a\
. Entre novamente.","unauthenticated");a.json(s)}));_e.post("/logout",Ne(),l(async(e,a)=>{e.body?.all===!0?await c("update user_sessions set revoked_at = now() where user_id = $1 a\
nd revoked_at is null",[e.ctx.userId]):await c("update user_sessions set revoked_at = now() where id = $1",[e.ctx.sessionId]),a.json({ok:!0})}));_e.post("/password",Ne(),l(async(e,a)=>{
let t=w(q.object({current:q.string().max(200),next:q.string().max(200)}),e.body);Ke(t.next);let{rows:n}=await c("select password_hash from users where id = $1",[e.ctx.userId]);if(!await Re.
compare(t.current,n[0].password_hash))throw f("Senha atual incorreta");await c("update users set password_hash = $2, password_changed_at = now() where id = $1",[e.ctx.userId,await Re.
hash(t.next,12)]),await c("update user_sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null",[e.ctx.userId,e.ctx.sessionId]),await h({query:c},e.ctx,
"senha.alterada",{entity:"user",entityId:e.ctx.userId}),a.json({ok:!0})}));_e.get("/me",Ne(),l(async(e,a)=>{let t=e.ctx,n=await c("select id, name, day_cutoff from units where comp\
any_id = $1 and active order by id",[t.companyId]),o=t.terminalUnitId||t.unitId||n.rows[0]?.id;a.json({user:{id:t.userId,name:t.name,email:t.email,role:t.role,roleName:t.roleName,level:t.
level,unitId:t.unitId},company:t.company,permissions:[...t.perms],access:t.access,units:n.rows,unitId:o,terminalId:t.terminalId,pdv:await Ce({query:c},t,o),catalog:{permissions:Pe,
modules:Ve},notice:await jo()})}));async function jo(){let e=await Ee();return e.notice_text?{text:e.notice_text,level:e.notice_level==="warn"?"warn":"info"}:null}import{Router as Io}from"npm:express@5.2.1";import on from"npm:bcryptjs@3.0.3";import{z as k}from"npm:zod@4.6.5";var H=Io();async function ra(e,a){let t=await c("select level from roles where company_id = $1 and key = $2",[e,a]);if(!t.rows[0])throw f("Perfil inexistente");return t.rows[0].level}
H.get("/users",p("usuarios.gerenciar"),l(async(e,a)=>{let{rows:t}=await c(`select u.id, u.name, u.email, u.role_key, r.name as role_name, r.level, u.unit_id, u.active, u.created_at\
,
            u.locked_until > now() as locked
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by r.level desc, u.name`,[e.ctx.companyId]);a.json(t)}));var ca=k.object({name:k.string().trim().min(2).max(120),email:k.string().trim().toLowerCase().
email().max(160),password:k.string().max(200).optional(),role_key:k.string().max(40),unit_id:k.number().int().nullable().optional(),active:k.boolean().optional()});H.post("/users",
p("usuarios.gerenciar"),l(async(e,a)=>{let t=w(ca,e.body);if(await ra(e.ctx.companyId,t.role_key)>e.ctx.level)throw T("N\xE3o \xE9 poss\xEDvel criar usu\xE1rio com perfil acima do seu");
if(!t.password)throw f("Informe a senha inicial");if(Ke(t.password),t.unit_id&&await sn(e.ctx.companyId,t.unit_id),(await c("select 1 from users where lower(email) = $1",[t.email])).
rows[0])throw g("E-mail j\xE1 cadastrado");let o=await c("insert into users (company_id, name, email, password_hash, role_key, unit_id) values ($1,$2,$3,$4,$5,$6) returning id",[e.
ctx.companyId,t.name,t.email,await on.hash(t.password,12),t.role_key,t.unit_id??null]);await h({query:c},e.ctx,"usuario.criado",{entity:"user",entityId:o.rows[0].id,data:{role:t.role_key}}),
await ot({query:c},e.ctx.companyId,"tenant.updated"),a.status(201).json({id:o.rows[0].id})}));H.put("/users/:id",p("usuarios.gerenciar"),l(async(e,a)=>{let t=Number(e.params.id),n=w(
ca.partial(),e.body),s=(await c(`select u.*, r.level from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                       where u.id = $1 and u.company_id = $2`,[t,e.ctx.companyId])).rows[0];if(!s)throw $("Usu\xE1rio n\xE3o encontrado");if(s.level>e.ctx.level||s.level===e.ctx.level&&
s.id!==e.ctx.userId&&e.ctx.role!=="owner")throw T("N\xE3o \xE9 poss\xEDvel alterar usu\xE1rio de n\xEDvel igual ou superior");if(n.role_key&&await ra(e.ctx.companyId,n.role_key)>e.
ctx.level)throw T("Perfil acima do seu");if(s.role_key==="owner"&&n.role_key&&n.role_key!=="owner"&&(await c("select count(*)::int n from users where company_id = $1 and role_key =\
 'owner' and active",[e.ctx.companyId])).rows[0].n<=1)throw f("A empresa precisa de ao menos um propriet\xE1rio ativo");n.unit_id&&await sn(e.ctx.companyId,n.unit_id);let i=null;n.
password&&(Ke(n.password),i=await on.hash(n.password,12)),await c(`update users set name = coalesce($3, name), email = coalesce($4, email), role_key = coalesce($5, role_key),
             unit_id = case when $6::boolean then $7 else unit_id end, active = coalesce($8, active),
             password_hash = coalesce($9, password_hash),
             password_changed_at = case when $9 is not null then now() else password_changed_at end
           where id = $1 and company_id = $2`,[t,e.ctx.companyId,n.name??null,n.email??null,n.role_key??null,"unit_id"in n,n.unit_id??null,n.active??null,i]),(n.active===!1||i)&&await c(
"update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[t]),await h({query:c},e.ctx,"usuario.alterado",{entity:"user",entityId:t,data:{...n,password:n.
password?"alterada":void 0}}),a.json({ok:!0})}));H.get("/roles",p("usuarios.gerenciar"),l(async(e,a)=>{let{rows:t}=await c("select key, name, level, permissions, system from roles \
where company_id = $1 order by level desc",[e.ctx.companyId]);a.json({roles:t,catalog:Pe})}));H.put("/roles/:key",p("usuarios.gerenciar"),l(async(e,a)=>{let t=w(k.object({name:k.string().
trim().min(2).max(60).optional(),permissions:k.array(k.string()).max(200).optional(),level:k.number().int().min(1).max(99).optional()}),e.body),n=(await c("select * from roles wher\
e company_id = $1 and key = $2",[e.ctx.companyId,e.params.key])).rows[0];if(!n)throw $("Perfil n\xE3o encontrado");if(n.key==="owner")throw T("O perfil Propriet\xE1rio n\xE3o pode ser al\
terado");if(n.level>=e.ctx.level)throw T("S\xF3 \xE9 poss\xEDvel alterar perfis abaixo do seu n\xEDvel");if(t.level&&t.level>=e.ctx.level)throw T("N\xEDvel acima do seu");if(t.permissions){
let o=t.permissions.find(i=>!(i in Pe));if(o)throw f(`Permiss\xE3o inv\xE1lida: ${o}`);let s=t.permissions.find(i=>!e.ctx.can(i));if(s)throw T(`Voc\xEA n\xE3o pode conceder o que n\xE3o tem\
: ${s}`)}await c("update roles set name = coalesce($3,name), permissions = coalesce($4,permissions), level = coalesce($5,level) where company_id = $1 and key = $2",[e.ctx.companyId,
n.key,t.name??null,t.permissions??null,t.level??null]),await h({query:c},e.ctx,"perfil.alterado",{entity:"role",entityId:n.key,data:{before:n.permissions,after:t.permissions}}),a.json(
{ok:!0})}));H.post("/roles",p("usuarios.gerenciar"),l(async(e,a)=>{let t=w(k.object({name:k.string().trim().min(2).max(60),level:k.number().int().min(1).max(99),permissions:k.array(
k.string()).max(200)}),e.body);if(t.level>=e.ctx.level)throw T("N\xEDvel acima do seu");let n=t.permissions.find(s=>!(s in Pe)||!e.ctx.can(s));if(n)throw T(`Permiss\xE3o inv\xE1lida ou n\
\xE3o conced\xEDvel: ${n}`);let o=`custom_${te(4).toLowerCase().replace(/[^a-z0-9]/g,"x")}`;await c("insert into roles (company_id, key, name, level, permissions) values ($1,$2,$3,\
$4,$5)",[e.ctx.companyId,o,t.name,t.level,t.permissions]),await h({query:c},e.ctx,"perfil.criado",{entity:"role",entityId:o,data:t}),a.status(201).json({key:o})}));async function sn(e,a){
if(!(await c("select id from units where id = $1 and company_id = $2",[a,e])).rows[0])throw f("Unidade inv\xE1lida")}H.get("/units",l(async(e,a)=>{a.json((await c("select id, name,\
 active, day_cutoff, settings from units where company_id = $1 order by id",[e.ctx.companyId])).rows)}));H.post("/units",p("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(k.object(
{name:k.string().trim().min(2).max(80),day_cutoff:k.number().int().min(0).max(12).default(5)}),e.body),n=await c("insert into units (company_id, name, day_cutoff) values ($1,$2,$3)\
 returning id",[e.ctx.companyId,t.name,t.day_cutoff]);await h({query:c},e.ctx,"unidade.criada",{entity:"unit",entityId:n.rows[0].id,data:t}),a.status(201).json({id:n.rows[0].id})}));
H.put("/units/:id",p("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(k.object({name:k.string().trim().min(2).max(80).optional(),day_cutoff:k.number().int().min(0).max(12).optional(),
active:k.boolean().optional()}),e.body);if(!(await c("update units set name = coalesce($3,name), day_cutoff = coalesce($4,day_cutoff), active = coalesce($5,active) where id = $1 an\
d company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.day_cutoff??null,t.active??null])).rows[0])throw $();await h({query:c},e.ctx,"unidade.alterada",
{entity:"unit",entityId:e.params.id,data:t}),a.json({ok:!0})}));H.get("/terminals",l(async(e,a)=>{a.json((await c("select id, unit_id, name, active, settings from terminals where c\
ompany_id = $1 order by id",[e.ctx.companyId])).rows)}));H.post("/terminals",p("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(k.object({name:k.string().trim().min(2).max(60),unit_id:k.
number().int()}),e.body);await sn(e.ctx.companyId,t.unit_id);let n=await c("insert into terminals (company_id, unit_id, name) values ($1,$2,$3) returning id",[e.ctx.companyId,t.unit_id,
t.name]);await h({query:c},e.ctx,"terminal.criado",{entity:"terminal",entityId:n.rows[0].id,data:t}),a.status(201).json({id:n.rows[0].id})}));H.put("/terminals/:id",p("configuracoe\
s.gerenciar"),l(async(e,a)=>{let t=w(k.object({name:k.string().trim().min(2).max(60).optional(),active:k.boolean().optional()}),e.body);if(!(await c("update terminals set name = co\
alesce($3,name), active = coalesce($4,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.active??null])).rows[0])throw $();
a.json({ok:!0})}));var zo=k.object({name:k.string().trim().min(2).max(120),segment:k.string().max(30),document:k.string().max(20).nullable(),phone:k.string().max(30).nullable(),email:k.
string().email().max(160).nullable(),timezone:k.string().max(60),address:k.record(k.string(),k.string().max(160)),appearance:k.object({theme:k.enum(["claro","escuro","auto"]).optional(),
density:k.enum(["confortavel","compacta"]).optional(),menu:k.enum(["lateral","superior"]).optional(),accent:k.string().regex(/^#[0-9a-fA-F]{6}$/).optional()})}).partial();H.get("/s\
ettings",l(async(e,a)=>{let t=(await c("select id, name, segment, document, phone, email, timezone, address, settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json(
t)}));H.put("/settings",p("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(zo,e.body);if(t.timezone)try{new Intl.DateTimeFormat("pt-BR",{timeZone:t.timezone})}catch{throw f("Fuso \
hor\xE1rio inv\xE1lido")}await c(`update companies set name = coalesce($2,name), segment = coalesce($3,segment), document = coalesce($4,document),
             phone = coalesce($5,phone), email = coalesce($6,email), timezone = coalesce($7,timezone), address = coalesce($8,address),
             settings = case when $9::jsonb is null then settings else jsonb_set(settings, '{appearance}', $9::jsonb) end
           where id = $1`,[e.ctx.companyId,t.name??null,t.segment??null,t.document??null,t.phone??null,t.email??null,t.timezone??null,t.address??null,t.appearance?JSON.stringify(t.
appearance):null]),await h({query:c},e.ctx,"configuracoes.empresa",{entity:"company",entityId:e.ctx.companyId,data:t}),a.json({ok:!0})}));var So=k.object({scanner_enabled:k.boolean(),
mode:k.enum(["manual","continua","dupla"]),double_read_mandatory:k.boolean(),allow_manual:k.boolean(),allow_manual_exception:k.boolean(),exception_requires_manager:k.boolean(),allow_mode_change:k.
boolean(),product_timeout_s:k.number().int(),open_free_card_on_scan:k.boolean(),feedback_sound:k.boolean(),qty_per_scan:k.number().int().min(1).max(100),max_qty_per_scan:k.number().
int().min(1).max(100),terminator:k.enum(["Enter","Tab"]),kitchen_send:k.enum(["imediato","lote"]),require_open_cash:k.boolean(),service_fee_bp:k.number().int().min(0).max(3e3),card_prefix:k.
string().regex(/^[A-Z0-9-]{1,8}$/)}).partial();H.get("/pdv-settings",l(async(e,a)=>{let t=Number(e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId||null,n=await c("select settin\
gs->'pdv' as s from companies where id = $1",[e.ctx.companyId]),o=t?await c("select settings->'pdv' as s from units where id = $1 and company_id = $2",[t,e.ctx.companyId]):{rows:[]},
s=Number(e.query.terminal_id)||e.ctx.terminalId,i=s?await c("select settings->'pdv' as s from terminals where id = $1 and company_id = $2",[s,e.ctx.companyId]):{rows:[]};a.json({company:n.
rows[0]?.s||{},unit:o.rows[0]?.s||{},terminal:i.rows[0]?.s||{},effective:Yt(n.rows[0]?.s,o.rows[0]?.s,i.rows[0]?.s)})}));H.put("/pdv-settings/:level",p("configuracoes.gerenciar"),l(
async(e,a)=>{let t=w(k.enum(["company","unit","terminal"]),e.params.level),n=w(So,e.body?.settings);Je(n);let o=Number(e.body?.id);await v(async s=>{let i;if(t==="company"){i=(await s.
query("select settings->'pdv' s, settings from companies where id = $1 for update",[e.ctx.companyId])).rows[0];let r={...i.s||{},...n};Je(r),await s.query("update companies set set\
tings = jsonb_set(settings, '{pdv}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(r)])}else{let r=t==="unit"?"units":"terminals";if(i=(await s.query(`select settings->\
'pdv' s from ${r} where id = $1 and company_id = $2 for update`,[o,e.ctx.companyId])).rows[0],!i)throw $();let d={...i.s||{},...n};Je(d),await s.query(`update ${r} set settings = j\
sonb_set(settings, '{pdv}', $3::jsonb) where id = $1 and company_id = $2`,[o,e.ctx.companyId,JSON.stringify(d)])}await h(s,e.ctx,"pdv.configuracao",{entity:t,entityId:o||e.ctx.companyId,
data:{before:i?.s||{},after:n}})}),a.json({ok:!0,effective:await Ce({query:c},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId)})}));H.get("/audit",p("auditoria.visualizar"),l(async(e,a)=>{
let t=Math.min(Number(e.query.limit)||50,500),n=Math.max(Number(e.query.offset)||0,0),o=[e.ctx.companyId],s="a.company_id = $1";e.query.action&&(o.push(`${String(e.query.action)}%`),
s+=` and a.action like $${o.length}`),e.query.entity&&(o.push(String(e.query.entity)),s+=` and a.entity = $${o.length}`),e.query.entity_id&&(o.push(String(e.query.entity_id)),s+=` \
and a.entity_id = $${o.length}`),o.push(t,n);let{rows:i}=await c(`select a.id, a.action, a.entity, a.entity_id, a.reason, a.data, a.created_at, a.terminal_id, a.unit_id, u.name as \
user_name
       from audit_events a left join users u on u.id = a.user_id
      where ${s} order by a.id desc limit $${o.length-1} offset $${o.length}`,o);if(e.query.format==="csv")return a.type("text/csv; charset=utf-8").attachment("auditoria.csv"),a.send(
["data;usuario;acao;entidade;id;motivo",...i.map(r=>[r.created_at.toISOString(),r.user_name,r.action,r.entity,r.entity_id,r.reason].map(Be).join(";"))].join(`
`));a.json(i)}));H.post("/authorizations",l(async(e,a)=>{let t=w(k.object({email:k.string().trim().toLowerCase().max(160),password:k.string().max(200),action:k.enum(["excecao_dupla\
_leitura","cancelar_item","desconto","alterar_preco","reabrir_comanda","cancelar_venda","taxa_servico"]),reason:k.string().trim().min(3).max(300)}),e.body);await oe(`auth-mgr:${e.ctx.
companyId}:${t.email}`,5,600);let n={excecao_dupla_leitura:"pdv.excecao_dupla_leitura",cancelar_item:"pdv.cancelar_item",desconto:"pdv.desconto",alterar_preco:"pdv.alterar_preco",reabrir_comanda:"\
pdv.reabrir_comanda",cancelar_venda:"pdv.cancelar_venda",taxa_servico:"pdv.taxa_servico"}[t.action],{rows:o}=await c(`select u.id, u.password_hash, r.permissions from users u join \
roles r on r.company_id = u.company_id and r.key = u.role_key
                             where lower(u.email) = $1 and u.company_id = $2 and u.active`,[t.email,e.ctx.companyId]),s=o[0];if(!(s&&await on.compare(t.password,s.password_hash))||
!s.permissions.includes("pdv.autorizar")||!s.permissions.includes(n))throw await h({query:c},e.ctx,"autorizacao.negada",{data:{action:t.action,email:t.email}}),T("Autoriza\xE7\xE3o recus\
ada: credenciais inv\xE1lidas ou sem permiss\xE3o para autorizar esta a\xE7\xE3o");let r=te(24);await c(`insert into manager_authorizations (company_id, requested_by, authorized_by\
, action, scope, token_hash, expires_at)
           values ($1,$2,$3,$4,$5,$6, now() + interval '2 minutes')`,[e.ctx.companyId,e.ctx.userId,s.id,t.action,{reason:t.reason,terminal:e.ctx.terminalId},Se(r)]),await h({query:c},
e.ctx,"autorizacao.concedida",{reason:t.reason,data:{action:t.action,authorized_by:s.id}}),a.json({authorization:r,expires_in:120})}));async function Ae(e,a,t,n){if(!t)throw T("Est\
a a\xE7\xE3o exige autoriza\xE7\xE3o de um gerente","authorization_required");let{rows:o}=await e.query(`update manager_authorizations set used_at = now()
      where token_hash = $1 and company_id = $2 and requested_by = $3 and action = $4 and used_at is null and expires_at > now()
      returning authorized_by, scope`,[Se(t),a.companyId,a.userId,n]);if(!o[0])throw T("Autoriza\xE7\xE3o gerencial inv\xE1lida, expirada ou j\xE1 utilizada");return o[0]}import{Router as No}from"npm:express@5.2.1";import{z as O}from"npm:zod@4.6.5";var ue=No();ue.get("/categories",p("cardapio.visualizar"),l(async(e,a)=>{a.json((await c("select id, name, sort, active, demo from categories where company_id = $1 order by sort, n\
ame",[e.ctx.companyId])).rows)}));ue.post("/categories",p("cardapio.gerenciar"),l(async(e,a)=>{let t=w(O.object({name:O.string().trim().min(1).max(80),sort:O.number().int().default(
0)}),e.body),n=await c("insert into categories (company_id, name, sort) values ($1,$2,$3) returning id",[e.ctx.companyId,t.name,t.sort]);a.status(201).json({id:n.rows[0].id})}));ue.
put("/categories/:id",p("cardapio.gerenciar"),l(async(e,a)=>{let t=w(O.object({name:O.string().trim().min(1).max(80),sort:O.number().int(),active:O.boolean()}).partial(),e.body);if(!(await c(
"update categories set name = coalesce($3,name), sort = coalesce($4,sort), active = coalesce($5,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,
t.name??null,t.sort??null,t.active??null])).rows[0])throw $();a.json({ok:!0})}));ue.get("/sectors",l(async(e,a)=>{a.json((await c("select id, name, active from production_sectors w\
here company_id = $1 order by id",[e.ctx.companyId])).rows)}));ue.post("/sectors",p("cardapio.gerenciar"),l(async(e,a)=>{let t=w(O.object({name:O.string().trim().min(2).max(60)}),e.
body),n=await c("insert into production_sectors (company_id, name) values ($1,$2) returning id",[e.ctx.companyId,t.name]);a.status(201).json({id:n.rows[0].id})}));ue.get("/products",
p("cardapio.visualizar"),l(async(e,a)=>{let t=[e.ctx.companyId],n="p.company_id = $1";e.query.active!=="all"&&(n+=" and p.active"),e.query.q&&(t.push(`%${String(e.query.q).slice(0,
60)}%`,We(e.query.q)),n+=` and (p.name ilike $${t.length-1} or p.sku = $${t.length} or exists (select 1 from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO'\
 and s.entity_id = p.id and s.code = $${t.length}))`),e.query.category_id&&(t.push(Number(e.query.category_id)),n+=` and p.category_id = $${t.length}`);let o=e.ctx.can("relatorios.\
cmv")||e.ctx.can("cardapio.gerenciar"),{rows:s}=await c(`select p.id, p.name, p.description, p.sku, p.kind, p.unit, p.price_cents, ${o?"p.cost_cents,":""} p.favorite, p.active, p.d\
emo,
            p.category_id, p.sector_id, p.channels, p.allergens,
            coalesce((select array_agg(s.code order by s.id) from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.entity_id = p.id), '{}') as codes,
            coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
               'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                             from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id)
               from modifier_groups g where g.product_id = p.id), '[]') as groups
       from products p where ${n} order by p.favorite desc, p.name limit 500`,t);a.json(s)}));var da=O.object({name:O.string().trim().min(1).max(120),description:O.string().max(500).
nullable().optional(),sku:O.string().trim().max(40).nullable().optional(),kind:O.enum(["resale","recipe","produced","combo","addon","weight"]).default("resale"),unit:O.enum(["un","\
kg","g","L","ml"]).default("un"),price_cents:O.number().int().min(0).max(1e8),cost_cents:O.number().int().min(0).max(1e8).default(0),category_id:O.number().int().nullable().optional(),
sector_id:O.number().int().nullable().optional(),favorite:O.boolean().default(!1),active:O.boolean().default(!0),channels:O.array(O.enum(["pdv","delivery","cardapio_digital"])).default(
["pdv"]),allergens:O.string().max(500).nullable().optional(),codes:O.array(O.string().max(128)).max(20).default([]),groups:O.array(O.object({name:O.string().trim().min(1).max(60),min:O.
number().int().min(0).max(20),max:O.number().int().min(1).max(20),options:O.array(O.object({name:O.string().trim().min(1).max(60),price_cents:O.number().int().min(0).max(1e6)})).min(
1).max(40)})).max(10).optional()});async function ma(e,a,t){if(t.category_id&&!(await e.query("select 1 from categories where id = $1 and company_id = $2",[t.category_id,a])).rows[0])
throw f("Categoria inv\xE1lida");if(t.sector_id&&!(await e.query("select 1 from production_sectors where id = $1 and company_id = $2",[t.sector_id,a])).rows[0])throw f("Setor inv\xE1l\
ido");if(t.kind==="weight"&&t.unit==="un")throw f("Produto por peso precisa de unidade kg ou g");for(let n of t.groups||[])if(n.min>n.max)throw f(`Grupo ${n.name}: m\xEDnimo maior que\
 m\xE1ximo`)}async function ua(e,a,t,n){if(!n)return;await e.query("delete from modifier_groups where product_id = $1 and company_id = $2",[t,a]);let o=0;for(let s of n){let i=await e.
query("insert into modifier_groups (company_id, product_id, name, min_select, max_select, sort) values ($1,$2,$3,$4,$5,$6) returning id",[a,t,s.name,s.min,s.max,o++]);for(let r of s.
options)await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)",[a,i.rows[0].id,r.name,r.price_cents])}}ue.post("/products",p("c\
ardapio.gerenciar"),l(async(e,a)=>{let t=w(da,e.body),n=await v(async o=>{await ma(o,e.ctx.companyId,t);let i=(await o.query(`insert into products (company_id, name, description, s\
ku, kind, unit, price_cents, cost_cents, category_id, sector_id, favorite, active, channels, allergens)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,[e.ctx.companyId,t.name,t.description??null,t.sku||null,t.kind,t.unit,t.price_cents,t.cost_cents,t.category_id??
null,t.sector_id??null,t.favorite,t.active,t.channels,t.allergens??null])).rows[0].id;for(let r of t.codes)await De(o,e.ctx.companyId,r,"PRODUTO",i);return await ua(o,e.ctx.companyId,
i,t.groups),await o.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)",[e.ctx.companyId,i,t.price_cents,e.ctx.
userId]),await h(o,e.ctx,"produto.criado",{entity:"product",entityId:i,data:{name:t.name,price_cents:t.price_cents}}),i}).catch(o=>{throw o.code==="23505"?g("SKU j\xE1 usado em outro \
produto"):o});a.status(201).json({id:n})}));ue.put("/products/:id",p("cardapio.gerenciar"),l(async(e,a)=>{let t=Number(e.params.id),n=w(da.partial(),e.body);await v(async o=>{let s=(await o.
query("select * from products where id = $1 and company_id = $2 for update",[t,e.ctx.companyId])).rows[0];if(!s)throw $("Produto n\xE3o encontrado");await ma(o,e.ctx.companyId,{...s,
...n});let i={...s,...n};if(await o.query(`update products set name=$3, description=$4, sku=$5, kind=$6, unit=$7, price_cents=$8, cost_cents=$9, category_id=$10, sector_id=$11,
         favorite=$12, active=$13, channels=$14, allergens=$15, updated_at=now() where id=$1 and company_id=$2`,[t,e.ctx.companyId,i.name,i.description,i.sku||null,i.kind,i.unit,i.
price_cents,i.cost_cents,i.category_id,i.sector_id,i.favorite,i.active,i.channels,i.allergens]),n.price_cents!=null&&n.price_cents!==s.price_cents&&(await o.query("insert into prod\
uct_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,t,s.price_cents,n.price_cents,e.ctx.userId]),await h(o,e.ctx,"pr\
oduto.preco",{entity:"product",entityId:t,data:{before:s.price_cents,after:n.price_cents}})),n.codes){let r=n.codes.map(We).filter(Boolean);await o.query("delete from scan_codes wh\
ere company_id = $1 and entity = 'PRODUTO' and entity_id = $2 and not (code = any($3))",[e.ctx.companyId,t,r]);for(let d of r)await De(o,e.ctx.companyId,d,"PRODUTO",t)}await ua(o,e.
ctx.companyId,t,n.groups),await h(o,e.ctx,"produto.alterado",{entity:"product",entityId:t,data:{...n,groups:n.groups?"alterados":void 0}})}).catch(o=>{throw o.code==="23505"?g("SKU\
 j\xE1 usado em outro produto"):o}),a.json({ok:!0})}));ue.get("/products/:id/prices",p("cardapio.visualizar"),l(async(e,a)=>{a.json((await c(`select h.old_cents, h.new_cents, h.cre\
ated_at, u.name as user_name from product_price_history h left join users u on u.id = h.user_id
                      where h.product_id = $1 and h.company_id = $2 order by h.id desc`,[Number(e.params.id),e.ctx.companyId])).rows)}));ue.delete("/demo",p("configuracoes.gerencia\
r"),l(async(e,a)=>{let t=await v(async n=>{let s=(await n.query("select distinct product_id from order_items where company_id = $1",[e.ctx.companyId])).rows.map(d=>d.product_id),i=await n.
query("update products set active = false, name = name where company_id = $1 and demo and id = any($2) returning id",[e.ctx.companyId,s]);await n.query("delete from scan_codes wher\
e company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo and not (id = any($2)))",[e.ctx.companyId,s]),await n.query("delet\
e from product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 and demo and not (id = any($2)))",[e.ctx.companyId,s]);let r=await n.
query("delete from products where company_id = $1 and demo and not (id = any($2)) returning id",[e.ctx.companyId,s]);return await n.query("delete from categories c where c.company_\
id = $1 and c.demo and not exists (select 1 from products p where p.category_id = c.id)",[e.ctx.companyId]),await h(n,e.ctx,"demonstracao.removida",{data:{removed:r.rowCount,deactivated:i.
rowCount}}),{removed:r.rowCount,deactivated:i.rowCount}});a.json(t)}));import{Router as Co}from"npm:express@5.2.1";import{z as G}from"npm:zod@4.6.5";var $e=Co(),Eo=e=>Number(e.query.unit_id||e.body?.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;async function vt(e){let a=Eo(e);return a?(be(e.ctx,a),a):(await c("select id from un\
its where company_id = $1 and active order by id limit 1",[e.ctx.companyId])).rows[0]?.id}$e.get("/tables",p("salao.visualizar"),l(async(e,a)=>{let t=await vt(e),n=e.ctx.can("pdv.r\
eceber")||e.ctx.can("financeiro.visualizar")||e.ctx.can("pdv.lancar"),{rows:o}=await c(`select t.id, t.number, t.area, t.capacity, t.status, t.pos_x, t.pos_y, t.active,
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
       from dining_tables t where t.company_id = $1 and t.unit_id = $2 and t.active order by t.number`,[e.ctx.companyId,t]);a.json({unitId:t,tables:o})}));$e.post("/tables",p("sala\
o.gerenciar"),l(async(e,a)=>{let t=w(G.object({from:G.number().int().min(1).max(9999),count:G.number().int().min(1).max(200),area:G.string().max(40).default("Sal\xE3o"),capacity:G.
number().int().min(1).max(50).default(4)}),e.body),n=await vt(e),o=await v(async s=>{let i=await en(s,e.ctx.companyId,n,t.from,t.count);return i.length&&await s.query("update dinin\
g_tables set area = $2, capacity = $3 where id = any($1)",[i,t.area,t.capacity]),await h(s,e.ctx,"mesas.criadas",{unitId:n,data:{from:t.from,count:i.length}}),i});a.status(201).json(
{created:o.length})}));$e.put("/tables/:id",p("salao.visualizar"),l(async(e,a)=>{let t=w(G.object({status:G.enum(["livre","ocupada","reservada","conta","limpeza"]).optional(),area:G.
string().max(40).optional(),capacity:G.number().int().min(1).max(50).optional(),pos_x:G.number().int().min(0).max(40).optional(),pos_y:G.number().int().min(0).max(40).optional(),active:G.
boolean().optional()}),e.body);if(["area","capacity","pos_x","pos_y","active"].some(s=>s in t)&&!e.ctx.can("salao.gerenciar"))throw f("Sem permiss\xE3o para alterar a estrutura do sal\
\xE3o");if(t.status&&!e.ctx.can("salao.gerenciar")&&!e.ctx.can("pdv.lancar"))throw f("Sem permiss\xE3o para mudar a situa\xE7\xE3o da mesa");if(t.status==="livre"&&(await c("select\
 1 from consumption_sessions where table_id = $1 and company_id = $2 and status in ('aberta','em_fechamento')",[Number(e.params.id),e.ctx.companyId])).rows[0])throw g("Mesa com con\
sumo aberto n\xE3o pode ser liberada");if(!(await c(`update dining_tables set status = coalesce($3,status), area = coalesce($4,area), capacity = coalesce($5,capacity),
                       pos_x = coalesce($6,pos_x), pos_y = coalesce($7,pos_y), active = coalesce($8,active) where id = $1 and company_id = $2 returning unit_id`,[Number(e.params.id),
e.ctx.companyId,t.status??null,t.area??null,t.capacity??null,t.pos_x??null,t.pos_y??null,t.active??null])).rows[0])throw $("Mesa n\xE3o encontrada");await h({query:c},e.ctx,"mesa.a\
lterada",{entity:"table",entityId:e.params.id,data:t}),a.json({ok:!0})}));$e.get("/cards",p("pdv.lancar"),l(async(e,a)=>{let t=await vt(e),{rows:n}=await c(`select c.id, c.number, \
c.status, c.block_reason,
            (select code from scan_codes s where s.company_id = c.company_id and s.entity = 'COMANDA' and s.entity_id = c.id order by s.id limit 1) as code,
            s.id as session_id, s.customer_name, s.opened_at, s.status as session_status, t.number as table_number,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count,
            (select coalesce(sum(i.total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents
       from tab_cards c
       left join lateral (select * from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') order by s.id desc limit 1) s on true
       left join dining_tables t on t.id = s.table_id
      where c.company_id = $1 and c.unit_id = $2 order by c.number`,[e.ctx.companyId,t]);a.json({unitId:t,cards:n})}));$e.post("/cards",p("comandas.gerenciar"),l(async(e,a)=>{let t=w(
G.object({from:G.number().int().min(1).max(999999),count:G.number().int().min(1).max(1e3)}),e.body),n=await vt(e),o=await v(async s=>{let i=(await s.query("select coalesce(settings\
->'pdv'->>'card_prefix','CMD-') p from companies where id = $1",[e.ctx.companyId])).rows[0].p,r=await tn(s,e.ctx.companyId,n,t.from,t.count,i);return await h(s,e.ctx,"comandas.gera\
das",{unitId:n,data:{from:t.from,count:r.length}}),r});a.status(201).json({created:o})}));$e.post("/cards/:id/block",p("comandas.gerenciar"),l(async(e,a)=>{let t=w(G.object({reason:G.
string().trim().min(3).max(200)}),e.body);if(!(await c("update tab_cards set status = 'bloqueado', block_reason = $3 where id = $1 and company_id = $2 returning id",[Number(e.params.
id),e.ctx.companyId,t.reason])).rows[0])throw $();await h({query:c},e.ctx,"comanda.bloqueada",{entity:"card",entityId:e.params.id,reason:t.reason}),a.json({ok:!0})}));$e.post("/car\
ds/:id/unblock",p("comandas.gerenciar"),l(async(e,a)=>{if(!(await c("update tab_cards set status = 'ativo', block_reason = null where id = $1 and company_id = $2 returning id",[Number(
e.params.id),e.ctx.companyId])).rows[0])throw $();await h({query:c},e.ctx,"comanda.desbloqueada",{entity:"card",entityId:e.params.id}),a.json({ok:!0})}));$e.post("/cards/:id/replac\
e",p("comandas.gerenciar"),l(async(e,a)=>{let t=w(G.object({new_card_id:G.number().int(),reason:G.string().trim().min(3).max(200)}),e.body);await v(async n=>{let o=(await n.query("\
select * from tab_cards where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0],s=(await n.query("select * from tab_cards where id = $1 and co\
mpany_id = $2 for update",[t.new_card_id,e.ctx.companyId])).rows[0];if(!o||!s)throw $("Cart\xE3o n\xE3o encontrado");if(s.status!=="ativo")throw f("O novo cart\xE3o est\xE1 bloqueado");
if(o.unit_id!==s.unit_id)throw f("Cart\xF5es de unidades diferentes");if((await n.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechament\
o')",[s.id])).rows[0])throw g("O novo cart\xE3o j\xE1 tem consumo em aberto");await n.query("update tab_cards set status = 'bloqueado', block_reason = $2 where id = $1",[o.id,`Subs\
titu\xEDdo pelo ${s.number}: ${t.reason}`]);let r=await n.query("update consumption_sessions set card_id = $2, version = version + 1 where card_id = $1 and status in ('aberta','em_\
fechamento') returning id",[o.id,s.id]);await h(n,e.ctx,"comanda.substituida",{entity:"card",entityId:o.id,reason:t.reason,data:{new_card:s.id,session:r.rows[0]?.id??null}})}),a.json(
{ok:!0})}));import{Router as Do}from"npm:express@5.2.1";import{z as I}from"npm:zod@4.6.5";var rn=e=>({enabled:!0,allow_negative:!0,...e?.stock||{}});async function Ze(e,a,t){let n=await e.query(`select stock_item_id, coalesce(sum(qty),0)::numeric as qty from stock_movem\
ents
    where company_id = $1 ${t?"and stock_item_id = any($2)":""} group by stock_item_id`,t?[a,t]:[a]);return Object.fromEntries(n.rows.map(o=>[o.stock_item_id,Number(o.qty)]))}var la=e=>Math.
round(e*1e4)/1e4;async function xt(e,a,t,n,o=[]){let s=new Map,i=(r,d)=>s.set(Number(r),la((s.get(Number(r))||0)+d));if(t.stock_mode==="acabado"&&t.stock_item_id&&i(t.stock_item_id,
Number(n)),t.stock_mode==="ficha"){let r=(await e.query(`select l.stock_item_id, l.qty, l.loss_pct, r.yield_qty from recipes r join recipe_lines l on l.recipe_id = r.id
      where r.company_id = $1 and r.product_id = $2 and r.active`,[a,t.id])).rows;for(let d of r)i(d.stock_item_id,Number(d.qty)*(1+Number(d.loss_pct)/100)/Number(d.yield_qty)*Number(
n))}if(o.length){let r=(await e.query("select stock_item_id, stock_qty from modifier_options where company_id = $1 and id = any($2) and stock_item_id is not null and stock_qty > 0",
[a,o])).rows;for(let d of r)i(d.stock_item_id,Number(d.stock_qty)*Number(n))}return s}async function kt(e,a,t,n,o){let s=(await e.query("select settings from companies where id = $\
1",[a.companyId])).rows[0],i=rn(s.settings);if(!i.enabled)return[];let r=await xt(e,a.companyId,n,t.qty,o);if(!r.size)return[];let d=[...r.keys()],u=(await e.query("select id, name\
, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2) order by id for update",[a.companyId,d])).rows;if(!i.allow_negative){let y=await Ze(e,a.companyId,d);
for(let _ of u)if((y[_.id]||0)-r.get(Number(_.id))<-1e-4)throw g(`Estoque insuficiente de ${_.name} (saldo ${(y[_.id]||0).toLocaleString("pt-BR")} ${_.unit})`,"stock_insufficient")}
let m=[];for(let y of u){let _=await e.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, user_id)
      values ($1,$2,'venda',$3,$4,'order_item',$5,$6) on conflict do nothing returning id`,[a.companyId,y.id,-r.get(Number(y.id)),y.avg_cost_cents,t.id,a.userId]);_.rows[0]&&m.push(
_.rows[0].id)}return m}async function dt(e,a,t,n){let o=(await e.query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'order_item' and m.ref_id = $2 an\
d m.kind = 'venda'
    and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`,[a.companyId,t])).rows;for(let s of o)await e.query(`insert into stock_movements (company_id, stock\
_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
      values ($1,$2,'estorno_venda',$3,$4,'order_item_rev',$5,$6,$7,$8)`,[a.companyId,s.stock_item_id,-Number(s.qty),s.unit_cost_cents,t,s.id,n,a.userId]);return o.length}async function Xe(e,a,t,n,o,s,i){
let r=(await e.query("select avg_cost_cents from stock_items where id = $1 and company_id = $2 for update",[t,a.companyId])).rows[0],d=(await Ze(e,a.companyId,[t]))[t]||0,u=Math.max(
0,d),m=u+n>0?(u*Number(r.avg_cost_cents)+n*o)/(u+n):o;await e.query("update stock_items set avg_cost_cents = $3 where id = $1 and company_id = $2",[t,a.companyId,la(m)]),await e.query(
`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
    values ($1,$2,'entrada',$3,$4,$5,$6,$7,$8)`,[a.companyId,t,n,o,s?.type??null,s?.id??null,i??null,a.userId])}async function cn(e,a,t){let n=await xt(e,a,t,1,[]);if(!n.size)return Number(
t.cost_cents||0);let o=(await e.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2)",[a,[...n.keys()]])).rows;return Math.round(o.reduce((s,i)=>s+
Number(i.avg_cost_cents)*n.get(Number(i.id)),0))}var se=e=>String(e??"").replace(/\D/g,"");function qo(e){let a=se(e);if(a.length!==11||/^(\d)\1{10}$/.test(a))return!1;let t=n=>{let o=0;for(let i=0;i<n;i++)o+=Number(a[i])*(n+1-i);
let s=o*10%11;return s===10?0:s};return t(9)===Number(a[9])&&t(10)===Number(a[10])}function jt(e,{required:a=!1}={}){let t=se(e);if(!t){if(a)throw f("Informe o CPF");return null}if(!qo(
t))throw f("CPF inv\xE1lido","invalid_cpf");return t}var dn=e=>e?`${e.slice(0,3)}.${e.slice(3,6)}.${e.slice(6,9)}-${e.slice(9)}`:null,Ao=e=>e?`***.${e.slice(3,6)}.${e.slice(6,9)}-*\
*`:null,Oo=e=>e?e.replace(/\d(?=\d{4})/g,"*"):null,Po=e=>e?e.replace(/^(.).*(@.*)$/,"$1***$2"):null;function Ye(e,a){if(!e)return e;let t=a.can("dados.pessoais");return{id:e.id,name:e.
name,cpf:t?dn(e.cpf):Ao(e.cpf),phone:t?e.phone:Oo(e.phone),email:t?e.email:Po(e.email),birthday:t?e.birthday:null,address:t?e.address:{},tags:e.tags,preferences:e.preferences,notes:e.
notes,consent_whatsapp:e.consent_whatsapp,consent_email:e.consent_email,unsubscribed:!!e.unsubscribed_at,points:e.points,anonymized:!!e.anonymized_at,created_at:e.created_at,masked:!t,
...e.visits!=null?{visits:e.visits,spent_cents:e.spent_cents,last_visit:e.last_visit}:{}}}var It=e=>({enabled:!1,cents_per_point:100,point_value_cents:5,validity_days:365,min_redeem:100,
...e?.loyalty||{}});async function Me(e,a,t,n){let o=await e.query(`insert into loyalty_ledger (company_id, customer_id, session_id, kind, points, expires_at, reason, reverses_id, \
payment_id, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[a,t,n.session_id??null,n.kind,n.points,n.expires_at??null,n.reason??null,n.reverses_id??null,n.payment_id??null,n.user_id??
null]);return await e.query("update customers set points = points + $3, updated_at = now() where id = $1 and company_id = $2",[t,a,n.points]),o.rows[0]}async function mn(e,a,t){let n=await e.
query(`select
       coalesce(sum(l.points) filter (where (l.kind = 'ganho' or o.kind = 'ganho') and coalesce(l.expires_at, o.expires_at) < current_date), 0)::int as vencidos,
       coalesce(-sum(l.points) filter (where l.kind in ('resgate','expiracao') or (l.kind = 'ajuste' and l.points < 0) or o.kind = 'resgate'), 0)::int as usados
     from loyalty_ledger l left join loyalty_ledger o on o.id = l.reverses_id
     where l.company_id = $1 and l.customer_id = $2`,[a,t]),{vencidos:o,usados:s}=n.rows[0],i=o-s;i>0&&await Me(e,a,t,{kind:"expiracao",points:-i,reason:"Pontos vencidos"})}async function zt(e,a,t,n){
if(!t.customer_id)return null;let o=(await e.query("select settings from companies where id = $1",[a.companyId])).rows[0],s=It(o.settings);if(!s.enabled)return null;let i=Math.floor(
n/Math.max(1,s.cents_per_point));if(i<=0||(await e.query(`select 1 from loyalty_ledger where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = loyalty_ledger.id)`,[a.companyId,t.id])).rows[0])return null;let d=new Date(Date.now()+s.validity_days*864e5).
toISOString().slice(0,10);return Me(e,a.companyId,t.customer_id,{session_id:t.id,kind:"ganho",points:i,expires_at:d,reason:`Consumo ${t.id}`,user_id:a.userId})}async function pa(e,a,t,n){
let o=(await e.query(`select * from loyalty_ledger l where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = l.id)`,[a.companyId,t])).rows[0];return o?Me(e,a.companyId,o.customer_id,{session_id:t,kind:"estorno",points:-o.
points,reverses_id:o.id,reason:n,user_id:a.userId}):null}async function _a(e,a,t,n,o,s){let i=(await e.query("select points from customers where id = $1 and company_id = $2 for upd\
ate",[t,a.companyId])).rows[0];if(!i)throw f("Cliente n\xE3o encontrado");if(i.points<n)throw g(`Saldo insuficiente: ${i.points} pontos`,"insufficient_points");return Me(e,a.companyId,
t,{session_id:s,kind:"resgate",points:-n,payment_id:o,reason:`Resgate no consumo ${s}`,user_id:a.userId})}async function ya(e,a,t){let n=(await e.query(`select * from loyalty_ledge\
r l where company_id = $1 and payment_id = $2 and kind = 'resgate'
    and not exists (select 1 from loyalty_ledger x where x.reverses_id = l.id)`,[a.companyId,t])).rows[0];return n?Me(e,a.companyId,n.customer_id,{session_id:n.session_id,kind:"est\
orno",points:-n.points,reverses_id:n.id,reason:"Pagamento com pontos estornado",user_id:a.userId}):null}var B=Do();async function fa(e,a,t){let n=await e.query("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1 and u.company_id = $2",
[t,a]);if(!n.rows[0])throw f("Unidade inv\xE1lida");return n.rows[0]}B.post("/resolve",p("pdv.lancar"),l(async(e,a)=>{let{code:t}=w(I.object({code:I.string().max(256)}),e.body),n=await rt(
{query:c},e.ctx.companyId,t);n.type==="DESCONHECIDO"&&await h({query:c},e.ctx,"leitura.desconhecida",{data:{code:n.code.slice(0,40)}}),a.json(n)}));B.get("/sessions",p("pdv.lancar"),
l(async(e,a)=>{let t=e.query.status==="all"?null:["aberta","em_fechamento"],n=[e.ctx.companyId],o="s.company_id = $1";t&&(n.push(t),o+=` and s.status = any($${n.length})`);let s=Number(
e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;s&&(n.push(s),o+=` and s.unit_id = $${n.length}`);let{rows:i}=await c(`select s.id, s.kind, s.status, s.label, s.customer_name,\
 s.opened_at, s.version, s.suspended, s.unit_id,
            c.number as card_number, t.number as table_number, s.table_id, s.card_id,
            (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
            (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = s.id and p.status = 'confirmado') as paid_cents,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
      where ${o} order by s.opened_at desc limit 300`,n);a.json(i)}));var To=I.object({kind:I.enum(["comanda","mesa","balcao","retirada"]),card_id:I.number().int().optional(),card_code:I.
string().max(128).optional(),table_id:I.number().int().optional(),customer_name:I.string().trim().max(80).optional(),customer_id:I.number().int().optional(),label:I.string().trim().
max(60).optional(),unit_id:I.number().int().optional()});async function un(e,a,t){J(a,"pdv.abrir_comanda");let n=t.unit_id||a.terminalUnitId||a.unitId,o=null,s=null;if(t.card_code&&
!t.card_id){let m=await rt(e,a.companyId,t.card_code);if(m.type!=="COMANDA")throw f("C\xF3digo n\xE3o \xE9 de comanda");t.card_id=m.card.id}if(t.card_id){let m=(await e.query("sele\
ct * from tab_cards where id = $1 and company_id = $2 for update",[t.card_id,a.companyId])).rows[0];if(!m)throw $("Comanda n\xE3o encontrada");if(m.status!=="ativo")throw g(`Comand\
a ${m.number} bloqueada${m.block_reason?`: ${m.block_reason}`:""}`,"card_blocked");let y=await e.query("select id from consumption_sessions where card_id = $1 and status in ('abert\
a','em_fechamento')",[m.id]);if(y.rows[0])throw g(`Comanda ${m.number} j\xE1 est\xE1 em uso`,"card_busy",{session_id:y.rows[0].id});o=m.id,n=m.unit_id}if(t.table_id){let m=(await e.
query("select * from dining_tables where id = $1 and company_id = $2 and active",[t.table_id,a.companyId])).rows[0];if(!m)throw $("Mesa n\xE3o encontrada");if(n&&m.unit_id!==n)throw f(
"Mesa e comanda de unidades diferentes");s=m.id,n=m.unit_id}if(t.customer_id){let m=(await e.query("select id, name from customers where id = $1 and company_id = $2 and anonymized_\
at is null",[t.customer_id,a.companyId])).rows[0];if(!m)throw $("Cliente n\xE3o encontrado");t.customer_name=t.customer_name||m.name}if(t.kind==="comanda"&&!o)throw f("Informe a co\
manda");if(t.kind==="mesa"&&!s)throw f("Informe a mesa");n||(n=(await e.query("select id from units where company_id = $1 and active order by id limit 1",[a.companyId])).rows[0]?.id),
be(a,n);let i=await Ce(e,a,n),{day_cutoff:r,timezone:d}=await fa(e,a.companyId,n),u=await e.query(`insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, c\
ustomer_name, label, service_fee_bp, opened_by, business_date, customer_id, delivery_fee_cents)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[a.companyId,n,t.kind,o,s,t.customer_name??null,t.label??null,["balcao","retirada","delivery"].includes(t.kind)?0:
i.service_fee_bp,a.userId,le(new Date,d,r),t.customer_id??null,t.delivery_fee_cents??0]);return s&&await e.query("update dining_tables set status = 'ocupada' where id = $1 and stat\
us in ('livre','reservada','limpeza')",[s]),await h(e,a,"consumo.aberto",{entity:"session",entityId:u.rows[0].id,unitId:n,data:{kind:t.kind,card:o,table:s}}),u.rows[0]}B.post("/ses\
sions",l(async(e,a)=>{let t=w(To,e.body),n=await v(o=>un(o,e.ctx,t)).catch(o=>{throw o.code==="23505"?g("Comanda j\xE1 est\xE1 em uso","card_busy"):o});a.status(201).json(n)}));async function Ro(e,a,t){
let n=(await e.query(`select s.*, c.number as card_number, t.number as table_number, u.name as opened_by_name, cu.points as customer_points,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo' and i.sent_at is null and i.kitchen_status = 'novo') as pending_send
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join users u on u.id = s.opened_by left join customers cu on cu.id = s.customer_id where s.id = $1 and s.company_id = $2`,[t,a.companyId])).rows[0];if(!n)throw $("Consu\
mo n\xE3o encontrado");let o=(await e.query(`select i.id, i.product_id, i.description, i.qty, i.unit, i.unit_price_cents, i.modifiers, i.modifiers_cents, i.discount_cents,
            i.total_cents, i.notes, i.status, i.kitchen_status, i.launch_mode, i.created_at, i.cancel_reason, i.transferred_from, i.sent_at,
            u.name as user_name
       from order_items i left join users u on u.id = i.user_id where i.session_id = $1 order by i.id`,[t])).rows,s=(await e.query(`select p.id, p.method, p.amount_cents, p.tendere\
d_cents, p.change_cents, p.status, p.source, p.created_at, p.refund_reason, u.name as user_name
       from payments p left join users u on u.id = p.user_id where p.session_id = $1 order by p.id`,[t])).rows;return{...n,items:o,payments:s,totals:await M(e,t)}}B.get("/sessions/\
:id",p("pdv.lancar"),l(async(e,a)=>{a.json(await Ro({query:c},e.ctx,Number(e.params.id)))}));var Mo=I.object({session_id:I.number().int(),product_id:I.number().int().optional(),qty:I.
number().positive().max(9999).optional(),option_ids:I.array(I.number().int()).max(40).default([]),notes:I.string().trim().max(200).optional(),launch_mode:I.enum(["manual","continua",
"dupla","excecao","balcao","delivery"]),idempotency_key:I.string().regex(/^[A-Za-z0-9_-]{8,80}$/),scan:I.object({card_code:I.string().max(128).optional(),product_code:I.string().max(
128).optional()}).optional(),price_override_cents:I.number().int().min(0).max(1e8).optional(),discount_cents:I.number().int().min(0).max(1e8).optional(),authorization:I.string().max(
100).optional(),exception_reason:I.string().trim().max(200).optional()});B.post("/items",p("pdv.lancar"),l(async(e,a)=>{let t=w(Mo,e.body),n=e.ctx,o=await c("select * from order_it\
ems where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(o.rows[0]){if(Number(o.rows[0].session_id)!==t.session_id)throw g("Chave de opera\xE7\xE3o j\xE1 usad\
a em outro lan\xE7amento","idempotency_mismatch");return a.json({item:o.rows[0],replay:!0,totals:await M({query:c},t.session_id)})}let s=await v(async i=>{let r=await Z(i,n.companyId,
t.session_id);be(n,r.unit_id),Te(r);let d=await Ce(i,n,r.unit_id),u=t.product_id,m=null;if(t.launch_mode==="dupla"||t.launch_mode==="continua"){if(!d.scanner_enabled)throw T("Leito\
r desabilitado nesta configura\xE7\xE3o","scanner_disabled");if(t.launch_mode==="continua"&&d.double_read_mandatory)throw T("Dupla leitura obrigat\xF3ria: leitura cont\xEDnua n\xE3o permiti\
da","double_read_required");let V=await rt(i,n.companyId,t.scan?.product_code);if(V.type!=="PRODUTO")throw f("C\xF3digo lido n\xE3o \xE9 de produto","not_a_product");if(u&&u!==V.product.
id)throw f("Produto informado difere do c\xF3digo lido");if(u=V.product.id,t.launch_mode==="dupla"){let ne=await rt(i,n.companyId,t.scan?.card_code);if(ne.type!=="COMANDA")throw f(
"Dupla leitura exige a leitura da comanda antes do produto","card_required");if(Number(ne.card.id)!==Number(r.card_id))throw g("Comanda lida n\xE3o corresponde ao consumo de destino",
"card_mismatch")}}else if(t.launch_mode==="excecao"){if(!d.allow_manual_exception)throw T("Exce\xE7\xE3o manual desabilitada","exception_disabled");if(J(n,"pdv.excecao_dupla_leitur\
a"),!t.exception_reason)throw f("Informe o motivo da exce\xE7\xE3o");d.exception_requires_manager&&(m=(await Ae(i,n,t.authorization,"excecao_dupla_leitura")).authorized_by)}else if(t.
launch_mode==="delivery"){if(J(n,"delivery.gerenciar"),r.kind!=="delivery")throw f("Lan\xE7amento de delivery s\xF3 em pedidos de delivery")}else{if(d.double_read_mandatory)throw T(
"Dupla leitura obrigat\xF3ria: use a exce\xE7\xE3o autorizada para lan\xE7ar manualmente","double_read_required");if(!d.allow_manual)throw T("Lan\xE7amento manual desabilitado","ma\
nual_disabled");J(n,"pdv.lancamento_manual")}if(!u)throw f("Informe o produto");let y=(await i.query("select * from products where id = $1 and company_id = $2",[u,n.companyId])).rows[0];
if(!y)throw $("Produto n\xE3o encontrado");if(!y.active)throw g(`${y.name} est\xE1 indispon\xEDvel`,"product_inactive");let _=t.qty,j=t.launch_mode==="dupla"||t.launch_mode==="cont\
inua";if(y.kind==="weight"){if(!_)throw f(`${y.name} \xE9 vendido por peso: informe o peso`,"weight_required")}else{if(_=_??(j?d.qty_per_scan:1),!Number.isInteger(_))throw f("Quant\
idade deve ser inteira para este produto");if(j&&_!==d.qty_per_scan&&(J(n,"pdv.alterar_quantidade"),_>d.max_qty_per_scan))throw f(`Quantidade por leitura limitada a ${d.max_qty_per_scan}`)}
let x=(await i.query(`select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active
        where g.product_id = $1 group by g.id order by g.sort, g.id`,[y.id])).rows,S=[];for(let V of x){let ne=V.options.filter(ze=>t.option_ids.includes(ze.id));if(ne.length<V.min_select)
throw f(`Escolha ${V.min_select===1?"uma op\xE7\xE3o":`${V.min_select} op\xE7\xF5es`} em "${V.name}"`,"options_required");if(ne.length>V.max_select)throw f(`No m\xE1ximo ${V.max_select}\
 em "${V.name}"`);for(let ze of ne)S.push({group:V.name,id:ze.id,name:ze.name,price_cents:ze.price_cents})}if(S.length!==new Set(t.option_ids).size)throw f("Op\xE7\xE3o inv\xE1lida para est\
e produto");let A=S.reduce((V,ne)=>V+ne.price_cents,0),D=y.price_cents,L={};t.price_override_cents!=null&&t.price_override_cents!==y.price_cents&&(n.can("pdv.alterar_preco")||await Ae(
i,n,t.authorization,"alterar_preco"),D=t.price_override_cents,L.price={from:y.price_cents,to:D});let U=t.discount_cents||0;U&&(n.can("pdv.desconto")||await Ae(i,n,t.authorization,"\
desconto"),L.discount=U);let fe=nt(D,_,A,U);if(U>nt(D,_,A,0))throw f("Desconto maior que o valor do item");let we=(await i.query(`insert into order_items (company_id, session_id, p\
roduct_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, case when $19::boolean then now() end) returning *`,[n.companyId,r.id,y.id,y.name,_,y.unit,D,JSON.stringify(
S),A,U,fe,t.notes??null,y.sector_id,y.sector_id?"novo":"nao_produz",t.launch_mode,n.terminalId,n.userId,t.idempotency_key,!!y.sector_id&&d.kitchen_send!=="lote"&&r.kind!=="delivery"])).
rows[0];return await kt(i,n,we,y,S.map(V=>V.id)),await i.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),(t.launch_mode==="excecao"||Object.keys(
L).length)&&await h(i,n,t.launch_mode==="excecao"?"pdv.excecao_manual":"pdv.item_ajustado",{entity:"item",entityId:we.id,unitId:r.unit_id,reason:t.exception_reason,data:{session:r.
id,product:y.id,authorized_by:m,...L}}),{item:we,totals:await M(i,r.id),confirmation:{product:y.name,qty:_,unit_price_cents:D+A,total_cents:fe,destination:r.card_id?`Comanda ${(await i.
query("select number from tab_cards where id = $1",[r.card_id])).rows[0].number}`:r.label||`Consumo ${r.id}`}}}).catch(async i=>{if(i.code==="23505"){let r=await c("select * from o\
rder_items where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(r.rows[0])return{item:r.rows[0],replay:!0,totals:await M({query:c},r.rows[0].session_id)}}
throw i});a.status(s.replay?200:201).json(s)}));B.get("/items/by-key/:key",p("pdv.lancar"),l(async(e,a)=>{let t=await c("select * from order_items where company_id = $1 and idempot\
ency_key = $2",[e.ctx.companyId,String(e.params.key).slice(0,80)]);a.json({found:!!t.rows[0],item:t.rows[0]||null})}));B.post("/items/:id/cancel",p("pdv.lancar"),l(async(e,a)=>{let t=w(
I.object({reason:I.string().trim().min(3).max(200),authorization:I.string().max(100).optional()}),e.body),n=await v(async o=>{let s=(await o.query("select * from order_items where \
id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!s)throw $("Item n\xE3o encontrado");let i=await Z(o,e.ctx.companyId,s.session_id);Te(i);let r=(await o.
query("select * from order_items where id = $1 for update",[s.id])).rows[0];if(r.status!=="ativo")throw g("Item j\xE1 cancelado");let d=null;e.ctx.can("pdv.cancelar_item")||(d=(await Ae(
o,e.ctx,t.authorization,"cancelar_item")).authorized_by);let u=["preparando","pronto","entregue"].includes(r.kitchen_status);if(await o.query(`update order_items set status = 'canc\
elado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where id = $1`,[r.id,t.reason,e.ctx.userId]),(await M(o,i.id)).
balance<0)throw g("Cancelar este item deixaria o consumo com pagamento maior que o total. Estorne o pagamento antes.","overpaid");return await o.query("update consumption_sessions \
set version = version + 1 where id = $1",[i.id]),u||await dt(o,e.ctx,r.id,`Cancelamento: ${t.reason}`),await h(o,e.ctx,"pdv.item_cancelado",{entity:"item",entityId:r.id,unitId:i.unit_id,
reason:t.reason,data:{session:i.id,total_cents:r.total_cents,after_preparation:u,kitchen_status:r.kitchen_status,authorized_by:d}}),{ok:!0,after_preparation:u,totals:await M(o,i.id)}});
a.json(n)}));B.post("/items/transfer",p("pdv.transferir_item"),l(async(e,a)=>{let t=w(I.object({item_ids:I.array(I.number().int()).min(1).max(200),target_session_id:I.number().int(),
reason:I.string().trim().min(3).max(200)}),e.body);a.json(await v(n=>wa(n,e.ctx,t.item_ids,t.target_session_id,t.reason)))}));async function wa(e,a,t,n,o){let s=(await e.query("sel\
ect * from order_items where id = any($1) and company_id = $2 and status = 'ativo'",[t,a.companyId])).rows;if(s.length!==new Set(t).size)throw f("Itens inv\xE1lidos ou j\xE1 cancelados");
let i=[...new Set(s.map(m=>Number(m.session_id)))],r=[...i,n].sort((m,y)=>m-y),d={};for(let m of r)d[m]=await Z(e,a.companyId,m);let u=d[n];Te(u);for(let m of i){let y=d[m];if(Te(y),
m===n)throw f("Origem e destino iguais");if(y.unit_id!==u.unit_id)throw f("Transfer\xEAncia entre unidades n\xE3o permitida")}for(let m of s){let y=await e.query(`insert into order\
_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, transferred_from)
       select company_id, $2, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents, total_cents, notes,
              sector_id, kitchen_status, launch_mode, $3, $4, idempotency_key || '-t' || $5, id from order_items where id = $1 returning id`,[m.id,n,a.terminalId,a.userId,String(m.
id)]);await e.query("update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now() where id = $1",[m.id,`Transferido para consumo ${n} (ite\
m ${y.rows[0].id})`,a.userId])}for(let m of i){if((await M(e,m)).balance<0)throw g("A origem ficaria com pagamento maior que o consumo. Estorne antes de transferir.","overpaid");await e.
query("update consumption_sessions set version = version + 1 where id = $1",[m])}return await e.query("update consumption_sessions set version = version + 1 where id = $1",[n]),await h(
e,a,"pdv.itens_transferidos",{entity:"session",entityId:n,reason:o,data:{items:t,from:i}}),{ok:!0,moved:s.length}}B.post("/sessions/:id/merge",p("pdv.transferir_item"),l(async(e,a)=>{
let t=w(I.object({target_session_id:I.number().int(),reason:I.string().trim().min(3).max(200)}),e.body),n=Number(e.params.id);a.json(await v(async o=>{let s=(await o.query("select \
id from order_items where session_id = $1 and company_id = $2 and status = 'ativo'",[n,e.ctx.companyId])).rows.map(u=>u.id);if(!s.length)throw f("Consumo sem itens para juntar");if((await o.
query("select 1 from payments where session_id = $1 and status = 'confirmado'",[n])).rows[0])throw g("Consumo com pagamento registrado n\xE3o pode ser juntado; transfira os itens rest\
antes","has_payments");let r=await wa(o,e.ctx,s,t.target_session_id,t.reason);if(Number(t.target_session_id)===n)throw f("Escolha um destino diferente da origem");let d=(await o.query(
"select table_id, customer_name from consumption_sessions where id = $1",[n])).rows[0];return await o.query("update consumption_sessions set status = 'cancelada', closed_at = now()\
, closed_by = $2, label = coalesce(label,'') || ' (juntada)' where id = $1",[n,e.ctx.userId]),d.customer_name&&await o.query("update consumption_sessions set customer_name = coales\
ce(customer_name, $2) where id = $1",[t.target_session_id,d.customer_name]),d.table_id&&await St(o,d.table_id),r}))}));B.post("/sessions/:id/move-table",p("pdv.transferir_item"),l(
async(e,a)=>{let t=w(I.object({table_id:I.number().int(),reason:I.string().trim().min(3).max(200)}),e.body);await v(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));Te(
o);let s=(await n.query("select * from dining_tables where id = $1 and company_id = $2 and active",[t.table_id,e.ctx.companyId])).rows[0];if(!s)throw $("Mesa n\xE3o encontrada");if(s.
unit_id!==o.unit_id)throw f("Mesa de outra unidade");await n.query("update consumption_sessions set table_id = $2, version = version + 1 where id = $1",[o.id,s.id]),await n.query("\
update dining_tables set status = 'ocupada' where id = $1",[s.id]),o.table_id&&await St(n,o.table_id),await h(n,e.ctx,"pdv.mesa_trocada",{entity:"session",entityId:o.id,reason:t.reason,
data:{from:o.table_id,to:s.id}})}),a.json({ok:!0})}));async function St(e,a){await e.query(`update dining_tables set status = 'limpeza' where id = $1 and status in ('ocupada','cont\
a')
                  and not exists (select 1 from consumption_sessions where table_id = $1 and status in ('aberta','em_fechamento'))`,[a])}B.post("/sessions/:id/service-fee",p("pdv.l\
ancar"),l(async(e,a)=>{let t=w(I.object({bp:I.number().int().min(0).max(3e3),reason:I.string().trim().min(3).max(200),authorization:I.string().max(100).optional()}),e.body);a.json(
await v(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));if(!["aberta","em_fechamento"].includes(o.status))throw g("Consumo encerrado");e.ctx.can("pdv.taxa_servico")||
await Ae(n,e.ctx,t.authorization,"taxa_servico");let s=(await M(n,o.id)).paid;await n.query("update consumption_sessions set service_fee_bp = $2, service_fee_removed_reason = $3, v\
ersion = version + 1 where id = $1",[o.id,t.bp,t.reason]);let i=await M(n,o.id);if(s>i.total)throw g("Pagamento registrado supera o novo total. Estorne antes.","overpaid");return await h(
n,e.ctx,"pdv.taxa_servico",{entity:"session",entityId:o.id,reason:t.reason,data:{from:o.service_fee_bp,to:t.bp}}),i}))}));B.post("/sessions/:id/request-close",p("pdv.lancar"),l(async(e,a)=>{
a.json(await v(async t=>{let n=await Z(t,e.ctx.companyId,Number(e.params.id));return Te(n),await t.query("update consumption_sessions set status = 'em_fechamento', version = versio\
n + 1 where id = $1",[n.id]),n.table_id&&await t.query("update dining_tables set status = 'conta' where id = $1",[n.table_id]),{ok:!0}}))}));B.post("/sessions/:id/resume",p("pdv.la\
ncar"),l(async(e,a)=>{a.json(await v(async t=>{let n=await Z(t,e.ctx.companyId,Number(e.params.id));if(n.status!=="em_fechamento")throw g("Consumo n\xE3o est\xE1 em fechamento");return await t.
query("update consumption_sessions set status = 'aberta', version = version + 1 where id = $1",[n.id]),n.table_id&&await t.query("update dining_tables set status = 'ocupada' where \
id = $1",[n.table_id]),{ok:!0}}))}));B.post("/sessions/:id/suspend",p("pdv.lancar"),l(async(e,a)=>{let t=w(I.object({suspended:I.boolean()}),e.body);await c("update consumption_ses\
sions set suspended = $3 where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId,t.suspended]),a.json({ok:!0})}));B.get("/sessions/:id/split",p("pdv.lancar"),l(async(e,a)=>{
let t=Math.min(Math.max(Number(e.query.parts)||2,2),50),n=await M({query:c},Number(e.params.id));a.json({parts:Cn(Math.max(n.balance,0),t),balance:n.balance})}));B.post("/sessions/\
:id/close",p("pdv.receber"),l(async(e,a)=>{let t=w(I.object({version:I.number().int()}),e.body);a.json(await v(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));if(!["\
aberta","em_fechamento"].includes(o.status))throw g("Consumo j\xE1 encerrado","already_closed");if(o.version!==t.version)throw g("O consumo foi alterado em outro terminal. Confira \
antes de fechar.","version_conflict",{version:o.version});let s=await M(n,o.id);if(s.balance!==0)throw g(`Saldo pendente de ${(s.balance/100).toFixed(2)}. Receba antes de encerrar.`,
"balance_pending");if(s.items===0)throw f("Consumo sem itens: use cancelar");await n.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2,\
 version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await St(n,o.table_id);let i=await zt(n,e.ctx,o,s.items);return await h(n,e.ctx,"consumo.encerrado",{entity:"\
session",entityId:o.id,unitId:o.unit_id,data:s}),{ok:!0,totals:s,points_earned:i?.points||0}}))}));B.post("/sessions/:id/cancel",p("pdv.lancar"),l(async(e,a)=>{let t=w(I.object({reason:I.
string().trim().min(3).max(200),authorization:I.string().max(100).optional()}),e.body);a.json(await v(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));if(!["aberta","\
em_fechamento"].includes(o.status))throw g("Consumo j\xE1 encerrado");let s=await M(n,o.id);if(s.paid>0)throw g("H\xE1 pagamentos confirmados: estorne antes de cancelar","has_payme\
nts");let i=null;s.items>0&&!e.ctx.can("pdv.cancelar_venda")&&(i=(await Ae(n,e.ctx,t.authorization,"cancelar_venda")).authorized_by);let r=(await n.query("select id from order_item\
s where session_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','nao_produz')",[o.id])).rows;for(let d of r)await dt(n,e.ctx,d.id,`Consumo cancelado: ${t.reason}`);
return await n.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end
                    where session_id = $1 and status = 'ativo'`,[o.id,`Consumo cancelado: ${t.reason}`,e.ctx.userId]),await n.query("update consumption_sessions set status = 'cance\
lada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await St(n,o.table_id),await h(n,e.ctx,"consumo.cancelado",{entity:"\
session",entityId:o.id,reason:t.reason,data:{items_cents:s.items,authorized_by:i}}),{ok:!0}}))}));B.post("/sessions/:id/reopen",p("pdv.lancar"),l(async(e,a)=>{let t=w(I.object({reason:I.
string().trim().min(3).max(200),authorization:I.string().max(100).optional()}),e.body);a.json(await v(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));if(o.status!=="\
encerrada")throw g("S\xF3 consumos encerrados podem ser reabertos");let s=null;if(e.ctx.can("pdv.reabrir_comanda")||(s=(await Ae(n,e.ctx,t.authorization,"reabrir_comanda")).authorized_by),
o.card_id&&(await n.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento') and id <> $2",[o.card_id,o.id])).rows[0])throw g("O cart\xE3o\
 j\xE1 est\xE1 em uso por outro consumo. Transfira os itens em vez de reabrir.","card_busy");return await n.query("update consumption_sessions set status = 'aberta', closed_at = nu\
ll, closed_by = null, version = version + 1 where id = $1",[o.id]),await pa(n,e.ctx,o.id,"Consumo reaberto"),o.table_id&&await n.query("update dining_tables set status = 'ocupada' \
where id = $1",[o.table_id]),await h(n,e.ctx,"consumo.reaberto",{entity:"session",entityId:o.id,reason:t.reason,data:{authorized_by:s}}),{ok:!0}}))}));async function Lo(e,a,t){let n=[
a.companyId],o="company_id = $1 and status = 'aberto'";return a.terminalId?(n.push(a.terminalId),o+=` and terminal_id = $${n.length}`):(n.push(a.userId,t),o+=` and user_id = $${n.length-
1} and unit_id = $${n.length} and terminal_id is null`),(await e.query(`select * from cash_sessions where ${o} order by id desc limit 1`,n)).rows[0]}var Uo=I.object({method:I.enum(
["dinheiro","pix","debito","credito","vale","outro"]),amount_cents:I.number().int().positive().max(1e8),tendered_cents:I.number().int().positive().max(1e8).optional(),idempotency_key:I.
string().regex(/^[A-Za-z0-9_-]{8,80}$/)});B.post("/sessions/:id/payments",p("pdv.receber"),l(async(e,a)=>{let t=w(Uo,e.body),n=e.ctx,o=await c("select * from payments where company\
_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(o.rows[0])return a.json({payment:o.rows[0],replay:!0,totals:await M({query:c},o.rows[0].session_id)});let s=await v(
async i=>{let r=await Z(i,n.companyId,Number(e.params.id));if(be(n,r.unit_id),!["aberta","em_fechamento"].includes(r.status))throw g("Consumo encerrado","session_not_open");let d=await Ce(
i,n,r.unit_id),u=await Lo(i,n,r.unit_id);if(!u&&d.require_open_cash)throw g("Abra o caixa antes de receber","cash_closed");let m=await M(i,r.id);if(t.amount_cents>m.balance)throw f(
`Valor maior que o saldo (${(m.balance/100).toFixed(2)})`,"over_balance");let y=0;if(t.tendered_cents!=null){if(t.method!=="dinheiro")throw f("Troco s\xF3 \xE9 permitido em dinheiro",
"change_not_allowed");if(t.tendered_cents<t.amount_cents)throw f("Valor entregue menor que o valor a pagar");y=t.tendered_cents-t.amount_cents}let{day_cutoff:_,timezone:j}=await fa(
i,n.companyId,r.unit_id),x=(await i.query(`insert into payments (company_id, session_id, cash_session_id, method, amount_cents, tendered_cents, change_cents, business_date, idempot\
ency_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[n.companyId,r.id,u?.id??null,t.method,t.amount_cents,t.tendered_cents??null,y,le(new Date,j,_),t.idempotency_key,n.userId])).
rows[0];return await i.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),await h(i,n,"pagamento.registrado",{entity:"payment",entityId:x.id,unitId:r.
unit_id,data:{session:r.id,method:t.method,amount_cents:t.amount_cents,change_cents:y}}),{payment:x,totals:await M(i,r.id)}}).catch(async i=>{if(i.code==="23505"){let r=await c("se\
lect * from payments where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(r.rows[0])return{payment:r.rows[0],replay:!0,totals:await M({query:c},r.rows[0].
session_id)}}throw i});a.status(s.replay?200:201).json(s)}));B.post("/payments/:id/refund",p("financeiro.estornar"),l(async(e,a)=>{let t=w(I.object({reason:I.string().trim().min(3).
max(200)}),e.body);a.json(await v(async n=>{let o=(await n.query("select * from payments where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw $(
"Pagamento n\xE3o encontrado");let s=await Z(n,e.ctx.companyId,o.session_id);if(!["aberta","em_fechamento"].includes(s.status))throw g("Reabra o consumo antes de estornar","session\
_closed");if(!(await n.query(`update payments set status = 'estornado', refund_reason = $2, refunded_by = $3, refunded_at = now()
                              where id = $1 and status = 'confirmado' returning id`,[o.id,t.reason,e.ctx.userId])).rows[0])throw g("Pagamento j\xE1 estornado");return await n.query(
"update consumption_sessions set version = version + 1 where id = $1",[s.id]),await ya(n,e.ctx,o.id),await h(n,e.ctx,"pagamento.estornado",{entity:"payment",entityId:o.id,reason:t.
reason,data:{amount_cents:o.amount_cents,method:o.method}}),{ok:!0,totals:await M(n,s.id)}}))}));B.post("/sessions/:id/send",p("pdv.lancar"),l(async(e,a)=>{a.json(await v(async t=>{
let n=await Z(t,e.ctx.companyId,Number(e.params.id));be(e.ctx,n.unit_id);let o=await t.query(`update order_items set sent_at = now() where session_id = $1 and status = 'ativo' and \
sent_at is null
      and kitchen_status = 'novo' returning id`,[n.id]);return o.rowCount&&await h(t,e.ctx,"producao.lote_enviado",{entity:"session",entityId:n.id,data:{items:o.rowCount}}),{sent:o.
rowCount}}))}));B.post("/mode",p("pdv.lancar"),l(async(e,a)=>{let t=w(I.object({from:I.enum(["manual","continua","dupla"]),to:I.enum(["manual","continua","dupla"]),reason:I.string().
trim().max(200).optional()}),e.body),n=await Ce({query:c},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId);if(t.from!==t.to){if(J(e.ctx,"pdv.alterar_modo"),!n.allow_mode_change)throw T("T\
roca de modo desabilitada nesta configura\xE7\xE3o","mode_locked");if(n.double_read_mandatory&&t.to!=="dupla")throw T("Dupla leitura obrigat\xF3ria: use a exce\xE7\xE3o autorizada",
"double_read_required");if(!n.scanner_enabled&&t.to!=="manual")throw T("Leitor desabilitado","scanner_disabled")}await h({query:c},e.ctx,"pdv.modo_alterado",{reason:t.reason,data:{
from:t.from,to:t.to}}),a.json({ok:!0,mode:t.to})}));import{Router as Fo}from"npm:express@5.2.1";import{z as Y}from"npm:zod@4.6.5";var qe=Fo(),ln=["dinheiro","pix","debito","credito","vale","outro"];async function Nt(e,a){let t=(await e.query("select opening_cents from cash_sessions where id = $1",[a])).rows[0],
n=(await e.query("select method, coalesce(sum(amount_cents),0)::bigint as total from payments where cash_session_id = $1 and status = 'confirmado' group by method",[a])).rows,o=(await e.
query("select kind, coalesce(sum(amount_cents),0)::bigint as total from cash_movements where cash_session_id = $1 group by kind",[a])).rows,s=Object.fromEntries(ln.map(r=>[r,0]));for(let r of n)
s[r.method]=Number(r.total);let i=Object.fromEntries(o.map(r=>[r.kind,Number(r.total)]));return s.dinheiro=t.opening_cents+s.dinheiro+(i.suprimento||0)-(i.sangria||0)-(i.despesa||0),
{byMethod:s,opening:t.opening_cents,movements:i}}async function ha(e){let a=[e.ctx.companyId],t="c.company_id = $1 and c.status = 'aberto'";return e.ctx.terminalId?(a.push(e.ctx.terminalId),
t+=` and c.terminal_id = $${a.length}`):(a.push(e.ctx.userId),t+=` and c.user_id = $${a.length} and c.terminal_id is null`),(await c(`select c.*, u.name as user_name from cash_sess\
ions c join users u on u.id = c.user_id where ${t} order by c.id desc limit 1`,a)).rows[0]}qe.get("/current",l(async(e,a)=>{let t=await ha(e);if(!t)return a.json({open:!1});let n=e.
ctx.can("financeiro.visualizar");a.json({open:!0,cash:{id:t.id,opened_at:t.opened_at,user_name:t.user_name,opening_cents:t.opening_cents,business_date:t.business_date},expected:n?await Nt(
{query:c},t.id):null})}));qe.post("/open",p("caixa.abrir"),l(async(e,a)=>{let t=w(Y.object({opening_cents:Y.number().int().min(0).max(1e7)}),e.body),n=e.ctx.terminalUnitId||e.ctx.unitId||
(await c("select id from units where company_id = $1 order by id limit 1",[e.ctx.companyId])).rows[0].id;if(!e.ctx.terminalId&&(await c("select 1 from terminals where company_id = \
$1 and active limit 1",[e.ctx.companyId])).rows[0])throw f("Identifique o terminal deste dispositivo antes de abrir o caixa","terminal_required");if(await ha(e))throw g("J\xE1 existe \
caixa aberto neste terminal","cash_open");let o=(await c("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1",[n])).rows[0],s=await c(
"insert into cash_sessions (company_id, unit_id, terminal_id, user_id, opening_cents, business_date) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,n,e.ctx.terminalId,e.
ctx.userId,t.opening_cents,le(new Date,o.timezone,o.day_cutoff)]).catch(i=>{throw i.code==="23505"?g("J\xE1 existe caixa aberto neste terminal","cash_open"):i});await h({query:c},e.
ctx,"caixa.aberto",{entity:"cash",entityId:s.rows[0].id,unitId:n,data:t}),a.status(201).json({id:s.rows[0].id})}));qe.post("/:id/movements",l(async(e,a)=>{let t=w(Y.object({kind:Y.
enum(["sangria","suprimento","despesa"]),amount_cents:Y.number().int().positive().max(1e7),reason:Y.string().trim().min(3).max(200)}),e.body);J(e.ctx,t.kind==="suprimento"?"caixa.s\
uprimento":"caixa.sangria");let n=await v(async o=>{let s=(await o.query("select * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).
rows[0];if(!s)throw $("Caixa n\xE3o encontrado");if(s.status!=="aberto")throw g("Caixa fechado");if(t.kind!=="suprimento"){let r=await Nt(o,s.id);if(t.amount_cents>r.byMethod.dinheiro)
throw f("Valor maior que o dinheiro esperado na gaveta")}let i=await o.query("insert into cash_movements (company_id, cash_session_id, kind, amount_cents, reason, user_id) values (\
$1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,s.id,t.kind,t.amount_cents,t.reason,e.ctx.userId]);return await h(o,e.ctx,`caixa.${t.kind}`,{entity:"cash",entityId:s.id,reason:t.
reason,data:{amount_cents:t.amount_cents}}),{id:i.rows[0].id}});a.status(201).json(n)}));qe.post("/:id/close",p("caixa.fechar"),l(async(e,a)=>{let t=w(Y.object({counted:Y.object(Object.
fromEntries(ln.map(o=>[o,Y.number().int().min(0).max(1e8).default(0)]))),notes:Y.record(Y.string(),Y.number().int().min(0).max(1e5)).optional(),justification:Y.string().trim().max(
300).optional()}),e.body),n=await v(async o=>{let s=(await o.query("select * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).
rows[0];if(!s)throw $("Caixa n\xE3o encontrado");if(s.status!=="aberto")throw g("Caixa j\xE1 fechado");let i=await Nt(o,s.id),r=Object.fromEntries(ln.map(u=>[u,(t.counted[u]||0)-(i.
byMethod[u]||0)])),d=Object.values(r).reduce((u,m)=>u+m,0);if(Object.values(r).some(u=>u!==0)&&!t.justification)throw f("H\xE1 diferen\xE7a na confer\xEAncia: informe a justificativa",
"justification_required");return await o.query(`update cash_sessions set status = 'fechado', closed_at = now(), closed_by = $2, counted = $3, expected = $4,
                      difference_cents = $5, justification = $6 where id = $1`,[s.id,e.ctx.userId,{...t.counted,notes:t.notes??null},i.byMethod,d,t.justification??null]),await h(o,
e.ctx,"caixa.fechado",{entity:"cash",entityId:s.id,reason:t.justification,data:{difference_cents:d,by_method:r}}),{ok:!0,expected:i.byMethod,counted:t.counted,difference_cents:d,by_method:r}});
a.json(n)}));qe.post("/:id/reopen",p("caixa.reabrir"),l(async(e,a)=>{let t=w(Y.object({reason:Y.string().trim().min(3).max(200)}),e.body);await v(async n=>{let o=(await n.query("se\
lect * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw $();if(o.status!=="fechado")throw g("Caixa n\xE3o e\
st\xE1 fechado");if(new Date(o.closed_at)<new Date(Date.now()-48*3600*1e3))throw f("Reabertura permitida at\xE9 48 horas ap\xF3s o fechamento");if((o.terminal_id?await n.query("sel\
ect 1 from cash_sessions where terminal_id = $1 and status = 'aberto'",[o.terminal_id]):{rows:[]}).rows[0])throw g("J\xE1 existe outro caixa aberto neste terminal");await n.query("\
update cash_sessions set status = 'aberto', closed_at = null, closed_by = null where id = $1",[o.id]),await h(n,e.ctx,"caixa.reaberto",{entity:"cash",entityId:o.id,reason:t.reason,
data:{previous:{counted:o.counted,difference_cents:o.difference_cents,closed_at:o.closed_at}}})}),a.json({ok:!0})}));qe.get("/",p("financeiro.visualizar"),l(async(e,a)=>{a.json((await c(
`select c.id, c.status, c.opened_at, c.closed_at, c.business_date, c.opening_cents, c.difference_cents, c.justification,
                            u.name as user_name, t.name as terminal_name
                       from cash_sessions c join users u on u.id = c.user_id left join terminals t on t.id = c.terminal_id
                      where c.company_id = $1 order by c.id desc limit 100`,[e.ctx.companyId])).rows)}));qe.get("/:id/report",p("financeiro.visualizar"),l(async(e,a)=>{let t=(await c(
"select * from cash_sessions where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw $();let n=(await c("select m.kind, m.amount_cents, m.rea\
son, m.created_at, u.name user_name from cash_movements m left join users u on u.id = m.user_id where cash_session_id = $1 order by m.id",[t.id])).rows;a.json({cash:t,expected:await Nt(
{query:c},t.id),movements:n})}));import{Router as Bo}from"npm:express@5.2.1";var Ct=Bo();Ct.get("/dashboard",l(async(e,a)=>{let t=e.ctx,n=(await c("select id, day_cutoff from units where company_id = $1 and ($2::bigint is null or id = $2) order by id limit \
1",[t.companyId,t.terminalUnitId||t.unitId||null])).rows[0],o=le(new Date,t.company.timezone,n?.day_cutoff??5),s=t.can("financeiro.visualizar"),i=(await c(`select
       (select coalesce(sum(i.total_cents),0)::bigint from order_items i join consumption_sessions s on s.id = i.session_id
         where s.company_id = $1 and s.business_date = $2 and i.status = 'ativo' and s.status <> 'cancelada') as consumed_cents,
       (select coalesce(sum(amount_cents),0)::bigint from payments where company_id = $1 and business_date = $2 and status = 'confirmado') as received_cents,
       (select count(*)::int from consumption_sessions where company_id = $1 and status in ('aberta','em_fechamento')) as open_sessions,
       (select count(*)::int from dining_tables where company_id = $1 and active and status in ('ocupada','conta')) as busy_tables,
       (select count(*)::int from dining_tables where company_id = $1 and active) as total_tables,
       (select count(*)::int from order_items where company_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','preparando')) as preparing,
       (select count(*)::int from cash_sessions where company_id = $1 and business_date = $2 and status = 'fechado' and difference_cents <> 0) as cash_differences,
       (select count(*)::int from cash_sessions where company_id = $1 and status = 'aberto') as open_cash,
       (select count(*)::int from products where company_id = $1 and demo) as demo_products`,[t.companyId,o])).rows[0],r=s?(await c(`select extract(hour from p.created_at at time z\
one $3)::int as hour, sum(p.amount_cents)::bigint as cents
       from payments p where p.company_id = $1 and p.business_date = $2 and p.status = 'confirmado' group by 1 order by 1`,[t.companyId,o,t.company.timezone])).rows:null,d=(await c(
`select i.description, sum(i.qty)::numeric as qty ${s?", sum(i.total_cents)::bigint as cents":""}
       from order_items i join consumption_sessions s on s.id = i.session_id
      where s.company_id = $1 and s.business_date = $2 and i.status = 'ativo' group by 1 order by 2 desc limit 5`,[t.companyId,o])).rows;s||(delete i.consumed_cents,delete i.received_cents,
delete i.cash_differences),a.json({business_date:o,...i,by_hour:r,top:d,access:t.access,pending_modules:["delivery","estoque","cozinha","clientes","marketing","agente","fiscal","re\
latorios"]})}));Ct.get("/search",l(async(e,a)=>{let t=String(e.query.q||"").trim().slice(0,60);if(t.length<2)return a.json([]);let n=e.ctx,o=`%${t}%`,s=[];if(n.can("cardapio.visual\
izar")){let i=await c("select id, name from products where company_id = $1 and (name ilike $2 or sku = $3) order by name limit 6",[n.companyId,o,t]);s.push(...i.rows.map(r=>({type:"\
produto",id:r.id,label:r.name,to:`/cardapio?produto=${r.id}`})))}if(n.can("pdv.lancar")){let i=Number(t.replace(/\D/g,""));if(i){let d=await c(`select s.id, c.number card, t.number\
 tbl, s.status from consumption_sessions s left join tab_cards c on c.id = s.card_id
                          left join dining_tables t on t.id = s.table_id
                          where s.company_id = $1 and (c.number = $2 or t.number = $2 or s.id = $2) and s.status in ('aberta','em_fechamento') limit 6`,[n.companyId,i]);s.push(...d.
rows.map(u=>({type:"consumo",id:u.id,label:u.card?`Comanda ${u.card}`:u.tbl?`Mesa ${u.tbl}`:`Consumo ${u.id}`,to:`/pdv?sessao=${u.id}`})))}let r=await c(`select s.id, s.customer_na\
me, s.label from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')
                         and (s.customer_name ilike $2 or s.label ilike $2) limit 5`,[n.companyId,o]);s.push(...r.rows.map(d=>({type:"consumo",id:d.id,label:d.customer_name||d.label,
to:`/pdv?sessao=${d.id}`})))}if(n.can("usuarios.gerenciar")){let i=await c("select id, name from users where company_id = $1 and name ilike $2 limit 4",[n.companyId,o]);s.push(...i.
rows.map(r=>({type:"usuario",id:r.id,label:r.name,to:"/configuracoes/usuarios"})))}a.json(s)}));import{Router as Vo}from"npm:express@5.2.1";import{z as C}from"npm:zod@4.6.5";var Q=Vo(),ga=C.object({name:C.string().trim().min(2).max(100),cpf:C.string().max(20).optional().nullable(),phone:C.string().trim().max(30).optional().nullable(),email:C.string().trim().
email().max(120).optional().nullable().or(C.literal("")),birthday:C.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(C.literal("")),address:C.object({street:C.string().
max(120).optional(),number:C.string().max(20).optional(),district:C.string().max(80).optional(),city:C.string().max(80).optional(),complement:C.string().max(80).optional(),reference:C.
string().max(120).optional()}).partial().optional(),tags:C.array(C.string().trim().min(1).max(30)).max(20).optional(),preferences:C.string().max(300).optional().nullable(),notes:C.
string().max(500).optional().nullable(),consent_whatsapp:C.boolean().optional(),consent_email:C.boolean().optional()}),ba=e=>{let a=se(e);return a?a.slice(-13):null};async function $a(e,a,t){
if(!t.length)return{};let n=await e.query(`select s.customer_id, count(*)::int as visits, max(s.closed_at) as last_visit,
            coalesce(sum((select coalesce(sum(i.total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo')),0)::bigint as spent_cents
       from consumption_sessions s where s.company_id = $1 and s.customer_id = any($2) and s.status = 'encerrada' group by s.customer_id`,[a,t]);return Object.fromEntries(n.rows.map(
o=>[o.customer_id,o]))}Q.get("/lookup",p("clientes.visualizar"),l(async(e,a)=>{let t=jt(e.query.cpf,{required:!0}),n=(await c("select * from customers where company_id = $1 and cpf\
 = $2 and anonymized_at is null",[e.ctx.companyId,t])).rows[0];if(!n)return a.json({found:!1,cpf:dn(t)});let o=(await c(`select s.id, s.kind, t.number as table_number, cd.number as\
 card_number from consumption_sessions s
      left join dining_tables t on t.id = s.table_id left join tab_cards cd on cd.id = s.card_id
     where s.company_id = $1 and s.customer_id = $2 and s.status in ('aberta','em_fechamento') limit 3`,[e.ctx.companyId,n.id])).rows;a.json({found:!0,customer:{id:n.id,name:n.name,
points:n.points,tags:n.tags,preferences:n.preferences},open_sessions:o})}));Q.get("/",p("clientes.visualizar"),l(async(e,a)=>{let t=[e.ctx.companyId],n="c.company_id = $1 and c.ano\
nymized_at is null",o=String(e.query.q||"").trim().slice(0,80);if(o){let m=se(o);t.push(`%${o.toLowerCase()}%`),n+=` and (lower(c.name) like $${t.length}`,m.length>=3&&(t.push(`%${m}\
%`),n+=` or c.cpf like $${t.length} or regexp_replace(coalesce(c.phone,''),'\\D','','g') like $${t.length}`),n+=")"}e.query.tag&&(t.push(String(e.query.tag)),n+=` and $${t.length} \
= any(c.tags)`),e.query.birthday==="mes"&&(n+=" and extract(month from c.birthday) = extract(month from current_date)");let s=Math.min(200,Number(e.query.limit)||50),i=Math.max(0,Number(
e.query.offset)||0),r=(await c(`select count(*)::int as n from customers c where ${n}`,t)).rows[0].n,d=(await c(`select c.* from customers c where ${n} order by lower(c.name) limit\
 ${s} offset ${i}`,t)).rows,u=await $a({query:c},e.ctx.companyId,d.map(m=>m.id));a.json({total:r,items:d.map(m=>Ye({...m,...u[m.id]||{visits:0,spent_cents:0,last_visit:null}},e.ctx))})}));
Q.get("/summary",p("clientes.visualizar"),l(async(e,a)=>{let t=(await c(`select count(*)::int as total,
      count(*) filter (where extract(month from birthday) = extract(month from current_date))::int as birthdays,
      count(*) filter (where consent_whatsapp and unsubscribed_at is null)::int as whatsapp_ok,
      coalesce(sum(points),0)::int as points
    from customers where company_id = $1 and anonymized_at is null`,[e.ctx.companyId])).rows[0],n=(await c("select t as tag, count(*)::int as n from customers, unnest(tags) t where\
 company_id = $1 and anonymized_at is null group by t order by n desc limit 20",[e.ctx.companyId])).rows,o=(await c("select settings from companies where id = $1",[e.ctx.companyId])).
rows[0];a.json({...t,tags:n,loyalty:It(o.settings)})}));Q.put("/loyalty",p("clientes.gerenciar","configuracoes.gerenciar"),l(async(e,a)=>{let t=w(C.object({enabled:C.boolean(),cents_per_point:C.
number().int().min(1).max(1e5),point_value_cents:C.number().int().min(1).max(1e4),validity_days:C.number().int().min(7).max(3650),min_redeem:C.number().int().min(1).max(1e5)}),e.body);
await c("update companies set settings = jsonb_set(settings, '{loyalty}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await h({query:c},e.ctx,"fidelidade.configu\
racao",{data:t}),a.json({ok:!0})}));Q.get("/:id",p("clientes.visualizar"),l(async(e,a)=>{let t=Number(e.params.id);await v(u=>mn(u,e.ctx.companyId,t));let n=(await c("select * from\
 customers where id = $1 and company_id = $2",[t,e.ctx.companyId])).rows[0];if(!n)throw $("Cliente n\xE3o encontrado");let o=(await $a({query:c},e.ctx.companyId,[t]))[t]||{visits:0,
spent_cents:0,last_visit:null},s=(await c(`select s.id, s.kind, s.opened_at, s.closed_at, s.status,
       (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
       (select string_agg(i.description, ', ' order by i.id) from (select description, id from order_items where session_id = s.id and status = 'ativo' limit 6) i) as items
     from consumption_sessions s where s.company_id = $1 and s.customer_id = $2 order by s.opened_at desc limit 30`,[e.ctx.companyId,t])).rows,i=(await c("select id, kind, points, \
expires_at, reason, session_id, created_at from loyalty_ledger where company_id = $1 and customer_id = $2 order by id desc limit 50",[e.ctx.companyId,t])).rows,r=(await c("select i\
d, score, comment, created_at from reviews where company_id = $1 and customer_id = $2 order by id desc limit 10",[e.ctx.companyId,t])).rows,d=o.visits?Math.round(Number(o.spent_cents)/
o.visits):0;a.json({customer:Ye({...n,...o},e.ctx),ticket_cents:d,history:s,ledger:i,reviews:r})}));function va(e,a){return{cpf:e.cpf!==void 0?jt(e.cpf):void 0,phone:e.phone!==void 0?
e.phone||null:void 0,email:e.email!==void 0?e.email||null:void 0,birthday:e.birthday!==void 0?e.birthday||null:void 0,consent_at:e.consent_whatsapp||e.consent_email?new Date:void 0,
by:a.userId}}async function Ho(e,a,t){let n=va(t,a);if(n.phone&&ba(n.phone).length<10)throw f("Telefone deve ter DDD");let o=await e.query(`insert into customers (company_id, cpf, \
name, phone, email, birthday, address, tags, preferences, notes, consent_whatsapp, consent_email, consent_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,[a.companyId,n.cpf??null,t.name,n.phone??null,n.email??null,n.birthday??null,t.address||{},t.tags||[],t.preferences??
null,t.notes??null,!!t.consent_whatsapp,!!t.consent_email,n.consent_at??null,a.userId]).catch(s=>{throw s.code==="23505"?g("J\xE1 existe cliente com este CPF","cpf_in_use"):s});return await h(
e,a,"cliente.criado",{entity:"customer",entityId:o.rows[0].id,data:{consent_whatsapp:!!t.consent_whatsapp,consent_email:!!t.consent_email}}),o.rows[0]}Q.post("/",p("clientes.gerenc\
iar"),l(async(e,a)=>{let t=w(ga,e.body),n=await v(o=>Ho(o,e.ctx,t));a.status(201).json(Ye(n,e.ctx))}));Q.put("/:id",p("clientes.gerenciar"),l(async(e,a)=>{let t=w(ga.partial(),e.body),
n=Number(e.params.id),o=await v(async s=>{let i=(await s.query("select * from customers where id = $1 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!i)throw $("C\
liente n\xE3o encontrado");if(i.anonymized_at)throw g("Cliente anonimizado n\xE3o pode ser editado");if(!e.ctx.can("dados.pessoais"))for(let m of["cpf","phone","email","birthday","\
address"])delete t[m];let r=va(t,e.ctx),d=t.consent_whatsapp!==void 0&&t.consent_whatsapp!==i.consent_whatsapp||t.consent_email!==void 0&&t.consent_email!==i.consent_email,u=await s.
query(`update customers set name = coalesce($3,name), cpf = case when $4::boolean then $5 else cpf end, phone = case when $6::boolean then $7 else phone end,
         email = case when $8::boolean then $9 else email end, birthday = case when $10::boolean then $11::date else birthday end,
         address = coalesce($12,address), tags = coalesce($13,tags), preferences = coalesce($14,preferences), notes = coalesce($15,notes),
         consent_whatsapp = coalesce($16,consent_whatsapp), consent_email = coalesce($17,consent_email),
         consent_at = case when $18::boolean then now() else consent_at end,
         unsubscribed_at = case when coalesce($16,false) or coalesce($17,false) then null else unsubscribed_at end, updated_at = now()
       where id = $1 and company_id = $2 returning *`,[n,e.ctx.companyId,t.name??null,r.cpf!==void 0,r.cpf??null,r.phone!==void 0,r.phone??null,r.email!==void 0,r.email??null,r.birthday!==
void 0,r.birthday??null,t.address??null,t.tags??null,t.preferences??null,t.notes??null,t.consent_whatsapp??null,t.consent_email??null,d]).catch(m=>{throw m.code==="23505"?g("J\xE1 exi\
ste cliente com este CPF","cpf_in_use"):m});return await h(s,e.ctx,d?"cliente.consentimento":"cliente.alterado",{entity:"customer",entityId:n,data:{fields:Object.keys(t),consent_whatsapp:t.
consent_whatsapp,consent_email:t.consent_email}}),u.rows[0]});a.json(Ye(o,e.ctx))}));Q.post("/:id/points",p("clientes.gerenciar","pdv.autorizar"),l(async(e,a)=>{let t=w(C.object({points:C.
number().int().refine(s=>s!==0).refine(s=>Math.abs(s)<=1e5),reason:C.string().trim().min(3).max(200)}),e.body),n=Number(e.params.id),o=await v(async s=>{let i=(await s.query("selec\
t points from customers where id = $1 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!i)throw $("Cliente n\xE3o encontrado");if(i.points+t.points<0)throw g("Saldo\
 n\xE3o pode ficar negativo");let r=await Me(s,e.ctx.companyId,n,{kind:"ajuste",points:t.points,reason:t.reason,user_id:e.ctx.userId});return await h(s,e.ctx,"cliente.pontos_ajusta\
dos",{entity:"customer",entityId:n,reason:t.reason,data:{points:t.points}}),r});a.status(201).json(o)}));Q.post("/:id/redeem",p("pdv.receber"),l(async(e,a)=>{let t=w(C.object({session_id:C.
number().int(),points:C.number().int().positive(),idempotency_key:C.string().regex(/^[A-Za-z0-9_-]{8,80}$/)}),e.body),n=Number(e.params.id),o=await c("select * from payments where \
company_id = $1 and idempotency_key = $2",[e.ctx.companyId,t.idempotency_key]);if(o.rows[0])return a.json({payment:o.rows[0],replay:!0});let s=await v(async i=>{let r=await Z(i,e.ctx.
companyId,t.session_id);if(be(e.ctx,r.unit_id),!["aberta","em_fechamento"].includes(r.status))throw g("Consumo encerrado","session_not_open");if(Number(r.customer_id)!==n)throw g("\
O consumo n\xE3o est\xE1 identificado com este cliente","customer_mismatch");await mn(i,e.ctx.companyId,n);let d=(await i.query("select settings, timezone from companies where id =\
 $1",[e.ctx.companyId])).rows[0],u=It(d.settings);if(!u.enabled)throw g("Programa de fidelidade desligado");if(t.points<u.min_redeem)throw f(`Resgate m\xEDnimo de ${u.min_redeem} p\
ontos`);let m=t.points*u.point_value_cents,y=await M(i,r.id);if(m>y.balance)throw f("Valor do resgate maior que o saldo do consumo","over_balance");let _=(await i.query("select day\
_cutoff from units where id = $1",[r.unit_id])).rows[0],j=(await i.query(`insert into payments (company_id, session_id, method, amount_cents, business_date, idempotency_key, user_i\
d)
       values ($1,$2,'vale',$3,$4,$5,$6) returning *`,[e.ctx.companyId,r.id,m,le(new Date,d.timezone,_.day_cutoff),t.idempotency_key,e.ctx.userId])).rows[0];return await _a(i,e.ctx,
n,t.points,j.id,r.id),await i.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),await h(i,e.ctx,"cliente.pontos_resgatados",{entity:"payment",entityId:j.
id,unitId:r.unit_id,data:{customer:n,points:t.points,amount_cents:m}}),{payment:j,totals:await M(i,r.id)}});a.status(201).json(s)}));Q.post("/attach",p("pdv.lancar"),l(async(e,a)=>{
let t=w(C.object({session_id:C.number().int(),customer_id:C.number().int().nullable()}),e.body),n=await v(async o=>{let s=await Z(o,e.ctx.companyId,t.session_id);if(be(e.ctx,s.unit_id),
!["aberta","em_fechamento"].includes(s.status))throw g("Consumo encerrado","session_not_open");let i=null;if(t.customer_id){let r=(await o.query("select name from customers where i\
d = $1 and company_id = $2 and anonymized_at is null",[t.customer_id,e.ctx.companyId])).rows[0];if(!r)throw $("Cliente n\xE3o encontrado");i=r.name}return await o.query("update con\
sumption_sessions set customer_id = $2, customer_name = coalesce($3, customer_name), version = version + 1 where id = $1",[s.id,t.customer_id,i]),await h(o,e.ctx,"consumo.cliente",
{entity:"session",entityId:s.id,data:{customer:t.customer_id}}),{ok:!0,customer_name:i}});a.json(n)}));Q.get("/export/csv",p("clientes.gerenciar"),l(async(e,a)=>{let t=(await c("se\
lect * from customers where company_id = $1 and anonymized_at is null order by name",[e.ctx.companyId])).rows,o=[["nome","cpf","telefone","email","aniversario","etiquetas","pontos",
"whatsapp","email_ok"].join(";")];for(let s of t){let i=Ye(s,e.ctx);o.push([i.name,i.cpf,i.phone,i.email,i.birthday,(i.tags||[]).join("|"),i.points,i.consent_whatsapp?"sim":"nao",i.
consent_email?"sim":"nao"].map(Be).join(";"))}await h({query:c},e.ctx,"cliente.exportados",{data:{count:t.length,full:e.ctx.can("dados.pessoais")}}),a.setHeader("content-type","tex\
t/csv; charset=utf-8"),a.setHeader("content-disposition",'attachment; filename="clientes.csv"'),a.send(`\uFEFF${o.join(`
`)}`)}));Q.post("/import",p("clientes.gerenciar","dados.pessoais"),l(async(e,a)=>{let t=w(C.object({rows:C.array(C.record(C.string(),C.any())).max(2e3),dry_run:C.boolean().default(
!0)}),e.body),n=(u,...m)=>{for(let y of Object.keys(u))if(m.includes(y.toLowerCase().trim()))return String(u[y]??"").trim();return""},o=(await c("select cpf, regexp_replace(coalesc\
e(phone,''),'\\D','','g') as phone from customers where company_id = $1",[e.ctx.companyId])).rows,s=new Set(o.map(u=>u.cpf).filter(Boolean)),i=new Set(o.map(u=>u.phone).filter(Boolean)),
r=[],d=[];t.rows.forEach((u,m)=>{let y=n(u,"nome","name","cliente"),_=n(u,"cpf","documento"),j=ba(n(u,"telefone","celular","whatsapp","phone")),x=n(u,"email","e-mail"),S=n(u,"anive\
rsario","anivers\xE1rio","nascimento","birthday"),A=S.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);A&&(S=`${A[3]}-${A[2]}-${A[1]}`);let D=m+2;if(y.length<2)return r.push({line:D,status:"er\
ro",message:"Nome ausente"});let L=null;if(_)try{L=jt(_)}catch{return r.push({line:D,status:"erro",message:"CPF inv\xE1lido"})}if(L&&s.has(L))return r.push({line:D,status:"duplicad\
o",message:"CPF j\xE1 cadastrado"});if(!L&&j&&i.has(j))return r.push({line:D,status:"duplicado",message:"Telefone j\xE1 cadastrado"});S&&!/^\d{4}-\d{2}-\d{2}$/.test(S)&&(S=""),L&&s.
add(L),j&&i.add(j),d.push({name:y.slice(0,100),cpf:L,phone:j,email:/@/.test(x)?x.slice(0,120):null,birthday:S||null}),r.push({line:D,status:"ok",name:y})}),!t.dry_run&&d.length&&await v(
async u=>{for(let m of d)await u.query("insert into customers (company_id, cpf, name, phone, email, birthday, created_by) values ($1,$2,$3,$4,$5,$6,$7)",[e.ctx.companyId,m.cpf,m.name,
m.phone,m.email,m.birthday,e.ctx.userId]);await h(u,e.ctx,"cliente.importados",{data:{count:d.length}})}),a.json({dry_run:t.dry_run,valid:d.length,report:r.slice(0,500)})}));Q.post(
"/:id/anonymize",p("clientes.gerenciar","dados.pessoais"),l(async(e,a)=>{let t=w(C.object({reason:C.string().trim().min(3).max(200)}),e.body);J(e.ctx,"pdv.autorizar");let n=Number(
e.params.id);await v(async o=>{if(!(await o.query(`update customers set name = 'Cliente anonimizado', cpf = null, phone = null, email = null, birthday = null,
        address = '{}', tags = '{}', preferences = null, notes = null, consent_whatsapp = false, consent_email = false, anonymized_at = now(), updated_at = now()
      where id = $1 and company_id = $2 and anonymized_at is null returning id`,[n,e.ctx.companyId])).rows[0])throw $("Cliente n\xE3o encontrado");await o.query("update consumption\
_sessions set customer_name = null where company_id = $1 and customer_id = $2",[e.ctx.companyId,n]),await o.query("update delivery_orders set customer_name = 'Anonimizado', phone =\
 '', address = '{}' where company_id = $1 and customer_id = $2",[e.ctx.companyId,n]),await h(o,e.ctx,"cliente.anonimizado",{entity:"customer",entityId:n,reason:t.reason})}),a.json(
{ok:!0})}));import{Router as Go}from"npm:express@5.2.1";import{z as ye}from"npm:zod@4.6.5";var ie=Go(),xa=(...e)=>(a,t,n)=>e.some(o=>a.ctx.can(o))?n():n(T("Sem permiss\xE3o para o painel")),Et=["novo","aceito","preparando","pronto","entregue"];ie.get("/sectors",p("cozinh\
a.operar"),l(async(e,a)=>{a.json((await c(`select s.id, s.name, s.target_minutes,
      (select count(*)::int from order_items i where i.sector_id = s.id and i.sent_at is not null and i.status = 'ativo'
         and i.kitchen_status in ('novo','aceito','preparando')) as open_count
    from production_sectors s where s.company_id = $1 and s.active order by s.id`,[e.ctx.companyId])).rows)}));ie.put("/sectors/:id",p("cardapio.gerenciar"),l(async(e,a)=>{let t=w(
ye.object({target_minutes:ye.number().int().min(1).max(240)}),e.body);if(!(await c("update production_sectors set target_minutes = $3 where id = $1 and company_id = $2 returning id",
[Number(e.params.id),e.ctx.companyId,t.target_minutes])).rows[0])throw $();a.json({ok:!0})}));ie.get("/queue",p("cozinha.operar"),l(async(e,a)=>{let t=[e.ctx.companyId],n=`i.compan\
y_id = $1 and i.sent_at is not null and i.kitchen_status <> 'nao_produz'
    and (i.kitchen_status in ('novo','aceito','preparando','pronto')
         or (i.kitchen_status = 'cancelado' and i.cancel_ack_at is null and i.accepted_at is not null)
         or (i.kitchen_status = 'cancelado' and i.cancel_ack_at is null and i.canceled_at > now() - interval '30 minutes'))`;e.query.sector_id&&(t.push(Number(e.query.sector_id)),n+=
` and i.sector_id = $${t.length}`);let o=e.ctx.terminalUnitId||e.ctx.unitId;o&&(t.push(o),n+=` and s.unit_id = $${t.length}`);let s=(await c(`select i.id, i.session_id, i.descripti\
on, i.qty, i.unit, i.modifiers, i.notes, i.kitchen_status, i.status, i.priority, i.sector_id,
            i.created_at, i.sent_at, i.accepted_at, i.ready_at, i.cancel_reason, i.canceled_at, i.launch_mode,
            s.kind, s.label, s.customer_name, c.number as card_number, t.number as table_number, d.number as delivery_number, d.mode as delivery_mode,
            ps.name as sector_name, ps.target_minutes, u.name as user_name,
            exists(select 1 from order_items o where o.session_id = i.session_id and o.id < i.id and o.sent_at < i.sent_at - interval '1 minute') as added_later
       from order_items i join consumption_sessions s on s.id = i.session_id
       left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join delivery_orders d on d.session_id = s.id left join production_sectors ps on ps.id = i.sector_id
       left join users u on u.id = i.user_id
      where ${n} order by i.priority desc, i.sent_at, i.id limit 400`,t)).rows,i=(await c("select coalesce(max(id),0)::bigint as id from kitchen_events where company_id = $1",[e.ctx.
companyId])).rows[0].id;a.json({now:new Date().toISOString(),last_event:i,items:s})}));ie.post("/items/:id/status",p("cozinha.operar"),l(async(e,a)=>{let t=w(ye.object({to:ye.enum(
["aceito","preparando","pronto","entregue"]),from:ye.string().optional()}),e.body),n=await v(async o=>{let s=(await o.query("select * from order_items where id = $1 and company_id \
= $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!s)throw $("Item n\xE3o encontrado");if(s.kitchen_status===t.to)return{ok:!0,replay:!0,status:s.kitchen_status};
if(s.status!=="ativo"||s.kitchen_status==="cancelado")throw g("Item cancelado: confirme a ci\xEAncia do cancelamento","item_canceled");if(!s.sent_at)throw g("Item ainda n\xE3o enviado\
 \xE0 produ\xE7\xE3o","not_sent");if(t.from&&t.from!==s.kitchen_status)throw g(`O item j\xE1 est\xE1 "${s.kitchen_status}" (alterado em outra tela)`,"status_changed",{status:s.kitchen_status});
let i=Et.indexOf(s.kitchen_status);if(Et.indexOf(t.to)<=i)throw g("N\xE3o \xE9 poss\xEDvel voltar a etapa anterior","invalid_transition");return await o.query(`update order_items s\
et kitchen_status = $2,
        accepted_at = coalesce(accepted_at, case when $2 in ('aceito','preparando','pronto','entregue') then now() end),
        ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
        delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`,[s.id,t.to]),await o.query("insert into kitchen_events (company_id, item_id, from_s\
tatus, to_status, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,s.id,s.kitchen_status,t.to,e.ctx.userId]),{ok:!0,status:t.to}});a.json(n)}));ie.post("/sessions/:id/advance",p(
"cozinha.operar"),l(async(e,a)=>{let t=w(ye.object({to:ye.enum(["aceito","preparando","pronto","entregue"]),sector_id:ye.number().int().optional()}),e.body),n=Et.indexOf(t.to),o=await v(
async s=>{let i=[Number(e.params.id),e.ctx.companyId,Et.slice(0,n)],r="";t.sector_id&&(i.push(t.sector_id),r=` and sector_id = $${i.length}`);let d=(await s.query(`select id, kitch\
en_status from order_items where session_id = $1 and company_id = $2 and status = 'ativo'
      and sent_at is not null and kitchen_status = any($3)${r} for update`,i)).rows;for(let u of d)await s.query(`update order_items set kitchen_status = $2, accepted_at = coalesce\
(accepted_at, now()),
          ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
          delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`,[u.id,t.to]),await s.query("insert into kitchen_events (company_id, item_id, from\
_status, to_status, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,u.id,u.kitchen_status,t.to,e.ctx.userId]);return{changed:d.length}});a.json(o)}));ie.post("/items/:id/ack-can\
cel",p("cozinha.operar"),l(async(e,a)=>{let t=await c("update order_items set cancel_ack_at = now() where id = $1 and company_id = $2 and kitchen_status = 'cancelado' and cancel_ac\
k_at is null returning id",[Number(e.params.id),e.ctx.companyId]);t.rows[0]&&await c("insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$\
2,$3,$4,$5)",[e.ctx.companyId,t.rows[0].id,"cancelado","cancelado_ciente",e.ctx.userId]),a.json({ok:!0})}));ie.post("/items/:id/priority",p("cozinha.operar"),l(async(e,a)=>{let t=w(
ye.object({priority:ye.boolean(),reason:ye.string().trim().min(3).max(200)}),e.body);J(e.ctx,"pdv.autorizar");let n=await c("update order_items set priority = $3 where id = $1 and \
company_id = $2 returning id, session_id",[Number(e.params.id),e.ctx.companyId,t.priority]);if(!n.rows[0])throw $();await h({query:c},e.ctx,"producao.prioridade",{entity:"item",entityId:n.
rows[0].id,reason:t.reason,data:{priority:t.priority}}),a.json({ok:!0})}));ie.get("/ready",p("pdv.lancar"),l(async(e,a)=>{a.json((await c(`select i.id, i.description, i.qty, i.read\
y_at, s.id as session_id, s.label, c.number as card_number, t.number as table_number
     from order_items i join consumption_sessions s on s.id = i.session_id left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
     where i.company_id = $1 and i.kitchen_status = 'pronto' and i.status = 'ativo' order by i.ready_at limit 100`,[e.ctx.companyId])).rows)}));ie.get("/stats",p("cozinha.operar"),
l(async(e,a)=>{let t=(await c(`select ps.name as sector, count(*)::int as items,
      round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::numeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
     from order_items i join production_sectors ps on ps.id = i.sector_id
    where i.company_id = $1 and i.ready_at is not null and i.sent_at > now() - interval '24 hours' group by ps.name order by ps.name`,[e.ctx.companyId])).rows;a.json(t)}));ie.get("\
/board",xa("pdv.lancar","cozinha.operar"),l(async(e,a)=>{let t=e.ctx.terminalUnitId||e.ctx.unitId,n=[e.ctx.companyId],o="";t&&(n.push(t),o=` and s.unit_id = $${n.length}`);let s=(await c(
`
    select s.id, s.kind, s.label, s.customer_name, c.number as card_number, t.number as table_number, d.number as delivery_number, d.mode as delivery_mode,
           count(*) filter (where i.kitchen_status in ('novo','aceito','preparando'))::int as pending,
           count(*) filter (where i.kitchen_status = 'pronto')::int as ready,
           min(i.sent_at) as sent_at, max(i.ready_at) as ready_at,
           coalesce(json_agg(json_build_object('d', i.description, 'q', i.qty, 's', i.kitchen_status) order by i.id), '[]') as items,
           (select max(e.created_at) from kitchen_events e join order_items i2 on i2.id = e.item_id where i2.session_id = s.id and e.to_status = 'chamado') as called_at
      from order_items i join consumption_sessions s on s.id = i.session_id
      left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id left join delivery_orders d on d.session_id = s.id
     where i.company_id = $1${o} and i.status = 'ativo' and i.sent_at is not null and i.kitchen_status in ('novo','aceito','preparando','pronto')
       and s.status in ('aberta','em_fechamento') and coalesce(d.status, '') not in ('saiu','entregue','cancelado')
     group by s.id, c.number, t.number, d.number, d.mode
     order by min(i.sent_at)
     limit 120`,n)).rows,i=d=>d?String(d).trim().split(/\s+/)[0]:null,r=(await c("select coalesce(max(id),0)::bigint as id from kitchen_events where company_id = $1",[e.ctx.companyId])).
rows[0].id;a.set("cache-control","no-store"),a.json({now:new Date().toISOString(),version:String(r),orders:s.map(d=>({id:d.id,code:d.delivery_number?`#${d.delivery_number}`:d.card_number?
String(d.card_number):d.table_number?String(d.table_number):String(d.id),kind:d.delivery_number?d.delivery_mode==="retirada"?"retirada":"delivery":d.card_number?"comanda":d.table_number?
"mesa":d.kind,table:d.card_number&&d.table_number?d.table_number:null,name:i(d.customer_name),status:d.ready>0?"pronto":"preparando",partial:d.pending>0&&d.ready>0,pending:d.pending,
ready_count:d.ready,sent_at:d.sent_at,ready_at:d.ready_at,called_at:d.called_at,items:d.items.map(u=>({d:u.d,q:Number(u.q),ready:u.s==="pronto"}))}))})}));ie.post("/sessions/:id/ca\
ll",xa("pdv.lancar","cozinha.operar"),l(async(e,a)=>{let t=(await c(`select id, kitchen_status from order_items where session_id = $1 and company_id = $2 and status = 'ativo' and s\
ent_at is not null
      and kitchen_status in ('novo','aceito','preparando','pronto') order by (kitchen_status = 'pronto') desc, id desc limit 1`,[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)
throw g("Este pedido n\xE3o est\xE1 mais no painel","nothing_to_call");let n=(await c("insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,\
$2,$3,'chamado',$4) returning created_at",[e.ctx.companyId,t.id,t.kitchen_status,e.ctx.userId])).rows[0];a.json({ok:!0,called_at:n.created_at})}));import{Router as Zo}from"npm:express@5.2.1";import{z as b}from"npm:zod@4.6.5";var pn=e=>String(e||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),_n=e=>pn(e).slice(0,120);async function ka(e){let a=(await c("select\
 key, value from company_secrets where company_id = $1 and key in ('ai_api_key','ai_model')",[e])).rows,t=(await c("select key, value from platform_config where key in ('anthropic_\
api_key','ai_model')").catch(()=>({rows:[]}))).rows,n=(o,s)=>o.find(i=>i.key===s)?.value;return{key:n(a,"ai_api_key")||P.ANTHROPIC_API_KEY||n(t,"anthropic_api_key")||null,model:n(a,
"ai_model")||P.AI_MODEL||n(t,"ai_model")||"claude-sonnet-5-5",url:P.AI_API_URL||"https://api.anthropic.com/v1/messages"}}async function ja(e){return!!(await ka(e)).key}var Jo=`Voc\xEA\
 l\xEA documentos de compra de bares e restaurantes no Brasil: nota fiscal (NF-e/DANFE, NFC-e, cupom), pedido de compra,
romaneio ou lista escrita \xE0 m\xE3o. Extraia SOMENTE o que est\xE1 escrito. Responda apenas com JSON v\xE1lido, sem texto antes ou depois, no formato:
{"supplier": string|null, "document": string|null, "date": "AAAA-MM-DD"|null, "total": number|null,
 "items": [{"description": string, "qty": number, "unit": string|null, "unit_price": number|null, "total": number|null}],
 "warnings": [string]}
Regras: n\xFAmeros com ponto decimal (12,50 \u2192 12.5); "unit" como est\xE1 na nota (UN, CX, KG, FD, PCT, L, GF...);
n\xE3o invente itens, pre\xE7os ou quantidades; se algo estiver ileg\xEDvel, deixe null e explique em "warnings";
ignore impostos, descontos gerais e totalizadores (eles n\xE3o s\xE3o itens).`;async function Ia(e,a){let t=await ka(e);if(!t.key)throw new N(503,"Leitura por foto n\xE3o configurada:\
 informe a chave da API em Estoque \u203A Leitura de notas, ou use o XML da NF-e.","ai_not_configured");let n=String(a).match(/^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
if(!n)throw new N(400,"Envie uma foto (JPG, PNG ou WEBP) ou PDF","invalid");let o={type:"base64",media_type:n[1],data:n[2]},s=n[1]==="application/pdf"?{type:"document",source:o}:{type:"\
image",source:o},i;try{i=await fetch(t.url,{method:"POST",signal:AbortSignal.timeout(6e4),headers:{"content-type":"application/json","x-api-key":t.key,"anthropic-version":"2023-06-\
01"},body:JSON.stringify({model:t.model,max_tokens:4e3,messages:[{role:"user",content:[s,{type:"text",text:Jo}]}]})})}catch(_){throw new N(502,`N\xE3o foi poss\xEDvel ler a foto agora (${String(
_.message||_).slice(0,80)}). Tente de novo.`,"ai_unavailable")}let r=await i.json().catch(()=>({}));if(!i.ok)throw new N(502,`Servi\xE7o de leitura recusou a foto: ${r?.error?.message?.
slice(0,160)||i.status}`,"ai_error");let d=(r.content||[]).filter(_=>_.type==="text").map(_=>_.text).join(""),u=d.slice(d.indexOf("{"),d.lastIndexOf("}")+1),m;try{m=JSON.parse(u)}catch{
throw new N(422,"N\xE3o consegui entender a foto. Tente outra mais n\xEDtida, com a nota inteira e bem iluminada.","ai_unreadable")}let y=_=>_==null||_===""||Number.isNaN(Number(_))?
null:Number(_);return{supplier:m.supplier?String(m.supplier).slice(0,100):null,document:m.document?String(m.document).slice(0,60):null,date:/^\d{4}-\d{2}-\d{2}$/.test(m.date||"")?m.
date:null,total:y(m.total),warnings:(m.warnings||[]).map(String).slice(0,10),items:(m.items||[]).filter(_=>_&&_.description).slice(0,150).map(_=>({description:String(_.description).
slice(0,120),qty:y(_.qty),unit:_.unit?String(_.unit).slice(0,10):null,unit_price:y(_.unit_price),total:y(_.total)}))}}var Wo={un:"un",und:"un",unid:"un",pc:"un",p\u00E7:"un",kg:"kg",
g:"g",gr:"g",l:"L",lt:"L",ml:"ml"},Ko=e=>Wo[pn(e)]||null;async function yn(e,a){let t=(await c("select id, name, unit from stock_items where company_id = $1 and active",[e])).rows,
n=Object.fromEntries((await c("select alias, stock_item_id, factor from stock_aliases where company_id = $1",[e])).rows.map(o=>[o.alias,o]));return a.map(o=>{let s=_n(o.description),
i=n[s];if(i&&t.find(m=>Number(m.id)===Number(i.stock_item_id)))return{...o,alias:s,stock_item_id:Number(i.stock_item_id),factor:Number(i.factor),match:"aprendido"};let r=s.split(" ").
filter(m=>m.length>2&&!/^\d+$/.test(m)),d=null,u=0;for(let m of t){let y=pn(m.name).split(" ").filter(x=>x.length>2);if(!y.length)continue;let j=y.filter(x=>r.some(S=>S.startsWith(
x)||x.startsWith(S))).length/y.length;j>u&&(u=j,d=m)}return{...o,alias:s,stock_item_id:u>.5?Number(d.id):null,factor:1,match:u>.5?"semelhante":"novo",suggested_unit:Ko(o.unit)||"un"}})}var R=Zo(),Xo=["un","kg","g","L","ml"],fn=b.number().positive().max(1e6);R.get("/items",p("estoque.visualizar"),l(async(e,a)=>{let t=(await c(`select s.*, (select coalesce(sum(qty)\
,0) from stock_movements m where m.stock_item_id = s.id)::float as balance,
      (select coalesce(-sum(qty),0) from stock_movements m where m.stock_item_id = s.id and m.kind = 'venda' and m.created_at > now() - interval '30 days')::float as used_30d
    from stock_items s where s.company_id = $1 ${e.query.all?"":"and s.active"} order by lower(s.name)`,[e.ctx.companyId])).rows,n=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.g\
erenciar");a.json(t.map(o=>({...o,avg_cost_cents:n?Number(o.avg_cost_cents):null,status:o.balance<=0?"zerado":o.balance<=Number(o.min_qty)?"baixo":"ok",suggest:Math.max(0,Math.ceil(
(Number(o.reorder_qty)||Number(o.min_qty)*2)+o.used_30d/30*7-o.balance))})))}));var za=b.object({name:b.string().trim().min(2).max(80),unit:b.enum(Xo),min_qty:b.number().min(0).max(
1e6).default(0),reorder_qty:b.number().min(0).max(1e6).default(0),active:b.boolean().default(!0)});R.post("/items",p("estoque.ajustar"),l(async(e,a)=>{let t=w(za.extend({initial_qty:b.
number().min(0).max(1e6).optional(),unit_cost_cents:b.number().int().min(0).max(1e8).optional()}),e.body),n=await v(async o=>{let s=await o.query("insert into stock_items (company_\
id, name, unit, min_qty, reorder_qty, active) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,t.name,t.unit,t.min_qty,t.reorder_qty,t.active]).catch(i=>{throw i.code==="2\
3505"?g("J\xE1 existe insumo com este nome"):i});return t.initial_qty&&await Xe(o,e.ctx,s.rows[0].id,t.initial_qty,t.unit_cost_cents||0,{type:"saldo_inicial"},"Saldo inicial"),await h(
o,e.ctx,"estoque.insumo_criado",{entity:"stock_item",entityId:s.rows[0].id,data:{name:t.name,initial:t.initial_qty}}),s.rows[0].id});a.status(201).json({id:n})}));R.put("/items/:id",
p("estoque.ajustar"),l(async(e,a)=>{let t=w(za.partial(),e.body);if(!(await c(`update stock_items set name = coalesce($3,name), unit = coalesce($4,unit), min_qty = coalesce($5,min_\
qty), reorder_qty = coalesce($6,reorder_qty),
      active = coalesce($7,active) where id = $1 and company_id = $2 returning id`,[Number(e.params.id),e.ctx.companyId,t.name??null,t.unit??null,t.min_qty??null,t.reorder_qty??null,
t.active??null])).rows[0])throw $("Insumo n\xE3o encontrado");a.json({ok:!0})}));R.get("/items/:id/movements",p("estoque.visualizar"),l(async(e,a)=>{a.json((await c(`select m.id, m\
.kind, m.qty::float, m.unit_cost_cents, m.ref_type, m.ref_id, m.reverses_id, m.reason, m.created_at, u.name as user_name
     from stock_movements m left join users u on u.id = m.user_id where m.company_id = $1 and m.stock_item_id = $2 order by m.id desc limit 200`,[e.ctx.companyId,Number(e.params.id)])).
rows)}));R.post("/movements",p("estoque.ajustar"),l(async(e,a)=>{let t=w(b.object({stock_item_id:b.number().int(),kind:b.enum(["entrada","perda","ajuste"]),qty:b.number().refine(o=>o!==
0&&Math.abs(o)<=1e6),unit_cost_cents:b.number().int().min(0).max(1e8).optional(),reason:b.string().trim().min(3).max(200)}),e.body),n=await v(async o=>{let s=(await o.query("select\
 * from stock_items where id = $1 and company_id = $2 for update",[t.stock_item_id,e.ctx.companyId])).rows[0];if(!s)throw $("Insumo n\xE3o encontrado");if(t.kind==="entrada"){if(t.
qty<=0)throw f("Entrada deve ser positiva");await Xe(o,e.ctx,s.id,t.qty,t.unit_cost_cents??Math.round(Number(s.avg_cost_cents)),{type:"manual"},t.reason)}else{let i=t.kind==="perda"?
-Math.abs(t.qty):t.qty;await o.query("insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6,$7)",[e.ctx.companyId,
s.id,t.kind,i,s.avg_cost_cents,t.reason,e.ctx.userId])}return await h(o,e.ctx,`estoque.${t.kind}`,{entity:"stock_item",entityId:s.id,reason:t.reason,data:{qty:t.qty}}),{balance:(await Ze(
o,e.ctx.companyId,[s.id]))[s.id]||0}});a.status(201).json(n)}));R.post("/movements/:id/reverse",p("estoque.ajustar"),l(async(e,a)=>{let t=w(b.object({reason:b.string().trim().min(3).
max(200)}),e.body),n=await v(async o=>{let s=(await o.query("select * from stock_movements where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!s)
throw $("Movimento n\xE3o encontrado");if(!["entrada","perda","ajuste"].includes(s.kind)||s.reverses_id)throw g("Este movimento \xE9 revertido pelo fluxo de origem (venda, compra ou i\
nvent\xE1rio)");return await o.query("insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reverses_id, reason, user_id) values ($1,$2,'reversao',$3,\
$4,$5,$6,$7)",[e.ctx.companyId,s.stock_item_id,-Number(s.qty),s.unit_cost_cents,s.id,t.reason,e.ctx.userId]).catch(i=>{throw i.code==="23505"?g("Movimento j\xE1 revertido"):i}),await h(
o,e.ctx,"estoque.reversao",{entity:"stock_movement",entityId:s.id,reason:t.reason}),{ok:!0}});a.json(n)}));R.get("/recipes",p("estoque.visualizar"),l(async(e,a)=>{let t=(await c(`s\
elect p.id, p.name, p.price_cents, p.cost_cents, p.stock_mode, p.stock_item_id, p.kind, si.name as stock_item_name,
      r.id as recipe_id, r.version, r.yield_qty::float
    from products p left join recipes r on r.product_id = p.id and r.active left join stock_items si on si.id = p.stock_item_id
    where p.company_id = $1 and p.active order by p.name`,[e.ctx.companyId])).rows,n=(await c(`select l.recipe_id, l.stock_item_id, l.qty::float, l.loss_pct::float, s.name, s.unit \
from recipe_lines l join stock_items s on s.id = l.stock_item_id
    where l.company_id = $1 and l.recipe_id = any($2)`,[e.ctx.companyId,t.map(i=>i.recipe_id).filter(Boolean)])).rows,o=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.gerenciar"),
s=[];for(let i of t){let r=o?await cn({query:c},e.ctx.companyId,i):null;s.push({...i,lines:n.filter(d=>d.recipe_id===i.recipe_id),theoretical_cost_cents:r,margin_pct:r!=null&&i.price_cents?
Math.round((i.price_cents-r)/i.price_cents*1e3)/10:null})}a.json(s)}));R.get("/recipes/:productId/history",p("estoque.visualizar"),l(async(e,a)=>{a.json((await c(`select r.id, r.ve\
rsion, r.yield_qty::float, r.active, r.created_at, u.name as user_name,
      (select json_agg(json_build_object('name', s.name, 'qty', l.qty, 'unit', s.unit, 'loss_pct', l.loss_pct)) from recipe_lines l join stock_items s on s.id = l.stock_item_id whe\
re l.recipe_id = r.id) as lines
    from recipes r left join users u on u.id = r.created_by where r.company_id = $1 and r.product_id = $2 order by r.version desc`,[e.ctx.companyId,Number(e.params.productId)])).rows)}));
R.put("/recipes/:productId",p("estoque.ajustar"),l(async(e,a)=>{let t=w(b.object({stock_mode:b.enum(["nenhum","ficha","acabado"]),stock_item_id:b.number().int().nullable().optional(),
yield_qty:b.number().positive().max(1e4).default(1),lines:b.array(b.object({stock_item_id:b.number().int(),qty:b.number().positive().max(1e5),loss_pct:b.number().min(0).max(99).default(
0)})).max(60).default([]),notes:b.string().max(300).optional()}),e.body),n=Number(e.params.productId),o=await v(async s=>{let i=(await s.query("select * from products where id = $1\
 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!i)throw $("Produto n\xE3o encontrado");let r=[...new Set([...t.lines.map(m=>m.stock_item_id),...t.stock_item_id?[
t.stock_item_id]:[]])];if(r.length&&(await s.query("select count(*)::int as n from stock_items where company_id = $1 and id = any($2)",[e.ctx.companyId,r])).rows[0].n!==r.length)throw f(
"Insumo inv\xE1lido");if(t.stock_mode==="acabado"&&!t.stock_item_id)throw f("Escolha o item de estoque do produto acabado");if(t.stock_mode==="ficha"&&!t.lines.length)throw f("A fi\
cha t\xE9cnica precisa de ao menos um insumo");if(new Set(t.lines.map(m=>m.stock_item_id)).size!==t.lines.length)throw f("Insumo repetido na ficha");await s.query("update products \
set stock_mode = $3, stock_item_id = $4, updated_at = now() where id = $1 and company_id = $2",[n,e.ctx.companyId,t.stock_mode,t.stock_mode==="acabado"?t.stock_item_id:null]);let d=null;
if(t.lines.length&&t.stock_mode!=="nenhum"){d=Number((await s.query("select coalesce(max(version),0) as v from recipes where product_id = $1",[n])).rows[0].v)+1,await s.query("upda\
te recipes set active = false where product_id = $1 and active",[n]);let m=await s.query("insert into recipes (company_id, product_id, version, yield_qty, notes, created_by) values\
 ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,n,d,t.yield_qty,t.notes??null,e.ctx.userId]);for(let y of t.lines)await s.query("insert into recipe_lines (company_id, recipe_id\
, stock_item_id, qty, loss_pct) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,m.rows[0].id,y.stock_item_id,y.qty,y.loss_pct])}else await s.query("update recipes set active = false wher\
e product_id = $1 and active",[n]);let u=await cn(s,e.ctx.companyId,{...i,stock_mode:t.stock_mode,stock_item_id:t.stock_mode==="acabado"?t.stock_item_id:null});return t.stock_mode!==
"nenhum"&&await s.query("update products set cost_cents = $3 where id = $1 and company_id = $2",[n,e.ctx.companyId,u]),await h(s,e.ctx,"estoque.ficha",{entity:"product",entityId:n,
data:{mode:t.stock_mode,version:d,lines:t.lines.length}}),{ok:!0,version:d,cost_cents:u}});a.json(o)}));R.get("/purchases",p("estoque.visualizar"),l(async(e,a)=>{let t=(await c(`se\
lect p.*, u.name as user_name,
      (select json_agg(json_build_object('id', l.id, 'stock_item_id', l.stock_item_id, 'name', s.name, 'unit', s.unit, 'qty', l.qty, 'received_qty', l.received_qty,
         'unit_cost_cents', l.unit_cost_cents) order by l.id) from purchase_lines l join stock_items s on s.id = l.stock_item_id where l.purchase_id = p.id) as lines
    from purchases p left join users u on u.id = p.created_by where p.company_id = $1 order by p.id desc limit 100`,[e.ctx.companyId])).rows;a.json(t)}));R.post("/purchases",p("com\
pras.gerenciar"),l(async(e,a)=>{let t=w(b.object({supplier:b.string().trim().min(2).max(100),document:b.string().trim().max(60).optional(),due_date:b.string().regex(/^\d{4}-\d{2}-\d{2}$/).
optional(),notes:b.string().max(300).optional(),lines:b.array(b.object({stock_item_id:b.number().int(),qty:fn,unit_cost_cents:b.number().int().min(0).max(1e8)})).min(1).max(100)}),
e.body),n=await v(async o=>{let s=[...new Set(t.lines.map(u=>u.stock_item_id))];if((await o.query("select count(*)::int as n from stock_items where company_id = $1 and id = any($2)",
[e.ctx.companyId,s])).rows[0].n!==s.length)throw f("Insumo inv\xE1lido");let r=t.lines.reduce((u,m)=>u+Math.round(m.qty*m.unit_cost_cents),0),d=await o.query("insert into purchases\
 (company_id, supplier, document, due_date, notes, total_cents, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",[e.ctx.companyId,t.supplier,t.document??null,t.due_date??null,
t.notes??null,r,e.ctx.userId]);for(let u of t.lines)await o.query("insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) values ($1,$2,$3,$4,$5)",
[e.ctx.companyId,d.rows[0].id,u.stock_item_id,u.qty,u.unit_cost_cents]);return await h(o,e.ctx,"compra.criada",{entity:"purchase",entityId:d.rows[0].id,data:{supplier:t.supplier,total_cents:r}}),
d.rows[0].id});a.status(201).json({id:n})}));R.post("/purchases/:id/receive",p("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({lines:b.array(b.object({line_id:b.number().int(),
qty:fn})).min(1).max(100)}),e.body),n=await v(async o=>{let s=(await o.query("select * from purchases where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).
rows[0];if(!s)throw $("Compra n\xE3o encontrada");if(["recebida","cancelada"].includes(s.status))throw g(`Compra ${s.status}`);for(let d of t.lines){let u=(await o.query("select * \
from purchase_lines where id = $1 and purchase_id = $2 for update",[d.line_id,s.id])).rows[0];if(!u)throw f("Linha inv\xE1lida");if(Number(u.received_qty)+d.qty>Number(u.qty)+1e-4)
throw f("Quantidade recebida maior que a comprada");await o.query("update purchase_lines set received_qty = received_qty + $2 where id = $1",[u.id,d.qty]),await Xe(o,e.ctx,u.stock_item_id,
d.qty,Number(u.unit_cost_cents),{type:"purchase",id:s.id},`Compra ${s.id} \u2014 ${s.supplier}`)}let r=(await o.query("select count(*)::int as n from purchase_lines where purchase_\
id = $1 and received_qty < qty",[s.id])).rows[0].n?"parcial":"recebida";return await o.query("update purchases set status = $2 where id = $1",[s.id,r]),await h(o,e.ctx,"compra.rece\
bida",{entity:"purchase",entityId:s.id,data:{status:r,lines:t.lines.length}}),{status:r}});a.json(n)}));R.post("/purchases/:id/cancel",p("compras.gerenciar"),l(async(e,a)=>{let t=w(
b.object({reason:b.string().trim().min(3).max(200)}),e.body),n=await c("update purchases set status = 'cancelada', notes = coalesce(notes,'') || ' [cancelada: ' || $3 || ']' where \
id = $1 and company_id = $2 and status = 'aberta' returning id",[Number(e.params.id),e.ctx.companyId,t.reason]);if(!n.rows[0])throw g("S\xF3 compras ainda n\xE3o recebidas podem ser canc\
eladas");await h({query:c},e.ctx,"compra.cancelada",{entity:"purchase",entityId:n.rows[0].id,reason:t.reason}),a.json({ok:!0})}));R.get("/inventories",p("estoque.visualizar"),l(async(e,a)=>{
a.json((await c(`select i.*, u.name as user_name, a.name as approved_name from inventory_counts i left join users u on u.id = i.created_by
    left join users a on a.id = i.approved_by where i.company_id = $1 order by i.id desc limit 30`,[e.ctx.companyId])).rows)}));R.post("/inventories",p("estoque.ajustar"),l(async(e,a)=>{
let t=w(b.object({counts:b.array(b.object({stock_item_id:b.number().int(),counted:b.number().min(0).max(1e6)})).min(1).max(500),notes:b.string().max(300).optional()}),e.body),n=await Ze(
{query:c},e.ctx.companyId,t.counts.map(r=>r.stock_item_id)),o=Object.fromEntries((await c("select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any\
($2)",[e.ctx.companyId,t.counts.map(r=>r.stock_item_id)])).rows.map(r=>[r.id,r])),s=t.counts.filter(r=>o[r.stock_item_id]).map(r=>{let d=Math.round((n[r.stock_item_id]||0)*1e3)/1e3,
u=Math.round((r.counted-d)*1e3)/1e3;return{stock_item_id:r.stock_item_id,name:o[r.stock_item_id].name,unit:o[r.stock_item_id].unit,system:d,counted:r.counted,diff:u,value_cents:Math.
round(u*Number(o[r.stock_item_id].avg_cost_cents))}}),i=await c("insert into inventory_counts (company_id, lines, notes, created_by) values ($1,$2,$3,$4) returning id",[e.ctx.companyId,
JSON.stringify(s),t.notes??null,e.ctx.userId]);a.status(201).json({id:i.rows[0].id,lines:s})}));R.post("/inventories/:id/approve",p("estoque.ajustar"),l(async(e,a)=>{J(e.ctx,"pdv.a\
utorizar");let t=await v(async n=>{let o=(await n.query("select * from inventory_counts where id = $1 and company_id = $2 and status = 'aberto' for update",[Number(e.params.id),e.ctx.
companyId])).rows[0];if(!o)throw g("Invent\xE1rio n\xE3o est\xE1 aberto");if(Number(o.created_by)===Number(e.ctx.userId)&&e.ctx.level<100)throw g("A aprova\xE7\xE3o deve ser feita por ou\
tra pessoa","same_user");let s=await Ze(n,e.ctx.companyId,o.lines.map(r=>r.stock_item_id)),i=0;for(let r of o.lines){let d=Math.round(((s[r.stock_item_id]||0)-r.system)*1e3)/1e3,u=Math.
round((r.counted+d-(s[r.stock_item_id]||0))*1e3)/1e3;Math.abs(u)<5e-4||(await n.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type,\
 ref_id, reason, user_id)
        select $1, id, 'inventario', $3, avg_cost_cents, 'inventory', $4, 'Invent\xE1rio aprovado', $5 from stock_items where id = $2 and company_id = $1`,[e.ctx.companyId,r.stock_item_id,
u,o.id,e.ctx.userId]),i++)}return await n.query("update inventory_counts set status = 'aprovado', approved_by = $2, approved_at = now() where id = $1",[o.id,e.ctx.userId]),await h(
n,e.ctx,"estoque.inventario_aprovado",{entity:"inventory",entityId:o.id,data:{adjustments:i}}),{adjustments:i}});a.json(t)}));R.post("/inventories/:id/discard",p("estoque.ajustar"),
l(async(e,a)=>{if(!(await c("update inventory_counts set status = 'descartado' where id = $1 and company_id = $2 and status = 'aberto' returning id",[Number(e.params.id),e.ctx.companyId])).
rows[0])throw g("Invent\xE1rio n\xE3o est\xE1 aberto");a.json({ok:!0})}));R.post("/produce",p("estoque.ajustar"),l(async(e,a)=>{let t=w(b.object({product_id:b.number().int(),qty:fn}),
e.body),n=await v(async o=>{let s=(await o.query("select * from products where id = $1 and company_id = $2",[t.product_id,e.ctx.companyId])).rows[0];if(!s)throw $("Produto n\xE3o enco\
ntrado");if(s.stock_mode!=="acabado")throw f("Produ\xE7\xE3o pr\xF3pria vale para produtos com estoque de produto acabado");if(!(await o.query("select id from recipes where product\
_id = $1 and active",[s.id])).rows[0])throw f("Cadastre a ficha de produ\xE7\xE3o (insumos) deste produto acabado antes de produzir");let r=await xt(o,e.ctx.companyId,{...s,stock_mode:"\
ficha"},t.qty),d=(await o.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2) for update",[e.ctx.companyId,[...r.keys()]])).rows,u=0;for(let m of d){
let y=r.get(Number(m.id));u+=y*Number(m.avg_cost_cents),await o.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason,\
 user_id)
        values ($1,$2,'producao_consumo',$3,$4,'production',$5,$6,$7)`,[e.ctx.companyId,m.id,-y,m.avg_cost_cents,s.id,`Produ\xE7\xE3o de ${t.qty} ${s.name}`,e.ctx.userId])}return await Xe(
o,e.ctx,s.stock_item_id,t.qty,Math.round(u/t.qty),{type:"production",id:s.id},`Produ\xE7\xE3o de ${s.name}`),await h(o,e.ctx,"estoque.producao",{entity:"product",entityId:s.id,data:{
qty:t.qty,cost_cents:Math.round(u)}}),{ok:!0,cost_cents:Math.round(u)}});a.json(n)}));R.get("/settings",p("estoque.visualizar"),l(async(e,a)=>{let t=(await c("select settings from \
companies where id = $1",[e.ctx.companyId])).rows[0];a.json(rn(t.settings))}));R.put("/settings",p("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(b.object({enabled:b.boolean(),allow_negative:b.
boolean()}),e.body);await c("update companies set settings = jsonb_set(settings, '{stock}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await h({query:c},e.ctx,"\
estoque.politica",{data:t}),a.json({ok:!0})}));R.get("/notes/status",p("compras.gerenciar"),l(async(e,a)=>{let t=(await c("select 1 from company_secrets where company_id = $1 and k\
ey = 'ai_api_key'",[e.ctx.companyId])).rows[0];a.json({photo:await ja(e.ctx.companyId),own_key:!!t})}));R.put("/notes/key",p("compras.gerenciar","configuracoes.gerenciar"),l(async(e,a)=>{
let t=w(b.object({api_key:b.string().trim().max(300)}),e.body);if(t.api_key&&!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(t.api_key))throw f('Chave inv\xE1lida: ela come\xE7a com "sk-ant-"');
t.api_key?await c("insert into company_secrets (company_id, key, value) values ($1,'ai_api_key',$2) on conflict (company_id, key) do update set value = excluded.value, updated_at =\
 now()",[e.ctx.companyId,t.api_key]):await c("delete from company_secrets where company_id = $1 and key = 'ai_api_key'",[e.ctx.companyId]),await h({query:c},e.ctx,"estoque.leitura_\
chave",{data:{removed:!t.api_key}}),a.json({ok:!0})}));R.post("/notes/read",p("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({image:b.string().max(9e6)}),e.body);await oe(`no\
tes:${e.ctx.companyId}`,60,3600);let n=await Ia(e.ctx.companyId,t.image);a.json({...n,items:await yn(e.ctx.companyId,n.items)})}));R.post("/notes/match",p("compras.gerenciar"),l(async(e,a)=>{
let t=w(b.object({items:b.array(b.object({description:b.string().max(120),qty:b.number().nullable().optional(),unit:b.string().max(10).nullable().optional(),unit_price:b.number().nullable().
optional(),total:b.number().nullable().optional()})).max(300)}),e.body);a.json({items:await yn(e.ctx.companyId,t.items)})}));R.post("/notes/confirm",p("compras.gerenciar"),l(async(e,a)=>{
let t=w(b.object({supplier:b.string().trim().min(2).max(100),document:b.string().trim().max(60).optional().nullable(),due_date:b.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
source:b.enum(["foto","xml","manual"]),nfe_key:b.string().regex(/^\d{44}$/).optional().nullable(),receive:b.boolean().default(!0),lines:b.array(b.object({description:b.string().max(
120),alias:b.string().max(120).optional(),stock_item_id:b.number().int().optional().nullable(),new_item:b.object({name:b.string().trim().min(2).max(80),unit:b.enum(["un","kg","g","\
L","ml"]),min_qty:b.number().min(0).max(1e6).default(0)}).optional().nullable(),qty:b.number().positive().max(1e6),factor:b.number().positive().max(1e4).default(1),unit_cost_cents:b.
number().int().min(0).max(1e8)})).min(1).max(150)}),e.body),n=await v(async o=>{if(t.nfe_key){let d=(await o.query("select id from purchases where company_id = $1 and nfe_key = $2 \
and status <> 'cancelada'",[e.ctx.companyId,t.nfe_key])).rows[0];if(d)throw g(`Esta NF-e j\xE1 foi lan\xE7ada (compra #${d.id})`,"nfe_duplicate")}let s=[];for(let d of t.lines){let u=d.
stock_item_id;if(!u&&d.new_item&&(u=(await o.query("select id from stock_items where company_id = $1 and lower(name) = lower($2)",[e.ctx.companyId,d.new_item.name])).rows[0]?.id??(await o.
query("insert into stock_items (company_id, name, unit, min_qty, reorder_qty) values ($1,$2,$3,$4,$5) returning id",[e.ctx.companyId,d.new_item.name,d.new_item.unit,d.new_item.min_qty,
d.new_item.min_qty*3])).rows[0].id),!u)throw f(`Escolha o insumo de "${d.description}" ou marque para criar`);if(!(await o.query("select 1 from stock_items where id = $1 and compan\
y_id = $2",[u,e.ctx.companyId])).rows[0])throw f("Insumo inv\xE1lido");s.push({...d,stock_item_id:Number(u),stock_qty:Math.round(d.qty*d.factor*1e3)/1e3,stock_cost:Math.round(d.unit_cost_cents/
d.factor)})}let i=t.lines.reduce((d,u)=>d+Math.round(u.qty*u.unit_cost_cents),0),r=(await o.query(`insert into purchases (company_id, supplier, document, due_date, total_cents, cre\
ated_by, source, nfe_key, notes)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[e.ctx.companyId,t.supplier,t.document??null,t.due_date??null,i,e.ctx.userId,t.source,t.nfe_key??null,{foto:"Lan\xE7ada pela fo\
to da nota (conferida)",xml:"Importada do XML da NF-e",manual:"Nota/pedido digitado manualmente"}[t.source]])).rows[0];for(let d of s){let u=(await o.query("insert into purchase_li\
nes (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) values ($1,$2,$3,$4,$5) returning id",[e.ctx.companyId,r.id,d.stock_item_id,d.stock_qty,d.stock_cost])).rows[0];t.
receive&&(await o.query("update purchase_lines set received_qty = qty where id = $1",[u.id]),await Xe(o,e.ctx,d.stock_item_id,d.stock_qty,d.stock_cost,{type:"purchase",id:r.id},`Co\
mpra ${r.id} \u2014 ${t.supplier}`));let m=_n(d.alias||d.description);m&&await o.query(`insert into stock_aliases (company_id, alias, stock_item_id, factor) values ($1,$2,$3,$4)
        on conflict (company_id, alias) do update set stock_item_id = excluded.stock_item_id, factor = excluded.factor, updated_at = now()`,[e.ctx.companyId,m,d.stock_item_id,d.factor])}
return t.receive&&await o.query("update purchases set status = 'recebida' where id = $1",[r.id]),await h(o,e.ctx,"compra.nota_lancada",{entity:"purchase",entityId:r.id,data:{source:t.
source,lines:s.length,total_cents:i,received:t.receive}}),{purchase_id:r.id,lines:s.length,total_cents:i,received:t.receive}}).catch(o=>{throw o.code==="23505"?g("Esta NF-e j\xE1 foi \
lan\xE7ada","nfe_duplicate"):o});a.status(201).json(n)}));import{Router as Yo}from"npm:express@5.2.1";import{z as qt}from"npm:zod@4.6.5";var At=Yo(),Sa=e=>{let a=w(qt.object({from:qt.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:qt.string().regex(/^\d{4}-\d{2}-\d{2}$/),unit_id:qt.coerce.number().int().optional()}),e);if(a.
from>a.to)throw f("Data inicial depois da final");if((new Date(a.to)-new Date(a.from))/864e5>400)throw f("Per\xEDodo m\xE1ximo de 400 dias");return a};async function Na(e,a){let t=e.
can("financeiro.visualizar"),n=e.can("relatorios.cmv"),o=e.company.timezone,s=[e.companyId,a.from,a.to],i="";a.unit_id&&(s.push(a.unit_id),i=` and s.unit_id = $${s.length}`);let r=`\
s.company_id = $1 and s.business_date between $2 and $3${i}`,d=`${r} and s.status = 'encerrada'`,u=`from order_items i join consumption_sessions s on s.id = i.session_id where ${d}\
 and i.status = 'ativo'`,m=(await c(`with x as (
      select s.id, s.service_fee_bp, s.delivery_fee_cents, (select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo') as items
      from consumption_sessions s where ${d})
    select count(*)::int as sessions, coalesce(sum(items),0)::bigint as items_cents,
      coalesce(sum(round(items * service_fee_bp / 10000.0)),0)::bigint as service_fee_cents, coalesce(sum(delivery_fee_cents),0)::bigint as delivery_fee_cents from x`,s)).rows[0],y=Number(
m.items_cents)+Number(m.service_fee_cents)+Number(m.delivery_fee_cents),_=(await c(`select p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total, coalesce(\
sum(p.change_cents),0)::bigint as change
    from payments p join consumption_sessions s on s.id = p.session_id where p.company_id = $1 and p.business_date between $2 and $3${i} and p.status = 'confirmado' group by p.meth\
od order by total desc`,s)).rows,j=(await c(`select count(*)::int as n, coalesce(sum((select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status \
= 'ativo')
      - (select coalesce(sum(amount_cents),0) from payments p where p.session_id = s.id and p.status = 'confirmado')),0)::bigint as balance
    from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')${a.unit_id?" and s.unit_id = $2":""}`,a.unit_id?[e.companyId,a.unit_id]:[e.companyId])).
rows[0],x=(await c(`select s.business_date as day, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u} group by 1 order by 1`,s)).rows,
S=(await c(`select extract(hour from i.created_at at time zone '${o.replace(/'/g,"")}')::int as hour, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u}\
 group by 1 order by 1`,s)).rows,A=(await c(`select i.product_id, max(i.description) as name, max(c.name) as category, sum(i.qty)::float as qty, sum(i.total_cents)::bigint as items\
_cents,
      sum(coalesce((select -sum(m.qty * m.unit_cost_cents) from stock_movements m where m.ref_type = 'order_item' and m.ref_id = i.id and m.kind = 'venda'),
        p.cost_cents * i.qty))::bigint as cost_cents
    ${u.replace("where","join products p on p.id = i.product_id left join categories c on c.id = p.category_id where")} group by i.product_id order by items_cents desc`,s)).rows,D=Object.
values(A.reduce((z,me)=>{let tt=me.category||"Sem categoria";return z[tt]||={name:tt,qty:0,items_cents:0,cost_cents:0},z[tt].qty+=me.qty,z[tt].items_cents+=Number(me.items_cents),z[tt].
cost_cents+=Number(me.cost_cents),z},{})).sort((z,me)=>me.items_cents-z.items_cents),L=A.reduce((z,me)=>z+Number(me.items_cents),0)||1,U=0;for(let z of A)U+=Number(z.items_cents),z.
abc=U/L<=.8?"A":U/L<=.95?"B":"C";let fe=(await c(`select u.name, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u.replace("where","left join users \
u on u.id = i.user_id where")} group by u.name order by items_cents desc`,s)).rows,we=(await c(`select t.number, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),\
0)::bigint as items_cents,
      round(avg(extract(epoch from (s.closed_at - s.opened_at)) / 60)::numeric)::int as avg_minutes
    ${u.replace("where","join dining_tables t on t.id = s.table_id where")} group by t.number order by t.number`,s)).rows,V=(await c(`select s.kind as channel, count(distinct s.id)\
::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u} group by 1 order by 3 desc`,s)).rows,ne=(await c(`select coalesce(tm.name, 'Sem terminal') as name, co\
unt(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u.replace("where","left join terminals tm on tm.id = i.terminal_id where")} group by 1 order by 3 desc`,
s)).rows,ze=(await c(`select i.launch_mode, count(*)::int as n from order_items i join consumption_sessions s on s.id = i.session_id where ${r} group by 1`,s)).rows,he=(await c(`se\
lect
      count(*) filter (where i.status = 'cancelado')::int as canceled_items, coalesce(sum(i.total_cents) filter (where i.status = 'cancelado'),0)::bigint as canceled_cents,
      coalesce(sum(i.discount_cents) filter (where i.status = 'ativo'),0)::bigint as discounts_cents, count(*) filter (where i.discount_cents > 0)::int as discounted_items
    from order_items i join consumption_sessions s on s.id = i.session_id where ${r}`,s)).rows[0],yt=(await c(`select action, count(*)::int as n from audit_events where company_id \
= $1 and created_at >= $2::date and created_at < $3::date + 1
      and action in ('consumo.reaberto','consumo.cancelado','pdv.itens_transferidos','pdv.mesa_trocada','autorizacao.concedida','autorizacao.negada','leitura.desconhecida','pdv.exc\
ecao_manual','pagamento.estornado','pdv.taxa_servico')
    group by action`,[e.companyId,a.from,a.to])).rows,Ma=(await c(`select ps.name as sector, count(*)::int as items, round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::n\
umeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
    from order_items i join consumption_sessions s on s.id = i.session_id join production_sectors ps on ps.id = i.sector_id
    where ${r} and i.ready_at is not null and i.sent_at is not null group by ps.name order by ps.name`,s)).rows,La=(await c(`select count(*)::int as orders, count(*) filter (where \
d.status = 'cancelado')::int as canceled,
      round(avg(extract(epoch from (e.created_at - d.created_at)) / 60)::numeric)::int as avg_minutes_to_deliver
    from delivery_orders d join consumption_sessions s on s.id = d.session_id
    left join lateral (select created_at from delivery_events where order_id = d.id and status = 'entregue' order by id limit 1) e on true where ${r}`,s)).rows[0],Ua=(await c(`sele\
ct coalesce(sum(-m.qty * m.unit_cost_cents) filter (where m.kind = 'perda'),0)::bigint as losses_cents,
      coalesce(sum(m.qty * m.unit_cost_cents) filter (where m.kind = 'inventario'),0)::bigint as inventory_diff_cents
    from stock_movements m where m.company_id = $1 and m.created_at >= $2::date and m.created_at < $3::date + 1`,[e.companyId,a.from,a.to])).rows[0],Fa=(await c(`select count(disti\
nct s.customer_id)::int as identified,
      count(distinct s.customer_id) filter (where exists (select 1 from consumption_sessions o where o.customer_id = s.customer_id and o.status = 'encerrada' and o.business_date < \
$2))::int as returning
    from consumption_sessions s where ${d} and s.customer_id is not null`,s)).rows[0],Ba=(await c(`select coalesce(sum(points) filter (where kind = 'ganho'),0)::int as earned, coal\
esce(-sum(points) filter (where kind = 'resgate'),0)::int as redeemed
    from loyalty_ledger where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1`,[e.companyId,a.from,a.to])).rows[0],Va=(await c("select count(*)::int as n, \
round(avg(score)::numeric, 2)::float as average from reviews where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1",[e.companyId,a.from,a.to])).rows[0],Ha=t?
(await c(`select count(*)::int as sessions, coalesce(sum(difference_cents),0)::bigint as difference_cents,
      count(*) filter (where difference_cents <> 0)::int as with_difference from cash_sessions where company_id = $1 and business_date between $2 and $3 and status = 'fechado'`,[e.
companyId,a.from,a.to])).rows[0]:null,Ut=t?(await c(`select m.kind, coalesce(sum(m.amount_cents),0)::bigint as total from cash_movements m join cash_sessions c on c.id = m.cash_ses\
sion_id
      where m.company_id = $1 and c.business_date between $2 and $3 group by m.kind`,[e.companyId,a.from,a.to])).rows:null,et=A.reduce((z,me)=>z+Number(me.cost_cents),0),K=z=>t?z:null;
if(!n)for(let z of[...A,...D])delete z.cost_cents;let Ga=_.reduce((z,me)=>z+Number(me.total),0),Ja=t&&n?{receita_bruta:y,taxa_servico:Number(m.service_fee_cents),taxa_entrega:Number(
m.delivery_fee_cents),cmv:et,lucro_bruto:Number(m.items_cents)-et,despesas_caixa:Number(Ut?.find(z=>z.kind==="despesa")?.total||0),resultado:Number(m.items_cents)-et-Number(Ut?.find(
z=>z.kind==="despesa")?.total||0)}:null;return{period:{from:a.from,to:a.to},permissions:{financial:t,cmv:n},summary:{sessions:m.sessions,revenue_cents:K(y),items_cents:K(Number(m.items_cents)),
service_fee_cents:K(Number(m.service_fee_cents)),delivery_fee_cents:K(Number(m.delivery_fee_cents)),received_cents:K(Ga),ticket_cents:K(m.sessions?Math.round(y/m.sessions):0),open_sessions:j.
n,open_balance_cents:K(Number(j.balance)),cmv_cents:n?et:null,margin_pct:n&&Number(m.items_cents)?Math.round((Number(m.items_cents)-et)/Number(m.items_cents)*1e3)/10:null},by_day:x.
map(z=>({...z,items_cents:K(Number(z.items_cents))})),by_hour:S.map(z=>({...z,items_cents:K(Number(z.items_cents))})),by_product:A.map(z=>({...z,items_cents:K(Number(z.items_cents))})),
by_category:D.map(z=>({...z,items_cents:K(z.items_cents)})),by_user:fe.map(z=>({...z,items_cents:K(Number(z.items_cents))})),by_table:we.map(z=>({...z,items_cents:K(Number(z.items_cents))})),
by_channel:V.map(z=>({...z,items_cents:K(Number(z.items_cents))})),by_terminal:ne.map(z=>({...z,items_cents:K(Number(z.items_cents))})),payments:t?_:null,cash:Ha,movements:Ut,dre:Ja,
control:{...he,canceled_cents:K(Number(he.canceled_cents)),discounts_cents:K(Number(he.discounts_cents)),launch_modes:Object.fromEntries(ze.map(z=>[z.launch_mode,z.n])),events:Object.
fromEntries(yt.map(z=>[z.action,z.n]))},kitchen:Ma,delivery:La,stock:n?Ua:null,customers:{...Fa,loyalty:Ba,reviews:Va}}}At.get("/overview",p("relatorios.visualizar"),l(async(e,a)=>{
a.json(await Na(e.ctx,Sa(e.query)))}));var Qo={produtos:["by_product",[["name","Produto"],["category","Categoria"],["qty","Quantidade"],["items_cents","Vendido (R$)"],["cost_cents",
"CMV (R$)"],["abc","Curva ABC"]]],dias:["by_day",[["day","Dia comercial"],["sessions","Consumos"],["items_cents","Vendido (R$)"]]],horas:["by_hour",[["hour","Hora"],["items","Itens"],
["items_cents","Vendido (R$)"]]],garcons:["by_user",[["name","Usu\xE1rio"],["items","Itens"],["items_cents","Vendido (R$)"]]],mesas:["by_table",[["number","Mesa"],["sessions","Cons\
umos"],["items_cents","Vendido (R$)"],["avg_minutes","Perman\xEAncia m\xE9dia (min)"]]],pagamentos:["payments",[["method","Forma"],["n","Quantidade"],["total","Total (R$)"]]]};At.get(
"/export",p("relatorios.visualizar"),l(async(e,a)=>{let t=Sa(e.query),n=Qo[e.query.section];if(!n)throw f("Se\xE7\xE3o inv\xE1lida");let s=(await Na(e.ctx,t))[n[0]]||[],i=n[1].filter(
([u])=>s.some(m=>m[u]!==void 0&&m[u]!==null)),r=(u,m)=>/cents|^total$/.test(u)&&m!=null?(Number(m)/100).toFixed(2).replace(".",","):m,d=[i.map(([,u])=>u).join(";"),...s.map(u=>i.map(
([m])=>Be(r(m,u[m]))).join(";"))];await h({query:c},e.ctx,"relatorio.exportado",{data:{section:e.query.section,...t}}),a.setHeader("content-type","text/csv; charset=utf-8"),a.setHeader(
"content-disposition",`attachment; filename="rusten-${e.query.section}-${t.from}-${t.to}.csv"`),a.send(`\uFEFF${d.join(`
`)}`)}));import{Router as as}from"npm:express@5.2.1";import{z as E}from"npm:zod@4.6.5";import es from"node:crypto";var Le=e=>({enabled:!1,accepting:!0,delivery:!0,pickup:!0,fee_cents:0,min_order_cents:0,eta_minutes:45,hours:"",areas:"",payment_methods:["dinheiro","pix","cartao"],message:"",...e?.
delivery||{}}),Ca={recebido:["confirmado","cancelado"],confirmado:["em_preparo","pronto","cancelado"],em_preparo:["pronto","cancelado"],pronto:["saiu","entregue","cancelado"],saiu:[
"entregue","cancelado"],entregue:[],cancelado:[]},Oe={recebido:"Recebido",confirmado:"Confirmado",em_preparo:"Em preparo",pronto:"Pronto",saiu:"Saiu para entrega",entregue:"Entregu\
e",cancelado:"Cancelado"},ts=e=>({companyId:e,userId:null,unitId:null,terminalId:null,level:0,can:a=>["pdv.abrir_comanda","delivery.gerenciar"].includes(a)});async function wn(e,a,t,{
channel:n="delivery"}={}){if(!Array.isArray(t)||!t.length)throw f("Carrinho vazio");let o=[...new Set(t.map(r=>Number(r.product_id)))],s=Object.fromEntries((await e.query("select *\
 from products where company_id = $1 and id = any($2)",[a,o])).rows.map(r=>[r.id,r])),i=[];for(let r of t){let d=s[Number(r.product_id)];if(!d||!d.active)throw g(`Produto indispon\xED\
vel${d?`: ${d.name}`:""}`,"product_unavailable");if(n!=="interno"&&!d.channels.includes("delivery")&&!d.channels.includes("cardapio_digital"))throw g(`${d.name} n\xE3o est\xE1 dispon\xEDvel\
 para delivery`,"product_unavailable");if(d.kind==="weight")throw g(`${d.name} \xE9 vendido por peso e n\xE3o pode ser pedido online`,"product_unavailable");let u=Number(r.qty);if(!Number.
isInteger(u)||u<1||u>50)throw f("Quantidade inv\xE1lida");let m=(r.option_ids||[]).map(Number),y=(await e.query(`select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active where g.product_id = $1 group by g.id order by g.sort, g.id`,[d.id])).rows,_=[];for(let x of y){
let S=x.options.filter(A=>m.includes(A.id));if(S.length<x.min_select)throw f(`${d.name}: escolha ${x.min_select} em "${x.name}"`,"options_required");if(S.length>x.max_select)throw f(
`${d.name}: no m\xE1ximo ${x.max_select} em "${x.name}"`);for(let A of S)_.push({group:x.name,id:A.id,name:A.name,price_cents:A.price_cents})}if(_.length!==new Set(m).size)throw f(
"Op\xE7\xE3o inv\xE1lida");let j=_.reduce((x,S)=>x+S.price_cents,0);i.push({product:d,qty:u,chosen:_,mods:j,notes:r.notes?String(r.notes).slice(0,140):null,total:nt(d.price_cents,u,
j,0)})}return{lines:i,subtotal:i.reduce((r,d)=>r+d.total,0)}}async function Qe(e,a,t,n){let o=(await e.query("select id, name, settings from companies where id = $1",[a])).rows[0];
if(!o)throw $();let s=Le(o.settings),i=t.channel==="telefone"||t.channel==="balcao";if(!i&&(!s.enabled||!s.accepting))throw g("O estabelecimento n\xE3o est\xE1 recebendo pedidos agora",
"closed");if(t.mode==="entrega"&&!s.delivery)throw f("Entrega indispon\xEDvel: escolha retirada");if(t.mode==="retirada"&&!s.pickup)throw f("Retirada indispon\xEDvel");if(t.mode===
"entrega"&&(!t.address?.street||!t.address?.number))throw f("Informe rua e n\xFAmero para entrega");let r=se(t.phone);if(r.length<10)throw f("Telefone com DDD \xE9 obrigat\xF3rio");
let d=(await e.query("select id, public_token, number from delivery_orders where company_id = $1 and client_key = $2",[a,t.client_key])).rows[0];if(d)return{replay:!0,...d};let{lines:u,
subtotal:m}=await wn(e,a,t.cart,{channel:i?"interno":"delivery"});if(!i&&m<s.min_order_cents)throw f(`Pedido m\xEDnimo de R$ ${(s.min_order_cents/100).toFixed(2).replace(".",",")}`,
"min_order");let y=t.mode==="entrega"?s.fee_cents:0,_=(await e.query("select id from customers where company_id = $1 and anonymized_at is null and regexp_replace(coalesce(phone,'')\
,'\\D','','g') = $2 limit 1",[a,r])).rows[0],j=n||ts(a),x=Number((await e.query("select coalesce(max(number),0)+1 as n from delivery_orders where company_id = $1",[a])).rows[0].n),
S=await un(e,{...j,companyId:a},{kind:"delivery",label:`Delivery #${x}`,customer_name:t.customer_name,customer_id:_?.id,delivery_fee_cents:y});for(let[L,U]of u.entries()){let fe=(await e.
query(`insert into order_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents,
         total_cents, notes, sector_id, kitchen_status, launch_mode, user_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,'delivery',$14,$15) returning *`,[a,S.id,U.product.id,U.product.name,U.qty,U.product.unit,U.product.price_cents,JSON.stringify(
U.chosen),U.mods,U.total,U.notes,U.product.sector_id,U.product.sector_id?"novo":"nao_produz",j.userId,`dlv${S.id}x${L}`])).rows[0];await kt(e,{...j,companyId:a},fe,U.product,U.chosen.
map(we=>we.id))}let A=te(18),D=(await e.query(`insert into delivery_orders (company_id, unit_id, session_id, number, public_token, channel, mode, customer_id, customer_name, phone,\
 address,
       payment_hint, change_for_cents, notes, eta_minutes, client_key, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,[a,S.unit_id,S.id,x,A,t.channel,t.mode,_?.id??null,t.customer_name,r,t.address||{},t.payment_hint??
null,t.change_for_cents??null,t.notes??null,s.eta_minutes,t.client_key,i?"confirmado":"recebido"])).rows[0];return i&&await e.query("update order_items set sent_at = now() where se\
ssion_id = $1 and kitchen_status = 'novo'",[S.id]),await e.query("insert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",[a,D.id,D.status,
j.userId,`Pedido via ${t.channel}`]),{...D,subtotal:m,fee:y,total:m+y}}var ns=()=>st("review-link"),Ot=e=>`${e}.${es.createHmac("sha256",ns()).update(String(e)).digest("base64url").
slice(0,16)}`;function hn(e){let[a,t]=String(e||"").split(".");return!/^\d+$/.test(a||"")||!t?null:Ot(a)===`${a}.${t}`?Number(a):null}var ve=as(),os=e=>String(e).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40)||"loja";ve.get("/settings",p("delivery\
.gerenciar"),l(async(e,a)=>{let t=(await c("select slug, name, settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json({slug:t.slug,suggested_slug:t.slug||os(t.name),
...Le(t.settings)})}));ve.put("/settings",p("delivery.gerenciar","configuracoes.gerenciar"),l(async(e,a)=>{let t=w(E.object({slug:E.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
"use letras min\xFAsculas, n\xFAmeros e h\xEDfen (3 a 40)"),enabled:E.boolean(),accepting:E.boolean(),delivery:E.boolean(),pickup:E.boolean(),fee_cents:E.number().int().min(0).max(
1e5),min_order_cents:E.number().int().min(0).max(1e6),eta_minutes:E.number().int().min(5).max(300),hours:E.string().max(300).default(""),areas:E.string().max(500).default(""),message:E.
string().max(300).default(""),payment_methods:E.array(E.enum(["dinheiro","pix","cartao"])).min(1)}),e.body);if(!t.delivery&&!t.pickup)throw f("Habilite entrega, retirada ou ambos");
let{slug:n,...o}=t;await v(async s=>{if((await s.query("select 1 from companies where slug = $1 and id <> $2",[n,e.ctx.companyId])).rows[0])throw g("Este endere\xE7o j\xE1 est\xE1 em uso po\
r outra empresa","slug_taken");await s.query("update companies set slug = $2, settings = jsonb_set(settings, '{delivery}', $3::jsonb) where id = $1",[e.ctx.companyId,n,JSON.stringify(
o)]),await h(s,e.ctx,"delivery.configuracao",{data:{slug:n,...o}})}),a.json({ok:!0})}));ve.get("/orders",p("delivery.gerenciar"),l(async(e,a)=>{let t=[e.ctx.companyId],n="d.company\
_id = $1";e.query.status==="abertos"?n+=" and d.status not in ('entregue','cancelado')":e.query.status==="hoje"&&(n+=" and d.created_at > now() - interval '24 hours'"),e.ctx.can("d\
elivery.gerenciar")||(t.push(e.ctx.userId),n+=` and d.courier_id = $${t.length}`);let o=(await c(`select d.*, u.name as courier_name, s.status as session_status,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') as items_cents,
      (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = d.session_id and p.status = 'confirmado') as paid_cents,
      s.delivery_fee_cents,
      (select json_agg(json_build_object('description', i.description, 'qty', i.qty, 'modifiers', i.modifiers, 'notes', i.notes, 'kitchen_status', i.kitchen_status, 'status', i.sta\
tus) order by i.id)
         from order_items i where i.session_id = d.session_id) as items
    from delivery_orders d join consumption_sessions s on s.id = d.session_id left join users u on u.id = d.courier_id
    where ${n} order by case when d.status in ('entregue','cancelado') then 1 else 0 end, d.created_at desc limit 200`,t)).rows;a.json(o)}));ve.get("/my",p("delivery.entregar"),l(async(e,a)=>{
a.json((await c(`select d.id, d.number, d.status, d.customer_name, d.phone, d.address, d.payment_hint, d.change_for_cents, d.notes,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') + s.delivery_fee_cents as total_cents
    from delivery_orders d join consumption_sessions s on s.id = d.session_id where d.company_id = $1 and d.courier_id = $2 and d.status in ('pronto','saiu') order by d.id`,[e.ctx.
companyId,e.ctx.userId])).rows)}));var ss=E.object({mode:E.enum(["entrega","retirada"]),channel:E.enum(["telefone","balcao"]).default("telefone"),customer_name:E.string().trim().min(
2).max(80),phone:E.string().trim().min(10).max(20),address:E.object({street:E.string().max(120),number:E.string().max(20),district:E.string().max(80).optional(),complement:E.string().
max(80).optional(),reference:E.string().max(120).optional()}).partial().optional(),payment_hint:E.enum(["dinheiro","pix","cartao"]).optional(),change_for_cents:E.number().int().min(
0).max(1e7).optional(),notes:E.string().max(300).optional(),cart:E.array(E.object({product_id:E.number().int(),qty:E.number().int().min(1).max(50),option_ids:E.array(E.number().int()).
max(40).default([]),notes:E.string().max(140).optional()})).min(1).max(60),client_key:E.string().regex(/^[A-Za-z0-9_-]{8,80}$/)});ve.post("/orders",p("delivery.gerenciar"),l(async(e,a)=>{
let t=w(ss,e.body),n=await v(o=>Qe(o,e.ctx.companyId,t,e.ctx));await h({query:c},e.ctx,"delivery.pedido_interno",{entity:"delivery",entityId:n.id,data:{number:n.number,mode:t.mode}}),
a.status(n.replay?200:201).json(n)}));ve.post("/orders/:id/status",l(async(e,a)=>{let t=w(E.object({to:E.enum(["confirmado","em_preparo","pronto","saiu","entregue","cancelado"]),reason:E.
string().trim().max(200).optional(),proof:E.string().trim().max(200).optional(),eta_minutes:E.number().int().min(5).max(300).optional()}),e.body),n=await v(async o=>{let s=(await o.
query("select * from delivery_orders where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!s)throw $("Pedido n\xE3o encontrado");if(["sa\
iu","entregue"].includes(t.to)&&!e.ctx.can("delivery.gerenciar")){if(J(e.ctx,"delivery.entregar"),Number(s.courier_id)!==Number(e.ctx.userId))throw g("Pedido atribu\xEDdo a outro entr\
egador")}else J(e.ctx,"delivery.gerenciar");if(s.status===t.to)return{ok:!0,replay:!0};if(!Ca[s.status].includes(t.to))throw g(`N\xE3o \xE9 poss\xEDvel ir de "${Oe[s.status]}" para\
 "${Oe[t.to]}"`,"invalid_transition");if(t.to==="saiu"&&s.mode!=="entrega")throw f("Pedido de retirada n\xE3o sai para entrega");if(t.to==="cancelado"&&!t.reason)throw f("Informe o\
 motivo do cancelamento");if(t.to==="confirmado"&&await o.query("update order_items set sent_at = now() where session_id = $1 and kitchen_status = 'novo' and sent_at is null and st\
atus = 'ativo'",[s.session_id]),t.to==="cancelado"){if((await M(o,s.session_id)).paid>0)throw g("H\xE1 pagamento confirmado: estorne antes de cancelar","has_payments");let r=(await o.
query("select id, kitchen_status from order_items where session_id = $1 and status = 'ativo'",[s.session_id])).rows;for(let d of r)["novo","aceito","nao_produz"].includes(d.kitchen_status)&&
await dt(o,e.ctx,d.id,`Delivery cancelado: ${t.reason}`);await o.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
          kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where session_id = $1 and status = 'ativo'`,[s.session_id,`Delivery canc\
elado: ${t.reason}`,e.ctx.userId]),await o.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2 where id = $1",[s.session_id,e.ctx.userId])}
if(t.to==="entregue"){let i=await M(o,s.session_id);if(i.balance>0&&!t.proof)throw g(`Saldo de R$ ${(i.balance/100).toFixed(2).replace(".",",")} em aberto: registre o pagamento ou \
informe o comprovante`,"balance_pending");let r=(await o.query("select * from consumption_sessions where id = $1 for update",[s.session_id])).rows[0];i.balance===0&&i.items>0&&["ab\
erta","em_fechamento"].includes(r.status)&&(await o.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2, version = version + 1 where id =\
 $1",[r.id,e.ctx.userId]),await zt(o,e.ctx,r,i.items))}return await o.query(`update delivery_orders set status = $2, cancel_reason = coalesce($3, cancel_reason), proof = coalesce($\
4, proof),
        eta_minutes = coalesce($5, eta_minutes), updated_at = now() where id = $1`,[s.id,t.to,t.to==="cancelado"?t.reason:null,t.proof??null,t.eta_minutes??null]),await o.query("in\
sert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,s.id,t.to,e.ctx.userId,t.reason||t.proof||null]),await h(o,e.ctx,`\
delivery.${t.to}`,{entity:"delivery",entityId:s.id,reason:t.reason,data:{from:s.status}}),{ok:!0,status:t.to}});a.json(n)}));ve.post("/orders/:id/courier",p("delivery.gerenciar"),l(
async(e,a)=>{let t=w(E.object({courier_id:E.number().int().nullable()}),e.body);if(t.courier_id&&!(await c("select 1 from users where id = $1 and company_id = $2 and active",[t.courier_id,
e.ctx.companyId])).rows[0])throw f("Entregador inv\xE1lido");let n=await c("update delivery_orders set courier_id = $3, updated_at = now() where id = $1 and company_id = $2 returni\
ng id",[Number(e.params.id),e.ctx.companyId,t.courier_id]);if(!n.rows[0])throw $();await h({query:c},e.ctx,"delivery.entregador",{entity:"delivery",entityId:n.rows[0].id,data:t}),a.
json({ok:!0})}));ve.get("/couriers",p("delivery.gerenciar"),l(async(e,a)=>{a.json((await c(`select u.id, u.name, u.role_key from users u join roles r on r.company_id = u.company_id\
 and r.key = u.role_key
    where u.company_id = $1 and u.active and 'delivery.entregar' = any(r.permissions) order by u.name`,[e.ctx.companyId])).rows)}));import ms from"node:crypto";import{Router as us}from"npm:express@5.2.1";import{z as ee}from"npm:zod@4.6.5";var Dt=e=>({enabled:!1,name:"Atendente virtual",greeting:"Ol\xE1! Sou o atendimento virtual. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* do ped\
ido ou fazer uma *reserva*. Para falar com a equipe, digite *atendente*.",handoff_message:"Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA. Aguarde um instante.",closed_message:"\
No momento n\xE3o estamos recebendo pedidos. Veja nossos hor\xE1rios digitando *hor\xE1rio*.",reservation_max_people:12,reservation_min_hours:2,...e?.agent||{}});function is(e,a){let t=new Date(
`${e}Z`);if(Number.isNaN(t.getTime()))return t;let n=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:a,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"\
2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(t).map(s=>[s.type,s.value])),o=Date.UTC(+n.year,+n.month-1,+n.day,+n.hour,+n.minute,+n.second);return new Date(t.getTime()-
(o-t.getTime()))}var Pt=e=>String(e||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim(),Ue=e=>`R$ ${(Number(e)/100).toFixed(2).replace(".",",")}`,X=(e,...a)=>a.some(t=>new RegExp(
`(^|\\W)${t}(\\W|$)`).test(e));async function rs(e){return(await c(`select p.id, p.name, p.price_cents, c.name as category, p.kind,
      exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as required_opts
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and (('delivery' = any(p.channels)) or ('cardapio_digital' = any(p.channels)) or ('pdv' = any(p.channels)))
    order by c.sort nulls last, c.name, p.name limit 200`,[e])).rows}var cs=new Set(["quanto","custa","valor","preco","qual","quero","uma","umas","uns","com","sem","por","favor","t\
em","voces","pra","para","mais","esta","esse","essa"]);function gn(e,a){let t=Pt(a),n=null,o=0;for(let s of e){let i=Pt(s.name);if(t.includes(i))return s;let r=i.split(/\s+/).filter(
_=>_.length>2),d=t.split(/\W+/).filter(_=>_.length>2&&!cs.has(_)),u=r.filter(_=>t.includes(_)).length,m=d.filter(_=>r.some(j=>j.startsWith(_)||_.startsWith(j))).length,y=u?Math.max(
r.length?u/r.length:0,d.length?m/d.length:0):0;y>o&&(o=y,n=s)}return o>=.5?n:null}function Ea(e,a){let t=Pt(a),n=t.match(/^(\d{1,2})\s*(x\s*)?(.+)$/),o=n?Number(n[1]):1,s=gn(e,n?n[3]:
t);return s?{p:s,qty:Math.min(Math.max(o,1),50)}:null}var qa=(e,a)=>e.map(t=>{let n=a.find(o=>o.id===t.product_id);return`${t.qty}\xD7 ${n?.name} \u2014 ${Ue((n?.price_cents||0)*t.
qty)}`}).join(`
`);async function ds(e,a,t,{simulated:n}){let o=Dt(e.settings),s=Le(e.settings),i={...a.state||{}},r=Pt(t),d=[],u=await rs(e.id);if(X(r,"atendente","humano","pessoa","gerente","rec\
lamacao","reclamar","problema","desconto","cobranca","estorno","reembolso"))return{replies:[o.handoff_message],state:{step:null},handoff:!0};if(X(r,"cancelar","cancela","sair","rec\
omecar")&&i.step&&!X(r,"reserva"))return{replies:["Tudo bem, cancelei o que est\xE1vamos montando. Posso ajudar em algo mais?"],state:{step:null}};if(i.step==="pedido"){if(X(r,"fin\
alizar","fechar","pronto","so isso","e isso","acabou")){if(!i.cart?.length)return{replies:["Seu pedido ainda est\xE1 vazio. Envie, por exemplo: *2 pilsen*."],state:i};let j=[s.delivery&&
"*entrega*",s.pickup&&"*retirada*"].filter(Boolean).join(" ou ");return{replies:[`Seu pedido:
${qa(i.cart,u)}

Vai ser ${j}?`],state:{...i,step:"modo"}}}let _=[];for(let j of String(t).split(/\n|,| e (?=\d)/)){if(!j.trim())continue;let x=Ea(u,j);if(x){if(x.p.required_opts){d.push(`*${x.p.name}\
* tem op\xE7\xF5es para escolher \u2014 pe\xE7a esse item pelo card\xE1pio digital${e.slug?`: /c/${e.slug}`:""}.`);continue}i.cart=[...i.cart||[],{product_id:x.p.id,qty:x.qty}],_.push(
`${x.qty}\xD7 ${x.p.name}`)}}return _.length?d.push(`Anotado: ${_.join(", ")}. Algo mais? Quando terminar, digite *finalizar*.`):d.length||d.push("N\xE3o encontrei esse item no card\xE1p\
io. Digite *card\xE1pio* para ver as op\xE7\xF5es ou envie como *2 pilsen*."),{replies:d,state:i}}if(i.step==="modo")return X(r,"entrega","entregar","delivery")&&s.delivery?{replies:[
"Qual o endere\xE7o? Envie *rua, n\xFAmero e bairro*."],state:{...i,step:"endereco",mode:"entrega"}}:X(r,"retirada","retirar","buscar","balcao")&&s.pickup?{replies:["Em nome de que\
m fica o pedido?"],state:{...i,step:"nome",mode:"retirada"}}:{replies:["Responda *entrega* ou *retirada*."],state:i};if(i.step==="endereco"){let _=String(t).split(",").map(j=>j.trim());
return _.length<2||!/\d/.test(_[1])?{replies:["Preciso de rua e n\xFAmero, separados por v\xEDrgula. Ex.: *Rua das Flores, 120, Centro*."],state:i}:{replies:["Em nome de quem fica \
o pedido?"],state:{...i,step:"nome",address:{street:_[0],number:_[1],district:_[2]||""}}}}if(i.step==="nome"){let _=String(t).trim().slice(0,60);if(_.length<2)return{replies:["Qual\
 o nome?"],state:i};let{subtotal:j}=await wn({query:c},e.id,i.cart).catch(()=>({subtotal:0})),x=i.mode==="entrega"?s.fee_cents:0;return{replies:[`Confira:
${qa(i.cart,u)}
${x?`Taxa de entrega: ${Ue(x)}
`:""}*Total: ${Ue(j+x)}*
${i.mode==="entrega"?`Entrega em: ${i.address.street}, ${i.address.number}`:"Retirada no balc\xE3o"} \xB7 Nome: ${_}
Pagamento na ${i.mode==="entrega"?"entrega":"retirada"}.

Responda *confirmar* para enviar ou *cancelar*.`],state:{...i,step:"confirmar",name:_}}}if(i.step==="confirmar"){if(!X(r,"confirmar","confirmo","sim","pode","ok"))return{replies:["\
Responda *confirmar* para enviar o pedido ou *cancelar*."],state:i};if(n)return{replies:["\u2705 (Simula\xE7\xE3o) Pedido montado corretamente. Nada foi enviado \xE0 cozinha nem registrado nas v\
endas."],state:{step:null}};try{let _=await Qe({query:c},e.id,{channel:"whatsapp",mode:i.mode,customer_name:i.name,phone:a.contact,address:i.address,cart:i.cart,client_key:`wa${a.id}\
x${te(6)}`},null);return{replies:[`\u2705 Pedido *#${_.number}* recebido! Total ${Ue(_.total)}. Avisaremos quando for confirmado. Para acompanhar, digite *status*.`],state:{step:null}}}catch(_){
return{replies:[`N\xE3o consegui registrar o pedido: ${_.message}`],state:{step:null}}}}if(i.step==="reserva"){let _=String(t).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\D+(\d{1,2})(?:[:h](\d{2}))?\D+(\d{1,3})/i);
if(!_)return{replies:["Envie *dia/m\xEAs, hor\xE1rio e pessoas*. Ex.: *25/10 20:30 4 pessoas*."],state:i};let j=_[3]?_[3].length===2?2e3+Number(_[3]):Number(_[3]):new Date().getFullYear(),
x=e.timezone||"America/Sao_Paulo",S=`${j}-${String(_[2]).padStart(2,"0")}-${String(_[1]).padStart(2,"0")}T${String(_[4]).padStart(2,"0")}:${_[5]||"00"}:00`,A=is(S,x),D=Number(_[6]);
if(Number.isNaN(A.getTime()))return{replies:["Data inv\xE1lida. Ex.: *25/10 20:30 4 pessoas*."],state:i};if(A.getTime()<Date.now()+o.reservation_min_hours*36e5)return{replies:[`Res\
ervas precisam de pelo menos ${o.reservation_min_hours}h de anteced\xEAncia.`],state:i};if(D<1||D>o.reservation_max_people)return{replies:[`Para grupos acima de ${o.reservation_max_people}\
 pessoas, a equipe vai te atender.`],state:{step:null},handoff:!0};if(n)return{replies:[`\u2705 (Simula\xE7\xE3o) Reserva para ${D} pessoa(s) em ${_[1]}/${_[2]} \xE0s ${_[4]}:${_[5]||
"00"} \u2014 nada foi gravado.`],state:{step:null}};let L=(await c("select id from units where company_id = $1 and active order by id limit 1",[e.id])).rows[0];return await c("inse\
rt into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source) values ($1,$2,$3,$4,$5,$6,'pendente','agente')",[e.id,L.id,a.contact_name||"Clie\
nte WhatsApp",a.contact,D,A]),{replies:[`Pedido de reserva para *${D}* pessoa(s) em *${_[1]}/${_[2]} \xE0s ${_[4]}:${_[5]||"00"}* registrado. A equipe confirma em breve.`],state:{step:null}}}
if(X(r,"oi","ola","bom dia","boa tarde","boa noite","menu inicial","ajuda","opcoes")&&r.length<30)return{replies:[o.greeting],state:{step:null}};if(X(r,"horario","horarios","funcio\
na","funcionamento","aberto","abre","fecha"))return{replies:[`${s.hours?`Nosso hor\xE1rio: ${s.hours}`:"Consulte nosso hor\xE1rio com a equipe."}${s.enabled?s.accepting?`
Estamos recebendo pedidos agora.`:`
No momento n\xE3o estamos recebendo pedidos.`:""}`],state:i};if(X(r,"cardapio","menu","opcoes de","o que tem","tem o que")){let _={};for(let x of u)(_[x.category||"Outros"]||=[]).push(
`\u2022 ${x.name} \u2014 ${Ue(x.price_cents)}`);return{replies:[Object.entries(_).map(([x,S])=>`*${x}*
${S.slice(0,12).join(`
`)}`).join(`

`).slice(0,3500)||"Card\xE1pio indispon\xEDvel no momento.","Para pedir, digite *pedido*."],state:i}}if(X(r,"status","meu pedido","cade","acompanhar","demora")){let _=(await c("sel\
ect number, status, mode, eta_minutes, created_at from delivery_orders where company_id = $1 and phone = $2 order by id desc limit 1",[e.id,se(a.contact)])).rows[0];return _?{replies:[
`Pedido *#${_.number}*: *${Oe[_.status]}*${["recebido","confirmado","em_preparo"].includes(_.status)&&_.eta_minutes?` \xB7 previs\xE3o de ${_.eta_minutes} min`:""}.`],state:i}:{replies:[
"N\xE3o encontrei pedidos feitos por este n\xFAmero. Se pediu por outro n\xFAmero, fale com um *atendente*."],state:i}}if(X(r,"reserva","reservar","mesa para"))return X(r,"cancelar",
"cancela","desmarcar")?n?{replies:["\u2705 (Simula\xE7\xE3o) Reserva cancelada \u2014 nada foi alterado."],state:{step:null}}:{replies:[(await c(`update reservations set status = '\
cancelada' where id = (select id from reservations where company_id = $1 and phone = $2
          and status in ('pendente','confirmada') and starts_at > now() order by starts_at limit 1) returning starts_at`,[e.id,se(a.contact)])).rows[0]?"Sua pr\xF3xima reserva foi can\
celada.":"N\xE3o encontrei reserva futura neste n\xFAmero."],state:{step:null}}:X(r,"remarcar","mudar","alterar")?{replies:["Para remarcar, cancele a atual (*cancelar reserva*) e f\
a\xE7a uma nova (*reserva*). Se preferir, chame um *atendente*."],state:i}:{replies:["Vamos reservar! Envie *dia/m\xEAs, hor\xE1rio e n\xFAmero de pessoas*. Ex.: *25/10 20:30 4 pessoas*."],
state:{step:"reserva"}};if(X(r,"pedido","pedir","quero","encomendar","delivery","entrega")){if(!s.enabled||!s.accepting)return{replies:[o.closed_message],state:i};let _=Ea(u,r.replace(
/\b(quero|pedir|pedido|fazer|um|uma)\b/g," ").trim()),j=_&&!_.p.required_opts?[{product_id:_.p.id,qty:_.qty}]:[];return{replies:[`${j.length?`Anotado: ${j[0].qty}\xD7 ${_.p.name}. `:
""}Me diga os itens, um por linha, com a quantidade. Ex.:
*2 pilsen*
*1 batata frita*
Quando terminar, digite *finalizar*.`],state:{step:"pedido",cart:j}}}if(X(r,"preco","quanto","valor","custa")){let _=gn(u,r);return{replies:[_?`*${_.name}*: ${Ue(_.price_cents)}.`:
"De qual item? Digite *card\xE1pio* para ver todos os pre\xE7os."],state:i}}let m=gn(u,r);if(m)return{replies:[`*${m.name}*: ${Ue(m.price_cents)}. Para pedir, digite *pedido*.`],state:i};
let y=(i.misses||0)+1;return y>=3?{replies:[o.handoff_message],state:{step:null},handoff:!0}:{replies:[`N\xE3o entendi. ${o.greeting}`],state:{...i,misses:y}}}async function ut(e,a,t){
let n=Object.fromEntries((await c("select key, value from company_secrets where company_id = $1 and key in ('wa_token','wa_phone_number_id')",[e])).rows.map(o=>[o.key,o.value]));if(!n.
wa_token||!n.wa_phone_number_id)return{ok:!1,error:"Integra\xE7\xE3o do WhatsApp n\xE3o configurada"};try{let o=await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(n.
wa_phone_number_id)}/messages`,{method:"POST",headers:{authorization:`Bearer ${n.wa_token}`,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:se(
a),type:"text",text:{body:t.slice(0,4e3)}}),signal:AbortSignal.timeout(8e3)}),s=await o.json().catch(()=>({}));return o.ok?{ok:!0,id:s?.messages?.[0]?.id}:{ok:!1,error:s?.error?.message?.
slice(0,200)||`HTTP ${o.status}`}}catch(o){return{ok:!1,error:String(o.message||o).slice(0,200)}}}async function mt(e,a,t,n){let o=await e.query(`insert into conversation_messages \
(company_id, conversation_id, direction, author, body, external_id, delivery_status, error, user_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,[a,t,n.direction,n.author,n.body,n.external_id??null,n.delivery_status||"ok",n.error??null,n.user_id??null]);
return await e.query("update conversations set last_message_at = now() where id = $1",[t]),o.rows[0]?.id||null}async function Tt(e,{channel:a,contact:t,contactName:n,body:o,externalId:s}){
let i=a==="simulador",r=(await c(`insert into conversations (company_id, channel, contact, contact_name) values ($1,$2,$3,$4)
    on conflict (company_id, channel, contact) do update set contact_name = coalesce(excluded.contact_name, conversations.contact_name) returning *`,[e.id,a,t,n??null])).rows[0];if(!await mt(
{query:c},e.id,r.id,{direction:"in",author:"cliente",body:String(o).slice(0,4e3),external_id:s}))return{duplicate:!0,conversation_id:r.id,replies:[]};let u=Dt(e.settings);if(r.mode!==
"agente"||!u.enabled&&!i)return{conversation_id:r.id,replies:[],mode:r.mode};let m=await ds(e,r,o,{simulated:i});await c("update conversations set state = $2, needs_human = needs_h\
uman or $3, mode = case when $3 then 'humano' else mode end where id = $1",[r.id,JSON.stringify(m.state||{}),!!m.handoff]);for(let y of m.replies){let _=i?"simulado":"pendente",j=null,
x=null;if(!i){let S=await ut(e.id,t,y);_=S.ok?"ok":"falhou",j=S.error||null,x=S.id||null}await mt({query:c},e.id,r.id,{direction:"out",author:"agente",body:y,external_id:x,delivery_status:_,
error:j})}return{conversation_id:r.id,replies:m.replies,handoff:!!m.handoff}}var re=us(),bn=e=>`${e}.${ms.createHmac("sha256",st("unsubscribe")).update(String(e)).digest("base64url").slice(0,16)}`;function Aa(e){let[a]=String(e||"").split(".");return/^\d+$/.
test(a||"")&&bn(a)===e?Number(a):null}var Oa=ee.object({birthday_month:ee.boolean().optional(),inactive_days:ee.number().int().min(1).max(3650).optional(),tag:ee.string().trim().max(
30).optional(),min_visits:ee.number().int().min(1).max(1e3).optional()}).default({});function Pa(e,a,t){let n=`c.company_id = $1 and c.anonymized_at is null and c.unsubscribed_at i\
s null and ${a==="whatsapp"?"c.consent_whatsapp and c.phone is not null":"c.consent_email and c.email is not null"}`;return e.birthday_month&&(n+=" and extract(month from c.birthda\
y) = extract(month from current_date)"),e.tag&&(t.push(e.tag),n+=` and $${t.length} = any(c.tags)`),e.inactive_days&&(t.push(e.inactive_days),n+=` and not exists (select 1 from con\
sumption_sessions s where s.customer_id = c.id and s.opened_at > now() - make_interval(days => $${t.length}))`),e.min_visits&&(t.push(e.min_visits),n+=` and (select count(*) from c\
onsumption_sessions s where s.customer_id = c.id and s.status = 'encerrada') >= $${t.length}`),n}var Da=(e,a,t)=>e.replaceAll("{nome}",(a.name||"").split(" ")[0]).replaceAll("{empr\
esa}",t).replaceAll("{pontos}",String(a.points??0));re.post("/segments/preview",p("marketing.gerenciar"),l(async(e,a)=>{let t=w(ee.object({channel:ee.enum(["whatsapp","email"]),segment:Oa}),
e.body),n=[e.ctx.companyId],o=Pa(t.segment,t.channel,n),s=(await c(`select count(*)::int as n from customers c where ${o}`,n)).rows[0].n,i=(await c("select count(*)::int as n from \
customers where company_id = $1 and anonymized_at is null",[e.ctx.companyId])).rows[0].n;a.json({recipients:s,without_consent:i-s})}));re.get("/campaigns",p("marketing.gerenciar"),
l(async(e,a)=>{a.json((await c(`select c.*, u.name as user_name,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'enviado') as sent,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'falhou') as failed
    from campaigns c left join users u on u.id = c.created_by where c.company_id = $1 order by c.id desc limit 100`,[e.ctx.companyId])).rows)}));re.post("/campaigns",p("marketing.g\
erenciar"),l(async(e,a)=>{let t=w(ee.object({name:ee.string().trim().min(3).max(80),channel:ee.enum(["whatsapp","email"]),segment:Oa,message:ee.string().trim().min(10).max(1500)}),
e.body),n=await c("insert into campaigns (company_id, name, channel, segment, message, created_by) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,t.name,t.channel,t.segment,
t.message,e.ctx.userId]);a.status(201).json({id:n.rows[0].id})}));re.post("/campaigns/:id/prepare",p("marketing.gerenciar"),l(async(e,a)=>{let t=await v(async n=>{let o=(await n.query(
"select * from campaigns where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw $("Campanha n\xE3o encontrada");if(o.status!=="ra\
scunho")throw g("Campanha j\xE1 preparada");let s=[e.ctx.companyId],i=Pa(o.segment,o.channel,s);s.push(o.id);let r=await n.query(`insert into campaign_recipients (company_id, campa\
ign_id, customer_id) select $1, $${s.length}, c.id from customers c where ${i}`,s);return await n.query("update campaigns set status = 'preparada', recipients = $2, prepared_at = n\
ow() where id = $1",[o.id,r.rowCount]),await h(n,e.ctx,"marketing.campanha_preparada",{entity:"campaign",entityId:o.id,data:{recipients:r.rowCount}}),{recipients:r.rowCount}});a.json(
t)}));re.get("/campaigns/:id/recipients",p("marketing.gerenciar","dados.pessoais"),l(async(e,a)=>{let t=(await c("select c.*, co.name as company from campaigns c join companies co \
on co.id = c.company_id where c.id = $1 and c.company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw $();let n=(await c(`select r.id, r.status, r.sent_at, r.e\
rror, cu.id as customer_id, cu.name, cu.phone, cu.email, cu.points, cu.unsubscribed_at
    from campaign_recipients r join customers cu on cu.id = r.customer_id where r.campaign_id = $1 order by cu.name limit 2000`,[t.id])).rows;a.json(n.map(o=>({...o,message:`${Da(t.
message,o,t.company)}

Para n\xE3o receber mais: ${e.query.base||""}/sair/${bn(o.customer_id)}`})))}));re.post("/campaigns/:id/recipients/:rid/sent",p("marketing.gerenciar"),l(async(e,a)=>{let t=await c(
"update campaign_recipients set status = 'enviado', sent_at = now() where id = $1 and campaign_id = $2 and company_id = $3 and status in ('pendente','falhou') returning id",[Number(
e.params.rid),Number(e.params.id),e.ctx.companyId]);a.json({ok:!!t.rows[0]})}));re.post("/campaigns/:id/send",p("marketing.gerenciar"),l(async(e,a)=>{let t=w(ee.object({base_url:ee.
string().url().max(200)}),e.body),n=(await c("select c.*, co.name as company from campaigns c join companies co on co.id = c.company_id where c.id = $1 and c.company_id = $2",[Number(
e.params.id),e.ctx.companyId])).rows[0];if(!n)throw $();if(n.channel!=="whatsapp")throw f("Envio autom\xE1tico dispon\xEDvel s\xF3 para WhatsApp; para e-mail, exporte a lista");if(n.
status!=="preparada")throw g("Prepare a campanha antes de enviar");let o=(await c(`select r.id, cu.id as customer_id, cu.name, cu.phone, cu.points from campaign_recipients r join c\
ustomers cu on cu.id = r.customer_id
    where r.campaign_id = $1 and r.status in ('pendente','falhou') and cu.unsubscribed_at is null and cu.consent_whatsapp limit 300`,[n.id])).rows,s=0,i=0;for(let r of o){let d=await ut(
e.ctx.companyId,r.phone,`${Da(n.message,r,n.company)}

Para n\xE3o receber mais: ${t.base_url}/sair/${bn(r.customer_id)}`);if(await c("update campaign_recipients set status = $2, sent_at = case when $2 = 'enviado' then now() end, error\
 = $3 where id = $1",[r.id,d.ok?"enviado":"falhou",d.error||null]),d.ok?s++:i++,!d.ok&&/não configurada/.test(d.error))break}s&&!i&&await c("update campaigns set status = 'enviada\
' where id = $1",[n.id]),await h({query:c},e.ctx,"marketing.campanha_enviada",{entity:"campaign",entityId:n.id,data:{sent:s,failed:i}}),a.json({sent:s,failed:i})}));re.post("/campa\
igns/:id/cancel",p("marketing.gerenciar"),l(async(e,a)=>{if(!(await c("update campaigns set status = 'cancelada' where id = $1 and company_id = $2 and status in ('rascunho','prepar\
ada') returning id",[Number(e.params.id),e.ctx.companyId])).rows[0])throw g("Campanha n\xE3o pode ser cancelada");a.json({ok:!0})}));re.get("/reviews",p("marketing.gerenciar"),l(async(e,a)=>{
let t=Math.min(365,Number(e.query.days)||30),n=(await c(`select count(*)::int as total, round(avg(score)::numeric, 2)::float as average,
      count(*) filter (where score >= 4)::int as positive, count(*) filter (where score <= 2)::int as negative,
      count(*) filter (where score <= 2 and handled_at is null)::int as pending
    from reviews where company_id = $1 and created_at > now() - make_interval(days => $2)`,[e.ctx.companyId,t])).rows[0],o=(await c("select score, count(*)::int as n from reviews w\
here company_id = $1 and created_at > now() - make_interval(days => $2) group by score order by score",[e.ctx.companyId,t])).rows,s=(await c(`select r.id, r.score, r.comment, r.cre\
ated_at, r.handled_at, r.session_id, cu.name as customer_name, cu.id as customer_id, u.name as handled_name
    from reviews r left join customers cu on cu.id = r.customer_id left join users u on u.id = r.handled_by
    where r.company_id = $1 and r.created_at > now() - make_interval(days => $2) order by (r.score <= 2 and r.handled_at is null) desc, r.id desc limit 200`,[e.ctx.companyId,t])).rows;
a.json({stats:n,distribution:o,items:s})}));re.post("/reviews/:id/handled",p("marketing.gerenciar"),l(async(e,a)=>{let t=w(ee.object({note:ee.string().trim().min(3).max(300)}),e.body),
n=await c("update reviews set handled_at = now(), handled_by = $3 where id = $1 and company_id = $2 and handled_at is null returning id",[Number(e.params.id),e.ctx.companyId,e.ctx.
userId]);if(!n.rows[0])throw g("Avalia\xE7\xE3o j\xE1 tratada");await h({query:c},e.ctx,"marketing.avaliacao_tratada",{entity:"review",entityId:n.rows[0].id,reason:t.note}),a.json(
{ok:!0})}));re.get("/review-link/:sessionId",p("pdv.lancar"),l(async(e,a)=>{let t=(await c("select id from consumption_sessions where id = $1 and company_id = $2 and status = 'ence\
rrada'",[Number(e.params.sessionId),e.ctx.companyId])).rows[0];if(!t)throw $("Consumo encerrado n\xE3o encontrado");let n=(await c("select slug from companies where id = $1",[e.ctx.
companyId])).rows[0];a.json({token:Ot(t.id),path:`/avaliar/${Ot(t.id)}`,slug:n.slug})}));import{Router as ls}from"npm:express@5.2.1";import{z as W}from"npm:zod@4.6.5";var xe=ls(),$n=["wa_token","wa_phone_number_id","wa_app_secret","wa_verify_token"];xe.get("/settings",p("agente.gerenciar"),l(async(e,a)=>{let t=(await c("select slug, settings fro\
m companies where id = $1",[e.ctx.companyId])).rows[0],n=(await c("select key, updated_at from company_secrets where company_id = $1 and key = any($2)",[e.ctx.companyId,$n])).rows,
o=(await c("select m.created_at, m.error from conversation_messages m where m.company_id = $1 and m.delivery_status = 'falhou' order by m.id desc limit 10",[e.ctx.companyId])).rows;
a.json({...Dt(t.settings),slug:t.slug,secrets:Object.fromEntries($n.map(s=>[s,!!n.find(i=>i.key===s)])),webhook_path:t.slug?`/api/public/whatsapp/${t.slug}`:null,failures:o})}));xe.
put("/settings",p("agente.gerenciar"),l(async(e,a)=>{let t=w(W.object({enabled:W.boolean(),name:W.string().trim().min(2).max(40),greeting:W.string().trim().min(5).max(600),handoff_message:W.
string().trim().min(5).max(300),closed_message:W.string().trim().min(5).max(300),reservation_max_people:W.number().int().min(1).max(100),reservation_min_hours:W.number().int().min(
0).max(72)}),e.body);await c("update companies set settings = jsonb_set(settings, '{agent}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await h({query:c},e.ctx,
"agente.configuracao",{data:{enabled:t.enabled}}),a.json({ok:!0})}));xe.put("/secrets",p("agente.gerenciar","configuracoes.gerenciar"),l(async(e,a)=>{let t=w(W.object(Object.fromEntries(
$n.map(n=>[n,W.string().trim().max(600).optional()]))),e.body);await v(async n=>{for(let[o,s]of Object.entries(t))s!==void 0&&(s?await n.query(`insert into company_secrets (company\
_id, key, value) values ($1,$2,$3)
        on conflict (company_id, key) do update set value = excluded.value, updated_at = now()`,[e.ctx.companyId,o,s]):await n.query("delete from company_secrets where company_id =\
 $1 and key = $2",[e.ctx.companyId,o]));await h(n,e.ctx,"agente.credenciais",{data:{keys:Object.keys(t).filter(o=>t[o]!==void 0)}})}),a.json({ok:!0})}));xe.get("/conversations",p("\
agente.atender"),l(async(e,a)=>{let t=e.query.channel==="simulador"?"simulador":"whatsapp";a.json((await c(`select c.id, c.channel, c.contact, c.contact_name, c.mode, c.needs_human\
, c.last_message_at, u.name as assigned_name,
      (select body from conversation_messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_body,
      (select count(*)::int from conversation_messages m where m.conversation_id = c.id and m.delivery_status = 'falhou') as failures
    from conversations c left join users u on u.id = c.assigned_to where c.company_id = $1 and c.channel = $2
    order by c.needs_human desc, c.last_message_at desc limit 100`,[e.ctx.companyId,t])).rows)}));xe.get("/conversations/:id",p("agente.atender"),l(async(e,a)=>{let t=(await c("sel\
ect * from conversations where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw $("Conversa n\xE3o encontrada");let n=(await c(`select m.id,\
 m.direction, m.author, m.body, m.delivery_status, m.error, m.created_at, u.name as user_name
    from conversation_messages m left join users u on u.id = m.user_id where m.conversation_id = $1 order by m.id desc limit 200`,[t.id])).rows.reverse();a.json({conversation:t,messages:n})}));
xe.post("/conversations/:id/mode",p("agente.atender"),l(async(e,a)=>{let t=w(W.object({mode:W.enum(["agente","humano","pausado"])}),e.body),n=await c(`update conversations set mode\
 = $3, assigned_to = case when $3 = 'humano' then $4 else null end,
      needs_human = case when $3 = 'agente' then false else needs_human end, state = case when $3 = 'agente' then '{}'::jsonb else state end
    where id = $1 and company_id = $2 returning id`,[Number(e.params.id),e.ctx.companyId,t.mode,e.ctx.userId]);if(!n.rows[0])throw $();await mt({query:c},e.ctx.companyId,n.rows[0].
id,{direction:"out",author:"sistema",delivery_status:"simulado",body:{agente:"Conversa devolvida ao agente",humano:`${e.ctx.name} assumiu a conversa`,pausado:"Agente pausado nesta \
conversa"}[t.mode],user_id:e.ctx.userId}),a.json({ok:!0})}));xe.post("/conversations/:id/reply",p("agente.atender"),l(async(e,a)=>{let t=w(W.object({body:W.string().trim().min(1).max(
2e3)}),e.body),n=(await c("select * from conversations where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!n)throw $();if(n.mode==="agente")throw g(
"Assuma a conversa antes de responder","not_assumed");let o="simulado",s=null,i=null;if(n.channel==="whatsapp"){let r=await ut(e.ctx.companyId,n.contact,t.body);o=r.ok?"ok":"falhou",
s=r.error||null,i=r.id||null}await mt({query:c},e.ctx.companyId,n.id,{direction:"out",author:"equipe",body:t.body,external_id:i,delivery_status:o,error:s,user_id:e.ctx.userId}),a.status(
201).json({ok:o!=="falhou",status:o,error:s})}));xe.post("/simulate",p("agente.gerenciar"),l(async(e,a)=>{let t=w(W.object({body:W.string().trim().min(1).max(1e3),contact:W.string().
trim().max(20).optional(),reset:W.boolean().optional()}),e.body),n=(await c("select id, name, slug, timezone, settings from companies where id = $1",[e.ctx.companyId])).rows[0],o=`\
sim-${t.contact||e.ctx.userId}`;t.reset&&await c("delete from conversations where company_id = $1 and channel = 'simulador' and contact = $2",[e.ctx.companyId,o]);let s=await Tt(n,
{channel:"simulador",contact:o,contactName:"Simula\xE7\xE3o",body:t.body,externalId:`sim-${te(8)}`});a.json(s)}));import{Router as ps}from"npm:express@5.2.1";import{z as ke}from"npm:zod@4.6.5";var lt=ps();lt.get("/",p("salao.visualizar"),l(async(e,a)=>{let t=/^\d{4}-\d{2}-\d{2}$/.test(String(e.query.day))?e.query.day:null,n=e.ctx.company.timezone,o=[e.ctx.companyId,n],s="\
r.company_id = $1";t?(o.push(t),s+=` and (r.starts_at at time zone $2)::date = $${o.length}`):s+=" and r.starts_at > now() - interval '3 hours'",a.json((await c(`select r.*, t.numb\
er as table_number from reservations r left join dining_tables t on t.id = r.table_id where ${s} order by r.starts_at limit 200`,o)).rows)}));lt.post("/",p("salao.gerenciar"),l(async(e,a)=>{
let t=w(ke.object({customer_name:ke.string().trim().min(2).max(80),phone:ke.string().trim().max(20).optional(),people:ke.number().int().min(1).max(100),starts_at:ke.string().datetime(
{offset:!0}),table_id:ke.number().int().nullable().optional(),notes:ke.string().max(300).optional()}),e.body);if(new Date(t.starts_at).getTime()<Date.now()-36e5)throw f("Hor\xE1rio j\xE1\
 passou");if(t.table_id&&!(await c("select 1 from dining_tables where id = $1 and company_id = $2",[t.table_id,e.ctx.companyId])).rows[0])throw f("Mesa inv\xE1lida");let n=e.ctx.unitId||
(await c("select id from units where company_id = $1 order by id limit 1",[e.ctx.companyId])).rows[0].id,o=await c(`insert into reservations (company_id, unit_id, customer_name, ph\
one, people, starts_at, table_id, notes, status, source)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmada','equipe') returning id`,[e.ctx.companyId,n,t.customer_name,t.phone?se(t.phone):null,t.people,t.starts_at,t.table_id??null,t.notes??
null]);await h({query:c},e.ctx,"reserva.criada",{entity:"reservation",entityId:o.rows[0].id,data:{people:t.people,starts_at:t.starts_at}}),a.status(201).json({id:o.rows[0].id})}));
lt.post("/:id/status",p("salao.gerenciar"),l(async(e,a)=>{let t=w(ke.object({status:ke.enum(["confirmada","cancelada","chegou","nao_compareceu"]),table_id:ke.number().int().nullable().
optional()}),e.body),n=await c("update reservations set status = $3, table_id = coalesce($4, table_id) where id = $1 and company_id = $2 returning id, table_id",[Number(e.params.id),
e.ctx.companyId,t.status,t.table_id??null]);if(!n.rows[0])throw $("Reserva n\xE3o encontrada");t.status==="confirmada"&&n.rows[0].table_id&&await c("update dining_tables set status\
 = 'reservada' where id = $1 and status = 'livre'",[n.rows[0].table_id]),await h({query:c},e.ctx,`reserva.${t.status}`,{entity:"reservation",entityId:n.rows[0].id}),a.json({ok:!0})}));import _s from"node:crypto";import{Router as ys}from"npm:express@5.2.1";import{z as F}from"npm:zod@4.6.5";var je=ys();async function Rt(e){if(!/^[a-z0-9-]{3,40}$/.test(String(e)))throw $("Estabelecimento n\xE3o encontrado");let a=(await c("select id, name, slug, phone, address, timezon\
e, settings, is_demo from companies where slug = $1",[e])).rows[0];if(!a)throw $("Estabelecimento n\xE3o encontrado");return a}je.get("/:slug/menu",l(async(e,a)=>{let t=await Rt(e.
params.slug),n=Le(t.settings);if(!n.enabled)throw $("Card\xE1pio digital desativado");let o=(await c(`select p.id, p.name, p.description, p.price_cents, p.allergens, p.category_id,\
 c.name as category,
      coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
         'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                       from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id) from modifier_groups g where g.product_id = p.id), '[]') as groups
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and ('delivery' = any(p.channels) or 'cardapio_digital' = any(p.channels))
    order by c.sort nulls last, c.name, p.name`,[t.id])).rows;a.set("cache-control","public, max-age=30"),a.json({company:{name:t.name,slug:t.slug,phone:t.phone,address:t.address?.
city?`${t.address.street||""} ${t.address.number||""} \u2014 ${t.address.city}`:null},settings:{accepting:n.accepting,delivery:n.delivery,pickup:n.pickup,fee_cents:n.fee_cents,min_order_cents:n.
min_order_cents,eta_minutes:n.eta_minutes,hours:n.hours,areas:n.areas,message:n.message,payment_methods:n.payment_methods},products:o})}));var fs=F.object({mode:F.enum(["entrega","\
retirada"]),customer_name:F.string().trim().min(2).max(80),phone:F.string().trim().min(10).max(20),address:F.object({street:F.string().trim().max(120),number:F.string().trim().max(
20),district:F.string().trim().max(80).optional(),complement:F.string().trim().max(80).optional(),reference:F.string().trim().max(120).optional()}).partial().optional(),payment_hint:F.
enum(["dinheiro","pix","cartao"]),change_for_cents:F.number().int().min(0).max(1e6).optional(),notes:F.string().trim().max(300).optional(),cart:F.array(F.object({product_id:F.number().
int(),qty:F.number().int().min(1).max(50),option_ids:F.array(F.number().int()).max(40).default([]),notes:F.string().trim().max(140).optional()})).min(1).max(40),client_key:F.string().
regex(/^[A-Za-z0-9_-]{12,80}$/),website:F.string().max(0).optional()});je.post("/:slug/orders",l(async(e,a)=>{let t=await Rt(e.params.slug),n=w(fs,e.body);await oe(`pub-order:${t.id}\
:${e.ip}`,8,900),await oe(`pub-order-phone:${t.id}:${n.phone.replace(/\D/g,"")}`,4,900);let o=await v(s=>Qe(s,t.id,{...n,channel:"site"},null));a.status(o.replay?200:201).json({number:o.
number,token:o.public_token,status:o.status})}));je.get("/orders/:token",l(async(e,a)=>{if(!/^[A-Za-z0-9_-]{16,40}$/.test(e.params.token))throw $("Pedido n\xE3o encontrado");let t=(await c(
`select d.id, d.number, d.status, d.mode, d.eta_minutes, d.created_at, d.updated_at, d.session_id, d.customer_name, c.name as company, c.slug
    from delivery_orders d join companies c on c.id = d.company_id where d.public_token = $1`,[e.params.token])).rows[0];if(!t)throw $("Pedido n\xE3o encontrado");let n=(await c("s\
elect description, qty, modifiers, total_cents from order_items where session_id = $1 and status = 'ativo' order by id",[t.session_id])).rows,o=(await c("select status, created_at \
from delivery_events where order_id = $1 order by id",[t.id])).rows,s=await M({query:c},t.session_id);a.set("cache-control","no-store"),a.json({number:t.number,status:t.status,label:Oe[t.
status],mode:t.mode,eta_minutes:t.eta_minutes,created_at:t.created_at,first_name:t.customer_name.split(" ")[0],company:t.company,slug:t.slug,items:n,totals:{items:s.items,delivery_fee:s.
deliveryFee,total:s.total},events:o.map(i=>({status:i.status,label:Oe[i.status],at:i.created_at}))})}));je.get("/review/:token",l(async(e,a)=>{let t=hn(e.params.token);if(!t)throw $(
"Link inv\xE1lido");let n=(await c(`select s.id, s.company_id, c.name as company, (select 1 from reviews r where r.session_id = s.id) as done
    from consumption_sessions s join companies c on c.id = s.company_id where s.id = $1 and s.status = 'encerrada'`,[t])).rows[0];if(!n)throw $("Link inv\xE1lido");a.json({company:n.
company,already:!!n.done})}));je.post("/review/:token",l(async(e,a)=>{let t=hn(e.params.token);if(!t)throw $("Link inv\xE1lido");await oe(`pub-review:${e.ip}`,10,3600);let n=w(F.object(
{score:F.number().int().min(1).max(5),comment:F.string().trim().max(600).optional()}),e.body),o=(await c("select id, company_id, customer_id from consumption_sessions where id = $1\
 and status = 'encerrada'",[t])).rows[0];if(!o)throw $("Link inv\xE1lido");await c("insert into reviews (company_id, session_id, customer_id, score, comment) values ($1,$2,$3,$4,$5\
)",[o.company_id,o.id,o.customer_id,n.score,n.comment||null]).catch(s=>{throw s.code==="23505"?g("Este consumo j\xE1 foi avaliado. Obrigado!","already_reviewed"):s}),a.status(201).
json({ok:!0})}));je.post("/unsubscribe/:token",l(async(e,a)=>{let t=Aa(e.params.token);if(!t)throw $("Link inv\xE1lido");let n=await c("update customers set consent_whatsapp = fals\
e, consent_email = false, unsubscribed_at = now(), updated_at = now() where id = $1 returning company_id",[t]);n.rows[0]&&await c(`insert into audit_events (company_id, action, ent\
ity, entity_id, data) values ($1,'cliente.descadastro','customer',$2,'{"origem":"link"}')`,[n.rows[0].company_id,String(t)]),a.json({ok:!0})}));async function Ta(e){return Object.fromEntries(
(await c("select key, value from company_secrets where company_id = $1 and key like 'wa_%'",[e])).rows.map(a=>[a.key,a.value]))}je.get("/whatsapp/:slug",l(async(e,a)=>{let t=await Rt(
e.params.slug),n=await Ta(t.id);if(e.query["hub.mode"]==="subscribe"&&n.wa_verify_token&&Ht(String(e.query["hub.verify_token"]||""),n.wa_verify_token))return a.type("text/plain").send(
String(e.query["hub.challenge"]||"").slice(0,200));a.status(403).json({error:"Verifica\xE7\xE3o recusada"})}));je.post("/whatsapp/:slug",l(async(e,a)=>{let t=await Rt(e.params.slug),
n=await Ta(t.id);if(!n.wa_app_secret)return a.status(403).json({error:"Integra\xE7\xE3o n\xE3o configurada"});let o=`sha256=${_s.createHmac("sha256",n.wa_app_secret).update(e.rawBody||
"").digest("hex")}`;if(!Ht(String(e.headers["x-hub-signature-256"]||""),o))return a.status(401).json({error:"Assinatura inv\xE1lida"});let s=(await c("select id, name, slug, timezo\
ne, settings from companies where id = $1",[t.id])).rows[0];for(let i of e.body?.entry||[])for(let r of i.changes||[]){let d=r.value||{},u=Object.fromEntries((d.contacts||[]).map(m=>[
m.wa_id,m.profile?.name]));for(let m of d.messages||[]){let y=m.type==="text"?m.text?.body:m.type==="button"?m.button?.text:m.type==="interactive"?m.interactive?.button_reply?.title||
m.interactive?.list_reply?.title:null;!y||!m.from||await Tt(s,{channel:"whatsapp",contact:String(m.from).slice(0,20),contactName:u[m.from]||null,body:y,externalId:m.id})}}a.json({ok:!0})}));import{Router as vn}from"npm:express@5.2.1";import ws from"npm:bcryptjs@3.0.3";import Ra from"node:crypto";import{z as ce}from"npm:zod@4.6.5";var de=vn();de.use(Mn);de.use((e,a,t)=>{a.set("Cache-Control","no-store"),t()});var xn={companyId:null,userId:null};async function pt(e){if(!/^\d{1,18}$/.test(String(e)))throw $("E\
mpresa n\xE3o encontrada.");let{rows:a}=await c("select id, is_demo from companies where id = $1",[e]);if(!a[0]||a[0].is_demo)throw $("Empresa n\xE3o encontrada.");return a[0]}de.get(
"/manifest",(e,a)=>a.json({code:Wt,name:"RUSTEN",contract:Dn,contract_minor:1,version:Tn,description:"Gest\xE3o e PDV para bares e restaurantes: comandas, mesas, dupla leitura e caixa\
.",features:Ln,settings:na()}));de.get("/tenants",l(async(e,a)=>{let{rows:t}=await c("select id from companies where not is_demo order by id limit 5000"),n=[];for(let o of t){let s=await ht(
o.id);if(s){let{is_demo:i,owner_email:r,...d}=s;n.push(d)}}a.json({items:n})}));var hs=(e,a)=>a||e;de.get("/tenants/:id",l(async(e,a)=>{let t=await pt(e.params.id),{is_demo:n,...o}=await ht(
t.id),{rows:s}=await c(`select u.name, u.email, u.role_key as role, r.name as role_name, u.active,
            (select max(s.created_at) from user_sessions s where s.user_id = u.id) as last_login_at
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by u.role_key = 'owner' desc, u.name limit 200`,[t.id]),{rows:i}=await c("select name, active from units where company_id = $1 order by id",[t.id]);
a.json({tenant:{...o,users:{n:s.length,active:s.filter(r=>r.active).length,list:s.map(({role_name:r,...d})=>({...d,role_label:hs(d.role,r)}))},units:i}})}));de.post("/tenants/:id/a\
ccess",l(async(e,a)=>{let t=await pt(e.params.id),n=w(ce.object({access:ce.object({status:ce.string(),blocked:ce.boolean()}).passthrough()}),e.body);await at(t.id,n.access),await h(
{query:c},{...xn,companyId:t.id},"central.situacao_recebida",{entity:"company",entityId:t.id,data:{status:n.access.status,blocked:n.access.blocked}}),a.json({ok:!0})}));de.post("/t\
enants/:id/owner-reset",l(async(e,a)=>{let t=await pt(e.params.id),n=w(ce.object({email:ce.string().trim().toLowerCase().email().max(160).nullable().optional()}),e.body||{}),{rows:o}=await c(
"select id, email from users where company_id = $1 and role_key = 'owner' order by id limit 1",[t.id]),s=o[0];if(!s)throw new N(404,"Esta empresa n\xE3o tem usu\xE1rio respons\xE1vel.",
"not_found");let i=s.email;if(n.email&&n.email!==s.email.toLowerCase()){if((await c("select 1 from users where lower(email) = $1 and id <> $2",[n.email,s.id])).rows[0])throw new N(
409,"Este e-mail j\xE1 \xE9 usado por outro acesso.","email_taken");await c("update users set email = $1 where id = $2",[n.email,s.id]),i=n.email}let r=`Rs-${Ra.randomBytes(6).toString(
"base64url")}-${Ra.randomInt(10,99)}`;await c(`update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null, active = true
            where id = $1`,[s.id,await ws.hash(r,12)]),await c("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[s.id]),await h({query:c},{...xn,
companyId:t.id},"central.senha_provisoria",{entity:"user",entityId:s.id,data:{email:i}}),a.json({ok:!0,user_id:String(s.id),email:i,temporary_password:r,message:"Senha provis\xF3ria c\
riada. Oriente o respons\xE1vel a troc\xE1-la em Configura\xE7\xF5es \u203A Meu acesso logo no primeiro acesso."})}));de.get("/settings",l(async(e,a)=>a.json({values:await Ee()})));
de.put("/settings",l(async(e,a)=>{let t=await oa(e.body?.values);a.json({values:t})}));de.get("/tenants/:id/settings",l(async(e,a)=>{let t=await pt(e.params.id);a.json({values:await an(
t.id)})}));de.put("/tenants/:id/settings",l(async(e,a)=>{let t=await pt(e.params.id),n=await v(async o=>{let s=await ia(o,t.id,e.body?.values);return await h(o,{...xn,companyId:t.id},
"central.parametros_alterados",{entity:"company",entityId:t.id,reason:typeof e.body?.reason=="string"?e.body.reason.slice(0,300):null,data:s}),s});a.json({ok:!0,changed:n,values:await an(
t.id)})}));var kn=vn();kn.get("/platform",l(async(e,a)=>{let t=P.CRON_SECRET;if(!t||e.headers.authorization!==`Bearer ${t}`)return a.status(401).json({error:"n\xE3o autorizado"});a.
json(await Ge(50))}));var Ie=vn();Ie.use(Ne());var _t=e=>encodeURIComponent(e.ctx.companyId),Mt=e=>({user_email:e.ctx.email,user_name:e.ctx.name}),Lt=(e,a,t)=>{if(e.ctx.company.is_demo)
return t(new N(400,"Na demonstra\xE7\xE3o n\xE3o h\xE1 assinatura. Ative sua conta para contratar.","demo"));t()};Ie.get("/",l(async(e,a)=>a.json({access:e.ctx.access,hub:!!await pe()})));
Ie.get("/billing",l(async(e,a)=>{if(e.ctx.company.is_demo||!await pe())return a.json({access:e.ctx.access,hub:!1,demo:!!e.ctx.company.is_demo});if(!e.ctx.can("assinatura.gerenciar"))
return a.json({access:e.ctx.access,restricted:!0,hub:!0});let t=await ge("GET",`/tenants/${_t(e)}/billing`);t.access&&await at(e.ctx.companyId,t.access),a.json({...t,hub:!0})}));Ie.
post("/billing/checkout",p("assinatura.gerenciar"),Lt,l(async(e,a)=>{let t=w(ce.object({plan_id:ce.string().uuid(),cycle:ce.enum(["MONTHLY","ANNUAL"])}),e.body),n=await ge("POST",`\
/tenants/${_t(e)}/billing/checkout`,{...t,...Mt(e)});await h({query:c},e.ctx,"assinatura.contratacao",{data:{plan_id:t.plan_id,cycle:t.cycle}}),a.status(201).json(n)}));Ie.post("/b\
illing/renew",p("assinatura.gerenciar"),Lt,l(async(e,a)=>{let t=await ge("POST",`/tenants/${_t(e)}/billing/renew`,Mt(e));await h({query:c},e.ctx,"assinatura.renovacao"),a.status(201).
json(t)}));Ie.post("/billing/change-plan",p("assinatura.gerenciar"),Lt,l(async(e,a)=>{let t=w(ce.object({plan_id:ce.string().uuid()}),e.body),n=await ge("POST",`/tenants/${_t(e)}/b\
illing/change-plan`,{...t,...Mt(e)});await He({id:e.ctx.companyId},{fresh:!0}),await h({query:c},e.ctx,"assinatura.troca_plano",{data:t}),a.json(n)}));Ie.post("/billing/cancel",p("\
assinatura.gerenciar"),Lt,l(async(e,a)=>{if(w(ce.object({confirm:ce.literal(!0,{message:"confirme o cancelamento"})}),e.body),e.ctx.role!=="owner")throw new N(403,"S\xF3 o propriet\xE1ri\
o pode cancelar a assinatura.","forbidden");let t=await ge("POST",`/tenants/${_t(e)}/billing/cancel`,{confirm:!0,...Mt(e)});await He({id:e.ctx.companyId},{fresh:!0}),await h({query:c},
e.ctx,"assinatura.cancelamento"),a.json(t)}));Ie.post("/verify",l(async(e,a)=>{let t=await He({id:e.ctx.companyId,is_demo:e.ctx.company.is_demo},{fresh:!0});await h({query:c},e.ctx,
"assinatura.verificacao"),a.json({ok:!0,refreshed:!!t})}));function In(){let e=jn();e.disable("x-powered-by"),e.set("trust proxy",1),e.use(gs());let a=(P.CORS_ORIGINS||"http://localhost:5173").split(",").map(o=>o.trim()).filter(Boolean),t=o=>!o||
a.includes(o)||a.includes("*")&&/^https:\/\//.test(o);e.use(bs({origin:(o,s)=>s(null,t(o)),credentials:!1,allowedHeaders:["content-type","authorization","x-terminal-id"]})),e.use("\
/api/stock/notes/read",jn.json({limit:"9mb"})),e.use(jn.json({limit:"1mb",verify:(o,s,i)=>{o.rawBody=i.toString("utf8")}})),e.get("/api/health",(o,s)=>s.json({ok:!0,service:"rusten\
-api"})),e.use("/api/auth",_e),e.use("/api/platform/v1",de),e.use("/api/cron",kn),e.use("/api/access",Ie),e.use("/api/public",je);let n=[Ne(),ae()];return e.use("/api/admin",...n,H),
e.use("/api/home",...n,Ct),e.use("/api/menu",...n,ae("cardapio"),ue),e.use("/api/floor",...n,$e),e.use("/api/pdv",...n,ae("pdv"),B),e.use("/api/cash",...n,ae("pdv"),qe),e.use("/api\
/customers",...n,ae("clientes"),Q),e.use("/api/kitchen",...n,ae("cozinha"),ie),e.use("/api/stock",...n,ae("estoque"),R),e.use("/api/reports",...n,ae("relatorios"),At),e.use("/api/d\
elivery",...n,ae("delivery"),ve),e.use("/api/marketing",...n,ae("marketing"),re),e.use("/api/agent",...n,ae("agente"),xe),e.use("/api/reservations",...n,ae("salao"),lt),e.use("/api",
(o,s,i)=>i(new N(404,"Rota n\xE3o encontrada","not_found"))),e.use((o,s,i,r)=>{if(o instanceof N)return i.status(o.status).json({error:o.message,code:o.code,...o.extra||{}});if(o?.
type==="entity.parse.failed")return i.status(400).json({error:"JSON inv\xE1lido",code:"invalid"});if(o?.type==="entity.too.large")return i.status(413).json({error:"Requisi\xE7\xE3o muito\
 grande",code:"too_large"});if(o?.code==="22P02"||o?.code==="22003")return i.status(400).json({error:"Valor inv\xE1lido",code:"invalid"});if(o?.code==="23503")return i.status(400).
json({error:"Refer\xEAncia inv\xE1lida",code:"invalid_reference"});console.error(JSON.stringify({level:"error",msg:o?.message,path:s.path,method:s.method,code:o?.code})),i.status(500).
json({error:"Erro interno. Tente novamente.",code:"internal"})}),e}var xs=!P.EDGE_RUNTIME&&process.argv[1]&&vs(import.meta.url)===$s.resolve(process.argv[1]);if(xs){let e=Number(P.
PORT||3001);await it(),In().listen(e,()=>console.log(`RUSTEN API na porta ${e}`)),setInterval(()=>Ge().catch(()=>{}),6e4).unref()}var zn=null,Sn=ks();Sn.use(async(e,a,t)=>{try{zn??=it({log:n=>console.log(`[migrate] ${n}`)}).catch(n=>{throw zn=null,n}),await zn,t()}catch(n){console.error("[boot]",n.message),a.
status(503).json({error:"Servi\xE7o iniciando. Tente novamente em instantes."})}});Sn.use(P.PATH_PREFIX,In());Sn.listen(8e3);
