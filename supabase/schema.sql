-- ParTrack Supabase setup
-- Run this in the Supabase SQL editor before deploying a build with env vars.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  state text,
  country text default 'US',
  latitude numeric,
  longitude numeric,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_public_unverified boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.tees (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  gender text,
  par int,
  rating numeric,
  slope int,
  yardage int,
  holes jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id),
  tee_id uuid references public.tees(id),
  played_at date not null,
  gross_score int,
  adjusted_gross_score int,
  differential numeric,
  pcc numeric default 0,
  holes jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz default now()
);

create index if not exists courses_status_idx on public.courses(status);
create index if not exists courses_created_by_idx on public.courses(created_by);
create index if not exists tees_course_id_idx on public.tees(course_id);
create index if not exists rounds_user_id_idx on public.rounds(user_id);
create index if not exists rounds_played_at_idx on public.rounds(played_at);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists courses_touch_updated_at on public.courses;
create trigger courses_touch_updated_at
before update on public.courses
for each row execute function public.touch_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

create or replace function public.can_read_course(course_row public.courses)
returns boolean
language sql
stable
as $$
  select
    course_row.status = 'approved'
    or (
      course_row.status = 'pending'
      and (
        course_row.created_by = auth.uid()
        or course_row.is_public_unverified = true
      )
    )
    or public.is_admin();
$$;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.tees enable row level security;
alter table public.rounds enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles for insert
with check (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Readable approved and visible courses" on public.courses;
create policy "Readable approved and visible courses"
on public.courses for select
using (public.can_read_course(courses));

drop policy if exists "Users insert pending own courses" on public.courses;
create policy "Users insert pending own courses"
on public.courses for insert
with check (
  auth.uid() is not null
  and created_by = auth.uid()
  and status = 'pending'
);

drop policy if exists "Users edit own pending courses" on public.courses;
create policy "Users edit own pending courses"
on public.courses for update
using (created_by = auth.uid() and status = 'pending')
with check (created_by = auth.uid() and status = 'pending');

drop policy if exists "Users delete own pending courses" on public.courses;
create policy "Users delete own pending courses"
on public.courses for delete
using (created_by = auth.uid() and status = 'pending');

drop policy if exists "Admins manage courses" on public.courses;
create policy "Admins manage courses"
on public.courses for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users read tees for readable courses" on public.tees;
create policy "Users read tees for readable courses"
on public.tees for select
using (
  exists (
    select 1 from public.courses
    where courses.id = tees.course_id
    and public.can_read_course(courses)
  )
);

drop policy if exists "Users add tees to own pending courses" on public.tees;
create policy "Users add tees to own pending courses"
on public.tees for insert
with check (
  exists (
    select 1 from public.courses
    where courses.id = tees.course_id
    and courses.created_by = auth.uid()
    and courses.status = 'pending'
  )
);

drop policy if exists "Users edit tees on own pending courses" on public.tees;
create policy "Users edit tees on own pending courses"
on public.tees for update
using (
  exists (
    select 1 from public.courses
    where courses.id = tees.course_id
    and courses.created_by = auth.uid()
    and courses.status = 'pending'
  )
)
with check (
  exists (
    select 1 from public.courses
    where courses.id = tees.course_id
    and courses.created_by = auth.uid()
    and courses.status = 'pending'
  )
);

drop policy if exists "Users delete tees on own pending courses" on public.tees;
create policy "Users delete tees on own pending courses"
on public.tees for delete
using (
  exists (
    select 1 from public.courses
    where courses.id = tees.course_id
    and courses.created_by = auth.uid()
    and courses.status = 'pending'
  )
);

drop policy if exists "Admins manage tees" on public.tees;
create policy "Admins manage tees"
on public.tees for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users read own rounds" on public.rounds;
create policy "Users read own rounds"
on public.rounds for select
using (user_id = auth.uid());

drop policy if exists "Users insert own rounds on readable courses" on public.rounds;
create policy "Users insert own rounds on readable courses"
on public.rounds for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.tees
    join public.courses on courses.id = tees.course_id
    where tees.id = rounds.tee_id
    and courses.id = rounds.course_id
    and public.can_read_course(courses)
  )
);

drop policy if exists "Users update own rounds" on public.rounds;
create policy "Users update own rounds"
on public.rounds for update
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.tees
    join public.courses on courses.id = tees.course_id
    where tees.id = rounds.tee_id
    and courses.id = rounds.course_id
    and public.can_read_course(courses)
  )
);

drop policy if exists "Users delete own rounds" on public.rounds;
create policy "Users delete own rounds"
on public.rounds for delete
using (user_id = auth.uid());
