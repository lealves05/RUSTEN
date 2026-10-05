-- RUSTEN — 011: entrada de compras pelo código de barras (chave da NF-e no DANFE ou pedido de compra impresso pelo RUSTEN).
-- CNPJ do fornecedor guardado na compra para reconhecer o fornecedor pela chave da próxima nota.
-- Rollback: migrations/rollback/011_compras_codigo_barras.down.sql
alter table purchases add column if not exists supplier_doc text;
create index if not exists purchases_supplier_doc_idx on purchases (company_id, supplier_doc) where supplier_doc is not null;
