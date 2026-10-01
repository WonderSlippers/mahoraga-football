"""Read only the two isolated v2 profiles; never open legacy SQLite."""
import datetime
import hashlib
import json
import pathlib
import re
import sqlite3
from zoneinfo import ZoneInfo

root = pathlib.Path(__file__).resolve().parents[1]
evidence = root / ".runtime-v2/usability"
before = json.loads((evidence / "restart-before.json").read_text(encoding="utf-8-sig"))
now = datetime.datetime.now(datetime.timezone.utc)
report = {"at": now.isoformat(), "mode": "READ_ONLY_OWN_V2_ONLY", "profiles": {}}
tables = {"predictions", "tickets", "ticket_legs", "ledger_entries", "archive_records"}

def digests(row):
    return {
        f"shape={shape};sort={sort};compact={compact};ascii={ascii_only}": hashlib.sha256(
            json.dumps(value, sort_keys=sort, ensure_ascii=ascii_only,
                       separators=(",", ":") if compact else None).encode("utf-8")
        ).hexdigest()
        for shape,value in (("dict",dict(row)),("list",list(row)))
        for sort in (True, False) for compact in (True, False) for ascii_only in (False, True)
    }

for profile, previous in before["profiles"].items():
    database = pathlib.Path(previous["database"]).resolve()
    if profile not in ("research", "demo") or not database.is_relative_to(root / ".runtime-v2" / profile):
        raise RuntimeError("OWN_PROFILE_PATH_REQUIRED")
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("BEGIN")
    current = {"database": str(database), "tables": {}, "quickCheck": connection.execute("PRAGMA quick_check").fetchone()[0]}
    for table, old in previous["tables"].items():
        if table not in tables:
            raise RuntimeError("UNEXPECTED_PROOF_TABLE")
        records = {row["id"]: digests(row) for row in connection.execute("SELECT * FROM " + table)}
        changed = [key for key, expected in old.items() if expected not in records.get(key, {}).values()]
        current["tables"][table] = {"before": len(old), "after": len(records), "originalRowsUnchanged": not changed, "missingOrChangedIds": changed}
    current["run"] = json.loads((root / ".runtime-v2" / profile / "run.json").read_text())
    if profile == "research":
        workspace = connection.execute("SELECT metadataJson FROM workspace_imports ORDER BY importedAt DESC LIMIT 1").fetchone()
        leagues = [x["code"] for x in json.loads(workspace[0]).get("leagues", []) if x["code"] != "jfa.emperors"]
        today = now.astimezone(ZoneInfo("Europe/Berlin")).date()
        dates = [(today + datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(-1, 7)]
        grid = {code + "|" + day for code in leagues for day in dates}
        captures = {}
        for row in connection.execute("SELECT competition,sourceUrl,state,startedAt FROM source_runs WHERE providerId='ESPN_PUBLIC_V1' AND startedAt>? ORDER BY startedAt", (int(now.timestamp()*1000)-86400000,)):
            match = re.search(r"dates=(\d{8})", row["sourceUrl"])
            if match:
                captures[row["competition"] + "|" + match[1]] = {"state": row["state"], "at": row["startedAt"]}
        missing = sorted(grid - captures.keys())
        current["discovery"] = {"configuredLeagues": len(leagues), "dates": dates, "expectedCells": len(grid), "attemptedCells": len(grid)-len(missing), "missingCells": missing, "lastStateCounts": {state: sum(x["state"] == state for k,x in captures.items() if k in grid) for state in {x["state"] for x in captures.values()}}}
        current["pipeline"] = {"jobs": [dict(x) for x in connection.execute("SELECT state,COUNT(*) count FROM jobs GROUP BY state")], "lastSourceCaptureAt": connection.execute("SELECT MAX(observedAt) FROM source_snapshots").fetchone()[0], "lastQuoteCaptureAt": connection.execute("SELECT MAX(observedAt) FROM quote_sets").fetchone()[0], "lastPredictionAt": connection.execute("SELECT MAX(calculatedAt) FROM predictions").fetchone()[0]}
    report["profiles"][profile] = current
    connection.close()

(evidence / "restart-final-proof.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"at":report["at"],"profiles":{name:{"quickCheck":p["quickCheck"],"tables":{t:{"before":x["before"],"after":x["after"],"originalRowsUnchanged":x["originalRowsUnchanged"],"mismatches":len(x["missingOrChangedIds"])} for t,x in p["tables"].items()},"discovery":{k:v for k,v in p.get("discovery",{}).items() if k!="missingCells"},"pipeline":p.get("pipeline")} for name,p in report["profiles"].items()}},ensure_ascii=False,indent=2))
if any(x["quickCheck"] != "ok" or any(not t["originalRowsUnchanged"] for t in x["tables"].values()) for x in report["profiles"].values()):
    raise SystemExit(1)
