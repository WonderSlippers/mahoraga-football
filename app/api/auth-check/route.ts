import { env } from "cloudflare:workers";

export async function GET(request: Request) {
  const configured = Boolean(env.SITE_OWNER_ACCOUNT_USER_ID || env.SITE_OWNER_EMAIL);
  const caller = request.headers.get("oai-authenticated-user-id");
  const callerEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  const ownerEmail = env.SITE_OWNER_EMAIL?.trim().toLowerCase();
  const idMatch = Boolean(caller && caller === env.SITE_OWNER_ACCOUNT_USER_ID);
  const emailMatch = Boolean(callerEmail && ownerEmail && callerEmail === ownerEmail);
  const owner = idMatch || emailMatch;
  console.info("site_owner_identity_probe", { configured, identityPresent: Boolean(caller), emailPresent: Boolean(callerEmail), idMatch, emailMatch, owner });
  return Response.json({ configured, identityPresent: Boolean(caller), emailPresent: Boolean(callerEmail), owner }, { headers: { "cache-control": "no-store" } });
}
