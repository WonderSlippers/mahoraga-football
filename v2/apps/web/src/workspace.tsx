import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
type Client = (path: string, body?: unknown, key?: string) => Promise<any>;
type Props = { api: Client; mode?: string };
const pct = (x: any) =>
  x === null || x === undefined ? "—" : (Number(x) * 100).toFixed(2) + "%";
const amount = (x: any) =>
  x === null || x === undefined
    ? "—"
    : (Number(x) / 1e6).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const fmt = (x: any) =>
  x === null || x === undefined
    ? "未记录"
    : new Date(x).toLocaleString("zh-CN", { hour12: false });
const day = (x: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(x);
const leagueName = (code: string, leagues: any[] = []) =>
  leagues.find((l) => l.code === code)?.name || code;
const time = (x: any) =>
  new Date(x).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
function useData(api: Client, path: string, poll = 30000) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const serial = useRef(0);
  const refresh = async () => {
    const id = ++serial.current;
    setBusy(true);
    try {
      const value = await api(path);
      if (serial.current === id) {
        setData(value);
        setError("");
      }
    } catch (e) {
      if (serial.current === id) setError(String(e));
    } finally {
      if (serial.current === id) setBusy(false);
    }
  };
  useEffect(() => {
    setData(undefined);
    void refresh();
    const timer = setInterval(refresh, poll);
    return () => {
      clearInterval(timer);
      serial.current++;
    };
  }, [path]);
  return { data, error, busy, refresh };
}
function LoadState({ error, data, busy }: any) {
  return (
    <div
      className="ws-read-state"
      data-testid="load-status"
      data-loaded={data !== undefined}
      role={error ? "alert" : "status"}
    >
      {error
        ? `读取失败：${error}。${data ? "当前显示上次成功快照" : "可使用立即刷新重试"}`
        : busy
          ? "正在同步本地记录…"
          : `本地快照 ${fmt(data?.asOf)}`}
      <span className={busy ? "ws-live-dot working" : "ws-live-dot"} />
    </div>
  );
}
function Head({ n, title, text, children }: any) {
  return (
    <section className="ws-head">
      <div>
        <p className="eyebrow">MAHORAGA / {n}</p>
        <h1>
          {title}
          <span className="ws-title-dot">.</span>
        </h1>
        <p className="ws-deck">{text}</p>
      </div>
      <div className="ws-head-actions">{children}</div>
    </section>
  );
}
function Stat({ label, value, detail }: any) {
  return (
    <div className="ws-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
function Select({ label, value, values, onChange }: any) {
  return (
    <label className="ws-filter">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {values.map((v: any) => (
          <option
            key={Array.isArray(v) ? v[0] : v}
            value={Array.isArray(v) ? v[0] : v}
          >
            {Array.isArray(v) ? v[1] : v}
          </option>
        ))}
      </select>
    </label>
  );
}
function Json({ value, label = "原始数据 / 审计详情" }: any) {
  return (
    <details className="ws-audit">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
function Curve({ points, label }: any) {
  const values = points.map((p: any) => Number(p.profitAtoms));
  if (!values.length)
    return (
      <div className="ws-empty compact">
        暂无已知金额的已结记录；曲线与回撤不会填造。
      </div>
    );
  const lo = Math.min(0, ...values),
    hi = Math.max(0, ...values),
    range = hi - lo || 1;
  const path = [0, ...values]
    .map(
      (n, i, a) =>
        `${i ? "L" : "M"}${20 + (i * 700) / Math.max(1, a.length - 1)},${150 - ((n - lo) / range) * 125}`,
    )
    .join(" ");
  return (
    <svg
      className="ws-curve"
      viewBox="0 0 740 180"
      role="img"
      aria-label={label}
    >
      <path d="M20,155H720" stroke="currentColor" opacity=".15" />
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
      <text x="20" y="176">
        最早结算
      </text>
      <text x="648" y="176">
        最新结算
      </text>
    </svg>
  );
}
function CandidateGroup({ title, rows, empty }: any) {
  return (
    <article className="ws-candidate">
      <div className="ws-section-label">
        <span>{title}</span>
        <b>{rows.length.toString().padStart(2, "0")}</b>
      </div>
      {rows.length ? (
        rows.slice(0, 3).map((r: any) => (
          <Link key={r.id} to={"/match/" + encodeURIComponent(r.id)}>
            {r.home} <span>vs</span> {r.away}
            <small>{r.reason}</small>
          </Link>
        ))
      ) : (
        <p>{empty}</p>
      )}
    </article>
  );
}
export function ScheduleWorkspace({ api, mode }: Props) {
  const [period, setPeriod] = useState("ALL"),
    [custom, setCustom] = useState(day(Date.now())),
    [league, setLeague] = useState(
      new URLSearchParams(window.location.search).get("league") || "ALL",
    ),
    [status, setStatus] = useState("ALL"),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0);
  const from =
    period === "ALL"
      ? ""
      : period === "CUSTOM"
        ? custom
        : day(Date.now() + (period === "TOMORROW" ? 86400000 : 0));
  const to = period === "RECENT" ? day(Date.now() + 6 * 86400000) : from;
  const query = new URLSearchParams({
    from,
    to,
    league,
    status,
    q,
    offset: String(offset),
  });
  const state = useData(api, "/workspace/schedule?" + query);
  const { data, refresh } = state;
  const [notice, setNotice] = useState("");
  const change = (fn: any) => (v: string) => {
    setOffset(0);
    fn(v);
  };
  async function manual() {
    setNotice("正在读取已配置来源…");
    try {
      const r = await api("/workspace/refresh", {});
      setNotice(
        r.state === "FAILED"
          ? r.reason
          : mode === "DEMO"
            ? "DEMO为离线模式；真实来源请打开研究工作台。"
            : r.stage === "RUNNING" || r.state === "BUSY"
              ? "自动读取正在进行，已保留当前快照。"
              : r.enabled === 0
                ? "来源轮转已暂停；请在运行状态页恢复。"
                : "已触发一轮来源更新；后续由本地任务自动轮转。",
      );
      await refresh();
    } catch (e) {
      setNotice(String(e));
    }
  }
  return (
    <div className="workspace-page">
      <Head
        n="01 / FIXTURES"
        title="完整赛程"
        text="展示已取得的全部赛程。候选只是其中一部分。"
      >
        <button onClick={manual}>
          立即刷新 <span>↗</span>
        </button>
        <small>自动读取 · 每30秒更新视图</small>
      </Head>
      <LoadState {...state} />
      <div className="ws-summary">
        <Stat
          label="筛选范围内比赛"
          value={data?.total ?? "—"}
          detail={`目录共 ${data?.totalKnown ?? "—"} 场已知比赛`}
        />
        <Stat
          label="研究候选"
          value={data?.researchCandidates.length ?? "—"}
          detail="固定决策，不等于出票"
        />
        <Stat
          label="严格前瞻"
          value={data?.strictCandidates.length ?? "—"}
          detail="资格不足时保持空集"
        />
        <Stat
          label="已迁移联赛配置"
          value={data?.metadata?.leagues.length ?? "—"}
          detail="来源能力逐项显示"
        />
      </div>
      <div className="ws-candidates">
        <CandidateGroup
          title="研究候选"
          rows={data?.researchCandidates || []}
          empty="本范围暂无通过固定策略的研究候选。"
        />
        <CandidateGroup
          title="严格前瞻候选"
          rows={data?.strictCandidates || []}
          empty="完整实时模型输入与验证资格尚未具备；不以历史重放代替。"
        />
        <CandidateGroup
          title="观察比赛"
          rows={data?.observations || []}
          empty="本范围暂无等待观察的比赛；完整赛程仍在下方。"
        />
      </div>
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>
            赛程目录 <span>{data?.total ?? "—"}</span>
          </h2>
          <div className="ws-pills" aria-label="赛程日期范围">
            {[
              ["TODAY", "今日"],
              ["TOMORROW", "明日"],
              ["RECENT", "近七日"],
              ["ALL", "所有已知"],
              ["CUSTOM", "指定日期"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={period === v ? "selected" : ""}
                onClick={() => {
                  setPeriod(v);
                  setOffset(0);
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="ws-filters">
          {period === "CUSTOM" && (
            <label className="ws-filter">
              <span>比赛日期</span>
              <input
                aria-label="比赛日期"
                type="date"
                value={custom}
                onChange={(e) => change(setCustom)(e.target.value)}
              />
            </label>
          )}
          <Select
            label="赛程联赛"
            value={league}
            onChange={change(setLeague)}
            values={[
              ["ALL", "全部已配置赛事"],
              ["jfa.emperors", "天皇杯 · JFA官方公告"],
              ...(data?.metadata?.leagues || []).map((l: any) => [
                l.code,
                l.name,
              ]),
              ...(mode === "DEMO" ? [["DEMO", "DEMO 合成赛事"]] : []),
            ]}
          />
          <Select
            label="赛程状态"
            value={status}
            onChange={change(setStatus)}
            values={[
              ["ALL", "全部状态"],
              ["CANDIDATE", "候选"],
              ["OBSERVING", "观察"],
              ["NO_EDGE", "无优势"],
              ["MISSING_DATA", "缺数据"],
              ["STALE_QUOTE", "报价失效"],
              ["MODEL_FAILED", "模型失败"],
              ["STARTED", "已开赛"],
              ["FINISHED", "已结束"],
            ]}
          />
          <label className="ws-filter search">
            <span>搜索球队 / 对阵</span>
            <input
              aria-label="搜索球队"
              placeholder="输入球队名称…"
              value={q}
              onChange={(e) => change(setQ)(e.target.value)}
            />
          </label>
        </div>
        <div className="ws-fixture-table">
          <div className="ws-fixture-row ws-table-heading">
            <span>开球 / 赛事</span>
            <span>对阵</span>
            <span>观察状态</span>
            <span>证据与验证</span>
            <span />
          </div>
          {data?.items.map((f: any) => (
            <Link
              className="ws-fixture-row"
              key={f.id}
              to={"/match/" + encodeURIComponent(f.id)}
            >
              <div>
                <strong>{time(f.kickoffAt)}</strong>
                <small>
                  {day(Date.parse(f.kickoffAt))} ·{" "}
                  {leagueName(f.competition, data.metadata.leagues)}
                </small>
              </div>
              <div className="ws-teams">
                <span className="ws-team-mark">{f.home.slice(0, 1)}</span>
                <strong>
                  {f.home}
                  <small>{f.away}</small>
                </strong>
              </div>
              <div>
                <span className={"ws-state state-" + f.state}>{f.label}</span>
                <small>{f.reason}</small>
              </div>
              <div>
                <strong>
                  {f.predictionCount
                    ? `${f.predictionCount} 份冻结预测`
                    : "等待完整输入"}
                </strong>
                <small>
                  {f.validation === "DEMO_ONLY"
                    ? "DEMO · 不是真实模型"
                    : f.validation === "LEGACY_NON_PROSPECTIVE"
                      ? "Legacy历史记录 · 不具前瞻资格"
                      : "实时V6/V7受阻 · 仍保留比赛"}
                </small>
              </div>
              <b className="ws-arrow">↗</b>
            </Link>
          ))}
        </div>
        {data && !data.items.length && (
          <div className="ws-empty">
            <strong>本筛选范围没有已载入比赛</strong>
            <p>
              这仅说明当前来源/范围没有记录，不代表现实中没有比赛。可查看“所有已知”或来源读取状态。
            </p>
            <Link to="/system">查看数据运行状态 →</Link>
          </div>
        )}
        <div className="ws-pagination">
          <span>
            第 {Math.floor(offset / 40) + 1} 页 · 共 {data?.total ?? "—"} 场
          </span>
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 40))}
          >
            上一页
          </button>
          <button
            disabled={data?.nextOffset === null || !data}
            onClick={() => setOffset(data.nextOffset)}
          >
            下一页
          </button>
        </div>
      </section>
      <p role="status" className="ws-notice">
        {notice}
      </p>
      {mode === "DEMO" && (
        <Link className="ws-tool-link" to="/demo-workbench">
          打开离线观察与纸面出票演练 →
        </Link>
      )}
    </div>
  );
}
export function FixtureWorkspace({ api }: Props) {
  const [market, setMarket] = useState("1X2");
  const { id } = useParams();
  const state = useData(api, "/workspace/fixtures/" + encodeURIComponent(id!));
  const { data } = state;
  if (!data)
    return (
      <div className="workspace-page">
        <Head n="MATCH / EVIDENCE" title="比赛研究" text="读取赛事与冻结证据" />
        <LoadState {...state} />
      </div>
    );
  const f = data.fixture,
    latest = data.quotes[0],
    publicOdds = data.publicData.providerOdds || [];
  return (
    <div className="workspace-page">
      <Link className="ws-back" to="/workbench">
        ← 返回完整赛程
      </Link>
      <Head
        n="MATCH / EVIDENCE"
        title="比赛研究"
        text={`${f.competition || "赛事"} · ${fmt(f.kickoffAt)} · ${f.status === "FINISHED" ? "已结束" : "赛程观察"}`}
      />
      <LoadState {...state} />
      <section className="ws-match-hero">
        <div>
          <span className="ws-large-mark">{f.home.slice(0, 1)}</span>
          <h2>{f.home}</h2>
        </div>
        <div className="ws-match-middle">
          <span>REGULATION / 90′</span>
          <strong>
            {data.adjudications[0]?.regulationJson
              ? (() => {
                  const s = JSON.parse(data.adjudications[0].regulationJson);
                  return `${s.home} : ${s.away}`;
                })()
              : "VS"}
          </strong>
          <small>{fmt(f.kickoffAt)}</small>
        </div>
        <div>
          <span className="ws-large-mark away">{f.away.slice(0, 1)}</span>
          <h2>{f.away}</h2>
        </div>
      </section>
      <div className="ws-note">
        赛前预测与报价永久冻结。赛后新增赛果与更正，不根据比分重算概率。实时来源不足时，历史记录仍可查看。
      </div>
      <div className="ws-detail-grid">
        <section className="ws-panel">
          <div className="ws-section-head">
            <h2>市场报价</h2>
            <span className="ws-state">来源与时间独立保留</span>
          </div>
          <div className="ws-market-tabs">
            {[
              ["1X2", "1X2"],
              ["AH", "亚洲盘"],
              ["TOTAL", "大小球"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={market === id ? "active secondary" : "secondary"}
                onClick={() => setMarket(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ws-odds-history">
            {market === "1X2" &&
              (data.savedQuotes?.oneXTwo || []).map((q: any) => (
                <div key={q.id}>
                  <span>
                    {q.provider} · 历史1X2
                    <br />
                    原抓取 {fmt(Number(q.captured_at))}
                  </span>
                  <b>
                    {[q.home_odds, q.draw_odds, q.away_odds]
                      .map((o: any) => Number(o).toFixed(3))
                      .join(" / ")}
                    <br />
                    <small>
                      市场去水{" "}
                      {(q.marketProbabilities || []).map(pct).join(" / ") ||
                        "不完整"}
                    </small>
                  </b>
                </div>
              ))}
            {market === "TOTAL" &&
              (data.savedQuotes?.markets || [])
                .filter((q: any) => q.market === "total-ft")
                .map((q: any) => (
                  <div key={q.id}>
                    <span>
                      {q.provider} · 全场大小球 {q.line}
                      <br />
                      原抓取 {fmt(Number(q.captured_at))} · {q.phase}
                    </span>
                    <b>
                      大 {Number(q.over_odds).toFixed(3)} / 小{" "}
                      {Number(q.under_odds).toFixed(3)}
                    </b>
                  </div>
                ))}
            {market === "AH" && (
              <p className="ws-muted">
                已有静态导出未包含亚洲盘价格；原票如有盘口，会在下方原样展示。
              </p>
            )}
            {((market === "TOTAL" && !data.savedQuotes?.markets?.length) ||
              (market === "1X2" && !data.savedQuotes?.oneXTwo?.length)) && (
              <p className="ws-caption">
                该历史来源未保存此市场；不会用最新时间或0替代。
              </p>
            )}
          </div>
          <Json
            value={data.savedQuotes || {}}
            label="旧源1X2/大小球原始值与抓取时间（Historical）"
          />
          {latest ? (
            <>
              <div className="ws-odds-grid">
                {["HOME", "DRAW", "AWAY"].map((side, i) => (
                  <Stat
                    key={side}
                    label={["主胜", "平局", "客胜"][i]}
                    value={latest.selections[side] || "—"}
                    detail={`去水 ${pct(latest.marketProbabilities?.[i])}`}
                  />
                ))}
              </div>
              <p className="ws-caption">
                {latest.providerId} · {latest.phase} · 报价抓取{" "}
                {fmt(latest.observedAt)} · 来源更新{" "}
                {fmt(latest.providerUpdatedAt)}
              </p>
              <div className="ws-odds-history">
                <h3>同源1X2变化</h3>
                {data.quotes.slice(0, 8).map((q: any) => (
                  <div key={q.id}>
                    <span>
                      {fmt(q.observedAt)} · {q.providerId}
                    </span>
                    <b>
                      {["HOME", "DRAW", "AWAY"]
                        .map((s) => q.selections[s] || "—")
                        .join(" / ")}
                    </b>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="ws-empty compact">
              <strong>尚无完整可核验的1X2报价</strong>
              <p>已保存的公开盘口与历史报价在下方保留原值；缺失不填0。</p>
            </div>
          )}
          <div className="ws-market-missing">
            <div>
              <strong>亚洲盘</strong>
              <span>
                {publicOdds.some(
                  (o: any) => o.spread !== undefined || o.homeTeamOdds?.spread,
                )
                  ? "公开来源参考盘口，见原始记录"
                  : "当前来源未提供；历史票盘口保留"}
              </span>
            </div>
            <div>
              <strong>大小球</strong>
              <span>
                {publicOdds.some((o: any) => o.overUnder !== undefined)
                  ? publicOdds
                      .map((o: any) => o.overUnder)
                      .filter(Boolean)
                      .join(" / ")
                  : "当前来源未提供；历史票盘口保留"}
              </span>
            </div>
          </div>
          {(data.publicData.legacyMarkets || []).length > 0 && (
            <div className="ws-odds-history">
              <h3>已保存历史盘口 · Non-prospective</h3>
              {data.publicData.legacyMarkets.map((q: any, i: number) => (
                <div key={i}>
                  <span>
                    {q.market} · {q.pick}{" "}
                    {q.line == null ? "" : `盘口 ${q.line}`}
                    <br />
                    {q.provider || "来源未记录"} · 报价 {fmt(q.priceCapturedAt)}
                  </span>
                  <b>{q.odds == null ? "—" : Number(q.odds).toFixed(3)}</b>
                </div>
              ))}
              <Json
                value={data.publicData.legacyMarkets}
                label="原票市场赔率、旧模型观测与解释（未经前瞻认证）"
              />
            </div>
          )}
          {publicOdds.length > 0 && (
            <Json
              value={publicOdds}
              label="公开来源盘口原值（可成交性/更新时间未验证）"
            />
          )}
          <Json value={data.quotes} label="报价ID、原始格式与冻结时间" />
        </section>
        <section className="ws-panel">
          <div className="ws-section-head">
            <h2>预测与入选原因</h2>
            <span className="ws-state">概率 ≠ 评分</span>
          </div>
          {data.predictions.map((p: any) => (
            <article className="ws-prediction" key={p.id}>
              <h3>{p.modelId}</h3>
              <div className="ws-probability">
                {p.central.map((v: number, i: number) => (
                  <div key={i}>
                    <small>{["主胜", "平局", "客胜"][i]}</small>
                    <strong>{pct(v)}</strong>
                    <i style={{ width: `${v * 100}%` }} />
                  </div>
                ))}
              </div>
              <p className="ws-caption">
                冻结截止 {fmt(p.cutoffAt)} · 计算 {fmt(p.calculatedAt)}
              </p>
              {p.expectations.map((e: any) => (
                <div key={e.id} className="ws-expectation">
                  <b>{e.selection}</b>
                  <span>estimated EV {pct(e.ev)}</span>
                  <small>
                    {e.accepted ? "研究候选" : "拒绝"} · {e.reason}
                  </small>
                </div>
              ))}
              <Json value={p} label="冻结预测与模型解释 / predictionId" />
            </article>
          ))}
          {!data.predictions.length && (
            <p className="ws-muted">
              尚无本场冻结预测。不会通过赛果补造赛前概率。
            </p>
          )}
          {data.models.map((m: any) => (
            <article className="ws-model-blocked" key={m.id}>
              <div>
                <h3>{m.label}</h3>
                <span className="ws-state">缺数据 · BLOCKED</span>
              </div>
              <p>{m.reason}</p>
              <small>{m.probabilityKind}</small>
            </article>
          ))}
          <div className="ws-separate-metrics">
            <span>
              model probability：{data.predictions.length ? "如上" : "未提供"}
            </span>
            <span>
              estimated EV：{data.predictions.length ? "读取冻结值" : "未计算"}
            </span>
            <span>
              evidence completeness：
              {data.quotes.length
                ? "有报价；实时特征仍缺"
                : "报价与实时特征缺失"}
            </span>
            <span>validation status：历史研究 / 未晋升</span>
          </div>
          <p className="ws-caption">
            研究排序分如存在，仅表示规则排序，不是命中概率或收益保证。
          </p>
        </section>
      </div>
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>原始数据与审计时间线</h2>
          <span>预测、赛果、更正分别保留</span>
        </div>
        <div className="ws-timeline">
          {data.adjudications.map((a: any) => (
            <div key={a.id}>
              <b>赛果 revision {a.revision}</b>
              <span>{a.state}</span>
              <small>{a.reason}</small>
            </div>
          ))}
        </div>
        {data.archives.map((a: any) => (
          <Json
            key={a.id}
            value={a}
            label={`Legacy关联记录 · ${a.portfolio} · ${a.title}`}
          />
        ))}
        <Json
          value={{
            fixture: f,
            source: data.publicData,
            sourceEvidence: data.sourceEvidence,
            observations: data.observations,
            adjudications: data.adjudications,
          }}
        />
        {f.competition === "DEMO" && (
          <Link to={"/fixtures/" + encodeURIComponent(f.id)}>
            打开DEMO纸面决策与确认 →
          </Link>
        )}
      </section>
    </div>
  );
}
const periods = [
  ["TODAY", "今日"],
  ["WEEK", "本周"],
  ["MONTH", "本月"],
  ["SEASON", "本赛季"],
  ["ALL", "全历史"],
];
export function HistoryWorkspace({
  api,
  ledger = false,
}: Props & { ledger?: boolean }) {
  const [filters, setFilters] = useState<Record<string, string>>({
      mode: "LEGACY_IMPORT",
      period: "ALL",
      league: "ALL",
      model: "ALL",
      market: "ALL",
      strategy:
        new URLSearchParams(window.location.search).get("strategy") || "ALL",
      currency: "ALL",
      odds: "ALL",
      score: "ALL",
      from: "",
      to: "",
      q: "",
    }),
    [offset, setOffset] = useState(0),
    [detail, setDetail] = useState<any>();
  const state = useData(
    api,
    `/workspace/${ledger ? "ledger" : "history"}?` +
      new URLSearchParams({ ...filters, offset: String(offset) }),
  );
  const { data } = state;
  const s = data?.summary;
  const change = (key: string) => (value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setOffset(0);
    setDetail(undefined);
  };
  const options = (key: string) => [
    ["ALL", "全部 / 含未知"],
    ...(data?.dimensions?.[key] || []).map((v: any) => [v, v]),
  ];
  return (
    <div className="workspace-page">
      <Head
        n={ledger ? "03 / LEDGER & REVIEW" : "02 / HISTORY"}
        title={ledger ? "账本与复盘" : "历史中心"}
        text={
          ledger
            ? "投入、结算、回撤，各有来源与分母。"
            : "保留过去的全部信息。历史可阅读，资格单独判断。"
        }
      >
        <Link className="ws-button secondary" to="/archives">
          原始档案与导入 ↗
        </Link>
      </Head>
      <LoadState {...state} />
      {ledger && (
        <div className="ws-ledger-modes">
          {[
            ["LEGACY_IMPORT", "历史票 / Legacy"],
            ["PAPER", "2.0纸面票"],
            ["USER_REPORTED", "手工实际声明"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={filters.mode === v ? "selected" : ""}
              onClick={() => change("mode")(v)}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <div className="ws-note">
        {filters.mode === "USER_REPORTED" && ledger
          ? "用户自行声明的成交与返还，不等同于服务器验证的输赢。"
          : ledger && filters.mode === "PAPER"
            ? "PAPER独立测试账本；不与旧票或实际记录相加。"
            : "LEGACY / HISTORICAL / NON-PROSPECTIVE · 原始票据与模型观测保留，不补造时间与缺失金额。"}{" "}
        数据截止：{fmt(data?.sourceCutoffAt)}
      </div>
      {ledger && (
        <>
          <div className="ws-pills ws-periods">
            {periods.map(([v, l]) => (
              <button
                className={filters.period === v ? "selected" : ""}
                onClick={() => change("period")(v)}
                key={v}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="ws-summary six">
            <Stat
              label="投入"
              value={amount(s?.stakeAtoms)}
              detail={s?.currencies?.join(" / ")}
            />
            <Stat label="净收益（已知已结）" value={amount(s?.profitAtoms)} />
            <Stat label="ROI" value={pct(s?.roi)} detail="分母：已结投入" />
            <Stat label="未结 / 待复核" value={s?.open ?? "—"} />
            <Stat label="已结" value={s?.settled ?? "—"} />
            <Stat
              label="最大净收益回撤"
              value={amount(s?.maxDrawdownAtoms)}
              detail="以结算时间排序"
            />
          </div>
          <section className="ws-panel ws-chart-panel">
            <div className="ws-section-head">
              <h2>累计已结净收益</h2>
              <span>
                缺金额 {s ? s.missingStake + s.missingProfit : "—"} · 不补造资金
              </span>
            </div>
            <Curve points={s?.curve || []} label="当前筛选已结净收益曲线" />
          </section>
          {s?.currencyMixed && (
            <p role="alert">
              当前包含多种币种，金额总计和ROI已禁用。请选择单一币种。
            </p>
          )}
        </>
      )}
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>
            {ledger ? "票据记录" : "历史档案"} <span>{data?.total ?? "—"}</span>
          </h2>
          <span>统计基于完整筛选集合，分页不改指标</span>
        </div>
        <div className="ws-filters wrap">
          <label className="ws-filter">
            <span>起始日期</span>
            <input
              aria-label="起始日期"
              type="date"
              value={filters.from}
              onChange={(e) => change("from")(e.target.value)}
            />
          </label>
          <label className="ws-filter">
            <span>结束日期</span>
            <input
              aria-label="结束日期"
              type="date"
              value={filters.to}
              onChange={(e) => change("to")(e.target.value)}
            />
          </label>
          <Select
            label="历史联赛"
            value={filters.league}
            onChange={change("league")}
            values={options("leagues")}
          />
          <Select
            label="历史模型"
            value={filters.model}
            onChange={change("model")}
            values={options("models")}
          />
          <Select
            label="历史市场"
            value={filters.market}
            onChange={change("market")}
            values={options("markets")}
          />
          <Select
            label="历史策略"
            value={filters.strategy}
            onChange={change("strategy")}
            values={options("strategy")}
          />
          {ledger && (
            <>
              <Select
                label="赔率区间"
                value={filters.odds}
                onChange={change("odds")}
                values={[
                  ["ALL", "全部赔率"],
                  ["LOW", "低于1.80"],
                  ["MID", "1.80–2.49"],
                  ["HIGH", "2.50及以上"],
                ]}
              />
              <Select
                label="评分区间"
                value={filters.score}
                onChange={change("score")}
                values={[
                  ["ALL", "全部 / 含未记录"],
                  ["HIGH", "75及以上"],
                  ["MID", "45–74"],
                  ["LOW", "低于45"],
                ]}
              />
              <Select
                label="统计币种"
                value={filters.currency}
                onChange={change("currency")}
                values={options("currency")}
              />
            </>
          )}
          <label className="ws-filter search">
            <span>搜索历史记录</span>
            <input
              aria-label="搜索历史记录"
              placeholder="对阵 / 策略 / ID"
              value={filters.q}
              onChange={(e) => change("q")(e.target.value)}
            />
          </label>
        </div>
        <div className="ws-records">
          {data?.items.map((r: any) => (
            <button
              className="ws-record-row"
              key={r.id}
              onClick={() => setDetail(r)}
            >
              <div>
                <span className="ws-record-tag">{r.kind || r.mode}</span>
                <small>{fmt(r.at)}</small>
              </div>
              <div>
                <strong>{r.title}</strong>
                <small>
                  {r.portfolio} · {r.leagues.join(" / ") || "联赛未知"} ·{" "}
                  {r.markets.join(" / ")}
                </small>
              </div>
              <div>
                <strong>
                  {r.odds == null ? "—" : Number(r.odds).toFixed(3)}
                </strong>
                <small>赔率 · {r.legCount ?? "—"} 腿</small>
              </div>
              <div>
                <strong>{amount(r.pnlAtoms)}</strong>
                <small>
                  {r.status} ·{" "}
                  {r.currency === "UNKNOWN" ? "原币种未记录" : r.currency}
                </small>
              </div>
              <b>↗</b>
            </button>
          ))}
        </div>
        {data?.total === 0 && (
          <div className="ws-empty">
            当前筛选无记录。可清除筛选查看全历史；未知字段不会填0。
          </div>
        )}
        <div className="ws-pagination">
          <span>
            共 {data?.total ?? "—"} 条 · 第 {offset / 40 + 1} 页
          </span>
          <button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 40))}
          >
            上一页
          </button>
          <button
            disabled={data?.nextOffset === null || !data}
            onClick={() => setOffset(data.nextOffset)}
          >
            下一页
          </button>
        </div>
      </section>
      {detail && (
        <section className="ws-panel ws-selected-record">
          <div className="ws-section-head">
            <h2>原始记录 · {detail.portfolio}</h2>
            <button onClick={() => setDetail(undefined)}>关闭详情</button>
          </div>
          <p>{detail.title}</p>
          <div className="ws-note">
            原始解释、评分、概率、盘口与赛果均按当时保存值展示；其中0或缺字段不等同于已验证模型概率。
          </div>
          <div className="ws-bottom-links">
            {detail.fixtureLinks?.map((f: any) => (
              <Link
                className="ws-fixture-link"
                key={f.id}
                to={"/match/" + encodeURIComponent(f.id)}
              >
                {f.home} — {f.away} · 比赛详情 →
              </Link>
            ))}
          </div>
          {(detail.raw.legs || (detail.raw.leg ? [detail.raw.leg] : []))?.map(
            (l: any, i: number) => (
              <article className="ws-leg" key={i}>
                <h3>
                  {l.home} — {l.away}
                </h3>
                <p>
                  注项 {l.pickName ?? l.pick ?? "未知"} · 赔率{" "}
                  {l.odds ?? "未记录"} · {l.marketType ?? l.market ?? "1X2"} ·
                  盘口 {l.line ?? l.handicap ?? l.total ?? "未记录"}
                </p>
                <p>
                  报价：{l.provider || "来源未知"} · {fmt(l.priceCapturedAt)} ·{" "}
                  {l.phase || "时相未知"}
                </p>
                <p>{l.rationale?.join("；")}</p>
                <Json value={l} label="本腿原始预测、盘口与结算证据" />
              </article>
            ),
          )}
          <Json value={detail} label="完整原始记录与内容hash" />
        </section>
      )}
      {ledger && (
        <div className="ws-bottom-links">
          <Link to="/demo-ledger">纸面出票 / 结算 / 更正与完整导出 →</Link>
          <Link to="/reported">登记或更正手工实际声明 →</Link>
        </div>
      )}
    </div>
  );
}
export function LaboratoryWorkspace({ api }: Props) {
  const [season, setSeason] = useState("ALL"),
    [league, setLeague] = useState("ALL"),
    [odds, setOdds] = useState("ALL");
  const state = useData(
    api,
    "/workspace/models?" + new URLSearchParams({ season, league, odds }),
    60000,
  );
  const { data } = state;
  return (
    <div className="workspace-page">
      <Head
        n="04 / MODEL LABORATORY"
        title="模型实验室"
        text="比较同一批样本，而不是比较包装后的收益。"
      >
        <Link className="ws-button secondary" to="/registry">
          模型登记与冻结评估 ↗
        </Link>
      </Head>
      <LoadState {...state} />
      <div className="ws-note">
        {data?.scope || "读取研究口径"} · 本次固定重放不等同于严格前瞻。数据截止{" "}
        {fmt(data?.sourceCutoffAt)} · 不自动晋升。
      </div>
      <div className="ws-filters">
        <Select
          label="研究赛季"
          value={season}
          onChange={setSeason}
          values={[
            ["ALL", "全部共同样本"],
            ...(data?.seasons || []).map((s: string) => [s, s]),
          ]}
        />
        <Select
          label="研究联赛"
          value={league}
          onChange={setLeague}
          values={[
            ["ALL", "全部共同样本联赛"],
            ...(data?.leagues || []).map((s: string) => [s, s]),
          ]}
        />
        <Select
          label="研究赔率区间"
          value={odds}
          onChange={setOdds}
          values={[
            ["ALL", "全部 / 含无行动"],
            ["LOW", "动作赔率 <1.80"],
            ["MID", "动作赔率 1.80–2.49"],
            ["HIGH", "动作赔率 ≥2.50"],
          ]}
        />
      </div>
      <div className="ws-model-comparison">
        {data?.models.map((m: any, i: number) => (
          <section className="ws-lab-model" key={m.id}>
            <div className="ws-section-label">
              <span>
                0{i + 1} /{" "}
                {m.kind === "SELECTION_STRESS_ONLY"
                  ? "STRESS ONLY"
                  : "CENTRAL 1X2"}
              </span>
              <b>研究</b>
            </div>
            <h2>{m.label}</h2>
            <small>{m.validation}</small>
            <div className="ws-lab-primary">
              <span>研究动作 ROI</span>
              <strong>{pct(m.metrics.roi)}</strong>
              <small>1单位平注 · 非真实账户成交</small>
            </div>
            <div className="ws-lab-metrics">
              {[
                ["N（动作）", m.metrics.count],
                ["预测样本", m.metrics.eligibleN],
                ["wins / losses", `${m.metrics.wins} / ${m.metrics.losses}`],
                ["avg odds", m.metrics.avgOdds?.toFixed(3) ?? "—"],
                ["drawdown（单位）", amount(m.metrics.maxDrawdownAtoms)],
                ["coverage", pct(m.metrics.coverage)],
                ["LogLoss", m.metrics.logLoss?.toFixed(4) ?? "不适用"],
                ["Brier", m.metrics.brier?.toFixed(4) ?? "不适用"],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            {m.kind === "SELECTION_STRESS_ONLY" && (
              <p className="ws-caption">
                V6逐方向压力输出不归一化，不进入三分类LogLoss/Brier/校准。
              </p>
            )}
            <Json
              value={{
                sampleRange: m.sampleRange,
                sampleManifestHash: m.sampleManifestHash,
                artifactHash: m.artifactHash,
                trainCutoff: m.trainCutoff,
                calibrationCutoff: m.calibrationCutoff,
                fixedBlend: m.fixedBlend,
              }}
              label="固定变体、样本范围、训练/校准截止"
            />
          </section>
        ))}
      </div>
      {data?.models.map((m: any) => (
        <section className="ws-panel" key={"samples:" + m.id}>
          <div className="ws-section-head">
            <h2>{m.label} · 逐场研究证据</h2>
            <span>
              {m.sampleRange.from || "无样本"} — {m.sampleRange.to || "无样本"}
            </span>
          </div>
          <p className="ws-caption">
            当前筛选的前20场原始推断输出。历史重放不是赛前捕获；V6压力值分别保留，没有归一化。
          </p>
          {m.samplePreview.map((r: any) => (
            <div className="ws-odds-history" key={r.fixtureId}>
              <div>
                <span>
                  {r.date} · {r.home} — {r.away}
                </span>
                <b>
                  {r.action === "NO_ACTION" ? "无行动" : r.action} · EV{" "}
                  {pct(r.estimatedEV)}
                </b>
              </div>
              <Json
                value={{
                  model: m.id,
                  fixtureId: r.fixtureId,
                  marketOdds: r.marketOdds,
                  central: r.central,
                  stressBySelection: r.stressBySelection,
                  priceSource: r.priceSource,
                  validation: m.validation,
                }}
                label="查看市场、概率/压力值与来源口径"
              />
            </div>
          ))}
        </section>
      ))}
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>当前赛季 · 严格前瞻表现</h2>
          <span>与上方历史重放分开</span>
        </div>
        <div className="ws-summary">
          <Stat label="前瞻 N" value={data?.prospective.n ?? "—"} />
          <Stat label="前瞻 ROI" value={pct(data?.prospective.roi)} />
          <Stat
            label="状态"
            value="缺必要输入"
            detail="不会把历史日期作为原始捕获时间"
          />
        </div>
      </section>
      {data?.models.map((m: any) => (
        <section className="ws-panel" key={m.id}>
          <div className="ws-section-head">
            <h2>{m.label} · 分组复盘</h2>
            <span>本次共同样本</span>
          </div>
          <div className="ws-group-tables">
            {m.groups.map((g: any) => (
              <div key={g.key}>
                <h3>
                  {
                    (
                      {
                        season: "分赛季",
                        competition: "分联赛",
                        oddsBand: "分赔率区间",
                      } as any
                    )[g.key]
                  }
                </h3>
                <table>
                  <thead>
                    <tr>
                      <th>范围</th>
                      <th>N / 预测</th>
                      <th>胜 / 负</th>
                      <th>ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r: any) => (
                      <tr key={r.value}>
                        <td>{r.value}</td>
                        <td>
                          {r.n} / {r.eligibleN}
                        </td>
                        <td>
                          {r.wins} / {r.losses}
                        </td>
                        <td>{pct(r.roi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <h3>校准 / 覆盖</h3>
          {m.metrics.calibration.length ? (
            <div className="ws-calibration">
              {m.metrics.calibration.map((b: any) => (
                <div key={b.lower}>
                  <span>
                    {Math.round(b.lower * 100)}–
                    {Math.round((b.lower + 0.1) * 100)}%
                  </span>
                  <i style={{ width: `${b.predicted * 100}%` }} />
                  <b>{pct(b.observed)}</b>
                  <small>
                    N={b.n} · 预测均值 {pct(b.predicted)}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="ws-muted">
              压力输出无完整三分类校准；不显示伪校准图。
            </p>
          )}
        </section>
      ))}
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>原研究包 · 跨赛季报告</h2>
          <span>原档案报告，与本次重放分开</span>
        </div>
        {data?.originalSeasonReports.map((report: any) => (
          <details className="ws-audit" key={report.source}>
            <summary>
              {report.source} · {report.rows.length} 项
            </summary>
            <div className="ws-table-scroll">
              <table>
                <thead>
                  <tr>
                    {Object.keys(report.rows[0] || {}).map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r: any, i: number) => (
                    <tr key={i}>
                      {Object.values(r).map((v: any, j) => (
                        <td key={j}>{v === null ? "—" : String(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small>
              source hash：{report.hash} · {report.scope}
            </small>
          </details>
        ))}
        <ul>
          {data?.limitations.map((s: string) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
export function RuntimeWorkspace({ api, mode }: Props) {
  const state = useData(api, "/workspace/status", 10000);
  const { data, refresh } = state;
  const [message, setMessage] = useState("");
  const automation = data?.automation[0];
  async function run() {
    setMessage("正在立即读取来源…");
    try {
      const r = await api("/workspace/refresh", {});
      setMessage(
        r.state === "FAILED"
          ? r.reason
          : r.state === "DEMO_OFFLINE"
            ? "离线DEMO不访问真实来源。"
            : r.stage === "RUNNING" || r.state === "BUSY"
              ? "自动读取正在进行，请查看来源日志。"
              : r.enabled === 0
                ? "来源轮转已暂停。"
                : "已完成本轮；自动运行继续按计划轮转。",
      );
      await refresh();
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <div className="workspace-page">
      <Head
        n="05 / DATA OPERATIONS"
        title="数据运行状态"
        text="来源、模型和账本分别报告。失败有原因，正常运行自动推进。"
      >
        <button onClick={run}>立即刷新 / 重试 ↗</button>
      </Head>
      <LoadState {...state} />
      <div className="ws-summary">
        <Stat
          label="本地运行"
          value={
            mode === "DEMO"
              ? "离线DEMO"
              : automation?.enabled
                ? "自动运行"
                : "已暂停"
          }
        />
        <Stat
          label="Python任务领取器"
          value={
            data?.runner.some(
              (r: any) => Date.now() - Date.parse(r.lastSeenAt) < 90000,
            )
              ? "在线"
              : "等待心跳"
          }
        />
        <Stat label="上次自动成功" value={fmt(automation?.lastSuccessAt)} />
        <Stat label="下次计划" value={fmt(automation?.nextRunAt)} />
      </div>
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>本地自动流程</h2>
          {automation && (
            <button
              className="secondary"
              onClick={async () => {
                await api("/workspace/automation", {
                  enabled: !automation.enabled,
                });
                await refresh();
              }}
            >
              {automation.enabled ? "暂停新来源轮转" : "恢复来源轮转"}
            </button>
          )}
        </div>
        <div className="ws-pipeline">
          {[
            "赛程发现",
            "报价刷新",
            "冻结输入",
            "模型领取",
            "固定决策",
            "结果观察",
            "无冲突裁定",
            "已有纸面票结算",
          ].map((s, i) => (
            <div key={s}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <strong>{s}</strong>
              <small>
                {i === 1
                  ? "来源无价明确缺失"
                  : i === 2
                    ? "必要输入满足才冻结"
                    : i === 3
                      ? "V6/V7实时仍受阻"
                      : i === 7
                        ? "原子幂等；不自动新出票"
                        : "自动 / 事件驱动"}
              </small>
            </div>
          ))}
        </div>
        <p className="ws-note">
          手动刷新用于立即读取、重试或复核。正常真实研究模式自动轮转已迁移的联赛清单；来源失败不会成为“无机会”。新纸面出票仍需用户明确动作。
        </p>
        <p role="status">{message}</p>
        {automation?.reason && (
          <Json
            value={(() => {
              try {
                return JSON.parse(automation.reason);
              } catch {
                return automation.reason;
              }
            })()}
            label="最近流程结果与受阻原因"
          />
        )}
      </section>
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>来源读取日志</h2>
          <span>最后30次 · 原始证据已单独保存</span>
        </div>
        {data?.sources.map((s: any) => (
          <div className="ws-source-row" key={s.id}>
            <div>
              <strong>{s.competition}</strong>
              <small>{s.providerId}</small>
            </div>
            <span className="ws-state">
              {s.state === "EMPTY" ? "当前来源返回空集" : s.state}
            </span>
            <span>{s.normalizedCount} 场</span>
            <div>
              <small>{fmt(s.startedAt)}</small>
              <p>{s.reason}</p>
            </div>
          </div>
        ))}
      </section>
      <section className="ws-panel">
        <h2>模型队列</h2>
        <div className="ws-summary">
          {data?.queue.map((q: any) => (
            <Stat key={q.state} label={q.state} value={q.count} />
          ))}
        </div>
        <Link to="/system-details">安装身份、schema与完整状态 →</Link>
      </section>
    </div>
  );
}
export function LegacyWorkspace({ api }: Props) {
  const state = useData(api, "/workspace/settings", 60000);
  const { data } = state;
  return (
    <div className="workspace-page">
      <Head
        n="LEGACY / READ ONLY"
        title="旧版功能对照"
        text="旧设置与十策略保留在独立只读视图，方便逐项核对。"
      />
      <LoadState {...state} />
      <div className="ws-note">
        此入口仅读取2.0的新只读档案，不加载旧写入脚本，不连接旧活动D1。原始快照截止{" "}
        {fmt(data?.sourceCutoffAt)}。
      </div>
      <div className="ws-legacy-nav">
        <Link to="/workbench">找比赛 ↗</Link>
        <Link to="/history">看历史研究 ↗</Link>
        <Link to="/ledger">模拟与统计 ↗</Link>
        <Link to="/models">模型实验室 ↗</Link>
      </div>
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>官方杯赛观察</h2>
          <Link to="/workbench?league=jfa.emperors">
            天皇杯官方已公布赛程 →
          </Link>
        </div>
        <p className="ws-caption">
          旧版JFA第三轮公告进入完整赛程，自动读取原始公告。官方公告只确认赛程，不推断比分或赔率。
        </p>
        <a
          href="https://www.jfa.jp/match/news/00036688/"
          target="_blank"
          rel="noopener noreferrer"
        >
          日本足协原公告 ↗
        </a>
      </section>
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>旧十策略配置</h2>
          <span>已自动读取，不必重新输入</span>
        </div>
        <div className="ws-strategies">
          {data?.strategies.map((p: any) => (
            <article key={p.id}>
              <span>{p.id}</span>
              <h3>{p.name}</h3>
              <p>{p.rule}</p>
              <small>
                {p.legs} 腿 · 旧开关 {p.enabled ? "启用" : "关闭"} · 均注{" "}
                {p.stake} · 上限 {p.maxTickets}
              </small>
              <Link to={"/ledger?strategy=" + encodeURIComponent(p.id)}>
                在历史账本查看 →
              </Link>
            </article>
          ))}
        </div>
        <Json
          value={data?.settings}
          label="原个人模拟设置（只读，不自动恢复出票开关）"
        />
        <Json value={data?.sourceFiles} label="静态导出文件与SHA256" />
      </section>
      <section className="ws-panel">
        <h2>已迁移联赛清单</h2>
        <div className="ws-leagues">
          {data?.leagues.map((l: any) => (
            <span key={l.code}>
              {l.name}
              <small>{l.code}</small>
            </span>
          ))}
        </div>
      </section>
      <HypothesisCalculator />
    </div>
  );
}
function HypothesisCalculator() {
  const [odds, setOdds] = useState(""),
    [probability, setProbability] = useState(""),
    [budget, setBudget] = useState("");
  const o = Number(odds),
    p = Number(probability) / 100,
    b = Number(budget),
    valid =
      odds !== "" &&
      probability !== "" &&
      budget !== "" &&
      o > 1 &&
      p > 0 &&
      p < 1 &&
      b > 0;
  return (
    <section className="ws-panel">
      <h2>个人假设计算器</h2>
      <p className="ws-caption">
        只计算你输入的假设，不使用模型或行情，不生成票据。
      </p>
      <div className="ws-filters">
        {[
          ["假设十进制赔率", odds, setOdds],
          ["自行假设概率（%）", probability, setProbability],
          ["可承受损失预算", budget, setBudget],
        ].map(([label, value, setter]: any) => (
          <label className="ws-filter" key={label}>
            <span>{label}</span>
            <input
              type="number"
              aria-label={label}
              value={value}
              onChange={(e) => setter(e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="ws-summary">
        <Stat label="假设EV" value={valid ? pct(p * o - 1) : "—"} />
        <Stat label="输入预算" value={valid ? b.toFixed(2) : "—"} />
      </div>
    </section>
  );
}
