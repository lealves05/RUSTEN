-- Reverte 002 (apaga antes as demonstrações, que só existem por causa desta migração)
do $$ declare r record; begin
  for r in select id from companies where is_demo loop perform purge_demo_company(r.id); end loop;
end $$;
drop function if exists purge_demo_company(bigint);
create or replace function audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'auditoria é somente inclusão';
end $$;
drop table if exists platform_config;
drop table if exists system_settings;
drop index if exists companies_demo_idx;
alter table companies drop column if exists is_demo;
delete from schema_migrations where name = '002_central_demo.sql';
