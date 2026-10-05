// RUSTEN API — gerado por scripts/build-edge.mjs. Não editar à mão.
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/migrations.gen.js
var migrations_gen_exports = {};
__export(migrations_gen_exports, {
  MIGRATIONS: () => MIGRATIONS
});
var MIGRATIONS;
var init_migrations_gen = __esm({
  "src/migrations.gen.js"() {
    MIGRATIONS = [
      {
        "name": "001_base_pdv.sql",
        "sql": "-- RUSTEN \u2014 001: base multiempresa, perfis, card\xE1pio, comandas/sess\xF5es, mesas, PDV, caixa, auditoria e central.\n-- Somente cria\xE7\xE3o de objetos. Rollback: migrations/\
rollback/001_base_pdv.down.sql\n\ncreate table if not exists companies (\n  id            bigserial primary key,\n  name          text not null,\n  segment       text not null default '\
restaurante',\n  document      text,\n  email         text,\n  phone         text,\n  address       jsonb not null default '{}'::jsonb,\n  timezone      text not null default 'America/S\
ao_Paulo',\n  settings      jsonb not null default '{}'::jsonb,\n  -- situa\xE7\xE3o entregue pela central (MASTER do ORBI). Vazio = sem central configurada.\n  access        jsonb not null\
 default '{}'::jsonb,\n  access_updated_at timestamptz,\n  created_at    timestamptz not null default now(),\n  last_access_at timestamptz\n);\n\ncreate table if not exists units (\n  id \
         bigserial primary key,\n  company_id  bigint not null references companies(id),\n  name        text not null,\n  active      boolean not null default true,\n  -- jornada que a\
travessa a meia-noite: vendas antes deste hor\xE1rio contam no dia comercial anterior\n  day_cutoff  smallint not null default 5 check (day_cutoff between 0 and 12),\n  settings    json\
b not null default '{}'::jsonb,\n  created_at  timestamptz not null default now(),\n  unique (company_id, id)\n);\n\ncreate table if not exists roles (\n  id          bigserial primary k\
ey,\n  company_id  bigint not null references companies(id),\n  key         text not null,\n  name        text not null,\n  level       smallint not null default 10,\n  permissions text\
[] not null default '{}',\n  system      boolean not null default false,\n  unique (company_id, key)\n);\n\ncreate table if not exists users (\n  id            bigserial primary key,\n  c\
ompany_id    bigint not null references companies(id),\n  unit_id       bigint,\n  name          text not null,\n  email         text not null,\n  password_hash text not null,\n  role_k\
ey      text not null,\n  active        boolean not null default true,\n  failed_attempts int not null default 0,\n  locked_until  timestamptz,\n  password_changed_at timestamptz not n\
ull default now(),\n  created_at    timestamptz not null default now(),\n  foreign key (company_id, unit_id) references units(company_id, id),\n  foreign key (company_id, role_key) re\
ferences roles(company_id, key) on update cascade\n);\ncreate unique index if not exists users_email_uq on users (lower(email));\ncreate unique index if not exists users_company_id_uq\
 on users (company_id, id);\n\ncreate table if not exists user_sessions (\n  id           uuid primary key,\n  user_id      bigint not null references users(id),\n  refresh_hash text no\
t null,\n  expires_at   timestamptz not null,\n  revoked_at   timestamptz,\n  rotated_at   timestamptz,\n  ip           text,\n  created_at   timestamptz not null default now()\n);\n\ncrea\
te table if not exists terminals (\n  id          bigserial primary key,\n  company_id  bigint not null,\n  unit_id     bigint not null,\n  name        text not null,\n  active      boo\
lean not null default true,\n  settings    jsonb not null default '{}'::jsonb,\n  created_at  timestamptz not null default now(),\n  foreign key (company_id, unit_id) references units\
(company_id, id),\n  unique (company_id, id)\n);\n\ncreate table if not exists audit_events (\n  id          bigserial primary key,\n  company_id  bigint not null references companies(id\
),\n  unit_id     bigint,\n  terminal_id bigint,\n  user_id     bigint,\n  action      text not null,\n  entity      text,\n  entity_id   text,\n  reason      text,\n  data        jsonb no\
t null default '{}'::jsonb,\n  created_at  timestamptz not null default now()\n);\ncreate index if not exists audit_company_idx on audit_events (company_id, created_at desc);\n\ncreate \
or replace function audit_immutable() returns trigger language plpgsql as $$\nbegin\n  raise exception 'auditoria \xE9 somente inclus\xE3o';\nend $$;\ndrop trigger if exists audit_no_change \
on audit_events;\ncreate trigger audit_no_change before update or delete on audit_events\n  for each row execute function audit_immutable();\n\n-- Card\xE1pio ----------------------------\
-----------------------------------\ncreate table if not exists production_sectors (\n  id         bigserial primary key,\n  company_id bigint not null references companies(id),\n  nam\
e       text not null,\n  active     boolean not null default true,\n  unique (company_id, id)\n);\n\ncreate table if not exists categories (\n  id         bigserial primary key,\n  compa\
ny_id bigint not null references companies(id),\n  name       text not null,\n  sort       int not null default 0,\n  active     boolean not null default true,\n  demo       boolean no\
t null default false,\n  unique (company_id, id)\n);\n\ncreate table if not exists products (\n  id           bigserial primary key,\n  company_id   bigint not null references companies(\
id),\n  category_id  bigint,\n  sector_id    bigint,\n  name         text not null,\n  description  text,\n  sku          text,\n  kind         text not null default 'resale'\n           \
    check (kind in ('resale','recipe','produced','combo','addon','weight')),\n  unit         text not null default 'un' check (unit in ('un','kg','g','L','ml')),\n  price_cents  bigi\
nt not null check (price_cents >= 0),\n  cost_cents   bigint not null default 0 check (cost_cents >= 0),\n  favorite     boolean not null default false,\n  active       boolean not nu\
ll default true,\n  channels     text[] not null default '{pdv}',\n  allergens    text,\n  demo         boolean not null default false,\n  created_at   timestamptz not null default now\
(),\n  updated_at   timestamptz not null default now(),\n  foreign key (company_id, category_id) references categories(company_id, id),\n  foreign key (company_id, sector_id) referenc\
es production_sectors(company_id, id),\n  unique (company_id, id)\n);\ncreate unique index if not exists products_sku_uq on products (company_id, sku) where sku is not null;\n\ncreate t\
able if not exists product_price_history (\n  id          bigserial primary key,\n  company_id  bigint not null,\n  product_id  bigint not null,\n  old_cents   bigint,\n  new_cents   bi\
gint not null,\n  user_id     bigint,\n  created_at  timestamptz not null default now(),\n  foreign key (company_id, product_id) references products(company_id, id)\n);\n\n-- C\xF3digos lid\
os pelo PDV. Texto (preserva zeros \xE0 esquerda). Um c\xF3digo pertence a UMA entidade da empresa.\ncreate table if not exists scan_codes (\n  id          bigserial primary key,\n  company\
_id  bigint not null references companies(id),\n  code        text not null,\n  entity      text not null check (entity in ('PRODUTO','COMANDA','MESA','CLIENTE','FUNCIONARIO','PEDIDO\
')),\n  entity_id   bigint not null,\n  created_at  timestamptz not null default now(),\n  unique (company_id, code)\n);\ncreate index if not exists scan_codes_entity_idx on scan_codes \
(company_id, entity, entity_id);\n\ncreate table if not exists modifier_groups (\n  id          bigserial primary key,\n  company_id  bigint not null,\n  product_id  bigint not null,\n  \
name        text not null,\n  min_select  int not null default 0 check (min_select >= 0),\n  max_select  int not null default 1 check (max_select >= 1),\n  sort        int not null de\
fault 0,\n  foreign key (company_id, product_id) references products(company_id, id) on delete cascade,\n  unique (company_id, id),\n  check (min_select <= max_select)\n);\n\ncreate tabl\
e if not exists modifier_options (\n  id          bigserial primary key,\n  company_id  bigint not null,\n  group_id    bigint not null,\n  name        text not null,\n  price_cents big\
int not null default 0 check (price_cents >= 0),\n  active      boolean not null default true,\n  foreign key (company_id, group_id) references modifier_groups(company_id, id) on del\
ete cascade,\n  unique (company_id, id)\n);\n\n-- Sal\xE3o ------------------------------------------------------------------\ncreate table if not exists dining_tables (\n  id          bigs\
erial primary key,\n  company_id  bigint not null,\n  unit_id     bigint not null,\n  number      int not null,\n  area        text not null default 'Sal\xE3o',\n  capacity    int not null\
 default 4 check (capacity > 0),\n  status      text not null default 'livre'\n              check (status in ('livre','ocupada','reservada','conta','limpeza')),\n  pos_x       int no\
t null default 0,\n  pos_y       int not null default 0,\n  active      boolean not null default true,\n  foreign key (company_id, unit_id) references units(company_id, id),\n  unique \
(company_id, unit_id, number),\n  unique (company_id, id)\n);\n\n-- Cart\xE3o f\xEDsico reutiliz\xE1vel (n\xE3o confundir com a sess\xE3o de consumo)\ncreate table if not exists tab_cards (\n  id      \
     bigserial primary key,\n  company_id   bigint not null,\n  unit_id      bigint not null,\n  number       int not null,\n  status       text not null default 'ativo' check (status \
in ('ativo','bloqueado')),\n  block_reason text,\n  created_at   timestamptz not null default now(),\n  foreign key (company_id, unit_id) references units(company_id, id),\n  unique (c\
ompany_id, unit_id, number),\n  unique (company_id, id)\n);\n\ncreate table if not exists consumption_sessions (\n  id             bigserial primary key,\n  company_id     bigint not nul\
l,\n  unit_id        bigint not null,\n  kind           text not null default 'comanda' check (kind in ('comanda','mesa','balcao','retirada')),\n  card_id        bigint,\n  table_id   \
    bigint,\n  customer_name  text,\n  label          text,\n  status         text not null default 'aberta'\n                 check (status in ('aberta','em_fechamento','encerrada','c\
ancelada')),\n  service_fee_bp int not null default 0 check (service_fee_bp between 0 and 3000),\n  service_fee_removed_reason text,\n  opened_by      bigint,\n  opened_at      timesta\
mptz not null default now(),\n  closed_by      bigint,\n  closed_at      timestamptz,\n  business_date  date not null,\n  version        int not null default 1,\n  suspended      boolea\
n not null default false,\n  foreign key (company_id, unit_id) references units(company_id, id),\n  foreign key (company_id, card_id) references tab_cards(company_id, id),\n  foreign \
key (company_id, table_id) references dining_tables(company_id, id),\n  unique (company_id, id)\n);\n-- no m\xE1ximo uma sess\xE3o ativa por cart\xE3o\ncreate unique index if not exists session\
s_card_active_uq on consumption_sessions (card_id)\n  where card_id is not null and status in ('aberta','em_fechamento');\ncreate index if not exists sessions_open_idx on consumption\
_sessions (company_id, status);\n\ncreate table if not exists order_items (\n  id              bigserial primary key,\n  company_id      bigint not null,\n  session_id      bigint not n\
ull,\n  product_id      bigint not null,\n  description     text not null,\n  qty             numeric(12,3) not null check (qty > 0),\n  unit            text not null default 'un',\n  u\
nit_price_cents bigint not null check (unit_price_cents >= 0),\n  modifiers       jsonb not null default '[]'::jsonb,\n  modifiers_cents bigint not null default 0,\n  discount_cents  \
bigint not null default 0 check (discount_cents >= 0),\n  total_cents     bigint not null check (total_cents >= 0),\n  notes           text,\n  sector_id       bigint,\n  status       \
   text not null default 'ativo' check (status in ('ativo','cancelado')),\n  kitchen_status  text not null default 'novo'\n                  check (kitchen_status in ('novo','aceito'\
,'preparando','pronto','entregue','cancelado','nao_produz')),\n  launch_mode     text not null check (launch_mode in ('manual','continua','dupla','excecao','balcao')),\n  terminal_id\
     bigint,\n  user_id         bigint,\n  idempotency_key text not null,\n  transferred_from bigint,\n  cancel_reason   text,\n  canceled_by     bigint,\n  canceled_at     timestamptz,\n\
  created_at      timestamptz not null default now(),\n  foreign key (company_id, session_id) references consumption_sessions(company_id, id),\n  foreign key (company_id, product_id)\
 references products(company_id, id),\n  unique (company_id, idempotency_key)\n);\ncreate index if not exists items_session_idx on order_items (session_id);\n\n-- Caixa ----------------\
--------------------------------------------------\ncreate table if not exists cash_sessions (\n  id              bigserial primary key,\n  company_id      bigint not null,\n  unit_id \
        bigint not null,\n  terminal_id     bigint,\n  user_id         bigint not null,\n  status          text not null default 'aberto' check (status in ('aberto','fechado')),\n  ope\
ning_cents   bigint not null default 0 check (opening_cents >= 0),\n  opened_at       timestamptz not null default now(),\n  business_date   date not null,\n  closed_at       timestam\
ptz,\n  closed_by       bigint,\n  counted         jsonb,\n  expected        jsonb,\n  difference_cents bigint,\n  justification   text,\n  foreign key (company_id, unit_id) references u\
nits(company_id, id),\n  unique (company_id, id)\n);\ncreate unique index if not exists cash_open_terminal_uq on cash_sessions (company_id, terminal_id)\n  where status = 'aberto' and \
terminal_id is not null;\n\ncreate table if not exists cash_movements (\n  id              bigserial primary key,\n  company_id      bigint not null,\n  cash_session_id bigint not null,\
\n  kind            text not null check (kind in ('sangria','suprimento','despesa')),\n  amount_cents    bigint not null check (amount_cents > 0),\n  reason          text not null,\n  \
user_id         bigint,\n  created_at      timestamptz not null default now(),\n  foreign key (company_id, cash_session_id) references cash_sessions(company_id, id)\n);\n\ncreate table \
if not exists payments (\n  id              bigserial primary key,\n  company_id      bigint not null,\n  session_id      bigint not null,\n  cash_session_id bigint,\n  method          \
text not null check (method in ('dinheiro','pix','debito','credito','vale','outro')),\n  amount_cents    bigint not null check (amount_cents > 0),\n  tendered_cents  bigint,\n  change\
_cents    bigint not null default 0 check (change_cents >= 0),\n  status          text not null default 'confirmado' check (status in ('confirmado','estornado')),\n  -- origem: infor\
mado pelo operador, importado de relat\xF3rio ou confirmado por integra\xE7\xE3o oficial\n  source          text not null default 'operador' check (source in ('operador','importado','integra\
cao')),\n  business_date   date not null,\n  idempotency_key text not null,\n  user_id         bigint,\n  refund_reason   text,\n  refunded_by     bigint,\n  refunded_at     timestamptz,\
\n  created_at      timestamptz not null default now(),\n  foreign key (company_id, session_id) references consumption_sessions(company_id, id),\n  unique (company_id, idempotency_key\
)\n);\ncreate index if not exists payments_session_idx on payments (session_id);\n\n-- Autoriza\xE7\xE3o gerencial individual, de uso \xFAnico e validade curta\ncreate table if not exists manage\
r_authorizations (\n  id            bigserial primary key,\n  company_id    bigint not null,\n  requested_by  bigint not null,\n  authorized_by bigint not null,\n  action        text no\
t null,\n  scope         jsonb not null default '{}'::jsonb,\n  token_hash    text not null unique,\n  expires_at    timestamptz not null,\n  used_at       timestamptz,\n  created_at   \
 timestamptz not null default now()\n);\n\ncreate table if not exists rate_limits (\n  key       text primary key,\n  count     int not null,\n  reset_at  timestamptz not null\n);\n\n-- Cen\
tral (MASTER do ORBI): prote\xE7\xE3o contra repeti\xE7\xE3o de chamadas assinadas\ncreate table if not exists platform_nonces (\n  nonce      text primary key,\n  created_at timestamptz not null\
 default now()\n);\n\ncreate table if not exists platform_outbox (\n  id          bigserial primary key,\n  company_id  bigint,\n  kind        text not null,\n  payload     jsonb not null\
,\n  attempts    int not null default 0,\n  last_error  text,\n  sent_at     timestamptz,\n  created_at  timestamptz not null default now()\n);\n"
      },
      {
        "name": "002_central_demo.sql",
        "sql": "-- RUSTEN \u2014 002: liga\xE7\xE3o com a central da plataforma (MASTER do ORBI, contrato v1) e empresas de demonstra\xE7\xE3o.\n-- Rollback: migrations/rollback/002_central_demo.dow\
n.sql\n\n-- Demonstra\xE7\xE3o: nunca vai para a central, nunca \xE9 bloqueada e \xE9 apagada ap\xF3s 7 dias sem convers\xE3o\nalter table companies add column if not exists is_demo boolean not null de\
fault false;\ncreate index if not exists companies_demo_idx on companies (created_at) where is_demo;\n\n-- Configura\xE7\xE3o da central quando n\xE3o h\xE1 vari\xE1veis de ambiente (Supabase Edge):\
 platform_hub_url, platform_secret\ncreate table if not exists platform_config (\n  key        text primary key,\n  value      text not null,\n  updated_at timestamptz not null default\
 now()\n);\n\n-- Par\xE2metros do sistema (valem para todas as empresas), edit\xE1veis pelo MASTER da central\ncreate table if not exists system_settings (\n  key        text primary key,\n  v\
alue      jsonb not null,\n  updated_at timestamptz not null default now()\n);\n\n-- Auditoria segue somente inclus\xE3o; a \xFAnica exce\xE7\xE3o \xE9 apagar uma empresa de demonstra\xE7\xE3o inteira\ncrea\
te or replace function audit_immutable() returns trigger language plpgsql as $$\nbegin\n  if tg_op = 'DELETE' and current_setting('rusten.purge_demo', true) = old.company_id::text th\
en\n    return old;\n  end if;\n  raise exception 'auditoria \xE9 somente inclus\xE3o';\nend $$;\n\n-- Apaga uma empresa de demonstra\xE7\xE3o e tudo o que pertence a ela (recusa empresas reais)\ncre\
ate or replace function purge_demo_company(p_company bigint) returns void language plpgsql as $$\nbegin\n  if not exists (select 1 from companies where id = p_company and is_demo) th\
en\n    raise exception 'empresa % n\xE3o \xE9 de demonstra\xE7\xE3o', p_company;\n  end if;\n  perform set_config('rusten.purge_demo', p_company::text, true);\n  delete from payments where compan\
y_id = p_company;\n  delete from cash_movements where company_id = p_company;\n  delete from cash_sessions where company_id = p_company;\n  delete from order_items where company_id = \
p_company;\n  delete from consumption_sessions where company_id = p_company;\n  delete from manager_authorizations where company_id = p_company;\n  delete from scan_codes where compan\
y_id = p_company;\n  delete from tab_cards where company_id = p_company;\n  delete from dining_tables where company_id = p_company;\n  delete from modifier_options where company_id = \
p_company;\n  delete from modifier_groups where company_id = p_company;\n  delete from product_price_history where company_id = p_company;\n  delete from products where company_id = p\
_company;\n  delete from categories where company_id = p_company;\n  delete from production_sectors where company_id = p_company;\n  delete from user_sessions where user_id in (select\
 id from users where company_id = p_company);\n  delete from users where company_id = p_company;\n  delete from terminals where company_id = p_company;\n  delete from roles where comp\
any_id = p_company;\n  delete from units where company_id = p_company;\n  delete from platform_outbox where company_id = p_company;\n  delete from audit_events where company_id = p_co\
mpany;\n  delete from companies where id = p_company;\n  perform set_config('rusten.purge_demo', '', true);\nend $$;\nrevoke all on function purge_demo_company(bigint) from public;\n"
      },
      {
        "name": "003_modulos.sql",
        "sql": "-- RUSTEN \u2014 003: clientes e fidelidade, cozinha (KDS), estoque e fichas t\xE9cnicas, compras, delivery e card\xE1pio digital,\n-- marketing (campanhas e avalia\xE7\xF5es) e agen\
te de atendimento por WhatsApp.\n-- Rollback: migrations/rollback/003_modulos.down.sql\n\n-- Permiss\xF5es novas entram nos perfis j\xE1 existentes -----------------------------------------\
-\ncreate or replace function rusten_grant(p_keys text[], p_perms text[]) returns void language sql as $$\n  update roles set permissions = (select array(select distinct unnest(permi\
ssions || p_perms)))\n   where key = any(p_keys);\n$$;\nselect rusten_grant(array['owner','admin','gerente'], array['clientes.visualizar','clientes.gerenciar','cozinha.operar',\n  'del\
ivery.gerenciar','estoque.visualizar','compras.gerenciar','marketing.gerenciar','agente.gerenciar','agente.atender']);\nselect rusten_grant(array['caixa','garcom'], array['clientes.\
visualizar','clientes.gerenciar']);\nselect rusten_grant(array['cozinha','bar'], array['cozinha.operar']);\nselect rusten_grant(array['estoque'], array['estoque.visualizar','compras.\
gerenciar']);\nselect rusten_grant(array['financeiro'], array['estoque.visualizar','clientes.visualizar']);\nselect rusten_grant(array['entregador'], array['delivery.entregar']);\nsel\
ect rusten_grant(array['owner','admin','gerente'], array['delivery.entregar']);\ndrop function rusten_grant(text[], text[]);\n\n-- Endere\xE7o p\xFAblico da empresa (card\xE1pio digital e aval\
ia\xE7\xF5es)\nalter table companies add column if not exists slug text;\ncreate unique index if not exists companies_slug_uq on companies (slug) where slug is not null;\n\n-- Clientes -----\
------------------------------------------------------------------------------\ncreate table if not exists customers (\n  id            bigserial primary key,\n  company_id    bigint \
not null references companies(id),\n  cpf           text check (cpf ~ '^[0-9]{11}$'),\n  name          text not null,\n  phone         text,\n  email         text,\n  birthday      date\
,\n  address       jsonb not null default '{}'::jsonb,\n  tags          text[] not null default '{}',\n  preferences   text,\n  notes         text,\n  consent_whatsapp boolean not null \
default false,\n  consent_email    boolean not null default false,\n  consent_at    timestamptz,\n  unsubscribed_at timestamptz,\n  points        int not null default 0,\n  anonymized_a\
t timestamptz,\n  created_by    bigint,\n  created_at    timestamptz not null default now(),\n  updated_at    timestamptz not null default now(),\n  unique (company_id, id)\n);\ncreate u\
nique index if not exists customers_cpf_uq on customers (company_id, cpf) where cpf is not null;\ncreate index if not exists customers_phone_idx on customers (company_id, phone);\ncr\
eate index if not exists customers_name_idx on customers (company_id, lower(name));\n\nalter table consumption_sessions add column if not exists customer_id bigint;\nalter table consu\
mption_sessions drop constraint if exists consumption_sessions_customer_fk;\nalter table consumption_sessions add constraint consumption_sessions_customer_fk\n  foreign key (company_\
id, customer_id) references customers(company_id, id);\ncreate index if not exists sessions_customer_idx on consumption_sessions (company_id, customer_id) where customer_id is not n\
ull;\n\n-- Extrato de pontos: somente inclus\xE3o; o saldo em customers.points \xE9 mantido pela mesma transa\xE7\xE3o\ncreate table if not exists loyalty_ledger (\n  id           bigserial primar\
y key,\n  company_id   bigint not null,\n  customer_id  bigint not null,\n  session_id   bigint,\n  kind         text not null check (kind in ('ganho','resgate','estorno','expiracao','\
ajuste')),\n  points       int not null check (points <> 0),\n  expires_at   date,\n  reason       text,\n  reverses_id  bigint references loyalty_ledger(id),\n  payment_id   bigint,\n  \
user_id      bigint,\n  created_at   timestamptz not null default now(),\n  foreign key (company_id, customer_id) references customers(company_id, id)\n);\ncreate index if not exists l\
oyalty_customer_idx on loyalty_ledger (company_id, customer_id, id);\ncreate unique index if not exists loyalty_reverse_once_uq on loyalty_ledger (reverses_id) where reverses_id is \
not null;\n\ncreate table if not exists reviews (\n  id           bigserial primary key,\n  company_id   bigint not null references companies(id),\n  session_id   bigint,\n  customer_id \
 bigint,\n  score        smallint not null check (score between 1 and 5),\n  comment      text,\n  handled_at   timestamptz,\n  handled_by   bigint,\n  created_at   timestamptz not null\
 default now()\n);\ncreate unique index if not exists reviews_session_uq on reviews (company_id, session_id) where session_id is not null;\n\n-- Cozinha / KDS -------------------------\
-----------------------------------------------------\nalter table production_sectors add column if not exists target_minutes int not null default 15 check (target_minutes between 1\
 and 240);\nalter table order_items add column if not exists priority boolean not null default false;\nalter table order_items add column if not exists accepted_at timestamptz;\nalter\
 table order_items add column if not exists ready_at timestamptz;\nalter table order_items add column if not exists delivered_at timestamptz;\nalter table order_items add column if n\
ot exists cancel_ack_at timestamptz;\nalter table order_items add column if not exists sent_at timestamptz;\nalter table order_items drop constraint if exists order_items_launch_mode\
_check;\nalter table order_items add constraint order_items_launch_mode_check\n  check (launch_mode in ('manual','continua','dupla','excecao','balcao','delivery'));\nupdate order_item\
s set sent_at = created_at where sent_at is null and kitchen_status <> 'nao_produz';\n-- Envio por lote: itens aguardando confirma\xE7\xE3o (sent_at nulo) n\xE3o aparecem na fila\ncreate inde\
x if not exists items_kitchen_idx on order_items (company_id, sector_id, kitchen_status) where kitchen_status not in ('entregue','nao_produz');\n\n-- Eventos de produ\xE7\xE3o (somente inc\
lus\xE3o): toda transi\xE7\xE3o registrada uma vez\ncreate table if not exists kitchen_events (\n  id          bigserial primary key,\n  company_id  bigint not null,\n  item_id     bigint not n\
ull references order_items(id),\n  from_status text,\n  to_status   text not null,\n  user_id     bigint,\n  created_at  timestamptz not null default now()\n);\ncreate index if not exist\
s kitchen_events_item_idx on kitchen_events (item_id);\n\n-- Estoque ------------------------------------------------------------------------------------\ncreate table if not exists s\
tock_items (\n  id            bigserial primary key,\n  company_id    bigint not null references companies(id),\n  name          text not null,\n  unit          text not null check (un\
it in ('un','kg','g','L','ml')),\n  min_qty       numeric(14,3) not null default 0,\n  reorder_qty   numeric(14,3) not null default 0,\n  avg_cost_cents numeric(16,4) not null default\
 0 check (avg_cost_cents >= 0),\n  active        boolean not null default true,\n  created_at    timestamptz not null default now(),\n  unique (company_id, id)\n);\ncreate unique index \
if not exists stock_items_name_uq on stock_items (company_id, lower(name));\n\n-- Estrat\xE9gia por produto: nenhuma, ficha t\xE9cnica (insumos) ou produto acabado \u2014 nunca as duas\nalter ta\
ble products add column if not exists stock_mode text not null default 'nenhum' check (stock_mode in ('nenhum','ficha','acabado'));\nalter table products add column if not exists st\
ock_item_id bigint;\nalter table products drop constraint if exists products_stock_item_fk;\nalter table products add constraint products_stock_item_fk foreign key (company_id, stock\
_item_id) references stock_items(company_id, id);\nalter table products drop constraint if exists products_stock_mode_chk;\nalter table products add constraint products_stock_mode_ch\
k check (stock_mode <> 'acabado' or stock_item_id is not null);\n\n-- Fichas t\xE9cnicas versionadas: s\xF3 uma vigente por produto\ncreate table if not exists recipes (\n  id          bigse\
rial primary key,\n  company_id  bigint not null,\n  product_id  bigint not null,\n  version     int not null,\n  yield_qty   numeric(12,3) not null default 1 check (yield_qty > 0),\n  \
notes       text,\n  active      boolean not null default true,\n  created_by  bigint,\n  created_at  timestamptz not null default now(),\n  foreign key (company_id, product_id) refere\
nces products(company_id, id),\n  unique (company_id, id),\n  unique (product_id, version)\n);\ncreate unique index if not exists recipes_active_uq on recipes (product_id) where active\
;\n\ncreate table if not exists recipe_lines (\n  id            bigserial primary key,\n  company_id    bigint not null,\n  recipe_id     bigint not null,\n  stock_item_id bigint not nul\
l,\n  qty           numeric(14,4) not null check (qty > 0),\n  loss_pct      numeric(5,2) not null default 0 check (loss_pct >= 0 and loss_pct < 100),\n  foreign key (company_id, reci\
pe_id) references recipes(company_id, id) on delete cascade,\n  foreign key (company_id, stock_item_id) references stock_items(company_id, id)\n);\n\n-- Adicional que consome insumo (e\
x.: bacon extra)\nalter table modifier_options add column if not exists stock_item_id bigint;\nalter table modifier_options add column if not exists stock_qty numeric(14,4);\n\n-- Movi\
mentos imut\xE1veis. Saldo = soma das quantidades. Revers\xF5es apontam para o original.\ncreate table if not exists stock_movements (\n  id            bigserial primary key,\n  company_id \
   bigint not null,\n  stock_item_id bigint not null,\n  kind          text not null check (kind in ('entrada','venda','estorno_venda','perda','ajuste','inventario','producao_consumo\
','producao_entrada','reversao')),\n  qty           numeric(14,4) not null check (qty <> 0),\n  unit_cost_cents numeric(16,4),\n  ref_type      text,\n  ref_id        bigint,\n  reverse\
s_id   bigint references stock_movements(id),\n  reason        text,\n  user_id       bigint,\n  created_at    timestamptz not null default now(),\n  foreign key (company_id, stock_ite\
m_id) references stock_items(company_id, id)\n);\ncreate index if not exists stock_mov_item_idx on stock_movements (company_id, stock_item_id, created_at);\n-- impede baixa dupla de u\
m mesmo item vendido\ncreate unique index if not exists stock_mov_sale_uq on stock_movements (company_id, ref_type, ref_id, stock_item_id, kind)\n  where ref_type = 'order_item';\ncre\
ate unique index if not exists stock_mov_reverse_uq on stock_movements (reverses_id) where reverses_id is not null;\n\ncreate or replace function stock_immutable() returns trigger la\
nguage plpgsql as $$\nbegin\n  if tg_op = 'DELETE' and current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;\n  raise exception 'movimentos de est\
oque s\xE3o imut\xE1veis: registre uma revers\xE3o';\nend $$;\ndrop trigger if exists stock_mov_immutable on stock_movements;\ncreate trigger stock_mov_immutable before update or delete on sto\
ck_movements for each row execute function stock_immutable();\n\ncreate table if not exists purchases (\n  id           bigserial primary key,\n  company_id   bigint not null reference\
s companies(id),\n  supplier     text not null,\n  document     text,\n  status       text not null default 'aberta' check (status in ('aberta','parcial','recebida','cancelada')),\n  d\
ue_date     date,\n  notes        text,\n  total_cents  bigint not null default 0,\n  created_by   bigint,\n  created_at   timestamptz not null default now(),\n  unique (company_id, id)\
\n);\ncreate table if not exists purchase_lines (\n  id             bigserial primary key,\n  company_id     bigint not null,\n  purchase_id    bigint not null,\n  stock_item_id  bigint \
not null,\n  qty            numeric(14,3) not null check (qty > 0),\n  received_qty   numeric(14,3) not null default 0 check (received_qty >= 0),\n  unit_cost_cents bigint not null ch\
eck (unit_cost_cents >= 0),\n  foreign key (company_id, purchase_id) references purchases(company_id, id) on delete cascade,\n  foreign key (company_id, stock_item_id) references sto\
ck_items(company_id, id),\n  check (received_qty <= qty)\n);\n\ncreate table if not exists inventory_counts (\n  id          bigserial primary key,\n  company_id  bigint not null referen\
ces companies(id),\n  status      text not null default 'aberto' check (status in ('aberto','aprovado','descartado')),\n  lines       jsonb not null default '[]'::jsonb,\n  notes     \
  text,\n  created_by  bigint,\n  approved_by bigint,\n  approved_at timestamptz,\n  created_at  timestamptz not null default now()\n);\n\n-- Delivery e card\xE1pio digital -----------------\
----------------------------------------------\nalter table consumption_sessions drop constraint if exists consumption_sessions_kind_check;\nalter table consumption_sessions add cons\
traint consumption_sessions_kind_check check (kind in ('comanda','mesa','balcao','retirada','delivery'));\nalter table consumption_sessions add column if not exists delivery_fee_cen\
ts bigint not null default 0 check (delivery_fee_cents >= 0);\n\ncreate table if not exists delivery_orders (\n  id            bigserial primary key,\n  company_id    bigint not null r\
eferences companies(id),\n  unit_id       bigint not null,\n  session_id    bigint not null,\n  number        int not null,\n  public_token  text not null unique,\n  channel       text \
not null default 'site' check (channel in ('site','whatsapp','telefone','balcao','marketplace')),\n  mode          text not null check (mode in ('entrega','retirada')),\n  status    \
    text not null default 'recebido'\n                check (status in ('recebido','confirmado','em_preparo','pronto','saiu','entregue','cancelado')),\n  customer_id   bigint,\n  cust\
omer_name text not null,\n  phone         text not null,\n  address       jsonb not null default '{}'::jsonb,\n  payment_hint  text,\n  change_for_cents bigint,\n  notes         text,\n \
 eta_minutes   int,\n  courier_id    bigint,\n  proof         text,\n  cancel_reason text,\n  client_key    text not null,\n  created_at    timestamptz not null default now(),\n  updated\
_at    timestamptz not null default now(),\n  foreign key (company_id, session_id) references consumption_sessions(company_id, id),\n  unique (company_id, number),\n  unique (company_\
id, client_key)\n);\ncreate index if not exists delivery_status_idx on delivery_orders (company_id, status, created_at desc);\n\ncreate table if not exists delivery_events (\n  id      \
   bigserial primary key,\n  company_id bigint not null,\n  order_id   bigint not null references delivery_orders(id),\n  status     text not null,\n  user_id    bigint,\n  note       t\
ext,\n  created_at timestamptz not null default now()\n);\n\n-- Marketing ----------------------------------------------------------------------------------\ncreate table if not exists \
campaigns (\n  id           bigserial primary key,\n  company_id   bigint not null references companies(id),\n  name         text not null,\n  channel      text not null check (channel\
 in ('whatsapp','email')),\n  segment      jsonb not null default '{}'::jsonb,\n  message      text not null,\n  status       text not null default 'rascunho' check (status in ('rascu\
nho','preparada','enviada','cancelada')),\n  recipients   int not null default 0,\n  prepared_at  timestamptz,\n  created_by   bigint,\n  created_at   timestamptz not null default now(\
)\n);\ncreate table if not exists campaign_recipients (\n  id           bigserial primary key,\n  company_id   bigint not null,\n  campaign_id  bigint not null references campaigns(id) \
on delete cascade,\n  customer_id  bigint not null,\n  status       text not null default 'pendente' check (status in ('pendente','enviado','falhou','descadastrado')),\n  sent_at     \
 timestamptz,\n  error        text,\n  unique (campaign_id, customer_id)\n);\n\n-- Agente WhatsApp ----------------------------------------------------------------------------\n-- Creden\
ciais da integra\xE7\xE3o oficial: nunca devolvidas ao navegador\ncreate table if not exists company_secrets (\n  company_id  bigint not null references companies(id),\n  key         text n\
ot null,\n  value       text not null,\n  updated_at  timestamptz not null default now(),\n  primary key (company_id, key)\n);\ncreate table if not exists conversations (\n  id          \
 bigserial primary key,\n  company_id   bigint not null references companies(id),\n  channel      text not null check (channel in ('whatsapp','simulador')),\n  contact      text not n\
ull,\n  contact_name text,\n  customer_id  bigint,\n  mode         text not null default 'agente' check (mode in ('agente','humano','pausado')),\n  assigned_to  bigint,\n  state        \
jsonb not null default '{}'::jsonb,\n  needs_human  boolean not null default false,\n  last_message_at timestamptz not null default now(),\n  created_at   timestamptz not null default\
 now(),\n  unique (company_id, channel, contact)\n);\ncreate table if not exists conversation_messages (\n  id              bigserial primary key,\n  company_id      bigint not null,\n  \
conversation_id bigint not null references conversations(id) on delete cascade,\n  direction       text not null check (direction in ('in','out')),\n  author          text not null c\
heck (author in ('cliente','agente','equipe','sistema')),\n  body            text not null,\n  external_id     text,\n  delivery_status text not null default 'ok' check (delivery_stat\
us in ('ok','pendente','falhou','simulado')),\n  error           text,\n  user_id         bigint,\n  created_at      timestamptz not null default now()\n);\ncreate unique index if not e\
xists conv_msg_external_uq on conversation_messages (company_id, external_id) where external_id is not null;\ncreate index if not exists conv_msg_conv_idx on conversation_messages (\
conversation_id, id);\n\n-- Reservas (pedidas pelo agente ou registradas pela equipe)\ncreate table if not exists reservations (\n  id           bigserial primary key,\n  company_id   b\
igint not null references companies(id),\n  unit_id      bigint not null,\n  customer_name text not null,\n  phone        text,\n  customer_id  bigint,\n  people       int not null chec\
k (people between 1 and 100),\n  starts_at    timestamptz not null,\n  table_id     bigint,\n  status       text not null default 'confirmada' check (status in ('pendente','confirmada\
','cancelada','chegou','nao_compareceu')),\n  source       text not null default 'equipe' check (source in ('equipe','agente','site')),\n  notes        text,\n  created_at   timestamp\
tz not null default now()\n);\ncreate index if not exists reservations_day_idx on reservations (company_id, starts_at);\n\n-- Demonstra\xE7\xE3o: limpeza tamb\xE9m dos m\xF3dulos novos\ncreate or r\
eplace function purge_demo_company(p_company bigint) returns void language plpgsql as $$\nbegin\n  if not exists (select 1 from companies where id = p_company and is_demo) then\n    r\
aise exception 'empresa % n\xE3o \xE9 de demonstra\xE7\xE3o', p_company;\n  end if;\n  perform set_config('rusten.purge_demo', p_company::text, true);\n  delete from conversation_messages where c\
ompany_id = p_company;\n  delete from conversations where company_id = p_company;\n  delete from company_secrets where company_id = p_company;\n  delete from reservations where compan\
y_id = p_company;\n  delete from campaign_recipients where company_id = p_company;\n  delete from campaigns where company_id = p_company;\n  delete from delivery_events where company_\
id = p_company;\n  delete from delivery_orders where company_id = p_company;\n  delete from inventory_counts where company_id = p_company;\n  delete from purchase_lines where company_\
id = p_company;\n  delete from purchases where company_id = p_company;\n  delete from stock_movements where company_id = p_company and reverses_id is not null;\n  delete from stock_mo\
vements where company_id = p_company;\n  delete from recipe_lines where company_id = p_company;\n  delete from recipes where company_id = p_company;\n  update modifier_options set sto\
ck_item_id = null where company_id = p_company;\n  update products set stock_mode = 'nenhum', stock_item_id = null where company_id = p_company;\n  delete from stock_items where comp\
any_id = p_company;\n  delete from kitchen_events where company_id = p_company;\n  delete from reviews where company_id = p_company;\n  delete from loyalty_ledger where company_id = p\
_company and reverses_id is not null;\n  delete from loyalty_ledger where company_id = p_company;\n  delete from payments where company_id = p_company;\n  delete from cash_movements w\
here company_id = p_company;\n  delete from cash_sessions where company_id = p_company;\n  delete from order_items where company_id = p_company;\n  delete from consumption_sessions wh\
ere company_id = p_company;\n  delete from customers where company_id = p_company;\n  delete from manager_authorizations where company_id = p_company;\n  delete from scan_codes where \
company_id = p_company;\n  delete from tab_cards where company_id = p_company;\n  delete from dining_tables where company_id = p_company;\n  delete from modifier_options where company\
_id = p_company;\n  delete from modifier_groups where company_id = p_company;\n  delete from product_price_history where company_id = p_company;\n  delete from products where company_\
id = p_company;\n  delete from categories where company_id = p_company;\n  delete from production_sectors where company_id = p_company;\n  delete from user_sessions where user_id in (\
select id from users where company_id = p_company);\n  delete from users where company_id = p_company;\n  delete from terminals where company_id = p_company;\n  delete from roles wher\
e company_id = p_company;\n  delete from units where company_id = p_company;\n  delete from platform_outbox where company_id = p_company;\n  delete from audit_events where company_id \
= p_company;\n  delete from companies where id = p_company;\n  perform set_config('rusten.purge_demo', '', true);\nend $$;\nrevoke all on function purge_demo_company(bigint) from publi\
c;\n"
      },
      {
        "name": "004_leitura_notas.sql",
        "sql": "-- RUSTEN \u2014 004: leitura de notas e pedidos de compra (foto ou XML da NF-e) para lan\xE7ar no estoque.\n-- Rollback: migrations/rollback/004_leitura_notas.down.sql\n\n-- \
Como cada fornecedor escreve o insumo na nota \u2192 insumo do estoque (aprendido a cada confirma\xE7\xE3o)\ncreate table if not exists stock_aliases (\n  company_id    bigint not null referenc\
es companies(id),\n  alias         text not null,\n  stock_item_id bigint not null,\n  factor        numeric(14,4) not null default 1 check (factor > 0),\n  updated_at    timestamptz n\
ot null default now(),\n  primary key (company_id, alias),\n  foreign key (company_id, stock_item_id) references stock_items(company_id, id) on delete cascade\n);\n\n-- Origem da compra\
 (lan\xE7ada \xE0 m\xE3o, por foto ou por XML) e chave da NF-e para n\xE3o lan\xE7ar a mesma nota duas vezes\nalter table purchases add column if not exists source text not null default 'manual' c\
heck (source in ('manual','foto','xml'));\nalter table purchases add column if not exists nfe_key text;\ncreate unique index if not exists purchases_nfe_key_uq on purchases (company_\
id, nfe_key) where nfe_key is not null and status <> 'cancelada';\n"
      },
      {
        "name": "005_correcao_estoque.sql",
        "sql": "-- RUSTEN \u2014 005: corre\xE7\xE3o de estoque com trilha de auditoria (motivo, justificativa, valor, aprova\xE7\xE3o por outra pessoa).\n-- Rollback: migrations/rollback/005_correc\
ao_estoque.down.sql\n\n-- novo tipo de movimento: corre\xE7\xE3o aprovada (nunca edita movimentos anteriores)\nalter table stock_movements drop constraint if exists stock_movements_kind_che\
ck;\nalter table stock_movements add constraint stock_movements_kind_check\n  check (kind in ('entrada','venda','estorno_venda','perda','ajuste','inventario','producao_consumo','prod\
ucao_entrada','reversao','correcao'));\n\ncreate table if not exists stock_corrections (\n  id               bigserial primary key,\n  company_id       bigint not null references compa\
nies(id),\n  stock_item_id    bigint not null,\n  system_qty       numeric(14,4) not null,          -- saldo do sistema no pedido\n  counted_qty      numeric(14,4) not null check (cou\
nted_qty >= 0), -- saldo real informado\n  diff_qty         numeric(14,4) not null,          -- counted - system\n  unit_cost_cents  numeric(16,4) not null default 0,\n  value_cents  \
    bigint not null,                 -- impacto financeiro (diferen\xE7a \xD7 custo m\xE9dio)\n  reason_code      text not null check (reason_code in ('contagem','quebra','vencimento','erro_\
lancamento','consumo_interno','furto_desvio','devolucao','outro')),\n  justification    text not null check (length(justification) >= 15),\n  evidence         text,\n  status         \
  text not null default 'pendente' check (status in ('pendente','aplicada','rejeitada','expirada')),\n  needs_approval   boolean not null,\n  approval_rule    text,                  \
          -- por que precisou de aprova\xE7\xE3o (limite, %, motivo, perfil)\n  requested_by     bigint not null,\n  requested_ip     text,\n  decided_by       bigint,\n  decided_at       ti\
mestamptz,\n  decision_note    text,\n  self_approved    boolean not null default false,  -- aprovado pelo pr\xF3prio solicitante (s\xF3 sem outro aprovador na empresa)\n  movement_id      \
bigint,\n  created_at       timestamptz not null default now(),\n  foreign key (company_id, stock_item_id) references stock_items(company_id, id) on delete cascade\n);\ncreate index if\
 not exists stock_corr_company_idx on stock_corrections (company_id, created_at desc);\ncreate index if not exists stock_corr_item_idx on stock_corrections (company_id, stock_item_i\
d, created_at desc);\n-- uma corre\xE7\xE3o pendente por insumo (evita pedidos duplicados e conflitantes)\ncreate unique index if not exists stock_corr_pending_uq on stock_corrections (com\
pany_id, stock_item_id) where status = 'pendente';\n\n-- registro decidido n\xE3o muda mais; nada \xE9 apagado (exceto na remo\xE7\xE3o da demonstra\xE7\xE3o)\ncreate or replace function stock_corr_gua\
rd() returns trigger language plpgsql as $$\nbegin\n  if current_setting('rusten.purge_demo', true) = old.company_id::text then\n    return case when tg_op = 'DELETE' then old else ne\
w end;\n  end if;\n  if tg_op = 'DELETE' then raise exception 'corre\xE7\xF5es de estoque n\xE3o podem ser apagadas'; end if;\n  if old.status <> 'pendente' then raise exception 'corre\xE7\xE3o j\xE1 d\
ecidida n\xE3o pode ser alterada'; end if;\n  if new.stock_item_id <> old.stock_item_id or new.counted_qty <> old.counted_qty or new.system_qty <> old.system_qty\n     or new.diff_qty <\
> old.diff_qty or new.value_cents <> old.value_cents or new.reason_code <> old.reason_code\n     or new.justification <> old.justification or new.requested_by <> old.requested_by or\
 new.created_at <> old.created_at then\n    raise exception 'os dados do pedido de corre\xE7\xE3o n\xE3o podem ser alterados';\n  end if;\n  return new;\nend $$;\ndrop trigger if exists stock_co\
rr_guard on stock_corrections;\ncreate trigger stock_corr_guard before update or delete on stock_corrections for each row execute function stock_corr_guard();\n"
      },
      {
        "name": "006_conta_cliente.sql",
        "sql": `-- RUSTEN \u2014 006: conta do cliente (cr\xE9dito antecipado e fiado) vinculada ao CPF, integrada ao recebimento da comanda.
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
`
      },
      {
        "name": "007_redefinir_senha.sql",
        "sql": '-- RUSTEN \u2014 007: "Esqueci minha senha" com link de uso \xFAnico enviado pela central (remetente da plataforma).\n-- Rollback: migrations/rollback/007_redefinir_senha.do\
wn.sql\ncreate table if not exists password_resets (\n  id          bigserial primary key,\n  user_id     bigint not null references users(id) on delete cascade,\n  token_hash  text no\
t null unique,\n  expires_at  timestamptz not null,\n  used_at     timestamptz,\n  ip          text,\n  created_at  timestamptz not null default now()\n);\ncreate index if not exists pas\
sword_resets_user_idx on password_resets (user_id, created_at desc);\n'
      },
      {
        "name": "008_infinitepay.sql",
        "sql": "-- RUSTEN \u2014 008: integra\xE7\xE3o com a InfinitePay (Checkout Integrado: link Pix/cart\xE3o, confirma\xE7\xE3o por webhook e consulta).\n-- Rollback: migrations/rollback/008_infini\
tepay.down.sql\ncreate table if not exists infinitepay_charges (\n  id               bigserial primary key,\n  company_id       bigint not null references companies(id),\n  session_id \
      bigint,\n  cash_session_id  bigint,\n  order_nsu        text not null unique,          -- identificador do RUSTEN enviado \xE0 InfinitePay\n  token            text not null unique,\
          -- segredo do retorno/webhook desta cobran\xE7a\n  amount_cents     bigint not null check (amount_cents > 0),\n  description      text not null,\n  link_url         text,\n  sta\
tus           text not null default 'pendente' check (status in ('pendente','pago','cancelado','divergente','erro')),\n  capture_method   text,                          -- pix | cre\
dit_card\n  installments     int,\n  paid_amount_cents bigint,                       -- valor pago pelo cliente (inclui juros do parcelamento, se houver)\n  transaction_nsu  text,\n  i\
nvoice_slug     text,\n  receipt_url      text,\n  payment_id       bigint,\n  confirmed_by     text check (confirmed_by in ('webhook','retorno','consulta')),\n  note             text,\
\n  created_by       bigint,\n  created_at       timestamptz not null default now(),\n  paid_at          timestamptz,\n  canceled_at      timestamptz\n);\ncreate index if not exists infi\
nitepay_charges_company_idx on infinitepay_charges (company_id, created_at desc);\ncreate index if not exists infinitepay_charges_session_idx on infinitepay_charges (session_id) whe\
re session_id is not null;\n\n-- tudo o que chega da InfinitePay fica registrado (confer\xEAncia e auditoria)\ncreate table if not exists infinitepay_events (\n  id          bigserial pri\
mary key,\n  company_id  bigint not null,\n  charge_id   bigint references infinitepay_charges(id) on delete cascade,\n  kind        text not null,                      -- link_criado\
 | webhook | retorno | consulta | erro\n  ok          boolean not null default true,\n  payload     jsonb not null default '{}'::jsonb,\n  created_at  timestamptz not null default now\
()\n);\ncreate index if not exists infinitepay_events_charge_idx on infinitepay_events (charge_id, id);\n\n-- remo\xE7\xE3o da demonstra\xE7\xE3o\ncreate or replace function purge_infinitepay() ret\
urns trigger language plpgsql as $$\nbegin\n  if current_setting('rusten.purge_demo', true) = old.id::text then\n    delete from infinitepay_events where company_id = old.id;\n    dele\
te from infinitepay_charges where company_id = old.id;\n  end if;\n  return old;\nend $$;\ndrop trigger if exists companies_purge_infinitepay on companies;\ncreate trigger companies_pur\
ge_infinitepay before delete on companies for each row execute function purge_infinitepay();\n"
      },
      {
        "name": "009_vendas_maquininha.sql",
        "sql": "-- RUSTEN \u2014 009: vendas feitas direto na maquininha (fora do RUSTEN), importadas do relat\xF3rio da InfinitePay.\n-- Cada importa\xE7\xE3o guarda o resumo do per\xEDodo, os valo\
res por dia e por forma; cancelar n\xE3o apaga (fica no hist\xF3rico).\n-- Rollback: migrations/rollback/009_vendas_maquininha.down.sql\ncreate table if not exists pos_sales_imports (\n  id\
              bigserial primary key,\n  company_id      bigint not null references companies(id),\n  provider        text not null default 'infinitepay',\n  mode            text not n\
ull check (mode in ('externa','conferencia')), -- externa: soma ao faturamento; conferencia: s\xF3 compara\n  file_name       text not null,\n  file_sha256     text not null,\n  file_dat\
a       bytea,                                -- relat\xF3rio original (para confer\xEAncia)\n  account_label   text,\n  period_from     date not null,\n  period_to       date not null chec\
k (period_to >= period_from),\n  generated_on    date,\n  gross_cents     bigint not null check (gross_cents >= 0),\n  net_cents       bigint not null check (net_cents >= 0 and net_ce\
nts <= gross_cents),\n  fee_cents       bigint not null check (fee_cents >= 0),\n  tx_count        int not null check (tx_count >= 0),\n  methods         jsonb not null default '[]'::\
jsonb,   -- [{method, label, gross_cents}]\n  products        jsonb not null default '[]'::jsonb,   -- [{name, qty}] (ranking do relat\xF3rio; pode ser parcial)\n  categories      jsonb\
 not null default '[]'::jsonb,   -- [{name, qty}]\n  notes           jsonb not null default '[]'::jsonb,   -- observa\xE7\xF5es do pr\xF3prio relat\xF3rio\n  status          text not null defaul\
t 'ativo' check (status in ('ativo','cancelado')),\n  created_by      bigint,\n  created_at      timestamptz not null default now(),\n  canceled_by     bigint,\n  canceled_at     times\
tamptz,\n  cancel_reason   text\n);\n-- o mesmo arquivo n\xE3o entra duas vezes enquanto a importa\xE7\xE3o estiver ativa\ncreate unique index if not exists pos_sales_imports_file_uq on pos_sal\
es_imports (company_id, file_sha256) where status = 'ativo';\ncreate index if not exists pos_sales_imports_company_idx on pos_sales_imports (company_id, period_from desc);\n\ncreate t\
able if not exists pos_sales_days (\n  id          bigserial primary key,\n  company_id  bigint not null references companies(id),\n  import_id   bigint not null references pos_sales_\
imports(id),\n  provider    text not null,\n  day         date not null,\n  gross_cents bigint not null check (gross_cents >= 0),\n  net_cents   bigint not null check (net_cents >= 0),\
\n  tx_count    int not null check (tx_count >= 0),\n  active      boolean not null default true\n);\n-- um dia s\xF3 pode estar em uma importa\xE7\xE3o ativa (evita somar a mesma venda duas ve\
zes)\ncreate unique index if not exists pos_sales_days_uq on pos_sales_days (company_id, provider, day) where active;\ncreate index if not exists pos_sales_days_import_idx on pos_sal\
es_days (import_id);\n\n-- valores importados n\xE3o s\xE3o editados: s\xF3 cancelados (com motivo) e reimportados\ncreate or replace function pos_sales_imports_guard() returns trigger languag\
e plpgsql as $$\nbegin\n  if tg_op = 'DELETE' then\n    if current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;\n    raise exception 'Importa\xE7\xE3o d\
e vendas n\xE3o pode ser apagada; cancele-a';\n  end if;\n  if (new.gross_cents, new.net_cents, new.fee_cents, new.tx_count, new.period_from, new.period_to, new.mode, new.file_sha256, n\
ew.company_id)\n     is distinct from (old.gross_cents, old.net_cents, old.fee_cents, old.tx_count, old.period_from, old.period_to, old.mode, old.file_sha256, old.company_id) then\n \
   raise exception 'Valores importados n\xE3o podem ser alterados; cancele e importe de novo';\n  end if;\n  return new;\nend $$;\ncreate or replace function pos_sales_days_guard() return\
s trigger language plpgsql as $$\nbegin\n  if tg_op = 'DELETE' then\n    if current_setting('rusten.purge_demo', true) = old.company_id::text then return old; end if;\n    raise except\
ion 'Importa\xE7\xE3o de vendas n\xE3o pode ser apagada; cancele-a';\n  end if;\n  if (new.gross_cents, new.net_cents, new.tx_count, new.day, new.import_id, new.company_id) is distinct from (\
old.gross_cents, old.net_cents, old.tx_count, old.day, old.import_id, old.company_id) then\n    raise exception 'Valores importados n\xE3o podem ser alterados; cancele e importe de nov\
o';\n  end if;\n  if new.active and not old.active then raise exception 'Dia cancelado n\xE3o volta a valer; importe de novo'; end if;\n  return new;\nend $$;\ndrop trigger if exists pos_s\
ales_imports_guard on pos_sales_imports;\ncreate trigger pos_sales_imports_guard before update or delete on pos_sales_imports for each row execute function pos_sales_imports_guard()\
;\ndrop trigger if exists pos_sales_days_guard on pos_sales_days;\ncreate trigger pos_sales_days_guard before update or delete on pos_sales_days for each row execute function pos_sal\
es_days_guard();\n\n-- remo\xE7\xE3o da demonstra\xE7\xE3o\ncreate or replace function purge_pos_sales() returns trigger language plpgsql as $$\nbegin\n  if current_setting('rusten.purge_demo', tru\
e) = old.id::text then\n    delete from pos_sales_days where company_id = old.id;\n    delete from pos_sales_imports where company_id = old.id;\n  end if;\n  return old;\nend $$;\ndrop t\
rigger if exists companies_purge_pos_sales on companies;\ncreate trigger companies_purge_pos_sales before delete on companies for each row execute function purge_pos_sales();\n"
      },
      {
        "name": "010_maquininha_estoque.sql",
        "sql": `-- RUSTEN \u2014 010: produtos vendidos na maquininha \u2192 sa\xEDda no estoque.
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
`
      }
    ];
  }
});

// src/edge-env.js
globalThis.__RUSTEN_ENV_DEFAULTS__ = {
  EDGE_RUNTIME: "1",
  NODE_ENV: "production",
  DB_SCHEMA: "rusten",
  // tabelas do RUSTEN ficam no esquema próprio
  DB_POOL_MAX: "3",
  PATH_PREFIX: "/rusten-api",
  // a Supabase entrega o caminho com o nome da função
  // F06: só o site oficial (origem exata). Outros domínios: secret CORS_ORIGINS na Edge Function, separados por vírgula
  CORS_ORIGINS: "https://rusten.lorler.com.br,https://rusten.vercel.app"
};

// src/edge.js
import express2 from "npm:express@5.2.1";

// src/server.js
import express from "npm:express@5.2.1";
import helmet from "npm:helmet@8.3.0";
import cors from "npm:cors@2.8.6";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/lib/core.js
import pg from "npm:pg@8.23.1";
import crypto from "node:crypto";
import { Buffer as Buffer2 } from "node:buffer";

// src/lib/env.js
var defaults = globalThis.__RUSTEN_ENV_DEFAULTS__ || {};
var env = new Proxy({}, {
  get: (_t, key2) => {
    const v = typeof process !== "undefined" ? process.env[key2] : void 0;
    return v !== void 0 && v !== "" ? v : defaults[key2];
  }
});

// src/lib/core.js
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);
var isLocal = (url) => /localhost|127\.0\.0\.1|\/tmp/.test(url || "");
var dbUrl = env.DATABASE_URL || env.SUPABASE_DB_URL;
var pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: dbUrl && !isLocal(dbUrl) ? { rejectUnauthorized: false } : void 0,
  max: Number(env.DB_POOL_MAX || 10)
});
var schema = env.DB_SCHEMA;
if (schema) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("DB_SCHEMA inv\xE1lido");
  pool.on("connect", (client) => {
    client.query(`set search_path to ${schema}, public`).catch(() => {
    });
  });
}
var q = (text, params) => pool.query(text, params);
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {
    });
    throw e;
  } finally {
    client.release();
  }
}
var HttpError = class extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
};
var bad = (msg, code = "invalid") => new HttpError(400, msg, code);
var forbidden = (msg = "Sem permiss\xE3o para esta a\xE7\xE3o", code = "forbidden") => new HttpError(403, msg, code);
var notFound = (msg = "N\xE3o encontrado") => new HttpError(404, msg, "not_found");
var conflict = (msg, code = "conflict", extra) => new HttpError(409, msg, code, extra);
function parse(schema2, data) {
  const r = schema2.safeParse(data ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    throw bad(`${i.path.join(".") || "dados"}: ${i.message}`);
  }
  return r.data;
}
var h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function lineTotal(unitCents, qty, modifiersCents = 0, discountCents = 0) {
  const qtyMilli = Math.round(Number(qty) * 1e3);
  const gross = Math.round((unitCents + modifiersCents) * qtyMilli / 1e3);
  return Math.max(0, gross - discountCents);
}
function splitCents(total, parts) {
  const base2 = Math.floor(total / parts);
  const rest = total - base2 * parts;
  return Array.from({ length: parts }, (_, i) => base2 + (i < rest ? 1 : 0));
}
function businessDate(date, timezone = "America/Sao_Paulo", cutoffHour = 5) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  let d = new Date(Date.UTC(+get("year"), +get("month") - 1, +get("day")));
  if (+get("hour") < cutoffHour) d = new Date(d.getTime() - 864e5);
  return d.toISOString().slice(0, 10);
}
var sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
var randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
function safeEqual(a, b) {
  const x = Buffer2.from(String(a));
  const y = Buffer2.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// src/lib/auth.js
import crypto3 from "node:crypto";
import { Buffer as Buffer4 } from "node:buffer";
import jwt from "npm:jsonwebtoken@9.0.3";

// src/lib/catalog.js
var PERMISSIONS = {
  "pdv.lancar": "Lan\xE7ar itens",
  "pdv.lancamento_manual": "Lan\xE7amento manual (busca, cat\xE1logo, c\xF3digo digitado)",
  "pdv.alterar_modo": "Trocar modo de leitura no PDV",
  "pdv.excecao_dupla_leitura": "Exce\xE7\xE3o manual na dupla leitura obrigat\xF3ria",
  "pdv.autorizar": "Autorizar opera\xE7\xF5es de outros usu\xE1rios (gerente)",
  "pdv.abrir_comanda": "Abrir comanda/mesa/balc\xE3o",
  "pdv.alterar_quantidade": "Alterar quantidade na leitura",
  "pdv.alterar_preco": "Alterar pre\xE7o do item",
  "pdv.desconto": "Conceder desconto",
  "pdv.cancelar_item": "Cancelar item",
  "pdv.cancelar_venda": "Cancelar consumo inteiro",
  "pdv.transferir_item": "Transferir itens e consumos",
  "pdv.reabrir_comanda": "Reabrir consumo encerrado",
  "pdv.receber": "Receber pagamentos",
  "pdv.taxa_servico": "Ajustar/remover taxa de servi\xE7o",
  "caixa.abrir": "Abrir caixa",
  "caixa.fechar": "Fechar caixa",
  "caixa.sangria": "Sangria e despesa de caixa",
  "caixa.suprimento": "Suprimento",
  "caixa.reabrir": "Reabrir caixa",
  "financeiro.visualizar": "Ver dados financeiros",
  "financeiro.estornar": "Estornar pagamentos",
  "salao.visualizar": "Ver sal\xE3o e mesas",
  "salao.gerenciar": "Cadastrar mesas e mudar situa\xE7\xE3o",
  "cardapio.visualizar": "Ver card\xE1pio",
  "cardapio.gerenciar": "Cadastrar produtos, pre\xE7os e c\xF3digos",
  "comandas.gerenciar": "Gerar, bloquear e substituir cart\xF5es de comanda",
  "estoque.ajustar": "Ajustar estoque",
  "relatorios.visualizar": "Ver relat\xF3rios",
  "relatorios.cmv": "Ver CMV e margem",
  "usuarios.gerenciar": "Gerenciar usu\xE1rios e perfis",
  "configuracoes.gerenciar": "Alterar configura\xE7\xF5es",
  "assinatura.gerenciar": "Gerenciar assinatura",
  "auditoria.visualizar": "Ver auditoria",
  "dados.pessoais": "Ver dados pessoais de clientes",
  "clientes.visualizar": "Ver clientes",
  "clientes.gerenciar": "Cadastrar e editar clientes, pontos e consentimentos",
  "cozinha.operar": "Operar a fila de produ\xE7\xE3o (KDS)",
  "delivery.gerenciar": "Gerenciar pedidos de delivery e retirada",
  "delivery.entregar": "Registrar sa\xEDda e entrega de pedidos",
  "estoque.visualizar": "Ver estoque e fichas t\xE9cnicas",
  "compras.gerenciar": "Registrar compras e recebimentos",
  "marketing.gerenciar": "Campanhas e avalia\xE7\xF5es",
  "agente.gerenciar": "Configurar o agente de atendimento",
  "agente.atender": "Atender conversas da caixa de entrada"
};
var ALL = Object.keys(PERMISSIONS);
var without = (...ex) => ALL.filter((p) => !ex.includes(p));
var DEFAULT_ROLES = [
  { key: "owner", name: "Propriet\xE1rio", level: 100, permissions: ALL },
  { key: "admin", name: "Administrador", level: 90, permissions: without("assinatura.gerenciar") },
  { key: "gerente", name: "Gerente", level: 70, permissions: without("assinatura.gerenciar", "usuarios.gerenciar", "configuracoes.gerenciar") },
  { key: "caixa", name: "Caixa", level: 40, permissions: [
    "pdv.lancar",
    "pdv.lancamento_manual",
    "pdv.abrir_comanda",
    "pdv.receber",
    "caixa.abrir",
    "caixa.fechar",
    "caixa.sangria",
    "caixa.suprimento",
    "salao.visualizar",
    "cardapio.visualizar",
    "clientes.visualizar",
    "clientes.gerenciar"
  ] },
  { key: "garcom", name: "Gar\xE7om", level: 30, permissions: [
    "pdv.lancar",
    "pdv.lancamento_manual",
    "pdv.abrir_comanda",
    "salao.visualizar",
    "cardapio.visualizar",
    "clientes.visualizar",
    "clientes.gerenciar"
  ] },
  { key: "cozinha", name: "Cozinha", level: 20, permissions: ["cardapio.visualizar", "cozinha.operar"] },
  { key: "bar", name: "Bar", level: 20, permissions: ["cardapio.visualizar", "pdv.lancar", "cozinha.operar"] },
  { key: "estoque", name: "Estoque", level: 30, permissions: ["estoque.ajustar", "estoque.visualizar", "compras.gerenciar", "cardapio.visualizar", "relatorios.cmv"] },
  { key: "financeiro", name: "Financeiro", level: 50, permissions: [
    "financeiro.visualizar",
    "financeiro.estornar",
    "relatorios.visualizar",
    "relatorios.cmv",
    "caixa.reabrir",
    "auditoria.visualizar",
    "estoque.visualizar",
    "clientes.visualizar"
  ] },
  { key: "entregador", name: "Entregador", level: 10, permissions: ["delivery.entregar"] },
  { key: "consulta", name: "Consulta", level: 5, permissions: ["salao.visualizar", "cardapio.visualizar", "relatorios.visualizar"] }
];
var MODULES = {
  pdv: "PDV e comandas",
  salao: "Sal\xE3o, mesas e reservas",
  cozinha: "Cozinha, bar e KDS",
  delivery: "Delivery e card\xE1pio digital",
  cardapio: "Card\xE1pio",
  estoque: "Estoque, compras e fichas t\xE9cnicas",
  clientes: "Clientes e fidelidade",
  financeiro: "Caixa e financeiro",
  relatorios: "Relat\xF3rios",
  marketing: "Marketing",
  agente: "Agente WhatsApp",
  fiscal: "Fiscal",
  infinitepay: "Importa\xE7\xE3o e concilia\xE7\xE3o InfinitePay"
};
var DEFAULT_PDV = {
  scanner_enabled: true,
  mode: "manual",
  // manual | continua | dupla
  double_read_mandatory: false,
  // política: exige dupla leitura; só exceção autorizada sai dela
  allow_manual: true,
  allow_manual_exception: true,
  exception_requires_manager: true,
  allow_mode_change: true,
  product_timeout_s: 15,
  open_free_card_on_scan: false,
  feedback_sound: true,
  qty_per_scan: 1,
  max_qty_per_scan: 20,
  terminator: "Enter",
  kitchen_send: "imediato",
  // imediato | lote
  require_open_cash: true,
  service_fee_bp: 1e3,
  card_prefix: "CMD-"
};

// src/lib/platform.js
import crypto2 from "node:crypto";
import { Buffer as Buffer3 } from "node:buffer";
var PRODUCT_CODE = "rusten";
var CONTRACT_VERSION = 1;
var RUSTEN_VERSION = "2026.10";
var SKEW_S = 300;
var FRESH_MS = 5 * 60 * 1e3;
var hubDownUntil = 0;
var cfgCache = { at: 0, v: null };
async function platformConfig() {
  if (Date.now() - cfgCache.at < 6e4) return cfgCache.v;
  let hub = env.PLATFORM_HUB_URL || "";
  let secret = env.PLATFORM_SECRET || "";
  let product = env.PLATFORM_PRODUCT || "";
  if (!hub || !secret) {
    try {
      const { rows } = await q(`select key, value from platform_config where key in ('platform_hub_url','platform_secret','platform_product')`);
      const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      hub ||= m.platform_hub_url || "";
      secret ||= m.platform_secret || "";
      product ||= m.platform_product || "";
    } catch {
    }
  }
  const v = hub && secret ? { hub: hub.replace(/\/+$/, ""), secret, product: product || PRODUCT_CODE } : null;
  cfgCache = { at: Date.now(), v };
  return v;
}
var signPayload = (secret, ts, method, route, body) => crypto2.createHmac("sha256", secret).update(`${ts}
${String(method).toUpperCase()}
${route}
${sha256(body || "")}`).digest("hex");
async function hubCall(method, route, payload, timeoutMs = 1e4) {
  const cfg = await platformConfig();
  if (!cfg) throw new HttpError(503, "A assinatura ainda n\xE3o est\xE1 configurada nesta instala\xE7\xE3o. Fale com o suporte.", "platform_not_configured");
  if (!/^https:\/\//.test(cfg.hub) && env.NODE_ENV === "production") throw new HttpError(503, "Endere\xE7o da central deve usar HTTPS", "platform_not_configured");
  const body = payload === void 0 ? "" : JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1e3);
  let res;
  try {
    res = await fetch(`${cfg.hub}/api/hub/v1${route}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        "X-Platform-Product": cfg.product,
        "X-Platform-Timestamp": String(ts),
        "X-Platform-Signature": signPayload(cfg.secret, ts, method, route, body)
      },
      body: body || void 0
    });
  } catch {
    throw new HttpError(503, "A central de assinaturas n\xE3o respondeu. Tente novamente em instantes.", "platform_unavailable");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 401 ? 502 : res.status, data?.error || `Central: erro ${res.status}`, data?.code || "hub_error");
  return data;
}
async function tenantPayload(companyId) {
  const { rows } = await q(
    `select c.id, c.name, c.email, c.phone, c.document, c.created_at, c.is_demo,
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
       from companies c where c.id = $1`,
    [companyId]
  );
  const c = rows[0];
  if (!c) return null;
  return {
    remote_id: String(c.id),
    name: c.name,
    email: c.owner_email || c.email,
    phone: c.phone,
    document: c.document,
    owner_name: c.owner_name,
    owner_email: c.owner_email,
    created_at: c.created_at,
    last_access_at: c.last_access_at,
    is_demo: c.is_demo,
    metrics: {
      users: c.users,
      units: c.units,
      terminals: c.terminals,
      tables: c.tables,
      consumptions_30d: c.consumptions_30d,
      revenue_30d: Number(c.revenue_30d_cents) / 100
    }
  };
}
async function storeAccess(companyId, access) {
  await q("update companies set access = $2, access_updated_at = now() where id = $1", [companyId, access || {}]);
}
async function registerCompany(companyId, timeoutMs = 1e4) {
  if (!await platformConfig()) return null;
  const t = await tenantPayload(companyId);
  if (!t || t.is_demo) return null;
  const { is_demo: _d, owner_email: _o, ...payload } = t;
  const out = await hubCall("POST", "/tenants", payload, timeoutMs);
  if (out?.access) await storeAccess(companyId, out.access);
  return out?.access || null;
}
async function refreshAccess(company2, { fresh = false } = {}) {
  if (!company2 || company2.is_demo) return null;
  const cfg = await platformConfig();
  if (!cfg) return null;
  const age = company2.access_updated_at ? Date.now() - new Date(company2.access_updated_at).getTime() : Infinity;
  const has2 = company2.access && Object.keys(company2.access).length;
  if (!fresh && has2 && age < FRESH_MS) return company2.access;
  if (!fresh && Date.now() < hubDownUntil) return has2 ? company2.access : null;
  try {
    const out = await hubCall("GET", `/tenants/${encodeURIComponent(company2.id)}/access`, void 0, 4e3);
    await storeAccess(company2.id, out.access);
    return out.access;
  } catch (e) {
    if (e.status === 404) {
      try {
        return await registerCompany(company2.id, 4e3);
      } catch {
      }
    } else hubDownUntil = Date.now() + 6e4;
    return has2 ? company2.access : null;
  }
}
async function enqueueHub(db, companyId, kind, payload = {}) {
  if (!await platformConfig()) return;
  await db.query("insert into platform_outbox (company_id, kind, payload) values ($1,$2,$3)", [companyId, kind, payload]);
}
async function flushOutbox(limit = 20) {
  if (!await platformConfig()) return { sent: 0, failed: 0 };
  const { rows } = await q("select * from platform_outbox where sent_at is null and attempts < 20 order by id limit $1", [limit]);
  let sent = 0;
  let failed = 0;
  for (const ev of rows) {
    try {
      if (ev.kind === "tenant.created" || ev.kind === "tenant.updated") await registerCompany(ev.company_id);
      await q("update platform_outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = $1", [ev.id]);
      sent++;
    } catch (e) {
      await q("update platform_outbox set attempts = attempts + 1, last_error = $2 where id = $1", [ev.id, String(e.message).slice(0, 300)]);
      failed++;
    }
  }
  return { sent, failed };
}
async function verifyHubRequest(req, _res, next) {
  try {
    const cfg = await platformConfig();
    const deny = () => new HttpError(401, "Chamada da central n\xE3o autenticada.", "bad_signature");
    if (!cfg) throw new HttpError(503, "Liga\xE7\xE3o com a central n\xE3o configurada.", "platform_not_configured");
    const ts = Number(req.headers["x-platform-timestamp"]);
    const sig = String(req.headers["x-platform-signature"] || "");
    if (String(req.headers["x-platform-product"] || "") !== cfg.product || !Number.isFinite(ts) || !/^[0-9a-f]{64}$/.test(sig)) throw deny();
    if (Math.abs(Date.now() / 1e3 - ts) > SKEW_S) throw deny();
    const want = signPayload(cfg.secret, ts, req.method, req.url, req.rawBody || "");
    if (!crypto2.timingSafeEqual(Buffer3.from(want), Buffer3.from(sig))) throw deny();
    const r = await q("insert into platform_nonces (nonce) values ($1) on conflict do nothing returning nonce", [sig]);
    if (!r.rows[0]) throw new HttpError(401, "Chamada repetida.", "replay");
    await q("delete from platform_nonces where created_at < now() - interval '1 day'");
    next();
  } catch (e) {
    next(e);
  }
}
var FEATURES = MODULES;

// src/lib/auth.js
var isProd = env.NODE_ENV === "production";
var rootSecret = env.JWT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || (isProd ? null : "dev-only-rusten-secret-not-for-production");
if (!rootSecret) throw new Error("JWT_SECRET \xE9 obrigat\xF3rio em produ\xE7\xE3o");
function secretProblem(s) {
  if (!s) return "ausente";
  if (["changeme", "secret", "jwt_secret", "dev-only-rusten-secret-not-for-production"].includes(s)) return "valor de exemplo";
  if (Buffer4.byteLength(s, "utf8") < 32) return "curta (m\xEDnimo de 32 bytes aleat\xF3rios)";
  if (new Set(s).size < 10) return "pouca varia\xE7\xE3o de caracteres";
  return null;
}
if (isProd && secretProblem(rootSecret)) throw new Error(`JWT_SECRET inseguro (${secretProblem(rootSecret)}) \u2014 o servidor n\xE3o inicia em produ\xE7\xE3o.`);
var deriveKey = (purpose) => Buffer4.from(crypto3.hkdfSync("sha256", rootSecret, "rusten", purpose, 32));
var accessKey = deriveKey("access-token");
var ACCESS_TTL_S = Number(env.ACCESS_TTL_S) || 15 * 60;
var REFRESH_TTL_DAYS = 30;
function signAccess(user, sessionId) {
  return jwt.sign({ sub: String(user.id), cid: String(user.company_id), sid: sessionId }, accessKey, {
    expiresIn: ACCESS_TTL_S,
    algorithm: "HS256"
  });
}
async function loadContext(userId, companyId) {
  const { rows } = await q(
    `select u.id, u.company_id, u.unit_id, u.name, u.email, u.role_key, u.active, u.password_changed_at,
            r.name as role_name, r.level, r.permissions,
            c.name as company_name, c.segment, c.timezone, c.settings, c.access, c.access_updated_at, c.is_demo
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
       join companies c on c.id = u.company_id
      where u.id = $1 and u.company_id = $2`,
    [userId, companyId]
  );
  return rows[0];
}
function auth() {
  return async (req, _res, next) => {
    try {
      const hdr = req.headers.authorization || "";
      const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
      if (!token) throw new HttpError(401, "Sess\xE3o expirada. Entre novamente.", "unauthenticated");
      let payload;
      try {
        payload = jwt.verify(token, accessKey, { algorithms: ["HS256"] });
      } catch {
        throw new HttpError(401, "Sess\xE3o expirada. Entre novamente.", "unauthenticated");
      }
      const u = await loadContext(Number(payload.sub), Number(payload.cid));
      if (!u || !u.active) throw new HttpError(401, "Usu\xE1rio inativo", "unauthenticated");
      const s = await q("select revoked_at from user_sessions where id = $1 and user_id = $2", [payload.sid, u.id]);
      if (!s.rows[0] || s.rows[0].revoked_at) throw new HttpError(401, "Sess\xE3o encerrada", "unauthenticated");
      if (payload.iat * 1e3 < new Date(u.password_changed_at).getTime() - 1e3)
        throw new HttpError(401, "Senha alterada. Entre novamente.", "unauthenticated");
      const raw = await refreshAccess({ id: u.company_id, is_demo: u.is_demo, access: u.access, access_updated_at: u.access_updated_at });
      const ctx = {
        userId: u.id,
        companyId: u.company_id,
        unitId: u.unit_id,
        name: u.name,
        email: u.email,
        role: u.role_key,
        roleName: u.role_name,
        level: u.level,
        perms: new Set(u.permissions),
        company: { id: u.company_id, name: u.company_name, segment: u.segment, timezone: u.timezone, settings: u.settings, is_demo: u.is_demo },
        access: u.is_demo ? computeAccess(null, null, { demo: true }) : computeAccess(raw ?? u.access, u.access_updated_at),
        sessionId: payload.sid,
        terminalId: null
      };
      const tid = Number(req.headers["x-terminal-id"]);
      if (tid) {
        const t = await q("select id, unit_id from terminals where id = $1 and company_id = $2 and active", [tid, ctx.companyId]);
        if (t.rows[0]) {
          ctx.terminalId = t.rows[0].id;
          ctx.terminalUnitId = t.rows[0].unit_id;
        }
      }
      ctx.can = (p) => ctx.perms.has(p);
      req.ctx = ctx;
      next();
    } catch (e) {
      next(e);
    }
  };
}
var need = (...perms) => (req, _res, next) => {
  const missing = perms.find((p) => !req.ctx.can(p));
  if (missing) return next(forbidden(`Sem permiss\xE3o: ${missing}`));
  next();
};
function assertCan(ctx, perm) {
  if (!ctx.can(perm)) throw forbidden(`Sem permiss\xE3o: ${perm}`);
}
async function audit(db, ctx, action, { entity, entityId, reason, data, unitId } = {}) {
  await db.query(
    `insert into audit_events (company_id, unit_id, terminal_id, user_id, action, entity, entity_id, reason, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      ctx.companyId,
      unitId ?? ctx.terminalUnitId ?? ctx.unitId ?? null,
      ctx.terminalId ?? null,
      ctx.userId ?? null,
      action,
      entity ?? null,
      entityId != null ? String(entityId) : null,
      reason ?? null,
      scrub(data ?? {})
    ]
  );
}
var SECRET_KEYS = /pass|senha|token|secret|segredo|hash|card_number|cvv/i;
function scrub(obj) {
  if (Array.isArray(obj)) return obj.map(scrub);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[omitido]" : scrub(v)]));
  }
  return obj;
}
var STATUS_LABEL = {
  ACTIVE: "Ativa",
  TRIAL: "Em teste",
  PAYMENT_PENDING: "Aguardando pagamento",
  PAST_DUE: "Pagamento pendente",
  SUSPENDED: "Suspensa",
  CANCELED: "Cancelada",
  EXPIRED: "Expirada"
};
var BLOCK_TEXT = {
  ADMINISTRATIVO: "O acesso desta empresa foi bloqueado pela administra\xE7\xE3o da plataforma. Fale com o suporte.",
  TRIAL_EXPIRADO: "O per\xEDodo de teste terminou. Contrate um plano para continuar operando \u2014 seus dados est\xE3o preservados.",
  CANCELAMENTO: "A assinatura foi encerrada. Contrate novamente para voltar a operar \u2014 seus dados est\xE3o preservados.",
  FINANCEIRO: "Acesso suspenso por pend\xEAncia financeira. Regularize a assinatura \u2014 seus dados est\xE3o preservados."
};
function computeAccess(access, updatedAt, { demo = false } = {}) {
  const a = access || {};
  const allModules = Object.keys(MODULES);
  if (demo) return { allowed: true, state: "DEMO", label: "Demonstra\xE7\xE3o", modules: allModules, warning: null, notices: [], managed: false, demo: true };
  if (!Object.keys(a).length || typeof a.blocked !== "boolean") {
    return { allowed: true, state: "sem_central", label: "Sem central", modules: allModules, warning: null, notices: [], managed: false };
  }
  const f = a.features && typeof a.features === "object" ? a.features : {};
  const known = allModules.filter((k) => k in f);
  const modules = known.length ? allModules.filter((k) => f[k] !== false) : allModules;
  const notices = Array.isArray(a.notices) ? a.notices.filter((n) => n && n.text).map((n) => ({ level: n.level === "danger" ? "danger" : "warn", text: String(n.text) })) : [];
  const byAdmin = !!a.admin_blocked || a.reason === "ADMINISTRATIVO";
  return {
    allowed: !a.blocked,
    state: a.status,
    label: STATUS_LABEL[a.status] || a.status,
    reasonCode: a.reason || null,
    reason: a.blocked ? BLOCK_TEXT[byAdmin ? "ADMINISTRATIVO" : a.reason] || BLOCK_TEXT.FINANCEIRO : null,
    adminBlocked: byAdmin,
    modules,
    notices,
    warning: notices[0]?.text || null,
    plan: a.plan?.name || null,
    planId: a.plan?.id || null,
    cycle: a.cycle || null,
    validUntil: a.valid_until || null,
    trial: a.trial || null,
    support: a.support || null,
    supportChannel: a.support_channel || null,
    managed: true,
    updatedAt
  };
}
var requireAccess = (module) => (req, _res, next) => {
  const acc = req.ctx.access;
  if (!acc.allowed) return next(new HttpError(402, acc.reason, "access_blocked", { state: acc.state }));
  if (module && !acc.modules.includes(module)) return next(forbidden("M\xF3dulo n\xE3o inclu\xEDdo no plano", "module_disabled"));
  next();
};
async function rateLimit(key2, max, windowS) {
  const { rows } = await q(
    `insert into rate_limits(key, count, reset_at) values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update set
       count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => $2) else rate_limits.reset_at end
     returning count`,
    [key2, windowS]
  );
  if (rows[0].count > max) throw new HttpError(429, "Muitas tentativas. Aguarde alguns minutos.", "rate_limited");
}

// src/migrate.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var dir = import.meta.url.startsWith("file:") ? path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations") : "migrations";
async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(424242)");
    await client.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
    const list = env.EDGE_RUNTIME ? (await Promise.resolve().then(() => (init_migrations_gen(), migrations_gen_exports))).MIGRATIONS : fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.
    test(f)).sort().map((name) => ({ name, sql: null }));
    for (const { name: f, sql: embedded } of list) {
      if (done.has(f)) continue;
      const sql = embedded ?? fs.readFileSync(path.join(dir, f), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations(name) values ($1)", [f]);
        await client.query("commit");
        log(`migra\xE7\xE3o aplicada: ${f}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`falha na migra\xE7\xE3o ${f}: ${e.message}`);
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(424242)").catch(() => {
    });
    client.release();
  }
}
if (!env.EDGE_RUNTIME && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

// src/routes/auth.js
import { Router } from "npm:express@5.2.1";
import bcrypt from "npm:bcryptjs@3.0.3";
import crypto4 from "node:crypto";
import { z } from "npm:zod@4.6.5";

// src/lib/pdv.js
var AND_KEYS = ["scanner_enabled", "allow_manual", "allow_manual_exception", "allow_mode_change", "open_free_card_on_scan"];
var OR_KEYS = ["double_read_mandatory", "exception_requires_manager", "require_open_cash"];
var MIN_KEYS = ["max_qty_per_scan"];
function mergePdv(company2 = {}, unit = {}, terminal = {}) {
  const layers = [DEFAULT_PDV, company2 || {}, unit || {}, terminal || {}];
  const out = { ...DEFAULT_PDV };
  for (const layer of layers.slice(1)) {
    for (const [k, v] of Object.entries(layer)) {
      if (!(k in DEFAULT_PDV) || v === void 0 || v === null) continue;
      if (AND_KEYS.includes(k)) out[k] = out[k] && !!v;
      else if (OR_KEYS.includes(k)) out[k] = out[k] || !!v;
      else if (MIN_KEYS.includes(k)) out[k] = Math.min(out[k], Number(v));
      else out[k] = v;
    }
  }
  if (out.double_read_mandatory) out.mode = "dupla";
  if (!out.scanner_enabled) out.mode = "manual";
  if (!out.scanner_enabled && !out.allow_manual) out.allow_manual = true;
  out.qty_per_scan = Math.min(Math.max(1, Number(out.qty_per_scan) || 1), out.max_qty_per_scan);
  return out;
}
function validatePdvLayer(layer) {
  if (layer.scanner_enabled === false && layer.allow_manual === false)
    throw bad("Configura\xE7\xE3o eliminaria todos os meios de lan\xE7amento: mantenha o leitor ou o lan\xE7amento manual.");
  if (layer.mode && !["manual", "continua", "dupla"].includes(layer.mode)) throw bad("Modo inv\xE1lido");
  if (layer.double_read_mandatory && layer.scanner_enabled === false)
    throw bad("Dupla leitura obrigat\xF3ria exige o leitor habilitado.");
  if (layer.product_timeout_s != null && (layer.product_timeout_s < 3 || layer.product_timeout_s > 120))
    throw bad("Tempo de espera do produto deve ficar entre 3 e 120 segundos");
}
async function pdvSettings(db, ctx, unitId) {
  const c = await db.query("select settings from companies where id = $1", [ctx.companyId]);
  const u = unitId ? await db.query("select settings from units where id = $1 and company_id = $2", [unitId, ctx.companyId]) : { rows: [] };
  const t = ctx.terminalId ? await db.query("select settings from terminals where id = $1", [ctx.terminalId]) : { rows: [] };
  return mergePdv(c.rows[0]?.settings?.pdv, u.rows[0]?.settings?.pdv, t.rows[0]?.settings?.pdv);
}
var normalizeCode = (raw) => String(raw ?? "").replace(/[\r\n\t]/g, "").trim();
async function resolveCode(db, companyId, raw) {
  const code = normalizeCode(raw);
  if (!code) return { type: "DESCONHECIDO", code };
  if (code.length > 128) return { type: "DESCONHECIDO", code: code.slice(0, 128) };
  const { rows } = await db.query(
    "select entity, entity_id from scan_codes where company_id = $1 and code = $2",
    [companyId, code]
  );
  if (!rows[0]) return { type: "DESCONHECIDO", code };
  const { entity, entity_id: id } = rows[0];
  if (entity === "PRODUTO") {
    const p = await db.query(
      `select p.id, p.name, p.price_cents, p.kind, p.unit, p.active,
              exists(select 1 from modifier_groups g where g.product_id = p.id) as has_options,
              exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as has_required
         from products p where p.id = $1 and p.company_id = $2`,
      [id, companyId]
    );
    if (!p.rows[0]) return { type: "DESCONHECIDO", code };
    return { type: "PRODUTO", code, product: p.rows[0] };
  }
  if (entity === "COMANDA") {
    const c = await db.query(
      `select c.id, c.number, c.unit_id, c.status, c.block_reason,
              (select s.id from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_id,
              (select s.status from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_status
         from tab_cards c where c.id = $1 and c.company_id = $2`,
      [id, companyId]
    );
    if (!c.rows[0]) return { type: "DESCONHECIDO", code };
    return { type: "COMANDA", code, card: c.rows[0] };
  }
  if (entity === "MESA") {
    const t = await db.query("select id, number, unit_id, status, area from dining_tables where id = $1 and company_id = $2", [id, companyId]);
    if (!t.rows[0]) return { type: "DESCONHECIDO", code };
    return { type: "MESA", code, table: t.rows[0] };
  }
  return { type: entity, code, id };
}
async function registerCode(db, companyId, code, entity, entityId) {
  const c = normalizeCode(code);
  if (!c) throw bad("C\xF3digo vazio");
  if (c.length > 128) throw bad("C\xF3digo muito longo");
  const ex = await db.query("select entity, entity_id from scan_codes where company_id = $1 and code = $2", [companyId, c]);
  if (ex.rows[0]) {
    if (ex.rows[0].entity === entity && Number(ex.rows[0].entity_id) === Number(entityId)) return;
    throw conflict(`C\xF3digo ${c} j\xE1 est\xE1 em uso (${ex.rows[0].entity.toLowerCase()} ${ex.rows[0].entity_id}). Cadastros amb\xEDguos n\xE3o s\xE3o permitidos.`, "code_in_use");
  }
  await db.query("insert into scan_codes (company_id, code, entity, entity_id) values ($1,$2,$3,$4)", [companyId, c, entity, entityId]);
}
var cardCode = (prefix, unitIdx, number) => `${prefix}${unitIdx > 1 ? `${unitIdx}-` : ""}${String(number).padStart(6, "0")}`;
async function lockSession(db, companyId, sessionId) {
  const { rows } = await db.query(
    "select * from consumption_sessions where id = $1 and company_id = $2 for update",
    [sessionId, companyId]
  );
  if (!rows[0]) throw notFound("Consumo n\xE3o encontrado");
  return rows[0];
}
function assertOpen(session) {
  if (session.status !== "aberta") {
    const map = { em_fechamento: "em fechamento", encerrada: "encerrada", cancelada: "cancelada" };
    throw conflict(`Consumo ${map[session.status] || session.status}: n\xE3o aceita lan\xE7amentos`, "session_not_open");
  }
}
function assertUnitScope(ctx, unitId) {
  if (ctx.unitId && Number(ctx.unitId) !== Number(unitId) && ctx.level < 90)
    throw forbidden("Registro de outra unidade");
}
async function sessionTotals(db, sessionId) {
  const s = await db.query("select service_fee_bp, delivery_fee_cents from consumption_sessions where id = $1", [sessionId]);
  const it = await db.query(
    `select coalesce(sum(total_cents) filter (where status = 'ativo'), 0)::bigint as items from order_items where session_id = $1`,
    [sessionId]
  );
  const pay = await db.query(
    `select coalesce(sum(amount_cents) filter (where status = 'confirmado'), 0)::bigint as paid from payments where session_id = $1`,
    [sessionId]
  );
  const items = Number(it.rows[0].items);
  const serviceFee = Math.round(items * (s.rows[0]?.service_fee_bp || 0) / 1e4);
  const deliveryFee = Number(s.rows[0]?.delivery_fee_cents || 0);
  const total = items + serviceFee + deliveryFee;
  const paid = Number(pay.rows[0].paid);
  return { items, serviceFee, serviceFeeBp: s.rows[0]?.service_fee_bp || 0, deliveryFee, total, paid, balance: total - paid };
}

// src/lib/seed.js
async function seedCompany(db, companyId, setup = {}) {
  const u = await db.query(
    "insert into units (company_id, name, day_cutoff) values ($1,$2,$3) returning id",
    [companyId, setup.unit_name || "Matriz", setup.day_cutoff ?? 5]
  );
  const unitId = u.rows[0].id;
  await db.query("insert into terminals (company_id, unit_id, name) values ($1,$2,$3)", [companyId, unitId, "Caixa 1"]);
  const sectors = {};
  for (const name of ["Cozinha", "Bar", "Copa"]) {
    const s = await db.query("insert into production_sectors (company_id, name) values ($1,$2) returning id", [companyId, name]);
    sectors[name] = s.rows[0].id;
  }
  await createTables(db, companyId, unitId, 1, setup.tables ?? 10);
  await createCards(db, companyId, unitId, 1, setup.cards ?? 50);
  if (setup.demo) await seedDemo(db, companyId, sectors);
  return { unitId, sectors };
}
async function createTables(db, companyId, unitId, from, count) {
  const created = [];
  for (let n = from; n < from + count; n++) {
    const t = await db.query(
      `insert into dining_tables (company_id, unit_id, number, pos_x, pos_y) values ($1,$2,$3,$4,$5)
       on conflict do nothing returning id`,
      [companyId, unitId, n, (n - 1) % 6, Math.floor((n - 1) / 6)]
    );
    if (t.rows[0]) {
      await registerCode(db, companyId, `MESA-${String(unitId).padStart(2, "0")}-${String(n).padStart(3, "0")}`, "MESA", t.rows[0].id);
      created.push(t.rows[0].id);
    }
  }
  return created;
}
async function createCards(db, companyId, unitId, from, count, prefix = "CMD-") {
  const idx = (await db.query("select count(*)::int as n from units where company_id = $1 and id <= $2", [companyId, unitId])).rows[0].n;
  const created = [];
  for (let n = from; n < from + count; n++) {
    const c = await db.query(
      "insert into tab_cards (company_id, unit_id, number) values ($1,$2,$3) on conflict do nothing returning id, number",
      [companyId, unitId, n]
    );
    if (c.rows[0]) {
      const code = cardCode(prefix, idx, n);
      await registerCode(db, companyId, code, "COMANDA", c.rows[0].id);
      created.push({ ...c.rows[0], code });
    }
  }
  return created;
}
var DEMO = [
  ["Cervejas", "Bar", [["Cerveja IPA 600 ml", 2890, "7890000000011"], ["Pilsen long neck", 1290, "7890000000028"], ["Chope 300 ml", 1190, null]]],
  ["Drinks", "Bar", [["Caipirinha", 2400, null], ["Gin t\xF4nica", 3200, null]]],
  ["Lanches", "Cozinha", [["Hamb\xFArguer da oficina", 3890, null], ["Por\xE7\xE3o de fritas", 2690, null]]],
  ["Sem \xE1lcool", "Bar", [["Refrigerante lata", 700, "7890000000035"], ["\xC1gua mineral", 500, "7890000000042"]]]
];
async function seedDemo(db, companyId, sectors) {
  let sort = 0;
  for (const [cat, sector, items] of DEMO) {
    const c = await db.query("insert into categories (company_id, name, sort, demo) values ($1,$2,$3,true) returning id", [companyId, `${cat} (demonstra\xE7\xE3o)`, sort++]);
    for (const [name, price, ean] of items) {
      const p = await db.query(
        `insert into products (company_id, category_id, sector_id, name, price_cents, kind, demo, favorite, channels)
         values ($1,$2,$3,$4,$5,$6,true,$7,'{pdv,delivery,cardapio_digital}') returning id`,
        [companyId, c.rows[0].id, sectors[sector], name, price, sector === "Cozinha" ? "recipe" : "resale", sort === 1]
      );
      if (ean) await registerCode(db, companyId, ean, "PRODUTO", p.rows[0].id);
      if (name.startsWith("Hamb\xFArguer")) {
        const g = await db.query(`insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Ponto da carne',1,1) returning id`, [companyId, p.
        rows[0].id]);
        for (const o of ["Mal passado", "Ao ponto", "Bem passado"])
          await db.query("insert into modifier_options (company_id, group_id, name) values ($1,$2,$3)", [companyId, g.rows[0].id, o]);
        const g2 = await db.query(`insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Adicionais',0,3) returning id`, [companyId, p.rows[0].
        id]);
        for (const [o, v] of [["Bacon", 600], ["Queijo extra", 400], ["Ovo", 300]])
          await db.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)", [companyId, g2.rows[0].id, o, v]);
      }
    }
  }
}
async function seedDemoActivity(db, companyId, unitId, userId, businessDate2) {
  const prod = Object.fromEntries((await db.query("select id, name, price_cents, sector_id from products where company_id = $1", [companyId])).rows.map((p) => [p.name, p]));
  const table = (await db.query("select id from dining_tables where company_id = $1 and number = 3", [companyId])).rows[0];
  const cards = (await db.query("select id from tab_cards where company_id = $1 order by number limit 3", [companyId])).rows;
  let seq = 0;
  let age = 4;
  const kitchenAge = () => {
    age = age === 4 ? 9 : age === 9 ? 18 : 4;
    return age;
  };
  async function open(kind, { tableId = null, cardId = null, label = null }, items, status = "aberta") {
    const s = (await db.query(
      `insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, label, status, service_fee_bp, opened_by, business_date,
                                         opened_at, closed_at, closed_by)
       values ($1,$2,$3,$4,$5,$6,$7,1000,$8,$9, now() - interval '90 minutes', case when $7 = 'encerrada' then now() - interval '20 minutes' end,
               case when $7 = 'encerrada' then $8::bigint end) returning id`,
      [companyId, unitId, kind, cardId, tableId, label, status, userId, businessDate2]
    )).rows[0].id;
    let total = 0;
    for (const [name, qty, ks] of items) {
      const p = prod[name];
      if (!p) continue;
      const t = p.price_cents * qty;
      total += t;
      await db.query(
        `insert into order_items (company_id, session_id, product_id, description, qty, unit_price_cents, total_cents, sector_id,
                                  kitchen_status, launch_mode, user_id, idempotency_key, created_at, sent_at, accepted_at, ready_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11, now() - interval '${kitchenAge()} minutes',
                 case when $9 <> 'nao_produz' then now() - interval '${kitchenAge()} minutes' end,
                 case when $9 in ('aceito','preparando','pronto','entregue') then now() - interval '8 minutes' end,
                 case when $9 in ('pronto','entregue') then now() - interval '3 minutes' end)`,
        [companyId, s, p.id, p.name, qty, p.price_cents, t, p.sector_id, ks, userId, `demo-${s}-${++seq}`]
      );
    }
    return { id: s, total };
  }
  if (table) {
    await open(
      "mesa",
      { tableId: table.id, label: "Mesa 3" },
      [["Hamb\xFArguer da oficina", 2, "preparando"], ["Por\xE7\xE3o de fritas", 1, "pronto"], ["Chope 300 ml", 4, "entregue"]]
    );
    await db.query("update dining_tables set status = 'ocupada' where id = $1", [table.id]);
  }
  if (cards[0]) await open("comanda", { cardId: cards[0].id }, [["Cerveja IPA 600 ml", 2, "nao_produz"], ["Caipirinha", 1, "novo"]]);
  if (cards[1]) await open("comanda", { cardId: cards[1].id }, [["Gin t\xF4nica", 2, "entregue"], ["\xC1gua mineral", 1, "nao_produz"]]);
  const closed = await open("balcao", { label: "Balc\xE3o" }, [["Pilsen long neck", 3, "nao_produz"], ["Por\xE7\xE3o de fritas", 1, "entregue"]], "encerrada");
  const withFee = closed.total + Math.round(closed.total * 0.1);
  await db.query(
    `insert into payments (company_id, session_id, method, amount_cents, business_date, idempotency_key, user_id, created_at)
     values ($1,$2,'pix',$3,$4,$5,$6, now() - interval '20 minutes')`,
    [companyId, closed.id, withFee, businessDate2, `demo-pay-${closed.id}`, userId]
  );
  await seedDemoModules(db, companyId, unitId, userId, closed.id);
}
async function seedDemoModules(db, companyId, unitId, userId, closedId) {
  const settings = {
    loyalty: { enabled: true, cents_per_point: 100, point_value_cents: 5, validity_days: 365, min_redeem: 100 },
    delivery: {
      enabled: true,
      accepting: true,
      delivery: true,
      pickup: true,
      fee_cents: 700,
      min_order_cents: 3e3,
      eta_minutes: 40,
      hours: "Ter a dom, 18h \xE0s 0h",
      areas: "Centro, Vila Nova e Jardim",
      payment_methods: ["dinheiro", "pix", "cartao"],
      message: "Chope em dobro at\xE9 as 20h!"
    },
    agent: {
      enabled: false,
      name: "R\xFAstica",
      greeting: "Ol\xE1! Sou a R\xFAstica, atendente virtual do bar. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* ou fazer uma *reserva*. Para fala\
r com a equipe, digite *atendente*.",
      handoff_message: "Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA.",
      closed_message: "No momento n\xE3o estamos recebendo pedidos.",
      reservation_max_people: 12,
      reservation_min_hours: 2
    }
  };
  await db.query(`update companies set slug = $2, settings = settings || $3::jsonb where id = $1`, [companyId, `demo-${companyId}`, JSON.stringify(settings)]);
  const month = String((/* @__PURE__ */ new Date()).getMonth() + 1).padStart(2, "0");
  const cust = {};
  for (const [name, cpf, phone, bday, tags, consent, pts] of [
    ["Ana Souza", "52998224725", "11988887777", "1990-03-12", ["vip", "chope"], true, 120],
    ["Bruno Lima", "39053344705", "11977776666", `1987-${month}-21`, ["anivers\xE1rio"], true, 0],
    ["Carla Dias", null, "11966665555", "1995-08-02", [], false, 0]
  ]) {
    const r = await db.query(`insert into customers (company_id, cpf, name, phone, birthday, tags, consent_whatsapp, consent_at, created_by)
      values ($1,$2,$3,$4,$5,$6,$7, case when $7 then now() end, $8) returning id`, [companyId, cpf, name, phone, bday, tags, consent, userId]);
    cust[name] = r.rows[0].id;
    if (pts) {
      await db.query(`insert into loyalty_ledger (company_id, customer_id, kind, points, expires_at, reason, user_id) values ($1,$2,'ganho',$3, current_date + 365, 'Consumos anteri\
ores', $4)`, [companyId, r.rows[0].id, pts, userId]);
      await db.query("update customers set points = $2 where id = $1", [r.rows[0].id, pts]);
    }
  }
  await db.query("update consumption_sessions set customer_id = $2, customer_name = $3 where id = $1", [closedId, cust["Bruno Lima"], "Bruno Lima"]);
  const mesa = (await db.query("select id from consumption_sessions where company_id = $1 and kind = 'mesa' limit 1", [companyId])).rows[0];
  if (mesa) await db.query("update consumption_sessions set customer_id = $2, customer_name = $3 where id = $1", [mesa.id, cust["Ana Souza"], "Ana Souza"]);
  await db.query("insert into reviews (company_id, session_id, customer_id, score, comment) values ($1,$2,$3,5,$4)", [companyId, closedId, cust["Bruno Lima"], "Chope gelado e atend\
imento r\xE1pido!"]);
  const stock = {};
  for (const [name, unit, qty, cost, min] of [
    ["Carne mo\xEDda", "kg", 8, 3200, 2],
    ["P\xE3o brioche", "un", 40, 150, 12],
    ["Batata congelada", "kg", 12, 900, 4],
    ["Pilsen long neck (garrafa)", "un", 48, 450, 24],
    ["Chope (barril)", "L", 30, 1200, 10],
    ["Lim\xE3o", "kg", 1.5, 600, 3],
    ["Cacha\xE7a", "L", 4, 2500, 1]
  ]) {
    const r = await db.query("insert into stock_items (company_id, name, unit, min_qty, reorder_qty, avg_cost_cents) values ($1,$2,$3,$4,$5,$6) returning id", [companyId, name, unit,
    min, min * 3, cost]);
    stock[name] = r.rows[0].id;
    await db.query(
      `insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, reason, user_id) values ($1,$2,'entrada',$3,$4,'saldo_inicial','Saldo inicial',\
$5)`,
      [companyId, r.rows[0].id, qty, cost, userId]
    );
  }
  const prods = Object.fromEntries((await db.query("select id, name from products where company_id = $1", [companyId])).rows.map((p) => [p.name, p.id]));
  for (const [prod, lines, cost] of [
    ["Hamb\xFArguer da oficina", [["Carne mo\xEDda", 0.18], ["P\xE3o brioche", 1]], 726],
    ["Por\xE7\xE3o de fritas", [["Batata congelada", 0.4]], 360],
    ["Chope 300 ml", [["Chope (barril)", 0.3]], 360],
    ["Caipirinha", [["Lim\xE3o", 0.12], ["Cacha\xE7a", 0.06]], 222]
  ]) {
    if (!prods[prod]) continue;
    const r = await db.query("insert into recipes (company_id, product_id, version, yield_qty, created_by) values ($1,$2,1,1,$3) returning id", [companyId, prods[prod], userId]);
    for (const [it, q2] of lines) await db.query("insert into recipe_lines (company_id, recipe_id, stock_item_id, qty) values ($1,$2,$3,$4)", [companyId, r.rows[0].id, stock[it], q2]);
    await db.query("update products set stock_mode = 'ficha', cost_cents = $2 where id = $1", [prods[prod], cost]);
  }
  if (prods["Pilsen long neck"]) await db.query("update products set stock_mode = 'acabado', stock_item_id = $2, cost_cents = 450 where id = $1", [prods["Pilsen long neck"], stock["\
Pilsen long neck (garrafa)"]]);
  for (const [name, phone, people, hour, status, source] of [["Diego Martins", "11955554444", 6, 21, "confirmada", "equipe"], ["Fernanda Alves", "11944443333", 4, 22, "pendente", "\
agente"]]) {
    await db.query(
      `insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source)
      values ($1,$2,$3,$4,$5, date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' + make_interval(hours => $6), $7, $8)`,
      [companyId, unitId, name, phone, people, hour, status, source]
    );
  }
}

// src/lib/params.js
var MODE_OPTIONS = [
  { value: "manual", label: "Manual (toque/busca)" },
  { value: "continua", label: "Leitura cont\xEDnua" },
  { value: "dupla", label: "Dupla leitura (comanda \u2192 produto)" }
];
var TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Cuiaba",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Porto_Velho",
  "America/Rio_Branco",
  "America/Noronha"
].map((v) => ({ value: v, label: v.replace("America/", "").replace("_", " ") }));
var SYSTEM_FIELDS = [
  {
    key: "signup_enabled",
    label: "Novos cadastros abertos",
    type: "boolean",
    group: "Cadastro e demonstra\xE7\xE3o",
    default: true,
    help: 'Desligado, a tela "Criar conta" do RUSTEN fica fechada (empresas existentes seguem normalmente).'
  },
  { key: "demo_enabled", label: 'Bot\xE3o "Experimentar demonstra\xE7\xE3o" no login', type: "boolean", group: "Cadastro e demonstra\xE7\xE3o", default: true },
  { key: "demo_days", label: "Dias at\xE9 apagar demonstra\xE7\xF5es n\xE3o ativadas", type: "number", group: "Cadastro e demonstra\xE7\xE3o", min: 1, max: 30, step: 1, unit: "dias",
  default: 7 },
  { key: "default_mode", label: "Modo do PDV em empresas novas", type: "select", group: "Padr\xF5es de empresas novas", options: MODE_OPTIONS, default: "manual" },
  { key: "default_service_fee", label: "Taxa de servi\xE7o padr\xE3o", type: "number", group: "Padr\xF5es de empresas novas", min: 0, max: 30, step: 0.5, unit: "%", default: 10 },
  { key: "default_tables", label: "Mesas criadas no cadastro", type: "number", group: "Padr\xF5es de empresas novas", min: 0, max: 300, step: 1, default: 10 },
  { key: "default_cards", label: "Cart\xF5es de comanda criados no cadastro", type: "number", group: "Padr\xF5es de empresas novas", min: 0, max: 2e3, step: 1, default: 50 },
  {
    key: "default_day_cutoff",
    label: "Virada do dia comercial",
    type: "number",
    group: "Padr\xF5es de empresas novas",
    min: 0,
    max: 12,
    step: 1,
    unit: "h",
    default: 5,
    help: "Vendas antes deste hor\xE1rio contam no dia anterior."
  },
  {
    key: "notice_text",
    label: "Aviso para todos os usu\xE1rios",
    type: "textarea",
    group: "Comunica\xE7\xE3o",
    max: 300,
    default: "",
    help: "Exibido no topo do RUSTEN para todas as empresas. Deixe vazio para n\xE3o mostrar."
  },
  {
    key: "notice_level",
    label: "Tipo do aviso",
    type: "select",
    group: "Comunica\xE7\xE3o",
    default: "info",
    options: [{ value: "info", label: "Informativo" }, { value: "warn", label: "Aten\xE7\xE3o" }]
  }
];
var TENANT_FIELDS = [
  { key: "name", label: "Nome da empresa", type: "text", group: "Empresa", max: 120 },
  { key: "timezone", label: "Fuso hor\xE1rio", type: "select", group: "Empresa", options: TIMEZONES },
  { key: "pdv_mode", label: "Modo padr\xE3o do PDV", type: "select", group: "PDV e leitor", options: MODE_OPTIONS },
  { key: "pdv_scanner_enabled", label: "Leitor de c\xF3digo habilitado", type: "boolean", group: "PDV e leitor" },
  {
    key: "pdv_double_read_mandatory",
    label: "Dupla leitura obrigat\xF3ria",
    type: "boolean",
    group: "PDV e leitor",
    help: "Exige ler a comanda e depois o produto em cada item; s\xF3 exce\xE7\xE3o autorizada sai dela."
  },
  { key: "pdv_allow_manual", label: "Permitir lan\xE7amento manual", type: "boolean", group: "PDV e leitor" },
  { key: "pdv_exception_requires_manager", label: "Exce\xE7\xE3o \xE0 dupla leitura exige gerente", type: "boolean", group: "PDV e leitor" },
  { key: "pdv_product_timeout_s", label: "Tempo para ler o produto ap\xF3s a comanda", type: "number", group: "PDV e leitor", min: 3, max: 120, step: 1, unit: "s" },
  { key: "pdv_require_open_cash", label: "Exigir caixa aberto para receber", type: "boolean", group: "Caixa e cobran\xE7a" },
  { key: "pdv_service_fee", label: "Taxa de servi\xE7o", type: "number", group: "Caixa e cobran\xE7a", min: 0, max: 30, step: 0.5, unit: "%" },
  { key: "pdv_card_prefix", label: "Prefixo dos cart\xF5es de comanda", type: "text", group: "Caixa e cobran\xE7a", max: 8, help: "Letras mai\xFAsculas, n\xFAmeros e h\xEDfen." }
];
var strip = ({ default: _d, ...f }) => f;
var settingsManifest = () => ({ system: SYSTEM_FIELDS.map(strip), tenant: TENANT_FIELDS });
function coerce(field, v) {
  if (v === null || v === void 0) return void 0;
  switch (field.type) {
    case "boolean":
      if (typeof v !== "boolean") throw bad(`${field.label}: valor inv\xE1lido`);
      return v;
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n) || field.min != null && n < field.min || field.max != null && n > field.max)
        throw bad(`${field.label}: use um valor entre ${field.min} e ${field.max}`);
      return n;
    }
    case "select":
      if (!field.options.some((o) => o.value === v)) throw bad(`${field.label}: op\xE7\xE3o inv\xE1lida`);
      return v;
    default: {
      const s = String(v).trim();
      if (field.max && s.length > field.max) throw bad(`${field.label}: m\xE1ximo de ${field.max} caracteres`);
      return s;
    }
  }
}
function pick(fields, values2) {
  if (!values2 || typeof values2 !== "object" || Array.isArray(values2)) throw bad('Envie os par\xE2metros em "values"');
  const out = {};
  for (const [k, v] of Object.entries(values2)) {
    const f = fields.find((x) => x.key === k);
    if (!f) throw bad(`Par\xE2metro desconhecido: ${k}`);
    const c = coerce(f, v);
    if (c !== void 0) out[k] = c;
  }
  return out;
}
var sysCache = { at: 0, v: null };
async function getSystemParams() {
  if (sysCache.v && Date.now() - sysCache.at < 3e4) return sysCache.v;
  const base2 = Object.fromEntries(SYSTEM_FIELDS.map((f) => [f.key, f.default]));
  try {
    const { rows } = await q("select key, value from system_settings");
    for (const r of rows) if (r.key in base2) base2[r.key] = r.value;
  } catch {
  }
  sysCache = { at: Date.now(), v: base2 };
  return base2;
}
async function setSystemParams(values2) {
  const clean = pick(SYSTEM_FIELDS, values2);
  for (const [k, v] of Object.entries(clean)) {
    await q(`insert into system_settings (key, value, updated_at) values ($1, $2::jsonb, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, JSON.stringify(v)]);
  }
  sysCache.at = 0;
  return getSystemParams();
}
var PDV_MAP = {
  pdv_mode: "mode",
  pdv_scanner_enabled: "scanner_enabled",
  pdv_double_read_mandatory: "double_read_mandatory",
  pdv_allow_manual: "allow_manual",
  pdv_exception_requires_manager: "exception_requires_manager",
  pdv_product_timeout_s: "product_timeout_s",
  pdv_require_open_cash: "require_open_cash",
  pdv_card_prefix: "card_prefix"
};
async function getTenantParams(companyId) {
  const { rows } = await q("select name, timezone, settings from companies where id = $1", [companyId]);
  const c = rows[0];
  if (!c) return null;
  const pdv = c.settings?.pdv || {};
  const out = { name: c.name, timezone: c.timezone };
  for (const [k, src] of Object.entries(PDV_MAP)) out[k] = pdv[src] ?? null;
  out.pdv_service_fee = pdv.service_fee_bp != null ? pdv.service_fee_bp / 100 : null;
  return out;
}
async function setTenantParams(db, companyId, values2) {
  const clean = pick(TENANT_FIELDS, values2);
  if (clean.pdv_card_prefix != null && !/^[A-Z0-9-]{1,8}$/.test(clean.pdv_card_prefix)) throw bad("Prefixo dos cart\xF5es: use letras mai\xFAsculas, n\xFAmeros e h\xEDfen (at\xE9 8)");
  if (clean.name != null && clean.name.length < 2) throw bad("Nome da empresa muito curto");
  const layer = {};
  for (const [k, src] of Object.entries(PDV_MAP)) if (k in clean) layer[src] = clean[k];
  if ("pdv_service_fee" in clean) layer.service_fee_bp = Math.round(clean.pdv_service_fee * 100);
  const cur = (await db.query("select settings from companies where id = $1 for update", [companyId])).rows[0];
  const pdv = { ...cur?.settings?.pdv || {}, ...layer };
  validatePdvLayer(pdv);
  await db.query(
    `update companies set name = coalesce($2, name), timezone = coalesce($3, timezone),
                    settings = jsonb_set(settings, '{pdv}', $4::jsonb) where id = $1`,
    [companyId, clean.name ?? null, clean.timezone ?? null, JSON.stringify(pdv)]
  );
  return clean;
}

// src/lib/plans.js
function toCents(v) {
  if (v === null || v === void 0 || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 1e7) return null;
  return Math.round(n * 100);
}
function annualSavings(monthlyCents, yearlyCents) {
  if (!monthlyCents || !yearlyCents) return null;
  const full = monthlyCents * 12;
  if (yearlyCents >= full) return null;
  return { cents: full - yearlyCents, pct: Math.floor((full - yearlyCents) / full * 100) };
}
function normalizePlan(p) {
  if (!p || typeof p !== "object") return null;
  const monthly = toCents(p.monthly_price ?? (p.monthly_cents != null ? p.monthly_cents / 100 : null));
  const yearly = toCents(p.annual_price ?? (p.yearly_cents != null ? p.yearly_cents / 100 : null));
  const savings = annualSavings(monthly, yearly);
  return {
    id: p.id ?? null,
    code: p.code ?? null,
    name: String(p.name ?? ""),
    description: p.description ?? null,
    features: p.features ?? null,
    max_users: p.max_users ?? null,
    monthly_cents: monthly,
    yearly_cents: yearly,
    annual_savings_cents: savings?.cents ?? null,
    annual_savings_pct: savings?.pct ?? null,
    // legado (reais): mantidos enquanto houver consumidores; null quando o ciclo não tem preço
    monthly_price: monthly == null ? null : monthly / 100,
    annual_price: yearly == null ? null : yearly / 100
  };
}
var normalizePlans = (list) => Array.isArray(list) ? list.map(normalizePlan).filter((p) => p && (p.monthly_cents || p.yearly_cents)) : [];
function trialInfo(t) {
  if (t === "15_DAYS") return { trial: true, trial_days: 15, trial_label: "Per\xEDodo de teste de 15 dias" };
  if (t === "30_DAYS") return { trial: true, trial_days: 30, trial_label: "Per\xEDodo de teste de 30 dias" };
  if (t === "UNLIMITED") return { trial: true, trial_days: null, trial_label: "Per\xEDodo de teste com prazo definido pela administra\xE7\xE3o" };
  return { trial: false, trial_days: null, trial_label: null };
}

// src/lib/sessionCookie.js
var COOKIE = "__Host-rusten_rt";
var cookieMode = (req) => String(req.get("x-session-mode") || "").toLowerCase() === "cookie";
function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function assertSameOrigin(req) {
  const origin = String(req.get("origin") || "");
  if (!origin) throw new HttpError(403, "Origem da requisi\xE7\xE3o n\xE3o informada.", "csrf");
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Origem inv\xE1lida.", "csrf");
  }
  const site = String(req.get("x-edge-site") || "");
  const allowed = String(env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const dev = env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (!(site && host === site) && !allowed.includes(origin) && !dev) throw new HttpError(403, "Origem n\xE3o autorizada.", "csrf");
}
var cookieValue = (v, maxAge) => `${COOKIE}=${v ? encodeURIComponent(v) : ""}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
function sendTokens(req, res, tokens2, status = 200) {
  if (!cookieMode(req)) return res.status(status).json(tokens2);
  const { refresh_token: rt, ...rest } = tokens2;
  res.append("Set-Cookie", cookieValue(rt, REFRESH_TTL_DAYS * 86400));
  res.set("Cache-Control", "no-store");
  return res.status(status).json({ ...rest, session: "cookie" });
}
function clearRefreshCookie(res) {
  res.append("Set-Cookie", cookieValue("", 0));
}
function readRefresh(req) {
  const body = String(req.body?.refresh_token || "");
  if (cookieMode(req)) assertSameOrigin(req);
  if (body) return body;
  return cookieMode(req) ? String(readCookie(req) || "") : "";
}

// src/routes/auth.js
var router = Router();
var COMMON = ["12345678", "senha123", "password", "qwerty", "123456789", "rusten123", "abc12345"];
function checkPassword(p) {
  if (p.length < 10) throw bad("A senha precisa ter pelo menos 10 caracteres");
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) throw bad("A senha precisa ter letras e n\xFAmeros");
  if (COMMON.some((c) => p.toLowerCase().includes(c))) throw bad("Senha muito comum");
}
var SEGMENTS = ["bar", "restaurante", "lanchonete", "cafeteria", "pub", "food_truck", "hamburgueria", "pizzaria", "padaria", "outro"];
var registerSchema = z.object({
  company: z.object({
    name: z.string().trim().min(2).max(120),
    segment: z.enum(SEGMENTS).default("restaurante"),
    document: z.string().trim().max(20).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(160).optional(),
    address: z.object({ street: z.string().max(160).optional(), city: z.string().max(80).optional(), state: z.string().max(2).optional(), zip: z.string().max(10).optional() }).partial().
    optional()
  }),
  owner: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(160),
    password: z.string().min(1).max(200)
  }),
  accept_terms: z.literal(true, { message: "\xC9 preciso aceitar os termos" }),
  plan: z.object({ code: z.string().max(60).optional(), cycle: z.enum(["mensal", "anual"]).optional(), trial: z.boolean().optional() }).optional(),
  setup: z.object({
    unit_name: z.string().trim().max(80).optional(),
    tables: z.number().int().min(0).max(300).default(10),
    cards: z.number().int().min(0).max(2e3).default(50),
    mode: z.enum(["manual", "continua", "dupla"]).default("manual"),
    demo: z.boolean().default(false),
    day_cutoff: z.number().int().min(0).max(12).default(5)
  }).default({})
});
router.post("/register", h(async (req, res) => {
  const sys = await getSystemParams();
  if (env.ALLOW_SIGNUP === "false" || sys.signup_enabled === false) throw new HttpError(403, "Novos cadastros est\xE3o temporariamente fechados", "signup_closed");
  await rateLimit(`register:${req.ip}`, 10, 3600);
  const b = parse(registerSchema, req.body);
  checkPassword(b.owner.password);
  const exists = await q("select 1 from users where lower(email) = $1", [b.owner.email]);
  if (exists.rows[0]) throw new HttpError(409, 'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.', "email_taken");
  const hash = await bcrypt.hash(b.owner.password, 12);
  const out = await tx(async (db) => {
    const c = await db.query(
      `insert into companies (name, segment, document, phone, email, address, settings)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        b.company.name,
        b.company.segment,
        b.company.document ?? null,
        b.company.phone ?? null,
        b.company.email ?? b.owner.email,
        b.company.address ?? {},
        { pdv: { mode: b.setup.mode, service_fee_bp: Math.round(Number(sys.default_service_fee ?? 10) * 100) }, plan_request: b.plan ?? null }
      ]
    );
    const companyId = c.rows[0].id;
    for (const r of DEFAULT_ROLES) {
      await db.query(
        "insert into roles (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",
        [companyId, r.key, r.name, r.level, r.permissions]
      );
    }
    const u = await db.query(
      `insert into users (company_id, name, email, password_hash, role_key) values ($1,$2,$3,$4,'owner') returning id`,
      [companyId, b.owner.name, b.owner.email, hash]
    );
    const ctx = { companyId, userId: u.rows[0].id };
    await seedCompany(db, companyId, b.setup);
    await audit(db, ctx, "empresa.cadastrada", { entity: "company", entityId: companyId, data: { segment: b.company.segment, plan: b.plan ?? null } });
    await enqueueHub(db, companyId, "tenant.created");
    return { companyId, userId: u.rows[0].id };
  });
  try {
    if (await registerCompany(out.companyId, 4e3)) await q("update platform_outbox set sent_at = now() where company_id = $1 and sent_at is null", [out.companyId]);
  } catch {
  }
  const tokens2 = await startSession({ id: out.userId, company_id: out.companyId }, req);
  sendTokens(req, res, tokens2, 201);
}));
async function startSession(user, req) {
  const sid = crypto4.randomUUID();
  const refresh = randomToken(48);
  await q(
    `insert into user_sessions (id, user_id, refresh_hash, expires_at, ip)
           values ($1,$2,$3, now() + make_interval(days => $4), $5)`,
    [sid, user.id, sha256(refresh), REFRESH_TTL_DAYS, req.ip]
  );
  return { access_token: signAccess(user, sid), refresh_token: `${sid}.${refresh}` };
}
var DUMMY_HASH;
var dummyHash = () => DUMMY_HASH ||= bcrypt.hashSync("dummy-password-for-timing", 12);
router.get("/plans", h(async (_req, res) => {
  const sys = await getSystemParams();
  const base2 = {
    signup_open: env.ALLOW_SIGNUP !== "false" && sys.signup_enabled !== false,
    demo_enabled: sys.demo_enabled !== false,
    defaults: { mode: sys.default_mode, tables: sys.default_tables, cards: sys.default_cards, day_cutoff: sys.default_day_cutoff }
  };
  if (!await platformConfig()) return res.json({ ...base2, hub: false, plans: [] });
  try {
    const data = await hubCall("GET", "/plans", void 0, 5e3);
    res.json({
      ...base2,
      hub: true,
      plans: normalizePlans(data.plans),
      trial_default: data.trial_default || null,
      ...trialInfo(data.trial_default),
      signup_open: base2.signup_open && data.signup_enabled !== false
    });
  } catch {
    res.json({ ...base2, hub: true, plans: [], unavailable: true });
  }
}));
router.post("/demo", h(async (req, res) => {
  const sys = await getSystemParams();
  if (sys.demo_enabled === false) throw new HttpError(403, "A demonstra\xE7\xE3o est\xE1 desativada no momento.", "demo_disabled");
  await rateLimit(`demo:${req.ip}`, 10, 3600);
  const old = await q("select id from companies where is_demo and created_at < now() - make_interval(days => $1) limit 20", [Number(sys.demo_days) || 7]);
  for (const r of old.rows) await tx((db) => db.query("select purge_demo_company($1)", [r.id])).catch(() => {
  });
  const rand = randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "x");
  const out = await tx(async (db) => {
    const c = await db.query(
      `insert into companies (name, segment, email, settings, is_demo) values ('Bar Demonstra\xE7\xE3o', 'bar', null, $1, true) returning id, timezone`,
      [{ pdv: { mode: "manual", service_fee_bp: 1e3 } }]
    );
    const companyId = c.rows[0].id;
    for (const r of DEFAULT_ROLES) {
      await db.query(
        "insert into roles (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)",
        [companyId, r.key, r.name, r.level, r.permissions]
      );
    }
    const u = await db.query(
      `insert into users (company_id, name, email, password_hash, role_key) values ($1,'Visitante',$2,$3,'owner') returning id`,
      [companyId, `demo-${rand}@demo.rusten.app`, await bcrypt.hash(randomToken(24), 8)]
    );
    const { unitId } = await seedCompany(db, companyId, { unit_name: "Matriz", tables: 12, cards: 30, demo: true, day_cutoff: 5 });
    await seedDemoActivity(db, companyId, unitId, u.rows[0].id, businessDate(/* @__PURE__ */ new Date(), c.rows[0].timezone, 5));
    await audit(db, { companyId, userId: u.rows[0].id }, "demonstracao.criada", { entity: "company", entityId: companyId });
    return { companyId, userId: u.rows[0].id };
  });
  sendTokens(req, res, await startSession({ id: out.userId, company_id: out.companyId }, req), 201);
}));
router.post("/activate", auth(), h(async (req, res) => {
  const b = parse(z.object({
    company_name: z.string().trim().min(2).max(120),
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(160),
    password: z.string().min(1).max(200),
    phone: z.string().trim().max(30).optional(),
    keep_data: z.boolean().default(false),
    accept_terms: z.literal(true, { message: "\xC9 preciso aceitar os termos" })
  }), req.body);
  if (req.ctx.role !== "owner") throw new HttpError(403, "S\xF3 o propriet\xE1rio pode ativar o sistema.", "forbidden");
  if (!req.ctx.company.is_demo) throw bad("Esta empresa j\xE1 est\xE1 em uso normal.");
  const sys = await getSystemParams();
  if (env.ALLOW_SIGNUP === "false" || sys.signup_enabled === false) throw new HttpError(403, "Novos cadastros est\xE3o temporariamente fechados", "signup_closed");
  checkPassword(b.password);
  const taken = await q("select 1 from users where lower(email) = $1 and id <> $2", [b.email, req.ctx.userId]);
  if (taken.rows[0]) throw new HttpError(409, 'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.', "email_taken");
  const cid = req.ctx.companyId;
  await tx(async (db) => {
    if (!b.keep_data) {
      await db.query("select set_config('rusten.purge_demo', $1, true)", [String(cid)]);
      for (const sql of [
        "delete from reviews where company_id = $1",
        "delete from loyalty_ledger where company_id = $1 and reverses_id is not null",
        "delete from loyalty_ledger where company_id = $1",
        "delete from delivery_events where company_id = $1",
        "delete from delivery_orders where company_id = $1",
        "delete from kitchen_events where company_id = $1",
        "delete from stock_movements where company_id = $1 and reverses_id is not null",
        "delete from stock_movements where company_id = $1",
        "delete from recipe_lines where company_id = $1",
        "delete from recipes where company_id = $1",
        "update products set stock_mode = 'nenhum', stock_item_id = null where company_id = $1",
        "delete from purchase_lines where company_id = $1",
        "delete from purchases where company_id = $1",
        "delete from inventory_counts where company_id = $1",
        "update modifier_options set stock_item_id = null where company_id = $1",
        "delete from stock_items where company_id = $1",
        "delete from reservations where company_id = $1",
        "delete from conversation_messages where company_id = $1",
        "delete from conversations where company_id = $1"
      ]) await db.query(sql, [cid]);
      await db.query("delete from payments where company_id = $1", [cid]);
      await db.query("delete from cash_movements where company_id = $1", [cid]);
      await db.query("delete from cash_sessions where company_id = $1", [cid]);
      await db.query("delete from order_items where company_id = $1", [cid]);
      await db.query("delete from consumption_sessions where company_id = $1", [cid]);
      await db.query("delete from customers where company_id = $1", [cid]);
      await db.query("select set_config('rusten.purge_demo', '', true)");
      await db.query("update dining_tables set status = 'livre' where company_id = $1", [cid]);
      await db.query("delete from scan_codes where company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo)", [cid]);
      await db.query("delete from modifier_groups where company_id = $1 and product_id in (select id from products where company_id = $1 and demo)", [cid]);
      await db.query("delete from product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 and demo)", [cid]);
      await db.query("delete from products where company_id = $1 and demo", [cid]);
      await db.query("delete from categories where company_id = $1 and demo", [cid]);
    }
    await db.query(
      "update companies set name = $2, phone = coalesce($3, phone), email = $4, is_demo = false, created_at = now() where id = $1",
      [cid, b.company_name, b.phone ?? null, b.email]
    );
    await db.query(
      "update users set name = $2, email = $3, password_hash = $4, password_changed_at = now() where id = $1",
      [req.ctx.userId, b.name, b.email, await bcrypt.hash(b.password, 12)]
    );
    await db.query("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [req.ctx.userId]);
    await audit(db, req.ctx, "demonstracao.ativada", { entity: "company", entityId: cid, data: { keep_data: b.keep_data } });
    await enqueueHub(db, cid, "tenant.created");
  });
  try {
    await flushOutbox(5);
  } catch {
  }
  sendTokens(req, res, await startSession({ id: req.ctx.userId, company_id: cid }, req));
}));
router.post("/login", h(async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().max(160), password: z.string().max(200) }), req.body);
  await rateLimit(`login:${req.ip}`, 30, 900);
  await rateLimit(`login-user:${b.email}`, 15, 900);
  const { rows } = await q("select * from users where lower(email) = $1", [b.email]);
  const u = rows[0];
  const ok = await bcrypt.compare(b.password, u?.password_hash || dummyHash());
  const fail = new HttpError(401, "E-mail ou senha incorretos", "bad_credentials");
  if (!u || !u.active) throw fail;
  if (u.locked_until && new Date(u.locked_until) > /* @__PURE__ */ new Date())
    throw new HttpError(423, "Conta bloqueada temporariamente por tentativas inv\xE1lidas. Tente em 15 minutos.", "locked");
  if (!ok) {
    await q(`update users set failed_attempts = failed_attempts + 1,
               locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
             where id = $1`, [u.id]);
    await audit({ query: q }, { companyId: u.company_id, userId: u.id }, "login.falhou", { entity: "user", entityId: u.id });
    throw fail;
  }
  await q("update users set failed_attempts = 0, locked_until = null where id = $1", [u.id]);
  await q("update companies set last_access_at = now() where id = $1", [u.company_id]);
  await audit({ query: q }, { companyId: u.company_id, userId: u.id }, "login", { entity: "user", entityId: u.id });
  sendTokens(req, res, await startSession(u, req));
}));
var RESET_MIN = 60;
var GENERIC_FORGOT = { ok: true, message: "Se o e-mail estiver cadastrado, voc\xEA vai receber um link para criar uma nova senha em alguns minutos." };
var mailCache = { at: 0, v: false };
async function resetAvailable() {
  if (Date.now() - mailCache.at < 6e4) return mailCache.v;
  let v = false;
  try {
    v = !!(await hubCall("GET", "/mail/status", void 0, 5e3)).available;
  } catch {
    v = false;
  }
  mailCache = { at: Date.now(), v };
  return v;
}
router.get("/reset-options", h(async (_req, res) => res.json({ available: await resetAvailable() })));
router.post("/forgot", h(async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email("E-mail inv\xE1lido").max(160) }), req.body);
  await rateLimit(`forgot:${req.ip}`, 20, 3600);
  if (!await resetAvailable()) throw new HttpError(503, "A recupera\xE7\xE3o de senha por e-mail ainda n\xE3o est\xE1 ativa. Pe\xE7a ao propriet\xE1rio ou administrador da empresa para definir uma n\
ova senha em Configura\xE7\xF5es \u203A Usu\xE1rios, ou fale com o suporte.", "reset_unavailable");
  try {
    await rateLimit(`forgot-user:${b.email}`, 3, 3600);
  } catch {
    return res.json(GENERIC_FORGOT);
  }
  const u = (await q(`select u.id, u.name, u.email, u.company_id, c.name as company_name, c.is_demo from users u join companies c on c.id = u.company_id
     where lower(u.email) = $1 and u.active`, [b.email])).rows[0];
  if (!u || u.is_demo) return res.json(GENERIC_FORGOT);
  const token = randomToken(32);
  await q("update password_resets set used_at = now() where user_id = $1 and used_at is null", [u.id]);
  await q(
    `insert into password_resets (user_id, token_hash, expires_at, ip) values ($1,$2, now() + make_interval(mins => $3), $4)`,
    [u.id, sha256(token), RESET_MIN, String(req.ip || "").slice(0, 64)]
  );
  try {
    await hubCall("POST", "/mail/password-reset", { to: u.email, name: u.name, company: u.company_name, path: `/redefinir-senha?token=${token}`, minutes: RESET_MIN }, 2e4);
  } catch (e) {
    await q("update password_resets set used_at = now() where token_hash = $1", [sha256(token)]);
    throw new HttpError(e.status === 429 ? 429 : 502, e.status === 429 ? e.message : "N\xE3o foi poss\xEDvel enviar o e-mail agora. Tente novamente em alguns minutos.", "mail_faile\
d");
  }
  await audit({ query: q }, { companyId: u.company_id, userId: u.id }, "senha.redefinicao_pedida", { entity: "user", entityId: u.id });
  res.json(GENERIC_FORGOT);
}));
router.post("/reset", h(async (req, res) => {
  const b = parse(z.object({ token: z.string().trim().min(20).max(200), new_password: z.string().max(200) }), req.body);
  await rateLimit(`reset:${req.ip}`, 30, 3600);
  checkPassword(b.new_password);
  const out = await tx(async (db) => {
    const r = (await db.query(`update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id`, [sha256(b.token)])).rows[0];
    if (!r) throw new HttpError(400, "Este link expirou ou j\xE1 foi usado. Pe\xE7a um novo em \u201CEsqueci minha senha\u201D.", "reset_invalid");
    const u = (await db.query("select id, company_id from users where id = $1 and active", [r.user_id])).rows[0];
    if (!u) throw new HttpError(400, "Conta indispon\xEDvel.", "reset_invalid");
    await db.query(`update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null where id = $1`, [u.id, await bcrypt.hash(b.new_password,
    10)]);
    await db.query("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [u.id]);
    await audit(db, { companyId: u.company_id, userId: u.id }, "senha.redefinida_por_email", { entity: "user", entityId: u.id });
    return { ok: true };
  });
  res.json(out);
}));
router.post("/refresh", h(async (req, res) => {
  try {
    await refreshSession(req, res);
  } catch (e) {
    if (cookieMode(req) && e?.status === 401) clearRefreshCookie(res);
    throw e;
  }
}));
async function refreshSession(req, res) {
  const raw = readRefresh(req);
  const [sid, secret] = raw.split(".");
  if (!sid || !secret || !/^[0-9a-f-]{36}$/.test(sid)) throw new HttpError(401, "Sess\xE3o inv\xE1lida", "unauthenticated");
  const out = await tx(async (db) => {
    const { rows } = await db.query(
      `select s.*, u.company_id, u.active from user_sessions s join users u on u.id = s.user_id where s.id = $1 for update of s`,
      [sid]
    );
    const s = rows[0];
    if (!s || s.revoked_at || new Date(s.expires_at) < /* @__PURE__ */ new Date() || !s.active) throw new HttpError(401, "Sess\xE3o expirada", "unauthenticated");
    if (s.refresh_hash !== sha256(secret)) {
      await db.query("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [s.user_id]);
      await audit(db, { companyId: s.company_id, userId: s.user_id }, "sessao.reuso_detectado", { entity: "user", entityId: s.user_id });
      return null;
    }
    const next = randomToken(48);
    await db.query("update user_sessions set refresh_hash = $2, rotated_at = now() where id = $1", [sid, sha256(next)]);
    return { access_token: signAccess({ id: s.user_id, company_id: s.company_id }, sid), refresh_token: `${sid}.${next}` };
  });
  if (!out) throw new HttpError(401, "Sess\xE3o encerrada por seguran\xE7a. Entre novamente.", "unauthenticated");
  sendTokens(req, res, out);
}
router.post("/logout", auth(), h(async (req, res) => {
  const all = req.body?.all === true;
  if (all) await q("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [req.ctx.userId]);
  else await q("update user_sessions set revoked_at = now() where id = $1", [req.ctx.sessionId]);
  if (cookieMode(req)) clearRefreshCookie(res);
  res.json({ ok: true });
}));
router.post("/password", auth(), h(async (req, res) => {
  const b = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), req.body);
  checkPassword(b.next);
  const { rows } = await q("select password_hash from users where id = $1", [req.ctx.userId]);
  if (!await bcrypt.compare(b.current, rows[0].password_hash)) throw bad("Senha atual incorreta");
  await q("update users set password_hash = $2, password_changed_at = now() where id = $1", [req.ctx.userId, await bcrypt.hash(b.next, 12)]);
  await q("update user_sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null", [req.ctx.userId, req.ctx.sessionId]);
  await audit({ query: q }, req.ctx, "senha.alterada", { entity: "user", entityId: req.ctx.userId });
  res.json({ ok: true });
}));
router.get("/me", auth(), h(async (req, res) => {
  const c = req.ctx;
  const units = await q("select id, name, day_cutoff from units where company_id = $1 and active order by id", [c.companyId]);
  const unitId = c.terminalUnitId || c.unitId || units.rows[0]?.id;
  res.json({
    user: { id: c.userId, name: c.name, email: c.email, role: c.role, roleName: c.roleName, level: c.level, unitId: c.unitId },
    company: c.company,
    permissions: [...c.perms],
    access: c.access,
    units: units.rows,
    unitId,
    terminalId: c.terminalId,
    pdv: await pdvSettings({ query: q }, c, unitId),
    catalog: { permissions: PERMISSIONS, modules: MODULES },
    notice: await systemNotice()
  });
}));
async function systemNotice() {
  const sys = await getSystemParams();
  return sys.notice_text ? { text: sys.notice_text, level: sys.notice_level === "warn" ? "warn" : "info" } : null;
}

// src/routes/admin.js
import { Router as Router2 } from "npm:express@5.2.1";
import bcrypt2 from "npm:bcryptjs@3.0.3";
import { z as z2 } from "npm:zod@4.6.5";
var router2 = Router2();
async function roleLevel(companyId, key2) {
  const r = await q("select level from roles where company_id = $1 and key = $2", [companyId, key2]);
  if (!r.rows[0]) throw bad("Perfil inexistente");
  return r.rows[0].level;
}
router2.get("/users", need("usuarios.gerenciar"), h(async (req, res) => {
  const { rows } = await q(
    `select u.id, u.name, u.email, u.role_key, r.name as role_name, r.level, u.unit_id, u.active, u.created_at,
            u.locked_until > now() as locked
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by r.level desc, u.name`,
    [req.ctx.companyId]
  );
  res.json(rows);
}));
var userSchema = z2.object({
  name: z2.string().trim().min(2).max(120),
  email: z2.string().trim().toLowerCase().email().max(160),
  password: z2.string().max(200).optional(),
  role_key: z2.string().max(40),
  unit_id: z2.number().int().nullable().optional(),
  active: z2.boolean().optional()
});
router2.post("/users", need("usuarios.gerenciar"), h(async (req, res) => {
  const b = parse(userSchema, req.body);
  if (await roleLevel(req.ctx.companyId, b.role_key) > req.ctx.level) throw forbidden("N\xE3o \xE9 poss\xEDvel criar usu\xE1rio com perfil acima do seu");
  if (!b.password) throw bad("Informe a senha inicial");
  checkPassword(b.password);
  if (b.unit_id) await ownUnit(req.ctx.companyId, b.unit_id);
  const ex = await q("select 1 from users where lower(email) = $1", [b.email]);
  if (ex.rows[0]) throw conflict("E-mail j\xE1 cadastrado");
  const r = await q(
    `insert into users (company_id, name, email, password_hash, role_key, unit_id) values ($1,$2,$3,$4,$5,$6) returning id`,
    [req.ctx.companyId, b.name, b.email, await bcrypt2.hash(b.password, 12), b.role_key, b.unit_id ?? null]
  );
  await audit({ query: q }, req.ctx, "usuario.criado", { entity: "user", entityId: r.rows[0].id, data: { role: b.role_key } });
  await enqueueHub({ query: q }, req.ctx.companyId, "tenant.updated");
  res.status(201).json({ id: r.rows[0].id });
}));
router2.put("/users/:id", need("usuarios.gerenciar"), h(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(userSchema.partial(), req.body);
  const cur = await q(`select u.*, r.level from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                       where u.id = $1 and u.company_id = $2`, [id, req.ctx.companyId]);
  const u = cur.rows[0];
  if (!u) throw notFound("Usu\xE1rio n\xE3o encontrado");
  if (u.level > req.ctx.level || u.level === req.ctx.level && u.id !== req.ctx.userId && req.ctx.role !== "owner")
    throw forbidden("N\xE3o \xE9 poss\xEDvel alterar usu\xE1rio de n\xEDvel igual ou superior");
  if (b.role_key && await roleLevel(req.ctx.companyId, b.role_key) > req.ctx.level) throw forbidden("Perfil acima do seu");
  if (u.role_key === "owner" && b.role_key && b.role_key !== "owner") {
    const owners = await q("select count(*)::int n from users where company_id = $1 and role_key = 'owner' and active", [req.ctx.companyId]);
    if (owners.rows[0].n <= 1) throw bad("A empresa precisa de ao menos um propriet\xE1rio ativo");
  }
  if (b.unit_id) await ownUnit(req.ctx.companyId, b.unit_id);
  let hash = null;
  if (b.password) {
    checkPassword(b.password);
    hash = await bcrypt2.hash(b.password, 12);
  }
  await q(
    `update users set name = coalesce($3, name), email = coalesce($4, email), role_key = coalesce($5, role_key),
             unit_id = case when $6::boolean then $7 else unit_id end, active = coalesce($8, active),
             password_hash = coalesce($9, password_hash),
             password_changed_at = case when $9 is not null then now() else password_changed_at end
           where id = $1 and company_id = $2`,
    [id, req.ctx.companyId, b.name ?? null, b.email ?? null, b.role_key ?? null, "unit_id" in b, b.unit_id ?? null, b.active ?? null, hash]
  );
  if (b.active === false || hash) await q("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [id]);
  await audit({ query: q }, req.ctx, "usuario.alterado", { entity: "user", entityId: id, data: { ...b, password: b.password ? "alterada" : void 0 } });
  res.json({ ok: true });
}));
router2.get("/roles", need("usuarios.gerenciar"), h(async (req, res) => {
  const { rows } = await q("select key, name, level, permissions, system from roles where company_id = $1 order by level desc", [req.ctx.companyId]);
  res.json({ roles: rows, catalog: PERMISSIONS });
}));
router2.put("/roles/:key", need("usuarios.gerenciar"), h(async (req, res) => {
  const b = parse(z2.object({
    name: z2.string().trim().min(2).max(60).optional(),
    permissions: z2.array(z2.string()).max(200).optional(),
    level: z2.number().int().min(1).max(99).optional()
  }), req.body);
  const r = (await q("select * from roles where company_id = $1 and key = $2", [req.ctx.companyId, req.params.key])).rows[0];
  if (!r) throw notFound("Perfil n\xE3o encontrado");
  if (r.key === "owner") throw forbidden("O perfil Propriet\xE1rio n\xE3o pode ser alterado");
  if (r.level >= req.ctx.level) throw forbidden("S\xF3 \xE9 poss\xEDvel alterar perfis abaixo do seu n\xEDvel");
  if (b.level && b.level >= req.ctx.level) throw forbidden("N\xEDvel acima do seu");
  if (b.permissions) {
    const invalid = b.permissions.find((p) => !(p in PERMISSIONS));
    if (invalid) throw bad(`Permiss\xE3o inv\xE1lida: ${invalid}`);
    const notOwned = b.permissions.find((p) => !req.ctx.can(p));
    if (notOwned) throw forbidden(`Voc\xEA n\xE3o pode conceder o que n\xE3o tem: ${notOwned}`);
  }
  await q(
    "update roles set name = coalesce($3,name), permissions = coalesce($4,permissions), level = coalesce($5,level) where company_id = $1 and key = $2",
    [req.ctx.companyId, r.key, b.name ?? null, b.permissions ?? null, b.level ?? null]
  );
  await audit({ query: q }, req.ctx, "perfil.alterado", { entity: "role", entityId: r.key, data: { before: r.permissions, after: b.permissions } });
  res.json({ ok: true });
}));
router2.post("/roles", need("usuarios.gerenciar"), h(async (req, res) => {
  const b = parse(z2.object({ name: z2.string().trim().min(2).max(60), level: z2.number().int().min(1).max(99), permissions: z2.array(z2.string()).max(200) }), req.body);
  if (b.level >= req.ctx.level) throw forbidden("N\xEDvel acima do seu");
  const notOwned = b.permissions.find((p) => !(p in PERMISSIONS) || !req.ctx.can(p));
  if (notOwned) throw forbidden(`Permiss\xE3o inv\xE1lida ou n\xE3o conced\xEDvel: ${notOwned}`);
  const key2 = `custom_${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  await q("insert into roles (company_id, key, name, level, permissions) values ($1,$2,$3,$4,$5)", [req.ctx.companyId, key2, b.name, b.level, b.permissions]);
  await audit({ query: q }, req.ctx, "perfil.criado", { entity: "role", entityId: key2, data: b });
  res.status(201).json({ key: key2 });
}));
async function ownUnit(companyId, unitId) {
  const r = await q("select id from units where id = $1 and company_id = $2", [unitId, companyId]);
  if (!r.rows[0]) throw bad("Unidade inv\xE1lida");
}
router2.get("/units", h(async (req, res) => {
  res.json((await q("select id, name, active, day_cutoff, settings from units where company_id = $1 order by id", [req.ctx.companyId])).rows);
}));
router2.post("/units", need("configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z2.object({ name: z2.string().trim().min(2).max(80), day_cutoff: z2.number().int().min(0).max(12).default(5) }), req.body);
  const r = await q("insert into units (company_id, name, day_cutoff) values ($1,$2,$3) returning id", [req.ctx.companyId, b.name, b.day_cutoff]);
  await audit({ query: q }, req.ctx, "unidade.criada", { entity: "unit", entityId: r.rows[0].id, data: b });
  res.status(201).json({ id: r.rows[0].id });
}));
router2.put("/units/:id", need("configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z2.object({ name: z2.string().trim().min(2).max(80).optional(), day_cutoff: z2.number().int().min(0).max(12).optional(), active: z2.boolean().optional() }), req.body);
  const r = await q(
    "update units set name = coalesce($3,name), day_cutoff = coalesce($4,day_cutoff), active = coalesce($5,active) where id = $1 and company_id = $2 returning id",
    [Number(req.params.id), req.ctx.companyId, b.name ?? null, b.day_cutoff ?? null, b.active ?? null]
  );
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, "unidade.alterada", { entity: "unit", entityId: req.params.id, data: b });
  res.json({ ok: true });
}));
router2.get("/terminals", h(async (req, res) => {
  res.json((await q("select id, unit_id, name, active, settings from terminals where company_id = $1 order by id", [req.ctx.companyId])).rows);
}));
router2.post("/terminals", need("configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z2.object({ name: z2.string().trim().min(2).max(60), unit_id: z2.number().int() }), req.body);
  await ownUnit(req.ctx.companyId, b.unit_id);
  const r = await q("insert into terminals (company_id, unit_id, name) values ($1,$2,$3) returning id", [req.ctx.companyId, b.unit_id, b.name]);
  await audit({ query: q }, req.ctx, "terminal.criado", { entity: "terminal", entityId: r.rows[0].id, data: b });
  res.status(201).json({ id: r.rows[0].id });
}));
router2.put("/terminals/:id", need("configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z2.object({ name: z2.string().trim().min(2).max(60).optional(), active: z2.boolean().optional() }), req.body);
  const r = await q(
    "update terminals set name = coalesce($3,name), active = coalesce($4,active) where id = $1 and company_id = $2 returning id",
    [Number(req.params.id), req.ctx.companyId, b.name ?? null, b.active ?? null]
  );
  if (!r.rows[0]) throw notFound();
  res.json({ ok: true });
}));
var companySchema = z2.object({
  name: z2.string().trim().min(2).max(120),
  segment: z2.string().max(30),
  document: z2.string().max(20).nullable(),
  phone: z2.string().max(30).nullable(),
  email: z2.string().email().max(160).nullable(),
  timezone: z2.string().max(60),
  address: z2.record(z2.string(), z2.string().max(160)),
  appearance: z2.object({
    theme: z2.enum(["claro", "escuro", "auto"]).optional(),
    density: z2.enum(["confortavel", "compacta"]).optional(),
    menu: z2.enum(["lateral", "superior"]).optional(),
    accent: z2.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
  })
}).partial();
router2.get("/settings", h(async (req, res) => {
  const c = (await q("select id, name, segment, document, phone, email, timezone, address, settings from companies where id = $1", [req.ctx.companyId])).rows[0];
  res.json(c);
}));
router2.put("/settings", need("configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(companySchema, req.body);
  if (b.timezone) {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: b.timezone });
    } catch {
      throw bad("Fuso hor\xE1rio inv\xE1lido");
    }
  }
  await q(
    `update companies set name = coalesce($2,name), segment = coalesce($3,segment), document = coalesce($4,document),
             phone = coalesce($5,phone), email = coalesce($6,email), timezone = coalesce($7,timezone), address = coalesce($8,address),
             settings = case when $9::jsonb is null then settings else jsonb_set(settings, '{appearance}', $9::jsonb) end
           where id = $1`,
    [
      req.ctx.companyId,
      b.name ?? null,
      b.segment ?? null,
      b.document ?? null,
      b.phone ?? null,
      b.email ?? null,
      b.timezone ?? null,
      b.address ?? null,
      b.appearance ? JSON.stringify(b.appearance) : null
    ]
  );
  await audit({ query: q }, req.ctx, "configuracoes.empresa", { entity: "company", entityId: req.ctx.companyId, data: b });
  res.json({ ok: true });
}));
var pdvLayer = z2.object({
  scanner_enabled: z2.boolean(),
  mode: z2.enum(["manual", "continua", "dupla"]),
  double_read_mandatory: z2.boolean(),
  allow_manual: z2.boolean(),
  allow_manual_exception: z2.boolean(),
  exception_requires_manager: z2.boolean(),
  allow_mode_change: z2.boolean(),
  product_timeout_s: z2.number().int(),
  open_free_card_on_scan: z2.boolean(),
  feedback_sound: z2.boolean(),
  qty_per_scan: z2.number().int().min(1).max(100),
  max_qty_per_scan: z2.number().int().min(1).max(100),
  terminator: z2.enum(["Enter", "Tab"]),
  kitchen_send: z2.enum(["imediato", "lote"]),
  require_open_cash: z2.boolean(),
  service_fee_bp: z2.number().int().min(0).max(3e3),
  card_prefix: z2.string().regex(/^[A-Z0-9-]{1,8}$/)
}).partial();
router2.get("/pdv-settings", h(async (req, res) => {
  const unitId = Number(req.query.unit_id) || req.ctx.terminalUnitId || req.ctx.unitId || null;
  const c = await q("select settings->'pdv' as s from companies where id = $1", [req.ctx.companyId]);
  const u = unitId ? await q("select settings->'pdv' as s from units where id = $1 and company_id = $2", [unitId, req.ctx.companyId]) : { rows: [] };
  const tid = Number(req.query.terminal_id) || req.ctx.terminalId;
  const t = tid ? await q("select settings->'pdv' as s from terminals where id = $1 and company_id = $2", [tid, req.ctx.companyId]) : { rows: [] };
  res.json({
    company: c.rows[0]?.s || {},
    unit: u.rows[0]?.s || {},
    terminal: t.rows[0]?.s || {},
    effective: mergePdv(c.rows[0]?.s, u.rows[0]?.s, t.rows[0]?.s)
  });
}));
router2.put("/pdv-settings/:level", need("configuracoes.gerenciar"), h(async (req, res) => {
  const level = parse(z2.enum(["company", "unit", "terminal"]), req.params.level);
  const b = parse(pdvLayer, req.body?.settings);
  validatePdvLayer(b);
  const id = Number(req.body?.id);
  await tx(async (db) => {
    let before;
    if (level === "company") {
      before = (await db.query("select settings->'pdv' s, settings from companies where id = $1 for update", [req.ctx.companyId])).rows[0];
      const merged = { ...before.s || {}, ...b };
      validatePdvLayer(merged);
      await db.query("update companies set settings = jsonb_set(settings, '{pdv}', $2::jsonb) where id = $1", [req.ctx.companyId, JSON.stringify(merged)]);
    } else {
      const table = level === "unit" ? "units" : "terminals";
      before = (await db.query(`select settings->'pdv' s from ${table} where id = $1 and company_id = $2 for update`, [id, req.ctx.companyId])).rows[0];
      if (!before) throw notFound();
      const merged = { ...before.s || {}, ...b };
      validatePdvLayer(merged);
      await db.query(`update ${table} set settings = jsonb_set(settings, '{pdv}', $3::jsonb) where id = $1 and company_id = $2`, [id, req.ctx.companyId, JSON.stringify(merged)]);
    }
    await audit(db, req.ctx, "pdv.configuracao", { entity: level, entityId: id || req.ctx.companyId, data: { before: before?.s || {}, after: b } });
  });
  res.json({ ok: true, effective: await pdvSettings({ query: q }, req.ctx, req.ctx.terminalUnitId || req.ctx.unitId) });
}));
router2.get("/audit", need("auditoria.visualizar"), h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const params = [req.ctx.companyId];
  let where = "a.company_id = $1";
  if (req.query.action) {
    params.push(`${String(req.query.action)}%`);
    where += ` and a.action like $${params.length}`;
  }
  if (req.query.entity) {
    params.push(String(req.query.entity));
    where += ` and a.entity = $${params.length}`;
  }
  if (req.query.entity_id) {
    params.push(String(req.query.entity_id));
    where += ` and a.entity_id = $${params.length}`;
  }
  params.push(limit, offset);
  const { rows } = await q(
    `select a.id, a.action, a.entity, a.entity_id, a.reason, a.data, a.created_at, a.terminal_id, a.unit_id, u.name as user_name
       from audit_events a left join users u on u.id = a.user_id
      where ${where} order by a.id desc limit $${params.length - 1} offset $${params.length}`,
    params
  );
  if (req.query.format === "csv") {
    res.type("text/csv; charset=utf-8").attachment("auditoria.csv");
    return res.send(["data;usuario;acao;entidade;id;motivo", ...rows.map((r) => [r.created_at.toISOString(), r.user_name, r.action, r.entity, r.entity_id, r.reason].map(csvCell).join(
    ";"))].join("\n"));
  }
  res.json(rows);
}));
router2.post("/authorizations", h(async (req, res) => {
  const b = parse(z2.object({
    email: z2.string().trim().toLowerCase().max(160),
    password: z2.string().max(200),
    action: z2.enum(["excecao_dupla_leitura", "cancelar_item", "desconto", "alterar_preco", "reabrir_comanda", "cancelar_venda", "taxa_servico"]),
    reason: z2.string().trim().min(3).max(300)
  }), req.body);
  await rateLimit(`auth-mgr:${req.ctx.companyId}:${b.email}`, 5, 600);
  const requiredPerm = {
    excecao_dupla_leitura: "pdv.excecao_dupla_leitura",
    cancelar_item: "pdv.cancelar_item",
    desconto: "pdv.desconto",
    alterar_preco: "pdv.alterar_preco",
    reabrir_comanda: "pdv.reabrir_comanda",
    cancelar_venda: "pdv.cancelar_venda",
    taxa_servico: "pdv.taxa_servico"
  }[b.action];
  const { rows } = await q(`select u.id, u.password_hash, r.permissions from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                             where lower(u.email) = $1 and u.company_id = $2 and u.active`, [b.email, req.ctx.companyId]);
  const m = rows[0];
  const ok = m && await bcrypt2.compare(b.password, m.password_hash);
  if (!ok || !m.permissions.includes("pdv.autorizar") || !m.permissions.includes(requiredPerm)) {
    await audit({ query: q }, req.ctx, "autorizacao.negada", { data: { action: b.action, email: b.email } });
    throw forbidden("Autoriza\xE7\xE3o recusada: credenciais inv\xE1lidas ou sem permiss\xE3o para autorizar esta a\xE7\xE3o");
  }
  const token = randomToken(24);
  await q(
    `insert into manager_authorizations (company_id, requested_by, authorized_by, action, scope, token_hash, expires_at)
           values ($1,$2,$3,$4,$5,$6, now() + interval '2 minutes')`,
    [req.ctx.companyId, req.ctx.userId, m.id, b.action, { reason: b.reason, terminal: req.ctx.terminalId }, sha256(token)]
  );
  await audit({ query: q }, req.ctx, "autorizacao.concedida", { reason: b.reason, data: { action: b.action, authorized_by: m.id } });
  res.json({ authorization: token, expires_in: 120 });
}));
async function consumeAuthorization(db, ctx, token, action) {
  if (!token) throw forbidden("Esta a\xE7\xE3o exige autoriza\xE7\xE3o de um gerente", "authorization_required");
  const { rows } = await db.query(
    `update manager_authorizations set used_at = now()
      where token_hash = $1 and company_id = $2 and requested_by = $3 and action = $4 and used_at is null and expires_at > now()
      returning authorized_by, scope`,
    [sha256(token), ctx.companyId, ctx.userId, action]
  );
  if (!rows[0]) throw forbidden("Autoriza\xE7\xE3o gerencial inv\xE1lida, expirada ou j\xE1 utilizada");
  return rows[0];
}

// src/routes/menu.js
import { Router as Router3 } from "npm:express@5.2.1";
import { z as z3 } from "npm:zod@4.6.5";
var router3 = Router3();
router3.get("/categories", need("cardapio.visualizar"), h(async (req, res) => {
  res.json((await q("select id, name, sort, active, demo from categories where company_id = $1 order by sort, name", [req.ctx.companyId])).rows);
}));
router3.post("/categories", need("cardapio.gerenciar"), h(async (req, res) => {
  const b = parse(z3.object({ name: z3.string().trim().min(1).max(80), sort: z3.number().int().default(0) }), req.body);
  const r = await q("insert into categories (company_id, name, sort) values ($1,$2,$3) returning id", [req.ctx.companyId, b.name, b.sort]);
  res.status(201).json({ id: r.rows[0].id });
}));
router3.put("/categories/:id", need("cardapio.gerenciar"), h(async (req, res) => {
  const b = parse(z3.object({ name: z3.string().trim().min(1).max(80), sort: z3.number().int(), active: z3.boolean() }).partial(), req.body);
  const r = await q(
    "update categories set name = coalesce($3,name), sort = coalesce($4,sort), active = coalesce($5,active) where id = $1 and company_id = $2 returning id",
    [Number(req.params.id), req.ctx.companyId, b.name ?? null, b.sort ?? null, b.active ?? null]
  );
  if (!r.rows[0]) throw notFound();
  res.json({ ok: true });
}));
router3.get("/sectors", h(async (req, res) => {
  res.json((await q("select id, name, active from production_sectors where company_id = $1 order by id", [req.ctx.companyId])).rows);
}));
router3.post("/sectors", need("cardapio.gerenciar"), h(async (req, res) => {
  const b = parse(z3.object({ name: z3.string().trim().min(2).max(60) }), req.body);
  const r = await q("insert into production_sectors (company_id, name) values ($1,$2) returning id", [req.ctx.companyId, b.name]);
  res.status(201).json({ id: r.rows[0].id });
}));
router3.get("/products", need("cardapio.visualizar"), h(async (req, res) => {
  const params = [req.ctx.companyId];
  let where = "p.company_id = $1";
  if (req.query.active !== "all") where += " and p.active";
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 60)}%`, normalizeCode(req.query.q));
    where += ` and (p.name ilike $${params.length - 1} or p.sku = $${params.length} or exists (select 1 from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO'\
 and s.entity_id = p.id and s.code = $${params.length}))`;
  }
  if (req.query.category_id) {
    params.push(Number(req.query.category_id));
    where += ` and p.category_id = $${params.length}`;
  }
  const showCost = req.ctx.can("relatorios.cmv") || req.ctx.can("cardapio.gerenciar");
  const { rows } = await q(
    `select p.id, p.name, p.description, p.sku, p.kind, p.unit, p.price_cents, ${showCost ? "p.cost_cents," : ""} p.favorite, p.active, p.demo,
            p.category_id, p.sector_id, p.channels, p.allergens,
            coalesce((select array_agg(s.code order by s.id) from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.entity_id = p.id), '{}') as codes,
            coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
               'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                             from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id)
               from modifier_groups g where g.product_id = p.id), '[]') as groups
       from products p where ${where} order by p.favorite desc, p.name limit 500`,
    params
  );
  res.json(rows);
}));
var productSchema = z3.object({
  name: z3.string().trim().min(1).max(120),
  description: z3.string().max(500).nullable().optional(),
  sku: z3.string().trim().max(40).nullable().optional(),
  kind: z3.enum(["resale", "recipe", "produced", "combo", "addon", "weight"]).default("resale"),
  unit: z3.enum(["un", "kg", "g", "L", "ml"]).default("un"),
  price_cents: z3.number().int().min(0).max(1e8),
  cost_cents: z3.number().int().min(0).max(1e8).default(0),
  category_id: z3.number().int().nullable().optional(),
  sector_id: z3.number().int().nullable().optional(),
  favorite: z3.boolean().default(false),
  active: z3.boolean().default(true),
  channels: z3.array(z3.enum(["pdv", "delivery", "cardapio_digital"])).default(["pdv"]),
  allergens: z3.string().max(500).nullable().optional(),
  codes: z3.array(z3.string().max(128)).max(20).default([]),
  groups: z3.array(z3.object({
    name: z3.string().trim().min(1).max(60),
    min: z3.number().int().min(0).max(20),
    max: z3.number().int().min(1).max(20),
    options: z3.array(z3.object({ name: z3.string().trim().min(1).max(60), price_cents: z3.number().int().min(0).max(1e6) })).min(1).max(40)
  })).max(10).optional()
});
async function checkRefs(db, companyId, b) {
  if (b.category_id) {
    const r = await db.query("select 1 from categories where id = $1 and company_id = $2", [b.category_id, companyId]);
    if (!r.rows[0]) throw bad("Categoria inv\xE1lida");
  }
  if (b.sector_id) {
    const r = await db.query("select 1 from production_sectors where id = $1 and company_id = $2", [b.sector_id, companyId]);
    if (!r.rows[0]) throw bad("Setor inv\xE1lido");
  }
  if (b.kind === "weight" && b.unit === "un") throw bad("Produto por peso precisa de unidade kg ou g");
  for (const g of b.groups || []) if (g.min > g.max) throw bad(`Grupo ${g.name}: m\xEDnimo maior que m\xE1ximo`);
}
async function saveGroups(db, companyId, productId, groups) {
  if (!groups) return;
  await db.query("delete from modifier_groups where product_id = $1 and company_id = $2", [productId, companyId]);
  let sort = 0;
  for (const g of groups) {
    const r = await db.query(
      "insert into modifier_groups (company_id, product_id, name, min_select, max_select, sort) values ($1,$2,$3,$4,$5,$6) returning id",
      [companyId, productId, g.name, g.min, g.max, sort++]
    );
    for (const o of g.options)
      await db.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)", [companyId, r.rows[0].id, o.name, o.price_cents]);
  }
}
router3.post("/products", need("cardapio.gerenciar"), h(async (req, res) => {
  const b = parse(productSchema, req.body);
  const id = await tx(async (db) => {
    await checkRefs(db, req.ctx.companyId, b);
    const r = await db.query(
      `insert into products (company_id, name, description, sku, kind, unit, price_cents, cost_cents, category_id, sector_id, favorite, active, channels, allergens)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [
        req.ctx.companyId,
        b.name,
        b.description ?? null,
        b.sku || null,
        b.kind,
        b.unit,
        b.price_cents,
        b.cost_cents,
        b.category_id ?? null,
        b.sector_id ?? null,
        b.favorite,
        b.active,
        b.channels,
        b.allergens ?? null
      ]
    );
    const pid = r.rows[0].id;
    for (const c of b.codes) await registerCode(db, req.ctx.companyId, c, "PRODUTO", pid);
    await saveGroups(db, req.ctx.companyId, pid, b.groups);
    await db.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)", [req.ctx.companyId, pid, b.price_cents, req.
    ctx.userId]);
    await audit(db, req.ctx, "produto.criado", { entity: "product", entityId: pid, data: { name: b.name, price_cents: b.price_cents } });
    return pid;
  }).catch((e) => {
    if (e.code === "23505") throw conflict("SKU j\xE1 usado em outro produto");
    throw e;
  });
  res.status(201).json({ id });
}));
router3.put("/products/:id", need("cardapio.gerenciar"), h(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(productSchema.partial(), req.body);
  await tx(async (db) => {
    const cur = (await db.query("select * from products where id = $1 and company_id = $2 for update", [id, req.ctx.companyId])).rows[0];
    if (!cur) throw notFound("Produto n\xE3o encontrado");
    await checkRefs(db, req.ctx.companyId, { ...cur, ...b });
    const next = { ...cur, ...b };
    await db.query(
      `update products set name=$3, description=$4, sku=$5, kind=$6, unit=$7, price_cents=$8, cost_cents=$9, category_id=$10, sector_id=$11,
         favorite=$12, active=$13, channels=$14, allergens=$15, updated_at=now() where id=$1 and company_id=$2`,
      [
        id,
        req.ctx.companyId,
        next.name,
        next.description,
        next.sku || null,
        next.kind,
        next.unit,
        next.price_cents,
        next.cost_cents,
        next.category_id,
        next.sector_id,
        next.favorite,
        next.active,
        next.channels,
        next.allergens
      ]
    );
    if (b.price_cents != null && b.price_cents !== cur.price_cents) {
      await db.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,$3,$4,$5)", [req.ctx.companyId, id, cur.price_cents, b.
      price_cents, req.ctx.userId]);
      await audit(db, req.ctx, "produto.preco", { entity: "product", entityId: id, data: { before: cur.price_cents, after: b.price_cents } });
    }
    if (b.codes) {
      const keep = b.codes.map(normalizeCode).filter(Boolean);
      await db.query("delete from scan_codes where company_id = $1 and entity = 'PRODUTO' and entity_id = $2 and not (code = any($3))", [req.ctx.companyId, id, keep]);
      for (const c of keep) await registerCode(db, req.ctx.companyId, c, "PRODUTO", id);
    }
    await saveGroups(db, req.ctx.companyId, id, b.groups);
    await audit(db, req.ctx, "produto.alterado", { entity: "product", entityId: id, data: { ...b, groups: b.groups ? "alterados" : void 0 } });
  }).catch((e) => {
    if (e.code === "23505") throw conflict("SKU j\xE1 usado em outro produto");
    throw e;
  });
  res.json({ ok: true });
}));
router3.get("/products/:id/prices", need("cardapio.visualizar"), h(async (req, res) => {
  res.json((await q(`select h.old_cents, h.new_cents, h.created_at, u.name as user_name from product_price_history h left join users u on u.id = h.user_id
                      where h.product_id = $1 and h.company_id = $2 order by h.id desc`, [Number(req.params.id), req.ctx.companyId])).rows);
}));
router3.delete("/demo", need("configuracoes.gerenciar"), h(async (req, res) => {
  const out = await tx(async (db) => {
    const used = await db.query(`select distinct product_id from order_items where company_id = $1`, [req.ctx.companyId]);
    const usedIds = used.rows.map((r) => r.product_id);
    const deact = await db.query("update products set active = false, name = name where company_id = $1 and demo and id = any($2) returning id", [req.ctx.companyId, usedIds]);
    await db.query("delete from scan_codes where company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo and not (id = any($\
2)))", [req.ctx.companyId, usedIds]);
    await db.query("delete from product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 and demo and not (id = any($2)))", [req.
    ctx.companyId, usedIds]);
    const del = await db.query("delete from products where company_id = $1 and demo and not (id = any($2)) returning id", [req.ctx.companyId, usedIds]);
    await db.query("delete from categories c where c.company_id = $1 and c.demo and not exists (select 1 from products p where p.category_id = c.id)", [req.ctx.companyId]);
    await audit(db, req.ctx, "demonstracao.removida", { data: { removed: del.rowCount, deactivated: deact.rowCount } });
    return { removed: del.rowCount, deactivated: deact.rowCount };
  });
  res.json(out);
}));

// src/routes/floor.js
import { Router as Router4 } from "npm:express@5.2.1";
import { z as z4 } from "npm:zod@4.6.5";
var router4 = Router4();
var unitOf = (req) => Number(req.query.unit_id || req.body?.unit_id) || req.ctx.terminalUnitId || req.ctx.unitId;
async function defaultUnit(req) {
  const u = unitOf(req);
  if (u) {
    assertUnitScope(req.ctx, u);
    return u;
  }
  return (await q("select id from units where company_id = $1 and active order by id limit 1", [req.ctx.companyId])).rows[0]?.id;
}
router4.get("/tables", need("salao.visualizar"), h(async (req, res) => {
  const unitId = await defaultUnit(req);
  const showMoney = req.ctx.can("pdv.receber") || req.ctx.can("financeiro.visualizar") || req.ctx.can("pdv.lancar");
  const { rows } = await q(
    `select t.id, t.number, t.area, t.capacity, t.status, t.pos_x, t.pos_y, t.active,
            (select code from scan_codes s where s.company_id = t.company_id and s.entity = 'MESA' and s.entity_id = t.id limit 1) as code,
            (select count(*)::int from consumption_sessions s where s.table_id = t.id and s.status in ('aberta','em_fechamento')) as open_sessions,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status in ('novo','aceito','preparando')) as preparing,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status = 'pronto') as ready,
            (select string_agg(coalesce(s.customer_name, ''), ', ') filter (where s.customer_name is not null) from consumption_sessions s
              where s.table_id = t.id and s.status in ('aberta','em_fechamento')) as customer_names
            ${showMoney ? `, (select coalesce(sum(i.total_cents),0)::bigint from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo') as consumed_cents` : ""}
       from dining_tables t where t.company_id = $1 and t.unit_id = $2 and t.active order by t.number`,
    [req.ctx.companyId, unitId]
  );
  res.json({ unitId, tables: rows });
}));
router4.post("/tables", need("salao.gerenciar"), h(async (req, res) => {
  const b = parse(z4.object({ from: z4.number().int().min(1).max(9999), count: z4.number().int().min(1).max(200), area: z4.string().max(40).default("Sal\xE3o"), capacity: z4.number().
  int().min(1).max(50).default(4) }), req.body);
  const unitId = await defaultUnit(req);
  const ids = await tx(async (db) => {
    const created = await createTables(db, req.ctx.companyId, unitId, b.from, b.count);
    if (created.length) await db.query("update dining_tables set area = $2, capacity = $3 where id = any($1)", [created, b.area, b.capacity]);
    await audit(db, req.ctx, "mesas.criadas", { unitId, data: { from: b.from, count: created.length } });
    return created;
  });
  res.status(201).json({ created: ids.length });
}));
router4.put("/tables/:id", need("salao.visualizar"), h(async (req, res) => {
  const b = parse(z4.object({
    status: z4.enum(["livre", "ocupada", "reservada", "conta", "limpeza"]).optional(),
    area: z4.string().max(40).optional(),
    capacity: z4.number().int().min(1).max(50).optional(),
    pos_x: z4.number().int().min(0).max(40).optional(),
    pos_y: z4.number().int().min(0).max(40).optional(),
    active: z4.boolean().optional()
  }), req.body);
  const structural = ["area", "capacity", "pos_x", "pos_y", "active"].some((k) => k in b);
  if (structural && !req.ctx.can("salao.gerenciar")) throw bad("Sem permiss\xE3o para alterar a estrutura do sal\xE3o");
  if (b.status && !req.ctx.can("salao.gerenciar") && !req.ctx.can("pdv.lancar")) throw bad("Sem permiss\xE3o para mudar a situa\xE7\xE3o da mesa");
  if (b.status === "livre") {
    const open = await q("select 1 from consumption_sessions where table_id = $1 and company_id = $2 and status in ('aberta','em_fechamento')", [Number(req.params.id), req.ctx.companyId]);
    if (open.rows[0]) throw conflict("Mesa com consumo aberto n\xE3o pode ser liberada");
  }
  const r = await q(
    `update dining_tables set status = coalesce($3,status), area = coalesce($4,area), capacity = coalesce($5,capacity),
                       pos_x = coalesce($6,pos_x), pos_y = coalesce($7,pos_y), active = coalesce($8,active) where id = $1 and company_id = $2 returning unit_id`,
    [Number(req.params.id), req.ctx.companyId, b.status ?? null, b.area ?? null, b.capacity ?? null, b.pos_x ?? null, b.pos_y ?? null, b.active ?? null]
  );
  if (!r.rows[0]) throw notFound("Mesa n\xE3o encontrada");
  await audit({ query: q }, req.ctx, "mesa.alterada", { entity: "table", entityId: req.params.id, data: b });
  res.json({ ok: true });
}));
router4.get("/cards", need("pdv.lancar"), h(async (req, res) => {
  const unitId = await defaultUnit(req);
  const { rows } = await q(
    `select c.id, c.number, c.status, c.block_reason,
            (select code from scan_codes s where s.company_id = c.company_id and s.entity = 'COMANDA' and s.entity_id = c.id order by s.id limit 1) as code,
            s.id as session_id, s.customer_name, s.opened_at, s.status as session_status, t.number as table_number,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count,
            (select coalesce(sum(i.total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
            s.customer_id,
            (select sum(a.amount_cents)::bigint from customer_account a where a.company_id = c.company_id and a.customer_id = s.customer_id) as account_cents
       from tab_cards c
       left join lateral (select * from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') order by s.id desc limit 1) s on true
       left join dining_tables t on t.id = s.table_id
      where c.company_id = $1 and c.unit_id = $2 order by c.number`,
    [req.ctx.companyId, unitId]
  );
  res.json({ unitId, cards: rows });
}));
router4.post("/cards", need("comandas.gerenciar"), h(async (req, res) => {
  const b = parse(z4.object({ from: z4.number().int().min(1).max(999999), count: z4.number().int().min(1).max(1e3) }), req.body);
  const unitId = await defaultUnit(req);
  const created = await tx(async (db) => {
    const prefix = (await db.query("select coalesce(settings->'pdv'->>'card_prefix','CMD-') p from companies where id = $1", [req.ctx.companyId])).rows[0].p;
    const c = await createCards(db, req.ctx.companyId, unitId, b.from, b.count, prefix);
    await audit(db, req.ctx, "comandas.geradas", { unitId, data: { from: b.from, count: c.length } });
    return c;
  });
  res.status(201).json({ created });
}));
router4.post("/cards/:id/block", need("comandas.gerenciar"), h(async (req, res) => {
  const b = parse(z4.object({ reason: z4.string().trim().min(3).max(200) }), req.body);
  const r = await q("update tab_cards set status = 'bloqueado', block_reason = $3 where id = $1 and company_id = $2 returning id", [Number(req.params.id), req.ctx.companyId, b.reason]);
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, "comanda.bloqueada", { entity: "card", entityId: req.params.id, reason: b.reason });
  res.json({ ok: true });
}));
router4.post("/cards/:id/unblock", need("comandas.gerenciar"), h(async (req, res) => {
  const r = await q("update tab_cards set status = 'ativo', block_reason = null where id = $1 and company_id = $2 returning id", [Number(req.params.id), req.ctx.companyId]);
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, "comanda.desbloqueada", { entity: "card", entityId: req.params.id });
  res.json({ ok: true });
}));
router4.post("/cards/:id/replace", need("comandas.gerenciar"), h(async (req, res) => {
  const b = parse(z4.object({ new_card_id: z4.number().int(), reason: z4.string().trim().min(3).max(200) }), req.body);
  await tx(async (db) => {
    const old = (await db.query("select * from tab_cards where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    const neu = (await db.query("select * from tab_cards where id = $1 and company_id = $2 for update", [b.new_card_id, req.ctx.companyId])).rows[0];
    if (!old || !neu) throw notFound("Cart\xE3o n\xE3o encontrado");
    if (neu.status !== "ativo") throw bad("O novo cart\xE3o est\xE1 bloqueado");
    if (old.unit_id !== neu.unit_id) throw bad("Cart\xF5es de unidades diferentes");
    const busy = await db.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento')", [neu.id]);
    if (busy.rows[0]) throw conflict("O novo cart\xE3o j\xE1 tem consumo em aberto");
    await db.query("update tab_cards set status = 'bloqueado', block_reason = $2 where id = $1", [old.id, `Substitu\xEDdo pelo ${neu.number}: ${b.reason}`]);
    const s = await db.query("update consumption_sessions set card_id = $2, version = version + 1 where card_id = $1 and status in ('aberta','em_fechamento') returning id", [old.id,
    neu.id]);
    await audit(db, req.ctx, "comanda.substituida", { entity: "card", entityId: old.id, reason: b.reason, data: { new_card: neu.id, session: s.rows[0]?.id ?? null } });
  });
  res.json({ ok: true });
}));

// src/routes/pdv.js
import { Router as Router5 } from "npm:express@5.2.1";
import { z as z5 } from "npm:zod@4.6.5";

// src/lib/stock.js
var STOCK_DEFAULTS = { enabled: true, allow_negative: true, correction_limit_cents: 5e3, correction_max_pct: 20, correction_expire_days: 7 };
var stockConfig = (settings) => ({ ...STOCK_DEFAULTS, ...settings?.stock || {} });
async function balances(db, companyId, ids) {
  const r = await db.query(`select stock_item_id, coalesce(sum(qty),0)::numeric as qty from stock_movements
    where company_id = $1 ${ids ? "and stock_item_id = any($2)" : ""} group by stock_item_id`, ids ? [companyId, ids] : [companyId]);
  return Object.fromEntries(r.rows.map((x) => [x.stock_item_id, Number(x.qty)]));
}
var round4 = (n) => Math.round(n * 1e4) / 1e4;
async function requirements(db, companyId, product, qty, optionIds = []) {
  const need2 = /* @__PURE__ */ new Map();
  const add = (id, n) => need2.set(Number(id), round4((need2.get(Number(id)) || 0) + n));
  if (product.stock_mode === "acabado" && product.stock_item_id) add(product.stock_item_id, Number(qty));
  if (product.stock_mode === "ficha") {
    const lines = (await db.query(`select l.stock_item_id, l.qty, l.loss_pct, r.yield_qty from recipes r join recipe_lines l on l.recipe_id = r.id
      where r.company_id = $1 and r.product_id = $2 and r.active`, [companyId, product.id])).rows;
    for (const l of lines) add(l.stock_item_id, Number(l.qty) * (1 + Number(l.loss_pct) / 100) / Number(l.yield_qty) * Number(qty));
  }
  if (optionIds.length) {
    const ops = (await db.query(
      "select stock_item_id, stock_qty from modifier_options where company_id = $1 and id = any($2) and stock_item_id is not null and stock_qty > 0",
      [companyId, optionIds]
    )).rows;
    for (const o of ops) add(o.stock_item_id, Number(o.stock_qty) * Number(qty));
  }
  return need2;
}
async function consumeForItem(db, ctx, item, product, optionIds) {
  const c = (await db.query("select settings from companies where id = $1", [ctx.companyId])).rows[0];
  const cfg = stockConfig(c.settings);
  if (!cfg.enabled) return [];
  const need2 = await requirements(db, ctx.companyId, product, item.qty, optionIds);
  if (!need2.size) return [];
  const ids = [...need2.keys()];
  const items = (await db.query("select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2) order by id for update", [ctx.companyId, ids])).rows;
  if (!cfg.allow_negative) {
    const bal = await balances(db, ctx.companyId, ids);
    for (const s of items) {
      if ((bal[s.id] || 0) - need2.get(Number(s.id)) < -1e-4)
        throw conflict(`Estoque insuficiente de ${s.name} (saldo ${(bal[s.id] || 0).toLocaleString("pt-BR")} ${s.unit})`, "stock_insufficient");
    }
  }
  const out = [];
  for (const s of items) {
    const r = await db.query(
      `insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, user_id)
      values ($1,$2,'venda',$3,$4,'order_item',$5,$6) on conflict do nothing returning id`,
      [ctx.companyId, s.id, -need2.get(Number(s.id)), s.avg_cost_cents, item.id, ctx.userId]
    );
    if (r.rows[0]) out.push(r.rows[0].id);
  }
  return out;
}
async function reverseForItem(db, ctx, itemId, reason) {
  const mv = (await db.query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'order_item' and m.ref_id = $2 and m.kind = 'venda'
    and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`, [ctx.companyId, itemId])).rows;
  for (const m of mv) {
    await db.query(
      `insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
      values ($1,$2,'estorno_venda',$3,$4,'order_item_rev',$5,$6,$7,$8)`,
      [ctx.companyId, m.stock_item_id, -Number(m.qty), m.unit_cost_cents, itemId, m.id, reason, ctx.userId]
    );
  }
  return mv.length;
}
async function receive(db, ctx, stockItemId, qty, unitCostCents, ref, reason) {
  const s = (await db.query("select avg_cost_cents from stock_items where id = $1 and company_id = $2 for update", [stockItemId, ctx.companyId])).rows[0];
  const bal = (await balances(db, ctx.companyId, [stockItemId]))[stockItemId] || 0;
  const prevQty = Math.max(0, bal);
  const avg = prevQty + qty > 0 ? (prevQty * Number(s.avg_cost_cents) + qty * unitCostCents) / (prevQty + qty) : unitCostCents;
  await db.query("update stock_items set avg_cost_cents = $3 where id = $1 and company_id = $2", [stockItemId, ctx.companyId, round4(avg)]);
  await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
    values ($1,$2,'entrada',$3,$4,$5,$6,$7,$8)`, [ctx.companyId, stockItemId, qty, unitCostCents, ref?.type ?? null, ref?.id ?? null, reason ?? null, ctx.userId]);
}
async function theoreticalCost(db, companyId, product) {
  const need2 = await requirements(db, companyId, product, 1, []);
  if (!need2.size) return Number(product.cost_cents || 0);
  const r = (await db.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2)", [companyId, [...need2.keys()]])).rows;
  return Math.round(r.reduce((s, x) => s + Number(x.avg_cost_cents) * need2.get(Number(x.id)), 0));
}

// src/lib/customers.js
var onlyDigits = (s) => String(s ?? "").replace(/\D/g, "");
function validCpf(raw) {
  const c = onlyDigits(raw);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = sum * 10 % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
function normalizeCpf(raw, { required = false } = {}) {
  const c = onlyDigits(raw);
  if (!c) {
    if (required) throw bad("Informe o CPF");
    return null;
  }
  if (!validCpf(c)) throw bad("CPF inv\xE1lido", "invalid_cpf");
  return c;
}
var fmtCpf = (c) => c ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : null;
var maskCpf = (c) => c ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : null;
var maskPhone = (p) => p ? p.replace(/\d(?=\d{4})/g, "*") : null;
var maskEmail = (e) => e ? e.replace(/^(.).*(@.*)$/, "$1***$2") : null;
function presentCustomer(c, ctx) {
  if (!c) return c;
  const full = ctx.can("dados.pessoais");
  return {
    id: c.id,
    name: c.name,
    cpf: full ? fmtCpf(c.cpf) : maskCpf(c.cpf),
    phone: full ? c.phone : maskPhone(c.phone),
    email: full ? c.email : maskEmail(c.email),
    birthday: full ? c.birthday : null,
    address: full ? c.address : {},
    tags: c.tags,
    preferences: c.preferences,
    notes: c.notes,
    consent_whatsapp: c.consent_whatsapp,
    consent_email: c.consent_email,
    unsubscribed: !!c.unsubscribed_at,
    points: c.points,
    anonymized: !!c.anonymized_at,
    created_at: c.created_at,
    masked: !full,
    ...c.visits != null ? { visits: c.visits, spent_cents: c.spent_cents, last_visit: c.last_visit } : {}
  };
}
var loyaltyConfig = (settings) => ({
  enabled: false,
  cents_per_point: 100,
  point_value_cents: 5,
  validity_days: 365,
  min_redeem: 100,
  ...settings?.loyalty || {}
});
async function addLedger(db, companyId, customerId, entry) {
  const r = await db.query(
    `insert into loyalty_ledger (company_id, customer_id, session_id, kind, points, expires_at, reason, reverses_id, payment_id, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [
      companyId,
      customerId,
      entry.session_id ?? null,
      entry.kind,
      entry.points,
      entry.expires_at ?? null,
      entry.reason ?? null,
      entry.reverses_id ?? null,
      entry.payment_id ?? null,
      entry.user_id ?? null
    ]
  );
  await db.query("update customers set points = points + $3, updated_at = now() where id = $1 and company_id = $2", [customerId, companyId, entry.points]);
  return r.rows[0];
}
async function expirePoints(db, companyId, customerId) {
  const r = await db.query(
    `select
       coalesce(sum(l.points) filter (where (l.kind = 'ganho' or o.kind = 'ganho') and coalesce(l.expires_at, o.expires_at) < current_date), 0)::int as vencidos,
       coalesce(-sum(l.points) filter (where l.kind in ('resgate','expiracao') or (l.kind = 'ajuste' and l.points < 0) or o.kind = 'resgate'), 0)::int as usados
     from loyalty_ledger l left join loyalty_ledger o on o.id = l.reverses_id
     where l.company_id = $1 and l.customer_id = $2`,
    [companyId, customerId]
  );
  const { vencidos, usados } = r.rows[0];
  const expire = vencidos - usados;
  if (expire > 0) await addLedger(db, companyId, customerId, { kind: "expiracao", points: -expire, reason: "Pontos vencidos" });
}
async function earnPoints(db, ctx, session, itemsCents) {
  if (!session.customer_id) return null;
  const c = (await db.query("select settings from companies where id = $1", [ctx.companyId])).rows[0];
  const cfg = loyaltyConfig(c.settings);
  if (!cfg.enabled) return null;
  const pts = Math.floor(itemsCents / Math.max(1, cfg.cents_per_point));
  if (pts <= 0) return null;
  const prior = await db.query(`select 1 from loyalty_ledger where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = loyalty_ledger.id)`, [ctx.companyId, session.id]);
  if (prior.rows[0]) return null;
  const expires = new Date(Date.now() + cfg.validity_days * 864e5).toISOString().slice(0, 10);
  return addLedger(db, ctx.companyId, session.customer_id, {
    session_id: session.id,
    kind: "ganho",
    points: pts,
    expires_at: expires,
    reason: `Consumo ${session.id}`,
    user_id: ctx.userId
  });
}
async function reverseEarn(db, ctx, sessionId, reason) {
  const g = (await db.query(`select * from loyalty_ledger l where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = l.id)`, [ctx.companyId, sessionId])).rows[0];
  if (!g) return null;
  return addLedger(db, ctx.companyId, g.customer_id, {
    session_id: sessionId,
    kind: "estorno",
    points: -g.points,
    reverses_id: g.id,
    reason,
    user_id: ctx.userId
  });
}
async function redeemPoints(db, ctx, customerId, points, paymentId, sessionId) {
  const c = (await db.query("select points from customers where id = $1 and company_id = $2 for update", [customerId, ctx.companyId])).rows[0];
  if (!c) throw bad("Cliente n\xE3o encontrado");
  if (c.points < points) throw conflict(`Saldo insuficiente: ${c.points} pontos`, "insufficient_points");
  return addLedger(db, ctx.companyId, customerId, {
    session_id: sessionId,
    kind: "resgate",
    points: -points,
    payment_id: paymentId,
    reason: `Resgate no consumo ${sessionId}`,
    user_id: ctx.userId
  });
}
async function reverseRedeemByPayment(db, ctx, paymentId) {
  const r = (await db.query(`select * from loyalty_ledger l where company_id = $1 and payment_id = $2 and kind = 'resgate'
    and not exists (select 1 from loyalty_ledger x where x.reverses_id = l.id)`, [ctx.companyId, paymentId])).rows[0];
  if (!r) return null;
  return addLedger(db, ctx.companyId, r.customer_id, {
    session_id: r.session_id,
    kind: "estorno",
    points: -r.points,
    reverses_id: r.id,
    reason: "Pagamento com pontos estornado",
    user_id: ctx.userId
  });
}

// src/lib/account.js
var ACCOUNT_KINDS = { credito: "Cr\xE9dito lan\xE7ado", uso_credito: "Uso de cr\xE9dito", fiado: "Fiado", pagamento_fiado: "Pagamento de fiado", estorno: "Estorno", ajuste: "Ajuste" };
async function accountSummary(db, companyId, customerId) {
  const r = (await db.query(`select coalesce(sum(amount_cents),0)::bigint as balance,
      min(created_at) filter (where kind = 'fiado') as first_fiado, max(created_at) as last_entry
    from customer_account where company_id = $1 and customer_id = $2`, [companyId, customerId])).rows[0];
  const balance = Number(r.balance);
  let openSince = null;
  if (balance < 0) {
    const rows = (await db.query(`select amount_cents, created_at, kind from customer_account where company_id = $1 and customer_id = $2 order by id`, [companyId, customerId])).rows;
    let credit = rows.filter((x) => Number(x.amount_cents) > 0).reduce((s, x) => s + Number(x.amount_cents), 0);
    for (const x of rows) {
      if (Number(x.amount_cents) >= 0) continue;
      credit += Number(x.amount_cents);
      if (credit < 0) {
        openSince = x.created_at;
        break;
      }
    }
  }
  return { balance_cents: balance, credit_cents: Math.max(0, balance), debt_cents: Math.max(0, -balance), open_since: openSince, last_entry: r.last_entry };
}
async function chargeAccount(db, ctx, s, method, amount, paymentId) {
  if (!s.customer_id) throw conflict("Identifique o cliente pelo CPF na comanda para usar fiado ou cr\xE9dito", "customer_required");
  const c = (await db.query("select id, name, cpf, fiado_limit_cents, anonymized_at from customers where id = $1 and company_id = $2 for update", [s.customer_id, ctx.companyId])).rows[0];
  if (!c || c.anonymized_at) throw conflict("Cliente indispon\xEDvel", "customer_required");
  if (!c.cpf) throw conflict("Cadastre o CPF do cliente para lan\xE7ar fiado ou usar cr\xE9dito", "cpf_required");
  const acc = await accountSummary(db, ctx.companyId, c.id);
  let overLimit = false;
  if (method === "saldo_cliente") {
    if (amount > acc.credit_cents) throw conflict(`Cr\xE9dito dispon\xEDvel: R$ ${(acc.credit_cents / 100).toFixed(2).replace(".", ",")}`, "insufficient_credit");
  } else {
    const after = acc.balance_cents - amount;
    const limit = Number(c.fiado_limit_cents);
    if (-after > limit) {
      if (!ctx.can("pdv.autorizar")) {
        throw forbidden(`Fiado acima do limite do cliente (R$ ${(limit / 100).toFixed(2).replace(".", ",")}). Pe\xE7a a um gerente ou receba de outra forma.`, "fiado_limit");
      }
      overLimit = true;
    }
  }
  const kind = method === "fiado" ? "fiado" : "uso_credito";
  const e = (await db.query(
    `insert into customer_account (company_id, customer_id, kind, amount_cents, session_id, payment_id, over_limit, reason, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [ctx.companyId, c.id, kind, -amount, s.id, paymentId, overLimit, kind === "fiado" ? `Consumo #${s.id}` : `Uso de cr\xE9dito no consumo #${s.id}`, ctx.userId]
  )).rows[0];
  return { entry_id: e.id, over_limit: overLimit, customer_id: c.id, balance_after: acc.balance_cents - amount };
}
async function reverseAccountByPayment(db, ctx, paymentId, reason) {
  const e = (await db.query(`select * from customer_account a where company_id = $1 and payment_id = $2 and reverses_id is null
    and not exists (select 1 from customer_account x where x.reverses_id = a.id)`, [ctx.companyId, paymentId])).rows[0];
  if (!e) return null;
  await db.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, session_id, reverses_id, reason, user_id)
     values ($1,$2,'estorno',$3,$4,$5,$6,$7)`, [ctx.companyId, e.customer_id, -Number(e.amount_cents), e.session_id, e.id, reason || "Estorno do pagamento", ctx.userId]);
  return e.id;
}

// src/routes/pdv.js
var router5 = Router5();
async function unitCutoff(db, companyId, unitId) {
  const r = await db.query("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1 and u.company_id = $2", [unitId, companyId]);
  if (!r.rows[0]) throw bad("Unidade inv\xE1lida");
  return r.rows[0];
}
router5.post("/resolve", need("pdv.lancar"), h(async (req, res) => {
  const { code } = parse(z5.object({ code: z5.string().max(256) }), req.body);
  const r = await resolveCode({ query: q }, req.ctx.companyId, code);
  if (r.type === "DESCONHECIDO") await audit({ query: q }, req.ctx, "leitura.desconhecida", { data: { code: r.code.slice(0, 40) } });
  res.json(r);
}));
router5.get("/sessions", need("pdv.lancar"), h(async (req, res) => {
  const status = req.query.status === "all" ? null : ["aberta", "em_fechamento"];
  const params = [req.ctx.companyId];
  let where = "s.company_id = $1";
  if (status) {
    params.push(status);
    where += ` and s.status = any($${params.length})`;
  }
  const unit = Number(req.query.unit_id) || req.ctx.terminalUnitId || req.ctx.unitId;
  if (unit) {
    params.push(unit);
    where += ` and s.unit_id = $${params.length}`;
  }
  const { rows } = await q(
    `select s.id, s.kind, s.status, s.label, s.customer_name, s.opened_at, s.version, s.suspended, s.unit_id,
            c.number as card_number, t.number as table_number, s.table_id, s.card_id,
            (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
            (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = s.id and p.status = 'confirmado') as paid_cents,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
      where ${where} order by s.opened_at desc limit 300`,
    params
  );
  res.json(rows);
}));
var openSchema = z5.object({
  kind: z5.enum(["comanda", "mesa", "balcao", "retirada"]),
  card_id: z5.number().int().optional(),
  card_code: z5.string().max(128).optional(),
  table_id: z5.number().int().optional(),
  customer_name: z5.string().trim().max(80).optional(),
  customer_id: z5.number().int().optional(),
  label: z5.string().trim().max(60).optional(),
  unit_id: z5.number().int().optional()
});
async function openSession(db, ctx, b) {
  assertCan(ctx, "pdv.abrir_comanda");
  let unitId = b.unit_id || ctx.terminalUnitId || ctx.unitId;
  let cardId = null;
  let tableId = null;
  if (b.card_code && !b.card_id) {
    const r = await resolveCode(db, ctx.companyId, b.card_code);
    if (r.type !== "COMANDA") throw bad("C\xF3digo n\xE3o \xE9 de comanda");
    b.card_id = r.card.id;
  }
  if (b.card_id) {
    const c = (await db.query("select * from tab_cards where id = $1 and company_id = $2 for update", [b.card_id, ctx.companyId])).rows[0];
    if (!c) throw notFound("Comanda n\xE3o encontrada");
    if (c.status !== "ativo") throw conflict(`Comanda ${c.number} bloqueada${c.block_reason ? `: ${c.block_reason}` : ""}`, "card_blocked");
    const busy = await db.query("select id from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento')", [c.id]);
    if (busy.rows[0]) throw conflict(`Comanda ${c.number} j\xE1 est\xE1 em uso`, "card_busy", { session_id: busy.rows[0].id });
    cardId = c.id;
    unitId = c.unit_id;
  }
  if (b.table_id) {
    const t = (await db.query("select * from dining_tables where id = $1 and company_id = $2 and active", [b.table_id, ctx.companyId])).rows[0];
    if (!t) throw notFound("Mesa n\xE3o encontrada");
    if (unitId && t.unit_id !== unitId) throw bad("Mesa e comanda de unidades diferentes");
    tableId = t.id;
    unitId = t.unit_id;
  }
  if (b.customer_id) {
    const cu = (await db.query("select id, name from customers where id = $1 and company_id = $2 and anonymized_at is null", [b.customer_id, ctx.companyId])).rows[0];
    if (!cu) throw notFound("Cliente n\xE3o encontrado");
    b.customer_name = b.customer_name || cu.name;
  }
  if (b.kind === "comanda" && !cardId) throw bad("Informe a comanda");
  if (b.kind === "mesa" && !tableId) throw bad("Informe a mesa");
  if (!unitId) unitId = (await db.query("select id from units where company_id = $1 and active order by id limit 1", [ctx.companyId])).rows[0]?.id;
  assertUnitScope(ctx, unitId);
  const settings = await pdvSettings(db, ctx, unitId);
  const { day_cutoff, timezone } = await unitCutoff(db, ctx.companyId, unitId);
  const s = await db.query(
    `insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, customer_name, label, service_fee_bp, opened_by, business_date, customer_id, delivery_fee_cents\
)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [
      ctx.companyId,
      unitId,
      b.kind,
      cardId,
      tableId,
      b.customer_name ?? null,
      b.label ?? null,
      ["balcao", "retirada", "delivery"].includes(b.kind) ? 0 : settings.service_fee_bp,
      ctx.userId,
      businessDate(/* @__PURE__ */ new Date(), timezone, day_cutoff),
      b.customer_id ?? null,
      b.delivery_fee_cents ?? 0
    ]
  );
  if (tableId) await db.query("update dining_tables set status = 'ocupada' where id = $1 and status in ('livre','reservada','limpeza')", [tableId]);
  await audit(db, ctx, "consumo.aberto", { entity: "session", entityId: s.rows[0].id, unitId, data: { kind: b.kind, card: cardId, table: tableId } });
  return s.rows[0];
}
router5.post("/sessions", h(async (req, res) => {
  const b = parse(openSchema, req.body);
  const s = await tx((db) => openSession(db, req.ctx, b)).catch((e) => {
    if (e.code === "23505") throw conflict("Comanda j\xE1 est\xE1 em uso", "card_busy");
    throw e;
  });
  res.status(201).json(s);
}));
async function loadSessionFull(db, ctx, id) {
  const s = (await db.query(
    `select s.*, c.number as card_number, t.number as table_number, u.name as opened_by_name, cu.points as customer_points,
            cu.fiado_limit_cents as customer_fiado_limit, (cu.cpf is not null) as customer_has_cpf, cu.phone as customer_phone,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo' and i.sent_at is null and i.kitchen_status = 'novo') as pending_send
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join users u on u.id = s.opened_by left join customers cu on cu.id = s.customer_id where s.id = $1 and s.company_id = $2`,
    [id, ctx.companyId]
  )).rows[0];
  if (!s) throw notFound("Consumo n\xE3o encontrado");
  const items = (await db.query(
    `select i.id, i.product_id, i.description, i.qty, i.unit, i.unit_price_cents, i.modifiers, i.modifiers_cents, i.discount_cents,
            i.total_cents, i.notes, i.status, i.kitchen_status, i.launch_mode, i.created_at, i.cancel_reason, i.transferred_from, i.sent_at,
            u.name as user_name
       from order_items i left join users u on u.id = i.user_id where i.session_id = $1 order by i.id`,
    [id]
  )).rows;
  const payments = (await db.query(
    `select p.id, p.method, p.amount_cents, p.tendered_cents, p.change_cents, p.status, p.source, p.created_at, p.refund_reason, u.name as user_name
       from payments p left join users u on u.id = p.user_id where p.session_id = $1 order by p.id`,
    [id]
  )).rows;
  const account = s.customer_id ? { ...await accountSummary(db, ctx.companyId, s.customer_id), fiado_limit_cents: Number(s.customer_fiado_limit || 0), has_cpf: !!s.customer_has_cpf } :
  null;
  return { ...s, items, payments, totals: await sessionTotals(db, id), account };
}
router5.get("/sessions/:id", need("pdv.lancar"), h(async (req, res) => {
  res.json(await loadSessionFull({ query: q }, req.ctx, Number(req.params.id)));
}));
var itemSchema = z5.object({
  session_id: z5.number().int(),
  product_id: z5.number().int().optional(),
  qty: z5.number().positive().max(9999).optional(),
  option_ids: z5.array(z5.number().int()).max(40).default([]),
  notes: z5.string().trim().max(200).optional(),
  launch_mode: z5.enum(["manual", "continua", "dupla", "excecao", "balcao", "delivery"]),
  idempotency_key: z5.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  scan: z5.object({ card_code: z5.string().max(128).optional(), product_code: z5.string().max(128).optional() }).optional(),
  price_override_cents: z5.number().int().min(0).max(1e8).optional(),
  discount_cents: z5.number().int().min(0).max(1e8).optional(),
  authorization: z5.string().max(100).optional(),
  exception_reason: z5.string().trim().max(200).optional()
});
router5.post("/items", need("pdv.lancar"), h(async (req, res) => {
  const b = parse(itemSchema, req.body);
  const ctx = req.ctx;
  const prev = await q("select * from order_items where company_id = $1 and idempotency_key = $2", [ctx.companyId, b.idempotency_key]);
  if (prev.rows[0]) {
    if (Number(prev.rows[0].session_id) !== b.session_id) throw conflict("Chave de opera\xE7\xE3o j\xE1 usada em outro lan\xE7amento", "idempotency_mismatch");
    return res.json({ item: prev.rows[0], replay: true, totals: await sessionTotals({ query: q }, b.session_id) });
  }
  const out = await tx(async (db) => {
    const session = await lockSession(db, ctx.companyId, b.session_id);
    assertUnitScope(ctx, session.unit_id);
    assertOpen(session);
    const st = await pdvSettings(db, ctx, session.unit_id);
    let productId = b.product_id;
    let exceptionBy = null;
    if (b.launch_mode === "dupla" || b.launch_mode === "continua") {
      if (!st.scanner_enabled) throw forbidden("Leitor desabilitado nesta configura\xE7\xE3o", "scanner_disabled");
      if (b.launch_mode === "continua" && st.double_read_mandatory) throw forbidden("Dupla leitura obrigat\xF3ria: leitura cont\xEDnua n\xE3o permitida", "double_read_required");
      const pr = await resolveCode(db, ctx.companyId, b.scan?.product_code);
      if (pr.type !== "PRODUTO") throw bad("C\xF3digo lido n\xE3o \xE9 de produto", "not_a_product");
      if (productId && productId !== pr.product.id) throw bad("Produto informado difere do c\xF3digo lido");
      productId = pr.product.id;
      if (b.launch_mode === "dupla") {
        const cr = await resolveCode(db, ctx.companyId, b.scan?.card_code);
        if (cr.type !== "COMANDA") throw bad("Dupla leitura exige a leitura da comanda antes do produto", "card_required");
        if (Number(cr.card.id) !== Number(session.card_id)) throw conflict("Comanda lida n\xE3o corresponde ao consumo de destino", "card_mismatch");
      }
    } else if (b.launch_mode === "excecao") {
      if (!st.allow_manual_exception) throw forbidden("Exce\xE7\xE3o manual desabilitada", "exception_disabled");
      assertCan(ctx, "pdv.excecao_dupla_leitura");
      if (!b.exception_reason) throw bad("Informe o motivo da exce\xE7\xE3o");
      if (st.exception_requires_manager) {
        const a = await consumeAuthorization(db, ctx, b.authorization, "excecao_dupla_leitura");
        exceptionBy = a.authorized_by;
      }
    } else if (b.launch_mode === "delivery") {
      assertCan(ctx, "delivery.gerenciar");
      if (session.kind !== "delivery") throw bad("Lan\xE7amento de delivery s\xF3 em pedidos de delivery");
    } else {
      if (st.double_read_mandatory) throw forbidden("Dupla leitura obrigat\xF3ria: use a exce\xE7\xE3o autorizada para lan\xE7ar manualmente", "double_read_required");
      if (!st.allow_manual) throw forbidden("Lan\xE7amento manual desabilitado", "manual_disabled");
      assertCan(ctx, "pdv.lancamento_manual");
    }
    if (!productId) throw bad("Informe o produto");
    const p = (await db.query("select * from products where id = $1 and company_id = $2", [productId, ctx.companyId])).rows[0];
    if (!p) throw notFound("Produto n\xE3o encontrado");
    if (!p.active) throw conflict(`${p.name} est\xE1 indispon\xEDvel`, "product_inactive");
    let qty = b.qty;
    const scanning = b.launch_mode === "dupla" || b.launch_mode === "continua";
    if (p.kind === "weight") {
      if (!qty) throw bad(`${p.name} \xE9 vendido por peso: informe o peso`, "weight_required");
    } else {
      qty = qty ?? (scanning ? st.qty_per_scan : 1);
      if (!Number.isInteger(qty)) throw bad("Quantidade deve ser inteira para este produto");
      if (scanning && qty !== st.qty_per_scan) {
        assertCan(ctx, "pdv.alterar_quantidade");
        if (qty > st.max_qty_per_scan) throw bad(`Quantidade por leitura limitada a ${st.max_qty_per_scan}`);
      }
    }
    const groups = (await db.query(
      `select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active
        where g.product_id = $1 group by g.id order by g.sort, g.id`,
      [p.id]
    )).rows;
    const chosen = [];
    for (const g of groups) {
      const sel = g.options.filter((o) => b.option_ids.includes(o.id));
      if (sel.length < g.min_select) throw bad(`Escolha ${g.min_select === 1 ? "uma op\xE7\xE3o" : `${g.min_select} op\xE7\xF5es`} em "${g.name}"`, "options_required");
      if (sel.length > g.max_select) throw bad(`No m\xE1ximo ${g.max_select} em "${g.name}"`);
      for (const o of sel) chosen.push({ group: g.name, id: o.id, name: o.name, price_cents: o.price_cents });
    }
    if (chosen.length !== new Set(b.option_ids).size) throw bad("Op\xE7\xE3o inv\xE1lida para este produto");
    const modsCents = chosen.reduce((s, o) => s + o.price_cents, 0);
    let unitPrice = p.price_cents;
    const overrides = {};
    if (b.price_override_cents != null && b.price_override_cents !== p.price_cents) {
      if (!ctx.can("pdv.alterar_preco")) await consumeAuthorization(db, ctx, b.authorization, "alterar_preco");
      unitPrice = b.price_override_cents;
      overrides.price = { from: p.price_cents, to: unitPrice };
    }
    const discount = b.discount_cents || 0;
    if (discount) {
      if (!ctx.can("pdv.desconto")) await consumeAuthorization(db, ctx, b.authorization, "desconto");
      overrides.discount = discount;
    }
    const total = lineTotal(unitPrice, qty, modsCents, discount);
    if (discount > lineTotal(unitPrice, qty, modsCents, 0)) throw bad("Desconto maior que o valor do item");
    const item = (await db.query(
      `insert into order_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, case when $19::boolean then now() end) returning *`,
      [
        ctx.companyId,
        session.id,
        p.id,
        p.name,
        qty,
        p.unit,
        unitPrice,
        JSON.stringify(chosen),
        modsCents,
        discount,
        total,
        b.notes ?? null,
        p.sector_id,
        p.sector_id ? "novo" : "nao_produz",
        b.launch_mode,
        ctx.terminalId,
        ctx.userId,
        b.idempotency_key,
        // envio por lote: o item espera a confirmação "Enviar à produção" (delivery entra na fila ao ser confirmado)
        !!p.sector_id && st.kitchen_send !== "lote" && session.kind !== "delivery"
      ]
    )).rows[0];
    await consumeForItem(db, ctx, item, p, chosen.map((o) => o.id));
    await db.query("update consumption_sessions set version = version + 1 where id = $1", [session.id]);
    if (b.launch_mode === "excecao" || Object.keys(overrides).length) {
      await audit(db, ctx, b.launch_mode === "excecao" ? "pdv.excecao_manual" : "pdv.item_ajustado", {
        entity: "item",
        entityId: item.id,
        unitId: session.unit_id,
        reason: b.exception_reason,
        data: { session: session.id, product: p.id, authorized_by: exceptionBy, ...overrides }
      });
    }
    return {
      item,
      totals: await sessionTotals(db, session.id),
      confirmation: {
        product: p.name,
        qty,
        unit_price_cents: unitPrice + modsCents,
        total_cents: total,
        destination: session.card_id ? `Comanda ${(await db.query("select number from tab_cards where id = $1", [session.card_id])).rows[0].number}` : session.label || `Consumo ${session.
        id}`
      }
    };
  }).catch(async (e) => {
    if (e.code === "23505") {
      const again = await q("select * from order_items where company_id = $1 and idempotency_key = $2", [ctx.companyId, b.idempotency_key]);
      if (again.rows[0]) return { item: again.rows[0], replay: true, totals: await sessionTotals({ query: q }, again.rows[0].session_id) };
    }
    throw e;
  });
  res.status(out.replay ? 200 : 201).json(out);
}));
router5.get("/items/by-key/:key", need("pdv.lancar"), h(async (req, res) => {
  const r = await q("select * from order_items where company_id = $1 and idempotency_key = $2", [req.ctx.companyId, String(req.params.key).slice(0, 80)]);
  res.json({ found: !!r.rows[0], item: r.rows[0] || null });
}));
router5.post("/items/:id/cancel", need("pdv.lancar"), h(async (req, res) => {
  const b = parse(z5.object({ reason: z5.string().trim().min(3).max(200), authorization: z5.string().max(100).optional() }), req.body);
  const out = await tx(async (db) => {
    const it = (await db.query("select * from order_items where id = $1 and company_id = $2", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!it) throw notFound("Item n\xE3o encontrado");
    const s = await lockSession(db, req.ctx.companyId, it.session_id);
    assertOpen(s);
    const cur = (await db.query("select * from order_items where id = $1 for update", [it.id])).rows[0];
    if (cur.status !== "ativo") throw conflict("Item j\xE1 cancelado");
    let authorizedBy = null;
    if (!req.ctx.can("pdv.cancelar_item")) authorizedBy = (await consumeAuthorization(db, req.ctx, b.authorization, "cancelar_item")).authorized_by;
    const afterPrep = ["preparando", "pronto", "entregue"].includes(cur.kitchen_status);
    await db.query(
      `update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where id = $1`,
      [cur.id, b.reason, req.ctx.userId]
    );
    if ((await sessionTotals(db, s.id)).balance < 0)
      throw conflict("Cancelar este item deixaria o consumo com pagamento maior que o total. Estorne o pagamento antes.", "overpaid");
    await db.query("update consumption_sessions set version = version + 1 where id = $1", [s.id]);
    if (!afterPrep) await reverseForItem(db, req.ctx, cur.id, `Cancelamento: ${b.reason}`);
    await audit(db, req.ctx, "pdv.item_cancelado", {
      entity: "item",
      entityId: cur.id,
      unitId: s.unit_id,
      reason: b.reason,
      data: { session: s.id, total_cents: cur.total_cents, after_preparation: afterPrep, kitchen_status: cur.kitchen_status, authorized_by: authorizedBy }
    });
    return { ok: true, after_preparation: afterPrep, totals: await sessionTotals(db, s.id) };
  });
  res.json(out);
}));
router5.post("/items/transfer", need("pdv.transferir_item"), h(async (req, res) => {
  const b = parse(z5.object({ item_ids: z5.array(z5.number().int()).min(1).max(200), target_session_id: z5.number().int(), reason: z5.string().trim().min(3).max(200) }), req.body);
  res.json(await tx((db) => transferItems(db, req.ctx, b.item_ids, b.target_session_id, b.reason)));
}));
async function transferItems(db, ctx, itemIds, targetId, reason) {
  const items = (await db.query(`select * from order_items where id = any($1) and company_id = $2 and status = 'ativo'`, [itemIds, ctx.companyId])).rows;
  if (items.length !== new Set(itemIds).size) throw bad("Itens inv\xE1lidos ou j\xE1 cancelados");
  const sourceIds = [...new Set(items.map((i) => Number(i.session_id)))];
  const ids = [...sourceIds, targetId].sort((a, b) => a - b);
  const locked = {};
  for (const id of ids) locked[id] = await lockSession(db, ctx.companyId, id);
  const target = locked[targetId];
  assertOpen(target);
  for (const sid of sourceIds) {
    const s = locked[sid];
    assertOpen(s);
    if (sid === targetId) throw bad("Origem e destino iguais");
    if (s.unit_id !== target.unit_id) throw bad("Transfer\xEAncia entre unidades n\xE3o permitida");
  }
  for (const it of items) {
    const copy = await db.query(
      `insert into order_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, transferred_from)
       select company_id, $2, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents, total_cents, notes,
              sector_id, kitchen_status, launch_mode, $3, $4, idempotency_key || '-t' || $5, id from order_items where id = $1 returning id`,
      [it.id, targetId, ctx.terminalId, ctx.userId, String(it.id)]
    );
    await db.query(
      `update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now() where id = $1`,
      [it.id, `Transferido para consumo ${targetId} (item ${copy.rows[0].id})`, ctx.userId]
    );
  }
  for (const sid of sourceIds) {
    const t = await sessionTotals(db, sid);
    if (t.balance < 0) throw conflict("A origem ficaria com pagamento maior que o consumo. Estorne antes de transferir.", "overpaid");
    await db.query("update consumption_sessions set version = version + 1 where id = $1", [sid]);
  }
  await db.query("update consumption_sessions set version = version + 1 where id = $1", [targetId]);
  await audit(db, ctx, "pdv.itens_transferidos", { entity: "session", entityId: targetId, reason, data: { items: itemIds, from: sourceIds } });
  return { ok: true, moved: items.length };
}
router5.post("/sessions/:id/merge", need("pdv.transferir_item"), h(async (req, res) => {
  const b = parse(z5.object({ target_session_id: z5.number().int(), reason: z5.string().trim().min(3).max(200) }), req.body);
  const id = Number(req.params.id);
  res.json(await tx(async (db) => {
    const items = (await db.query(`select id from order_items where session_id = $1 and company_id = $2 and status = 'ativo'`, [id, req.ctx.companyId])).rows.map((r2) => r2.id);
    if (!items.length) throw bad("Consumo sem itens para juntar");
    const paid = await db.query("select 1 from payments where session_id = $1 and status = 'confirmado'", [id]);
    if (paid.rows[0]) throw conflict("Consumo com pagamento registrado n\xE3o pode ser juntado; transfira os itens restantes", "has_payments");
    const r = await transferItems(db, req.ctx, items, b.target_session_id, b.reason);
    if (Number(b.target_session_id) === id) throw bad("Escolha um destino diferente da origem");
    const src = (await db.query("select table_id, customer_name from consumption_sessions where id = $1", [id])).rows[0];
    await db.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2, label = coalesce(label,'') || ' (juntada)' where id = $1", [id, req.ctx.
    userId]);
    if (src.customer_name) await db.query("update consumption_sessions set customer_name = coalesce(customer_name, $2) where id = $1", [b.target_session_id, src.customer_name]);
    if (src.table_id) await freeTableIfEmpty(db, src.table_id);
    return r;
  }));
}));
router5.post("/sessions/:id/move-table", need("pdv.transferir_item"), h(async (req, res) => {
  const b = parse(z5.object({ table_id: z5.number().int(), reason: z5.string().trim().min(3).max(200) }), req.body);
  await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    assertOpen(s);
    const t = (await db.query("select * from dining_tables where id = $1 and company_id = $2 and active", [b.table_id, req.ctx.companyId])).rows[0];
    if (!t) throw notFound("Mesa n\xE3o encontrada");
    if (t.unit_id !== s.unit_id) throw bad("Mesa de outra unidade");
    await db.query("update consumption_sessions set table_id = $2, version = version + 1 where id = $1", [s.id, t.id]);
    await db.query("update dining_tables set status = 'ocupada' where id = $1", [t.id]);
    if (s.table_id) await freeTableIfEmpty(db, s.table_id);
    await audit(db, req.ctx, "pdv.mesa_trocada", { entity: "session", entityId: s.id, reason: b.reason, data: { from: s.table_id, to: t.id } });
  });
  res.json({ ok: true });
}));
async function freeTableIfEmpty(db, tableId) {
  await db.query(`update dining_tables set status = 'limpeza' where id = $1 and status in ('ocupada','conta')
                  and not exists (select 1 from consumption_sessions where table_id = $1 and status in ('aberta','em_fechamento'))`, [tableId]);
}
router5.post("/sessions/:id/service-fee", need("pdv.lancar"), h(async (req, res) => {
  const b = parse(z5.object({ bp: z5.number().int().min(0).max(3e3), reason: z5.string().trim().min(3).max(200), authorization: z5.string().max(100).optional() }), req.body);
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (!["aberta", "em_fechamento"].includes(s.status)) throw conflict("Consumo encerrado");
    if (!req.ctx.can("pdv.taxa_servico")) await consumeAuthorization(db, req.ctx, b.authorization, "taxa_servico");
    const paid = (await sessionTotals(db, s.id)).paid;
    await db.query("update consumption_sessions set service_fee_bp = $2, service_fee_removed_reason = $3, version = version + 1 where id = $1", [s.id, b.bp, b.reason]);
    const t = await sessionTotals(db, s.id);
    if (paid > t.total) throw conflict("Pagamento registrado supera o novo total. Estorne antes.", "overpaid");
    await audit(db, req.ctx, "pdv.taxa_servico", { entity: "session", entityId: s.id, reason: b.reason, data: { from: s.service_fee_bp, to: b.bp } });
    return t;
  }));
}));
router5.post("/sessions/:id/request-close", need("pdv.lancar"), h(async (req, res) => {
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    assertOpen(s);
    await db.query("update consumption_sessions set status = 'em_fechamento', version = version + 1 where id = $1", [s.id]);
    if (s.table_id) await db.query("update dining_tables set status = 'conta' where id = $1", [s.table_id]);
    return { ok: true };
  }));
}));
router5.post("/sessions/:id/resume", need("pdv.lancar"), h(async (req, res) => {
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (s.status !== "em_fechamento") throw conflict("Consumo n\xE3o est\xE1 em fechamento");
    await db.query("update consumption_sessions set status = 'aberta', version = version + 1 where id = $1", [s.id]);
    if (s.table_id) await db.query("update dining_tables set status = 'ocupada' where id = $1", [s.table_id]);
    return { ok: true };
  }));
}));
router5.post("/sessions/:id/suspend", need("pdv.lancar"), h(async (req, res) => {
  const b = parse(z5.object({ suspended: z5.boolean() }), req.body);
  await q("update consumption_sessions set suspended = $3 where id = $1 and company_id = $2", [Number(req.params.id), req.ctx.companyId, b.suspended]);
  res.json({ ok: true });
}));
router5.get("/sessions/:id/split", need("pdv.lancar"), h(async (req, res) => {
  const parts = Math.min(Math.max(Number(req.query.parts) || 2, 2), 50);
  const t = await sessionTotals({ query: q }, Number(req.params.id));
  res.json({ parts: splitCents(Math.max(t.balance, 0), parts), balance: t.balance });
}));
router5.post("/sessions/:id/close", need("pdv.receber"), h(async (req, res) => {
  const b = parse(z5.object({ version: z5.number().int() }), req.body);
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (!["aberta", "em_fechamento"].includes(s.status)) throw conflict("Consumo j\xE1 encerrado", "already_closed");
    if (s.version !== b.version) throw conflict("O consumo foi alterado em outro terminal. Confira antes de fechar.", "version_conflict", { version: s.version });
    const t = await sessionTotals(db, s.id);
    if (t.balance !== 0) throw conflict(`Saldo pendente de ${(t.balance / 100).toFixed(2)}. Receba antes de encerrar.`, "balance_pending");
    if (t.items === 0) throw bad("Consumo sem itens: use cancelar");
    await db.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1", [s.id, req.ctx.userId]);
    if (s.table_id) await freeTableIfEmpty(db, s.table_id);
    const earned = await earnPoints(db, req.ctx, s, t.items);
    await audit(db, req.ctx, "consumo.encerrado", { entity: "session", entityId: s.id, unitId: s.unit_id, data: t });
    return { ok: true, totals: t, points_earned: earned?.points || 0 };
  }));
}));
router5.post("/sessions/:id/cancel", need("pdv.lancar"), h(async (req, res) => {
  const b = parse(z5.object({ reason: z5.string().trim().min(3).max(200), authorization: z5.string().max(100).optional() }), req.body);
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (!["aberta", "em_fechamento"].includes(s.status)) throw conflict("Consumo j\xE1 encerrado");
    const t = await sessionTotals(db, s.id);
    if (t.paid > 0) throw conflict("H\xE1 pagamentos confirmados: estorne antes de cancelar", "has_payments");
    let by = null;
    if (t.items > 0 && !req.ctx.can("pdv.cancelar_venda")) by = (await consumeAuthorization(db, req.ctx, b.authorization, "cancelar_venda")).authorized_by;
    const before = (await db.query(`select id from order_items where session_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','nao_produz')`, [s.id])).rows;
    for (const it of before) await reverseForItem(db, req.ctx, it.id, `Consumo cancelado: ${b.reason}`);
    await db.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end
                    where session_id = $1 and status = 'ativo'`, [s.id, `Consumo cancelado: ${b.reason}`, req.ctx.userId]);
    await db.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1", [s.id, req.ctx.userId]);
    if (s.table_id) await freeTableIfEmpty(db, s.table_id);
    await audit(db, req.ctx, "consumo.cancelado", { entity: "session", entityId: s.id, reason: b.reason, data: { items_cents: t.items, authorized_by: by } });
    return { ok: true };
  }));
}));
router5.post("/sessions/:id/reopen", need("pdv.lancar"), h(async (req, res) => {
  const b = parse(z5.object({ reason: z5.string().trim().min(3).max(200), authorization: z5.string().max(100).optional() }), req.body);
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (s.status !== "encerrada") throw conflict("S\xF3 consumos encerrados podem ser reabertos");
    let by = null;
    if (!req.ctx.can("pdv.reabrir_comanda")) by = (await consumeAuthorization(db, req.ctx, b.authorization, "reabrir_comanda")).authorized_by;
    if (s.card_id) {
      const busy = await db.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento') and id <> $2", [s.card_id, s.id]);
      if (busy.rows[0]) throw conflict("O cart\xE3o j\xE1 est\xE1 em uso por outro consumo. Transfira os itens em vez de reabrir.", "card_busy");
    }
    await db.query("update consumption_sessions set status = 'aberta', closed_at = null, closed_by = null, version = version + 1 where id = $1", [s.id]);
    await reverseEarn(db, req.ctx, s.id, "Consumo reaberto");
    if (s.table_id) await db.query("update dining_tables set status = 'ocupada' where id = $1", [s.table_id]);
    await audit(db, req.ctx, "consumo.reaberto", { entity: "session", entityId: s.id, reason: b.reason, data: { authorized_by: by } });
    return { ok: true };
  }));
}));
async function openCashFor(db, ctx, unitId) {
  const params = [ctx.companyId];
  let where = "company_id = $1 and status = 'aberto'";
  if (ctx.terminalId) {
    params.push(ctx.terminalId);
    where += ` and terminal_id = $${params.length}`;
  } else {
    params.push(ctx.userId, unitId);
    where += ` and user_id = $${params.length - 1} and unit_id = $${params.length} and terminal_id is null`;
  }
  return (await db.query(`select * from cash_sessions where ${where} order by id desc limit 1`, params)).rows[0];
}
var payInput = z5.object({
  method: z5.enum(["dinheiro", "pix", "debito", "credito", "vale", "outro", "fiado", "saldo_cliente"]),
  amount_cents: z5.number().int().positive().max(1e8),
  tendered_cents: z5.number().int().positive().max(1e8).optional(),
  idempotency_key: z5.string().regex(/^[A-Za-z0-9_-]{8,80}$/)
});
router5.post("/sessions/:id/payments", need("pdv.receber"), h(async (req, res) => {
  const b = parse(payInput, req.body);
  const ctx = req.ctx;
  const prev = await q("select * from payments where company_id = $1 and idempotency_key = $2", [ctx.companyId, b.idempotency_key]);
  if (prev.rows[0]) return res.json({ payment: prev.rows[0], replay: true, totals: await sessionTotals({ query: q }, prev.rows[0].session_id) });
  const out = await tx(async (db) => {
    const s = await lockSession(db, ctx.companyId, Number(req.params.id));
    assertUnitScope(ctx, s.unit_id);
    if (!["aberta", "em_fechamento"].includes(s.status)) throw conflict("Consumo encerrado", "session_not_open");
    const st = await pdvSettings(db, ctx, s.unit_id);
    const cash = await openCashFor(db, ctx, s.unit_id);
    if (!cash && st.require_open_cash) throw conflict("Abra o caixa antes de receber", "cash_closed");
    const t = await sessionTotals(db, s.id);
    if (b.amount_cents > t.balance) throw bad(`Valor maior que o saldo (${(t.balance / 100).toFixed(2)})`, "over_balance");
    let change = 0;
    if (b.method === "outro") throw bad('A forma "Outro" foi substitu\xEDda por "Fiado"', "method_retired");
    if (b.tendered_cents != null) {
      if (b.method !== "dinheiro") throw bad("Troco s\xF3 \xE9 permitido em dinheiro", "change_not_allowed");
      if (b.tendered_cents < b.amount_cents) throw bad("Valor entregue menor que o valor a pagar");
      change = b.tendered_cents - b.amount_cents;
    }
    const { day_cutoff, timezone } = await unitCutoff(db, ctx.companyId, s.unit_id);
    const p = (await db.query(
      `insert into payments (company_id, session_id, cash_session_id, method, amount_cents, tendered_cents, change_cents, business_date, idempotency_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [
        ctx.companyId,
        s.id,
        cash?.id ?? null,
        b.method,
        b.amount_cents,
        b.tendered_cents ?? null,
        change,
        businessDate(/* @__PURE__ */ new Date(), timezone, day_cutoff),
        b.idempotency_key,
        ctx.userId
      ]
    )).rows[0];
    const account = ["fiado", "saldo_cliente"].includes(b.method) ? await chargeAccount(db, ctx, s, b.method, b.amount_cents, p.id) : null;
    await db.query("update consumption_sessions set version = version + 1 where id = $1", [s.id]);
    await audit(db, ctx, b.method === "fiado" ? "pagamento.fiado" : "pagamento.registrado", {
      entity: "payment",
      entityId: p.id,
      unitId: s.unit_id,
      data: { session: s.id, method: b.method, amount_cents: b.amount_cents, change_cents: change, ...account ? { cliente: account.customer_id, acima_do_limite: account.over_limit,
      saldo_conta: account.balance_after } : {} }
    });
    return { payment: p, totals: await sessionTotals(db, s.id), account };
  }).catch(async (e) => {
    if (e.code === "23505") {
      const again = await q("select * from payments where company_id = $1 and idempotency_key = $2", [ctx.companyId, b.idempotency_key]);
      if (again.rows[0]) return { payment: again.rows[0], replay: true, totals: await sessionTotals({ query: q }, again.rows[0].session_id) };
    }
    throw e;
  });
  res.status(out.replay ? 200 : 201).json(out);
}));
router5.post("/payments/:id/refund", need("financeiro.estornar"), h(async (req, res) => {
  const b = parse(z5.object({ reason: z5.string().trim().min(3).max(200) }), req.body);
  res.json(await tx(async (db) => {
    const p = (await db.query("select * from payments where id = $1 and company_id = $2", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!p) throw notFound("Pagamento n\xE3o encontrado");
    const s = await lockSession(db, req.ctx.companyId, p.session_id);
    if (!["aberta", "em_fechamento"].includes(s.status)) throw conflict("Reabra o consumo antes de estornar", "session_closed");
    const r = await db.query(`update payments set status = 'estornado', refund_reason = $2, refunded_by = $3, refunded_at = now()
                              where id = $1 and status = 'confirmado' returning id`, [p.id, b.reason, req.ctx.userId]);
    if (!r.rows[0]) throw conflict("Pagamento j\xE1 estornado");
    await db.query("update consumption_sessions set version = version + 1 where id = $1", [s.id]);
    await reverseRedeemByPayment(db, req.ctx, p.id);
    await reverseAccountByPayment(db, req.ctx, p.id, b.reason);
    await audit(db, req.ctx, "pagamento.estornado", { entity: "payment", entityId: p.id, reason: b.reason, data: { amount_cents: p.amount_cents, method: p.method } });
    return { ok: true, totals: await sessionTotals(db, s.id) };
  }));
}));
router5.post("/sessions/:id/send", need("pdv.lancar"), h(async (req, res) => {
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    assertUnitScope(req.ctx, s.unit_id);
    const r = await db.query(`update order_items set sent_at = now() where session_id = $1 and status = 'ativo' and sent_at is null
      and kitchen_status = 'novo' returning id`, [s.id]);
    if (r.rowCount) await audit(db, req.ctx, "producao.lote_enviado", { entity: "session", entityId: s.id, data: { items: r.rowCount } });
    return { sent: r.rowCount };
  }));
}));
router5.post("/mode", need("pdv.lancar"), h(async (req, res) => {
  const b = parse(z5.object({ from: z5.enum(["manual", "continua", "dupla"]), to: z5.enum(["manual", "continua", "dupla"]), reason: z5.string().trim().max(200).optional() }), req.body);
  const st = await pdvSettings({ query: q }, req.ctx, req.ctx.terminalUnitId || req.ctx.unitId);
  if (b.from !== b.to) {
    assertCan(req.ctx, "pdv.alterar_modo");
    if (!st.allow_mode_change) throw forbidden("Troca de modo desabilitada nesta configura\xE7\xE3o", "mode_locked");
    if (st.double_read_mandatory && b.to !== "dupla") throw forbidden("Dupla leitura obrigat\xF3ria: use a exce\xE7\xE3o autorizada", "double_read_required");
    if (!st.scanner_enabled && b.to !== "manual") throw forbidden("Leitor desabilitado", "scanner_disabled");
  }
  await audit({ query: q }, req.ctx, "pdv.modo_alterado", { reason: b.reason, data: { from: b.from, to: b.to } });
  res.json({ ok: true, mode: b.to });
}));

// src/routes/cash.js
import { Router as Router6 } from "npm:express@5.2.1";
import { z as z6 } from "npm:zod@4.6.5";
var router6 = Router6();
var METHODS = ["dinheiro", "pix", "debito", "credito", "vale", "outro"];
var NON_CASH = ["fiado", "saldo_cliente"];
async function expected(db, cashId) {
  const c = (await db.query("select opening_cents from cash_sessions where id = $1", [cashId])).rows[0];
  const pays = (await db.query(
    `select method, coalesce(sum(amount_cents),0)::bigint as total from payments where cash_session_id = $1 and status = 'confirmado' group by method`,
    [cashId]
  )).rows;
  const mov = (await db.query(
    `select kind, coalesce(sum(amount_cents),0)::bigint as total from cash_movements where cash_session_id = $1 group by kind`,
    [cashId]
  )).rows;
  const acc = (await db.query(
    `select method, coalesce(sum(amount_cents),0)::bigint as total from customer_account where cash_session_id = $1 and method is not null group by method`,
    [cashId]
  )).rows;
  const byMethod = Object.fromEntries(METHODS.map((m2) => [m2, 0]));
  const info = Object.fromEntries(NON_CASH.map((m2) => [m2, 0]));
  for (const p of pays) {
    if (NON_CASH.includes(p.method)) info[p.method] = Number(p.total);
    else byMethod[p.method] = Number(p.total);
  }
  const accountIn = {};
  for (const a of acc) {
    byMethod[a.method] += Number(a.total);
    accountIn[a.method] = Number(a.total);
  }
  const m = Object.fromEntries(mov.map((r) => [r.kind, Number(r.total)]));
  byMethod.dinheiro = c.opening_cents + byMethod.dinheiro + (m.suprimento || 0) - (m.sangria || 0) - (m.despesa || 0);
  return { byMethod, opening: c.opening_cents, movements: m, info, account_in: accountIn };
}
async function currentCash(req) {
  const params = [req.ctx.companyId];
  let where = "c.company_id = $1 and c.status = 'aberto'";
  if (req.ctx.terminalId) {
    params.push(req.ctx.terminalId);
    where += ` and c.terminal_id = $${params.length}`;
  } else {
    params.push(req.ctx.userId);
    where += ` and c.user_id = $${params.length} and c.terminal_id is null`;
  }
  return (await q(`select c.*, u.name as user_name from cash_sessions c join users u on u.id = c.user_id where ${where} order by c.id desc limit 1`, params)).rows[0];
}
router6.get("/current", h(async (req, res) => {
  const c = await currentCash(req);
  if (!c) return res.json({ open: false });
  const showExpected = req.ctx.can("financeiro.visualizar");
  res.json({
    open: true,
    cash: { id: c.id, opened_at: c.opened_at, user_name: c.user_name, opening_cents: c.opening_cents, business_date: c.business_date },
    expected: showExpected ? await expected({ query: q }, c.id) : null
  });
}));
router6.post("/open", need("caixa.abrir"), h(async (req, res) => {
  const b = parse(z6.object({ opening_cents: z6.number().int().min(0).max(1e7) }), req.body);
  const unitId = req.ctx.terminalUnitId || req.ctx.unitId || (await q("select id from units where company_id = $1 order by id limit 1", [req.ctx.companyId])).rows[0].id;
  if (!req.ctx.terminalId) {
    const t = await q("select 1 from terminals where company_id = $1 and active limit 1", [req.ctx.companyId]);
    if (t.rows[0]) throw bad("Identifique o terminal deste dispositivo antes de abrir o caixa", "terminal_required");
  }
  if (await currentCash(req)) throw conflict("J\xE1 existe caixa aberto neste terminal", "cash_open");
  const u = (await q("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1", [unitId])).rows[0];
  const r = await q(
    `insert into cash_sessions (company_id, unit_id, terminal_id, user_id, opening_cents, business_date) values ($1,$2,$3,$4,$5,$6) returning id`,
    [req.ctx.companyId, unitId, req.ctx.terminalId, req.ctx.userId, b.opening_cents, businessDate(/* @__PURE__ */ new Date(), u.timezone, u.day_cutoff)]
  ).catch((e) => {
    if (e.code === "23505") throw conflict("J\xE1 existe caixa aberto neste terminal", "cash_open");
    throw e;
  });
  await audit({ query: q }, req.ctx, "caixa.aberto", { entity: "cash", entityId: r.rows[0].id, unitId, data: b });
  res.status(201).json({ id: r.rows[0].id });
}));
router6.post("/:id/movements", h(async (req, res) => {
  const b = parse(z6.object({ kind: z6.enum(["sangria", "suprimento", "despesa"]), amount_cents: z6.number().int().positive().max(1e7), reason: z6.string().trim().min(3).max(200) }),
  req.body);
  assertCan(req.ctx, b.kind === "suprimento" ? "caixa.suprimento" : "caixa.sangria");
  const out = await tx(async (db) => {
    const c = (await db.query("select * from cash_sessions where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!c) throw notFound("Caixa n\xE3o encontrado");
    if (c.status !== "aberto") throw conflict("Caixa fechado");
    if (b.kind !== "suprimento") {
      const e = await expected(db, c.id);
      if (b.amount_cents > e.byMethod.dinheiro) throw bad("Valor maior que o dinheiro esperado na gaveta");
    }
    const r = await db.query(
      "insert into cash_movements (company_id, cash_session_id, kind, amount_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6) returning id",
      [req.ctx.companyId, c.id, b.kind, b.amount_cents, b.reason, req.ctx.userId]
    );
    await audit(db, req.ctx, `caixa.${b.kind}`, { entity: "cash", entityId: c.id, reason: b.reason, data: { amount_cents: b.amount_cents } });
    return { id: r.rows[0].id };
  });
  res.status(201).json(out);
}));
router6.post("/:id/close", need("caixa.fechar"), h(async (req, res) => {
  const b = parse(z6.object({
    counted: z6.object(Object.fromEntries(METHODS.map((m) => [m, z6.number().int().min(0).max(1e8).default(0)]))),
    notes: z6.record(z6.string(), z6.number().int().min(0).max(1e5)).optional(),
    // contador de cédulas/moedas
    justification: z6.string().trim().max(300).optional()
  }), req.body);
  const out = await tx(async (db) => {
    const c = (await db.query("select * from cash_sessions where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!c) throw notFound("Caixa n\xE3o encontrado");
    if (c.status !== "aberto") throw conflict("Caixa j\xE1 fechado");
    const e = await expected(db, c.id);
    const diffByMethod = Object.fromEntries(METHODS.map((m) => [m, (b.counted[m] || 0) - (e.byMethod[m] || 0)]));
    const diff = Object.values(diffByMethod).reduce((s, v) => s + v, 0);
    if (Object.values(diffByMethod).some((v) => v !== 0) && !b.justification)
      throw bad("H\xE1 diferen\xE7a na confer\xEAncia: informe a justificativa", "justification_required");
    await db.query(
      `update cash_sessions set status = 'fechado', closed_at = now(), closed_by = $2, counted = $3, expected = $4,
                      difference_cents = $5, justification = $6 where id = $1`,
      [c.id, req.ctx.userId, { ...b.counted, notes: b.notes ?? null }, e.byMethod, diff, b.justification ?? null]
    );
    await audit(db, req.ctx, "caixa.fechado", { entity: "cash", entityId: c.id, reason: b.justification, data: { difference_cents: diff, by_method: diffByMethod } });
    return { ok: true, expected: e.byMethod, counted: b.counted, difference_cents: diff, by_method: diffByMethod };
  });
  res.json(out);
}));
router6.post("/:id/reopen", need("caixa.reabrir"), h(async (req, res) => {
  const b = parse(z6.object({ reason: z6.string().trim().min(3).max(200) }), req.body);
  await tx(async (db) => {
    const c = (await db.query("select * from cash_sessions where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!c) throw notFound();
    if (c.status !== "fechado") throw conflict("Caixa n\xE3o est\xE1 fechado");
    if (new Date(c.closed_at) < new Date(Date.now() - 48 * 3600 * 1e3)) throw bad("Reabertura permitida at\xE9 48 horas ap\xF3s o fechamento");
    const other = c.terminal_id ? await db.query("select 1 from cash_sessions where terminal_id = $1 and status = 'aberto'", [c.terminal_id]) : { rows: [] };
    if (other.rows[0]) throw conflict("J\xE1 existe outro caixa aberto neste terminal");
    await db.query("update cash_sessions set status = 'aberto', closed_at = null, closed_by = null where id = $1", [c.id]);
    await audit(db, req.ctx, "caixa.reaberto", { entity: "cash", entityId: c.id, reason: b.reason, data: { previous: { counted: c.counted, difference_cents: c.difference_cents, closed_at: c.
    closed_at } } });
  });
  res.json({ ok: true });
}));
router6.get("/", need("financeiro.visualizar"), h(async (req, res) => {
  res.json((await q(`select c.id, c.status, c.opened_at, c.closed_at, c.business_date, c.opening_cents, c.difference_cents, c.justification,
                            u.name as user_name, t.name as terminal_name
                       from cash_sessions c join users u on u.id = c.user_id left join terminals t on t.id = c.terminal_id
                      where c.company_id = $1 order by c.id desc limit 100`, [req.ctx.companyId])).rows);
}));
router6.get("/:id/report", need("financeiro.visualizar"), h(async (req, res) => {
  const c = (await q("select * from cash_sessions where id = $1 and company_id = $2", [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!c) throw notFound();
  const mov = (await q("select m.kind, m.amount_cents, m.reason, m.created_at, u.name user_name from cash_movements m left join users u on u.id = m.user_id where cash_session_id = \
$1 order by m.id", [c.id])).rows;
  res.json({ cash: c, expected: await expected({ query: q }, c.id), movements: mov });
}));

// src/routes/home.js
import { Router as Router7 } from "npm:express@5.2.1";
var router7 = Router7();
router7.get("/dashboard", h(async (req, res) => {
  const c = req.ctx;
  const unit = (await q(
    "select id, day_cutoff from units where company_id = $1 and ($2::bigint is null or id = $2) order by id limit 1",
    [c.companyId, c.terminalUnitId || c.unitId || null]
  )).rows[0];
  const day = businessDate(/* @__PURE__ */ new Date(), c.company.timezone, unit?.day_cutoff ?? 5);
  const money2 = c.can("financeiro.visualizar");
  const r = (await q(
    `select
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
       (select count(*)::int from products where company_id = $1 and demo) as demo_products`,
    [c.companyId, day]
  )).rows[0];
  const byHour = money2 ? (await q(
    `select extract(hour from p.created_at at time zone $3)::int as hour, sum(p.amount_cents)::bigint as cents
       from payments p where p.company_id = $1 and p.business_date = $2 and p.status = 'confirmado' and p.method not in ('fiado','saldo_cliente') group by 1 order by 1`,
    [c.companyId, day, c.company.timezone]
  )).rows : null;
  const top = (await q(
    `select i.description, sum(i.qty)::numeric as qty ${money2 ? ", sum(i.total_cents)::bigint as cents" : ""}
       from order_items i join consumption_sessions s on s.id = i.session_id
      where s.company_id = $1 and s.business_date = $2 and i.status = 'ativo' group by 1 order by 2 desc limit 5`,
    [c.companyId, day]
  )).rows;
  if (!money2) {
    delete r.consumed_cents;
    delete r.received_cents;
    delete r.fiado_cents;
    delete r.cash_differences;
  }
  res.json({
    business_date: day,
    ...r,
    by_hour: byHour,
    top,
    access: c.access,
    pending_modules: ["delivery", "estoque", "cozinha", "clientes", "marketing", "agente", "fiscal", "relatorios"]
  });
}));
router7.get("/search", h(async (req, res) => {
  const term = String(req.query.q || "").trim().slice(0, 60);
  if (term.length < 2) return res.json([]);
  const c = req.ctx;
  const like = `%${term}%`;
  const out = [];
  if (c.can("cardapio.visualizar")) {
    const p = await q(`select id, name from products where company_id = $1 and (name ilike $2 or sku = $3) order by name limit 6`, [c.companyId, like, term]);
    out.push(...p.rows.map((r) => ({ type: "produto", id: r.id, label: r.name, to: `/cardapio?produto=${r.id}` })));
  }
  if (c.can("pdv.lancar")) {
    const n = Number(term.replace(/\D/g, ""));
    if (n) {
      const s = await q(`select s.id, c.number card, t.number tbl, s.status from consumption_sessions s left join tab_cards c on c.id = s.card_id
                          left join dining_tables t on t.id = s.table_id
                          where s.company_id = $1 and (c.number = $2 or t.number = $2 or s.id = $2) and s.status in ('aberta','em_fechamento') limit 6`, [c.companyId, n]);
      out.push(...s.rows.map((r) => ({ type: "consumo", id: r.id, label: r.card ? `Comanda ${r.card}` : r.tbl ? `Mesa ${r.tbl}` : `Consumo ${r.id}`, to: `/pdv?sessao=${r.id}` })));
    }
    const sc = await q(`select s.id, s.customer_name, s.label from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')
                         and (s.customer_name ilike $2 or s.label ilike $2) limit 5`, [c.companyId, like]);
    out.push(...sc.rows.map((r) => ({ type: "consumo", id: r.id, label: r.customer_name || r.label, to: `/pdv?sessao=${r.id}` })));
  }
  if (c.can("usuarios.gerenciar")) {
    const u = await q("select id, name from users where company_id = $1 and name ilike $2 limit 4", [c.companyId, like]);
    out.push(...u.rows.map((r) => ({ type: "usuario", id: r.id, label: r.name, to: "/configuracoes/usuarios" })));
  }
  res.json(out);
}));

// src/routes/customers.js
import { Router as Router8 } from "npm:express@5.2.1";
import { z as z7 } from "npm:zod@4.6.5";
var router8 = Router8();
var base = z7.object({
  name: z7.string().trim().min(2).max(100),
  cpf: z7.string().max(20).optional().nullable(),
  phone: z7.string().trim().max(30).optional().nullable(),
  email: z7.string().trim().email().max(120).optional().nullable().or(z7.literal("")),
  birthday: z7.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z7.literal("")),
  address: z7.object({
    street: z7.string().max(120).optional(),
    number: z7.string().max(20).optional(),
    district: z7.string().max(80).optional(),
    city: z7.string().max(80).optional(),
    complement: z7.string().max(80).optional(),
    reference: z7.string().max(120).optional()
  }).partial().optional(),
  tags: z7.array(z7.string().trim().min(1).max(30)).max(20).optional(),
  preferences: z7.string().max(300).optional().nullable(),
  notes: z7.string().max(500).optional().nullable(),
  consent_whatsapp: z7.boolean().optional(),
  consent_email: z7.boolean().optional()
});
var phoneNorm = (p) => {
  const d = onlyDigits(p);
  return d ? d.slice(-13) : null;
};
async function stats(db, companyId, ids) {
  if (!ids.length) return {};
  const r = await db.query(
    `select s.customer_id, count(*)::int as visits, max(s.closed_at) as last_visit,
            coalesce(sum((select coalesce(sum(i.total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo')),0)::bigint as spent_cents
       from consumption_sessions s where s.company_id = $1 and s.customer_id = any($2) and s.status = 'encerrada' group by s.customer_id`,
    [companyId, ids]
  );
  return Object.fromEntries(r.rows.map((x) => [x.customer_id, x]));
}
router8.get("/lookup", need("clientes.visualizar"), h(async (req, res) => {
  const cpf = normalizeCpf(req.query.cpf, { required: true });
  const c = (await q("select * from customers where company_id = $1 and cpf = $2 and anonymized_at is null", [req.ctx.companyId, cpf])).rows[0];
  if (!c) return res.json({ found: false, cpf: fmtCpf(cpf) });
  const open = (await q(`select s.id, s.kind, t.number as table_number, cd.number as card_number from consumption_sessions s
      left join dining_tables t on t.id = s.table_id left join tab_cards cd on cd.id = s.card_id
     where s.company_id = $1 and s.customer_id = $2 and s.status in ('aberta','em_fechamento') limit 3`, [req.ctx.companyId, c.id])).rows;
  res.json({ found: true, customer: { id: c.id, name: c.name, points: c.points, tags: c.tags, preferences: c.preferences }, open_sessions: open });
}));
router8.get("/", need("clientes.visualizar"), h(async (req, res) => {
  const params = [req.ctx.companyId];
  let where = "c.company_id = $1 and c.anonymized_at is null";
  const term = String(req.query.q || "").trim().slice(0, 80);
  if (term) {
    const d = onlyDigits(term);
    params.push(`%${term.toLowerCase()}%`);
    where += ` and (lower(c.name) like $${params.length}`;
    if (d.length >= 3) {
      params.push(`%${d}%`);
      where += ` or c.cpf like $${params.length} or regexp_replace(coalesce(c.phone,''),'\\D','','g') like $${params.length}`;
    }
    where += ")";
  }
  if (req.query.tag) {
    params.push(String(req.query.tag));
    where += ` and $${params.length} = any(c.tags)`;
  }
  if (req.query.birthday === "mes") where += " and extract(month from c.birthday) = extract(month from current_date)";
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const total = (await q(`select count(*)::int as n from customers c where ${where}`, params)).rows[0].n;
  const rows = (await q(`select c.* from customers c where ${where} order by lower(c.name) limit ${limit} offset ${offset}`, params)).rows;
  const st = await stats({ query: q }, req.ctx.companyId, rows.map((r) => r.id));
  res.json({ total, items: rows.map((r) => presentCustomer({ ...r, ...st[r.id] || { visits: 0, spent_cents: 0, last_visit: null } }, req.ctx)) });
}));
router8.get("/summary", need("clientes.visualizar"), h(async (req, res) => {
  const r = (await q(`select count(*)::int as total,
      count(*) filter (where extract(month from birthday) = extract(month from current_date))::int as birthdays,
      count(*) filter (where consent_whatsapp and unsubscribed_at is null)::int as whatsapp_ok,
      coalesce(sum(points),0)::int as points
    from customers where company_id = $1 and anonymized_at is null`, [req.ctx.companyId])).rows[0];
  const tags = (await q(`select t as tag, count(*)::int as n from customers, unnest(tags) t where company_id = $1 and anonymized_at is null group by t order by n desc limit 20`, [req.
  ctx.companyId])).rows;
  const c = (await q("select settings from companies where id = $1", [req.ctx.companyId])).rows[0];
  res.json({ ...r, tags, loyalty: loyaltyConfig(c.settings) });
}));
router8.put("/loyalty", need("clientes.gerenciar", "configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z7.object({
    enabled: z7.boolean(),
    cents_per_point: z7.number().int().min(1).max(1e5),
    point_value_cents: z7.number().int().min(1).max(1e4),
    validity_days: z7.number().int().min(7).max(3650),
    min_redeem: z7.number().int().min(1).max(1e5)
  }), req.body);
  await q(`update companies set settings = jsonb_set(settings, '{loyalty}', $2::jsonb) where id = $1`, [req.ctx.companyId, JSON.stringify(b)]);
  await audit({ query: q }, req.ctx, "fidelidade.configuracao", { data: b });
  res.json({ ok: true });
}));
router8.get("/:id", need("clientes.visualizar"), h(async (req, res) => {
  const id = Number(req.params.id);
  await tx((db) => expirePoints(db, req.ctx.companyId, id));
  const c = (await q("select * from customers where id = $1 and company_id = $2", [id, req.ctx.companyId])).rows[0];
  if (!c) throw notFound("Cliente n\xE3o encontrado");
  const st = (await stats({ query: q }, req.ctx.companyId, [id]))[id] || { visits: 0, spent_cents: 0, last_visit: null };
  const history = (await q(`select s.id, s.kind, s.opened_at, s.closed_at, s.status,
       (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
       (select string_agg(i.description, ', ' order by i.id) from (select description, id from order_items where session_id = s.id and status = 'ativo' limit 6) i) as items
     from consumption_sessions s where s.company_id = $1 and s.customer_id = $2 order by s.opened_at desc limit 30`, [req.ctx.companyId, id])).rows;
  const ledger = (await q(`select id, kind, points, expires_at, reason, session_id, created_at from loyalty_ledger where company_id = $1 and customer_id = $2 order by id desc limit\
 50`, [req.ctx.companyId, id])).rows;
  const reviews = (await q("select id, score, comment, created_at from reviews where company_id = $1 and customer_id = $2 order by id desc limit 10", [req.ctx.companyId, id])).rows;
  const ticket = st.visits ? Math.round(Number(st.spent_cents) / st.visits) : 0;
  res.json({ customer: presentCustomer({ ...c, ...st }, req.ctx), ticket_cents: ticket, history, ledger, reviews });
}));
function values(b, ctx) {
  return {
    cpf: b.cpf !== void 0 ? normalizeCpf(b.cpf) : void 0,
    phone: b.phone !== void 0 ? b.phone || null : void 0,
    email: b.email !== void 0 ? b.email || null : void 0,
    birthday: b.birthday !== void 0 ? b.birthday || null : void 0,
    consent_at: b.consent_whatsapp || b.consent_email ? /* @__PURE__ */ new Date() : void 0,
    by: ctx.userId
  };
}
async function createCustomer(db, ctx, b) {
  const v = values(b, ctx);
  if (v.phone && phoneNorm(v.phone).length < 10) throw bad("Telefone deve ter DDD");
  const r = await db.query(
    `insert into customers (company_id, cpf, name, phone, email, birthday, address, tags, preferences, notes, consent_whatsapp, consent_email, consent_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [
      ctx.companyId,
      v.cpf ?? null,
      b.name,
      v.phone ?? null,
      v.email ?? null,
      v.birthday ?? null,
      b.address || {},
      b.tags || [],
      b.preferences ?? null,
      b.notes ?? null,
      !!b.consent_whatsapp,
      !!b.consent_email,
      v.consent_at ?? null,
      ctx.userId
    ]
  ).catch((e) => {
    if (e.code === "23505") throw conflict("J\xE1 existe cliente com este CPF", "cpf_in_use");
    throw e;
  });
  await audit(db, ctx, "cliente.criado", { entity: "customer", entityId: r.rows[0].id, data: { consent_whatsapp: !!b.consent_whatsapp, consent_email: !!b.consent_email } });
  return r.rows[0];
}
router8.post("/", need("clientes.gerenciar"), h(async (req, res) => {
  const b = parse(base, req.body);
  const c = await tx((db) => createCustomer(db, req.ctx, b));
  res.status(201).json(presentCustomer(c, req.ctx));
}));
router8.put("/:id", need("clientes.gerenciar"), h(async (req, res) => {
  const b = parse(base.partial(), req.body);
  const id = Number(req.params.id);
  const out = await tx(async (db) => {
    const cur = (await db.query("select * from customers where id = $1 and company_id = $2 for update", [id, req.ctx.companyId])).rows[0];
    if (!cur) throw notFound("Cliente n\xE3o encontrado");
    if (cur.anonymized_at) throw conflict("Cliente anonimizado n\xE3o pode ser editado");
    if (!req.ctx.can("dados.pessoais")) for (const k of ["cpf", "phone", "email", "birthday", "address"]) delete b[k];
    const v = values(b, req.ctx);
    const consentChanged = b.consent_whatsapp !== void 0 && b.consent_whatsapp !== cur.consent_whatsapp || b.consent_email !== void 0 && b.consent_email !== cur.consent_email;
    const r = await db.query(
      `update customers set name = coalesce($3,name), cpf = case when $4::boolean then $5 else cpf end, phone = case when $6::boolean then $7 else phone end,
         email = case when $8::boolean then $9 else email end, birthday = case when $10::boolean then $11::date else birthday end,
         address = coalesce($12,address), tags = coalesce($13,tags), preferences = coalesce($14,preferences), notes = coalesce($15,notes),
         consent_whatsapp = coalesce($16,consent_whatsapp), consent_email = coalesce($17,consent_email),
         consent_at = case when $18::boolean then now() else consent_at end,
         unsubscribed_at = case when coalesce($16,false) or coalesce($17,false) then null else unsubscribed_at end, updated_at = now()
       where id = $1 and company_id = $2 returning *`,
      [
        id,
        req.ctx.companyId,
        b.name ?? null,
        v.cpf !== void 0,
        v.cpf ?? null,
        v.phone !== void 0,
        v.phone ?? null,
        v.email !== void 0,
        v.email ?? null,
        v.birthday !== void 0,
        v.birthday ?? null,
        b.address ?? null,
        b.tags ?? null,
        b.preferences ?? null,
        b.notes ?? null,
        b.consent_whatsapp ?? null,
        b.consent_email ?? null,
        consentChanged
      ]
    ).catch((e) => {
      if (e.code === "23505") throw conflict("J\xE1 existe cliente com este CPF", "cpf_in_use");
      throw e;
    });
    await audit(db, req.ctx, consentChanged ? "cliente.consentimento" : "cliente.alterado", {
      entity: "customer",
      entityId: id,
      data: { fields: Object.keys(b), consent_whatsapp: b.consent_whatsapp, consent_email: b.consent_email }
    });
    return r.rows[0];
  });
  res.json(presentCustomer(out, req.ctx));
}));
router8.post("/:id/points", need("clientes.gerenciar", "pdv.autorizar"), h(async (req, res) => {
  const b = parse(z7.object({ points: z7.number().int().refine((n) => n !== 0).refine((n) => Math.abs(n) <= 1e5), reason: z7.string().trim().min(3).max(200) }), req.body);
  const id = Number(req.params.id);
  const out = await tx(async (db) => {
    const c = (await db.query("select points from customers where id = $1 and company_id = $2 for update", [id, req.ctx.companyId])).rows[0];
    if (!c) throw notFound("Cliente n\xE3o encontrado");
    if (c.points + b.points < 0) throw conflict("Saldo n\xE3o pode ficar negativo");
    const l = await addLedger(db, req.ctx.companyId, id, { kind: "ajuste", points: b.points, reason: b.reason, user_id: req.ctx.userId });
    await audit(db, req.ctx, "cliente.pontos_ajustados", { entity: "customer", entityId: id, reason: b.reason, data: { points: b.points } });
    return l;
  });
  res.status(201).json(out);
}));
router8.post("/:id/redeem", need("pdv.receber"), h(async (req, res) => {
  const b = parse(z7.object({ session_id: z7.number().int(), points: z7.number().int().positive(), idempotency_key: z7.string().regex(/^[A-Za-z0-9_-]{8,80}$/) }), req.body);
  const id = Number(req.params.id);
  const prev = await q("select * from payments where company_id = $1 and idempotency_key = $2", [req.ctx.companyId, b.idempotency_key]);
  if (prev.rows[0]) return res.json({ payment: prev.rows[0], replay: true });
  const out = await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, b.session_id);
    assertUnitScope(req.ctx, s.unit_id);
    if (!["aberta", "em_fechamento"].includes(s.status)) throw conflict("Consumo encerrado", "session_not_open");
    if (Number(s.customer_id) !== id) throw conflict("O consumo n\xE3o est\xE1 identificado com este cliente", "customer_mismatch");
    await expirePoints(db, req.ctx.companyId, id);
    const co = (await db.query("select settings, timezone from companies where id = $1", [req.ctx.companyId])).rows[0];
    const cfg = loyaltyConfig(co.settings);
    if (!cfg.enabled) throw conflict("Programa de fidelidade desligado");
    if (b.points < cfg.min_redeem) throw bad(`Resgate m\xEDnimo de ${cfg.min_redeem} pontos`);
    const amount = b.points * cfg.point_value_cents;
    const t = await sessionTotals(db, s.id);
    if (amount > t.balance) throw bad("Valor do resgate maior que o saldo do consumo", "over_balance");
    const u = (await db.query("select day_cutoff from units where id = $1", [s.unit_id])).rows[0];
    const p = (await db.query(
      `insert into payments (company_id, session_id, method, amount_cents, business_date, idempotency_key, user_id)
       values ($1,$2,'vale',$3,$4,$5,$6) returning *`,
      [req.ctx.companyId, s.id, amount, businessDate(/* @__PURE__ */ new Date(), co.timezone, u.day_cutoff), b.idempotency_key, req.ctx.userId]
    )).rows[0];
    await redeemPoints(db, req.ctx, id, b.points, p.id, s.id);
    await db.query("update consumption_sessions set version = version + 1 where id = $1", [s.id]);
    await audit(db, req.ctx, "cliente.pontos_resgatados", { entity: "payment", entityId: p.id, unitId: s.unit_id, data: { customer: id, points: b.points, amount_cents: amount } });
    return { payment: p, totals: await sessionTotals(db, s.id) };
  });
  res.status(201).json(out);
}));
router8.post("/attach", need("pdv.lancar"), h(async (req, res) => {
  const b = parse(z7.object({ session_id: z7.number().int(), customer_id: z7.number().int().nullable() }), req.body);
  const out = await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, b.session_id);
    assertUnitScope(req.ctx, s.unit_id);
    if (!["aberta", "em_fechamento"].includes(s.status)) throw conflict("Consumo encerrado", "session_not_open");
    let name = null;
    if (b.customer_id) {
      const c = (await db.query("select name from customers where id = $1 and company_id = $2 and anonymized_at is null", [b.customer_id, req.ctx.companyId])).rows[0];
      if (!c) throw notFound("Cliente n\xE3o encontrado");
      name = c.name;
    }
    await db.query("update consumption_sessions set customer_id = $2, customer_name = coalesce($3, customer_name), version = version + 1 where id = $1", [s.id, b.customer_id, name]);
    await audit(db, req.ctx, "consumo.cliente", { entity: "session", entityId: s.id, data: { customer: b.customer_id } });
    return { ok: true, customer_name: name };
  });
  res.json(out);
}));
router8.get("/export/csv", need("clientes.gerenciar"), h(async (req, res) => {
  const rows = (await q("select * from customers where company_id = $1 and anonymized_at is null order by name", [req.ctx.companyId])).rows;
  const cols = ["nome", "cpf", "telefone", "email", "aniversario", "etiquetas", "pontos", "whatsapp", "email_ok"];
  const lines = [cols.join(";")];
  for (const r of rows) {
    const c = presentCustomer(r, req.ctx);
    lines.push([c.name, c.cpf, c.phone, c.email, c.birthday, (c.tags || []).join("|"), c.points, c.consent_whatsapp ? "sim" : "nao", c.consent_email ? "sim" : "nao"].map(csvCell).join(
    ";"));
  }
  await audit({ query: q }, req.ctx, "cliente.exportados", { data: { count: rows.length, full: req.ctx.can("dados.pessoais") } });
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", 'attachment; filename="clientes.csv"');
  res.send(`\uFEFF${lines.join("\n")}`);
}));
router8.post("/import", need("clientes.gerenciar", "dados.pessoais"), h(async (req, res) => {
  const b = parse(z7.object({ rows: z7.array(z7.record(z7.string(), z7.any())).max(2e3), dry_run: z7.boolean().default(true) }), req.body);
  const pick2 = (r, ...keys) => {
    for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().trim())) return String(r[k] ?? "").trim();
    return "";
  };
  const existing = (await q("select cpf, regexp_replace(coalesce(phone,''),'\\D','','g') as phone from customers where company_id = $1", [req.ctx.companyId])).rows;
  const cpfs = new Set(existing.map((e) => e.cpf).filter(Boolean));
  const phones = new Set(existing.map((e) => e.phone).filter(Boolean));
  const report = [];
  const ok = [];
  b.rows.forEach((r, i) => {
    const name = pick2(r, "nome", "name", "cliente");
    const cpfRaw = pick2(r, "cpf", "documento");
    const phone = phoneNorm(pick2(r, "telefone", "celular", "whatsapp", "phone"));
    const email = pick2(r, "email", "e-mail");
    let birthday = pick2(r, "aniversario", "anivers\xE1rio", "nascimento", "birthday");
    const m = birthday.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) birthday = `${m[3]}-${m[2]}-${m[1]}`;
    const line = i + 2;
    if (name.length < 2) return report.push({ line, status: "erro", message: "Nome ausente" });
    let cpf = null;
    if (cpfRaw) {
      try {
        cpf = normalizeCpf(cpfRaw);
      } catch {
        return report.push({ line, status: "erro", message: "CPF inv\xE1lido" });
      }
    }
    if (cpf && cpfs.has(cpf)) return report.push({ line, status: "duplicado", message: "CPF j\xE1 cadastrado" });
    if (!cpf && phone && phones.has(phone)) return report.push({ line, status: "duplicado", message: "Telefone j\xE1 cadastrado" });
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) birthday = "";
    if (cpf) cpfs.add(cpf);
    if (phone) phones.add(phone);
    ok.push({ name: name.slice(0, 100), cpf, phone, email: /@/.test(email) ? email.slice(0, 120) : null, birthday: birthday || null });
    report.push({ line, status: "ok", name });
  });
  if (!b.dry_run && ok.length) {
    await tx(async (db) => {
      for (const c of ok) {
        await db.query(
          "insert into customers (company_id, cpf, name, phone, email, birthday, created_by) values ($1,$2,$3,$4,$5,$6,$7)",
          [req.ctx.companyId, c.cpf, c.name, c.phone, c.email, c.birthday, req.ctx.userId]
        );
      }
      await audit(db, req.ctx, "cliente.importados", { data: { count: ok.length } });
    });
  }
  res.json({ dry_run: b.dry_run, valid: ok.length, report: report.slice(0, 500) });
}));
router8.post("/:id/anonymize", need("clientes.gerenciar", "dados.pessoais"), h(async (req, res) => {
  const b = parse(z7.object({ reason: z7.string().trim().min(3).max(200) }), req.body);
  assertCan(req.ctx, "pdv.autorizar");
  const id = Number(req.params.id);
  await tx(async (db) => {
    const r = await db.query(`update customers set name = 'Cliente anonimizado', cpf = null, phone = null, email = null, birthday = null,
        address = '{}', tags = '{}', preferences = null, notes = null, consent_whatsapp = false, consent_email = false, anonymized_at = now(), updated_at = now()
      where id = $1 and company_id = $2 and anonymized_at is null returning id`, [id, req.ctx.companyId]);
    if (!r.rows[0]) throw notFound("Cliente n\xE3o encontrado");
    await db.query(`update consumption_sessions set customer_name = null where company_id = $1 and customer_id = $2`, [req.ctx.companyId, id]);
    await db.query(`update delivery_orders set customer_name = 'Anonimizado', phone = '', address = '{}' where company_id = $1 and customer_id = $2`, [req.ctx.companyId, id]);
    await audit(db, req.ctx, "cliente.anonimizado", { entity: "customer", entityId: id, reason: b.reason });
  });
  res.json({ ok: true });
}));

// src/routes/kitchen.js
import { Router as Router9 } from "npm:express@5.2.1";
import { z as z8 } from "npm:zod@4.6.5";
var router9 = Router9();
var anyOf = (...perms) => (req, _res, next) => perms.some((p) => req.ctx.can(p)) ? next() : next(forbidden("Sem permiss\xE3o para o painel"));
var FLOW = ["novo", "aceito", "preparando", "pronto", "entregue"];
router9.get("/sectors", need("cozinha.operar"), h(async (req, res) => {
  res.json((await q(`select s.id, s.name, s.target_minutes,
      (select count(*)::int from order_items i where i.sector_id = s.id and i.sent_at is not null and i.status = 'ativo'
         and i.kitchen_status in ('novo','aceito','preparando')) as open_count
    from production_sectors s where s.company_id = $1 and s.active order by s.id`, [req.ctx.companyId])).rows);
}));
router9.put("/sectors/:id", need("cardapio.gerenciar"), h(async (req, res) => {
  const b = parse(z8.object({ target_minutes: z8.number().int().min(1).max(240) }), req.body);
  const r = await q("update production_sectors set target_minutes = $3 where id = $1 and company_id = $2 returning id", [Number(req.params.id), req.ctx.companyId, b.target_minutes]);
  if (!r.rows[0]) throw notFound();
  res.json({ ok: true });
}));
router9.get("/queue", need("cozinha.operar"), h(async (req, res) => {
  const params = [req.ctx.companyId];
  let where = `i.company_id = $1 and i.sent_at is not null and i.kitchen_status <> 'nao_produz'
    and (i.kitchen_status in ('novo','aceito','preparando','pronto')
         or (i.kitchen_status = 'cancelado' and i.cancel_ack_at is null and i.accepted_at is not null)
         or (i.kitchen_status = 'cancelado' and i.cancel_ack_at is null and i.canceled_at > now() - interval '30 minutes'))`;
  if (req.query.sector_id) {
    params.push(Number(req.query.sector_id));
    where += ` and i.sector_id = $${params.length}`;
  }
  const unit = req.ctx.terminalUnitId || req.ctx.unitId;
  if (unit) {
    params.push(unit);
    where += ` and s.unit_id = $${params.length}`;
  }
  const rows = (await q(
    `select i.id, i.session_id, i.description, i.qty, i.unit, i.modifiers, i.notes, i.kitchen_status, i.status, i.priority, i.sector_id,
            i.created_at, i.sent_at, i.accepted_at, i.ready_at, i.cancel_reason, i.canceled_at, i.launch_mode,
            s.kind, s.label, s.customer_name, c.number as card_number, t.number as table_number, d.number as delivery_number, d.mode as delivery_mode,
            ps.name as sector_name, ps.target_minutes, u.name as user_name,
            exists(select 1 from order_items o where o.session_id = i.session_id and o.id < i.id and o.sent_at < i.sent_at - interval '1 minute') as added_later
       from order_items i join consumption_sessions s on s.id = i.session_id
       left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join delivery_orders d on d.session_id = s.id left join production_sectors ps on ps.id = i.sector_id
       left join users u on u.id = i.user_id
      where ${where} order by i.priority desc, i.sent_at, i.id limit 400`,
    params
  )).rows;
  const last = (await q("select coalesce(max(id),0)::bigint as id from kitchen_events where company_id = $1", [req.ctx.companyId])).rows[0].id;
  res.json({ now: (/* @__PURE__ */ new Date()).toISOString(), last_event: last, items: rows });
}));
router9.post("/items/:id/status", need("cozinha.operar"), h(async (req, res) => {
  const b = parse(z8.object({ to: z8.enum(["aceito", "preparando", "pronto", "entregue"]), from: z8.string().optional() }), req.body);
  const out = await tx(async (db) => {
    const it = (await db.query("select * from order_items where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!it) throw notFound("Item n\xE3o encontrado");
    if (it.kitchen_status === b.to) return { ok: true, replay: true, status: it.kitchen_status };
    if (it.status !== "ativo" || it.kitchen_status === "cancelado") throw conflict("Item cancelado: confirme a ci\xEAncia do cancelamento", "item_canceled");
    if (!it.sent_at) throw conflict("Item ainda n\xE3o enviado \xE0 produ\xE7\xE3o", "not_sent");
    if (b.from && b.from !== it.kitchen_status) throw conflict(`O item j\xE1 est\xE1 "${it.kitchen_status}" (alterado em outra tela)`, "status_changed", { status: it.kitchen_status });
    const iFrom = FLOW.indexOf(it.kitchen_status);
    const iTo = FLOW.indexOf(b.to);
    if (iTo <= iFrom) throw conflict("N\xE3o \xE9 poss\xEDvel voltar a etapa anterior", "invalid_transition");
    await db.query(`update order_items set kitchen_status = $2,
        accepted_at = coalesce(accepted_at, case when $2 in ('aceito','preparando','pronto','entregue') then now() end),
        ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
        delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`, [it.id, b.to]);
    await db.query(
      "insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$2,$3,$4,$5)",
      [req.ctx.companyId, it.id, it.kitchen_status, b.to, req.ctx.userId]
    );
    return { ok: true, status: b.to };
  });
  res.json(out);
}));
router9.post("/sessions/:id/advance", need("cozinha.operar"), h(async (req, res) => {
  const b = parse(z8.object({ to: z8.enum(["aceito", "preparando", "pronto", "entregue"]), sector_id: z8.number().int().optional() }), req.body);
  const iTo = FLOW.indexOf(b.to);
  const out = await tx(async (db) => {
    const params = [Number(req.params.id), req.ctx.companyId, FLOW.slice(0, iTo)];
    let extra = "";
    if (b.sector_id) {
      params.push(b.sector_id);
      extra = ` and sector_id = $${params.length}`;
    }
    const items = (await db.query(`select id, kitchen_status from order_items where session_id = $1 and company_id = $2 and status = 'ativo'
      and sent_at is not null and kitchen_status = any($3)${extra} for update`, params)).rows;
    for (const it of items) {
      await db.query(`update order_items set kitchen_status = $2, accepted_at = coalesce(accepted_at, now()),
          ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
          delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`, [it.id, b.to]);
      await db.query(
        "insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$2,$3,$4,$5)",
        [req.ctx.companyId, it.id, it.kitchen_status, b.to, req.ctx.userId]
      );
    }
    return { changed: items.length };
  });
  res.json(out);
}));
router9.post("/items/:id/ack-cancel", need("cozinha.operar"), h(async (req, res) => {
  const r = await q(
    `update order_items set cancel_ack_at = now() where id = $1 and company_id = $2 and kitchen_status = 'cancelado' and cancel_ack_at is null returning id`,
    [Number(req.params.id), req.ctx.companyId]
  );
  if (r.rows[0]) await q(
    "insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$2,$3,$4,$5)",
    [req.ctx.companyId, r.rows[0].id, "cancelado", "cancelado_ciente", req.ctx.userId]
  );
  res.json({ ok: true });
}));
router9.post("/items/:id/priority", need("cozinha.operar"), h(async (req, res) => {
  const b = parse(z8.object({ priority: z8.boolean(), reason: z8.string().trim().min(3).max(200) }), req.body);
  assertCan(req.ctx, "pdv.autorizar");
  const r = await q("update order_items set priority = $3 where id = $1 and company_id = $2 returning id, session_id", [Number(req.params.id), req.ctx.companyId, b.priority]);
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, "producao.prioridade", { entity: "item", entityId: r.rows[0].id, reason: b.reason, data: { priority: b.priority } });
  res.json({ ok: true });
}));
router9.get("/ready", need("pdv.lancar"), h(async (req, res) => {
  res.json((await q(`select i.id, i.description, i.qty, i.ready_at, s.id as session_id, s.label, c.number as card_number, t.number as table_number
     from order_items i join consumption_sessions s on s.id = i.session_id left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
     where i.company_id = $1 and i.kitchen_status = 'pronto' and i.status = 'ativo' order by i.ready_at limit 100`, [req.ctx.companyId])).rows);
}));
router9.get("/stats", need("cozinha.operar"), h(async (req, res) => {
  const r = (await q(`select ps.name as sector, count(*)::int as items,
      round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::numeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
     from order_items i join production_sectors ps on ps.id = i.sector_id
    where i.company_id = $1 and i.ready_at is not null and i.sent_at > now() - interval '24 hours' group by ps.name order by ps.name`, [req.ctx.companyId])).rows;
  res.json(r);
}));
router9.get("/board", anyOf("pdv.lancar", "cozinha.operar"), h(async (req, res) => {
  const unit = req.ctx.terminalUnitId || req.ctx.unitId;
  const params = [req.ctx.companyId];
  let unitF = "";
  if (unit) {
    params.push(unit);
    unitF = ` and s.unit_id = $${params.length}`;
  }
  const rows = (await q(`
    select s.id, s.kind, s.label, s.customer_name, c.number as card_number, t.number as table_number, d.number as delivery_number, d.mode as delivery_mode,
           count(*) filter (where i.kitchen_status in ('novo','aceito','preparando'))::int as pending,
           count(*) filter (where i.kitchen_status = 'pronto')::int as ready,
           min(i.sent_at) as sent_at, max(i.ready_at) as ready_at,
           coalesce(json_agg(json_build_object('d', i.description, 'q', i.qty, 's', i.kitchen_status) order by i.id), '[]') as items,
           (select max(e.created_at) from kitchen_events e join order_items i2 on i2.id = e.item_id where i2.session_id = s.id and e.to_status = 'chamado') as called_at
      from order_items i join consumption_sessions s on s.id = i.session_id
      left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id left join delivery_orders d on d.session_id = s.id
     where i.company_id = $1${unitF} and i.status = 'ativo' and i.sent_at is not null and i.kitchen_status in ('novo','aceito','preparando','pronto')
       and s.status in ('aberta','em_fechamento') and coalesce(d.status, '') not in ('saiu','entregue','cancelado')
     group by s.id, c.number, t.number, d.number, d.mode
     order by min(i.sent_at)
     limit 120`, params)).rows;
  const first = (n) => n ? String(n).trim().split(/\s+/)[0] : null;
  const version = (await q("select coalesce(max(id),0)::bigint as id from kitchen_events where company_id = $1", [req.ctx.companyId])).rows[0].id;
  res.set("cache-control", "no-store");
  res.json({ now: (/* @__PURE__ */ new Date()).toISOString(), version: String(version), orders: rows.map((r) => ({
    id: r.id,
    code: r.delivery_number ? `#${r.delivery_number}` : r.card_number ? String(r.card_number) : r.table_number ? String(r.table_number) : String(r.id),
    kind: r.delivery_number ? r.delivery_mode === "retirada" ? "retirada" : "delivery" : r.card_number ? "comanda" : r.table_number ? "mesa" : r.kind,
    table: r.card_number && r.table_number ? r.table_number : null,
    name: first(r.customer_name),
    // Pronto assim que houver item pronto para retirar (mesmo que outro setor, ex.: bar, ainda esteja preparando)
    status: r.ready > 0 ? "pronto" : "preparando",
    partial: r.pending > 0 && r.ready > 0,
    pending: r.pending,
    ready_count: r.ready,
    sent_at: r.sent_at,
    ready_at: r.ready_at,
    called_at: r.called_at,
    items: r.items.map((x) => ({ d: x.d, q: Number(x.q), ready: x.s === "pronto" }))
  })) });
}));
router9.post("/sessions/:id/call", anyOf("pdv.lancar", "cozinha.operar"), h(async (req, res) => {
  const it = (await q(
    `select id, kitchen_status from order_items where session_id = $1 and company_id = $2 and status = 'ativo' and sent_at is not null
      and kitchen_status in ('novo','aceito','preparando','pronto') order by (kitchen_status = 'pronto') desc, id desc limit 1`,
    [Number(req.params.id), req.ctx.companyId]
  )).rows[0];
  if (!it) throw conflict("Este pedido n\xE3o est\xE1 mais no painel", "nothing_to_call");
  const ev = (await q(
    `insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$2,$3,'chamado',$4) returning created_at`,
    [req.ctx.companyId, it.id, it.kitchen_status, req.ctx.userId]
  )).rows[0];
  res.json({ ok: true, called_at: ev.created_at });
}));

// src/routes/stock.js
import { Router as Router10 } from "npm:express@5.2.1";
import { z as z9 } from "npm:zod@4.6.5";

// src/lib/notes.js
var norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
var aliasKey = (s) => norm(s).slice(0, 120);
async function aiConfig(companyId) {
  const own = (await q("select key, value from company_secrets where company_id = $1 and key in ('ai_api_key','ai_model')", [companyId])).rows;
  const plat = (await q("select key, value from platform_config where key in ('anthropic_api_key','ai_model')").catch(() => ({ rows: [] }))).rows;
  const get = (rows, k) => rows.find((r) => r.key === k)?.value;
  return {
    key: get(own, "ai_api_key") || env.ANTHROPIC_API_KEY || get(plat, "anthropic_api_key") || null,
    model: get(own, "ai_model") || env.AI_MODEL || get(plat, "ai_model") || "claude-sonnet-5-5",
    url: env.AI_API_URL || "https://api.anthropic.com/v1/messages"
  };
}
async function aiAvailable(companyId) {
  return !!(await aiConfig(companyId)).key;
}
var PROMPT = `Voc\xEA l\xEA documentos de compra de bares e restaurantes no Brasil: nota fiscal (NF-e/DANFE, NFC-e, cupom), pedido de compra,
romaneio ou lista escrita \xE0 m\xE3o. Extraia SOMENTE o que est\xE1 escrito. Responda apenas com JSON v\xE1lido, sem texto antes ou depois, no formato:
{"supplier": string|null, "document": string|null, "date": "AAAA-MM-DD"|null, "total": number|null,
 "items": [{"description": string, "qty": number, "unit": string|null, "unit_price": number|null, "total": number|null}],
 "warnings": [string]}
Regras: n\xFAmeros com ponto decimal (12,50 \u2192 12.5); "unit" como est\xE1 na nota (UN, CX, KG, FD, PCT, L, GF...);
n\xE3o invente itens, pre\xE7os ou quantidades; se algo estiver ileg\xEDvel, deixe null e explique em "warnings";
ignore impostos, descontos gerais e totalizadores (eles n\xE3o s\xE3o itens).`;
async function readImage(companyId, dataUrl) {
  const cfg = await aiConfig(companyId);
  if (!cfg.key) throw new HttpError(503, "Leitura por foto n\xE3o configurada: informe a chave da API em Estoque \u203A Leitura de notas, ou use o XML da NF-e.", "ai_not_configured");
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, "Envie uma foto (JPG, PNG ou WEBP) ou PDF", "invalid");
  const source = { type: "base64", media_type: m[1], data: m[2] };
  const block = m[1] === "application/pdf" ? { type: "document", source } : { type: "image", source };
  let res;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      signal: AbortSignal.timeout(6e4),
      headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4e3, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }] })
    });
  } catch (e) {
    throw new HttpError(502, `N\xE3o foi poss\xEDvel ler a foto agora (${String(e.message || e).slice(0, 80)}). Tente de novo.`, "ai_unavailable");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Servi\xE7o de leitura recusou a foto: ${body?.error?.message?.slice(0, 160) || res.status}`, "ai_error");
  const text = (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let out;
  try {
    out = JSON.parse(json);
  } catch {
    throw new HttpError(422, "N\xE3o consegui entender a foto. Tente outra mais n\xEDtida, com a nota inteira e bem iluminada.", "ai_unreadable");
  }
  const num = (v) => v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
  return {
    supplier: out.supplier ? String(out.supplier).slice(0, 100) : null,
    document: out.document ? String(out.document).slice(0, 60) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(out.date || "") ? out.date : null,
    total: num(out.total),
    warnings: (out.warnings || []).map(String).slice(0, 10),
    items: (out.items || []).filter((i) => i && i.description).slice(0, 150).map((i) => ({
      description: String(i.description).slice(0, 120),
      qty: num(i.qty),
      unit: i.unit ? String(i.unit).slice(0, 10) : null,
      unit_price: num(i.unit_price),
      total: num(i.total)
    }))
  };
}
var UNIT_MAP = { un: "un", und: "un", unid: "un", pc: "un", p\u00E7: "un", kg: "kg", g: "g", gr: "g", l: "L", lt: "L", ml: "ml" };
var guessUnit = (u) => UNIT_MAP[norm(u)] || null;
async function matchLines(companyId, lines) {
  const items = (await q("select id, name, unit from stock_items where company_id = $1 and active", [companyId])).rows;
  const aliases = Object.fromEntries((await q("select alias, stock_item_id, factor from stock_aliases where company_id = $1", [companyId])).rows.map((a) => [a.alias, a]));
  return lines.map((l) => {
    const key2 = aliasKey(l.description);
    const al = aliases[key2];
    if (al && items.find((i) => Number(i.id) === Number(al.stock_item_id))) return { ...l, alias: key2, stock_item_id: Number(al.stock_item_id), factor: Number(al.factor), match: "\
aprendido" };
    const words = key2.split(" ").filter((w) => w.length > 2 && !/^\d+$/.test(w));
    let best = null;
    let score = 0;
    for (const it of items) {
      const iw = norm(it.name).split(" ").filter((w) => w.length > 2);
      if (!iw.length) continue;
      const hit = iw.filter((w) => words.some((x) => x.startsWith(w) || w.startsWith(x))).length;
      const s = hit / iw.length;
      if (s > score) {
        score = s;
        best = it;
      }
    }
    return { ...l, alias: key2, stock_item_id: score > 0.5 ? Number(best.id) : null, factor: 1, match: score > 0.5 ? "semelhante" : "novo", suggested_unit: guessUnit(l.unit) || "un" };
  });
}

// src/routes/stock.js
var router10 = Router10();
var UNITS = ["un", "kg", "g", "L", "ml"];
var qtyNum = z9.number().positive().max(1e6);
router10.get("/items", need("estoque.visualizar"), h(async (req, res) => {
  const rows = (await q(`select s.*, (select coalesce(sum(qty),0) from stock_movements m where m.stock_item_id = s.id)::float as balance,
      (select coalesce(-sum(qty),0) from stock_movements m where m.stock_item_id = s.id and m.kind = 'venda' and m.created_at > now() - interval '30 days')::float as used_30d
    from stock_items s where s.company_id = $1 ${req.query.all ? "" : "and s.active"} order by lower(s.name)`, [req.ctx.companyId])).rows;
  const showCost = req.ctx.can("relatorios.cmv") || req.ctx.can("compras.gerenciar");
  res.json(rows.map((r) => ({
    ...r,
    avg_cost_cents: showCost ? Number(r.avg_cost_cents) : null,
    status: r.balance <= 0 ? "zerado" : r.balance <= Number(r.min_qty) ? "baixo" : "ok",
    // sugestão de compra: repor até o ponto de reposição + consumo médio de 7 dias
    suggest: Math.max(0, Math.ceil((Number(r.reorder_qty) || Number(r.min_qty) * 2) + r.used_30d / 30 * 7 - r.balance))
  })));
}));
var itemSchema2 = z9.object({
  name: z9.string().trim().min(2).max(80),
  unit: z9.enum(UNITS),
  min_qty: z9.number().min(0).max(1e6).default(0),
  reorder_qty: z9.number().min(0).max(1e6).default(0),
  active: z9.boolean().default(true)
});
router10.post("/items", need("estoque.ajustar"), h(async (req, res) => {
  const b = parse(itemSchema2.extend({ initial_qty: z9.number().min(0).max(1e6).optional(), unit_cost_cents: z9.number().int().min(0).max(1e8).optional() }), req.body);
  const id = await tx(async (db) => {
    const r = await db.query(
      "insert into stock_items (company_id, name, unit, min_qty, reorder_qty, active) values ($1,$2,$3,$4,$5,$6) returning id",
      [req.ctx.companyId, b.name, b.unit, b.min_qty, b.reorder_qty, b.active]
    ).catch((e) => {
      if (e.code === "23505") throw conflict("J\xE1 existe insumo com este nome");
      throw e;
    });
    if (b.initial_qty) await receive(db, req.ctx, r.rows[0].id, b.initial_qty, b.unit_cost_cents || 0, { type: "saldo_inicial" }, "Saldo inicial");
    await audit(db, req.ctx, "estoque.insumo_criado", { entity: "stock_item", entityId: r.rows[0].id, data: { name: b.name, initial: b.initial_qty } });
    return r.rows[0].id;
  });
  res.status(201).json({ id });
}));
router10.put("/items/:id", need("estoque.ajustar"), h(async (req, res) => {
  const b = parse(itemSchema2.partial(), req.body);
  const r = await q(
    `update stock_items set name = coalesce($3,name), unit = coalesce($4,unit), min_qty = coalesce($5,min_qty), reorder_qty = coalesce($6,reorder_qty),
      active = coalesce($7,active) where id = $1 and company_id = $2 returning id`,
    [Number(req.params.id), req.ctx.companyId, b.name ?? null, b.unit ?? null, b.min_qty ?? null, b.reorder_qty ?? null, b.active ?? null]
  );
  if (!r.rows[0]) throw notFound("Insumo n\xE3o encontrado");
  res.json({ ok: true });
}));
router10.get("/items/:id/movements", need("estoque.visualizar"), h(async (req, res) => {
  res.json((await q(
    `select m.id, m.kind, m.qty::float, m.unit_cost_cents, m.ref_type, m.ref_id, m.reverses_id, m.reason, m.created_at, u.name as user_name
     from stock_movements m left join users u on u.id = m.user_id where m.company_id = $1 and m.stock_item_id = $2 order by m.id desc limit 200`,
    [req.ctx.companyId, Number(req.params.id)]
  )).rows);
}));
router10.post("/movements", need("estoque.ajustar"), h(async (req, res) => {
  const b = parse(z9.object({
    stock_item_id: z9.number().int(),
    kind: z9.enum(["entrada", "perda", "ajuste"]),
    qty: z9.number().refine((n) => n !== 0 && Math.abs(n) <= 1e6),
    unit_cost_cents: z9.number().int().min(0).max(1e8).optional(),
    reason: z9.string().trim().min(3).max(200)
  }), req.body);
  const out = await tx(async (db) => {
    const s = (await db.query("select * from stock_items where id = $1 and company_id = $2 for update", [b.stock_item_id, req.ctx.companyId])).rows[0];
    if (!s) throw notFound("Insumo n\xE3o encontrado");
    if (b.kind === "entrada") {
      if (b.qty <= 0) throw bad("Entrada deve ser positiva");
      await receive(db, req.ctx, s.id, b.qty, b.unit_cost_cents ?? Math.round(Number(s.avg_cost_cents)), { type: "manual" }, b.reason);
    } else {
      const qty = b.kind === "perda" ? -Math.abs(b.qty) : b.qty;
      await db.query(
        `insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6,$7)`,
        [req.ctx.companyId, s.id, b.kind, qty, s.avg_cost_cents, b.reason, req.ctx.userId]
      );
    }
    await audit(db, req.ctx, `estoque.${b.kind}`, { entity: "stock_item", entityId: s.id, reason: b.reason, data: { qty: b.qty } });
    return { balance: (await balances(db, req.ctx.companyId, [s.id]))[s.id] || 0 };
  });
  res.status(201).json(out);
}));
router10.post("/movements/:id/reverse", need("estoque.ajustar"), h(async (req, res) => {
  const b = parse(z9.object({ reason: z9.string().trim().min(3).max(200) }), req.body);
  const out = await tx(async (db) => {
    const m = (await db.query("select * from stock_movements where id = $1 and company_id = $2", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!m) throw notFound("Movimento n\xE3o encontrado");
    if (!["entrada", "perda", "ajuste"].includes(m.kind) || m.reverses_id) throw conflict("Este movimento \xE9 revertido pelo fluxo de origem (venda, compra ou invent\xE1rio)");
    await db.query(
      `insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reverses_id, reason, user_id) values ($1,$2,'reversao',$3,$4,$5,$6,$7)`,
      [req.ctx.companyId, m.stock_item_id, -Number(m.qty), m.unit_cost_cents, m.id, b.reason, req.ctx.userId]
    ).catch((e) => {
      if (e.code === "23505") throw conflict("Movimento j\xE1 revertido");
      throw e;
    });
    await audit(db, req.ctx, "estoque.reversao", { entity: "stock_movement", entityId: m.id, reason: b.reason });
    return { ok: true };
  });
  res.json(out);
}));
router10.get("/recipes", need("estoque.visualizar"), h(async (req, res) => {
  const products = (await q(`select p.id, p.name, p.price_cents, p.cost_cents, p.stock_mode, p.stock_item_id, p.kind, si.name as stock_item_name,
      r.id as recipe_id, r.version, r.yield_qty::float
    from products p left join recipes r on r.product_id = p.id and r.active left join stock_items si on si.id = p.stock_item_id
    where p.company_id = $1 and p.active order by p.name`, [req.ctx.companyId])).rows;
  const lines = (await q(`select l.recipe_id, l.stock_item_id, l.qty::float, l.loss_pct::float, s.name, s.unit from recipe_lines l join stock_items s on s.id = l.stock_item_id
    where l.company_id = $1 and l.recipe_id = any($2)`, [req.ctx.companyId, products.map((p) => p.recipe_id).filter(Boolean)])).rows;
  const showCost = req.ctx.can("relatorios.cmv") || req.ctx.can("compras.gerenciar");
  const out = [];
  for (const p of products) {
    const cost = showCost ? await theoreticalCost({ query: q }, req.ctx.companyId, p) : null;
    out.push({
      ...p,
      lines: lines.filter((l) => l.recipe_id === p.recipe_id),
      theoretical_cost_cents: cost,
      margin_pct: cost != null && p.price_cents ? Math.round((p.price_cents - cost) / p.price_cents * 1e3) / 10 : null
    });
  }
  res.json(out);
}));
router10.get("/recipes/:productId/history", need("estoque.visualizar"), h(async (req, res) => {
  res.json((await q(`select r.id, r.version, r.yield_qty::float, r.active, r.created_at, u.name as user_name,
      (select json_agg(json_build_object('name', s.name, 'qty', l.qty, 'unit', s.unit, 'loss_pct', l.loss_pct)) from recipe_lines l join stock_items s on s.id = l.stock_item_id whe\
re l.recipe_id = r.id) as lines
    from recipes r left join users u on u.id = r.created_by where r.company_id = $1 and r.product_id = $2 order by r.version desc`, [req.ctx.companyId, Number(req.params.productId)])).
  rows);
}));
router10.put("/recipes/:productId", need("estoque.ajustar"), h(async (req, res) => {
  const b = parse(z9.object({
    stock_mode: z9.enum(["nenhum", "ficha", "acabado"]),
    stock_item_id: z9.number().int().nullable().optional(),
    yield_qty: z9.number().positive().max(1e4).default(1),
    lines: z9.array(z9.object({ stock_item_id: z9.number().int(), qty: z9.number().positive().max(1e5), loss_pct: z9.number().min(0).max(99).default(0) })).max(60).default([]),
    notes: z9.string().max(300).optional()
  }), req.body);
  const pid = Number(req.params.productId);
  const out = await tx(async (db) => {
    const p = (await db.query("select * from products where id = $1 and company_id = $2 for update", [pid, req.ctx.companyId])).rows[0];
    if (!p) throw notFound("Produto n\xE3o encontrado");
    const ids = [.../* @__PURE__ */ new Set([...b.lines.map((l) => l.stock_item_id), ...b.stock_item_id ? [b.stock_item_id] : []])];
    if (ids.length) {
      const ok = (await db.query("select count(*)::int as n from stock_items where company_id = $1 and id = any($2)", [req.ctx.companyId, ids])).rows[0].n;
      if (ok !== ids.length) throw bad("Insumo inv\xE1lido");
    }
    if (b.stock_mode === "acabado" && !b.stock_item_id) throw bad("Escolha o item de estoque do produto acabado");
    if (b.stock_mode === "ficha" && !b.lines.length) throw bad("A ficha t\xE9cnica precisa de ao menos um insumo");
    if (new Set(b.lines.map((l) => l.stock_item_id)).size !== b.lines.length) throw bad("Insumo repetido na ficha");
    await db.query(
      "update products set stock_mode = $3, stock_item_id = $4, updated_at = now() where id = $1 and company_id = $2",
      [pid, req.ctx.companyId, b.stock_mode, b.stock_mode === "acabado" ? b.stock_item_id : null]
    );
    let version = null;
    if (b.lines.length && b.stock_mode !== "nenhum") {
      version = Number((await db.query("select coalesce(max(version),0) as v from recipes where product_id = $1", [pid])).rows[0].v) + 1;
      await db.query("update recipes set active = false where product_id = $1 and active", [pid]);
      const r = await db.query(
        "insert into recipes (company_id, product_id, version, yield_qty, notes, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
        [req.ctx.companyId, pid, version, b.yield_qty, b.notes ?? null, req.ctx.userId]
      );
      for (const l of b.lines) await db.query(
        "insert into recipe_lines (company_id, recipe_id, stock_item_id, qty, loss_pct) values ($1,$2,$3,$4,$5)",
        [req.ctx.companyId, r.rows[0].id, l.stock_item_id, l.qty, l.loss_pct]
      );
    } else {
      await db.query("update recipes set active = false where product_id = $1 and active", [pid]);
    }
    const cost = await theoreticalCost(db, req.ctx.companyId, { ...p, stock_mode: b.stock_mode, stock_item_id: b.stock_mode === "acabado" ? b.stock_item_id : null });
    if (b.stock_mode !== "nenhum") await db.query("update products set cost_cents = $3 where id = $1 and company_id = $2", [pid, req.ctx.companyId, cost]);
    await audit(db, req.ctx, "estoque.ficha", { entity: "product", entityId: pid, data: { mode: b.stock_mode, version, lines: b.lines.length } });
    return { ok: true, version, cost_cents: cost };
  });
  res.json(out);
}));
router10.get("/purchases", need("estoque.visualizar"), h(async (req, res) => {
  const rows = (await q(`select p.*, u.name as user_name,
      (select json_agg(json_build_object('id', l.id, 'stock_item_id', l.stock_item_id, 'name', s.name, 'unit', s.unit, 'qty', l.qty, 'received_qty', l.received_qty,
         'unit_cost_cents', l.unit_cost_cents) order by l.id) from purchase_lines l join stock_items s on s.id = l.stock_item_id where l.purchase_id = p.id) as lines
    from purchases p left join users u on u.id = p.created_by where p.company_id = $1 order by p.id desc limit 100`, [req.ctx.companyId])).rows;
  res.json(rows);
}));
router10.post("/purchases", need("compras.gerenciar"), h(async (req, res) => {
  const b = parse(z9.object({
    supplier: z9.string().trim().min(2).max(100),
    document: z9.string().trim().max(60).optional(),
    due_date: z9.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z9.string().max(300).optional(),
    lines: z9.array(z9.object({ stock_item_id: z9.number().int(), qty: qtyNum, unit_cost_cents: z9.number().int().min(0).max(1e8) })).min(1).max(100)
  }), req.body);
  const id = await tx(async (db) => {
    const ids = [...new Set(b.lines.map((l) => l.stock_item_id))];
    const ok = (await db.query("select count(*)::int as n from stock_items where company_id = $1 and id = any($2)", [req.ctx.companyId, ids])).rows[0].n;
    if (ok !== ids.length) throw bad("Insumo inv\xE1lido");
    const total = b.lines.reduce((s, l) => s + Math.round(l.qty * l.unit_cost_cents), 0);
    const r = await db.query(
      "insert into purchases (company_id, supplier, document, due_date, notes, total_cents, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [req.ctx.companyId, b.supplier, b.document ?? null, b.due_date ?? null, b.notes ?? null, total, req.ctx.userId]
    );
    for (const l of b.lines) await db.query(
      "insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) values ($1,$2,$3,$4,$5)",
      [req.ctx.companyId, r.rows[0].id, l.stock_item_id, l.qty, l.unit_cost_cents]
    );
    await audit(db, req.ctx, "compra.criada", { entity: "purchase", entityId: r.rows[0].id, data: { supplier: b.supplier, total_cents: total } });
    return r.rows[0].id;
  });
  res.status(201).json({ id });
}));
router10.post("/purchases/:id/receive", need("compras.gerenciar"), h(async (req, res) => {
  const b = parse(z9.object({ lines: z9.array(z9.object({ line_id: z9.number().int(), qty: qtyNum })).min(1).max(100) }), req.body);
  const out = await tx(async (db) => {
    const p = (await db.query("select * from purchases where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!p) throw notFound("Compra n\xE3o encontrada");
    if (["recebida", "cancelada"].includes(p.status)) throw conflict(`Compra ${p.status}`);
    for (const r of b.lines) {
      const l = (await db.query("select * from purchase_lines where id = $1 and purchase_id = $2 for update", [r.line_id, p.id])).rows[0];
      if (!l) throw bad("Linha inv\xE1lida");
      if (Number(l.received_qty) + r.qty > Number(l.qty) + 1e-4) throw bad("Quantidade recebida maior que a comprada");
      await db.query("update purchase_lines set received_qty = received_qty + $2 where id = $1", [l.id, r.qty]);
      await receive(db, req.ctx, l.stock_item_id, r.qty, Number(l.unit_cost_cents), { type: "purchase", id: p.id }, `Compra ${p.id} \u2014 ${p.supplier}`);
    }
    const left = (await db.query("select count(*)::int as n from purchase_lines where purchase_id = $1 and received_qty < qty", [p.id])).rows[0].n;
    const status = left ? "parcial" : "recebida";
    await db.query("update purchases set status = $2 where id = $1", [p.id, status]);
    await audit(db, req.ctx, "compra.recebida", { entity: "purchase", entityId: p.id, data: { status, lines: b.lines.length } });
    return { status };
  });
  res.json(out);
}));
router10.post("/purchases/:id/cancel", need("compras.gerenciar"), h(async (req, res) => {
  const b = parse(z9.object({ reason: z9.string().trim().min(3).max(200) }), req.body);
  const r = await q(
    `update purchases set status = 'cancelada', notes = coalesce(notes,'') || ' [cancelada: ' || $3 || ']' where id = $1 and company_id = $2 and status = 'aberta' returning id`,
    [Number(req.params.id), req.ctx.companyId, b.reason]
  );
  if (!r.rows[0]) throw conflict("S\xF3 compras ainda n\xE3o recebidas podem ser canceladas");
  await audit({ query: q }, req.ctx, "compra.cancelada", { entity: "purchase", entityId: r.rows[0].id, reason: b.reason });
  res.json({ ok: true });
}));
router10.get("/inventories", need("estoque.visualizar"), h(async (req, res) => {
  res.json((await q(`select i.*, u.name as user_name, a.name as approved_name from inventory_counts i left join users u on u.id = i.created_by
    left join users a on a.id = i.approved_by where i.company_id = $1 order by i.id desc limit 30`, [req.ctx.companyId])).rows);
}));
router10.post("/inventories", need("estoque.ajustar"), h(async (req, res) => {
  const b = parse(z9.object({ counts: z9.array(z9.object({ stock_item_id: z9.number().int(), counted: z9.number().min(0).max(1e6) })).min(1).max(500), notes: z9.string().max(300).optional() }),
  req.body);
  const bal = await balances({ query: q }, req.ctx.companyId, b.counts.map((c) => c.stock_item_id));
  const names = Object.fromEntries((await q("select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2)", [req.ctx.companyId, b.counts.map((c) => c.
  stock_item_id)])).rows.map((r2) => [r2.id, r2]));
  const lines = b.counts.filter((c) => names[c.stock_item_id]).map((c) => {
    const system = Math.round((bal[c.stock_item_id] || 0) * 1e3) / 1e3;
    const diff = Math.round((c.counted - system) * 1e3) / 1e3;
    return {
      stock_item_id: c.stock_item_id,
      name: names[c.stock_item_id].name,
      unit: names[c.stock_item_id].unit,
      system,
      counted: c.counted,
      diff,
      value_cents: Math.round(diff * Number(names[c.stock_item_id].avg_cost_cents))
    };
  });
  const r = await q("insert into inventory_counts (company_id, lines, notes, created_by) values ($1,$2,$3,$4) returning id", [req.ctx.companyId, JSON.stringify(lines), b.notes ?? null,
  req.ctx.userId]);
  res.status(201).json({ id: r.rows[0].id, lines });
}));
router10.post("/inventories/:id/approve", need("estoque.ajustar"), h(async (req, res) => {
  assertCan(req.ctx, "pdv.autorizar");
  const out = await tx(async (db) => {
    const inv = (await db.query("select * from inventory_counts where id = $1 and company_id = $2 and status = 'aberto' for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!inv) throw conflict("Invent\xE1rio n\xE3o est\xE1 aberto");
    if (Number(inv.created_by) === Number(req.ctx.userId) && req.ctx.level < 100) throw conflict("A aprova\xE7\xE3o deve ser feita por outra pessoa", "same_user");
    const bal = await balances(db, req.ctx.companyId, inv.lines.map((l) => l.stock_item_id));
    let n = 0;
    for (const l of inv.lines) {
      const sinceCount = Math.round(((bal[l.stock_item_id] || 0) - l.system) * 1e3) / 1e3;
      const adj = Math.round((l.counted + sinceCount - (bal[l.stock_item_id] || 0)) * 1e3) / 1e3;
      if (Math.abs(adj) < 5e-4) continue;
      await db.query(
        `insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
        select $1, id, 'inventario', $3, avg_cost_cents, 'inventory', $4, 'Invent\xE1rio aprovado', $5 from stock_items where id = $2 and company_id = $1`,
        [req.ctx.companyId, l.stock_item_id, adj, inv.id, req.ctx.userId]
      );
      n++;
    }
    await db.query("update inventory_counts set status = 'aprovado', approved_by = $2, approved_at = now() where id = $1", [inv.id, req.ctx.userId]);
    await audit(db, req.ctx, "estoque.inventario_aprovado", { entity: "inventory", entityId: inv.id, data: { adjustments: n } });
    return { adjustments: n };
  });
  res.json(out);
}));
router10.post("/inventories/:id/discard", need("estoque.ajustar"), h(async (req, res) => {
  const r = await q("update inventory_counts set status = 'descartado' where id = $1 and company_id = $2 and status = 'aberto' returning id", [Number(req.params.id), req.ctx.companyId]);
  if (!r.rows[0]) throw conflict("Invent\xE1rio n\xE3o est\xE1 aberto");
  res.json({ ok: true });
}));
router10.post("/produce", need("estoque.ajustar"), h(async (req, res) => {
  const b = parse(z9.object({ product_id: z9.number().int(), qty: qtyNum }), req.body);
  const out = await tx(async (db) => {
    const p = (await db.query("select * from products where id = $1 and company_id = $2", [b.product_id, req.ctx.companyId])).rows[0];
    if (!p) throw notFound("Produto n\xE3o encontrado");
    if (p.stock_mode !== "acabado") throw bad("Produ\xE7\xE3o pr\xF3pria vale para produtos com estoque de produto acabado");
    const recipe = (await db.query("select id from recipes where product_id = $1 and active", [p.id])).rows[0];
    if (!recipe) throw bad("Cadastre a ficha de produ\xE7\xE3o (insumos) deste produto acabado antes de produzir");
    const need2 = await requirements(db, req.ctx.companyId, { ...p, stock_mode: "ficha" }, b.qty);
    const items = (await db.query("select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2) for update", [req.ctx.companyId, [...need2.keys()]])).rows;
    let cost = 0;
    for (const s of items) {
      const qn = need2.get(Number(s.id));
      cost += qn * Number(s.avg_cost_cents);
      await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
        values ($1,$2,'producao_consumo',$3,$4,'production',$5,$6,$7)`, [req.ctx.companyId, s.id, -qn, s.avg_cost_cents, p.id, `Produ\xE7\xE3o de ${b.qty} ${p.name}`, req.ctx.userId]);
    }
    await receive(db, req.ctx, p.stock_item_id, b.qty, Math.round(cost / b.qty), { type: "production", id: p.id }, `Produ\xE7\xE3o de ${p.name}`);
    await audit(db, req.ctx, "estoque.producao", { entity: "product", entityId: p.id, data: { qty: b.qty, cost_cents: Math.round(cost) } });
    return { ok: true, cost_cents: Math.round(cost) };
  });
  res.json(out);
}));
router10.get("/settings", need("estoque.visualizar"), h(async (req, res) => {
  const c = (await q("select settings from companies where id = $1", [req.ctx.companyId])).rows[0];
  res.json(stockConfig(c.settings));
}));
router10.put("/settings", need("configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z9.object({
    enabled: z9.boolean().optional(),
    allow_negative: z9.boolean().optional(),
    correction_limit_cents: z9.number().int().min(0).max(1e8).optional(),
    correction_max_pct: z9.number().min(0).max(1e3).optional(),
    correction_expire_days: z9.number().int().min(1).max(60).optional()
  }), req.body);
  const before = (await q("select settings from companies where id = $1", [req.ctx.companyId])).rows[0];
  const next = { ...stockConfig(before.settings), ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== void 0)) };
  await q(`update companies set settings = jsonb_set(settings, '{stock}', $2::jsonb) where id = $1`, [req.ctx.companyId, JSON.stringify(next)]);
  await audit({ query: q }, req.ctx, "estoque.politica", { data: { antes: stockConfig(before.settings), depois: next } });
  res.json({ ok: true });
}));
var REASONS = {
  contagem: "Diverg\xEAncia de contagem",
  quebra: "Quebra / avaria",
  vencimento: "Vencimento / validade",
  erro_lancamento: "Erro de lan\xE7amento",
  consumo_interno: "Consumo interno / cortesia",
  furto_desvio: "Furto ou desvio",
  devolucao: "Devolu\xE7\xE3o ao fornecedor",
  outro: "Outro"
};
var r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
var corrSelect = `select c.*, c.system_qty::float as system_qty, c.counted_qty::float as counted_qty, c.diff_qty::float as diff_qty,
    s.name as item_name, s.unit, u.name as requested_name, d.name as decided_name,
    (select count(*)::int from stock_corrections x where x.company_id = c.company_id and x.stock_item_id = c.stock_item_id
       and x.status = 'aplicada' and x.created_at > c.created_at - interval '30 days' and x.id <> c.id) as recent_count
  from stock_corrections c join stock_items s on s.id = c.stock_item_id
  left join users u on u.id = c.requested_by left join users d on d.id = c.decided_by`;
async function otherApprovers(db, ctx) {
  return (await db.query(
    `select count(*)::int as n from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
     where u.company_id = $1 and u.active and u.id <> $2 and 'pdv.autorizar' = any(r.permissions) and 'estoque.ajustar' = any(r.permissions)`,
    [ctx.companyId, ctx.userId]
  )).rows[0].n;
}
async function applyCorrection(db, ctx, c, { selfApproved = false, note = null, auto = false } = {}) {
  const s = (await db.query("select id, avg_cost_cents from stock_items where id = $1 and company_id = $2 for update", [c.stock_item_id, ctx.companyId])).rows[0];
  const mv = await db.query(
    `insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
     values ($1,$2,'correcao',$3,$4,'stock_correction',$5,$6,$7) returning id`,
    [ctx.companyId, c.stock_item_id, c.diff_qty, s.avg_cost_cents, c.id, `Corre\xE7\xE3o #${c.id}: ${REASONS[c.reason_code]}`, ctx.userId]
  );
  await db.query(
    `update stock_corrections set status = 'aplicada', decided_by = $2, decided_at = now(), decision_note = $3, self_approved = $4, movement_id = $5 where id = $1`,
    [c.id, ctx.userId, note, selfApproved, mv.rows[0].id]
  );
  await audit(db, ctx, auto ? "estoque.correcao_aplicada_direto" : "estoque.correcao_aprovada", {
    entity: "stock_correction",
    entityId: c.id,
    reason: note || c.justification,
    data: {
      insumo: c.stock_item_id,
      saldo_sistema: Number(c.system_qty),
      saldo_real: Number(c.counted_qty),
      diferenca: Number(c.diff_qty),
      valor_cents: Number(c.value_cents),
      motivo: c.reason_code,
      solicitado_por: c.requested_by,
      autoaprovado: selfApproved,
      movimento: mv.rows[0].id
    }
  });
  return mv.rows[0].id;
}
router10.get("/corrections", need("estoque.visualizar"), h(async (req, res) => {
  const params = [req.ctx.companyId];
  let where = "c.company_id = $1";
  if (req.query.status) {
    params.push(String(req.query.status));
    where += ` and c.status = $${params.length}`;
  }
  if (req.query.from) {
    params.push(String(req.query.from));
    where += ` and c.created_at >= $${params.length}::date`;
  }
  if (req.query.to) {
    params.push(String(req.query.to));
    where += ` and c.created_at < $${params.length}::date + 1`;
  }
  if (req.query.item) {
    params.push(Number(req.query.item));
    where += ` and c.stock_item_id = $${params.length}`;
  }
  const cfg = stockConfig((await q("select settings from companies where id = $1", [req.ctx.companyId])).rows[0].settings);
  await q(`update stock_corrections set status = 'expirada', decided_at = now(), decision_note = 'Vencida sem decis\xE3o'
     where company_id = $1 and status = 'pendente' and created_at < now() - make_interval(days => $2)`, [req.ctx.companyId, cfg.correction_expire_days]);
  const rows = (await q(`${corrSelect} where ${where} order by c.id desc limit 500`, params)).rows;
  const showCost = req.ctx.can("relatorios.cmv") || req.ctx.can("compras.gerenciar") || req.ctx.can("pdv.autorizar");
  const out = rows.map((r) => ({
    ...r,
    reason_label: REASONS[r.reason_code],
    value_cents: showCost ? Number(r.value_cents) : null,
    unit_cost_cents: showCost ? Number(r.unit_cost_cents) : null,
    requested_ip: void 0,
    recurrent: r.recent_count >= 2
  }));
  if (req.query.format === "csv") {
    const esc = (v) => {
      const t = v == null ? "" : String(v);
      const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const head = ["id", "data", "insumo", "unidade", "saldo_sistema", "saldo_real", "diferenca", "valor_reais", "motivo", "justificativa", "evidencia", "situacao", "solicitado_por",
    "decidido_por", "decidido_em", "observacao_decisao", "autoaprovado", "movimento"];
    const lines = out.map((r) => [
      r.id,
      new Date(r.created_at).toISOString(),
      r.item_name,
      r.unit,
      r.system_qty,
      r.counted_qty,
      r.diff_qty,
      r.value_cents == null ? "" : (r.value_cents / 100).toFixed(2),
      r.reason_label,
      r.justification,
      r.evidence,
      r.status,
      r.requested_name,
      r.decided_name,
      r.decided_at ? new Date(r.decided_at).toISOString() : "",
      r.decision_note,
      r.self_approved ? "sim" : "n\xE3o",
      r.movement_id
    ].map(esc).join(";"));
    await audit({ query: q }, req.ctx, "estoque.correcoes_exportadas", { data: { linhas: out.length } });
    res.set("content-type", "text/csv; charset=utf-8").set("content-disposition", 'attachment; filename="correcoes-estoque.csv"');
    return res.send(`\uFEFF${head.join(";")}
${lines.join("\n")}`);
  }
  res.json({ reasons: REASONS, config: cfg, items: out });
}));
router10.post("/corrections", need("estoque.ajustar"), h(async (req, res) => {
  const b = parse(z9.object({
    stock_item_id: z9.number().int(),
    counted_qty: z9.number().min(0).max(1e6),
    reason_code: z9.enum(Object.keys(REASONS)),
    justification: z9.string().trim().min(15, "Explique o motivo com pelo menos 15 caracteres").max(500),
    evidence: z9.string().trim().max(300).optional(),
    expected_system_qty: z9.number().optional()
  }), req.body);
  await rateLimit(`stock-corr:${req.ctx.userId}`, 60, 3600);
  const out = await tx(async (db) => {
    const s = (await db.query("select * from stock_items where id = $1 and company_id = $2 for update", [b.stock_item_id, req.ctx.companyId])).rows[0];
    if (!s) throw notFound("Insumo n\xE3o encontrado");
    const cfg = stockConfig((await db.query("select settings from companies where id = $1", [req.ctx.companyId])).rows[0].settings);
    const pending = (await db.query(
      "select id from stock_corrections where company_id = $1 and stock_item_id = $2 and status = 'pendente' and created_at >= now() - make_interval(days => $3)",
      [req.ctx.companyId, s.id, cfg.correction_expire_days]
    )).rows[0];
    if (pending) throw conflict(`J\xE1 existe a corre\xE7\xE3o #${pending.id} pendente para este insumo. Aprove ou rejeite antes de pedir outra.`, "correction_pending");
    await db.query(`update stock_corrections set status = 'expirada', decided_at = now(), decision_note = 'Vencida sem decis\xE3o'
       where company_id = $1 and stock_item_id = $2 and status = 'pendente'`, [req.ctx.companyId, s.id]);
    const system = r4((await balances(db, req.ctx.companyId, [s.id]))[s.id] || 0);
    if (b.expected_system_qty != null && Math.abs(r4(b.expected_system_qty) - system) > 5e-4)
      throw conflict(`O saldo do sistema mudou para ${system} ${s.unit} enquanto voc\xEA contava. Confira e envie de novo.`, "balance_changed", { system_qty: system });
    const diff = r4(b.counted_qty - system);
    if (Math.abs(diff) < 5e-4) throw bad("O saldo informado \xE9 igual ao do sistema: n\xE3o h\xE1 o que corrigir");
    const cost = Number(s.avg_cost_cents) || 0;
    const value = Math.round(diff * cost);
    const recent = (await db.query(
      `select count(*)::int as n from stock_corrections where company_id = $1 and stock_item_id = $2 and status = 'aplicada' and created_at > now() - interval '30 days'`,
      [req.ctx.companyId, s.id]
    )).rows[0].n;
    const rules = [];
    if (!req.ctx.can("pdv.autorizar")) rules.push("quem pediu n\xE3o tem permiss\xE3o de aprovar");
    if (Math.abs(value) > cfg.correction_limit_cents) rules.push(`valor acima do limite de R$ ${(cfg.correction_limit_cents / 100).toFixed(2).replace(".", ",")}`);
    if (system > 0 && Math.abs(diff) / system * 100 > cfg.correction_max_pct) rules.push(`diferen\xE7a acima de ${cfg.correction_max_pct}% do saldo`);
    if (b.reason_code === "furto_desvio") rules.push("motivo furto/desvio sempre exige aprova\xE7\xE3o");
    if (recent >= 2) rules.push(`${recent + 1}\xAA corre\xE7\xE3o deste insumo em 30 dias`);
    const ins = await db.query(
      `insert into stock_corrections (company_id, stock_item_id, system_qty, counted_qty, diff_qty, unit_cost_cents, value_cents, reason_code,
        justification, evidence, needs_approval, approval_rule, requested_by, requested_ip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [
        req.ctx.companyId,
        s.id,
        system,
        b.counted_qty,
        diff,
        cost,
        value,
        b.reason_code,
        b.justification,
        b.evidence || null,
        rules.length > 0,
        rules.join("; ") || null,
        req.ctx.userId,
        String(req.ip || "").slice(0, 64)
      ]
    );
    const c = ins.rows[0];
    await audit(db, req.ctx, "estoque.correcao_solicitada", {
      entity: "stock_correction",
      entityId: c.id,
      reason: b.justification,
      data: { insumo: s.id, nome: s.name, saldo_sistema: system, saldo_real: b.counted_qty, diferenca: diff, valor_cents: value, motivo: b.reason_code, regras: rules }
    });
    if (!rules.length) await applyCorrection(db, req.ctx, c, { auto: true, note: "Dentro dos limites: aplicada por quem tem permiss\xE3o de aprovar" });
    return { id: c.id, status: rules.length ? "pendente" : "aplicada", rules, diff_qty: diff, value_cents: value, system_qty: system };
  });
  res.status(201).json(out);
}));
router10.post("/corrections/:id/approve", need("estoque.ajustar"), h(async (req, res) => {
  assertCan(req.ctx, "pdv.autorizar");
  const b = parse(z9.object({ note: z9.string().trim().max(300).optional() }), req.body || {});
  const out = await tx(async (db) => {
    const c = (await db.query("select * from stock_corrections where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!c) throw notFound("Corre\xE7\xE3o n\xE3o encontrada");
    if (c.status !== "pendente") throw conflict(`Esta corre\xE7\xE3o j\xE1 est\xE1 ${c.status}`);
    const cfg = stockConfig((await db.query("select settings from companies where id = $1", [req.ctx.companyId])).rows[0].settings);
    if (new Date(c.created_at).getTime() < Date.now() - cfg.correction_expire_days * 864e5) {
      await db.query("update stock_corrections set status = 'expirada', decided_at = now(), decision_note = 'Vencida sem decis\xE3o' where id = $1", [c.id]);
      return { expired: true };
    }
    let selfApproved = false;
    if (Number(c.requested_by) === Number(req.ctx.userId)) {
      if (await otherApprovers(db, req.ctx) > 0 || req.ctx.level < 100) throw conflict("A aprova\xE7\xE3o deve ser feita por outra pessoa (gerente ou propriet\xE1rio)", "same_user");
      if (!b.note || b.note.length < 10) throw bad("Sem outro aprovador na empresa: registre uma observa\xE7\xE3o (m\xEDn. 10 caracteres) para aprovar o pr\xF3prio pedido");
      selfApproved = true;
    }
    await applyCorrection(db, req.ctx, c, { selfApproved, note: b.note || null });
    return { ok: true, self_approved: selfApproved };
  });
  if (out.expired) throw conflict("Esta corre\xE7\xE3o venceu sem decis\xE3o. Conte de novo e fa\xE7a um novo pedido.", "expired");
  res.json(out);
}));
router10.post("/corrections/:id/reject", need("estoque.ajustar"), h(async (req, res) => {
  assertCan(req.ctx, "pdv.autorizar");
  const b = parse(z9.object({ note: z9.string().trim().min(5, "Informe o motivo da rejei\xE7\xE3o").max(300) }), req.body);
  const r = await q(`update stock_corrections set status = 'rejeitada', decided_by = $3, decided_at = now(), decision_note = $4
     where id = $1 and company_id = $2 and status = 'pendente' returning id, stock_item_id, diff_qty, value_cents`, [Number(req.params.id), req.ctx.companyId, req.ctx.userId, b.note]);
  if (!r.rows[0]) throw conflict("Esta corre\xE7\xE3o n\xE3o est\xE1 pendente");
  await audit({ query: q }, req.ctx, "estoque.correcao_rejeitada", {
    entity: "stock_correction",
    entityId: r.rows[0].id,
    reason: b.note,
    data: { insumo: r.rows[0].stock_item_id, diferenca: Number(r.rows[0].diff_qty), valor_cents: Number(r.rows[0].value_cents) }
  });
  res.json({ ok: true });
}));
router10.post("/items/from-products", need("estoque.ajustar"), h(async (req, res) => {
  const b = parse(z9.object({ product_ids: z9.array(z9.number().int()).min(1).max(300) }), req.body);
  const out = await tx(async (db) => {
    const ps = (await db.query(
      `select id, name, cost_cents from products where company_id = $1 and id = any($2) and active and stock_mode = 'nenhum' for update`,
      [req.ctx.companyId, b.product_ids]
    )).rows;
    let created = 0;
    let linked = 0;
    for (const p of ps) {
      let s = (await db.query("select id from stock_items where company_id = $1 and lower(name) = lower($2)", [req.ctx.companyId, p.name])).rows[0];
      if (!s) {
        s = (await db.query(`insert into stock_items (company_id, name, unit, avg_cost_cents) values ($1,$2,'un',$3) returning id`, [req.ctx.companyId, p.name.slice(0, 80), Number(
        p.cost_cents) || 0])).rows[0];
        created++;
      }
      await db.query("update products set stock_mode = 'acabado', stock_item_id = $3, updated_at = now() where id = $1 and company_id = $2", [p.id, req.ctx.companyId, s.id]);
      linked++;
    }
    await audit(db, req.ctx, "estoque.produtos_controlados", { data: { produtos: ps.map((p) => p.id), criados: created } });
    return { created, linked };
  });
  res.status(201).json(out);
}));
router10.get("/notes/status", need("compras.gerenciar"), h(async (req, res) => {
  const own = (await q("select 1 from company_secrets where company_id = $1 and key = 'ai_api_key'", [req.ctx.companyId])).rows[0];
  res.json({ photo: await aiAvailable(req.ctx.companyId), own_key: !!own });
}));
router10.put("/notes/key", need("compras.gerenciar", "configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z9.object({ api_key: z9.string().trim().max(300) }), req.body);
  if (b.api_key && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(b.api_key)) throw bad('Chave inv\xE1lida: ela come\xE7a com "sk-ant-"');
  if (!b.api_key) await q("delete from company_secrets where company_id = $1 and key = 'ai_api_key'", [req.ctx.companyId]);
  else await q(`insert into company_secrets (company_id, key, value) values ($1,'ai_api_key',$2) on conflict (company_id, key) do update set value = excluded.value, updated_at = no\
w()`, [req.ctx.companyId, b.api_key]);
  await audit({ query: q }, req.ctx, "estoque.leitura_chave", { data: { removed: !b.api_key } });
  res.json({ ok: true });
}));
router10.post("/notes/read", need("compras.gerenciar"), h(async (req, res) => {
  const b = parse(z9.object({ image: z9.string().max(9e6) }), req.body);
  await rateLimit(`notes:${req.ctx.companyId}`, 60, 3600);
  const doc = await readImage(req.ctx.companyId, b.image);
  res.json({ ...doc, items: await matchLines(req.ctx.companyId, doc.items) });
}));
router10.post("/notes/match", need("compras.gerenciar"), h(async (req, res) => {
  const b = parse(z9.object({ items: z9.array(z9.object({
    description: z9.string().max(120),
    qty: z9.number().nullable().optional(),
    unit: z9.string().max(10).nullable().optional(),
    unit_price: z9.number().nullable().optional(),
    total: z9.number().nullable().optional()
  })).max(300) }), req.body);
  res.json({ items: await matchLines(req.ctx.companyId, b.items) });
}));
router10.post("/notes/confirm", need("compras.gerenciar"), h(async (req, res) => {
  const b = parse(z9.object({
    supplier: z9.string().trim().min(2).max(100),
    document: z9.string().trim().max(60).optional().nullable(),
    due_date: z9.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    source: z9.enum(["foto", "xml", "manual"]),
    nfe_key: z9.string().regex(/^\d{44}$/).optional().nullable(),
    receive: z9.boolean().default(true),
    lines: z9.array(z9.object({
      description: z9.string().max(120),
      alias: z9.string().max(120).optional(),
      stock_item_id: z9.number().int().optional().nullable(),
      new_item: z9.object({ name: z9.string().trim().min(2).max(80), unit: z9.enum(["un", "kg", "g", "L", "ml"]), min_qty: z9.number().min(0).max(1e6).default(0) }).optional().nullable(),
      qty: z9.number().positive().max(1e6),
      factor: z9.number().positive().max(1e4).default(1),
      unit_cost_cents: z9.number().int().min(0).max(1e8)
    })).min(1).max(150)
  }), req.body);
  const out = await tx(async (db) => {
    if (b.nfe_key) {
      const dup = (await db.query("select id from purchases where company_id = $1 and nfe_key = $2 and status <> 'cancelada'", [req.ctx.companyId, b.nfe_key])).rows[0];
      if (dup) throw conflict(`Esta NF-e j\xE1 foi lan\xE7ada (compra #${dup.id})`, "nfe_duplicate");
    }
    const resolved = [];
    for (const l of b.lines) {
      let id = l.stock_item_id;
      if (!id && l.new_item) {
        const ex = (await db.query("select id from stock_items where company_id = $1 and lower(name) = lower($2)", [req.ctx.companyId, l.new_item.name])).rows[0];
        id = ex?.id ?? (await db.query(
          "insert into stock_items (company_id, name, unit, min_qty, reorder_qty) values ($1,$2,$3,$4,$5) returning id",
          [req.ctx.companyId, l.new_item.name, l.new_item.unit, l.new_item.min_qty, l.new_item.min_qty * 3]
        )).rows[0].id;
      }
      if (!id) throw bad(`Escolha o insumo de "${l.description}" ou marque para criar`);
      const ok = (await db.query("select 1 from stock_items where id = $1 and company_id = $2", [id, req.ctx.companyId])).rows[0];
      if (!ok) throw bad("Insumo inv\xE1lido");
      resolved.push({ ...l, stock_item_id: Number(id), stock_qty: Math.round(l.qty * l.factor * 1e3) / 1e3, stock_cost: Math.round(l.unit_cost_cents / l.factor) });
    }
    const total = b.lines.reduce((s, l) => s + Math.round(l.qty * l.unit_cost_cents), 0);
    const p = (await db.query(`insert into purchases (company_id, supplier, document, due_date, total_cents, created_by, source, nfe_key, notes)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [
      req.ctx.companyId,
      b.supplier,
      b.document ?? null,
      b.due_date ?? null,
      total,
      req.ctx.userId,
      b.source,
      b.nfe_key ?? null,
      { foto: "Lan\xE7ada pela foto da nota (conferida)", xml: "Importada do XML da NF-e", manual: "Nota/pedido digitado manualmente" }[b.source]
    ])).rows[0];
    for (const l of resolved) {
      const pl = (await db.query(
        "insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) values ($1,$2,$3,$4,$5) returning id",
        [req.ctx.companyId, p.id, l.stock_item_id, l.stock_qty, l.stock_cost]
      )).rows[0];
      if (b.receive) {
        await db.query("update purchase_lines set received_qty = qty where id = $1", [pl.id]);
        await receive(db, req.ctx, l.stock_item_id, l.stock_qty, l.stock_cost, { type: "purchase", id: p.id }, `Compra ${p.id} \u2014 ${b.supplier}`);
      }
      const alias = aliasKey(l.alias || l.description);
      if (alias) await db.query(`insert into stock_aliases (company_id, alias, stock_item_id, factor) values ($1,$2,$3,$4)
        on conflict (company_id, alias) do update set stock_item_id = excluded.stock_item_id, factor = excluded.factor, updated_at = now()`, [req.ctx.companyId, alias, l.stock_item_id,
      l.factor]);
    }
    if (b.receive) await db.query("update purchases set status = 'recebida' where id = $1", [p.id]);
    await audit(db, req.ctx, "compra.nota_lancada", { entity: "purchase", entityId: p.id, data: { source: b.source, lines: resolved.length, total_cents: total, received: b.receive } });
    return { purchase_id: p.id, lines: resolved.length, total_cents: total, received: b.receive };
  }).catch((e) => {
    if (e.code === "23505") throw conflict("Esta NF-e j\xE1 foi lan\xE7ada", "nfe_duplicate");
    throw e;
  });
  res.status(201).json(out);
}));

// src/routes/account.js
import { Router as Router11 } from "npm:express@5.2.1";
import { z as z10 } from "npm:zod@4.6.5";
var router11 = Router11();
var money = z10.number().int().positive().max(1e8);
var key = z10.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
var brl = (c) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
async function openCash(db, ctx) {
  const params = [ctx.companyId];
  let where = "company_id = $1 and status = 'aberto'";
  if (ctx.terminalId) {
    params.push(ctx.terminalId);
    where += ` and terminal_id = $${params.length}`;
  } else {
    params.push(ctx.userId);
    where += ` and user_id = $${params.length} and terminal_id is null`;
  }
  return (await db.query(`select id from cash_sessions where ${where} order by id desc limit 1 for update`, params)).rows[0];
}
async function lockCustomer(db, ctx, id) {
  const c = (await db.query("select * from customers where id = $1 and company_id = $2 for update", [id, ctx.companyId])).rows[0];
  if (!c) throw notFound("Cliente n\xE3o encontrado");
  if (c.anonymized_at) throw conflict("Cliente anonimizado");
  return c;
}
router11.get("/open", need("clientes.visualizar"), h(async (req, res) => {
  const rows = (await q(`select c.id, c.name, c.cpf, c.phone, c.fiado_limit_cents, a.balance, a.last_entry,
       (select min(x.created_at) from customer_account x where x.company_id = c.company_id and x.customer_id = c.id and x.kind = 'fiado') as first_fiado
     from customers c join (select customer_id, sum(amount_cents)::bigint as balance, max(created_at) as last_entry from customer_account where company_id = $1 group by customer_id\
) a
       on a.customer_id = c.id
     where c.company_id = $1 and a.balance <> 0 order by a.balance`, [req.ctx.companyId])).rows;
  const items = rows.map((r) => ({ ...presentCustomer(r, req.ctx), balance_cents: Number(r.balance), fiado_limit_cents: Number(r.fiado_limit_cents), last_entry: r.last_entry, first_fiado: r.
  first_fiado }));
  res.json({
    items,
    debt_cents: items.filter((x) => x.balance_cents < 0).reduce((s, x) => s - x.balance_cents, 0),
    credit_cents: items.filter((x) => x.balance_cents > 0).reduce((s, x) => s + x.balance_cents, 0)
  });
}));
router11.get("/customers/:id", need("clientes.visualizar"), h(async (req, res) => {
  const id = Number(req.params.id);
  const c = (await q("select * from customers where id = $1 and company_id = $2", [id, req.ctx.companyId])).rows[0];
  if (!c) throw notFound("Cliente n\xE3o encontrado");
  const entries = (await q(`select a.id, a.kind, a.amount_cents, a.method, a.session_id, a.payment_id, a.reverses_id, a.over_limit, a.reason, a.created_at, u.name as user_name,
       exists(select 1 from customer_account x where x.reverses_id = a.id) as reversed
     from customer_account a left join users u on u.id = a.user_id where a.company_id = $1 and a.customer_id = $2 order by a.id desc limit 200`, [req.ctx.companyId, id])).rows;
  res.json({
    customer: presentCustomer(c, req.ctx),
    has_cpf: !!c.cpf,
    fiado_limit_cents: Number(c.fiado_limit_cents),
    ...await accountSummary({ query: q }, req.ctx.companyId, id),
    entries: entries.map((e) => ({ ...e, amount_cents: Number(e.amount_cents), label: ACCOUNT_KINDS[e.kind] }))
  });
}));
async function moneyIn(req, res, kind) {
  const b = parse(z10.object({ amount_cents: money, method: z10.enum(["dinheiro", "pix", "debito", "credito"]), reason: z10.string().trim().max(200).optional(), idempotency_key: key }),
  req.body);
  const id = Number(req.params.id);
  const prev = (await q("select id from customer_account where company_id = $1 and idempotency_key = $2", [req.ctx.companyId, b.idempotency_key])).rows[0];
  if (prev) return res.json({ id: prev.id, replay: true, ...await accountSummary({ query: q }, req.ctx.companyId, id) });
  const out = await tx(async (db) => {
    const c = await lockCustomer(db, req.ctx, id);
    if (!c.cpf) throw conflict("Cadastre o CPF do cliente antes de lan\xE7ar na conta", "cpf_required");
    const cash = await openCash(db, req.ctx);
    if (!cash) throw conflict("Abra o caixa antes de receber", "cash_closed");
    const acc = await accountSummary(db, req.ctx.companyId, id);
    if (kind === "pagamento_fiado") {
      if (!acc.debt_cents) throw conflict("Este cliente n\xE3o tem fiado em aberto", "no_debt");
      if (b.amount_cents > acc.debt_cents) throw bad(`Valor maior que o fiado em aberto (${brl(acc.debt_cents)}). Para deixar cr\xE9dito, use "Lan\xE7ar cr\xE9dito".`, "over_debt");
    }
    const e = (await db.query(
      `insert into customer_account (company_id, customer_id, kind, amount_cents, method, cash_session_id, reason, idempotency_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [req.ctx.companyId, id, kind, b.amount_cents, b.method, cash.id, b.reason || null, b.idempotency_key, req.ctx.userId]
    )).rows[0];
    await audit(db, req.ctx, kind === "credito" ? "cliente.credito_lancado" : "cliente.fiado_recebido", {
      entity: "customer",
      entityId: id,
      reason: b.reason,
      data: { lancamento: e.id, valor_cents: b.amount_cents, forma: b.method, caixa: cash.id, saldo_antes: acc.balance_cents, saldo_depois: acc.balance_cents + b.amount_cents }
    });
    return { id: e.id, ...await accountSummary(db, req.ctx.companyId, id) };
  });
  res.status(201).json(out);
}
router11.post("/customers/:id/credit", need("pdv.receber", "clientes.visualizar"), h((req, res) => moneyIn(req, res, "credito")));
router11.post("/customers/:id/settle", need("pdv.receber", "clientes.visualizar"), h((req, res) => moneyIn(req, res, "pagamento_fiado")));
router11.post("/customers/:id/adjust", need("clientes.gerenciar", "pdv.autorizar"), h(async (req, res) => {
  const b = parse(z10.object({ amount_cents: z10.number().int().refine((n) => n !== 0 && Math.abs(n) <= 1e8), reason: z10.string().trim().min(10, "Explique o ajuste (m\xEDn. 10 caract\
eres)").max(300) }), req.body);
  const id = Number(req.params.id);
  const out = await tx(async (db) => {
    await lockCustomer(db, req.ctx, id);
    const acc = await accountSummary(db, req.ctx.companyId, id);
    const e = (await db.query(
      `insert into customer_account (company_id, customer_id, kind, amount_cents, reason, user_id) values ($1,$2,'ajuste',$3,$4,$5) returning id`,
      [req.ctx.companyId, id, b.amount_cents, b.reason, req.ctx.userId]
    )).rows[0];
    await audit(db, req.ctx, "cliente.conta_ajustada", { entity: "customer", entityId: id, reason: b.reason, data: { lancamento: e.id, valor_cents: b.amount_cents, saldo_antes: acc.
    balance_cents, saldo_depois: acc.balance_cents + b.amount_cents } });
    return { id: e.id, ...await accountSummary(db, req.ctx.companyId, id) };
  });
  res.status(201).json(out);
}));
router11.post("/entries/:id/reverse", need("financeiro.estornar"), h(async (req, res) => {
  const b = parse(z10.object({ reason: z10.string().trim().min(5).max(200) }), req.body);
  const out = await tx(async (db) => {
    const e = (await db.query("select * from customer_account where id = $1 and company_id = $2", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!e) throw notFound("Lan\xE7amento n\xE3o encontrado");
    if (!["credito", "pagamento_fiado", "ajuste"].includes(e.kind)) throw conflict("Este lan\xE7amento \xE9 estornado pelo pagamento da comanda (Receber \u203A estornar)");
    await lockCustomer(db, req.ctx, e.customer_id);
    if (e.cash_session_id) {
      const cs = (await db.query("select status from cash_sessions where id = $1", [e.cash_session_id])).rows[0];
      if (cs?.status !== "aberto") throw conflict("O caixa deste recebimento j\xE1 foi fechado: registre um ajuste na conta com o motivo", "cash_closed");
    }
    const acc = await accountSummary(db, req.ctx.companyId, e.customer_id);
    if (e.kind === "credito" && acc.balance_cents - Number(e.amount_cents) < 0 && acc.balance_cents >= 0)
      throw conflict("Parte deste cr\xE9dito j\xE1 foi usada: estorne o uso antes ou registre um ajuste", "credit_used");
    await db.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, method, cash_session_id, reverses_id, reason, user_id)
       values ($1,$2,'estorno',$3,$4,$5,$6,$7,$8)`, [req.ctx.companyId, e.customer_id, -Number(e.amount_cents), e.method, e.cash_session_id, e.id, b.reason, req.ctx.userId]).catch(
    (x) => {
      if (x.code === "23505") throw conflict("Lan\xE7amento j\xE1 estornado");
      throw x;
    });
    await audit(db, req.ctx, "cliente.conta_estorno", { entity: "customer", entityId: e.customer_id, reason: b.reason, data: { lancamento: e.id, valor_cents: -Number(e.amount_cents) } });
    return accountSummary(db, req.ctx.companyId, e.customer_id);
  });
  res.json(out);
}));
router11.put("/customers/:id/limit", need("clientes.gerenciar", "pdv.autorizar"), h(async (req, res) => {
  const b = parse(z10.object({ fiado_limit_cents: z10.number().int().min(0).max(1e8) }), req.body);
  const r = await q("update customers set fiado_limit_cents = $3, updated_at = now() where id = $1 and company_id = $2 returning id", [Number(req.params.id), req.ctx.companyId, b.fiado_limit_cents]);
  if (!r.rows[0]) throw notFound("Cliente n\xE3o encontrado");
  await audit({ query: q }, req.ctx, "cliente.limite_fiado", { entity: "customer", entityId: r.rows[0].id, data: b });
  res.json({ ok: true });
}));

// src/routes/infinitepay.js
import crypto6 from "node:crypto";
import { Router as Router12 } from "npm:express@5.2.1";
import { z as z11 } from "npm:zod@4.6.5";

// src/lib/infinitepay.js
import crypto5 from "node:crypto";
var API = () => (env.INFINITEPAY_API_URL || "https://api.checkout.infinitepay.io").replace(/\/+$/, "");
var ipConfig = (settings) => ({ enabled: false, handle: "", ...settings?.infinitepay || {} });
var normalizeHandle = (h2) => String(h2 || "").trim().replace(/^\$/, "").toLowerCase();
var METHOD_FROM_CAPTURE = (m) => m === "pix" ? "pix" : "credito";
async function call(path3, body, timeoutMs = 12e3) {
  let res;
  try {
    res = await fetch(`${API()}${path3}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new HttpError(503, "A InfinitePay n\xE3o respondeu. Tente de novo em instantes ou receba de outra forma.", "infinitepay_unavailable");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.errors?.[0]?.message || `erro ${res.status}`;
    throw new HttpError(502, `InfinitePay recusou: ${String(msg).slice(0, 160)}`, "infinitepay_error", { status: res.status });
  }
  return data;
}
async function createLink({ handle, amount, description, orderNsu, webhookUrl, redirectUrl, customer }) {
  const body = { handle, items: [{ quantity: 1, price: amount, description: description.slice(0, 120) }], order_nsu: orderNsu };
  if (webhookUrl) body.webhook_url = webhookUrl;
  if (redirectUrl) body.redirect_url = redirectUrl;
  if (customer && (customer.name || customer.email || customer.phone_number)) body.customer = customer;
  const raw = await call("/links", body);
  const url = raw?.url || raw?.link || raw?.checkout_url || raw?.data?.url || (typeof raw?.raw === "string" && /^https?:\/\//.test(raw.raw) ? raw.raw : null);
  if (!url) throw new HttpError(502, "A InfinitePay n\xE3o devolveu o link de pagamento.", "infinitepay_error");
  return { url, raw };
}
async function paymentCheck({ handle, orderNsu, transactionNsu, slug }) {
  return call("/payment_check", { handle, order_nsu: orderNsu, transaction_nsu: transactionNsu, slug }, 8e3);
}
var newOrderNsu = (companyId) => `RST${companyId}-${Date.now().toString(36)}-${crypto5.randomBytes(3).toString("hex")}`.toUpperCase();
async function logEvent(db, charge, kind, payload, ok = true) {
  await db.query(
    "insert into infinitepay_events (company_id, charge_id, kind, ok, payload) values ($1,$2,$3,$4,$5)",
    [charge.company_id, charge.id, kind, ok, JSON.stringify(payload ?? {})]
  ).catch(() => {
  });
}
async function confirmCharge(tx2, chargeId, info, source, checkFn = paymentCheck) {
  return tx2(async (db) => {
    const c = (await db.query("select * from infinitepay_charges where id = $1 for update", [chargeId])).rows[0];
    if (!c) throw new HttpError(404, "Cobran\xE7a n\xE3o encontrada");
    if (c.status === "pago" || c.status === "divergente") return c;
    const co = (await db.query("select settings, timezone from companies where id = $1", [c.company_id])).rows[0];
    const cfg = ipConfig(co.settings);
    const tnsu = String(info.transaction_nsu || c.transaction_nsu || "").slice(0, 120);
    const slug = String(info.invoice_slug || info.slug || c.invoice_slug || "").slice(0, 120);
    if (!tnsu || !slug) {
      await logEvent(db, c, source, { motivo: "sem transaction_nsu/slug", info }, false);
      return c;
    }
    let chk;
    try {
      chk = await checkFn({ handle: cfg.handle, orderNsu: c.order_nsu, transactionNsu: tnsu, slug });
    } catch (e) {
      await logEvent(db, c, "consulta", { erro: e.message }, false);
      throw e;
    }
    await logEvent(db, c, "consulta", chk, !!chk?.paid);
    await db.query("update infinitepay_charges set transaction_nsu = $2, invoice_slug = $3 where id = $1", [c.id, tnsu, slug]);
    if (!chk?.success || !chk?.paid) return { ...c, transaction_nsu: tnsu, invoice_slug: slug };
    const amount = Number(chk.amount ?? c.amount_cents);
    const method = METHOD_FROM_CAPTURE(chk.capture_method || info.capture_method);
    const base2 = {
      capture_method: chk.capture_method || info.capture_method || null,
      installments: chk.installments ?? null,
      paid_amount_cents: chk.paid_amount ?? null,
      receipt_url: String(info.receipt_url || c.receipt_url || "").slice(0, 500) || null
    };
    const ctx = { companyId: c.company_id, userId: c.created_by };
    if (amount !== Number(c.amount_cents)) {
      const r2 = (await db.query(
        `update infinitepay_charges set status = 'divergente', capture_method = $2, installments = $3, paid_amount_cents = $4, receipt_url = $5,
          paid_at = now(), confirmed_by = $6, note = $7 where id = $1 returning *`,
        [c.id, base2.capture_method, base2.installments, base2.paid_amount_cents, base2.receipt_url, source, `Valor pago (${amount}) diferente do cobrado (${c.amount_cents})`]
      )).rows[0];
      await audit(db, ctx, "infinitepay.divergente", { entity: "infinitepay", entityId: c.id, data: { cobrado: Number(c.amount_cents), pago: amount } });
      return r2;
    }
    let paymentId = null;
    let note = null;
    const s = c.session_id ? (await db.query("select * from consumption_sessions where id = $1 for update", [c.session_id])).rows[0] : null;
    if (s && ["aberta", "em_fechamento"].includes(s.status)) {
      const t = await sessionTotals(db, s.id);
      if (amount <= t.balance) {
        const u = (await db.query("select day_cutoff from units where id = $1", [s.unit_id])).rows[0];
        const p = (await db.query(
          `insert into payments (company_id, session_id, cash_session_id, method, amount_cents, source, business_date, idempotency_key, user_id)
            values ($1,$2,$3,$4,$5,'integracao',$6,$7,$8) on conflict (company_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key returning id`,
          [c.company_id, s.id, c.cash_session_id, method, amount, businessDate(/* @__PURE__ */ new Date(), co.timezone, u?.day_cutoff ?? 5), `ip-${c.order_nsu}`.slice(0, 80), c.created_by]
        )).rows[0];
        paymentId = p.id;
        await db.query("update consumption_sessions set version = version + 1 where id = $1", [s.id]);
      } else note = "Pago, mas o saldo da comanda j\xE1 era menor: confira e devolva a diferen\xE7a pelo app da InfinitePay.";
    } else if (c.session_id) note = "Pago depois que a comanda foi encerrada ou cancelada: confira.";
    const status = paymentId || !c.session_id ? "pago" : "divergente";
    const r = (await db.query(
      `update infinitepay_charges set status = $2, capture_method = $3, installments = $4, paid_amount_cents = $5, receipt_url = $6,
        payment_id = $7, paid_at = now(), confirmed_by = $8, note = $9 where id = $1 returning *`,
      [c.id, status, base2.capture_method, base2.installments, base2.paid_amount_cents, base2.receipt_url, paymentId, source, note]
    )).rows[0];
    await audit(db, ctx, status === "pago" ? "infinitepay.pago" : "infinitepay.divergente", {
      entity: "infinitepay",
      entityId: c.id,
      data: { comanda: c.session_id, valor_cents: amount, forma: base2.capture_method, parcelas: base2.installments, pagamento: paymentId, origem: source }
    });
    return r;
  });
}

// src/routes/infinitepay.js
var router12 = Router12();
var httpsUrl = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || env.NODE_ENV !== "production" && x.protocol === "http:" ? x.origin + x.pathname.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
};
var apiBase = (req, hint) => httpsUrl(env.PUBLIC_API_URL || "") || httpsUrl(hint || "") || `${req.protocol}://${req.get("host")}`;
var appBase = (req) => httpsUrl(env.APP_URL || "") || httpsUrl(req.get("origin") || "") || "https://rusten.vercel.app";
router12.get("/settings", need("pdv.receber"), h(async (req, res) => {
  const c = (await q("select settings from companies where id = $1", [req.ctx.companyId])).rows[0];
  res.json(ipConfig(c.settings));
}));
router12.put("/settings", need("configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z11.object({ enabled: z11.boolean(), handle: z11.string().trim().max(60) }), req.body);
  const handle = normalizeHandle(b.handle);
  if (b.enabled && !/^[a-z0-9][a-z0-9_.-]{1,39}$/.test(handle)) throw bad("Informe a InfiniteTag (seu usu\xE1rio na InfinitePay, sem o $)");
  const value = { enabled: b.enabled, handle };
  await q(`update companies set settings = jsonb_set(settings, '{infinitepay}', $2::jsonb) where id = $1`, [req.ctx.companyId, JSON.stringify(value)]);
  await audit({ query: q }, req.ctx, "infinitepay.configurada", { data: value });
  res.json(value);
}));
router12.post("/charges", need("pdv.receber"), h(async (req, res) => {
  const b = parse(z11.object({ session_id: z11.number().int(), amount_cents: z11.number().int().positive().max(1e8), api_base: z11.string().max(300).optional() }), req.body);
  await rateLimit(`ip-charge:${req.ctx.companyId}`, 120, 3600);
  const prep = await tx(async (db) => {
    const co = (await db.query("select name, settings from companies where id = $1", [req.ctx.companyId])).rows[0];
    const cfg2 = ipConfig(co.settings);
    if (!cfg2.enabled || !cfg2.handle) throw conflict("Ative a InfinitePay em Configura\xE7\xF5es \u203A Integra\xE7\xF5es", "infinitepay_off");
    const s = await lockSession(db, req.ctx.companyId, b.session_id);
    assertUnitScope(req.ctx, s.unit_id);
    if (!["aberta", "em_fechamento"].includes(s.status)) throw conflict("Consumo encerrado", "session_not_open");
    const t = await sessionTotals(db, s.id);
    if (b.amount_cents > t.balance) throw bad("Valor maior que o saldo da comanda", "over_balance");
    const open = (await db.query(`select id from infinitepay_charges where session_id = $1 and status = 'pendente' and amount_cents = $2 and created_at > now() - interval '30 minut\
es' order by id desc limit 1`, [s.id, b.amount_cents])).rows[0];
    if (open) return { reuse: open.id };
    const label = (await db.query(`select coalesce('Comanda ' || c.number, 'Mesa ' || t.number, s.label, 'Consumo #' || s.id) as l from consumption_sessions s
       left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id where s.id = $1`, [s.id])).rows[0].l;
    const cu = s.customer_id ? (await db.query("select name, email, phone from customers where id = $1", [s.customer_id])).rows[0] : null;
    const cash = req.ctx.terminalId ? (await db.query("select id from cash_sessions where company_id = $1 and terminal_id = $2 and status = 'aberto' limit 1", [req.ctx.companyId, req.
    ctx.terminalId])).rows[0] : (await db.query("select id from cash_sessions where company_id = $1 and user_id = $2 and terminal_id is null and status = 'aberto' limit 1", [req.ctx.
    companyId, req.ctx.userId])).rows[0];
    const orderNsu = newOrderNsu(req.ctx.companyId);
    const token = crypto6.randomBytes(18).toString("hex");
    const c2 = (await db.query(`insert into infinitepay_charges (company_id, session_id, cash_session_id, order_nsu, token, amount_cents, description, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [req.ctx.companyId, s.id, cash?.id ?? null, orderNsu, token, b.amount_cents, `${label} \u2014 ${co.name}`.slice(0, 120), req.ctx.
    userId])).rows[0];
    return { c: c2, cfg: cfg2, customer: cu };
  });
  if (prep.reuse) return res.json(await loadCharge(req, prep.reuse));
  const { c, cfg, customer } = prep;
  const phone = String(customer?.phone || "").replace(/\D/g, "");
  try {
    const link = await createLink({
      handle: cfg.handle,
      amount: Number(c.amount_cents),
      description: c.description,
      orderNsu: c.order_nsu,
      webhookUrl: `${apiBase(req, b.api_base)}/api/public/infinitepay/webhook/${c.token}`,
      redirectUrl: `${appBase(req)}/pagamento/concluido?c=${c.token}`,
      customer: customer ? { name: customer.name || void 0, email: customer.email || void 0, phone_number: phone.length >= 10 ? `+55${phone.slice(-11)}` : void 0 } : null
    });
    await q("update infinitepay_charges set link_url = $2 where id = $1", [c.id, link.url]);
    await logEvent({ query: q }, c, "link_criado", { url: link.url });
    await audit({ query: q }, req.ctx, "infinitepay.cobranca", { entity: "infinitepay", entityId: c.id, data: { comanda: c.session_id, valor_cents: Number(c.amount_cents) } });
  } catch (e) {
    await q("update infinitepay_charges set status = 'erro', note = $2 where id = $1", [c.id, String(e.message).slice(0, 300)]);
    await logEvent({ query: q }, c, "erro", { erro: e.message }, false);
    throw e;
  }
  res.status(201).json(await loadCharge(req, c.id));
}));
async function loadCharge(req, id) {
  const r = (await q(`select c.id, c.session_id, c.order_nsu, c.amount_cents, c.description, c.link_url, c.status, c.capture_method, c.installments,
      c.paid_amount_cents, c.receipt_url, c.payment_id, c.confirmed_by, c.note, c.created_at, c.paid_at, u.name as user_name
    from infinitepay_charges c left join users u on u.id = c.created_by where c.id = $1 and c.company_id = $2`, [id, req.ctx.companyId])).rows[0];
  if (!r) throw notFound("Cobran\xE7a n\xE3o encontrada");
  return { ...r, amount_cents: Number(r.amount_cents), paid_amount_cents: r.paid_amount_cents == null ? null : Number(r.paid_amount_cents) };
}
router12.get("/charges/:id", need("pdv.receber"), h(async (req, res) => {
  const id = Number(req.params.id);
  const c = (await q("select id, status, transaction_nsu, invoice_slug, created_at from infinitepay_charges where id = $1 and company_id = $2", [id, req.ctx.companyId])).rows[0];
  if (!c) throw notFound("Cobran\xE7a n\xE3o encontrada");
  if (c.status === "pendente" && c.transaction_nsu && c.invoice_slug) await confirmCharge(tx, id, {}, "consulta").catch(() => {
  });
  res.json(await loadCharge(req, id));
}));
router12.post("/charges/:id/cancel", need("pdv.receber"), h(async (req, res) => {
  const r = await q(
    `update infinitepay_charges set status = 'cancelado', canceled_at = now() where id = $1 and company_id = $2 and status in ('pendente','erro') returning id`,
    [Number(req.params.id), req.ctx.companyId]
  );
  if (!r.rows[0]) throw conflict("Esta cobran\xE7a n\xE3o est\xE1 pendente");
  await audit({ query: q }, req.ctx, "infinitepay.cancelada", { entity: "infinitepay", entityId: r.rows[0].id });
  res.json({ ok: true, note: 'O link deixa de aparecer aqui. Se o cliente pagar mesmo assim, o pagamento chega como "para conferir".' });
}));
router12.post("/charges/:id/confirm", need("pdv.receber"), h(async (req, res) => {
  const b = parse(z11.object({ transaction_nsu: z11.string().trim().min(6).max(120), invoice_slug: z11.string().trim().min(3).max(120) }), req.body);
  const id = Number(req.params.id);
  const c = (await q("select id from infinitepay_charges where id = $1 and company_id = $2", [id, req.ctx.companyId])).rows[0];
  if (!c) throw notFound("Cobran\xE7a n\xE3o encontrada");
  await confirmCharge(tx, id, b, "consulta");
  res.json(await loadCharge(req, id));
}));
router12.get("/charges", need("financeiro.visualizar"), h(async (req, res) => {
  const p = [req.ctx.companyId];
  let w = "c.company_id = $1";
  if (req.query.from) {
    p.push(String(req.query.from));
    w += ` and c.created_at >= $${p.length}::date`;
  }
  if (req.query.to) {
    p.push(String(req.query.to));
    w += ` and c.created_at < $${p.length}::date + 1`;
  }
  if (req.query.status) {
    p.push(String(req.query.status));
    w += ` and c.status = $${p.length}`;
  }
  const rows = (await q(`select c.id, c.session_id, c.order_nsu, c.amount_cents::bigint, c.description, c.status, c.capture_method, c.installments, c.paid_amount_cents,
      c.receipt_url, c.transaction_nsu, c.confirmed_by, c.note, c.created_at, c.paid_at, u.name as user_name
    from infinitepay_charges c left join users u on u.id = c.created_by where ${w} order by c.id desc limit 500`, p)).rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents),
  paid_amount_cents: r.paid_amount_cents == null ? null : Number(r.paid_amount_cents) }));
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.amount_cents, 0);
  res.json({ items: rows, totals: {
    pago: sum((r) => r.status === "pago"),
    pix: sum((r) => r.status === "pago" && r.capture_method === "pix"),
    cartao: sum((r) => r.status === "pago" && r.capture_method && r.capture_method !== "pix"),
    pendente: sum((r) => r.status === "pendente"),
    divergente: sum((r) => r.status === "divergente"),
    count: rows.length
  } });
}));
router12.get("/charges/:id/events", need("financeiro.visualizar"), h(async (req, res) => {
  res.json((await q("select kind, ok, payload, created_at from infinitepay_events where charge_id = $1 and company_id = $2 order by id", [Number(req.params.id), req.ctx.companyId])).
  rows);
}));

// src/routes/possales.js
import crypto7 from "node:crypto";
import { Buffer as Buffer5 } from "node:buffer";
import { Router as Router13 } from "npm:express@5.2.1";
import { z as z12 } from "npm:zod@4.6.5";
var router13 = Router13();
var DAY = z12.string().regex(/^\d{4}-\d{2}-\d{2}$/);
var CENTS = z12.number().int().min(0).max(1e10);
var NAME = z12.string().trim().min(1).max(120);
var reportSchema = z12.object({
  account: z12.string().trim().max(120).nullish(),
  generated_on: DAY.nullish(),
  period_from: DAY,
  period_to: DAY,
  gross_cents: CENTS,
  net_cents: CENTS,
  fee_cents: CENTS,
  tx_count: z12.number().int().min(0).max(1e6),
  days: z12.array(z12.object({ day: DAY, gross_cents: CENTS, net_cents: CENTS, tx_count: z12.number().int().min(0).max(1e6) })).min(1).max(400),
  methods: z12.array(z12.object({ label: NAME, gross_cents: CENTS })).max(20).default([]),
  products: z12.array(z12.object({ name: NAME, qty: z12.number().min(0).max(1e6) })).max(300).default([]),
  categories: z12.array(z12.object({ name: NAME, qty: z12.number().min(0).max(1e6) })).max(100).default([]),
  notes: z12.array(z12.string().trim().max(300)).max(10).default([])
});
var bodySchema = z12.object({
  file_name: z12.string().trim().min(1).max(200),
  file_b64: z12.string().min(10).max(7e6),
  mode: z12.enum(["externa", "conferencia"]),
  replace: z12.boolean().default(false),
  report: reportSchema
});
var norm2 = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function methodKey(label) {
  const l = norm2(label);
  if (/debito/.test(l)) return "debito";
  if (/credito|parcelad/.test(l)) return "credito";
  if (/pix/.test(l)) return "pix";
  if (/money|dinheiro|especie/.test(l)) return "dinheiro";
  return "outro";
}
function checkReport(r) {
  const errs = [];
  const near = (a, b, tol2) => Math.abs(a - b) <= tol2;
  if (r.period_from > r.period_to) errs.push("per\xEDodo com data inicial depois da final");
  if ((new Date(r.period_to) - new Date(r.period_from)) / 864e5 > 400) errs.push("per\xEDodo maior que 400 dias");
  const seen = /* @__PURE__ */ new Set();
  for (const d of r.days) {
    if (seen.has(d.day)) errs.push(`dia ${d.day} repetido`);
    seen.add(d.day);
    if (d.day < r.period_from || d.day > r.period_to) errs.push(`dia ${d.day} fora do per\xEDodo do relat\xF3rio`);
    if (d.net_cents > d.gross_cents) errs.push(`dia ${d.day}: l\xEDquido maior que o bruto`);
  }
  const tol = Math.max(2, r.days.length);
  const sg = r.days.reduce((s, d) => s + d.gross_cents, 0);
  const sn = r.days.reduce((s, d) => s + d.net_cents, 0);
  const st = r.days.reduce((s, d) => s + d.tx_count, 0);
  if (!near(sg, r.gross_cents, tol)) errs.push(`soma dos dias (${sg / 100}) diferente da receita bruta (${r.gross_cents / 100})`);
  if (!near(sn, r.net_cents, tol)) errs.push(`soma dos dias (${sn / 100}) diferente da receita l\xEDquida (${r.net_cents / 100})`);
  if (st !== r.tx_count) errs.push(`soma das transa\xE7\xF5es por dia (${st}) diferente do total (${r.tx_count})`);
  if (r.net_cents > r.gross_cents) errs.push("receita l\xEDquida maior que a bruta");
  if (!near(r.gross_cents - r.net_cents, r.fee_cents, 2)) errs.push("taxas diferentes de bruto \u2212 l\xEDquido");
  if (r.methods.length) {
    const sm = r.methods.reduce((s, m) => s + m.gross_cents, 0);
    if (!near(sm, r.gross_cents, Math.max(2, r.methods.length))) errs.push(`soma das formas de pagamento (${sm / 100}) diferente da receita bruta (${r.gross_cents / 100})`);
  }
  return errs;
}
async function reconcile(db, companyId, days) {
  if (!days.length) return [];
  const rows = (await db.query(`select p.business_date as day, p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total
      from payments p where p.company_id = $1 and p.status = 'confirmado' and p.business_date = any($2::date[])
        and p.method in ('debito','credito','pix','dinheiro') group by 1, 2`, [companyId, days.map((d) => d.day)])).rows;
  return days.map((d) => {
    const mine = rows.filter((r) => r.day === d.day);
    const card = mine.filter((r) => r.method !== "dinheiro").reduce((s, r) => s + Number(r.total), 0);
    return {
      day: d.day,
      report_gross_cents: d.gross_cents,
      report_tx: d.tx_count,
      rusten_card_pix_cents: card,
      rusten_cash_cents: mine.filter((r) => r.method === "dinheiro").reduce((s, r) => s + Number(r.total), 0),
      rusten_card_pix_count: mine.filter((r) => r.method !== "dinheiro").reduce((s, r) => s + r.n, 0)
    };
  });
}
async function overlaps(db, companyId, days) {
  return (await db.query(`select i.id, i.file_name, i.period_from, i.period_to, i.mode, count(d.id)::int as days
      from pos_sales_days d join pos_sales_imports i on i.id = d.import_id
     where d.company_id = $1 and d.provider = 'infinitepay' and d.active and d.day = any($2::date[])
     group by i.id order by i.id`, [companyId, days.map((d) => d.day)])).rows;
}
function decodeFile(b64) {
  const buf = Buffer5.from(b64, "base64");
  if (buf.length < 100 || buf.length > 5 * 1024 * 1024) throw bad("Arquivo vazio ou maior que 5 MB");
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw bad("O arquivo n\xE3o \xE9 um PDF");
  return { buf, sha: crypto7.createHash("sha256").update(buf).digest("hex") };
}
router13.post("/preview", need("financeiro.visualizar"), h(async (req, res) => {
  const b = parse(bodySchema.omit({ mode: true, replace: true }), req.body);
  const { sha } = decodeFile(b.file_b64);
  const dup = (await q("select id, created_at from pos_sales_imports where company_id = $1 and file_sha256 = $2 and status = 'ativo'", [req.ctx.companyId, sha])).rows[0];
  res.json({
    problems: checkReport(b.report),
    duplicate: dup || null,
    overlaps: await overlaps({ query: q }, req.ctx.companyId, b.report.days),
    reconciliation: await reconcile({ query: q }, req.ctx.companyId, b.report.days)
  });
}));
router13.post("/", need("financeiro.visualizar"), h(async (req, res) => {
  const b = parse(bodySchema, req.body);
  const r = b.report;
  const problems = checkReport(r);
  if (problems.length) throw bad(`O relat\xF3rio n\xE3o fecha: ${problems.slice(0, 3).join("; ")}`, "report_inconsistent");
  const { buf, sha } = decodeFile(b.file_b64);
  const out = await tx(async (db) => {
    await db.query("select pg_advisory_xact_lock(hashtext('pos-sales:' || $1::text))", [req.ctx.companyId]);
    const dup = (await db.query("select id from pos_sales_imports where company_id = $1 and file_sha256 = $2 and status = 'ativo'", [req.ctx.companyId, sha])).rows[0];
    if (dup) throw conflict("Este relat\xF3rio j\xE1 foi importado", "duplicate", { import_id: dup.id });
    const ov = await overlaps(db, req.ctx.companyId, r.days);
    if (ov.length && !b.replace) throw conflict("J\xE1 existe importa\xE7\xE3o ativa para parte destes dias", "overlap", { overlaps: ov });
    if (ov.length && !req.ctx.can("financeiro.estornar")) throw forbidden('Substituir uma importa\xE7\xE3o exige a permiss\xE3o "Estornar pagamentos"');
    const methods = r.methods.map((m) => ({ method: methodKey(m.label), label: m.label, gross_cents: m.gross_cents }));
    const imp = (await db.query(
      `insert into pos_sales_imports (company_id, mode, file_name, file_sha256, file_data, account_label, period_from, period_to, generated_on,
          gross_cents, net_cents, fee_cents, tx_count, methods, products, categories, notes, created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
      [
        req.ctx.companyId,
        b.mode,
        b.file_name,
        sha,
        buf,
        r.account || null,
        r.period_from,
        r.period_to,
        r.generated_on || null,
        r.gross_cents,
        r.net_cents,
        r.fee_cents,
        r.tx_count,
        JSON.stringify(methods),
        JSON.stringify(r.products),
        JSON.stringify(r.categories),
        JSON.stringify(r.notes),
        req.ctx.userId
      ]
    )).rows[0];
    for (const o of ov) {
      await cancelImport(db, req.ctx, o.id, `Substitu\xEDda pela importa\xE7\xE3o #${imp.id}`);
      await audit(db, req.ctx, "maquininha.importacao_substituida", { entity: "pos_sales_import", entityId: o.id, reason: `nova importa\xE7\xE3o #${imp.id}` });
    }
    for (const d of r.days) {
      await db.query(
        "insert into pos_sales_days (company_id, import_id, provider, day, gross_cents, net_cents, tx_count) values ($1,$2,$3,$4,$5,$6,$7)",
        [req.ctx.companyId, imp.id, "infinitepay", d.day, d.gross_cents, d.net_cents, d.tx_count]
      );
    }
    await audit(db, req.ctx, "maquininha.importada", {
      entity: "pos_sales_import",
      entityId: imp.id,
      data: { file: b.file_name, sha256: sha, mode: b.mode, period: [r.period_from, r.period_to], gross_cents: r.gross_cents, net_cents: r.net_cents, tx_count: r.tx_count, replaced: ov.
      map((o) => o.id) }
    });
    return { id: imp.id, replaced: ov.map((o) => o.id) };
  });
  res.status(201).json(out);
}));
router13.get("/", need("financeiro.visualizar"), h(async (req, res) => {
  const rows = (await q(`select i.id, i.mode, i.file_name, i.account_label, i.period_from, i.period_to, i.generated_on, i.gross_cents, i.net_cents, i.fee_cents, i.tx_count,
      i.methods, i.status, i.created_at, i.canceled_at, i.cancel_reason, u.name as user_name, cu.name as canceled_by_name
    from pos_sales_imports i left join users u on u.id = i.created_by left join users cu on cu.id = i.canceled_by
    where i.company_id = $1 order by i.period_to desc, i.id desc limit 100`, [req.ctx.companyId])).rows;
  const act = rows.filter((r) => r.status === "ativo");
  const sum = (k, mode) => act.filter((r) => !mode || r.mode === mode).reduce((s, r) => s + Number(r[k]), 0);
  res.json({ items: rows, totals: { gross_cents: sum("gross_cents", "externa"), net_cents: sum("net_cents", "externa"), fee_cents: sum("fee_cents", "externa"), tx_count: sum("tx_co\
unt", "externa") } });
}));
router13.get("/:id", need("financeiro.visualizar"), h(async (req, res) => {
  const i = (await q(`select i.id, i.mode, i.file_name, i.file_sha256, i.account_label, i.period_from, i.period_to, i.generated_on, i.gross_cents, i.net_cents, i.fee_cents, i.tx_co\
unt,
      i.methods, i.products, i.categories, i.notes, i.status, i.created_at, i.canceled_at, i.cancel_reason, u.name as user_name
    from pos_sales_imports i left join users u on u.id = i.created_by where i.id = $1 and i.company_id = $2`, [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!i) throw notFound("Importa\xE7\xE3o n\xE3o encontrada");
  const days = (await q("select day, gross_cents, net_cents, tx_count, active from pos_sales_days where import_id = $1 order by day", [i.id])).rows;
  res.json({ ...i, days, reconciliation: await reconcile({ query: q }, req.ctx.companyId, days) });
}));
router13.get("/:id/file", need("financeiro.visualizar"), h(async (req, res) => {
  const i = (await q("select file_name, file_data from pos_sales_imports where id = $1 and company_id = $2", [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!i?.file_data) throw notFound("Arquivo n\xE3o encontrado");
  res.setHeader("content-type", "application/pdf");
  res.setHeader("content-disposition", `attachment; filename="${i.file_name.replace(/[^\w.\- ]/g, "_")}"`);
  res.send(i.file_data);
}));
async function cancelImport(db, ctx, importId, reason) {
  await db.query("update pos_sales_days set active = false where import_id = $1", [importId]);
  await db.query("update pos_sales_imports set status = 'cancelado', canceled_by = $2, canceled_at = now(), cancel_reason = $3 where id = $1", [importId, ctx.userId, reason]);
  const rows = (await db.query("select id from pos_sales_items where import_id = $1 and status = 'baixado' for update", [importId])).rows;
  for (const r of rows) {
    const mv = (await db.query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'pos_sales_item' and m.ref_id = $2 and m.kind = 'venda'
      and not exists (select 1 from stock_movements x where x.reverses_id = m.id)`, [ctx.companyId, r.id])).rows;
    for (const m of mv) {
      await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
        values ($1,$2,'estorno_venda',$3,$4,'pos_sales_item_rev',$5,$6,$7,$8)`, [ctx.companyId, m.stock_item_id, -Number(m.qty), m.unit_cost_cents, r.id, m.id, `Importa\xE7\xE3o da maqui\
ninha cancelada: ${reason}`.slice(0, 300), ctx.userId]);
    }
    await db.query("update pos_sales_items set status = 'estornado' where id = $1", [r.id]);
  }
  return rows.length;
}
var STOP = /* @__PURE__ */ new Set(["de", "da", "do", "das", "dos", "e", "com", "sem", "ml", "l", "lt", "un", "und", "g", "kg", "a", "o"]);
var normName = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").replace(/[^a-z0-9]+/g,
" ").trim();
var tokens = (s) => [...new Set(normName(s).split(" ").filter((t) => t && !STOP.has(t)))];
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
var same = (x, y) => x === y || x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)) || Math.min(x.length, y.length) >= 5 && lev(x, y) <= (Math.min(x.length, y.length) >=
8 ? 2 : 1);
function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  const used = /* @__PURE__ */ new Set();
  let inter = 0;
  for (const t of A) {
    const k = B.findIndex((x, i) => !used.has(i) && same(t, x));
    if (k >= 0) {
      used.add(k);
      inter++;
    }
  }
  return 2 * inter / (A.length + B.length);
}
function bestMatch(name, products) {
  let best = null;
  for (const p of products) {
    const sc = normName(p.name) === normName(name) ? 1 : similarity(name, p.name);
    if (!best || sc > best.score) best = { product_id: p.id, name: p.name, score: Math.round(sc * 100) / 100 };
  }
  return best && best.score >= 0.5 ? best : null;
}
async function loadImport(db, ctx, id, lock = false) {
  const i = (await db.query(
    `select id, status, mode, period_from, period_to, products, categories from pos_sales_imports where id = $1 and company_id = $2${lock ? " for update" : ""}`,
    [Number(id), ctx.companyId]
  )).rows[0];
  if (!i) throw notFound("Importa\xE7\xE3o n\xE3o encontrada");
  return i;
}
async function ensureItems(db, ctx, imp) {
  const has2 = (await db.query("select 1 from pos_sales_items where import_id = $1 limit 1", [imp.id])).rows[0];
  if (has2 || !imp.products?.length) return;
  const products = (await db.query("select id, name from products where company_id = $1 and active", [ctx.companyId])).rows;
  const aliases = Object.fromEntries((await db.query("select alias_norm, product_id from pos_product_aliases where company_id = $1 and provider = 'infinitepay'", [ctx.companyId])).
  rows.filter((a) => products.some((p) => Number(p.id) === Number(a.product_id))).map((a) => [a.alias_norm, a.product_id]));
  for (const p of imp.products) {
    if (!(Number(p.qty) > 0)) continue;
    const exact = products.find((x) => normName(x.name) === normName(p.name));
    const pid = aliases[normName(p.name)] ?? exact?.id ?? null;
    await db.query("insert into pos_sales_items (company_id, import_id, report_name, qty, product_id) values ($1,$2,$3,$4,$5)", [ctx.companyId, imp.id, p.name, p.qty, pid]);
  }
}
async function itemsView(db, ctx, imp) {
  const rows = (await db.query(`select i.id, i.report_name, i.source, i.qty::float as qty, i.product_id, i.status, i.posted_at, u.name as posted_by_name
      from pos_sales_items i left join users u on u.id = i.posted_by where i.import_id = $1 order by i.source desc, i.qty desc, i.id`, [imp.id])).rows;
  const products = (await db.query("select id, name, stock_mode, stock_item_id, cost_cents from products where company_id = $1 and active order by name", [ctx.companyId])).rows;
  const byId = Object.fromEntries(products.map((p) => [Number(p.id), p]));
  const units = Object.fromEntries((await db.query("select id, name, unit from stock_items where company_id = $1", [ctx.companyId])).rows.map((s) => [Number(s.id), s]));
  for (const r of rows) {
    const p = byId[Number(r.product_id)];
    r.product_name = p?.name || null;
    r.untracked = p ? p.stock_mode === "nenhum" : false;
    if (!p && r.status === "pendente") r.suggestion = bestMatch(r.report_name, products);
    if (p) {
      const need2 = await requirements(db, ctx.companyId, p, r.qty, []);
      r.stock = [...need2.entries()].map(([id, q2]) => ({ stock_item_id: id, name: units[id]?.name, unit: units[id]?.unit, qty: Math.round(q2 * 1e3) / 1e3 }));
    }
    if (r.status === "baixado" || r.status === "estornado") {
      r.moved = (await db.query(`select s.name, s.unit, -m.qty::float as qty from stock_movements m join stock_items s on s.id = m.stock_item_id
        where m.company_id = $1 and m.ref_type = 'pos_sales_item' and m.ref_id = $2 and m.kind = 'venda'`, [ctx.companyId, r.id])).rows;
    }
  }
  const reportQty = (imp.products || []).reduce((a, p) => a + Number(p.qty || 0), 0);
  const catQty = (imp.categories || []).reduce((a, p) => a + Number(p.qty || 0), 0);
  return {
    rows,
    products: products.map((p) => ({ id: p.id, name: p.name, stock_mode: p.stock_mode })),
    summary: { report_qty: reportQty, categories_qty: catQty, missing_qty: Math.max(0, catQty - reportQty) },
    can_post: imp.status === "ativo" && imp.mode === "externa",
    mode: imp.mode,
    status: imp.status,
    can_edit: ctx.can("estoque.ajustar"),
    can_create: ctx.can("estoque.ajustar") && ctx.can("cardapio.gerenciar")
  };
}
router13.get("/:id/items", need("financeiro.visualizar"), h(async (req, res) => {
  const out = await tx(async (db) => {
    const imp = await loadImport(db, req.ctx, req.params.id, true);
    if (imp.status === "ativo") await ensureItems(db, req.ctx, imp);
    return itemsView(db, req.ctx, imp);
  });
  res.json(out);
}));
router13.put("/:id/items", need("financeiro.visualizar"), h(async (req, res) => {
  assertCan(req.ctx, "estoque.ajustar");
  const b = parse(z12.object({ rows: z12.array(z12.object({
    id: z12.number().int().optional(),
    report_name: z12.string().trim().min(1).max(120).optional(),
    qty: z12.number().positive().max(1e5),
    product_id: z12.number().int().nullable(),
    ignored: z12.boolean().default(false)
  })).max(400) }), req.body);
  const out = await tx(async (db) => {
    const imp = await loadImport(db, req.ctx, req.params.id, true);
    if (imp.status !== "ativo") throw conflict("Importa\xE7\xE3o cancelada");
    const pids = [...new Set(b.rows.map((r) => r.product_id).filter(Boolean))];
    if (pids.length) {
      const ok = (await db.query("select count(*)::int as n from products where company_id = $1 and id = any($2)", [req.ctx.companyId, pids])).rows[0].n;
      if (ok !== pids.length) throw bad("Produto inv\xE1lido");
    }
    const cur = (await db.query("select id, source, status from pos_sales_items where import_id = $1 for update", [imp.id])).rows;
    const keep = /* @__PURE__ */ new Set();
    for (const r of b.rows) {
      const status = r.ignored ? "ignorado" : "pendente";
      if (r.id) {
        const c = cur.find((x) => Number(x.id) === r.id);
        if (!c) throw bad("Linha inv\xE1lida");
        keep.add(r.id);
        if (c.status === "baixado" || c.status === "estornado") continue;
        await db.query("update pos_sales_items set qty = $2, product_id = $3, status = $4 where id = $1", [r.id, r.qty, r.product_id, status]);
      } else {
        if (!r.product_id) throw bad("Escolha o produto da linha acrescentada");
        const p = (await db.query("select name from products where id = $1", [r.product_id])).rows[0];
        await db.query(
          "insert into pos_sales_items (company_id, import_id, report_name, source, qty, product_id, status) values ($1,$2,$3,'manual',$4,$5,$6)",
          [req.ctx.companyId, imp.id, (r.report_name || p.name).slice(0, 120), r.qty, r.product_id, status]
        );
      }
    }
    for (const c of cur) if (c.source === "manual" && !keep.has(Number(c.id)) && (c.status === "pendente" || c.status === "ignorado")) await db.query("delete from pos_sales_items w\
here id = $1", [c.id]);
    return itemsView(db, req.ctx, imp);
  });
  res.json(out);
}));
async function controlAsFinished(db, ctx, p) {
  let st = (await db.query("select id from stock_items where company_id = $1 and lower(name) = lower($2)", [ctx.companyId, p.name.slice(0, 80)])).rows[0];
  if (!st) st = (await db.query("insert into stock_items (company_id, name, unit, avg_cost_cents) values ($1,$2,'un',$3) returning id", [ctx.companyId, p.name.slice(0, 80), Number(
  p.cost_cents) || 0])).rows[0];
  await db.query("update products set stock_mode = 'acabado', stock_item_id = $3, updated_at = now() where id = $1 and company_id = $2", [p.id, ctx.companyId, st.id]);
  await audit(db, ctx, "estoque.produtos_controlados", { entity: "product", entityId: p.id, data: { origem: "maquininha", stock_item_id: st.id } });
  return st.id;
}
router13.post("/:id/items/create-products", need("financeiro.visualizar"), h(async (req, res) => {
  assertCan(req.ctx, "estoque.ajustar");
  assertCan(req.ctx, "cardapio.gerenciar");
  const b = parse(z12.object({ rows: z12.array(z12.object({ id: z12.number().int(), name: z12.string().trim().min(1).max(120), price_cents: z12.number().int().min(0).max(1e8).nullable().
  default(null) })).min(1).max(200) }), req.body);
  const out = await tx(async (db) => {
    const imp = await loadImport(db, req.ctx, req.params.id, true);
    if (imp.status !== "ativo") throw conflict("Importa\xE7\xE3o cancelada");
    let cat = (await db.query("select id from categories where company_id = $1 and name = 'Maquininha' and not demo", [req.ctx.companyId])).rows[0];
    if (!cat) cat = (await db.query("insert into categories (company_id, name, sort) values ($1,'Maquininha',999) returning id", [req.ctx.companyId])).rows[0];
    const created = [];
    for (const r of b.rows) {
      const row = (await db.query("select id, status from pos_sales_items where id = $1 and import_id = $2 for update", [r.id, imp.id])).rows[0];
      if (!row || row.status !== "pendente") throw bad("Linha inv\xE1lida ou j\xE1 lan\xE7ada");
      let p = (await db.query("select id, name, cost_cents, stock_mode from products where company_id = $1 and lower(name) = lower($2) and active", [req.ctx.companyId, r.name])).rows[0];
      if (!p) {
        p = (await db.query(
          `insert into products (company_id, name, description, kind, unit, price_cents, cost_cents, category_id, active, channels)
            values ($1,$2,$3,'resale','un',$4,0,$5,true,'{pdv}') returning id, name, cost_cents, stock_mode`,
          [req.ctx.companyId, r.name, "Cadastrado pela importa\xE7\xE3o da maquininha: confira pre\xE7o, categoria e ficha t\xE9cnica.", r.price_cents ?? 0, cat.id]
        )).rows[0];
        await db.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)", [req.ctx.companyId, p.id, r.price_cents ??
        0, req.ctx.userId]);
        await audit(db, req.ctx, "produto.criado", { entity: "product", entityId: p.id, data: { name: r.name, price_cents: r.price_cents ?? 0, origem: "maquininha" } });
        created.push(r.name);
      }
      if (p.stock_mode === "nenhum") await controlAsFinished(db, req.ctx, p);
      await db.query("update pos_sales_items set product_id = $2 where id = $1", [r.id, p.id]);
    }
    return { created, view: await itemsView(db, req.ctx, imp) };
  });
  res.status(201).json(out);
}));
router13.post("/:id/items/post", need("financeiro.visualizar"), h(async (req, res) => {
  assertCan(req.ctx, "estoque.ajustar");
  const b = parse(z12.object({ control_untracked: z12.boolean().default(false) }), req.body || {});
  const out = await tx(async (db) => {
    const imp = await loadImport(db, req.ctx, req.params.id, true);
    if (imp.status !== "ativo") throw conflict("Importa\xE7\xE3o cancelada");
    if (imp.mode !== "externa") throw conflict("Esta importa\xE7\xE3o \xE9 s\xF3 de confer\xEAncia: as vendas j\xE1 baixaram o estoque pelas comandas", "conference_only");
    const rows = (await db.query("select * from pos_sales_items where import_id = $1 and status = 'pendente' order by id for update", [imp.id])).rows;
    const unmapped = rows.filter((r) => !r.product_id);
    if (unmapped.length) throw bad(`Escolha o produto (ou marque "ignorar") para: ${unmapped.slice(0, 5).map((r) => r.report_name).join(", ")}`, "unmapped");
    if (!rows.length) throw bad("Nada pendente para lan\xE7ar");
    let controlled = [];
    if (b.control_untracked) {
      const un = (await db.query(
        "select id, name, cost_cents from products where company_id = $1 and id = any($2) and stock_mode = 'nenhum' for update",
        [req.ctx.companyId, [...new Set(rows.map((r) => Number(r.product_id)))]]
      )).rows;
      for (const p of un) await controlAsFinished(db, req.ctx, p);
      controlled = un.map((p) => p.name);
    }
    const co = (await db.query("select settings from companies where id = $1", [req.ctx.companyId])).rows[0];
    const cfg = stockConfig(co.settings);
    const per = `${String(imp.period_from).split("-").reverse().join("/")} a ${String(imp.period_to).split("-").reverse().join("/")}`;
    const plan = [];
    const total = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const p = (await db.query("select id, name, stock_mode, stock_item_id, cost_cents from products where id = $1 and company_id = $2", [r.product_id, req.ctx.companyId])).rows[0];
      const need2 = await requirements(db, req.ctx.companyId, p, Number(r.qty), []);
      plan.push({ r, p, need: need2 });
      for (const [id, q2] of need2) total.set(id, (total.get(id) || 0) + q2);
    }
    const ids = [...total.keys()];
    const items = ids.length ? (await db.query("select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2) order by id for update", [req.ctx.companyId,
    ids])).rows : [];
    if (!cfg.allow_negative && ids.length) {
      const bal = await balances(db, req.ctx.companyId, ids);
      const short = items.filter((s) => (bal[s.id] || 0) - total.get(Number(s.id)) < -1e-4);
      if (short.length) throw conflict(`Estoque insuficiente: ${short.map((s) => `${s.name} (saldo ${(bal[s.id] || 0).toLocaleString("pt-BR")} ${s.unit})`).join(", ")}. Lance a ent\
rada antes ou permita estoque negativo.`, "stock_insufficient");
    }
    const cost = Object.fromEntries(items.map((s) => [Number(s.id), s.avg_cost_cents]));
    let moves = 0;
    for (const { r, p, need: need2 } of plan) {
      for (const [sid, q2] of need2) {
        const ins = await db.query(
          `insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
          values ($1,$2,'venda',$3,$4,'pos_sales_item',$5,$6,$7) on conflict do nothing returning id`,
          [req.ctx.companyId, sid, -q2, cost[sid], r.id, `Venda na maquininha (${per}): ${r.report_name} \xD7 ${Number(r.qty).toLocaleString("pt-BR")}`.slice(0, 300), req.ctx.userId]
        );
        moves += ins.rowCount;
      }
      await db.query("update pos_sales_items set status = 'baixado', posted_at = now(), posted_by = $2 where id = $1", [r.id, req.ctx.userId]);
      if (r.source === "relatorio") {
        await db.query(`insert into pos_product_aliases (company_id, provider, alias_norm, product_id) values ($1,'infinitepay',$2,$3)
          on conflict (company_id, provider, alias_norm) do update set product_id = excluded.product_id, updated_at = now()`, [req.ctx.companyId, normName(r.report_name), p.id]);
      }
    }
    await audit(db, req.ctx, "maquininha.estoque_baixado", {
      entity: "pos_sales_import",
      entityId: imp.id,
      data: { rows: rows.length, movements: moves, controlled, items: plan.map(({ r, p }) => ({ report: r.report_name, product: p.name, qty: Number(r.qty) })) }
    });
    return { posted: rows.length, movements: moves, controlled, without_stock: plan.filter((x) => !x.need.size).map((x) => x.p.name), view: await itemsView(db, req.ctx, imp) };
  });
  res.json(out);
}));
router13.post("/:id/cancel", need("financeiro.estornar"), h(async (req, res) => {
  const b = parse(z12.object({ reason: z12.string().trim().min(5, "informe o motivo (m\xEDnimo 5 caracteres)").max(200) }), req.body);
  await tx(async (db) => {
    const i = (await db.query("select id, status from pos_sales_imports where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!i) throw notFound("Importa\xE7\xE3o n\xE3o encontrada");
    if (i.status !== "ativo") throw conflict("Importa\xE7\xE3o j\xE1 cancelada");
    const reversed = await cancelImport(db, req.ctx, i.id, b.reason);
    await audit(db, req.ctx, "maquininha.importacao_cancelada", { entity: "pos_sales_import", entityId: i.id, reason: b.reason, data: { stock_reversed_rows: reversed } });
  });
  res.json({ ok: true });
}));

// src/routes/reports.js
import { Router as Router14 } from "npm:express@5.2.1";
import { z as z13 } from "npm:zod@4.6.5";
var router14 = Router14();
var range = (query) => {
  const b = parse(z13.object({ from: z13.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z13.string().regex(/^\d{4}-\d{2}-\d{2}$/), unit_id: z13.coerce.number().int().optional() }), query);
  if (b.from > b.to) throw bad("Data inicial depois da final");
  if ((new Date(b.to) - new Date(b.from)) / 864e5 > 400) throw bad("Per\xEDodo m\xE1ximo de 400 dias");
  return b;
};
async function build(ctx, r) {
  const fin = ctx.can("financeiro.visualizar");
  const cmv = ctx.can("relatorios.cmv");
  const tz = ctx.company.timezone;
  const P = [ctx.companyId, r.from, r.to];
  let unitF = "";
  if (r.unit_id) {
    P.push(r.unit_id);
    unitF = ` and s.unit_id = $${P.length}`;
  }
  const S = `s.company_id = $1 and s.business_date between $2 and $3${unitF}`;
  const closed = `${S} and s.status = 'encerrada'`;
  const ITEM = `from order_items i join consumption_sessions s on s.id = i.session_id where ${closed} and i.status = 'ativo'`;
  const sum = (await q(`with x as (
      select s.id, s.service_fee_bp, s.delivery_fee_cents, (select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo') as items
      from consumption_sessions s where ${closed})
    select count(*)::int as sessions, coalesce(sum(items),0)::bigint as items_cents,
      coalesce(sum(round(items * service_fee_bp / 10000.0)),0)::bigint as service_fee_cents, coalesce(sum(delivery_fee_cents),0)::bigint as delivery_fee_cents from x`, P)).rows[0];
  const revenue = Number(sum.items_cents) + Number(sum.service_fee_cents) + Number(sum.delivery_fee_cents);
  const payments = (await q(`select p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total, coalesce(sum(p.change_cents),0)::bigint as change
    from payments p join consumption_sessions s on s.id = p.session_id where p.company_id = $1 and p.business_date between $2 and $3${unitF} and p.status = 'confirmado' group by p.\
method order by total desc`, P)).rows;
  const open = (await q(`select count(*)::int as n, coalesce(sum((select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo')
      - (select coalesce(sum(amount_cents),0) from payments p where p.session_id = s.id and p.status = 'confirmado')),0)::bigint as balance
    from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')${r.unit_id ? " and s.unit_id = $2" : ""}`, r.unit_id ? [ctx.companyId, r.unit_id] :
  [ctx.companyId])).rows[0];
  const byDay = (await q(`select s.business_date as day, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${ITEM} group by 1 order by 1`,
  P)).rows;
  const byHour = (await q(`select extract(hour from i.created_at at time zone '${tz.replace(/'/g, "")}')::int as hour, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigin\
t as items_cents ${ITEM} group by 1 order by 1`, P)).rows;
  const byProduct = (await q(`select i.product_id, max(i.description) as name, max(c.name) as category, sum(i.qty)::float as qty, sum(i.total_cents)::bigint as items_cents,
      sum(coalesce((select -sum(m.qty * m.unit_cost_cents) from stock_movements m where m.ref_type = 'order_item' and m.ref_id = i.id and m.kind = 'venda'),
        p.cost_cents * i.qty))::bigint as cost_cents
    ${ITEM.replace("where", "join products p on p.id = i.product_id left join categories c on c.id = p.category_id where")} group by i.product_id order by items_cents desc`, P)).rows;
  const byCategory = Object.values(byProduct.reduce((acc2, p) => {
    const k = p.category || "Sem categoria";
    acc2[k] ||= { name: k, qty: 0, items_cents: 0, cost_cents: 0 };
    acc2[k].qty += p.qty;
    acc2[k].items_cents += Number(p.items_cents);
    acc2[k].cost_cents += Number(p.cost_cents);
    return acc2;
  }, {})).sort((a, b) => b.items_cents - a.items_cents);
  const totalItems = byProduct.reduce((s, p) => s + Number(p.items_cents), 0) || 1;
  let acc = 0;
  for (const p of byProduct) {
    acc += Number(p.items_cents);
    p.abc = acc / totalItems <= 0.8 ? "A" : acc / totalItems <= 0.95 ? "B" : "C";
  }
  const byUser = (await q(`select u.name, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${ITEM.replace("where", "left join users u on u.id = i.user_\
id where")} group by u.name order by items_cents desc`, P)).rows;
  const byTable = (await q(`select t.number, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents,
      round(avg(extract(epoch from (s.closed_at - s.opened_at)) / 60)::numeric)::int as avg_minutes
    ${ITEM.replace("where", "join dining_tables t on t.id = s.table_id where")} group by t.number order by t.number`, P)).rows;
  const byChannel = (await q(`select s.kind as channel, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${ITEM} group by 1 order by 3 d\
esc`, P)).rows;
  const byTerminal = (await q(`select coalesce(tm.name, 'Sem terminal') as name, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${ITEM.replace("where",
  "left join terminals tm on tm.id = i.terminal_id where")} group by 1 order by 3 desc`, P)).rows;
  const modes = (await q(`select i.launch_mode, count(*)::int as n from order_items i join consumption_sessions s on s.id = i.session_id where ${S} group by 1`, P)).rows;
  const control = (await q(`select
      count(*) filter (where i.status = 'cancelado')::int as canceled_items, coalesce(sum(i.total_cents) filter (where i.status = 'cancelado'),0)::bigint as canceled_cents,
      coalesce(sum(i.discount_cents) filter (where i.status = 'ativo'),0)::bigint as discounts_cents, count(*) filter (where i.discount_cents > 0)::int as discounted_items
    from order_items i join consumption_sessions s on s.id = i.session_id where ${S}`, P)).rows[0];
  const auditCounts = (await q(`select action, count(*)::int as n from audit_events where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1
      and action in ('consumo.reaberto','consumo.cancelado','pdv.itens_transferidos','pdv.mesa_trocada','autorizacao.concedida','autorizacao.negada','leitura.desconhecida','pdv.exc\
ecao_manual','pagamento.estornado','pdv.taxa_servico')
    group by action`, [ctx.companyId, r.from, r.to])).rows;
  const kitchen = (await q(`select ps.name as sector, count(*)::int as items, round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::numeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
    from order_items i join consumption_sessions s on s.id = i.session_id join production_sectors ps on ps.id = i.sector_id
    where ${S} and i.ready_at is not null and i.sent_at is not null group by ps.name order by ps.name`, P)).rows;
  const delivery = (await q(`select count(*)::int as orders, count(*) filter (where d.status = 'cancelado')::int as canceled,
      round(avg(extract(epoch from (e.created_at - d.created_at)) / 60)::numeric)::int as avg_minutes_to_deliver
    from delivery_orders d join consumption_sessions s on s.id = d.session_id
    left join lateral (select created_at from delivery_events where order_id = d.id and status = 'entregue' order by id limit 1) e on true where ${S}`, P)).rows[0];
  const stock = (await q(`select coalesce(sum(-m.qty * m.unit_cost_cents) filter (where m.kind = 'perda'),0)::bigint as losses_cents,
      coalesce(sum(m.qty * m.unit_cost_cents) filter (where m.kind = 'inventario'),0)::bigint as inventory_diff_cents
    from stock_movements m where m.company_id = $1 and m.created_at >= $2::date and m.created_at < $3::date + 1`, [ctx.companyId, r.from, r.to])).rows[0];
  const customers = (await q(`select count(distinct s.customer_id)::int as identified,
      count(distinct s.customer_id) filter (where exists (select 1 from consumption_sessions o where o.customer_id = s.customer_id and o.status = 'encerrada' and o.business_date < \
$2))::int as returning
    from consumption_sessions s where ${closed} and s.customer_id is not null`, P)).rows[0];
  const loyalty = (await q(`select coalesce(sum(points) filter (where kind = 'ganho'),0)::int as earned, coalesce(-sum(points) filter (where kind = 'resgate'),0)::int as redeemed
    from loyalty_ledger where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1`, [ctx.companyId, r.from, r.to])).rows[0];
  const reviews = (await q(`select count(*)::int as n, round(avg(score)::numeric, 2)::float as average from reviews where company_id = $1 and created_at >= $2::date and created_at \
< $3::date + 1`, [ctx.companyId, r.from, r.to])).rows[0];
  const cash = fin ? (await q(`select count(*)::int as sessions, coalesce(sum(difference_cents),0)::bigint as difference_cents,
      count(*) filter (where difference_cents <> 0)::int as with_difference from cash_sessions where company_id = $1 and business_date between $2 and $3 and status = 'fechado'`, [ctx.
  companyId, r.from, r.to])).rows[0] : null;
  const movements = fin ? (await q(`select m.kind, coalesce(sum(m.amount_cents),0)::bigint as total from cash_movements m join cash_sessions c on c.id = m.cash_session_id
      where m.company_id = $1 and c.business_date between $2 and $3 group by m.kind`, [ctx.companyId, r.from, r.to])).rows : null;
  const extDays = fin ? (await q(`select d.day, d.import_id, d.gross_cents, d.net_cents, d.tx_count from pos_sales_days d join pos_sales_imports i on i.id = d.import_id
      where d.company_id = $1 and d.active and i.mode = 'externa' and d.day between $2 and $3 order by d.day`, [ctx.companyId, r.from, r.to])).rows : [];
  let external = null;
  if (fin && extDays.length) {
    const imps = (await q("select id, period_from, period_to, gross_cents, methods from pos_sales_imports where id = any($1::bigint[])", [[...new Set(extDays.map((d) => d.import_id))]])).
    rows;
    const byMethod = {};
    let exact = true;
    let extCmv = 0;
    const costs = Object.fromEntries((await q(`select i.import_id, coalesce(sum(-m.qty * m.unit_cost_cents),0)::float as cost
        from pos_sales_items i join stock_movements m on m.company_id = i.company_id and m.ref_type = 'pos_sales_item' and m.ref_id = i.id and m.kind = 'venda'
       where i.import_id = any($1::bigint[]) and i.status = 'baixado' group by i.import_id`, [imps.map((i) => i.id)])).rows.map((x) => [Number(x.import_id), x.cost]));
    for (const i of imps) {
      const part = extDays.filter((d) => d.import_id === i.id).reduce((a, d) => a + Number(d.gross_cents), 0);
      if (i.period_from < r.from || i.period_to > r.to) exact = false;
      const f = i.gross_cents ? part / i.gross_cents : 0;
      for (const m of i.methods) byMethod[m.method] = (byMethod[m.method] || 0) + Math.round(m.gross_cents * f);
      extCmv += Math.round((costs[Number(i.id)] || 0) * f);
    }
    const tot = (k) => extDays.reduce((a, d) => a + Number(d[k]), 0);
    external = {
      gross_cents: tot("gross_cents"),
      net_cents: tot("net_cents"),
      fee_cents: tot("gross_cents") - tot("net_cents"),
      tx_count: tot("tx_count"),
      by_day: extDays.map(({ day, gross_cents, net_cents, tx_count }) => ({ day, gross_cents, net_cents, tx_count })),
      by_method: Object.entries(byMethod).map(([method, total]) => ({ method, total })).sort((a, b) => b.total - a.total),
      methods_exact: exact,
      imports: imps.length,
      cmv_cents: cmv ? extCmv : null
    };
  }
  const cogs = byProduct.reduce((s, p) => s + Number(p.cost_cents), 0);
  const money2 = (v) => fin ? v : null;
  if (!cmv) for (const p of [...byProduct, ...byCategory]) delete p.cost_cents;
  const received = payments.reduce((s, p) => s + Number(p.total), 0);
  const dre = fin && cmv ? {
    receita_bruta: revenue,
    taxa_servico: Number(sum.service_fee_cents),
    taxa_entrega: Number(sum.delivery_fee_cents),
    cmv: cogs,
    lucro_bruto: Number(sum.items_cents) - cogs,
    despesas_caixa: Number(movements?.find((m) => m.kind === "despesa")?.total || 0),
    maquininha_bruta: external?.gross_cents || 0,
    maquininha_taxas: external?.fee_cents || 0,
    maquininha_cmv: external?.cmv_cents || 0,
    resultado: Number(sum.items_cents) - cogs - Number(movements?.find((m) => m.kind === "despesa")?.total || 0) + (external?.net_cents || 0) - (external?.cmv_cents || 0)
  } : null;
  return {
    period: { from: r.from, to: r.to },
    permissions: { financial: fin, cmv },
    summary: {
      sessions: sum.sessions,
      revenue_cents: money2(revenue),
      items_cents: money2(Number(sum.items_cents)),
      service_fee_cents: money2(Number(sum.service_fee_cents)),
      delivery_fee_cents: money2(Number(sum.delivery_fee_cents)),
      received_cents: money2(received),
      ticket_cents: money2(sum.sessions ? Math.round(revenue / sum.sessions) : 0),
      external_cents: fin ? external?.gross_cents || 0 : null,
      revenue_total_cents: fin ? revenue + (external?.gross_cents || 0) : null,
      open_sessions: open.n,
      open_balance_cents: money2(Number(open.balance)),
      cmv_cents: cmv ? cogs : null,
      margin_pct: cmv && Number(sum.items_cents) ? Math.round((Number(sum.items_cents) - cogs) / Number(sum.items_cents) * 1e3) / 10 : null
    },
    by_day: byDay.map((d) => ({ ...d, items_cents: money2(Number(d.items_cents)) })),
    by_hour: byHour.map((d) => ({ ...d, items_cents: money2(Number(d.items_cents)) })),
    by_product: byProduct.map((d) => ({ ...d, items_cents: money2(Number(d.items_cents)) })),
    by_category: byCategory.map((d) => ({ ...d, items_cents: money2(d.items_cents) })),
    by_user: byUser.map((d) => ({ ...d, items_cents: money2(Number(d.items_cents)) })),
    by_table: byTable.map((d) => ({ ...d, items_cents: money2(Number(d.items_cents)) })),
    by_channel: byChannel.map((d) => ({ ...d, items_cents: money2(Number(d.items_cents)) })),
    by_terminal: byTerminal.map((d) => ({ ...d, items_cents: money2(Number(d.items_cents)) })),
    payments: fin ? payments : null,
    cash,
    movements,
    dre,
    external,
    control: {
      ...control,
      canceled_cents: money2(Number(control.canceled_cents)),
      discounts_cents: money2(Number(control.discounts_cents)),
      launch_modes: Object.fromEntries(modes.map((m) => [m.launch_mode, m.n])),
      events: Object.fromEntries(auditCounts.map((a) => [a.action, a.n]))
    },
    kitchen,
    delivery,
    stock: cmv ? stock : null,
    customers: { ...customers, loyalty, reviews }
  };
}
router14.get("/overview", need("relatorios.visualizar"), h(async (req, res) => {
  res.json(await build(req.ctx, range(req.query)));
}));
var SECTIONS = {
  produtos: ["by_product", [["name", "Produto"], ["category", "Categoria"], ["qty", "Quantidade"], ["items_cents", "Vendido (R$)"], ["cost_cents", "CMV (R$)"], ["abc", "Curva ABC"]]],
  dias: ["by_day", [["day", "Dia comercial"], ["sessions", "Consumos"], ["items_cents", "Vendido (R$)"]]],
  horas: ["by_hour", [["hour", "Hora"], ["items", "Itens"], ["items_cents", "Vendido (R$)"]]],
  garcons: ["by_user", [["name", "Usu\xE1rio"], ["items", "Itens"], ["items_cents", "Vendido (R$)"]]],
  mesas: ["by_table", [["number", "Mesa"], ["sessions", "Consumos"], ["items_cents", "Vendido (R$)"], ["avg_minutes", "Perman\xEAncia m\xE9dia (min)"]]],
  pagamentos: ["payments", [["method", "Forma"], ["n", "Quantidade"], ["total", "Total (R$)"]]]
};
router14.get("/export", need("relatorios.visualizar"), h(async (req, res) => {
  const r = range(req.query);
  const sec = SECTIONS[req.query.section];
  if (!sec) throw bad("Se\xE7\xE3o inv\xE1lida");
  const data = await build(req.ctx, r);
  const rows = data[sec[0]] || [];
  const cols = sec[1].filter(([k]) => rows.some((x) => x[k] !== void 0 && x[k] !== null));
  const fmt = (k, v) => /cents|^total$/.test(k) && v != null ? (Number(v) / 100).toFixed(2).replace(".", ",") : v;
  const lines = [cols.map(([, l]) => l).join(";"), ...rows.map((x) => cols.map(([k]) => csvCell(fmt(k, x[k]))).join(";"))];
  await audit({ query: q }, req.ctx, "relatorio.exportado", { data: { section: req.query.section, ...r } });
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="rusten-${req.query.section}-${r.from}-${r.to}.csv"`);
  res.send(`\uFEFF${lines.join("\n")}`);
}));

// src/routes/delivery.js
import { Router as Router15 } from "npm:express@5.2.1";
import { z as z14 } from "npm:zod@4.6.5";

// src/lib/delivery.js
import crypto8 from "node:crypto";
var deliveryConfig = (settings) => ({
  enabled: false,
  accepting: true,
  delivery: true,
  pickup: true,
  fee_cents: 0,
  min_order_cents: 0,
  eta_minutes: 45,
  hours: "",
  areas: "",
  payment_methods: ["dinheiro", "pix", "cartao"],
  message: "",
  ...settings?.delivery || {}
});
var FLOW2 = {
  recebido: ["confirmado", "cancelado"],
  confirmado: ["em_preparo", "pronto", "cancelado"],
  em_preparo: ["pronto", "cancelado"],
  pronto: ["saiu", "entregue", "cancelado"],
  saiu: ["entregue", "cancelado"],
  entregue: [],
  cancelado: []
};
var STATUS_LABEL2 = { recebido: "Recebido", confirmado: "Confirmado", em_preparo: "Em preparo", pronto: "Pronto", saiu: "Saiu para entrega", entregue: "Entregue", cancelado: "Cance\
lado" };
var systemCtx = (companyId) => ({ companyId, userId: null, unitId: null, terminalId: null, level: 0, can: (p) => ["pdv.abrir_comanda", "delivery.gerenciar"].includes(p) });
async function priceCart(db, companyId, cart, { channel = "delivery" } = {}) {
  if (!Array.isArray(cart) || !cart.length) throw bad("Carrinho vazio");
  const ids = [...new Set(cart.map((c) => Number(c.product_id)))];
  const prods = Object.fromEntries((await db.query(`select * from products where company_id = $1 and id = any($2)`, [companyId, ids])).rows.map((p) => [p.id, p]));
  const lines = [];
  for (const c of cart) {
    const p = prods[Number(c.product_id)];
    if (!p || !p.active) throw conflict(`Produto indispon\xEDvel${p ? `: ${p.name}` : ""}`, "product_unavailable");
    if (channel !== "interno" && !p.channels.includes("delivery") && !p.channels.includes("cardapio_digital")) throw conflict(`${p.name} n\xE3o est\xE1 dispon\xEDvel para delivery`,
    "product_unavailable");
    if (p.kind === "weight") throw conflict(`${p.name} \xE9 vendido por peso e n\xE3o pode ser pedido online`, "product_unavailable");
    const qty = Number(c.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw bad("Quantidade inv\xE1lida");
    const optionIds = (c.option_ids || []).map(Number);
    const groups = (await db.query(
      `select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active where g.product_id = $1 group by g.id order by g.sort, g.id`,
      [p.id]
    )).rows;
    const chosen = [];
    for (const g of groups) {
      const sel = g.options.filter((o) => optionIds.includes(o.id));
      if (sel.length < g.min_select) throw bad(`${p.name}: escolha ${g.min_select} em "${g.name}"`, "options_required");
      if (sel.length > g.max_select) throw bad(`${p.name}: no m\xE1ximo ${g.max_select} em "${g.name}"`);
      for (const o of sel) chosen.push({ group: g.name, id: o.id, name: o.name, price_cents: o.price_cents });
    }
    if (chosen.length !== new Set(optionIds).size) throw bad("Op\xE7\xE3o inv\xE1lida");
    const mods = chosen.reduce((s, o) => s + o.price_cents, 0);
    lines.push({ product: p, qty, chosen, mods, notes: c.notes ? String(c.notes).slice(0, 140) : null, total: lineTotal(p.price_cents, qty, mods, 0) });
  }
  return { lines, subtotal: lines.reduce((s, l) => s + l.total, 0) };
}
async function createDeliveryOrder(db, companyId, input, actor2) {
  const co = (await db.query("select id, name, settings from companies where id = $1", [companyId])).rows[0];
  if (!co) throw notFound();
  const cfg = deliveryConfig(co.settings);
  const internal = input.channel === "telefone" || input.channel === "balcao";
  if (!internal && (!cfg.enabled || !cfg.accepting)) throw conflict("O estabelecimento n\xE3o est\xE1 recebendo pedidos agora", "closed");
  if (input.mode === "entrega" && !cfg.delivery) throw bad("Entrega indispon\xEDvel: escolha retirada");
  if (input.mode === "retirada" && !cfg.pickup) throw bad("Retirada indispon\xEDvel");
  if (input.mode === "entrega" && (!input.address?.street || !input.address?.number)) throw bad("Informe rua e n\xFAmero para entrega");
  const phone = onlyDigits(input.phone);
  if (phone.length < 10) throw bad("Telefone com DDD \xE9 obrigat\xF3rio");
  const dup = (await db.query("select id, public_token, number from delivery_orders where company_id = $1 and client_key = $2", [companyId, input.client_key])).rows[0];
  if (dup) return { replay: true, ...dup };
  const { lines, subtotal } = await priceCart(db, companyId, input.cart, { channel: internal ? "interno" : "delivery" });
  if (!internal && subtotal < cfg.min_order_cents) throw bad(`Pedido m\xEDnimo de R$ ${(cfg.min_order_cents / 100).toFixed(2).replace(".", ",")}`, "min_order");
  const fee = input.mode === "entrega" ? cfg.fee_cents : 0;
  const cust = (await db.query(`select id from customers where company_id = $1 and anonymized_at is null and regexp_replace(coalesce(phone,''),'\\D','','g') = $2 limit 1`, [companyId,
  phone])).rows[0];
  const ctx = actor2 || systemCtx(companyId);
  const number = Number((await db.query("select coalesce(max(number),0)+1 as n from delivery_orders where company_id = $1", [companyId])).rows[0].n);
  const session = await openSession(db, { ...ctx, companyId }, {
    kind: "delivery",
    label: `Delivery #${number}`,
    customer_name: input.customer_name,
    customer_id: cust?.id,
    delivery_fee_cents: fee
  });
  for (const [i, l] of lines.entries()) {
    const item = (await db.query(
      `insert into order_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents,
         total_cents, notes, sector_id, kitchen_status, launch_mode, user_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,'delivery',$14,$15) returning *`,
      [
        companyId,
        session.id,
        l.product.id,
        l.product.name,
        l.qty,
        l.product.unit,
        l.product.price_cents,
        JSON.stringify(l.chosen),
        l.mods,
        l.total,
        l.notes,
        l.product.sector_id,
        l.product.sector_id ? "novo" : "nao_produz",
        ctx.userId,
        `dlv${session.id}x${i}`
      ]
    )).rows[0];
    await consumeForItem(db, { ...ctx, companyId }, item, l.product, l.chosen.map((o2) => o2.id));
  }
  const token = randomToken(18);
  const o = (await db.query(
    `insert into delivery_orders (company_id, unit_id, session_id, number, public_token, channel, mode, customer_id, customer_name, phone, address,
       payment_hint, change_for_cents, notes, eta_minutes, client_key, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
    [
      companyId,
      session.unit_id,
      session.id,
      number,
      token,
      input.channel,
      input.mode,
      cust?.id ?? null,
      input.customer_name,
      phone,
      input.address || {},
      input.payment_hint ?? null,
      input.change_for_cents ?? null,
      input.notes ?? null,
      cfg.eta_minutes,
      input.client_key,
      internal ? "confirmado" : "recebido"
    ]
  )).rows[0];
  if (internal) await db.query(`update order_items set sent_at = now() where session_id = $1 and kitchen_status = 'novo'`, [session.id]);
  await db.query(
    "insert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",
    [companyId, o.id, o.status, ctx.userId, `Pedido via ${input.channel}`]
  );
  return { ...o, subtotal, fee, total: subtotal + fee };
}
var reviewKey = () => deriveKey("review-link");
var reviewToken = (sessionId) => `${sessionId}.${crypto8.createHmac("sha256", reviewKey()).update(String(sessionId)).digest("base64url").slice(0, 16)}`;
function parseReviewToken(token) {
  const [id, sig] = String(token || "").split(".");
  if (!/^\d+$/.test(id || "") || !sig) return null;
  return reviewToken(id) === `${id}.${sig}` ? Number(id) : null;
}

// src/routes/delivery.js
var router15 = Router15();
var slugify = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "loja";
router15.get("/settings", need("delivery.gerenciar"), h(async (req, res) => {
  const c = (await q("select slug, name, settings from companies where id = $1", [req.ctx.companyId])).rows[0];
  res.json({ slug: c.slug, suggested_slug: c.slug || slugify(c.name), ...deliveryConfig(c.settings) });
}));
router15.put("/settings", need("delivery.gerenciar", "configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z14.object({
    slug: z14.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "use letras min\xFAsculas, n\xFAmeros e h\xEDfen (3 a 40)"),
    enabled: z14.boolean(),
    accepting: z14.boolean(),
    delivery: z14.boolean(),
    pickup: z14.boolean(),
    fee_cents: z14.number().int().min(0).max(1e5),
    min_order_cents: z14.number().int().min(0).max(1e6),
    eta_minutes: z14.number().int().min(5).max(300),
    hours: z14.string().max(300).default(""),
    areas: z14.string().max(500).default(""),
    message: z14.string().max(300).default(""),
    payment_methods: z14.array(z14.enum(["dinheiro", "pix", "cartao"])).min(1)
  }), req.body);
  if (!b.delivery && !b.pickup) throw bad("Habilite entrega, retirada ou ambos");
  const { slug, ...cfg } = b;
  await tx(async (db) => {
    const taken = await db.query("select 1 from companies where slug = $1 and id <> $2", [slug, req.ctx.companyId]);
    if (taken.rows[0]) throw conflict("Este endere\xE7o j\xE1 est\xE1 em uso por outra empresa", "slug_taken");
    await db.query(`update companies set slug = $2, settings = jsonb_set(settings, '{delivery}', $3::jsonb) where id = $1`, [req.ctx.companyId, slug, JSON.stringify(cfg)]);
    await audit(db, req.ctx, "delivery.configuracao", { data: { slug, ...cfg } });
  });
  res.json({ ok: true });
}));
router15.get("/orders", need("delivery.gerenciar"), h(async (req, res) => {
  const params = [req.ctx.companyId];
  let where = "d.company_id = $1";
  if (req.query.status === "abertos") where += " and d.status not in ('entregue','cancelado')";
  else if (req.query.status === "hoje") where += " and d.created_at > now() - interval '24 hours'";
  if (!req.ctx.can("delivery.gerenciar")) {
    params.push(req.ctx.userId);
    where += ` and d.courier_id = $${params.length}`;
  }
  const rows = (await q(`select d.*, u.name as courier_name, s.status as session_status,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') as items_cents,
      (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = d.session_id and p.status = 'confirmado') as paid_cents,
      s.delivery_fee_cents,
      (select json_agg(json_build_object('description', i.description, 'qty', i.qty, 'modifiers', i.modifiers, 'notes', i.notes, 'kitchen_status', i.kitchen_status, 'status', i.sta\
tus) order by i.id)
         from order_items i where i.session_id = d.session_id) as items
    from delivery_orders d join consumption_sessions s on s.id = d.session_id left join users u on u.id = d.courier_id
    where ${where} order by case when d.status in ('entregue','cancelado') then 1 else 0 end, d.created_at desc limit 200`, params)).rows;
  res.json(rows);
}));
router15.get("/my", need("delivery.entregar"), h(async (req, res) => {
  res.json((await q(
    `select d.id, d.number, d.status, d.customer_name, d.phone, d.address, d.payment_hint, d.change_for_cents, d.notes,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') + s.delivery_fee_cents as total_cents
    from delivery_orders d join consumption_sessions s on s.id = d.session_id where d.company_id = $1 and d.courier_id = $2 and d.status in ('pronto','saiu') order by d.id`,
    [req.ctx.companyId, req.ctx.userId]
  )).rows);
}));
var orderInput = z14.object({
  mode: z14.enum(["entrega", "retirada"]),
  channel: z14.enum(["telefone", "balcao"]).default("telefone"),
  customer_name: z14.string().trim().min(2).max(80),
  phone: z14.string().trim().min(10).max(20),
  address: z14.object({ street: z14.string().max(120), number: z14.string().max(20), district: z14.string().max(80).optional(), complement: z14.string().max(80).optional(), reference: z14.
  string().max(120).optional() }).partial().optional(),
  payment_hint: z14.enum(["dinheiro", "pix", "cartao"]).optional(),
  change_for_cents: z14.number().int().min(0).max(1e7).optional(),
  notes: z14.string().max(300).optional(),
  cart: z14.array(z14.object({ product_id: z14.number().int(), qty: z14.number().int().min(1).max(50), option_ids: z14.array(z14.number().int()).max(40).default([]), notes: z14.string().
  max(140).optional() })).min(1).max(60),
  client_key: z14.string().regex(/^[A-Za-z0-9_-]{8,80}$/)
});
router15.post("/orders", need("delivery.gerenciar"), h(async (req, res) => {
  const b = parse(orderInput, req.body);
  const o = await tx((db) => createDeliveryOrder(db, req.ctx.companyId, b, req.ctx));
  await audit({ query: q }, req.ctx, "delivery.pedido_interno", { entity: "delivery", entityId: o.id, data: { number: o.number, mode: b.mode } });
  res.status(o.replay ? 200 : 201).json(o);
}));
router15.post("/orders/:id/status", h(async (req, res) => {
  const b = parse(z14.object({
    to: z14.enum(["confirmado", "em_preparo", "pronto", "saiu", "entregue", "cancelado"]),
    reason: z14.string().trim().max(200).optional(),
    proof: z14.string().trim().max(200).optional(),
    eta_minutes: z14.number().int().min(5).max(300).optional()
  }), req.body);
  const out = await tx(async (db) => {
    const o = (await db.query("select * from delivery_orders where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!o) throw notFound("Pedido n\xE3o encontrado");
    if (["saiu", "entregue"].includes(b.to) && !req.ctx.can("delivery.gerenciar")) {
      assertCan(req.ctx, "delivery.entregar");
      if (Number(o.courier_id) !== Number(req.ctx.userId)) throw conflict("Pedido atribu\xEDdo a outro entregador");
    } else assertCan(req.ctx, "delivery.gerenciar");
    if (o.status === b.to) return { ok: true, replay: true };
    if (!FLOW2[o.status].includes(b.to)) throw conflict(`N\xE3o \xE9 poss\xEDvel ir de "${STATUS_LABEL2[o.status]}" para "${STATUS_LABEL2[b.to]}"`, "invalid_transition");
    if (b.to === "saiu" && o.mode !== "entrega") throw bad("Pedido de retirada n\xE3o sai para entrega");
    if (b.to === "cancelado" && !b.reason) throw bad("Informe o motivo do cancelamento");
    if (b.to === "confirmado") await db.query(`update order_items set sent_at = now() where session_id = $1 and kitchen_status = 'novo' and sent_at is null and status = 'ativo'`, [
    o.session_id]);
    if (b.to === "cancelado") {
      const t = await sessionTotals(db, o.session_id);
      if (t.paid > 0) throw conflict("H\xE1 pagamento confirmado: estorne antes de cancelar", "has_payments");
      const items = (await db.query(`select id, kitchen_status from order_items where session_id = $1 and status = 'ativo'`, [o.session_id])).rows;
      for (const it of items) if (["novo", "aceito", "nao_produz"].includes(it.kitchen_status)) await reverseForItem(db, req.ctx, it.id, `Delivery cancelado: ${b.reason}`);
      await db.query(
        `update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
          kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where session_id = $1 and status = 'ativo'`,
        [o.session_id, `Delivery cancelado: ${b.reason}`, req.ctx.userId]
      );
      await db.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2 where id = $1", [o.session_id, req.ctx.userId]);
    }
    if (b.to === "entregue") {
      const t = await sessionTotals(db, o.session_id);
      if (t.balance > 0 && !b.proof) throw conflict(`Saldo de R$ ${(t.balance / 100).toFixed(2).replace(".", ",")} em aberto: registre o pagamento ou informe o comprovante`, "balan\
ce_pending");
      const sess = (await db.query("select * from consumption_sessions where id = $1 for update", [o.session_id])).rows[0];
      if (t.balance === 0 && t.items > 0 && ["aberta", "em_fechamento"].includes(sess.status)) {
        await db.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1", [sess.id, req.ctx.userId]);
        await earnPoints(db, req.ctx, sess, t.items);
      }
    }
    await db.query(`update delivery_orders set status = $2, cancel_reason = coalesce($3, cancel_reason), proof = coalesce($4, proof),
        eta_minutes = coalesce($5, eta_minutes), updated_at = now() where id = $1`, [o.id, b.to, b.to === "cancelado" ? b.reason : null, b.proof ?? null, b.eta_minutes ?? null]);
    await db.query(
      "insert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)",
      [req.ctx.companyId, o.id, b.to, req.ctx.userId, b.reason || b.proof || null]
    );
    await audit(db, req.ctx, `delivery.${b.to}`, { entity: "delivery", entityId: o.id, reason: b.reason, data: { from: o.status } });
    return { ok: true, status: b.to };
  });
  res.json(out);
}));
router15.post("/orders/:id/courier", need("delivery.gerenciar"), h(async (req, res) => {
  const b = parse(z14.object({ courier_id: z14.number().int().nullable() }), req.body);
  if (b.courier_id) {
    const u = (await q("select 1 from users where id = $1 and company_id = $2 and active", [b.courier_id, req.ctx.companyId])).rows[0];
    if (!u) throw bad("Entregador inv\xE1lido");
  }
  const r = await q("update delivery_orders set courier_id = $3, updated_at = now() where id = $1 and company_id = $2 returning id", [Number(req.params.id), req.ctx.companyId, b.courier_id]);
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, "delivery.entregador", { entity: "delivery", entityId: r.rows[0].id, data: b });
  res.json({ ok: true });
}));
router15.get("/couriers", need("delivery.gerenciar"), h(async (req, res) => {
  res.json((await q(`select u.id, u.name, u.role_key from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
    where u.company_id = $1 and u.active and 'delivery.entregar' = any(r.permissions) order by u.name`, [req.ctx.companyId])).rows);
}));

// src/routes/marketing.js
import crypto9 from "node:crypto";
import { Router as Router16 } from "npm:express@5.2.1";
import { z as z15 } from "npm:zod@4.6.5";

// src/lib/agent.js
var agentConfig = (settings) => ({
  enabled: false,
  name: "Atendente virtual",
  greeting: "Ol\xE1! Sou o atendimento virtual. Posso mostrar o *card\xE1pio*, informar *hor\xE1rio*, montar seu *pedido*, ver o *status* do pedido ou fazer uma *reserva*. Para falar com a \
equipe, digite *atendente*.",
  handoff_message: "Certo! Vou chamar algu\xE9m da equipe para continuar com voc\xEA. Aguarde um instante.",
  closed_message: "No momento n\xE3o estamos recebendo pedidos. Veja nossos hor\xE1rios digitando *hor\xE1rio*.",
  reservation_max_people: 12,
  reservation_min_hours: 2,
  ...settings?.agent || {}
});
function zonedToUtc(local, tz) {
  const guess = /* @__PURE__ */ new Date(`${local}Z`);
  if (Number.isNaN(guess.getTime())) return guess;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(guess).map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}
var norm3 = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
var brl2 = (c) => `R$ ${(Number(c) / 100).toFixed(2).replace(".", ",")}`;
var has = (t, ...words) => words.some((w) => new RegExp(`(^|\\W)${w}(\\W|$)`).test(t));
async function menuProducts(companyId) {
  return (await q(`select p.id, p.name, p.price_cents, c.name as category, p.kind,
      exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as required_opts
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and (('delivery' = any(p.channels)) or ('cardapio_digital' = any(p.channels)) or ('pdv' = any(p.channels)))
    order by c.sort nulls last, c.name, p.name limit 200`, [companyId])).rows;
}
var STOP2 = /* @__PURE__ */ new Set(["quanto", "custa", "valor", "preco", "qual", "quero", "uma", "umas", "uns", "com", "sem", "por", "favor", "tem", "voces", "pra", "para", "mais",
"esta", "esse", "essa"]);
function findProduct(products, text) {
  const t = norm3(text);
  let best = null;
  let score = 0;
  for (const p of products) {
    const n = norm3(p.name);
    if (t.includes(n)) return p;
    const words = n.split(/\s+/).filter((w) => w.length > 2);
    const qwords = t.split(/\W+/).filter((w) => w.length > 2 && !STOP2.has(w));
    const hit = words.filter((w) => t.includes(w)).length;
    const qhit = qwords.filter((w) => words.some((x) => x.startsWith(w) || w.startsWith(x))).length;
    const s = hit ? Math.max(words.length ? hit / words.length : 0, qwords.length ? qhit / qwords.length : 0) : 0;
    if (s > score) {
      score = s;
      best = p;
    }
  }
  return score >= 0.5 ? best : null;
}
function parseQtyLine(products, line) {
  const t = norm3(line);
  const m = t.match(/^(\d{1,2})\s*(x\s*)?(.+)$/);
  const qty = m ? Number(m[1]) : 1;
  const p = findProduct(products, m ? m[3] : t);
  return p ? { p, qty: Math.min(Math.max(qty, 1), 50) } : null;
}
var summary = (cart, products) => cart.map((c) => {
  const p = products.find((x) => x.id === c.product_id);
  return `${c.qty}\xD7 ${p?.name} \u2014 ${brl2((p?.price_cents || 0) * c.qty)}`;
}).join("\n");
async function agentReply(company2, conv, text, { simulated }) {
  const cfg = agentConfig(company2.settings);
  const dcfg = deliveryConfig(company2.settings);
  const st = { ...conv.state || {} };
  const t = norm3(text);
  const out = [];
  const products = await menuProducts(company2.id);
  if (has(t, "atendente", "humano", "pessoa", "gerente", "reclamacao", "reclamar", "problema", "desconto", "cobranca", "estorno", "reembolso")) {
    return { replies: [cfg.handoff_message], state: { step: null }, handoff: true };
  }
  if (has(t, "cancelar", "cancela", "sair", "recomecar") && st.step && !has(t, "reserva")) {
    return { replies: ["Tudo bem, cancelei o que est\xE1vamos montando. Posso ajudar em algo mais?"], state: { step: null } };
  }
  if (st.step === "pedido") {
    if (has(t, "finalizar", "fechar", "pronto", "so isso", "e isso", "acabou")) {
      if (!st.cart?.length) return { replies: ["Seu pedido ainda est\xE1 vazio. Envie, por exemplo: *2 pilsen*."], state: st };
      const modes = [dcfg.delivery && "*entrega*", dcfg.pickup && "*retirada*"].filter(Boolean).join(" ou ");
      return { replies: [`Seu pedido:
${summary(st.cart, products)}

Vai ser ${modes}?`], state: { ...st, step: "modo" } };
    }
    const added = [];
    for (const line of String(text).split(/\n|,| e (?=\d)/)) {
      if (!line.trim()) continue;
      const r = parseQtyLine(products, line);
      if (!r) continue;
      if (r.p.required_opts) {
        out.push(`*${r.p.name}* tem op\xE7\xF5es para escolher \u2014 pe\xE7a esse item pelo card\xE1pio digital${company2.slug ? `: /c/${company2.slug}` : ""}.`);
        continue;
      }
      st.cart = [...st.cart || [], { product_id: r.p.id, qty: r.qty }];
      added.push(`${r.qty}\xD7 ${r.p.name}`);
    }
    if (added.length) out.push(`Anotado: ${added.join(", ")}. Algo mais? Quando terminar, digite *finalizar*.`);
    else if (!out.length) out.push("N\xE3o encontrei esse item no card\xE1pio. Digite *card\xE1pio* para ver as op\xE7\xF5es ou envie como *2 pilsen*.");
    return { replies: out, state: st };
  }
  if (st.step === "modo") {
    if (has(t, "entrega", "entregar", "delivery") && dcfg.delivery) return { replies: ["Qual o endere\xE7o? Envie *rua, n\xFAmero e bairro*."], state: { ...st, step: "endereco", mode: "\
entrega" } };
    if (has(t, "retirada", "retirar", "buscar", "balcao") && dcfg.pickup) return { replies: ["Em nome de quem fica o pedido?"], state: { ...st, step: "nome", mode: "retirada" } };
    return { replies: ["Responda *entrega* ou *retirada*."], state: st };
  }
  if (st.step === "endereco") {
    const parts = String(text).split(",").map((s) => s.trim());
    if (parts.length < 2 || !/\d/.test(parts[1])) return { replies: ["Preciso de rua e n\xFAmero, separados por v\xEDrgula. Ex.: *Rua das Flores, 120, Centro*."], state: st };
    return { replies: ["Em nome de quem fica o pedido?"], state: { ...st, step: "nome", address: { street: parts[0], number: parts[1], district: parts[2] || "" } } };
  }
  if (st.step === "nome") {
    const name = String(text).trim().slice(0, 60);
    if (name.length < 2) return { replies: ["Qual o nome?"], state: st };
    const { subtotal } = await priceCart({ query: q }, company2.id, st.cart).catch(() => ({ subtotal: 0 }));
    const fee = st.mode === "entrega" ? dcfg.fee_cents : 0;
    return {
      replies: [`Confira:
${summary(st.cart, products)}
${fee ? `Taxa de entrega: ${brl2(fee)}
` : ""}*Total: ${brl2(subtotal + fee)}*
${st.mode === "entrega" ? `Entrega em: ${st.address.street}, ${st.address.number}` : "Retirada no balc\xE3o"} \xB7 Nome: ${name}
Pagamento na ${st.mode === "entrega" ? "entrega" : "retirada"}.

Responda *confirmar* para enviar ou *cancelar*.`],
      state: { ...st, step: "confirmar", name }
    };
  }
  if (st.step === "confirmar") {
    if (!has(t, "confirmar", "confirmo", "sim", "pode", "ok")) return { replies: ["Responda *confirmar* para enviar o pedido ou *cancelar*."], state: st };
    if (simulated) return { replies: ["\u2705 (Simula\xE7\xE3o) Pedido montado corretamente. Nada foi enviado \xE0 cozinha nem registrado nas vendas."], state: { step: null } };
    try {
      const o = await createDeliveryOrder({ query: q }, company2.id, {
        channel: "whatsapp",
        mode: st.mode,
        customer_name: st.name,
        phone: conv.contact,
        address: st.address,
        cart: st.cart,
        client_key: `wa${conv.id}x${randomToken(6)}`
      }, null);
      return { replies: [`\u2705 Pedido *#${o.number}* recebido! Total ${brl2(o.total)}. Avisaremos quando for confirmado. Para acompanhar, digite *status*.`], state: { step: null } };
    } catch (e) {
      return { replies: [`N\xE3o consegui registrar o pedido: ${e.message}`], state: { step: null } };
    }
  }
  if (st.step === "reserva") {
    const d = String(text).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\D+(\d{1,2})(?:[:h](\d{2}))?\D+(\d{1,3})/i);
    if (!d) return { replies: ["Envie *dia/m\xEAs, hor\xE1rio e pessoas*. Ex.: *25/10 20:30 4 pessoas*."], state: st };
    const year = d[3] ? d[3].length === 2 ? 2e3 + Number(d[3]) : Number(d[3]) : (/* @__PURE__ */ new Date()).getFullYear();
    const tz = company2.timezone || "America/Sao_Paulo";
    const local = `${year}-${String(d[2]).padStart(2, "0")}-${String(d[1]).padStart(2, "0")}T${String(d[4]).padStart(2, "0")}:${d[5] || "00"}:00`;
    const when = zonedToUtc(local, tz);
    const people = Number(d[6]);
    if (Number.isNaN(when.getTime())) return { replies: ["Data inv\xE1lida. Ex.: *25/10 20:30 4 pessoas*."], state: st };
    if (when.getTime() < Date.now() + cfg.reservation_min_hours * 36e5) return { replies: [`Reservas precisam de pelo menos ${cfg.reservation_min_hours}h de anteced\xEAncia.`], state: st };
    if (people < 1 || people > cfg.reservation_max_people) return { replies: [`Para grupos acima de ${cfg.reservation_max_people} pessoas, a equipe vai te atender.`], state: { step: null },
    handoff: true };
    if (simulated) return { replies: [`\u2705 (Simula\xE7\xE3o) Reserva para ${people} pessoa(s) em ${d[1]}/${d[2]} \xE0s ${d[4]}:${d[5] || "00"} \u2014 nada foi gravado.`], state: {
    step: null } };
    const u = (await q("select id from units where company_id = $1 and active order by id limit 1", [company2.id])).rows[0];
    await q(
      `insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source) values ($1,$2,$3,$4,$5,$6,'pendente','agente')`,
      [company2.id, u.id, conv.contact_name || "Cliente WhatsApp", conv.contact, people, when]
    );
    return { replies: [`Pedido de reserva para *${people}* pessoa(s) em *${d[1]}/${d[2]} \xE0s ${d[4]}:${d[5] || "00"}* registrado. A equipe confirma em breve.`], state: { step: null } };
  }
  if (has(t, "oi", "ola", "bom dia", "boa tarde", "boa noite", "menu inicial", "ajuda", "opcoes") && t.length < 30) return { replies: [cfg.greeting], state: { step: null } };
  if (has(t, "horario", "horarios", "funciona", "funcionamento", "aberto", "abre", "fecha")) {
    return { replies: [`${dcfg.hours ? `Nosso hor\xE1rio: ${dcfg.hours}` : "Consulte nosso hor\xE1rio com a equipe."}${dcfg.enabled ? dcfg.accepting ? "\nEstamos recebendo pedidos a\
gora." : "\nNo momento n\xE3o estamos recebendo pedidos." : ""}`], state: st };
  }
  if (has(t, "cardapio", "menu", "opcoes de", "o que tem", "tem o que")) {
    const byCat = {};
    for (const p2 of products) (byCat[p2.category || "Outros"] ||= []).push(`\u2022 ${p2.name} \u2014 ${brl2(p2.price_cents)}`);
    const body = Object.entries(byCat).map(([c, l]) => `*${c}*
${l.slice(0, 12).join("\n")}`).join("\n\n").slice(0, 3500);
    return { replies: [body || "Card\xE1pio indispon\xEDvel no momento.", "Para pedir, digite *pedido*."], state: st };
  }
  if (has(t, "status", "meu pedido", "cade", "acompanhar", "demora")) {
    const o = (await q(
      `select number, status, mode, eta_minutes, created_at from delivery_orders where company_id = $1 and phone = $2 order by id desc limit 1`,
      [company2.id, onlyDigits(conv.contact)]
    )).rows[0];
    if (!o) return { replies: ["N\xE3o encontrei pedidos feitos por este n\xFAmero. Se pediu por outro n\xFAmero, fale com um *atendente*."], state: st };
    return { replies: [`Pedido *#${o.number}*: *${STATUS_LABEL2[o.status]}*${["recebido", "confirmado", "em_preparo"].includes(o.status) && o.eta_minutes ? ` \xB7 previs\xE3o de ${o.
    eta_minutes} min` : ""}.`], state: st };
  }
  if (has(t, "reserva", "reservar", "mesa para")) {
    if (has(t, "cancelar", "cancela", "desmarcar")) {
      if (simulated) return { replies: ["\u2705 (Simula\xE7\xE3o) Reserva cancelada \u2014 nada foi alterado."], state: { step: null } };
      const r = (await q(`update reservations set status = 'cancelada' where id = (select id from reservations where company_id = $1 and phone = $2
          and status in ('pendente','confirmada') and starts_at > now() order by starts_at limit 1) returning starts_at`, [company2.id, onlyDigits(conv.contact)])).rows[0];
      return { replies: [r ? "Sua pr\xF3xima reserva foi cancelada." : "N\xE3o encontrei reserva futura neste n\xFAmero."], state: { step: null } };
    }
    if (has(t, "remarcar", "mudar", "alterar")) return { replies: ["Para remarcar, cancele a atual (*cancelar reserva*) e fa\xE7a uma nova (*reserva*). Se preferir, chame um *atendent\
e*."], state: st };
    return { replies: ["Vamos reservar! Envie *dia/m\xEAs, hor\xE1rio e n\xFAmero de pessoas*. Ex.: *25/10 20:30 4 pessoas*."], state: { step: "reserva" } };
  }
  if (has(t, "pedido", "pedir", "quero", "encomendar", "delivery", "entrega")) {
    if (!dcfg.enabled || !dcfg.accepting) return { replies: [cfg.closed_message], state: st };
    const first = parseQtyLine(products, t.replace(/\b(quero|pedir|pedido|fazer|um|uma)\b/g, " ").trim());
    const cart = first && !first.p.required_opts ? [{ product_id: first.p.id, qty: first.qty }] : [];
    return { replies: [`${cart.length ? `Anotado: ${cart[0].qty}\xD7 ${first.p.name}. ` : ""}Me diga os itens, um por linha, com a quantidade. Ex.:
*2 pilsen*
*1 batata frita*
Quando terminar, digite *finalizar*.`], state: { step: "pedido", cart } };
  }
  if (has(t, "preco", "quanto", "valor", "custa")) {
    const p2 = findProduct(products, t);
    return { replies: [p2 ? `*${p2.name}*: ${brl2(p2.price_cents)}.` : "De qual item? Digite *card\xE1pio* para ver todos os pre\xE7os."], state: st };
  }
  const p = findProduct(products, t);
  if (p) return { replies: [`*${p.name}*: ${brl2(p.price_cents)}. Para pedir, digite *pedido*.`], state: st };
  const misses = (st.misses || 0) + 1;
  if (misses >= 3) return { replies: [cfg.handoff_message], state: { step: null }, handoff: true };
  return { replies: [`N\xE3o entendi. ${cfg.greeting}`], state: { ...st, misses } };
}
async function sendWhatsApp(companyId, to, body) {
  const s = Object.fromEntries((await q("select key, value from company_secrets where company_id = $1 and key in ('wa_token','wa_phone_number_id')", [companyId])).rows.map((r) => [
  r.key, r.value]));
  if (!s.wa_token || !s.wa_phone_number_id) return { ok: false, error: "Integra\xE7\xE3o do WhatsApp n\xE3o configurada" };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(s.wa_phone_number_id)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${s.wa_token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: onlyDigits(to), type: "text", text: { body: body.slice(0, 4e3) } }),
      signal: AbortSignal.timeout(8e3)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j?.error?.message?.slice(0, 200) || `HTTP ${r.status}` };
    return { ok: true, id: j?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
}
async function storeMessage(db, companyId, convId, m) {
  const r = await db.query(
    `insert into conversation_messages (company_id, conversation_id, direction, author, body, external_id, delivery_status, error, user_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,
    [companyId, convId, m.direction, m.author, m.body, m.external_id ?? null, m.delivery_status || "ok", m.error ?? null, m.user_id ?? null]
  );
  await db.query("update conversations set last_message_at = now() where id = $1", [convId]);
  return r.rows[0]?.id || null;
}
async function handleIncoming(company2, { channel, contact, contactName, body, externalId }) {
  const simulated = channel === "simulador";
  const conv = (await q(
    `insert into conversations (company_id, channel, contact, contact_name) values ($1,$2,$3,$4)
    on conflict (company_id, channel, contact) do update set contact_name = coalesce(excluded.contact_name, conversations.contact_name) returning *`,
    [company2.id, channel, contact, contactName ?? null]
  )).rows[0];
  const inId = await storeMessage({ query: q }, company2.id, conv.id, { direction: "in", author: "cliente", body: String(body).slice(0, 4e3), external_id: externalId });
  if (!inId) return { duplicate: true, conversation_id: conv.id, replies: [] };
  const cfg = agentConfig(company2.settings);
  if (conv.mode !== "agente" || !cfg.enabled && !simulated) return { conversation_id: conv.id, replies: [], mode: conv.mode };
  const r = await agentReply(company2, conv, body, { simulated });
  await q(
    "update conversations set state = $2, needs_human = needs_human or $3, mode = case when $3 then 'humano' else mode end where id = $1",
    [conv.id, JSON.stringify(r.state || {}), !!r.handoff]
  );
  for (const text of r.replies) {
    let status = simulated ? "simulado" : "pendente";
    let error = null;
    let ext = null;
    if (!simulated) {
      const s = await sendWhatsApp(company2.id, contact, text);
      status = s.ok ? "ok" : "falhou";
      error = s.error || null;
      ext = s.id || null;
    }
    await storeMessage({ query: q }, company2.id, conv.id, { direction: "out", author: "agente", body: text, external_id: ext, delivery_status: status, error });
  }
  return { conversation_id: conv.id, replies: r.replies, handoff: !!r.handoff };
}

// src/routes/marketing.js
var router16 = Router16();
var unsubscribeToken = (customerId) => `${customerId}.${crypto9.createHmac("sha256", deriveKey("unsubscribe")).update(String(customerId)).digest("base64url").slice(0, 16)}`;
function parseUnsubscribe(token) {
  const [id] = String(token || "").split(".");
  return /^\d+$/.test(id || "") && unsubscribeToken(id) === token ? Number(id) : null;
}
var segmentSchema = z15.object({
  birthday_month: z15.boolean().optional(),
  inactive_days: z15.number().int().min(1).max(3650).optional(),
  tag: z15.string().trim().max(30).optional(),
  min_visits: z15.number().int().min(1).max(1e3).optional()
}).default({});
function segmentWhere(seg, channel, params) {
  let w = `c.company_id = $1 and c.anonymized_at is null and c.unsubscribed_at is null and ${channel === "whatsapp" ? "c.consent_whatsapp and c.phone is not null" : "c.consent_emai\
l and c.email is not null"}`;
  if (seg.birthday_month) w += " and extract(month from c.birthday) = extract(month from current_date)";
  if (seg.tag) {
    params.push(seg.tag);
    w += ` and $${params.length} = any(c.tags)`;
  }
  if (seg.inactive_days) {
    params.push(seg.inactive_days);
    w += ` and not exists (select 1 from consumption_sessions s where s.customer_id = c.id and s.opened_at > now() - make_interval(days => $${params.length}))`;
  }
  if (seg.min_visits) {
    params.push(seg.min_visits);
    w += ` and (select count(*) from consumption_sessions s where s.customer_id = c.id and s.status = 'encerrada') >= $${params.length}`;
  }
  return w;
}
var render = (tpl, c, company2) => tpl.replaceAll("{nome}", (c.name || "").split(" ")[0]).replaceAll("{empresa}", company2).replaceAll("{pontos}", String(c.points ?? 0));
router16.post("/segments/preview", need("marketing.gerenciar"), h(async (req, res) => {
  const b = parse(z15.object({ channel: z15.enum(["whatsapp", "email"]), segment: segmentSchema }), req.body);
  const params = [req.ctx.companyId];
  const w = segmentWhere(b.segment, b.channel, params);
  const n = (await q(`select count(*)::int as n from customers c where ${w}`, params)).rows[0].n;
  const total = (await q("select count(*)::int as n from customers where company_id = $1 and anonymized_at is null", [req.ctx.companyId])).rows[0].n;
  res.json({ recipients: n, without_consent: total - n });
}));
router16.get("/campaigns", need("marketing.gerenciar"), h(async (req, res) => {
  res.json((await q(`select c.*, u.name as user_name,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'enviado') as sent,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'falhou') as failed
    from campaigns c left join users u on u.id = c.created_by where c.company_id = $1 order by c.id desc limit 100`, [req.ctx.companyId])).rows);
}));
router16.post("/campaigns", need("marketing.gerenciar"), h(async (req, res) => {
  const b = parse(z15.object({
    name: z15.string().trim().min(3).max(80),
    channel: z15.enum(["whatsapp", "email"]),
    segment: segmentSchema,
    message: z15.string().trim().min(10).max(1500)
  }), req.body);
  const r = await q(
    "insert into campaigns (company_id, name, channel, segment, message, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
    [req.ctx.companyId, b.name, b.channel, b.segment, b.message, req.ctx.userId]
  );
  res.status(201).json({ id: r.rows[0].id });
}));
router16.post("/campaigns/:id/prepare", need("marketing.gerenciar"), h(async (req, res) => {
  const out = await tx(async (db) => {
    const c = (await db.query("select * from campaigns where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!c) throw notFound("Campanha n\xE3o encontrada");
    if (c.status !== "rascunho") throw conflict("Campanha j\xE1 preparada");
    const params = [req.ctx.companyId];
    const w = segmentWhere(c.segment, c.channel, params);
    params.push(c.id);
    const r = await db.query(`insert into campaign_recipients (company_id, campaign_id, customer_id) select $1, $${params.length}, c.id from customers c where ${w}`, params);
    await db.query("update campaigns set status = 'preparada', recipients = $2, prepared_at = now() where id = $1", [c.id, r.rowCount]);
    await audit(db, req.ctx, "marketing.campanha_preparada", { entity: "campaign", entityId: c.id, data: { recipients: r.rowCount } });
    return { recipients: r.rowCount };
  });
  res.json(out);
}));
router16.get("/campaigns/:id/recipients", need("marketing.gerenciar", "dados.pessoais"), h(async (req, res) => {
  const c = (await q("select c.*, co.name as company from campaigns c join companies co on co.id = c.company_id where c.id = $1 and c.company_id = $2", [Number(req.params.id), req.
  ctx.companyId])).rows[0];
  if (!c) throw notFound();
  const rows = (await q(`select r.id, r.status, r.sent_at, r.error, cu.id as customer_id, cu.name, cu.phone, cu.email, cu.points, cu.unsubscribed_at
    from campaign_recipients r join customers cu on cu.id = r.customer_id where r.campaign_id = $1 order by cu.name limit 2000`, [c.id])).rows;
  res.json(rows.map((r) => ({ ...r, message: `${render(c.message, r, c.company)}

Para n\xE3o receber mais: ${req.query.base || ""}/sair/${unsubscribeToken(r.customer_id)}` })));
}));
router16.post("/campaigns/:id/recipients/:rid/sent", need("marketing.gerenciar"), h(async (req, res) => {
  const r = await q(
    `update campaign_recipients set status = 'enviado', sent_at = now() where id = $1 and campaign_id = $2 and company_id = $3 and status in ('pendente','falhou') returning id`,
    [Number(req.params.rid), Number(req.params.id), req.ctx.companyId]
  );
  res.json({ ok: !!r.rows[0] });
}));
router16.post("/campaigns/:id/send", need("marketing.gerenciar"), h(async (req, res) => {
  const b = parse(z15.object({ base_url: z15.string().url().max(200) }), req.body);
  const c = (await q("select c.*, co.name as company from campaigns c join companies co on co.id = c.company_id where c.id = $1 and c.company_id = $2", [Number(req.params.id), req.
  ctx.companyId])).rows[0];
  if (!c) throw notFound();
  if (c.channel !== "whatsapp") throw bad("Envio autom\xE1tico dispon\xEDvel s\xF3 para WhatsApp; para e-mail, exporte a lista");
  if (c.status !== "preparada") throw conflict("Prepare a campanha antes de enviar");
  const rows = (await q(`select r.id, cu.id as customer_id, cu.name, cu.phone, cu.points from campaign_recipients r join customers cu on cu.id = r.customer_id
    where r.campaign_id = $1 and r.status in ('pendente','falhou') and cu.unsubscribed_at is null and cu.consent_whatsapp limit 300`, [c.id])).rows;
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const s = await sendWhatsApp(req.ctx.companyId, r.phone, `${render(c.message, r, c.company)}

Para n\xE3o receber mais: ${b.base_url}/sair/${unsubscribeToken(r.customer_id)}`);
    await q("update campaign_recipients set status = $2, sent_at = case when $2 = 'enviado' then now() end, error = $3 where id = $1", [r.id, s.ok ? "enviado" : "falhou", s.error ||
    null]);
    if (s.ok) sent++;
    else failed++;
    if (!s.ok && /não configurada/.test(s.error)) break;
  }
  if (sent && !failed) await q("update campaigns set status = 'enviada' where id = $1", [c.id]);
  await audit({ query: q }, req.ctx, "marketing.campanha_enviada", { entity: "campaign", entityId: c.id, data: { sent, failed } });
  res.json({ sent, failed });
}));
router16.post("/campaigns/:id/cancel", need("marketing.gerenciar"), h(async (req, res) => {
  const r = await q("update campaigns set status = 'cancelada' where id = $1 and company_id = $2 and status in ('rascunho','preparada') returning id", [Number(req.params.id), req.ctx.
  companyId]);
  if (!r.rows[0]) throw conflict("Campanha n\xE3o pode ser cancelada");
  res.json({ ok: true });
}));
router16.get("/reviews", need("marketing.gerenciar"), h(async (req, res) => {
  const days = Math.min(365, Number(req.query.days) || 30);
  const stats2 = (await q(`select count(*)::int as total, round(avg(score)::numeric, 2)::float as average,
      count(*) filter (where score >= 4)::int as positive, count(*) filter (where score <= 2)::int as negative,
      count(*) filter (where score <= 2 and handled_at is null)::int as pending
    from reviews where company_id = $1 and created_at > now() - make_interval(days => $2)`, [req.ctx.companyId, days])).rows[0];
  const dist = (await q(`select score, count(*)::int as n from reviews where company_id = $1 and created_at > now() - make_interval(days => $2) group by score order by score`, [req.
  ctx.companyId, days])).rows;
  const items = (await q(`select r.id, r.score, r.comment, r.created_at, r.handled_at, r.session_id, cu.name as customer_name, cu.id as customer_id, u.name as handled_name
    from reviews r left join customers cu on cu.id = r.customer_id left join users u on u.id = r.handled_by
    where r.company_id = $1 and r.created_at > now() - make_interval(days => $2) order by (r.score <= 2 and r.handled_at is null) desc, r.id desc limit 200`, [req.ctx.companyId, days])).
  rows;
  res.json({ stats: stats2, distribution: dist, items });
}));
router16.post("/reviews/:id/handled", need("marketing.gerenciar"), h(async (req, res) => {
  const b = parse(z15.object({ note: z15.string().trim().min(3).max(300) }), req.body);
  const r = await q("update reviews set handled_at = now(), handled_by = $3 where id = $1 and company_id = $2 and handled_at is null returning id", [Number(req.params.id), req.ctx.
  companyId, req.ctx.userId]);
  if (!r.rows[0]) throw conflict("Avalia\xE7\xE3o j\xE1 tratada");
  await audit({ query: q }, req.ctx, "marketing.avaliacao_tratada", { entity: "review", entityId: r.rows[0].id, reason: b.note });
  res.json({ ok: true });
}));
router16.get("/review-link/:sessionId", need("pdv.lancar"), h(async (req, res) => {
  const s = (await q("select id from consumption_sessions where id = $1 and company_id = $2 and status = 'encerrada'", [Number(req.params.sessionId), req.ctx.companyId])).rows[0];
  if (!s) throw notFound("Consumo encerrado n\xE3o encontrado");
  const c = (await q("select slug from companies where id = $1", [req.ctx.companyId])).rows[0];
  res.json({ token: reviewToken(s.id), path: `/avaliar/${reviewToken(s.id)}`, slug: c.slug });
}));

// src/routes/agent.js
import { Router as Router17 } from "npm:express@5.2.1";
import { z as z16 } from "npm:zod@4.6.5";
var router17 = Router17();
var SECRET_KEYS2 = ["wa_token", "wa_phone_number_id", "wa_app_secret", "wa_verify_token"];
router17.get("/settings", need("agente.gerenciar"), h(async (req, res) => {
  const c = (await q("select slug, settings from companies where id = $1", [req.ctx.companyId])).rows[0];
  const secrets2 = (await q("select key, updated_at from company_secrets where company_id = $1 and key = any($2)", [req.ctx.companyId, SECRET_KEYS2])).rows;
  const fails = (await q(`select m.created_at, m.error from conversation_messages m where m.company_id = $1 and m.delivery_status = 'falhou' order by m.id desc limit 10`, [req.ctx.
  companyId])).rows;
  res.json({
    ...agentConfig(c.settings),
    slug: c.slug,
    secrets: Object.fromEntries(SECRET_KEYS2.map((k) => [k, !!secrets2.find((s) => s.key === k)])),
    webhook_path: c.slug ? `/api/public/whatsapp/${c.slug}` : null,
    failures: fails
  });
}));
router17.put("/settings", need("agente.gerenciar"), h(async (req, res) => {
  const b = parse(z16.object({
    enabled: z16.boolean(),
    name: z16.string().trim().min(2).max(40),
    greeting: z16.string().trim().min(5).max(600),
    handoff_message: z16.string().trim().min(5).max(300),
    closed_message: z16.string().trim().min(5).max(300),
    reservation_max_people: z16.number().int().min(1).max(100),
    reservation_min_hours: z16.number().int().min(0).max(72)
  }), req.body);
  await q(`update companies set settings = jsonb_set(settings, '{agent}', $2::jsonb) where id = $1`, [req.ctx.companyId, JSON.stringify(b)]);
  await audit({ query: q }, req.ctx, "agente.configuracao", { data: { enabled: b.enabled } });
  res.json({ ok: true });
}));
router17.put("/secrets", need("agente.gerenciar", "configuracoes.gerenciar"), h(async (req, res) => {
  const b = parse(z16.object(Object.fromEntries(SECRET_KEYS2.map((k) => [k, z16.string().trim().max(600).optional()]))), req.body);
  await tx(async (db) => {
    for (const [k, v] of Object.entries(b)) {
      if (v === void 0) continue;
      if (!v) await db.query("delete from company_secrets where company_id = $1 and key = $2", [req.ctx.companyId, k]);
      else await db.query(`insert into company_secrets (company_id, key, value) values ($1,$2,$3)
        on conflict (company_id, key) do update set value = excluded.value, updated_at = now()`, [req.ctx.companyId, k, v]);
    }
    await audit(db, req.ctx, "agente.credenciais", { data: { keys: Object.keys(b).filter((k) => b[k] !== void 0) } });
  });
  res.json({ ok: true });
}));
router17.get("/conversations", need("agente.atender"), h(async (req, res) => {
  const channel = req.query.channel === "simulador" ? "simulador" : "whatsapp";
  res.json((await q(`select c.id, c.channel, c.contact, c.contact_name, c.mode, c.needs_human, c.last_message_at, u.name as assigned_name,
      (select body from conversation_messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_body,
      (select count(*)::int from conversation_messages m where m.conversation_id = c.id and m.delivery_status = 'falhou') as failures
    from conversations c left join users u on u.id = c.assigned_to where c.company_id = $1 and c.channel = $2
    order by c.needs_human desc, c.last_message_at desc limit 100`, [req.ctx.companyId, channel])).rows);
}));
router17.get("/conversations/:id", need("agente.atender"), h(async (req, res) => {
  const c = (await q("select * from conversations where id = $1 and company_id = $2", [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!c) throw notFound("Conversa n\xE3o encontrada");
  const msgs = (await q(`select m.id, m.direction, m.author, m.body, m.delivery_status, m.error, m.created_at, u.name as user_name
    from conversation_messages m left join users u on u.id = m.user_id where m.conversation_id = $1 order by m.id desc limit 200`, [c.id])).rows.reverse();
  res.json({ conversation: c, messages: msgs });
}));
router17.post("/conversations/:id/mode", need("agente.atender"), h(async (req, res) => {
  const b = parse(z16.object({ mode: z16.enum(["agente", "humano", "pausado"]) }), req.body);
  const r = await q(`update conversations set mode = $3, assigned_to = case when $3 = 'humano' then $4 else null end,
      needs_human = case when $3 = 'agente' then false else needs_human end, state = case when $3 = 'agente' then '{}'::jsonb else state end
    where id = $1 and company_id = $2 returning id`, [Number(req.params.id), req.ctx.companyId, b.mode, req.ctx.userId]);
  if (!r.rows[0]) throw notFound();
  await storeMessage({ query: q }, req.ctx.companyId, r.rows[0].id, {
    direction: "out",
    author: "sistema",
    delivery_status: "simulado",
    body: { agente: "Conversa devolvida ao agente", humano: `${req.ctx.name} assumiu a conversa`, pausado: "Agente pausado nesta conversa" }[b.mode],
    user_id: req.ctx.userId
  });
  res.json({ ok: true });
}));
router17.post("/conversations/:id/reply", need("agente.atender"), h(async (req, res) => {
  const b = parse(z16.object({ body: z16.string().trim().min(1).max(2e3) }), req.body);
  const c = (await q("select * from conversations where id = $1 and company_id = $2", [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!c) throw notFound();
  if (c.mode === "agente") throw conflict("Assuma a conversa antes de responder", "not_assumed");
  let status = "simulado";
  let error = null;
  let ext = null;
  if (c.channel === "whatsapp") {
    const s = await sendWhatsApp(req.ctx.companyId, c.contact, b.body);
    status = s.ok ? "ok" : "falhou";
    error = s.error || null;
    ext = s.id || null;
  }
  await storeMessage({ query: q }, req.ctx.companyId, c.id, { direction: "out", author: "equipe", body: b.body, external_id: ext, delivery_status: status, error, user_id: req.ctx.userId });
  res.status(201).json({ ok: status !== "falhou", status, error });
}));
router17.post("/simulate", need("agente.gerenciar"), h(async (req, res) => {
  const b = parse(z16.object({ body: z16.string().trim().min(1).max(1e3), contact: z16.string().trim().max(20).optional(), reset: z16.boolean().optional() }), req.body);
  const company2 = (await q("select id, name, slug, timezone, settings from companies where id = $1", [req.ctx.companyId])).rows[0];
  const contact = `sim-${b.contact || req.ctx.userId}`;
  if (b.reset) await q("delete from conversations where company_id = $1 and channel = 'simulador' and contact = $2", [req.ctx.companyId, contact]);
  const r = await handleIncoming(company2, { channel: "simulador", contact, contactName: "Simula\xE7\xE3o", body: b.body, externalId: `sim-${randomToken(8)}` });
  res.json(r);
}));

// src/routes/reservations.js
import { Router as Router18 } from "npm:express@5.2.1";
import { z as z17 } from "npm:zod@4.6.5";
var router18 = Router18();
router18.get("/", need("salao.visualizar"), h(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day)) ? req.query.day : null;
  const tz = req.ctx.company.timezone;
  const params = [req.ctx.companyId, tz];
  let where = "r.company_id = $1";
  if (day) {
    params.push(day);
    where += ` and (r.starts_at at time zone $2)::date = $${params.length}`;
  } else where += " and r.starts_at > now() - interval '3 hours'";
  res.json((await q(`select r.*, t.number as table_number from reservations r left join dining_tables t on t.id = r.table_id where ${where} order by r.starts_at limit 200`, params)).
  rows);
}));
router18.post("/", need("salao.gerenciar"), h(async (req, res) => {
  const b = parse(z17.object({
    customer_name: z17.string().trim().min(2).max(80),
    phone: z17.string().trim().max(20).optional(),
    people: z17.number().int().min(1).max(100),
    starts_at: z17.string().datetime({ offset: true }),
    table_id: z17.number().int().nullable().optional(),
    notes: z17.string().max(300).optional()
  }), req.body);
  if (new Date(b.starts_at).getTime() < Date.now() - 36e5) throw bad("Hor\xE1rio j\xE1 passou");
  if (b.table_id) {
    const t = await q("select 1 from dining_tables where id = $1 and company_id = $2", [b.table_id, req.ctx.companyId]);
    if (!t.rows[0]) throw bad("Mesa inv\xE1lida");
  }
  const unit = req.ctx.unitId || (await q("select id from units where company_id = $1 order by id limit 1", [req.ctx.companyId])).rows[0].id;
  const r = await q(
    `insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, table_id, notes, status, source)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmada','equipe') returning id`,
    [req.ctx.companyId, unit, b.customer_name, b.phone ? onlyDigits(b.phone) : null, b.people, b.starts_at, b.table_id ?? null, b.notes ?? null]
  );
  await audit({ query: q }, req.ctx, "reserva.criada", { entity: "reservation", entityId: r.rows[0].id, data: { people: b.people, starts_at: b.starts_at } });
  res.status(201).json({ id: r.rows[0].id });
}));
router18.post("/:id/status", need("salao.gerenciar"), h(async (req, res) => {
  const b = parse(z17.object({ status: z17.enum(["confirmada", "cancelada", "chegou", "nao_compareceu"]), table_id: z17.number().int().nullable().optional() }), req.body);
  const r = await q(
    "update reservations set status = $3, table_id = coalesce($4, table_id) where id = $1 and company_id = $2 returning id, table_id",
    [Number(req.params.id), req.ctx.companyId, b.status, b.table_id ?? null]
  );
  if (!r.rows[0]) throw notFound("Reserva n\xE3o encontrada");
  if (b.status === "confirmada" && r.rows[0].table_id) await q("update dining_tables set status = 'reservada' where id = $1 and status = 'livre'", [r.rows[0].table_id]);
  await audit({ query: q }, req.ctx, `reserva.${b.status}`, { entity: "reservation", entityId: r.rows[0].id });
  res.json({ ok: true });
}));

// src/routes/public.js
import crypto10 from "node:crypto";
import { Router as Router19 } from "npm:express@5.2.1";
import { z as z18 } from "npm:zod@4.6.5";
var router19 = Router19();
async function companyBySlug(slug) {
  if (!/^[a-z0-9-]{3,40}$/.test(String(slug))) throw notFound("Estabelecimento n\xE3o encontrado");
  const c = (await q("select id, name, slug, phone, address, timezone, settings, is_demo from companies where slug = $1", [slug])).rows[0];
  if (!c) throw notFound("Estabelecimento n\xE3o encontrado");
  return c;
}
router19.get("/:slug/menu", h(async (req, res) => {
  const c = await companyBySlug(req.params.slug);
  const cfg = deliveryConfig(c.settings);
  if (!cfg.enabled) throw notFound("Card\xE1pio digital desativado");
  const products = (await q(`select p.id, p.name, p.description, p.price_cents, p.allergens, p.category_id, c.name as category,
      coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
         'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                       from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id) from modifier_groups g where g.product_id = p.id), '[]') as groups
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and ('delivery' = any(p.channels) or 'cardapio_digital' = any(p.channels))
    order by c.sort nulls last, c.name, p.name`, [c.id])).rows;
  res.set("cache-control", "public, max-age=30");
  res.json({
    company: { name: c.name, slug: c.slug, phone: c.phone, address: c.address?.city ? `${c.address.street || ""} ${c.address.number || ""} \u2014 ${c.address.city}` : null },
    settings: {
      accepting: cfg.accepting,
      delivery: cfg.delivery,
      pickup: cfg.pickup,
      fee_cents: cfg.fee_cents,
      min_order_cents: cfg.min_order_cents,
      eta_minutes: cfg.eta_minutes,
      hours: cfg.hours,
      areas: cfg.areas,
      message: cfg.message,
      payment_methods: cfg.payment_methods
    },
    products
  });
}));
var orderSchema = z18.object({
  mode: z18.enum(["entrega", "retirada"]),
  customer_name: z18.string().trim().min(2).max(80),
  phone: z18.string().trim().min(10).max(20),
  address: z18.object({
    street: z18.string().trim().max(120),
    number: z18.string().trim().max(20),
    district: z18.string().trim().max(80).optional(),
    complement: z18.string().trim().max(80).optional(),
    reference: z18.string().trim().max(120).optional()
  }).partial().optional(),
  payment_hint: z18.enum(["dinheiro", "pix", "cartao"]),
  change_for_cents: z18.number().int().min(0).max(1e6).optional(),
  notes: z18.string().trim().max(300).optional(),
  cart: z18.array(z18.object({
    product_id: z18.number().int(),
    qty: z18.number().int().min(1).max(50),
    option_ids: z18.array(z18.number().int()).max(40).default([]),
    notes: z18.string().trim().max(140).optional()
  })).min(1).max(40),
  client_key: z18.string().regex(/^[A-Za-z0-9_-]{12,80}$/),
  website: z18.string().max(0).optional()
  // armadilha para robôs: campo invisível precisa vir vazio
});
router19.post("/:slug/orders", h(async (req, res) => {
  const c = await companyBySlug(req.params.slug);
  const b = parse(orderSchema, req.body);
  await rateLimit(`pub-order:${c.id}:${req.ip}`, 8, 900);
  await rateLimit(`pub-order-phone:${c.id}:${b.phone.replace(/\D/g, "")}`, 4, 900);
  const o = await tx((db) => createDeliveryOrder(db, c.id, { ...b, channel: "site" }, null));
  res.status(o.replay ? 200 : 201).json({ number: o.number, token: o.public_token, status: o.status });
}));
router19.get("/orders/:token", h(async (req, res) => {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(req.params.token)) throw notFound("Pedido n\xE3o encontrado");
  const o = (await q(`select d.id, d.number, d.status, d.mode, d.eta_minutes, d.created_at, d.updated_at, d.session_id, d.customer_name, c.name as company, c.slug
    from delivery_orders d join companies c on c.id = d.company_id where d.public_token = $1`, [req.params.token])).rows[0];
  if (!o) throw notFound("Pedido n\xE3o encontrado");
  const items = (await q(`select description, qty, modifiers, total_cents from order_items where session_id = $1 and status = 'ativo' order by id`, [o.session_id])).rows;
  const events = (await q("select status, created_at from delivery_events where order_id = $1 order by id", [o.id])).rows;
  const t = await sessionTotals({ query: q }, o.session_id);
  res.set("cache-control", "no-store");
  res.json({
    number: o.number,
    status: o.status,
    label: STATUS_LABEL2[o.status],
    mode: o.mode,
    eta_minutes: o.eta_minutes,
    created_at: o.created_at,
    first_name: o.customer_name.split(" ")[0],
    company: o.company,
    slug: o.slug,
    items,
    totals: { items: t.items, delivery_fee: t.deliveryFee, total: t.total },
    events: events.map((e) => ({ status: e.status, label: STATUS_LABEL2[e.status], at: e.created_at }))
  });
}));
router19.get("/review/:token", h(async (req, res) => {
  const sid = parseReviewToken(req.params.token);
  if (!sid) throw notFound("Link inv\xE1lido");
  const s = (await q(`select s.id, s.company_id, c.name as company, (select 1 from reviews r where r.session_id = s.id) as done
    from consumption_sessions s join companies c on c.id = s.company_id where s.id = $1 and s.status = 'encerrada'`, [sid])).rows[0];
  if (!s) throw notFound("Link inv\xE1lido");
  res.json({ company: s.company, already: !!s.done });
}));
router19.post("/review/:token", h(async (req, res) => {
  const sid = parseReviewToken(req.params.token);
  if (!sid) throw notFound("Link inv\xE1lido");
  await rateLimit(`pub-review:${req.ip}`, 10, 3600);
  const b = parse(z18.object({ score: z18.number().int().min(1).max(5), comment: z18.string().trim().max(600).optional() }), req.body);
  const s = (await q("select id, company_id, customer_id from consumption_sessions where id = $1 and status = 'encerrada'", [sid])).rows[0];
  if (!s) throw notFound("Link inv\xE1lido");
  await q("insert into reviews (company_id, session_id, customer_id, score, comment) values ($1,$2,$3,$4,$5)", [s.company_id, s.id, s.customer_id, b.score, b.comment || null]).catch(
  (e) => {
    if (e.code === "23505") throw conflict("Este consumo j\xE1 foi avaliado. Obrigado!", "already_reviewed");
    throw e;
  });
  res.status(201).json({ ok: true });
}));
router19.post("/unsubscribe/:token", h(async (req, res) => {
  const id = parseUnsubscribe(req.params.token);
  if (!id) throw notFound("Link inv\xE1lido");
  const r = await q(`update customers set consent_whatsapp = false, consent_email = false, unsubscribed_at = now(), updated_at = now() where id = $1 returning company_id`, [id]);
  if (r.rows[0]) await q(`insert into audit_events (company_id, action, entity, entity_id, data) values ($1,'cliente.descadastro','customer',$2,'{"origem":"link"}')`, [r.rows[0].company_id,
  String(id)]);
  res.json({ ok: true });
}));
async function secrets(companyId) {
  return Object.fromEntries((await q("select key, value from company_secrets where company_id = $1 and key like 'wa_%'", [companyId])).rows.map((r) => [r.key, r.value]));
}
router19.get("/whatsapp/:slug", h(async (req, res) => {
  const c = await companyBySlug(req.params.slug);
  const s = await secrets(c.id);
  if (req.query["hub.mode"] === "subscribe" && s.wa_verify_token && safeEqual(String(req.query["hub.verify_token"] || ""), s.wa_verify_token)) {
    return res.type("text/plain").send(String(req.query["hub.challenge"] || "").slice(0, 200));
  }
  res.status(403).json({ error: "Verifica\xE7\xE3o recusada" });
}));
router19.post("/whatsapp/:slug", h(async (req, res) => {
  const c = await companyBySlug(req.params.slug);
  const s = await secrets(c.id);
  if (!s.wa_app_secret) return res.status(403).json({ error: "Integra\xE7\xE3o n\xE3o configurada" });
  const expected2 = `sha256=${crypto10.createHmac("sha256", s.wa_app_secret).update(req.rawBody || "").digest("hex")}`;
  if (!safeEqual(String(req.headers["x-hub-signature-256"] || ""), expected2)) return res.status(401).json({ error: "Assinatura inv\xE1lida" });
  const company2 = (await q("select id, name, slug, timezone, settings from companies where id = $1", [c.id])).rows[0];
  for (const entry of req.body?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names = Object.fromEntries((v.contacts || []).map((k) => [k.wa_id, k.profile?.name]));
      for (const m of v.messages || []) {
        const body = m.type === "text" ? m.text?.body : m.type === "button" ? m.button?.text : m.type === "interactive" ? m.interactive?.button_reply?.title || m.interactive?.list_reply?.
        title : null;
        if (!body || !m.from) continue;
        await handleIncoming(company2, { channel: "whatsapp", contact: String(m.from).slice(0, 20), contactName: names[m.from] || null, body, externalId: m.id });
      }
    }
  }
  res.json({ ok: true });
}));
async function chargeByToken(token) {
  if (!/^[0-9a-f]{36}$/.test(String(token))) return null;
  return (await q("select * from infinitepay_charges where token = $1", [token])).rows[0] || null;
}
router19.post("/infinitepay/webhook/:token", h(async (req, res) => {
  const c = await chargeByToken(req.params.token);
  if (!c) return res.status(404).json({ ok: false });
  const b = req.body || {};
  await logEvent({ query: q }, c, "webhook", b);
  if (b.order_nsu && String(b.order_nsu) !== c.order_nsu) return res.status(400).json({ ok: false, error: "pedido n\xE3o confere" });
  try {
    await confirmCharge(tx, c.id, { transaction_nsu: b.transaction_nsu, invoice_slug: b.invoice_slug, capture_method: b.capture_method, receipt_url: b.receipt_url }, "webhook");
    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false });
  }
}));
router19.post("/infinitepay/return", h(async (req, res) => {
  await rateLimit(`ip-return:${req.ip}`, 60, 600);
  const b = req.body || {};
  const c = await chargeByToken(b.c);
  if (!c) return res.status(404).json({ error: "Pagamento n\xE3o encontrado" });
  await logEvent({ query: q }, c, "retorno", { ...b, c: void 0 });
  let r = c;
  try {
    r = await confirmCharge(tx, c.id, { transaction_nsu: b.transaction_nsu, invoice_slug: b.slug, capture_method: b.capture_method, receipt_url: b.receipt_url }, "retorno");
  } catch {
  }
  const co = (await q("select name from companies where id = $1", [c.company_id])).rows[0];
  res.json({ status: r.status === "divergente" ? "pago" : r.status, amount_cents: Number(c.amount_cents), description: c.description, company: co?.name, receipt_url: r.receipt_url ||
  b.receipt_url || null });
}));

// src/routes/platform.js
import { Router as Router20 } from "npm:express@5.2.1";
import bcrypt3 from "npm:bcryptjs@3.0.3";
import crypto11 from "node:crypto";
import { z as z19 } from "npm:zod@4.6.5";
var platformRouter = Router20();
platformRouter.use(verifyHubRequest);
platformRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
var central = { companyId: null, userId: null };
async function company(id) {
  if (!/^\d{1,18}$/.test(String(id))) throw notFound("Empresa n\xE3o encontrada.");
  const { rows } = await q("select id, is_demo from companies where id = $1", [id]);
  if (!rows[0] || rows[0].is_demo) throw notFound("Empresa n\xE3o encontrada.");
  return rows[0];
}
platformRouter.get("/manifest", (_req, res) => res.json({
  code: PRODUCT_CODE,
  name: "RUSTEN",
  contract: CONTRACT_VERSION,
  contract_minor: 1,
  version: RUSTEN_VERSION,
  description: "Gest\xE3o e PDV para bares e restaurantes: comandas, mesas, dupla leitura e caixa.",
  features: FEATURES,
  settings: settingsManifest()
}));
platformRouter.get("/tenants", h(async (_req, res) => {
  const { rows } = await q("select id from companies where not is_demo order by id limit 5000");
  const items = [];
  for (const r of rows) {
    const t = await tenantPayload(r.id);
    if (t) {
      const { is_demo: _d, owner_email: _o, ...x } = t;
      items.push(x);
    }
  }
  res.json({ items });
}));
var ROLE_LABEL = (key2, name) => name || key2;
platformRouter.get("/tenants/:id", h(async (req, res) => {
  const c = await company(req.params.id);
  const { is_demo: _d, ...t } = await tenantPayload(c.id);
  const { rows: users } = await q(
    `select u.name, u.email, u.role_key as role, r.name as role_name, u.active,
            (select max(s.created_at) from user_sessions s where s.user_id = u.id) as last_login_at
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by u.role_key = 'owner' desc, u.name limit 200`,
    [c.id]
  );
  const { rows: units } = await q("select name, active from units where company_id = $1 order by id", [c.id]);
  res.json({ tenant: { ...t, users: {
    n: users.length,
    active: users.filter((u) => u.active).length,
    list: users.map(({ role_name: rn, ...u }) => ({ ...u, role_label: ROLE_LABEL(u.role, rn) }))
  }, units } });
}));
platformRouter.post("/tenants/:id/access", h(async (req, res) => {
  const c = await company(req.params.id);
  const d = parse(z19.object({ access: z19.object({ status: z19.string(), blocked: z19.boolean() }).passthrough() }), req.body);
  await storeAccess(c.id, d.access);
  await audit({ query: q }, { ...central, companyId: c.id }, "central.situacao_recebida", {
    entity: "company",
    entityId: c.id,
    data: { status: d.access.status, blocked: d.access.blocked }
  });
  res.json({ ok: true });
}));
platformRouter.post("/tenants/:id/owner-reset", h(async (req, res) => {
  const c = await company(req.params.id);
  const d = parse(z19.object({ email: z19.string().trim().toLowerCase().email().max(160).nullable().optional() }), req.body || {});
  const { rows } = await q("select id, email from users where company_id = $1 and role_key = 'owner' order by id limit 1", [c.id]);
  const owner = rows[0];
  if (!owner) throw new HttpError(404, "Esta empresa n\xE3o tem usu\xE1rio respons\xE1vel.", "not_found");
  let email = owner.email;
  if (d.email && d.email !== owner.email.toLowerCase()) {
    const taken = await q("select 1 from users where lower(email) = $1 and id <> $2", [d.email, owner.id]);
    if (taken.rows[0]) throw new HttpError(409, "Este e-mail j\xE1 \xE9 usado por outro acesso.", "email_taken");
    await q("update users set email = $1 where id = $2", [d.email, owner.id]);
    email = d.email;
  }
  const temp = `Rs-${crypto11.randomBytes(6).toString("base64url")}-${crypto11.randomInt(10, 99)}`;
  await q(`update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null, active = true
            where id = $1`, [owner.id, await bcrypt3.hash(temp, 12)]);
  await q("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [owner.id]);
  await audit({ query: q }, { ...central, companyId: c.id }, "central.senha_provisoria", { entity: "user", entityId: owner.id, data: { email } });
  res.json({
    ok: true,
    user_id: String(owner.id),
    email,
    temporary_password: temp,
    message: "Senha provis\xF3ria criada. Oriente o respons\xE1vel a troc\xE1-la em Configura\xE7\xF5es \u203A Meu acesso logo no primeiro acesso."
  });
}));
platformRouter.get("/settings", h(async (_req, res) => res.json({ values: await getSystemParams() })));
platformRouter.put("/settings", h(async (req, res) => {
  const values2 = await setSystemParams(req.body?.values);
  res.json({ values: values2 });
}));
platformRouter.get("/tenants/:id/settings", h(async (req, res) => {
  const c = await company(req.params.id);
  res.json({ values: await getTenantParams(c.id) });
}));
platformRouter.put("/tenants/:id/settings", h(async (req, res) => {
  const c = await company(req.params.id);
  const changed = await tx(async (db) => {
    const ch = await setTenantParams(db, c.id, req.body?.values);
    await audit(db, { ...central, companyId: c.id }, "central.parametros_alterados", {
      entity: "company",
      entityId: c.id,
      reason: typeof req.body?.reason === "string" ? req.body.reason.slice(0, 300) : null,
      data: ch
    });
    return ch;
  });
  res.json({ ok: true, changed, values: await getTenantParams(c.id) });
}));
var cronRouter = Router20();
cronRouter.get("/platform", h(async (req, res) => {
  const secret = env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "n\xE3o autorizado" });
  res.json(await flushOutbox(50));
}));
var accessRouter = Router20();
accessRouter.use(auth());
var rid = (req) => encodeURIComponent(req.ctx.companyId);
var actor = (req) => ({ user_email: req.ctx.email, user_name: req.ctx.name });
var demoGuard = (req, _res, next) => {
  if (req.ctx.company.is_demo) return next(new HttpError(400, "Na demonstra\xE7\xE3o n\xE3o h\xE1 assinatura. Ative sua conta para contratar.", "demo"));
  next();
};
accessRouter.get("/", h(async (req, res) => res.json({ access: req.ctx.access, hub: !!await platformConfig() })));
accessRouter.get("/billing", h(async (req, res) => {
  if (req.ctx.company.is_demo || !await platformConfig()) return res.json({ access: req.ctx.access, hub: false, demo: !!req.ctx.company.is_demo });
  if (!req.ctx.can("assinatura.gerenciar")) return res.json({ access: req.ctx.access, restricted: true, hub: true });
  const out = await hubCall("GET", `/tenants/${rid(req)}/billing`);
  if (out.access) await storeAccess(req.ctx.companyId, out.access);
  res.json({ ...out, plans: normalizePlans(out.plans), hub: true });
}));
accessRouter.post("/billing/checkout", need("assinatura.gerenciar"), demoGuard, h(async (req, res) => {
  const d = parse(z19.object({ plan_id: z19.string().uuid(), cycle: z19.enum(["MONTHLY", "ANNUAL"]) }), req.body);
  const out = await hubCall("POST", `/tenants/${rid(req)}/billing/checkout`, { ...d, ...actor(req) });
  await audit({ query: q }, req.ctx, "assinatura.contratacao", { data: { plan_id: d.plan_id, cycle: d.cycle } });
  res.status(201).json(out);
}));
accessRouter.post("/billing/renew", need("assinatura.gerenciar"), demoGuard, h(async (req, res) => {
  const out = await hubCall("POST", `/tenants/${rid(req)}/billing/renew`, actor(req));
  await audit({ query: q }, req.ctx, "assinatura.renovacao");
  res.status(201).json(out);
}));
accessRouter.post("/billing/change-plan", need("assinatura.gerenciar"), demoGuard, h(async (req, res) => {
  const d = parse(z19.object({ plan_id: z19.string().uuid() }), req.body);
  const out = await hubCall("POST", `/tenants/${rid(req)}/billing/change-plan`, { ...d, ...actor(req) });
  await refreshAccess({ id: req.ctx.companyId }, { fresh: true });
  await audit({ query: q }, req.ctx, "assinatura.troca_plano", { data: d });
  res.json(out);
}));
accessRouter.post("/billing/cancel", need("assinatura.gerenciar"), demoGuard, h(async (req, res) => {
  parse(z19.object({ confirm: z19.literal(true, { message: "confirme o cancelamento" }) }), req.body);
  if (req.ctx.role !== "owner") throw new HttpError(403, "S\xF3 o propriet\xE1rio pode cancelar a assinatura.", "forbidden");
  const out = await hubCall("POST", `/tenants/${rid(req)}/billing/cancel`, { confirm: true, ...actor(req) });
  await refreshAccess({ id: req.ctx.companyId }, { fresh: true });
  await audit({ query: q }, req.ctx, "assinatura.cancelamento");
  res.json(out);
}));
accessRouter.post("/verify", h(async (req, res) => {
  const access = await refreshAccess({ id: req.ctx.companyId, is_demo: req.ctx.company.is_demo }, { fresh: true });
  await audit({ query: q }, req.ctx, "assinatura.verificacao");
  res.json({ ok: true, refreshed: !!access });
}));

// src/edgeProxy.js
import crypto12 from "node:crypto";
var env2 = () => globalThis.process?.env ?? {};
function edgeProxyIp(req, _res, next) {
  const key2 = env2().EDGE_PROXY_KEY;
  const sent = req.headers["x-edge-proxy-key"];
  const ip = String(req.headers["x-edge-client-ip"] || "").trim();
  delete req.headers["x-edge-proxy-key"];
  if (key2 && typeof sent === "string" && ip && /^[0-9a-fA-F:.]{3,64}$/.test(ip)) {
    const a = crypto12.createHash("sha256").update(sent).digest();
    const b = crypto12.createHash("sha256").update(key2).digest();
    if (crypto12.timingSafeEqual(a, b)) Object.defineProperty(req, "ip", { value: ip, configurable: true });
  }
  next();
}

// src/server.js
function createApp() {
  const app2 = express();
  app2.disable("x-powered-by");
  app2.set("trust proxy", 1);
  app2.use(edgeProxyIp);
  app2.use(helmet());
  const prod = env.NODE_ENV === "production";
  const origins = (env.CORS_ORIGINS || (prod ? "" : "http://localhost:5173")).split(",").map((s) => s.trim()).filter((s) => s && (!prod || s !== "*"));
  const allowed = (o) => !o || origins.includes(o) || !prod && (origins.includes("*") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o));
  app2.use(cors({
    origin: (o, cb) => cb(null, allowed(o)),
    credentials: false,
    maxAge: 600,
    allowedHeaders: ["content-type", "authorization", "x-terminal-id", "x-session-mode"]
  }));
  app2.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const verify = (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  };
  const bigJson = express.json({ limit: "9mb", verify });
  const json = express.json({ limit: "1mb", verify });
  const BIG = /^\/api\/(stock\/notes\/read|pos-sales(\/preview)?)\/?$/;
  app2.use((req, res, next) => (BIG.test(req.path) ? bigJson : json)(req, res, next));
  app2.get("/api/health", (_req, res) => res.json({ ok: true, service: "rusten-api" }));
  app2.use("/api/auth", router);
  app2.use("/api/platform/v1", platformRouter);
  app2.use("/api/cron", cronRouter);
  app2.use("/api/access", accessRouter);
  app2.use("/api/public", router19);
  const gated = [auth(), requireAccess()];
  app2.use("/api/admin", ...gated, router2);
  app2.use("/api/home", ...gated, router7);
  app2.use("/api/menu", ...gated, requireAccess("cardapio"), router3);
  app2.use("/api/floor", ...gated, router4);
  app2.use("/api/pdv", ...gated, requireAccess("pdv"), router5);
  app2.use("/api/cash", ...gated, requireAccess("pdv"), router6);
  app2.use("/api/customers", ...gated, requireAccess("clientes"), router8);
  app2.use("/api/accounts", ...gated, requireAccess("clientes"), router11);
  app2.use("/api/infinitepay", ...gated, router12);
  app2.use("/api/pos-sales", ...gated, requireAccess("pdv"), router13);
  app2.use("/api/kitchen", ...gated, requireAccess("cozinha"), router9);
  app2.use("/api/stock", ...gated, requireAccess("estoque"), router10);
  app2.use("/api/reports", ...gated, requireAccess("relatorios"), router14);
  app2.use("/api/delivery", ...gated, requireAccess("delivery"), router15);
  app2.use("/api/marketing", ...gated, requireAccess("marketing"), router16);
  app2.use("/api/agent", ...gated, requireAccess("agente"), router17);
  app2.use("/api/reservations", ...gated, requireAccess("salao"), router18);
  app2.use("/api", (_req, _res, next) => next(new HttpError(404, "Rota n\xE3o encontrada", "not_found")));
  app2.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra || {} });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inv\xE1lido", code: "invalid" });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Requisi\xE7\xE3o muito grande", code: "too_large" });
    if (err?.code === "22P02" || err?.code === "22003") return res.status(400).json({ error: "Valor inv\xE1lido", code: "invalid" });
    if (err?.code === "23503") return res.status(400).json({ error: "Refer\xEAncia inv\xE1lida", code: "invalid_reference" });
    console.error(JSON.stringify({ level: "error", msg: err?.message, path: req.path, method: req.method, code: err?.code }));
    res.status(500).json({ error: "Erro interno. Tente novamente.", code: "internal" });
  });
  return app2;
}
var isMain = !env.EDGE_RUNTIME && process.argv[1] && fileURLToPath2(import.meta.url) === path2.resolve(process.argv[1]);
if (isMain) {
  const port = Number(env.PORT || 3001);
  await migrate();
  createApp().listen(port, () => console.log(`RUSTEN API na porta ${port}`));
  setInterval(() => flushOutbox().catch(() => {
  }), 6e4).unref();
}

// src/edge.js
var ready = null;
var app = express2();
app.use(async (_req, res, next) => {
  try {
    ready ??= migrate({ log: (m) => console.log(`[migrate] ${m}`) }).catch((e) => {
      ready = null;
      throw e;
    });
    await ready;
    next();
  } catch (e) {
    console.error("[boot]", e.message);
    res.status(503).json({ error: "Servi\xE7o iniciando. Tente novamente em instantes." });
  }
});
app.use(env.PATH_PREFIX, createApp());
app.listen(8e3);
