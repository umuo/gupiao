declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    APP_ENCRYPTION_KEY?: string;
    CRON_SECRET?: string;
  };
}
