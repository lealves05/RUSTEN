-- RUSTEN — 014: exclusão de empresa pedida pela central da plataforma (MASTER do ORBI).
-- Apaga a empresa e tudo o que é dela, em todas as tabelas que têm company_id (lista lida do catálogo, então
-- tabelas novas entram sozinhas). As travas de registros imutáveis (auditoria, estoque, conta do cliente, vendas
-- importadas) só são liberadas para esta empresa e só dentro da transação (rusten.purge_demo = id da empresa).
-- Todas as exclusões rodam num único comando: as referências entre as tabelas da empresa são checadas no fim dele.
-- Rollback: migrations/rollback/014_excluir_empresa.down.sql
create or replace function purge_company(p_company bigint) returns integer language plpgsql as $$
declare
  t record;
  parts text[] := '{}';
  n int := 0;
begin
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'empresa % não encontrada', p_company;
  end if;
  perform set_config('rusten.purge_demo', p_company::text, true);
  delete from user_sessions where user_id in (select id from users where company_id = p_company);
  delete from password_resets where user_id in (select id from users where company_id = p_company);
  for t in
    select c.relname from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
     where ns.nspname = current_schema() and c.relkind in ('r', 'p')
       and c.relname not in ('companies', 'customer_account') -- conta do cliente sai pelo gatilho de customers
     order by c.relname
  loop
    n := n + 1;
    parts := parts || format('d%s as (delete from %I where company_id = $1)', n, t.relname);
  end loop;
  if n > 0 then
    execute 'with ' || array_to_string(parts, ', ') || ' select 1' using p_company;
  end if;
  delete from companies where id = p_company;
  perform set_config('rusten.purge_demo', '', true);
  return n;
end $$;
