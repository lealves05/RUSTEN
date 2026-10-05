-- Desfaz 011.
drop index if exists purchases_supplier_doc_idx;
alter table purchases drop column if exists supplier_doc;
