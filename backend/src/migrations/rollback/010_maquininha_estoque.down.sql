drop trigger if exists companies_purge_pos_items on companies;
drop function if exists purge_pos_sales_items();
drop trigger if exists pos_sales_items_guard on pos_sales_items;
drop function if exists pos_sales_items_guard();
drop index if exists stock_mov_pos_uq;
drop table if exists pos_product_aliases;
drop table if exists pos_sales_items;
delete from schema_migrations where name = '010_maquininha_estoque.sql';
