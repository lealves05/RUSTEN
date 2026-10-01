-- Remove a conta do cliente. Pagamentos "fiado"/"saldo_cliente" já gravados continuam no histórico de recebimentos.
drop trigger if exists customers_purge_account on customers;
drop function if exists purge_customer_account();
drop table if exists customer_account;
drop function if exists customer_account_immutable();
alter table customers drop column if exists fiado_limit_cents;
delete from schema_migrations where name = '006_conta_cliente.sql';
