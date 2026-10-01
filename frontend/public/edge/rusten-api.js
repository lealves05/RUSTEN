// RUSTEN API — gerado por scripts/build-edge.mjs. Não editar à mão.
var Ua=Object.defineProperty;var Fa=(e,a,t)=>()=>{if(t)throw t[0];try{return e&&(a=e(e=0)),a}catch(n){throw t=[n],n}};var Ba=(e,a)=>{for(var t in a)Ua(e,t,{get:a[t],enumerable:!0})};var Bn={};Ba(Bn,{MIGRATIONS:()=>eo});var eo,Vn=Fa(()=>{eo=[{name:"001_base_pdv.sql",sql:`-- RUSTEN \u2014 001: base multiempresa, perfis, card\xE1pio, comandas/sess\xF5es, mesas, PDV, caixa, \
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
`}]});globalThis.__RUSTEN_ENV_DEFAULTS__={EDGE_RUNTIME:"1",NODE_ENV:"production",DB_SCHEMA:"rusten",DB_POOL_MAX:"3",PATH_PREFIX:"/rusten-api",CORS_ORIGINS:"*"};import _s from"npm:express@5.2.1";import Ea from"npm:express@5.2.1";import ds from"npm:helmet@8.3.0";import ms from"npm:cors@2.8.6";import us from"node:path";import{fileURLToPath as ls}from"node:url";import ft from"npm:pg@8.23.1";import Bt from"node:crypto";import{Buffer as jn}from"node:buffer";var Va=globalThis.__RUSTEN_ENV_DEFAULTS__||{},P=new Proxy({},{get:(e,a)=>{let t=typeof process<"u"?process.env[a]:void 0;return t!==void 0&&t!==""?t:Va[a]}});ft.types.setTypeParser(20,e=>Number(e));ft.types.setTypeParser(1700,e=>Number(e));ft.types.setTypeParser(1082,e=>e);var Ha=e=>/localhost|127\.0\.0\.1|\/tmp/.test(e||""),Ut=P.DATABASE_URL||
P.SUPABASE_DB_URL,Fe=new ft.Pool({connectionString:Ut,ssl:Ut&&!Ha(Ut)?{rejectUnauthorized:!1}:void 0,max:Number(P.DB_POOL_MAX||10)}),Ft=P.DB_SCHEMA;if(Ft){if(!/^[a-z_][a-z0-9_]*$/.
test(Ft))throw new Error("DB_SCHEMA inv\xE1lido");Fe.on("connect",e=>{e.query(`set search_path to ${Ft}, public`).catch(()=>{})})}var c=(e,a)=>Fe.query(e,a);async function $(e){let a=await Fe.
connect();try{await a.query("begin");let t=await e(a);return await a.query("commit"),t}catch(t){throw await a.query("rollback").catch(()=>{}),t}finally{a.release()}}var E=class extends Error{constructor(a,t,n,o){
super(t),this.status=a,this.code=n,this.extra=o}},y=(e,a="invalid")=>new E(400,e,a),T=(e="Sem permiss\xE3o para esta a\xE7\xE3o",a="forbidden")=>new E(403,e,a),b=(e="N\xE3o encontrado")=>new E(
404,e,"not_found"),g=(e,a="conflict",t)=>new E(409,e,a,t);function w(e,a){let t=e.safeParse(a??{});if(!t.success){let n=t.error.issues[0];throw y(`${n.path.join(".")||"dados"}: ${n.
message}`)}return t.data}var u=e=>(a,t,n)=>Promise.resolve(e(a,t,n)).catch(n);function tt(e,a,t=0,n=0){let o=Math.round(Number(a)*1e3),s=Math.round((e+t)*o/1e3);return Math.max(0,s-
n)}function In(e,a){let t=Math.floor(e/a),n=e-t*a;return Array.from({length:a},(o,s)=>t+(s<n?1:0))}function me(e,a="America/Sao_Paulo",t=5){let n=new Intl.DateTimeFormat("en-CA",{timeZone:a,
year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(e),o=i=>n.find(r=>r.type===i).value,s=new Date(Date.UTC(+o("year"),+o("month")-1,+o("day")));
return+o("hour")<t&&(s=new Date(s.getTime()-864e5)),s.toISOString().slice(0,10)}var Se=e=>Bt.createHash("sha256").update(String(e)).digest("hex"),te=(e=32)=>Bt.randomBytes(e).toString(
"base64url");function Vt(e,a){let t=jn.from(String(e)),n=jn.from(String(a));return t.length===n.length&&Bt.timingSafeEqual(t,n)}function Be(e){let a=e==null?"":String(e);return/^[=+\-@\t\r]/.
test(a)&&(a=`'${a}`),/[";\n]/.test(a)?`"${a.replace(/"/g,'""')}"`:a}import Wa from"node:crypto";import{Buffer as Ka}from"node:buffer";import Rn from"npm:jsonwebtoken@9.0.3";var De={"pdv.lancar":"Lan\xE7ar itens","pdv.lancamento_manual":"Lan\xE7amento manual (busca, cat\xE1logo, c\xF3digo digitado)","pdv.alterar_modo":"Trocar modo de leitura no PDV","p\
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
gerenciar":"Configurar o agente de atendimento","agente.atender":"Atender conversas da caixa de entrada"},Sn=Object.keys(De),zn=(...e)=>Sn.filter(a=>!e.includes(a)),Ht=[{key:"owner",
name:"Propriet\xE1rio",level:100,permissions:Sn},{key:"admin",name:"Administrador",level:90,permissions:zn("assinatura.gerenciar")},{key:"gerente",name:"Gerente",level:70,permissions:zn(
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
imediato",require_open_cash:!0,service_fee_bp:1e3,card_prefix:"CMD-"};import En from"node:crypto";import{Buffer as Nn}from"node:buffer";var Jt="rusten",qn=1,An="2026.10",Ga=300,Ja=300*1e3,Cn=0,Gt={at:0,v:null};async function ue(){if(Date.now()-Gt.at<6e4)return Gt.v;let e=P.PLATFORM_HUB_URL||"",a=P.PLATFORM_SECRET||
"",t=P.PLATFORM_PRODUCT||"";if(!e||!a)try{let{rows:o}=await c("select key, value from platform_config where key in ('platform_hub_url','platform_secret','platform_product')"),s=Object.
fromEntries(o.map(i=>[i.key,i.value]));e||=s.platform_hub_url||"",a||=s.platform_secret||"",t||=s.platform_product||""}catch{}let n=e&&a?{hub:e.replace(/\/+$/,""),secret:a,product:t||
Jt}:null;return Gt={at:Date.now(),v:n},n}var On=(e,a,t,n,o)=>En.createHmac("sha256",e).update(`${a}
${String(t).toUpperCase()}
${n}
${Se(o||"")}`).digest("hex");async function ge(e,a,t,n=1e4){let o=await ue();if(!o)throw new E(503,"A assinatura ainda n\xE3o est\xE1 configurada nesta instala\xE7\xE3o. Fale com o suporte.",
"platform_not_configured");if(!/^https:\/\//.test(o.hub)&&P.NODE_ENV==="production")throw new E(503,"Endere\xE7o da central deve usar HTTPS","platform_not_configured");let s=t===void 0?
"":JSON.stringify(t),i=Math.floor(Date.now()/1e3),r;try{r=await fetch(`${o.hub}/api/hub/v1${a}`,{method:e,signal:AbortSignal.timeout(n),headers:{"Content-Type":"application/json","\
X-Platform-Product":o.product,"X-Platform-Timestamp":String(i),"X-Platform-Signature":On(o.secret,i,e,a,s)},body:s||void 0})}catch{throw new E(503,"A central de assinaturas n\xE3o res\
pondeu. Tente novamente em instantes.","platform_unavailable")}let d=await r.json().catch(()=>({}));if(!r.ok)throw new E(r.status===401?502:r.status,d?.error||`Central: erro ${r.status}`,
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
consumptions_30d,revenue_30d:Number(t.revenue_30d_cents)/100}}:null}async function nt(e,a){await c("update companies set access = $2, access_updated_at = now() where id = $1",[e,a||
{}])}async function gt(e,a=1e4){if(!await ue())return null;let t=await ht(e);if(!t||t.is_demo)return null;let{is_demo:n,owner_email:o,...s}=t,i=await ge("POST","/tenants",s,a);return i?.
access&&await nt(e,i.access),i?.access||null}async function He(e,{fresh:a=!1}={}){if(!e||e.is_demo||!await ue())return null;let n=e.access_updated_at?Date.now()-new Date(e.access_updated_at).
getTime():1/0,o=e.access&&Object.keys(e.access).length;if(!a&&o&&n<Ja)return e.access;if(!a&&Date.now()<Cn)return o?e.access:null;try{let s=await ge("GET",`/tenants/${encodeURIComponent(
e.id)}/access`,void 0,4e3);return await nt(e.id,s.access),s.access}catch(s){if(s.status===404)try{return await gt(e.id,4e3)}catch{}else Cn=Date.now()+6e4;return o?e.access:null}}async function at(e,a,t,n={}){
await ue()&&await e.query("insert into platform_outbox (company_id, kind, payload) values ($1,$2,$3)",[a,t,n])}async function Ge(e=20){if(!await ue())return{sent:0,failed:0};let{rows:a}=await c(
"select * from platform_outbox where sent_at is null and attempts < 20 order by id limit $1",[e]),t=0,n=0;for(let o of a)try{(o.kind==="tenant.created"||o.kind==="tenant.updated")&&
await gt(o.company_id),await c("update platform_outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = $1",[o.id]),t++}catch(s){await c("update platform_\
outbox set attempts = attempts + 1, last_error = $2 where id = $1",[o.id,String(s.message).slice(0,300)]),n++}return{sent:t,failed:n}}async function Dn(e,a,t){try{let n=await ue(),
o=()=>new E(401,"Chamada da central n\xE3o autenticada.","bad_signature");if(!n)throw new E(503,"Liga\xE7\xE3o com a central n\xE3o configurada.","platform_not_configured");let s=Number(
e.headers["x-platform-timestamp"]),i=String(e.headers["x-platform-signature"]||"");if(String(e.headers["x-platform-product"]||"")!==n.product||!Number.isFinite(s)||!/^[0-9a-f]{64}$/.
test(i)||Math.abs(Date.now()/1e3-s)>Ga)throw o();let r=On(n.secret,s,e.method,e.url,e.rawBody||"");if(!En.timingSafeEqual(Nn.from(r),Nn.from(i)))throw o();if(!(await c("insert into\
 platform_nonces (nonce) values ($1) on conflict do nothing returning nonce",[i])).rows[0])throw new E(401,"Chamada repetida.","replay");await c("delete from platform_nonces where \
created_at < now() - interval '1 day'"),t()}catch(n){t(n)}}var Pn=Ve;var Za=P.NODE_ENV==="production",Mn=P.JWT_SECRET||P.SUPABASE_SERVICE_ROLE_KEY||(Za?null:"dev-only-rusten-secret-not-for-production");if(!Mn)throw new Error("JWT_SECRET \xE9 obrigat\xF3ri\
o em produ\xE7\xE3o");var ot=e=>Ka.from(Wa.hkdfSync("sha256",Mn,"rusten",e,32)),Ln=ot("access-token"),Qa=12*3600,Un=30;function Zt(e,a){return Rn.sign({sub:String(e.id),cid:String(
e.company_id),sid:a},Ln,{expiresIn:Qa,algorithm:"HS256"})}async function Fn(e,a){let{rows:t}=await c(`select u.id, u.company_id, u.unit_id, u.name, u.email, u.role_key, u.active, u\
.password_changed_at,
            r.name as role_name, r.level, r.permissions,
            c.name as company_name, c.segment, c.timezone, c.settings, c.access, c.access_updated_at, c.is_demo
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
       join companies c on c.id = u.company_id
      where u.id = $1 and u.company_id = $2`,[e,a]);return t[0]}function Ne(){return async(e,a,t)=>{try{let n=e.headers.authorization||"",o=n.startsWith("Bearer ")?n.slice(7):null;
if(!o)throw new E(401,"Sess\xE3o expirada. Entre novamente.","unauthenticated");let s;try{s=Rn.verify(o,Ln,{algorithms:["HS256"]})}catch{throw new E(401,"Sess\xE3o expirada. Entre nov\
amente.","unauthenticated")}let i=await Fn(Number(s.sub),Number(s.cid));if(!i||!i.active)throw new E(401,"Usu\xE1rio inativo","unauthenticated");let r=await c("select revoked_at fr\
om user_sessions where id = $1 and user_id = $2",[s.sid,i.id]);if(!r.rows[0]||r.rows[0].revoked_at)throw new E(401,"Sess\xE3o encerrada","unauthenticated");if(s.iat*1e3<new Date(i.
password_changed_at).getTime()-1e3)throw new E(401,"Senha alterada. Entre novamente.","unauthenticated");let d=await He({id:i.company_id,is_demo:i.is_demo,access:i.access,access_updated_at:i.
access_updated_at}),l={userId:i.id,companyId:i.company_id,unitId:i.unit_id,name:i.name,email:i.email,role:i.role_key,roleName:i.role_name,level:i.level,perms:new Set(i.permissions),
company:{id:i.company_id,name:i.company_name,segment:i.segment,timezone:i.timezone,settings:i.settings,is_demo:i.is_demo},access:i.is_demo?Kt(null,null,{demo:!0}):Kt(d??i.access,i.
access_updated_at),sessionId:s.sid,terminalId:null},m=Number(e.headers["x-terminal-id"]);if(m){let f=await c("select id, unit_id from terminals where id = $1 and company_id = $2 an\
d active",[m,l.companyId]);f.rows[0]&&(l.terminalId=f.rows[0].id,l.terminalUnitId=f.rows[0].unit_id)}l.can=f=>l.perms.has(f),e.ctx=l,t()}catch(n){t(n)}}}var p=(...e)=>(a,t,n)=>{let o=e.
find(s=>!a.ctx.can(s));if(o)return n(T(`Sem permiss\xE3o: ${o}`));n()};function J(e,a){if(!e.can(a))throw T(`Sem permiss\xE3o: ${a}`)}async function h(e,a,t,{entity:n,entityId:o,reason:s,
data:i,unitId:r}={}){await e.query(`insert into audit_events (company_id, unit_id, terminal_id, user_id, action, entity, entity_id, reason, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[a.companyId,r??a.terminalUnitId??a.unitId??null,a.terminalId??null,a.userId??null,t,n??null,o!=null?String(o):null,s??null,Wt(i??{})])}var Ya=/pass|senha|token|secret|segredo|hash|card_number|cvv/i;
function Wt(e){return Array.isArray(e)?e.map(Wt):e&&typeof e=="object"?Object.fromEntries(Object.entries(e).map(([a,t])=>[a,Ya.test(a)?"[omitido]":Wt(t)])):e}var Xa={ACTIVE:"Ativa",
TRIAL:"Em teste",PAYMENT_PENDING:"Aguardando pagamento",PAST_DUE:"Pagamento pendente",SUSPENDED:"Suspensa",CANCELED:"Cancelada",EXPIRED:"Expirada"},Tn={ADMINISTRATIVO:"O acesso des\
ta empresa foi bloqueado pela administra\xE7\xE3o da plataforma. Fale com o suporte.",TRIAL_EXPIRADO:"O per\xEDodo de teste terminou. Contrate um plano para continuar operando \u2014 seus \
dados est\xE3o preservados.",CANCELAMENTO:"A assinatura foi encerrada. Contrate novamente para voltar a operar \u2014 seus dados est\xE3o preservados.",FINANCEIRO:"Acesso suspenso \
por pend\xEAncia financeira. Regularize a assinatura \u2014 seus dados est\xE3o preservados."};function Kt(e,a,{demo:t=!1}={}){let n=e||{},o=Object.keys(Ve);if(t)return{allowed:!0,
state:"DEMO",label:"Demonstra\xE7\xE3o",modules:o,warning:null,notices:[],managed:!1,demo:!0};if(!Object.keys(n).length||typeof n.blocked!="boolean")return{allowed:!0,state:"sem_ce\
ntral",label:"Sem central",modules:o,warning:null,notices:[],managed:!1};let s=n.features&&typeof n.features=="object"?n.features:{},r=o.filter(m=>m in s).length?o.filter(m=>s[m]!==
!1):o,d=Array.isArray(n.notices)?n.notices.filter(m=>m&&m.text).map(m=>({level:m.level==="danger"?"danger":"warn",text:String(m.text)})):[],l=!!n.admin_blocked||n.reason==="ADMINIS\
TRATIVO";return{allowed:!n.blocked,state:n.status,label:Xa[n.status]||n.status,reasonCode:n.reason||null,reason:n.blocked?Tn[l?"ADMINISTRATIVO":n.reason]||Tn.FINANCEIRO:null,adminBlocked:l,
modules:r,notices:d,warning:d[0]?.text||null,plan:n.plan?.name||null,planId:n.plan?.id||null,cycle:n.cycle||null,validUntil:n.valid_until||null,trial:n.trial||null,support:n.support||
null,supportChannel:n.support_channel||null,managed:!0,updatedAt:a}}var ae=e=>(a,t,n)=>{let o=a.ctx.access;if(!o.allowed)return n(new E(402,o.reason,"access_blocked",{state:o.state}));
if(e&&!o.modules.includes(e))return n(T("M\xF3dulo n\xE3o inclu\xEDdo no plano","module_disabled"));n()};async function le(e,a,t){let{rows:n}=await c(`insert into rate_limits(key, \
count, reset_at) values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update set
       count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => $2) else rate_limits.reset_at end
     returning count`,[e,t]);if(n[0].count>a)throw new E(429,"Muitas tentativas. Aguarde alguns minutos.","rate_limited")}import Hn from"node:fs";import bt from"node:path";import{fileURLToPath as Jn}from"node:url";var Gn=import.meta.url.startsWith("file:")?bt.join(bt.dirname(Jn(import.meta.url)),"migrations"):"migrations";async function st({log:e=console.log}={}){let a=await Fe.connect();try{
await a.query("select pg_advisory_lock(424242)"),await a.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);let t=new Set((await a.query("select name from schema_migrations")).rows.map(o=>o.name)),n=P.EDGE_RUNTIME?
(await Promise.resolve().then(()=>(Vn(),Bn))).MIGRATIONS:Hn.readdirSync(Gn).filter(o=>/^\d+_.+\.sql$/.test(o)).sort().map(o=>({name:o,sql:null}));for(let{name:o,sql:s}of n){if(t.has(
o))continue;let i=s??Hn.readFileSync(bt.join(Gn,o),"utf8");await a.query("begin");try{await a.query(i),await a.query("insert into schema_migrations(name) values ($1)",[o]),await a.
query("commit"),e(`migra\xE7\xE3o aplicada: ${o}`)}catch(r){throw await a.query("rollback"),new Error(`falha na migra\xE7\xE3o ${o}: ${r.message}`)}}}finally{await a.query("select \
pg_advisory_unlock(424242)").catch(()=>{}),a.release()}}!P.EDGE_RUNTIME&&process.argv[1]&&Jn(import.meta.url)===bt.resolve(process.argv[1])&&st().then(()=>Fe.end()).catch(e=>{console.
error(e.message),process.exit(1)});import{Router as uo}from"npm:express@5.2.1";import Re from"npm:bcryptjs@3.0.3";import lo from"node:crypto";import{z as q}from"npm:zod@4.6.5";var to=["scanner_enabled","allow_manual","allow_manual_exception","allow_mode_change","open_free_card_on_scan"],no=["double_read_mandatory","exception_requires_manager","require_op\
en_cash"],ao=["max_qty_per_scan"];function Qt(e={},a={},t={}){let n=[wt,e||{},a||{},t||{}],o={...wt};for(let s of n.slice(1))for(let[i,r]of Object.entries(s))!(i in wt)||r===void 0||
r===null||(to.includes(i)?o[i]=o[i]&&!!r:no.includes(i)?o[i]=o[i]||!!r:ao.includes(i)?o[i]=Math.min(o[i],Number(r)):o[i]=r);return o.double_read_mandatory&&(o.mode="dupla"),o.scanner_enabled||
(o.mode="manual"),!o.scanner_enabled&&!o.allow_manual&&(o.allow_manual=!0),o.qty_per_scan=Math.min(Math.max(1,Number(o.qty_per_scan)||1),o.max_qty_per_scan),o}function Je(e){if(e.scanner_enabled===
!1&&e.allow_manual===!1)throw y("Configura\xE7\xE3o eliminaria todos os meios de lan\xE7amento: mantenha o leitor ou o lan\xE7amento manual.");if(e.mode&&!["manual","continua","dup\
la"].includes(e.mode))throw y("Modo inv\xE1lido");if(e.double_read_mandatory&&e.scanner_enabled===!1)throw y("Dupla leitura obrigat\xF3ria exige o leitor habilitado.");if(e.product_timeout_s!=
null&&(e.product_timeout_s<3||e.product_timeout_s>120))throw y("Tempo de espera do produto deve ficar entre 3 e 120 segundos")}async function Ce(e,a,t){let n=await e.query("select \
settings from companies where id = $1",[a.companyId]),o=t?await e.query("select settings from units where id = $1 and company_id = $2",[t,a.companyId]):{rows:[]},s=a.terminalId?await e.
query("select settings from terminals where id = $1",[a.terminalId]):{rows:[]};return Qt(n.rows[0]?.settings?.pdv,o.rows[0]?.settings?.pdv,s.rows[0]?.settings?.pdv)}var We=e=>String(
e??"").replace(/[\r\n\t]/g,"").trim();async function it(e,a,t){let n=We(t);if(!n)return{type:"DESCONHECIDO",code:n};if(n.length>128)return{type:"DESCONHECIDO",code:n.slice(0,128)};
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
DO",code:n}}return{type:s,code:n,id:i}}async function Pe(e,a,t,n,o){let s=We(t);if(!s)throw y("C\xF3digo vazio");if(s.length>128)throw y("C\xF3digo muito longo");let i=await e.query(
"select entity, entity_id from scan_codes where company_id = $1 and code = $2",[a,s]);if(i.rows[0]){if(i.rows[0].entity===n&&Number(i.rows[0].entity_id)===Number(o))return;throw g(
`C\xF3digo ${s} j\xE1 est\xE1 em uso (${i.rows[0].entity.toLowerCase()} ${i.rows[0].entity_id}). Cadastros amb\xEDguos n\xE3o s\xE3o permitidos.`,"code_in_use")}await e.query("inse\
rt into scan_codes (company_id, code, entity, entity_id) values ($1,$2,$3,$4)",[a,s,n,o])}var Wn=(e,a,t)=>`${e}${a>1?`${a}-`:""}${String(t).padStart(6,"0")}`;async function Z(e,a,t){
let{rows:n}=await e.query("select * from consumption_sessions where id = $1 and company_id = $2 for update",[t,a]);if(!n[0])throw b("Consumo n\xE3o encontrado");return n[0]}function Te(e){
if(e.status!=="aberta")throw g(`Consumo ${{em_fechamento:"em fechamento",encerrada:"encerrada",cancelada:"cancelada"}[e.status]||e.status}: n\xE3o aceita lan\xE7amentos`,"session_n\
ot_open")}function be(e,a){if(e.unitId&&Number(e.unitId)!==Number(a)&&e.level<90)throw T("Registro de outra unidade")}async function R(e,a){let t=await e.query("select service_fee_\
bp, delivery_fee_cents from consumption_sessions where id = $1",[a]),n=await e.query("select coalesce(sum(total_cents) filter (where status = 'ativo'), 0)::bigint as items from ord\
er_items where session_id = $1",[a]),o=await e.query("select coalesce(sum(amount_cents) filter (where status = 'confirmado'), 0)::bigint as paid from payments where session_id = $1",
[a]),s=Number(n.rows[0].items),i=Math.round(s*(t.rows[0]?.service_fee_bp||0)/1e4),r=Number(t.rows[0]?.delivery_fee_cents||0),d=s+i+r,l=Number(o.rows[0].paid);return{items:s,serviceFee:i,
serviceFeeBp:t.rows[0]?.service_fee_bp||0,deliveryFee:r,total:d,paid:l,balance:d-l}}async function Yt(e,a,t={}){let o=(await e.query("insert into units (company_id, name, day_cutoff) values ($1,$2,$3) returning id",[a,t.unit_name||"Matriz",t.day_cutoff??5])).rows[0].
id;await e.query("insert into terminals (company_id, unit_id, name) values ($1,$2,$3)",[a,o,"Caixa 1"]);let s={};for(let i of["Cozinha","Bar","Copa"]){let r=await e.query("insert i\
nto production_sectors (company_id, name) values ($1,$2) returning id",[a,i]);s[i]=r.rows[0].id}return await Xt(e,a,o,1,t.tables??10),await en(e,a,o,1,t.cards??50),t.demo&&await so(
e,a,s),{unitId:o,sectors:s}}async function Xt(e,a,t,n,o){let s=[];for(let i=n;i<n+o;i++){let r=await e.query(`insert into dining_tables (company_id, unit_id, number, pos_x, pos_y) \
values ($1,$2,$3,$4,$5)
       on conflict do nothing returning id`,[a,t,i,(i-1)%6,Math.floor((i-1)/6)]);r.rows[0]&&(await Pe(e,a,`MESA-${String(t).padStart(2,"0")}-${String(i).padStart(3,"0")}`,"MESA",r.
rows[0].id),s.push(r.rows[0].id))}return s}async function en(e,a,t,n,o,s="CMD-"){let i=(await e.query("select count(*)::int as n from units where company_id = $1 and id <= $2",[a,t])).
rows[0].n,r=[];for(let d=n;d<n+o;d++){let l=await e.query("insert into tab_cards (company_id, unit_id, number) values ($1,$2,$3) on conflict do nothing returning id, number",[a,t,d]);
if(l.rows[0]){let m=Wn(s,i,d);await Pe(e,a,m,"COMANDA",l.rows[0].id),r.push({...l.rows[0],code:m})}}return r}var oo=[["Cervejas","Bar",[["Cerveja IPA 600 ml",2890,"7890000000011"],
["Pilsen long neck",1290,"7890000000028"],["Chope 300 ml",1190,null]]],["Drinks","Bar",[["Caipirinha",2400,null],["Gin t\xF4nica",3200,null]]],["Lanches","Cozinha",[["Hamb\xFArguer da\
 oficina",3890,null],["Por\xE7\xE3o de fritas",2690,null]]],["Sem \xE1lcool","Bar",[["Refrigerante lata",700,"7890000000035"],["\xC1gua mineral",500,"7890000000042"]]]];async function so(e,a,t){
let n=0;for(let[o,s,i]of oo){let r=await e.query("insert into categories (company_id, name, sort, demo) values ($1,$2,$3,true) returning id",[a,`${o} (demonstra\xE7\xE3o)`,n++]);for(let[
d,l,m]of i){let f=await e.query(`insert into products (company_id, category_id, sector_id, name, price_cents, kind, demo, favorite, channels)
         values ($1,$2,$3,$4,$5,$6,true,$7,'{pdv,delivery,cardapio_digital}') returning id`,[a,r.rows[0].id,t[s],d,l,s==="Cozinha"?"recipe":"resale",n===1]);if(m&&await Pe(e,a,m,"P\
RODUTO",f.rows[0].id),d.startsWith("Hamb\xFArguer")){let _=await e.query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Ponto da\
 carne',1,1) returning id",[a,f.rows[0].id]);for(let j of["Mal passado","Ao ponto","Bem passado"])await e.query("insert into modifier_options (company_id, group_id, name) values ($\
1,$2,$3)",[a,_.rows[0].id,j]);let k=await e.query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Adicionais',0,3) returning id",
[a,f.rows[0].id]);for(let[j,S]of[["Bacon",600],["Queijo extra",400],["Ovo",300]])await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2\
,$3,$4)",[a,k.rows[0].id,j,S])}}}}async function Kn(e,a,t,n,o){let s=Object.fromEntries((await e.query("select id, name, price_cents, sector_id from products where company_id = $1",
[a])).rows.map(j=>[j.name,j])),i=(await e.query("select id from dining_tables where company_id = $1 and number = 3",[a])).rows[0],r=(await e.query("select id from tab_cards where c\
ompany_id = $1 order by number limit 3",[a])).rows,d=0,l=4,m=()=>(l=l===4?9:l===9?18:4,l);async function f(j,{tableId:S=null,cardId:A=null,label:D=null},M,L="aberta"){let fe=(await e.
query(`insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, label, status, service_fee_bp, opened_by, business_date,
                                         opened_at, closed_at, closed_by)
       values ($1,$2,$3,$4,$5,$6,$7,1000,$8,$9, now() - interval '90 minutes', case when $7 = 'encerrada' then now() - interval '20 minutes' end,
               case when $7 = 'encerrada' then $8::bigint end) returning id`,[a,t,j,A,S,D,L,n,o])).rows[0].id,we=0;for(let[B,ne,ze]of M){let he=s[B];if(!he)continue;let yt=he.price_cents*
ne;we+=yt,await e.query(`insert into order_items (company_id, session_id, product_id, description, qty, unit_price_cents, total_cents, sector_id,
                                  kitchen_status, launch_mode, user_id, idempotency_key, created_at, sent_at, accepted_at, ready_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11, now() - interval '${m()} minutes',
                 case when $9 <> 'nao_produz' then now() - interval '${m()} minutes' end,
                 case when $9 in ('aceito','preparando','pronto','entregue') then now() - interval '8 minutes' end,
                 case when $9 in ('pronto','entregue') then now() - interval '3 minutes' end)`,[a,fe,he.id,he.name,ne,he.price_cents,yt,he.sector_id,ze,n,`demo-${fe}-${++d}`])}return{
id:fe,total:we}}i&&(await f("mesa",{tableId:i.id,label:"Mesa 3"},[["Hamb\xFArguer da oficina",2,"preparando"],["Por\xE7\xE3o de fritas",1,"pronto"],["Chope 300 ml",4,"entregue"]]),
await e.query("update dining_tables set status = 'ocupada' where id = $1",[i.id])),r[0]&&await f("comanda",{cardId:r[0].id},[["Cerveja IPA 600 ml",2,"nao_produz"],["Caipirinha",1,"\
novo"]]),r[1]&&await f("comanda",{cardId:r[1].id},[["Gin t\xF4nica",2,"entregue"],["\xC1gua mineral",1,"nao_produz"]]);let _=await f("balcao",{label:"Balc\xE3o"},[["Pilsen long nec\
k",3,"nao_produz"],["Por\xE7\xE3o de fritas",1,"entregue"]],"encerrada"),k=_.total+Math.round(_.total*.1);await e.query(`insert into payments (company_id, session_id, method, amoun\
t_cents, business_date, idempotency_key, user_id, created_at)
     values ($1,$2,'pix',$3,$4,$5,$6, now() - interval '20 minutes')`,[a,_.id,k,o,`demo-pay-${_.id}`,n]),await io(e,a,t,n,_.id)}async function io(e,a,t,n,o){let s={loyalty:{enabled:!0,
cents_per_point:100,point_value_cents:5,validity_days:365,min_redeem:100},delivery:{enabled:!0,accepting:!0,delivery:!0,pickup:!0,fee_cents:700,min_order_cents:3e3,eta_minutes:40,hours:"\
Ter a dom, 18h \xE0s 0h",areas:"Centro, Vila Nova e Jardim",payment_methods:["dinheiro","pix","cartao"],message:"Chope em dobro at\xE9 as 20h!"},agent:{enabled:!1,name:"R\xFAstica",
greeting:"Ol\xE1! Sou a R\xFAstica, atendente virtual do bar. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* ou fazer uma *reserva*. Para falar com a\
 equipe, digite *atendente*.",handoff_message:"Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA.",closed_message:"No momento n\xE3o estamos recebendo pedidos.",reservation_max_people:12,
reservation_min_hours:2}};await e.query("update companies set slug = $2, settings = settings || $3::jsonb where id = $1",[a,`demo-${a}`,JSON.stringify(s)]);let i=String(new Date().
getMonth()+1).padStart(2,"0"),r={};for(let[f,_,k,j,S,A,D]of[["Ana Souza","52998224725","11988887777","1990-03-12",["vip","chope"],!0,120],["Bruno Lima","39053344705","11977776666",
`1987-${i}-21`,["anivers\xE1rio"],!0,0],["Carla Dias",null,"11966665555","1995-08-02",[],!1,0]]){let M=await e.query(`insert into customers (company_id, cpf, name, phone, birthday,\
 tags, consent_whatsapp, consent_at, created_by)
      values ($1,$2,$3,$4,$5,$6,$7, case when $7 then now() end, $8) returning id`,[a,_,f,k,j,S,A,n]);r[f]=M.rows[0].id,D&&(await e.query("insert into loyalty_ledger (company_id, c\
ustomer_id, kind, points, expires_at, reason, user_id) values ($1,$2,'ganho',$3, current_date + 365, 'Consumos anteriores', $4)",[a,M.rows[0].id,D,n]),await e.query("update custome\
rs set points = $2 where id = $1",[M.rows[0].id,D]))}await e.query("update consumption_sessions set customer_id = $2, customer_name = $3 where id = $1",[o,r["Bruno Lima"],"Bruno Li\
ma"]);let d=(await e.query("select id from consumption_sessions where company_id = $1 and kind = 'mesa' limit 1",[a])).rows[0];d&&await e.query("update consumption_sessions set cus\
tomer_id = $2, customer_name = $3 where id = $1",[d.id,r["Ana Souza"],"Ana Souza"]),await e.query("insert into reviews (company_id, session_id, customer_id, score, comment) values \
($1,$2,$3,5,$4)",[a,o,r["Bruno Lima"],"Chope gelado e atendimento r\xE1pido!"]);let l={};for(let[f,_,k,j,S]of[["Carne mo\xEDda","kg",8,3200,2],["P\xE3o brioche","un",40,150,12],["B\
atata congelada","kg",12,900,4],["Pilsen long neck (garrafa)","un",48,450,24],["Chope (barril)","L",30,1200,10],["Lim\xE3o","kg",1.5,600,3],["Cacha\xE7a","L",4,2500,1]]){let A=await e.
query("insert into stock_items (company_id, name, unit, min_qty, reorder_qty, avg_cost_cents) values ($1,$2,$3,$4,$5,$6) returning id",[a,f,_,S,S*3,j]);l[f]=A.rows[0].id,await e.query(
"insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, reason, user_id) values ($1,$2,'entrada',$3,$4,'saldo_inicial','Saldo inicial',$5)",[
a,A.rows[0].id,k,j,n])}let m=Object.fromEntries((await e.query("select id, name from products where company_id = $1",[a])).rows.map(f=>[f.name,f.id]));for(let[f,_,k]of[["Hamb\xFArguer\
 da oficina",[["Carne mo\xEDda",.18],["P\xE3o brioche",1]],726],["Por\xE7\xE3o de fritas",[["Batata congelada",.4]],360],["Chope 300 ml",[["Chope (barril)",.3]],360],["Caipirinha",
[["Lim\xE3o",.12],["Cacha\xE7a",.06]],222]]){if(!m[f])continue;let j=await e.query("insert into recipes (company_id, product_id, version, yield_qty, created_by) values ($1,$2,1,1,$\
3) returning id",[a,m[f],n]);for(let[S,A]of _)await e.query("insert into recipe_lines (company_id, recipe_id, stock_item_id, qty) values ($1,$2,$3,$4)",[a,j.rows[0].id,l[S],A]);await e.
query("update products set stock_mode = 'ficha', cost_cents = $2 where id = $1",[m[f],k])}m["Pilsen long neck"]&&await e.query("update products set stock_mode = 'acabado', stock_it\
em_id = $2, cost_cents = 450 where id = $1",[m["Pilsen long neck"],l["Pilsen long neck (garrafa)"]]);for(let[f,_,k,j,S,A]of[["Diego Martins","11955554444",6,21,"confirmada","equipe"],
["Fernanda Alves","11944443333",4,22,"pendente","agente"]])await e.query(`insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source)
      values ($1,$2,$3,$4,$5, date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' + make_interval(hours => $6), $7, $8)`,[a,t,f,_,k,j,S,A])}var Zn=[{value:"manual",label:"Manual (toque/busca)"},{value:"continua",label:"Leitura cont\xEDnua"},{value:"dupla",label:"Dupla leitura (comanda \u2192 produto)"}],ro=["America/Sa\
o_Paulo","America/Manaus","America/Cuiaba","America/Belem","America/Fortaleza","America/Recife","America/Bahia","America/Porto_Velho","America/Rio_Branco","America/Noronha"].map(e=>({
value:e,label:e.replace("America/","").replace("_"," ")})),tn=[{key:"signup_enabled",label:"Novos cadastros abertos",type:"boolean",group:"Cadastro e demonstra\xE7\xE3o",default:!0,
help:'Desligado, a tela "Criar conta" do RUSTEN fica fechada (empresas existentes seguem normalmente).'},{key:"demo_enabled",label:'Bot\xE3o "Experimentar demonstra\xE7\xE3o" no login',
type:"boolean",group:"Cadastro e demonstra\xE7\xE3o",default:!0},{key:"demo_days",label:"Dias at\xE9 apagar demonstra\xE7\xF5es n\xE3o ativadas",type:"number",group:"Cadastro e dem\
onstra\xE7\xE3o",min:1,max:30,step:1,unit:"dias",default:7},{key:"default_mode",label:"Modo do PDV em empresas novas",type:"select",group:"Padr\xF5es de empresas novas",options:Zn,
default:"manual"},{key:"default_service_fee",label:"Taxa de servi\xE7o padr\xE3o",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:30,step:.5,unit:"%",default:10},{key:"\
default_tables",label:"Mesas criadas no cadastro",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:300,step:1,default:10},{key:"default_cards",label:"Cart\xF5es de comanda\
 criados no cadastro",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:2e3,step:1,default:50},{key:"default_day_cutoff",label:"Virada do dia comercial",type:"number",group:"\
Padr\xF5es de empresas novas",min:0,max:12,step:1,unit:"h",default:5,help:"Vendas antes deste hor\xE1rio contam no dia anterior."},{key:"notice_text",label:"Aviso para todos os usu\
\xE1rios",type:"textarea",group:"Comunica\xE7\xE3o",max:300,default:"",help:"Exibido no topo do RUSTEN para todas as empresas. Deixe vazio para n\xE3o mostrar."},{key:"notice_level",
label:"Tipo do aviso",type:"select",group:"Comunica\xE7\xE3o",default:"info",options:[{value:"info",label:"Informativo"},{value:"warn",label:"Aten\xE7\xE3o"}]}],Qn=[{key:"name",label:"\
Nome da empresa",type:"text",group:"Empresa",max:120},{key:"timezone",label:"Fuso hor\xE1rio",type:"select",group:"Empresa",options:ro},{key:"pdv_mode",label:"Modo padr\xE3o do PDV",
type:"select",group:"PDV e leitor",options:Zn},{key:"pdv_scanner_enabled",label:"Leitor de c\xF3digo habilitado",type:"boolean",group:"PDV e leitor"},{key:"pdv_double_read_mandator\
y",label:"Dupla leitura obrigat\xF3ria",type:"boolean",group:"PDV e leitor",help:"Exige ler a comanda e depois o produto em cada item; s\xF3 exce\xE7\xE3o autorizada sai dela."},{key:"\
pdv_allow_manual",label:"Permitir lan\xE7amento manual",type:"boolean",group:"PDV e leitor"},{key:"pdv_exception_requires_manager",label:"Exce\xE7\xE3o \xE0 dupla leitura exige gerente",
type:"boolean",group:"PDV e leitor"},{key:"pdv_product_timeout_s",label:"Tempo para ler o produto ap\xF3s a comanda",type:"number",group:"PDV e leitor",min:3,max:120,step:1,unit:"s"},
{key:"pdv_require_open_cash",label:"Exigir caixa aberto para receber",type:"boolean",group:"Caixa e cobran\xE7a"},{key:"pdv_service_fee",label:"Taxa de servi\xE7o",type:"number",group:"\
Caixa e cobran\xE7a",min:0,max:30,step:.5,unit:"%"},{key:"pdv_card_prefix",label:"Prefixo dos cart\xF5es de comanda",type:"text",group:"Caixa e cobran\xE7a",max:8,help:"Letras mai\xFA\
sculas, n\xFAmeros e h\xEDfen."}],co=({default:e,...a})=>a,Yn=()=>({system:tn.map(co),tenant:Qn});function mo(e,a){if(a!=null)switch(e.type){case"boolean":if(typeof a!="boolean")throw y(
`${e.label}: valor inv\xE1lido`);return a;case"number":{let t=Number(a);if(!Number.isFinite(t)||e.min!=null&&t<e.min||e.max!=null&&t>e.max)throw y(`${e.label}: use um valor entre ${e.
min} e ${e.max}`);return t}case"select":if(!e.options.some(t=>t.value===a))throw y(`${e.label}: op\xE7\xE3o inv\xE1lida`);return a;default:{let t=String(a).trim();if(e.max&&t.length>
e.max)throw y(`${e.label}: m\xE1ximo de ${e.max} caracteres`);return t}}}function Xn(e,a){if(!a||typeof a!="object"||Array.isArray(a))throw y('Envie os par\xE2metros em "values"');
let t={};for(let[n,o]of Object.entries(a)){let s=e.find(r=>r.key===n);if(!s)throw y(`Par\xE2metro desconhecido: ${n}`);let i=mo(s,o);i!==void 0&&(t[n]=i)}return t}var rt={at:0,v:null};
async function Ee(){if(rt.v&&Date.now()-rt.at<3e4)return rt.v;let e=Object.fromEntries(tn.map(a=>[a.key,a.default]));try{let{rows:a}=await c("select key, value from system_settings");
for(let t of a)t.key in e&&(e[t.key]=t.value)}catch{}return rt={at:Date.now(),v:e},e}async function ea(e){let a=Xn(tn,e);for(let[t,n]of Object.entries(a))await c(`insert into syste\
m_settings (key, value, updated_at) values ($1, $2::jsonb, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`,[t,JSON.stringify(n)]);return rt.at=0,Ee()}var ta={pdv_mode:"mode",pdv_scanner_enabled:"sca\
nner_enabled",pdv_double_read_mandatory:"double_read_mandatory",pdv_allow_manual:"allow_manual",pdv_exception_requires_manager:"exception_requires_manager",pdv_product_timeout_s:"p\
roduct_timeout_s",pdv_require_open_cash:"require_open_cash",pdv_card_prefix:"card_prefix"};async function nn(e){let{rows:a}=await c("select name, timezone, settings from companies \
where id = $1",[e]),t=a[0];if(!t)return null;let n=t.settings?.pdv||{},o={name:t.name,timezone:t.timezone};for(let[s,i]of Object.entries(ta))o[s]=n[i]??null;return o.pdv_service_fee=
n.service_fee_bp!=null?n.service_fee_bp/100:null,o}async function na(e,a,t){let n=Xn(Qn,t);if(n.pdv_card_prefix!=null&&!/^[A-Z0-9-]{1,8}$/.test(n.pdv_card_prefix))throw y("Prefixo \
dos cart\xF5es: use letras mai\xFAsculas, n\xFAmeros e h\xEDfen (at\xE9 8)");if(n.name!=null&&n.name.length<2)throw y("Nome da empresa muito curto");let o={};for(let[r,d]of Object.
entries(ta))r in n&&(o[d]=n[r]);"pdv_service_fee"in n&&(o.service_fee_bp=Math.round(n.pdv_service_fee*100));let i={...(await e.query("select settings from companies where id = $1 f\
or update",[a])).rows[0]?.settings?.pdv||{},...o};return Je(i),await e.query(`update companies set name = coalesce($2, name), timezone = coalesce($3, timezone),
                    settings = jsonb_set(settings, '{pdv}', $4::jsonb) where id = $1`,[a,n.name??null,n.timezone??null,JSON.stringify(i)]),n}var pe=uo(),po=["12345678","senha123","password","qwerty","123456789","rusten123","abc12345"];function Ke(e){if(e.length<10)throw y("A senha precisa ter pelo menos 10 caracteres");
if(!/[a-zA-Z]/.test(e)||!/\d/.test(e))throw y("A senha precisa ter letras e n\xFAmeros");if(po.some(a=>e.toLowerCase().includes(a)))throw y("Senha muito comum")}var _o=["bar","rest\
aurante","lanchonete","cafeteria","pub","food_truck","hamburgueria","pizzaria","padaria","outro"],yo=q.object({company:q.object({name:q.string().trim().min(2).max(120),segment:q.enum(
_o).default("restaurante"),document:q.string().trim().max(20).optional(),phone:q.string().trim().max(30).optional(),email:q.string().trim().email().max(160).optional(),address:q.object(
{street:q.string().max(160).optional(),city:q.string().max(80).optional(),state:q.string().max(2).optional(),zip:q.string().max(10).optional()}).partial().optional()}),owner:q.object(
{name:q.string().trim().min(2).max(120),email:q.string().trim().toLowerCase().email().max(160),password:q.string().min(1).max(200)}),accept_terms:q.literal(!0,{message:"\xC9 preciso a\
ceitar os termos"}),plan:q.object({code:q.string().max(60).optional(),cycle:q.enum(["mensal","anual"]).optional(),trial:q.boolean().optional()}).optional(),setup:q.object({unit_name:q.
string().trim().max(80).optional(),tables:q.number().int().min(0).max(300).default(10),cards:q.number().int().min(0).max(2e3).default(50),mode:q.enum(["manual","continua","dupla"]).
default("manual"),demo:q.boolean().default(!1),day_cutoff:q.number().int().min(0).max(12).default(5)}).default({})});pe.post("/register",u(async(e,a)=>{let t=await Ee();if(P.ALLOW_SIGNUP===
"false"||t.signup_enabled===!1)throw new E(403,"Novos cadastros est\xE3o temporariamente fechados","signup_closed");await le(`register:${e.ip}`,10,3600);let n=w(yo,e.body);if(Ke(n.
owner.password),(await c("select 1 from users where lower(email) = $1",[n.owner.email])).rows[0])throw new E(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.',
"email_taken");let s=await Re.hash(n.owner.password,12),i=await $(async d=>{let m=(await d.query(`insert into companies (name, segment, document, phone, email, address, settings)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,[n.company.name,n.company.segment,n.company.document??null,n.company.phone??null,n.company.email??n.owner.email,n.company.address??
{},{pdv:{mode:n.setup.mode,service_fee_bp:Math.round(Number(t.default_service_fee??10)*100)},plan_request:n.plan??null}])).rows[0].id;for(let k of Ht)await d.query("insert into rol\
es (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",[m,k.key,k.name,k.level,k.permissions]);let f=await d.query("insert into users (company_id, nam\
e, email, password_hash, role_key) values ($1,$2,$3,$4,'owner') returning id",[m,n.owner.name,n.owner.email,s]),_={companyId:m,userId:f.rows[0].id};return await Yt(d,m,n.setup),await h(
d,_,"empresa.cadastrada",{entity:"company",entityId:m,data:{segment:n.company.segment,plan:n.plan??null}}),await at(d,m,"tenant.created"),{companyId:m,userId:f.rows[0].id}});try{await gt(
i.companyId,4e3)&&await c("update platform_outbox set sent_at = now() where company_id = $1 and sent_at is null",[i.companyId])}catch{}let r=await $t({id:i.userId,company_id:i.companyId},
e);a.status(201).json(r)}));async function $t(e,a){let t=lo.randomUUID(),n=te(48);return await c(`insert into user_sessions (id, user_id, refresh_hash, expires_at, ip)
           values ($1,$2,$3, now() + make_interval(days => $4), $5)`,[t,e.id,Se(n),Un,a.ip]),{access_token:Zt(e,t),refresh_token:`${t}.${n}`}}var fo,wo=()=>fo||=Re.hashSync("dummy-\
password-for-timing",12);pe.get("/plans",u(async(e,a)=>{let t=await Ee(),n={signup_open:P.ALLOW_SIGNUP!=="false"&&t.signup_enabled!==!1,demo_enabled:t.demo_enabled!==!1,defaults:{mode:t.
default_mode,tables:t.default_tables,cards:t.default_cards,day_cutoff:t.default_day_cutoff}};if(!await ue())return a.json({...n,hub:!1,plans:[]});try{let o=await ge("GET","/plans",
void 0,5e3);a.json({...n,hub:!0,plans:o.plans||[],trial_default:o.trial_default||null,signup_open:n.signup_open&&o.signup_enabled!==!1})}catch{a.json({...n,hub:!0,plans:[],unavailable:!0})}}));
pe.post("/demo",u(async(e,a)=>{let t=await Ee();if(t.demo_enabled===!1)throw new E(403,"A demonstra\xE7\xE3o est\xE1 desativada no momento.","demo_disabled");await le(`demo:${e.ip}`,
10,3600);let n=await c("select id from companies where is_demo and created_at < now() - make_interval(days => $1) limit 20",[Number(t.demo_days)||7]);for(let i of n.rows)await $(r=>r.
query("select purge_demo_company($1)",[i.id])).catch(()=>{});let o=te(6).toLowerCase().replace(/[^a-z0-9]/g,"x"),s=await $(async i=>{let r=await i.query("insert into companies (nam\
e, segment, email, settings, is_demo) values ('Bar Demonstra\xE7\xE3o', 'bar', null, $1, true) returning id, timezone",[{pdv:{mode:"manual",service_fee_bp:1e3}}]),d=r.rows[0].id;for(let f of Ht)
await i.query("insert into roles (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",[d,f.key,f.name,f.level,f.permissions]);let l=await i.query("inse\
rt into users (company_id, name, email, password_hash, role_key) values ($1,'Visitante',$2,$3,'owner') returning id",[d,`demo-${o}@demo.rusten.app`,await Re.hash(te(24),8)]),{unitId:m}=await Yt(
i,d,{unit_name:"Matriz",tables:12,cards:30,demo:!0,day_cutoff:5});return await Kn(i,d,m,l.rows[0].id,me(new Date,r.rows[0].timezone,5)),await h(i,{companyId:d,userId:l.rows[0].id},
"demonstracao.criada",{entity:"company",entityId:d}),{companyId:d,userId:l.rows[0].id}});a.status(201).json(await $t({id:s.userId,company_id:s.companyId},e))}));pe.post("/activate",
Ne(),u(async(e,a)=>{let t=w(q.object({company_name:q.string().trim().min(2).max(120),name:q.string().trim().min(2).max(120),email:q.string().trim().toLowerCase().email().max(160),password:q.
string().min(1).max(200),phone:q.string().trim().max(30).optional(),keep_data:q.boolean().default(!1),accept_terms:q.literal(!0,{message:"\xC9 preciso aceitar os termos"})}),e.body);
if(e.ctx.role!=="owner")throw new E(403,"S\xF3 o propriet\xE1rio pode ativar o sistema.","forbidden");if(!e.ctx.company.is_demo)throw y("Esta empresa j\xE1 est\xE1 em uso normal.");
let n=await Ee();if(P.ALLOW_SIGNUP==="false"||n.signup_enabled===!1)throw new E(403,"Novos cadastros est\xE3o temporariamente fechados","signup_closed");if(Ke(t.password),(await c(
"select 1 from users where lower(email) = $1 and id <> $2",[t.email,e.ctx.userId])).rows[0])throw new E(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.',
"email_taken");let s=e.ctx.companyId;await $(async i=>{if(!t.keep_data){await i.query("select set_config('rusten.purge_demo', $1, true)",[String(s)]);for(let r of["delete from revi\
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
userId]),await h(i,e.ctx,"demonstracao.ativada",{entity:"company",entityId:s,data:{keep_data:t.keep_data}}),await at(i,s,"tenant.created")});try{await Ge(5)}catch{}a.json(await $t(
{id:e.ctx.userId,company_id:s},e))}));pe.post("/login",u(async(e,a)=>{let t=w(q.object({email:q.string().trim().toLowerCase().max(160),password:q.string().max(200)}),e.body);await le(
`login:${e.ip}`,30,900),await le(`login-user:${t.email}`,15,900);let{rows:n}=await c("select * from users where lower(email) = $1",[t.email]),o=n[0],s=await Re.compare(t.password,o?.
password_hash||wo()),i=new E(401,"E-mail ou senha incorretos","bad_credentials");if(!o||!o.active)throw i;if(o.locked_until&&new Date(o.locked_until)>new Date)throw new E(423,"Cont\
a bloqueada temporariamente por tentativas inv\xE1lidas. Tente em 15 minutos.","locked");if(!s)throw await c(`update users set failed_attempts = failed_attempts + 1,
               locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
             where id = $1`,[o.id]),await h({query:c},{companyId:o.company_id,userId:o.id},"login.falhou",{entity:"user",entityId:o.id}),i;await c("update users set failed_attempts\
 = 0, locked_until = null where id = $1",[o.id]),await c("update companies set last_access_at = now() where id = $1",[o.company_id]),await h({query:c},{companyId:o.company_id,userId:o.
id},"login",{entity:"user",entityId:o.id}),a.json(await $t(o,e))}));pe.post("/refresh",u(async(e,a)=>{let t=String(e.body?.refresh_token||""),[n,o]=t.split(".");if(!n||!o||!/^[0-9a-f-]{36}$/.
test(n))throw new E(401,"Sess\xE3o inv\xE1lida","unauthenticated");let s=await $(async i=>{let{rows:r}=await i.query("select s.*, u.company_id, u.active from user_sessions s join u\
sers u on u.id = s.user_id where s.id = $1 for update of s",[n]),d=r[0];if(!d||d.revoked_at||new Date(d.expires_at)<new Date||!d.active)throw new E(401,"Sess\xE3o expirada","unauth\
enticated");if(d.refresh_hash!==Se(o))return await i.query("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[d.user_id]),await h(i,{companyId:d.
company_id,userId:d.user_id},"sessao.reuso_detectado",{entity:"user",entityId:d.user_id}),null;let l=te(48);return await i.query("update user_sessions set refresh_hash = $2, rotate\
d_at = now() where id = $1",[n,Se(l)]),{access_token:Zt({id:d.user_id,company_id:d.company_id},n),refresh_token:`${n}.${l}`}});if(!s)throw new E(401,"Sess\xE3o encerrada por seguran\xE7a\
. Entre novamente.","unauthenticated");a.json(s)}));pe.post("/logout",Ne(),u(async(e,a)=>{e.body?.all===!0?await c("update user_sessions set revoked_at = now() where user_id = $1 a\
nd revoked_at is null",[e.ctx.userId]):await c("update user_sessions set revoked_at = now() where id = $1",[e.ctx.sessionId]),a.json({ok:!0})}));pe.post("/password",Ne(),u(async(e,a)=>{
let t=w(q.object({current:q.string().max(200),next:q.string().max(200)}),e.body);Ke(t.next);let{rows:n}=await c("select password_hash from users where id = $1",[e.ctx.userId]);if(!await Re.
compare(t.current,n[0].password_hash))throw y("Senha atual incorreta");await c("update users set password_hash = $2, password_changed_at = now() where id = $1",[e.ctx.userId,await Re.
hash(t.next,12)]),await c("update user_sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null",[e.ctx.userId,e.ctx.sessionId]),await h({query:c},e.ctx,
"senha.alterada",{entity:"user",entityId:e.ctx.userId}),a.json({ok:!0})}));pe.get("/me",Ne(),u(async(e,a)=>{let t=e.ctx,n=await c("select id, name, day_cutoff from units where comp\
any_id = $1 and active order by id",[t.companyId]),o=t.terminalUnitId||t.unitId||n.rows[0]?.id;a.json({user:{id:t.userId,name:t.name,email:t.email,role:t.role,roleName:t.roleName,level:t.
level,unitId:t.unitId},company:t.company,permissions:[...t.perms],access:t.access,units:n.rows,unitId:o,terminalId:t.terminalId,pdv:await Ce({query:c},t,o),catalog:{permissions:De,
modules:Ve},notice:await ho()})}));async function ho(){let e=await Ee();return e.notice_text?{text:e.notice_text,level:e.notice_level==="warn"?"warn":"info"}:null}import{Router as go}from"npm:express@5.2.1";import an from"npm:bcryptjs@3.0.3";import{z as v}from"npm:zod@4.6.5";var H=go();async function aa(e,a){let t=await c("select level from roles where company_id = $1 and key = $2",[e,a]);if(!t.rows[0])throw y("Perfil inexistente");return t.rows[0].level}
H.get("/users",p("usuarios.gerenciar"),u(async(e,a)=>{let{rows:t}=await c(`select u.id, u.name, u.email, u.role_key, r.name as role_name, r.level, u.unit_id, u.active, u.created_at\
,
            u.locked_until > now() as locked
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by r.level desc, u.name`,[e.ctx.companyId]);a.json(t)}));var oa=v.object({name:v.string().trim().min(2).max(120),email:v.string().trim().toLowerCase().
email().max(160),password:v.string().max(200).optional(),role_key:v.string().max(40),unit_id:v.number().int().nullable().optional(),active:v.boolean().optional()});H.post("/users",
p("usuarios.gerenciar"),u(async(e,a)=>{let t=w(oa,e.body);if(await aa(e.ctx.companyId,t.role_key)>e.ctx.level)throw T("N\xE3o \xE9 poss\xEDvel criar usu\xE1rio com perfil acima do seu");
if(!t.password)throw y("Informe a senha inicial");if(Ke(t.password),t.unit_id&&await on(e.ctx.companyId,t.unit_id),(await c("select 1 from users where lower(email) = $1",[t.email])).
rows[0])throw g("E-mail j\xE1 cadastrado");let o=await c("insert into users (company_id, name, email, password_hash, role_key, unit_id) values ($1,$2,$3,$4,$5,$6) returning id",[e.
ctx.companyId,t.name,t.email,await an.hash(t.password,12),t.role_key,t.unit_id??null]);await h({query:c},e.ctx,"usuario.criado",{entity:"user",entityId:o.rows[0].id,data:{role:t.role_key}}),
await at({query:c},e.ctx.companyId,"tenant.updated"),a.status(201).json({id:o.rows[0].id})}));H.put("/users/:id",p("usuarios.gerenciar"),u(async(e,a)=>{let t=Number(e.params.id),n=w(
oa.partial(),e.body),s=(await c(`select u.*, r.level from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                       where u.id = $1 and u.company_id = $2`,[t,e.ctx.companyId])).rows[0];if(!s)throw b("Usu\xE1rio n\xE3o encontrado");if(s.level>e.ctx.level||s.level===e.ctx.level&&
s.id!==e.ctx.userId&&e.ctx.role!=="owner")throw T("N\xE3o \xE9 poss\xEDvel alterar usu\xE1rio de n\xEDvel igual ou superior");if(n.role_key&&await aa(e.ctx.companyId,n.role_key)>e.
ctx.level)throw T("Perfil acima do seu");if(s.role_key==="owner"&&n.role_key&&n.role_key!=="owner"&&(await c("select count(*)::int n from users where company_id = $1 and role_key =\
 'owner' and active",[e.ctx.companyId])).rows[0].n<=1)throw y("A empresa precisa de ao menos um propriet\xE1rio ativo");n.unit_id&&await on(e.ctx.companyId,n.unit_id);let i=null;n.
password&&(Ke(n.password),i=await an.hash(n.password,12)),await c(`update users set name = coalesce($3, name), email = coalesce($4, email), role_key = coalesce($5, role_key),
             unit_id = case when $6::boolean then $7 else unit_id end, active = coalesce($8, active),
             password_hash = coalesce($9, password_hash),
             password_changed_at = case when $9 is not null then now() else password_changed_at end
           where id = $1 and company_id = $2`,[t,e.ctx.companyId,n.name??null,n.email??null,n.role_key??null,"unit_id"in n,n.unit_id??null,n.active??null,i]),(n.active===!1||i)&&await c(
"update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[t]),await h({query:c},e.ctx,"usuario.alterado",{entity:"user",entityId:t,data:{...n,password:n.
password?"alterada":void 0}}),a.json({ok:!0})}));H.get("/roles",p("usuarios.gerenciar"),u(async(e,a)=>{let{rows:t}=await c("select key, name, level, permissions, system from roles \
where company_id = $1 order by level desc",[e.ctx.companyId]);a.json({roles:t,catalog:De})}));H.put("/roles/:key",p("usuarios.gerenciar"),u(async(e,a)=>{let t=w(v.object({name:v.string().
trim().min(2).max(60).optional(),permissions:v.array(v.string()).max(200).optional(),level:v.number().int().min(1).max(99).optional()}),e.body),n=(await c("select * from roles wher\
e company_id = $1 and key = $2",[e.ctx.companyId,e.params.key])).rows[0];if(!n)throw b("Perfil n\xE3o encontrado");if(n.key==="owner")throw T("O perfil Propriet\xE1rio n\xE3o pode ser al\
terado");if(n.level>=e.ctx.level)throw T("S\xF3 \xE9 poss\xEDvel alterar perfis abaixo do seu n\xEDvel");if(t.level&&t.level>=e.ctx.level)throw T("N\xEDvel acima do seu");if(t.permissions){
let o=t.permissions.find(i=>!(i in De));if(o)throw y(`Permiss\xE3o inv\xE1lida: ${o}`);let s=t.permissions.find(i=>!e.ctx.can(i));if(s)throw T(`Voc\xEA n\xE3o pode conceder o que n\xE3o tem\
: ${s}`)}await c("update roles set name = coalesce($3,name), permissions = coalesce($4,permissions), level = coalesce($5,level) where company_id = $1 and key = $2",[e.ctx.companyId,
n.key,t.name??null,t.permissions??null,t.level??null]),await h({query:c},e.ctx,"perfil.alterado",{entity:"role",entityId:n.key,data:{before:n.permissions,after:t.permissions}}),a.json(
{ok:!0})}));H.post("/roles",p("usuarios.gerenciar"),u(async(e,a)=>{let t=w(v.object({name:v.string().trim().min(2).max(60),level:v.number().int().min(1).max(99),permissions:v.array(
v.string()).max(200)}),e.body);if(t.level>=e.ctx.level)throw T("N\xEDvel acima do seu");let n=t.permissions.find(s=>!(s in De)||!e.ctx.can(s));if(n)throw T(`Permiss\xE3o inv\xE1lida ou n\
\xE3o conced\xEDvel: ${n}`);let o=`custom_${te(4).toLowerCase().replace(/[^a-z0-9]/g,"x")}`;await c("insert into roles (company_id, key, name, level, permissions) values ($1,$2,$3,\
$4,$5)",[e.ctx.companyId,o,t.name,t.level,t.permissions]),await h({query:c},e.ctx,"perfil.criado",{entity:"role",entityId:o,data:t}),a.status(201).json({key:o})}));async function on(e,a){
if(!(await c("select id from units where id = $1 and company_id = $2",[a,e])).rows[0])throw y("Unidade inv\xE1lida")}H.get("/units",u(async(e,a)=>{a.json((await c("select id, name,\
 active, day_cutoff, settings from units where company_id = $1 order by id",[e.ctx.companyId])).rows)}));H.post("/units",p("configuracoes.gerenciar"),u(async(e,a)=>{let t=w(v.object(
{name:v.string().trim().min(2).max(80),day_cutoff:v.number().int().min(0).max(12).default(5)}),e.body),n=await c("insert into units (company_id, name, day_cutoff) values ($1,$2,$3)\
 returning id",[e.ctx.companyId,t.name,t.day_cutoff]);await h({query:c},e.ctx,"unidade.criada",{entity:"unit",entityId:n.rows[0].id,data:t}),a.status(201).json({id:n.rows[0].id})}));
H.put("/units/:id",p("configuracoes.gerenciar"),u(async(e,a)=>{let t=w(v.object({name:v.string().trim().min(2).max(80).optional(),day_cutoff:v.number().int().min(0).max(12).optional(),
active:v.boolean().optional()}),e.body);if(!(await c("update units set name = coalesce($3,name), day_cutoff = coalesce($4,day_cutoff), active = coalesce($5,active) where id = $1 an\
d company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.day_cutoff??null,t.active??null])).rows[0])throw b();await h({query:c},e.ctx,"unidade.alterada",
{entity:"unit",entityId:e.params.id,data:t}),a.json({ok:!0})}));H.get("/terminals",u(async(e,a)=>{a.json((await c("select id, unit_id, name, active, settings from terminals where c\
ompany_id = $1 order by id",[e.ctx.companyId])).rows)}));H.post("/terminals",p("configuracoes.gerenciar"),u(async(e,a)=>{let t=w(v.object({name:v.string().trim().min(2).max(60),unit_id:v.
number().int()}),e.body);await on(e.ctx.companyId,t.unit_id);let n=await c("insert into terminals (company_id, unit_id, name) values ($1,$2,$3) returning id",[e.ctx.companyId,t.unit_id,
t.name]);await h({query:c},e.ctx,"terminal.criado",{entity:"terminal",entityId:n.rows[0].id,data:t}),a.status(201).json({id:n.rows[0].id})}));H.put("/terminals/:id",p("configuracoe\
s.gerenciar"),u(async(e,a)=>{let t=w(v.object({name:v.string().trim().min(2).max(60).optional(),active:v.boolean().optional()}),e.body);if(!(await c("update terminals set name = co\
alesce($3,name), active = coalesce($4,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.active??null])).rows[0])throw b();
a.json({ok:!0})}));var bo=v.object({name:v.string().trim().min(2).max(120),segment:v.string().max(30),document:v.string().max(20).nullable(),phone:v.string().max(30).nullable(),email:v.
string().email().max(160).nullable(),timezone:v.string().max(60),address:v.record(v.string(),v.string().max(160)),appearance:v.object({theme:v.enum(["claro","escuro","auto"]).optional(),
density:v.enum(["confortavel","compacta"]).optional(),menu:v.enum(["lateral","superior"]).optional(),accent:v.string().regex(/^#[0-9a-fA-F]{6}$/).optional()})}).partial();H.get("/s\
ettings",u(async(e,a)=>{let t=(await c("select id, name, segment, document, phone, email, timezone, address, settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json(
t)}));H.put("/settings",p("configuracoes.gerenciar"),u(async(e,a)=>{let t=w(bo,e.body);if(t.timezone)try{new Intl.DateTimeFormat("pt-BR",{timeZone:t.timezone})}catch{throw y("Fuso \
hor\xE1rio inv\xE1lido")}await c(`update companies set name = coalesce($2,name), segment = coalesce($3,segment), document = coalesce($4,document),
             phone = coalesce($5,phone), email = coalesce($6,email), timezone = coalesce($7,timezone), address = coalesce($8,address),
             settings = case when $9::jsonb is null then settings else jsonb_set(settings, '{appearance}', $9::jsonb) end
           where id = $1`,[e.ctx.companyId,t.name??null,t.segment??null,t.document??null,t.phone??null,t.email??null,t.timezone??null,t.address??null,t.appearance?JSON.stringify(t.
appearance):null]),await h({query:c},e.ctx,"configuracoes.empresa",{entity:"company",entityId:e.ctx.companyId,data:t}),a.json({ok:!0})}));var $o=v.object({scanner_enabled:v.boolean(),
mode:v.enum(["manual","continua","dupla"]),double_read_mandatory:v.boolean(),allow_manual:v.boolean(),allow_manual_exception:v.boolean(),exception_requires_manager:v.boolean(),allow_mode_change:v.
boolean(),product_timeout_s:v.number().int(),open_free_card_on_scan:v.boolean(),feedback_sound:v.boolean(),qty_per_scan:v.number().int().min(1).max(100),max_qty_per_scan:v.number().
int().min(1).max(100),terminator:v.enum(["Enter","Tab"]),kitchen_send:v.enum(["imediato","lote"]),require_open_cash:v.boolean(),service_fee_bp:v.number().int().min(0).max(3e3),card_prefix:v.
string().regex(/^[A-Z0-9-]{1,8}$/)}).partial();H.get("/pdv-settings",u(async(e,a)=>{let t=Number(e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId||null,n=await c("select settin\
gs->'pdv' as s from companies where id = $1",[e.ctx.companyId]),o=t?await c("select settings->'pdv' as s from units where id = $1 and company_id = $2",[t,e.ctx.companyId]):{rows:[]},
s=Number(e.query.terminal_id)||e.ctx.terminalId,i=s?await c("select settings->'pdv' as s from terminals where id = $1 and company_id = $2",[s,e.ctx.companyId]):{rows:[]};a.json({company:n.
rows[0]?.s||{},unit:o.rows[0]?.s||{},terminal:i.rows[0]?.s||{},effective:Qt(n.rows[0]?.s,o.rows[0]?.s,i.rows[0]?.s)})}));H.put("/pdv-settings/:level",p("configuracoes.gerenciar"),u(
async(e,a)=>{let t=w(v.enum(["company","unit","terminal"]),e.params.level),n=w($o,e.body?.settings);Je(n);let o=Number(e.body?.id);await $(async s=>{let i;if(t==="company"){i=(await s.
query("select settings->'pdv' s, settings from companies where id = $1 for update",[e.ctx.companyId])).rows[0];let r={...i.s||{},...n};Je(r),await s.query("update companies set set\
tings = jsonb_set(settings, '{pdv}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(r)])}else{let r=t==="unit"?"units":"terminals";if(i=(await s.query(`select settings->\
'pdv' s from ${r} where id = $1 and company_id = $2 for update`,[o,e.ctx.companyId])).rows[0],!i)throw b();let d={...i.s||{},...n};Je(d),await s.query(`update ${r} set settings = j\
sonb_set(settings, '{pdv}', $3::jsonb) where id = $1 and company_id = $2`,[o,e.ctx.companyId,JSON.stringify(d)])}await h(s,e.ctx,"pdv.configuracao",{entity:t,entityId:o||e.ctx.companyId,
data:{before:i?.s||{},after:n}})}),a.json({ok:!0,effective:await Ce({query:c},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId)})}));H.get("/audit",p("auditoria.visualizar"),u(async(e,a)=>{
let t=Math.min(Number(e.query.limit)||50,500),n=Math.max(Number(e.query.offset)||0,0),o=[e.ctx.companyId],s="a.company_id = $1";e.query.action&&(o.push(`${String(e.query.action)}%`),
s+=` and a.action like $${o.length}`),e.query.entity&&(o.push(String(e.query.entity)),s+=` and a.entity = $${o.length}`),e.query.entity_id&&(o.push(String(e.query.entity_id)),s+=` \
and a.entity_id = $${o.length}`),o.push(t,n);let{rows:i}=await c(`select a.id, a.action, a.entity, a.entity_id, a.reason, a.data, a.created_at, a.terminal_id, a.unit_id, u.name as \
user_name
       from audit_events a left join users u on u.id = a.user_id
      where ${s} order by a.id desc limit $${o.length-1} offset $${o.length}`,o);if(e.query.format==="csv")return a.type("text/csv; charset=utf-8").attachment("auditoria.csv"),a.send(
["data;usuario;acao;entidade;id;motivo",...i.map(r=>[r.created_at.toISOString(),r.user_name,r.action,r.entity,r.entity_id,r.reason].map(Be).join(";"))].join(`
`));a.json(i)}));H.post("/authorizations",u(async(e,a)=>{let t=w(v.object({email:v.string().trim().toLowerCase().max(160),password:v.string().max(200),action:v.enum(["excecao_dupla\
_leitura","cancelar_item","desconto","alterar_preco","reabrir_comanda","cancelar_venda","taxa_servico"]),reason:v.string().trim().min(3).max(300)}),e.body);await le(`auth-mgr:${e.ctx.
companyId}:${t.email}`,5,600);let n={excecao_dupla_leitura:"pdv.excecao_dupla_leitura",cancelar_item:"pdv.cancelar_item",desconto:"pdv.desconto",alterar_preco:"pdv.alterar_preco",reabrir_comanda:"\
pdv.reabrir_comanda",cancelar_venda:"pdv.cancelar_venda",taxa_servico:"pdv.taxa_servico"}[t.action],{rows:o}=await c(`select u.id, u.password_hash, r.permissions from users u join \
roles r on r.company_id = u.company_id and r.key = u.role_key
                             where lower(u.email) = $1 and u.company_id = $2 and u.active`,[t.email,e.ctx.companyId]),s=o[0];if(!(s&&await an.compare(t.password,s.password_hash))||
!s.permissions.includes("pdv.autorizar")||!s.permissions.includes(n))throw await h({query:c},e.ctx,"autorizacao.negada",{data:{action:t.action,email:t.email}}),T("Autoriza\xE7\xE3o recus\
ada: credenciais inv\xE1lidas ou sem permiss\xE3o para autorizar esta a\xE7\xE3o");let r=te(24);await c(`insert into manager_authorizations (company_id, requested_by, authorized_by\
, action, scope, token_hash, expires_at)
           values ($1,$2,$3,$4,$5,$6, now() + interval '2 minutes')`,[e.ctx.companyId,e.ctx.userId,s.id,t.action,{reason:t.reason,terminal:e.ctx.terminalId},Se(r)]),await h({query:c},
e.ctx,"autorizacao.concedida",{reason:t.reason,data:{action:t.action,authorized_by:s.id}}),a.json({authorization:r,expires_in:120})}));async function Ae(e,a,t,n){if(!t)throw T("Est\
a a\xE7\xE3o exige autoriza\xE7\xE3o de um gerente","authorization_required");let{rows:o}=await e.query(`update manager_authorizations set used_at = now()
      where token_hash = $1 and company_id = $2 and requested_by = $3 and action = $4 and used_at is null and expires_at > now()
      returning authorized_by, scope`,[Se(t),a.companyId,a.userId,n]);if(!o[0])throw T("Autoriza\xE7\xE3o gerencial inv\xE1lida, expirada ou j\xE1 utilizada");return o[0]}import{Router as vo}from"npm:express@5.2.1";import{z as O}from"npm:zod@4.6.5";var de=vo();de.get("/categories",p("cardapio.visualizar"),u(async(e,a)=>{a.json((await c("select id, name, sort, active, demo from categories where company_id = $1 order by sort, n\
ame",[e.ctx.companyId])).rows)}));de.post("/categories",p("cardapio.gerenciar"),u(async(e,a)=>{let t=w(O.object({name:O.string().trim().min(1).max(80),sort:O.number().int().default(
0)}),e.body),n=await c("insert into categories (company_id, name, sort) values ($1,$2,$3) returning id",[e.ctx.companyId,t.name,t.sort]);a.status(201).json({id:n.rows[0].id})}));de.
put("/categories/:id",p("cardapio.gerenciar"),u(async(e,a)=>{let t=w(O.object({name:O.string().trim().min(1).max(80),sort:O.number().int(),active:O.boolean()}).partial(),e.body);if(!(await c(
"update categories set name = coalesce($3,name), sort = coalesce($4,sort), active = coalesce($5,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,
t.name??null,t.sort??null,t.active??null])).rows[0])throw b();a.json({ok:!0})}));de.get("/sectors",u(async(e,a)=>{a.json((await c("select id, name, active from production_sectors w\
here company_id = $1 order by id",[e.ctx.companyId])).rows)}));de.post("/sectors",p("cardapio.gerenciar"),u(async(e,a)=>{let t=w(O.object({name:O.string().trim().min(2).max(60)}),e.
body),n=await c("insert into production_sectors (company_id, name) values ($1,$2) returning id",[e.ctx.companyId,t.name]);a.status(201).json({id:n.rows[0].id})}));de.get("/products",
p("cardapio.visualizar"),u(async(e,a)=>{let t=[e.ctx.companyId],n="p.company_id = $1";e.query.active!=="all"&&(n+=" and p.active"),e.query.q&&(t.push(`%${String(e.query.q).slice(0,
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
       from products p where ${n} order by p.favorite desc, p.name limit 500`,t);a.json(s)}));var sa=O.object({name:O.string().trim().min(1).max(120),description:O.string().max(500).
nullable().optional(),sku:O.string().trim().max(40).nullable().optional(),kind:O.enum(["resale","recipe","produced","combo","addon","weight"]).default("resale"),unit:O.enum(["un","\
kg","g","L","ml"]).default("un"),price_cents:O.number().int().min(0).max(1e8),cost_cents:O.number().int().min(0).max(1e8).default(0),category_id:O.number().int().nullable().optional(),
sector_id:O.number().int().nullable().optional(),favorite:O.boolean().default(!1),active:O.boolean().default(!0),channels:O.array(O.enum(["pdv","delivery","cardapio_digital"])).default(
["pdv"]),allergens:O.string().max(500).nullable().optional(),codes:O.array(O.string().max(128)).max(20).default([]),groups:O.array(O.object({name:O.string().trim().min(1).max(60),min:O.
number().int().min(0).max(20),max:O.number().int().min(1).max(20),options:O.array(O.object({name:O.string().trim().min(1).max(60),price_cents:O.number().int().min(0).max(1e6)})).min(
1).max(40)})).max(10).optional()});async function ia(e,a,t){if(t.category_id&&!(await e.query("select 1 from categories where id = $1 and company_id = $2",[t.category_id,a])).rows[0])
throw y("Categoria inv\xE1lida");if(t.sector_id&&!(await e.query("select 1 from production_sectors where id = $1 and company_id = $2",[t.sector_id,a])).rows[0])throw y("Setor inv\xE1l\
ido");if(t.kind==="weight"&&t.unit==="un")throw y("Produto por peso precisa de unidade kg ou g");for(let n of t.groups||[])if(n.min>n.max)throw y(`Grupo ${n.name}: m\xEDnimo maior que\
 m\xE1ximo`)}async function ra(e,a,t,n){if(!n)return;await e.query("delete from modifier_groups where product_id = $1 and company_id = $2",[t,a]);let o=0;for(let s of n){let i=await e.
query("insert into modifier_groups (company_id, product_id, name, min_select, max_select, sort) values ($1,$2,$3,$4,$5,$6) returning id",[a,t,s.name,s.min,s.max,o++]);for(let r of s.
options)await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)",[a,i.rows[0].id,r.name,r.price_cents])}}de.post("/products",p("c\
ardapio.gerenciar"),u(async(e,a)=>{let t=w(sa,e.body),n=await $(async o=>{await ia(o,e.ctx.companyId,t);let i=(await o.query(`insert into products (company_id, name, description, s\
ku, kind, unit, price_cents, cost_cents, category_id, sector_id, favorite, active, channels, allergens)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,[e.ctx.companyId,t.name,t.description??null,t.sku||null,t.kind,t.unit,t.price_cents,t.cost_cents,t.category_id??
null,t.sector_id??null,t.favorite,t.active,t.channels,t.allergens??null])).rows[0].id;for(let r of t.codes)await Pe(o,e.ctx.companyId,r,"PRODUTO",i);return await ra(o,e.ctx.companyId,
i,t.groups),await o.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)",[e.ctx.companyId,i,t.price_cents,e.ctx.
userId]),await h(o,e.ctx,"produto.criado",{entity:"product",entityId:i,data:{name:t.name,price_cents:t.price_cents}}),i}).catch(o=>{throw o.code==="23505"?g("SKU j\xE1 usado em outro \
produto"):o});a.status(201).json({id:n})}));de.put("/products/:id",p("cardapio.gerenciar"),u(async(e,a)=>{let t=Number(e.params.id),n=w(sa.partial(),e.body);await $(async o=>{let s=(await o.
query("select * from products where id = $1 and company_id = $2 for update",[t,e.ctx.companyId])).rows[0];if(!s)throw b("Produto n\xE3o encontrado");await ia(o,e.ctx.companyId,{...s,
...n});let i={...s,...n};if(await o.query(`update products set name=$3, description=$4, sku=$5, kind=$6, unit=$7, price_cents=$8, cost_cents=$9, category_id=$10, sector_id=$11,
         favorite=$12, active=$13, channels=$14, allergens=$15, updated_at=now() where id=$1 and company_id=$2`,[t,e.ctx.companyId,i.name,i.description,i.sku||null,i.kind,i.unit,i.
price_cents,i.cost_cents,i.category_id,i.sector_id,i.favorite,i.active,i.channels,i.allergens]),n.price_cents!=null&&n.price_cents!==s.price_cents&&(await o.query("insert into prod\
uct_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,t,s.price_cents,n.price_cents,e.ctx.userId]),await h(o,e.ctx,"pr\
oduto.preco",{entity:"product",entityId:t,data:{before:s.price_cents,after:n.price_cents}})),n.codes){let r=n.codes.map(We).filter(Boolean);await o.query("delete from scan_codes wh\
ere company_id = $1 and entity = 'PRODUTO' and entity_id = $2 and not (code = any($3))",[e.ctx.companyId,t,r]);for(let d of r)await Pe(o,e.ctx.companyId,d,"PRODUTO",t)}await ra(o,e.
ctx.companyId,t,n.groups),await h(o,e.ctx,"produto.alterado",{entity:"product",entityId:t,data:{...n,groups:n.groups?"alterados":void 0}})}).catch(o=>{throw o.code==="23505"?g("SKU\
 j\xE1 usado em outro produto"):o}),a.json({ok:!0})}));de.get("/products/:id/prices",p("cardapio.visualizar"),u(async(e,a)=>{a.json((await c(`select h.old_cents, h.new_cents, h.cre\
ated_at, u.name as user_name from product_price_history h left join users u on u.id = h.user_id
                      where h.product_id = $1 and h.company_id = $2 order by h.id desc`,[Number(e.params.id),e.ctx.companyId])).rows)}));de.delete("/demo",p("configuracoes.gerencia\
r"),u(async(e,a)=>{let t=await $(async n=>{let s=(await n.query("select distinct product_id from order_items where company_id = $1",[e.ctx.companyId])).rows.map(d=>d.product_id),i=await n.
query("update products set active = false, name = name where company_id = $1 and demo and id = any($2) returning id",[e.ctx.companyId,s]);await n.query("delete from scan_codes wher\
e company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo and not (id = any($2)))",[e.ctx.companyId,s]),await n.query("delet\
e from product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 and demo and not (id = any($2)))",[e.ctx.companyId,s]);let r=await n.
query("delete from products where company_id = $1 and demo and not (id = any($2)) returning id",[e.ctx.companyId,s]);return await n.query("delete from categories c where c.company_\
id = $1 and c.demo and not exists (select 1 from products p where p.category_id = c.id)",[e.ctx.companyId]),await h(n,e.ctx,"demonstracao.removida",{data:{removed:r.rowCount,deactivated:i.
rowCount}}),{removed:r.rowCount,deactivated:i.rowCount}});a.json(t)}));import{Router as xo}from"npm:express@5.2.1";import{z as G}from"npm:zod@4.6.5";var $e=xo(),ko=e=>Number(e.query.unit_id||e.body?.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;async function vt(e){let a=ko(e);return a?(be(e.ctx,a),a):(await c("select id from un\
its where company_id = $1 and active order by id limit 1",[e.ctx.companyId])).rows[0]?.id}$e.get("/tables",p("salao.visualizar"),u(async(e,a)=>{let t=await vt(e),n=e.ctx.can("pdv.r\
eceber")||e.ctx.can("financeiro.visualizar")||e.ctx.can("pdv.lancar"),{rows:o}=await c(`select t.id, t.number, t.area, t.capacity, t.status, t.pos_x, t.pos_y, t.active,
            (select code from scan_codes s where s.company_id = t.company_id and s.entity = 'MESA' and s.entity_id = t.id limit 1) as code,
            (select count(*)::int from consumption_sessions s where s.table_id = t.id and s.status in ('aberta','em_fechamento')) as open_sessions,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status in ('novo','aceito','preparando')) as preparing,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status = 'pronto') as ready
            ${n?`, (select coalesce(sum(i.total_cents),0)::bigint from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo') as consumed_cents`:""}
       from dining_tables t where t.company_id = $1 and t.unit_id = $2 and t.active order by t.number`,[e.ctx.companyId,t]);a.json({unitId:t,tables:o})}));$e.post("/tables",p("sala\
o.gerenciar"),u(async(e,a)=>{let t=w(G.object({from:G.number().int().min(1).max(9999),count:G.number().int().min(1).max(200),area:G.string().max(40).default("Sal\xE3o"),capacity:G.
number().int().min(1).max(50).default(4)}),e.body),n=await vt(e),o=await $(async s=>{let i=await Xt(s,e.ctx.companyId,n,t.from,t.count);return i.length&&await s.query("update dinin\
g_tables set area = $2, capacity = $3 where id = any($1)",[i,t.area,t.capacity]),await h(s,e.ctx,"mesas.criadas",{unitId:n,data:{from:t.from,count:i.length}}),i});a.status(201).json(
{created:o.length})}));$e.put("/tables/:id",p("salao.visualizar"),u(async(e,a)=>{let t=w(G.object({status:G.enum(["livre","ocupada","reservada","conta","limpeza"]).optional(),area:G.
string().max(40).optional(),capacity:G.number().int().min(1).max(50).optional(),pos_x:G.number().int().min(0).max(40).optional(),pos_y:G.number().int().min(0).max(40).optional(),active:G.
boolean().optional()}),e.body);if(["area","capacity","pos_x","pos_y","active"].some(s=>s in t)&&!e.ctx.can("salao.gerenciar"))throw y("Sem permiss\xE3o para alterar a estrutura do sal\
\xE3o");if(t.status&&!e.ctx.can("salao.gerenciar")&&!e.ctx.can("pdv.lancar"))throw y("Sem permiss\xE3o para mudar a situa\xE7\xE3o da mesa");if(t.status==="livre"&&(await c("select\
 1 from consumption_sessions where table_id = $1 and company_id = $2 and status in ('aberta','em_fechamento')",[Number(e.params.id),e.ctx.companyId])).rows[0])throw g("Mesa com con\
sumo aberto n\xE3o pode ser liberada");if(!(await c(`update dining_tables set status = coalesce($3,status), area = coalesce($4,area), capacity = coalesce($5,capacity),
                       pos_x = coalesce($6,pos_x), pos_y = coalesce($7,pos_y), active = coalesce($8,active) where id = $1 and company_id = $2 returning unit_id`,[Number(e.params.id),
e.ctx.companyId,t.status??null,t.area??null,t.capacity??null,t.pos_x??null,t.pos_y??null,t.active??null])).rows[0])throw b("Mesa n\xE3o encontrada");await h({query:c},e.ctx,"mesa.a\
lterada",{entity:"table",entityId:e.params.id,data:t}),a.json({ok:!0})}));$e.get("/cards",p("pdv.lancar"),u(async(e,a)=>{let t=await vt(e),{rows:n}=await c(`select c.id, c.number, \
c.status, c.block_reason,
            (select code from scan_codes s where s.company_id = c.company_id and s.entity = 'COMANDA' and s.entity_id = c.id order by s.id limit 1) as code,
            (select s.id from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_id
       from tab_cards c where c.company_id = $1 and c.unit_id = $2 order by c.number`,[e.ctx.companyId,t]);a.json({unitId:t,cards:n})}));$e.post("/cards",p("comandas.gerenciar"),u(
async(e,a)=>{let t=w(G.object({from:G.number().int().min(1).max(999999),count:G.number().int().min(1).max(1e3)}),e.body),n=await vt(e),o=await $(async s=>{let i=(await s.query("sel\
ect coalesce(settings->'pdv'->>'card_prefix','CMD-') p from companies where id = $1",[e.ctx.companyId])).rows[0].p,r=await en(s,e.ctx.companyId,n,t.from,t.count,i);return await h(s,
e.ctx,"comandas.geradas",{unitId:n,data:{from:t.from,count:r.length}}),r});a.status(201).json({created:o})}));$e.post("/cards/:id/block",p("comandas.gerenciar"),u(async(e,a)=>{let t=w(
G.object({reason:G.string().trim().min(3).max(200)}),e.body);if(!(await c("update tab_cards set status = 'bloqueado', block_reason = $3 where id = $1 and company_id = $2 returning \
id",[Number(e.params.id),e.ctx.companyId,t.reason])).rows[0])throw b();await h({query:c},e.ctx,"comanda.bloqueada",{entity:"card",entityId:e.params.id,reason:t.reason}),a.json({ok:!0})}));
$e.post("/cards/:id/unblock",p("comandas.gerenciar"),u(async(e,a)=>{if(!(await c("update tab_cards set status = 'ativo', block_reason = null where id = $1 and company_id = $2 retur\
ning id",[Number(e.params.id),e.ctx.companyId])).rows[0])throw b();await h({query:c},e.ctx,"comanda.desbloqueada",{entity:"card",entityId:e.params.id}),a.json({ok:!0})}));$e.post("\
/cards/:id/replace",p("comandas.gerenciar"),u(async(e,a)=>{let t=w(G.object({new_card_id:G.number().int(),reason:G.string().trim().min(3).max(200)}),e.body);await $(async n=>{let o=(await n.
query("select * from tab_cards where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0],s=(await n.query("select * from tab_cards where id = $1\
 and company_id = $2 for update",[t.new_card_id,e.ctx.companyId])).rows[0];if(!o||!s)throw b("Cart\xE3o n\xE3o encontrado");if(s.status!=="ativo")throw y("O novo cart\xE3o est\xE1 bloque\
ado");if(o.unit_id!==s.unit_id)throw y("Cart\xF5es de unidades diferentes");if((await n.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fec\
hamento')",[s.id])).rows[0])throw g("O novo cart\xE3o j\xE1 tem consumo em aberto");await n.query("update tab_cards set status = 'bloqueado', block_reason = $2 where id = $1",[o.id,
`Substitu\xEDdo pelo ${s.number}: ${t.reason}`]);let r=await n.query("update consumption_sessions set card_id = $2, version = version + 1 where card_id = $1 and status in ('aberta'\
,'em_fechamento') returning id",[o.id,s.id]);await h(n,e.ctx,"comanda.substituida",{entity:"card",entityId:o.id,reason:t.reason,data:{new_card:s.id,session:r.rows[0]?.id??null}})}),
a.json({ok:!0})}));import{Router as No}from"npm:express@5.2.1";import{z as x}from"npm:zod@4.6.5";var sn=e=>({enabled:!0,allow_negative:!0,...e?.stock||{}});async function Ze(e,a,t){let n=await e.query(`select stock_item_id, coalesce(sum(qty),0)::numeric as qty from stock_movem\
ents
    where company_id = $1 ${t?"and stock_item_id = any($2)":""} group by stock_item_id`,t?[a,t]:[a]);return Object.fromEntries(n.rows.map(o=>[o.stock_item_id,Number(o.qty)]))}var ca=e=>Math.
round(e*1e4)/1e4;async function xt(e,a,t,n,o=[]){let s=new Map,i=(r,d)=>s.set(Number(r),ca((s.get(Number(r))||0)+d));if(t.stock_mode==="acabado"&&t.stock_item_id&&i(t.stock_item_id,
Number(n)),t.stock_mode==="ficha"){let r=(await e.query(`select l.stock_item_id, l.qty, l.loss_pct, r.yield_qty from recipes r join recipe_lines l on l.recipe_id = r.id
      where r.company_id = $1 and r.product_id = $2 and r.active`,[a,t.id])).rows;for(let d of r)i(d.stock_item_id,Number(d.qty)*(1+Number(d.loss_pct)/100)/Number(d.yield_qty)*Number(
n))}if(o.length){let r=(await e.query("select stock_item_id, stock_qty from modifier_options where company_id = $1 and id = any($2) and stock_item_id is not null and stock_qty > 0",
[a,o])).rows;for(let d of r)i(d.stock_item_id,Number(d.stock_qty)*Number(n))}return s}async function kt(e,a,t,n,o){let s=(await e.query("select settings from companies where id = $\
1",[a.companyId])).rows[0],i=sn(s.settings);if(!i.enabled)return[];let r=await xt(e,a.companyId,n,t.qty,o);if(!r.size)return[];let d=[...r.keys()],l=(await e.query("select id, name\
, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2) order by id for update",[a.companyId,d])).rows;if(!i.allow_negative){let f=await Ze(e,a.companyId,d);
for(let _ of l)if((f[_.id]||0)-r.get(Number(_.id))<-1e-4)throw g(`Estoque insuficiente de ${_.name} (saldo ${(f[_.id]||0).toLocaleString("pt-BR")} ${_.unit})`,"stock_insufficient")}
let m=[];for(let f of l){let _=await e.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, user_id)
      values ($1,$2,'venda',$3,$4,'order_item',$5,$6) on conflict do nothing returning id`,[a.companyId,f.id,-r.get(Number(f.id)),f.avg_cost_cents,t.id,a.userId]);_.rows[0]&&m.push(
_.rows[0].id)}return m}async function ct(e,a,t,n){let o=(await e.query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'order_item' and m.ref_id = $2 an\
d m.kind = 'venda'
    and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`,[a.companyId,t])).rows;for(let s of o)await e.query(`insert into stock_movements (company_id, stock\
_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
      values ($1,$2,'estorno_venda',$3,$4,'order_item_rev',$5,$6,$7,$8)`,[a.companyId,s.stock_item_id,-Number(s.qty),s.unit_cost_cents,t,s.id,n,a.userId]);return o.length}async function dt(e,a,t,n,o,s,i){
let r=(await e.query("select avg_cost_cents from stock_items where id = $1 and company_id = $2 for update",[t,a.companyId])).rows[0],d=(await Ze(e,a.companyId,[t]))[t]||0,l=Math.max(
0,d),m=l+n>0?(l*Number(r.avg_cost_cents)+n*o)/(l+n):o;await e.query("update stock_items set avg_cost_cents = $3 where id = $1 and company_id = $2",[t,a.companyId,ca(m)]),await e.query(
`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
    values ($1,$2,'entrada',$3,$4,$5,$6,$7,$8)`,[a.companyId,t,n,o,s?.type??null,s?.id??null,i??null,a.userId])}async function rn(e,a,t){let n=await xt(e,a,t,1,[]);if(!n.size)return Number(
t.cost_cents||0);let o=(await e.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2)",[a,[...n.keys()]])).rows;return Math.round(o.reduce((s,i)=>s+
Number(i.avg_cost_cents)*n.get(Number(i.id)),0))}var oe=e=>String(e??"").replace(/\D/g,"");function jo(e){let a=oe(e);if(a.length!==11||/^(\d)\1{10}$/.test(a))return!1;let t=n=>{let o=0;for(let i=0;i<n;i++)o+=Number(a[i])*(n+1-i);
let s=o*10%11;return s===10?0:s};return t(9)===Number(a[9])&&t(10)===Number(a[10])}function jt(e,{required:a=!1}={}){let t=oe(e);if(!t){if(a)throw y("Informe o CPF");return null}if(!jo(
t))throw y("CPF inv\xE1lido","invalid_cpf");return t}var cn=e=>e?`${e.slice(0,3)}.${e.slice(3,6)}.${e.slice(6,9)}-${e.slice(9)}`:null,Io=e=>e?`***.${e.slice(3,6)}.${e.slice(6,9)}-*\
*`:null,zo=e=>e?e.replace(/\d(?=\d{4})/g,"*"):null,So=e=>e?e.replace(/^(.).*(@.*)$/,"$1***$2"):null;function Qe(e,a){if(!e)return e;let t=a.can("dados.pessoais");return{id:e.id,name:e.
name,cpf:t?cn(e.cpf):Io(e.cpf),phone:t?e.phone:zo(e.phone),email:t?e.email:So(e.email),birthday:t?e.birthday:null,address:t?e.address:{},tags:e.tags,preferences:e.preferences,notes:e.
notes,consent_whatsapp:e.consent_whatsapp,consent_email:e.consent_email,unsubscribed:!!e.unsubscribed_at,points:e.points,anonymized:!!e.anonymized_at,created_at:e.created_at,masked:!t,
...e.visits!=null?{visits:e.visits,spent_cents:e.spent_cents,last_visit:e.last_visit}:{}}}var It=e=>({enabled:!1,cents_per_point:100,point_value_cents:5,validity_days:365,min_redeem:100,
...e?.loyalty||{}});async function Me(e,a,t,n){let o=await e.query(`insert into loyalty_ledger (company_id, customer_id, session_id, kind, points, expires_at, reason, reverses_id, \
payment_id, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[a,t,n.session_id??null,n.kind,n.points,n.expires_at??null,n.reason??null,n.reverses_id??null,n.payment_id??null,n.user_id??
null]);return await e.query("update customers set points = points + $3, updated_at = now() where id = $1 and company_id = $2",[t,a,n.points]),o.rows[0]}async function dn(e,a,t){let n=await e.
query(`select
       coalesce(sum(l.points) filter (where (l.kind = 'ganho' or o.kind = 'ganho') and coalesce(l.expires_at, o.expires_at) < current_date), 0)::int as vencidos,
       coalesce(-sum(l.points) filter (where l.kind in ('resgate','expiracao') or (l.kind = 'ajuste' and l.points < 0) or o.kind = 'resgate'), 0)::int as usados
     from loyalty_ledger l left join loyalty_ledger o on o.id = l.reverses_id
     where l.company_id = $1 and l.customer_id = $2`,[a,t]),{vencidos:o,usados:s}=n.rows[0],i=o-s;i>0&&await Me(e,a,t,{kind:"expiracao",points:-i,reason:"Pontos vencidos"})}async function zt(e,a,t,n){
if(!t.customer_id)return null;let o=(await e.query("select settings from companies where id = $1",[a.companyId])).rows[0],s=It(o.settings);if(!s.enabled)return null;let i=Math.floor(
n/Math.max(1,s.cents_per_point));if(i<=0||(await e.query(`select 1 from loyalty_ledger where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = loyalty_ledger.id)`,[a.companyId,t.id])).rows[0])return null;let d=new Date(Date.now()+s.validity_days*864e5).
toISOString().slice(0,10);return Me(e,a.companyId,t.customer_id,{session_id:t.id,kind:"ganho",points:i,expires_at:d,reason:`Consumo ${t.id}`,user_id:a.userId})}async function da(e,a,t,n){
let o=(await e.query(`select * from loyalty_ledger l where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = l.id)`,[a.companyId,t])).rows[0];return o?Me(e,a.companyId,o.customer_id,{session_id:t,kind:"estorno",points:-o.
points,reverses_id:o.id,reason:n,user_id:a.userId}):null}async function ma(e,a,t,n,o,s){let i=(await e.query("select points from customers where id = $1 and company_id = $2 for upd\
ate",[t,a.companyId])).rows[0];if(!i)throw y("Cliente n\xE3o encontrado");if(i.points<n)throw g(`Saldo insuficiente: ${i.points} pontos`,"insufficient_points");return Me(e,a.companyId,
t,{session_id:s,kind:"resgate",points:-n,payment_id:o,reason:`Resgate no consumo ${s}`,user_id:a.userId})}async function ua(e,a,t){let n=(await e.query(`select * from loyalty_ledge\
r l where company_id = $1 and payment_id = $2 and kind = 'resgate'
    and not exists (select 1 from loyalty_ledger x where x.reverses_id = l.id)`,[a.companyId,t])).rows[0];return n?Me(e,a.companyId,n.customer_id,{session_id:n.session_id,kind:"est\
orno",points:-n.points,reverses_id:n.id,reason:"Pagamento com pontos estornado",user_id:a.userId}):null}var F=No();async function la(e,a,t){let n=await e.query("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1 and u.company_id = $2",
[t,a]);if(!n.rows[0])throw y("Unidade inv\xE1lida");return n.rows[0]}F.post("/resolve",p("pdv.lancar"),u(async(e,a)=>{let{code:t}=w(x.object({code:x.string().max(256)}),e.body),n=await it(
{query:c},e.ctx.companyId,t);n.type==="DESCONHECIDO"&&await h({query:c},e.ctx,"leitura.desconhecida",{data:{code:n.code.slice(0,40)}}),a.json(n)}));F.get("/sessions",p("pdv.lancar"),
u(async(e,a)=>{let t=e.query.status==="all"?null:["aberta","em_fechamento"],n=[e.ctx.companyId],o="s.company_id = $1";t&&(n.push(t),o+=` and s.status = any($${n.length})`);let s=Number(
e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;s&&(n.push(s),o+=` and s.unit_id = $${n.length}`);let{rows:i}=await c(`select s.id, s.kind, s.status, s.label, s.customer_name,\
 s.opened_at, s.version, s.suspended, s.unit_id,
            c.number as card_number, t.number as table_number, s.table_id, s.card_id,
            (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
            (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = s.id and p.status = 'confirmado') as paid_cents,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
      where ${o} order by s.opened_at desc limit 300`,n);a.json(i)}));var Co=x.object({kind:x.enum(["comanda","mesa","balcao","retirada"]),card_id:x.number().int().optional(),card_code:x.
string().max(128).optional(),table_id:x.number().int().optional(),customer_name:x.string().trim().max(80).optional(),customer_id:x.number().int().optional(),label:x.string().trim().
max(60).optional(),unit_id:x.number().int().optional()});async function mn(e,a,t){J(a,"pdv.abrir_comanda");let n=t.unit_id||a.terminalUnitId||a.unitId,o=null,s=null;if(t.card_code&&
!t.card_id){let m=await it(e,a.companyId,t.card_code);if(m.type!=="COMANDA")throw y("C\xF3digo n\xE3o \xE9 de comanda");t.card_id=m.card.id}if(t.card_id){let m=(await e.query("sele\
ct * from tab_cards where id = $1 and company_id = $2 for update",[t.card_id,a.companyId])).rows[0];if(!m)throw b("Comanda n\xE3o encontrada");if(m.status!=="ativo")throw g(`Comand\
a ${m.number} bloqueada${m.block_reason?`: ${m.block_reason}`:""}`,"card_blocked");let f=await e.query("select id from consumption_sessions where card_id = $1 and status in ('abert\
a','em_fechamento')",[m.id]);if(f.rows[0])throw g(`Comanda ${m.number} j\xE1 est\xE1 em uso`,"card_busy",{session_id:f.rows[0].id});o=m.id,n=m.unit_id}if(t.table_id){let m=(await e.
query("select * from dining_tables where id = $1 and company_id = $2 and active",[t.table_id,a.companyId])).rows[0];if(!m)throw b("Mesa n\xE3o encontrada");if(n&&m.unit_id!==n)throw y(
"Mesa e comanda de unidades diferentes");s=m.id,n=m.unit_id}if(t.customer_id){let m=(await e.query("select id, name from customers where id = $1 and company_id = $2 and anonymized_\
at is null",[t.customer_id,a.companyId])).rows[0];if(!m)throw b("Cliente n\xE3o encontrado");t.customer_name=t.customer_name||m.name}if(t.kind==="comanda"&&!o)throw y("Informe a co\
manda");if(t.kind==="mesa"&&!s)throw y("Informe a mesa");n||(n=(await e.query("select id from units where company_id = $1 and active order by id limit 1",[a.companyId])).rows[0]?.id),
be(a,n);let i=await Ce(e,a,n),{day_cutoff:r,timezone:d}=await la(e,a.companyId,n),l=await e.query(`insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, c\
ustomer_name, label, service_fee_bp, opened_by, business_date, customer_id, delivery_fee_cents)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[a.companyId,n,t.kind,o,s,t.customer_name??null,t.label??null,["balcao","retirada","delivery"].includes(t.kind)?0:
i.service_fee_bp,a.userId,me(new Date,d,r),t.customer_id??null,t.delivery_fee_cents??0]);return s&&await e.query("update dining_tables set status = 'ocupada' where id = $1 and stat\
us in ('livre','reservada','limpeza')",[s]),await h(e,a,"consumo.aberto",{entity:"session",entityId:l.rows[0].id,unitId:n,data:{kind:t.kind,card:o,table:s}}),l.rows[0]}F.post("/ses\
sions",u(async(e,a)=>{let t=w(Co,e.body),n=await $(o=>mn(o,e.ctx,t)).catch(o=>{throw o.code==="23505"?g("Comanda j\xE1 est\xE1 em uso","card_busy"):o});a.status(201).json(n)}));async function Eo(e,a,t){
let n=(await e.query(`select s.*, c.number as card_number, t.number as table_number, u.name as opened_by_name, cu.points as customer_points,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo' and i.sent_at is null and i.kitchen_status = 'novo') as pending_send
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join users u on u.id = s.opened_by left join customers cu on cu.id = s.customer_id where s.id = $1 and s.company_id = $2`,[t,a.companyId])).rows[0];if(!n)throw b("Consu\
mo n\xE3o encontrado");let o=(await e.query(`select i.id, i.product_id, i.description, i.qty, i.unit, i.unit_price_cents, i.modifiers, i.modifiers_cents, i.discount_cents,
            i.total_cents, i.notes, i.status, i.kitchen_status, i.launch_mode, i.created_at, i.cancel_reason, i.transferred_from, i.sent_at,
            u.name as user_name
       from order_items i left join users u on u.id = i.user_id where i.session_id = $1 order by i.id`,[t])).rows,s=(await e.query(`select p.id, p.method, p.amount_cents, p.tendere\
d_cents, p.change_cents, p.status, p.source, p.created_at, p.refund_reason, u.name as user_name
       from payments p left join users u on u.id = p.user_id where p.session_id = $1 order by p.id`,[t])).rows;return{...n,items:o,payments:s,totals:await R(e,t)}}F.get("/sessions/\
:id",p("pdv.lancar"),u(async(e,a)=>{a.json(await Eo({query:c},e.ctx,Number(e.params.id)))}));var qo=x.object({session_id:x.number().int(),product_id:x.number().int().optional(),qty:x.
number().positive().max(9999).optional(),option_ids:x.array(x.number().int()).max(40).default([]),notes:x.string().trim().max(200).optional(),launch_mode:x.enum(["manual","continua",
"dupla","excecao","balcao","delivery"]),idempotency_key:x.string().regex(/^[A-Za-z0-9_-]{8,80}$/),scan:x.object({card_code:x.string().max(128).optional(),product_code:x.string().max(
128).optional()}).optional(),price_override_cents:x.number().int().min(0).max(1e8).optional(),discount_cents:x.number().int().min(0).max(1e8).optional(),authorization:x.string().max(
100).optional(),exception_reason:x.string().trim().max(200).optional()});F.post("/items",p("pdv.lancar"),u(async(e,a)=>{let t=w(qo,e.body),n=e.ctx,o=await c("select * from order_it\
ems where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(o.rows[0]){if(Number(o.rows[0].session_id)!==t.session_id)throw g("Chave de opera\xE7\xE3o j\xE1 usad\
a em outro lan\xE7amento","idempotency_mismatch");return a.json({item:o.rows[0],replay:!0,totals:await R({query:c},t.session_id)})}let s=await $(async i=>{let r=await Z(i,n.companyId,
t.session_id);be(n,r.unit_id),Te(r);let d=await Ce(i,n,r.unit_id),l=t.product_id,m=null;if(t.launch_mode==="dupla"||t.launch_mode==="continua"){if(!d.scanner_enabled)throw T("Leito\
r desabilitado nesta configura\xE7\xE3o","scanner_disabled");if(t.launch_mode==="continua"&&d.double_read_mandatory)throw T("Dupla leitura obrigat\xF3ria: leitura cont\xEDnua n\xE3o permiti\
da","double_read_required");let B=await it(i,n.companyId,t.scan?.product_code);if(B.type!=="PRODUTO")throw y("C\xF3digo lido n\xE3o \xE9 de produto","not_a_product");if(l&&l!==B.product.
id)throw y("Produto informado difere do c\xF3digo lido");if(l=B.product.id,t.launch_mode==="dupla"){let ne=await it(i,n.companyId,t.scan?.card_code);if(ne.type!=="COMANDA")throw y(
"Dupla leitura exige a leitura da comanda antes do produto","card_required");if(Number(ne.card.id)!==Number(r.card_id))throw g("Comanda lida n\xE3o corresponde ao consumo de destino",
"card_mismatch")}}else if(t.launch_mode==="excecao"){if(!d.allow_manual_exception)throw T("Exce\xE7\xE3o manual desabilitada","exception_disabled");if(J(n,"pdv.excecao_dupla_leitur\
a"),!t.exception_reason)throw y("Informe o motivo da exce\xE7\xE3o");d.exception_requires_manager&&(m=(await Ae(i,n,t.authorization,"excecao_dupla_leitura")).authorized_by)}else if(t.
launch_mode==="delivery"){if(J(n,"delivery.gerenciar"),r.kind!=="delivery")throw y("Lan\xE7amento de delivery s\xF3 em pedidos de delivery")}else{if(d.double_read_mandatory)throw T(
"Dupla leitura obrigat\xF3ria: use a exce\xE7\xE3o autorizada para lan\xE7ar manualmente","double_read_required");if(!d.allow_manual)throw T("Lan\xE7amento manual desabilitado","ma\
nual_disabled");J(n,"pdv.lancamento_manual")}if(!l)throw y("Informe o produto");let f=(await i.query("select * from products where id = $1 and company_id = $2",[l,n.companyId])).rows[0];
if(!f)throw b("Produto n\xE3o encontrado");if(!f.active)throw g(`${f.name} est\xE1 indispon\xEDvel`,"product_inactive");let _=t.qty,k=t.launch_mode==="dupla"||t.launch_mode==="cont\
inua";if(f.kind==="weight"){if(!_)throw y(`${f.name} \xE9 vendido por peso: informe o peso`,"weight_required")}else{if(_=_??(k?d.qty_per_scan:1),!Number.isInteger(_))throw y("Quant\
idade deve ser inteira para este produto");if(k&&_!==d.qty_per_scan&&(J(n,"pdv.alterar_quantidade"),_>d.max_qty_per_scan))throw y(`Quantidade por leitura limitada a ${d.max_qty_per_scan}`)}
let j=(await i.query(`select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active
        where g.product_id = $1 group by g.id order by g.sort, g.id`,[f.id])).rows,S=[];for(let B of j){let ne=B.options.filter(ze=>t.option_ids.includes(ze.id));if(ne.length<B.min_select)
throw y(`Escolha ${B.min_select===1?"uma op\xE7\xE3o":`${B.min_select} op\xE7\xF5es`} em "${B.name}"`,"options_required");if(ne.length>B.max_select)throw y(`No m\xE1ximo ${B.max_select}\
 em "${B.name}"`);for(let ze of ne)S.push({group:B.name,id:ze.id,name:ze.name,price_cents:ze.price_cents})}if(S.length!==new Set(t.option_ids).size)throw y("Op\xE7\xE3o inv\xE1lida para est\
e produto");let A=S.reduce((B,ne)=>B+ne.price_cents,0),D=f.price_cents,M={};t.price_override_cents!=null&&t.price_override_cents!==f.price_cents&&(n.can("pdv.alterar_preco")||await Ae(
i,n,t.authorization,"alterar_preco"),D=t.price_override_cents,M.price={from:f.price_cents,to:D});let L=t.discount_cents||0;L&&(n.can("pdv.desconto")||await Ae(i,n,t.authorization,"\
desconto"),M.discount=L);let fe=tt(D,_,A,L);if(L>tt(D,_,A,0))throw y("Desconto maior que o valor do item");let we=(await i.query(`insert into order_items (company_id, session_id, p\
roduct_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, case when $19::boolean then now() end) returning *`,[n.companyId,r.id,f.id,f.name,_,f.unit,D,JSON.stringify(
S),A,L,fe,t.notes??null,f.sector_id,f.sector_id?"novo":"nao_produz",t.launch_mode,n.terminalId,n.userId,t.idempotency_key,!!f.sector_id&&d.kitchen_send!=="lote"&&r.kind!=="delivery"])).
rows[0];return await kt(i,n,we,f,S.map(B=>B.id)),await i.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),(t.launch_mode==="excecao"||Object.keys(
M).length)&&await h(i,n,t.launch_mode==="excecao"?"pdv.excecao_manual":"pdv.item_ajustado",{entity:"item",entityId:we.id,unitId:r.unit_id,reason:t.exception_reason,data:{session:r.
id,product:f.id,authorized_by:m,...M}}),{item:we,totals:await R(i,r.id),confirmation:{product:f.name,qty:_,unit_price_cents:D+A,total_cents:fe,destination:r.card_id?`Comanda ${(await i.
query("select number from tab_cards where id = $1",[r.card_id])).rows[0].number}`:r.label||`Consumo ${r.id}`}}}).catch(async i=>{if(i.code==="23505"){let r=await c("select * from o\
rder_items where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(r.rows[0])return{item:r.rows[0],replay:!0,totals:await R({query:c},r.rows[0].session_id)}}
throw i});a.status(s.replay?200:201).json(s)}));F.get("/items/by-key/:key",p("pdv.lancar"),u(async(e,a)=>{let t=await c("select * from order_items where company_id = $1 and idempot\
ency_key = $2",[e.ctx.companyId,String(e.params.key).slice(0,80)]);a.json({found:!!t.rows[0],item:t.rows[0]||null})}));F.post("/items/:id/cancel",p("pdv.lancar"),u(async(e,a)=>{let t=w(
x.object({reason:x.string().trim().min(3).max(200),authorization:x.string().max(100).optional()}),e.body),n=await $(async o=>{let s=(await o.query("select * from order_items where \
id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!s)throw b("Item n\xE3o encontrado");let i=await Z(o,e.ctx.companyId,s.session_id);Te(i);let r=(await o.
query("select * from order_items where id = $1 for update",[s.id])).rows[0];if(r.status!=="ativo")throw g("Item j\xE1 cancelado");let d=null;e.ctx.can("pdv.cancelar_item")||(d=(await Ae(
o,e.ctx,t.authorization,"cancelar_item")).authorized_by);let l=["preparando","pronto","entregue"].includes(r.kitchen_status);if(await o.query(`update order_items set status = 'canc\
elado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where id = $1`,[r.id,t.reason,e.ctx.userId]),(await R(o,i.id)).
balance<0)throw g("Cancelar este item deixaria o consumo com pagamento maior que o total. Estorne o pagamento antes.","overpaid");return await o.query("update consumption_sessions \
set version = version + 1 where id = $1",[i.id]),l||await ct(o,e.ctx,r.id,`Cancelamento: ${t.reason}`),await h(o,e.ctx,"pdv.item_cancelado",{entity:"item",entityId:r.id,unitId:i.unit_id,
reason:t.reason,data:{session:i.id,total_cents:r.total_cents,after_preparation:l,kitchen_status:r.kitchen_status,authorized_by:d}}),{ok:!0,after_preparation:l,totals:await R(o,i.id)}});
a.json(n)}));F.post("/items/transfer",p("pdv.transferir_item"),u(async(e,a)=>{let t=w(x.object({item_ids:x.array(x.number().int()).min(1).max(200),target_session_id:x.number().int(),
reason:x.string().trim().min(3).max(200)}),e.body);a.json(await $(n=>pa(n,e.ctx,t.item_ids,t.target_session_id,t.reason)))}));async function pa(e,a,t,n,o){let s=(await e.query("sel\
ect * from order_items where id = any($1) and company_id = $2 and status = 'ativo'",[t,a.companyId])).rows;if(s.length!==new Set(t).size)throw y("Itens inv\xE1lidos ou j\xE1 cancelados");
let i=[...new Set(s.map(m=>Number(m.session_id)))],r=[...i,n].sort((m,f)=>m-f),d={};for(let m of r)d[m]=await Z(e,a.companyId,m);let l=d[n];Te(l);for(let m of i){let f=d[m];if(Te(f),
m===n)throw y("Origem e destino iguais");if(f.unit_id!==l.unit_id)throw y("Transfer\xEAncia entre unidades n\xE3o permitida")}for(let m of s){let f=await e.query(`insert into order\
_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, transferred_from)
       select company_id, $2, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents, total_cents, notes,
              sector_id, kitchen_status, launch_mode, $3, $4, idempotency_key || '-t' || $5, id from order_items where id = $1 returning id`,[m.id,n,a.terminalId,a.userId,String(m.
id)]);await e.query("update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now() where id = $1",[m.id,`Transferido para consumo ${n} (ite\
m ${f.rows[0].id})`,a.userId])}for(let m of i){if((await R(e,m)).balance<0)throw g("A origem ficaria com pagamento maior que o consumo. Estorne antes de transferir.","overpaid");await e.
query("update consumption_sessions set version = version + 1 where id = $1",[m])}return await e.query("update consumption_sessions set version = version + 1 where id = $1",[n]),await h(
e,a,"pdv.itens_transferidos",{entity:"session",entityId:n,reason:o,data:{items:t,from:i}}),{ok:!0,moved:s.length}}F.post("/sessions/:id/merge",p("pdv.transferir_item"),u(async(e,a)=>{
let t=w(x.object({target_session_id:x.number().int(),reason:x.string().trim().min(3).max(200)}),e.body),n=Number(e.params.id);a.json(await $(async o=>{let s=(await o.query("select \
id from order_items where session_id = $1 and company_id = $2 and status = 'ativo'",[n,e.ctx.companyId])).rows.map(d=>d.id);if(!s.length)throw y("Consumo sem itens para juntar");if((await o.
query("select 1 from payments where session_id = $1 and status = 'confirmado'",[n])).rows[0])throw g("Consumo com pagamento registrado n\xE3o pode ser juntado; transfira os itens rest\
antes","has_payments");let r=await pa(o,e.ctx,s,t.target_session_id,t.reason);return await o.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_\
by = $2, label = coalesce(label,'') || ' (juntada)' where id = $1",[n,e.ctx.userId]),r}))}));F.post("/sessions/:id/move-table",p("pdv.transferir_item"),u(async(e,a)=>{let t=w(x.object(
{table_id:x.number().int(),reason:x.string().trim().min(3).max(200)}),e.body);await $(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));Te(o);let s=(await n.query("sel\
ect * from dining_tables where id = $1 and company_id = $2 and active",[t.table_id,e.ctx.companyId])).rows[0];if(!s)throw b("Mesa n\xE3o encontrada");if(s.unit_id!==o.unit_id)throw y(
"Mesa de outra unidade");await n.query("update consumption_sessions set table_id = $2, version = version + 1 where id = $1",[o.id,s.id]),await n.query("update dining_tables set sta\
tus = 'ocupada' where id = $1",[s.id]),o.table_id&&await un(n,o.table_id),await h(n,e.ctx,"pdv.mesa_trocada",{entity:"session",entityId:o.id,reason:t.reason,data:{from:o.table_id,to:s.
id}})}),a.json({ok:!0})}));async function un(e,a){await e.query(`update dining_tables set status = 'limpeza' where id = $1 and status in ('ocupada','conta')
                  and not exists (select 1 from consumption_sessions where table_id = $1 and status in ('aberta','em_fechamento'))`,[a])}F.post("/sessions/:id/service-fee",p("pdv.l\
ancar"),u(async(e,a)=>{let t=w(x.object({bp:x.number().int().min(0).max(3e3),reason:x.string().trim().min(3).max(200),authorization:x.string().max(100).optional()}),e.body);a.json(
await $(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));if(!["aberta","em_fechamento"].includes(o.status))throw g("Consumo encerrado");e.ctx.can("pdv.taxa_servico")||
await Ae(n,e.ctx,t.authorization,"taxa_servico");let s=(await R(n,o.id)).paid;await n.query("update consumption_sessions set service_fee_bp = $2, service_fee_removed_reason = $3, v\
ersion = version + 1 where id = $1",[o.id,t.bp,t.reason]);let i=await R(n,o.id);if(s>i.total)throw g("Pagamento registrado supera o novo total. Estorne antes.","overpaid");return await h(
n,e.ctx,"pdv.taxa_servico",{entity:"session",entityId:o.id,reason:t.reason,data:{from:o.service_fee_bp,to:t.bp}}),i}))}));F.post("/sessions/:id/request-close",p("pdv.lancar"),u(async(e,a)=>{
a.json(await $(async t=>{let n=await Z(t,e.ctx.companyId,Number(e.params.id));return Te(n),await t.query("update consumption_sessions set status = 'em_fechamento', version = versio\
n + 1 where id = $1",[n.id]),n.table_id&&await t.query("update dining_tables set status = 'conta' where id = $1",[n.table_id]),{ok:!0}}))}));F.post("/sessions/:id/resume",p("pdv.la\
ncar"),u(async(e,a)=>{a.json(await $(async t=>{let n=await Z(t,e.ctx.companyId,Number(e.params.id));if(n.status!=="em_fechamento")throw g("Consumo n\xE3o est\xE1 em fechamento");return await t.
query("update consumption_sessions set status = 'aberta', version = version + 1 where id = $1",[n.id]),n.table_id&&await t.query("update dining_tables set status = 'ocupada' where \
id = $1",[n.table_id]),{ok:!0}}))}));F.post("/sessions/:id/suspend",p("pdv.lancar"),u(async(e,a)=>{let t=w(x.object({suspended:x.boolean()}),e.body);await c("update consumption_ses\
sions set suspended = $3 where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId,t.suspended]),a.json({ok:!0})}));F.get("/sessions/:id/split",p("pdv.lancar"),u(async(e,a)=>{
let t=Math.min(Math.max(Number(e.query.parts)||2,2),50),n=await R({query:c},Number(e.params.id));a.json({parts:In(Math.max(n.balance,0),t),balance:n.balance})}));F.post("/sessions/\
:id/close",p("pdv.receber"),u(async(e,a)=>{let t=w(x.object({version:x.number().int()}),e.body);a.json(await $(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));if(!["\
aberta","em_fechamento"].includes(o.status))throw g("Consumo j\xE1 encerrado","already_closed");if(o.version!==t.version)throw g("O consumo foi alterado em outro terminal. Confira \
antes de fechar.","version_conflict",{version:o.version});let s=await R(n,o.id);if(s.balance!==0)throw g(`Saldo pendente de ${(s.balance/100).toFixed(2)}. Receba antes de encerrar.`,
"balance_pending");if(s.items===0)throw y("Consumo sem itens: use cancelar");await n.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2,\
 version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await un(n,o.table_id);let i=await zt(n,e.ctx,o,s.items);return await h(n,e.ctx,"consumo.encerrado",{entity:"\
session",entityId:o.id,unitId:o.unit_id,data:s}),{ok:!0,totals:s,points_earned:i?.points||0}}))}));F.post("/sessions/:id/cancel",p("pdv.lancar"),u(async(e,a)=>{let t=w(x.object({reason:x.
string().trim().min(3).max(200),authorization:x.string().max(100).optional()}),e.body);a.json(await $(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));if(!["aberta","\
em_fechamento"].includes(o.status))throw g("Consumo j\xE1 encerrado");let s=await R(n,o.id);if(s.paid>0)throw g("H\xE1 pagamentos confirmados: estorne antes de cancelar","has_payme\
nts");let i=null;s.items>0&&!e.ctx.can("pdv.cancelar_venda")&&(i=(await Ae(n,e.ctx,t.authorization,"cancelar_venda")).authorized_by);let r=(await n.query("select id from order_item\
s where session_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','nao_produz')",[o.id])).rows;for(let d of r)await ct(n,e.ctx,d.id,`Consumo cancelado: ${t.reason}`);
return await n.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end
                    where session_id = $1 and status = 'ativo'`,[o.id,`Consumo cancelado: ${t.reason}`,e.ctx.userId]),await n.query("update consumption_sessions set status = 'cance\
lada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await un(n,o.table_id),await h(n,e.ctx,"consumo.cancelado",{entity:"\
session",entityId:o.id,reason:t.reason,data:{items_cents:s.items,authorized_by:i}}),{ok:!0}}))}));F.post("/sessions/:id/reopen",p("pdv.lancar"),u(async(e,a)=>{let t=w(x.object({reason:x.
string().trim().min(3).max(200),authorization:x.string().max(100).optional()}),e.body);a.json(await $(async n=>{let o=await Z(n,e.ctx.companyId,Number(e.params.id));if(o.status!=="\
encerrada")throw g("S\xF3 consumos encerrados podem ser reabertos");let s=null;if(e.ctx.can("pdv.reabrir_comanda")||(s=(await Ae(n,e.ctx,t.authorization,"reabrir_comanda")).authorized_by),
o.card_id&&(await n.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento') and id <> $2",[o.card_id,o.id])).rows[0])throw g("O cart\xE3o\
 j\xE1 est\xE1 em uso por outro consumo. Transfira os itens em vez de reabrir.","card_busy");return await n.query("update consumption_sessions set status = 'aberta', closed_at = nu\
ll, closed_by = null, version = version + 1 where id = $1",[o.id]),await da(n,e.ctx,o.id,"Consumo reaberto"),o.table_id&&await n.query("update dining_tables set status = 'ocupada' \
where id = $1",[o.table_id]),await h(n,e.ctx,"consumo.reaberto",{entity:"session",entityId:o.id,reason:t.reason,data:{authorized_by:s}}),{ok:!0}}))}));async function Ao(e,a,t){let n=[
a.companyId],o="company_id = $1 and status = 'aberto'";return a.terminalId?(n.push(a.terminalId),o+=` and terminal_id = $${n.length}`):(n.push(a.userId,t),o+=` and user_id = $${n.length-
1} and unit_id = $${n.length} and terminal_id is null`),(await e.query(`select * from cash_sessions where ${o} order by id desc limit 1`,n)).rows[0]}var Oo=x.object({method:x.enum(
["dinheiro","pix","debito","credito","vale","outro"]),amount_cents:x.number().int().positive().max(1e8),tendered_cents:x.number().int().positive().max(1e8).optional(),idempotency_key:x.
string().regex(/^[A-Za-z0-9_-]{8,80}$/)});F.post("/sessions/:id/payments",p("pdv.receber"),u(async(e,a)=>{let t=w(Oo,e.body),n=e.ctx,o=await c("select * from payments where company\
_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(o.rows[0])return a.json({payment:o.rows[0],replay:!0,totals:await R({query:c},o.rows[0].session_id)});let s=await $(
async i=>{let r=await Z(i,n.companyId,Number(e.params.id));if(be(n,r.unit_id),!["aberta","em_fechamento"].includes(r.status))throw g("Consumo encerrado","session_not_open");let d=await Ce(
i,n,r.unit_id),l=await Ao(i,n,r.unit_id);if(!l&&d.require_open_cash)throw g("Abra o caixa antes de receber","cash_closed");let m=await R(i,r.id);if(t.amount_cents>m.balance)throw y(
`Valor maior que o saldo (${(m.balance/100).toFixed(2)})`,"over_balance");let f=0;if(t.tendered_cents!=null){if(t.method!=="dinheiro")throw y("Troco s\xF3 \xE9 permitido em dinheiro",
"change_not_allowed");if(t.tendered_cents<t.amount_cents)throw y("Valor entregue menor que o valor a pagar");f=t.tendered_cents-t.amount_cents}let{day_cutoff:_,timezone:k}=await la(
i,n.companyId,r.unit_id),j=(await i.query(`insert into payments (company_id, session_id, cash_session_id, method, amount_cents, tendered_cents, change_cents, business_date, idempot\
ency_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[n.companyId,r.id,l?.id??null,t.method,t.amount_cents,t.tendered_cents??null,f,me(new Date,k,_),t.idempotency_key,n.userId])).
rows[0];return await i.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),await h(i,n,"pagamento.registrado",{entity:"payment",entityId:j.id,unitId:r.
unit_id,data:{session:r.id,method:t.method,amount_cents:t.amount_cents,change_cents:f}}),{payment:j,totals:await R(i,r.id)}}).catch(async i=>{if(i.code==="23505"){let r=await c("se\
lect * from payments where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(r.rows[0])return{payment:r.rows[0],replay:!0,totals:await R({query:c},r.rows[0].
session_id)}}throw i});a.status(s.replay?200:201).json(s)}));F.post("/payments/:id/refund",p("financeiro.estornar"),u(async(e,a)=>{let t=w(x.object({reason:x.string().trim().min(3).
max(200)}),e.body);a.json(await $(async n=>{let o=(await n.query("select * from payments where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw b(
"Pagamento n\xE3o encontrado");let s=await Z(n,e.ctx.companyId,o.session_id);if(!["aberta","em_fechamento"].includes(s.status))throw g("Reabra o consumo antes de estornar","session\
_closed");if(!(await n.query(`update payments set status = 'estornado', refund_reason = $2, refunded_by = $3, refunded_at = now()
                              where id = $1 and status = 'confirmado' returning id`,[o.id,t.reason,e.ctx.userId])).rows[0])throw g("Pagamento j\xE1 estornado");return await n.query(
"update consumption_sessions set version = version + 1 where id = $1",[s.id]),await ua(n,e.ctx,o.id),await h(n,e.ctx,"pagamento.estornado",{entity:"payment",entityId:o.id,reason:t.
reason,data:{amount_cents:o.amount_cents,method:o.method}}),{ok:!0,totals:await R(n,s.id)}}))}));F.post("/sessions/:id/send",p("pdv.lancar"),u(async(e,a)=>{a.json(await $(async t=>{
let n=await Z(t,e.ctx.companyId,Number(e.params.id));be(e.ctx,n.unit_id);let o=await t.query(`update order_items set sent_at = now() where session_id = $1 and status = 'ativo' and \
sent_at is null
      and kitchen_status = 'novo' returning id`,[n.id]);return o.rowCount&&await h(t,e.ctx,"producao.lote_enviado",{entity:"session",entityId:n.id,data:{items:o.rowCount}}),{sent:o.
rowCount}}))}));F.post("/mode",p("pdv.lancar"),u(async(e,a)=>{let t=w(x.object({from:x.enum(["manual","continua","dupla"]),to:x.enum(["manual","continua","dupla"]),reason:x.string().
trim().max(200).optional()}),e.body),n=await Ce({query:c},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId);if(t.from!==t.to){if(J(e.ctx,"pdv.alterar_modo"),!n.allow_mode_change)throw T("T\
roca de modo desabilitada nesta configura\xE7\xE3o","mode_locked");if(n.double_read_mandatory&&t.to!=="dupla")throw T("Dupla leitura obrigat\xF3ria: use a exce\xE7\xE3o autorizada",
"double_read_required");if(!n.scanner_enabled&&t.to!=="manual")throw T("Leitor desabilitado","scanner_disabled")}await h({query:c},e.ctx,"pdv.modo_alterado",{reason:t.reason,data:{
from:t.from,to:t.to}}),a.json({ok:!0,mode:t.to})}));import{Router as Do}from"npm:express@5.2.1";import{z as Y}from"npm:zod@4.6.5";var qe=Do(),ln=["dinheiro","pix","debito","credito","vale","outro"];async function St(e,a){let t=(await e.query("select opening_cents from cash_sessions where id = $1",[a])).rows[0],
n=(await e.query("select method, coalesce(sum(amount_cents),0)::bigint as total from payments where cash_session_id = $1 and status = 'confirmado' group by method",[a])).rows,o=(await e.
query("select kind, coalesce(sum(amount_cents),0)::bigint as total from cash_movements where cash_session_id = $1 group by kind",[a])).rows,s=Object.fromEntries(ln.map(r=>[r,0]));for(let r of n)
s[r.method]=Number(r.total);let i=Object.fromEntries(o.map(r=>[r.kind,Number(r.total)]));return s.dinheiro=t.opening_cents+s.dinheiro+(i.suprimento||0)-(i.sangria||0)-(i.despesa||0),
{byMethod:s,opening:t.opening_cents,movements:i}}async function _a(e){let a=[e.ctx.companyId],t="c.company_id = $1 and c.status = 'aberto'";return e.ctx.terminalId?(a.push(e.ctx.terminalId),
t+=` and c.terminal_id = $${a.length}`):(a.push(e.ctx.userId),t+=` and c.user_id = $${a.length} and c.terminal_id is null`),(await c(`select c.*, u.name as user_name from cash_sess\
ions c join users u on u.id = c.user_id where ${t} order by c.id desc limit 1`,a)).rows[0]}qe.get("/current",u(async(e,a)=>{let t=await _a(e);if(!t)return a.json({open:!1});let n=e.
ctx.can("financeiro.visualizar");a.json({open:!0,cash:{id:t.id,opened_at:t.opened_at,user_name:t.user_name,opening_cents:t.opening_cents,business_date:t.business_date},expected:n?await St(
{query:c},t.id):null})}));qe.post("/open",p("caixa.abrir"),u(async(e,a)=>{let t=w(Y.object({opening_cents:Y.number().int().min(0).max(1e7)}),e.body),n=e.ctx.terminalUnitId||e.ctx.unitId||
(await c("select id from units where company_id = $1 order by id limit 1",[e.ctx.companyId])).rows[0].id;if(!e.ctx.terminalId&&(await c("select 1 from terminals where company_id = \
$1 and active limit 1",[e.ctx.companyId])).rows[0])throw y("Identifique o terminal deste dispositivo antes de abrir o caixa","terminal_required");if(await _a(e))throw g("J\xE1 existe \
caixa aberto neste terminal","cash_open");let o=(await c("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1",[n])).rows[0],s=await c(
"insert into cash_sessions (company_id, unit_id, terminal_id, user_id, opening_cents, business_date) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,n,e.ctx.terminalId,e.
ctx.userId,t.opening_cents,me(new Date,o.timezone,o.day_cutoff)]).catch(i=>{throw i.code==="23505"?g("J\xE1 existe caixa aberto neste terminal","cash_open"):i});await h({query:c},e.
ctx,"caixa.aberto",{entity:"cash",entityId:s.rows[0].id,unitId:n,data:t}),a.status(201).json({id:s.rows[0].id})}));qe.post("/:id/movements",u(async(e,a)=>{let t=w(Y.object({kind:Y.
enum(["sangria","suprimento","despesa"]),amount_cents:Y.number().int().positive().max(1e7),reason:Y.string().trim().min(3).max(200)}),e.body);J(e.ctx,t.kind==="suprimento"?"caixa.s\
uprimento":"caixa.sangria");let n=await $(async o=>{let s=(await o.query("select * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).
rows[0];if(!s)throw b("Caixa n\xE3o encontrado");if(s.status!=="aberto")throw g("Caixa fechado");if(t.kind!=="suprimento"){let r=await St(o,s.id);if(t.amount_cents>r.byMethod.dinheiro)
throw y("Valor maior que o dinheiro esperado na gaveta")}let i=await o.query("insert into cash_movements (company_id, cash_session_id, kind, amount_cents, reason, user_id) values (\
$1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,s.id,t.kind,t.amount_cents,t.reason,e.ctx.userId]);return await h(o,e.ctx,`caixa.${t.kind}`,{entity:"cash",entityId:s.id,reason:t.
reason,data:{amount_cents:t.amount_cents}}),{id:i.rows[0].id}});a.status(201).json(n)}));qe.post("/:id/close",p("caixa.fechar"),u(async(e,a)=>{let t=w(Y.object({counted:Y.object(Object.
fromEntries(ln.map(o=>[o,Y.number().int().min(0).max(1e8).default(0)]))),notes:Y.record(Y.string(),Y.number().int().min(0).max(1e5)).optional(),justification:Y.string().trim().max(
300).optional()}),e.body),n=await $(async o=>{let s=(await o.query("select * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).
rows[0];if(!s)throw b("Caixa n\xE3o encontrado");if(s.status!=="aberto")throw g("Caixa j\xE1 fechado");let i=await St(o,s.id),r=Object.fromEntries(ln.map(l=>[l,(t.counted[l]||0)-(i.
byMethod[l]||0)])),d=Object.values(r).reduce((l,m)=>l+m,0);if(Object.values(r).some(l=>l!==0)&&!t.justification)throw y("H\xE1 diferen\xE7a na confer\xEAncia: informe a justificativa",
"justification_required");return await o.query(`update cash_sessions set status = 'fechado', closed_at = now(), closed_by = $2, counted = $3, expected = $4,
                      difference_cents = $5, justification = $6 where id = $1`,[s.id,e.ctx.userId,{...t.counted,notes:t.notes??null},i.byMethod,d,t.justification??null]),await h(o,
e.ctx,"caixa.fechado",{entity:"cash",entityId:s.id,reason:t.justification,data:{difference_cents:d,by_method:r}}),{ok:!0,expected:i.byMethod,counted:t.counted,difference_cents:d,by_method:r}});
a.json(n)}));qe.post("/:id/reopen",p("caixa.reabrir"),u(async(e,a)=>{let t=w(Y.object({reason:Y.string().trim().min(3).max(200)}),e.body);await $(async n=>{let o=(await n.query("se\
lect * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw b();if(o.status!=="fechado")throw g("Caixa n\xE3o e\
st\xE1 fechado");if(new Date(o.closed_at)<new Date(Date.now()-48*3600*1e3))throw y("Reabertura permitida at\xE9 48 horas ap\xF3s o fechamento");if((o.terminal_id?await n.query("sel\
ect 1 from cash_sessions where terminal_id = $1 and status = 'aberto'",[o.terminal_id]):{rows:[]}).rows[0])throw g("J\xE1 existe outro caixa aberto neste terminal");await n.query("\
update cash_sessions set status = 'aberto', closed_at = null, closed_by = null where id = $1",[o.id]),await h(n,e.ctx,"caixa.reaberto",{entity:"cash",entityId:o.id,reason:t.reason,
data:{previous:{counted:o.counted,difference_cents:o.difference_cents,closed_at:o.closed_at}}})}),a.json({ok:!0})}));qe.get("/",p("financeiro.visualizar"),u(async(e,a)=>{a.json((await c(
`select c.id, c.status, c.opened_at, c.closed_at, c.business_date, c.opening_cents, c.difference_cents, c.justification,
                            u.name as user_name, t.name as terminal_name
                       from cash_sessions c join users u on u.id = c.user_id left join terminals t on t.id = c.terminal_id
                      where c.company_id = $1 order by c.id desc limit 100`,[e.ctx.companyId])).rows)}));qe.get("/:id/report",p("financeiro.visualizar"),u(async(e,a)=>{let t=(await c(
"select * from cash_sessions where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw b();let n=(await c("select m.kind, m.amount_cents, m.rea\
son, m.created_at, u.name user_name from cash_movements m left join users u on u.id = m.user_id where cash_session_id = $1 order by m.id",[t.id])).rows;a.json({cash:t,expected:await St(
{query:c},t.id),movements:n})}));import{Router as Po}from"npm:express@5.2.1";var Nt=Po();Nt.get("/dashboard",u(async(e,a)=>{let t=e.ctx,n=(await c("select id, day_cutoff from units where company_id = $1 and ($2::bigint is null or id = $2) order by id limit \
1",[t.companyId,t.terminalUnitId||t.unitId||null])).rows[0],o=me(new Date,t.company.timezone,n?.day_cutoff??5),s=t.can("financeiro.visualizar"),i=(await c(`select
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
latorios"]})}));Nt.get("/search",u(async(e,a)=>{let t=String(e.query.q||"").trim().slice(0,60);if(t.length<2)return a.json([]);let n=e.ctx,o=`%${t}%`,s=[];if(n.can("cardapio.visual\
izar")){let i=await c("select id, name from products where company_id = $1 and (name ilike $2 or sku = $3) order by name limit 6",[n.companyId,o,t]);s.push(...i.rows.map(r=>({type:"\
produto",id:r.id,label:r.name,to:`/cardapio?produto=${r.id}`})))}if(n.can("pdv.lancar")){let i=Number(t.replace(/\D/g,""));if(i){let d=await c(`select s.id, c.number card, t.number\
 tbl, s.status from consumption_sessions s left join tab_cards c on c.id = s.card_id
                          left join dining_tables t on t.id = s.table_id
                          where s.company_id = $1 and (c.number = $2 or t.number = $2 or s.id = $2) and s.status in ('aberta','em_fechamento') limit 6`,[n.companyId,i]);s.push(...d.
rows.map(l=>({type:"consumo",id:l.id,label:l.card?`Comanda ${l.card}`:l.tbl?`Mesa ${l.tbl}`:`Consumo ${l.id}`,to:`/pdv?sessao=${l.id}`})))}let r=await c(`select s.id, s.customer_na\
me, s.label from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')
                         and (s.customer_name ilike $2 or s.label ilike $2) limit 5`,[n.companyId,o]);s.push(...r.rows.map(d=>({type:"consumo",id:d.id,label:d.customer_name||d.label,
to:`/pdv?sessao=${d.id}`})))}if(n.can("usuarios.gerenciar")){let i=await c("select id, name from users where company_id = $1 and name ilike $2 limit 4",[n.companyId,o]);s.push(...i.
rows.map(r=>({type:"usuario",id:r.id,label:r.name,to:"/configuracoes/usuarios"})))}a.json(s)}));import{Router as To}from"npm:express@5.2.1";import{z as N}from"npm:zod@4.6.5";var X=To(),ya=N.object({name:N.string().trim().min(2).max(100),cpf:N.string().max(20).optional().nullable(),phone:N.string().trim().max(30).optional().nullable(),email:N.string().trim().
email().max(120).optional().nullable().or(N.literal("")),birthday:N.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(N.literal("")),address:N.object({street:N.string().
max(120).optional(),number:N.string().max(20).optional(),district:N.string().max(80).optional(),city:N.string().max(80).optional(),complement:N.string().max(80).optional(),reference:N.
string().max(120).optional()}).partial().optional(),tags:N.array(N.string().trim().min(1).max(30)).max(20).optional(),preferences:N.string().max(300).optional().nullable(),notes:N.
string().max(500).optional().nullable(),consent_whatsapp:N.boolean().optional(),consent_email:N.boolean().optional()}),fa=e=>{let a=oe(e);return a?a.slice(-13):null};async function wa(e,a,t){
if(!t.length)return{};let n=await e.query(`select s.customer_id, count(*)::int as visits, max(s.closed_at) as last_visit,
            coalesce(sum((select coalesce(sum(i.total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo')),0)::bigint as spent_cents
       from consumption_sessions s where s.company_id = $1 and s.customer_id = any($2) and s.status = 'encerrada' group by s.customer_id`,[a,t]);return Object.fromEntries(n.rows.map(
o=>[o.customer_id,o]))}X.get("/lookup",p("clientes.visualizar"),u(async(e,a)=>{let t=jt(e.query.cpf,{required:!0}),n=(await c("select * from customers where company_id = $1 and cpf\
 = $2 and anonymized_at is null",[e.ctx.companyId,t])).rows[0];if(!n)return a.json({found:!1,cpf:cn(t)});let o=(await c(`select s.id, s.kind, t.number as table_number, cd.number as\
 card_number from consumption_sessions s
      left join dining_tables t on t.id = s.table_id left join tab_cards cd on cd.id = s.card_id
     where s.company_id = $1 and s.customer_id = $2 and s.status in ('aberta','em_fechamento') limit 3`,[e.ctx.companyId,n.id])).rows;a.json({found:!0,customer:{id:n.id,name:n.name,
points:n.points,tags:n.tags,preferences:n.preferences},open_sessions:o})}));X.get("/",p("clientes.visualizar"),u(async(e,a)=>{let t=[e.ctx.companyId],n="c.company_id = $1 and c.ano\
nymized_at is null",o=String(e.query.q||"").trim().slice(0,80);if(o){let m=oe(o);t.push(`%${o.toLowerCase()}%`),n+=` and (lower(c.name) like $${t.length}`,m.length>=3&&(t.push(`%${m}\
%`),n+=` or c.cpf like $${t.length} or regexp_replace(coalesce(c.phone,''),'\\D','','g') like $${t.length}`),n+=")"}e.query.tag&&(t.push(String(e.query.tag)),n+=` and $${t.length} \
= any(c.tags)`),e.query.birthday==="mes"&&(n+=" and extract(month from c.birthday) = extract(month from current_date)");let s=Math.min(200,Number(e.query.limit)||50),i=Math.max(0,Number(
e.query.offset)||0),r=(await c(`select count(*)::int as n from customers c where ${n}`,t)).rows[0].n,d=(await c(`select c.* from customers c where ${n} order by lower(c.name) limit\
 ${s} offset ${i}`,t)).rows,l=await wa({query:c},e.ctx.companyId,d.map(m=>m.id));a.json({total:r,items:d.map(m=>Qe({...m,...l[m.id]||{visits:0,spent_cents:0,last_visit:null}},e.ctx))})}));
X.get("/summary",p("clientes.visualizar"),u(async(e,a)=>{let t=(await c(`select count(*)::int as total,
      count(*) filter (where extract(month from birthday) = extract(month from current_date))::int as birthdays,
      count(*) filter (where consent_whatsapp and unsubscribed_at is null)::int as whatsapp_ok,
      coalesce(sum(points),0)::int as points
    from customers where company_id = $1 and anonymized_at is null`,[e.ctx.companyId])).rows[0],n=(await c("select t as tag, count(*)::int as n from customers, unnest(tags) t where\
 company_id = $1 and anonymized_at is null group by t order by n desc limit 20",[e.ctx.companyId])).rows,o=(await c("select settings from companies where id = $1",[e.ctx.companyId])).
rows[0];a.json({...t,tags:n,loyalty:It(o.settings)})}));X.put("/loyalty",p("clientes.gerenciar","configuracoes.gerenciar"),u(async(e,a)=>{let t=w(N.object({enabled:N.boolean(),cents_per_point:N.
number().int().min(1).max(1e5),point_value_cents:N.number().int().min(1).max(1e4),validity_days:N.number().int().min(7).max(3650),min_redeem:N.number().int().min(1).max(1e5)}),e.body);
await c("update companies set settings = jsonb_set(settings, '{loyalty}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await h({query:c},e.ctx,"fidelidade.configu\
racao",{data:t}),a.json({ok:!0})}));X.get("/:id",p("clientes.visualizar"),u(async(e,a)=>{let t=Number(e.params.id);await $(l=>dn(l,e.ctx.companyId,t));let n=(await c("select * from\
 customers where id = $1 and company_id = $2",[t,e.ctx.companyId])).rows[0];if(!n)throw b("Cliente n\xE3o encontrado");let o=(await wa({query:c},e.ctx.companyId,[t]))[t]||{visits:0,
spent_cents:0,last_visit:null},s=(await c(`select s.id, s.kind, s.opened_at, s.closed_at, s.status,
       (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
       (select string_agg(i.description, ', ' order by i.id) from (select description, id from order_items where session_id = s.id and status = 'ativo' limit 6) i) as items
     from consumption_sessions s where s.company_id = $1 and s.customer_id = $2 order by s.opened_at desc limit 30`,[e.ctx.companyId,t])).rows,i=(await c("select id, kind, points, \
expires_at, reason, session_id, created_at from loyalty_ledger where company_id = $1 and customer_id = $2 order by id desc limit 50",[e.ctx.companyId,t])).rows,r=(await c("select i\
d, score, comment, created_at from reviews where company_id = $1 and customer_id = $2 order by id desc limit 10",[e.ctx.companyId,t])).rows,d=o.visits?Math.round(Number(o.spent_cents)/
o.visits):0;a.json({customer:Qe({...n,...o},e.ctx),ticket_cents:d,history:s,ledger:i,reviews:r})}));function ha(e,a){return{cpf:e.cpf!==void 0?jt(e.cpf):void 0,phone:e.phone!==void 0?
e.phone||null:void 0,email:e.email!==void 0?e.email||null:void 0,birthday:e.birthday!==void 0?e.birthday||null:void 0,consent_at:e.consent_whatsapp||e.consent_email?new Date:void 0,
by:a.userId}}async function Ro(e,a,t){let n=ha(t,a);if(n.phone&&fa(n.phone).length<10)throw y("Telefone deve ter DDD");let o=await e.query(`insert into customers (company_id, cpf, \
name, phone, email, birthday, address, tags, preferences, notes, consent_whatsapp, consent_email, consent_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,[a.companyId,n.cpf??null,t.name,n.phone??null,n.email??null,n.birthday??null,t.address||{},t.tags||[],t.preferences??
null,t.notes??null,!!t.consent_whatsapp,!!t.consent_email,n.consent_at??null,a.userId]).catch(s=>{throw s.code==="23505"?g("J\xE1 existe cliente com este CPF","cpf_in_use"):s});return await h(
e,a,"cliente.criado",{entity:"customer",entityId:o.rows[0].id,data:{consent_whatsapp:!!t.consent_whatsapp,consent_email:!!t.consent_email}}),o.rows[0]}X.post("/",p("clientes.gerenc\
iar"),u(async(e,a)=>{let t=w(ya,e.body),n=await $(o=>Ro(o,e.ctx,t));a.status(201).json(Qe(n,e.ctx))}));X.put("/:id",p("clientes.gerenciar"),u(async(e,a)=>{let t=w(ya.partial(),e.body),
n=Number(e.params.id),o=await $(async s=>{let i=(await s.query("select * from customers where id = $1 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!i)throw b("C\
liente n\xE3o encontrado");if(i.anonymized_at)throw g("Cliente anonimizado n\xE3o pode ser editado");if(!e.ctx.can("dados.pessoais"))for(let m of["cpf","phone","email","birthday","\
address"])delete t[m];let r=ha(t,e.ctx),d=t.consent_whatsapp!==void 0&&t.consent_whatsapp!==i.consent_whatsapp||t.consent_email!==void 0&&t.consent_email!==i.consent_email,l=await s.
query(`update customers set name = coalesce($3,name), cpf = case when $4::boolean then $5 else cpf end, phone = case when $6::boolean then $7 else phone end,
         email = case when $8::boolean then $9 else email end, birthday = case when $10::boolean then $11::date else birthday end,
         address = coalesce($12,address), tags = coalesce($13,tags), preferences = coalesce($14,preferences), notes = coalesce($15,notes),
         consent_whatsapp = coalesce($16,consent_whatsapp), consent_email = coalesce($17,consent_email),
         consent_at = case when $18::boolean then now() else consent_at end,
         unsubscribed_at = case when coalesce($16,false) or coalesce($17,false) then null else unsubscribed_at end, updated_at = now()
       where id = $1 and company_id = $2 returning *`,[n,e.ctx.companyId,t.name??null,r.cpf!==void 0,r.cpf??null,r.phone!==void 0,r.phone??null,r.email!==void 0,r.email??null,r.birthday!==
void 0,r.birthday??null,t.address??null,t.tags??null,t.preferences??null,t.notes??null,t.consent_whatsapp??null,t.consent_email??null,d]).catch(m=>{throw m.code==="23505"?g("J\xE1 exi\
ste cliente com este CPF","cpf_in_use"):m});return await h(s,e.ctx,d?"cliente.consentimento":"cliente.alterado",{entity:"customer",entityId:n,data:{fields:Object.keys(t),consent_whatsapp:t.
consent_whatsapp,consent_email:t.consent_email}}),l.rows[0]});a.json(Qe(o,e.ctx))}));X.post("/:id/points",p("clientes.gerenciar","pdv.autorizar"),u(async(e,a)=>{let t=w(N.object({points:N.
number().int().refine(s=>s!==0).refine(s=>Math.abs(s)<=1e5),reason:N.string().trim().min(3).max(200)}),e.body),n=Number(e.params.id),o=await $(async s=>{let i=(await s.query("selec\
t points from customers where id = $1 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!i)throw b("Cliente n\xE3o encontrado");if(i.points+t.points<0)throw g("Saldo\
 n\xE3o pode ficar negativo");let r=await Me(s,e.ctx.companyId,n,{kind:"ajuste",points:t.points,reason:t.reason,user_id:e.ctx.userId});return await h(s,e.ctx,"cliente.pontos_ajusta\
dos",{entity:"customer",entityId:n,reason:t.reason,data:{points:t.points}}),r});a.status(201).json(o)}));X.post("/:id/redeem",p("pdv.receber"),u(async(e,a)=>{let t=w(N.object({session_id:N.
number().int(),points:N.number().int().positive(),idempotency_key:N.string().regex(/^[A-Za-z0-9_-]{8,80}$/)}),e.body),n=Number(e.params.id),o=await c("select * from payments where \
company_id = $1 and idempotency_key = $2",[e.ctx.companyId,t.idempotency_key]);if(o.rows[0])return a.json({payment:o.rows[0],replay:!0});let s=await $(async i=>{let r=await Z(i,e.ctx.
companyId,t.session_id);if(be(e.ctx,r.unit_id),!["aberta","em_fechamento"].includes(r.status))throw g("Consumo encerrado","session_not_open");if(Number(r.customer_id)!==n)throw g("\
O consumo n\xE3o est\xE1 identificado com este cliente","customer_mismatch");await dn(i,e.ctx.companyId,n);let d=(await i.query("select settings, timezone from companies where id =\
 $1",[e.ctx.companyId])).rows[0],l=It(d.settings);if(!l.enabled)throw g("Programa de fidelidade desligado");if(t.points<l.min_redeem)throw y(`Resgate m\xEDnimo de ${l.min_redeem} p\
ontos`);let m=t.points*l.point_value_cents,f=await R(i,r.id);if(m>f.balance)throw y("Valor do resgate maior que o saldo do consumo","over_balance");let _=(await i.query("select day\
_cutoff from units where id = $1",[r.unit_id])).rows[0],k=(await i.query(`insert into payments (company_id, session_id, method, amount_cents, business_date, idempotency_key, user_i\
d)
       values ($1,$2,'vale',$3,$4,$5,$6) returning *`,[e.ctx.companyId,r.id,m,me(new Date,d.timezone,_.day_cutoff),t.idempotency_key,e.ctx.userId])).rows[0];return await ma(i,e.ctx,
n,t.points,k.id,r.id),await i.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),await h(i,e.ctx,"cliente.pontos_resgatados",{entity:"payment",entityId:k.
id,unitId:r.unit_id,data:{customer:n,points:t.points,amount_cents:m}}),{payment:k,totals:await R(i,r.id)}});a.status(201).json(s)}));X.post("/attach",p("pdv.lancar"),u(async(e,a)=>{
let t=w(N.object({session_id:N.number().int(),customer_id:N.number().int().nullable()}),e.body),n=await $(async o=>{let s=await Z(o,e.ctx.companyId,t.session_id);if(be(e.ctx,s.unit_id),
!["aberta","em_fechamento"].includes(s.status))throw g("Consumo encerrado","session_not_open");let i=null;if(t.customer_id){let r=(await o.query("select name from customers where i\
d = $1 and company_id = $2 and anonymized_at is null",[t.customer_id,e.ctx.companyId])).rows[0];if(!r)throw b("Cliente n\xE3o encontrado");i=r.name}return await o.query("update con\
sumption_sessions set customer_id = $2, customer_name = coalesce($3, customer_name), version = version + 1 where id = $1",[s.id,t.customer_id,i]),await h(o,e.ctx,"consumo.cliente",
{entity:"session",entityId:s.id,data:{customer:t.customer_id}}),{ok:!0,customer_name:i}});a.json(n)}));X.get("/export/csv",p("clientes.gerenciar"),u(async(e,a)=>{let t=(await c("se\
lect * from customers where company_id = $1 and anonymized_at is null order by name",[e.ctx.companyId])).rows,o=[["nome","cpf","telefone","email","aniversario","etiquetas","pontos",
"whatsapp","email_ok"].join(";")];for(let s of t){let i=Qe(s,e.ctx);o.push([i.name,i.cpf,i.phone,i.email,i.birthday,(i.tags||[]).join("|"),i.points,i.consent_whatsapp?"sim":"nao",i.
consent_email?"sim":"nao"].map(Be).join(";"))}await h({query:c},e.ctx,"cliente.exportados",{data:{count:t.length,full:e.ctx.can("dados.pessoais")}}),a.setHeader("content-type","tex\
t/csv; charset=utf-8"),a.setHeader("content-disposition",'attachment; filename="clientes.csv"'),a.send(`\uFEFF${o.join(`
`)}`)}));X.post("/import",p("clientes.gerenciar","dados.pessoais"),u(async(e,a)=>{let t=w(N.object({rows:N.array(N.record(N.string(),N.any())).max(2e3),dry_run:N.boolean().default(
!0)}),e.body),n=(l,...m)=>{for(let f of Object.keys(l))if(m.includes(f.toLowerCase().trim()))return String(l[f]??"").trim();return""},o=(await c("select cpf, regexp_replace(coalesc\
e(phone,''),'\\D','','g') as phone from customers where company_id = $1",[e.ctx.companyId])).rows,s=new Set(o.map(l=>l.cpf).filter(Boolean)),i=new Set(o.map(l=>l.phone).filter(Boolean)),
r=[],d=[];t.rows.forEach((l,m)=>{let f=n(l,"nome","name","cliente"),_=n(l,"cpf","documento"),k=fa(n(l,"telefone","celular","whatsapp","phone")),j=n(l,"email","e-mail"),S=n(l,"anive\
rsario","anivers\xE1rio","nascimento","birthday"),A=S.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);A&&(S=`${A[3]}-${A[2]}-${A[1]}`);let D=m+2;if(f.length<2)return r.push({line:D,status:"er\
ro",message:"Nome ausente"});let M=null;if(_)try{M=jt(_)}catch{return r.push({line:D,status:"erro",message:"CPF inv\xE1lido"})}if(M&&s.has(M))return r.push({line:D,status:"duplicad\
o",message:"CPF j\xE1 cadastrado"});if(!M&&k&&i.has(k))return r.push({line:D,status:"duplicado",message:"Telefone j\xE1 cadastrado"});S&&!/^\d{4}-\d{2}-\d{2}$/.test(S)&&(S=""),M&&s.
add(M),k&&i.add(k),d.push({name:f.slice(0,100),cpf:M,phone:k,email:/@/.test(j)?j.slice(0,120):null,birthday:S||null}),r.push({line:D,status:"ok",name:f})}),!t.dry_run&&d.length&&await $(
async l=>{for(let m of d)await l.query("insert into customers (company_id, cpf, name, phone, email, birthday, created_by) values ($1,$2,$3,$4,$5,$6,$7)",[e.ctx.companyId,m.cpf,m.name,
m.phone,m.email,m.birthday,e.ctx.userId]);await h(l,e.ctx,"cliente.importados",{data:{count:d.length}})}),a.json({dry_run:t.dry_run,valid:d.length,report:r.slice(0,500)})}));X.post(
"/:id/anonymize",p("clientes.gerenciar","dados.pessoais"),u(async(e,a)=>{let t=w(N.object({reason:N.string().trim().min(3).max(200)}),e.body);J(e.ctx,"pdv.autorizar");let n=Number(
e.params.id);await $(async o=>{if(!(await o.query(`update customers set name = 'Cliente anonimizado', cpf = null, phone = null, email = null, birthday = null,
        address = '{}', tags = '{}', preferences = null, notes = null, consent_whatsapp = false, consent_email = false, anonymized_at = now(), updated_at = now()
      where id = $1 and company_id = $2 and anonymized_at is null returning id`,[n,e.ctx.companyId])).rows[0])throw b("Cliente n\xE3o encontrado");await o.query("update consumption\
_sessions set customer_name = null where company_id = $1 and customer_id = $2",[e.ctx.companyId,n]),await o.query("update delivery_orders set customer_name = 'Anonimizado', phone =\
 '', address = '{}' where company_id = $1 and customer_id = $2",[e.ctx.companyId,n]),await h(o,e.ctx,"cliente.anonimizado",{entity:"customer",entityId:n,reason:t.reason})}),a.json(
{ok:!0})}));import{Router as Mo}from"npm:express@5.2.1";import{z as _e}from"npm:zod@4.6.5";var ye=Mo(),Ct=["novo","aceito","preparando","pronto","entregue"];ye.get("/sectors",p("cozinha.operar"),u(async(e,a)=>{a.json((await c(`select s.id, s.name, s.target_minutes,
      (select count(*)::int from order_items i where i.sector_id = s.id and i.sent_at is not null and i.status = 'ativo'
         and i.kitchen_status in ('novo','aceito','preparando')) as open_count
    from production_sectors s where s.company_id = $1 and s.active order by s.id`,[e.ctx.companyId])).rows)}));ye.put("/sectors/:id",p("cardapio.gerenciar"),u(async(e,a)=>{let t=w(
_e.object({target_minutes:_e.number().int().min(1).max(240)}),e.body);if(!(await c("update production_sectors set target_minutes = $3 where id = $1 and company_id = $2 returning id",
[Number(e.params.id),e.ctx.companyId,t.target_minutes])).rows[0])throw b();a.json({ok:!0})}));ye.get("/queue",p("cozinha.operar"),u(async(e,a)=>{let t=[e.ctx.companyId],n=`i.compan\
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
companyId])).rows[0].id;a.json({now:new Date().toISOString(),last_event:i,items:s})}));ye.post("/items/:id/status",p("cozinha.operar"),u(async(e,a)=>{let t=w(_e.object({to:_e.enum(
["aceito","preparando","pronto","entregue"]),from:_e.string().optional()}),e.body),n=await $(async o=>{let s=(await o.query("select * from order_items where id = $1 and company_id \
= $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!s)throw b("Item n\xE3o encontrado");if(s.kitchen_status===t.to)return{ok:!0,replay:!0,status:s.kitchen_status};
if(s.status!=="ativo"||s.kitchen_status==="cancelado")throw g("Item cancelado: confirme a ci\xEAncia do cancelamento","item_canceled");if(!s.sent_at)throw g("Item ainda n\xE3o enviado\
 \xE0 produ\xE7\xE3o","not_sent");if(t.from&&t.from!==s.kitchen_status)throw g(`O item j\xE1 est\xE1 "${s.kitchen_status}" (alterado em outra tela)`,"status_changed",{status:s.kitchen_status});
let i=Ct.indexOf(s.kitchen_status);if(Ct.indexOf(t.to)<=i)throw g("N\xE3o \xE9 poss\xEDvel voltar a etapa anterior","invalid_transition");return await o.query(`update order_items s\
et kitchen_status = $2,
        accepted_at = coalesce(accepted_at, case when $2 in ('aceito','preparando','pronto','entregue') then now() end),
        ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
        delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`,[s.id,t.to]),await o.query("insert into kitchen_events (company_id, item_id, from_s\
tatus, to_status, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,s.id,s.kitchen_status,t.to,e.ctx.userId]),{ok:!0,status:t.to}});a.json(n)}));ye.post("/sessions/:id/advance",p(
"cozinha.operar"),u(async(e,a)=>{let t=w(_e.object({to:_e.enum(["aceito","preparando","pronto","entregue"]),sector_id:_e.number().int().optional()}),e.body),n=Ct.indexOf(t.to),o=await $(
async s=>{let i=[Number(e.params.id),e.ctx.companyId,Ct.slice(0,n)],r="";t.sector_id&&(i.push(t.sector_id),r=` and sector_id = $${i.length}`);let d=(await s.query(`select id, kitch\
en_status from order_items where session_id = $1 and company_id = $2 and status = 'ativo'
      and sent_at is not null and kitchen_status = any($3)${r} for update`,i)).rows;for(let l of d)await s.query(`update order_items set kitchen_status = $2, accepted_at = coalesce\
(accepted_at, now()),
          ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
          delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`,[l.id,t.to]),await s.query("insert into kitchen_events (company_id, item_id, from\
_status, to_status, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,l.id,l.kitchen_status,t.to,e.ctx.userId]);return{changed:d.length}});a.json(o)}));ye.post("/items/:id/ack-can\
cel",p("cozinha.operar"),u(async(e,a)=>{let t=await c("update order_items set cancel_ack_at = now() where id = $1 and company_id = $2 and kitchen_status = 'cancelado' and cancel_ac\
k_at is null returning id",[Number(e.params.id),e.ctx.companyId]);t.rows[0]&&await c("insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$\
2,$3,$4,$5)",[e.ctx.companyId,t.rows[0].id,"cancelado","cancelado_ciente",e.ctx.userId]),a.json({ok:!0})}));ye.post("/items/:id/priority",p("cozinha.operar"),u(async(e,a)=>{let t=w(
_e.object({priority:_e.boolean(),reason:_e.string().trim().min(3).max(200)}),e.body);J(e.ctx,"pdv.autorizar");let n=await c("update order_items set priority = $3 where id = $1 and \
company_id = $2 returning id, session_id",[Number(e.params.id),e.ctx.companyId,t.priority]);if(!n.rows[0])throw b();await h({query:c},e.ctx,"producao.prioridade",{entity:"item",entityId:n.
rows[0].id,reason:t.reason,data:{priority:t.priority}}),a.json({ok:!0})}));ye.get("/ready",p("pdv.lancar"),u(async(e,a)=>{a.json((await c(`select i.id, i.description, i.qty, i.read\
y_at, s.id as session_id, s.label, c.number as card_number, t.number as table_number
     from order_items i join consumption_sessions s on s.id = i.session_id left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
     where i.company_id = $1 and i.kitchen_status = 'pronto' and i.status = 'ativo' order by i.ready_at limit 100`,[e.ctx.companyId])).rows)}));ye.get("/stats",p("cozinha.operar"),
u(async(e,a)=>{let t=(await c(`select ps.name as sector, count(*)::int as items,
      round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::numeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
     from order_items i join production_sectors ps on ps.id = i.sector_id
    where i.company_id = $1 and i.ready_at is not null and i.sent_at > now() - interval '24 hours' group by ps.name order by ps.name`,[e.ctx.companyId])).rows;a.json(t)}));import{Router as Lo}from"npm:express@5.2.1";import{z}from"npm:zod@4.6.5";var V=Lo(),Uo=["un","kg","g","L","ml"],pn=z.number().positive().max(1e6);V.get("/items",p("estoque.visualizar"),u(async(e,a)=>{let t=(await c(`select s.*, (select coalesce(sum(qty)\
,0) from stock_movements m where m.stock_item_id = s.id)::float as balance,
      (select coalesce(-sum(qty),0) from stock_movements m where m.stock_item_id = s.id and m.kind = 'venda' and m.created_at > now() - interval '30 days')::float as used_30d
    from stock_items s where s.company_id = $1 ${e.query.all?"":"and s.active"} order by lower(s.name)`,[e.ctx.companyId])).rows,n=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.g\
erenciar");a.json(t.map(o=>({...o,avg_cost_cents:n?Number(o.avg_cost_cents):null,status:o.balance<=0?"zerado":o.balance<=Number(o.min_qty)?"baixo":"ok",suggest:Math.max(0,Math.ceil(
(Number(o.reorder_qty)||Number(o.min_qty)*2)+o.used_30d/30*7-o.balance))})))}));var ga=z.object({name:z.string().trim().min(2).max(80),unit:z.enum(Uo),min_qty:z.number().min(0).max(
1e6).default(0),reorder_qty:z.number().min(0).max(1e6).default(0),active:z.boolean().default(!0)});V.post("/items",p("estoque.ajustar"),u(async(e,a)=>{let t=w(ga.extend({initial_qty:z.
number().min(0).max(1e6).optional(),unit_cost_cents:z.number().int().min(0).max(1e8).optional()}),e.body),n=await $(async o=>{let s=await o.query("insert into stock_items (company_\
id, name, unit, min_qty, reorder_qty, active) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,t.name,t.unit,t.min_qty,t.reorder_qty,t.active]).catch(i=>{throw i.code==="2\
3505"?g("J\xE1 existe insumo com este nome"):i});return t.initial_qty&&await dt(o,e.ctx,s.rows[0].id,t.initial_qty,t.unit_cost_cents||0,{type:"saldo_inicial"},"Saldo inicial"),await h(
o,e.ctx,"estoque.insumo_criado",{entity:"stock_item",entityId:s.rows[0].id,data:{name:t.name,initial:t.initial_qty}}),s.rows[0].id});a.status(201).json({id:n})}));V.put("/items/:id",
p("estoque.ajustar"),u(async(e,a)=>{let t=w(ga.partial(),e.body);if(!(await c(`update stock_items set name = coalesce($3,name), unit = coalesce($4,unit), min_qty = coalesce($5,min_\
qty), reorder_qty = coalesce($6,reorder_qty),
      active = coalesce($7,active) where id = $1 and company_id = $2 returning id`,[Number(e.params.id),e.ctx.companyId,t.name??null,t.unit??null,t.min_qty??null,t.reorder_qty??null,
t.active??null])).rows[0])throw b("Insumo n\xE3o encontrado");a.json({ok:!0})}));V.get("/items/:id/movements",p("estoque.visualizar"),u(async(e,a)=>{a.json((await c(`select m.id, m\
.kind, m.qty::float, m.unit_cost_cents, m.ref_type, m.ref_id, m.reverses_id, m.reason, m.created_at, u.name as user_name
     from stock_movements m left join users u on u.id = m.user_id where m.company_id = $1 and m.stock_item_id = $2 order by m.id desc limit 200`,[e.ctx.companyId,Number(e.params.id)])).
rows)}));V.post("/movements",p("estoque.ajustar"),u(async(e,a)=>{let t=w(z.object({stock_item_id:z.number().int(),kind:z.enum(["entrada","perda","ajuste"]),qty:z.number().refine(o=>o!==
0&&Math.abs(o)<=1e6),unit_cost_cents:z.number().int().min(0).max(1e8).optional(),reason:z.string().trim().min(3).max(200)}),e.body),n=await $(async o=>{let s=(await o.query("select\
 * from stock_items where id = $1 and company_id = $2 for update",[t.stock_item_id,e.ctx.companyId])).rows[0];if(!s)throw b("Insumo n\xE3o encontrado");if(t.kind==="entrada"){if(t.
qty<=0)throw y("Entrada deve ser positiva");await dt(o,e.ctx,s.id,t.qty,t.unit_cost_cents??Math.round(Number(s.avg_cost_cents)),{type:"manual"},t.reason)}else{let i=t.kind==="perda"?
-Math.abs(t.qty):t.qty;await o.query("insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6,$7)",[e.ctx.companyId,
s.id,t.kind,i,s.avg_cost_cents,t.reason,e.ctx.userId])}return await h(o,e.ctx,`estoque.${t.kind}`,{entity:"stock_item",entityId:s.id,reason:t.reason,data:{qty:t.qty}}),{balance:(await Ze(
o,e.ctx.companyId,[s.id]))[s.id]||0}});a.status(201).json(n)}));V.post("/movements/:id/reverse",p("estoque.ajustar"),u(async(e,a)=>{let t=w(z.object({reason:z.string().trim().min(3).
max(200)}),e.body),n=await $(async o=>{let s=(await o.query("select * from stock_movements where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!s)
throw b("Movimento n\xE3o encontrado");if(!["entrada","perda","ajuste"].includes(s.kind)||s.reverses_id)throw g("Este movimento \xE9 revertido pelo fluxo de origem (venda, compra ou i\
nvent\xE1rio)");return await o.query("insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reverses_id, reason, user_id) values ($1,$2,'reversao',$3,\
$4,$5,$6,$7)",[e.ctx.companyId,s.stock_item_id,-Number(s.qty),s.unit_cost_cents,s.id,t.reason,e.ctx.userId]).catch(i=>{throw i.code==="23505"?g("Movimento j\xE1 revertido"):i}),await h(
o,e.ctx,"estoque.reversao",{entity:"stock_movement",entityId:s.id,reason:t.reason}),{ok:!0}});a.json(n)}));V.get("/recipes",p("estoque.visualizar"),u(async(e,a)=>{let t=(await c(`s\
elect p.id, p.name, p.price_cents, p.cost_cents, p.stock_mode, p.stock_item_id, p.kind, si.name as stock_item_name,
      r.id as recipe_id, r.version, r.yield_qty::float
    from products p left join recipes r on r.product_id = p.id and r.active left join stock_items si on si.id = p.stock_item_id
    where p.company_id = $1 and p.active order by p.name`,[e.ctx.companyId])).rows,n=(await c(`select l.recipe_id, l.stock_item_id, l.qty::float, l.loss_pct::float, s.name, s.unit \
from recipe_lines l join stock_items s on s.id = l.stock_item_id
    where l.company_id = $1 and l.recipe_id = any($2)`,[e.ctx.companyId,t.map(i=>i.recipe_id).filter(Boolean)])).rows,o=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.gerenciar"),
s=[];for(let i of t){let r=o?await rn({query:c},e.ctx.companyId,i):null;s.push({...i,lines:n.filter(d=>d.recipe_id===i.recipe_id),theoretical_cost_cents:r,margin_pct:r!=null&&i.price_cents?
Math.round((i.price_cents-r)/i.price_cents*1e3)/10:null})}a.json(s)}));V.get("/recipes/:productId/history",p("estoque.visualizar"),u(async(e,a)=>{a.json((await c(`select r.id, r.ve\
rsion, r.yield_qty::float, r.active, r.created_at, u.name as user_name,
      (select json_agg(json_build_object('name', s.name, 'qty', l.qty, 'unit', s.unit, 'loss_pct', l.loss_pct)) from recipe_lines l join stock_items s on s.id = l.stock_item_id whe\
re l.recipe_id = r.id) as lines
    from recipes r left join users u on u.id = r.created_by where r.company_id = $1 and r.product_id = $2 order by r.version desc`,[e.ctx.companyId,Number(e.params.productId)])).rows)}));
V.put("/recipes/:productId",p("estoque.ajustar"),u(async(e,a)=>{let t=w(z.object({stock_mode:z.enum(["nenhum","ficha","acabado"]),stock_item_id:z.number().int().nullable().optional(),
yield_qty:z.number().positive().max(1e4).default(1),lines:z.array(z.object({stock_item_id:z.number().int(),qty:z.number().positive().max(1e5),loss_pct:z.number().min(0).max(99).default(
0)})).max(60).default([]),notes:z.string().max(300).optional()}),e.body),n=Number(e.params.productId),o=await $(async s=>{let i=(await s.query("select * from products where id = $1\
 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!i)throw b("Produto n\xE3o encontrado");let r=[...new Set([...t.lines.map(m=>m.stock_item_id),...t.stock_item_id?[
t.stock_item_id]:[]])];if(r.length&&(await s.query("select count(*)::int as n from stock_items where company_id = $1 and id = any($2)",[e.ctx.companyId,r])).rows[0].n!==r.length)throw y(
"Insumo inv\xE1lido");if(t.stock_mode==="acabado"&&!t.stock_item_id)throw y("Escolha o item de estoque do produto acabado");if(t.stock_mode==="ficha"&&!t.lines.length)throw y("A fi\
cha t\xE9cnica precisa de ao menos um insumo");if(new Set(t.lines.map(m=>m.stock_item_id)).size!==t.lines.length)throw y("Insumo repetido na ficha");await s.query("update products \
set stock_mode = $3, stock_item_id = $4, updated_at = now() where id = $1 and company_id = $2",[n,e.ctx.companyId,t.stock_mode,t.stock_mode==="acabado"?t.stock_item_id:null]);let d=null;
if(t.lines.length&&t.stock_mode!=="nenhum"){d=Number((await s.query("select coalesce(max(version),0) as v from recipes where product_id = $1",[n])).rows[0].v)+1,await s.query("upda\
te recipes set active = false where product_id = $1 and active",[n]);let m=await s.query("insert into recipes (company_id, product_id, version, yield_qty, notes, created_by) values\
 ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,n,d,t.yield_qty,t.notes??null,e.ctx.userId]);for(let f of t.lines)await s.query("insert into recipe_lines (company_id, recipe_id\
, stock_item_id, qty, loss_pct) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,m.rows[0].id,f.stock_item_id,f.qty,f.loss_pct])}else await s.query("update recipes set active = false wher\
e product_id = $1 and active",[n]);let l=await rn(s,e.ctx.companyId,{...i,stock_mode:t.stock_mode,stock_item_id:t.stock_mode==="acabado"?t.stock_item_id:null});return t.stock_mode!==
"nenhum"&&await s.query("update products set cost_cents = $3 where id = $1 and company_id = $2",[n,e.ctx.companyId,l]),await h(s,e.ctx,"estoque.ficha",{entity:"product",entityId:n,
data:{mode:t.stock_mode,version:d,lines:t.lines.length}}),{ok:!0,version:d,cost_cents:l}});a.json(o)}));V.get("/purchases",p("estoque.visualizar"),u(async(e,a)=>{let t=(await c(`se\
lect p.*, u.name as user_name,
      (select json_agg(json_build_object('id', l.id, 'stock_item_id', l.stock_item_id, 'name', s.name, 'unit', s.unit, 'qty', l.qty, 'received_qty', l.received_qty,
         'unit_cost_cents', l.unit_cost_cents) order by l.id) from purchase_lines l join stock_items s on s.id = l.stock_item_id where l.purchase_id = p.id) as lines
    from purchases p left join users u on u.id = p.created_by where p.company_id = $1 order by p.id desc limit 100`,[e.ctx.companyId])).rows;a.json(t)}));V.post("/purchases",p("com\
pras.gerenciar"),u(async(e,a)=>{let t=w(z.object({supplier:z.string().trim().min(2).max(100),document:z.string().trim().max(60).optional(),due_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).
optional(),notes:z.string().max(300).optional(),lines:z.array(z.object({stock_item_id:z.number().int(),qty:pn,unit_cost_cents:z.number().int().min(0).max(1e8)})).min(1).max(100)}),
e.body),n=await $(async o=>{let s=[...new Set(t.lines.map(l=>l.stock_item_id))];if((await o.query("select count(*)::int as n from stock_items where company_id = $1 and id = any($2)",
[e.ctx.companyId,s])).rows[0].n!==s.length)throw y("Insumo inv\xE1lido");let r=t.lines.reduce((l,m)=>l+Math.round(m.qty*m.unit_cost_cents),0),d=await o.query("insert into purchases\
 (company_id, supplier, document, due_date, notes, total_cents, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",[e.ctx.companyId,t.supplier,t.document??null,t.due_date??null,
t.notes??null,r,e.ctx.userId]);for(let l of t.lines)await o.query("insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) values ($1,$2,$3,$4,$5)",
[e.ctx.companyId,d.rows[0].id,l.stock_item_id,l.qty,l.unit_cost_cents]);return await h(o,e.ctx,"compra.criada",{entity:"purchase",entityId:d.rows[0].id,data:{supplier:t.supplier,total_cents:r}}),
d.rows[0].id});a.status(201).json({id:n})}));V.post("/purchases/:id/receive",p("compras.gerenciar"),u(async(e,a)=>{let t=w(z.object({lines:z.array(z.object({line_id:z.number().int(),
qty:pn})).min(1).max(100)}),e.body),n=await $(async o=>{let s=(await o.query("select * from purchases where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).
rows[0];if(!s)throw b("Compra n\xE3o encontrada");if(["recebida","cancelada"].includes(s.status))throw g(`Compra ${s.status}`);for(let d of t.lines){let l=(await o.query("select * \
from purchase_lines where id = $1 and purchase_id = $2 for update",[d.line_id,s.id])).rows[0];if(!l)throw y("Linha inv\xE1lida");if(Number(l.received_qty)+d.qty>Number(l.qty)+1e-4)
throw y("Quantidade recebida maior que a comprada");await o.query("update purchase_lines set received_qty = received_qty + $2 where id = $1",[l.id,d.qty]),await dt(o,e.ctx,l.stock_item_id,
d.qty,Number(l.unit_cost_cents),{type:"purchase",id:s.id},`Compra ${s.id} \u2014 ${s.supplier}`)}let r=(await o.query("select count(*)::int as n from purchase_lines where purchase_\
id = $1 and received_qty < qty",[s.id])).rows[0].n?"parcial":"recebida";return await o.query("update purchases set status = $2 where id = $1",[s.id,r]),await h(o,e.ctx,"compra.rece\
bida",{entity:"purchase",entityId:s.id,data:{status:r,lines:t.lines.length}}),{status:r}});a.json(n)}));V.post("/purchases/:id/cancel",p("compras.gerenciar"),u(async(e,a)=>{let t=w(
z.object({reason:z.string().trim().min(3).max(200)}),e.body),n=await c("update purchases set status = 'cancelada', notes = coalesce(notes,'') || ' [cancelada: ' || $3 || ']' where \
id = $1 and company_id = $2 and status = 'aberta' returning id",[Number(e.params.id),e.ctx.companyId,t.reason]);if(!n.rows[0])throw g("S\xF3 compras ainda n\xE3o recebidas podem ser canc\
eladas");await h({query:c},e.ctx,"compra.cancelada",{entity:"purchase",entityId:n.rows[0].id,reason:t.reason}),a.json({ok:!0})}));V.get("/inventories",p("estoque.visualizar"),u(async(e,a)=>{
a.json((await c(`select i.*, u.name as user_name, a.name as approved_name from inventory_counts i left join users u on u.id = i.created_by
    left join users a on a.id = i.approved_by where i.company_id = $1 order by i.id desc limit 30`,[e.ctx.companyId])).rows)}));V.post("/inventories",p("estoque.ajustar"),u(async(e,a)=>{
let t=w(z.object({counts:z.array(z.object({stock_item_id:z.number().int(),counted:z.number().min(0).max(1e6)})).min(1).max(500),notes:z.string().max(300).optional()}),e.body),n=await Ze(
{query:c},e.ctx.companyId,t.counts.map(r=>r.stock_item_id)),o=Object.fromEntries((await c("select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any\
($2)",[e.ctx.companyId,t.counts.map(r=>r.stock_item_id)])).rows.map(r=>[r.id,r])),s=t.counts.filter(r=>o[r.stock_item_id]).map(r=>{let d=Math.round((n[r.stock_item_id]||0)*1e3)/1e3,
l=Math.round((r.counted-d)*1e3)/1e3;return{stock_item_id:r.stock_item_id,name:o[r.stock_item_id].name,unit:o[r.stock_item_id].unit,system:d,counted:r.counted,diff:l,value_cents:Math.
round(l*Number(o[r.stock_item_id].avg_cost_cents))}}),i=await c("insert into inventory_counts (company_id, lines, notes, created_by) values ($1,$2,$3,$4) returning id",[e.ctx.companyId,
JSON.stringify(s),t.notes??null,e.ctx.userId]);a.status(201).json({id:i.rows[0].id,lines:s})}));V.post("/inventories/:id/approve",p("estoque.ajustar"),u(async(e,a)=>{J(e.ctx,"pdv.a\
utorizar");let t=await $(async n=>{let o=(await n.query("select * from inventory_counts where id = $1 and company_id = $2 and status = 'aberto' for update",[Number(e.params.id),e.ctx.
companyId])).rows[0];if(!o)throw g("Invent\xE1rio n\xE3o est\xE1 aberto");if(Number(o.created_by)===Number(e.ctx.userId)&&e.ctx.level<100)throw g("A aprova\xE7\xE3o deve ser feita por ou\
tra pessoa","same_user");let s=await Ze(n,e.ctx.companyId,o.lines.map(r=>r.stock_item_id)),i=0;for(let r of o.lines){let d=Math.round(((s[r.stock_item_id]||0)-r.system)*1e3)/1e3,l=Math.
round((r.counted+d-(s[r.stock_item_id]||0))*1e3)/1e3;Math.abs(l)<5e-4||(await n.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type,\
 ref_id, reason, user_id)
        select $1, id, 'inventario', $3, avg_cost_cents, 'inventory', $4, 'Invent\xE1rio aprovado', $5 from stock_items where id = $2 and company_id = $1`,[e.ctx.companyId,r.stock_item_id,
l,o.id,e.ctx.userId]),i++)}return await n.query("update inventory_counts set status = 'aprovado', approved_by = $2, approved_at = now() where id = $1",[o.id,e.ctx.userId]),await h(
n,e.ctx,"estoque.inventario_aprovado",{entity:"inventory",entityId:o.id,data:{adjustments:i}}),{adjustments:i}});a.json(t)}));V.post("/inventories/:id/discard",p("estoque.ajustar"),
u(async(e,a)=>{if(!(await c("update inventory_counts set status = 'descartado' where id = $1 and company_id = $2 and status = 'aberto' returning id",[Number(e.params.id),e.ctx.companyId])).
rows[0])throw g("Invent\xE1rio n\xE3o est\xE1 aberto");a.json({ok:!0})}));V.post("/produce",p("estoque.ajustar"),u(async(e,a)=>{let t=w(z.object({product_id:z.number().int(),qty:pn}),
e.body),n=await $(async o=>{let s=(await o.query("select * from products where id = $1 and company_id = $2",[t.product_id,e.ctx.companyId])).rows[0];if(!s)throw b("Produto n\xE3o enco\
ntrado");if(s.stock_mode!=="acabado")throw y("Produ\xE7\xE3o pr\xF3pria vale para produtos com estoque de produto acabado");if(!(await o.query("select id from recipes where product\
_id = $1 and active",[s.id])).rows[0])throw y("Cadastre a ficha de produ\xE7\xE3o (insumos) deste produto acabado antes de produzir");let r=await xt(o,e.ctx.companyId,{...s,stock_mode:"\
ficha"},t.qty),d=(await o.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2) for update",[e.ctx.companyId,[...r.keys()]])).rows,l=0;for(let m of d){
let f=r.get(Number(m.id));l+=f*Number(m.avg_cost_cents),await o.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason,\
 user_id)
        values ($1,$2,'producao_consumo',$3,$4,'production',$5,$6,$7)`,[e.ctx.companyId,m.id,-f,m.avg_cost_cents,s.id,`Produ\xE7\xE3o de ${t.qty} ${s.name}`,e.ctx.userId])}return await dt(
o,e.ctx,s.stock_item_id,t.qty,Math.round(l/t.qty),{type:"production",id:s.id},`Produ\xE7\xE3o de ${s.name}`),await h(o,e.ctx,"estoque.producao",{entity:"product",entityId:s.id,data:{
qty:t.qty,cost_cents:Math.round(l)}}),{ok:!0,cost_cents:Math.round(l)}});a.json(n)}));V.get("/settings",p("estoque.visualizar"),u(async(e,a)=>{let t=(await c("select settings from \
companies where id = $1",[e.ctx.companyId])).rows[0];a.json(sn(t.settings))}));V.put("/settings",p("configuracoes.gerenciar"),u(async(e,a)=>{let t=w(z.object({enabled:z.boolean(),allow_negative:z.
boolean()}),e.body);await c("update companies set settings = jsonb_set(settings, '{stock}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await h({query:c},e.ctx,"\
estoque.politica",{data:t}),a.json({ok:!0})}));import{Router as Fo}from"npm:express@5.2.1";import{z as Et}from"npm:zod@4.6.5";var qt=Fo(),ba=e=>{let a=w(Et.object({from:Et.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:Et.string().regex(/^\d{4}-\d{2}-\d{2}$/),unit_id:Et.coerce.number().int().optional()}),e);if(a.
from>a.to)throw y("Data inicial depois da final");if((new Date(a.to)-new Date(a.from))/864e5>400)throw y("Per\xEDodo m\xE1ximo de 400 dias");return a};async function $a(e,a){let t=e.
can("financeiro.visualizar"),n=e.can("relatorios.cmv"),o=e.company.timezone,s=[e.companyId,a.from,a.to],i="";a.unit_id&&(s.push(a.unit_id),i=` and s.unit_id = $${s.length}`);let r=`\
s.company_id = $1 and s.business_date between $2 and $3${i}`,d=`${r} and s.status = 'encerrada'`,l=`from order_items i join consumption_sessions s on s.id = i.session_id where ${d}\
 and i.status = 'ativo'`,m=(await c(`with x as (
      select s.id, s.service_fee_bp, s.delivery_fee_cents, (select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo') as items
      from consumption_sessions s where ${d})
    select count(*)::int as sessions, coalesce(sum(items),0)::bigint as items_cents,
      coalesce(sum(round(items * service_fee_bp / 10000.0)),0)::bigint as service_fee_cents, coalesce(sum(delivery_fee_cents),0)::bigint as delivery_fee_cents from x`,s)).rows[0],f=Number(
m.items_cents)+Number(m.service_fee_cents)+Number(m.delivery_fee_cents),_=(await c(`select p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total, coalesce(\
sum(p.change_cents),0)::bigint as change
    from payments p join consumption_sessions s on s.id = p.session_id where p.company_id = $1 and p.business_date between $2 and $3${i} and p.status = 'confirmado' group by p.meth\
od order by total desc`,s)).rows,k=(await c(`select count(*)::int as n, coalesce(sum((select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status \
= 'ativo')
      - (select coalesce(sum(amount_cents),0) from payments p where p.session_id = s.id and p.status = 'confirmado')),0)::bigint as balance
    from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')${a.unit_id?" and s.unit_id = $2":""}`,a.unit_id?[e.companyId,a.unit_id]:[e.companyId])).
rows[0],j=(await c(`select s.business_date as day, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${l} group by 1 order by 1`,s)).rows,
S=(await c(`select extract(hour from i.created_at at time zone '${o.replace(/'/g,"")}')::int as hour, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${l}\
 group by 1 order by 1`,s)).rows,A=(await c(`select i.product_id, max(i.description) as name, max(c.name) as category, sum(i.qty)::float as qty, sum(i.total_cents)::bigint as items\
_cents,
      sum(coalesce((select -sum(m.qty * m.unit_cost_cents) from stock_movements m where m.ref_type = 'order_item' and m.ref_id = i.id and m.kind = 'venda'),
        p.cost_cents * i.qty))::bigint as cost_cents
    ${l.replace("where","join products p on p.id = i.product_id left join categories c on c.id = p.category_id where")} group by i.product_id order by items_cents desc`,s)).rows,D=Object.
values(A.reduce((I,ce)=>{let et=ce.category||"Sem categoria";return I[et]||={name:et,qty:0,items_cents:0,cost_cents:0},I[et].qty+=ce.qty,I[et].items_cents+=Number(ce.items_cents),I[et].
cost_cents+=Number(ce.cost_cents),I},{})).sort((I,ce)=>ce.items_cents-I.items_cents),M=A.reduce((I,ce)=>I+Number(ce.items_cents),0)||1,L=0;for(let I of A)L+=Number(I.items_cents),I.
abc=L/M<=.8?"A":L/M<=.95?"B":"C";let fe=(await c(`select u.name, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${l.replace("where","left join users \
u on u.id = i.user_id where")} group by u.name order by items_cents desc`,s)).rows,we=(await c(`select t.number, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),\
0)::bigint as items_cents,
      round(avg(extract(epoch from (s.closed_at - s.opened_at)) / 60)::numeric)::int as avg_minutes
    ${l.replace("where","join dining_tables t on t.id = s.table_id where")} group by t.number order by t.number`,s)).rows,B=(await c(`select s.kind as channel, count(distinct s.id)\
::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${l} group by 1 order by 3 desc`,s)).rows,ne=(await c(`select coalesce(tm.name, 'Sem terminal') as name, co\
unt(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${l.replace("where","left join terminals tm on tm.id = i.terminal_id where")} group by 1 order by 3 desc`,
s)).rows,ze=(await c(`select i.launch_mode, count(*)::int as n from order_items i join consumption_sessions s on s.id = i.session_id where ${r} group by 1`,s)).rows,he=(await c(`se\
lect
      count(*) filter (where i.status = 'cancelado')::int as canceled_items, coalesce(sum(i.total_cents) filter (where i.status = 'cancelado'),0)::bigint as canceled_cents,
      coalesce(sum(i.discount_cents) filter (where i.status = 'ativo'),0)::bigint as discounts_cents, count(*) filter (where i.discount_cents > 0)::int as discounted_items
    from order_items i join consumption_sessions s on s.id = i.session_id where ${r}`,s)).rows[0],yt=(await c(`select action, count(*)::int as n from audit_events where company_id \
= $1 and created_at >= $2::date and created_at < $3::date + 1
      and action in ('consumo.reaberto','consumo.cancelado','pdv.itens_transferidos','pdv.mesa_trocada','autorizacao.concedida','autorizacao.negada','leitura.desconhecida','pdv.exc\
ecao_manual','pagamento.estornado','pdv.taxa_servico')
    group by action`,[e.companyId,a.from,a.to])).rows,qa=(await c(`select ps.name as sector, count(*)::int as items, round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::n\
umeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
    from order_items i join consumption_sessions s on s.id = i.session_id join production_sectors ps on ps.id = i.sector_id
    where ${r} and i.ready_at is not null and i.sent_at is not null group by ps.name order by ps.name`,s)).rows,Aa=(await c(`select count(*)::int as orders, count(*) filter (where \
d.status = 'cancelado')::int as canceled,
      round(avg(extract(epoch from (e.created_at - d.created_at)) / 60)::numeric)::int as avg_minutes_to_deliver
    from delivery_orders d join consumption_sessions s on s.id = d.session_id
    left join lateral (select created_at from delivery_events where order_id = d.id and status = 'entregue' order by id limit 1) e on true where ${r}`,s)).rows[0],Oa=(await c(`sele\
ct coalesce(sum(-m.qty * m.unit_cost_cents) filter (where m.kind = 'perda'),0)::bigint as losses_cents,
      coalesce(sum(m.qty * m.unit_cost_cents) filter (where m.kind = 'inventario'),0)::bigint as inventory_diff_cents
    from stock_movements m where m.company_id = $1 and m.created_at >= $2::date and m.created_at < $3::date + 1`,[e.companyId,a.from,a.to])).rows[0],Da=(await c(`select count(disti\
nct s.customer_id)::int as identified,
      count(distinct s.customer_id) filter (where exists (select 1 from consumption_sessions o where o.customer_id = s.customer_id and o.status = 'encerrada' and o.business_date < \
$2))::int as returning
    from consumption_sessions s where ${d} and s.customer_id is not null`,s)).rows[0],Pa=(await c(`select coalesce(sum(points) filter (where kind = 'ganho'),0)::int as earned, coal\
esce(-sum(points) filter (where kind = 'resgate'),0)::int as redeemed
    from loyalty_ledger where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1`,[e.companyId,a.from,a.to])).rows[0],Ta=(await c("select count(*)::int as n, \
round(avg(score)::numeric, 2)::float as average from reviews where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1",[e.companyId,a.from,a.to])).rows[0],Ra=t?
(await c(`select count(*)::int as sessions, coalesce(sum(difference_cents),0)::bigint as difference_cents,
      count(*) filter (where difference_cents <> 0)::int as with_difference from cash_sessions where company_id = $1 and business_date between $2 and $3 and status = 'fechado'`,[e.
companyId,a.from,a.to])).rows[0]:null,Lt=t?(await c(`select m.kind, coalesce(sum(m.amount_cents),0)::bigint as total from cash_movements m join cash_sessions c on c.id = m.cash_ses\
sion_id
      where m.company_id = $1 and c.business_date between $2 and $3 group by m.kind`,[e.companyId,a.from,a.to])).rows:null,Xe=A.reduce((I,ce)=>I+Number(ce.cost_cents),0),K=I=>t?I:null;
if(!n)for(let I of[...A,...D])delete I.cost_cents;let Ma=_.reduce((I,ce)=>I+Number(ce.total),0),La=t&&n?{receita_bruta:f,taxa_servico:Number(m.service_fee_cents),taxa_entrega:Number(
m.delivery_fee_cents),cmv:Xe,lucro_bruto:Number(m.items_cents)-Xe,despesas_caixa:Number(Lt?.find(I=>I.kind==="despesa")?.total||0),resultado:Number(m.items_cents)-Xe-Number(Lt?.find(
I=>I.kind==="despesa")?.total||0)}:null;return{period:{from:a.from,to:a.to},permissions:{financial:t,cmv:n},summary:{sessions:m.sessions,revenue_cents:K(f),items_cents:K(Number(m.items_cents)),
service_fee_cents:K(Number(m.service_fee_cents)),delivery_fee_cents:K(Number(m.delivery_fee_cents)),received_cents:K(Ma),ticket_cents:K(m.sessions?Math.round(f/m.sessions):0),open_sessions:k.
n,open_balance_cents:K(Number(k.balance)),cmv_cents:n?Xe:null,margin_pct:n&&Number(m.items_cents)?Math.round((Number(m.items_cents)-Xe)/Number(m.items_cents)*1e3)/10:null},by_day:j.
map(I=>({...I,items_cents:K(Number(I.items_cents))})),by_hour:S.map(I=>({...I,items_cents:K(Number(I.items_cents))})),by_product:A.map(I=>({...I,items_cents:K(Number(I.items_cents))})),
by_category:D.map(I=>({...I,items_cents:K(I.items_cents)})),by_user:fe.map(I=>({...I,items_cents:K(Number(I.items_cents))})),by_table:we.map(I=>({...I,items_cents:K(Number(I.items_cents))})),
by_channel:B.map(I=>({...I,items_cents:K(Number(I.items_cents))})),by_terminal:ne.map(I=>({...I,items_cents:K(Number(I.items_cents))})),payments:t?_:null,cash:Ra,movements:Lt,dre:La,
control:{...he,canceled_cents:K(Number(he.canceled_cents)),discounts_cents:K(Number(he.discounts_cents)),launch_modes:Object.fromEntries(ze.map(I=>[I.launch_mode,I.n])),events:Object.
fromEntries(yt.map(I=>[I.action,I.n]))},kitchen:qa,delivery:Aa,stock:n?Oa:null,customers:{...Da,loyalty:Pa,reviews:Ta}}}qt.get("/overview",p("relatorios.visualizar"),u(async(e,a)=>{
a.json(await $a(e.ctx,ba(e.query)))}));var Bo={produtos:["by_product",[["name","Produto"],["category","Categoria"],["qty","Quantidade"],["items_cents","Vendido (R$)"],["cost_cents",
"CMV (R$)"],["abc","Curva ABC"]]],dias:["by_day",[["day","Dia comercial"],["sessions","Consumos"],["items_cents","Vendido (R$)"]]],horas:["by_hour",[["hour","Hora"],["items","Itens"],
["items_cents","Vendido (R$)"]]],garcons:["by_user",[["name","Usu\xE1rio"],["items","Itens"],["items_cents","Vendido (R$)"]]],mesas:["by_table",[["number","Mesa"],["sessions","Cons\
umos"],["items_cents","Vendido (R$)"],["avg_minutes","Perman\xEAncia m\xE9dia (min)"]]],pagamentos:["payments",[["method","Forma"],["n","Quantidade"],["total","Total (R$)"]]]};qt.get(
"/export",p("relatorios.visualizar"),u(async(e,a)=>{let t=ba(e.query),n=Bo[e.query.section];if(!n)throw y("Se\xE7\xE3o inv\xE1lida");let s=(await $a(e.ctx,t))[n[0]]||[],i=n[1].filter(
([l])=>s.some(m=>m[l]!==void 0&&m[l]!==null)),r=(l,m)=>/cents|^total$/.test(l)&&m!=null?(Number(m)/100).toFixed(2).replace(".",","):m,d=[i.map(([,l])=>l).join(";"),...s.map(l=>i.map(
([m])=>Be(r(m,l[m]))).join(";"))];await h({query:c},e.ctx,"relatorio.exportado",{data:{section:e.query.section,...t}}),a.setHeader("content-type","text/csv; charset=utf-8"),a.setHeader(
"content-disposition",`attachment; filename="rusten-${e.query.section}-${t.from}-${t.to}.csv"`),a.send(`\uFEFF${d.join(`
`)}`)}));import{Router as Jo}from"npm:express@5.2.1";import{z as C}from"npm:zod@4.6.5";import Vo from"node:crypto";var Le=e=>({enabled:!1,accepting:!0,delivery:!0,pickup:!0,fee_cents:0,min_order_cents:0,eta_minutes:45,hours:"",areas:"",payment_methods:["dinheiro","pix","cartao"],message:"",...e?.
delivery||{}}),va={recebido:["confirmado","cancelado"],confirmado:["em_preparo","pronto","cancelado"],em_preparo:["pronto","cancelado"],pronto:["saiu","entregue","cancelado"],saiu:[
"entregue","cancelado"],entregue:[],cancelado:[]},Oe={recebido:"Recebido",confirmado:"Confirmado",em_preparo:"Em preparo",pronto:"Pronto",saiu:"Saiu para entrega",entregue:"Entregu\
e",cancelado:"Cancelado"},Ho=e=>({companyId:e,userId:null,unitId:null,terminalId:null,level:0,can:a=>["pdv.abrir_comanda","delivery.gerenciar"].includes(a)});async function _n(e,a,t,{
channel:n="delivery"}={}){if(!Array.isArray(t)||!t.length)throw y("Carrinho vazio");let o=[...new Set(t.map(r=>Number(r.product_id)))],s=Object.fromEntries((await e.query("select *\
 from products where company_id = $1 and id = any($2)",[a,o])).rows.map(r=>[r.id,r])),i=[];for(let r of t){let d=s[Number(r.product_id)];if(!d||!d.active)throw g(`Produto indispon\xED\
vel${d?`: ${d.name}`:""}`,"product_unavailable");if(n!=="interno"&&!d.channels.includes("delivery")&&!d.channels.includes("cardapio_digital"))throw g(`${d.name} n\xE3o est\xE1 dispon\xEDvel\
 para delivery`,"product_unavailable");if(d.kind==="weight")throw g(`${d.name} \xE9 vendido por peso e n\xE3o pode ser pedido online`,"product_unavailable");let l=Number(r.qty);if(!Number.
isInteger(l)||l<1||l>50)throw y("Quantidade inv\xE1lida");let m=(r.option_ids||[]).map(Number),f=(await e.query(`select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active where g.product_id = $1 group by g.id order by g.sort, g.id`,[d.id])).rows,_=[];for(let j of f){
let S=j.options.filter(A=>m.includes(A.id));if(S.length<j.min_select)throw y(`${d.name}: escolha ${j.min_select} em "${j.name}"`,"options_required");if(S.length>j.max_select)throw y(
`${d.name}: no m\xE1ximo ${j.max_select} em "${j.name}"`);for(let A of S)_.push({group:j.name,id:A.id,name:A.name,price_cents:A.price_cents})}if(_.length!==new Set(m).size)throw y(
"Op\xE7\xE3o inv\xE1lida");let k=_.reduce((j,S)=>j+S.price_cents,0);i.push({product:d,qty:l,chosen:_,mods:k,notes:r.notes?String(r.notes).slice(0,140):null,total:tt(d.price_cents,l,
k,0)})}return{lines:i,subtotal:i.reduce((r,d)=>r+d.total,0)}}async function Ye(e,a,t,n){let o=(await e.query("select id, name, settings from companies where id = $1",[a])).rows[0];
if(!o)throw b();let s=Le(o.settings),i=t.channel==="telefone"||t.channel==="balcao";if(!i&&(!s.enabled||!s.accepting))throw g("O estabelecimento n\xE3o est\xE1 recebendo pedidos agora",
"closed");if(t.mode==="entrega"&&!s.delivery)throw y("Entrega indispon\xEDvel: escolha retirada");if(t.mode==="retirada"&&!s.pickup)throw y("Retirada indispon\xEDvel");if(t.mode===
"entrega"&&(!t.address?.street||!t.address?.number))throw y("Informe rua e n\xFAmero para entrega");let r=oe(t.phone);if(r.length<10)throw y("Telefone com DDD \xE9 obrigat\xF3rio");
let d=(await e.query("select id, public_token, number from delivery_orders where company_id = $1 and client_key = $2",[a,t.client_key])).rows[0];if(d)return{replay:!0,...d};let{lines:l,
subtotal:m}=await _n(e,a,t.cart,{channel:i?"interno":"delivery"});if(!i&&m<s.min_order_cents)throw y(`Pedido m\xEDnimo de R$ ${(s.min_order_cents/100).toFixed(2).replace(".",",")}`,
"min_order");let f=t.mode==="entrega"?s.fee_cents:0,_=(await e.query("select id from customers where company_id = $1 and anonymized_at is null and regexp_replace(coalesce(phone,'')\
,'\\D','','g') = $2 limit 1",[a,r])).rows[0],k=n||Ho(a),j=Number((await e.query("select coalesce(max(number),0)+1 as n from delivery_orders where company_id = $1",[a])).rows[0].n),
S=await mn(e,{...k,companyId:a},{kind:"delivery",label:`Delivery #${j}`,customer_name:t.customer_name,customer_id:_?.id,delivery_fee_cents:f});for(let[M,L]of l.entries()){let fe=(await e.
query(`insert into order_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents,
         total_cents, notes, sector_id, kitchen_status, launch_mode, user_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,'delivery',$14,$15) returning *`,[a,S.id,L.product.id,L.product.name,L.qty,L.product.unit,L.product.price_cents,JSON.stringify(
L.chosen),L.mods,L.total,L.notes,L.product.sector_id,L.product.sector_id?"novo":"nao_produz",k.userId,`dlv${S.id}x${M}`])).rows[0];await kt(e,{...k,companyId:a},fe,L.product,L.chosen.
map(we=>we.id))}let A=te(18),D=(await e.query(`insert into delivery_orders (company_id, unit_id, session_id, number, public_token, channel, mode, customer_id, customer_name, phone,\
 address,
       payment_hint, change_for_cents, notes, eta_minutes, client_key, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,[a,S.unit_id,S.id,j,A,t.channel,t.mode,_?.id??null,t.customer_name,r,t.address||{},t.payment_hint??
null,t.change_for_cents??null,t.notes??null,s.eta_minutes,t.client_key,i?"confirmado":"recebido"])).rows[0];return i&&await e.query("update order_items set sent_at = now() where se\
ssion_id = $1 and kitchen_status = 'novo'",[S.id]),await e.query("insert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",[a,D.id,D.status,
k.userId,`Pedido via ${t.channel}`]),{...D,subtotal:m,fee:f,total:m+f}}var Go=()=>ot("review-link"),At=e=>`${e}.${Vo.createHmac("sha256",Go()).update(String(e)).digest("base64url").
slice(0,16)}`;function yn(e){let[a,t]=String(e||"").split(".");return!/^\d+$/.test(a||"")||!t?null:At(a)===`${a}.${t}`?Number(a):null}var ve=Jo(),Wo=e=>String(e).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40)||"loja";ve.get("/settings",p("delivery\
.gerenciar"),u(async(e,a)=>{let t=(await c("select slug, name, settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json({slug:t.slug,suggested_slug:t.slug||Wo(t.name),
...Le(t.settings)})}));ve.put("/settings",p("delivery.gerenciar","configuracoes.gerenciar"),u(async(e,a)=>{let t=w(C.object({slug:C.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
"use letras min\xFAsculas, n\xFAmeros e h\xEDfen (3 a 40)"),enabled:C.boolean(),accepting:C.boolean(),delivery:C.boolean(),pickup:C.boolean(),fee_cents:C.number().int().min(0).max(
1e5),min_order_cents:C.number().int().min(0).max(1e6),eta_minutes:C.number().int().min(5).max(300),hours:C.string().max(300).default(""),areas:C.string().max(500).default(""),message:C.
string().max(300).default(""),payment_methods:C.array(C.enum(["dinheiro","pix","cartao"])).min(1)}),e.body);if(!t.delivery&&!t.pickup)throw y("Habilite entrega, retirada ou ambos");
let{slug:n,...o}=t;await $(async s=>{if((await s.query("select 1 from companies where slug = $1 and id <> $2",[n,e.ctx.companyId])).rows[0])throw g("Este endere\xE7o j\xE1 est\xE1 em uso po\
r outra empresa","slug_taken");await s.query("update companies set slug = $2, settings = jsonb_set(settings, '{delivery}', $3::jsonb) where id = $1",[e.ctx.companyId,n,JSON.stringify(
o)]),await h(s,e.ctx,"delivery.configuracao",{data:{slug:n,...o}})}),a.json({ok:!0})}));ve.get("/orders",p("delivery.gerenciar"),u(async(e,a)=>{let t=[e.ctx.companyId],n="d.company\
_id = $1";e.query.status==="abertos"?n+=" and d.status not in ('entregue','cancelado')":e.query.status==="hoje"&&(n+=" and d.created_at > now() - interval '24 hours'"),e.ctx.can("d\
elivery.gerenciar")||(t.push(e.ctx.userId),n+=` and d.courier_id = $${t.length}`);let o=(await c(`select d.*, u.name as courier_name, s.status as session_status,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') as items_cents,
      (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = d.session_id and p.status = 'confirmado') as paid_cents,
      s.delivery_fee_cents,
      (select json_agg(json_build_object('description', i.description, 'qty', i.qty, 'modifiers', i.modifiers, 'notes', i.notes, 'kitchen_status', i.kitchen_status, 'status', i.sta\
tus) order by i.id)
         from order_items i where i.session_id = d.session_id) as items
    from delivery_orders d join consumption_sessions s on s.id = d.session_id left join users u on u.id = d.courier_id
    where ${n} order by case when d.status in ('entregue','cancelado') then 1 else 0 end, d.created_at desc limit 200`,t)).rows;a.json(o)}));ve.get("/my",p("delivery.entregar"),u(async(e,a)=>{
a.json((await c(`select d.id, d.number, d.status, d.customer_name, d.phone, d.address, d.payment_hint, d.change_for_cents, d.notes,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') + s.delivery_fee_cents as total_cents
    from delivery_orders d join consumption_sessions s on s.id = d.session_id where d.company_id = $1 and d.courier_id = $2 and d.status in ('pronto','saiu') order by d.id`,[e.ctx.
companyId,e.ctx.userId])).rows)}));var Ko=C.object({mode:C.enum(["entrega","retirada"]),channel:C.enum(["telefone","balcao"]).default("telefone"),customer_name:C.string().trim().min(
2).max(80),phone:C.string().trim().min(10).max(20),address:C.object({street:C.string().max(120),number:C.string().max(20),district:C.string().max(80).optional(),complement:C.string().
max(80).optional(),reference:C.string().max(120).optional()}).partial().optional(),payment_hint:C.enum(["dinheiro","pix","cartao"]).optional(),change_for_cents:C.number().int().min(
0).max(1e7).optional(),notes:C.string().max(300).optional(),cart:C.array(C.object({product_id:C.number().int(),qty:C.number().int().min(1).max(50),option_ids:C.array(C.number().int()).
max(40).default([]),notes:C.string().max(140).optional()})).min(1).max(60),client_key:C.string().regex(/^[A-Za-z0-9_-]{8,80}$/)});ve.post("/orders",p("delivery.gerenciar"),u(async(e,a)=>{
let t=w(Ko,e.body),n=await $(o=>Ye(o,e.ctx.companyId,t,e.ctx));await h({query:c},e.ctx,"delivery.pedido_interno",{entity:"delivery",entityId:n.id,data:{number:n.number,mode:t.mode}}),
a.status(n.replay?200:201).json(n)}));ve.post("/orders/:id/status",u(async(e,a)=>{let t=w(C.object({to:C.enum(["confirmado","em_preparo","pronto","saiu","entregue","cancelado"]),reason:C.
string().trim().max(200).optional(),proof:C.string().trim().max(200).optional(),eta_minutes:C.number().int().min(5).max(300).optional()}),e.body),n=await $(async o=>{let s=(await o.
query("select * from delivery_orders where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!s)throw b("Pedido n\xE3o encontrado");if(["sa\
iu","entregue"].includes(t.to)&&!e.ctx.can("delivery.gerenciar")){if(J(e.ctx,"delivery.entregar"),Number(s.courier_id)!==Number(e.ctx.userId))throw g("Pedido atribu\xEDdo a outro entr\
egador")}else J(e.ctx,"delivery.gerenciar");if(s.status===t.to)return{ok:!0,replay:!0};if(!va[s.status].includes(t.to))throw g(`N\xE3o \xE9 poss\xEDvel ir de "${Oe[s.status]}" para\
 "${Oe[t.to]}"`,"invalid_transition");if(t.to==="saiu"&&s.mode!=="entrega")throw y("Pedido de retirada n\xE3o sai para entrega");if(t.to==="cancelado"&&!t.reason)throw y("Informe o\
 motivo do cancelamento");if(t.to==="confirmado"&&await o.query("update order_items set sent_at = now() where session_id = $1 and kitchen_status = 'novo' and sent_at is null and st\
atus = 'ativo'",[s.session_id]),t.to==="cancelado"){if((await R(o,s.session_id)).paid>0)throw g("H\xE1 pagamento confirmado: estorne antes de cancelar","has_payments");let r=(await o.
query("select id, kitchen_status from order_items where session_id = $1 and status = 'ativo'",[s.session_id])).rows;for(let d of r)["novo","aceito","nao_produz"].includes(d.kitchen_status)&&
await ct(o,e.ctx,d.id,`Delivery cancelado: ${t.reason}`);await o.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
          kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where session_id = $1 and status = 'ativo'`,[s.session_id,`Delivery canc\
elado: ${t.reason}`,e.ctx.userId]),await o.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2 where id = $1",[s.session_id,e.ctx.userId])}
if(t.to==="entregue"){let i=await R(o,s.session_id);if(i.balance>0&&!t.proof)throw g(`Saldo de R$ ${(i.balance/100).toFixed(2).replace(".",",")} em aberto: registre o pagamento ou \
informe o comprovante`,"balance_pending");let r=(await o.query("select * from consumption_sessions where id = $1 for update",[s.session_id])).rows[0];i.balance===0&&i.items>0&&["ab\
erta","em_fechamento"].includes(r.status)&&(await o.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2, version = version + 1 where id =\
 $1",[r.id,e.ctx.userId]),await zt(o,e.ctx,r,i.items))}return await o.query(`update delivery_orders set status = $2, cancel_reason = coalesce($3, cancel_reason), proof = coalesce($\
4, proof),
        eta_minutes = coalesce($5, eta_minutes), updated_at = now() where id = $1`,[s.id,t.to,t.to==="cancelado"?t.reason:null,t.proof??null,t.eta_minutes??null]),await o.query("in\
sert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,s.id,t.to,e.ctx.userId,t.reason||t.proof||null]),await h(o,e.ctx,`\
delivery.${t.to}`,{entity:"delivery",entityId:s.id,reason:t.reason,data:{from:s.status}}),{ok:!0,status:t.to}});a.json(n)}));ve.post("/orders/:id/courier",p("delivery.gerenciar"),u(
async(e,a)=>{let t=w(C.object({courier_id:C.number().int().nullable()}),e.body);if(t.courier_id&&!(await c("select 1 from users where id = $1 and company_id = $2 and active",[t.courier_id,
e.ctx.companyId])).rows[0])throw y("Entregador inv\xE1lido");let n=await c("update delivery_orders set courier_id = $3, updated_at = now() where id = $1 and company_id = $2 returni\
ng id",[Number(e.params.id),e.ctx.companyId,t.courier_id]);if(!n.rows[0])throw b();await h({query:c},e.ctx,"delivery.entregador",{entity:"delivery",entityId:n.rows[0].id,data:t}),a.
json({ok:!0})}));ve.get("/couriers",p("delivery.gerenciar"),u(async(e,a)=>{a.json((await c(`select u.id, u.name, u.role_key from users u join roles r on r.company_id = u.company_id\
 and r.key = u.role_key
    where u.company_id = $1 and u.active and 'delivery.entregar' = any(r.permissions) order by u.name`,[e.ctx.companyId])).rows)}));import es from"node:crypto";import{Router as ts}from"npm:express@5.2.1";import{z as ee}from"npm:zod@4.6.5";var Dt=e=>({enabled:!1,name:"Atendente virtual",greeting:"Ol\xE1! Sou o atendimento virtual. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* do ped\
ido ou fazer uma *reserva*. Para falar com a equipe, digite *atendente*.",handoff_message:"Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA. Aguarde um instante.",closed_message:"\
No momento n\xE3o estamos recebendo pedidos. Veja nossos hor\xE1rios digitando *hor\xE1rio*.",reservation_max_people:12,reservation_min_hours:2,...e?.agent||{}});function Zo(e,a){let t=new Date(
`${e}Z`);if(Number.isNaN(t.getTime()))return t;let n=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:a,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"\
2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(t).map(s=>[s.type,s.value])),o=Date.UTC(+n.year,+n.month-1,+n.day,+n.hour,+n.minute,+n.second);return new Date(t.getTime()-
(o-t.getTime()))}var Ot=e=>String(e||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim(),Ue=e=>`R$ ${(Number(e)/100).toFixed(2).replace(".",",")}`,Q=(e,...a)=>a.some(t=>new RegExp(
`(^|\\W)${t}(\\W|$)`).test(e));async function Qo(e){return(await c(`select p.id, p.name, p.price_cents, c.name as category, p.kind,
      exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as required_opts
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and (('delivery' = any(p.channels)) or ('cardapio_digital' = any(p.channels)) or ('pdv' = any(p.channels)))
    order by c.sort nulls last, c.name, p.name limit 200`,[e])).rows}var Yo=new Set(["quanto","custa","valor","preco","qual","quero","uma","umas","uns","com","sem","por","favor","t\
em","voces","pra","para","mais","esta","esse","essa"]);function fn(e,a){let t=Ot(a),n=null,o=0;for(let s of e){let i=Ot(s.name);if(t.includes(i))return s;let r=i.split(/\s+/).filter(
_=>_.length>2),d=t.split(/\W+/).filter(_=>_.length>2&&!Yo.has(_)),l=r.filter(_=>t.includes(_)).length,m=d.filter(_=>r.some(k=>k.startsWith(_)||_.startsWith(k))).length,f=l?Math.max(
r.length?l/r.length:0,d.length?m/d.length:0):0;f>o&&(o=f,n=s)}return o>=.5?n:null}function xa(e,a){let t=Ot(a),n=t.match(/^(\d{1,2})\s*(x\s*)?(.+)$/),o=n?Number(n[1]):1,s=fn(e,n?n[3]:
t);return s?{p:s,qty:Math.min(Math.max(o,1),50)}:null}var ka=(e,a)=>e.map(t=>{let n=a.find(o=>o.id===t.product_id);return`${t.qty}\xD7 ${n?.name} \u2014 ${Ue((n?.price_cents||0)*t.
qty)}`}).join(`
`);async function Xo(e,a,t,{simulated:n}){let o=Dt(e.settings),s=Le(e.settings),i={...a.state||{}},r=Ot(t),d=[],l=await Qo(e.id);if(Q(r,"atendente","humano","pessoa","gerente","rec\
lamacao","reclamar","problema","desconto","cobranca","estorno","reembolso"))return{replies:[o.handoff_message],state:{step:null},handoff:!0};if(Q(r,"cancelar","cancela","sair","rec\
omecar")&&i.step&&!Q(r,"reserva"))return{replies:["Tudo bem, cancelei o que est\xE1vamos montando. Posso ajudar em algo mais?"],state:{step:null}};if(i.step==="pedido"){if(Q(r,"fin\
alizar","fechar","pronto","so isso","e isso","acabou")){if(!i.cart?.length)return{replies:["Seu pedido ainda est\xE1 vazio. Envie, por exemplo: *2 pilsen*."],state:i};let k=[s.delivery&&
"*entrega*",s.pickup&&"*retirada*"].filter(Boolean).join(" ou ");return{replies:[`Seu pedido:
${ka(i.cart,l)}

Vai ser ${k}?`],state:{...i,step:"modo"}}}let _=[];for(let k of String(t).split(/\n|,| e (?=\d)/)){if(!k.trim())continue;let j=xa(l,k);if(j){if(j.p.required_opts){d.push(`*${j.p.name}\
* tem op\xE7\xF5es para escolher \u2014 pe\xE7a esse item pelo card\xE1pio digital${e.slug?`: /c/${e.slug}`:""}.`);continue}i.cart=[...i.cart||[],{product_id:j.p.id,qty:j.qty}],_.push(
`${j.qty}\xD7 ${j.p.name}`)}}return _.length?d.push(`Anotado: ${_.join(", ")}. Algo mais? Quando terminar, digite *finalizar*.`):d.length||d.push("N\xE3o encontrei esse item no card\xE1p\
io. Digite *card\xE1pio* para ver as op\xE7\xF5es ou envie como *2 pilsen*."),{replies:d,state:i}}if(i.step==="modo")return Q(r,"entrega","entregar","delivery")&&s.delivery?{replies:[
"Qual o endere\xE7o? Envie *rua, n\xFAmero e bairro*."],state:{...i,step:"endereco",mode:"entrega"}}:Q(r,"retirada","retirar","buscar","balcao")&&s.pickup?{replies:["Em nome de que\
m fica o pedido?"],state:{...i,step:"nome",mode:"retirada"}}:{replies:["Responda *entrega* ou *retirada*."],state:i};if(i.step==="endereco"){let _=String(t).split(",").map(k=>k.trim());
return _.length<2||!/\d/.test(_[1])?{replies:["Preciso de rua e n\xFAmero, separados por v\xEDrgula. Ex.: *Rua das Flores, 120, Centro*."],state:i}:{replies:["Em nome de quem fica \
o pedido?"],state:{...i,step:"nome",address:{street:_[0],number:_[1],district:_[2]||""}}}}if(i.step==="nome"){let _=String(t).trim().slice(0,60);if(_.length<2)return{replies:["Qual\
 o nome?"],state:i};let{subtotal:k}=await _n({query:c},e.id,i.cart).catch(()=>({subtotal:0})),j=i.mode==="entrega"?s.fee_cents:0;return{replies:[`Confira:
${ka(i.cart,l)}
${j?`Taxa de entrega: ${Ue(j)}
`:""}*Total: ${Ue(k+j)}*
${i.mode==="entrega"?`Entrega em: ${i.address.street}, ${i.address.number}`:"Retirada no balc\xE3o"} \xB7 Nome: ${_}
Pagamento na ${i.mode==="entrega"?"entrega":"retirada"}.

Responda *confirmar* para enviar ou *cancelar*.`],state:{...i,step:"confirmar",name:_}}}if(i.step==="confirmar"){if(!Q(r,"confirmar","confirmo","sim","pode","ok"))return{replies:["\
Responda *confirmar* para enviar o pedido ou *cancelar*."],state:i};if(n)return{replies:["\u2705 (Simula\xE7\xE3o) Pedido montado corretamente. Nada foi enviado \xE0 cozinha nem registrado nas v\
endas."],state:{step:null}};try{let _=await Ye({query:c},e.id,{channel:"whatsapp",mode:i.mode,customer_name:i.name,phone:a.contact,address:i.address,cart:i.cart,client_key:`wa${a.id}\
x${te(6)}`},null);return{replies:[`\u2705 Pedido *#${_.number}* recebido! Total ${Ue(_.total)}. Avisaremos quando for confirmado. Para acompanhar, digite *status*.`],state:{step:null}}}catch(_){
return{replies:[`N\xE3o consegui registrar o pedido: ${_.message}`],state:{step:null}}}}if(i.step==="reserva"){let _=String(t).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\D+(\d{1,2})(?:[:h](\d{2}))?\D+(\d{1,3})/i);
if(!_)return{replies:["Envie *dia/m\xEAs, hor\xE1rio e pessoas*. Ex.: *25/10 20:30 4 pessoas*."],state:i};let k=_[3]?_[3].length===2?2e3+Number(_[3]):Number(_[3]):new Date().getFullYear(),
j=e.timezone||"America/Sao_Paulo",S=`${k}-${String(_[2]).padStart(2,"0")}-${String(_[1]).padStart(2,"0")}T${String(_[4]).padStart(2,"0")}:${_[5]||"00"}:00`,A=Zo(S,j),D=Number(_[6]);
if(Number.isNaN(A.getTime()))return{replies:["Data inv\xE1lida. Ex.: *25/10 20:30 4 pessoas*."],state:i};if(A.getTime()<Date.now()+o.reservation_min_hours*36e5)return{replies:[`Res\
ervas precisam de pelo menos ${o.reservation_min_hours}h de anteced\xEAncia.`],state:i};if(D<1||D>o.reservation_max_people)return{replies:[`Para grupos acima de ${o.reservation_max_people}\
 pessoas, a equipe vai te atender.`],state:{step:null},handoff:!0};if(n)return{replies:[`\u2705 (Simula\xE7\xE3o) Reserva para ${D} pessoa(s) em ${_[1]}/${_[2]} \xE0s ${_[4]}:${_[5]||
"00"} \u2014 nada foi gravado.`],state:{step:null}};let M=(await c("select id from units where company_id = $1 and active order by id limit 1",[e.id])).rows[0];return await c("inse\
rt into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source) values ($1,$2,$3,$4,$5,$6,'pendente','agente')",[e.id,M.id,a.contact_name||"Clie\
nte WhatsApp",a.contact,D,A]),{replies:[`Pedido de reserva para *${D}* pessoa(s) em *${_[1]}/${_[2]} \xE0s ${_[4]}:${_[5]||"00"}* registrado. A equipe confirma em breve.`],state:{step:null}}}
if(Q(r,"oi","ola","bom dia","boa tarde","boa noite","menu inicial","ajuda","opcoes")&&r.length<30)return{replies:[o.greeting],state:{step:null}};if(Q(r,"horario","horarios","funcio\
na","funcionamento","aberto","abre","fecha"))return{replies:[`${s.hours?`Nosso hor\xE1rio: ${s.hours}`:"Consulte nosso hor\xE1rio com a equipe."}${s.enabled?s.accepting?`
Estamos recebendo pedidos agora.`:`
No momento n\xE3o estamos recebendo pedidos.`:""}`],state:i};if(Q(r,"cardapio","menu","opcoes de","o que tem","tem o que")){let _={};for(let j of l)(_[j.category||"Outros"]||=[]).push(
`\u2022 ${j.name} \u2014 ${Ue(j.price_cents)}`);return{replies:[Object.entries(_).map(([j,S])=>`*${j}*
${S.slice(0,12).join(`
`)}`).join(`

`).slice(0,3500)||"Card\xE1pio indispon\xEDvel no momento.","Para pedir, digite *pedido*."],state:i}}if(Q(r,"status","meu pedido","cade","acompanhar","demora")){let _=(await c("sel\
ect number, status, mode, eta_minutes, created_at from delivery_orders where company_id = $1 and phone = $2 order by id desc limit 1",[e.id,oe(a.contact)])).rows[0];return _?{replies:[
`Pedido *#${_.number}*: *${Oe[_.status]}*${["recebido","confirmado","em_preparo"].includes(_.status)&&_.eta_minutes?` \xB7 previs\xE3o de ${_.eta_minutes} min`:""}.`],state:i}:{replies:[
"N\xE3o encontrei pedidos feitos por este n\xFAmero. Se pediu por outro n\xFAmero, fale com um *atendente*."],state:i}}if(Q(r,"reserva","reservar","mesa para"))return Q(r,"cancelar",
"cancela","desmarcar")?n?{replies:["\u2705 (Simula\xE7\xE3o) Reserva cancelada \u2014 nada foi alterado."],state:{step:null}}:{replies:[(await c(`update reservations set status = '\
cancelada' where id = (select id from reservations where company_id = $1 and phone = $2
          and status in ('pendente','confirmada') and starts_at > now() order by starts_at limit 1) returning starts_at`,[e.id,oe(a.contact)])).rows[0]?"Sua pr\xF3xima reserva foi can\
celada.":"N\xE3o encontrei reserva futura neste n\xFAmero."],state:{step:null}}:Q(r,"remarcar","mudar","alterar")?{replies:["Para remarcar, cancele a atual (*cancelar reserva*) e f\
a\xE7a uma nova (*reserva*). Se preferir, chame um *atendente*."],state:i}:{replies:["Vamos reservar! Envie *dia/m\xEAs, hor\xE1rio e n\xFAmero de pessoas*. Ex.: *25/10 20:30 4 pessoas*."],
state:{step:"reserva"}};if(Q(r,"pedido","pedir","quero","encomendar","delivery","entrega")){if(!s.enabled||!s.accepting)return{replies:[o.closed_message],state:i};let _=xa(l,r.replace(
/\b(quero|pedir|pedido|fazer|um|uma)\b/g," ").trim()),k=_&&!_.p.required_opts?[{product_id:_.p.id,qty:_.qty}]:[];return{replies:[`${k.length?`Anotado: ${k[0].qty}\xD7 ${_.p.name}. `:
""}Me diga os itens, um por linha, com a quantidade. Ex.:
*2 pilsen*
*1 batata frita*
Quando terminar, digite *finalizar*.`],state:{step:"pedido",cart:k}}}if(Q(r,"preco","quanto","valor","custa")){let _=fn(l,r);return{replies:[_?`*${_.name}*: ${Ue(_.price_cents)}.`:
"De qual item? Digite *card\xE1pio* para ver todos os pre\xE7os."],state:i}}let m=fn(l,r);if(m)return{replies:[`*${m.name}*: ${Ue(m.price_cents)}. Para pedir, digite *pedido*.`],state:i};
let f=(i.misses||0)+1;return f>=3?{replies:[o.handoff_message],state:{step:null},handoff:!0}:{replies:[`N\xE3o entendi. ${o.greeting}`],state:{...i,misses:f}}}async function ut(e,a,t){
let n=Object.fromEntries((await c("select key, value from company_secrets where company_id = $1 and key in ('wa_token','wa_phone_number_id')",[e])).rows.map(o=>[o.key,o.value]));if(!n.
wa_token||!n.wa_phone_number_id)return{ok:!1,error:"Integra\xE7\xE3o do WhatsApp n\xE3o configurada"};try{let o=await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(n.
wa_phone_number_id)}/messages`,{method:"POST",headers:{authorization:`Bearer ${n.wa_token}`,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:oe(
a),type:"text",text:{body:t.slice(0,4e3)}}),signal:AbortSignal.timeout(8e3)}),s=await o.json().catch(()=>({}));return o.ok?{ok:!0,id:s?.messages?.[0]?.id}:{ok:!1,error:s?.error?.message?.
slice(0,200)||`HTTP ${o.status}`}}catch(o){return{ok:!1,error:String(o.message||o).slice(0,200)}}}async function mt(e,a,t,n){let o=await e.query(`insert into conversation_messages \
(company_id, conversation_id, direction, author, body, external_id, delivery_status, error, user_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,[a,t,n.direction,n.author,n.body,n.external_id??null,n.delivery_status||"ok",n.error??null,n.user_id??null]);
return await e.query("update conversations set last_message_at = now() where id = $1",[t]),o.rows[0]?.id||null}async function Pt(e,{channel:a,contact:t,contactName:n,body:o,externalId:s}){
let i=a==="simulador",r=(await c(`insert into conversations (company_id, channel, contact, contact_name) values ($1,$2,$3,$4)
    on conflict (company_id, channel, contact) do update set contact_name = coalesce(excluded.contact_name, conversations.contact_name) returning *`,[e.id,a,t,n??null])).rows[0];if(!await mt(
{query:c},e.id,r.id,{direction:"in",author:"cliente",body:String(o).slice(0,4e3),external_id:s}))return{duplicate:!0,conversation_id:r.id,replies:[]};let l=Dt(e.settings);if(r.mode!==
"agente"||!l.enabled&&!i)return{conversation_id:r.id,replies:[],mode:r.mode};let m=await Xo(e,r,o,{simulated:i});await c("update conversations set state = $2, needs_human = needs_h\
uman or $3, mode = case when $3 then 'humano' else mode end where id = $1",[r.id,JSON.stringify(m.state||{}),!!m.handoff]);for(let f of m.replies){let _=i?"simulado":"pendente",k=null,
j=null;if(!i){let S=await ut(e.id,t,f);_=S.ok?"ok":"falhou",k=S.error||null,j=S.id||null}await mt({query:c},e.id,r.id,{direction:"out",author:"agente",body:f,external_id:j,delivery_status:_,
error:k})}return{conversation_id:r.id,replies:m.replies,handoff:!!m.handoff}}var se=ts(),wn=e=>`${e}.${es.createHmac("sha256",ot("unsubscribe")).update(String(e)).digest("base64url").slice(0,16)}`;function ja(e){let[a]=String(e||"").split(".");return/^\d+$/.
test(a||"")&&wn(a)===e?Number(a):null}var Ia=ee.object({birthday_month:ee.boolean().optional(),inactive_days:ee.number().int().min(1).max(3650).optional(),tag:ee.string().trim().max(
30).optional(),min_visits:ee.number().int().min(1).max(1e3).optional()}).default({});function za(e,a,t){let n=`c.company_id = $1 and c.anonymized_at is null and c.unsubscribed_at i\
s null and ${a==="whatsapp"?"c.consent_whatsapp and c.phone is not null":"c.consent_email and c.email is not null"}`;return e.birthday_month&&(n+=" and extract(month from c.birthda\
y) = extract(month from current_date)"),e.tag&&(t.push(e.tag),n+=` and $${t.length} = any(c.tags)`),e.inactive_days&&(t.push(e.inactive_days),n+=` and not exists (select 1 from con\
sumption_sessions s where s.customer_id = c.id and s.opened_at > now() - make_interval(days => $${t.length}))`),e.min_visits&&(t.push(e.min_visits),n+=` and (select count(*) from c\
onsumption_sessions s where s.customer_id = c.id and s.status = 'encerrada') >= $${t.length}`),n}var Sa=(e,a,t)=>e.replaceAll("{nome}",(a.name||"").split(" ")[0]).replaceAll("{empr\
esa}",t).replaceAll("{pontos}",String(a.points??0));se.post("/segments/preview",p("marketing.gerenciar"),u(async(e,a)=>{let t=w(ee.object({channel:ee.enum(["whatsapp","email"]),segment:Ia}),
e.body),n=[e.ctx.companyId],o=za(t.segment,t.channel,n),s=(await c(`select count(*)::int as n from customers c where ${o}`,n)).rows[0].n,i=(await c("select count(*)::int as n from \
customers where company_id = $1 and anonymized_at is null",[e.ctx.companyId])).rows[0].n;a.json({recipients:s,without_consent:i-s})}));se.get("/campaigns",p("marketing.gerenciar"),
u(async(e,a)=>{a.json((await c(`select c.*, u.name as user_name,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'enviado') as sent,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'falhou') as failed
    from campaigns c left join users u on u.id = c.created_by where c.company_id = $1 order by c.id desc limit 100`,[e.ctx.companyId])).rows)}));se.post("/campaigns",p("marketing.g\
erenciar"),u(async(e,a)=>{let t=w(ee.object({name:ee.string().trim().min(3).max(80),channel:ee.enum(["whatsapp","email"]),segment:Ia,message:ee.string().trim().min(10).max(1500)}),
e.body),n=await c("insert into campaigns (company_id, name, channel, segment, message, created_by) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,t.name,t.channel,t.segment,
t.message,e.ctx.userId]);a.status(201).json({id:n.rows[0].id})}));se.post("/campaigns/:id/prepare",p("marketing.gerenciar"),u(async(e,a)=>{let t=await $(async n=>{let o=(await n.query(
"select * from campaigns where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw b("Campanha n\xE3o encontrada");if(o.status!=="ra\
scunho")throw g("Campanha j\xE1 preparada");let s=[e.ctx.companyId],i=za(o.segment,o.channel,s);s.push(o.id);let r=await n.query(`insert into campaign_recipients (company_id, campa\
ign_id, customer_id) select $1, $${s.length}, c.id from customers c where ${i}`,s);return await n.query("update campaigns set status = 'preparada', recipients = $2, prepared_at = n\
ow() where id = $1",[o.id,r.rowCount]),await h(n,e.ctx,"marketing.campanha_preparada",{entity:"campaign",entityId:o.id,data:{recipients:r.rowCount}}),{recipients:r.rowCount}});a.json(
t)}));se.get("/campaigns/:id/recipients",p("marketing.gerenciar","dados.pessoais"),u(async(e,a)=>{let t=(await c("select c.*, co.name as company from campaigns c join companies co \
on co.id = c.company_id where c.id = $1 and c.company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw b();let n=(await c(`select r.id, r.status, r.sent_at, r.e\
rror, cu.id as customer_id, cu.name, cu.phone, cu.email, cu.points, cu.unsubscribed_at
    from campaign_recipients r join customers cu on cu.id = r.customer_id where r.campaign_id = $1 order by cu.name limit 2000`,[t.id])).rows;a.json(n.map(o=>({...o,message:`${Sa(t.
message,o,t.company)}

Para n\xE3o receber mais: ${e.query.base||""}/sair/${wn(o.customer_id)}`})))}));se.post("/campaigns/:id/recipients/:rid/sent",p("marketing.gerenciar"),u(async(e,a)=>{let t=await c(
"update campaign_recipients set status = 'enviado', sent_at = now() where id = $1 and campaign_id = $2 and company_id = $3 and status in ('pendente','falhou') returning id",[Number(
e.params.rid),Number(e.params.id),e.ctx.companyId]);a.json({ok:!!t.rows[0]})}));se.post("/campaigns/:id/send",p("marketing.gerenciar"),u(async(e,a)=>{let t=w(ee.object({base_url:ee.
string().url().max(200)}),e.body),n=(await c("select c.*, co.name as company from campaigns c join companies co on co.id = c.company_id where c.id = $1 and c.company_id = $2",[Number(
e.params.id),e.ctx.companyId])).rows[0];if(!n)throw b();if(n.channel!=="whatsapp")throw y("Envio autom\xE1tico dispon\xEDvel s\xF3 para WhatsApp; para e-mail, exporte a lista");if(n.
status!=="preparada")throw g("Prepare a campanha antes de enviar");let o=(await c(`select r.id, cu.id as customer_id, cu.name, cu.phone, cu.points from campaign_recipients r join c\
ustomers cu on cu.id = r.customer_id
    where r.campaign_id = $1 and r.status in ('pendente','falhou') and cu.unsubscribed_at is null and cu.consent_whatsapp limit 300`,[n.id])).rows,s=0,i=0;for(let r of o){let d=await ut(
e.ctx.companyId,r.phone,`${Sa(n.message,r,n.company)}

Para n\xE3o receber mais: ${t.base_url}/sair/${wn(r.customer_id)}`);if(await c("update campaign_recipients set status = $2, sent_at = case when $2 = 'enviado' then now() end, error\
 = $3 where id = $1",[r.id,d.ok?"enviado":"falhou",d.error||null]),d.ok?s++:i++,!d.ok&&/não configurada/.test(d.error))break}s&&!i&&await c("update campaigns set status = 'enviada\
' where id = $1",[n.id]),await h({query:c},e.ctx,"marketing.campanha_enviada",{entity:"campaign",entityId:n.id,data:{sent:s,failed:i}}),a.json({sent:s,failed:i})}));se.post("/campa\
igns/:id/cancel",p("marketing.gerenciar"),u(async(e,a)=>{if(!(await c("update campaigns set status = 'cancelada' where id = $1 and company_id = $2 and status in ('rascunho','prepar\
ada') returning id",[Number(e.params.id),e.ctx.companyId])).rows[0])throw g("Campanha n\xE3o pode ser cancelada");a.json({ok:!0})}));se.get("/reviews",p("marketing.gerenciar"),u(async(e,a)=>{
let t=Math.min(365,Number(e.query.days)||30),n=(await c(`select count(*)::int as total, round(avg(score)::numeric, 2)::float as average,
      count(*) filter (where score >= 4)::int as positive, count(*) filter (where score <= 2)::int as negative,
      count(*) filter (where score <= 2 and handled_at is null)::int as pending
    from reviews where company_id = $1 and created_at > now() - make_interval(days => $2)`,[e.ctx.companyId,t])).rows[0],o=(await c("select score, count(*)::int as n from reviews w\
here company_id = $1 and created_at > now() - make_interval(days => $2) group by score order by score",[e.ctx.companyId,t])).rows,s=(await c(`select r.id, r.score, r.comment, r.cre\
ated_at, r.handled_at, r.session_id, cu.name as customer_name, cu.id as customer_id, u.name as handled_name
    from reviews r left join customers cu on cu.id = r.customer_id left join users u on u.id = r.handled_by
    where r.company_id = $1 and r.created_at > now() - make_interval(days => $2) order by (r.score <= 2 and r.handled_at is null) desc, r.id desc limit 200`,[e.ctx.companyId,t])).rows;
a.json({stats:n,distribution:o,items:s})}));se.post("/reviews/:id/handled",p("marketing.gerenciar"),u(async(e,a)=>{let t=w(ee.object({note:ee.string().trim().min(3).max(300)}),e.body),
n=await c("update reviews set handled_at = now(), handled_by = $3 where id = $1 and company_id = $2 and handled_at is null returning id",[Number(e.params.id),e.ctx.companyId,e.ctx.
userId]);if(!n.rows[0])throw g("Avalia\xE7\xE3o j\xE1 tratada");await h({query:c},e.ctx,"marketing.avaliacao_tratada",{entity:"review",entityId:n.rows[0].id,reason:t.note}),a.json(
{ok:!0})}));se.get("/review-link/:sessionId",p("pdv.lancar"),u(async(e,a)=>{let t=(await c("select id from consumption_sessions where id = $1 and company_id = $2 and status = 'ence\
rrada'",[Number(e.params.sessionId),e.ctx.companyId])).rows[0];if(!t)throw b("Consumo encerrado n\xE3o encontrado");let n=(await c("select slug from companies where id = $1",[e.ctx.
companyId])).rows[0];a.json({token:At(t.id),path:`/avaliar/${At(t.id)}`,slug:n.slug})}));import{Router as ns}from"npm:express@5.2.1";import{z as W}from"npm:zod@4.6.5";var xe=ns(),hn=["wa_token","wa_phone_number_id","wa_app_secret","wa_verify_token"];xe.get("/settings",p("agente.gerenciar"),u(async(e,a)=>{let t=(await c("select slug, settings fro\
m companies where id = $1",[e.ctx.companyId])).rows[0],n=(await c("select key, updated_at from company_secrets where company_id = $1 and key = any($2)",[e.ctx.companyId,hn])).rows,
o=(await c("select m.created_at, m.error from conversation_messages m where m.company_id = $1 and m.delivery_status = 'falhou' order by m.id desc limit 10",[e.ctx.companyId])).rows;
a.json({...Dt(t.settings),slug:t.slug,secrets:Object.fromEntries(hn.map(s=>[s,!!n.find(i=>i.key===s)])),webhook_path:t.slug?`/api/public/whatsapp/${t.slug}`:null,failures:o})}));xe.
put("/settings",p("agente.gerenciar"),u(async(e,a)=>{let t=w(W.object({enabled:W.boolean(),name:W.string().trim().min(2).max(40),greeting:W.string().trim().min(5).max(600),handoff_message:W.
string().trim().min(5).max(300),closed_message:W.string().trim().min(5).max(300),reservation_max_people:W.number().int().min(1).max(100),reservation_min_hours:W.number().int().min(
0).max(72)}),e.body);await c("update companies set settings = jsonb_set(settings, '{agent}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await h({query:c},e.ctx,
"agente.configuracao",{data:{enabled:t.enabled}}),a.json({ok:!0})}));xe.put("/secrets",p("agente.gerenciar","configuracoes.gerenciar"),u(async(e,a)=>{let t=w(W.object(Object.fromEntries(
hn.map(n=>[n,W.string().trim().max(600).optional()]))),e.body);await $(async n=>{for(let[o,s]of Object.entries(t))s!==void 0&&(s?await n.query(`insert into company_secrets (company\
_id, key, value) values ($1,$2,$3)
        on conflict (company_id, key) do update set value = excluded.value, updated_at = now()`,[e.ctx.companyId,o,s]):await n.query("delete from company_secrets where company_id =\
 $1 and key = $2",[e.ctx.companyId,o]));await h(n,e.ctx,"agente.credenciais",{data:{keys:Object.keys(t).filter(o=>t[o]!==void 0)}})}),a.json({ok:!0})}));xe.get("/conversations",p("\
agente.atender"),u(async(e,a)=>{let t=e.query.channel==="simulador"?"simulador":"whatsapp";a.json((await c(`select c.id, c.channel, c.contact, c.contact_name, c.mode, c.needs_human\
, c.last_message_at, u.name as assigned_name,
      (select body from conversation_messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_body,
      (select count(*)::int from conversation_messages m where m.conversation_id = c.id and m.delivery_status = 'falhou') as failures
    from conversations c left join users u on u.id = c.assigned_to where c.company_id = $1 and c.channel = $2
    order by c.needs_human desc, c.last_message_at desc limit 100`,[e.ctx.companyId,t])).rows)}));xe.get("/conversations/:id",p("agente.atender"),u(async(e,a)=>{let t=(await c("sel\
ect * from conversations where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw b("Conversa n\xE3o encontrada");let n=(await c(`select m.id,\
 m.direction, m.author, m.body, m.delivery_status, m.error, m.created_at, u.name as user_name
    from conversation_messages m left join users u on u.id = m.user_id where m.conversation_id = $1 order by m.id desc limit 200`,[t.id])).rows.reverse();a.json({conversation:t,messages:n})}));
xe.post("/conversations/:id/mode",p("agente.atender"),u(async(e,a)=>{let t=w(W.object({mode:W.enum(["agente","humano","pausado"])}),e.body),n=await c(`update conversations set mode\
 = $3, assigned_to = case when $3 = 'humano' then $4 else null end,
      needs_human = case when $3 = 'agente' then false else needs_human end, state = case when $3 = 'agente' then '{}'::jsonb else state end
    where id = $1 and company_id = $2 returning id`,[Number(e.params.id),e.ctx.companyId,t.mode,e.ctx.userId]);if(!n.rows[0])throw b();await mt({query:c},e.ctx.companyId,n.rows[0].
id,{direction:"out",author:"sistema",delivery_status:"simulado",body:{agente:"Conversa devolvida ao agente",humano:`${e.ctx.name} assumiu a conversa`,pausado:"Agente pausado nesta \
conversa"}[t.mode],user_id:e.ctx.userId}),a.json({ok:!0})}));xe.post("/conversations/:id/reply",p("agente.atender"),u(async(e,a)=>{let t=w(W.object({body:W.string().trim().min(1).max(
2e3)}),e.body),n=(await c("select * from conversations where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!n)throw b();if(n.mode==="agente")throw g(
"Assuma a conversa antes de responder","not_assumed");let o="simulado",s=null,i=null;if(n.channel==="whatsapp"){let r=await ut(e.ctx.companyId,n.contact,t.body);o=r.ok?"ok":"falhou",
s=r.error||null,i=r.id||null}await mt({query:c},e.ctx.companyId,n.id,{direction:"out",author:"equipe",body:t.body,external_id:i,delivery_status:o,error:s,user_id:e.ctx.userId}),a.status(
201).json({ok:o!=="falhou",status:o,error:s})}));xe.post("/simulate",p("agente.gerenciar"),u(async(e,a)=>{let t=w(W.object({body:W.string().trim().min(1).max(1e3),contact:W.string().
trim().max(20).optional(),reset:W.boolean().optional()}),e.body),n=(await c("select id, name, slug, timezone, settings from companies where id = $1",[e.ctx.companyId])).rows[0],o=`\
sim-${t.contact||e.ctx.userId}`;t.reset&&await c("delete from conversations where company_id = $1 and channel = 'simulador' and contact = $2",[e.ctx.companyId,o]);let s=await Pt(n,
{channel:"simulador",contact:o,contactName:"Simula\xE7\xE3o",body:t.body,externalId:`sim-${te(8)}`});a.json(s)}));import{Router as as}from"npm:express@5.2.1";import{z as ke}from"npm:zod@4.6.5";var lt=as();lt.get("/",p("salao.visualizar"),u(async(e,a)=>{let t=/^\d{4}-\d{2}-\d{2}$/.test(String(e.query.day))?e.query.day:null,n=e.ctx.company.timezone,o=[e.ctx.companyId,n],s="\
r.company_id = $1";t?(o.push(t),s+=` and (r.starts_at at time zone $2)::date = $${o.length}`):s+=" and r.starts_at > now() - interval '3 hours'",a.json((await c(`select r.*, t.numb\
er as table_number from reservations r left join dining_tables t on t.id = r.table_id where ${s} order by r.starts_at limit 200`,o)).rows)}));lt.post("/",p("salao.gerenciar"),u(async(e,a)=>{
let t=w(ke.object({customer_name:ke.string().trim().min(2).max(80),phone:ke.string().trim().max(20).optional(),people:ke.number().int().min(1).max(100),starts_at:ke.string().datetime(
{offset:!0}),table_id:ke.number().int().nullable().optional(),notes:ke.string().max(300).optional()}),e.body);if(new Date(t.starts_at).getTime()<Date.now()-36e5)throw y("Hor\xE1rio j\xE1\
 passou");if(t.table_id&&!(await c("select 1 from dining_tables where id = $1 and company_id = $2",[t.table_id,e.ctx.companyId])).rows[0])throw y("Mesa inv\xE1lida");let n=e.ctx.unitId||
(await c("select id from units where company_id = $1 order by id limit 1",[e.ctx.companyId])).rows[0].id,o=await c(`insert into reservations (company_id, unit_id, customer_name, ph\
one, people, starts_at, table_id, notes, status, source)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmada','equipe') returning id`,[e.ctx.companyId,n,t.customer_name,t.phone?oe(t.phone):null,t.people,t.starts_at,t.table_id??null,t.notes??
null]);await h({query:c},e.ctx,"reserva.criada",{entity:"reservation",entityId:o.rows[0].id,data:{people:t.people,starts_at:t.starts_at}}),a.status(201).json({id:o.rows[0].id})}));
lt.post("/:id/status",p("salao.gerenciar"),u(async(e,a)=>{let t=w(ke.object({status:ke.enum(["confirmada","cancelada","chegou","nao_compareceu"]),table_id:ke.number().int().nullable().
optional()}),e.body),n=await c("update reservations set status = $3, table_id = coalesce($4, table_id) where id = $1 and company_id = $2 returning id, table_id",[Number(e.params.id),
e.ctx.companyId,t.status,t.table_id??null]);if(!n.rows[0])throw b("Reserva n\xE3o encontrada");t.status==="confirmada"&&n.rows[0].table_id&&await c("update dining_tables set status\
 = 'reservada' where id = $1 and status = 'livre'",[n.rows[0].table_id]),await h({query:c},e.ctx,`reserva.${t.status}`,{entity:"reservation",entityId:n.rows[0].id}),a.json({ok:!0})}));import os from"node:crypto";import{Router as ss}from"npm:express@5.2.1";import{z as U}from"npm:zod@4.6.5";var je=ss();async function Tt(e){if(!/^[a-z0-9-]{3,40}$/.test(String(e)))throw b("Estabelecimento n\xE3o encontrado");let a=(await c("select id, name, slug, phone, address, timezon\
e, settings, is_demo from companies where slug = $1",[e])).rows[0];if(!a)throw b("Estabelecimento n\xE3o encontrado");return a}je.get("/:slug/menu",u(async(e,a)=>{let t=await Tt(e.
params.slug),n=Le(t.settings);if(!n.enabled)throw b("Card\xE1pio digital desativado");let o=(await c(`select p.id, p.name, p.description, p.price_cents, p.allergens, p.category_id,\
 c.name as category,
      coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
         'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                       from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id) from modifier_groups g where g.product_id = p.id), '[]') as groups
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and ('delivery' = any(p.channels) or 'cardapio_digital' = any(p.channels))
    order by c.sort nulls last, c.name, p.name`,[t.id])).rows;a.set("cache-control","public, max-age=30"),a.json({company:{name:t.name,slug:t.slug,phone:t.phone,address:t.address?.
city?`${t.address.street||""} ${t.address.number||""} \u2014 ${t.address.city}`:null},settings:{accepting:n.accepting,delivery:n.delivery,pickup:n.pickup,fee_cents:n.fee_cents,min_order_cents:n.
min_order_cents,eta_minutes:n.eta_minutes,hours:n.hours,areas:n.areas,message:n.message,payment_methods:n.payment_methods},products:o})}));var is=U.object({mode:U.enum(["entrega","\
retirada"]),customer_name:U.string().trim().min(2).max(80),phone:U.string().trim().min(10).max(20),address:U.object({street:U.string().trim().max(120),number:U.string().trim().max(
20),district:U.string().trim().max(80).optional(),complement:U.string().trim().max(80).optional(),reference:U.string().trim().max(120).optional()}).partial().optional(),payment_hint:U.
enum(["dinheiro","pix","cartao"]),change_for_cents:U.number().int().min(0).max(1e6).optional(),notes:U.string().trim().max(300).optional(),cart:U.array(U.object({product_id:U.number().
int(),qty:U.number().int().min(1).max(50),option_ids:U.array(U.number().int()).max(40).default([]),notes:U.string().trim().max(140).optional()})).min(1).max(40),client_key:U.string().
regex(/^[A-Za-z0-9_-]{12,80}$/),website:U.string().max(0).optional()});je.post("/:slug/orders",u(async(e,a)=>{let t=await Tt(e.params.slug),n=w(is,e.body);await le(`pub-order:${t.id}\
:${e.ip}`,8,900),await le(`pub-order-phone:${t.id}:${n.phone.replace(/\D/g,"")}`,4,900);let o=await $(s=>Ye(s,t.id,{...n,channel:"site"},null));a.status(o.replay?200:201).json({number:o.
number,token:o.public_token,status:o.status})}));je.get("/orders/:token",u(async(e,a)=>{if(!/^[A-Za-z0-9_-]{16,40}$/.test(e.params.token))throw b("Pedido n\xE3o encontrado");let t=(await c(
`select d.id, d.number, d.status, d.mode, d.eta_minutes, d.created_at, d.updated_at, d.session_id, d.customer_name, c.name as company, c.slug
    from delivery_orders d join companies c on c.id = d.company_id where d.public_token = $1`,[e.params.token])).rows[0];if(!t)throw b("Pedido n\xE3o encontrado");let n=(await c("s\
elect description, qty, modifiers, total_cents from order_items where session_id = $1 and status = 'ativo' order by id",[t.session_id])).rows,o=(await c("select status, created_at \
from delivery_events where order_id = $1 order by id",[t.id])).rows,s=await R({query:c},t.session_id);a.set("cache-control","no-store"),a.json({number:t.number,status:t.status,label:Oe[t.
status],mode:t.mode,eta_minutes:t.eta_minutes,created_at:t.created_at,first_name:t.customer_name.split(" ")[0],company:t.company,slug:t.slug,items:n,totals:{items:s.items,delivery_fee:s.
deliveryFee,total:s.total},events:o.map(i=>({status:i.status,label:Oe[i.status],at:i.created_at}))})}));je.get("/review/:token",u(async(e,a)=>{let t=yn(e.params.token);if(!t)throw b(
"Link inv\xE1lido");let n=(await c(`select s.id, s.company_id, c.name as company, (select 1 from reviews r where r.session_id = s.id) as done
    from consumption_sessions s join companies c on c.id = s.company_id where s.id = $1 and s.status = 'encerrada'`,[t])).rows[0];if(!n)throw b("Link inv\xE1lido");a.json({company:n.
company,already:!!n.done})}));je.post("/review/:token",u(async(e,a)=>{let t=yn(e.params.token);if(!t)throw b("Link inv\xE1lido");await le(`pub-review:${e.ip}`,10,3600);let n=w(U.object(
{score:U.number().int().min(1).max(5),comment:U.string().trim().max(600).optional()}),e.body),o=(await c("select id, company_id, customer_id from consumption_sessions where id = $1\
 and status = 'encerrada'",[t])).rows[0];if(!o)throw b("Link inv\xE1lido");await c("insert into reviews (company_id, session_id, customer_id, score, comment) values ($1,$2,$3,$4,$5\
)",[o.company_id,o.id,o.customer_id,n.score,n.comment||null]).catch(s=>{throw s.code==="23505"?g("Este consumo j\xE1 foi avaliado. Obrigado!","already_reviewed"):s}),a.status(201).
json({ok:!0})}));je.post("/unsubscribe/:token",u(async(e,a)=>{let t=ja(e.params.token);if(!t)throw b("Link inv\xE1lido");let n=await c("update customers set consent_whatsapp = fals\
e, consent_email = false, unsubscribed_at = now(), updated_at = now() where id = $1 returning company_id",[t]);n.rows[0]&&await c(`insert into audit_events (company_id, action, ent\
ity, entity_id, data) values ($1,'cliente.descadastro','customer',$2,'{"origem":"link"}')`,[n.rows[0].company_id,String(t)]),a.json({ok:!0})}));async function Na(e){return Object.fromEntries(
(await c("select key, value from company_secrets where company_id = $1 and key like 'wa_%'",[e])).rows.map(a=>[a.key,a.value]))}je.get("/whatsapp/:slug",u(async(e,a)=>{let t=await Tt(
e.params.slug),n=await Na(t.id);if(e.query["hub.mode"]==="subscribe"&&n.wa_verify_token&&Vt(String(e.query["hub.verify_token"]||""),n.wa_verify_token))return a.type("text/plain").send(
String(e.query["hub.challenge"]||"").slice(0,200));a.status(403).json({error:"Verifica\xE7\xE3o recusada"})}));je.post("/whatsapp/:slug",u(async(e,a)=>{let t=await Tt(e.params.slug),
n=await Na(t.id);if(!n.wa_app_secret)return a.status(403).json({error:"Integra\xE7\xE3o n\xE3o configurada"});let o=`sha256=${os.createHmac("sha256",n.wa_app_secret).update(e.rawBody||
"").digest("hex")}`;if(!Vt(String(e.headers["x-hub-signature-256"]||""),o))return a.status(401).json({error:"Assinatura inv\xE1lida"});let s=(await c("select id, name, slug, timezo\
ne, settings from companies where id = $1",[t.id])).rows[0];for(let i of e.body?.entry||[])for(let r of i.changes||[]){let d=r.value||{},l=Object.fromEntries((d.contacts||[]).map(m=>[
m.wa_id,m.profile?.name]));for(let m of d.messages||[]){let f=m.type==="text"?m.text?.body:m.type==="button"?m.button?.text:m.type==="interactive"?m.interactive?.button_reply?.title||
m.interactive?.list_reply?.title:null;!f||!m.from||await Pt(s,{channel:"whatsapp",contact:String(m.from).slice(0,20),contactName:l[m.from]||null,body:f,externalId:m.id})}}a.json({ok:!0})}));import{Router as gn}from"npm:express@5.2.1";import rs from"npm:bcryptjs@3.0.3";import Ca from"node:crypto";import{z as ie}from"npm:zod@4.6.5";var re=gn();re.use(Dn);re.use((e,a,t)=>{a.set("Cache-Control","no-store"),t()});var bn={companyId:null,userId:null};async function pt(e){if(!/^\d{1,18}$/.test(String(e)))throw b("E\
mpresa n\xE3o encontrada.");let{rows:a}=await c("select id, is_demo from companies where id = $1",[e]);if(!a[0]||a[0].is_demo)throw b("Empresa n\xE3o encontrada.");return a[0]}re.get(
"/manifest",(e,a)=>a.json({code:Jt,name:"RUSTEN",contract:qn,contract_minor:1,version:An,description:"Gest\xE3o e PDV para bares e restaurantes: comandas, mesas, dupla leitura e caixa\
.",features:Pn,settings:Yn()}));re.get("/tenants",u(async(e,a)=>{let{rows:t}=await c("select id from companies where not is_demo order by id limit 5000"),n=[];for(let o of t){let s=await ht(
o.id);if(s){let{is_demo:i,owner_email:r,...d}=s;n.push(d)}}a.json({items:n})}));var cs=(e,a)=>a||e;re.get("/tenants/:id",u(async(e,a)=>{let t=await pt(e.params.id),{is_demo:n,...o}=await ht(
t.id),{rows:s}=await c(`select u.name, u.email, u.role_key as role, r.name as role_name, u.active,
            (select max(s.created_at) from user_sessions s where s.user_id = u.id) as last_login_at
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by u.role_key = 'owner' desc, u.name limit 200`,[t.id]),{rows:i}=await c("select name, active from units where company_id = $1 order by id",[t.id]);
a.json({tenant:{...o,users:{n:s.length,active:s.filter(r=>r.active).length,list:s.map(({role_name:r,...d})=>({...d,role_label:cs(d.role,r)}))},units:i}})}));re.post("/tenants/:id/a\
ccess",u(async(e,a)=>{let t=await pt(e.params.id),n=w(ie.object({access:ie.object({status:ie.string(),blocked:ie.boolean()}).passthrough()}),e.body);await nt(t.id,n.access),await h(
{query:c},{...bn,companyId:t.id},"central.situacao_recebida",{entity:"company",entityId:t.id,data:{status:n.access.status,blocked:n.access.blocked}}),a.json({ok:!0})}));re.post("/t\
enants/:id/owner-reset",u(async(e,a)=>{let t=await pt(e.params.id),n=w(ie.object({email:ie.string().trim().toLowerCase().email().max(160).nullable().optional()}),e.body||{}),{rows:o}=await c(
"select id, email from users where company_id = $1 and role_key = 'owner' order by id limit 1",[t.id]),s=o[0];if(!s)throw new E(404,"Esta empresa n\xE3o tem usu\xE1rio respons\xE1vel.",
"not_found");let i=s.email;if(n.email&&n.email!==s.email.toLowerCase()){if((await c("select 1 from users where lower(email) = $1 and id <> $2",[n.email,s.id])).rows[0])throw new E(
409,"Este e-mail j\xE1 \xE9 usado por outro acesso.","email_taken");await c("update users set email = $1 where id = $2",[n.email,s.id]),i=n.email}let r=`Rs-${Ca.randomBytes(6).toString(
"base64url")}-${Ca.randomInt(10,99)}`;await c(`update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null, active = true
            where id = $1`,[s.id,await rs.hash(r,12)]),await c("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[s.id]),await h({query:c},{...bn,
companyId:t.id},"central.senha_provisoria",{entity:"user",entityId:s.id,data:{email:i}}),a.json({ok:!0,user_id:String(s.id),email:i,temporary_password:r,message:"Senha provis\xF3ria c\
riada. Oriente o respons\xE1vel a troc\xE1-la em Configura\xE7\xF5es \u203A Meu acesso logo no primeiro acesso."})}));re.get("/settings",u(async(e,a)=>a.json({values:await Ee()})));
re.put("/settings",u(async(e,a)=>{let t=await ea(e.body?.values);a.json({values:t})}));re.get("/tenants/:id/settings",u(async(e,a)=>{let t=await pt(e.params.id);a.json({values:await nn(
t.id)})}));re.put("/tenants/:id/settings",u(async(e,a)=>{let t=await pt(e.params.id),n=await $(async o=>{let s=await na(o,t.id,e.body?.values);return await h(o,{...bn,companyId:t.id},
"central.parametros_alterados",{entity:"company",entityId:t.id,reason:typeof e.body?.reason=="string"?e.body.reason.slice(0,300):null,data:s}),s});a.json({ok:!0,changed:n,values:await nn(
t.id)})}));var $n=gn();$n.get("/platform",u(async(e,a)=>{let t=P.CRON_SECRET;if(!t||e.headers.authorization!==`Bearer ${t}`)return a.status(401).json({error:"n\xE3o autorizado"});a.
json(await Ge(50))}));var Ie=gn();Ie.use(Ne());var _t=e=>encodeURIComponent(e.ctx.companyId),Rt=e=>({user_email:e.ctx.email,user_name:e.ctx.name}),Mt=(e,a,t)=>{if(e.ctx.company.is_demo)
return t(new E(400,"Na demonstra\xE7\xE3o n\xE3o h\xE1 assinatura. Ative sua conta para contratar.","demo"));t()};Ie.get("/",u(async(e,a)=>a.json({access:e.ctx.access,hub:!!await ue()})));
Ie.get("/billing",u(async(e,a)=>{if(e.ctx.company.is_demo||!await ue())return a.json({access:e.ctx.access,hub:!1,demo:!!e.ctx.company.is_demo});if(!e.ctx.can("assinatura.gerenciar"))
return a.json({access:e.ctx.access,restricted:!0,hub:!0});let t=await ge("GET",`/tenants/${_t(e)}/billing`);t.access&&await nt(e.ctx.companyId,t.access),a.json({...t,hub:!0})}));Ie.
post("/billing/checkout",p("assinatura.gerenciar"),Mt,u(async(e,a)=>{let t=w(ie.object({plan_id:ie.string().uuid(),cycle:ie.enum(["MONTHLY","ANNUAL"])}),e.body),n=await ge("POST",`\
/tenants/${_t(e)}/billing/checkout`,{...t,...Rt(e)});await h({query:c},e.ctx,"assinatura.contratacao",{data:{plan_id:t.plan_id,cycle:t.cycle}}),a.status(201).json(n)}));Ie.post("/b\
illing/renew",p("assinatura.gerenciar"),Mt,u(async(e,a)=>{let t=await ge("POST",`/tenants/${_t(e)}/billing/renew`,Rt(e));await h({query:c},e.ctx,"assinatura.renovacao"),a.status(201).
json(t)}));Ie.post("/billing/change-plan",p("assinatura.gerenciar"),Mt,u(async(e,a)=>{let t=w(ie.object({plan_id:ie.string().uuid()}),e.body),n=await ge("POST",`/tenants/${_t(e)}/b\
illing/change-plan`,{...t,...Rt(e)});await He({id:e.ctx.companyId},{fresh:!0}),await h({query:c},e.ctx,"assinatura.troca_plano",{data:t}),a.json(n)}));Ie.post("/billing/cancel",p("\
assinatura.gerenciar"),Mt,u(async(e,a)=>{if(w(ie.object({confirm:ie.literal(!0,{message:"confirme o cancelamento"})}),e.body),e.ctx.role!=="owner")throw new E(403,"S\xF3 o propriet\xE1ri\
o pode cancelar a assinatura.","forbidden");let t=await ge("POST",`/tenants/${_t(e)}/billing/cancel`,{confirm:!0,...Rt(e)});await He({id:e.ctx.companyId},{fresh:!0}),await h({query:c},
e.ctx,"assinatura.cancelamento"),a.json(t)}));Ie.post("/verify",u(async(e,a)=>{let t=await He({id:e.ctx.companyId,is_demo:e.ctx.company.is_demo},{fresh:!0});await h({query:c},e.ctx,
"assinatura.verificacao"),a.json({ok:!0,refreshed:!!t})}));function vn(){let e=Ea();e.disable("x-powered-by"),e.set("trust proxy",1),e.use(ds());let a=(P.CORS_ORIGINS||"http://localhost:5173").split(",").map(o=>o.trim()).filter(Boolean),t=o=>!o||
a.includes(o)||a.includes("*")&&/^https:\/\//.test(o);e.use(ms({origin:(o,s)=>s(null,t(o)),credentials:!1,allowedHeaders:["content-type","authorization","x-terminal-id"]})),e.use(Ea.
json({limit:"1mb",verify:(o,s,i)=>{o.rawBody=i.toString("utf8")}})),e.get("/api/health",(o,s)=>s.json({ok:!0,service:"rusten-api"})),e.use("/api/auth",pe),e.use("/api/platform/v1",
re),e.use("/api/cron",$n),e.use("/api/access",Ie),e.use("/api/public",je);let n=[Ne(),ae()];return e.use("/api/admin",...n,H),e.use("/api/home",...n,Nt),e.use("/api/menu",...n,ae("\
cardapio"),de),e.use("/api/floor",...n,$e),e.use("/api/pdv",...n,ae("pdv"),F),e.use("/api/cash",...n,ae("pdv"),qe),e.use("/api/customers",...n,ae("clientes"),X),e.use("/api/kitchen",
...n,ae("cozinha"),ye),e.use("/api/stock",...n,ae("estoque"),V),e.use("/api/reports",...n,ae("relatorios"),qt),e.use("/api/delivery",...n,ae("delivery"),ve),e.use("/api/marketing",
...n,ae("marketing"),se),e.use("/api/agent",...n,ae("agente"),xe),e.use("/api/reservations",...n,ae("salao"),lt),e.use("/api",(o,s,i)=>i(new E(404,"Rota n\xE3o encontrada","not_fou\
nd"))),e.use((o,s,i,r)=>{if(o instanceof E)return i.status(o.status).json({error:o.message,code:o.code,...o.extra||{}});if(o?.type==="entity.parse.failed")return i.status(400).json(
{error:"JSON inv\xE1lido",code:"invalid"});if(o?.type==="entity.too.large")return i.status(413).json({error:"Requisi\xE7\xE3o muito grande",code:"too_large"});if(o?.code==="22P02"||
o?.code==="22003")return i.status(400).json({error:"Valor inv\xE1lido",code:"invalid"});if(o?.code==="23503")return i.status(400).json({error:"Refer\xEAncia inv\xE1lida",code:"inva\
lid_reference"});console.error(JSON.stringify({level:"error",msg:o?.message,path:s.path,method:s.method,code:o?.code})),i.status(500).json({error:"Erro interno. Tente novamente.",code:"\
internal"})}),e}var ps=!P.EDGE_RUNTIME&&process.argv[1]&&ls(import.meta.url)===us.resolve(process.argv[1]);if(ps){let e=Number(P.PORT||3001);await st(),vn().listen(e,()=>console.log(
`RUSTEN API na porta ${e}`)),setInterval(()=>Ge().catch(()=>{}),6e4).unref()}var xn=null,kn=_s();kn.use(async(e,a,t)=>{try{xn??=st({log:n=>console.log(`[migrate] ${n}`)}).catch(n=>{throw xn=null,n}),await xn,t()}catch(n){console.error("[boot]",n.message),a.
status(503).json({error:"Servi\xE7o iniciando. Tente novamente em instantes."})}});kn.use(P.PATH_PREFIX,vn());kn.listen(8e3);
