import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(() => {
  return {
    test: {
      poolOptions: {
        workers: {
          main: "./src/index.ts",
          wrangler: { configPath: "./wrangler.toml" },
        },
      },
    },
  };
});
