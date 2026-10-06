-- RUSTEN — 012: foto opcional do produto (cardápio digital). Só adiciona colunas; produtos existentes ficam sem foto.
-- A imagem fica no próprio banco (data URL já reduzida no navegador, até ~300 KB) e é servida por /api/public/:slug/foto/:id.
-- Rollback: migrations/rollback/012_foto_produto.down.sql
alter table products add column if not exists photo text;
alter table products add column if not exists photo_updated_at timestamptz;
