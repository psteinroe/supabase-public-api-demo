create schema private;

grant usage on schema private to postgres, anon, authenticated, service_role;
alter default privileges in schema private grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema private grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema private grant all on sequences to postgres, anon, authenticated, service_role;

create or replace function private.organisation_id() returns uuid as
$$
select gen_random_uuid();
$$ language sql stable security definer;

create table organisation
(
  id          uuid primary key         not null default gen_random_uuid(),
  name        text unique              not null
);

alter table organisation enable row level security;

create policy employee_all on organisation to authenticated using (
    (select private.organisation_id()) = id
);

create table employee
(
  id              uuid primary key         not null default gen_random_uuid(),
  organisation_id uuid                     not null references organisation on update restrict on delete cascade default private.organisation_id(),
  user_id         uuid unique references auth.users on update restrict on delete cascade
);

alter table employee enable row level security;

create policy employee_all on employee to authenticated using (
    (select private.organisation_id()) = organisation_id
);

alter table employee enable row level security;

create or replace function private.organisation_id() returns uuid as
$$
select organisation_id from employee where user_id = auth.uid()
$$ language sql stable security definer;

create table contact
(
  id              uuid primary key         not null                                                  default gen_random_uuid(),
  organisation_id uuid                     not null references organisation on delete cascade default private.organisation_id(),
  full_name       text
);

alter table contact enable row level security;

create policy employee_all on contact to authenticated using (
    (select private.organisation_id()) = organisation_id
);

-- setup slides with https://sli.dev/guide/
