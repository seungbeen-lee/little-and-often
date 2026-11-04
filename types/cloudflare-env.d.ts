// Keep Worker types scoped: globally loading them overwrites browser DOM types
// such as Element.append and Response.json in this shared client/server project.
// D1's globals are also used by drizzle-orm's public declarations.
type D1Database = import("@cloudflare/workers-types").D1Database;
type D1Result<T = Record<string, unknown>> = import("@cloudflare/workers-types").D1Result<T>;

declare module "cloudflare:workers" {
  // Bindings supplied by Sites (.openai/hosting.json), never browser variables.
  export const env: {
    DB: import("@cloudflare/workers-types").D1Database;
    UPLOADS: import("@cloudflare/workers-types").R2Bucket;
    OPENAI_API_KEY?: string;
  };
}
