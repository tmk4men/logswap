-- Migration 0003: add profile fields that the shipped app already collects
-- but the initial (2026-07-02) schema lacked: bio, handle, image2.
alter table public.profiles
  add column if not exists bio         text,
  add column if not exists handle      text,
  add column if not exists image2_path text;

-- bio length safety net (UI limits to ~20; keep generous headroom)
alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len
  check (bio is null or char_length(bio) <= 60);

-- handle format: "@" + [A-Za-z0-9_], 1-30 chars (app-set, immutable)
alter table public.profiles drop constraint if exists profiles_handle_fmt;
alter table public.profiles add constraint profiles_handle_fmt
  check (handle is null or handle ~ '^@[A-Za-z0-9_]{1,30}$');

-- case-insensitive uniqueness of handle (nulls allowed, multiple ok)
create unique index if not exists profiles_handle_lower_key
  on public.profiles (lower(handle)) where handle is not null;
