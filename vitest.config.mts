import { defineConfig } from "vitest/config"
import { config as loadEnv } from "dotenv"

loadEnv({ path: "./.env" })

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
})
