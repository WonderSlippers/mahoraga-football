import { readLedger, writeLedger, writeLedgerIfUnchanged } from "@/db/ledger";
import { ownerWriteDenied } from "@/lib/site-owner";
import { validateLedgerWrite } from "@/lib/ledger-write-policy";
import { readTextLimited } from "@/lib/limited-response";

const MAX_PAYLOAD_BYTES = 1_500_000;

export async function GET() {
  try {
    return Response.json({ ok: true, ledger: await readLedger() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("ledger_read_failed", error);
    return Response.json({ ok: false, error: "账本暂时不可用" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = await ownerWriteDenied(request); if (denied) return denied;
  try {
    const raw = await readTextLimited(request, MAX_PAYLOAD_BYTES);
    const body = JSON.parse(raw) as { state?: unknown; settings?: unknown; updatedAt?: number; baseUpdatedAt?: number };
    if (!body || typeof body !== "object" || !body.state || !body.settings) {
      return Response.json({ ok: false, error: "账本格式无效" }, { status: 400 });
    }
    const updatedAt = Number.isFinite(Number(body.updatedAt)) ? Number(body.updatedAt) : Date.now();
    const current = await readLedger();
    const baseUpdatedAt = Number(body.baseUpdatedAt) || 0;
    if (current && current.updatedAt > baseUpdatedAt) {
      return Response.json({ ok: false, conflict: true, ledger: current }, { status: 409 });
    }
    const invalid = validateLedgerWrite(current, body);
    if (invalid) return Response.json({ ok: false, error: invalid }, { status: 422 });
    const value = { state: body.state, settings: body.settings, updatedAt };
    if (current) {
      if (!await writeLedgerIfUnchanged(value, current.updatedAt)) {
        return Response.json({ ok: false, conflict: true, ledger: await readLedger() }, { status: 409 });
      }
    } else await writeLedger(value);
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    if (error instanceof RangeError) return Response.json({ ok: false, error: "账本数据过大" }, { status: 413 });
    console.error("ledger_write_failed", error);
    return Response.json({ ok: false, error: "账本保存失败" }, { status: 503 });
  }
}
