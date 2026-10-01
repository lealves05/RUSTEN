-- Reverte 003: remove os módulos (clientes, KDS, estoque, delivery, marketing, agente). Apaga os dados desses módulos.
drop table if exists conversation_messages, conversations, company_secrets, reservations, campaign_recipients, campaigns,
  delivery_events, delivery_orders, inventory_counts, purchase_lines, purchases, stock_movements, recipe_lines, recipes,
  kitchen_events, reviews, loyalty_ledger cascade;
drop function if exists stock_immutable();
alter table modifier_options drop column if exists stock_item_id, drop column if exists stock_qty;
alter table products drop constraint if exists products_stock_mode_chk, drop constraint if exists products_stock_item_fk,
  drop column if exists stock_mode, drop column if exists stock_item_id;
drop table if exists stock_items cascade;
alter table consumption_sessions drop constraint if exists consumption_sessions_customer_fk, drop column if exists customer_id,
  drop column if exists delivery_fee_cents;
delete from order_items where launch_mode = 'delivery';
alter table consumption_sessions drop constraint if exists consumption_sessions_kind_check;
alter table consumption_sessions add constraint consumption_sessions_kind_check check (kind in ('comanda','mesa','balcao','retirada'));
alter table order_items drop constraint if exists order_items_launch_mode_check;
alter table order_items add constraint order_items_launch_mode_check check (launch_mode in ('manual','continua','dupla','excecao','balcao'));
alter table order_items drop column if exists priority, drop column if exists accepted_at, drop column if exists ready_at,
  drop column if exists delivered_at, drop column if exists cancel_ack_at, drop column if exists sent_at;
alter table production_sectors drop column if exists target_minutes;
drop table if exists customers cascade;
drop index if exists companies_slug_uq;
alter table companies drop column if exists slug;
delete from schema_migrations where name = '003_modulos.sql';
