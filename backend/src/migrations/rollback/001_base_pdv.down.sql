-- Reverte 001_base_pdv. APAGA todos os dados do RUSTEN: use só em clone/homologação ou após backup (pg_dump).
drop table if exists platform_outbox, platform_nonces, rate_limits, manager_authorizations, payments,
  cash_movements, cash_sessions, order_items, consumption_sessions, tab_cards, dining_tables,
  modifier_options, modifier_groups, scan_codes, product_price_history, products, categories,
  production_sectors, audit_events, terminals, user_sessions, users, roles, units, companies cascade;
drop function if exists audit_immutable();
delete from schema_migrations where name = '001_base_pdv.sql';
