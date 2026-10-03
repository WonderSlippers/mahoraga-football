import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Routes,
  Route,
  Link,
  useParams,
  useLocation,
} from "react-router-dom";
import "./style.css";
import "./workspace.css";
import { StrategiesWorkspace } from "./universal-view";
import {
  ScheduleWorkspace,
  FixtureWorkspace,
  HistoryWorkspace,
  LaboratoryWorkspace,
  RuntimeWorkspace,
  LegacyWorkspace,
} from "./workspace";
let csrf = "";
function requestKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function api(path: string, body?: unknown, key?: string) {
  const response = await fetch("/api/v2" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": key || requestKey(),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j: any = await response.json();
  if (!response.ok) throw Error(j.error.code);
  return j.data;
}
const money = (a: string | number) => (Number(a) / 1000000).toFixed(2);
const percent = (n: number | null) =>
  n === null ? "—" : (n * 100).toFixed(2) + "%";
const date = (n: number) =>
  new Date(n).toLocaleString("zh-CN", { hour12: false });
function App() {
  const location = useLocation();
  const [logged, setLogged] = useState(false),
    [error, setError] = useState("");
  const [mode, setMode] = useState("DEMO");
  const [theme, setTheme] = useState(
    localStorage.getItem("v2-theme") || "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("v2-theme", theme);
  }, [theme]);
  const research = mode === "LOCAL_RESEARCH";
  useEffect(() => {
    if (
      logged &&
      !research &&
      window.location.port === "5273" &&
      ["/", "/workbench"].includes(location.pathname) &&
      !new URLSearchParams(location.search).has("offline")
    )
      window.location.replace(
        `http://${window.location.hostname}:5274` +
          location.pathname +
          location.search,
      );
  }, [logged, research, location.pathname, location.search]);
  useEffect(() => {
    document.title = "魔虚罗 2.0 · " + (research ? "真实研究" : "DEMO");
  }, [research]);
  const connect = () => {
    setError("");
    api("/session")
      .catch(async () => {
        const response = await fetch("/api/v2/session/local", {
          method: "POST",
          headers: {
            "X-V2-Local-Session": "1",
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        const result: any = await response.json();
        if (!response.ok) throw Error(result.error.code);
        return result.data;
      })
      .then(async (s) => {
        csrf = s.csrf;
        setMode((await api("/meta")).mode);
        setLogged(true);
      })
      .catch((e) => setError(String(e)));
  };
  useEffect(connect, []);
  return (
    <>
      <header>
        <div className="brand">
          <img
            className="brand-avatar"
            src="/mahoraga-avatar.png?v=user-reference-1"
            width="44"
            height="44"
            alt="魔虚罗头像"
          />
          魔虚罗 <span>2.0</span>
        </div>
        <span className="badge">
          {location.pathname === "/archives" ||
          location.pathname === "/history" ||
          location.pathname === "/legacy"
            ? "历史档案"
            : location.pathname === "/reported"
              ? "历史记录"
              : research
                ? "真实研究"
                : "DEMO · 合成数据"}
        </span>
        <small>本地研究工作台 / 不连接真实投注账户</small>
        <button
          className="secondary"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "浅色" : "深色"}
        </button>
      </header>
      {!logged ? (
        <main className="login">
          <h1>{error ? "本地服务暂时无法连接" : "正在打开工作台…"}</h1>
          {error && <button onClick={connect}>重新连接</button>}
          <p role="alert">{error}</p>
        </main>
      ) : (
        <div className="shell">
          <nav>
            <p className="navtitle">研究流程</p>
            <NavLink to={research ? "/workbench" : "/workbench?offline=1"}>
              01 完整赛程 <span>↗</span>
            </NavLink>
            <NavLink to="/history">
              02 历史中心 <span>↗</span>
            </NavLink>
            <NavLink to="/ledger">
              03 昨日战绩与账本 <span>↗</span>
            </NavLink>
            <NavLink to="/models">
              04 模型实验室 <span>↗</span>
            </NavLink>
            <NavLink to="/system">
              05 数据运行状态 <span>↗</span>
            </NavLink>
            <NavLink to="/legacy">
              06 旧档案与设置 <span>↗</span>
            </NavLink>
            {research && (
              <NavLink to="/strategies">
                07 模拟策略 <span>↗</span>
              </NavLink>
            )}
            <div className="navnote">
              {research ? "真实研究独立数据库" : "DEMO 专用数据库"}
              <br />
              {research ? "自动纸面策略：独立虚拟账本" : "DEMO离线工程演练"}
              <br />
              {research ? "自动轮转 · 公开来源" : "离线工程演练"}
              {!research && (
                <>
                  <br />
                  <a href={`http://${window.location.hostname}:5274/workbench`}>
                    打开真实研究
                  </a>
                </>
              )}
            </div>
          </nav>
          <main>
            <Routes>
              {["/review", "/review.html"].map((path) => (
                <Route
                  key={path}
                  path={path}
                  element={<HistoryWorkspace api={api} mode={mode} ledger />}
                />
              ))}
              {["/simulation", "/lab"].map((path) => (
                <Route
                  key={path}
                  path={path}
                  element={<StrategiesWorkspace api={api} />}
                />
              ))}
              <Route
                path="/results"
                element={
                  <Navigate
                    to="/workbench?view=RESULTS&period=RECENT"
                    replace
                  />
                }
              />
              <Route
                path="/research"
                element={<Navigate to="/models" replace />}
              />
              <Route path="/scan" element={<Navigate to="/system" replace />} />
              <Route
                path="/legacy.html"
                element={<LegacyWorkspace api={api} mode={mode} />}
              />
              <Route
                path="/fixtures/:id"
                element={research ? <ResearchDetail /> : <Detail />}
              />
              <Route
                path="/match/:id"
                element={<FixtureWorkspace api={api} mode={mode} />}
              />
              <Route
                path="/ledger"
                element={<HistoryWorkspace api={api} mode={mode} ledger />}
              />
              <Route
                path="/history"
                element={<HistoryWorkspace api={api} mode={mode} />}
              />
              <Route
                path="/models"
                element={<LaboratoryWorkspace api={api} mode={mode} />}
              />
              <Route
                path="/system"
                element={<RuntimeWorkspace api={api} mode={mode} />}
              />
              <Route
                path="/legacy"
                element={<LegacyWorkspace api={api} mode={mode} />}
              />
              <Route
                path="/strategies"
                element={<StrategiesWorkspace api={api} />}
              />
              <Route path="/demo-workbench" element={<Workbench />} />
              <Route
                path="/demo-ledger"
                element={research ? <Sources /> : <Ledger />}
              />
              <Route path="/registry" element={<Models />} />
              <Route path="/sources" element={<Sources />} />
              <Route path="/system-details" element={<System />} />
              <Route path="/archives" element={<Archives />} />
              <Route
                path="/reported"
                element={<HistoryWorkspace api={api} mode={mode} ledger />}
              />
              <Route
                path="*"
                element={<ScheduleWorkspace api={api} mode={mode} />}
              />
            </Routes>
          </main>
        </div>
      )}
      <footer>
        预测冻结 · 原票不可改写 · 更正追加记录　/　不执行真实投注或付款
      </footer>
    </>
  );
}
function useLoad<T>(load: () => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [lastRead, setLastRead] = useState<number | null>(null);
  const serial = useRef(0);
  const refresh = async () => {
    const current = ++serial.current;
    setLoading(true);
    setError("");
    try {
      const value = await load();
      if (current === serial.current) {
        setData(value);
        setLastRead(Date.now());
      }
    } catch (e) {
      if (current === serial.current) setError(String(e));
    } finally {
      if (current === serial.current) setLoading(false);
    }
  };
  useEffect(() => {
    setData(undefined);
    setLastRead(null);
    void refresh();
    return () => {
      serial.current++;
    };
  }, dependencies);
  const loadStatus = (
    <p
      className="muted"
      data-testid="load-status"
      data-loaded={data !== undefined}
      aria-live="polite"
    >
      {loading
        ? "正在读取本地记录…"
        : error
          ? "读取失败；保留上一次显示内容"
          : lastRead
            ? "本地记录读取于 " + date(lastRead)
            : "尚未读取"}
    </p>
  );
  return { data, error, refresh, setError, loadStatus };
}
function Workbench() {
  const [cursor, setCursor] = useState<any>(null),
    [status, setStatus] = useState("ALL");
  const { data, error, refresh, setError, loadStatus } = useLoad(async () => {
    const page = await api(
      "/fixture-page?status=" +
        status +
        (cursor
          ? "&afterAt=" +
            encodeURIComponent(new Date(cursor.at).toISOString()) +
            "&afterId=" +
            encodeURIComponent(cursor.id)
          : ""),
    );
    return { fixtures: page.items, nextCursor: page.nextCursor };
  }, [cursor, status]);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="heading">
        <div>
          <p className="eyebrow">OBSERVATION / DEMO T−60</p>
          <h1>今日观察</h1>
          {loadStatus}
          <p>每次观察冻结一组报价与输入。候选不等于已经记录票据。</p>
        </div>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/observation-requests", {});
              await refresh();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          创建 DEMO 观察
        </button>
      </div>
      <div className="callout">
        市场比例基准通常没有正优势，这是正常的
        NO_ACTION。固定概率适配器仅用于验证离线工程链路。
      </div>
      <div className="toolbar">
        <h2>
          观察记录 <span>{data?.fixtures.length || 0}</span>
        </h2>
        <button className="secondary" onClick={refresh}>
          刷新任务结果
        </button>
      </div>
      <p role="alert">{error}</p>
      <div className="toolbar">
        <label>
          比赛状态{" "}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursor(null);
            }}
          >
            <option value="ALL">全部观察</option>
            <option value="SCHEDULED">未开赛</option>
            <option value="FINISHED">已结束</option>
          </select>
        </label>
        <button
          className="secondary"
          onClick={() => setCursor(null)}
          disabled={!cursor}
        >
          回到第一页
        </button>
        <button
          className="secondary"
          disabled={!data?.nextCursor}
          onClick={() => setCursor(data?.nextCursor)}
        >
          下一页
        </button>
      </div>
      {!data ? (
        <p>正在读取本地数据库…</p>
      ) : data.fixtures.length === 0 ? (
        <div className="empty">
          尚未创建观察。点击上方按钮开始完整 DEMO 链路。
        </div>
      ) : (
        data.fixtures.map((f: any) => (
          <article key={f.id}>
            <div className="row">
              <h2>
                <Link to={"/fixtures/" + f.id}>
                  {f.home} <span className="muted">vs</span> {f.away}
                </Link>
              </h2>
              <span className="badge">{f.status}</span>
            </div>
            <p>
              开球 {date(f.kickoffAt)} · {f.decisionCount} 项冻结决策
            </p>
            <Link className="textlink" to={"/fixtures/" + f.id}>
              查看证据与纸面决策 →
            </Link>
          </article>
        ))
      )}
    </>
  );
}
function Detail() {
  const { id } = useParams();
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<any>(null);
  useEffect(() => {
    if (selected) confirmDialog.current?.showModal();
    else if (confirmDialog.current?.open) confirmDialog.current.close();
  }, [selected]);
  const { data, error, refresh, setError, loadStatus } = useLoad(
    async () => ({
      fixture: await api("/fixtures/" + id),
      decisions: await api("/decisions?fixtureId=" + encodeURIComponent(id!)),
      portfolio: await api("/portfolios/demo/summary"),
    }),
    [id],
  );
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  if (!data) return <p>{error || "读取冻结记录…"}</p>;
  return (
    <>
      <p className="eyebrow">FROZEN RESEARCH / DEMO</p>
      <h1>
        {data.fixture.home} vs {data.fixture.away}
      </h1>
      {loadStatus}
      <p>当时预测始终保留。赛果及更正不会改变下面的概率与 EV。</p>
      <div className="toolbar">
        <span className="badge">{data.fixture.status}</span>
        <button className="secondary" onClick={refresh}>
          刷新预测
        </button>
      </div>
      <p role="alert">{error}</p>
      <p role="status">{notice}</p>
      <details>
        <summary>原始证据与冻结输入</summary>
        <p>
          人工生成的 DEMO 原始响应；哈希对应保存的原始字节。未知来源更新时间保持
          null。
        </p>
        <pre>
          {JSON.stringify(
            { evidence: data.fixture.evidence, bundles: data.fixture.bundles },
            null,
            2,
          )}
        </pre>
      </details>
      {data.decisions.length === 0 ? (
        <div className="empty">
          Python runner 正在领取任务。请稍后刷新；无结果不会填成 0。
        </div>
      ) : (
        data.decisions.map((d: any) => (
          <article key={d.id}>
            <div className="row">
              <h2>
                {d.modelId === "DEMO_FIXED_CENTRAL_V1"
                  ? "DEMO 固定中心概率"
                  : "市场比例去水基准"}
              </h2>
              <span
                className={"badge " + (d.accepted ? "positive" : "neutral")}
              >
                {d.accepted ? "DEMO 候选" : "NO_ACTION"}
              </span>
            </div>
            <div className="metrics">
              <div>
                <small>方向 / 参考赔率</small>
                <strong>
                  {d.selection} / {d.decimalOdds}
                </strong>
              </div>
              <div>
                <small>冻结中心概率</small>
                <strong>{percent(d.probability)}</strong>
              </div>
              <div>
                <small>已保存 EV</small>
                <strong>{percent(d.ev)}</strong>
              </div>
            </div>
            <p>
              报价实收时间：{date(d.observedAt)} · 来源更新时间：未知 ·
              合成参考价
            </p>
            <details>
              <summary>追溯标识与拒绝原因</summary>
              <p className="mono">
                predictionId: {d.predictionId}
                <br />
                decisionId: {d.id}
                <br />
                {d.reason}
              </p>
            </details>
            {!!d.accepted && (
              <button
                disabled={busy || data.fixture.status !== "SCHEDULED"}
                onClick={() =>
                  setSelected({
                    ...d,
                    expectedRevision: data.portfolio.revision,
                    commandKey: requestKey(),
                  })
                }
              >
                记录纸面票 · 25 PAPER
              </button>
            )}
          </article>
        ))
      )}
      <dialog
        ref={confirmDialog}
        aria-labelledby="paper-confirm-title"
        onCancel={() => setSelected(null)}
      >
        <h2 id="paper-confirm-title">确认 DEMO 纸面记录</h2>
        <p>
          投入 25 PAPER · {selected?.selection} @{selected?.decimalOdds}
        </p>
        <p>合成数据，记录到本地纸面账本。</p>
        <p className="mono">predictionId: {selected?.predictionId}</p>
        <div className="actions">
          <button
            autoFocus
            className="secondary"
            disabled={busy}
            onClick={() => setSelected(null)}
          >
            取消
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(
                  "/paper-tickets",
                  {
                    decisionId: selected.id,
                    portfolioId: "demo",
                    stakeAtoms: "25000000",
                    expectedRevision: selected.expectedRevision,
                  },
                  selected.commandKey,
                );
                setNotice("纸面票已持久化：25.00 PAPER");
                setSelected(null);
                await refresh();
              } catch (e) {
                setError(String(e));
                setSelected(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            确认记录 25 PAPER
          </button>
        </div>
      </dialog>
      <Link to="/demo-ledger" className="textlink">
        打开纸面账本 →
      </Link>
    </>
  );
}
function Ledger() {
  const [cursor, setCursor] = useState<any>(null);
  const { data, error, refresh, setError, loadStatus } = useLoad(async () => {
    const page = await api(
      "/ticket-page" +
        (cursor
          ? "?afterAt=" +
            encodeURIComponent(cursor.at) +
            "&afterId=" +
            encodeURIComponent(cursor.id)
          : ""),
    );
    return {
      tickets: page.items,
      nextCursor: page.nextCursor,
      portfolio: await api("/portfolios/demo/summary"),
    };
  }, [cursor]);
  const [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<any>();
  async function result(t: any, scenario: string) {
    setBusy(true);
    try {
      const original = await api("/tickets/" + t.id);
      const fixtureId = original.original.fixtureId;
      const full = await api("/fixtures/" + fixtureId);
      const a = await api("/demo/results", {
        fixtureId,
        scenario,
        expectedRevision: full.adjudications.at(-1)?.revision || 0,
        reason: "用户触发 DEMO " + scenario + " 合成证据",
      });
      const p = await api("/portfolios/demo/summary");
      await api("/settlement-requests", {
        ticketId: t.id,
        adjudicationId: a.id,
        expectedRevision: p.revision,
      });
      setDetail(await api("/tickets/" + t.id));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">PAPER LEDGER / DEMO ONLY</p>
      <h1>纸面账本</h1>
      {loadStatus}
      <p>收益率 = 已结算净收益 ÷ 已结算原始投入；没有结算时显示 —。</p>
      {data && (
        <>
          <div className="metrics summary">
            <div>
              <small>可用 PAPER</small>
              <strong data-testid="available">
                {money(data.portfolio.available)}
              </strong>
            </div>
            <div>
              <small>未结投入</small>
              <strong>{money(data.portfolio.openStake)}</strong>
            </div>
            <div>
              <small>已实现净收益</small>
              <strong>{money(data.portfolio.realized)}</strong>
            </div>
            <div>
              <small>已结算 ROI</small>
              <strong>{percent(data.portfolio.roi)}</strong>
            </div>
          </div>
          <p>
            账户 revision {data.portfolio.revision} ·{" "}
            {data.portfolio.frozen ? "欠额，冻结新出票" : "手工纸面记录"} · 初始
            100 PAPER
          </p>
        </>
      )}
      <p role="alert">{error}</p>
      {data?.tickets.map((t: any) => (
        <article key={t.id}>
          <div className="row">
            <h2>
              {t.selection} @{t.frozenOdds} · {money(t.stakeAtoms)} PAPER
            </h2>
            <span className="badge">{t.currentStatus}</span>
          </div>
          <p className="mono">
            predictionId: {t.predictionId}
            <br />
            ticketId: {t.id}
          </p>
          <p>
            当前返还 {money(t.gross)} PAPER · 结算 revision{" "}
            {t.settlementRevision}
          </p>
          <div className="actions">
            <button disabled={busy} onClick={() => result(t, "WIN")}>
              DEMO 主胜结算
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => result(t, "LOSS")}
            >
              追加更正为客胜
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => result(t, "CONFLICT")}
            >
              注入冲突 → review
            </button>
            <button
              className="secondary"
              onClick={async () => setDetail(await api("/tickets/" + t.id))}
            >
              查看原票与事件
            </button>
          </div>
        </article>
      ))}
      {data?.tickets.length === 0 && (
        <div className="empty">暂无纸面票。请先在观察详情中手工记录。</div>
      )}
      <div className="toolbar">
        <p>每页最多 50 张，账户汇总包含全部票据。</p>
        <button
          className="secondary"
          disabled={!cursor}
          onClick={() => setCursor(null)}
        >
          回到第一页
        </button>
        <button
          className="secondary"
          disabled={!data?.nextCursor}
          onClick={() => setCursor(data?.nextCursor)}
        >
          下一页
        </button>
      </div>
      {detail && (
        <article>
          <h2>不可变原票与追加事件</h2>
          <pre>{JSON.stringify(detail, null, 2)}</pre>
        </article>
      )}
      <Exports />
    </>
  );
}
function Exports() {
  const { data, error, refresh, setError, loadStatus } = useLoad(() =>
    api("/export-jobs"),
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data?.some((j: any) => ["RUNNING", "QUEUED"].includes(j.state)))
      return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [data]);
  return (
    <article>
      <h2>完整事实导出</h2>
      <p>
        先固定全部原票、预测和事件的水位，再由后台分批生成
        JSONL；包括全部页面。用于审计，数据库恢复请用本地备份命令。
      </p>
      <p role="alert">{error}</p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/export-jobs", {});
            await refresh();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        创建完整导出
      </button>
      {data?.map((j: any) => (
        <div key={j.id}>
          <p>
            {date(j.createdAt)} · {j.mode} · {j.state} · {j.rowsExported} 条事实{" "}
            {j.reason || ""}
          </p>
          {j.state === "COMPLETE" && (
            <a
              className="textlink"
              href={"/api/v2/export-jobs/" + j.id + "/download"}
            >
              下载完整 JSONL
            </a>
          )}
        </div>
      ))}
    </article>
  );
}
function Models() {
  const { data, error, refresh, setError, loadStatus } = useLoad(async () => ({
    models: await api("/models"),
    evaluations: await api("/evaluations"),
  }));
  const [busy, setBusy] = useState(false),
    [evaluation, setEvaluation] = useState<any>(null);
  return (
    <>
      <p className="eyebrow">MODEL REGISTRY</p>
      <h1>模型状态</h1>
      {loadStatus}
      <p>历史研究成绩不代表实盘资格。没有自动晋升。</p>
      <p>{error}</p>
      {data?.models.map((m: any) => (
        <article key={m.id}>
          <h2>{m.id}</h2>
          <span className="badge">{m.status}</span>
          <p>{m.outputKind}</p>
          <p className="mono">manifest hash: {m.manifestHash}</p>
          {m.status === "BLOCKED" && (
            <p>
              {JSON.parse(m.manifestJson).parity
                ? "历史软件对照已通过；实时原始特征、精确训练时间与训练清单尚不具备，保持 BLOCKED。"
                : "早期登记占位；完整研究登记见对应带版本哈希的条目。"}
            </p>
          )}
          <details>
            <summary>变体、概率含义、训练范围与特征契约</summary>
            <pre>{JSON.stringify(JSON.parse(m.manifestJson), null, 2)}</pre>
          </details>
        </article>
      ))}
      <h2>固定协议评估</h2>
      <p>
        按比赛、协议、模型选取第一份冻结预测。V6
        压力输出不参与三分类损失；无已结投入时 ROI
        为空。历史档案不进入当前模型样本。
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const run = await api("/evaluations", {
              asOf: new Date().toISOString(),
            });
            setEvaluation(await api("/evaluations/" + run.id));
            await refresh();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        冻结当前评估样本
      </button>
      {data?.evaluations.map((e: any) => (
        <article key={e.id}>
          <p>
            {e.mode} · asOf {date(e.asOf)}
          </p>
          <p className="mono">样本 hash：{e.manifestHash}</p>
          <button
            className="secondary"
            onClick={async () =>
              setEvaluation(await api("/evaluations/" + e.id))
            }
          >
            查看已冻结指标
          </button>{" "}
          <a href={"/api/v2/evaluations/" + e.id + "/csv"}>下载指标 CSV</a>
        </article>
      ))}
      {evaluation && (
        <article>
          <h3>固定样本结果 · {evaluation.mode}</h3>
          <pre>{JSON.stringify(evaluation.metrics, null, 2)}</pre>
          <details>
            <summary>样本与排除原因（分页不改变指标）</summary>
            <pre>{JSON.stringify(evaluation.samples, null, 2)}</pre>
            {evaluation.nextOffset !== null && (
              <button
                onClick={async () =>
                  setEvaluation(
                    await api(
                      `/evaluations/${evaluation.id}?offset=${evaluation.nextOffset}`,
                    ),
                  )
                }
              >
                下一页样本
              </button>
            )}
          </details>
        </article>
      )}
    </>
  );
}
function Sources() {
  const { data, error, refresh, setError, loadStatus } = useLoad(async () => ({
    sources: await api("/sources"),
    page: await api("/fixture-page"),
  }));
  const [filter, setFilter] = useState("SCHEDULED"),
    [page, setPage] = useState<any>(null);
  const shown = page || data?.page;
  const nextPage = async (cursor: any = null, status = filter) => {
    setError("");
    try {
      setPage(
        await api(
          "/fixture-page?status=" +
            status +
            (cursor
              ? "&afterAt=" +
                encodeURIComponent(cursor.at) +
                "&afterId=" +
                encodeURIComponent(cursor.id)
              : ""),
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  };
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState(2026);
  return (
    <>
      <p className="eyebrow">LOCAL RESEARCH / READ ONLY</p>
      <h1>真实来源观察</h1>
      {loadStatus}
      <div className="callout">
        赛程与赛果来自真实公开来源。当前来源不提供报价和
        xG，研究模型受阻；没有报价就不会生成预测或纸面票。
      </div>
      <div className="toolbar">
        <label>
          起始赛季年份{" "}
          <input
            aria-label="赛季年份"
            type="number"
            min="2020"
            max="2099"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
          />
        </label>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("/source-captures", { season });
              await refresh();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "正在采集与保存证据…" : "采集德甲公开赛程"}
        </button>
        <button className="secondary" onClick={refresh}>
          刷新本地记录
        </button>
      </div>
      <p role="alert">{error}</p>
      <h2>最近采集</h2>
      {data?.sources.runs.length === 0 && (
        <p>尚未采集。采集不会连接真实投注账户，也不会写入旧站。</p>
      )}
      {data?.sources.runs.map((r: any) => (
        <article key={r.id}>
          <div className="row">
            <h3>
              OpenLigaDB · 德甲 {r.season}/{r.season + 1}
            </h3>
            <span className="badge">{r.state}</span>
          </div>
          <p>
            实际完成时间：{r.finishedAt ? date(r.finishedAt) : "进行中"} ·
            规范化比赛：{r.normalizedCount}
          </p>
          <p>
            状态原因：
            {r.reason === "QUOTE_AND_XG_NOT_PROVIDED"
              ? "赛程已保存；来源不提供报价和 xG"
              : r.reason || "等待完成"}
          </p>
          <p className="mono">原始证据：{r.snapshotId || "尚无完整证据"}</p>
        </article>
      ))}
      <details>
        <summary>五联赛能力与观察覆盖</summary>
        <pre>
          {JSON.stringify(
            {
              capabilities: data?.sources.capabilities,
              coverage: data?.sources.coverage,
              slots: data?.sources.slots,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <div className="toolbar">
        <h2>已保存赛程（每页50条）</h2>
        <select
          aria-label="赛程状态"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            void nextPage(null, e.target.value);
          }}
        >
          <option value="SCHEDULED">待赛（最近在前）</option>
          <option value="FINISHED">已完赛（最近在前）</option>
          <option value="ALL">全部（最近在前）</option>
        </select>
        <button className="secondary" onClick={() => nextPage()}>
          第一页
        </button>
      </div>
      {shown?.items.map((f: any) => (
        <article key={f.id}>
          <h3>
            <Link to={"/fixtures/" + f.id}>
              {f.home} vs {f.away}
            </Link>
          </h3>
          <p>
            开球：{date(f.kickoffAt)} · {f.status} · 报价缺失
          </p>
        </article>
      ))}
      {shown?.nextCursor && (
        <button onClick={() => nextPage(shown.nextCursor)}>下一页赛程</button>
      )}
    </>
  );
}
function ResearchDetail() {
  const { id } = useParams();
  const { data, error, refresh, setError, loadStatus } = useLoad(
    () => api("/fixtures/" + id),
    [id],
  );
  const [selected, setSelected] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <p className="eyebrow">LOCAL RESEARCH / EVIDENCE</p>
      <h1>{data ? `${data.home} vs ${data.away}` : "读取比赛证据…"}</h1>
      {loadStatus}
      <p role="alert">{error}</p>
      <div className="callout">
        没有可用报价，未生成预测。来源更新时间未知时保留
        null；页面时间为实际捕获时间。
      </div>
      {data && (
        <>
          <h2>开球版本</h2>
          <pre>{JSON.stringify(data.revisions, null, 2)}</pre>
          <h2>90 分钟赛果与复核</h2>
          <pre>{JSON.stringify(data.resultObservations, null, 2)}</pre>
          <label>
            采用规则或选择已有证据
            <select
              aria-label="赛果证据"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">全部已知证据一致才接受；冲突进入复核</option>
              {data.resultObservations.map((o: any) => (
                <option key={o.id} value={o.id}>
                  {o.regulationJson || "缺常规时间比分"} · {date(o.observedAt)}
                </option>
              ))}
            </select>
          </label>
          <label>
            裁定或更正原因
            <input
              aria-label="裁定原因"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              reason.trim().length < 3 ||
              !data.resultObservations.length
            }
            onClick={async () => {
              setBusy(true);
              try {
                await api("/result-adjudications", {
                  fixtureId: id,
                  expectedRevision: data.adjudications.at(-1)?.revision || 0,
                  selectedEvidenceId: selected || null,
                  reason,
                });
                await refresh();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            追加裁定记录
          </button>
          <details>
            <summary>历史裁定与更正（原证据保留）</summary>
            <pre>{JSON.stringify(data.adjudications, null, 2)}</pre>
          </details>
          <h2>原始证据时间线</h2>
          {data.evidence.map((e: any, i: number) => (
            <article key={e.id + ":" + i}>
              <p>
                捕获：{date(e.observedAt)} · 入库：{date(e.ingestedAt)}
              </p>
              <p className="mono">SHA256 {e.payloadHash}</p>
              <details>
                <summary>原始响应分块（完整响应由多个块组成）</summary>
                <pre>{e.content}</pre>
              </details>
            </article>
          ))}
        </>
      )}
    </>
  );
}
function Archives() {
  const { data, error, refresh, setError, loadStatus } = useLoad(async () => ({
    batches: await api("/imports"),
    page: await api("/archives"),
  }));
  const [selected, setSelected] = useState<File[]>([]),
    [namespace, setNamespace] = useState("legacy-local"),
    [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<any>(null);
  const [page, setPage] = useState<any>(null),
    [portfolio, setPortfolio] = useState("");
  const shown = page || data?.page;
  const readFiles = async () =>
    Promise.all(
      selected.map(async (f) => ({
        name: f.name,
        content: new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(await f.arrayBuffer()),
      })),
    );
  const loadPage = async (after = "") =>
    setPage(
      await api(
        "/archives?after=" +
          encodeURIComponent(after) +
          (portfolio ? "&portfolio=" + encodeURIComponent(portfolio) : ""),
      ),
    );
  const download = async (batch: any, index: number) => {
    setError("");
    try {
      let cursor: any = -1;
      const parts: string[] = [];
      do {
        const r = await api(
          `/imports/${batch.id}/files/${index}/chunks?after=${cursor}`,
        );
        parts.push(...r.chunks.map((c: any) => c.content));
        cursor = r.nextCursor;
      } while (cursor !== null);
      const bytes = new TextEncoder().encode(parts.join(""));
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== batch.manifest.files[index].sha256)
        throw Error("SOURCE_HASH_MISMATCH");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([bytes]));
      link.download = batch.manifest.files[index].name;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      setError(String(e));
    }
  };
  const action = async (commit: boolean) => {
    setBusy(true);
    setError("");
    try {
      const files = await readFiles();
      const result = await api(
        commit ? "/imports/commit" : "/imports/preview",
        commit
          ? { previewId: preview.id, previewHash: preview.previewHash, files }
          : { namespace, files },
      );
      setPreview(result);
      setPage(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="eyebrow">LEGACY IMPORT / READ ONLY</p>
      <h1>历史档案与对账</h1>
      {loadStatus}
      <div className="callout">
        这里保存原始历史记录与缺失字段。历史票只读，不补写预测，不自动结算开放票，不把旧余额转成可用纸面资金。
      </div>
      <article>
        <h2>导入预览</h2>
        <label>
          原系统标识（同一旧账本持续使用相同标识）
          <input
            aria-label="原系统标识"
            value={namespace}
            onChange={(e) => {
              setNamespace(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <input
          aria-label="历史导出文件"
          type="file"
          accept=".json,.csv,.txt"
          multiple
          onChange={(e) => {
            setSelected(Array.from(e.target.files || []));
            setPreview(null);
          }}
        />
        <p>
          JSON / CSV / TXT / app_state 分片；总文件不超过 8
          MiB。先预览，再按文件 hash 提交到新档案。
        </p>
        <div className="actions">
          <button
            disabled={busy || !selected.length}
            onClick={() => action(false)}
          >
            预览并对账
          </button>
          <button
            disabled={busy || !preview || preview.state !== "PREVIEW"}
            onClick={() => action(true)}
          >
            提交到新只读档案
          </button>
        </div>
        {preview && (
          <>
            <p role="status">
              状态：{preview.state} · 原记录 {preview.report.records} 条
            </p>
            <pre>
              {JSON.stringify(
                {
                  report: preview.report,
                  warnings: preview.warnings,
                  claims: preview.claims,
                },
                null,
                2,
              )}
            </pre>
          </>
        )}
      </article>
      <p role="alert">{error}</p>
      <details>
        <summary>导入批次与原文件 SHA256</summary>
        <pre>{JSON.stringify(data?.batches, null, 2)}</pre>
        {data?.batches.map((b: any) => (
          <div key={b.id}>
            <p>
              {b.namespace} · {b.state}
            </p>
            {b.manifest.files.map((f: any, i: number) => (
              <button
                className="secondary"
                key={f.name}
                onClick={() => download(b, i)}
              >
                下载原文件：{f.name}
              </button>
            ))}
          </div>
        ))}
      </details>
      <div className="toolbar">
        <h2>只读历史记录</h2>
        <label>
          组合标识
          <input
            aria-label="档案组合筛选"
            value={portfolio}
            onChange={(e) => setPortfolio(e.target.value)}
          />
        </label>
        <button className="secondary" onClick={() => loadPage()}>
          筛选 / 第一页
        </button>
      </div>
      {shown?.items.map((r: any) => (
        <article key={r.id}>
          <div className="row">
            <h3>
              {r.portfolio} · {r.originalId}
            </h3>
            <span className="badge">LEGACY_IMPORT</span>
          </div>
          <p>
            原状态 {r.status || "缺失"} · 腿数 {r.legCount ?? "未知"} · 币种{" "}
            {r.currency || "未记录"}
          </p>
          <p>
            原投入 {r.stakeAtoms === null ? "缺失" : money(r.stakeAtoms)} ·
            原盈亏声明 {r.pnlAtoms === null ? "缺失" : money(r.pnlAtoms)}
          </p>
          <button
            className="secondary"
            onClick={async () => setDetail(await api("/archives/" + r.id))}
          >
            查看原记录 / 多腿详情
          </button>
        </article>
      ))}
      {shown?.nextCursor && (
        <button onClick={() => loadPage(shown.nextCursor)}>下一页</button>
      )}
      {detail && (
        <article>
          <h2>原始记录（只读）</h2>
          <p>
            缺失项：
            {JSON.parse(detail.warningsJson).join(" / ") || "无额外提示"}
          </p>
          <pre>{JSON.stringify(JSON.parse(detail.rawJson), null, 2)}</pre>
          <button className="secondary" onClick={() => setDetail(null)}>
            关闭详情
          </button>
        </article>
      )}
    </>
  );
}
function System() {
  const { data, error, refresh, loadStatus } = useLoad(() => api("/meta"));
  return (
    <>
      <p className="eyebrow">LOCAL RUNTIME</p>
      <h1>系统信息</h1>
      {loadStatus}
      <div className="callout">
        只写本次新建的隔离数据库。旧站入口、数据库与启动任务均未接管。
      </div>
      <p>{error}</p>
      <button className="secondary" onClick={refresh}>
        刷新系统状态
      </button>
      {data && (
        <div className="metrics">
          <div>
            <small>运行模式</small>
            <strong>{data.mode}</strong>
          </div>
          <div>
            <small>自动纸面出票</small>
            <strong>关闭</strong>
          </div>
          <div>
            <small>Python 领取器</small>
            <strong>
              {data.health?.some(
                (h: any) => Date.now() - Date.parse(h.lastSeenAt) < 90000,
              )
                ? "在线"
                : "未收到近期心跳"}
            </strong>
          </div>
        </div>
      )}
      <p>
        BLOCKED 表示缺必要输入或资格；NO_ACTION
        表示模型已计算但没有可执行优势；FAILED
        表示采集或任务失败。三者不会混成“无机会”。
      </p>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
