import { SupabaseClient, createClient } from "@supabase/supabase-js";

export type TestContext = {
  apiKey: string;
  organisationId: string;
  destroy: () => Promise<void>;
  ctr: number;
  serviceClient: SupabaseClient;
};

export const createTestContext = async (env: {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}): Promise<TestContext> => {
  const serviceClient = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_KEY,
  );
  const { count } = await serviceClient
    .from("organisation")
    .select("*", { count: "exact" })
    .like("name", "Test Organisation %")
    .throwOnError();

  const ctr = (count || -1) + 1;

  const { data: organisation } = await serviceClient
    .from("organisation")
    .insert({
      name: `Test Organisation ${ctr}`,
    })
    .select("id")
    .throwOnError()
    .single();

  if (!organisation) {
    // This should never happen
    throw new Error("Setup failed");
  }

  const { data: apiKey } = await serviceClient
    .rpc("create_api_token", {
      organisation_id: organisation.id,
      name: "Test Key",
    })
    .throwOnError();

  if (!apiKey) {
    throw new Error("Setup failed");
  }

  return {
    apiKey,
    organisationId: organisation.id,
    destroy: async () => {
      await serviceClient
        .from("organisation")
        .delete()
        .eq("id", organisation.id);
    },
    ctr,
    serviceClient,
  };
};
