drop table if exists stock_aliases;
drop index if exists purchases_nfe_key_uq;
alter table purchases drop column if exists nfe_key, drop column if exists source;
delete from schema_migrations where name = '004_leitura_notas.sql';
