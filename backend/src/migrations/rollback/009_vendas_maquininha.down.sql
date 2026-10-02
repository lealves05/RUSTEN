drop trigger if exists companies_purge_pos_sales on companies;
drop function if exists purge_pos_sales();
drop table if exists pos_sales_days;
drop table if exists pos_sales_imports;
drop function if exists pos_sales_imports_guard();
drop function if exists pos_sales_days_guard();
delete from schema_migrations where name = '009_vendas_maquininha.sql';
