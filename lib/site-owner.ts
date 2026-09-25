import { env } from "cloudflare:workers";
import {isLocalSimulationWrite} from '@/lib/local-origin-policy';

export function isSiteOwner(request: Request): boolean {
  const trustedId = request.headers.get("oai-authenticated-user-id");
  const trustedEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  const ownerEmail = env.SITE_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(
    (trustedId && env.SITE_OWNER_ACCOUNT_USER_ID && trustedId === env.SITE_OWNER_ACCOUNT_USER_ID) ||
    (trustedEmail && ownerEmail && trustedEmail === ownerEmail)
  );
}

async function hasAgentWriteKey(request: Request): Promise<boolean> {
  const key = request.headers.get("x-site-agent-write-key");
  const expected = env.SITE_AGENT_WRITE_HASH;
  if (!key || !expected || key.length > 128) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return hex === expected;
}

export async function ownerWriteDenied(request: Request): Promise<Response | null> {
  const host = new URL(request.url).hostname;
  const origin = request.headers.get("origin");
  // The portable localhost preview has no real ChatGPT identity header. Keep
  // its simulation controls usable without weakening the hosted Site: the
  // mock owner email is only injected by the local preview configuration.
  const localPreviewOwner = (host === "localhost" || host === "127.0.0.1") && env.SITE_OWNER_EMAIL === "seedy@sites.test";
  // The standalone site now runs only on this PC. There is no Sites identity
  // header locally; allow same-origin browser controls and the hidden local
  // scanner, while keeping cross-origin requests and hosted Sites unchanged.
  const localSimulationWrite=isLocalSimulationWrite(request.url,origin);
  const trustedOwner = isSiteOwner(request), agentKey = await hasAgentWriteKey(request), allowed = trustedOwner || localPreviewOwner || localSimulationWrite || agentKey;
  if (!allowed) console.warn("site_owner_write_denied", {
    host,
    identityPresent: Boolean(request.headers.get("oai-authenticated-user-id")),
    emailPresent: Boolean(request.headers.get("oai-authenticated-user-email")),
    ownerEmailConfigured: Boolean(env.SITE_OWNER_EMAIL),
    ownerIdConfigured: Boolean(env.SITE_OWNER_ACCOUNT_USER_ID),
    agentKeyConfigured: Boolean(env.SITE_AGENT_WRITE_HASH),
    originPresent: Boolean(request.headers.get("origin")),
  });
  return allowed
    ? null
    : Response.json({ ok: false, error: "此账号只有浏览权限，不能修改模拟账本或结算" }, { status: 403 });
}
