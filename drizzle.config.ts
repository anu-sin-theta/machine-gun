import { defineConfig } from "drizzle-kit";
import { databaseUrlFrom } from "./src/config/database-url";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/adapters/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrlFrom(process.env) ?? "" },
});
