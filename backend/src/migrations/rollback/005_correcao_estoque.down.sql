-- Remove a tabela de pedidos de correção. Os movimentos do tipo 'correcao' já gravados continuam no histórico
-- (movimentos são imutáveis), por isso a restrição de tipos continua aceitando 'correcao'.
drop table if exists stock_corrections;
drop function if exists stock_corr_guard();
delete from schema_migrations where name = '005_correcao_estoque.sql';
