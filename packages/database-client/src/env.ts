import dotenv from "dotenv";
import { z } from "zod";

// Load .env into process.env (does not override vars already set, e.g. in prod)
//dotenv.config();

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    DB_HOST: z.string().min(1).default("localhost"),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().min(1),
    DB_SSLMODE: z.enum(["disable", "require", "verify-full"]).default("disable"),
  })
  .transform((e) => {
    const user = encodeURIComponent(e.DB_USER);
    const password = encodeURIComponent(e.DB_PASSWORD);
    const databaseUrl =
      `postgresql://${user}:${password}@${e.DB_HOST}:${e.DB_PORT}/` +
      `${encodeURIComponent(e.DB_NAME)}?sslmode=${e.DB_SSLMODE}`;

    return {
      ...e,
      databaseUrl,
      // Ready to spread into `new Pool(...)` from node-postgres
      pg: {
        host: e.DB_HOST,
        port: e.DB_PORT,
        user: e.DB_USER,
        password: e.DB_PASSWORD,
        database: e.DB_NAME,
        ssl:
          e.DB_SSLMODE === "disable"
            ? false
            : { rejectUnauthorized: e.DB_SSLMODE === "verify-full" },
      },
    };
  });

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    // Never print values here — they may include secrets
    console.error(`Invalid environment configuration:\n${lines.join("\n")}`);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
