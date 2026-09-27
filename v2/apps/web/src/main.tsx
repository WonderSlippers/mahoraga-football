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
    [error, setError] = useState("");
  const [mode, setMode] = useState('DEMO');
  const research = mode === 'LOCAL_RESEARCH';
  useEffect(() => { document.title = '魔虚罗 2.0 · ' + (research ? '真实研究' : 'DEMO'); }, [research]);
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
        setMode((await api('/meta')).mode);
        setLogged(true);
      })
      .catch((e) => setError(String(e)));
  };
  useEffect(connect, []);
  return (
    <>
      <header>
        <div className="brand">
          魔虚罗 <span>2.0</span>
        </div>
        <span className="badge">{research ? 'LOCAL RESEARCH · 真实只读来源' : 'DEMO · 合成数据'}</span>
        <small>本地研究工作台 / 不连接真实投注账户</small>
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
            <NavLink to="/workbench">01 今日观察</NavLink>
            {!research && <NavLink to="/ledger">02 纸面账本</NavLink>}
            <NavLink to="/models">03 模型状态</NavLink>
            <NavLink to="/system">04 系统信息</NavLink>
            <div className="navnote">
              {research ? '真实研究独立数据库' : 'DEMO 专用数据库'}
              <br />
              自动出票：关闭
              <br />
              {research ? '来源白名单：OpenLigaDB' : '真实网络：禁用'}
              <br />
              <a href={research ? 'http://127.0.0.1:5273/workbench' : 'http://127.0.0.1:5274/workbench'}>{research ? '打开离线 DEMO' : '打开真实研究'}</a>
            </div>
          </nav>
          <main>
            <Routes>
              <Route path="/fixtures/:id" element={research ? <ResearchDetail /> : <Detail />} />
              <Route path="/ledger" element={research ? <Sources /> : <Ledger />} />
              <Route path="/models" element={<Models />} />
              <Route path="/system" element={<System />} />
              <Route path="*" element={research ? <Sources /> : <Workbench />} />
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
function Sources() {
  const { data, error, refresh, setError } = useLoad(async () => ({ sources: await api('/sources'), fixtures: await api('/fixtures') }));
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState(2026);
  return <>
    <p className="eyebrow">LOCAL RESEARCH / READ ONLY</p><h1>真实来源观察</h1>
    <div className="callout">赛程与赛果来自真实公开来源。当前来源不提供报价和 xG，研究模型受阻；没有报价就不会生成预测或纸面票。</div>
    <div className="toolbar"><label>起始赛季年份 <input aria-label="赛季年份" type="number" min="2020" max="2099" value={season} onChange={e => setSeason(Number(e.target.value))}/></label>
      <button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await api('/source-captures', {season}); await refresh(); } catch(e) { setError(String(e)); } finally { setBusy(false); } }}>{busy ? '正在采集与保存证据…' : '采集德甲公开赛程'}</button>
      <button className="secondary" onClick={refresh}>刷新本地记录</button></div>
    <p role="alert">{error}</p>
    <h2>最近采集</h2>
    {data?.sources.runs.length === 0 && <p>尚未采集。采集不会连接真实投注账户，也不会写入旧站。</p>}
    {data?.sources.runs.map((r: any) => <article key={r.id}><div className="row"><h3>OpenLigaDB · 德甲 {r.season}/{r.season+1}</h3><span className="badge">{r.state}</span></div>
      <p>实际完成时间：{r.finishedAt ? date(r.finishedAt) : '进行中'} · 规范化比赛：{r.normalizedCount}</p>
      <p>状态原因：{r.reason === 'QUOTE_AND_XG_NOT_PROVIDED' ? '赛程已保存；来源不提供报价和 xG' : r.reason || '等待完成'}</p>
      <p className="mono">原始证据：{r.snapshotId || '尚无完整证据'}</p></article>)}
    <details><summary>五联赛能力与观察覆盖</summary><pre>{JSON.stringify({capabilities:data?.sources.capabilities, coverage:data?.sources.coverage,slots:data?.sources.slots},null,2)}</pre></details>
    <h2>已保存赛程（当前最多显示50条）</h2>
    {data?.fixtures.map((f:any) => <article key={f.id}><h3><Link to={'/fixtures/'+f.id}>{f.home} vs {f.away}</Link></h3><p>开球：{date(f.kickoffAt)} · {f.status} · 报价缺失</p></article>)}
  </>;
}
function ResearchDetail() {
  const {id} = useParams();
  const {data,error} = useLoad(() => api('/fixtures/'+id));
  return <><p className="eyebrow">LOCAL RESEARCH / EVIDENCE</p><h1>{data ? `${data.home} vs ${data.away}` : '读取比赛证据…'}</h1><p role="alert">{error}</p>
    <div className="callout">没有可用报价，未生成预测。来源更新时间未知时保留 null；页面时间为实际捕获时间。</div>
    {data && <><h2>开球版本</h2><pre>{JSON.stringify(data.revisions,null,2)}</pre><h2>原始证据时间线</h2>{data.evidence.map((e:any,i:number) => <article key={e.id+':'+i}><p>捕获：{date(e.observedAt)} · 入库：{date(e.ingestedAt)}</p><p className="mono">SHA256 {e.payloadHash}</p><details><summary>原始响应分块（完整响应由多个块组成）</summary><pre>{e.content}</pre></details></article>)}</>}
  </>;
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
