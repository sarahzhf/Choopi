-- =====================================================================
-- Nous Deux : schéma de la base Supabase
-- À coller en entier dans Supabase > SQL Editor, puis "Run".
-- Remplace les deux adresses e-mail en bas du fichier AVANT de lancer.
-- =====================================================================

-- 1. Les deux membres du couple (seules ces adresses peuvent se connecter)
create table if not exists public.members (
  email        text primary key,
  user_id      uuid unique references auth.users(id) on delete set null,
  display_name text,
  created_at   timestamptz not null default now()
);

-- 2. Toutes les données de l'appli (rappels, listes, messages, questions...)
--    Chaque ligne = un document JSON rangé dans une "collection".
create table if not exists public.docs (
  coll       text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  created_by uuid        default auth.uid(),
  updated_by uuid        default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
create index if not exists docs_coll_idx on public.docs (coll);

-- 3. Les abonnements aux notifications push (un par téléphone)
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sub        jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------

-- Est-ce que la personne connectée fait partie du couple ?
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- À la première connexion, on relie l'adresse e-mail au compte.
create or replace function public.claim_member() returns json
language plpgsql security definer set search_path = public as $$
declare r public.members;
begin
  update public.members
     set user_id = auth.uid()
   where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  returning * into r;
  if r.email is null then
    raise exception 'not_a_member';
  end if;
  return json_build_object('email', r.email, 'user_id', r.user_id, 'display_name', r.display_name);
end $$;

-- Avant d'envoyer le code de connexion : cette adresse fait-elle partie du couple ?
create or replace function public.can_login(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where lower(email) = lower(trim(p_email)));
$$;
grant execute on function public.can_login(text) to anon, authenticated;

-- Fusionne quelques champs dans un document (équivalent de "update").
create or replace function public.merge_doc(p_coll text, p_id text, p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare d jsonb;
begin
  update public.docs
     set data = data || p_patch, updated_by = auth.uid(), updated_at = now()
   where coll = p_coll and id = p_id
  returning data into d;
  if d is null then raise exception 'not_found'; end if;
  return d;
end $$;

-- Garde updated_at et updated_by à jour à chaque écriture.
create or replace function public.touch_doc() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs
  for each row execute function public.touch_doc();

-- ---------------------------------------------------------------------
-- Règles d'accès : seuls les deux membres voient et modifient les données
-- ---------------------------------------------------------------------
alter table public.members   enable row level security;
alter table public.docs      enable row level security;
alter table public.push_subs enable row level security;

drop policy if exists "members read"  on public.members;
create policy "members read" on public.members for select using (public.is_member());

drop policy if exists "docs all" on public.docs;
create policy "docs all" on public.docs for all using (public.is_member()) with check (public.is_member());

drop policy if exists "push own" on public.push_subs;
create policy "push own" on public.push_subs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

-- ---------------------------------------------------------------------
-- Temps réel : la synchro instantanée entre vos deux téléphones
-- ---------------------------------------------------------------------
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Photos : un espace de stockage privé "photos"
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "photos read"   on storage.objects;
drop policy if exists "photos write"  on storage.objects;
drop policy if exists "photos delete" on storage.objects;
create policy "photos read"   on storage.objects for select using (bucket_id = 'photos' and public.is_member());
create policy "photos write"  on storage.objects for insert with check (bucket_id = 'photos' and public.is_member());
create policy "photos delete" on storage.objects for delete using (bucket_id = 'photos' and public.is_member());

-- Inviter son partenaire depuis l'appli (2 personnes maximum)
create or replace function public.invite_partner(p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not public.is_member() then raise exception 'not_a_member'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  if exists (select 1 from public.members where lower(email) = e) then return true; end if;
  if (select count(*) from public.members) >= 2 then raise exception 'couple_full'; end if;
  insert into public.members (email) values (e);
  return true;
end $$;
grant execute on function public.invite_partner(text) to authenticated;

-- TON ADRESSE : remplace-la avant de lancer (ton partenaire, tu l'inviteras depuis l'appli)
insert into public.members (email, display_name) values
  ('ton.adresse@exemple.com', 'Sarah')
on conflict (email) do update set display_name = excluded.display_name;
