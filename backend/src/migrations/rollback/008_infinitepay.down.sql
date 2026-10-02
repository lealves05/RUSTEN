drop trigger if exists companies_purge_infinitepay on companies;
drop function if exists purge_infinitepay();
drop table if exists infinitepay_events;
drop table if exists infinitepay_charges;
delete from schema_migrations where name = '008_infinitepay.sql';
