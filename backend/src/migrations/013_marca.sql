-- RUSTEN — 013: marca do estabelecimento (logotipo e imagens de fundo do sistema e da TV).
-- Imagens reduzidas no navegador e guardadas como data URL (PNG/JPEG/WebP; nunca SVG). Uma por tipo e empresa.
-- Rollback: migrations/rollback/013_marca.down.sql
create table if not exists company_assets (
  company_id  bigint not null references companies(id) on delete cascade,
  kind        text not null check (kind in ('logo', 'fundo', 'tv_fundo')),
  data_url    text not null,
  bytes       int not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, kind)
);
