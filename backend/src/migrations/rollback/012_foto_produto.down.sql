-- Desfaz 012.
alter table products drop column if exists photo_updated_at;
alter table products drop column if exists photo;
