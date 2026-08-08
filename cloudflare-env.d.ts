declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    APP_ENCRYPTION_KEY?: string;
    CRON_SECRET?: string;
    DEFAULT_ADMIN_EMAIL?: string;
    DEFAULT_ADMIN_NAME?: string;
    DEFAULT_ADMIN_PASSWORD?: string;
  };
}
