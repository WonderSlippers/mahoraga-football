import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  NavLink,
  Routes,
  Route,
  Link,
  useParams,
} from "react-router-dom";
import "./style.css";
let csrf = "";
async function api(path: string, body?: unknown, key?: string) {
  const response = await fetch("/api/v2" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": key || crypto.randomUUID(),
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
  const [logged, setLogged] = useState(false),
    [code, setCode] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api("/session")
      .then((s) => {
        csrf = s.csrf;
        setLogged(true);
      })
      .catch(() => {});
  }, []);
  return (
    <>
      <header>
        <div className="brand">
          魔虚罗 <span>2.0</span>
        </div>
        <span className="badge">DEMO · 合成数据</span>
        <small>离线研究工作台 / 不连接真实投注账户</small>
      </header>
      {!logged ? (
        <main className="login">
          <h1>打开本地研究工作台</h1>
          <p>
            输入新环境生成的一次性登录口令。口令保存在本地运行目录的
            login-code.txt。
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const s = await api("/session/bootstrap", { passphrase: code });
                csrf = s.csrf;
                setCode("");
                setLogged(true);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <label>
              本地口令
              <input
                type="password"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button>进入 DEMO</button>
          </form>
          <p role="alert">{error}</p>
        </main>
      ) : (
        <div className="shell">
          <nav>
            <p className="navtitle">研究流程</p>
            <NavLink to="/workbench">01 今日观察</NavLink>
            <NavLink to="/ledger">02 纸面账本</NavLink>
            <NavLink to="/models">03 模型状态</NavLink>
            <NavLink to="/system">04 系统信息</NavLink>
            <div className="navnote">
              DEMO 专用数据库
              <br />
              自动出票：关闭
              <br />
              真实网络：禁用
            </div>
          </nav>
          <main>
            <Routes>
              <Route path="/fixtures/:id" element={<Detail />} />
              <Route path="/ledger" element={<Ledger />} />
              <Route path="/models" element={<Models />} />
              <Route path="/system" element={<System />} />
              <Route path="*" element={<Workbench />} />
            </Routes>
          </main>
        </div>
      )}
      <footer>
        预测冻结 · 原票不可改写 · 更正追加记录　/　所有金额均为虚拟 PAPER
      </footer>
    </>
  );
}
function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState("");
  const refresh = () =>
    load()
      .then(setData)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void refresh();
  }, []);
  return { data, error, refresh, setError };
}
function Workbench() {
  const { data, error, refresh, setError } = useLoad(async () => ({
    fixtures: await api("/fixtures"),
    decisions: await api("/decisions"),
  }));
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="heading">
        <div>
          <p className="eyebrow">OBSERVATION / DEMO T−60</p>
          <h1>今日观察</h1>
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
              开球 {date(f.kickoffAt)} ·{" "}
              {data.decisions.filter((d: any) => d.fixtureId === f.id).length}{" "}
              项冻结决策
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
  const { data, error, refresh, setError } = useLoad(async () => ({
    fixture: await api("/fixtures/" + id),
    decisions: (await api("/decisions")).filter((d: any) => d.fixtureId === id),
    portfolio: await api("/portfolios/demo/summary"),
  }));
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  if (!data) return <p>{error || "读取冻结记录…"}</p>;
  return (
    <>
      <p className="eyebrow">FROZEN RESEARCH / DEMO</p>
      <h1>
        {data.fixture.home} vs {data.fixture.away}
      </h1>
      <p>当时预测始终保留。赛果及更正不会改变下面的概率与 EV。</p>
      <div className="toolbar">
        <span className="badge">{data.fixture.status}</span>
        <button className="secondary" onClick={refresh}>
          刷新预测
        </button>
      </div>
      <p role="alert">{error}</p>
      <p role="status">{notice}</p>
      <details><summary>原始证据与冻结输入</summary><p>人工生成的 DEMO 原始响应；哈希对应保存的原始字节。未知来源更新时间保持 null。</p><pre>{JSON.stringify({evidence:data.fixture.evidence,bundles:data.fixture.bundles},null,2)}</pre></details>
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
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/paper-tickets", {
                      decisionId: d.id,
                      portfolioId: "demo",
                      stakeAtoms: "25000000",
                      expectedRevision: data.portfolio.revision,
                    });
                    setNotice("纸面票已持久化：25.00 PAPER");
                    await refresh();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                记录纸面票 · 25 PAPER
              </button>
            )}
          </article>
        ))
      )}
      <Link to="/ledger" className="textlink">
        打开纸面账本 →
      </Link>
    </>
  );
}
function Ledger() {
  const { data, error, refresh, setError } = useLoad(async () => ({
    tickets: await api("/tickets"),
    portfolio: await api("/portfolios/demo/summary"),
  }));
  const [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<any>();
  async function result(t: any, scenario: string) {
    setBusy(true);
    try {
      const original = await api("/tickets/" + t.id);
      const fixtures = await api("/fixtures");
      const f = fixtures.find(
        (x: any) => x.revisionId === original.original.fixtureRevisionId,
      );
      const full = await api("/fixtures/" + f.id);
      const a = await api("/demo/results", {
        fixtureId: f.id,
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
      {detail && (
        <article>
          <h2>不可变原票与追加事件</h2>
          <pre>{JSON.stringify(detail, null, 2)}</pre>
        </article>
      )}
      <button
        className="secondary"
        onClick={async () => {
          const j = await api("/export");
          const a = document.createElement("a");
          a.href = URL.createObjectURL(
            new Blob([JSON.stringify(j, null, 2)], {
              type: "application/json",
            }),
          );
          a.download = "mahoraga-DEMO.json";
          a.click();
          URL.revokeObjectURL(a.href);
        }}
      >
        导出 DEMO 记录
      </button>
    </>
  );
}
function Models() {
  const { data, error } = useLoad(() => api("/models"));
  return (
    <>
      <p className="eyebrow">MODEL REGISTRY</p>
      <h1>模型状态</h1>
      <p>历史研究成绩不代表实盘资格。没有自动晋升。</p>
      <p>{error}</p>
      {data?.map((m: any) => (
        <article key={m.id}>
          <h2>{m.id}</h2>
          <span className="badge">{m.status}</span>
          <p>{m.outputKind}</p>
          <p className="mono">manifest hash: {m.manifestHash}</p>
          {m.status === "BLOCKED" && (
            <p>研究包已登记；特征准备、原模型对照与适配接入尚未验收。</p>
          )}
        </article>
      ))}
    </>
  );
}
function System() {
  const { data, error } = useLoad(() => api("/meta"));
  return (
    <>
      <p className="eyebrow">LOCAL RUNTIME</p>
      <h1>系统信息</h1>
      <div className="callout">
        只写新的 DEMO 数据库。旧站入口、数据库与启动任务均未接管。
      </div>
      <p>{error}</p>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
