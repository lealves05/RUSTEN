// RUSTEN API — gerado por scripts/build-edge.mjs. Não editar à mão.
var fi=Object.defineProperty;var wi=(e,a,t)=>()=>{if(t)throw t[0];try{return e&&(a=e(e=0)),a}catch(n){throw t=[n],n}};var hi=(e,a)=>{for(var t in a)fi(e,t,{get:a[t],enumerable:!0})};var Pa={};hi(Pa,{MIGRATIONS:()=>Ni});var Ni,Da=wi(()=>{Ni=[{name:"001_base_pdv.sql",sql:`-- RUSTEN \u2014 001: base multiempresa, perfis, card\xE1pio, comandas/sess\xF5es, mesas, PDV, caixa, \
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
`}]});globalThis.__RUSTEN_ENV_DEFAULTS__={EDGE_RUNTIME:"1",NODE_ENV:"production",DB_SCHEMA:"rusten",DB_POOL_MAX:"3",PATH_PREFIX:"/rusten-api",CORS_ORIGINS:"https://rusten.lorler.com.br,h\
ttps://rusten.vercel.app"};import Sr from"npm:express@5.2.1";import ua from"npm:express@5.2.1";import xr from"npm:helmet@8.3.0";import kr from"npm:cors@2.8.6";import Ir from"node:path";import{fileURLToPath as jr}from"node:url";import Rt from"npm:pg@8.23.1";import xn from"node:crypto";import{Buffer as fa}from"node:buffer";var gi=globalThis.__RUSTEN_ENV_DEFAULTS__||{},O=new Proxy({},{get:(e,a)=>{let t=typeof process<"u"?process.env[a]:void 0;return t!==void 0&&t!==""?t:gi[a]}});Rt.types.setTypeParser(20,e=>Number(e));Rt.types.setTypeParser(1700,e=>Number(e));Rt.types.setTypeParser(1082,e=>e);var bi=e=>/localhost|127\.0\.0\.1|\/tmp/.test(e||""),$n=O.DATABASE_URL||
O.SUPABASE_DB_URL,ct=new Rt.Pool({connectionString:$n,ssl:$n&&!bi($n)?{rejectUnauthorized:!1}:void 0,max:Number(O.DB_POOL_MAX||10)}),vn=O.DB_SCHEMA;if(vn){if(!/^[a-z_][a-z0-9_]*$/.
test(vn))throw new Error("DB_SCHEMA inv\xE1lido");ct.on("connect",e=>{e.query(`set search_path to ${vn}, public`).catch(()=>{})})}var d=(e,a)=>ct.query(e,a);async function x(e){let a=await ct.
connect();try{await a.query("begin");let t=await e(a);return await a.query("commit"),t}catch(t){throw await a.query("rollback").catch(()=>{}),t}finally{a.release()}}var z=class extends Error{constructor(a,t,n,o){
super(t),this.status=a,this.code=n,this.extra=o}},f=(e,a="invalid")=>new z(400,e,a),F=(e="Sem permiss\xE3o para esta a\xE7\xE3o",a="forbidden")=>new z(403,e,a),v=(e="N\xE3o encontrado")=>new z(
404,e,"not_found"),g=(e,a="conflict",t)=>new z(409,e,a,t);function w(e,a){let t=e.safeParse(a??{});if(!t.success){let n=t.error.issues[0];throw f(`${n.path.join(".")||"dados"}: ${n.
message}`)}return t.data}var l=e=>(a,t,n)=>Promise.resolve(e(a,t,n)).catch(n);function kt(e,a,t=0,n=0){let o=Math.round(Number(a)*1e3),i=Math.round((e+t)*o/1e3);return Math.max(0,i-
n)}function wa(e,a){let t=Math.floor(e/a),n=e-t*a;return Array.from({length:a},(o,i)=>t+(i<n?1:0))}function pe(e,a="America/Sao_Paulo",t=5){let n=new Intl.DateTimeFormat("en-CA",{timeZone:a,
year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(e),o=s=>n.find(r=>r.type===s).value,i=new Date(Date.UTC(+o("year"),+o("month")-1,+o("day")));
return+o("hour")<t&&(i=new Date(i.getTime()-864e5)),i.toISOString().slice(0,10)}var he=e=>xn.createHash("sha256").update(String(e)).digest("hex"),se=(e=32)=>xn.randomBytes(e).toString(
"base64url");function kn(e,a){let t=fa.from(String(e)),n=fa.from(String(a));return t.length===n.length&&xn.timingSafeEqual(t,n)}function dt(e){let a=e==null?"":String(e);return/^[=+\-@\t\r]/.
test(a)&&(a=`'${a}`),/[";\n]/.test(a)?`"${a.replace(/"/g,'""')}"`:a}import xi from"node:crypto";import{Buffer as qa}from"node:buffer";import Ca from"npm:jsonwebtoken@9.0.3";var Ze={"pdv.lancar":"Lan\xE7ar itens","pdv.lancamento_manual":"Lan\xE7amento manual (busca, cat\xE1logo, c\xF3digo digitado)","pdv.alterar_modo":"Trocar modo de leitura no PDV","p\
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
gerenciar":"Configurar o agente de atendimento","agente.atender":"Atender conversas da caixa de entrada"},ga=Object.keys(Ze),ha=(...e)=>ga.filter(a=>!e.includes(a)),In=[{key:"owner",
name:"Propriet\xE1rio",level:100,permissions:ga},{key:"admin",name:"Administrador",level:90,permissions:ha("assinatura.gerenciar")},{key:"gerente",name:"Gerente",level:70,permissions:ha(
"assinatura.gerenciar","usuarios.gerenciar","configuracoes.gerenciar")},{key:"caixa",name:"Caixa",level:40,permissions:["pdv.lancar","pdv.lancamento_manual","pdv.abrir_comanda","pd\
v.receber","caixa.abrir","caixa.fechar","caixa.sangria","caixa.suprimento","salao.visualizar","cardapio.visualizar","clientes.visualizar","clientes.gerenciar"]},{key:"garcom",name:"\
Gar\xE7om",level:30,permissions:["pdv.lancar","pdv.lancamento_manual","pdv.abrir_comanda","salao.visualizar","cardapio.visualizar","clientes.visualizar","clientes.gerenciar"]},{key:"\
cozinha",name:"Cozinha",level:20,permissions:["cardapio.visualizar","cozinha.operar"]},{key:"bar",name:"Bar",level:20,permissions:["cardapio.visualizar","pdv.lancar","cozinha.opera\
r"]},{key:"estoque",name:"Estoque",level:30,permissions:["estoque.ajustar","estoque.visualizar","compras.gerenciar","cardapio.visualizar","relatorios.cmv"]},{key:"financeiro",name:"\
Financeiro",level:50,permissions:["financeiro.visualizar","financeiro.estornar","relatorios.visualizar","relatorios.cmv","caixa.reabrir","auditoria.visualizar","estoque.visualizar",
"clientes.visualizar"]},{key:"entregador",name:"Entregador",level:10,permissions:["delivery.entregar"]},{key:"consulta",name:"Consulta",level:5,permissions:["salao.visualizar","car\
dapio.visualizar","relatorios.visualizar"]}],mt={pdv:"PDV e comandas",salao:"Sal\xE3o, mesas e reservas",cozinha:"Cozinha, bar e KDS",delivery:"Delivery e card\xE1pio digital",cardapio:"\
Card\xE1pio",estoque:"Estoque, compras e fichas t\xE9cnicas",clientes:"Clientes e fidelidade",financeiro:"Caixa e financeiro",relatorios:"Relat\xF3rios",marketing:"Marketing",agente:"\
Agente WhatsApp",fiscal:"Fiscal",infinitepay:"Importa\xE7\xE3o e concilia\xE7\xE3o InfinitePay"},Mt={scanner_enabled:!0,mode:"manual",double_read_mandatory:!1,allow_manual:!0,allow_manual_exception:!0,
exception_requires_manager:!0,allow_mode_change:!0,product_timeout_s:15,open_free_card_on_scan:!1,feedback_sound:!0,qty_per_scan:1,max_qty_per_scan:20,terminator:"Enter",kitchen_send:"\
imediato",require_open_cash:!0,service_fee_bp:1e3,card_prefix:"CMD-"};import va from"node:crypto";import{Buffer as ba}from"node:buffer";var Nn="rusten",xa=1,ka="2026.10",$i=300,vi=300*1e3,$a=0,jn={at:0,v:null};async function je(){if(Date.now()-jn.at<6e4)return jn.v;let e=O.PLATFORM_HUB_URL||"",a=O.PLATFORM_SECRET||
"",t=O.PLATFORM_PRODUCT||"";if(!e||!a)try{let{rows:o}=await d("select key, value from platform_config where key in ('platform_hub_url','platform_secret','platform_product')"),i=Object.
fromEntries(o.map(s=>[s.key,s.value]));e||=i.platform_hub_url||"",a||=i.platform_secret||"",t||=i.platform_product||""}catch{}let n=e&&a?{hub:e.replace(/\/+$/,""),secret:a,product:t||
Nn}:null;return jn={at:Date.now(),v:n},n}var Ia=(e,a,t,n,o)=>va.createHmac("sha256",e).update(`${a}
${String(t).toUpperCase()}
${n}
${he(o||"")}`).digest("hex");async function ge(e,a,t,n=1e4){let o=await je();if(!o)throw new z(503,"A assinatura ainda n\xE3o est\xE1 configurada nesta instala\xE7\xE3o. Fale com o suporte.",
"platform_not_configured");if(!/^https:\/\//.test(o.hub)&&O.NODE_ENV==="production")throw new z(503,"Endere\xE7o da central deve usar HTTPS","platform_not_configured");let i=t===void 0?
"":JSON.stringify(t),s=Math.floor(Date.now()/1e3),r;try{r=await fetch(`${o.hub}/api/hub/v1${a}`,{method:e,signal:AbortSignal.timeout(n),headers:{"Content-Type":"application/json","\
X-Platform-Product":o.product,"X-Platform-Timestamp":String(s),"X-Platform-Signature":Ia(o.secret,s,e,a,i)},body:i||void 0})}catch{throw new z(503,"A central de assinaturas n\xE3o res\
pondeu. Tente novamente em instantes.","platform_unavailable")}let c=await r.json().catch(()=>({}));if(!r.ok)throw new z(r.status===401?502:r.status,c?.error||`Central: erro ${r.status}`,
c?.code||"hub_error");return c}async function Lt(e){let{rows:a}=await d(`select c.id, c.name, c.email, c.phone, c.document, c.created_at, c.is_demo,
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
consumptions_30d,revenue_30d:Number(t.revenue_30d_cents)/100}}:null}async function It(e,a){await d("update companies set access = $2, access_updated_at = now() where id = $1",[e,a||
{}])}async function Ft(e,a=1e4){if(!await je())return null;let t=await Lt(e);if(!t||t.is_demo)return null;let{is_demo:n,owner_email:o,...i}=t,s=await ge("POST","/tenants",i,a);return s?.
access&&await It(e,s.access),s?.access||null}async function ut(e,{fresh:a=!1}={}){if(!e||e.is_demo||!await je())return null;let n=e.access_updated_at?Date.now()-new Date(e.access_updated_at).
getTime():1/0,o=e.access&&Object.keys(e.access).length;if(!a&&o&&n<vi)return e.access;if(!a&&Date.now()<$a)return o?e.access:null;try{let i=await ge("GET",`/tenants/${encodeURIComponent(
e.id)}/access`,void 0,4e3);return await It(e.id,i.access),i.access}catch(i){if(i.status===404)try{return await Ft(e.id,4e3)}catch{}else $a=Date.now()+6e4;return o?e.access:null}}async function jt(e,a,t,n={}){
await je()&&await e.query("insert into platform_outbox (company_id, kind, payload) values ($1,$2,$3)",[a,t,n])}async function lt(e=20){if(!await je())return{sent:0,failed:0};let{rows:a}=await d(
"select * from platform_outbox where sent_at is null and attempts < 20 order by id limit $1",[e]),t=0,n=0;for(let o of a)try{(o.kind==="tenant.created"||o.kind==="tenant.updated")&&
await Ft(o.company_id),await d("update platform_outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = $1",[o.id]),t++}catch(i){await d("update platform_\
outbox set attempts = attempts + 1, last_error = $2 where id = $1",[o.id,String(i.message).slice(0,300)]),n++}return{sent:t,failed:n}}async function ja(e,a,t){try{let n=await je(),
o=()=>new z(401,"Chamada da central n\xE3o autenticada.","bad_signature");if(!n)throw new z(503,"Liga\xE7\xE3o com a central n\xE3o configurada.","platform_not_configured");let i=Number(
e.headers["x-platform-timestamp"]),s=String(e.headers["x-platform-signature"]||"");if(String(e.headers["x-platform-product"]||"")!==n.product||!Number.isFinite(i)||!/^[0-9a-f]{64}$/.
test(s)||Math.abs(Date.now()/1e3-i)>$i)throw o();let r=Ia(n.secret,i,e.method,e.url,e.rawBody||"");if(!va.timingSafeEqual(ba.from(r),ba.from(s)))throw o();if(!(await d("insert into\
 platform_nonces (nonce) values ($1) on conflict do nothing returning nonce",[s])).rows[0])throw new z(401,"Chamada repetida.","replay");await d("delete from platform_nonces where \
created_at < now() - interval '1 day'"),t()}catch(n){t(n)}}var Na=mt;var Ea=O.NODE_ENV==="production",Ut=O.JWT_SECRET||O.SUPABASE_SERVICE_ROLE_KEY||(Ea?null:"dev-only-rusten-secret-not-for-production");if(!Ut)throw new Error("JWT_SECRET \xE9 obrigat\xF3ri\
o em produ\xE7\xE3o");function Sa(e){return e?["changeme","secret","jwt_secret","dev-only-rusten-secret-not-for-production"].includes(e)?"valor de exemplo":qa.byteLength(e,"utf8")<
32?"curta (m\xEDnimo de 32 bytes aleat\xF3rios)":new Set(e).size<10?"pouca varia\xE7\xE3o de caracteres":null:"ausente"}if(Ea&&Sa(Ut))throw new Error(`JWT_SECRET inseguro (${Sa(Ut)}\
) \u2014 o servidor n\xE3o inicia em produ\xE7\xE3o.`);var Nt=e=>qa.from(xi.hkdfSync("sha256",Ut,"rusten",e,32)),Aa=Nt("access-token"),ki=Number(O.ACCESS_TTL_S)||900,Bt=30;function qn(e,a){
return Ca.sign({sub:String(e.id),cid:String(e.company_id),sid:a},Aa,{expiresIn:ki,algorithm:"HS256"})}async function Oa(e,a){let{rows:t}=await d(`select u.id, u.company_id, u.unit_\
id, u.name, u.email, u.role_key, u.active, u.password_changed_at,
            r.name as role_name, r.level, r.permissions,
            c.name as company_name, c.segment, c.timezone, c.settings, c.access, c.access_updated_at, c.is_demo
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
       join companies c on c.id = u.company_id
      where u.id = $1 and u.company_id = $2`,[e,a]);return t[0]}function Le(){return async(e,a,t)=>{try{let n=e.headers.authorization||"",o=n.startsWith("Bearer ")?n.slice(7):null;
if(!o)throw new z(401,"Sess\xE3o expirada. Entre novamente.","unauthenticated");let i;try{i=Ca.verify(o,Aa,{algorithms:["HS256"]})}catch{throw new z(401,"Sess\xE3o expirada. Entre nov\
amente.","unauthenticated")}let s=await Oa(Number(i.sub),Number(i.cid));if(!s||!s.active)throw new z(401,"Usu\xE1rio inativo","unauthenticated");let r=await d("select revoked_at fr\
om user_sessions where id = $1 and user_id = $2",[i.sid,s.id]);if(!r.rows[0]||r.rows[0].revoked_at)throw new z(401,"Sess\xE3o encerrada","unauthenticated");if(i.iat*1e3<new Date(s.
password_changed_at).getTime()-1e3)throw new z(401,"Senha alterada. Entre novamente.","unauthenticated");let c=await ut({id:s.company_id,is_demo:s.is_demo,access:s.access,access_updated_at:s.
access_updated_at}),u={userId:s.id,companyId:s.company_id,unitId:s.unit_id,name:s.name,email:s.email,role:s.role_key,roleName:s.role_name,level:s.level,perms:new Set(s.permissions),
company:{id:s.company_id,name:s.company_name,segment:s.segment,timezone:s.timezone,settings:s.settings,is_demo:s.is_demo},access:s.is_demo?zn(null,null,{demo:!0}):zn(c??s.access,s.
access_updated_at),sessionId:i.sid,terminalId:null},m=Number(e.headers["x-terminal-id"]);if(m){let p=await d("select id, unit_id from terminals where id = $1 and company_id = $2 an\
d active",[m,u.companyId]);p.rows[0]&&(u.terminalId=p.rows[0].id,u.terminalUnitId=p.rows[0].unit_id)}u.can=p=>u.perms.has(p),e.ctx=u,t()}catch(n){t(n)}}}var y=(...e)=>(a,t,n)=>{let o=e.
find(i=>!a.ctx.can(i));if(o)return n(F(`Sem permiss\xE3o: ${o}`));n()};function V(e,a){if(!e.can(a))throw F(`Sem permiss\xE3o: ${a}`)}async function h(e,a,t,{entity:n,entityId:o,reason:i,
data:s,unitId:r}={}){await e.query(`insert into audit_events (company_id, unit_id, terminal_id, user_id, action, entity, entity_id, reason, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[a.companyId,r??a.terminalUnitId??a.unitId??null,a.terminalId??null,a.userId??null,t,n??null,o!=null?String(o):null,i??null,Sn(s??{})])}var Ii=/pass|senha|token|secret|segredo|hash|card_number|cvv/i;
function Sn(e){return Array.isArray(e)?e.map(Sn):e&&typeof e=="object"?Object.fromEntries(Object.entries(e).map(([a,t])=>[a,Ii.test(a)?"[omitido]":Sn(t)])):e}var ji={ACTIVE:"Ativa",
TRIAL:"Em teste",PAYMENT_PENDING:"Aguardando pagamento",PAST_DUE:"Pagamento pendente",SUSPENDED:"Suspensa",CANCELED:"Cancelada",EXPIRED:"Expirada"},za={ADMINISTRATIVO:"O acesso des\
ta empresa foi bloqueado pela administra\xE7\xE3o da plataforma. Fale com o suporte.",TRIAL_EXPIRADO:"O per\xEDodo de teste terminou. Contrate um plano para continuar operando \u2014 seus \
dados est\xE3o preservados.",CANCELAMENTO:"A assinatura foi encerrada. Contrate novamente para voltar a operar \u2014 seus dados est\xE3o preservados.",FINANCEIRO:"Acesso suspenso \
por pend\xEAncia financeira. Regularize a assinatura \u2014 seus dados est\xE3o preservados."};function zn(e,a,{demo:t=!1}={}){let n=e||{},o=Object.keys(mt);if(t)return{allowed:!0,
state:"DEMO",label:"Demonstra\xE7\xE3o",modules:o,warning:null,notices:[],managed:!1,demo:!0};if(!Object.keys(n).length||typeof n.blocked!="boolean")return{allowed:!0,state:"sem_ce\
ntral",label:"Sem central",modules:o,warning:null,notices:[],managed:!1};let i=n.features&&typeof n.features=="object"?n.features:{},r=o.filter(m=>m in i).length?o.filter(m=>i[m]!==
!1):o,c=Array.isArray(n.notices)?n.notices.filter(m=>m&&m.text).map(m=>({level:m.level==="danger"?"danger":"warn",text:String(m.text)})):[],u=!!n.admin_blocked||n.reason==="ADMINIS\
TRATIVO";return{allowed:!n.blocked,state:n.status,label:ji[n.status]||n.status,reasonCode:n.reason||null,reason:n.blocked?za[u?"ADMINISTRATIVO":n.reason]||za.FINANCEIRO:null,adminBlocked:u,
modules:r,notices:c,warning:c[0]?.text||null,plan:n.plan?.name||null,planId:n.plan?.id||null,cycle:n.cycle||null,validUntil:n.valid_until||null,trial:n.trial||null,support:n.support||
null,supportChannel:n.support_channel||null,managed:!0,updatedAt:a}}var re=e=>(a,t,n)=>{let o=a.ctx.access;if(!o.allowed)return n(new z(402,o.reason,"access_blocked",{state:o.state}));
if(e&&!o.modules.includes(e))return n(F("M\xF3dulo n\xE3o inclu\xEDdo no plano","module_disabled"));n()};async function X(e,a,t){let{rows:n}=await d(`insert into rate_limits(key, c\
ount, reset_at) values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update set
       count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => $2) else rate_limits.reset_at end
     returning count`,[e,t]);if(n[0].count>a)throw new z(429,"Muitas tentativas. Aguarde alguns minutos.","rate_limited")}import Ta from"node:fs";import Vt from"node:path";import{fileURLToPath as Ma}from"node:url";var Ra=import.meta.url.startsWith("file:")?Vt.join(Vt.dirname(Ma(import.meta.url)),"migrations"):"migrations";async function St({log:e=console.log}={}){let a=await ct.connect();try{
await a.query("select pg_advisory_lock(424242)"),await a.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);let t=new Set((await a.query("select name from schema_migrations")).rows.map(o=>o.name)),n=O.EDGE_RUNTIME?
(await Promise.resolve().then(()=>(Da(),Pa))).MIGRATIONS:Ta.readdirSync(Ra).filter(o=>/^\d+_.+\.sql$/.test(o)).sort().map(o=>({name:o,sql:null}));for(let{name:o,sql:i}of n){if(t.has(
o))continue;let s=i??Ta.readFileSync(Vt.join(Ra,o),"utf8");await a.query("begin");try{await a.query(s),await a.query("insert into schema_migrations(name) values ($1)",[o]),await a.
query("commit"),e(`migra\xE7\xE3o aplicada: ${o}`)}catch(r){throw await a.query("rollback"),new Error(`falha na migra\xE7\xE3o ${o}: ${r.message}`)}}}finally{await a.query("select \
pg_advisory_unlock(424242)").catch(()=>{}),a.release()}}!O.EDGE_RUNTIME&&process.argv[1]&&Ma(import.meta.url)===Vt.resolve(process.argv[1])&&St().then(()=>ct.end()).catch(e=>{console.
error(e.message),process.exit(1)});import{Router as Fi}from"npm:express@5.2.1";import We from"npm:bcryptjs@3.0.3";import Ui from"node:crypto";import{z as E}from"npm:zod@4.6.5";var Si=["scanner_enabled","allow_manual","allow_manual_exception","allow_mode_change","open_free_card_on_scan"],zi=["double_read_mandatory","exception_requires_manager","require_op\
en_cash"],qi=["max_qty_per_scan"];function Cn(e={},a={},t={}){let n=[Mt,e||{},a||{},t||{}],o={...Mt};for(let i of n.slice(1))for(let[s,r]of Object.entries(i))!(s in Mt)||r===void 0||
r===null||(Si.includes(s)?o[s]=o[s]&&!!r:zi.includes(s)?o[s]=o[s]||!!r:qi.includes(s)?o[s]=Math.min(o[s],Number(r)):o[s]=r);return o.double_read_mandatory&&(o.mode="dupla"),o.scanner_enabled||
(o.mode="manual"),!o.scanner_enabled&&!o.allow_manual&&(o.allow_manual=!0),o.qty_per_scan=Math.min(Math.max(1,Number(o.qty_per_scan)||1),o.max_qty_per_scan),o}function pt(e){if(e.scanner_enabled===
!1&&e.allow_manual===!1)throw f("Configura\xE7\xE3o eliminaria todos os meios de lan\xE7amento: mantenha o leitor ou o lan\xE7amento manual.");if(e.mode&&!["manual","continua","dup\
la"].includes(e.mode))throw f("Modo inv\xE1lido");if(e.double_read_mandatory&&e.scanner_enabled===!1)throw f("Dupla leitura obrigat\xF3ria exige o leitor habilitado.");if(e.product_timeout_s!=
null&&(e.product_timeout_s<3||e.product_timeout_s>120))throw f("Tempo de espera do produto deve ficar entre 3 e 120 segundos")}async function Fe(e,a,t){let n=await e.query("select \
settings from companies where id = $1",[a.companyId]),o=t?await e.query("select settings from units where id = $1 and company_id = $2",[t,a.companyId]):{rows:[]},i=a.terminalId?await e.
query("select settings from terminals where id = $1",[a.terminalId]):{rows:[]};return Cn(n.rows[0]?.settings?.pdv,o.rows[0]?.settings?.pdv,i.rows[0]?.settings?.pdv)}var _t=e=>String(
e??"").replace(/[\r\n\t]/g,"").trim();async function zt(e,a,t){let n=_t(t);if(!n)return{type:"DESCONHECIDO",code:n};if(n.length>128)return{type:"DESCONHECIDO",code:n.slice(0,128)};
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
DO",code:n}}return{type:i,code:n,id:s}}async function Qe(e,a,t,n,o){let i=_t(t);if(!i)throw f("C\xF3digo vazio");if(i.length>128)throw f("C\xF3digo muito longo");let s=await e.query(
"select entity, entity_id from scan_codes where company_id = $1 and code = $2",[a,i]);if(s.rows[0]){if(s.rows[0].entity===n&&Number(s.rows[0].entity_id)===Number(o))return;throw g(
`C\xF3digo ${i} j\xE1 est\xE1 em uso (${s.rows[0].entity.toLowerCase()} ${s.rows[0].entity_id}). Cadastros amb\xEDguos n\xE3o s\xE3o permitidos.`,"code_in_use")}await e.query("inse\
rt into scan_codes (company_id, code, entity, entity_id) values ($1,$2,$3,$4)",[a,i,n,o])}var La=(e,a,t)=>`${e}${a>1?`${a}-`:""}${String(t).padStart(6,"0")}`;async function Q(e,a,t){
let{rows:n}=await e.query("select * from consumption_sessions where id = $1 and company_id = $2 for update",[t,a]);if(!n[0])throw v("Consumo n\xE3o encontrado");return n[0]}function et(e){
if(e.status!=="aberta")throw g(`Consumo ${{em_fechamento:"em fechamento",encerrada:"encerrada",cancelada:"cancelada"}[e.status]||e.status}: n\xE3o aceita lan\xE7amentos`,"session_n\
ot_open")}function be(e,a){if(e.unitId&&Number(e.unitId)!==Number(a)&&e.level<90)throw F("Registro de outra unidade")}async function U(e,a){let t=await e.query("select service_fee_\
bp, delivery_fee_cents from consumption_sessions where id = $1",[a]),n=await e.query("select coalesce(sum(total_cents) filter (where status = 'ativo'), 0)::bigint as items from ord\
er_items where session_id = $1",[a]),o=await e.query("select coalesce(sum(amount_cents) filter (where status = 'confirmado'), 0)::bigint as paid from payments where session_id = $1",
[a]),i=Number(n.rows[0].items),s=Math.round(i*(t.rows[0]?.service_fee_bp||0)/1e4),r=Number(t.rows[0]?.delivery_fee_cents||0),c=i+s+r,u=Number(o.rows[0].paid);return{items:i,serviceFee:s,
serviceFeeBp:t.rows[0]?.service_fee_bp||0,deliveryFee:r,total:c,paid:u,balance:c-u}}async function En(e,a,t={}){let o=(await e.query("insert into units (company_id, name, day_cutoff) values ($1,$2,$3) returning id",[a,t.unit_name||"Matriz",t.day_cutoff??5])).rows[0].
id;await e.query("insert into terminals (company_id, unit_id, name) values ($1,$2,$3)",[a,o,"Caixa 1"]);let i={};for(let s of["Cozinha","Bar","Copa"]){let r=await e.query("insert i\
nto production_sectors (company_id, name) values ($1,$2) returning id",[a,s]);i[s]=r.rows[0].id}return await An(e,a,o,1,t.tables??10),await On(e,a,o,1,t.cards??50),t.demo&&await Ei(
e,a,i),{unitId:o,sectors:i}}async function An(e,a,t,n,o){let i=[];for(let s=n;s<n+o;s++){let r=await e.query(`insert into dining_tables (company_id, unit_id, number, pos_x, pos_y) \
values ($1,$2,$3,$4,$5)
       on conflict do nothing returning id`,[a,t,s,(s-1)%6,Math.floor((s-1)/6)]);r.rows[0]&&(await Qe(e,a,`MESA-${String(t).padStart(2,"0")}-${String(s).padStart(3,"0")}`,"MESA",r.
rows[0].id),i.push(r.rows[0].id))}return i}async function On(e,a,t,n,o,i="CMD-"){let s=(await e.query("select count(*)::int as n from units where company_id = $1 and id <= $2",[a,t])).
rows[0].n,r=[];for(let c=n;c<n+o;c++){let u=await e.query("insert into tab_cards (company_id, unit_id, number) values ($1,$2,$3) on conflict do nothing returning id, number",[a,t,c]);
if(u.rows[0]){let m=La(i,s,c);await Qe(e,a,m,"COMANDA",u.rows[0].id),r.push({...u.rows[0],code:m})}}return r}var Ci=[["Cervejas","Bar",[["Cerveja IPA 600 ml",2890,"7890000000011"],
["Pilsen long neck",1290,"7890000000028"],["Chope 300 ml",1190,null]]],["Drinks","Bar",[["Caipirinha",2400,null],["Gin t\xF4nica",3200,null]]],["Lanches","Cozinha",[["Hamb\xFArguer da\
 oficina",3890,null],["Por\xE7\xE3o de fritas",2690,null]]],["Sem \xE1lcool","Bar",[["Refrigerante lata",700,"7890000000035"],["\xC1gua mineral",500,"7890000000042"]]]];async function Ei(e,a,t){
let n=0;for(let[o,i,s]of Ci){let r=await e.query("insert into categories (company_id, name, sort, demo) values ($1,$2,$3,true) returning id",[a,`${o} (demonstra\xE7\xE3o)`,n++]);for(let[
c,u,m]of s){let p=await e.query(`insert into products (company_id, category_id, sector_id, name, price_cents, kind, demo, favorite, channels)
         values ($1,$2,$3,$4,$5,$6,true,$7,'{pdv,delivery,cardapio_digital}') returning id`,[a,r.rows[0].id,t[i],c,u,i==="Cozinha"?"recipe":"resale",n===1]);if(m&&await Qe(e,a,m,"P\
RODUTO",p.rows[0].id),c.startsWith("Hamb\xFArguer")){let _=await e.query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Ponto da\
 carne',1,1) returning id",[a,p.rows[0].id]);for(let k of["Mal passado","Ao ponto","Bem passado"])await e.query("insert into modifier_options (company_id, group_id, name) values ($\
1,$2,$3)",[a,_.rows[0].id,k]);let $=await e.query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Adicionais',0,3) returning id",
[a,p.rows[0].id]);for(let[k,j]of[["Bacon",600],["Queijo extra",400],["Ovo",300]])await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2\
,$3,$4)",[a,$.rows[0].id,k,j])}}}}async function Fa(e,a,t,n,o){let i=Object.fromEntries((await e.query("select id, name, price_cents, sector_id from products where company_id = $1",
[a])).rows.map(k=>[k.name,k])),s=(await e.query("select id from dining_tables where company_id = $1 and number = 3",[a])).rows[0],r=(await e.query("select id from tab_cards where c\
ompany_id = $1 order by number limit 3",[a])).rows,c=0,u=4,m=()=>(u=u===4?9:u===9?18:4,u);async function p(k,{tableId:j=null,cardId:C=null,label:R=null},S,A="aberta"){let J=(await e.
query(`insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, label, status, service_fee_bp, opened_by, business_date,
                                         opened_at, closed_at, closed_by)
       values ($1,$2,$3,$4,$5,$6,$7,1000,$8,$9, now() - interval '90 minutes', case when $7 = 'encerrada' then now() - interval '20 minutes' end,
               case when $7 = 'encerrada' then $8::bigint end) returning id`,[a,t,k,C,j,R,A,n,o])).rows[0].id,K=0;for(let[B,ae,De]of S){let Ne=i[B];if(!Ne)continue;let Tt=Ne.price_cents*
ae;K+=Tt,await e.query(`insert into order_items (company_id, session_id, product_id, description, qty, unit_price_cents, total_cents, sector_id,
                                  kitchen_status, launch_mode, user_id, idempotency_key, created_at, sent_at, accepted_at, ready_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11, now() - interval '${m()} minutes',
                 case when $9 <> 'nao_produz' then now() - interval '${m()} minutes' end,
                 case when $9 in ('aceito','preparando','pronto','entregue') then now() - interval '8 minutes' end,
                 case when $9 in ('pronto','entregue') then now() - interval '3 minutes' end)`,[a,J,Ne.id,Ne.name,ae,Ne.price_cents,Tt,Ne.sector_id,De,n,`demo-${J}-${++c}`])}return{
id:J,total:K}}s&&(await p("mesa",{tableId:s.id,label:"Mesa 3"},[["Hamb\xFArguer da oficina",2,"preparando"],["Por\xE7\xE3o de fritas",1,"pronto"],["Chope 300 ml",4,"entregue"]]),await e.
query("update dining_tables set status = 'ocupada' where id = $1",[s.id])),r[0]&&await p("comanda",{cardId:r[0].id},[["Cerveja IPA 600 ml",2,"nao_produz"],["Caipirinha",1,"novo"]]),
r[1]&&await p("comanda",{cardId:r[1].id},[["Gin t\xF4nica",2,"entregue"],["\xC1gua mineral",1,"nao_produz"]]);let _=await p("balcao",{label:"Balc\xE3o"},[["Pilsen long neck",3,"nao\
_produz"],["Por\xE7\xE3o de fritas",1,"entregue"]],"encerrada"),$=_.total+Math.round(_.total*.1);await e.query(`insert into payments (company_id, session_id, method, amount_cents, \
business_date, idempotency_key, user_id, created_at)
     values ($1,$2,'pix',$3,$4,$5,$6, now() - interval '20 minutes')`,[a,_.id,$,o,`demo-pay-${_.id}`,n]),await Ai(e,a,t,n,_.id)}async function Ai(e,a,t,n,o){let i={loyalty:{enabled:!0,
cents_per_point:100,point_value_cents:5,validity_days:365,min_redeem:100},delivery:{enabled:!0,accepting:!0,delivery:!0,pickup:!0,fee_cents:700,min_order_cents:3e3,eta_minutes:40,hours:"\
Ter a dom, 18h \xE0s 0h",areas:"Centro, Vila Nova e Jardim",payment_methods:["dinheiro","pix","cartao"],message:"Chope em dobro at\xE9 as 20h!"},agent:{enabled:!1,name:"R\xFAstica",
greeting:"Ol\xE1! Sou a R\xFAstica, atendente virtual do bar. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* ou fazer uma *reserva*. Para falar com a\
 equipe, digite *atendente*.",handoff_message:"Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA.",closed_message:"No momento n\xE3o estamos recebendo pedidos.",reservation_max_people:12,
reservation_min_hours:2}};await e.query("update companies set slug = $2, settings = settings || $3::jsonb where id = $1",[a,`demo-${a}`,JSON.stringify(i)]);let s=String(new Date().
getMonth()+1).padStart(2,"0"),r={};for(let[p,_,$,k,j,C,R]of[["Ana Souza","52998224725","11988887777","1990-03-12",["vip","chope"],!0,120],["Bruno Lima","39053344705","11977776666",
`1987-${s}-21`,["anivers\xE1rio"],!0,0],["Carla Dias",null,"11966665555","1995-08-02",[],!1,0]]){let S=await e.query(`insert into customers (company_id, cpf, name, phone, birthday,\
 tags, consent_whatsapp, consent_at, created_by)
      values ($1,$2,$3,$4,$5,$6,$7, case when $7 then now() end, $8) returning id`,[a,_,p,$,k,j,C,n]);r[p]=S.rows[0].id,R&&(await e.query("insert into loyalty_ledger (company_id, c\
ustomer_id, kind, points, expires_at, reason, user_id) values ($1,$2,'ganho',$3, current_date + 365, 'Consumos anteriores', $4)",[a,S.rows[0].id,R,n]),await e.query("update custome\
rs set points = $2 where id = $1",[S.rows[0].id,R]))}await e.query("update consumption_sessions set customer_id = $2, customer_name = $3 where id = $1",[o,r["Bruno Lima"],"Bruno Li\
ma"]);let c=(await e.query("select id from consumption_sessions where company_id = $1 and kind = 'mesa' limit 1",[a])).rows[0];c&&await e.query("update consumption_sessions set cus\
tomer_id = $2, customer_name = $3 where id = $1",[c.id,r["Ana Souza"],"Ana Souza"]),await e.query("insert into reviews (company_id, session_id, customer_id, score, comment) values \
($1,$2,$3,5,$4)",[a,o,r["Bruno Lima"],"Chope gelado e atendimento r\xE1pido!"]);let u={};for(let[p,_,$,k,j]of[["Carne mo\xEDda","kg",8,3200,2],["P\xE3o brioche","un",40,150,12],["B\
atata congelada","kg",12,900,4],["Pilsen long neck (garrafa)","un",48,450,24],["Chope (barril)","L",30,1200,10],["Lim\xE3o","kg",1.5,600,3],["Cacha\xE7a","L",4,2500,1]]){let C=await e.
query("insert into stock_items (company_id, name, unit, min_qty, reorder_qty, avg_cost_cents) values ($1,$2,$3,$4,$5,$6) returning id",[a,p,_,j,j*3,k]);u[p]=C.rows[0].id,await e.query(
"insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, reason, user_id) values ($1,$2,'entrada',$3,$4,'saldo_inicial','Saldo inicial',$5)",[
a,C.rows[0].id,$,k,n])}let m=Object.fromEntries((await e.query("select id, name from products where company_id = $1",[a])).rows.map(p=>[p.name,p.id]));for(let[p,_,$]of[["Hamb\xFArguer\
 da oficina",[["Carne mo\xEDda",.18],["P\xE3o brioche",1]],726],["Por\xE7\xE3o de fritas",[["Batata congelada",.4]],360],["Chope 300 ml",[["Chope (barril)",.3]],360],["Caipirinha",
[["Lim\xE3o",.12],["Cacha\xE7a",.06]],222]]){if(!m[p])continue;let k=await e.query("insert into recipes (company_id, product_id, version, yield_qty, created_by) values ($1,$2,1,1,$\
3) returning id",[a,m[p],n]);for(let[j,C]of _)await e.query("insert into recipe_lines (company_id, recipe_id, stock_item_id, qty) values ($1,$2,$3,$4)",[a,k.rows[0].id,u[j],C]);await e.
query("update products set stock_mode = 'ficha', cost_cents = $2 where id = $1",[m[p],$])}m["Pilsen long neck"]&&await e.query("update products set stock_mode = 'acabado', stock_it\
em_id = $2, cost_cents = 450 where id = $1",[m["Pilsen long neck"],u["Pilsen long neck (garrafa)"]]);for(let[p,_,$,k,j,C]of[["Diego Martins","11955554444",6,21,"confirmada","equipe"],
["Fernanda Alves","11944443333",4,22,"pendente","agente"]])await e.query(`insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source)
      values ($1,$2,$3,$4,$5, date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' + make_interval(hours => $6), $7, $8)`,[a,t,p,_,$,k,j,C])}var Ua=[{value:"manual",label:"Manual (toque/busca)"},{value:"continua",label:"Leitura cont\xEDnua"},{value:"dupla",label:"Dupla leitura (comanda \u2192 produto)"}],Oi=["America/Sa\
o_Paulo","America/Manaus","America/Cuiaba","America/Belem","America/Fortaleza","America/Recife","America/Bahia","America/Porto_Velho","America/Rio_Branco","America/Noronha"].map(e=>({
value:e,label:e.replace("America/","").replace("_"," ")})),Pn=[{key:"signup_enabled",label:"Novos cadastros abertos",type:"boolean",group:"Cadastro e demonstra\xE7\xE3o",default:!0,
help:'Desligado, a tela "Criar conta" do RUSTEN fica fechada (empresas existentes seguem normalmente).'},{key:"demo_enabled",label:'Bot\xE3o "Experimentar demonstra\xE7\xE3o" no login',
type:"boolean",group:"Cadastro e demonstra\xE7\xE3o",default:!0},{key:"demo_days",label:"Dias at\xE9 apagar demonstra\xE7\xF5es n\xE3o ativadas",type:"number",group:"Cadastro e dem\
onstra\xE7\xE3o",min:1,max:30,step:1,unit:"dias",default:7},{key:"default_mode",label:"Modo do PDV em empresas novas",type:"select",group:"Padr\xF5es de empresas novas",options:Ua,
default:"manual"},{key:"default_service_fee",label:"Taxa de servi\xE7o padr\xE3o",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:30,step:.5,unit:"%",default:10},{key:"\
default_tables",label:"Mesas criadas no cadastro",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:300,step:1,default:10},{key:"default_cards",label:"Cart\xF5es de comanda\
 criados no cadastro",type:"number",group:"Padr\xF5es de empresas novas",min:0,max:2e3,step:1,default:50},{key:"default_day_cutoff",label:"Virada do dia comercial",type:"number",group:"\
Padr\xF5es de empresas novas",min:0,max:12,step:1,unit:"h",default:5,help:"Vendas antes deste hor\xE1rio contam no dia anterior."},{key:"notice_text",label:"Aviso para todos os usu\
\xE1rios",type:"textarea",group:"Comunica\xE7\xE3o",max:300,default:"",help:"Exibido no topo do RUSTEN para todas as empresas. Deixe vazio para n\xE3o mostrar."},{key:"notice_level",
label:"Tipo do aviso",type:"select",group:"Comunica\xE7\xE3o",default:"info",options:[{value:"info",label:"Informativo"},{value:"warn",label:"Aten\xE7\xE3o"}]}],Ba=[{key:"name",label:"\
Nome da empresa",type:"text",group:"Empresa",max:120},{key:"timezone",label:"Fuso hor\xE1rio",type:"select",group:"Empresa",options:Oi},{key:"pdv_mode",label:"Modo padr\xE3o do PDV",
type:"select",group:"PDV e leitor",options:Ua},{key:"pdv_scanner_enabled",label:"Leitor de c\xF3digo habilitado",type:"boolean",group:"PDV e leitor"},{key:"pdv_double_read_mandator\
y",label:"Dupla leitura obrigat\xF3ria",type:"boolean",group:"PDV e leitor",help:"Exige ler a comanda e depois o produto em cada item; s\xF3 exce\xE7\xE3o autorizada sai dela."},{key:"\
pdv_allow_manual",label:"Permitir lan\xE7amento manual",type:"boolean",group:"PDV e leitor"},{key:"pdv_exception_requires_manager",label:"Exce\xE7\xE3o \xE0 dupla leitura exige gerente",
type:"boolean",group:"PDV e leitor"},{key:"pdv_product_timeout_s",label:"Tempo para ler o produto ap\xF3s a comanda",type:"number",group:"PDV e leitor",min:3,max:120,step:1,unit:"s"},
{key:"pdv_require_open_cash",label:"Exigir caixa aberto para receber",type:"boolean",group:"Caixa e cobran\xE7a"},{key:"pdv_service_fee",label:"Taxa de servi\xE7o",type:"number",group:"\
Caixa e cobran\xE7a",min:0,max:30,step:.5,unit:"%"},{key:"pdv_card_prefix",label:"Prefixo dos cart\xF5es de comanda",type:"text",group:"Caixa e cobran\xE7a",max:8,help:"Letras mai\xFA\
sculas, n\xFAmeros e h\xEDfen."}],Pi=({default:e,...a})=>a,Va=()=>({system:Pn.map(Pi),tenant:Ba});function Di(e,a){if(a!=null)switch(e.type){case"boolean":if(typeof a!="boolean")throw f(
`${e.label}: valor inv\xE1lido`);return a;case"number":{let t=Number(a);if(!Number.isFinite(t)||e.min!=null&&t<e.min||e.max!=null&&t>e.max)throw f(`${e.label}: use um valor entre ${e.
min} e ${e.max}`);return t}case"select":if(!e.options.some(t=>t.value===a))throw f(`${e.label}: op\xE7\xE3o inv\xE1lida`);return a;default:{let t=String(a).trim();if(e.max&&t.length>
e.max)throw f(`${e.label}: m\xE1ximo de ${e.max} caracteres`);return t}}}function Ha(e,a){if(!a||typeof a!="object"||Array.isArray(a))throw f('Envie os par\xE2metros em "values"');
let t={};for(let[n,o]of Object.entries(a)){let i=e.find(r=>r.key===n);if(!i)throw f(`Par\xE2metro desconhecido: ${n}`);let s=Di(i,o);s!==void 0&&(t[n]=s)}return t}var qt={at:0,v:null};
async function Ue(){if(qt.v&&Date.now()-qt.at<3e4)return qt.v;let e=Object.fromEntries(Pn.map(a=>[a.key,a.default]));try{let{rows:a}=await d("select key, value from system_settings");
for(let t of a)t.key in e&&(e[t.key]=t.value)}catch{}return qt={at:Date.now(),v:e},e}async function Ja(e){let a=Ha(Pn,e);for(let[t,n]of Object.entries(a))await d(`insert into syste\
m_settings (key, value, updated_at) values ($1, $2::jsonb, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`,[t,JSON.stringify(n)]);return qt.at=0,Ue()}var Ga={pdv_mode:"mode",pdv_scanner_enabled:"sca\
nner_enabled",pdv_double_read_mandatory:"double_read_mandatory",pdv_allow_manual:"allow_manual",pdv_exception_requires_manager:"exception_requires_manager",pdv_product_timeout_s:"p\
roduct_timeout_s",pdv_require_open_cash:"require_open_cash",pdv_card_prefix:"card_prefix"};async function Dn(e){let{rows:a}=await d("select name, timezone, settings from companies \
where id = $1",[e]),t=a[0];if(!t)return null;let n=t.settings?.pdv||{},o={name:t.name,timezone:t.timezone};for(let[i,s]of Object.entries(Ga))o[i]=n[s]??null;return o.pdv_service_fee=
n.service_fee_bp!=null?n.service_fee_bp/100:null,o}async function Ka(e,a,t){let n=Ha(Ba,t);if(n.pdv_card_prefix!=null&&!/^[A-Z0-9-]{1,8}$/.test(n.pdv_card_prefix))throw f("Prefixo \
dos cart\xF5es: use letras mai\xFAsculas, n\xFAmeros e h\xEDfen (at\xE9 8)");if(n.name!=null&&n.name.length<2)throw f("Nome da empresa muito curto");let o={};for(let[r,c]of Object.
entries(Ga))r in n&&(o[c]=n[r]);"pdv_service_fee"in n&&(o.service_fee_bp=Math.round(n.pdv_service_fee*100));let s={...(await e.query("select settings from companies where id = $1 f\
or update",[a])).rows[0]?.settings?.pdv||{},...o};return pt(s),await e.query(`update companies set name = coalesce($2, name), timezone = coalesce($3, timezone),
                    settings = jsonb_set(settings, '{pdv}', $4::jsonb) where id = $1`,[a,n.name??null,n.timezone??null,JSON.stringify(s)]),n}function Wa(e){if(e==null||e==="")return null;let a=typeof e=="number"?e:Number(String(e).replace(",","."));return!Number.isFinite(a)||a<=0||a>1e7?null:Math.round(a*100)}function Ti(e,a){
if(!e||!a)return null;let t=e*12;return a>=t?null:{cents:t-a,pct:Math.floor((t-a)/t*100)}}function Ri(e){if(!e||typeof e!="object")return null;let a=Wa(e.monthly_price??(e.monthly_cents!=
null?e.monthly_cents/100:null)),t=Wa(e.annual_price??(e.yearly_cents!=null?e.yearly_cents/100:null)),n=Ti(a,t);return{id:e.id??null,code:e.code??null,name:String(e.name??""),description:e.
description??null,features:e.features??null,max_users:e.max_users??null,monthly_cents:a,yearly_cents:t,annual_savings_cents:n?.cents??null,annual_savings_pct:n?.pct??null,monthly_price:a==
null?null:a/100,annual_price:t==null?null:t/100}}var Ht=e=>Array.isArray(e)?e.map(Ri).filter(a=>a&&(a.monthly_cents||a.yearly_cents)):[];function Xa(e){return e==="15_DAYS"?{trial:!0,
trial_days:15,trial_label:"Per\xEDodo de teste de 15 dias"}:e==="30_DAYS"?{trial:!0,trial_days:30,trial_label:"Per\xEDodo de teste de 30 dias"}:e==="UNLIMITED"?{trial:!0,trial_days:null,
trial_label:"Per\xEDodo de teste com prazo definido pela administra\xE7\xE3o"}:{trial:!1,trial_days:null,trial_label:null}}var Ya="__Host-rusten_rt",yt=e=>String(e.get("x-session-mode")||"").toLowerCase()==="cookie";function Mi(e,a=Ya){for(let t of String(e.headers.cookie||"").split(";")){let n=t.indexOf(
"=");if(n>0&&t.slice(0,n).trim()===a)return decodeURIComponent(t.slice(n+1).trim())}return null}function Li(e){let a=String(e.get("origin")||"");if(!a)throw new z(403,"Origem da re\
quisi\xE7\xE3o n\xE3o informada.","csrf");let t;try{t=new URL(a).host}catch{throw new z(403,"Origem inv\xE1lida.","csrf")}let n=String(e.get("x-edge-site")||""),o=String(O.CORS_ORIGINS||
"").split(",").map(s=>s.trim()).filter(Boolean),i=O.NODE_ENV!=="production"&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(t);if(!(n&&t===n)&&!o.includes(a)&&!i)throw new z(403,"Origem \
n\xE3o autorizada.","csrf")}var Za=(e,a)=>`${Ya}=${e?encodeURIComponent(e):""}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${a}`;function ft(e,a,t,n=200){if(!yt(e))return a.
status(n).json(t);let{refresh_token:o,...i}=t;return a.append("Set-Cookie",Za(o,Bt*86400)),a.set("Cache-Control","no-store"),a.status(n).json({...i,session:"cookie"})}function Tn(e){
e.append("Set-Cookie",Za("",0))}function Qa(e){let a=String(e.body?.refresh_token||"");return yt(e)&&Li(e),a||(yt(e)?String(Mi(e)||""):"")}var ue=Fi(),Bi=["12345678","senha123","password","qwerty","123456789","rusten123","abc12345"];function tt(e){if(e.length<10)throw f("A senha precisa ter pelo menos 10 caracteres");
if(!/[a-zA-Z]/.test(e)||!/\d/.test(e))throw f("A senha precisa ter letras e n\xFAmeros");if(Bi.some(a=>e.toLowerCase().includes(a)))throw f("Senha muito comum")}var Vi=["bar","rest\
aurante","lanchonete","cafeteria","pub","food_truck","hamburgueria","pizzaria","padaria","outro"],Hi=E.object({company:E.object({name:E.string().trim().min(2).max(120),segment:E.enum(
Vi).default("restaurante"),document:E.string().trim().max(20).optional(),phone:E.string().trim().max(30).optional(),email:E.string().trim().email().max(160).optional(),address:E.object(
{street:E.string().max(160).optional(),city:E.string().max(80).optional(),state:E.string().max(2).optional(),zip:E.string().max(10).optional()}).partial().optional()}),owner:E.object(
{name:E.string().trim().min(2).max(120),email:E.string().trim().toLowerCase().email().max(160),password:E.string().min(1).max(200)}),accept_terms:E.literal(!0,{message:"\xC9 preciso a\
ceitar os termos"}),plan:E.object({code:E.string().max(60).optional(),cycle:E.enum(["mensal","anual"]).optional(),trial:E.boolean().optional()}).optional(),setup:E.object({unit_name:E.
string().trim().max(80).optional(),tables:E.number().int().min(0).max(300).default(10),cards:E.number().int().min(0).max(2e3).default(50),mode:E.enum(["manual","continua","dupla"]).
default("manual"),demo:E.boolean().default(!1),day_cutoff:E.number().int().min(0).max(12).default(5)}).default({})});ue.post("/register",l(async(e,a)=>{let t=await Ue();if(O.ALLOW_SIGNUP===
"false"||t.signup_enabled===!1)throw new z(403,"Novos cadastros est\xE3o temporariamente fechados","signup_closed");await X(`register:${e.ip}`,10,3600);let n=w(Hi,e.body);if(tt(n.owner.
password),(await d("select 1 from users where lower(email) = $1",[n.owner.email])).rows[0])throw new z(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.',
"email_taken");let i=await We.hash(n.owner.password,12),s=await x(async c=>{let m=(await c.query(`insert into companies (name, segment, document, phone, email, address, settings)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,[n.company.name,n.company.segment,n.company.document??null,n.company.phone??null,n.company.email??n.owner.email,n.company.address??
{},{pdv:{mode:n.setup.mode,service_fee_bp:Math.round(Number(t.default_service_fee??10)*100)},plan_request:n.plan??null}])).rows[0].id;for(let $ of In)await c.query("insert into rol\
es (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",[m,$.key,$.name,$.level,$.permissions]);let p=await c.query("insert into users (company_id, nam\
e, email, password_hash, role_key) values ($1,$2,$3,$4,'owner') returning id",[m,n.owner.name,n.owner.email,i]),_={companyId:m,userId:p.rows[0].id};return await En(c,m,n.setup),await h(
c,_,"empresa.cadastrada",{entity:"company",entityId:m,data:{segment:n.company.segment,plan:n.plan??null}}),await jt(c,m,"tenant.created"),{companyId:m,userId:p.rows[0].id}});try{await Ft(
s.companyId,4e3)&&await d("update platform_outbox set sent_at = now() where company_id = $1 and sent_at is null",[s.companyId])}catch{}let r=await Jt({id:s.userId,company_id:s.companyId},
e);ft(e,a,r,201)}));async function Jt(e,a){let t=Ui.randomUUID(),n=se(48);return await d(`insert into user_sessions (id, user_id, refresh_hash, expires_at, ip)
           values ($1,$2,$3, now() + make_interval(days => $4), $5)`,[t,e.id,he(n),Bt,a.ip]),{access_token:qn(e,t),refresh_token:`${t}.${n}`}}var Ji,Gi=()=>Ji||=We.hashSync("dummy-\
password-for-timing",12);ue.get("/plans",l(async(e,a)=>{let t=await Ue(),n={signup_open:O.ALLOW_SIGNUP!=="false"&&t.signup_enabled!==!1,demo_enabled:t.demo_enabled!==!1,defaults:{mode:t.
default_mode,tables:t.default_tables,cards:t.default_cards,day_cutoff:t.default_day_cutoff}};if(!await je())return a.json({...n,hub:!1,plans:[]});try{let o=await ge("GET","/plans",
void 0,5e3);a.json({...n,hub:!0,plans:Ht(o.plans),trial_default:o.trial_default||null,...Xa(o.trial_default),signup_open:n.signup_open&&o.signup_enabled!==!1})}catch{a.json({...n,hub:!0,
plans:[],unavailable:!0})}}));ue.post("/demo",l(async(e,a)=>{let t=await Ue();if(t.demo_enabled===!1)throw new z(403,"A demonstra\xE7\xE3o est\xE1 desativada no momento.","demo_dis\
abled");await X(`demo:${e.ip}`,10,3600);let n=await d("select id from companies where is_demo and created_at < now() - make_interval(days => $1) limit 20",[Number(t.demo_days)||7]);
for(let s of n.rows)await x(r=>r.query("select purge_demo_company($1)",[s.id])).catch(()=>{});let o=se(6).toLowerCase().replace(/[^a-z0-9]/g,"x"),i=await x(async s=>{let r=await s.
query("insert into companies (name, segment, email, settings, is_demo) values ('Bar Demonstra\xE7\xE3o', 'bar', null, $1, true) returning id, timezone",[{pdv:{mode:"manual",service_fee_bp:1e3}}]),
c=r.rows[0].id;for(let p of In)await s.query("insert into roles (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",[c,p.key,p.name,p.level,p.permissions]);
let u=await s.query("insert into users (company_id, name, email, password_hash, role_key) values ($1,'Visitante',$2,$3,'owner') returning id",[c,`demo-${o}@demo.rusten.app`,await We.
hash(se(24),8)]),{unitId:m}=await En(s,c,{unit_name:"Matriz",tables:12,cards:30,demo:!0,day_cutoff:5});return await Fa(s,c,m,u.rows[0].id,pe(new Date,r.rows[0].timezone,5)),await h(
s,{companyId:c,userId:u.rows[0].id},"demonstracao.criada",{entity:"company",entityId:c}),{companyId:c,userId:u.rows[0].id}});ft(e,a,await Jt({id:i.userId,company_id:i.companyId},e),
201)}));ue.post("/activate",Le(),l(async(e,a)=>{let t=w(E.object({company_name:E.string().trim().min(2).max(120),name:E.string().trim().min(2).max(120),email:E.string().trim().toLowerCase().
email().max(160),password:E.string().min(1).max(200),phone:E.string().trim().max(30).optional(),keep_data:E.boolean().default(!1),accept_terms:E.literal(!0,{message:"\xC9 preciso acei\
tar os termos"})}),e.body);if(e.ctx.role!=="owner")throw new z(403,"S\xF3 o propriet\xE1rio pode ativar o sistema.","forbidden");if(!e.ctx.company.is_demo)throw f("Esta empresa j\xE1 \
est\xE1 em uso normal.");let n=await Ue();if(O.ALLOW_SIGNUP==="false"||n.signup_enabled===!1)throw new z(403,"Novos cadastros est\xE3o temporariamente fechados","signup_closed");if(tt(
t.password),(await d("select 1 from users where lower(email) = $1 and id <> $2",[t.email,e.ctx.userId])).rows[0])throw new z(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou re\
cupere a senha.',"email_taken");let i=e.ctx.companyId;await x(async s=>{if(!t.keep_data){await s.query("select set_config('rusten.purge_demo', $1, true)",[String(i)]);for(let r of[
"delete from reviews where company_id = $1","delete from loyalty_ledger where company_id = $1 and reverses_id is not null","delete from loyalty_ledger where company_id = $1","delet\
e from delivery_events where company_id = $1","delete from delivery_orders where company_id = $1","delete from kitchen_events where company_id = $1","delete from stock_movements wh\
ere company_id = $1 and reverses_id is not null","delete from stock_movements where company_id = $1","delete from recipe_lines where company_id = $1","delete from recipes where com\
pany_id = $1","update products set stock_mode = 'nenhum', stock_item_id = null where company_id = $1","delete from purchase_lines where company_id = $1","delete from purchases wher\
e company_id = $1","delete from inventory_counts where company_id = $1","update modifier_options set stock_item_id = null where company_id = $1","delete from stock_items where comp\
any_id = $1","delete from reservations where company_id = $1","delete from conversation_messages where company_id = $1","delete from conversations where company_id = $1"])await s.query(
r,[i]);await s.query("delete from payments where company_id = $1",[i]),await s.query("delete from cash_movements where company_id = $1",[i]),await s.query("delete from cash_session\
s where company_id = $1",[i]),await s.query("delete from order_items where company_id = $1",[i]),await s.query("delete from consumption_sessions where company_id = $1",[i]),await s.
query("delete from customers where company_id = $1",[i]),await s.query("select set_config('rusten.purge_demo', '', true)"),await s.query("update dining_tables set status = 'livre' \
where company_id = $1",[i]),await s.query("delete from scan_codes where company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and d\
emo)",[i]),await s.query("delete from modifier_groups where company_id = $1 and product_id in (select id from products where company_id = $1 and demo)",[i]),await s.query("delete f\
rom product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 and demo)",[i]),await s.query("delete from products where company_i\
d = $1 and demo",[i]),await s.query("delete from categories where company_id = $1 and demo",[i])}await s.query("update companies set name = $2, phone = coalesce($3, phone), email =\
 $4, is_demo = false, created_at = now() where id = $1",[i,t.company_name,t.phone??null,t.email]),await s.query("update users set name = $2, email = $3, password_hash = $4, passwor\
d_changed_at = now() where id = $1",[e.ctx.userId,t.name,t.email,await We.hash(t.password,12)]),await s.query("update user_sessions set revoked_at = now() where user_id = $1 and re\
voked_at is null",[e.ctx.userId]),await h(s,e.ctx,"demonstracao.ativada",{entity:"company",entityId:i,data:{keep_data:t.keep_data}}),await jt(s,i,"tenant.created")});try{await lt(5)}catch{}
ft(e,a,await Jt({id:e.ctx.userId,company_id:i},e))}));ue.post("/login",l(async(e,a)=>{let t=w(E.object({email:E.string().trim().toLowerCase().max(160),password:E.string().max(200)}),
e.body);await X(`login:${e.ip}`,30,900),await X(`login-user:${t.email}`,15,900);let{rows:n}=await d("select * from users where lower(email) = $1",[t.email]),o=n[0],i=await We.compare(
t.password,o?.password_hash||Gi()),s=new z(401,"E-mail ou senha incorretos","bad_credentials");if(!o||!o.active)throw s;if(o.locked_until&&new Date(o.locked_until)>new Date)throw new z(
423,"Conta bloqueada temporariamente por tentativas inv\xE1lidas. Tente em 15 minutos.","locked");if(!i)throw await d(`update users set failed_attempts = failed_attempts + 1,
               locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
             where id = $1`,[o.id]),await h({query:d},{companyId:o.company_id,userId:o.id},"login.falhou",{entity:"user",entityId:o.id}),s;await d("update users set failed_attempts\
 = 0, locked_until = null where id = $1",[o.id]),await d("update companies set last_access_at = now() where id = $1",[o.company_id]),await h({query:d},{companyId:o.company_id,userId:o.
id},"login",{entity:"user",entityId:o.id}),ft(e,a,await Jt(o,e))}));var eo=60,Rn={ok:!0,message:"Se o e-mail estiver cadastrado, voc\xEA vai receber um link para criar uma nova senha \
em alguns minutos."},Mn={at:0,v:!1};async function to(){if(Date.now()-Mn.at<6e4)return Mn.v;let e=!1;try{e=!!(await ge("GET","/mail/status",void 0,5e3)).available}catch{e=!1}return Mn=
{at:Date.now(),v:e},e}ue.get("/reset-options",l(async(e,a)=>a.json({available:await to()})));ue.post("/forgot",l(async(e,a)=>{let t=w(E.object({email:E.string().trim().toLowerCase().
email("E-mail inv\xE1lido").max(160)}),e.body);if(await X(`forgot:${e.ip}`,20,3600),!await to())throw new z(503,"A recupera\xE7\xE3o de senha por e-mail ainda n\xE3o est\xE1 ativa. Pe\xE7a ao pro\
priet\xE1rio ou administrador da empresa para definir uma nova senha em Configura\xE7\xF5es \u203A Usu\xE1rios, ou fale com o suporte.","reset_unavailable");try{await X(`forgot-use\
r:${t.email}`,3,3600)}catch{return a.json(Rn)}let n=(await d(`select u.id, u.name, u.email, u.company_id, c.name as company_name, c.is_demo from users u join companies c on c.id = \
u.company_id
     where lower(u.email) = $1 and u.active`,[t.email])).rows[0];if(!n||n.is_demo)return a.json(Rn);let o=se(32);await d("update password_resets set used_at = now() where user_id =\
 $1 and used_at is null",[n.id]),await d("insert into password_resets (user_id, token_hash, expires_at, ip) values ($1,$2, now() + make_interval(mins => $3), $4)",[n.id,he(o),eo,String(
e.ip||"").slice(0,64)]);try{await ge("POST","/mail/password-reset",{to:n.email,name:n.name,company:n.company_name,path:`/redefinir-senha?token=${o}`,minutes:eo},2e4)}catch(i){throw await d(
"update password_resets set used_at = now() where token_hash = $1",[he(o)]),new z(i.status===429?429:502,i.status===429?i.message:"N\xE3o foi poss\xEDvel enviar o e-mail agora. Tente nov\
amente em alguns minutos.","mail_failed")}await h({query:d},{companyId:n.company_id,userId:n.id},"senha.redefinicao_pedida",{entity:"user",entityId:n.id}),a.json(Rn)}));ue.post("/r\
eset",l(async(e,a)=>{let t=w(E.object({token:E.string().trim().min(20).max(200),new_password:E.string().max(200)}),e.body);await X(`reset:${e.ip}`,30,3600),tt(t.new_password);let n=await x(
async o=>{let i=(await o.query("update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id",[he(t.token)])).rows[0];
if(!i)throw new z(400,"Este link expirou ou j\xE1 foi usado. Pe\xE7a um novo em \u201CEsqueci minha senha\u201D.","reset_invalid");let s=(await o.query("select id, company_id from \
users where id = $1 and active",[i.user_id])).rows[0];if(!s)throw new z(400,"Conta indispon\xEDvel.","reset_invalid");return await o.query("update users set password_hash = $2, pas\
sword_changed_at = now(), failed_attempts = 0, locked_until = null where id = $1",[s.id,await We.hash(t.new_password,10)]),await o.query("update user_sessions set revoked_at = now(\
) where user_id = $1 and revoked_at is null",[s.id]),await h(o,{companyId:s.company_id,userId:s.id},"senha.redefinida_por_email",{entity:"user",entityId:s.id}),{ok:!0}});a.json(n)}));
ue.post("/refresh",l(async(e,a)=>{try{await Ki(e,a)}catch(t){throw yt(e)&&t?.status===401&&Tn(a),t}}));async function Ki(e,a){let t=Qa(e),[n,o]=t.split(".");if(!n||!o||!/^[0-9a-f-]{36}$/.
test(n))throw new z(401,"Sess\xE3o inv\xE1lida","unauthenticated");let i=await x(async s=>{let{rows:r}=await s.query("select s.*, u.company_id, u.active from user_sessions s join u\
sers u on u.id = s.user_id where s.id = $1 for update of s",[n]),c=r[0];if(!c||c.revoked_at||new Date(c.expires_at)<new Date||!c.active)throw new z(401,"Sess\xE3o expirada","unauth\
enticated");if(c.refresh_hash!==he(o))return await s.query("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[c.user_id]),await h(s,{companyId:c.
company_id,userId:c.user_id},"sessao.reuso_detectado",{entity:"user",entityId:c.user_id}),null;let u=se(48);return await s.query("update user_sessions set refresh_hash = $2, rotate\
d_at = now() where id = $1",[n,he(u)]),{access_token:qn({id:c.user_id,company_id:c.company_id},n),refresh_token:`${n}.${u}`}});if(!i)throw new z(401,"Sess\xE3o encerrada por seguran\xE7a\
. Entre novamente.","unauthenticated");ft(e,a,i)}ue.post("/logout",Le(),l(async(e,a)=>{e.body?.all===!0?await d("update user_sessions set revoked_at = now() where user_id = $1 and \
revoked_at is null",[e.ctx.userId]):await d("update user_sessions set revoked_at = now() where id = $1",[e.ctx.sessionId]),yt(e)&&Tn(a),a.json({ok:!0})}));ue.post("/password",Le(),
l(async(e,a)=>{let t=w(E.object({current:E.string().max(200),next:E.string().max(200)}),e.body);tt(t.next);let{rows:n}=await d("select password_hash from users where id = $1",[e.ctx.
userId]);if(!await We.compare(t.current,n[0].password_hash))throw f("Senha atual incorreta");await d("update users set password_hash = $2, password_changed_at = now() where id = $1",
[e.ctx.userId,await We.hash(t.next,12)]),await d("update user_sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null",[e.ctx.userId,e.ctx.sessionId]),
await h({query:d},e.ctx,"senha.alterada",{entity:"user",entityId:e.ctx.userId}),a.json({ok:!0})}));ue.get("/me",Le(),l(async(e,a)=>{let t=e.ctx,n=await d("select id, name, day_cuto\
ff from units where company_id = $1 and active order by id",[t.companyId]),o=t.terminalUnitId||t.unitId||n.rows[0]?.id;a.json({user:{id:t.userId,name:t.name,email:t.email,role:t.role,
roleName:t.roleName,level:t.level,unitId:t.unitId},company:t.company,permissions:[...t.perms],access:t.access,units:n.rows,unitId:o,terminalId:t.terminalId,pdv:await Fe({query:d},t,
o),catalog:{permissions:Ze,modules:mt},notice:await Wi()})}));async function Wi(){let e=await Ue();return e.notice_text?{text:e.notice_text,level:e.notice_level==="warn"?"warn":"in\
fo"}:null}import{Router as Xi}from"npm:express@5.2.1";import Ln from"npm:bcryptjs@3.0.3";import{z as I}from"npm:zod@4.6.5";var Y=Xi();async function no(e,a){let t=await d("select level from roles where company_id = $1 and key = $2",[e,a]);if(!t.rows[0])throw f("Perfil inexistente");return t.rows[0].level}
Y.get("/users",y("usuarios.gerenciar"),l(async(e,a)=>{let{rows:t}=await d(`select u.id, u.name, u.email, u.role_key, r.name as role_name, r.level, u.unit_id, u.active, u.created_at\
,
            u.locked_until > now() as locked
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by r.level desc, u.name`,[e.ctx.companyId]);a.json(t)}));var ao=I.object({name:I.string().trim().min(2).max(120),email:I.string().trim().toLowerCase().
email().max(160),password:I.string().max(200).optional(),role_key:I.string().max(40),unit_id:I.number().int().nullable().optional(),active:I.boolean().optional()});Y.post("/users",
y("usuarios.gerenciar"),l(async(e,a)=>{let t=w(ao,e.body);if(await no(e.ctx.companyId,t.role_key)>e.ctx.level)throw F("N\xE3o \xE9 poss\xEDvel criar usu\xE1rio com perfil acima do seu");
if(!t.password)throw f("Informe a senha inicial");if(tt(t.password),t.unit_id&&await Fn(e.ctx.companyId,t.unit_id),(await d("select 1 from users where lower(email) = $1",[t.email])).
rows[0])throw g("E-mail j\xE1 cadastrado");let o=await d("insert into users (company_id, name, email, password_hash, role_key, unit_id) values ($1,$2,$3,$4,$5,$6) returning id",[e.
ctx.companyId,t.name,t.email,await Ln.hash(t.password,12),t.role_key,t.unit_id??null]);await h({query:d},e.ctx,"usuario.criado",{entity:"user",entityId:o.rows[0].id,data:{role:t.role_key}}),
await jt({query:d},e.ctx.companyId,"tenant.updated"),a.status(201).json({id:o.rows[0].id})}));Y.put("/users/:id",y("usuarios.gerenciar"),l(async(e,a)=>{let t=Number(e.params.id),n=w(
ao.partial(),e.body),i=(await d(`select u.*, r.level from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                       where u.id = $1 and u.company_id = $2`,[t,e.ctx.companyId])).rows[0];if(!i)throw v("Usu\xE1rio n\xE3o encontrado");if(i.level>e.ctx.level||i.level===e.ctx.level&&
i.id!==e.ctx.userId&&e.ctx.role!=="owner")throw F("N\xE3o \xE9 poss\xEDvel alterar usu\xE1rio de n\xEDvel igual ou superior");if(n.role_key&&await no(e.ctx.companyId,n.role_key)>e.
ctx.level)throw F("Perfil acima do seu");if(i.role_key==="owner"&&n.role_key&&n.role_key!=="owner"&&(await d("select count(*)::int n from users where company_id = $1 and role_key =\
 'owner' and active",[e.ctx.companyId])).rows[0].n<=1)throw f("A empresa precisa de ao menos um propriet\xE1rio ativo");n.unit_id&&await Fn(e.ctx.companyId,n.unit_id);let s=null;n.
password&&(tt(n.password),s=await Ln.hash(n.password,12)),await d(`update users set name = coalesce($3, name), email = coalesce($4, email), role_key = coalesce($5, role_key),
             unit_id = case when $6::boolean then $7 else unit_id end, active = coalesce($8, active),
             password_hash = coalesce($9, password_hash),
             password_changed_at = case when $9 is not null then now() else password_changed_at end
           where id = $1 and company_id = $2`,[t,e.ctx.companyId,n.name??null,n.email??null,n.role_key??null,"unit_id"in n,n.unit_id??null,n.active??null,s]),(n.active===!1||s)&&await d(
"update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[t]),await h({query:d},e.ctx,"usuario.alterado",{entity:"user",entityId:t,data:{...n,password:n.
password?"alterada":void 0}}),a.json({ok:!0})}));Y.get("/roles",y("usuarios.gerenciar"),l(async(e,a)=>{let{rows:t}=await d("select key, name, level, permissions, system from roles \
where company_id = $1 order by level desc",[e.ctx.companyId]);a.json({roles:t,catalog:Ze})}));Y.put("/roles/:key",y("usuarios.gerenciar"),l(async(e,a)=>{let t=w(I.object({name:I.string().
trim().min(2).max(60).optional(),permissions:I.array(I.string()).max(200).optional(),level:I.number().int().min(1).max(99).optional()}),e.body),n=(await d("select * from roles wher\
e company_id = $1 and key = $2",[e.ctx.companyId,e.params.key])).rows[0];if(!n)throw v("Perfil n\xE3o encontrado");if(n.key==="owner")throw F("O perfil Propriet\xE1rio n\xE3o pode ser al\
terado");if(n.level>=e.ctx.level)throw F("S\xF3 \xE9 poss\xEDvel alterar perfis abaixo do seu n\xEDvel");if(t.level&&t.level>=e.ctx.level)throw F("N\xEDvel acima do seu");if(t.permissions){
let o=t.permissions.find(s=>!(s in Ze));if(o)throw f(`Permiss\xE3o inv\xE1lida: ${o}`);let i=t.permissions.find(s=>!e.ctx.can(s));if(i)throw F(`Voc\xEA n\xE3o pode conceder o que n\xE3o tem\
: ${i}`)}await d("update roles set name = coalesce($3,name), permissions = coalesce($4,permissions), level = coalesce($5,level) where company_id = $1 and key = $2",[e.ctx.companyId,
n.key,t.name??null,t.permissions??null,t.level??null]),await h({query:d},e.ctx,"perfil.alterado",{entity:"role",entityId:n.key,data:{before:n.permissions,after:t.permissions}}),a.json(
{ok:!0})}));Y.post("/roles",y("usuarios.gerenciar"),l(async(e,a)=>{let t=w(I.object({name:I.string().trim().min(2).max(60),level:I.number().int().min(1).max(99),permissions:I.array(
I.string()).max(200)}),e.body);if(t.level>=e.ctx.level)throw F("N\xEDvel acima do seu");let n=t.permissions.find(i=>!(i in Ze)||!e.ctx.can(i));if(n)throw F(`Permiss\xE3o inv\xE1lida ou n\
\xE3o conced\xEDvel: ${n}`);let o=`custom_${se(4).toLowerCase().replace(/[^a-z0-9]/g,"x")}`;await d("insert into roles (company_id, key, name, level, permissions) values ($1,$2,$3,\
$4,$5)",[e.ctx.companyId,o,t.name,t.level,t.permissions]),await h({query:d},e.ctx,"perfil.criado",{entity:"role",entityId:o,data:t}),a.status(201).json({key:o})}));async function Fn(e,a){
if(!(await d("select id from units where id = $1 and company_id = $2",[a,e])).rows[0])throw f("Unidade inv\xE1lida")}Y.get("/units",l(async(e,a)=>{a.json((await d("select id, name,\
 active, day_cutoff, settings from units where company_id = $1 order by id",[e.ctx.companyId])).rows)}));Y.post("/units",y("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(I.object(
{name:I.string().trim().min(2).max(80),day_cutoff:I.number().int().min(0).max(12).default(5)}),e.body),n=await d("insert into units (company_id, name, day_cutoff) values ($1,$2,$3)\
 returning id",[e.ctx.companyId,t.name,t.day_cutoff]);await h({query:d},e.ctx,"unidade.criada",{entity:"unit",entityId:n.rows[0].id,data:t}),a.status(201).json({id:n.rows[0].id})}));
Y.put("/units/:id",y("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(I.object({name:I.string().trim().min(2).max(80).optional(),day_cutoff:I.number().int().min(0).max(12).optional(),
active:I.boolean().optional()}),e.body);if(!(await d("update units set name = coalesce($3,name), day_cutoff = coalesce($4,day_cutoff), active = coalesce($5,active) where id = $1 an\
d company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.day_cutoff??null,t.active??null])).rows[0])throw v();await h({query:d},e.ctx,"unidade.alterada",
{entity:"unit",entityId:e.params.id,data:t}),a.json({ok:!0})}));Y.get("/terminals",l(async(e,a)=>{a.json((await d("select id, unit_id, name, active, settings from terminals where c\
ompany_id = $1 order by id",[e.ctx.companyId])).rows)}));Y.post("/terminals",y("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(I.object({name:I.string().trim().min(2).max(60),unit_id:I.
number().int()}),e.body);await Fn(e.ctx.companyId,t.unit_id);let n=await d("insert into terminals (company_id, unit_id, name) values ($1,$2,$3) returning id",[e.ctx.companyId,t.unit_id,
t.name]);await h({query:d},e.ctx,"terminal.criado",{entity:"terminal",entityId:n.rows[0].id,data:t}),a.status(201).json({id:n.rows[0].id})}));Y.put("/terminals/:id",y("configuracoe\
s.gerenciar"),l(async(e,a)=>{let t=w(I.object({name:I.string().trim().min(2).max(60).optional(),active:I.boolean().optional()}),e.body);if(!(await d("update terminals set name = co\
alesce($3,name), active = coalesce($4,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.active??null])).rows[0])throw v();
a.json({ok:!0})}));var Yi=I.object({name:I.string().trim().min(2).max(120),segment:I.string().max(30),document:I.string().max(20).nullable(),phone:I.string().max(30).nullable(),email:I.
string().email().max(160).nullable(),timezone:I.string().max(60),address:I.record(I.string(),I.string().max(160)),appearance:I.object({theme:I.enum(["claro","escuro","auto"]).optional(),
density:I.enum(["confortavel","compacta"]).optional(),menu:I.enum(["lateral","superior"]).optional(),accent:I.string().regex(/^#[0-9a-fA-F]{6}$/).optional()})}).partial();Y.get("/s\
ettings",l(async(e,a)=>{let t=(await d("select id, name, segment, document, phone, email, timezone, address, settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json(
t)}));Y.put("/settings",y("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(Yi,e.body);if(t.timezone)try{new Intl.DateTimeFormat("pt-BR",{timeZone:t.timezone})}catch{throw f("Fuso \
hor\xE1rio inv\xE1lido")}await d(`update companies set name = coalesce($2,name), segment = coalesce($3,segment), document = coalesce($4,document),
             phone = coalesce($5,phone), email = coalesce($6,email), timezone = coalesce($7,timezone), address = coalesce($8,address),
             settings = case when $9::jsonb is null then settings else jsonb_set(settings, '{appearance}', $9::jsonb) end
           where id = $1`,[e.ctx.companyId,t.name??null,t.segment??null,t.document??null,t.phone??null,t.email??null,t.timezone??null,t.address??null,t.appearance?JSON.stringify(t.
appearance):null]),await h({query:d},e.ctx,"configuracoes.empresa",{entity:"company",entityId:e.ctx.companyId,data:t}),a.json({ok:!0})}));var Zi=I.object({scanner_enabled:I.boolean(),
mode:I.enum(["manual","continua","dupla"]),double_read_mandatory:I.boolean(),allow_manual:I.boolean(),allow_manual_exception:I.boolean(),exception_requires_manager:I.boolean(),allow_mode_change:I.
boolean(),product_timeout_s:I.number().int(),open_free_card_on_scan:I.boolean(),feedback_sound:I.boolean(),qty_per_scan:I.number().int().min(1).max(100),max_qty_per_scan:I.number().
int().min(1).max(100),terminator:I.enum(["Enter","Tab"]),kitchen_send:I.enum(["imediato","lote"]),require_open_cash:I.boolean(),service_fee_bp:I.number().int().min(0).max(3e3),card_prefix:I.
string().regex(/^[A-Z0-9-]{1,8}$/)}).partial();Y.get("/pdv-settings",l(async(e,a)=>{let t=Number(e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId||null,n=await d("select settin\
gs->'pdv' as s from companies where id = $1",[e.ctx.companyId]),o=t?await d("select settings->'pdv' as s from units where id = $1 and company_id = $2",[t,e.ctx.companyId]):{rows:[]},
i=Number(e.query.terminal_id)||e.ctx.terminalId,s=i?await d("select settings->'pdv' as s from terminals where id = $1 and company_id = $2",[i,e.ctx.companyId]):{rows:[]};a.json({company:n.
rows[0]?.s||{},unit:o.rows[0]?.s||{},terminal:s.rows[0]?.s||{},effective:Cn(n.rows[0]?.s,o.rows[0]?.s,s.rows[0]?.s)})}));Y.put("/pdv-settings/:level",y("configuracoes.gerenciar"),l(
async(e,a)=>{let t=w(I.enum(["company","unit","terminal"]),e.params.level),n=w(Zi,e.body?.settings);pt(n);let o=Number(e.body?.id);await x(async i=>{let s;if(t==="company"){s=(await i.
query("select settings->'pdv' s, settings from companies where id = $1 for update",[e.ctx.companyId])).rows[0];let r={...s.s||{},...n};pt(r),await i.query("update companies set set\
tings = jsonb_set(settings, '{pdv}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(r)])}else{let r=t==="unit"?"units":"terminals";if(s=(await i.query(`select settings->\
'pdv' s from ${r} where id = $1 and company_id = $2 for update`,[o,e.ctx.companyId])).rows[0],!s)throw v();let c={...s.s||{},...n};pt(c),await i.query(`update ${r} set settings = j\
sonb_set(settings, '{pdv}', $3::jsonb) where id = $1 and company_id = $2`,[o,e.ctx.companyId,JSON.stringify(c)])}await h(i,e.ctx,"pdv.configuracao",{entity:t,entityId:o||e.ctx.companyId,
data:{before:s?.s||{},after:n}})}),a.json({ok:!0,effective:await Fe({query:d},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId)})}));Y.get("/audit",y("auditoria.visualizar"),l(async(e,a)=>{
let t=Math.min(Number(e.query.limit)||50,500),n=Math.max(Number(e.query.offset)||0,0),o=[e.ctx.companyId],i="a.company_id = $1";e.query.action&&(o.push(`${String(e.query.action)}%`),
i+=` and a.action like $${o.length}`),e.query.entity&&(o.push(String(e.query.entity)),i+=` and a.entity = $${o.length}`),e.query.entity_id&&(o.push(String(e.query.entity_id)),i+=` \
and a.entity_id = $${o.length}`),o.push(t,n);let{rows:s}=await d(`select a.id, a.action, a.entity, a.entity_id, a.reason, a.data, a.created_at, a.terminal_id, a.unit_id, u.name as \
user_name
       from audit_events a left join users u on u.id = a.user_id
      where ${i} order by a.id desc limit $${o.length-1} offset $${o.length}`,o);if(e.query.format==="csv")return a.type("text/csv; charset=utf-8").attachment("auditoria.csv"),a.send(
["data;usuario;acao;entidade;id;motivo",...s.map(r=>[r.created_at.toISOString(),r.user_name,r.action,r.entity,r.entity_id,r.reason].map(dt).join(";"))].join(`
`));a.json(s)}));Y.post("/authorizations",l(async(e,a)=>{let t=w(I.object({email:I.string().trim().toLowerCase().max(160),password:I.string().max(200),action:I.enum(["excecao_dupla\
_leitura","cancelar_item","desconto","alterar_preco","reabrir_comanda","cancelar_venda","taxa_servico"]),reason:I.string().trim().min(3).max(300)}),e.body);await X(`auth-mgr:${e.ctx.
companyId}:${t.email}`,5,600);let n={excecao_dupla_leitura:"pdv.excecao_dupla_leitura",cancelar_item:"pdv.cancelar_item",desconto:"pdv.desconto",alterar_preco:"pdv.alterar_preco",reabrir_comanda:"\
pdv.reabrir_comanda",cancelar_venda:"pdv.cancelar_venda",taxa_servico:"pdv.taxa_servico"}[t.action],{rows:o}=await d(`select u.id, u.password_hash, r.permissions from users u join \
roles r on r.company_id = u.company_id and r.key = u.role_key
                             where lower(u.email) = $1 and u.company_id = $2 and u.active`,[t.email,e.ctx.companyId]),i=o[0];if(!(i&&await Ln.compare(t.password,i.password_hash))||
!i.permissions.includes("pdv.autorizar")||!i.permissions.includes(n))throw await h({query:d},e.ctx,"autorizacao.negada",{data:{action:t.action,email:t.email}}),F("Autoriza\xE7\xE3o recus\
ada: credenciais inv\xE1lidas ou sem permiss\xE3o para autorizar esta a\xE7\xE3o");let r=se(24);await d(`insert into manager_authorizations (company_id, requested_by, authorized_by\
, action, scope, token_hash, expires_at)
           values ($1,$2,$3,$4,$5,$6, now() + interval '2 minutes')`,[e.ctx.companyId,e.ctx.userId,i.id,t.action,{reason:t.reason,terminal:e.ctx.terminalId},he(r)]),await h({query:d},
e.ctx,"autorizacao.concedida",{reason:t.reason,data:{action:t.action,authorized_by:i.id}}),a.json({authorization:r,expires_in:120})}));async function Xe(e,a,t,n){if(!t)throw F("Est\
a a\xE7\xE3o exige autoriza\xE7\xE3o de um gerente","authorization_required");let{rows:o}=await e.query(`update manager_authorizations set used_at = now()
      where token_hash = $1 and company_id = $2 and requested_by = $3 and action = $4 and used_at is null and expires_at > now()
      returning authorized_by, scope`,[he(t),a.companyId,a.userId,n]);if(!o[0])throw F("Autoriza\xE7\xE3o gerencial inv\xE1lida, expirada ou j\xE1 utilizada");return o[0]}import{Router as Qi}from"npm:express@5.2.1";import{z as M}from"npm:zod@4.6.5";var $e=Qi();$e.get("/categories",y("cardapio.visualizar"),l(async(e,a)=>{a.json((await d("select id, name, sort, active, demo from categories where company_id = $1 order by sort, n\
ame",[e.ctx.companyId])).rows)}));$e.post("/categories",y("cardapio.gerenciar"),l(async(e,a)=>{let t=w(M.object({name:M.string().trim().min(1).max(80),sort:M.number().int().default(
0)}),e.body),n=await d("insert into categories (company_id, name, sort) values ($1,$2,$3) returning id",[e.ctx.companyId,t.name,t.sort]);a.status(201).json({id:n.rows[0].id})}));$e.
put("/categories/:id",y("cardapio.gerenciar"),l(async(e,a)=>{let t=w(M.object({name:M.string().trim().min(1).max(80),sort:M.number().int(),active:M.boolean()}).partial(),e.body);if(!(await d(
"update categories set name = coalesce($3,name), sort = coalesce($4,sort), active = coalesce($5,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,
t.name??null,t.sort??null,t.active??null])).rows[0])throw v();a.json({ok:!0})}));$e.get("/sectors",l(async(e,a)=>{a.json((await d("select id, name, active from production_sectors w\
here company_id = $1 order by id",[e.ctx.companyId])).rows)}));$e.post("/sectors",y("cardapio.gerenciar"),l(async(e,a)=>{let t=w(M.object({name:M.string().trim().min(2).max(60)}),e.
body),n=await d("insert into production_sectors (company_id, name) values ($1,$2) returning id",[e.ctx.companyId,t.name]);a.status(201).json({id:n.rows[0].id})}));$e.get("/products",
y("cardapio.visualizar"),l(async(e,a)=>{let t=[e.ctx.companyId],n="p.company_id = $1";e.query.active!=="all"&&(n+=" and p.active"),e.query.q&&(t.push(`%${String(e.query.q).slice(0,
60)}%`,_t(e.query.q)),n+=` and (p.name ilike $${t.length-1} or p.sku = $${t.length} or exists (select 1 from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO'\
 and s.entity_id = p.id and s.code = $${t.length}))`),e.query.category_id&&(t.push(Number(e.query.category_id)),n+=` and p.category_id = $${t.length}`);let o=e.ctx.can("relatorios.\
cmv")||e.ctx.can("cardapio.gerenciar"),{rows:i}=await d(`select p.id, p.name, p.description, p.sku, p.kind, p.unit, p.price_cents, ${o?"p.cost_cents,":""} p.favorite, p.active, p.d\
emo,
            p.category_id, p.sector_id, p.channels, p.allergens,
            coalesce((select array_agg(s.code order by s.id) from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.entity_id = p.id), '{}') as codes,
            coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
               'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                             from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id)
               from modifier_groups g where g.product_id = p.id), '[]') as groups
       from products p where ${n} order by p.favorite desc, p.name limit 500`,t);a.json(i)}));var oo=M.object({name:M.string().trim().min(1).max(120),description:M.string().max(500).
nullable().optional(),sku:M.string().trim().max(40).nullable().optional(),kind:M.enum(["resale","recipe","produced","combo","addon","weight"]).default("resale"),unit:M.enum(["un","\
kg","g","L","ml"]).default("un"),price_cents:M.number().int().min(0).max(1e8),cost_cents:M.number().int().min(0).max(1e8).default(0),category_id:M.number().int().nullable().optional(),
sector_id:M.number().int().nullable().optional(),favorite:M.boolean().default(!1),active:M.boolean().default(!0),channels:M.array(M.enum(["pdv","delivery","cardapio_digital"])).default(
["pdv"]),allergens:M.string().max(500).nullable().optional(),codes:M.array(M.string().max(128)).max(20).default([]),groups:M.array(M.object({name:M.string().trim().min(1).max(60),min:M.
number().int().min(0).max(20),max:M.number().int().min(1).max(20),options:M.array(M.object({name:M.string().trim().min(1).max(60),price_cents:M.number().int().min(0).max(1e6)})).min(
1).max(40)})).max(10).optional()});async function io(e,a,t){if(t.category_id&&!(await e.query("select 1 from categories where id = $1 and company_id = $2",[t.category_id,a])).rows[0])
throw f("Categoria inv\xE1lida");if(t.sector_id&&!(await e.query("select 1 from production_sectors where id = $1 and company_id = $2",[t.sector_id,a])).rows[0])throw f("Setor inv\xE1l\
ido");if(t.kind==="weight"&&t.unit==="un")throw f("Produto por peso precisa de unidade kg ou g");for(let n of t.groups||[])if(n.min>n.max)throw f(`Grupo ${n.name}: m\xEDnimo maior que\
 m\xE1ximo`)}async function so(e,a,t,n){if(!n)return;await e.query("delete from modifier_groups where product_id = $1 and company_id = $2",[t,a]);let o=0;for(let i of n){let s=await e.
query("insert into modifier_groups (company_id, product_id, name, min_select, max_select, sort) values ($1,$2,$3,$4,$5,$6) returning id",[a,t,i.name,i.min,i.max,o++]);for(let r of i.
options)await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)",[a,s.rows[0].id,r.name,r.price_cents])}}$e.post("/products",y("c\
ardapio.gerenciar"),l(async(e,a)=>{let t=w(oo,e.body),n=await x(async o=>{await io(o,e.ctx.companyId,t);let s=(await o.query(`insert into products (company_id, name, description, s\
ku, kind, unit, price_cents, cost_cents, category_id, sector_id, favorite, active, channels, allergens)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,[e.ctx.companyId,t.name,t.description??null,t.sku||null,t.kind,t.unit,t.price_cents,t.cost_cents,t.category_id??
null,t.sector_id??null,t.favorite,t.active,t.channels,t.allergens??null])).rows[0].id;for(let r of t.codes)await Qe(o,e.ctx.companyId,r,"PRODUTO",s);return await so(o,e.ctx.companyId,
s,t.groups),await o.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)",[e.ctx.companyId,s,t.price_cents,e.ctx.
userId]),await h(o,e.ctx,"produto.criado",{entity:"product",entityId:s,data:{name:t.name,price_cents:t.price_cents}}),s}).catch(o=>{throw o.code==="23505"?g("SKU j\xE1 usado em outro \
produto"):o});a.status(201).json({id:n})}));$e.put("/products/:id",y("cardapio.gerenciar"),l(async(e,a)=>{let t=Number(e.params.id),n=w(oo.partial(),e.body);await x(async o=>{let i=(await o.
query("select * from products where id = $1 and company_id = $2 for update",[t,e.ctx.companyId])).rows[0];if(!i)throw v("Produto n\xE3o encontrado");await io(o,e.ctx.companyId,{...i,
...n});let s={...i,...n};if(await o.query(`update products set name=$3, description=$4, sku=$5, kind=$6, unit=$7, price_cents=$8, cost_cents=$9, category_id=$10, sector_id=$11,
         favorite=$12, active=$13, channels=$14, allergens=$15, updated_at=now() where id=$1 and company_id=$2`,[t,e.ctx.companyId,s.name,s.description,s.sku||null,s.kind,s.unit,s.
price_cents,s.cost_cents,s.category_id,s.sector_id,s.favorite,s.active,s.channels,s.allergens]),n.price_cents!=null&&n.price_cents!==i.price_cents&&(await o.query("insert into prod\
uct_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,t,i.price_cents,n.price_cents,e.ctx.userId]),await h(o,e.ctx,"pr\
oduto.preco",{entity:"product",entityId:t,data:{before:i.price_cents,after:n.price_cents}})),n.codes){let r=n.codes.map(_t).filter(Boolean);await o.query("delete from scan_codes wh\
ere company_id = $1 and entity = 'PRODUTO' and entity_id = $2 and not (code = any($3))",[e.ctx.companyId,t,r]);for(let c of r)await Qe(o,e.ctx.companyId,c,"PRODUTO",t)}await so(o,e.
ctx.companyId,t,n.groups),await h(o,e.ctx,"produto.alterado",{entity:"product",entityId:t,data:{...n,groups:n.groups?"alterados":void 0}})}).catch(o=>{throw o.code==="23505"?g("SKU\
 j\xE1 usado em outro produto"):o}),a.json({ok:!0})}));$e.get("/products/:id/prices",y("cardapio.visualizar"),l(async(e,a)=>{a.json((await d(`select h.old_cents, h.new_cents, h.cre\
ated_at, u.name as user_name from product_price_history h left join users u on u.id = h.user_id
                      where h.product_id = $1 and h.company_id = $2 order by h.id desc`,[Number(e.params.id),e.ctx.companyId])).rows)}));$e.delete("/demo",y("configuracoes.gerencia\
r"),l(async(e,a)=>{let t=await x(async n=>{let i=(await n.query("select distinct product_id from order_items where company_id = $1",[e.ctx.companyId])).rows.map(c=>c.product_id),s=await n.
query("update products set active = false, name = name where company_id = $1 and demo and id = any($2) returning id",[e.ctx.companyId,i]);await n.query("delete from scan_codes wher\
e company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo and not (id = any($2)))",[e.ctx.companyId,i]),await n.query("delet\
e from product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 and demo and not (id = any($2)))",[e.ctx.companyId,i]);let r=await n.
query("delete from products where company_id = $1 and demo and not (id = any($2)) returning id",[e.ctx.companyId,i]);return await n.query("delete from categories c where c.company_\
id = $1 and c.demo and not exists (select 1 from products p where p.category_id = c.id)",[e.ctx.companyId]),await h(n,e.ctx,"demonstracao.removida",{data:{removed:r.rowCount,deactivated:s.
rowCount}}),{removed:r.rowCount,deactivated:s.rowCount}});a.json(t)}));import{Router as es}from"npm:express@5.2.1";import{z as Z}from"npm:zod@4.6.5";var Se=es(),ts=e=>Number(e.query.unit_id||e.body?.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;async function Gt(e){let a=ts(e);return a?(be(e.ctx,a),a):(await d("select id from un\
its where company_id = $1 and active order by id limit 1",[e.ctx.companyId])).rows[0]?.id}Se.get("/tables",y("salao.visualizar"),l(async(e,a)=>{let t=await Gt(e),n=e.ctx.can("pdv.r\
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
       from dining_tables t where t.company_id = $1 and t.unit_id = $2 and t.active order by t.number`,[e.ctx.companyId,t]);a.json({unitId:t,tables:o})}));Se.post("/tables",y("sala\
o.gerenciar"),l(async(e,a)=>{let t=w(Z.object({from:Z.number().int().min(1).max(9999),count:Z.number().int().min(1).max(200),area:Z.string().max(40).default("Sal\xE3o"),capacity:Z.
number().int().min(1).max(50).default(4)}),e.body),n=await Gt(e),o=await x(async i=>{let s=await An(i,e.ctx.companyId,n,t.from,t.count);return s.length&&await i.query("update dinin\
g_tables set area = $2, capacity = $3 where id = any($1)",[s,t.area,t.capacity]),await h(i,e.ctx,"mesas.criadas",{unitId:n,data:{from:t.from,count:s.length}}),s});a.status(201).json(
{created:o.length})}));Se.put("/tables/:id",y("salao.visualizar"),l(async(e,a)=>{let t=w(Z.object({status:Z.enum(["livre","ocupada","reservada","conta","limpeza"]).optional(),area:Z.
string().max(40).optional(),capacity:Z.number().int().min(1).max(50).optional(),pos_x:Z.number().int().min(0).max(40).optional(),pos_y:Z.number().int().min(0).max(40).optional(),active:Z.
boolean().optional()}),e.body);if(["area","capacity","pos_x","pos_y","active"].some(i=>i in t)&&!e.ctx.can("salao.gerenciar"))throw f("Sem permiss\xE3o para alterar a estrutura do sal\
\xE3o");if(t.status&&!e.ctx.can("salao.gerenciar")&&!e.ctx.can("pdv.lancar"))throw f("Sem permiss\xE3o para mudar a situa\xE7\xE3o da mesa");if(t.status==="livre"&&(await d("select\
 1 from consumption_sessions where table_id = $1 and company_id = $2 and status in ('aberta','em_fechamento')",[Number(e.params.id),e.ctx.companyId])).rows[0])throw g("Mesa com con\
sumo aberto n\xE3o pode ser liberada");if(!(await d(`update dining_tables set status = coalesce($3,status), area = coalesce($4,area), capacity = coalesce($5,capacity),
                       pos_x = coalesce($6,pos_x), pos_y = coalesce($7,pos_y), active = coalesce($8,active) where id = $1 and company_id = $2 returning unit_id`,[Number(e.params.id),
e.ctx.companyId,t.status??null,t.area??null,t.capacity??null,t.pos_x??null,t.pos_y??null,t.active??null])).rows[0])throw v("Mesa n\xE3o encontrada");await h({query:d},e.ctx,"mesa.a\
lterada",{entity:"table",entityId:e.params.id,data:t}),a.json({ok:!0})}));Se.get("/cards",y("pdv.lancar"),l(async(e,a)=>{let t=await Gt(e),{rows:n}=await d(`select c.id, c.number, \
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
      where c.company_id = $1 and c.unit_id = $2 order by c.number`,[e.ctx.companyId,t]);a.json({unitId:t,cards:n})}));Se.post("/cards",y("comandas.gerenciar"),l(async(e,a)=>{let t=w(
Z.object({from:Z.number().int().min(1).max(999999),count:Z.number().int().min(1).max(1e3)}),e.body),n=await Gt(e),o=await x(async i=>{let s=(await i.query("select coalesce(settings\
->'pdv'->>'card_prefix','CMD-') p from companies where id = $1",[e.ctx.companyId])).rows[0].p,r=await On(i,e.ctx.companyId,n,t.from,t.count,s);return await h(i,e.ctx,"comandas.gera\
das",{unitId:n,data:{from:t.from,count:r.length}}),r});a.status(201).json({created:o})}));Se.post("/cards/:id/block",y("comandas.gerenciar"),l(async(e,a)=>{let t=w(Z.object({reason:Z.
string().trim().min(3).max(200)}),e.body);if(!(await d("update tab_cards set status = 'bloqueado', block_reason = $3 where id = $1 and company_id = $2 returning id",[Number(e.params.
id),e.ctx.companyId,t.reason])).rows[0])throw v();await h({query:d},e.ctx,"comanda.bloqueada",{entity:"card",entityId:e.params.id,reason:t.reason}),a.json({ok:!0})}));Se.post("/car\
ds/:id/unblock",y("comandas.gerenciar"),l(async(e,a)=>{if(!(await d("update tab_cards set status = 'ativo', block_reason = null where id = $1 and company_id = $2 returning id",[Number(
e.params.id),e.ctx.companyId])).rows[0])throw v();await h({query:d},e.ctx,"comanda.desbloqueada",{entity:"card",entityId:e.params.id}),a.json({ok:!0})}));Se.post("/cards/:id/replac\
e",y("comandas.gerenciar"),l(async(e,a)=>{let t=w(Z.object({new_card_id:Z.number().int(),reason:Z.string().trim().min(3).max(200)}),e.body);await x(async n=>{let o=(await n.query("\
select * from tab_cards where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0],i=(await n.query("select * from tab_cards where id = $1 and co\
mpany_id = $2 for update",[t.new_card_id,e.ctx.companyId])).rows[0];if(!o||!i)throw v("Cart\xE3o n\xE3o encontrado");if(i.status!=="ativo")throw f("O novo cart\xE3o est\xE1 bloqueado");
if(o.unit_id!==i.unit_id)throw f("Cart\xF5es de unidades diferentes");if((await n.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechament\
o')",[i.id])).rows[0])throw g("O novo cart\xE3o j\xE1 tem consumo em aberto");await n.query("update tab_cards set status = 'bloqueado', block_reason = $2 where id = $1",[o.id,`Subs\
titu\xEDdo pelo ${i.number}: ${t.reason}`]);let r=await n.query("update consumption_sessions set card_id = $2, version = version + 1 where card_id = $1 and status in ('aberta','em_\
fechamento') returning id",[o.id,i.id]);await h(n,e.ctx,"comanda.substituida",{entity:"card",entityId:o.id,reason:t.reason,data:{new_card:i.id,session:r.rows[0]?.id??null}})}),a.json(
{ok:!0})}));import{Router as rs}from"npm:express@5.2.1";import{z as N}from"npm:zod@4.6.5";var ns={enabled:!0,allow_negative:!0,correction_limit_cents:5e3,correction_max_pct:20,correction_expire_days:7},ze=e=>({...ns,...e?.stock||{}});async function Be(e,a,t){let n=await e.
query(`select stock_item_id, coalesce(sum(qty),0)::numeric as qty from stock_movements
    where company_id = $1 ${t?"and stock_item_id = any($2)":""} group by stock_item_id`,t?[a,t]:[a]);return Object.fromEntries(n.rows.map(o=>[o.stock_item_id,Number(o.qty)]))}var ro=e=>Math.
round(e*1e4)/1e4;async function nt(e,a,t,n,o=[]){let i=new Map,s=(r,c)=>i.set(Number(r),ro((i.get(Number(r))||0)+c));if(t.stock_mode==="acabado"&&t.stock_item_id&&s(t.stock_item_id,
Number(n)),t.stock_mode==="ficha"){let r=(await e.query(`select l.stock_item_id, l.qty, l.loss_pct, r.yield_qty from recipes r join recipe_lines l on l.recipe_id = r.id
      where r.company_id = $1 and r.product_id = $2 and r.active`,[a,t.id])).rows;for(let c of r)s(c.stock_item_id,Number(c.qty)*(1+Number(c.loss_pct)/100)/Number(c.yield_qty)*Number(
n))}if(o.length){let r=(await e.query("select stock_item_id, stock_qty from modifier_options where company_id = $1 and id = any($2) and stock_item_id is not null and stock_qty > 0",
[a,o])).rows;for(let c of r)s(c.stock_item_id,Number(c.stock_qty)*Number(n))}return i}async function Kt(e,a,t,n,o){let i=(await e.query("select settings from companies where id = $\
1",[a.companyId])).rows[0],s=ze(i.settings);if(!s.enabled)return[];let r=await nt(e,a.companyId,n,t.qty,o);if(!r.size)return[];let c=[...r.keys()],u=(await e.query("select id, name\
, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2) order by id for update",[a.companyId,c])).rows;if(!s.allow_negative){let p=await Be(e,a.companyId,c);
for(let _ of u)if((p[_.id]||0)-r.get(Number(_.id))<-1e-4)throw g(`Estoque insuficiente de ${_.name} (saldo ${(p[_.id]||0).toLocaleString("pt-BR")} ${_.unit})`,"stock_insufficient")}
let m=[];for(let p of u){let _=await e.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, user_id)
      values ($1,$2,'venda',$3,$4,'order_item',$5,$6) on conflict do nothing returning id`,[a.companyId,p.id,-r.get(Number(p.id)),p.avg_cost_cents,t.id,a.userId]);_.rows[0]&&m.push(
_.rows[0].id)}return m}async function Ct(e,a,t,n){let o=(await e.query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'order_item' and m.ref_id = $2 an\
d m.kind = 'venda'
    and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`,[a.companyId,t])).rows;for(let i of o)await e.query(`insert into stock_movements (company_id, stock\
_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
      values ($1,$2,'estorno_venda',$3,$4,'order_item_rev',$5,$6,$7,$8)`,[a.companyId,i.stock_item_id,-Number(i.qty),i.unit_cost_cents,t,i.id,n,a.userId]);return o.length}async function wt(e,a,t,n,o,i,s){
let r=(await e.query("select avg_cost_cents from stock_items where id = $1 and company_id = $2 for update",[t,a.companyId])).rows[0],c=(await Be(e,a.companyId,[t]))[t]||0,u=Math.max(
0,c),m=u+n>0?(u*Number(r.avg_cost_cents)+n*o)/(u+n):o;await e.query("update stock_items set avg_cost_cents = $3 where id = $1 and company_id = $2",[t,a.companyId,ro(m)]),await e.query(
`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
    values ($1,$2,'entrada',$3,$4,$5,$6,$7,$8)`,[a.companyId,t,n,o,i?.type??null,i?.id??null,s??null,a.userId])}async function Un(e,a,t){let n=await nt(e,a,t,1,[]);if(!n.size)return Number(
t.cost_cents||0);let o=(await e.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2)",[a,[...n.keys()]])).rows;return Math.round(o.reduce((i,s)=>i+
Number(s.avg_cost_cents)*n.get(Number(s.id)),0))}var _e=e=>String(e??"").replace(/\D/g,"");function as(e){let a=_e(e);if(a.length!==11||/^(\d)\1{10}$/.test(a))return!1;let t=n=>{let o=0;for(let s=0;s<n;s++)o+=Number(a[s])*(n+1-s);
let i=o*10%11;return i===10?0:i};return t(9)===Number(a[9])&&t(10)===Number(a[10])}function Wt(e,{required:a=!1}={}){let t=_e(e);if(!t){if(a)throw f("Informe o CPF");return null}if(!as(
t))throw f("CPF inv\xE1lido","invalid_cpf");return t}var Bn=e=>e?`${e.slice(0,3)}.${e.slice(3,6)}.${e.slice(6,9)}-${e.slice(9)}`:null,os=e=>e?`***.${e.slice(3,6)}.${e.slice(6,9)}-*\
*`:null,is=e=>e?e.replace(/\d(?=\d{4})/g,"*"):null,ss=e=>e?e.replace(/^(.).*(@.*)$/,"$1***$2"):null;function Ve(e,a){if(!e)return e;let t=a.can("dados.pessoais");return{id:e.id,name:e.
name,cpf:t?Bn(e.cpf):os(e.cpf),phone:t?e.phone:is(e.phone),email:t?e.email:ss(e.email),birthday:t?e.birthday:null,address:t?e.address:{},tags:e.tags,preferences:e.preferences,notes:e.
notes,consent_whatsapp:e.consent_whatsapp,consent_email:e.consent_email,unsubscribed:!!e.unsubscribed_at,points:e.points,anonymized:!!e.anonymized_at,created_at:e.created_at,masked:!t,
...e.visits!=null?{visits:e.visits,spent_cents:e.spent_cents,last_visit:e.last_visit}:{}}}var Xt=e=>({enabled:!1,cents_per_point:100,point_value_cents:5,validity_days:365,min_redeem:100,
...e?.loyalty||{}});async function at(e,a,t,n){let o=await e.query(`insert into loyalty_ledger (company_id, customer_id, session_id, kind, points, expires_at, reason, reverses_id, \
payment_id, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[a,t,n.session_id??null,n.kind,n.points,n.expires_at??null,n.reason??null,n.reverses_id??null,n.payment_id??null,n.user_id??
null]);return await e.query("update customers set points = points + $3, updated_at = now() where id = $1 and company_id = $2",[t,a,n.points]),o.rows[0]}async function Vn(e,a,t){let n=await e.
query(`select
       coalesce(sum(l.points) filter (where (l.kind = 'ganho' or o.kind = 'ganho') and coalesce(l.expires_at, o.expires_at) < current_date), 0)::int as vencidos,
       coalesce(-sum(l.points) filter (where l.kind in ('resgate','expiracao') or (l.kind = 'ajuste' and l.points < 0) or o.kind = 'resgate'), 0)::int as usados
     from loyalty_ledger l left join loyalty_ledger o on o.id = l.reverses_id
     where l.company_id = $1 and l.customer_id = $2`,[a,t]),{vencidos:o,usados:i}=n.rows[0],s=o-i;s>0&&await at(e,a,t,{kind:"expiracao",points:-s,reason:"Pontos vencidos"})}async function Yt(e,a,t,n){
if(!t.customer_id)return null;let o=(await e.query("select settings from companies where id = $1",[a.companyId])).rows[0],i=Xt(o.settings);if(!i.enabled)return null;let s=Math.floor(
n/Math.max(1,i.cents_per_point));if(s<=0||(await e.query(`select 1 from loyalty_ledger where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = loyalty_ledger.id)`,[a.companyId,t.id])).rows[0])return null;let c=new Date(Date.now()+i.validity_days*864e5).
toISOString().slice(0,10);return at(e,a.companyId,t.customer_id,{session_id:t.id,kind:"ganho",points:s,expires_at:c,reason:`Consumo ${t.id}`,user_id:a.userId})}async function co(e,a,t,n){
let o=(await e.query(`select * from loyalty_ledger l where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = l.id)`,[a.companyId,t])).rows[0];return o?at(e,a.companyId,o.customer_id,{session_id:t,kind:"estorno",points:-o.
points,reverses_id:o.id,reason:n,user_id:a.userId}):null}async function mo(e,a,t,n,o,i){let s=(await e.query("select points from customers where id = $1 and company_id = $2 for upd\
ate",[t,a.companyId])).rows[0];if(!s)throw f("Cliente n\xE3o encontrado");if(s.points<n)throw g(`Saldo insuficiente: ${s.points} pontos`,"insufficient_points");return at(e,a.companyId,
t,{session_id:i,kind:"resgate",points:-n,payment_id:o,reason:`Resgate no consumo ${i}`,user_id:a.userId})}async function uo(e,a,t){let n=(await e.query(`select * from loyalty_ledge\
r l where company_id = $1 and payment_id = $2 and kind = 'resgate'
    and not exists (select 1 from loyalty_ledger x where x.reverses_id = l.id)`,[a.companyId,t])).rows[0];return n?at(e,a.companyId,n.customer_id,{session_id:n.session_id,kind:"est\
orno",points:-n.points,reverses_id:n.id,reason:"Pagamento com pontos estornado",user_id:a.userId}):null}var lo={credito:"Cr\xE9dito lan\xE7ado",uso_credito:"Uso de cr\xE9dito",fiado:"Fiado",pagamento_fiado:"Pagamento de fiado",estorno:"Estorno",ajuste:"Ajuste"};async function ve(e,a,t){
let n=(await e.query(`select coalesce(sum(amount_cents),0)::bigint as balance,
      min(created_at) filter (where kind = 'fiado') as first_fiado, max(created_at) as last_entry
    from customer_account where company_id = $1 and customer_id = $2`,[a,t])).rows[0],o=Number(n.balance),i=null;if(o<0){let s=(await e.query("select amount_cents, created_at, kind\
 from customer_account where company_id = $1 and customer_id = $2 order by id",[a,t])).rows,r=s.filter(c=>Number(c.amount_cents)>0).reduce((c,u)=>c+Number(u.amount_cents),0);for(let c of s)
if(!(Number(c.amount_cents)>=0)&&(r+=Number(c.amount_cents),r<0)){i=c.created_at;break}}return{balance_cents:o,credit_cents:Math.max(0,o),debt_cents:Math.max(0,-o),open_since:i,last_entry:n.
last_entry}}async function po(e,a,t,n,o,i){if(!t.customer_id)throw g("Identifique o cliente pelo CPF na comanda para usar fiado ou cr\xE9dito","customer_required");let s=(await e.query(
"select id, name, cpf, fiado_limit_cents, anonymized_at from customers where id = $1 and company_id = $2 for update",[t.customer_id,a.companyId])).rows[0];if(!s||s.anonymized_at)throw g(
"Cliente indispon\xEDvel","customer_required");if(!s.cpf)throw g("Cadastre o CPF do cliente para lan\xE7ar fiado ou usar cr\xE9dito","cpf_required");let r=await ve(e,a.companyId,s.
id),c=!1;if(n==="saldo_cliente"){if(o>r.credit_cents)throw g(`Cr\xE9dito dispon\xEDvel: R$ ${(r.credit_cents/100).toFixed(2).replace(".",",")}`,"insufficient_credit")}else{let p=r.
balance_cents-o,_=Number(s.fiado_limit_cents);if(-p>_){if(!a.can("pdv.autorizar"))throw F(`Fiado acima do limite do cliente (R$ ${(_/100).toFixed(2).replace(".",",")}). Pe\xE7a a um g\
erente ou receba de outra forma.`,"fiado_limit");c=!0}}let u=n==="fiado"?"fiado":"uso_credito";return{entry_id:(await e.query(`insert into customer_account (company_id, customer_id\
, kind, amount_cents, session_id, payment_id, over_limit, reason, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[a.companyId,s.id,u,-o,t.id,i,c,u==="fiado"?`Consumo #${t.id}`:`Uso de cr\xE9dito no consumo #${t.id}`,a.userId])).rows[0].id,
over_limit:c,customer_id:s.id,balance_after:r.balance_cents-o}}async function _o(e,a,t,n){let o=(await e.query(`select * from customer_account a where company_id = $1 and payment_i\
d = $2 and reverses_id is null
    and not exists (select 1 from customer_account x where x.reverses_id = a.id)`,[a.companyId,t])).rows[0];return o?(await e.query(`insert into customer_account (company_id, custo\
mer_id, kind, amount_cents, session_id, reverses_id, reason, user_id)
     values ($1,$2,'estorno',$3,$4,$5,$6,$7)`,[a.companyId,o.customer_id,-Number(o.amount_cents),o.session_id,o.id,n||"Estorno do pagamento",a.userId]),o.id):null}var G=rs();async function yo(e,a,t){let n=await e.query("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1 and u.company_id = $2",
[t,a]);if(!n.rows[0])throw f("Unidade inv\xE1lida");return n.rows[0]}G.post("/resolve",y("pdv.lancar"),l(async(e,a)=>{let{code:t}=w(N.object({code:N.string().max(256)}),e.body),n=await zt(
{query:d},e.ctx.companyId,t);n.type==="DESCONHECIDO"&&await h({query:d},e.ctx,"leitura.desconhecida",{data:{code:n.code.slice(0,40)}}),a.json(n)}));G.get("/sessions",y("pdv.lancar"),
l(async(e,a)=>{let t=e.query.status==="all"?null:["aberta","em_fechamento"],n=[e.ctx.companyId],o="s.company_id = $1";t&&(n.push(t),o+=` and s.status = any($${n.length})`);let i=Number(
e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;i&&(n.push(i),o+=` and s.unit_id = $${n.length}`);let{rows:s}=await d(`select s.id, s.kind, s.status, s.label, s.customer_name,\
 s.opened_at, s.version, s.suspended, s.unit_id,
            c.number as card_number, t.number as table_number, s.table_id, s.card_id,
            (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
            (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = s.id and p.status = 'confirmado') as paid_cents,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
      where ${o} order by s.opened_at desc limit 300`,n);a.json(s)}));var cs=N.object({kind:N.enum(["comanda","mesa","balcao","retirada"]),card_id:N.number().int().optional(),card_code:N.
string().max(128).optional(),table_id:N.number().int().optional(),customer_name:N.string().trim().max(80).optional(),customer_id:N.number().int().optional(),label:N.string().trim().
max(60).optional(),unit_id:N.number().int().optional()});async function Hn(e,a,t){V(a,"pdv.abrir_comanda");let n=t.unit_id||a.terminalUnitId||a.unitId,o=null,i=null;if(t.card_code&&
!t.card_id){let m=await zt(e,a.companyId,t.card_code);if(m.type!=="COMANDA")throw f("C\xF3digo n\xE3o \xE9 de comanda");t.card_id=m.card.id}if(t.card_id){let m=(await e.query("sele\
ct * from tab_cards where id = $1 and company_id = $2 for update",[t.card_id,a.companyId])).rows[0];if(!m)throw v("Comanda n\xE3o encontrada");if(m.status!=="ativo")throw g(`Comand\
a ${m.number} bloqueada${m.block_reason?`: ${m.block_reason}`:""}`,"card_blocked");let p=await e.query("select id from consumption_sessions where card_id = $1 and status in ('abert\
a','em_fechamento')",[m.id]);if(p.rows[0])throw g(`Comanda ${m.number} j\xE1 est\xE1 em uso`,"card_busy",{session_id:p.rows[0].id});o=m.id,n=m.unit_id}if(t.table_id){let m=(await e.
query("select * from dining_tables where id = $1 and company_id = $2 and active",[t.table_id,a.companyId])).rows[0];if(!m)throw v("Mesa n\xE3o encontrada");if(n&&m.unit_id!==n)throw f(
"Mesa e comanda de unidades diferentes");i=m.id,n=m.unit_id}if(t.customer_id){let m=(await e.query("select id, name from customers where id = $1 and company_id = $2 and anonymized_\
at is null",[t.customer_id,a.companyId])).rows[0];if(!m)throw v("Cliente n\xE3o encontrado");t.customer_name=t.customer_name||m.name}if(t.kind==="comanda"&&!o)throw f("Informe a co\
manda");if(t.kind==="mesa"&&!i)throw f("Informe a mesa");n||(n=(await e.query("select id from units where company_id = $1 and active order by id limit 1",[a.companyId])).rows[0]?.id),
be(a,n);let s=await Fe(e,a,n),{day_cutoff:r,timezone:c}=await yo(e,a.companyId,n),u=await e.query(`insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, c\
ustomer_name, label, service_fee_bp, opened_by, business_date, customer_id, delivery_fee_cents)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[a.companyId,n,t.kind,o,i,t.customer_name??null,t.label??null,["balcao","retirada","delivery"].includes(t.kind)?0:
s.service_fee_bp,a.userId,pe(new Date,c,r),t.customer_id??null,t.delivery_fee_cents??0]);return i&&await e.query("update dining_tables set status = 'ocupada' where id = $1 and stat\
us in ('livre','reservada','limpeza')",[i]),await h(e,a,"consumo.aberto",{entity:"session",entityId:u.rows[0].id,unitId:n,data:{kind:t.kind,card:o,table:i}}),u.rows[0]}G.post("/ses\
sions",l(async(e,a)=>{let t=w(cs,e.body),n=await x(o=>Hn(o,e.ctx,t)).catch(o=>{throw o.code==="23505"?g("Comanda j\xE1 est\xE1 em uso","card_busy"):o});a.status(201).json(n)}));async function ds(e,a,t){
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
       from payments p left join users u on u.id = p.user_id where p.session_id = $1 order by p.id`,[t])).rows,s=n.customer_id?{...await ve(e,a.companyId,n.customer_id),fiado_limit_cents:Number(
n.customer_fiado_limit||0),has_cpf:!!n.customer_has_cpf}:null;return{...n,items:o,payments:i,totals:await U(e,t),account:s}}G.get("/sessions/:id",y("pdv.lancar"),l(async(e,a)=>{a.json(
await ds({query:d},e.ctx,Number(e.params.id)))}));var ms=N.object({session_id:N.number().int(),product_id:N.number().int().optional(),qty:N.number().positive().max(9999).optional(),
option_ids:N.array(N.number().int()).max(40).default([]),notes:N.string().trim().max(200).optional(),launch_mode:N.enum(["manual","continua","dupla","excecao","balcao","delivery"]),
idempotency_key:N.string().regex(/^[A-Za-z0-9_-]{8,80}$/),scan:N.object({card_code:N.string().max(128).optional(),product_code:N.string().max(128).optional()}).optional(),price_override_cents:N.
number().int().min(0).max(1e8).optional(),discount_cents:N.number().int().min(0).max(1e8).optional(),authorization:N.string().max(100).optional(),exception_reason:N.string().trim().
max(200).optional()});G.post("/items",y("pdv.lancar"),l(async(e,a)=>{let t=w(ms,e.body),n=e.ctx,o=await d("select * from order_items where company_id = $1 and idempotency_key = $2",
[n.companyId,t.idempotency_key]);if(o.rows[0]){if(Number(o.rows[0].session_id)!==t.session_id)throw g("Chave de opera\xE7\xE3o j\xE1 usada em outro lan\xE7amento","idempotency_mism\
atch");return a.json({item:o.rows[0],replay:!0,totals:await U({query:d},t.session_id)})}let i=await x(async s=>{let r=await Q(s,n.companyId,t.session_id);be(n,r.unit_id),et(r);let c=await Fe(
s,n,r.unit_id),u=t.product_id,m=null;if(t.launch_mode==="dupla"||t.launch_mode==="continua"){if(!c.scanner_enabled)throw F("Leitor desabilitado nesta configura\xE7\xE3o","scanner_d\
isabled");if(t.launch_mode==="continua"&&c.double_read_mandatory)throw F("Dupla leitura obrigat\xF3ria: leitura cont\xEDnua n\xE3o permitida","double_read_required");let B=await zt(
s,n.companyId,t.scan?.product_code);if(B.type!=="PRODUTO")throw f("C\xF3digo lido n\xE3o \xE9 de produto","not_a_product");if(u&&u!==B.product.id)throw f("Produto informado difere \
do c\xF3digo lido");if(u=B.product.id,t.launch_mode==="dupla"){let ae=await zt(s,n.companyId,t.scan?.card_code);if(ae.type!=="COMANDA")throw f("Dupla leitura exige a leitura da com\
anda antes do produto","card_required");if(Number(ae.card.id)!==Number(r.card_id))throw g("Comanda lida n\xE3o corresponde ao consumo de destino","card_mismatch")}}else if(t.launch_mode===
"excecao"){if(!c.allow_manual_exception)throw F("Exce\xE7\xE3o manual desabilitada","exception_disabled");if(V(n,"pdv.excecao_dupla_leitura"),!t.exception_reason)throw f("Informe o\
 motivo da exce\xE7\xE3o");c.exception_requires_manager&&(m=(await Xe(s,n,t.authorization,"excecao_dupla_leitura")).authorized_by)}else if(t.launch_mode==="delivery"){if(V(n,"deliv\
ery.gerenciar"),r.kind!=="delivery")throw f("Lan\xE7amento de delivery s\xF3 em pedidos de delivery")}else{if(c.double_read_mandatory)throw F("Dupla leitura obrigat\xF3ria: use a exce\
\xE7\xE3o autorizada para lan\xE7ar manualmente","double_read_required");if(!c.allow_manual)throw F("Lan\xE7amento manual desabilitado","manual_disabled");V(n,"pdv.lancamento_manua\
l")}if(!u)throw f("Informe o produto");let p=(await s.query("select * from products where id = $1 and company_id = $2",[u,n.companyId])).rows[0];if(!p)throw v("Produto n\xE3o encontra\
do");if(!p.active)throw g(`${p.name} est\xE1 indispon\xEDvel`,"product_inactive");let _=t.qty,$=t.launch_mode==="dupla"||t.launch_mode==="continua";if(p.kind==="weight"){if(!_)throw f(
`${p.name} \xE9 vendido por peso: informe o peso`,"weight_required")}else{if(_=_??($?c.qty_per_scan:1),!Number.isInteger(_))throw f("Quantidade deve ser inteira para este produto");
if($&&_!==c.qty_per_scan&&(V(n,"pdv.alterar_quantidade"),_>c.max_qty_per_scan))throw f(`Quantidade por leitura limitada a ${c.max_qty_per_scan}`)}let k=(await s.query(`select g.id,\
 g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active
        where g.product_id = $1 group by g.id order by g.sort, g.id`,[p.id])).rows,j=[];for(let B of k){let ae=B.options.filter(De=>t.option_ids.includes(De.id));if(ae.length<B.min_select)
throw f(`Escolha ${B.min_select===1?"uma op\xE7\xE3o":`${B.min_select} op\xE7\xF5es`} em "${B.name}"`,"options_required");if(ae.length>B.max_select)throw f(`No m\xE1ximo ${B.max_select}\
 em "${B.name}"`);for(let De of ae)j.push({group:B.name,id:De.id,name:De.name,price_cents:De.price_cents})}if(j.length!==new Set(t.option_ids).size)throw f("Op\xE7\xE3o inv\xE1lida para est\
e produto");let C=j.reduce((B,ae)=>B+ae.price_cents,0),R=p.price_cents,S={};t.price_override_cents!=null&&t.price_override_cents!==p.price_cents&&(n.can("pdv.alterar_preco")||await Xe(
s,n,t.authorization,"alterar_preco"),R=t.price_override_cents,S.price={from:p.price_cents,to:R});let A=t.discount_cents||0;A&&(n.can("pdv.desconto")||await Xe(s,n,t.authorization,"\
desconto"),S.discount=A);let J=kt(R,_,C,A);if(A>kt(R,_,C,0))throw f("Desconto maior que o valor do item");let K=(await s.query(`insert into order_items (company_id, session_id, pro\
duct_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, case when $19::boolean then now() end) returning *`,[n.companyId,r.id,p.id,p.name,_,p.unit,R,JSON.stringify(
j),C,A,J,t.notes??null,p.sector_id,p.sector_id?"novo":"nao_produz",t.launch_mode,n.terminalId,n.userId,t.idempotency_key,!!p.sector_id&&c.kitchen_send!=="lote"&&r.kind!=="delivery"])).
rows[0];return await Kt(s,n,K,p,j.map(B=>B.id)),await s.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),(t.launch_mode==="excecao"||Object.keys(
S).length)&&await h(s,n,t.launch_mode==="excecao"?"pdv.excecao_manual":"pdv.item_ajustado",{entity:"item",entityId:K.id,unitId:r.unit_id,reason:t.exception_reason,data:{session:r.id,
product:p.id,authorized_by:m,...S}}),{item:K,totals:await U(s,r.id),confirmation:{product:p.name,qty:_,unit_price_cents:R+C,total_cents:J,destination:r.card_id?`Comanda ${(await s.
query("select number from tab_cards where id = $1",[r.card_id])).rows[0].number}`:r.label||`Consumo ${r.id}`}}}).catch(async s=>{if(s.code==="23505"){let r=await d("select * from o\
rder_items where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(r.rows[0])return{item:r.rows[0],replay:!0,totals:await U({query:d},r.rows[0].session_id)}}
throw s});a.status(i.replay?200:201).json(i)}));G.get("/items/by-key/:key",y("pdv.lancar"),l(async(e,a)=>{let t=await d("select * from order_items where company_id = $1 and idempot\
ency_key = $2",[e.ctx.companyId,String(e.params.key).slice(0,80)]);a.json({found:!!t.rows[0],item:t.rows[0]||null})}));G.post("/items/:id/cancel",y("pdv.lancar"),l(async(e,a)=>{let t=w(
N.object({reason:N.string().trim().min(3).max(200),authorization:N.string().max(100).optional()}),e.body),n=await x(async o=>{let i=(await o.query("select * from order_items where \
id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Item n\xE3o encontrado");let s=await Q(o,e.ctx.companyId,i.session_id);et(s);let r=(await o.
query("select * from order_items where id = $1 for update",[i.id])).rows[0];if(r.status!=="ativo")throw g("Item j\xE1 cancelado");let c=null;e.ctx.can("pdv.cancelar_item")||(c=(await Xe(
o,e.ctx,t.authorization,"cancelar_item")).authorized_by);let u=["preparando","pronto","entregue"].includes(r.kitchen_status);if(await o.query(`update order_items set status = 'canc\
elado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where id = $1`,[r.id,t.reason,e.ctx.userId]),(await U(o,s.id)).
balance<0)throw g("Cancelar este item deixaria o consumo com pagamento maior que o total. Estorne o pagamento antes.","overpaid");return await o.query("update consumption_sessions \
set version = version + 1 where id = $1",[s.id]),u||await Ct(o,e.ctx,r.id,`Cancelamento: ${t.reason}`),await h(o,e.ctx,"pdv.item_cancelado",{entity:"item",entityId:r.id,unitId:s.unit_id,
reason:t.reason,data:{session:s.id,total_cents:r.total_cents,after_preparation:u,kitchen_status:r.kitchen_status,authorized_by:c}}),{ok:!0,after_preparation:u,totals:await U(o,s.id)}});
a.json(n)}));G.post("/items/transfer",y("pdv.transferir_item"),l(async(e,a)=>{let t=w(N.object({item_ids:N.array(N.number().int()).min(1).max(200),target_session_id:N.number().int(),
reason:N.string().trim().min(3).max(200)}),e.body);a.json(await x(n=>fo(n,e.ctx,t.item_ids,t.target_session_id,t.reason)))}));async function fo(e,a,t,n,o){let i=(await e.query("sel\
ect * from order_items where id = any($1) and company_id = $2 and status = 'ativo'",[t,a.companyId])).rows;if(i.length!==new Set(t).size)throw f("Itens inv\xE1lidos ou j\xE1 cancelados");
let s=[...new Set(i.map(m=>Number(m.session_id)))],r=[...s,n].sort((m,p)=>m-p),c={};for(let m of r)c[m]=await Q(e,a.companyId,m);let u=c[n];et(u);for(let m of s){let p=c[m];if(et(p),
m===n)throw f("Origem e destino iguais");if(p.unit_id!==u.unit_id)throw f("Transfer\xEAncia entre unidades n\xE3o permitida")}for(let m of i){let p=await e.query(`insert into order\
_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, transferred_from)
       select company_id, $2, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents, total_cents, notes,
              sector_id, kitchen_status, launch_mode, $3, $4, idempotency_key || '-t' || $5, id from order_items where id = $1 returning id`,[m.id,n,a.terminalId,a.userId,String(m.
id)]);await e.query("update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now() where id = $1",[m.id,`Transferido para consumo ${n} (ite\
m ${p.rows[0].id})`,a.userId])}for(let m of s){if((await U(e,m)).balance<0)throw g("A origem ficaria com pagamento maior que o consumo. Estorne antes de transferir.","overpaid");await e.
query("update consumption_sessions set version = version + 1 where id = $1",[m])}return await e.query("update consumption_sessions set version = version + 1 where id = $1",[n]),await h(
e,a,"pdv.itens_transferidos",{entity:"session",entityId:n,reason:o,data:{items:t,from:s}}),{ok:!0,moved:i.length}}G.post("/sessions/:id/merge",y("pdv.transferir_item"),l(async(e,a)=>{
let t=w(N.object({target_session_id:N.number().int(),reason:N.string().trim().min(3).max(200)}),e.body),n=Number(e.params.id);a.json(await x(async o=>{let i=(await o.query("select \
id from order_items where session_id = $1 and company_id = $2 and status = 'ativo'",[n,e.ctx.companyId])).rows.map(u=>u.id);if(!i.length)throw f("Consumo sem itens para juntar");if((await o.
query("select 1 from payments where session_id = $1 and status = 'confirmado'",[n])).rows[0])throw g("Consumo com pagamento registrado n\xE3o pode ser juntado; transfira os itens rest\
antes","has_payments");let r=await fo(o,e.ctx,i,t.target_session_id,t.reason);if(Number(t.target_session_id)===n)throw f("Escolha um destino diferente da origem");let c=(await o.query(
"select table_id, customer_name from consumption_sessions where id = $1",[n])).rows[0];return await o.query("update consumption_sessions set status = 'cancelada', closed_at = now()\
, closed_by = $2, label = coalesce(label,'') || ' (juntada)' where id = $1",[n,e.ctx.userId]),c.customer_name&&await o.query("update consumption_sessions set customer_name = coales\
ce(customer_name, $2) where id = $1",[t.target_session_id,c.customer_name]),c.table_id&&await Zt(o,c.table_id),r}))}));G.post("/sessions/:id/move-table",y("pdv.transferir_item"),l(
async(e,a)=>{let t=w(N.object({table_id:N.number().int(),reason:N.string().trim().min(3).max(200)}),e.body);await x(async n=>{let o=await Q(n,e.ctx.companyId,Number(e.params.id));et(
o);let i=(await n.query("select * from dining_tables where id = $1 and company_id = $2 and active",[t.table_id,e.ctx.companyId])).rows[0];if(!i)throw v("Mesa n\xE3o encontrada");if(i.
unit_id!==o.unit_id)throw f("Mesa de outra unidade");await n.query("update consumption_sessions set table_id = $2, version = version + 1 where id = $1",[o.id,i.id]),await n.query("\
update dining_tables set status = 'ocupada' where id = $1",[i.id]),o.table_id&&await Zt(n,o.table_id),await h(n,e.ctx,"pdv.mesa_trocada",{entity:"session",entityId:o.id,reason:t.reason,
data:{from:o.table_id,to:i.id}})}),a.json({ok:!0})}));async function Zt(e,a){await e.query(`update dining_tables set status = 'limpeza' where id = $1 and status in ('ocupada','cont\
a')
                  and not exists (select 1 from consumption_sessions where table_id = $1 and status in ('aberta','em_fechamento'))`,[a])}G.post("/sessions/:id/service-fee",y("pdv.l\
ancar"),l(async(e,a)=>{let t=w(N.object({bp:N.number().int().min(0).max(3e3),reason:N.string().trim().min(3).max(200),authorization:N.string().max(100).optional()}),e.body);a.json(
await x(async n=>{let o=await Q(n,e.ctx.companyId,Number(e.params.id));if(!["aberta","em_fechamento"].includes(o.status))throw g("Consumo encerrado");e.ctx.can("pdv.taxa_servico")||
await Xe(n,e.ctx,t.authorization,"taxa_servico");let i=(await U(n,o.id)).paid;await n.query("update consumption_sessions set service_fee_bp = $2, service_fee_removed_reason = $3, v\
ersion = version + 1 where id = $1",[o.id,t.bp,t.reason]);let s=await U(n,o.id);if(i>s.total)throw g("Pagamento registrado supera o novo total. Estorne antes.","overpaid");return await h(
n,e.ctx,"pdv.taxa_servico",{entity:"session",entityId:o.id,reason:t.reason,data:{from:o.service_fee_bp,to:t.bp}}),s}))}));G.post("/sessions/:id/request-close",y("pdv.lancar"),l(async(e,a)=>{
a.json(await x(async t=>{let n=await Q(t,e.ctx.companyId,Number(e.params.id));return et(n),await t.query("update consumption_sessions set status = 'em_fechamento', version = versio\
n + 1 where id = $1",[n.id]),n.table_id&&await t.query("update dining_tables set status = 'conta' where id = $1",[n.table_id]),{ok:!0}}))}));G.post("/sessions/:id/resume",y("pdv.la\
ncar"),l(async(e,a)=>{a.json(await x(async t=>{let n=await Q(t,e.ctx.companyId,Number(e.params.id));if(n.status!=="em_fechamento")throw g("Consumo n\xE3o est\xE1 em fechamento");return await t.
query("update consumption_sessions set status = 'aberta', version = version + 1 where id = $1",[n.id]),n.table_id&&await t.query("update dining_tables set status = 'ocupada' where \
id = $1",[n.table_id]),{ok:!0}}))}));G.post("/sessions/:id/suspend",y("pdv.lancar"),l(async(e,a)=>{let t=w(N.object({suspended:N.boolean()}),e.body);await d("update consumption_ses\
sions set suspended = $3 where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId,t.suspended]),a.json({ok:!0})}));G.get("/sessions/:id/split",y("pdv.lancar"),l(async(e,a)=>{
let t=Math.min(Math.max(Number(e.query.parts)||2,2),50),n=await U({query:d},Number(e.params.id));a.json({parts:wa(Math.max(n.balance,0),t),balance:n.balance})}));G.post("/sessions/\
:id/close",y("pdv.receber"),l(async(e,a)=>{let t=w(N.object({version:N.number().int()}),e.body);a.json(await x(async n=>{let o=await Q(n,e.ctx.companyId,Number(e.params.id));if(!["\
aberta","em_fechamento"].includes(o.status))throw g("Consumo j\xE1 encerrado","already_closed");if(o.version!==t.version)throw g("O consumo foi alterado em outro terminal. Confira \
antes de fechar.","version_conflict",{version:o.version});let i=await U(n,o.id);if(i.balance!==0)throw g(`Saldo pendente de ${(i.balance/100).toFixed(2)}. Receba antes de encerrar.`,
"balance_pending");if(i.items===0)throw f("Consumo sem itens: use cancelar");await n.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2,\
 version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await Zt(n,o.table_id);let s=await Yt(n,e.ctx,o,i.items);return await h(n,e.ctx,"consumo.encerrado",{entity:"\
session",entityId:o.id,unitId:o.unit_id,data:i}),{ok:!0,totals:i,points_earned:s?.points||0}}))}));G.post("/sessions/:id/cancel",y("pdv.lancar"),l(async(e,a)=>{let t=w(N.object({reason:N.
string().trim().min(3).max(200),authorization:N.string().max(100).optional()}),e.body);a.json(await x(async n=>{let o=await Q(n,e.ctx.companyId,Number(e.params.id));if(!["aberta","\
em_fechamento"].includes(o.status))throw g("Consumo j\xE1 encerrado");let i=await U(n,o.id);if(i.paid>0)throw g("H\xE1 pagamentos confirmados: estorne antes de cancelar","has_payme\
nts");let s=null;i.items>0&&!e.ctx.can("pdv.cancelar_venda")&&(s=(await Xe(n,e.ctx,t.authorization,"cancelar_venda")).authorized_by);let r=(await n.query("select id from order_item\
s where session_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','nao_produz')",[o.id])).rows;for(let c of r)await Ct(n,e.ctx,c.id,`Consumo cancelado: ${t.reason}`);
return await n.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end
                    where session_id = $1 and status = 'ativo'`,[o.id,`Consumo cancelado: ${t.reason}`,e.ctx.userId]),await n.query("update consumption_sessions set status = 'cance\
lada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await Zt(n,o.table_id),await h(n,e.ctx,"consumo.cancelado",{entity:"\
session",entityId:o.id,reason:t.reason,data:{items_cents:i.items,authorized_by:s}}),{ok:!0}}))}));G.post("/sessions/:id/reopen",y("pdv.lancar"),l(async(e,a)=>{let t=w(N.object({reason:N.
string().trim().min(3).max(200),authorization:N.string().max(100).optional()}),e.body);a.json(await x(async n=>{let o=await Q(n,e.ctx.companyId,Number(e.params.id));if(o.status!=="\
encerrada")throw g("S\xF3 consumos encerrados podem ser reabertos");let i=null;if(e.ctx.can("pdv.reabrir_comanda")||(i=(await Xe(n,e.ctx,t.authorization,"reabrir_comanda")).authorized_by),
o.card_id&&(await n.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento') and id <> $2",[o.card_id,o.id])).rows[0])throw g("O cart\xE3o\
 j\xE1 est\xE1 em uso por outro consumo. Transfira os itens em vez de reabrir.","card_busy");return await n.query("update consumption_sessions set status = 'aberta', closed_at = nu\
ll, closed_by = null, version = version + 1 where id = $1",[o.id]),await co(n,e.ctx,o.id,"Consumo reaberto"),o.table_id&&await n.query("update dining_tables set status = 'ocupada' \
where id = $1",[o.table_id]),await h(n,e.ctx,"consumo.reaberto",{entity:"session",entityId:o.id,reason:t.reason,data:{authorized_by:i}}),{ok:!0}}))}));async function us(e,a,t){let n=[
a.companyId],o="company_id = $1 and status = 'aberto'";return a.terminalId?(n.push(a.terminalId),o+=` and terminal_id = $${n.length}`):(n.push(a.userId,t),o+=` and user_id = $${n.length-
1} and unit_id = $${n.length} and terminal_id is null`),(await e.query(`select * from cash_sessions where ${o} order by id desc limit 1`,n)).rows[0]}var ls=N.object({method:N.enum(
["dinheiro","pix","debito","credito","vale","outro","fiado","saldo_cliente"]),amount_cents:N.number().int().positive().max(1e8),tendered_cents:N.number().int().positive().max(1e8).
optional(),idempotency_key:N.string().regex(/^[A-Za-z0-9_-]{8,80}$/)});G.post("/sessions/:id/payments",y("pdv.receber"),l(async(e,a)=>{let t=w(ls,e.body),n=e.ctx,o=await d("select \
* from payments where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(o.rows[0])return a.json({payment:o.rows[0],replay:!0,totals:await U({query:d},o.
rows[0].session_id)});let i=await x(async s=>{let r=await Q(s,n.companyId,Number(e.params.id));if(be(n,r.unit_id),!["aberta","em_fechamento"].includes(r.status))throw g("Consumo en\
cerrado","session_not_open");let c=await Fe(s,n,r.unit_id),u=await us(s,n,r.unit_id);if(!u&&c.require_open_cash)throw g("Abra o caixa antes de receber","cash_closed");let m=await U(
s,r.id);if(t.amount_cents>m.balance)throw f(`Valor maior que o saldo (${(m.balance/100).toFixed(2)})`,"over_balance");let p=0;if(t.method==="outro")throw f('A forma "Outro" foi sub\
stitu\xEDda por "Fiado"',"method_retired");if(t.tendered_cents!=null){if(t.method!=="dinheiro")throw f("Troco s\xF3 \xE9 permitido em dinheiro","change_not_allowed");if(t.tendered_cents<
t.amount_cents)throw f("Valor entregue menor que o valor a pagar");p=t.tendered_cents-t.amount_cents}let{day_cutoff:_,timezone:$}=await yo(s,n.companyId,r.unit_id),k=(await s.query(
`insert into payments (company_id, session_id, cash_session_id, method, amount_cents, tendered_cents, change_cents, business_date, idempotency_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[n.companyId,r.id,u?.id??null,t.method,t.amount_cents,t.tendered_cents??null,p,pe(new Date,$,_),t.idempotency_key,n.userId])).
rows[0],j=["fiado","saldo_cliente"].includes(t.method)?await po(s,n,r,t.method,t.amount_cents,k.id):null;return await s.query("update consumption_sessions set version = version + 1\
 where id = $1",[r.id]),await h(s,n,t.method==="fiado"?"pagamento.fiado":"pagamento.registrado",{entity:"payment",entityId:k.id,unitId:r.unit_id,data:{session:r.id,method:t.method,
amount_cents:t.amount_cents,change_cents:p,...j?{cliente:j.customer_id,acima_do_limite:j.over_limit,saldo_conta:j.balance_after}:{}}}),{payment:k,totals:await U(s,r.id),account:j}}).
catch(async s=>{if(s.code==="23505"){let r=await d("select * from payments where company_id = $1 and idempotency_key = $2",[n.companyId,t.idempotency_key]);if(r.rows[0])return{payment:r.
rows[0],replay:!0,totals:await U({query:d},r.rows[0].session_id)}}throw s});a.status(i.replay?200:201).json(i)}));G.post("/payments/:id/refund",y("financeiro.estornar"),l(async(e,a)=>{
let t=w(N.object({reason:N.string().trim().min(3).max(200)}),e.body);a.json(await x(async n=>{let o=(await n.query("select * from payments where id = $1 and company_id = $2",[Number(
e.params.id),e.ctx.companyId])).rows[0];if(!o)throw v("Pagamento n\xE3o encontrado");let i=await Q(n,e.ctx.companyId,o.session_id);if(!["aberta","em_fechamento"].includes(i.status))
throw g("Reabra o consumo antes de estornar","session_closed");if(!(await n.query(`update payments set status = 'estornado', refund_reason = $2, refunded_by = $3, refunded_at = now\
()
                              where id = $1 and status = 'confirmado' returning id`,[o.id,t.reason,e.ctx.userId])).rows[0])throw g("Pagamento j\xE1 estornado");return await n.query(
"update consumption_sessions set version = version + 1 where id = $1",[i.id]),await uo(n,e.ctx,o.id),await _o(n,e.ctx,o.id,t.reason),await h(n,e.ctx,"pagamento.estornado",{entity:"\
payment",entityId:o.id,reason:t.reason,data:{amount_cents:o.amount_cents,method:o.method}}),{ok:!0,totals:await U(n,i.id)}}))}));G.post("/sessions/:id/send",y("pdv.lancar"),l(async(e,a)=>{
a.json(await x(async t=>{let n=await Q(t,e.ctx.companyId,Number(e.params.id));be(e.ctx,n.unit_id);let o=await t.query(`update order_items set sent_at = now() where session_id = $1 \
and status = 'ativo' and sent_at is null
      and kitchen_status = 'novo' returning id`,[n.id]);return o.rowCount&&await h(t,e.ctx,"producao.lote_enviado",{entity:"session",entityId:n.id,data:{items:o.rowCount}}),{sent:o.
rowCount}}))}));G.post("/mode",y("pdv.lancar"),l(async(e,a)=>{let t=w(N.object({from:N.enum(["manual","continua","dupla"]),to:N.enum(["manual","continua","dupla"]),reason:N.string().
trim().max(200).optional()}),e.body),n=await Fe({query:d},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId);if(t.from!==t.to){if(V(e.ctx,"pdv.alterar_modo"),!n.allow_mode_change)throw F("T\
roca de modo desabilitada nesta configura\xE7\xE3o","mode_locked");if(n.double_read_mandatory&&t.to!=="dupla")throw F("Dupla leitura obrigat\xF3ria: use a exce\xE7\xE3o autorizada",
"double_read_required");if(!n.scanner_enabled&&t.to!=="manual")throw F("Leitor desabilitado","scanner_disabled")}await h({query:d},e.ctx,"pdv.modo_alterado",{reason:t.reason,data:{
from:t.from,to:t.to}}),a.json({ok:!0,mode:t.to})}));import{Router as ps}from"npm:express@5.2.1";import{z as ce}from"npm:zod@4.6.5";var He=ps(),Jn=["dinheiro","pix","debito","credito","vale","outro"],wo=["fiado","saldo_cliente"];async function Qt(e,a){let t=(await e.query("select opening_cents from cash_session\
s where id = $1",[a])).rows[0],n=(await e.query("select method, coalesce(sum(amount_cents),0)::bigint as total from payments where cash_session_id = $1 and status = 'confirmado' gr\
oup by method",[a])).rows,o=(await e.query("select kind, coalesce(sum(amount_cents),0)::bigint as total from cash_movements where cash_session_id = $1 group by kind",[a])).rows,i=(await e.
query("select method, coalesce(sum(amount_cents),0)::bigint as total from customer_account where cash_session_id = $1 and method is not null group by method",[a])).rows,s=Object.fromEntries(
Jn.map(m=>[m,0])),r=Object.fromEntries(wo.map(m=>[m,0]));for(let m of n)wo.includes(m.method)?r[m.method]=Number(m.total):s[m.method]=Number(m.total);let c={};for(let m of i)s[m.method]+=
Number(m.total),c[m.method]=Number(m.total);let u=Object.fromEntries(o.map(m=>[m.kind,Number(m.total)]));return s.dinheiro=t.opening_cents+s.dinheiro+(u.suprimento||0)-(u.sangria||
0)-(u.despesa||0),{byMethod:s,opening:t.opening_cents,movements:u,info:r,account_in:c}}async function ho(e){let a=[e.ctx.companyId],t="c.company_id = $1 and c.status = 'aberto'";return e.
ctx.terminalId?(a.push(e.ctx.terminalId),t+=` and c.terminal_id = $${a.length}`):(a.push(e.ctx.userId),t+=` and c.user_id = $${a.length} and c.terminal_id is null`),(await d(`selec\
t c.*, u.name as user_name from cash_sessions c join users u on u.id = c.user_id where ${t} order by c.id desc limit 1`,a)).rows[0]}He.get("/current",l(async(e,a)=>{let t=await ho(
e);if(!t)return a.json({open:!1});let n=e.ctx.can("financeiro.visualizar");a.json({open:!0,cash:{id:t.id,opened_at:t.opened_at,user_name:t.user_name,opening_cents:t.opening_cents,business_date:t.
business_date},expected:n?await Qt({query:d},t.id):null})}));He.post("/open",y("caixa.abrir"),l(async(e,a)=>{let t=w(ce.object({opening_cents:ce.number().int().min(0).max(1e7)}),e.
body),n=e.ctx.terminalUnitId||e.ctx.unitId||(await d("select id from units where company_id = $1 order by id limit 1",[e.ctx.companyId])).rows[0].id;if(!e.ctx.terminalId&&(await d(
"select 1 from terminals where company_id = $1 and active limit 1",[e.ctx.companyId])).rows[0])throw f("Identifique o terminal deste dispositivo antes de abrir o caixa","terminal_r\
equired");if(await ho(e))throw g("J\xE1 existe caixa aberto neste terminal","cash_open");let o=(await d("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.c\
ompany_id where u.id = $1",[n])).rows[0],i=await d("insert into cash_sessions (company_id, unit_id, terminal_id, user_id, opening_cents, business_date) values ($1,$2,$3,$4,$5,$6) r\
eturning id",[e.ctx.companyId,n,e.ctx.terminalId,e.ctx.userId,t.opening_cents,pe(new Date,o.timezone,o.day_cutoff)]).catch(s=>{throw s.code==="23505"?g("J\xE1 existe caixa aberto nest\
e terminal","cash_open"):s});await h({query:d},e.ctx,"caixa.aberto",{entity:"cash",entityId:i.rows[0].id,unitId:n,data:t}),a.status(201).json({id:i.rows[0].id})}));He.post("/:id/mo\
vements",l(async(e,a)=>{let t=w(ce.object({kind:ce.enum(["sangria","suprimento","despesa"]),amount_cents:ce.number().int().positive().max(1e7),reason:ce.string().trim().min(3).max(
200)}),e.body);V(e.ctx,t.kind==="suprimento"?"caixa.suprimento":"caixa.sangria");let n=await x(async o=>{let i=(await o.query("select * from cash_sessions where id = $1 and company\
_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Caixa n\xE3o encontrado");if(i.status!=="aberto")throw g("Caixa fechado");if(t.kind!=="supriment\
o"){let r=await Qt(o,i.id);if(t.amount_cents>r.byMethod.dinheiro)throw f("Valor maior que o dinheiro esperado na gaveta")}let s=await o.query("insert into cash_movements (company_i\
d, cash_session_id, kind, amount_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,i.id,t.kind,t.amount_cents,t.reason,e.ctx.userId]);return await h(
o,e.ctx,`caixa.${t.kind}`,{entity:"cash",entityId:i.id,reason:t.reason,data:{amount_cents:t.amount_cents}}),{id:s.rows[0].id}});a.status(201).json(n)}));He.post("/:id/close",y("cai\
xa.fechar"),l(async(e,a)=>{let t=w(ce.object({counted:ce.object(Object.fromEntries(Jn.map(o=>[o,ce.number().int().min(0).max(1e8).default(0)]))),notes:ce.record(ce.string(),ce.number().
int().min(0).max(1e5)).optional(),justification:ce.string().trim().max(300).optional()}),e.body),n=await x(async o=>{let i=(await o.query("select * from cash_sessions where id = $1\
 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Caixa n\xE3o encontrado");if(i.status!=="aberto")throw g("Caixa j\xE1 fechado");let s=await Qt(
o,i.id),r=Object.fromEntries(Jn.map(u=>[u,(t.counted[u]||0)-(s.byMethod[u]||0)])),c=Object.values(r).reduce((u,m)=>u+m,0);if(Object.values(r).some(u=>u!==0)&&!t.justification)throw f(
"H\xE1 diferen\xE7a na confer\xEAncia: informe a justificativa","justification_required");return await o.query(`update cash_sessions set status = 'fechado', closed_at = now(), clos\
ed_by = $2, counted = $3, expected = $4,
                      difference_cents = $5, justification = $6 where id = $1`,[i.id,e.ctx.userId,{...t.counted,notes:t.notes??null},s.byMethod,c,t.justification??null]),await h(o,
e.ctx,"caixa.fechado",{entity:"cash",entityId:i.id,reason:t.justification,data:{difference_cents:c,by_method:r}}),{ok:!0,expected:s.byMethod,counted:t.counted,difference_cents:c,by_method:r}});
a.json(n)}));He.post("/:id/reopen",y("caixa.reabrir"),l(async(e,a)=>{let t=w(ce.object({reason:ce.string().trim().min(3).max(200)}),e.body);await x(async n=>{let o=(await n.query("\
select * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw v();if(o.status!=="fechado")throw g("Caixa n\xE3o\
 est\xE1 fechado");if(new Date(o.closed_at)<new Date(Date.now()-48*3600*1e3))throw f("Reabertura permitida at\xE9 48 horas ap\xF3s o fechamento");if((o.terminal_id?await n.query("s\
elect 1 from cash_sessions where terminal_id = $1 and status = 'aberto'",[o.terminal_id]):{rows:[]}).rows[0])throw g("J\xE1 existe outro caixa aberto neste terminal");await n.query(
"update cash_sessions set status = 'aberto', closed_at = null, closed_by = null where id = $1",[o.id]),await h(n,e.ctx,"caixa.reaberto",{entity:"cash",entityId:o.id,reason:t.reason,
data:{previous:{counted:o.counted,difference_cents:o.difference_cents,closed_at:o.closed_at}}})}),a.json({ok:!0})}));He.get("/",y("financeiro.visualizar"),l(async(e,a)=>{a.json((await d(
`select c.id, c.status, c.opened_at, c.closed_at, c.business_date, c.opening_cents, c.difference_cents, c.justification,
                            u.name as user_name, t.name as terminal_name
                       from cash_sessions c join users u on u.id = c.user_id left join terminals t on t.id = c.terminal_id
                      where c.company_id = $1 order by c.id desc limit 100`,[e.ctx.companyId])).rows)}));He.get("/:id/report",y("financeiro.visualizar"),l(async(e,a)=>{let t=(await d(
"select * from cash_sessions where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw v();let n=(await d("select m.kind, m.amount_cents, m.rea\
son, m.created_at, u.name user_name from cash_movements m left join users u on u.id = m.user_id where cash_session_id = $1 order by m.id",[t.id])).rows;a.json({cash:t,expected:await Qt(
{query:d},t.id),movements:n})}));import{Router as _s}from"npm:express@5.2.1";var en=_s();en.get("/dashboard",l(async(e,a)=>{let t=e.ctx,n=(await d("select id, day_cutoff from units where company_id = $1 and ($2::bigint is null or id = $2) order by id limit \
1",[t.companyId,t.terminalUnitId||t.unitId||null])).rows[0],o=pe(new Date,t.company.timezone,n?.day_cutoff??5),i=t.can("financeiro.visualizar"),s=(await d(`select
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
"agente","fiscal","relatorios"]})}));en.get("/search",l(async(e,a)=>{let t=String(e.query.q||"").trim().slice(0,60);if(t.length<2)return a.json([]);let n=e.ctx,o=`%${t}%`,i=[];if(n.
can("cardapio.visualizar")){let s=await d("select id, name from products where company_id = $1 and (name ilike $2 or sku = $3) order by name limit 6",[n.companyId,o,t]);i.push(...s.
rows.map(r=>({type:"produto",id:r.id,label:r.name,to:`/cardapio?produto=${r.id}`})))}if(n.can("pdv.lancar")){let s=Number(t.replace(/\D/g,""));if(s){let c=await d(`select s.id, c.n\
umber card, t.number tbl, s.status from consumption_sessions s left join tab_cards c on c.id = s.card_id
                          left join dining_tables t on t.id = s.table_id
                          where s.company_id = $1 and (c.number = $2 or t.number = $2 or s.id = $2) and s.status in ('aberta','em_fechamento') limit 6`,[n.companyId,s]);i.push(...c.
rows.map(u=>({type:"consumo",id:u.id,label:u.card?`Comanda ${u.card}`:u.tbl?`Mesa ${u.tbl}`:`Consumo ${u.id}`,to:`/pdv?sessao=${u.id}`})))}let r=await d(`select s.id, s.customer_na\
me, s.label from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')
                         and (s.customer_name ilike $2 or s.label ilike $2) limit 5`,[n.companyId,o]);i.push(...r.rows.map(c=>({type:"consumo",id:c.id,label:c.customer_name||c.label,
to:`/pdv?sessao=${c.id}`})))}if(n.can("usuarios.gerenciar")){let s=await d("select id, name from users where company_id = $1 and name ilike $2 limit 4",[n.companyId,o]);i.push(...s.
rows.map(r=>({type:"usuario",id:r.id,label:r.name,to:"/configuracoes/usuarios"})))}a.json(i)}));import{Router as ys}from"npm:express@5.2.1";import{z as P}from"npm:zod@4.6.5";var de=ys(),go=P.object({name:P.string().trim().min(2).max(100),cpf:P.string().max(20).optional().nullable(),phone:P.string().trim().max(30).optional().nullable(),email:P.string().
trim().email().max(120).optional().nullable().or(P.literal("")),birthday:P.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(P.literal("")),address:P.object({street:P.
string().max(120).optional(),number:P.string().max(20).optional(),district:P.string().max(80).optional(),city:P.string().max(80).optional(),complement:P.string().max(80).optional(),
reference:P.string().max(120).optional()}).partial().optional(),tags:P.array(P.string().trim().min(1).max(30)).max(20).optional(),preferences:P.string().max(300).optional().nullable(),
notes:P.string().max(500).optional().nullable(),consent_whatsapp:P.boolean().optional(),consent_email:P.boolean().optional()}),bo=e=>{let a=_e(e);return a?a.slice(-13):null};async function $o(e,a,t){
if(!t.length)return{};let n=await e.query(`select s.customer_id, count(*)::int as visits, max(s.closed_at) as last_visit,
            coalesce(sum((select coalesce(sum(i.total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo')),0)::bigint as spent_cents
       from consumption_sessions s where s.company_id = $1 and s.customer_id = any($2) and s.status = 'encerrada' group by s.customer_id`,[a,t]);return Object.fromEntries(n.rows.map(
o=>[o.customer_id,o]))}de.get("/lookup",y("clientes.visualizar"),l(async(e,a)=>{let t=Wt(e.query.cpf,{required:!0}),n=(await d("select * from customers where company_id = $1 and cp\
f = $2 and anonymized_at is null",[e.ctx.companyId,t])).rows[0];if(!n)return a.json({found:!1,cpf:Bn(t)});let o=(await d(`select s.id, s.kind, t.number as table_number, cd.number a\
s card_number from consumption_sessions s
      left join dining_tables t on t.id = s.table_id left join tab_cards cd on cd.id = s.card_id
     where s.company_id = $1 and s.customer_id = $2 and s.status in ('aberta','em_fechamento') limit 3`,[e.ctx.companyId,n.id])).rows;a.json({found:!0,customer:{id:n.id,name:n.name,
points:n.points,tags:n.tags,preferences:n.preferences},open_sessions:o})}));de.get("/",y("clientes.visualizar"),l(async(e,a)=>{let t=[e.ctx.companyId],n="c.company_id = $1 and c.an\
onymized_at is null",o=String(e.query.q||"").trim().slice(0,80);if(o){let m=_e(o);t.push(`%${o.toLowerCase()}%`),n+=` and (lower(c.name) like $${t.length}`,m.length>=3&&(t.push(`%${m}\
%`),n+=` or c.cpf like $${t.length} or regexp_replace(coalesce(c.phone,''),'\\D','','g') like $${t.length}`),n+=")"}e.query.tag&&(t.push(String(e.query.tag)),n+=` and $${t.length} \
= any(c.tags)`),e.query.birthday==="mes"&&(n+=" and extract(month from c.birthday) = extract(month from current_date)");let i=Math.min(200,Number(e.query.limit)||50),s=Math.max(0,Number(
e.query.offset)||0),r=(await d(`select count(*)::int as n from customers c where ${n}`,t)).rows[0].n,c=(await d(`select c.* from customers c where ${n} order by lower(c.name) limit\
 ${i} offset ${s}`,t)).rows,u=await $o({query:d},e.ctx.companyId,c.map(m=>m.id));a.json({total:r,items:c.map(m=>Ve({...m,...u[m.id]||{visits:0,spent_cents:0,last_visit:null}},e.ctx))})}));
de.get("/summary",y("clientes.visualizar"),l(async(e,a)=>{let t=(await d(`select count(*)::int as total,
      count(*) filter (where extract(month from birthday) = extract(month from current_date))::int as birthdays,
      count(*) filter (where consent_whatsapp and unsubscribed_at is null)::int as whatsapp_ok,
      coalesce(sum(points),0)::int as points
    from customers where company_id = $1 and anonymized_at is null`,[e.ctx.companyId])).rows[0],n=(await d("select t as tag, count(*)::int as n from customers, unnest(tags) t where\
 company_id = $1 and anonymized_at is null group by t order by n desc limit 20",[e.ctx.companyId])).rows,o=(await d("select settings from companies where id = $1",[e.ctx.companyId])).
rows[0];a.json({...t,tags:n,loyalty:Xt(o.settings)})}));de.put("/loyalty",y("clientes.gerenciar","configuracoes.gerenciar"),l(async(e,a)=>{let t=w(P.object({enabled:P.boolean(),cents_per_point:P.
number().int().min(1).max(1e5),point_value_cents:P.number().int().min(1).max(1e4),validity_days:P.number().int().min(7).max(3650),min_redeem:P.number().int().min(1).max(1e5)}),e.body);
await d("update companies set settings = jsonb_set(settings, '{loyalty}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await h({query:d},e.ctx,"fidelidade.configu\
racao",{data:t}),a.json({ok:!0})}));de.get("/:id",y("clientes.visualizar"),l(async(e,a)=>{let t=Number(e.params.id);await x(u=>Vn(u,e.ctx.companyId,t));let n=(await d("select * fro\
m customers where id = $1 and company_id = $2",[t,e.ctx.companyId])).rows[0];if(!n)throw v("Cliente n\xE3o encontrado");let o=(await $o({query:d},e.ctx.companyId,[t]))[t]||{visits:0,
spent_cents:0,last_visit:null},i=(await d(`select s.id, s.kind, s.opened_at, s.closed_at, s.status,
       (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
       (select string_agg(i.description, ', ' order by i.id) from (select description, id from order_items where session_id = s.id and status = 'ativo' limit 6) i) as items
     from consumption_sessions s where s.company_id = $1 and s.customer_id = $2 order by s.opened_at desc limit 30`,[e.ctx.companyId,t])).rows,s=(await d("select id, kind, points, \
expires_at, reason, session_id, created_at from loyalty_ledger where company_id = $1 and customer_id = $2 order by id desc limit 50",[e.ctx.companyId,t])).rows,r=(await d("select i\
d, score, comment, created_at from reviews where company_id = $1 and customer_id = $2 order by id desc limit 10",[e.ctx.companyId,t])).rows,c=o.visits?Math.round(Number(o.spent_cents)/
o.visits):0;a.json({customer:Ve({...n,...o},e.ctx),ticket_cents:c,history:i,ledger:s,reviews:r})}));function vo(e,a){return{cpf:e.cpf!==void 0?Wt(e.cpf):void 0,phone:e.phone!==void 0?
e.phone||null:void 0,email:e.email!==void 0?e.email||null:void 0,birthday:e.birthday!==void 0?e.birthday||null:void 0,consent_at:e.consent_whatsapp||e.consent_email?new Date:void 0,
by:a.userId}}async function fs(e,a,t){let n=vo(t,a);if(n.phone&&bo(n.phone).length<10)throw f("Telefone deve ter DDD");let o=await e.query(`insert into customers (company_id, cpf, \
name, phone, email, birthday, address, tags, preferences, notes, consent_whatsapp, consent_email, consent_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,[a.companyId,n.cpf??null,t.name,n.phone??null,n.email??null,n.birthday??null,t.address||{},t.tags||[],t.preferences??
null,t.notes??null,!!t.consent_whatsapp,!!t.consent_email,n.consent_at??null,a.userId]).catch(i=>{throw i.code==="23505"?g("J\xE1 existe cliente com este CPF","cpf_in_use"):i});return await h(
e,a,"cliente.criado",{entity:"customer",entityId:o.rows[0].id,data:{consent_whatsapp:!!t.consent_whatsapp,consent_email:!!t.consent_email}}),o.rows[0]}de.post("/",y("clientes.geren\
ciar"),l(async(e,a)=>{let t=w(go,e.body),n=await x(o=>fs(o,e.ctx,t));a.status(201).json(Ve(n,e.ctx))}));de.put("/:id",y("clientes.gerenciar"),l(async(e,a)=>{let t=w(go.partial(),e.
body),n=Number(e.params.id),o=await x(async i=>{let s=(await i.query("select * from customers where id = $1 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!s)throw v(
"Cliente n\xE3o encontrado");if(s.anonymized_at)throw g("Cliente anonimizado n\xE3o pode ser editado");if(!e.ctx.can("dados.pessoais"))for(let m of["cpf","phone","email","birthday",
"address"])delete t[m];let r=vo(t,e.ctx),c=t.consent_whatsapp!==void 0&&t.consent_whatsapp!==s.consent_whatsapp||t.consent_email!==void 0&&t.consent_email!==s.consent_email,u=await i.
query(`update customers set name = coalesce($3,name), cpf = case when $4::boolean then $5 else cpf end, phone = case when $6::boolean then $7 else phone end,
         email = case when $8::boolean then $9 else email end, birthday = case when $10::boolean then $11::date else birthday end,
         address = coalesce($12,address), tags = coalesce($13,tags), preferences = coalesce($14,preferences), notes = coalesce($15,notes),
         consent_whatsapp = coalesce($16,consent_whatsapp), consent_email = coalesce($17,consent_email),
         consent_at = case when $18::boolean then now() else consent_at end,
         unsubscribed_at = case when coalesce($16,false) or coalesce($17,false) then null else unsubscribed_at end, updated_at = now()
       where id = $1 and company_id = $2 returning *`,[n,e.ctx.companyId,t.name??null,r.cpf!==void 0,r.cpf??null,r.phone!==void 0,r.phone??null,r.email!==void 0,r.email??null,r.birthday!==
void 0,r.birthday??null,t.address??null,t.tags??null,t.preferences??null,t.notes??null,t.consent_whatsapp??null,t.consent_email??null,c]).catch(m=>{throw m.code==="23505"?g("J\xE1 exi\
ste cliente com este CPF","cpf_in_use"):m});return await h(i,e.ctx,c?"cliente.consentimento":"cliente.alterado",{entity:"customer",entityId:n,data:{fields:Object.keys(t),consent_whatsapp:t.
consent_whatsapp,consent_email:t.consent_email}}),u.rows[0]});a.json(Ve(o,e.ctx))}));de.post("/:id/points",y("clientes.gerenciar","pdv.autorizar"),l(async(e,a)=>{let t=w(P.object({
points:P.number().int().refine(i=>i!==0).refine(i=>Math.abs(i)<=1e5),reason:P.string().trim().min(3).max(200)}),e.body),n=Number(e.params.id),o=await x(async i=>{let s=(await i.query(
"select points from customers where id = $1 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!s)throw v("Cliente n\xE3o encontrado");if(s.points+t.points<0)throw g(
"Saldo n\xE3o pode ficar negativo");let r=await at(i,e.ctx.companyId,n,{kind:"ajuste",points:t.points,reason:t.reason,user_id:e.ctx.userId});return await h(i,e.ctx,"cliente.pontos_\
ajustados",{entity:"customer",entityId:n,reason:t.reason,data:{points:t.points}}),r});a.status(201).json(o)}));de.post("/:id/redeem",y("pdv.receber"),l(async(e,a)=>{let t=w(P.object(
{session_id:P.number().int(),points:P.number().int().positive(),idempotency_key:P.string().regex(/^[A-Za-z0-9_-]{8,80}$/)}),e.body),n=Number(e.params.id),o=await d("select * from p\
ayments where company_id = $1 and idempotency_key = $2",[e.ctx.companyId,t.idempotency_key]);if(o.rows[0])return a.json({payment:o.rows[0],replay:!0});let i=await x(async s=>{let r=await Q(
s,e.ctx.companyId,t.session_id);if(be(e.ctx,r.unit_id),!["aberta","em_fechamento"].includes(r.status))throw g("Consumo encerrado","session_not_open");if(Number(r.customer_id)!==n)throw g(
"O consumo n\xE3o est\xE1 identificado com este cliente","customer_mismatch");await Vn(s,e.ctx.companyId,n);let c=(await s.query("select settings, timezone from companies where id \
= $1",[e.ctx.companyId])).rows[0],u=Xt(c.settings);if(!u.enabled)throw g("Programa de fidelidade desligado");if(t.points<u.min_redeem)throw f(`Resgate m\xEDnimo de ${u.min_redeem} \
pontos`);let m=t.points*u.point_value_cents,p=await U(s,r.id);if(m>p.balance)throw f("Valor do resgate maior que o saldo do consumo","over_balance");let _=(await s.query("select da\
y_cutoff from units where id = $1",[r.unit_id])).rows[0],$=(await s.query(`insert into payments (company_id, session_id, method, amount_cents, business_date, idempotency_key, user_\
id)
       values ($1,$2,'vale',$3,$4,$5,$6) returning *`,[e.ctx.companyId,r.id,m,pe(new Date,c.timezone,_.day_cutoff),t.idempotency_key,e.ctx.userId])).rows[0];return await mo(s,e.ctx,
n,t.points,$.id,r.id),await s.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),await h(s,e.ctx,"cliente.pontos_resgatados",{entity:"payment",entityId:$.
id,unitId:r.unit_id,data:{customer:n,points:t.points,amount_cents:m}}),{payment:$,totals:await U(s,r.id)}});a.status(201).json(i)}));de.post("/attach",y("pdv.lancar"),l(async(e,a)=>{
let t=w(P.object({session_id:P.number().int(),customer_id:P.number().int().nullable()}),e.body),n=await x(async o=>{let i=await Q(o,e.ctx.companyId,t.session_id);if(be(e.ctx,i.unit_id),
!["aberta","em_fechamento"].includes(i.status))throw g("Consumo encerrado","session_not_open");let s=null;if(t.customer_id){let r=(await o.query("select name from customers where i\
d = $1 and company_id = $2 and anonymized_at is null",[t.customer_id,e.ctx.companyId])).rows[0];if(!r)throw v("Cliente n\xE3o encontrado");s=r.name}return await o.query("update con\
sumption_sessions set customer_id = $2, customer_name = coalesce($3, customer_name), version = version + 1 where id = $1",[i.id,t.customer_id,s]),await h(o,e.ctx,"consumo.cliente",
{entity:"session",entityId:i.id,data:{customer:t.customer_id}}),{ok:!0,customer_name:s}});a.json(n)}));de.get("/export/csv",y("clientes.gerenciar"),l(async(e,a)=>{let t=(await d("s\
elect * from customers where company_id = $1 and anonymized_at is null order by name",[e.ctx.companyId])).rows,o=[["nome","cpf","telefone","email","aniversario","etiquetas","pontos",
"whatsapp","email_ok"].join(";")];for(let i of t){let s=Ve(i,e.ctx);o.push([s.name,s.cpf,s.phone,s.email,s.birthday,(s.tags||[]).join("|"),s.points,s.consent_whatsapp?"sim":"nao",s.
consent_email?"sim":"nao"].map(dt).join(";"))}await h({query:d},e.ctx,"cliente.exportados",{data:{count:t.length,full:e.ctx.can("dados.pessoais")}}),a.setHeader("content-type","tex\
t/csv; charset=utf-8"),a.setHeader("content-disposition",'attachment; filename="clientes.csv"'),a.send(`\uFEFF${o.join(`
`)}`)}));de.post("/import",y("clientes.gerenciar","dados.pessoais"),l(async(e,a)=>{let t=w(P.object({rows:P.array(P.record(P.string(),P.any())).max(2e3),dry_run:P.boolean().default(
!0)}),e.body),n=(u,...m)=>{for(let p of Object.keys(u))if(m.includes(p.toLowerCase().trim()))return String(u[p]??"").trim();return""},o=(await d("select cpf, regexp_replace(coalesc\
e(phone,''),'\\D','','g') as phone from customers where company_id = $1",[e.ctx.companyId])).rows,i=new Set(o.map(u=>u.cpf).filter(Boolean)),s=new Set(o.map(u=>u.phone).filter(Boolean)),
r=[],c=[];t.rows.forEach((u,m)=>{let p=n(u,"nome","name","cliente"),_=n(u,"cpf","documento"),$=bo(n(u,"telefone","celular","whatsapp","phone")),k=n(u,"email","e-mail"),j=n(u,"anive\
rsario","anivers\xE1rio","nascimento","birthday"),C=j.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);C&&(j=`${C[3]}-${C[2]}-${C[1]}`);let R=m+2;if(p.length<2)return r.push({line:R,status:"er\
ro",message:"Nome ausente"});let S=null;if(_)try{S=Wt(_)}catch{return r.push({line:R,status:"erro",message:"CPF inv\xE1lido"})}if(S&&i.has(S))return r.push({line:R,status:"duplicad\
o",message:"CPF j\xE1 cadastrado"});if(!S&&$&&s.has($))return r.push({line:R,status:"duplicado",message:"Telefone j\xE1 cadastrado"});j&&!/^\d{4}-\d{2}-\d{2}$/.test(j)&&(j=""),S&&i.
add(S),$&&s.add($),c.push({name:p.slice(0,100),cpf:S,phone:$,email:/@/.test(k)?k.slice(0,120):null,birthday:j||null}),r.push({line:R,status:"ok",name:p})}),!t.dry_run&&c.length&&await x(
async u=>{for(let m of c)await u.query("insert into customers (company_id, cpf, name, phone, email, birthday, created_by) values ($1,$2,$3,$4,$5,$6,$7)",[e.ctx.companyId,m.cpf,m.name,
m.phone,m.email,m.birthday,e.ctx.userId]);await h(u,e.ctx,"cliente.importados",{data:{count:c.length}})}),a.json({dry_run:t.dry_run,valid:c.length,report:r.slice(0,500)})}));de.post(
"/:id/anonymize",y("clientes.gerenciar","dados.pessoais"),l(async(e,a)=>{let t=w(P.object({reason:P.string().trim().min(3).max(200)}),e.body);V(e.ctx,"pdv.autorizar");let n=Number(
e.params.id);await x(async o=>{if(!(await o.query(`update customers set name = 'Cliente anonimizado', cpf = null, phone = null, email = null, birthday = null,
        address = '{}', tags = '{}', preferences = null, notes = null, consent_whatsapp = false, consent_email = false, anonymized_at = now(), updated_at = now()
      where id = $1 and company_id = $2 and anonymized_at is null returning id`,[n,e.ctx.companyId])).rows[0])throw v("Cliente n\xE3o encontrado");await o.query("update consumption\
_sessions set customer_name = null where company_id = $1 and customer_id = $2",[e.ctx.companyId,n]),await o.query("update delivery_orders set customer_name = 'Anonimizado', phone =\
 '', address = '{}' where company_id = $1 and customer_id = $2",[e.ctx.companyId,n]),await h(o,e.ctx,"cliente.anonimizado",{entity:"customer",entityId:n,reason:t.reason})}),a.json(
{ok:!0})}));import{Router as ws}from"npm:express@5.2.1";import{z as ee}from"npm:zod@4.6.5";var le=ws(),xo=(...e)=>(a,t,n)=>e.some(o=>a.ctx.can(o))?n():n(F("Sem permiss\xE3o para o painel")),tn=["novo","aceito","preparando","pronto","entregue"];le.get("/sectors",y("cozinh\
a.operar"),l(async(e,a)=>{a.json((await d(`select s.id, s.name, s.target_minutes,
      (select count(*)::int from order_items i where i.sector_id = s.id and i.sent_at is not null and i.status = 'ativo'
         and i.kitchen_status in ('novo','aceito','preparando')) as open_count
    from production_sectors s where s.company_id = $1 and s.active order by s.id`,[e.ctx.companyId])).rows)}));le.put("/sectors/:id",y("cardapio.gerenciar"),l(async(e,a)=>{let t=w(
ee.object({target_minutes:ee.number().int().min(1).max(240)}),e.body);if(!(await d("update production_sectors set target_minutes = $3 where id = $1 and company_id = $2 returning id",
[Number(e.params.id),e.ctx.companyId,t.target_minutes])).rows[0])throw v();a.json({ok:!0})}));le.get("/queue",y("cozinha.operar"),l(async(e,a)=>{let t=[e.ctx.companyId],n=`i.compan\
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
companyId])).rows[0].id;a.json({now:new Date().toISOString(),last_event:s,items:i})}));le.post("/items/:id/status",y("cozinha.operar"),l(async(e,a)=>{let t=w(ee.object({to:ee.enum(
["aceito","preparando","pronto","entregue"]),from:ee.string().optional()}),e.body),n=await x(async o=>{let i=(await o.query("select * from order_items where id = $1 and company_id \
= $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Item n\xE3o encontrado");if(i.kitchen_status===t.to)return{ok:!0,replay:!0,status:i.kitchen_status};
if(i.status!=="ativo"||i.kitchen_status==="cancelado")throw g("Item cancelado: confirme a ci\xEAncia do cancelamento","item_canceled");if(!i.sent_at)throw g("Item ainda n\xE3o enviado\
 \xE0 produ\xE7\xE3o","not_sent");if(t.from&&t.from!==i.kitchen_status)throw g(`O item j\xE1 est\xE1 "${i.kitchen_status}" (alterado em outra tela)`,"status_changed",{status:i.kitchen_status});
let s=tn.indexOf(i.kitchen_status);if(tn.indexOf(t.to)<=s)throw g("N\xE3o \xE9 poss\xEDvel voltar a etapa anterior","invalid_transition");return await o.query(`update order_items s\
et kitchen_status = $2,
        accepted_at = coalesce(accepted_at, case when $2 in ('aceito','preparando','pronto','entregue') then now() end),
        ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
        delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`,[i.id,t.to]),await o.query("insert into kitchen_events (company_id, item_id, from_s\
tatus, to_status, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,i.id,i.kitchen_status,t.to,e.ctx.userId]),{ok:!0,status:t.to}});a.json(n)}));le.post("/sessions/:id/advance",y(
"cozinha.operar"),l(async(e,a)=>{let t=w(ee.object({to:ee.enum(["aceito","preparando","pronto","entregue"]),sector_id:ee.number().int().optional()}),e.body),n=tn.indexOf(t.to),o=await x(
async i=>{let s=[Number(e.params.id),e.ctx.companyId,tn.slice(0,n)],r="";t.sector_id&&(s.push(t.sector_id),r=` and sector_id = $${s.length}`);let c=(await i.query(`select id, kitch\
en_status from order_items where session_id = $1 and company_id = $2 and status = 'ativo'
      and sent_at is not null and kitchen_status = any($3)${r} for update`,s)).rows;for(let u of c)await i.query(`update order_items set kitchen_status = $2, accepted_at = coalesce\
(accepted_at, now()),
          ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
          delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`,[u.id,t.to]),await i.query("insert into kitchen_events (company_id, item_id, from\
_status, to_status, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,u.id,u.kitchen_status,t.to,e.ctx.userId]);return{changed:c.length}});a.json(o)}));le.post("/items/refuse",y("\
cozinha.operar"),l(async(e,a)=>{let t=w(ee.object({item_ids:ee.array(ee.number().int()).min(1).max(400),reason:ee.string().trim().max(200).optional()}),e.body),n=await x(async o=>{
let i=(await o.query(`select id, session_id, description, qty, kitchen_status from order_items where company_id = $1 and id = any($2)
      and status = 'ativo' and sent_at is not null and kitchen_status in ('novo','aceito','preparando','pronto') for update`,[e.ctx.companyId,t.item_ids])).rows;for(let s of i)await o.
query("update order_items set kitchen_status = 'nao_produz' where id = $1",[s.id]),await o.query("insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) \
values ($1,$2,$3,'recusado',$4)",[e.ctx.companyId,s.id,s.kitchen_status,e.ctx.userId]);return i.length&&await h(o,e.ctx,"producao.recusado",{entity:"session",entityId:i[0].session_id,
reason:t.reason||null,data:{itens:i.map(s=>({id:s.id,item:`${Number(s.qty)}\xD7 ${s.description}`,etapa:s.kitchen_status}))}}),{refused:i.length}});a.json(n)}));le.post("/items/:id\
/ack-cancel",y("cozinha.operar"),l(async(e,a)=>{let t=await d("update order_items set cancel_ack_at = now() where id = $1 and company_id = $2 and kitchen_status = 'cancelado' and c\
ancel_ack_at is null returning id",[Number(e.params.id),e.ctx.companyId]);t.rows[0]&&await d("insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) valu\
es ($1,$2,$3,$4,$5)",[e.ctx.companyId,t.rows[0].id,"cancelado","cancelado_ciente",e.ctx.userId]),a.json({ok:!0})}));le.post("/items/:id/priority",y("cozinha.operar"),l(async(e,a)=>{
let t=w(ee.object({priority:ee.boolean(),reason:ee.string().trim().min(3).max(200)}),e.body);V(e.ctx,"pdv.autorizar");let n=await d("update order_items set priority = $3 where id =\
 $1 and company_id = $2 returning id, session_id",[Number(e.params.id),e.ctx.companyId,t.priority]);if(!n.rows[0])throw v();await h({query:d},e.ctx,"producao.prioridade",{entity:"i\
tem",entityId:n.rows[0].id,reason:t.reason,data:{priority:t.priority}}),a.json({ok:!0})}));le.get("/ready",y("pdv.lancar"),l(async(e,a)=>{a.json((await d(`select i.id, i.descriptio\
n, i.qty, i.ready_at, s.id as session_id, s.label, c.number as card_number, t.number as table_number
     from order_items i join consumption_sessions s on s.id = i.session_id left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
     where i.company_id = $1 and i.kitchen_status = 'pronto' and i.status = 'ativo' order by i.ready_at limit 100`,[e.ctx.companyId])).rows)}));le.get("/stats",y("cozinha.operar"),
l(async(e,a)=>{let t=(await d(`select ps.name as sector, count(*)::int as items,
      round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::numeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
     from order_items i join production_sectors ps on ps.id = i.sector_id
    where i.company_id = $1 and i.ready_at is not null and i.sent_at > now() - interval '24 hours' group by ps.name order by ps.name`,[e.ctx.companyId])).rows;a.json(t)}));le.get("\
/board",xo("pdv.lancar","cozinha.operar"),l(async(e,a)=>{let t=e.ctx.terminalUnitId||e.ctx.unitId,n=[e.ctx.companyId],o="";t&&(n.push(t),o=` and s.unit_id = $${n.length}`);let i=(await d(
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
     limit 240`,n)).rows,s=m=>m?String(m).trim().split(/\s+/)[0]:null,r=(await d("select coalesce(max(id),0)::bigint as id from kitchen_events where company_id = $1",[e.ctx.companyId])).
rows[0].id,c=m=>({id:m.id,key:`${m.id}-${m.sector_id??0}`,code:m.delivery_number?`#${m.delivery_number}`:m.card_number?String(m.card_number):m.table_number?String(m.table_number):String(
m.id),kind:m.delivery_number?m.delivery_mode==="retirada"?"retirada":"delivery":m.card_number?"comanda":m.table_number?"mesa":m.kind,table:m.card_number&&m.table_number?m.table_number:
null,name:s(m.customer_name),sector_id:m.sector_id,sector:m.sector_name||"Pedidos",status:m.ready>0?"pronto":"preparando",partial:m.pending>0&&m.ready>0,pending:m.pending,ready_count:m.
ready,sent_at:m.sent_at,ready_at:m.ready_at,called_at:m.called_at,items:m.items.map(p=>({d:p.d,q:Number(p.q),ready:p.s==="pronto"}))}),u=[];for(let m of i){let p=u.find(_=>_.id===(m.
sector_id??0));p||(p={id:m.sector_id??0,name:m.sector_name||"Pedidos",orders:[]},u.push(p)),p.orders.push(c(m))}u.sort((m,p)=>(m.id||1e9)-(p.id||1e9)),a.set("cache-control","no-sto\
re"),a.json({now:new Date().toISOString(),version:String(r),areas:u,orders:i.map(c)})}));le.post("/sessions/:id/call",xo("pdv.lancar","cozinha.operar"),l(async(e,a)=>{let t=w(ee.object(
{sector_ids:ee.array(ee.number().int()).max(20).optional()}),e.body||{}),n=(await d(`select distinct on (i.sector_id) i.id, i.kitchen_status, i.sector_id from order_items i join co\
nsumption_sessions s on s.id = i.session_id
      where i.session_id = $1 and i.company_id = $2 and i.status = 'ativo' and i.sent_at is not null and i.kitchen_status in ('novo','aceito','preparando','pronto')
        and s.status <> 'cancelada'
        ${t.sector_ids?.length?"and i.sector_id = any($3)":""}
      order by i.sector_id, (i.kitchen_status = 'pronto') desc, i.id desc`,t.sector_ids?.length?[Number(e.params.id),e.ctx.companyId,t.sector_ids]:[Number(e.params.id),e.ctx.companyId])).
rows;if(!n.length)throw g("Este pedido n\xE3o est\xE1 mais no painel","nothing_to_call");let o=null;for(let i of n)o=(await d("insert into kitchen_events (company_id, item_id, from\
_status, to_status, user_id) values ($1,$2,$3,'chamado',$4) returning created_at",[e.ctx.companyId,i.id,i.kitchen_status,e.ctx.userId])).rows[0].created_at;a.json({ok:!0,called_at:o,
sectors:n.map(i=>i.sector_id)})}));import{Router as js}from"npm:express@5.2.1";import{z as b}from"npm:zod@4.6.5";var Gn=e=>String(e||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),Kn=e=>Gn(e).slice(0,120);async function ko(e){let a=(await d("select\
 key, value from company_secrets where company_id = $1 and key in ('ai_api_key','ai_model')",[e])).rows,t=(await d("select key, value from platform_config where key in ('anthropic_\
api_key','ai_model')").catch(()=>({rows:[]}))).rows,n=(o,i)=>o.find(s=>s.key===i)?.value;return{key:n(a,"ai_api_key")||O.ANTHROPIC_API_KEY||n(t,"anthropic_api_key")||null,model:n(a,
"ai_model")||O.AI_MODEL||n(t,"ai_model")||"claude-sonnet-5-5",url:O.AI_API_URL||"https://api.anthropic.com/v1/messages"}}async function Io(e){return!!(await ko(e)).key}var hs=`Voc\xEA\
 l\xEA documentos de compra de bares e restaurantes no Brasil: nota fiscal (NF-e/DANFE, NFC-e, cupom), pedido de compra,
romaneio ou lista escrita \xE0 m\xE3o. Extraia SOMENTE o que est\xE1 escrito. Responda apenas com JSON v\xE1lido, sem texto antes ou depois, no formato:
{"supplier": string|null, "document": string|null, "date": "AAAA-MM-DD"|null, "total": number|null,
 "items": [{"description": string, "qty": number, "unit": string|null, "unit_price": number|null, "total": number|null}],
 "warnings": [string]}
Regras: n\xFAmeros com ponto decimal (12,50 \u2192 12.5); "unit" como est\xE1 na nota (UN, CX, KG, FD, PCT, L, GF...);
n\xE3o invente itens, pre\xE7os ou quantidades; se algo estiver ileg\xEDvel, deixe null e explique em "warnings";
ignore impostos, descontos gerais e totalizadores (eles n\xE3o s\xE3o itens).`;async function jo(e,a){let t=await ko(e);if(!t.key)throw new z(503,"Leitura por foto n\xE3o configurada:\
 informe a chave da API em Estoque \u203A Leitura de notas, ou use o XML da NF-e.","ai_not_configured");let n=String(a).match(/^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
if(!n)throw new z(400,"Envie uma foto (JPG, PNG ou WEBP) ou PDF","invalid");let o={type:"base64",media_type:n[1],data:n[2]},i=n[1]==="application/pdf"?{type:"document",source:o}:{type:"\
image",source:o},s;try{s=await fetch(t.url,{method:"POST",signal:AbortSignal.timeout(6e4),headers:{"content-type":"application/json","x-api-key":t.key,"anthropic-version":"2023-06-\
01"},body:JSON.stringify({model:t.model,max_tokens:4e3,messages:[{role:"user",content:[i,{type:"text",text:hs}]}]})})}catch(_){throw new z(502,`N\xE3o foi poss\xEDvel ler a foto agora (${String(
_.message||_).slice(0,80)}). Tente de novo.`,"ai_unavailable")}let r=await s.json().catch(()=>({}));if(!s.ok)throw new z(502,`Servi\xE7o de leitura recusou a foto: ${r?.error?.message?.
slice(0,160)||s.status}`,"ai_error");let c=(r.content||[]).filter(_=>_.type==="text").map(_=>_.text).join(""),u=c.slice(c.indexOf("{"),c.lastIndexOf("}")+1),m;try{m=JSON.parse(u)}catch{
throw new z(422,"N\xE3o consegui entender a foto. Tente outra mais n\xEDtida, com a nota inteira e bem iluminada.","ai_unreadable")}let p=_=>_==null||_===""||Number.isNaN(Number(_))?
null:Number(_);return{supplier:m.supplier?String(m.supplier).slice(0,100):null,document:m.document?String(m.document).slice(0,60):null,date:/^\d{4}-\d{2}-\d{2}$/.test(m.date||"")?m.
date:null,total:p(m.total),warnings:(m.warnings||[]).map(String).slice(0,10),items:(m.items||[]).filter(_=>_&&_.description).slice(0,150).map(_=>({description:String(_.description).
slice(0,120),qty:p(_.qty),unit:_.unit?String(_.unit).slice(0,10):null,unit_price:p(_.unit_price),total:p(_.total)}))}}var gs={un:"un",und:"un",unid:"un",pc:"un",p\u00E7:"un",kg:"kg",
g:"g",gr:"g",l:"L",lt:"L",ml:"ml"},bs=e=>gs[Gn(e)]||null;async function Wn(e,a){let t=(await d("select id, name, unit from stock_items where company_id = $1 and active",[e])).rows,
n=Object.fromEntries((await d("select alias, stock_item_id, factor from stock_aliases where company_id = $1",[e])).rows.map(o=>[o.alias,o]));return a.map(o=>{let i=Kn(o.description),
s=n[i];if(s&&t.find(m=>Number(m.id)===Number(s.stock_item_id)))return{...o,alias:i,stock_item_id:Number(s.stock_item_id),factor:Number(s.factor),match:"aprendido"};let r=i.split(" ").
filter(m=>m.length>2&&!/^\d+$/.test(m)),c=null,u=0;for(let m of t){let p=Gn(m.name).split(" ").filter(k=>k.length>2);if(!p.length)continue;let $=p.filter(k=>r.some(j=>j.startsWith(
k)||k.startsWith(j))).length/p.length;$>u&&(u=$,c=m)}return{...o,alias:i,stock_item_id:u>.5?Number(c.id):null,factor:1,match:u>.5?"semelhante":"novo",suggested_unit:bs(o.unit)||"un"}})}var No={11:"RO",12:"AC",13:"AM",14:"RR",15:"PA",16:"AP",17:"TO",21:"MA",22:"PI",23:"CE",24:"RN",25:"PB",26:"PE",27:"AL",28:"SE",29:"BA",31:"MG",32:"ES",33:"RJ",35:"SP",41:"PR",42:"\
SC",43:"RS",50:"MS",51:"MT",52:"GO",53:"DF"};function $s(e){let a=0,t=2;for(let o=e.length-1;o>=0;o-=1)a+=Number(e[o])*t,t=t===9?2:t+1;let n=a%11;return n<2?0:11-n}function vs(e){return/^\d{44}$/.
test(e)&&$s(e.slice(0,43))===Number(e[43])&&!!No[e.slice(0,2)]}function xs(e){return{uf:No[e.slice(0,2)],issued:`20${e.slice(2,4)}-${e.slice(4,6)}`,cnpj:e.slice(6,20),model:e.slice(
20,22),series:Number(e.slice(22,25)),number:Number(e.slice(25,34))}}var So=e=>{let a=0;for(let t=0;t<e.length;t+=1)a+=Number(e[e.length-1-t])*(t%2===0?3:1);return(10-a%10)%10},Xn=e=>{
let a=String(e).padStart(8,"0");return`PC${a}${So(a)}`};function Yn(e){let a=String(e||"").trim().toUpperCase(),t=a.replace(/\D/g,"");if(/^PC\d{9}$/.test(a.replace(/[\s-]/g,""))){let n=a.
replace(/[\s-]/g,""),o=n.slice(2,10);return So(o)!==Number(n[10])?{kind:"invalido",message:"C\xF3digo do pedido com d\xEDgito inv\xE1lido. Leia de novo."}:{kind:"pedido",purchase_id:Number(
o)}}if(t.length===44&&/^[\d\s.-]+$/.test(a)){if(!vs(t))return{kind:"invalido",message:"Chave de acesso inv\xE1lida (d\xEDgito verificador n\xE3o confere). Leia de novo."};let n=xs(
t);return["55","65"].includes(n.model)?{kind:"nfe",key:t,info:n}:{kind:"invalido",message:"Este c\xF3digo n\xE3o \xE9 de uma NF-e."}}return{kind:"invalido",message:"C\xF3digo n\xE3o reco\
nhecido. Leia o c\xF3digo de barras do DANFE (44 d\xEDgitos) ou de um pedido de compra do RUSTEN."}}import{Buffer as ks}from"node:buffer";var Is=()=>String(process.env.FOCUS_API_URL||"https://api.focusnfe.com.br").replace(/\/$/,"");async function nn(e){return(await d("select value from company_secrets where company_i\
d = $1 and key = 'focus_token'",[e])).rows[0]?.value||null}async function zo(e,a,{method:t="GET",body:n}={}){let o;try{o=await fetch(`${Is()}${a}`,{method:t,signal:AbortSignal.timeout(
2e4),headers:{authorization:`Basic ${ks.from(`${e}:`).toString("base64")}`,...n?{"content-type":"application/json"}:{}},body:n?JSON.stringify(n):void 0})}catch{throw new z(502,"Foc\
us NFe n\xE3o respondeu. Tente de novo em instantes.","focus_unavailable")}let i=await o.text();return{status:o.status,text:i}}async function qo(e,a){let t=await nn(e);if(!t)throw f(
"Busca do XML pela chave n\xE3o configurada. Informe o token da Focus NFe ou importe o arquivo XML.","focus_not_configured");let n=await zo(t,`/v2/nfes_recebidas/${a}.xml`);if(n.status===
200&&/<infNFe[\s>]/.test(n.text)&&n.text.includes(a))return{xml:n.text};if(n.status===401||n.status===403)throw f("A Focus NFe recusou o token. Confira em Estoque \u203A Lan\xE7ar nota.",
"focus_auth");let o=await zo(t,`/v2/nfes_recebidas/${a}/manifesto`,{method:"POST",body:{tipo:"ciencia"}});if(o.status>=500)throw new z(502,"Focus NFe indispon\xEDvel no momento.","\
focus_unavailable");let i=/j[aá] (foi )?(realizad|registrad|manifest)/i.test(o.text);if(o.status>=400&&!i){let s="";try{s=JSON.parse(o.text).mensagem||""}catch{}throw f(`A Focus N\
Fe n\xE3o encontrou esta nota para o CNPJ da empresa${s?`: ${s}`:""}. Importe o XML enviado pelo fornecedor.`,"focus_not_found")}return{pending:!0,message:"Ci\xEAncia da nota registra\
da na SEFAZ. O XML com os itens costuma ficar dispon\xEDvel em alguns minutos: leia o c\xF3digo de novo."}}var L=js(),Ns=["un","kg","g","L","ml"],Qn=b.number().positive().max(1e6);L.get("/items",y("estoque.visualizar"),l(async(e,a)=>{let t=(await d(`select s.*, (select coalesce(sum(qty)\
,0) from stock_movements m where m.stock_item_id = s.id)::float as balance,
      (select coalesce(-sum(qty),0) from stock_movements m where m.stock_item_id = s.id and m.kind = 'venda' and m.created_at > now() - interval '30 days')::float as used_30d
    from stock_items s where s.company_id = $1 ${e.query.all?"":"and s.active"} order by lower(s.name)`,[e.ctx.companyId])).rows,n=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.g\
erenciar");a.json(t.map(o=>({...o,avg_cost_cents:n?Number(o.avg_cost_cents):null,status:o.balance<=0?"zerado":o.balance<=Number(o.min_qty)?"baixo":"ok",suggest:Math.max(0,Math.ceil(
(Number(o.reorder_qty)||Number(o.min_qty)*2)+o.used_30d/30*7-o.balance))})))}));var Co=b.object({name:b.string().trim().min(2).max(80),unit:b.enum(Ns),min_qty:b.number().min(0).max(
1e6).default(0),reorder_qty:b.number().min(0).max(1e6).default(0),active:b.boolean().default(!0)});L.post("/items",y("estoque.ajustar"),l(async(e,a)=>{let t=w(Co.extend({initial_qty:b.
number().min(0).max(1e6).optional(),unit_cost_cents:b.number().int().min(0).max(1e8).optional()}),e.body),n=await x(async o=>{let i=await o.query("insert into stock_items (company_\
id, name, unit, min_qty, reorder_qty, active) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,t.name,t.unit,t.min_qty,t.reorder_qty,t.active]).catch(s=>{throw s.code==="2\
3505"?g("J\xE1 existe insumo com este nome"):s});return t.initial_qty&&await wt(o,e.ctx,i.rows[0].id,t.initial_qty,t.unit_cost_cents||0,{type:"saldo_inicial"},"Saldo inicial"),await h(
o,e.ctx,"estoque.insumo_criado",{entity:"stock_item",entityId:i.rows[0].id,data:{name:t.name,initial:t.initial_qty}}),i.rows[0].id});a.status(201).json({id:n})}));L.put("/items/:id",
y("estoque.ajustar"),l(async(e,a)=>{let t=w(Co.partial(),e.body);if(!(await d(`update stock_items set name = coalesce($3,name), unit = coalesce($4,unit), min_qty = coalesce($5,min_\
qty), reorder_qty = coalesce($6,reorder_qty),
      active = coalesce($7,active) where id = $1 and company_id = $2 returning id`,[Number(e.params.id),e.ctx.companyId,t.name??null,t.unit??null,t.min_qty??null,t.reorder_qty??null,
t.active??null])).rows[0])throw v("Insumo n\xE3o encontrado");a.json({ok:!0})}));L.get("/items/:id/movements",y("estoque.visualizar"),l(async(e,a)=>{a.json((await d(`select m.id, m\
.kind, m.qty::float, m.unit_cost_cents, m.ref_type, m.ref_id, m.reverses_id, m.reason, m.created_at, u.name as user_name
     from stock_movements m left join users u on u.id = m.user_id where m.company_id = $1 and m.stock_item_id = $2 order by m.id desc limit 200`,[e.ctx.companyId,Number(e.params.id)])).
rows)}));L.post("/movements",y("estoque.ajustar"),l(async(e,a)=>{let t=w(b.object({stock_item_id:b.number().int(),kind:b.enum(["entrada","perda","ajuste"]),qty:b.number().refine(o=>o!==
0&&Math.abs(o)<=1e6),unit_cost_cents:b.number().int().min(0).max(1e8).optional(),reason:b.string().trim().min(3).max(200)}),e.body),n=await x(async o=>{let i=(await o.query("select\
 * from stock_items where id = $1 and company_id = $2 for update",[t.stock_item_id,e.ctx.companyId])).rows[0];if(!i)throw v("Insumo n\xE3o encontrado");if(t.kind==="entrada"){if(t.
qty<=0)throw f("Entrada deve ser positiva");await wt(o,e.ctx,i.id,t.qty,t.unit_cost_cents??Math.round(Number(i.avg_cost_cents)),{type:"manual"},t.reason)}else{let s=t.kind==="perda"?
-Math.abs(t.qty):t.qty;await o.query("insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6,$7)",[e.ctx.companyId,
i.id,t.kind,s,i.avg_cost_cents,t.reason,e.ctx.userId])}return await h(o,e.ctx,`estoque.${t.kind}`,{entity:"stock_item",entityId:i.id,reason:t.reason,data:{qty:t.qty}}),{balance:(await Be(
o,e.ctx.companyId,[i.id]))[i.id]||0}});a.status(201).json(n)}));L.post("/movements/:id/reverse",y("estoque.ajustar"),l(async(e,a)=>{let t=w(b.object({reason:b.string().trim().min(3).
max(200)}),e.body),n=await x(async o=>{let i=(await o.query("select * from stock_movements where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)
throw v("Movimento n\xE3o encontrado");if(!["entrada","perda","ajuste"].includes(i.kind)||i.reverses_id)throw g("Este movimento \xE9 revertido pelo fluxo de origem (venda, compra ou i\
nvent\xE1rio)");return await o.query("insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reverses_id, reason, user_id) values ($1,$2,'reversao',$3,\
$4,$5,$6,$7)",[e.ctx.companyId,i.stock_item_id,-Number(i.qty),i.unit_cost_cents,i.id,t.reason,e.ctx.userId]).catch(s=>{throw s.code==="23505"?g("Movimento j\xE1 revertido"):s}),await h(
o,e.ctx,"estoque.reversao",{entity:"stock_movement",entityId:i.id,reason:t.reason}),{ok:!0}});a.json(n)}));L.get("/recipes",y("estoque.visualizar"),l(async(e,a)=>{let t=(await d(`s\
elect p.id, p.name, p.price_cents, p.cost_cents, p.stock_mode, p.stock_item_id, p.kind, si.name as stock_item_name,
      r.id as recipe_id, r.version, r.yield_qty::float
    from products p left join recipes r on r.product_id = p.id and r.active left join stock_items si on si.id = p.stock_item_id
    where p.company_id = $1 and p.active order by p.name`,[e.ctx.companyId])).rows,n=(await d(`select l.recipe_id, l.stock_item_id, l.qty::float, l.loss_pct::float, s.name, s.unit \
from recipe_lines l join stock_items s on s.id = l.stock_item_id
    where l.company_id = $1 and l.recipe_id = any($2)`,[e.ctx.companyId,t.map(s=>s.recipe_id).filter(Boolean)])).rows,o=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.gerenciar"),
i=[];for(let s of t){let r=o?await Un({query:d},e.ctx.companyId,s):null;i.push({...s,lines:n.filter(c=>c.recipe_id===s.recipe_id),theoretical_cost_cents:r,margin_pct:r!=null&&s.price_cents?
Math.round((s.price_cents-r)/s.price_cents*1e3)/10:null})}a.json(i)}));L.get("/recipes/:productId/history",y("estoque.visualizar"),l(async(e,a)=>{a.json((await d(`select r.id, r.ve\
rsion, r.yield_qty::float, r.active, r.created_at, u.name as user_name,
      (select json_agg(json_build_object('name', s.name, 'qty', l.qty, 'unit', s.unit, 'loss_pct', l.loss_pct)) from recipe_lines l join stock_items s on s.id = l.stock_item_id whe\
re l.recipe_id = r.id) as lines
    from recipes r left join users u on u.id = r.created_by where r.company_id = $1 and r.product_id = $2 order by r.version desc`,[e.ctx.companyId,Number(e.params.productId)])).rows)}));
L.put("/recipes/:productId",y("estoque.ajustar"),l(async(e,a)=>{let t=w(b.object({stock_mode:b.enum(["nenhum","ficha","acabado"]),stock_item_id:b.number().int().nullable().optional(),
yield_qty:b.number().positive().max(1e4).default(1),lines:b.array(b.object({stock_item_id:b.number().int(),qty:b.number().positive().max(1e5),loss_pct:b.number().min(0).max(99).default(
0)})).max(60).default([]),notes:b.string().max(300).optional()}),e.body),n=Number(e.params.productId),o=await x(async i=>{let s=(await i.query("select * from products where id = $1\
 and company_id = $2 for update",[n,e.ctx.companyId])).rows[0];if(!s)throw v("Produto n\xE3o encontrado");let r=[...new Set([...t.lines.map(m=>m.stock_item_id),...t.stock_item_id?[
t.stock_item_id]:[]])];if(r.length&&(await i.query("select count(*)::int as n from stock_items where company_id = $1 and id = any($2)",[e.ctx.companyId,r])).rows[0].n!==r.length)throw f(
"Insumo inv\xE1lido");if(t.stock_mode==="acabado"&&!t.stock_item_id)throw f("Escolha o item de estoque do produto acabado");if(t.stock_mode==="ficha"&&!t.lines.length)throw f("A fi\
cha t\xE9cnica precisa de ao menos um insumo");if(new Set(t.lines.map(m=>m.stock_item_id)).size!==t.lines.length)throw f("Insumo repetido na ficha");await i.query("update products \
set stock_mode = $3, stock_item_id = $4, updated_at = now() where id = $1 and company_id = $2",[n,e.ctx.companyId,t.stock_mode,t.stock_mode==="acabado"?t.stock_item_id:null]);let c=null;
if(t.lines.length&&t.stock_mode!=="nenhum"){c=Number((await i.query("select coalesce(max(version),0) as v from recipes where product_id = $1",[n])).rows[0].v)+1,await i.query("upda\
te recipes set active = false where product_id = $1 and active",[n]);let m=await i.query("insert into recipes (company_id, product_id, version, yield_qty, notes, created_by) values\
 ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,n,c,t.yield_qty,t.notes??null,e.ctx.userId]);for(let p of t.lines)await i.query("insert into recipe_lines (company_id, recipe_id\
, stock_item_id, qty, loss_pct) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,m.rows[0].id,p.stock_item_id,p.qty,p.loss_pct])}else await i.query("update recipes set active = false wher\
e product_id = $1 and active",[n]);let u=await Un(i,e.ctx.companyId,{...s,stock_mode:t.stock_mode,stock_item_id:t.stock_mode==="acabado"?t.stock_item_id:null});return t.stock_mode!==
"nenhum"&&await i.query("update products set cost_cents = $3 where id = $1 and company_id = $2",[n,e.ctx.companyId,u]),await h(i,e.ctx,"estoque.ficha",{entity:"product",entityId:n,
data:{mode:t.stock_mode,version:c,lines:t.lines.length}}),{ok:!0,version:c,cost_cents:u}});a.json(o)}));L.get("/purchases",y("estoque.visualizar"),l(async(e,a)=>{let t=(await d(`se\
lect p.*, u.name as user_name,
      (select json_agg(json_build_object('id', l.id, 'stock_item_id', l.stock_item_id, 'name', s.name, 'unit', s.unit, 'qty', l.qty, 'received_qty', l.received_qty,
         'unit_cost_cents', l.unit_cost_cents) order by l.id) from purchase_lines l join stock_items s on s.id = l.stock_item_id where l.purchase_id = p.id) as lines
    from purchases p left join users u on u.id = p.created_by where p.company_id = $1 order by p.id desc limit 100`,[e.ctx.companyId])).rows;a.json(t.map(n=>({...n,code:Xn(n.id)})))}));
L.post("/purchases",y("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({supplier:b.string().trim().min(2).max(100),document:b.string().trim().max(60).optional(),due_date:b.string().
regex(/^\d{4}-\d{2}-\d{2}$/).optional(),notes:b.string().max(300).optional(),lines:b.array(b.object({stock_item_id:b.number().int(),qty:Qn,unit_cost_cents:b.number().int().min(0).max(
1e8)})).min(1).max(100)}),e.body),n=await x(async o=>{let i=[...new Set(t.lines.map(u=>u.stock_item_id))];if((await o.query("select count(*)::int as n from stock_items where compan\
y_id = $1 and id = any($2)",[e.ctx.companyId,i])).rows[0].n!==i.length)throw f("Insumo inv\xE1lido");let r=t.lines.reduce((u,m)=>u+Math.round(m.qty*m.unit_cost_cents),0),c=await o.
query("insert into purchases (company_id, supplier, document, due_date, notes, total_cents, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",[e.ctx.companyId,t.supplier,t.document??
null,t.due_date??null,t.notes??null,r,e.ctx.userId]);for(let u of t.lines)await o.query("insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) v\
alues ($1,$2,$3,$4,$5)",[e.ctx.companyId,c.rows[0].id,u.stock_item_id,u.qty,u.unit_cost_cents]);return await h(o,e.ctx,"compra.criada",{entity:"purchase",entityId:c.rows[0].id,data:{
supplier:t.supplier,total_cents:r}}),c.rows[0].id});a.status(201).json({id:n})}));L.post("/purchases/:id/receive",y("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({lines:b.array(
b.object({line_id:b.number().int(),qty:Qn,unit_cost_cents:b.number().int().min(0).max(1e8).optional()})).min(1).max(100)}),e.body),n=await x(async o=>{let i=(await o.query("select \
* from purchases where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Compra n\xE3o encontrada");if(["recebida","cancelada"].
includes(i.status))throw g(`Compra ${i.status}`);for(let c of t.lines){let u=(await o.query("select * from purchase_lines where id = $1 and purchase_id = $2 for update",[c.line_id,
i.id])).rows[0];if(!u)throw f("Linha inv\xE1lida");if(Number(u.received_qty)+c.qty>Number(u.qty)+1e-4)throw f("Quantidade recebida maior que a comprada");let m=c.unit_cost_cents??Number(
u.unit_cost_cents);await o.query("update purchase_lines set received_qty = received_qty + $2, unit_cost_cents = $3 where id = $1",[u.id,c.qty,m]),await wt(o,e.ctx,u.stock_item_id,c.
qty,m,{type:"purchase",id:i.id},`Compra ${i.id} \u2014 ${i.supplier}`)}let r=(await o.query("select count(*)::int as n from purchase_lines where purchase_id = $1 and received_qty <\
 qty",[i.id])).rows[0].n?"parcial":"recebida";return await o.query(`update purchases set status = $2, total_cents = (select coalesce(sum(round(qty * unit_cost_cents)), 0) from purc\
hase_lines where purchase_id = $1)
      where id = $1`,[i.id,r]),await h(o,e.ctx,"compra.recebida",{entity:"purchase",entityId:i.id,data:{status:r,lines:t.lines.length}}),{status:r}});a.json(n)}));L.post("/purchase\
s/:id/cancel",y("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({reason:b.string().trim().min(3).max(200)}),e.body),n=await d("update purchases set status = 'cancelada', notes\
 = coalesce(notes,'') || ' [cancelada: ' || $3 || ']' where id = $1 and company_id = $2 and status = 'aberta' returning id",[Number(e.params.id),e.ctx.companyId,t.reason]);if(!n.rows[0])
throw g("S\xF3 compras ainda n\xE3o recebidas podem ser canceladas");await h({query:d},e.ctx,"compra.cancelada",{entity:"purchase",entityId:n.rows[0].id,reason:t.reason}),a.json({ok:!0})}));
L.get("/inventories",y("estoque.visualizar"),l(async(e,a)=>{a.json((await d(`select i.*, u.name as user_name, a.name as approved_name from inventory_counts i left join users u on u\
.id = i.created_by
    left join users a on a.id = i.approved_by where i.company_id = $1 order by i.id desc limit 30`,[e.ctx.companyId])).rows)}));L.post("/inventories",y("estoque.ajustar"),l(async(e,a)=>{
let t=w(b.object({counts:b.array(b.object({stock_item_id:b.number().int(),counted:b.number().min(0).max(1e6)})).min(1).max(500),notes:b.string().max(300).optional()}),e.body),n=await Be(
{query:d},e.ctx.companyId,t.counts.map(r=>r.stock_item_id)),o=Object.fromEntries((await d("select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any\
($2)",[e.ctx.companyId,t.counts.map(r=>r.stock_item_id)])).rows.map(r=>[r.id,r])),i=t.counts.filter(r=>o[r.stock_item_id]).map(r=>{let c=Math.round((n[r.stock_item_id]||0)*1e3)/1e3,
u=Math.round((r.counted-c)*1e3)/1e3;return{stock_item_id:r.stock_item_id,name:o[r.stock_item_id].name,unit:o[r.stock_item_id].unit,system:c,counted:r.counted,diff:u,value_cents:Math.
round(u*Number(o[r.stock_item_id].avg_cost_cents))}}),s=await d("insert into inventory_counts (company_id, lines, notes, created_by) values ($1,$2,$3,$4) returning id",[e.ctx.companyId,
JSON.stringify(i),t.notes??null,e.ctx.userId]);a.status(201).json({id:s.rows[0].id,lines:i})}));L.post("/inventories/:id/approve",y("estoque.ajustar"),l(async(e,a)=>{V(e.ctx,"pdv.a\
utorizar");let t=await x(async n=>{let o=(await n.query("select * from inventory_counts where id = $1 and company_id = $2 and status = 'aberto' for update",[Number(e.params.id),e.ctx.
companyId])).rows[0];if(!o)throw g("Invent\xE1rio n\xE3o est\xE1 aberto");if(Number(o.created_by)===Number(e.ctx.userId)&&e.ctx.level<100)throw g("A aprova\xE7\xE3o deve ser feita por ou\
tra pessoa","same_user");let i=await Be(n,e.ctx.companyId,o.lines.map(r=>r.stock_item_id)),s=0;for(let r of o.lines){let c=Math.round(((i[r.stock_item_id]||0)-r.system)*1e3)/1e3,u=Math.
round((r.counted+c-(i[r.stock_item_id]||0))*1e3)/1e3;Math.abs(u)<5e-4||(await n.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type,\
 ref_id, reason, user_id)
        select $1, id, 'inventario', $3, avg_cost_cents, 'inventory', $4, 'Invent\xE1rio aprovado', $5 from stock_items where id = $2 and company_id = $1`,[e.ctx.companyId,r.stock_item_id,
u,o.id,e.ctx.userId]),s++)}return await n.query("update inventory_counts set status = 'aprovado', approved_by = $2, approved_at = now() where id = $1",[o.id,e.ctx.userId]),await h(
n,e.ctx,"estoque.inventario_aprovado",{entity:"inventory",entityId:o.id,data:{adjustments:s}}),{adjustments:s}});a.json(t)}));L.post("/inventories/:id/discard",y("estoque.ajustar"),
l(async(e,a)=>{if(!(await d("update inventory_counts set status = 'descartado' where id = $1 and company_id = $2 and status = 'aberto' returning id",[Number(e.params.id),e.ctx.companyId])).
rows[0])throw g("Invent\xE1rio n\xE3o est\xE1 aberto");a.json({ok:!0})}));L.post("/produce",y("estoque.ajustar"),l(async(e,a)=>{let t=w(b.object({product_id:b.number().int(),qty:Qn}),
e.body),n=await x(async o=>{let i=(await o.query("select * from products where id = $1 and company_id = $2",[t.product_id,e.ctx.companyId])).rows[0];if(!i)throw v("Produto n\xE3o enco\
ntrado");if(i.stock_mode!=="acabado")throw f("Produ\xE7\xE3o pr\xF3pria vale para produtos com estoque de produto acabado");if(!(await o.query("select id from recipes where product\
_id = $1 and active",[i.id])).rows[0])throw f("Cadastre a ficha de produ\xE7\xE3o (insumos) deste produto acabado antes de produzir");let r=await nt(o,e.ctx.companyId,{...i,stock_mode:"\
ficha"},t.qty),c=(await o.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2) for update",[e.ctx.companyId,[...r.keys()]])).rows,u=0;for(let m of c){
let p=r.get(Number(m.id));u+=p*Number(m.avg_cost_cents),await o.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason,\
 user_id)
        values ($1,$2,'producao_consumo',$3,$4,'production',$5,$6,$7)`,[e.ctx.companyId,m.id,-p,m.avg_cost_cents,i.id,`Produ\xE7\xE3o de ${t.qty} ${i.name}`,e.ctx.userId])}return await wt(
o,e.ctx,i.stock_item_id,t.qty,Math.round(u/t.qty),{type:"production",id:i.id},`Produ\xE7\xE3o de ${i.name}`),await h(o,e.ctx,"estoque.producao",{entity:"product",entityId:i.id,data:{
qty:t.qty,cost_cents:Math.round(u)}}),{ok:!0,cost_cents:Math.round(u)}});a.json(n)}));L.get("/settings",y("estoque.visualizar"),l(async(e,a)=>{let t=(await d("select settings from \
companies where id = $1",[e.ctx.companyId])).rows[0];a.json(ze(t.settings))}));L.put("/settings",y("configuracoes.gerenciar"),l(async(e,a)=>{let t=w(b.object({enabled:b.boolean().optional(),
allow_negative:b.boolean().optional(),correction_limit_cents:b.number().int().min(0).max(1e8).optional(),correction_max_pct:b.number().min(0).max(1e3).optional(),correction_expire_days:b.
number().int().min(1).max(60).optional()}),e.body),n=(await d("select settings from companies where id = $1",[e.ctx.companyId])).rows[0],o={...ze(n.settings),...Object.fromEntries(
Object.entries(t).filter(([,i])=>i!==void 0))};await d("update companies set settings = jsonb_set(settings, '{stock}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(o)]),
await h({query:d},e.ctx,"estoque.politica",{data:{antes:ze(n.settings),depois:o}}),a.json({ok:!0})}));var an={contagem:"Diverg\xEAncia de contagem",quebra:"Quebra / avaria",vencimento:"\
Vencimento / validade",erro_lancamento:"Erro de lan\xE7amento",consumo_interno:"Consumo interno / cortesia",furto_desvio:"Furto ou desvio",devolucao:"Devolu\xE7\xE3o ao fornecedor",
outro:"Outro"},Zn=e=>Math.round(Number(e)*1e4)/1e4,Ss=`select c.*, c.system_qty::float as system_qty, c.counted_qty::float as counted_qty, c.diff_qty::float as diff_qty,
    s.name as item_name, s.unit, u.name as requested_name, d.name as decided_name,
    (select count(*)::int from stock_corrections x where x.company_id = c.company_id and x.stock_item_id = c.stock_item_id
       and x.status = 'aplicada' and x.created_at > c.created_at - interval '30 days' and x.id <> c.id) as recent_count
  from stock_corrections c join stock_items s on s.id = c.stock_item_id
  left join users u on u.id = c.requested_by left join users d on d.id = c.decided_by`;async function zs(e,a){return(await e.query(`select count(*)::int as n from users u join role\
s r on r.company_id = u.company_id and r.key = u.role_key
     where u.company_id = $1 and u.active and u.id <> $2 and 'pdv.autorizar' = any(r.permissions) and 'estoque.ajustar' = any(r.permissions)`,[a.companyId,a.userId])).rows[0].n}async function Eo(e,a,t,{
selfApproved:n=!1,note:o=null,auto:i=!1}={}){let s=(await e.query("select id, avg_cost_cents from stock_items where id = $1 and company_id = $2 for update",[t.stock_item_id,a.companyId])).
rows[0],r=await e.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
     values ($1,$2,'correcao',$3,$4,'stock_correction',$5,$6,$7) returning id`,[a.companyId,t.stock_item_id,t.diff_qty,s.avg_cost_cents,t.id,`Corre\xE7\xE3o #${t.id}: ${an[t.reason_code]}`,
a.userId]);return await e.query("update stock_corrections set status = 'aplicada', decided_by = $2, decided_at = now(), decision_note = $3, self_approved = $4, movement_id = $5 whe\
re id = $1",[t.id,a.userId,o,n,r.rows[0].id]),await h(e,a,i?"estoque.correcao_aplicada_direto":"estoque.correcao_aprovada",{entity:"stock_correction",entityId:t.id,reason:o||t.justification,
data:{insumo:t.stock_item_id,saldo_sistema:Number(t.system_qty),saldo_real:Number(t.counted_qty),diferenca:Number(t.diff_qty),valor_cents:Number(t.value_cents),motivo:t.reason_code,
solicitado_por:t.requested_by,autoaprovado:n,movimento:r.rows[0].id}}),r.rows[0].id}L.get("/corrections",y("estoque.visualizar"),l(async(e,a)=>{let t=[e.ctx.companyId],n="c.company\
_id = $1";e.query.status&&(t.push(String(e.query.status)),n+=` and c.status = $${t.length}`),e.query.from&&(t.push(String(e.query.from)),n+=` and c.created_at >= $${t.length}::date`),
e.query.to&&(t.push(String(e.query.to)),n+=` and c.created_at < $${t.length}::date + 1`),e.query.item&&(t.push(Number(e.query.item)),n+=` and c.stock_item_id = $${t.length}`);let o=ze(
(await d("select settings from companies where id = $1",[e.ctx.companyId])).rows[0].settings);await d(`update stock_corrections set status = 'expirada', decided_at = now(), decisio\
n_note = 'Vencida sem decis\xE3o'
     where company_id = $1 and status = 'pendente' and created_at < now() - make_interval(days => $2)`,[e.ctx.companyId,o.correction_expire_days]);let i=(await d(`${Ss} where ${n} \
order by c.id desc limit 500`,t)).rows,s=e.ctx.can("relatorios.cmv")||e.ctx.can("compras.gerenciar")||e.ctx.can("pdv.autorizar"),r=i.map(c=>({...c,reason_label:an[c.reason_code],value_cents:s?
Number(c.value_cents):null,unit_cost_cents:s?Number(c.unit_cost_cents):null,requested_ip:void 0,recurrent:c.recent_count>=2}));if(e.query.format==="csv"){let c=p=>{let _=p==null?"":
String(p);return`"${(/^[=+\-@\t\r]/.test(_)?`'${_}`:_).replace(/"/g,'""')}"`},u=["id","data","insumo","unidade","saldo_sistema","saldo_real","diferenca","valor_reais","motivo","jus\
tificativa","evidencia","situacao","solicitado_por","decidido_por","decidido_em","observacao_decisao","autoaprovado","movimento"],m=r.map(p=>[p.id,new Date(p.created_at).toISOString(),
p.item_name,p.unit,p.system_qty,p.counted_qty,p.diff_qty,p.value_cents==null?"":(p.value_cents/100).toFixed(2),p.reason_label,p.justification,p.evidence,p.status,p.requested_name,p.
decided_name,p.decided_at?new Date(p.decided_at).toISOString():"",p.decision_note,p.self_approved?"sim":"n\xE3o",p.movement_id].map(c).join(";"));return await h({query:d},e.ctx,"es\
toque.correcoes_exportadas",{data:{linhas:r.length}}),a.set("content-type","text/csv; charset=utf-8").set("content-disposition",'attachment; filename="correcoes-estoque.csv"'),a.send(
`\uFEFF${u.join(";")}
${m.join(`
`)}`)}a.json({reasons:an,config:o,items:r})}));L.post("/corrections",y("estoque.ajustar"),l(async(e,a)=>{let t=w(b.object({stock_item_id:b.number().int(),counted_qty:b.number().min(
0).max(1e6),reason_code:b.enum(Object.keys(an)),justification:b.string().trim().min(15,"Explique o motivo com pelo menos 15 caracteres").max(500),evidence:b.string().trim().max(300).
optional(),expected_system_qty:b.number().optional()}),e.body);await X(`stock-corr:${e.ctx.userId}`,60,3600);let n=await x(async o=>{let i=(await o.query("select * from stock_items\
 where id = $1 and company_id = $2 for update",[t.stock_item_id,e.ctx.companyId])).rows[0];if(!i)throw v("Insumo n\xE3o encontrado");let s=ze((await o.query("select settings from c\
ompanies where id = $1",[e.ctx.companyId])).rows[0].settings),r=(await o.query("select id from stock_corrections where company_id = $1 and stock_item_id = $2 and status = 'pendente\
' and created_at >= now() - make_interval(days => $3)",[e.ctx.companyId,i.id,s.correction_expire_days])).rows[0];if(r)throw g(`J\xE1 existe a corre\xE7\xE3o #${r.id} pendente para \
este insumo. Aprove ou rejeite antes de pedir outra.`,"correction_pending");await o.query(`update stock_corrections set status = 'expirada', decided_at = now(), decision_note = 'Ve\
ncida sem decis\xE3o'
       where company_id = $1 and stock_item_id = $2 and status = 'pendente'`,[e.ctx.companyId,i.id]);let c=Zn((await Be(o,e.ctx.companyId,[i.id]))[i.id]||0);if(t.expected_system_qty!=
null&&Math.abs(Zn(t.expected_system_qty)-c)>5e-4)throw g(`O saldo do sistema mudou para ${c} ${i.unit} enquanto voc\xEA contava. Confira e envie de novo.`,"balance_changed",{system_qty:c});
let u=Zn(t.counted_qty-c);if(Math.abs(u)<5e-4)throw f("O saldo informado \xE9 igual ao do sistema: n\xE3o h\xE1 o que corrigir");let m=Number(i.avg_cost_cents)||0,p=Math.round(u*m),
_=(await o.query("select count(*)::int as n from stock_corrections where company_id = $1 and stock_item_id = $2 and status = 'aplicada' and created_at > now() - interval '30 days'",
[e.ctx.companyId,i.id])).rows[0].n,$=[];e.ctx.can("pdv.autorizar")||$.push("quem pediu n\xE3o tem permiss\xE3o de aprovar"),Math.abs(p)>s.correction_limit_cents&&$.push(`valor acim\
a do limite de R$ ${(s.correction_limit_cents/100).toFixed(2).replace(".",",")}`),c>0&&Math.abs(u)/c*100>s.correction_max_pct&&$.push(`diferen\xE7a acima de ${s.correction_max_pct}\
% do saldo`),t.reason_code==="furto_desvio"&&$.push("motivo furto/desvio sempre exige aprova\xE7\xE3o"),_>=2&&$.push(`${_+1}\xAA corre\xE7\xE3o deste insumo em 30 dias`);let j=(await o.
query(`insert into stock_corrections (company_id, stock_item_id, system_qty, counted_qty, diff_qty, unit_cost_cents, value_cents, reason_code,
        justification, evidence, needs_approval, approval_rule, requested_by, requested_ip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,[e.ctx.companyId,i.
id,c,t.counted_qty,u,m,p,t.reason_code,t.justification,t.evidence||null,$.length>0,$.join("; ")||null,e.ctx.userId,String(e.ip||"").slice(0,64)])).rows[0];return await h(o,e.ctx,"e\
stoque.correcao_solicitada",{entity:"stock_correction",entityId:j.id,reason:t.justification,data:{insumo:i.id,nome:i.name,saldo_sistema:c,saldo_real:t.counted_qty,diferenca:u,valor_cents:p,
motivo:t.reason_code,regras:$}}),$.length||await Eo(o,e.ctx,j,{auto:!0,note:"Dentro dos limites: aplicada por quem tem permiss\xE3o de aprovar"}),{id:j.id,status:$.length?"pendente":
"aplicada",rules:$,diff_qty:u,value_cents:p,system_qty:c}});a.status(201).json(n)}));L.post("/corrections/:id/approve",y("estoque.ajustar"),l(async(e,a)=>{V(e.ctx,"pdv.autorizar");
let t=w(b.object({note:b.string().trim().max(300).optional()}),e.body||{}),n=await x(async o=>{let i=(await o.query("select * from stock_corrections where id = $1 and company_id = \
$2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Corre\xE7\xE3o n\xE3o encontrada");if(i.status!=="pendente")throw g(`Esta corre\xE7\xE3o j\xE1 est\xE1 ${i.
status}`);let s=ze((await o.query("select settings from companies where id = $1",[e.ctx.companyId])).rows[0].settings);if(new Date(i.created_at).getTime()<Date.now()-s.correction_expire_days*
864e5)return await o.query("update stock_corrections set status = 'expirada', decided_at = now(), decision_note = 'Vencida sem decis\xE3o' where id = $1",[i.id]),{expired:!0};let r=!1;
if(Number(i.requested_by)===Number(e.ctx.userId)){if(await zs(o,e.ctx)>0||e.ctx.level<100)throw g("A aprova\xE7\xE3o deve ser feita por outra pessoa (gerente ou propriet\xE1rio)","\
same_user");if(!t.note||t.note.length<10)throw f("Sem outro aprovador na empresa: registre uma observa\xE7\xE3o (m\xEDn. 10 caracteres) para aprovar o pr\xF3prio pedido");r=!0}return await Eo(
o,e.ctx,i,{selfApproved:r,note:t.note||null}),{ok:!0,self_approved:r}});if(n.expired)throw g("Esta corre\xE7\xE3o venceu sem decis\xE3o. Conte de novo e fa\xE7a um novo pedido.","e\
xpired");a.json(n)}));L.post("/corrections/:id/reject",y("estoque.ajustar"),l(async(e,a)=>{V(e.ctx,"pdv.autorizar");let t=w(b.object({note:b.string().trim().min(5,"Informe o motivo\
 da rejei\xE7\xE3o").max(300)}),e.body),n=await d(`update stock_corrections set status = 'rejeitada', decided_by = $3, decided_at = now(), decision_note = $4
     where id = $1 and company_id = $2 and status = 'pendente' returning id, stock_item_id, diff_qty, value_cents`,[Number(e.params.id),e.ctx.companyId,e.ctx.userId,t.note]);if(!n.
rows[0])throw g("Esta corre\xE7\xE3o n\xE3o est\xE1 pendente");await h({query:d},e.ctx,"estoque.correcao_rejeitada",{entity:"stock_correction",entityId:n.rows[0].id,reason:t.note,data:{
insumo:n.rows[0].stock_item_id,diferenca:Number(n.rows[0].diff_qty),valor_cents:Number(n.rows[0].value_cents)}}),a.json({ok:!0})}));L.post("/items/from-products",y("estoque.ajustar"),
l(async(e,a)=>{let t=w(b.object({product_ids:b.array(b.number().int()).min(1).max(300)}),e.body),n=await x(async o=>{let i=(await o.query("select id, name, cost_cents from products\
 where company_id = $1 and id = any($2) and active and stock_mode = 'nenhum' for update",[e.ctx.companyId,t.product_ids])).rows,s=0,r=0;for(let c of i){let u=(await o.query("select\
 id from stock_items where company_id = $1 and lower(name) = lower($2)",[e.ctx.companyId,c.name])).rows[0];u||(u=(await o.query("insert into stock_items (company_id, name, unit, av\
g_cost_cents) values ($1,$2,'un',$3) returning id",[e.ctx.companyId,c.name.slice(0,80),Number(c.cost_cents)||0])).rows[0],s++),await o.query("update products set stock_mode = 'acab\
ado', stock_item_id = $3, updated_at = now() where id = $1 and company_id = $2",[c.id,e.ctx.companyId,u.id]),r++}return await h(o,e.ctx,"estoque.produtos_controlados",{data:{produtos:i.
map(c=>c.id),criados:s}}),{created:s,linked:r}});a.status(201).json(n)}));L.get("/notes/status",y("compras.gerenciar"),l(async(e,a)=>{let t=(await d("select 1 from company_secrets \
where company_id = $1 and key = 'ai_api_key'",[e.ctx.companyId])).rows[0];a.json({photo:await Io(e.ctx.companyId),own_key:!!t,xml_by_key:!!await nn(e.ctx.companyId)})}));L.put("/no\
tes/key",y("compras.gerenciar","configuracoes.gerenciar"),l(async(e,a)=>{let t=w(b.object({api_key:b.string().trim().max(300)}),e.body);if(t.api_key&&!/^sk-ant-[A-Za-z0-9_-]{20,}$/.
test(t.api_key))throw f('Chave inv\xE1lida: ela come\xE7a com "sk-ant-"');t.api_key?await d("insert into company_secrets (company_id, key, value) values ($1,'ai_api_key',$2) on con\
flict (company_id, key) do update set value = excluded.value, updated_at = now()",[e.ctx.companyId,t.api_key]):await d("delete from company_secrets where company_id = $1 and key = \
'ai_api_key'",[e.ctx.companyId]),await h({query:d},e.ctx,"estoque.leitura_chave",{data:{removed:!t.api_key}}),a.json({ok:!0})}));L.put("/notes/focus",y("compras.gerenciar","configu\
racoes.gerenciar"),l(async(e,a)=>{let t=w(b.object({token:b.string().trim().max(200)}),e.body);if(t.token&&!/^[A-Za-z0-9_-]{16,200}$/.test(t.token))throw f("Token inv\xE1lido: copie o\
 token de produ\xE7\xE3o do painel da Focus NFe");t.token?await d("insert into company_secrets (company_id, key, value) values ($1,'focus_token',$2) on conflict (company_id, key) d\
o update set value = excluded.value, updated_at = now()",[e.ctx.companyId,t.token]):await d("delete from company_secrets where company_id = $1 and key = 'focus_token'",[e.ctx.companyId]),
await h({query:d},e.ctx,"estoque.focus_token",{data:{removed:!t.token}}),a.json({ok:!0})}));L.post("/barcode",y("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({code:b.string().
trim().min(4).max(80)}),e.body),n=Yn(t.code);if(n.kind==="invalido")throw f(n.message,"barcode_invalid");let o=e.ctx.companyId;if(n.kind==="pedido"){let r=(await d("select id, supp\
lier, document, due_date, status, total_cents from purchases where id = $1 and company_id = $2",[n.purchase_id,o])).rows[0];if(!r)throw v("Pedido de compra n\xE3o encontrado nesta emp\
resa");let c=(await d(`select l.id, l.stock_item_id, s.name, s.unit, l.qty, l.received_qty, l.unit_cost_cents, s.avg_cost_cents
      from purchase_lines l join stock_items s on s.id = l.stock_item_id where l.purchase_id = $1 order by l.id`,[r.id])).rows;return a.json({kind:"pedido",purchase:{...r,code:Xn(r.
id),lines:c}})}let i=(await d("select id, status from purchases where company_id = $1 and nfe_key = $2 and status <> 'cancelada'",[o,n.key])).rows[0],s=(await d("select supplier fr\
om purchases where company_id = $1 and supplier_doc = $2 and status <> 'cancelada' order by id desc limit 1",[o,n.info.cnpj])).rows[0];a.json({kind:"nfe",key:n.key,info:n.info,duplicate:i?
i.id:null,supplier:s?.supplier||null,xml_by_key:!!await nn(o)})}));L.post("/notes/xml-by-key",y("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({key:b.string().regex(/^\d{44}$/)}),
e.body),n=Yn(t.key);if(n.kind!=="nfe")throw f("Chave de acesso inv\xE1lida","barcode_invalid");await X(`nfexml:${e.ctx.companyId}`,120,3600),a.json(await qo(e.ctx.companyId,n.key))}));
L.post("/notes/read",y("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({image:b.string().max(9e6)}),e.body);await X(`notes:${e.ctx.companyId}`,60,3600);let n=await jo(e.ctx.companyId,
t.image);a.json({...n,items:await Wn(e.ctx.companyId,n.items)})}));L.post("/notes/match",y("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({items:b.array(b.object({description:b.
string().max(120),qty:b.number().nullable().optional(),unit:b.string().max(10).nullable().optional(),unit_price:b.number().nullable().optional(),total:b.number().nullable().optional()})).
max(300)}),e.body);a.json({items:await Wn(e.ctx.companyId,t.items)})}));L.post("/notes/confirm",y("compras.gerenciar"),l(async(e,a)=>{let t=w(b.object({supplier:b.string().trim().min(
2).max(100),document:b.string().trim().max(60).optional().nullable(),due_date:b.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),source:b.enum(["foto","xml","manual"]),nfe_key:b.
string().regex(/^\d{44}$/).optional().nullable(),receive:b.boolean().default(!0),supplier_doc:b.string().regex(/^\d{11}$|^\d{14}$/).optional().nullable(),lines:b.array(b.object({description:b.
string().max(120),alias:b.string().max(120).optional(),stock_item_id:b.number().int().optional().nullable(),new_item:b.object({name:b.string().trim().min(2).max(80),unit:b.enum(["u\
n","kg","g","L","ml"]),min_qty:b.number().min(0).max(1e6).default(0)}).optional().nullable(),qty:b.number().positive().max(1e6),factor:b.number().positive().max(1e4).default(1),unit_cost_cents:b.
number().int().min(0).max(1e8)})).min(1).max(150)}),e.body),n=await x(async o=>{if(t.nfe_key){let c=(await o.query("select id from purchases where company_id = $1 and nfe_key = $2 \
and status <> 'cancelada'",[e.ctx.companyId,t.nfe_key])).rows[0];if(c)throw g(`Esta NF-e j\xE1 foi lan\xE7ada (compra #${c.id})`,"nfe_duplicate")}let i=[];for(let c of t.lines){let u=c.
stock_item_id;if(!u&&c.new_item&&(u=(await o.query("select id from stock_items where company_id = $1 and lower(name) = lower($2)",[e.ctx.companyId,c.new_item.name])).rows[0]?.id??(await o.
query("insert into stock_items (company_id, name, unit, min_qty, reorder_qty) values ($1,$2,$3,$4,$5) returning id",[e.ctx.companyId,c.new_item.name,c.new_item.unit,c.new_item.min_qty,
c.new_item.min_qty*3])).rows[0].id),!u)throw f(`Escolha o insumo de "${c.description}" ou marque para criar`);if(!(await o.query("select 1 from stock_items where id = $1 and compan\
y_id = $2",[u,e.ctx.companyId])).rows[0])throw f("Insumo inv\xE1lido");i.push({...c,stock_item_id:Number(u),stock_qty:Math.round(c.qty*c.factor*1e3)/1e3,stock_cost:Math.round(c.unit_cost_cents/
c.factor)})}let s=t.lines.reduce((c,u)=>c+Math.round(u.qty*u.unit_cost_cents),0),r=(await o.query(`insert into purchases (company_id, supplier, document, due_date, total_cents, cre\
ated_by, source, nfe_key, notes, supplier_doc)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,[e.ctx.companyId,t.supplier,t.document??null,t.due_date??null,s,e.ctx.userId,t.source,t.nfe_key??null,{foto:"Lan\xE7ada pel\
a foto da nota (conferida)",xml:"Importada do XML da NF-e",manual:"Nota/pedido digitado manualmente"}[t.source],t.supplier_doc??(t.nfe_key?t.nfe_key.slice(6,20):null)])).rows[0];for(let c of i){
let u=(await o.query("insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) values ($1,$2,$3,$4,$5) returning id",[e.ctx.companyId,r.id,c.stock_item_id,
c.stock_qty,c.stock_cost])).rows[0];t.receive&&(await o.query("update purchase_lines set received_qty = qty where id = $1",[u.id]),await wt(o,e.ctx,c.stock_item_id,c.stock_qty,c.stock_cost,
{type:"purchase",id:r.id},`Compra ${r.id} \u2014 ${t.supplier}`));let m=Kn(c.alias||c.description);m&&await o.query(`insert into stock_aliases (company_id, alias, stock_item_id, fa\
ctor) values ($1,$2,$3,$4)
        on conflict (company_id, alias) do update set stock_item_id = excluded.stock_item_id, factor = excluded.factor, updated_at = now()`,[e.ctx.companyId,m,c.stock_item_id,c.factor])}
return t.receive&&await o.query("update purchases set status = 'recebida' where id = $1",[r.id]),await h(o,e.ctx,"compra.nota_lancada",{entity:"purchase",entityId:r.id,data:{source:t.
source,lines:i.length,total_cents:s,received:t.receive}}),{purchase_id:r.id,lines:i.length,total_cents:s,received:t.receive}}).catch(o=>{throw o.code==="23505"?g("Esta NF-e j\xE1 foi \
lan\xE7ada","nfe_duplicate"):o});a.status(201).json(n)}));import{Router as qs}from"npm:express@5.2.1";import{z as xe}from"npm:zod@4.6.5";var Je=qs(),Cs=xe.number().int().positive().max(1e8),Es=xe.string().regex(/^[A-Za-z0-9_-]{8,80}$/),As=e=>`R$ ${(e/100).toFixed(2).replace(".",",")}`;async function Os(e,a){let t=[a.
companyId],n="company_id = $1 and status = 'aberto'";return a.terminalId?(t.push(a.terminalId),n+=` and terminal_id = $${t.length}`):(t.push(a.userId),n+=` and user_id = $${t.length}\
 and terminal_id is null`),(await e.query(`select id from cash_sessions where ${n} order by id desc limit 1 for update`,t)).rows[0]}async function ea(e,a,t){let n=(await e.query("s\
elect * from customers where id = $1 and company_id = $2 for update",[t,a.companyId])).rows[0];if(!n)throw v("Cliente n\xE3o encontrado");if(n.anonymized_at)throw g("Cliente anonim\
izado");return n}Je.get("/open",y("clientes.visualizar"),l(async(e,a)=>{let n=(await d(`select c.id, c.name, c.cpf, c.phone, c.fiado_limit_cents, a.balance, a.last_entry,
       (select min(x.created_at) from customer_account x where x.company_id = c.company_id and x.customer_id = c.id and x.kind = 'fiado') as first_fiado
     from customers c join (select customer_id, sum(amount_cents)::bigint as balance, max(created_at) as last_entry from customer_account where company_id = $1 group by customer_id\
) a
       on a.customer_id = c.id
     where c.company_id = $1 and a.balance <> 0 order by a.balance`,[e.ctx.companyId])).rows.map(o=>({...Ve(o,e.ctx),balance_cents:Number(o.balance),fiado_limit_cents:Number(o.fiado_limit_cents),
last_entry:o.last_entry,first_fiado:o.first_fiado}));a.json({items:n,debt_cents:n.filter(o=>o.balance_cents<0).reduce((o,i)=>o-i.balance_cents,0),credit_cents:n.filter(o=>o.balance_cents>
0).reduce((o,i)=>o+i.balance_cents,0)})}));Je.get("/customers/:id",y("clientes.visualizar"),l(async(e,a)=>{let t=Number(e.params.id),n=(await d("select * from customers where id = \
$1 and company_id = $2",[t,e.ctx.companyId])).rows[0];if(!n)throw v("Cliente n\xE3o encontrado");let o=(await d(`select a.id, a.kind, a.amount_cents, a.method, a.session_id, a.paym\
ent_id, a.reverses_id, a.over_limit, a.reason, a.created_at, u.name as user_name,
       exists(select 1 from customer_account x where x.reverses_id = a.id) as reversed
     from customer_account a left join users u on u.id = a.user_id where a.company_id = $1 and a.customer_id = $2 order by a.id desc limit 200`,[e.ctx.companyId,t])).rows;a.json({customer:Ve(
n,e.ctx),has_cpf:!!n.cpf,fiado_limit_cents:Number(n.fiado_limit_cents),...await ve({query:d},e.ctx.companyId,t),entries:o.map(i=>({...i,amount_cents:Number(i.amount_cents),label:lo[i.
kind]}))})}));async function Ao(e,a,t){let n=w(xe.object({amount_cents:Cs,method:xe.enum(["dinheiro","pix","debito","credito"]),reason:xe.string().trim().max(200).optional(),idempotency_key:Es}),
e.body),o=Number(e.params.id),i=(await d("select id from customer_account where company_id = $1 and idempotency_key = $2",[e.ctx.companyId,n.idempotency_key])).rows[0];if(i)return a.
json({id:i.id,replay:!0,...await ve({query:d},e.ctx.companyId,o)});let s=await x(async r=>{if(!(await ea(r,e.ctx,o)).cpf)throw g("Cadastre o CPF do cliente antes de lan\xE7ar na conta",
"cpf_required");let u=await Os(r,e.ctx);if(!u)throw g("Abra o caixa antes de receber","cash_closed");let m=await ve(r,e.ctx.companyId,o);if(t==="pagamento_fiado"){if(!m.debt_cents)
throw g("Este cliente n\xE3o tem fiado em aberto","no_debt");if(n.amount_cents>m.debt_cents)throw f(`Valor maior que o fiado em aberto (${As(m.debt_cents)}). Para deixar cr\xE9dito, u\
se "Lan\xE7ar cr\xE9dito".`,"over_debt")}let p=(await r.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, method, cash_session_id, reason, idempoten\
cy_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[e.ctx.companyId,o,t,n.amount_cents,n.method,u.id,n.reason||null,n.idempotency_key,e.ctx.userId])).rows[0];return await h(r,
e.ctx,t==="credito"?"cliente.credito_lancado":"cliente.fiado_recebido",{entity:"customer",entityId:o,reason:n.reason,data:{lancamento:p.id,valor_cents:n.amount_cents,forma:n.method,
caixa:u.id,saldo_antes:m.balance_cents,saldo_depois:m.balance_cents+n.amount_cents}}),{id:p.id,...await ve(r,e.ctx.companyId,o)}});a.status(201).json(s)}Je.post("/customers/:id/cre\
dit",y("pdv.receber","clientes.visualizar"),l((e,a)=>Ao(e,a,"credito")));Je.post("/customers/:id/settle",y("pdv.receber","clientes.visualizar"),l((e,a)=>Ao(e,a,"pagamento_fiado")));
Je.post("/customers/:id/adjust",y("clientes.gerenciar","pdv.autorizar"),l(async(e,a)=>{let t=w(xe.object({amount_cents:xe.number().int().refine(i=>i!==0&&Math.abs(i)<=1e8),reason:xe.
string().trim().min(10,"Explique o ajuste (m\xEDn. 10 caracteres)").max(300)}),e.body),n=Number(e.params.id),o=await x(async i=>{await ea(i,e.ctx,n);let s=await ve(i,e.ctx.companyId,
n),r=(await i.query("insert into customer_account (company_id, customer_id, kind, amount_cents, reason, user_id) values ($1,$2,'ajuste',$3,$4,$5) returning id",[e.ctx.companyId,n,t.
amount_cents,t.reason,e.ctx.userId])).rows[0];return await h(i,e.ctx,"cliente.conta_ajustada",{entity:"customer",entityId:n,reason:t.reason,data:{lancamento:r.id,valor_cents:t.amount_cents,
saldo_antes:s.balance_cents,saldo_depois:s.balance_cents+t.amount_cents}}),{id:r.id,...await ve(i,e.ctx.companyId,n)}});a.status(201).json(o)}));Je.post("/entries/:id/reverse",y("f\
inanceiro.estornar"),l(async(e,a)=>{let t=w(xe.object({reason:xe.string().trim().min(5).max(200)}),e.body),n=await x(async o=>{let i=(await o.query("select * from customer_account \
where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Lan\xE7amento n\xE3o encontrado");if(!["credito","pagamento_fiado","ajuste"].includes(
i.kind))throw g("Este lan\xE7amento \xE9 estornado pelo pagamento da comanda (Receber \u203A estornar)");if(await ea(o,e.ctx,i.customer_id),i.cash_session_id&&(await o.query("selec\
t status from cash_sessions where id = $1",[i.cash_session_id])).rows[0]?.status!=="aberto")throw g("O caixa deste recebimento j\xE1 foi fechado: registre um ajuste na conta com o mot\
ivo","cash_closed");let s=await ve(o,e.ctx.companyId,i.customer_id);if(i.kind==="credito"&&s.balance_cents-Number(i.amount_cents)<0&&s.balance_cents>=0)throw g("Parte deste cr\xE9dito\
 j\xE1 foi usada: estorne o uso antes ou registre um ajuste","credit_used");return await o.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, method,\
 cash_session_id, reverses_id, reason, user_id)
       values ($1,$2,'estorno',$3,$4,$5,$6,$7,$8)`,[e.ctx.companyId,i.customer_id,-Number(i.amount_cents),i.method,i.cash_session_id,i.id,t.reason,e.ctx.userId]).catch(r=>{throw r.
code==="23505"?g("Lan\xE7amento j\xE1 estornado"):r}),await h(o,e.ctx,"cliente.conta_estorno",{entity:"customer",entityId:i.customer_id,reason:t.reason,data:{lancamento:i.id,valor_cents:-Number(
i.amount_cents)}}),ve(o,e.ctx.companyId,i.customer_id)});a.json(n)}));Je.put("/customers/:id/limit",y("clientes.gerenciar","pdv.autorizar"),l(async(e,a)=>{let t=w(xe.object({fiado_limit_cents:xe.
number().int().min(0).max(1e8)}),e.body),n=await d("update customers set fiado_limit_cents = $3, updated_at = now() where id = $1 and company_id = $2 returning id",[Number(e.params.
id),e.ctx.companyId,t.fiado_limit_cents]);if(!n.rows[0])throw v("Cliente n\xE3o encontrado");await h({query:d},e.ctx,"cliente.limite_fiado",{entity:"customer",entityId:n.rows[0].id,
data:t}),a.json({ok:!0})}));import Ms from"node:crypto";import{Router as Ls}from"npm:express@5.2.1";import{z as qe}from"npm:zod@4.6.5";import Ps from"node:crypto";var Ds=()=>(O.INFINITEPAY_API_URL||"https://api.checkout.infinitepay.io").replace(/\/+$/,""),on=e=>({enabled:!1,handle:"",...e?.infinitepay||{}}),Oo=e=>String(e||"").trim().replace(
/^\$/,"").toLowerCase(),Ts=e=>e==="pix"?"pix":"credito";async function Po(e,a,t=12e3){let n;try{n=await fetch(`${Ds()}${e}`,{method:"POST",headers:{"content-type":"application/json",
accept:"application/json"},body:JSON.stringify(a),signal:AbortSignal.timeout(t)})}catch{throw new z(503,"A InfinitePay n\xE3o respondeu. Tente de novo em instantes ou receba de outra \
forma.","infinitepay_unavailable")}let o=await n.text(),i=null;try{i=o?JSON.parse(o):{}}catch{i={raw:o.slice(0,300)}}if(!n.ok){let s=i?.message||i?.error||i?.errors?.[0]?.message||
`erro ${n.status}`;throw new z(502,`InfinitePay recusou: ${String(s).slice(0,160)}`,"infinitepay_error",{status:n.status})}return i}async function Do({handle:e,amount:a,description:t,
orderNsu:n,webhookUrl:o,redirectUrl:i,customer:s}){let r={handle:e,items:[{quantity:1,price:a,description:t.slice(0,120)}],order_nsu:n};o&&(r.webhook_url=o),i&&(r.redirect_url=i),s&&
(s.name||s.email||s.phone_number)&&(r.customer=s);let c=await Po("/links",r),u=c?.url||c?.link||c?.checkout_url||c?.data?.url||(typeof c?.raw=="string"&&/^https?:\/\//.test(c.raw)?
c.raw:null);if(!u)throw new z(502,"A InfinitePay n\xE3o devolveu o link de pagamento.","infinitepay_error");return{url:u,raw:c}}async function Rs({handle:e,orderNsu:a,transactionNsu:t,
slug:n}){return Po("/payment_check",{handle:e,order_nsu:a,transaction_nsu:t,slug:n},8e3)}var To=e=>`RST${e}-${Date.now().toString(36)}-${Ps.randomBytes(3).toString("hex")}`.toUpperCase();
async function Ge(e,a,t,n,o=!0){await e.query("insert into infinitepay_events (company_id, charge_id, kind, ok, payload) values ($1,$2,$3,$4,$5)",[a.company_id,a.id,t,o,JSON.stringify(
n??{})]).catch(()=>{})}async function ht(e,a,t,n,o=Rs){return e(async i=>{let s=(await i.query("select * from infinitepay_charges where id = $1 for update",[a])).rows[0];if(!s)throw new z(
404,"Cobran\xE7a n\xE3o encontrada");if(s.status==="pago"||s.status==="divergente")return s;let r=(await i.query("select settings, timezone from companies where id = $1",[s.company_id])).
rows[0],c=on(r.settings),u=String(t.transaction_nsu||s.transaction_nsu||"").slice(0,120),m=String(t.invoice_slug||t.slug||s.invoice_slug||"").slice(0,120);if(!u||!m)return await Ge(
i,s,n,{motivo:"sem transaction_nsu/slug",info:t},!1),s;let p;try{p=await o({handle:c.handle,orderNsu:s.order_nsu,transactionNsu:u,slug:m})}catch(K){throw await Ge(i,s,"consulta",{erro:K.
message},!1),K}if(await Ge(i,s,"consulta",p,!!p?.paid),await i.query("update infinitepay_charges set transaction_nsu = $2, invoice_slug = $3 where id = $1",[s.id,u,m]),!p?.success||
!p?.paid)return{...s,transaction_nsu:u,invoice_slug:m};let _=Number(p.amount??s.amount_cents),$=Ts(p.capture_method||t.capture_method),k={capture_method:p.capture_method||t.capture_method||
null,installments:p.installments??null,paid_amount_cents:p.paid_amount??null,receipt_url:String(t.receipt_url||s.receipt_url||"").slice(0,500)||null},j={companyId:s.company_id,userId:s.
created_by};if(_!==Number(s.amount_cents)){let K=(await i.query(`update infinitepay_charges set status = 'divergente', capture_method = $2, installments = $3, paid_amount_cents = $\
4, receipt_url = $5,
          paid_at = now(), confirmed_by = $6, note = $7 where id = $1 returning *`,[s.id,k.capture_method,k.installments,k.paid_amount_cents,k.receipt_url,n,`Valor pago (${_}) dife\
rente do cobrado (${s.amount_cents})`])).rows[0];return await h(i,j,"infinitepay.divergente",{entity:"infinitepay",entityId:s.id,data:{cobrado:Number(s.amount_cents),pago:_}}),K}let C=null,
R=null,S=s.session_id?(await i.query("select * from consumption_sessions where id = $1 for update",[s.session_id])).rows[0]:null;if(S&&["aberta","em_fechamento"].includes(S.status)){
let K=await U(i,S.id);if(_<=K.balance){let B=(await i.query("select day_cutoff from units where id = $1",[S.unit_id])).rows[0];C=(await i.query(`insert into payments (company_id, s\
ession_id, cash_session_id, method, amount_cents, source, business_date, idempotency_key, user_id)
            values ($1,$2,$3,$4,$5,'integracao',$6,$7,$8) on conflict (company_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key returning id`,[s.company_id,
S.id,s.cash_session_id,$,_,pe(new Date,r.timezone,B?.day_cutoff??5),`ip-${s.order_nsu}`.slice(0,80),s.created_by])).rows[0].id,await i.query("update consumption_sessions set versio\
n = version + 1 where id = $1",[S.id])}else R="Pago, mas o saldo da comanda j\xE1 era menor: confira e devolva a diferen\xE7a pelo app da InfinitePay."}else s.session_id&&(R="Pago \
depois que a comanda foi encerrada ou cancelada: confira.");let A=C||!s.session_id?"pago":"divergente",J=(await i.query(`update infinitepay_charges set status = $2, capture_method \
= $3, installments = $4, paid_amount_cents = $5, receipt_url = $6,
        payment_id = $7, paid_at = now(), confirmed_by = $8, note = $9 where id = $1 returning *`,[s.id,A,k.capture_method,k.installments,k.paid_amount_cents,k.receipt_url,C,n,R])).
rows[0];return await h(i,j,A==="pago"?"infinitepay.pago":"infinitepay.divergente",{entity:"infinitepay",entityId:s.id,data:{comanda:s.session_id,valor_cents:_,forma:k.capture_method,
parcelas:k.installments,pagamento:C,origem:n}}),J})}var Ce=Ls(),sn=e=>{try{let a=new URL(e);return a.protocol==="https:"||O.NODE_ENV!=="production"&&a.protocol==="http:"?a.origin+a.pathname.replace(/\/+$/,""):null}catch{return null}},
Fs=(e,a)=>sn(O.PUBLIC_API_URL||"")||sn(a||"")||`${e.protocol}://${e.get("host")}`,Us=e=>sn(O.APP_URL||"")||sn(e.get("origin")||"")||"https://rusten.vercel.app";Ce.get("/settings",y(
"pdv.receber"),l(async(e,a)=>{let t=(await d("select settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json(on(t.settings))}));Ce.put("/settings",y("configuracoe\
s.gerenciar"),l(async(e,a)=>{let t=w(qe.object({enabled:qe.boolean(),handle:qe.string().trim().max(60)}),e.body),n=Oo(t.handle);if(t.enabled&&!/^[a-z0-9][a-z0-9_.-]{1,39}$/.test(n))
throw f("Informe a InfiniteTag (seu usu\xE1rio na InfinitePay, sem o $)");let o={enabled:t.enabled,handle:n};await d("update companies set settings = jsonb_set(settings, '{infinite\
pay}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(o)]),await h({query:d},e.ctx,"infinitepay.configurada",{data:o}),a.json(o)}));Ce.post("/charges",y("pdv.receber"),l(
async(e,a)=>{let t=w(qe.object({session_id:qe.number().int(),amount_cents:qe.number().int().positive().max(1e8),api_base:qe.string().max(300).optional()}),e.body);await X(`ip-charg\
e:${e.ctx.companyId}`,120,3600);let n=await x(async c=>{let u=(await c.query("select name, settings from companies where id = $1",[e.ctx.companyId])).rows[0],m=on(u.settings);if(!m.
enabled||!m.handle)throw g("Ative a InfinitePay em Configura\xE7\xF5es \u203A Integra\xE7\xF5es","infinitepay_off");let p=await Q(c,e.ctx.companyId,t.session_id);if(be(e.ctx,p.unit_id),
!["aberta","em_fechamento"].includes(p.status))throw g("Consumo encerrado","session_not_open");let _=await U(c,p.id);if(t.amount_cents>_.balance)throw f("Valor maior que o saldo da\
 comanda","over_balance");let $=(await c.query("select id from infinitepay_charges where session_id = $1 and status = 'pendente' and amount_cents = $2 and created_at > now() - inte\
rval '30 minutes' order by id desc limit 1",[p.id,t.amount_cents])).rows[0];if($)return{reuse:$.id};let k=(await c.query(`select coalesce('Comanda ' || c.number, 'Mesa ' || t.numbe\
r, s.label, 'Consumo #' || s.id) as l from consumption_sessions s
       left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id where s.id = $1`,[p.id])).rows[0].l,j=p.customer_id?(await c.query("select name, ema\
il, phone from customers where id = $1",[p.customer_id])).rows[0]:null,C=e.ctx.terminalId?(await c.query("select id from cash_sessions where company_id = $1 and terminal_id = $2 an\
d status = 'aberto' limit 1",[e.ctx.companyId,e.ctx.terminalId])).rows[0]:(await c.query("select id from cash_sessions where company_id = $1 and user_id = $2 and terminal_id is nul\
l and status = 'aberto' limit 1",[e.ctx.companyId,e.ctx.userId])).rows[0],R=To(e.ctx.companyId),S=Ms.randomBytes(18).toString("hex");return{c:(await c.query(`insert into infinitepa\
y_charges (company_id, session_id, cash_session_id, order_nsu, token, amount_cents, description, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[e.ctx.companyId,p.id,C?.id??null,R,S,t.amount_cents,`${k} \u2014 ${u.name}`.slice(0,120),e.ctx.userId])).rows[0],cfg:m,customer:j}});
if(n.reuse)return a.json(await rn(e,n.reuse));let{c:o,cfg:i,customer:s}=n,r=String(s?.phone||"").replace(/\D/g,"");try{let c=await Do({handle:i.handle,amount:Number(o.amount_cents),
description:o.description,orderNsu:o.order_nsu,webhookUrl:`${Fs(e,t.api_base)}/api/public/infinitepay/webhook/${o.token}`,redirectUrl:`${Us(e)}/pagamento/concluido?c=${o.token}`,customer:s?
{name:s.name||void 0,email:s.email||void 0,phone_number:r.length>=10?`+55${r.slice(-11)}`:void 0}:null});await d("update infinitepay_charges set link_url = $2 where id = $1",[o.id,
c.url]),await Ge({query:d},o,"link_criado",{url:c.url}),await h({query:d},e.ctx,"infinitepay.cobranca",{entity:"infinitepay",entityId:o.id,data:{comanda:o.session_id,valor_cents:Number(
o.amount_cents)}})}catch(c){throw await d("update infinitepay_charges set status = 'erro', note = $2 where id = $1",[o.id,String(c.message).slice(0,300)]),await Ge({query:d},o,"err\
o",{erro:c.message},!1),c}a.status(201).json(await rn(e,o.id))}));async function rn(e,a){let t=(await d(`select c.id, c.session_id, c.order_nsu, c.amount_cents, c.description, c.li\
nk_url, c.status, c.capture_method, c.installments,
      c.paid_amount_cents, c.receipt_url, c.payment_id, c.confirmed_by, c.note, c.created_at, c.paid_at, u.name as user_name
    from infinitepay_charges c left join users u on u.id = c.created_by where c.id = $1 and c.company_id = $2`,[a,e.ctx.companyId])).rows[0];if(!t)throw v("Cobran\xE7a n\xE3o encontrada");
return{...t,amount_cents:Number(t.amount_cents),paid_amount_cents:t.paid_amount_cents==null?null:Number(t.paid_amount_cents)}}Ce.get("/charges/:id",y("pdv.receber"),l(async(e,a)=>{
let t=Number(e.params.id),n=(await d("select id, status, transaction_nsu, invoice_slug, created_at from infinitepay_charges where id = $1 and company_id = $2",[t,e.ctx.companyId])).
rows[0];if(!n)throw v("Cobran\xE7a n\xE3o encontrada");n.status==="pendente"&&n.transaction_nsu&&n.invoice_slug&&await ht(x,t,{},"consulta").catch(()=>{}),a.json(await rn(e,t))}));
Ce.post("/charges/:id/cancel",y("pdv.receber"),l(async(e,a)=>{let t=await d("update infinitepay_charges set status = 'cancelado', canceled_at = now() where id = $1 and company_id =\
 $2 and status in ('pendente','erro') returning id",[Number(e.params.id),e.ctx.companyId]);if(!t.rows[0])throw g("Esta cobran\xE7a n\xE3o est\xE1 pendente");await h({query:d},e.ctx,
"infinitepay.cancelada",{entity:"infinitepay",entityId:t.rows[0].id}),a.json({ok:!0,note:'O link deixa de aparecer aqui. Se o cliente pagar mesmo assim, o pagamento chega como "par\
a conferir".'})}));Ce.post("/charges/:id/confirm",y("pdv.receber"),l(async(e,a)=>{let t=w(qe.object({transaction_nsu:qe.string().trim().min(6).max(120),invoice_slug:qe.string().trim().
min(3).max(120)}),e.body),n=Number(e.params.id);if(!(await d("select id from infinitepay_charges where id = $1 and company_id = $2",[n,e.ctx.companyId])).rows[0])throw v("Cobran\xE7a \
n\xE3o encontrada");await ht(x,n,t,"consulta"),a.json(await rn(e,n))}));Ce.get("/charges",y("financeiro.visualizar"),l(async(e,a)=>{let t=[e.ctx.companyId],n="c.company_id = $1";e.
query.from&&(t.push(String(e.query.from)),n+=` and c.created_at >= $${t.length}::date`),e.query.to&&(t.push(String(e.query.to)),n+=` and c.created_at < $${t.length}::date + 1`),e.query.
status&&(t.push(String(e.query.status)),n+=` and c.status = $${t.length}`);let o=(await d(`select c.id, c.session_id, c.order_nsu, c.amount_cents::bigint, c.description, c.status, \
c.capture_method, c.installments, c.paid_amount_cents,
      c.receipt_url, c.transaction_nsu, c.confirmed_by, c.note, c.created_at, c.paid_at, u.name as user_name
    from infinitepay_charges c left join users u on u.id = c.created_by where ${n} order by c.id desc limit 500`,t)).rows.map(s=>({...s,amount_cents:Number(s.amount_cents),paid_amount_cents:s.
paid_amount_cents==null?null:Number(s.paid_amount_cents)})),i=s=>o.filter(s).reduce((r,c)=>r+c.amount_cents,0);a.json({items:o,totals:{pago:i(s=>s.status==="pago"),pix:i(s=>s.status===
"pago"&&s.capture_method==="pix"),cartao:i(s=>s.status==="pago"&&s.capture_method&&s.capture_method!=="pix"),pendente:i(s=>s.status==="pendente"),divergente:i(s=>s.status==="diverg\
ente"),count:o.length}})}));Ce.get("/charges/:id/events",y("financeiro.visualizar"),l(async(e,a)=>{a.json((await d("select kind, ok, payload, created_at from infinitepay_events whe\
re charge_id = $1 and company_id = $2 order by id",[Number(e.params.id),e.ctx.companyId])).rows)}));import Bs from"node:crypto";import{Buffer as Vs}from"node:buffer";import{Router as Hs}from"npm:express@5.2.1";import{z as T}from"npm:zod@4.6.5";var ke=Hs(),cn=T.string().regex(/^\d{4}-\d{2}-\d{2}$/),gt=T.number().int().min(0).max(1e10),ta=T.string().trim().min(1).max(120),Js=T.object({account:T.string().trim().max(120).nullish(),
generated_on:cn.nullish(),period_from:cn,period_to:cn,gross_cents:gt,net_cents:gt,fee_cents:gt,tx_count:T.number().int().min(0).max(1e6),days:T.array(T.object({day:cn,gross_cents:gt,
net_cents:gt,tx_count:T.number().int().min(0).max(1e6)})).min(1).max(400),methods:T.array(T.object({label:ta,gross_cents:gt})).max(20).default([]),products:T.array(T.object({name:ta,
qty:T.number().min(0).max(1e6)})).max(300).default([]),categories:T.array(T.object({name:ta,qty:T.number().min(0).max(1e6)})).max(100).default([]),notes:T.array(T.string().trim().max(
300)).max(10).default([])}),Mo=T.object({file_name:T.string().trim().min(1).max(200),file_b64:T.string().min(10).max(7e6),mode:T.enum(["externa","conferencia"]),replace:T.boolean().
default(!1),report:Js}),Gs=e=>e.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();function Ks(e){let a=Gs(e);return/debito/.test(a)?"debito":/credito|parcelad/.test(a)?"\
credito":/pix/.test(a)?"pix":/money|dinheiro|especie/.test(a)?"dinheiro":"outro"}function Lo(e){let a=[],t=(c,u,m)=>Math.abs(c-u)<=m;e.period_from>e.period_to&&a.push("per\xEDodo com data inicial depois da final"),(new Date(e.period_to)-new Date(e.period_from))/
864e5>400&&a.push("per\xEDodo maior que 400 dias");let n=new Set;for(let c of e.days)n.has(c.day)&&a.push(`dia ${c.day} repetido`),n.add(c.day),(c.day<e.period_from||c.day>e.period_to)&&
a.push(`dia ${c.day} fora do per\xEDodo do relat\xF3rio`),c.net_cents>c.gross_cents&&a.push(`dia ${c.day}: l\xEDquido maior que o bruto`);let o=Math.max(2,e.days.length),i=e.days.reduce(
(c,u)=>c+u.gross_cents,0),s=e.days.reduce((c,u)=>c+u.net_cents,0),r=e.days.reduce((c,u)=>c+u.tx_count,0);if(t(i,e.gross_cents,o)||a.push(`soma dos dias (${i/100}) diferente da rece\
ita bruta (${e.gross_cents/100})`),t(s,e.net_cents,o)||a.push(`soma dos dias (${s/100}) diferente da receita l\xEDquida (${e.net_cents/100})`),r!==e.tx_count&&a.push(`soma das tran\
sa\xE7\xF5es por dia (${r}) diferente do total (${e.tx_count})`),e.net_cents>e.gross_cents&&a.push("receita l\xEDquida maior que a bruta"),t(e.gross_cents-e.net_cents,e.fee_cents,2)||
a.push("taxas diferentes de bruto \u2212 l\xEDquido"),e.methods.length){let c=e.methods.reduce((u,m)=>u+m.gross_cents,0);t(c,e.gross_cents,Math.max(2,e.methods.length))||a.push(`so\
ma das formas de pagamento (${c/100}) diferente da receita bruta (${e.gross_cents/100})`)}return a}async function Fo(e,a,t){if(!t.length)return[];let n=(await e.query(`select p.bus\
iness_date as day, p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total
      from payments p where p.company_id = $1 and p.status = 'confirmado' and p.business_date = any($2::date[])
        and p.method in ('debito','credito','pix','dinheiro') group by 1, 2`,[a,t.map(o=>o.day)])).rows;return t.map(o=>{let i=n.filter(r=>r.day===o.day),s=i.filter(r=>r.method!=="\
dinheiro").reduce((r,c)=>r+Number(c.total),0);return{day:o.day,report_gross_cents:o.gross_cents,report_tx:o.tx_count,rusten_card_pix_cents:s,rusten_cash_cents:i.filter(r=>r.method===
"dinheiro").reduce((r,c)=>r+Number(c.total),0),rusten_card_pix_count:i.filter(r=>r.method!=="dinheiro").reduce((r,c)=>r+c.n,0)}})}async function Uo(e,a,t){return(await e.query(`sel\
ect i.id, i.file_name, i.period_from, i.period_to, i.mode, count(d.id)::int as days
      from pos_sales_days d join pos_sales_imports i on i.id = d.import_id
     where d.company_id = $1 and d.provider = 'infinitepay' and d.active and d.day = any($2::date[])
     group by i.id order by i.id`,[a,t.map(n=>n.day)])).rows}function Bo(e){let a=Vs.from(e,"base64");if(a.length<100||a.length>5*1024*1024)throw f("Arquivo vazio ou maior que 5 MB");
if(a.subarray(0,5).toString("latin1")!=="%PDF-")throw f("O arquivo n\xE3o \xE9 um PDF");return{buf:a,sha:Bs.createHash("sha256").update(a).digest("hex")}}ke.post("/preview",y("fina\
nceiro.visualizar"),l(async(e,a)=>{let t=w(Mo.omit({mode:!0,replace:!0}),e.body),{sha:n}=Bo(t.file_b64),o=(await d("select id, created_at from pos_sales_imports where company_id = \
$1 and file_sha256 = $2 and status = 'ativo'",[e.ctx.companyId,n])).rows[0];a.json({problems:Lo(t.report),duplicate:o||null,overlaps:await Uo({query:d},e.ctx.companyId,t.report.days),
reconciliation:await Fo({query:d},e.ctx.companyId,t.report.days)})}));ke.post("/",y("financeiro.visualizar"),l(async(e,a)=>{let t=w(Mo,e.body),n=t.report,o=Lo(n);if(o.length)throw f(
`O relat\xF3rio n\xE3o fecha: ${o.slice(0,3).join("; ")}`,"report_inconsistent");let{buf:i,sha:s}=Bo(t.file_b64),r=await x(async c=>{await c.query("select pg_advisory_xact_lock(has\
htext('pos-sales:' || $1::text))",[e.ctx.companyId]);let u=(await c.query("select id from pos_sales_imports where company_id = $1 and file_sha256 = $2 and status = 'ativo'",[e.ctx.
companyId,s])).rows[0];if(u)throw g("Este relat\xF3rio j\xE1 foi importado","duplicate",{import_id:u.id});let m=await Uo(c,e.ctx.companyId,n.days);if(m.length&&!t.replace)throw g("\
J\xE1 existe importa\xE7\xE3o ativa para parte destes dias","overlap",{overlaps:m});if(m.length&&!e.ctx.can("financeiro.estornar"))throw F('Substituir uma importa\xE7\xE3o exige a permis\
s\xE3o "Estornar pagamentos"');let p=n.methods.map($=>({method:Ks($.label),label:$.label,gross_cents:$.gross_cents})),_=(await c.query(`insert into pos_sales_imports (company_id, m\
ode, file_name, file_sha256, file_data, account_label, period_from, period_to, generated_on,
          gross_cents, net_cents, fee_cents, tx_count, methods, products, categories, notes, created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,[e.ctx.companyId,t.mode,t.file_name,s,i,n.account||null,n.period_from,n.period_to,n.generated_on||
null,n.gross_cents,n.net_cents,n.fee_cents,n.tx_count,JSON.stringify(p),JSON.stringify(n.products),JSON.stringify(n.categories),JSON.stringify(n.notes),e.ctx.userId])).rows[0];for(let $ of m)
await Vo(c,e.ctx,$.id,`Substitu\xEDda pela importa\xE7\xE3o #${_.id}`),await h(c,e.ctx,"maquininha.importacao_substituida",{entity:"pos_sales_import",entityId:$.id,reason:`nova imp\
orta\xE7\xE3o #${_.id}`});for(let $ of n.days)await c.query("insert into pos_sales_days (company_id, import_id, provider, day, gross_cents, net_cents, tx_count) values ($1,$2,$3,$4\
,$5,$6,$7)",[e.ctx.companyId,_.id,"infinitepay",$.day,$.gross_cents,$.net_cents,$.tx_count]);return await h(c,e.ctx,"maquininha.importada",{entity:"pos_sales_import",entityId:_.id,
data:{file:t.file_name,sha256:s,mode:t.mode,period:[n.period_from,n.period_to],gross_cents:n.gross_cents,net_cents:n.net_cents,tx_count:n.tx_count,replaced:m.map($=>$.id)}}),{id:_.
id,replaced:m.map($=>$.id)}});a.status(201).json(r)}));ke.get("/",y("financeiro.visualizar"),l(async(e,a)=>{let t=(await d(`select i.id, i.mode, i.file_name, i.account_label, i.per\
iod_from, i.period_to, i.generated_on, i.gross_cents, i.net_cents, i.fee_cents, i.tx_count,
      i.methods, i.status, i.created_at, i.canceled_at, i.cancel_reason, u.name as user_name, cu.name as canceled_by_name
    from pos_sales_imports i left join users u on u.id = i.created_by left join users cu on cu.id = i.canceled_by
    where i.company_id = $1 order by i.period_to desc, i.id desc limit 100`,[e.ctx.companyId])).rows,n=t.filter(i=>i.status==="ativo"),o=(i,s)=>n.filter(r=>!s||r.mode===s).reduce((r,c)=>r+
Number(c[i]),0);a.json({items:t,totals:{gross_cents:o("gross_cents","externa"),net_cents:o("net_cents","externa"),fee_cents:o("fee_cents","externa"),tx_count:o("tx_count","externa")}})}));
ke.get("/:id",y("financeiro.visualizar"),l(async(e,a)=>{let t=(await d(`select i.id, i.mode, i.file_name, i.file_sha256, i.account_label, i.period_from, i.period_to, i.generated_on\
, i.gross_cents, i.net_cents, i.fee_cents, i.tx_count,
      i.methods, i.products, i.categories, i.notes, i.status, i.created_at, i.canceled_at, i.cancel_reason, u.name as user_name
    from pos_sales_imports i left join users u on u.id = i.created_by where i.id = $1 and i.company_id = $2`,[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw v("Importa\xE7\
\xE3o n\xE3o encontrada");let n=(await d("select day, gross_cents, net_cents, tx_count, active from pos_sales_days where import_id = $1 order by day",[t.id])).rows;a.json({...t,days:n,
reconciliation:await Fo({query:d},e.ctx.companyId,n)})}));ke.get("/:id/file",y("financeiro.visualizar"),l(async(e,a)=>{let t=(await d("select file_name, file_data from pos_sales_im\
ports where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t?.file_data)throw v("Arquivo n\xE3o encontrado");a.setHeader("content-type","applicati\
on/pdf"),a.setHeader("content-disposition",`attachment; filename="${t.file_name.replace(/[^\w.\- ]/g,"_")}"`),a.send(t.file_data)}));async function Vo(e,a,t,n){await e.query("updat\
e pos_sales_days set active = false where import_id = $1",[t]),await e.query("update pos_sales_imports set status = 'cancelado', canceled_by = $2, canceled_at = now(), cancel_reaso\
n = $3 where id = $1",[t,a.userId,n]);let o=(await e.query("select id from pos_sales_items where import_id = $1 and status = 'baixado' for update",[t])).rows;for(let i of o){let s=(await e.
query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'pos_sales_item' and m.ref_id = $2 and m.kind = 'venda'
      and not exists (select 1 from stock_movements x where x.reverses_id = m.id)`,[a.companyId,i.id])).rows;for(let r of s)await e.query(`insert into stock_movements (company_id, \
stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
        values ($1,$2,'estorno_venda',$3,$4,'pos_sales_item_rev',$5,$6,$7,$8)`,[a.companyId,r.stock_item_id,-Number(r.qty),r.unit_cost_cents,i.id,r.id,`Importa\xE7\xE3o da maquininha can\
celada: ${n}`.slice(0,300),a.userId]);await e.query("update pos_sales_items set status = 'estornado' where id = $1",[i.id])}return o.length}var Ws=new Set(["de","da","do","das","do\
s","e","com","sem","ml","l","lt","un","und","g","kg","a","o"]),ot=e=>String(e||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/(\d)([a-z])/g,"$1 $2").replace(
/([a-z])(\d)/g,"$1 $2").replace(/[^a-z0-9]+/g," ").trim(),Ro=e=>[...new Set(ot(e).split(" ").filter(a=>a&&!Ws.has(a)))];function Xs(e,a){if(Math.abs(e.length-a.length)>2)return 3;let t=Array.
from({length:e.length+1},(n,o)=>[o,...Array(a.length).fill(0)]);for(let n=1;n<=a.length;n++)t[0][n]=n;for(let n=1;n<=e.length;n++)for(let o=1;o<=a.length;o++)t[n][o]=Math.min(t[n-1][o]+
1,t[n][o-1]+1,t[n-1][o-1]+(e[n-1]===a[o-1]?0:1));return t[e.length][a.length]}var Ys=(e,a)=>e===a||e.length>=4&&a.length>=4&&(e.startsWith(a)||a.startsWith(e))||Math.min(e.length,a.
length)>=5&&Xs(e,a)<=(Math.min(e.length,a.length)>=8?2:1);function Zs(e,a){let t=Ro(e),n=Ro(a);if(!t.length||!n.length)return 0;let o=new Set,i=0;for(let s of t){let r=n.findIndex(
(c,u)=>!o.has(u)&&Ys(s,c));r>=0&&(o.add(r),i++)}return 2*i/(t.length+n.length)}function Qs(e,a){let t=null;for(let n of a){let o=ot(n.name)===ot(e)?1:Zs(e,n.name);(!t||o>t.score)&&
(t={product_id:n.id,name:n.name,score:Math.round(o*100)/100})}return t&&t.score>=.5?t:null}async function dn(e,a,t,n=!1){let o=(await e.query(`select id, status, mode, period_from,\
 period_to, products, categories from pos_sales_imports where id = $1 and company_id = $2${n?" for update":""}`,[Number(t),a.companyId])).rows[0];if(!o)throw v("Importa\xE7\xE3o n\xE3o enco\
ntrada");return o}async function er(e,a,t){if((await e.query("select 1 from pos_sales_items where import_id = $1 limit 1",[t.id])).rows[0]||!t.products?.length)return;let o=(await e.
query("select id, name from products where company_id = $1 and active",[a.companyId])).rows,i=Object.fromEntries((await e.query("select alias_norm, product_id from pos_product_alia\
ses where company_id = $1 and provider = 'infinitepay'",[a.companyId])).rows.filter(s=>o.some(r=>Number(r.id)===Number(s.product_id))).map(s=>[s.alias_norm,s.product_id]));for(let s of t.
products){if(!(Number(s.qty)>0))continue;let r=o.find(u=>ot(u.name)===ot(s.name)),c=i[ot(s.name)]??r?.id??null;await e.query("insert into pos_sales_items (company_id, import_id, re\
port_name, qty, product_id) values ($1,$2,$3,$4,$5)",[a.companyId,t.id,s.name,s.qty,c])}}async function mn(e,a,t){let n=(await e.query(`select i.id, i.report_name, i.source, i.qty:\
:float as qty, i.product_id, i.status, i.posted_at, u.name as posted_by_name
      from pos_sales_items i left join users u on u.id = i.posted_by where i.import_id = $1 order by i.source desc, i.qty desc, i.id`,[t.id])).rows,o=(await e.query("select id, nam\
e, stock_mode, stock_item_id, cost_cents from products where company_id = $1 and active order by name",[a.companyId])).rows,i=Object.fromEntries(o.map(u=>[Number(u.id),u])),s=Object.
fromEntries((await e.query("select id, name, unit from stock_items where company_id = $1",[a.companyId])).rows.map(u=>[Number(u.id),u]));for(let u of n){let m=i[Number(u.product_id)];
if(u.product_name=m?.name||null,u.untracked=m?m.stock_mode==="nenhum":!1,!m&&u.status==="pendente"&&(u.suggestion=Qs(u.report_name,o)),m){let p=await nt(e,a.companyId,m,u.qty,[]);u.
stock=[...p.entries()].map(([_,$])=>({stock_item_id:_,name:s[_]?.name,unit:s[_]?.unit,qty:Math.round($*1e3)/1e3}))}(u.status==="baixado"||u.status==="estornado")&&(u.moved=(await e.
query(`select s.name, s.unit, -m.qty::float as qty from stock_movements m join stock_items s on s.id = m.stock_item_id
        where m.company_id = $1 and m.ref_type = 'pos_sales_item' and m.ref_id = $2 and m.kind = 'venda'`,[a.companyId,u.id])).rows)}let r=(t.products||[]).reduce((u,m)=>u+Number(m.
qty||0),0),c=(t.categories||[]).reduce((u,m)=>u+Number(m.qty||0),0);return{rows:n,products:o.map(u=>({id:u.id,name:u.name,stock_mode:u.stock_mode})),summary:{report_qty:r,categories_qty:c,
missing_qty:Math.max(0,c-r)},can_post:t.status==="ativo"&&t.mode==="externa",mode:t.mode,status:t.status,can_edit:a.can("estoque.ajustar"),can_create:a.can("estoque.ajustar")&&a.can(
"cardapio.gerenciar")}}ke.get("/:id/items",y("financeiro.visualizar"),l(async(e,a)=>{let t=await x(async n=>{let o=await dn(n,e.ctx,e.params.id,!0);return o.status==="ativo"&&await er(
n,e.ctx,o),mn(n,e.ctx,o)});a.json(t)}));ke.put("/:id/items",y("financeiro.visualizar"),l(async(e,a)=>{V(e.ctx,"estoque.ajustar");let t=w(T.object({rows:T.array(T.object({id:T.number().
int().optional(),report_name:T.string().trim().min(1).max(120).optional(),qty:T.number().positive().max(1e5),product_id:T.number().int().nullable(),ignored:T.boolean().default(!1)})).
max(400)}),e.body),n=await x(async o=>{let i=await dn(o,e.ctx,e.params.id,!0);if(i.status!=="ativo")throw g("Importa\xE7\xE3o cancelada");let s=[...new Set(t.rows.map(u=>u.product_id).
filter(Boolean))];if(s.length&&(await o.query("select count(*)::int as n from products where company_id = $1 and id = any($2)",[e.ctx.companyId,s])).rows[0].n!==s.length)throw f("P\
roduto inv\xE1lido");let r=(await o.query("select id, source, status from pos_sales_items where import_id = $1 for update",[i.id])).rows,c=new Set;for(let u of t.rows){let m=u.ignored?
"ignorado":"pendente";if(u.id){let p=r.find(_=>Number(_.id)===u.id);if(!p)throw f("Linha inv\xE1lida");if(c.add(u.id),p.status==="baixado"||p.status==="estornado")continue;await o.
query("update pos_sales_items set qty = $2, product_id = $3, status = $4 where id = $1",[u.id,u.qty,u.product_id,m])}else{if(!u.product_id)throw f("Escolha o produto da linha acres\
centada");let p=(await o.query("select name from products where id = $1",[u.product_id])).rows[0];await o.query("insert into pos_sales_items (company_id, import_id, report_name, so\
urce, qty, product_id, status) values ($1,$2,$3,'manual',$4,$5,$6)",[e.ctx.companyId,i.id,(u.report_name||p.name).slice(0,120),u.qty,u.product_id,m])}}for(let u of r)u.source==="ma\
nual"&&!c.has(Number(u.id))&&(u.status==="pendente"||u.status==="ignorado")&&await o.query("delete from pos_sales_items where id = $1",[u.id]);return mn(o,e.ctx,i)});a.json(n)}));async function Ho(e,a,t){
let n=(await e.query("select id from stock_items where company_id = $1 and lower(name) = lower($2)",[a.companyId,t.name.slice(0,80)])).rows[0];return n||(n=(await e.query("insert i\
nto stock_items (company_id, name, unit, avg_cost_cents) values ($1,$2,'un',$3) returning id",[a.companyId,t.name.slice(0,80),Number(t.cost_cents)||0])).rows[0]),await e.query("upd\
ate products set stock_mode = 'acabado', stock_item_id = $3, updated_at = now() where id = $1 and company_id = $2",[t.id,a.companyId,n.id]),await h(e,a,"estoque.produtos_controlado\
s",{entity:"product",entityId:t.id,data:{origem:"maquininha",stock_item_id:n.id}}),n.id}ke.post("/:id/items/create-products",y("financeiro.visualizar"),l(async(e,a)=>{V(e.ctx,"esto\
que.ajustar"),V(e.ctx,"cardapio.gerenciar");let t=w(T.object({rows:T.array(T.object({id:T.number().int(),name:T.string().trim().min(1).max(120),price_cents:T.number().int().min(0).
max(1e8).nullable().default(null)})).min(1).max(200)}),e.body),n=await x(async o=>{let i=await dn(o,e.ctx,e.params.id,!0);if(i.status!=="ativo")throw g("Importa\xE7\xE3o cancelada");
let s=(await o.query("select id from categories where company_id = $1 and name = 'Maquininha' and not demo",[e.ctx.companyId])).rows[0];s||(s=(await o.query("insert into categories\
 (company_id, name, sort) values ($1,'Maquininha',999) returning id",[e.ctx.companyId])).rows[0]);let r=[];for(let c of t.rows){let u=(await o.query("select id, status from pos_sal\
es_items where id = $1 and import_id = $2 for update",[c.id,i.id])).rows[0];if(!u||u.status!=="pendente")throw f("Linha inv\xE1lida ou j\xE1 lan\xE7ada");let m=(await o.query("sele\
ct id, name, cost_cents, stock_mode from products where company_id = $1 and lower(name) = lower($2) and active",[e.ctx.companyId,c.name])).rows[0];m||(m=(await o.query(`insert into\
 products (company_id, name, description, kind, unit, price_cents, cost_cents, category_id, active, channels)
            values ($1,$2,$3,'resale','un',$4,0,$5,true,'{pdv}') returning id, name, cost_cents, stock_mode`,[e.ctx.companyId,c.name,"Cadastrado pela importa\xE7\xE3o da maquininha: conf\
ira pre\xE7o, categoria e ficha t\xE9cnica.",c.price_cents??0,s.id])).rows[0],await o.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_i\
d) values ($1,$2,null,$3,$4)",[e.ctx.companyId,m.id,c.price_cents??0,e.ctx.userId]),await h(o,e.ctx,"produto.criado",{entity:"product",entityId:m.id,data:{name:c.name,price_cents:c.
price_cents??0,origem:"maquininha"}}),r.push(c.name)),m.stock_mode==="nenhum"&&await Ho(o,e.ctx,m),await o.query("update pos_sales_items set product_id = $2 where id = $1",[c.id,m.
id])}return{created:r,view:await mn(o,e.ctx,i)}});a.status(201).json(n)}));ke.post("/:id/items/post",y("financeiro.visualizar"),l(async(e,a)=>{V(e.ctx,"estoque.ajustar");let t=w(T.
object({control_untracked:T.boolean().default(!1)}),e.body||{}),n=await x(async o=>{let i=await dn(o,e.ctx,e.params.id,!0);if(i.status!=="ativo")throw g("Importa\xE7\xE3o cancelada");
if(i.mode!=="externa")throw g("Esta importa\xE7\xE3o \xE9 s\xF3 de confer\xEAncia: as vendas j\xE1 baixaram o estoque pelas comandas","conference_only");let s=(await o.query("selec\
t * from pos_sales_items where import_id = $1 and status = 'pendente' order by id for update",[i.id])).rows,r=s.filter(S=>!S.product_id);if(r.length)throw f(`Escolha o produto (ou \
marque "ignorar") para: ${r.slice(0,5).map(S=>S.report_name).join(", ")}`,"unmapped");if(!s.length)throw f("Nada pendente para lan\xE7ar");let c=[];if(t.control_untracked){let S=(await o.
query("select id, name, cost_cents from products where company_id = $1 and id = any($2) and stock_mode = 'nenhum' for update",[e.ctx.companyId,[...new Set(s.map(A=>Number(A.product_id)))]])).
rows;for(let A of S)await Ho(o,e.ctx,A);c=S.map(A=>A.name)}let u=(await o.query("select settings from companies where id = $1",[e.ctx.companyId])).rows[0],m=ze(u.settings),p=`${String(
i.period_from).split("-").reverse().join("/")} a ${String(i.period_to).split("-").reverse().join("/")}`,_=[],$=new Map;for(let S of s){let A=(await o.query("select id, name, stock_\
mode, stock_item_id, cost_cents from products where id = $1 and company_id = $2",[S.product_id,e.ctx.companyId])).rows[0],J=await nt(o,e.ctx.companyId,A,Number(S.qty),[]);_.push({r:S,
p:A,need:J});for(let[K,B]of J)$.set(K,($.get(K)||0)+B)}let k=[...$.keys()],j=k.length?(await o.query("select id, name, unit, avg_cost_cents from stock_items where company_id = $1 a\
nd id = any($2) order by id for update",[e.ctx.companyId,k])).rows:[];if(!m.allow_negative&&k.length){let S=await Be(o,e.ctx.companyId,k),A=j.filter(J=>(S[J.id]||0)-$.get(Number(J.
id))<-1e-4);if(A.length)throw g(`Estoque insuficiente: ${A.map(J=>`${J.name} (saldo ${(S[J.id]||0).toLocaleString("pt-BR")} ${J.unit})`).join(", ")}. Lance a entrada antes ou permi\
ta estoque negativo.`,"stock_insufficient")}let C=Object.fromEntries(j.map(S=>[Number(S.id),S.avg_cost_cents])),R=0;for(let{r:S,p:A,need:J}of _){for(let[K,B]of J){let ae=await o.query(
`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
          values ($1,$2,'venda',$3,$4,'pos_sales_item',$5,$6,$7) on conflict do nothing returning id`,[e.ctx.companyId,K,-B,C[K],S.id,`Venda na maquininha (${p}): ${S.report_name} \
\xD7 ${Number(S.qty).toLocaleString("pt-BR")}`.slice(0,300),e.ctx.userId]);R+=ae.rowCount}await o.query("update pos_sales_items set status = 'baixado', posted_at = now(), posted_by\
 = $2 where id = $1",[S.id,e.ctx.userId]),S.source==="relatorio"&&await o.query(`insert into pos_product_aliases (company_id, provider, alias_norm, product_id) values ($1,'infinite\
pay',$2,$3)
          on conflict (company_id, provider, alias_norm) do update set product_id = excluded.product_id, updated_at = now()`,[e.ctx.companyId,ot(S.report_name),A.id])}return await h(
o,e.ctx,"maquininha.estoque_baixado",{entity:"pos_sales_import",entityId:i.id,data:{rows:s.length,movements:R,controlled:c,items:_.map(({r:S,p:A})=>({report:S.report_name,product:A.
name,qty:Number(S.qty)}))}}),{posted:s.length,movements:R,controlled:c,without_stock:_.filter(S=>!S.need.size).map(S=>S.p.name),view:await mn(o,e.ctx,i)}});a.json(n)}));ke.post("/:\
id/cancel",y("financeiro.estornar"),l(async(e,a)=>{let t=w(T.object({reason:T.string().trim().min(5,"informe o motivo (m\xEDnimo 5 caracteres)").max(200)}),e.body);await x(async n=>{
let o=(await n.query("select id, status from pos_sales_imports where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw v("Importa\xE7\
\xE3o n\xE3o encontrada");if(o.status!=="ativo")throw g("Importa\xE7\xE3o j\xE1 cancelada");let i=await Vo(n,e.ctx,o.id,t.reason);await h(n,e.ctx,"maquininha.importacao_cancelada",
{entity:"pos_sales_import",entityId:o.id,reason:t.reason,data:{stock_reversed_rows:i}})}),a.json({ok:!0})}));import{Router as tr}from"npm:express@5.2.1";import{z as un}from"npm:zod@4.6.5";var ln=tr(),Jo=e=>{let a=w(un.object({from:un.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:un.string().regex(/^\d{4}-\d{2}-\d{2}$/),unit_id:un.coerce.number().int().optional()}),e);if(a.
from>a.to)throw f("Data inicial depois da final");if((new Date(a.to)-new Date(a.from))/864e5>400)throw f("Per\xEDodo m\xE1ximo de 400 dias");return a};async function Go(e,a){let t=e.
can("financeiro.visualizar"),n=e.can("relatorios.cmv"),o=e.company.timezone,i=[e.companyId,a.from,a.to],s="";a.unit_id&&(i.push(a.unit_id),s=` and s.unit_id = $${i.length}`);let r=`\
s.company_id = $1 and s.business_date between $2 and $3${s}`,c=`${r} and s.status = 'encerrada'`,u=`from order_items i join consumption_sessions s on s.id = i.session_id where ${c}\
 and i.status = 'ativo'`,m=(await d(`with x as (
      select s.id, s.service_fee_bp, s.delivery_fee_cents, (select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo') as items
      from consumption_sessions s where ${c})
    select count(*)::int as sessions, coalesce(sum(items),0)::bigint as items_cents,
      coalesce(sum(round(items * service_fee_bp / 10000.0)),0)::bigint as service_fee_cents, coalesce(sum(delivery_fee_cents),0)::bigint as delivery_fee_cents from x`,i)).rows[0],p=Number(
m.items_cents)+Number(m.service_fee_cents)+Number(m.delivery_fee_cents),_=(await d(`select p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total, coalesce(\
sum(p.change_cents),0)::bigint as change
    from payments p join consumption_sessions s on s.id = p.session_id where p.company_id = $1 and p.business_date between $2 and $3${s} and p.status = 'confirmado' group by p.meth\
od order by total desc`,i)).rows,$=(await d(`select count(*)::int as n, coalesce(sum((select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status \
= 'ativo')
      - (select coalesce(sum(amount_cents),0) from payments p where p.session_id = s.id and p.status = 'confirmado')),0)::bigint as balance
    from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')${a.unit_id?" and s.unit_id = $2":""}`,a.unit_id?[e.companyId,a.unit_id]:[e.companyId])).
rows[0],k=(await d(`select s.business_date as day, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u} group by 1 order by 1`,i)).rows,
j=(await d(`select extract(hour from i.created_at at time zone '${o.replace(/'/g,"")}')::int as hour, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u}\
 group by 1 order by 1`,i)).rows,C=(await d(`select i.product_id, max(i.description) as name, max(c.name) as category, sum(i.qty)::float as qty, sum(i.total_cents)::bigint as items\
_cents,
      sum(coalesce((select -sum(m.qty * m.unit_cost_cents) from stock_movements m where m.ref_type = 'order_item' and m.ref_id = i.id and m.kind = 'venda'),
        p.cost_cents * i.qty))::bigint as cost_cents
    ${u.replace("where","join products p on p.id = i.product_id left join categories c on c.id = p.category_id where")} group by i.product_id order by items_cents desc`,i)).rows,R=Object.
values(C.reduce((q,oe)=>{let Ke=oe.category||"Sem categoria";return q[Ke]||={name:Ke,qty:0,items_cents:0,cost_cents:0},q[Ke].qty+=oe.qty,q[Ke].items_cents+=Number(oe.items_cents),q[Ke].
cost_cents+=Number(oe.cost_cents),q},{})).sort((q,oe)=>oe.items_cents-q.items_cents),S=C.reduce((q,oe)=>q+Number(oe.items_cents),0)||1,A=0;for(let q of C)A+=Number(q.items_cents),q.
abc=A/S<=.8?"A":A/S<=.95?"B":"C";let J=(await d(`select u.name, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u.replace("where","left join users u\
 on u.id = i.user_id where")} group by u.name order by items_cents desc`,i)).rows,K=(await d(`select t.number, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)\
::bigint as items_cents,
      round(avg(extract(epoch from (s.closed_at - s.opened_at)) / 60)::numeric)::int as avg_minutes
    ${u.replace("where","join dining_tables t on t.id = s.table_id where")} group by t.number order by t.number`,i)).rows,B=(await d(`select s.kind as channel, count(distinct s.id)\
::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u} group by 1 order by 3 desc`,i)).rows,ae=(await d(`select coalesce(tm.name, 'Sem terminal') as name, co\
unt(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${u.replace("where","left join terminals tm on tm.id = i.terminal_id where")} group by 1 order by 3 desc`,
i)).rows,De=(await d(`select i.launch_mode, count(*)::int as n from order_items i join consumption_sessions s on s.id = i.session_id where ${r} group by 1`,i)).rows,Ne=(await d(`se\
lect
      count(*) filter (where i.status = 'cancelado')::int as canceled_items, coalesce(sum(i.total_cents) filter (where i.status = 'cancelado'),0)::bigint as canceled_cents,
      coalesce(sum(i.discount_cents) filter (where i.status = 'ativo'),0)::bigint as discounts_cents, count(*) filter (where i.discount_cents > 0)::int as discounted_items
    from order_items i join consumption_sessions s on s.id = i.session_id where ${r}`,i)).rows[0],Tt=(await d(`select action, count(*)::int as n from audit_events where company_id \
= $1 and created_at >= $2::date and created_at < $3::date + 1
      and action in ('consumo.reaberto','consumo.cancelado','pdv.itens_transferidos','pdv.mesa_trocada','autorizacao.concedida','autorizacao.negada','leitura.desconhecida','pdv.exc\
ecao_manual','pagamento.estornado','pdv.taxa_servico')
    group by action`,[e.companyId,a.from,a.to])).rows,ii=(await d(`select ps.name as sector, count(*)::int as items, round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::n\
umeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
    from order_items i join consumption_sessions s on s.id = i.session_id join production_sectors ps on ps.id = i.sector_id
    where ${r} and i.ready_at is not null and i.sent_at is not null group by ps.name order by ps.name`,i)).rows,si=(await d(`select count(*)::int as orders, count(*) filter (where \
d.status = 'cancelado')::int as canceled,
      round(avg(extract(epoch from (e.created_at - d.created_at)) / 60)::numeric)::int as avg_minutes_to_deliver
    from delivery_orders d join consumption_sessions s on s.id = d.session_id
    left join lateral (select created_at from delivery_events where order_id = d.id and status = 'entregue' order by id limit 1) e on true where ${r}`,i)).rows[0],ri=(await d(`sele\
ct coalesce(sum(-m.qty * m.unit_cost_cents) filter (where m.kind = 'perda'),0)::bigint as losses_cents,
      coalesce(sum(m.qty * m.unit_cost_cents) filter (where m.kind = 'inventario'),0)::bigint as inventory_diff_cents
    from stock_movements m where m.company_id = $1 and m.created_at >= $2::date and m.created_at < $3::date + 1`,[e.companyId,a.from,a.to])).rows[0],ci=(await d(`select count(disti\
nct s.customer_id)::int as identified,
      count(distinct s.customer_id) filter (where exists (select 1 from consumption_sessions o where o.customer_id = s.customer_id and o.status = 'encerrada' and o.business_date < \
$2))::int as returning
    from consumption_sessions s where ${c} and s.customer_id is not null`,i)).rows[0],di=(await d(`select coalesce(sum(points) filter (where kind = 'ganho'),0)::int as earned, coal\
esce(-sum(points) filter (where kind = 'resgate'),0)::int as redeemed
    from loyalty_ledger where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1`,[e.companyId,a.from,a.to])).rows[0],mi=(await d("select count(*)::int as n, \
round(avg(score)::numeric, 2)::float as average from reviews where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1",[e.companyId,a.from,a.to])).rows[0],ui=t?
(await d(`select count(*)::int as sessions, coalesce(sum(difference_cents),0)::bigint as difference_cents,
      count(*) filter (where difference_cents <> 0)::int as with_difference from cash_sessions where company_id = $1 and business_date between $2 and $3 and status = 'fechado'`,[e.
companyId,a.from,a.to])).rows[0]:null,bn=t?(await d(`select m.kind, coalesce(sum(m.amount_cents),0)::bigint as total from cash_movements m join cash_sessions c on c.id = m.cash_ses\
sion_id
      where m.company_id = $1 and c.business_date between $2 and $3 group by m.kind`,[e.companyId,a.from,a.to])).rows:null,$t=t?(await d(`select d.day, d.import_id, d.gross_cents, \
d.net_cents, d.tx_count from pos_sales_days d join pos_sales_imports i on i.id = d.import_id
      where d.company_id = $1 and d.active and i.mode = 'externa' and d.day between $2 and $3 order by d.day`,[e.companyId,a.from,a.to])).rows:[],Te=null;if(t&&$t.length){let q=(await d(
"select id, period_from, period_to, gross_cents, methods from pos_sales_imports where id = any($1::bigint[])",[[...new Set($t.map(W=>W.import_id))]])).rows,oe={},Ke=!0,ya=0,_i=Object.
fromEntries((await d(`select i.import_id, coalesce(sum(-m.qty * m.unit_cost_cents),0)::float as cost
        from pos_sales_items i join stock_movements m on m.company_id = i.company_id and m.ref_type = 'pos_sales_item' and m.ref_id = i.id and m.kind = 'venda'
       where i.import_id = any($1::bigint[]) and i.status = 'baixado' group by i.import_id`,[q.map(W=>W.id)])).rows.map(W=>[Number(W.import_id),W.cost]));for(let W of q){let Re=$t.
filter(Me=>Me.import_id===W.id).reduce((Me,yi)=>Me+Number(yi.gross_cents),0);(W.period_from<a.from||W.period_to>a.to)&&(Ke=!1);let rt=W.gross_cents?Re/W.gross_cents:0;for(let Me of W.
methods)oe[Me.method]=(oe[Me.method]||0)+Math.round(Me.gross_cents*rt);ya+=Math.round((_i[Number(W.id)]||0)*rt)}let xt=W=>$t.reduce((Re,rt)=>Re+Number(rt[W]),0);Te={gross_cents:xt(
"gross_cents"),net_cents:xt("net_cents"),fee_cents:xt("gross_cents")-xt("net_cents"),tx_count:xt("tx_count"),by_day:$t.map(({day:W,gross_cents:Re,net_cents:rt,tx_count:Me})=>({day:W,
gross_cents:Re,net_cents:rt,tx_count:Me})),by_method:Object.entries(oe).map(([W,Re])=>({method:W,total:Re})).sort((W,Re)=>Re.total-W.total),methods_exact:Ke,imports:q.length,cmv_cents:n?
ya:null}}let vt=C.reduce((q,oe)=>q+Number(oe.cost_cents),0),ne=q=>t?q:null;if(!n)for(let q of[...C,...R])delete q.cost_cents;let li=_.reduce((q,oe)=>q+Number(oe.total),0),pi=t&&n?{
receita_bruta:p,taxa_servico:Number(m.service_fee_cents),taxa_entrega:Number(m.delivery_fee_cents),cmv:vt,lucro_bruto:Number(m.items_cents)-vt,despesas_caixa:Number(bn?.find(q=>q.kind===
"despesa")?.total||0),maquininha_bruta:Te?.gross_cents||0,maquininha_taxas:Te?.fee_cents||0,maquininha_cmv:Te?.cmv_cents||0,resultado:Number(m.items_cents)-vt-Number(bn?.find(q=>q.
kind==="despesa")?.total||0)+(Te?.net_cents||0)-(Te?.cmv_cents||0)}:null;return{period:{from:a.from,to:a.to},permissions:{financial:t,cmv:n},summary:{sessions:m.sessions,revenue_cents:ne(
p),items_cents:ne(Number(m.items_cents)),service_fee_cents:ne(Number(m.service_fee_cents)),delivery_fee_cents:ne(Number(m.delivery_fee_cents)),received_cents:ne(li),ticket_cents:ne(
m.sessions?Math.round(p/m.sessions):0),external_cents:t?Te?.gross_cents||0:null,revenue_total_cents:t?p+(Te?.gross_cents||0):null,open_sessions:$.n,open_balance_cents:ne(Number($.balance)),
cmv_cents:n?vt:null,margin_pct:n&&Number(m.items_cents)?Math.round((Number(m.items_cents)-vt)/Number(m.items_cents)*1e3)/10:null},by_day:k.map(q=>({...q,items_cents:ne(Number(q.items_cents))})),
by_hour:j.map(q=>({...q,items_cents:ne(Number(q.items_cents))})),by_product:C.map(q=>({...q,items_cents:ne(Number(q.items_cents))})),by_category:R.map(q=>({...q,items_cents:ne(q.items_cents)})),
by_user:J.map(q=>({...q,items_cents:ne(Number(q.items_cents))})),by_table:K.map(q=>({...q,items_cents:ne(Number(q.items_cents))})),by_channel:B.map(q=>({...q,items_cents:ne(Number(
q.items_cents))})),by_terminal:ae.map(q=>({...q,items_cents:ne(Number(q.items_cents))})),payments:t?_:null,cash:ui,movements:bn,dre:pi,external:Te,control:{...Ne,canceled_cents:ne(
Number(Ne.canceled_cents)),discounts_cents:ne(Number(Ne.discounts_cents)),launch_modes:Object.fromEntries(De.map(q=>[q.launch_mode,q.n])),events:Object.fromEntries(Tt.map(q=>[q.action,
q.n]))},kitchen:ii,delivery:si,stock:n?ri:null,customers:{...ci,loyalty:di,reviews:mi}}}ln.get("/overview",y("relatorios.visualizar"),l(async(e,a)=>{a.json(await Go(e.ctx,Jo(e.query)))}));
var nr={produtos:["by_product",[["name","Produto"],["category","Categoria"],["qty","Quantidade"],["items_cents","Vendido (R$)"],["cost_cents","CMV (R$)"],["abc","Curva ABC"]]],dias:[
"by_day",[["day","Dia comercial"],["sessions","Consumos"],["items_cents","Vendido (R$)"]]],horas:["by_hour",[["hour","Hora"],["items","Itens"],["items_cents","Vendido (R$)"]]],garcons:[
"by_user",[["name","Usu\xE1rio"],["items","Itens"],["items_cents","Vendido (R$)"]]],mesas:["by_table",[["number","Mesa"],["sessions","Consumos"],["items_cents","Vendido (R$)"],["av\
g_minutes","Perman\xEAncia m\xE9dia (min)"]]],pagamentos:["payments",[["method","Forma"],["n","Quantidade"],["total","Total (R$)"]]]};ln.get("/export",y("relatorios.visualizar"),l(
async(e,a)=>{let t=Jo(e.query),n=nr[e.query.section];if(!n)throw f("Se\xE7\xE3o inv\xE1lida");let i=(await Go(e.ctx,t))[n[0]]||[],s=n[1].filter(([u])=>i.some(m=>m[u]!==void 0&&m[u]!==
null)),r=(u,m)=>/cents|^total$/.test(u)&&m!=null?(Number(m)/100).toFixed(2).replace(".",","):m,c=[s.map(([,u])=>u).join(";"),...i.map(u=>s.map(([m])=>dt(r(m,u[m]))).join(";"))];await h(
{query:d},e.ctx,"relatorio.exportado",{data:{section:e.query.section,...t}}),a.setHeader("content-type","text/csv; charset=utf-8"),a.setHeader("content-disposition",`attachment; fi\
lename="rusten-${e.query.section}-${t.from}-${t.to}.csv"`),a.send(`\uFEFF${c.join(`
`)}`)}));import{Router as sr}from"npm:express@5.2.1";import{z as D}from"npm:zod@4.6.5";import ar from"node:crypto";var it=e=>({enabled:!1,accepting:!0,delivery:!0,pickup:!0,fee_cents:0,min_order_cents:0,eta_minutes:45,hours:"",areas:"",payment_methods:["dinheiro","pix","cartao"],message:"",...e?.
delivery||{}}),Ko={recebido:["confirmado","cancelado"],confirmado:["em_preparo","pronto","cancelado"],em_preparo:["pronto","cancelado"],pronto:["saiu","entregue","cancelado"],saiu:[
"entregue","cancelado"],entregue:[],cancelado:[]},Ye={recebido:"Recebido",confirmado:"Confirmado",em_preparo:"Em preparo",pronto:"Pronto",saiu:"Saiu para entrega",entregue:"Entregu\
e",cancelado:"Cancelado"},or=e=>({companyId:e,userId:null,unitId:null,terminalId:null,level:0,can:a=>["pdv.abrir_comanda","delivery.gerenciar"].includes(a)});async function na(e,a,t,{
channel:n="delivery"}={}){if(!Array.isArray(t)||!t.length)throw f("Carrinho vazio");let o=[...new Set(t.map(r=>Number(r.product_id)))],i=Object.fromEntries((await e.query("select *\
 from products where company_id = $1 and id = any($2)",[a,o])).rows.map(r=>[r.id,r])),s=[];for(let r of t){let c=i[Number(r.product_id)];if(!c||!c.active)throw g(`Produto indispon\xED\
vel${c?`: ${c.name}`:""}`,"product_unavailable");if(n!=="interno"&&!c.channels.includes("delivery")&&!c.channels.includes("cardapio_digital"))throw g(`${c.name} n\xE3o est\xE1 dispon\xEDvel\
 para delivery`,"product_unavailable");if(c.kind==="weight")throw g(`${c.name} \xE9 vendido por peso e n\xE3o pode ser pedido online`,"product_unavailable");let u=Number(r.qty);if(!Number.
isInteger(u)||u<1||u>50)throw f("Quantidade inv\xE1lida");let m=(r.option_ids||[]).map(Number),p=(await e.query(`select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active where g.product_id = $1 group by g.id order by g.sort, g.id`,[c.id])).rows,_=[];for(let k of p){
let j=k.options.filter(C=>m.includes(C.id));if(j.length<k.min_select)throw f(`${c.name}: escolha ${k.min_select} em "${k.name}"`,"options_required");if(j.length>k.max_select)throw f(
`${c.name}: no m\xE1ximo ${k.max_select} em "${k.name}"`);for(let C of j)_.push({group:k.name,id:C.id,name:C.name,price_cents:C.price_cents})}if(_.length!==new Set(m).size)throw f(
"Op\xE7\xE3o inv\xE1lida");let $=_.reduce((k,j)=>k+j.price_cents,0);s.push({product:c,qty:u,chosen:_,mods:$,notes:r.notes?String(r.notes).slice(0,140):null,total:kt(c.price_cents,u,
$,0)})}return{lines:s,subtotal:s.reduce((r,c)=>r+c.total,0)}}async function bt(e,a,t,n){let o=(await e.query("select id, name, settings from companies where id = $1",[a])).rows[0];
if(!o)throw v();let i=it(o.settings),s=t.channel==="telefone"||t.channel==="balcao";if(!s&&(!i.enabled||!i.accepting))throw g("O estabelecimento n\xE3o est\xE1 recebendo pedidos agora",
"closed");if(t.mode==="entrega"&&!i.delivery)throw f("Entrega indispon\xEDvel: escolha retirada");if(t.mode==="retirada"&&!i.pickup)throw f("Retirada indispon\xEDvel");if(t.mode===
"entrega"&&(!t.address?.street||!t.address?.number))throw f("Informe rua e n\xFAmero para entrega");let r=_e(t.phone);if(r.length<10)throw f("Telefone com DDD \xE9 obrigat\xF3rio");
let c=(await e.query("select id, public_token, number from delivery_orders where company_id = $1 and client_key = $2",[a,t.client_key])).rows[0];if(c)return{replay:!0,...c};let{lines:u,
subtotal:m}=await na(e,a,t.cart,{channel:s?"interno":"delivery"});if(!s&&m<i.min_order_cents)throw f(`Pedido m\xEDnimo de R$ ${(i.min_order_cents/100).toFixed(2).replace(".",",")}`,
"min_order");let p=t.mode==="entrega"?i.fee_cents:0,_=(await e.query("select id from customers where company_id = $1 and anonymized_at is null and regexp_replace(coalesce(phone,'')\
,'\\D','','g') = $2 limit 1",[a,r])).rows[0],$=n||or(a),k=Number((await e.query("select coalesce(max(number),0)+1 as n from delivery_orders where company_id = $1",[a])).rows[0].n),
j=await Hn(e,{...$,companyId:a},{kind:"delivery",label:`Delivery #${k}`,customer_name:t.customer_name,customer_id:_?.id,delivery_fee_cents:p});for(let[S,A]of u.entries()){let J=(await e.
query(`insert into order_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents,
         total_cents, notes, sector_id, kitchen_status, launch_mode, user_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,'delivery',$14,$15) returning *`,[a,j.id,A.product.id,A.product.name,A.qty,A.product.unit,A.product.price_cents,JSON.stringify(
A.chosen),A.mods,A.total,A.notes,A.product.sector_id,A.product.sector_id?"novo":"nao_produz",$.userId,`dlv${j.id}x${S}`])).rows[0];await Kt(e,{...$,companyId:a},J,A.product,A.chosen.
map(K=>K.id))}let C=se(18),R=(await e.query(`insert into delivery_orders (company_id, unit_id, session_id, number, public_token, channel, mode, customer_id, customer_name, phone, a\
ddress,
       payment_hint, change_for_cents, notes, eta_minutes, client_key, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,[a,j.unit_id,j.id,k,C,t.channel,t.mode,_?.id??null,t.customer_name,r,t.address||{},t.payment_hint??
null,t.change_for_cents??null,t.notes??null,i.eta_minutes,t.client_key,s?"confirmado":"recebido"])).rows[0];return s&&await e.query("update order_items set sent_at = now() where se\
ssion_id = $1 and kitchen_status = 'novo'",[j.id]),await e.query("insert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",[a,R.id,R.status,
$.userId,`Pedido via ${t.channel}`]),{...R,subtotal:m,fee:p,total:m+p}}var ir=()=>Nt("review-link"),pn=e=>`${e}.${ar.createHmac("sha256",ir()).update(String(e)).digest("base64url").
slice(0,16)}`;function aa(e){let[a,t]=String(e||"").split(".");return!/^\d+$/.test(a||"")||!t?null:pn(a)===`${a}.${t}`?Number(a):null}var Ee=sr(),rr=e=>String(e).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40)||"loja";Ee.get("/settings",y("delivery\
.gerenciar"),l(async(e,a)=>{let t=(await d("select slug, name, settings from companies where id = $1",[e.ctx.companyId])).rows[0];a.json({slug:t.slug,suggested_slug:t.slug||rr(t.name),
...it(t.settings)})}));Ee.put("/settings",y("delivery.gerenciar","configuracoes.gerenciar"),l(async(e,a)=>{let t=w(D.object({slug:D.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
"use letras min\xFAsculas, n\xFAmeros e h\xEDfen (3 a 40)"),enabled:D.boolean(),accepting:D.boolean(),delivery:D.boolean(),pickup:D.boolean(),fee_cents:D.number().int().min(0).max(
1e5),min_order_cents:D.number().int().min(0).max(1e6),eta_minutes:D.number().int().min(5).max(300),hours:D.string().max(300).default(""),areas:D.string().max(500).default(""),message:D.
string().max(300).default(""),payment_methods:D.array(D.enum(["dinheiro","pix","cartao"])).min(1)}),e.body);if(!t.delivery&&!t.pickup)throw f("Habilite entrega, retirada ou ambos");
let{slug:n,...o}=t;await x(async i=>{if((await i.query("select 1 from companies where slug = $1 and id <> $2",[n,e.ctx.companyId])).rows[0])throw g("Este endere\xE7o j\xE1 est\xE1 em uso po\
r outra empresa","slug_taken");await i.query("update companies set slug = $2, settings = jsonb_set(settings, '{delivery}', $3::jsonb) where id = $1",[e.ctx.companyId,n,JSON.stringify(
o)]),await h(i,e.ctx,"delivery.configuracao",{data:{slug:n,...o}})}),a.json({ok:!0})}));Ee.get("/orders",y("delivery.gerenciar"),l(async(e,a)=>{let t=[e.ctx.companyId],n="d.company\
_id = $1";e.query.status==="abertos"?n+=" and d.status not in ('entregue','cancelado')":e.query.status==="hoje"&&(n+=" and d.created_at > now() - interval '24 hours'"),e.ctx.can("d\
elivery.gerenciar")||(t.push(e.ctx.userId),n+=` and d.courier_id = $${t.length}`);let o=(await d(`select d.*, u.name as courier_name, s.status as session_status,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') as items_cents,
      (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = d.session_id and p.status = 'confirmado') as paid_cents,
      s.delivery_fee_cents,
      (select json_agg(json_build_object('description', i.description, 'qty', i.qty, 'modifiers', i.modifiers, 'notes', i.notes, 'kitchen_status', i.kitchen_status, 'status', i.sta\
tus) order by i.id)
         from order_items i where i.session_id = d.session_id) as items
    from delivery_orders d join consumption_sessions s on s.id = d.session_id left join users u on u.id = d.courier_id
    where ${n} order by case when d.status in ('entregue','cancelado') then 1 else 0 end, d.created_at desc limit 200`,t)).rows;a.json(o)}));Ee.get("/my",y("delivery.entregar"),l(async(e,a)=>{
a.json((await d(`select d.id, d.number, d.status, d.customer_name, d.phone, d.address, d.payment_hint, d.change_for_cents, d.notes,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') + s.delivery_fee_cents as total_cents
    from delivery_orders d join consumption_sessions s on s.id = d.session_id where d.company_id = $1 and d.courier_id = $2 and d.status in ('pronto','saiu') order by d.id`,[e.ctx.
companyId,e.ctx.userId])).rows)}));var cr=D.object({mode:D.enum(["entrega","retirada"]),channel:D.enum(["telefone","balcao"]).default("telefone"),customer_name:D.string().trim().min(
2).max(80),phone:D.string().trim().min(10).max(20),address:D.object({street:D.string().max(120),number:D.string().max(20),district:D.string().max(80).optional(),complement:D.string().
max(80).optional(),reference:D.string().max(120).optional()}).partial().optional(),payment_hint:D.enum(["dinheiro","pix","cartao"]).optional(),change_for_cents:D.number().int().min(
0).max(1e7).optional(),notes:D.string().max(300).optional(),cart:D.array(D.object({product_id:D.number().int(),qty:D.number().int().min(1).max(50),option_ids:D.array(D.number().int()).
max(40).default([]),notes:D.string().max(140).optional()})).min(1).max(60),client_key:D.string().regex(/^[A-Za-z0-9_-]{8,80}$/)});Ee.post("/orders",y("delivery.gerenciar"),l(async(e,a)=>{
let t=w(cr,e.body),n=await x(o=>bt(o,e.ctx.companyId,t,e.ctx));await h({query:d},e.ctx,"delivery.pedido_interno",{entity:"delivery",entityId:n.id,data:{number:n.number,mode:t.mode}}),
a.status(n.replay?200:201).json(n)}));Ee.post("/orders/:id/status",l(async(e,a)=>{let t=w(D.object({to:D.enum(["confirmado","em_preparo","pronto","saiu","entregue","cancelado"]),reason:D.
string().trim().max(200).optional(),proof:D.string().trim().max(200).optional(),eta_minutes:D.number().int().min(5).max(300).optional()}),e.body),n=await x(async o=>{let i=(await o.
query("select * from delivery_orders where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!i)throw v("Pedido n\xE3o encontrado");if(["sa\
iu","entregue"].includes(t.to)&&!e.ctx.can("delivery.gerenciar")){if(V(e.ctx,"delivery.entregar"),Number(i.courier_id)!==Number(e.ctx.userId))throw g("Pedido atribu\xEDdo a outro entr\
egador")}else V(e.ctx,"delivery.gerenciar");if(i.status===t.to)return{ok:!0,replay:!0};if(!Ko[i.status].includes(t.to))throw g(`N\xE3o \xE9 poss\xEDvel ir de "${Ye[i.status]}" para\
 "${Ye[t.to]}"`,"invalid_transition");if(t.to==="saiu"&&i.mode!=="entrega")throw f("Pedido de retirada n\xE3o sai para entrega");if(t.to==="cancelado"&&!t.reason)throw f("Informe o\
 motivo do cancelamento");if(t.to==="confirmado"&&await o.query("update order_items set sent_at = now() where session_id = $1 and kitchen_status = 'novo' and sent_at is null and st\
atus = 'ativo'",[i.session_id]),t.to==="cancelado"){if((await U(o,i.session_id)).paid>0)throw g("H\xE1 pagamento confirmado: estorne antes de cancelar","has_payments");let r=(await o.
query("select id, kitchen_status from order_items where session_id = $1 and status = 'ativo'",[i.session_id])).rows;for(let c of r)["novo","aceito","nao_produz"].includes(c.kitchen_status)&&
await Ct(o,e.ctx,c.id,`Delivery cancelado: ${t.reason}`);await o.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
          kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where session_id = $1 and status = 'ativo'`,[i.session_id,`Delivery canc\
elado: ${t.reason}`,e.ctx.userId]),await o.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2 where id = $1",[i.session_id,e.ctx.userId])}
if(t.to==="entregue"){let s=await U(o,i.session_id);if(s.balance>0&&!t.proof)throw g(`Saldo de R$ ${(s.balance/100).toFixed(2).replace(".",",")} em aberto: registre o pagamento ou \
informe o comprovante`,"balance_pending");let r=(await o.query("select * from consumption_sessions where id = $1 for update",[i.session_id])).rows[0];s.balance===0&&s.items>0&&["ab\
erta","em_fechamento"].includes(r.status)&&(await o.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2, version = version + 1 where id =\
 $1",[r.id,e.ctx.userId]),await Yt(o,e.ctx,r,s.items))}return await o.query(`update delivery_orders set status = $2, cancel_reason = coalesce($3, cancel_reason), proof = coalesce($\
4, proof),
        eta_minutes = coalesce($5, eta_minutes), updated_at = now() where id = $1`,[i.id,t.to,t.to==="cancelado"?t.reason:null,t.proof??null,t.eta_minutes??null]),await o.query("in\
sert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,i.id,t.to,e.ctx.userId,t.reason||t.proof||null]),await h(o,e.ctx,`\
delivery.${t.to}`,{entity:"delivery",entityId:i.id,reason:t.reason,data:{from:i.status}}),{ok:!0,status:t.to}});a.json(n)}));Ee.post("/orders/:id/courier",y("delivery.gerenciar"),l(
async(e,a)=>{let t=w(D.object({courier_id:D.number().int().nullable()}),e.body);if(t.courier_id&&!(await d("select 1 from users where id = $1 and company_id = $2 and active",[t.courier_id,
e.ctx.companyId])).rows[0])throw f("Entregador inv\xE1lido");let n=await d("update delivery_orders set courier_id = $3, updated_at = now() where id = $1 and company_id = $2 returni\
ng id",[Number(e.params.id),e.ctx.companyId,t.courier_id]);if(!n.rows[0])throw v();await h({query:d},e.ctx,"delivery.entregador",{entity:"delivery",entityId:n.rows[0].id,data:t}),a.
json({ok:!0})}));Ee.get("/couriers",y("delivery.gerenciar"),l(async(e,a)=>{a.json((await d(`select u.id, u.name, u.role_key from users u join roles r on r.company_id = u.company_id\
 and r.key = u.role_key
    where u.company_id = $1 and u.active and 'delivery.entregar' = any(r.permissions) order by u.name`,[e.ctx.companyId])).rows)}));import pr from"node:crypto";import{Router as _r}from"npm:express@5.2.1";import{z as me}from"npm:zod@4.6.5";var yn=e=>({enabled:!1,name:"Atendente virtual",greeting:"Ol\xE1! Sou o atendimento virtual. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* do ped\
ido ou fazer uma *reserva*. Para falar com a equipe, digite *atendente*.",handoff_message:"Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA. Aguarde um instante.",closed_message:"\
No momento n\xE3o estamos recebendo pedidos. Veja nossos hor\xE1rios digitando *hor\xE1rio*.",reservation_max_people:12,reservation_min_hours:2,...e?.agent||{}});function dr(e,a){let t=new Date(
`${e}Z`);if(Number.isNaN(t.getTime()))return t;let n=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:a,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"\
2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(t).map(i=>[i.type,i.value])),o=Date.UTC(+n.year,+n.month-1,+n.day,+n.hour,+n.minute,+n.second);return new Date(t.getTime()-
(o-t.getTime()))}var _n=e=>String(e||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim(),st=e=>`R$ ${(Number(e)/100).toFixed(2).replace(".",",")}`,ie=(e,...a)=>a.some(
t=>new RegExp(`(^|\\W)${t}(\\W|$)`).test(e));async function mr(e){return(await d(`select p.id, p.name, p.price_cents, c.name as category, p.kind,
      exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as required_opts
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and (('delivery' = any(p.channels)) or ('cardapio_digital' = any(p.channels)) or ('pdv' = any(p.channels)))
    order by c.sort nulls last, c.name, p.name limit 200`,[e])).rows}var ur=new Set(["quanto","custa","valor","preco","qual","quero","uma","umas","uns","com","sem","por","favor","t\
em","voces","pra","para","mais","esta","esse","essa"]);function oa(e,a){let t=_n(a),n=null,o=0;for(let i of e){let s=_n(i.name);if(t.includes(s))return i;let r=s.split(/\s+/).filter(
_=>_.length>2),c=t.split(/\W+/).filter(_=>_.length>2&&!ur.has(_)),u=r.filter(_=>t.includes(_)).length,m=c.filter(_=>r.some($=>$.startsWith(_)||_.startsWith($))).length,p=u?Math.max(
r.length?u/r.length:0,c.length?m/c.length:0):0;p>o&&(o=p,n=i)}return o>=.5?n:null}function Wo(e,a){let t=_n(a),n=t.match(/^(\d{1,2})\s*(x\s*)?(.+)$/),o=n?Number(n[1]):1,i=oa(e,n?n[3]:
t);return i?{p:i,qty:Math.min(Math.max(o,1),50)}:null}var Xo=(e,a)=>e.map(t=>{let n=a.find(o=>o.id===t.product_id);return`${t.qty}\xD7 ${n?.name} \u2014 ${st((n?.price_cents||0)*t.
qty)}`}).join(`
`);async function lr(e,a,t,{simulated:n}){let o=yn(e.settings),i=it(e.settings),s={...a.state||{}},r=_n(t),c=[],u=await mr(e.id);if(ie(r,"atendente","humano","pessoa","gerente","re\
clamacao","reclamar","problema","desconto","cobranca","estorno","reembolso"))return{replies:[o.handoff_message],state:{step:null},handoff:!0};if(ie(r,"cancelar","cancela","sair","r\
ecomecar")&&s.step&&!ie(r,"reserva"))return{replies:["Tudo bem, cancelei o que est\xE1vamos montando. Posso ajudar em algo mais?"],state:{step:null}};if(s.step==="pedido"){if(ie(r,
"finalizar","fechar","pronto","so isso","e isso","acabou")){if(!s.cart?.length)return{replies:["Seu pedido ainda est\xE1 vazio. Envie, por exemplo: *2 pilsen*."],state:s};let $=[i.
delivery&&"*entrega*",i.pickup&&"*retirada*"].filter(Boolean).join(" ou ");return{replies:[`Seu pedido:
${Xo(s.cart,u)}

Vai ser ${$}?`],state:{...s,step:"modo"}}}let _=[];for(let $ of String(t).split(/\n|,| e (?=\d)/)){if(!$.trim())continue;let k=Wo(u,$);if(k){if(k.p.required_opts){c.push(`*${k.p.name}\
* tem op\xE7\xF5es para escolher \u2014 pe\xE7a esse item pelo card\xE1pio digital${e.slug?`: /c/${e.slug}`:""}.`);continue}s.cart=[...s.cart||[],{product_id:k.p.id,qty:k.qty}],_.push(
`${k.qty}\xD7 ${k.p.name}`)}}return _.length?c.push(`Anotado: ${_.join(", ")}. Algo mais? Quando terminar, digite *finalizar*.`):c.length||c.push("N\xE3o encontrei esse item no card\xE1p\
io. Digite *card\xE1pio* para ver as op\xE7\xF5es ou envie como *2 pilsen*."),{replies:c,state:s}}if(s.step==="modo")return ie(r,"entrega","entregar","delivery")&&i.delivery?{replies:[
"Qual o endere\xE7o? Envie *rua, n\xFAmero e bairro*."],state:{...s,step:"endereco",mode:"entrega"}}:ie(r,"retirada","retirar","buscar","balcao")&&i.pickup?{replies:["Em nome de qu\
em fica o pedido?"],state:{...s,step:"nome",mode:"retirada"}}:{replies:["Responda *entrega* ou *retirada*."],state:s};if(s.step==="endereco"){let _=String(t).split(",").map($=>$.trim());
return _.length<2||!/\d/.test(_[1])?{replies:["Preciso de rua e n\xFAmero, separados por v\xEDrgula. Ex.: *Rua das Flores, 120, Centro*."],state:s}:{replies:["Em nome de quem fica \
o pedido?"],state:{...s,step:"nome",address:{street:_[0],number:_[1],district:_[2]||""}}}}if(s.step==="nome"){let _=String(t).trim().slice(0,60);if(_.length<2)return{replies:["Qual\
 o nome?"],state:s};let{subtotal:$}=await na({query:d},e.id,s.cart).catch(()=>({subtotal:0})),k=s.mode==="entrega"?i.fee_cents:0;return{replies:[`Confira:
${Xo(s.cart,u)}
${k?`Taxa de entrega: ${st(k)}
`:""}*Total: ${st($+k)}*
${s.mode==="entrega"?`Entrega em: ${s.address.street}, ${s.address.number}`:"Retirada no balc\xE3o"} \xB7 Nome: ${_}
Pagamento na ${s.mode==="entrega"?"entrega":"retirada"}.

Responda *confirmar* para enviar ou *cancelar*.`],state:{...s,step:"confirmar",name:_}}}if(s.step==="confirmar"){if(!ie(r,"confirmar","confirmo","sim","pode","ok"))return{replies:[
"Responda *confirmar* para enviar o pedido ou *cancelar*."],state:s};if(n)return{replies:["\u2705 (Simula\xE7\xE3o) Pedido montado corretamente. Nada foi enviado \xE0 cozinha nem registrado nas \
vendas."],state:{step:null}};try{let _=await bt({query:d},e.id,{channel:"whatsapp",mode:s.mode,customer_name:s.name,phone:a.contact,address:s.address,cart:s.cart,client_key:`wa${a.
id}x${se(6)}`},null);return{replies:[`\u2705 Pedido *#${_.number}* recebido! Total ${st(_.total)}. Avisaremos quando for confirmado. Para acompanhar, digite *status*.`],state:{step:null}}}catch(_){
return{replies:[`N\xE3o consegui registrar o pedido: ${_.message}`],state:{step:null}}}}if(s.step==="reserva"){let _=String(t).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\D+(\d{1,2})(?:[:h](\d{2}))?\D+(\d{1,3})/i);
if(!_)return{replies:["Envie *dia/m\xEAs, hor\xE1rio e pessoas*. Ex.: *25/10 20:30 4 pessoas*."],state:s};let $=_[3]?_[3].length===2?2e3+Number(_[3]):Number(_[3]):new Date().getFullYear(),
k=e.timezone||"America/Sao_Paulo",j=`${$}-${String(_[2]).padStart(2,"0")}-${String(_[1]).padStart(2,"0")}T${String(_[4]).padStart(2,"0")}:${_[5]||"00"}:00`,C=dr(j,k),R=Number(_[6]);
if(Number.isNaN(C.getTime()))return{replies:["Data inv\xE1lida. Ex.: *25/10 20:30 4 pessoas*."],state:s};if(C.getTime()<Date.now()+o.reservation_min_hours*36e5)return{replies:[`Res\
ervas precisam de pelo menos ${o.reservation_min_hours}h de anteced\xEAncia.`],state:s};if(R<1||R>o.reservation_max_people)return{replies:[`Para grupos acima de ${o.reservation_max_people}\
 pessoas, a equipe vai te atender.`],state:{step:null},handoff:!0};if(n)return{replies:[`\u2705 (Simula\xE7\xE3o) Reserva para ${R} pessoa(s) em ${_[1]}/${_[2]} \xE0s ${_[4]}:${_[5]||
"00"} \u2014 nada foi gravado.`],state:{step:null}};let S=(await d("select id from units where company_id = $1 and active order by id limit 1",[e.id])).rows[0];return await d("inse\
rt into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source) values ($1,$2,$3,$4,$5,$6,'pendente','agente')",[e.id,S.id,a.contact_name||"Clie\
nte WhatsApp",a.contact,R,C]),{replies:[`Pedido de reserva para *${R}* pessoa(s) em *${_[1]}/${_[2]} \xE0s ${_[4]}:${_[5]||"00"}* registrado. A equipe confirma em breve.`],state:{step:null}}}
if(ie(r,"oi","ola","bom dia","boa tarde","boa noite","menu inicial","ajuda","opcoes")&&r.length<30)return{replies:[o.greeting],state:{step:null}};if(ie(r,"horario","horarios","func\
iona","funcionamento","aberto","abre","fecha"))return{replies:[`${i.hours?`Nosso hor\xE1rio: ${i.hours}`:"Consulte nosso hor\xE1rio com a equipe."}${i.enabled?i.accepting?`
Estamos recebendo pedidos agora.`:`
No momento n\xE3o estamos recebendo pedidos.`:""}`],state:s};if(ie(r,"cardapio","menu","opcoes de","o que tem","tem o que")){let _={};for(let k of u)(_[k.category||"Outros"]||=[]).
push(`\u2022 ${k.name} \u2014 ${st(k.price_cents)}`);return{replies:[Object.entries(_).map(([k,j])=>`*${k}*
${j.slice(0,12).join(`
`)}`).join(`

`).slice(0,3500)||"Card\xE1pio indispon\xEDvel no momento.","Para pedir, digite *pedido*."],state:s}}if(ie(r,"status","meu pedido","cade","acompanhar","demora")){let _=(await d("se\
lect number, status, mode, eta_minutes, created_at from delivery_orders where company_id = $1 and phone = $2 order by id desc limit 1",[e.id,_e(a.contact)])).rows[0];return _?{replies:[
`Pedido *#${_.number}*: *${Ye[_.status]}*${["recebido","confirmado","em_preparo"].includes(_.status)&&_.eta_minutes?` \xB7 previs\xE3o de ${_.eta_minutes} min`:""}.`],state:s}:{replies:[
"N\xE3o encontrei pedidos feitos por este n\xFAmero. Se pediu por outro n\xFAmero, fale com um *atendente*."],state:s}}if(ie(r,"reserva","reservar","mesa para"))return ie(r,"cancel\
ar","cancela","desmarcar")?n?{replies:["\u2705 (Simula\xE7\xE3o) Reserva cancelada \u2014 nada foi alterado."],state:{step:null}}:{replies:[(await d(`update reservations set status\
 = 'cancelada' where id = (select id from reservations where company_id = $1 and phone = $2
          and status in ('pendente','confirmada') and starts_at > now() order by starts_at limit 1) returning starts_at`,[e.id,_e(a.contact)])).rows[0]?"Sua pr\xF3xima reserva foi can\
celada.":"N\xE3o encontrei reserva futura neste n\xFAmero."],state:{step:null}}:ie(r,"remarcar","mudar","alterar")?{replies:["Para remarcar, cancele a atual (*cancelar reserva*) e \
fa\xE7a uma nova (*reserva*). Se preferir, chame um *atendente*."],state:s}:{replies:["Vamos reservar! Envie *dia/m\xEAs, hor\xE1rio e n\xFAmero de pessoas*. Ex.: *25/10 20:30 4 pessoas*."],
state:{step:"reserva"}};if(ie(r,"pedido","pedir","quero","encomendar","delivery","entrega")){if(!i.enabled||!i.accepting)return{replies:[o.closed_message],state:s};let _=Wo(u,r.replace(
/\b(quero|pedir|pedido|fazer|um|uma)\b/g," ").trim()),$=_&&!_.p.required_opts?[{product_id:_.p.id,qty:_.qty}]:[];return{replies:[`${$.length?`Anotado: ${$[0].qty}\xD7 ${_.p.name}. `:
""}Me diga os itens, um por linha, com a quantidade. Ex.:
*2 pilsen*
*1 batata frita*
Quando terminar, digite *finalizar*.`],state:{step:"pedido",cart:$}}}if(ie(r,"preco","quanto","valor","custa")){let _=oa(u,r);return{replies:[_?`*${_.name}*: ${st(_.price_cents)}.`:
"De qual item? Digite *card\xE1pio* para ver todos os pre\xE7os."],state:s}}let m=oa(u,r);if(m)return{replies:[`*${m.name}*: ${st(m.price_cents)}. Para pedir, digite *pedido*.`],state:s};
let p=(s.misses||0)+1;return p>=3?{replies:[o.handoff_message],state:{step:null},handoff:!0}:{replies:[`N\xE3o entendi. ${o.greeting}`],state:{...s,misses:p}}}async function At(e,a,t){
let n=Object.fromEntries((await d("select key, value from company_secrets where company_id = $1 and key in ('wa_token','wa_phone_number_id')",[e])).rows.map(o=>[o.key,o.value]));if(!n.
wa_token||!n.wa_phone_number_id)return{ok:!1,error:"Integra\xE7\xE3o do WhatsApp n\xE3o configurada"};try{let o=await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(n.
wa_phone_number_id)}/messages`,{method:"POST",headers:{authorization:`Bearer ${n.wa_token}`,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:_e(
a),type:"text",text:{body:t.slice(0,4e3)}}),signal:AbortSignal.timeout(8e3)}),i=await o.json().catch(()=>({}));return o.ok?{ok:!0,id:i?.messages?.[0]?.id}:{ok:!1,error:i?.error?.message?.
slice(0,200)||`HTTP ${o.status}`}}catch(o){return{ok:!1,error:String(o.message||o).slice(0,200)}}}async function Et(e,a,t,n){let o=await e.query(`insert into conversation_messages \
(company_id, conversation_id, direction, author, body, external_id, delivery_status, error, user_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,[a,t,n.direction,n.author,n.body,n.external_id??null,n.delivery_status||"ok",n.error??null,n.user_id??null]);
return await e.query("update conversations set last_message_at = now() where id = $1",[t]),o.rows[0]?.id||null}async function fn(e,{channel:a,contact:t,contactName:n,body:o,externalId:i}){
let s=a==="simulador",r=(await d(`insert into conversations (company_id, channel, contact, contact_name) values ($1,$2,$3,$4)
    on conflict (company_id, channel, contact) do update set contact_name = coalesce(excluded.contact_name, conversations.contact_name) returning *`,[e.id,a,t,n??null])).rows[0];if(!await Et(
{query:d},e.id,r.id,{direction:"in",author:"cliente",body:String(o).slice(0,4e3),external_id:i}))return{duplicate:!0,conversation_id:r.id,replies:[]};let u=yn(e.settings);if(r.mode!==
"agente"||!u.enabled&&!s)return{conversation_id:r.id,replies:[],mode:r.mode};let m=await lr(e,r,o,{simulated:s});await d("update conversations set state = $2, needs_human = needs_h\
uman or $3, mode = case when $3 then 'humano' else mode end where id = $1",[r.id,JSON.stringify(m.state||{}),!!m.handoff]);for(let p of m.replies){let _=s?"simulado":"pendente",$=null,
k=null;if(!s){let j=await At(e.id,t,p);_=j.ok?"ok":"falhou",$=j.error||null,k=j.id||null}await Et({query:d},e.id,r.id,{direction:"out",author:"agente",body:p,external_id:k,delivery_status:_,
error:$})}return{conversation_id:r.id,replies:m.replies,handoff:!!m.handoff}}var ye=_r(),ia=e=>`${e}.${pr.createHmac("sha256",Nt("unsubscribe")).update(String(e)).digest("base64url").slice(0,16)}`;function Yo(e){let[a]=String(e||"").split(".");return/^\d+$/.
test(a||"")&&ia(a)===e?Number(a):null}var Zo=me.object({birthday_month:me.boolean().optional(),inactive_days:me.number().int().min(1).max(3650).optional(),tag:me.string().trim().max(
30).optional(),min_visits:me.number().int().min(1).max(1e3).optional()}).default({});function Qo(e,a,t){let n=`c.company_id = $1 and c.anonymized_at is null and c.unsubscribed_at i\
s null and ${a==="whatsapp"?"c.consent_whatsapp and c.phone is not null":"c.consent_email and c.email is not null"}`;return e.birthday_month&&(n+=" and extract(month from c.birthda\
y) = extract(month from current_date)"),e.tag&&(t.push(e.tag),n+=` and $${t.length} = any(c.tags)`),e.inactive_days&&(t.push(e.inactive_days),n+=` and not exists (select 1 from con\
sumption_sessions s where s.customer_id = c.id and s.opened_at > now() - make_interval(days => $${t.length}))`),e.min_visits&&(t.push(e.min_visits),n+=` and (select count(*) from c\
onsumption_sessions s where s.customer_id = c.id and s.status = 'encerrada') >= $${t.length}`),n}var ei=(e,a,t)=>e.replaceAll("{nome}",(a.name||"").split(" ")[0]).replaceAll("{empr\
esa}",t).replaceAll("{pontos}",String(a.points??0));ye.post("/segments/preview",y("marketing.gerenciar"),l(async(e,a)=>{let t=w(me.object({channel:me.enum(["whatsapp","email"]),segment:Zo}),
e.body),n=[e.ctx.companyId],o=Qo(t.segment,t.channel,n),i=(await d(`select count(*)::int as n from customers c where ${o}`,n)).rows[0].n,s=(await d("select count(*)::int as n from \
customers where company_id = $1 and anonymized_at is null",[e.ctx.companyId])).rows[0].n;a.json({recipients:i,without_consent:s-i})}));ye.get("/campaigns",y("marketing.gerenciar"),
l(async(e,a)=>{a.json((await d(`select c.*, u.name as user_name,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'enviado') as sent,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'falhou') as failed
    from campaigns c left join users u on u.id = c.created_by where c.company_id = $1 order by c.id desc limit 100`,[e.ctx.companyId])).rows)}));ye.post("/campaigns",y("marketing.g\
erenciar"),l(async(e,a)=>{let t=w(me.object({name:me.string().trim().min(3).max(80),channel:me.enum(["whatsapp","email"]),segment:Zo,message:me.string().trim().min(10).max(1500)}),
e.body),n=await d("insert into campaigns (company_id, name, channel, segment, message, created_by) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,t.name,t.channel,t.segment,
t.message,e.ctx.userId]);a.status(201).json({id:n.rows[0].id})}));ye.post("/campaigns/:id/prepare",y("marketing.gerenciar"),l(async(e,a)=>{let t=await x(async n=>{let o=(await n.query(
"select * from campaigns where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw v("Campanha n\xE3o encontrada");if(o.status!=="ra\
scunho")throw g("Campanha j\xE1 preparada");let i=[e.ctx.companyId],s=Qo(o.segment,o.channel,i);i.push(o.id);let r=await n.query(`insert into campaign_recipients (company_id, campa\
ign_id, customer_id) select $1, $${i.length}, c.id from customers c where ${s}`,i);return await n.query("update campaigns set status = 'preparada', recipients = $2, prepared_at = n\
ow() where id = $1",[o.id,r.rowCount]),await h(n,e.ctx,"marketing.campanha_preparada",{entity:"campaign",entityId:o.id,data:{recipients:r.rowCount}}),{recipients:r.rowCount}});a.json(
t)}));ye.get("/campaigns/:id/recipients",y("marketing.gerenciar","dados.pessoais"),l(async(e,a)=>{let t=(await d("select c.*, co.name as company from campaigns c join companies co \
on co.id = c.company_id where c.id = $1 and c.company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw v();let n=(await d(`select r.id, r.status, r.sent_at, r.e\
rror, cu.id as customer_id, cu.name, cu.phone, cu.email, cu.points, cu.unsubscribed_at
    from campaign_recipients r join customers cu on cu.id = r.customer_id where r.campaign_id = $1 order by cu.name limit 2000`,[t.id])).rows;a.json(n.map(o=>({...o,message:`${ei(t.
message,o,t.company)}

Para n\xE3o receber mais: ${e.query.base||""}/sair/${ia(o.customer_id)}`})))}));ye.post("/campaigns/:id/recipients/:rid/sent",y("marketing.gerenciar"),l(async(e,a)=>{let t=await d(
"update campaign_recipients set status = 'enviado', sent_at = now() where id = $1 and campaign_id = $2 and company_id = $3 and status in ('pendente','falhou') returning id",[Number(
e.params.rid),Number(e.params.id),e.ctx.companyId]);a.json({ok:!!t.rows[0]})}));ye.post("/campaigns/:id/send",y("marketing.gerenciar"),l(async(e,a)=>{let t=w(me.object({base_url:me.
string().url().max(200)}),e.body),n=(await d("select c.*, co.name as company from campaigns c join companies co on co.id = c.company_id where c.id = $1 and c.company_id = $2",[Number(
e.params.id),e.ctx.companyId])).rows[0];if(!n)throw v();if(n.channel!=="whatsapp")throw f("Envio autom\xE1tico dispon\xEDvel s\xF3 para WhatsApp; para e-mail, exporte a lista");if(n.
status!=="preparada")throw g("Prepare a campanha antes de enviar");let o=(await d(`select r.id, cu.id as customer_id, cu.name, cu.phone, cu.points from campaign_recipients r join c\
ustomers cu on cu.id = r.customer_id
    where r.campaign_id = $1 and r.status in ('pendente','falhou') and cu.unsubscribed_at is null and cu.consent_whatsapp limit 300`,[n.id])).rows,i=0,s=0;for(let r of o){let c=await At(
e.ctx.companyId,r.phone,`${ei(n.message,r,n.company)}

Para n\xE3o receber mais: ${t.base_url}/sair/${ia(r.customer_id)}`);if(await d("update campaign_recipients set status = $2, sent_at = case when $2 = 'enviado' then now() end, error\
 = $3 where id = $1",[r.id,c.ok?"enviado":"falhou",c.error||null]),c.ok?i++:s++,!c.ok&&/não configurada/.test(c.error))break}i&&!s&&await d("update campaigns set status = 'enviada\
' where id = $1",[n.id]),await h({query:d},e.ctx,"marketing.campanha_enviada",{entity:"campaign",entityId:n.id,data:{sent:i,failed:s}}),a.json({sent:i,failed:s})}));ye.post("/campa\
igns/:id/cancel",y("marketing.gerenciar"),l(async(e,a)=>{if(!(await d("update campaigns set status = 'cancelada' where id = $1 and company_id = $2 and status in ('rascunho','prepar\
ada') returning id",[Number(e.params.id),e.ctx.companyId])).rows[0])throw g("Campanha n\xE3o pode ser cancelada");a.json({ok:!0})}));ye.get("/reviews",y("marketing.gerenciar"),l(async(e,a)=>{
let t=Math.min(365,Number(e.query.days)||30),n=(await d(`select count(*)::int as total, round(avg(score)::numeric, 2)::float as average,
      count(*) filter (where score >= 4)::int as positive, count(*) filter (where score <= 2)::int as negative,
      count(*) filter (where score <= 2 and handled_at is null)::int as pending
    from reviews where company_id = $1 and created_at > now() - make_interval(days => $2)`,[e.ctx.companyId,t])).rows[0],o=(await d("select score, count(*)::int as n from reviews w\
here company_id = $1 and created_at > now() - make_interval(days => $2) group by score order by score",[e.ctx.companyId,t])).rows,i=(await d(`select r.id, r.score, r.comment, r.cre\
ated_at, r.handled_at, r.session_id, cu.name as customer_name, cu.id as customer_id, u.name as handled_name
    from reviews r left join customers cu on cu.id = r.customer_id left join users u on u.id = r.handled_by
    where r.company_id = $1 and r.created_at > now() - make_interval(days => $2) order by (r.score <= 2 and r.handled_at is null) desc, r.id desc limit 200`,[e.ctx.companyId,t])).rows;
a.json({stats:n,distribution:o,items:i})}));ye.post("/reviews/:id/handled",y("marketing.gerenciar"),l(async(e,a)=>{let t=w(me.object({note:me.string().trim().min(3).max(300)}),e.body),
n=await d("update reviews set handled_at = now(), handled_by = $3 where id = $1 and company_id = $2 and handled_at is null returning id",[Number(e.params.id),e.ctx.companyId,e.ctx.
userId]);if(!n.rows[0])throw g("Avalia\xE7\xE3o j\xE1 tratada");await h({query:d},e.ctx,"marketing.avaliacao_tratada",{entity:"review",entityId:n.rows[0].id,reason:t.note}),a.json(
{ok:!0})}));ye.get("/review-link/:sessionId",y("pdv.lancar"),l(async(e,a)=>{let t=(await d("select id from consumption_sessions where id = $1 and company_id = $2 and status = 'ence\
rrada'",[Number(e.params.sessionId),e.ctx.companyId])).rows[0];if(!t)throw v("Consumo encerrado n\xE3o encontrado");let n=(await d("select slug from companies where id = $1",[e.ctx.
companyId])).rows[0];a.json({token:pn(t.id),path:`/avaliar/${pn(t.id)}`,slug:n.slug})}));import{Router as yr}from"npm:express@5.2.1";import{z as te}from"npm:zod@4.6.5";var Ae=yr(),sa=["wa_token","wa_phone_number_id","wa_app_secret","wa_verify_token"];Ae.get("/settings",y("agente.gerenciar"),l(async(e,a)=>{let t=(await d("select slug, settings fro\
m companies where id = $1",[e.ctx.companyId])).rows[0],n=(await d("select key, updated_at from company_secrets where company_id = $1 and key = any($2)",[e.ctx.companyId,sa])).rows,
o=(await d("select m.created_at, m.error from conversation_messages m where m.company_id = $1 and m.delivery_status = 'falhou' order by m.id desc limit 10",[e.ctx.companyId])).rows;
a.json({...yn(t.settings),slug:t.slug,secrets:Object.fromEntries(sa.map(i=>[i,!!n.find(s=>s.key===i)])),webhook_path:t.slug?`/api/public/whatsapp/${t.slug}`:null,failures:o})}));Ae.
put("/settings",y("agente.gerenciar"),l(async(e,a)=>{let t=w(te.object({enabled:te.boolean(),name:te.string().trim().min(2).max(40),greeting:te.string().trim().min(5).max(600),handoff_message:te.
string().trim().min(5).max(300),closed_message:te.string().trim().min(5).max(300),reservation_max_people:te.number().int().min(1).max(100),reservation_min_hours:te.number().int().min(
0).max(72)}),e.body);await d("update companies set settings = jsonb_set(settings, '{agent}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(t)]),await h({query:d},e.ctx,
"agente.configuracao",{data:{enabled:t.enabled}}),a.json({ok:!0})}));Ae.put("/secrets",y("agente.gerenciar","configuracoes.gerenciar"),l(async(e,a)=>{let t=w(te.object(Object.fromEntries(
sa.map(n=>[n,te.string().trim().max(600).optional()]))),e.body);await x(async n=>{for(let[o,i]of Object.entries(t))i!==void 0&&(i?await n.query(`insert into company_secrets (compan\
y_id, key, value) values ($1,$2,$3)
        on conflict (company_id, key) do update set value = excluded.value, updated_at = now()`,[e.ctx.companyId,o,i]):await n.query("delete from company_secrets where company_id =\
 $1 and key = $2",[e.ctx.companyId,o]));await h(n,e.ctx,"agente.credenciais",{data:{keys:Object.keys(t).filter(o=>t[o]!==void 0)}})}),a.json({ok:!0})}));Ae.get("/conversations",y("\
agente.atender"),l(async(e,a)=>{let t=e.query.channel==="simulador"?"simulador":"whatsapp";a.json((await d(`select c.id, c.channel, c.contact, c.contact_name, c.mode, c.needs_human\
, c.last_message_at, u.name as assigned_name,
      (select body from conversation_messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_body,
      (select count(*)::int from conversation_messages m where m.conversation_id = c.id and m.delivery_status = 'falhou') as failures
    from conversations c left join users u on u.id = c.assigned_to where c.company_id = $1 and c.channel = $2
    order by c.needs_human desc, c.last_message_at desc limit 100`,[e.ctx.companyId,t])).rows)}));Ae.get("/conversations/:id",y("agente.atender"),l(async(e,a)=>{let t=(await d("sel\
ect * from conversations where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw v("Conversa n\xE3o encontrada");let n=(await d(`select m.id,\
 m.direction, m.author, m.body, m.delivery_status, m.error, m.created_at, u.name as user_name
    from conversation_messages m left join users u on u.id = m.user_id where m.conversation_id = $1 order by m.id desc limit 200`,[t.id])).rows.reverse();a.json({conversation:t,messages:n})}));
Ae.post("/conversations/:id/mode",y("agente.atender"),l(async(e,a)=>{let t=w(te.object({mode:te.enum(["agente","humano","pausado"])}),e.body),n=await d(`update conversations set mo\
de = $3, assigned_to = case when $3 = 'humano' then $4 else null end,
      needs_human = case when $3 = 'agente' then false else needs_human end, state = case when $3 = 'agente' then '{}'::jsonb else state end
    where id = $1 and company_id = $2 returning id`,[Number(e.params.id),e.ctx.companyId,t.mode,e.ctx.userId]);if(!n.rows[0])throw v();await Et({query:d},e.ctx.companyId,n.rows[0].
id,{direction:"out",author:"sistema",delivery_status:"simulado",body:{agente:"Conversa devolvida ao agente",humano:`${e.ctx.name} assumiu a conversa`,pausado:"Agente pausado nesta \
conversa"}[t.mode],user_id:e.ctx.userId}),a.json({ok:!0})}));Ae.post("/conversations/:id/reply",y("agente.atender"),l(async(e,a)=>{let t=w(te.object({body:te.string().trim().min(1).
max(2e3)}),e.body),n=(await d("select * from conversations where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!n)throw v();if(n.mode==="agente")throw g(
"Assuma a conversa antes de responder","not_assumed");let o="simulado",i=null,s=null;if(n.channel==="whatsapp"){let r=await At(e.ctx.companyId,n.contact,t.body);o=r.ok?"ok":"falhou",
i=r.error||null,s=r.id||null}await Et({query:d},e.ctx.companyId,n.id,{direction:"out",author:"equipe",body:t.body,external_id:s,delivery_status:o,error:i,user_id:e.ctx.userId}),a.status(
201).json({ok:o!=="falhou",status:o,error:i})}));Ae.post("/simulate",y("agente.gerenciar"),l(async(e,a)=>{let t=w(te.object({body:te.string().trim().min(1).max(1e3),contact:te.string().
trim().max(20).optional(),reset:te.boolean().optional()}),e.body),n=(await d("select id, name, slug, timezone, settings from companies where id = $1",[e.ctx.companyId])).rows[0],o=`\
sim-${t.contact||e.ctx.userId}`;t.reset&&await d("delete from conversations where company_id = $1 and channel = 'simulador' and contact = $2",[e.ctx.companyId,o]);let i=await fn(n,
{channel:"simulador",contact:o,contactName:"Simula\xE7\xE3o",body:t.body,externalId:`sim-${se(8)}`});a.json(i)}));import{Router as fr}from"npm:express@5.2.1";import{z as Oe}from"npm:zod@4.6.5";var Ot=fr();Ot.get("/",y("salao.visualizar"),l(async(e,a)=>{let t=/^\d{4}-\d{2}-\d{2}$/.test(String(e.query.day))?e.query.day:null,n=e.ctx.company.timezone,o=[e.ctx.companyId,n],i="\
r.company_id = $1";t?(o.push(t),i+=` and (r.starts_at at time zone $2)::date = $${o.length}`):i+=" and r.starts_at > now() - interval '3 hours'",a.json((await d(`select r.*, t.numb\
er as table_number from reservations r left join dining_tables t on t.id = r.table_id where ${i} order by r.starts_at limit 200`,o)).rows)}));Ot.post("/",y("salao.gerenciar"),l(async(e,a)=>{
let t=w(Oe.object({customer_name:Oe.string().trim().min(2).max(80),phone:Oe.string().trim().max(20).optional(),people:Oe.number().int().min(1).max(100),starts_at:Oe.string().datetime(
{offset:!0}),table_id:Oe.number().int().nullable().optional(),notes:Oe.string().max(300).optional()}),e.body);if(new Date(t.starts_at).getTime()<Date.now()-36e5)throw f("Hor\xE1rio j\xE1\
 passou");if(t.table_id&&!(await d("select 1 from dining_tables where id = $1 and company_id = $2",[t.table_id,e.ctx.companyId])).rows[0])throw f("Mesa inv\xE1lida");let n=e.ctx.unitId||
(await d("select id from units where company_id = $1 order by id limit 1",[e.ctx.companyId])).rows[0].id,o=await d(`insert into reservations (company_id, unit_id, customer_name, ph\
one, people, starts_at, table_id, notes, status, source)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmada','equipe') returning id`,[e.ctx.companyId,n,t.customer_name,t.phone?_e(t.phone):null,t.people,t.starts_at,t.table_id??null,t.notes??
null]);await h({query:d},e.ctx,"reserva.criada",{entity:"reservation",entityId:o.rows[0].id,data:{people:t.people,starts_at:t.starts_at}}),a.status(201).json({id:o.rows[0].id})}));
Ot.post("/:id/status",y("salao.gerenciar"),l(async(e,a)=>{let t=w(Oe.object({status:Oe.enum(["confirmada","cancelada","chegou","nao_compareceu"]),table_id:Oe.number().int().nullable().
optional()}),e.body),n=await d("update reservations set status = $3, table_id = coalesce($4, table_id) where id = $1 and company_id = $2 returning id, table_id",[Number(e.params.id),
e.ctx.companyId,t.status,t.table_id??null]);if(!n.rows[0])throw v("Reserva n\xE3o encontrada");t.status==="confirmada"&&n.rows[0].table_id&&await d("update dining_tables set status\
 = 'reservada' where id = $1 and status = 'livre'",[n.rows[0].table_id]),await h({query:d},e.ctx,`reserva.${t.status}`,{entity:"reservation",entityId:n.rows[0].id}),a.json({ok:!0})}));import wr from"node:crypto";import{Router as hr}from"npm:express@5.2.1";import{z as H}from"npm:zod@4.6.5";var Ie=hr();async function wn(e){if(!/^[a-z0-9-]{3,40}$/.test(String(e)))throw v("Estabelecimento n\xE3o encontrado");let a=(await d("select id, name, slug, phone, address, timezon\
e, settings, is_demo from companies where slug = $1",[e])).rows[0];if(!a)throw v("Estabelecimento n\xE3o encontrado");return a}Ie.get("/:slug/menu",l(async(e,a)=>{let t=await wn(e.
params.slug),n=it(t.settings);if(!n.enabled)throw v("Card\xE1pio digital desativado");let o=(await d(`select p.id, p.name, p.description, p.price_cents, p.allergens, p.category_id,\
 c.name as category,
      coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
         'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                       from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id) from modifier_groups g where g.product_id = p.id), '[]') as groups
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and ('delivery' = any(p.channels) or 'cardapio_digital' = any(p.channels))
    order by c.sort nulls last, c.name, p.name`,[t.id])).rows;a.set("cache-control","public, max-age=30"),a.json({company:{name:t.name,slug:t.slug,phone:t.phone,address:t.address?.
city?`${t.address.street||""} ${t.address.number||""} \u2014 ${t.address.city}`:null},settings:{accepting:n.accepting,delivery:n.delivery,pickup:n.pickup,fee_cents:n.fee_cents,min_order_cents:n.
min_order_cents,eta_minutes:n.eta_minutes,hours:n.hours,areas:n.areas,message:n.message,payment_methods:n.payment_methods},products:o})}));var gr=H.object({mode:H.enum(["entrega","\
retirada"]),customer_name:H.string().trim().min(2).max(80),phone:H.string().trim().min(10).max(20),address:H.object({street:H.string().trim().max(120),number:H.string().trim().max(
20),district:H.string().trim().max(80).optional(),complement:H.string().trim().max(80).optional(),reference:H.string().trim().max(120).optional()}).partial().optional(),payment_hint:H.
enum(["dinheiro","pix","cartao"]),change_for_cents:H.number().int().min(0).max(1e6).optional(),notes:H.string().trim().max(300).optional(),cart:H.array(H.object({product_id:H.number().
int(),qty:H.number().int().min(1).max(50),option_ids:H.array(H.number().int()).max(40).default([]),notes:H.string().trim().max(140).optional()})).min(1).max(40),client_key:H.string().
regex(/^[A-Za-z0-9_-]{12,80}$/),website:H.string().max(0).optional()});Ie.post("/:slug/orders",l(async(e,a)=>{let t=await wn(e.params.slug),n=w(gr,e.body);await X(`pub-order:${t.id}\
:${e.ip}`,8,900),await X(`pub-order-phone:${t.id}:${n.phone.replace(/\D/g,"")}`,4,900);let o=await x(i=>bt(i,t.id,{...n,channel:"site"},null));a.status(o.replay?200:201).json({number:o.
number,token:o.public_token,status:o.status})}));Ie.get("/orders/:token",l(async(e,a)=>{if(!/^[A-Za-z0-9_-]{16,40}$/.test(e.params.token))throw v("Pedido n\xE3o encontrado");let t=(await d(
`select d.id, d.number, d.status, d.mode, d.eta_minutes, d.created_at, d.updated_at, d.session_id, d.customer_name, c.name as company, c.slug
    from delivery_orders d join companies c on c.id = d.company_id where d.public_token = $1`,[e.params.token])).rows[0];if(!t)throw v("Pedido n\xE3o encontrado");let n=(await d("s\
elect description, qty, modifiers, total_cents from order_items where session_id = $1 and status = 'ativo' order by id",[t.session_id])).rows,o=(await d("select status, created_at \
from delivery_events where order_id = $1 order by id",[t.id])).rows,i=await U({query:d},t.session_id);a.set("cache-control","no-store"),a.json({number:t.number,status:t.status,label:Ye[t.
status],mode:t.mode,eta_minutes:t.eta_minutes,created_at:t.created_at,first_name:t.customer_name.split(" ")[0],company:t.company,slug:t.slug,items:n,totals:{items:i.items,delivery_fee:i.
deliveryFee,total:i.total},events:o.map(s=>({status:s.status,label:Ye[s.status],at:s.created_at}))})}));Ie.get("/review/:token",l(async(e,a)=>{let t=aa(e.params.token);if(!t)throw v(
"Link inv\xE1lido");let n=(await d(`select s.id, s.company_id, c.name as company, (select 1 from reviews r where r.session_id = s.id) as done
    from consumption_sessions s join companies c on c.id = s.company_id where s.id = $1 and s.status = 'encerrada'`,[t])).rows[0];if(!n)throw v("Link inv\xE1lido");a.json({company:n.
company,already:!!n.done})}));Ie.post("/review/:token",l(async(e,a)=>{let t=aa(e.params.token);if(!t)throw v("Link inv\xE1lido");await X(`pub-review:${e.ip}`,10,3600);let n=w(H.object(
{score:H.number().int().min(1).max(5),comment:H.string().trim().max(600).optional()}),e.body),o=(await d("select id, company_id, customer_id from consumption_sessions where id = $1\
 and status = 'encerrada'",[t])).rows[0];if(!o)throw v("Link inv\xE1lido");await d("insert into reviews (company_id, session_id, customer_id, score, comment) values ($1,$2,$3,$4,$5\
)",[o.company_id,o.id,o.customer_id,n.score,n.comment||null]).catch(i=>{throw i.code==="23505"?g("Este consumo j\xE1 foi avaliado. Obrigado!","already_reviewed"):i}),a.status(201).
json({ok:!0})}));Ie.post("/unsubscribe/:token",l(async(e,a)=>{let t=Yo(e.params.token);if(!t)throw v("Link inv\xE1lido");let n=await d("update customers set consent_whatsapp = fals\
e, consent_email = false, unsubscribed_at = now(), updated_at = now() where id = $1 returning company_id",[t]);n.rows[0]&&await d(`insert into audit_events (company_id, action, ent\
ity, entity_id, data) values ($1,'cliente.descadastro','customer',$2,'{"origem":"link"}')`,[n.rows[0].company_id,String(t)]),a.json({ok:!0})}));async function ti(e){return Object.fromEntries(
(await d("select key, value from company_secrets where company_id = $1 and key like 'wa_%'",[e])).rows.map(a=>[a.key,a.value]))}Ie.get("/whatsapp/:slug",l(async(e,a)=>{let t=await wn(
e.params.slug),n=await ti(t.id);if(e.query["hub.mode"]==="subscribe"&&n.wa_verify_token&&kn(String(e.query["hub.verify_token"]||""),n.wa_verify_token))return a.type("text/plain").send(
String(e.query["hub.challenge"]||"").slice(0,200));a.status(403).json({error:"Verifica\xE7\xE3o recusada"})}));Ie.post("/whatsapp/:slug",l(async(e,a)=>{let t=await wn(e.params.slug),
n=await ti(t.id);if(!n.wa_app_secret)return a.status(403).json({error:"Integra\xE7\xE3o n\xE3o configurada"});let o=`sha256=${wr.createHmac("sha256",n.wa_app_secret).update(e.rawBody||
"").digest("hex")}`;if(!kn(String(e.headers["x-hub-signature-256"]||""),o))return a.status(401).json({error:"Assinatura inv\xE1lida"});let i=(await d("select id, name, slug, timezo\
ne, settings from companies where id = $1",[t.id])).rows[0];for(let s of e.body?.entry||[])for(let r of s.changes||[]){let c=r.value||{},u=Object.fromEntries((c.contacts||[]).map(m=>[
m.wa_id,m.profile?.name]));for(let m of c.messages||[]){let p=m.type==="text"?m.text?.body:m.type==="button"?m.button?.text:m.type==="interactive"?m.interactive?.button_reply?.title||
m.interactive?.list_reply?.title:null;!p||!m.from||await fn(i,{channel:"whatsapp",contact:String(m.from).slice(0,20),contactName:u[m.from]||null,body:p,externalId:m.id})}}a.json({ok:!0})}));
async function ni(e){return/^[0-9a-f]{36}$/.test(String(e))&&(await d("select * from infinitepay_charges where token = $1",[e])).rows[0]||null}Ie.post("/infinitepay/webhook/:token",
l(async(e,a)=>{let t=await ni(e.params.token);if(!t)return a.status(404).json({ok:!1});let n=e.body||{};if(await Ge({query:d},t,"webhook",n),n.order_nsu&&String(n.order_nsu)!==t.order_nsu)
return a.status(400).json({ok:!1,error:"pedido n\xE3o confere"});try{await ht(x,t.id,{transaction_nsu:n.transaction_nsu,invoice_slug:n.invoice_slug,capture_method:n.capture_method,
receipt_url:n.receipt_url},"webhook"),a.json({ok:!0})}catch{a.status(400).json({ok:!1})}}));Ie.post("/infinitepay/return",l(async(e,a)=>{await X(`ip-return:${e.ip}`,60,600);let t=e.
body||{},n=await ni(t.c);if(!n)return a.status(404).json({error:"Pagamento n\xE3o encontrado"});await Ge({query:d},n,"retorno",{...t,c:void 0});let o=n;try{o=await ht(x,n.id,{transaction_nsu:t.
transaction_nsu,invoice_slug:t.slug,capture_method:t.capture_method,receipt_url:t.receipt_url},"retorno")}catch{}let i=(await d("select name from companies where id = $1",[n.company_id])).
rows[0];a.json({status:o.status==="divergente"?"pago":o.status,amount_cents:Number(n.amount_cents),description:n.description,company:i?.name,receipt_url:o.receipt_url||t.receipt_url||
null})}));import{Router as ra}from"npm:express@5.2.1";import br from"npm:bcryptjs@3.0.3";import ai from"node:crypto";import{z as fe}from"npm:zod@4.6.5";var we=ra();we.use(ja);we.use((e,a,t)=>{a.set("Cache-Control","no-store"),t()});var ca={companyId:null,userId:null};async function Pt(e){if(!/^\d{1,18}$/.test(String(e)))throw v("E\
mpresa n\xE3o encontrada.");let{rows:a}=await d("select id, is_demo from companies where id = $1",[e]);if(!a[0]||a[0].is_demo)throw v("Empresa n\xE3o encontrada.");return a[0]}we.get(
"/manifest",(e,a)=>a.json({code:Nn,name:"RUSTEN",contract:xa,contract_minor:1,version:ka,description:"Gest\xE3o e PDV para bares e restaurantes: comandas, mesas, dupla leitura e caixa\
.",features:Na,settings:Va()}));we.get("/tenants",l(async(e,a)=>{let{rows:t}=await d("select id from companies where not is_demo order by id limit 5000"),n=[];for(let o of t){let i=await Lt(
o.id);if(i){let{is_demo:s,owner_email:r,...c}=i;n.push(c)}}a.json({items:n})}));var $r=(e,a)=>a||e;we.get("/tenants/:id",l(async(e,a)=>{let t=await Pt(e.params.id),{is_demo:n,...o}=await Lt(
t.id),{rows:i}=await d(`select u.name, u.email, u.role_key as role, r.name as role_name, u.active,
            (select max(s.created_at) from user_sessions s where s.user_id = u.id) as last_login_at
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by u.role_key = 'owner' desc, u.name limit 200`,[t.id]),{rows:s}=await d("select name, active from units where company_id = $1 order by id",[t.id]);
a.json({tenant:{...o,users:{n:i.length,active:i.filter(r=>r.active).length,list:i.map(({role_name:r,...c})=>({...c,role_label:$r(c.role,r)}))},units:s}})}));we.post("/tenants/:id/a\
ccess",l(async(e,a)=>{let t=await Pt(e.params.id),n=w(fe.object({access:fe.object({status:fe.string(),blocked:fe.boolean()}).passthrough()}),e.body);await It(t.id,n.access),await h(
{query:d},{...ca,companyId:t.id},"central.situacao_recebida",{entity:"company",entityId:t.id,data:{status:n.access.status,blocked:n.access.blocked}}),a.json({ok:!0})}));we.post("/t\
enants/:id/owner-reset",l(async(e,a)=>{let t=await Pt(e.params.id),n=w(fe.object({email:fe.string().trim().toLowerCase().email().max(160).nullable().optional()}),e.body||{}),{rows:o}=await d(
"select id, email from users where company_id = $1 and role_key = 'owner' order by id limit 1",[t.id]),i=o[0];if(!i)throw new z(404,"Esta empresa n\xE3o tem usu\xE1rio respons\xE1vel.",
"not_found");let s=i.email;if(n.email&&n.email!==i.email.toLowerCase()){if((await d("select 1 from users where lower(email) = $1 and id <> $2",[n.email,i.id])).rows[0])throw new z(
409,"Este e-mail j\xE1 \xE9 usado por outro acesso.","email_taken");await d("update users set email = $1 where id = $2",[n.email,i.id]),s=n.email}let r=`Rs-${ai.randomBytes(6).toString(
"base64url")}-${ai.randomInt(10,99)}`;await d(`update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null, active = true
            where id = $1`,[i.id,await br.hash(r,12)]),await d("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[i.id]),await h({query:d},{...ca,
companyId:t.id},"central.senha_provisoria",{entity:"user",entityId:i.id,data:{email:s}}),a.json({ok:!0,user_id:String(i.id),email:s,temporary_password:r,message:"Senha provis\xF3ria c\
riada. Oriente o respons\xE1vel a troc\xE1-la em Configura\xE7\xF5es \u203A Meu acesso logo no primeiro acesso."})}));we.get("/settings",l(async(e,a)=>a.json({values:await Ue()})));
we.put("/settings",l(async(e,a)=>{let t=await Ja(e.body?.values);a.json({values:t})}));we.get("/tenants/:id/settings",l(async(e,a)=>{let t=await Pt(e.params.id);a.json({values:await Dn(
t.id)})}));we.put("/tenants/:id/settings",l(async(e,a)=>{let t=await Pt(e.params.id),n=await x(async o=>{let i=await Ka(o,t.id,e.body?.values);return await h(o,{...ca,companyId:t.id},
"central.parametros_alterados",{entity:"company",entityId:t.id,reason:typeof e.body?.reason=="string"?e.body.reason.slice(0,300):null,data:i}),i});a.json({ok:!0,changed:n,values:await Dn(
t.id)})}));var da=ra();da.get("/platform",l(async(e,a)=>{let t=O.CRON_SECRET;if(!t||e.headers.authorization!==`Bearer ${t}`)return a.status(401).json({error:"n\xE3o autorizado"});a.
json(await lt(50))}));var Pe=ra();Pe.use(Le());var Dt=e=>encodeURIComponent(e.ctx.companyId),hn=e=>({user_email:e.ctx.email,user_name:e.ctx.name}),gn=(e,a,t)=>{if(e.ctx.company.is_demo)
return t(new z(400,"Na demonstra\xE7\xE3o n\xE3o h\xE1 assinatura. Ative sua conta para contratar.","demo"));t()};Pe.get("/",l(async(e,a)=>a.json({access:e.ctx.access,hub:!!await je()})));
Pe.get("/billing",l(async(e,a)=>{if(e.ctx.company.is_demo||!await je())return a.json({access:e.ctx.access,hub:!1,demo:!!e.ctx.company.is_demo});if(!e.ctx.can("assinatura.gerenciar"))
return a.json({access:e.ctx.access,restricted:!0,hub:!0});let t=await ge("GET",`/tenants/${Dt(e)}/billing`);t.access&&await It(e.ctx.companyId,t.access),a.json({...t,plans:Ht(t.plans),
hub:!0})}));Pe.post("/billing/checkout",y("assinatura.gerenciar"),gn,l(async(e,a)=>{let t=w(fe.object({plan_id:fe.string().uuid(),cycle:fe.enum(["MONTHLY","ANNUAL"])}),e.body),n=await ge(
"POST",`/tenants/${Dt(e)}/billing/checkout`,{...t,...hn(e)});await h({query:d},e.ctx,"assinatura.contratacao",{data:{plan_id:t.plan_id,cycle:t.cycle}}),a.status(201).json(n)}));Pe.
post("/billing/renew",y("assinatura.gerenciar"),gn,l(async(e,a)=>{let t=await ge("POST",`/tenants/${Dt(e)}/billing/renew`,hn(e));await h({query:d},e.ctx,"assinatura.renovacao"),a.status(
201).json(t)}));Pe.post("/billing/change-plan",y("assinatura.gerenciar"),gn,l(async(e,a)=>{let t=w(fe.object({plan_id:fe.string().uuid()}),e.body),n=await ge("POST",`/tenants/${Dt(
e)}/billing/change-plan`,{...t,...hn(e)});await ut({id:e.ctx.companyId},{fresh:!0}),await h({query:d},e.ctx,"assinatura.troca_plano",{data:t}),a.json(n)}));Pe.post("/billing/cancel",
y("assinatura.gerenciar"),gn,l(async(e,a)=>{if(w(fe.object({confirm:fe.literal(!0,{message:"confirme o cancelamento"})}),e.body),e.ctx.role!=="owner")throw new z(403,"S\xF3 o propriet\
\xE1rio pode cancelar a assinatura.","forbidden");let t=await ge("POST",`/tenants/${Dt(e)}/billing/cancel`,{confirm:!0,...hn(e)});await ut({id:e.ctx.companyId},{fresh:!0}),await h(
{query:d},e.ctx,"assinatura.cancelamento"),a.json(t)}));Pe.post("/verify",l(async(e,a)=>{let t=await ut({id:e.ctx.companyId,is_demo:e.ctx.company.is_demo},{fresh:!0});await h({query:d},
e.ctx,"assinatura.verificacao"),a.json({ok:!0,refreshed:!!t})}));import ma from"node:crypto";var vr=()=>globalThis.process?.env??{};function oi(e,a,t){let n=vr().EDGE_PROXY_KEY,o=e.headers["x-edge-proxy-key"],i=String(e.headers["x-edge-client-ip"]||
"").trim();if(delete e.headers["x-edge-proxy-key"],n&&typeof o=="string"&&i&&/^[0-9a-fA-F:.]{3,64}$/.test(i)){let s=ma.createHash("sha256").update(o).digest(),r=ma.createHash("sha2\
56").update(n).digest();ma.timingSafeEqual(s,r)&&Object.defineProperty(e,"ip",{value:i,configurable:!0})}t()}function la(){let e=ua();e.disable("x-powered-by"),e.set("trust proxy",1),e.use(oi),e.use(xr());let a=O.NODE_ENV==="production",t=(O.CORS_ORIGINS||(a?"":"http://localhost:5173")).split(
",").map(u=>u.trim()).filter(u=>u&&(!a||u!=="*")),n=u=>!u||t.includes(u)||!a&&(t.includes("*")||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u));e.use(kr({origin:(u,m)=>m(null,
n(u)),credentials:!1,maxAge:600,allowedHeaders:["content-type","authorization","x-terminal-id","x-session-mode"]})),e.use("/api",(u,m,p)=>{m.set("Cache-Control","no-store"),p()});let o=(u,m,p)=>{
u.rawBody=p.toString("utf8")},i=ua.json({limit:"9mb",verify:o}),s=ua.json({limit:"1mb",verify:o}),r=/^\/api\/(stock\/notes\/read|pos-sales(\/preview)?)\/?$/;e.use((u,m,p)=>(r.test(
u.path)?i:s)(u,m,p)),e.get("/api/health",(u,m)=>m.json({ok:!0,service:"rusten-api"})),e.use("/api/auth",ue),e.use("/api/platform/v1",we),e.use("/api/cron",da),e.use("/api/access",Pe),
e.use("/api/public",Ie);let c=[Le(),re()];return e.use("/api/admin",...c,Y),e.use("/api/home",...c,en),e.use("/api/menu",...c,re("cardapio"),$e),e.use("/api/floor",...c,Se),e.use("\
/api/pdv",...c,re("pdv"),G),e.use("/api/cash",...c,re("pdv"),He),e.use("/api/customers",...c,re("clientes"),de),e.use("/api/accounts",...c,re("clientes"),Je),e.use("/api/infinitepa\
y",...c,Ce),e.use("/api/pos-sales",...c,re("pdv"),ke),e.use("/api/kitchen",...c,re("cozinha"),le),e.use("/api/stock",...c,re("estoque"),L),e.use("/api/reports",...c,re("relatorios"),
ln),e.use("/api/delivery",...c,re("delivery"),Ee),e.use("/api/marketing",...c,re("marketing"),ye),e.use("/api/agent",...c,re("agente"),Ae),e.use("/api/reservations",...c,re("salao"),
Ot),e.use("/api",(u,m,p)=>p(new z(404,"Rota n\xE3o encontrada","not_found"))),e.use((u,m,p,_)=>{if(u instanceof z)return p.status(u.status).json({error:u.message,code:u.code,...u.extra||
{}});if(u?.type==="entity.parse.failed")return p.status(400).json({error:"JSON inv\xE1lido",code:"invalid"});if(u?.type==="entity.too.large")return p.status(413).json({error:"Requi\
si\xE7\xE3o muito grande",code:"too_large"});if(u?.code==="22P02"||u?.code==="22003")return p.status(400).json({error:"Valor inv\xE1lido",code:"invalid"});if(u?.code==="23503")return p.
status(400).json({error:"Refer\xEAncia inv\xE1lida",code:"invalid_reference"});console.error(JSON.stringify({level:"error",msg:u?.message,path:m.path,method:m.method,code:u?.code})),
p.status(500).json({error:"Erro interno. Tente novamente.",code:"internal"})}),e}var Nr=!O.EDGE_RUNTIME&&process.argv[1]&&jr(import.meta.url)===Ir.resolve(process.argv[1]);if(Nr){let e=Number(
O.PORT||3001);await St(),la().listen(e,()=>console.log(`RUSTEN API na porta ${e}`)),setInterval(()=>lt().catch(()=>{}),6e4).unref()}var pa=null,_a=Sr();_a.use(async(e,a,t)=>{try{pa??=St({log:n=>console.log(`[migrate] ${n}`)}).catch(n=>{throw pa=null,n}),await pa,t()}catch(n){console.error("[boot]",n.message),a.
status(503).json({error:"Servi\xE7o iniciando. Tente novamente em instantes."})}});_a.use([`${O.PATH_PREFIX}-cf`,O.PATH_PREFIX],la());_a.listen(8e3);
