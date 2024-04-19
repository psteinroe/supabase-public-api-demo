# How To Build A Public API with Supabase in 10 Minutes

Building with Supabase means most likely you are not buildig your API yourself thanks to PostgREST and the GraphQL extension. But what if your customers want a public API to integrate with your product? Instead of building your own API server from scratch, you can leverage Postgres + PostgREST to build a public API in minutes. This blog post walks you through the required steps.

## The Database Schema

First we create a sample schema. In this case, we create an `organisation` table. Each organisation has employees. We also have a `contact` table that we want to expose in our public API.

```sql
create table organisation
(
  id uuid primary key not null default gen_random_uuid(),
  name text unique not null
);

create table employee
(
  id uuid primary key not null default gen_random_uuid(),
  organisation_id uuid not null references organisation on update restrict on delete cascade default private.organisation_id(),
  user_id uuid unique references auth.users on update restrict on delete cascade
);

-- we want to expose this in our public api!
create table contact
(
  id uuid primary key not null default gen_random_uuid(),
  organisation_id uuid not null references organisation on delete cascade default private.organisation_id(),
  full_name text
);
```

We use Row-Level-Security to secure our data and make it accessible only if the user is authenticated and employee of the organisation. The `private.organisation_id()` function is a little helper function that returns the `organisation_id` of the authenticated user, if any.

```sql
create or replace function private.organisation_id() returns uuid as
$sql$
select organisation_id from employee where user_id = auth.uid()
$sql$ language sql stable security definer;

create policy employee_all on organisation to authenticated using (
    (select private.organisation_id()) = id
);

create policy employee_all on employee to authenticated using (
    (select private.organisation_id()) = organisation_id
);

create policy employee_all on contact to authenticated using (
    (select private.organisation_id()) = organisation_id
);
```

## Setup API Tokens

We will manage and create api tokens right within our database, and use Row-Level-Security to define what the api token can do. The first step is to create a role `tokenauthed` that can be used to authenticate with the database. It should behave like the `authenticated` role.

```sql
create role tokenauthed;
grant tokenauthed to authenticator;
grant anon to tokenauthed;
```

## Create the API Token Table

We store references to api tokens in a table. Note that the key itself is not stored. Employees should be able to manage tokens.

```sql
create table if not exists api_token
(
  id              uuid primary key         not null                                                  default gen_random_uuid(),
  organisation_id uuid                     not null references organisation on delete cascade default private.organisation_id(),
  created_at      timestamp with time zone not null                                                  default now(),
  name            text                     not null
);

alter table api_token enable row level security;

create policy employee_all on api_token to authenticated using (
    (select private.organisation_id()) = organisation_id
);
```

## Allow users to actually create a token

To actually create the api tokens we need to mint our own jwt tokens. We will use the `pgjwt` extension for this. Luckily, its ready to install on our Supabase instance.

```sql
create extension if not exists "pgjwt" with schema "extensions";
```

The `create_api_token` function inserts an api token into the database, and then signs a jwt token with id of the token and the organisation id in the payload. There are a few notable things here. First, live supabase instances store the jwt_secret in the `app.settings.jwt_secret` variable. >ou can run `show app.settings.jwt_secret;` in the Supabase SQL editor for your project to prove this for yourself. The jwt secret for local development with the [Supabase CLI](https://supabase.com/docs/guides/local-development) has the constant value "super-secret-jwt-token-with-at-least-32-characters-long" as an undocumented "feature". You might notice that the token is always valid forever for now. We will fix that at a later stage. And we use `HS256`, because its the same algorithm Supabase auth uses.

```sql
create or replace function create_api_token (organisation_id uuid, name text)
returns text as $token$
declare
  token_id uuid;
  jwt_secret text := coalesce(
    nullif(current_setting('app.settings.jwt_secret', true), ''),
    'super-secret-jwt-token-with-at-least-32-characters-long'
  );
begin
  insert into api_token (organisation_id, name) values (organisation_id, name)
  returning id into token_id;
  return extensions.sign(json_build_object(
      'tid', token_id, 'iss', 'supabase', 'sub', organisation_id,
      'role', 'tokenauthed', 'iat', trunc((extract(epoch from Now()))::numeric, 0)
    ),
    jwt_secret::text,
    'HS256'::text
  );
end;
$token$ security invoker language plpgsql;
```

## Update Row-Level-Security Policies

First, we add a function to extract the `tid` from the jwt token, similar to `auth.uid()`.

```sql
create or replace function private.tid ()
  returns uuid language 'sql' stable
  as $body$
  select coalesce(
    nullif (current_setting('request.jwt.claim.tid', true), ''),
    (nullif (current_setting('request.jwt.claims', true), '')::jsonb ->> 'tid')
  )::uuid
$body$;
```

We then update `private.organisation_id()` to return the `organisation_id` from the jwt payload when the role is `tokenauthed`.

```sql
create or replace function private.organisation_id() returns uuid as
$sql$
  select (
    case
        when auth.role() = 'authenticated'
            then (select organisation_id from employee where user_id = auth.uid())
        when auth.role() = 'tokenauthed'
            then (
                select coalesce(
                    nullif (current_setting('request.jwt.claim.sub', true), ''),
                    (nullif (current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
                )::uuid
            )
    end
);
$sql$ language sql stable security definer;
```

Finally, we re-create the Row-Level-Security policy on `contact` to include `tokenauthed`.

```sql
drop policy employee_all on contact;

create policy employee_tokenauthed_all on contact to authenticated, tokenauthed using (
    (select private.organisation_id()) = organisation_id
);
```

## Create the API Schema

To control what tables and columns should be exposed, we create a separate `api` schema. This separates our internal data model from the data model exposed in our public api.

```sql
create schema api;

grant usage on schema api to postgres, anon, authenticated, service_role, tokenauthed;
alter default privileges in schema api grant all on tables to postgres, anon, authenticated, service_role, tokenauthed;
alter default privileges in schema api grant all on functions to postgres, anon, authenticated, service_role, tokenauthed;
alter default privileges in schema api grant all on sequences to postgres, anon, authenticated, service_role, tokenauthed;
```

We now use ["updateable views"](https://www.postgresql.org/docs/current/sql-createview.html) and the `security_invoker` config to expose the `contact`. An updatable view in postgres is a view which allows mutations, because the underlying table can be derived. Thanks to the `security_invoker` config, all operations will respect the Row-Level-Security policy we set on the `contact` table. For better performance, we always filter on the `organisation_id` and therefore mimick the security policy clause. With the view, we can also define what columns should be exposed. This is pretty neat, since most apps will have columns that are internal to the app logic.

```sql
create view api.contact with (security_invoker) as
select id, full_name
from contact
where organisation_id = private.organisation_id();
```

And thats it for the database part. As of now, we have:

- a custom database role
- a function to generate tokens
- helper functions to easily define Row-Level-Security Policies
- a table that is exposed via a custom `api` schema

We could just share our Supabase Rest API endpoint and be done. I would not recommend that. Instead, lets build a little proxy that will give us the possibility to add required security measures such as rate-limiting and observability.

## The Proxy

Our little proxy will be a very simple Cloudflare Worker using Hono. You can choose any framework or platform you want for this though. First, we set up the project.

```shell
bunx create-hono api-proxy
```

## The Route Handler

First, setup a JWT middleware to verify the incoming request. You can find the JWT secret in your Supabase Dashboard.

```ts
const app = new Hono<Env>();

app.use((c, next) => {
  const jwtMiddleware = jwt({
    secret: c.env.SUPABASE_JWT_SECRET,
    alg: "HS256",
  });
  return jwtMiddleware(c, next);
});
```

Now, add a single "catch-all" route that forwards the request to the upstream PostgREST api.

```ts
app.all("/:table", async (c) => {
  const searchParams =
    c.req.url.indexOf("?") > -1 ? c.req.url.slice(c.req.url.indexOf("?")) : "";

  const upstreamUrl = `${c.env.SUPABASE_URL}/rest/v1/${c.req.param("table")}${searchParams}`;

  const newRequest = new Request(upstreamUrl, c.req.raw);
  const res = await fetch(newRequest);
  const newResponse = new Response(res.body, res);
  return newResponse;
});
```

To fail early, you might want to validate the path parameter.

```ts
import { object, picklist } from "valibot";
import { vValidator } from "@hono/valibot-validator";

const TABLES = ["contact"];

const paramsSchema = object({
  table: picklist(TABLES),
});

app.all(
  "/:table",
  vValidator<typeof paramsSchema, "param", Env, any>("param", paramsSchema),
  async (c) => {
    // ...
  },
);
```

For Kong, the API gateway that Supabase uses, to accept your proxied request, we need to set the `apiKey` header to the `anon` key. To target the `api` schema, set the `Accept-Profile` and `Content-Profile` headers.

```ts
app.all(
  "/:table",
  vValidator<typeof paramsSchema, "param", Env, any>("param", paramsSchema),
  async (c) => {
    //  ...
    const newRequest = new Request(upstreamUrl, c.req.raw);
    newRequest.headers.set("apiKey", c.env.SUPABASE_ANON_KEY);
    if (["GET", "HEAD"].includes(c.req.method)) {
      newRequest.headers.set("Accept-Profile", "api");
    } else {
      newRequest.headers.set("Content-Profile", "api");
    }
    // ...
  },
);
```

This is also a great opportunity to change the default behavior of PostgREST. For example, your users might expect that any mutation always returns the mutated row. This can be enabled by default by always adding `return=representation` to the `Prefer` header.

```ts
app.all(
  "/:table",
  vValidator<typeof paramsSchema, "param", Env, any>("param", paramsSchema),
  async (c) => {
    //  ...
    const newRequest = new Request(upstreamUrl, c.req.raw);
    // ...
    if (c.req.query("select")) {
      newRequest.headers.set(
        "Prefer",
        [c.req.header("Prefer"), "return=representation"]
          .filter(Boolean)
          .join(","),
      );
    }
    // ...
  },
);
```

And thats it! From here, you should be able to complete this on your own. To be ready for production, you should add rate-limiting as well as logging and monitoring to your worker.

## Recommendations

Control the statement timeout for your `tokenauthed` role. You are giving your users a lot of power with all the query features that PostgREST offers. To make sure they spend some time optimizing their requests, set the limit to a relatively low value depending on your use case.

```sql
alter role tokenauthed set statement_timeout = '2s';
```

Next, you should make sure that we can invalidate tokens. For now, a token can be invalidated if its reference in the `api_token` table is deleted. We can leverage the `db_pre_request` hook that PostgREST exposes for this. To read more about the Pre-Request feature check out their [documentation](https://postgrest.org/en/v12/references/transactions.html#pre-request). Its basically a middleware within Postgres which we can use to ensure that the token reference in our database still exists.

```sql
create or replace function private.validate_token ()
  returns void
  language 'plpgsql'
  security definer
  as $body$
begin
  -- 1. we should only verify api tokens.
  -- skip check if auth is not done using an api token
  if auth.role () <> 'tokenauthed' then
    return;
  end if;
  -- 2. make sure the token has not been revoked
  if (case when (
    select
      id
    from api_token t
    where
      id = private.tid ()
    ) is not null then false else true end) is true then
    raise sqlstate 'pt401'
    using message = 'unauthorized';
  end if;
end
$body$;

alter role authenticator set pgrst.db_pre_request to 'private.validate_token';
notify pgrst, 'reload config';
```

Finally, we only want to allow `tokenauthed` requests if they were routed through our proxy, so that rate-limiting applies. The simplest way to achieve this is to add a custom secret value to the header in the request.

```ts
app.all(
  "/:table",
  vValidator<typeof paramsSchema, "param", Env, any>("param", paramsSchema),
  async (c) => {
    //  ...
    const newRequest = new Request(upstreamUrl, c.req.raw);
    // ...
    if (c.req.query("select")) {
      newRequest.headers.set("x-proxy-secret", c.env.PROXY_SECRET);
    }
    // ...
  },
);
```

We can check for the existence of this token within the `validate_token` function. Luckily, our Supabase project comes with a built-in Vault, so we do not have to worry about storing our secret key in the database.

```sql
create or replace function private.validate_token ()
  returns void
  language 'plpgsql'
  security definer
  as $body$
begin
  -- 1. we should only verify api tokens.
  -- skip check if auth is not done using an api token
  if auth.role () <> 'tokenauthed' then
    return;
  end if;

  -- 2. Make sure that the request is going through our proxy
  if (select current_setting('request.headers', true)::json ->> 'x-proxy-secret') <> (select decrypted_secret from vault.decrypted_secrets where name = 'proxy_secret') then
    raise sqlstate 'pt401'
    using message = 'unauthorized';
  end if;

  -- 3. make sure the token has not been revoked
  if (case when (
    select
      id
    from api_token t
    where
      id = private.tid ()
    ) is not null then false else true end) is true then
    raise sqlstate 'pt401'
    using message = 'unauthorized';
  end if;
end
$body$;
```

And thats it!

You can find the source code and a demo on [GitHub](https://github.com/psteinroe/supabase-public-api-demo).
