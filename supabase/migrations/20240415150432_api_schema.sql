create schema api;

grant usage on schema api to postgres, anon, authenticated, service_role, tokenauthed;
alter default privileges in schema private grant all on tables to postgres, anon, authenticated, service_role, tokenauthed;
alter default privileges in schema private grant all on functions to postgres, anon, authenticated, service_role, tokenauthed;
alter default privileges in schema private grant all on sequences to postgres, anon, authenticated, service_role, tokenauthed;

create view api.contact with (security_invoker) as
select id, full_name
from contact
where organisation_id = private.organisation_id();
