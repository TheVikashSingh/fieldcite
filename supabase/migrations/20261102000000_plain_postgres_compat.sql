-- Lets the migrations run on plain Postgres (CI, local Docker) as well as on Supabase.
-- On Supabase every object below already exists, so each step is skipped.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Same behaviour as Supabase's auth.uid(): the JWT subject of the current request, or null.
do $$
begin
  if to_regprocedure('auth.uid()') is null then
    create function auth.uid() returns uuid
      language sql stable
      as $fn$
        select nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
          ),
          ''
        )::uuid
      $fn$;
  end if;
end
$$;
