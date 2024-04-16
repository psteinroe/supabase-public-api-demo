import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SchemaIssue, array, object, parse, string, uuid } from "valibot";

import app, { Bindings } from "../src";
import { TestContext, createTestContext } from "./test-utils";
import { TEST_ENV } from "./test-env";

const envSchema = object({
  SUPABASE_URL: string(),
  SUPABASE_JWT_SECRET: string(),
  SUPABASE_ANON_KEY: string(),
  SUPABASE_SERVICE_KEY: string(),
});

const ENV = parse(envSchema, TEST_ENV);

const MOCK_ENV: Bindings = {
  SUPABASE_URL: ENV.SUPABASE_URL,
  SUPABASE_JWT_SECRET: ENV.SUPABASE_JWT_SECRET,
  SUPABASE_ANON_KEY: ENV.SUPABASE_ANON_KEY,
};

const contactSchema = object({
  id: string([uuid()]),
  full_name: string(),
});

const contactsResponseSchema = array(contactSchema);

describe("public api", () => {
  let testContext: TestContext;

  beforeAll(async () => {
    testContext = await createTestContext({
      SUPABASE_URL: MOCK_ENV.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: ENV.SUPABASE_SERVICE_KEY,
    });
  });

  afterAll(async () => {
    if (testContext) {
      await testContext.destroy();
    }
  });

  it("cannot query any other table", async () => {
    const response = await app.request(
      "/organisation?full_name=eq.test",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${testContext.apiKey}`,
        },
      },
      MOCK_ENV,
    );
    const data = await response.json<SchemaIssue>();
    expect(data.issues).toBeDefined();
    expect(data.issues).toHaveLength(1);
  });

  describe("/contact", async () => {
    it("POST /contact", async () => {
      const insertResponse = await app.request(
        "/contact?select=id,full_name",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${testContext.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            full_name: `Test Contact ${testContext.ctr}`,
          }),
        },
        MOCK_ENV,
      );
      expect(insertResponse.status).toBe(201);
      const insertedContacts = parse(
        contactsResponseSchema,
        await insertResponse.json(),
      );
      expect(insertedContacts).toHaveLength(1);
      expect(insertedContacts[0].full_name).toEqual(
        `Test Contact ${testContext.ctr}`,
      );
    });

    it("PATCH /contact", async () => {
      const response = await app.request(
        `/contact?select=id,full_name&full_name=eq.Test Contact ${testContext.ctr}`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${testContext.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            full_name: `Test Contact Updated ${testContext.ctr}`,
          }),
        },
        MOCK_ENV,
      );
      expect(response.status).toBe(200);
      const contacts = parse(contactsResponseSchema, await response.json());
      expect(contacts).toHaveLength(1);
      expect(contacts[0].full_name).toEqual(
        `Test Contact Updated ${testContext.ctr}`,
      );
    });

    it("GET /contact", async () => {
      const response = await app.request(
        "/contact?select=id,full_name&full_name=eq.Test%20Contact%20Updated%20" +
          testContext.ctr,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${testContext.apiKey}`,
          },
        },
        MOCK_ENV,
      );
      expect(response.status).toBe(200);
      const contacts = parse(contactsResponseSchema, await response.json());
      expect(contacts).toHaveLength(1);
      expect(contacts[0].full_name).toEqual(
        `Test Contact Updated ${testContext.ctr}`,
      );
    });

    it("DELETE /contact", async () => {
      const response = await app.request(
        "/contact?select=id,full_name&full_name=eq.Test%20Contact%20Updated%20" +
          testContext.ctr,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${testContext.apiKey}`,
          },
        },
        MOCK_ENV,
      );
      expect(response.status).toBe(200);
      const contacts = parse(contactsResponseSchema, await response.json());
      expect(contacts).toHaveLength(1);
      expect(contacts[0].full_name).toEqual(
        `Test Contact Updated ${testContext.ctr}`,
      );

      const { data } = await testContext.serviceClient
        .from("contact")
        .select("*")
        .eq("id", contacts[0].id)
        .maybeSingle()
        .throwOnError();

      expect(data).toBeNull();
    });
  });
});
