import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { object, picklist } from "valibot";
import { vValidator } from "@hono/valibot-validator";

const TABLES = ["contact"];

const paramsSchema = object({
  table: picklist(TABLES),
});

export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_JWT_SECRET: string;
  SUPABASE_ANON_KEY: string;
};

type Env = {
  Bindings: Bindings;
};

const app = new Hono<Env>();

app.use((c, next) => {
  const jwtMiddleware = jwt({
    secret: c.env.SUPABASE_JWT_SECRET,
    alg: "HS256",
  });
  return jwtMiddleware(c, next);
});

app.all(
  "/:table",
  vValidator<typeof paramsSchema, "param", Env, any>("param", paramsSchema),
  async (c) => {
    const searchParams =
      c.req.url.indexOf("?") > -1
        ? c.req.url.slice(c.req.url.indexOf("?"))
        : "";

    const upstreamUrl = `${c.env.SUPABASE_URL}/rest/v1/${c.req.param("table")}${searchParams}`;

    const newRequest = new Request(upstreamUrl, c.req.raw);
    newRequest.headers.set("apiKey", c.env.SUPABASE_ANON_KEY);
    if (["GET", "HEAD"].includes(c.req.method)) {
      newRequest.headers.set("Accept-Profile", "api");
    } else {
      newRequest.headers.set("Content-Profile", "api");
    }
    if (c.req.query("select")) {
      newRequest.headers.set(
        "Prefer",
        [c.req.header("Prefer"), "return=representation"]
          .filter(Boolean)
          .join(","),
      );
    }
    const res = await fetch(newRequest);
    const newResponse = new Response(res.body, res);
    return newResponse;
  },
);

export default app;
