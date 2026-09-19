import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 moved the connection URL out of schema.prisma and into this file.
// The sqlite path is relative to the schema's directory (prisma/).
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: { path: path.join("prisma", "migrations") },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
