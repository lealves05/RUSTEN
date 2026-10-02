-- RUSTEN — 007: "Esqueci minha senha" com link de uso único enviado pela central (remetente da plataforma).
-- Rollback: migrations/rollback/007_redefinir_senha.down.sql
create table if not exists password_resets (
  id          bigserial primary key,
  user_id     bigint not null references users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists password_resets_user_idx on password_resets (user_id, created_at desc);
