declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SITE_OWNER_ACCOUNT_USER_ID?: string;
    SITE_OWNER_EMAIL?: string;
    SITE_AGENT_WRITE_HASH?: string;
  }
}
