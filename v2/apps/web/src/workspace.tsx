import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  teamName,
  calendarDay,
  formatDate,
  formatTime,
  DISPLAY_TIME_ZONE,
} from "../../../packages/display";
import { useReport } from "./use-report";
import { LedgerReview } from "./ledger-review";
import { TicketCards, StrategyBalances, DailyLedger } from "./ticket-cards";
import { CurrentMarkets, MatchContext, QuoteHistory } from "./match-evidence";
import {
  FixtureList,
  Recommendations,
  TeamBadge,
  Scoreboard,
} from "./schedule-view";
import { ComparisonPanel } from "./comparison-view";
import { UniversalPanel, GeneralLaboratory } from "./universal-view";
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
const fmt = (x: any) => (x == null ? "未记录" : formatDate(x));
const day = (x: number | string) => calendarDay(x);
const leagueName = (code: string, leagues: any[] = []) =>
  leagues.find((l) => l.code === code)?.name || code;
const time = (x: any) => formatTime(x);
function useData(api: Client, path: string, poll = 30000) {
  return useReport(api, path, 0, poll);
}
function LoadState({ error, data, busy }: any) {
  return (
    <div
      className={"ws-read-state" + (data && !error ? " quiet" : "")}
      data-testid="load-status"
      data-loaded={data !== undefined}
      role={error ? "alert" : "status"}
    >
      {error
        ? `读取失败：${error}。${data ? "当前显示上次成功快照" : "可使用立即刷新重试"}`
        : busy
          ? data
            ? ""
            : "正在读取战绩…"
          : ""}
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
  const [selected, setSelected] = useState<number | null>(null);
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
  const index = Math.min(selected ?? points.length - 1, points.length - 1),
    chosen = points[index];
  return (
    <div>
      <svg
        className="ws-curve"
        viewBox="0 0 740 180"
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setSelected(
            Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(
                  ((e.clientX - rect.left) / rect.width) * points.length,
                ) - 1,
              ),
            ),
          );
        }}
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
          结算顺序（逐票）
        </text>
        <text x="648" y="176">
          最新结算
        </text>
        <text x="24" y="20">
          {amount(String(hi))}
        </text>
        <text x="24" y="147">
          {amount(String(lo))}
        </text>
      </svg>
      <details className="ws-audit">
        <summary>逐票结算与回撤明细</summary>
        <label className="curve-selector">
          查看结算点
          <input
            aria-label="选择结算记录"
            type="range"
            min="0"
            max={points.length - 1}
            value={index}
            onChange={(e) => setSelected(Number(e.target.value))}
          />
        </label>
        <p className="ws-caption" aria-live="polite">
          第 {index + 1} 笔 · {fmt(chosen?.at)} · 累计净收益{" "}
          {amount(chosen?.profitAtoms)} · 当时回撤{" "}
          {amount(chosen?.drawdownAtoms)}
        </p>
        <div className="ws-table-scroll">
          <table>
            <thead>
              <tr>
                <th>结算时间</th>
                <th>累计净收益</th>
                <th>峰值</th>
                <th>回撤</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p: any, i: number) => (
                <tr key={i}>
                  <td>{fmt(p.at)}</td>
                  <td>{amount(p.profitAtoms)}</td>
                  <td>{amount(p.peakAtoms)}</td>
                  <td>{amount(p.drawdownAtoms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
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
            {teamName(r.home, r.competition || r.leagueCode)} <span>vs</span>{" "}
            {teamName(r.away, r.competition || r.leagueCode)}
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
  const [view, setView] = useState(
    new URLSearchParams(window.location.search).get("view") || "ACTIVE",
  );
  const [trackingModel, setTrackingModel] = useState(
    new URLSearchParams(window.location.search).get("trackingModel") || "ALL",
  );
  const [period, setPeriod] = useState(
      new URLSearchParams(window.location.search).get("period") ||
        (mode === "LOCAL_RESEARCH" &&
        !["LIVE", "RESULTS", "TRACKED"].includes(
          new URLSearchParams(window.location.search).get("view") || "ACTIVE",
        )
          ? "TODAY"
          : "RECENT"),
    ),
    [custom, setCustom] = useState(
      new URLSearchParams(window.location.search).get("custom") ||
        day(Date.now()),
    ),
    [league, setLeague] = useState(
      new URLSearchParams(window.location.search).get("league") || "ALL",
    ),
    [status, setStatus] = useState(
      new URLSearchParams(window.location.search).get("status") || "ALL",
    ),
    [q, setQ] = useState(
      new URLSearchParams(window.location.search).get("q") || "",
    ),
    [offset, setOffset] = useState(
      Number(new URLSearchParams(window.location.search).get("offset") || 0),
    );
  const from =
    period === "ALL"
      ? ""
      : period === "CUSTOM"
        ? custom
        : day(
            Date.now() +
              (period === "TOMORROW"
                ? 86400000
                : period === "YESTERDAY"
                  ? -86400000
                  : period === "RECENT"
                    ? -6 * 86400000
                    : 0),
          );
  const to = period === "RECENT" ? day(Date.now() + 6 * 86400000) : from;
  const query = new URLSearchParams({
    from,
    to,
    league,
    status,
    q,
    offset: String(offset),
    upcoming: "0",
    view,
    trackingModel,
  });
  useEffect(() => {
    const url =
      "/workbench?" +
      new URLSearchParams({
        period,
        view,
        trackingModel,
        custom,
        league,
        status,
        q,
        offset: String(offset),
      });
    window.history.replaceState(null, "", url);
    sessionStorage.setItem("v2-schedule-location", url);
  }, [period, view, trackingModel, custom, league, status, q, offset]);
  const state = useData(api, "/workspace/schedule?" + query);
  const { data, refresh } = state;
  const restoredScroll = useRef(false);
  useEffect(() => {
    if (!data || restoredScroll.current) return;
    restoredScroll.current = true;
    const at = sessionStorage.getItem("v2-schedule-scroll");
    if (at) requestAnimationFrame(() => window.scrollTo(0, Number(at)));
    sessionStorage.removeItem("v2-schedule-scroll");
  }, [data]);
  const [notice, setNotice] = useState("");
  const [showComparison, setShowComparison] = useState(false);
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
        title="比赛与推荐"
        text="赛前看方向，开赛追比分，赛后查原预测。"
      >
        <button onClick={manual}>
          立即刷新 <span>↗</span>
        </button>
        <small>自动读取 · 每30秒更新视图</small>
        <Link
          className="ws-button secondary"
          to="/ledger?mode=PAPER_RESEARCH&period=YESTERDAY&basis=PLACED"
        >
          昨天投了什么、赢没赢 →
        </Link>
        {mode === "LOCAL_RESEARCH" && (
          <Link className="ws-tool-link" to="/models#parallel">
            V6 与旧版V2并行比较 →
          </Link>
        )}
      </Head>
      <LoadState {...state} />
      <div className="schedule-overview">
        <span>
          近期 <b>{data?.total ?? "—"}</b> 场
        </span>
        <span>已知目录 {data?.totalKnown ?? "—"} 场</span>
        <span>自动读取公开来源</span>
        <span>时间：柏林 / Europe/Berlin</span>
      </div>
      <nav className="lifecycle-tabs" aria-label="比赛进程">
        {[
          ["ACTIVE", "比赛"],
          ["UPCOMING", "未开赛"],
          ["LIVE", "进行中"],
          ["RESULTS", "近期赛果"],
          ["TRACKED", "推荐跟踪"],
          ["ALL", "全部赛事"],
        ].map(([v, label]) => (
          <button
            key={v}
            aria-pressed={view === v}
            className={view === v ? "selected" : "secondary"}
            onClick={() => {
              setView(v);
              if (
                ["LIVE", "RESULTS", "TRACKED"].includes(v) &&
                period === "TODAY"
              )
                setPeriod("RECENT");
              setStatus("ALL");
              setOffset(0);
            }}
          >
            {label}
            <b>{data?.lifecycleCounts?.[v] ?? "—"}</b>
          </button>
        ))}
      </nav>
      <a className="ws-tool-link schedule-jump" href="#fixtures">
        跳到完整赛程与筛选 ↓
      </a>
      {["ACTIVE", "UPCOMING", "ALL"].includes(view) &&
        (mode === "LOCAL_RESEARCH" ? (
          <>
            <UniversalPanel api={api} />
            <details className="ws-panel">
              <summary>旧市场 / 近期战绩启发式研究</summary>
              <p>
                该方法未调整对手强度，容易将高赔率方向排在前列；仅保留对照。
              </p>
              <Recommendations
                data={data}
                onSelect={(filter?: string) => {
                  if (typeof filter === "string") {
                    setView("UPCOMING");
                    change(setStatus)(filter);
                  } else
                    sessionStorage.setItem(
                      "v2-schedule-scroll",
                      String(window.scrollY),
                    );
                }}
              />
            </details>
          </>
        ) : (
          <Recommendations data={data} onSelect={() => {}} />
        ))}
      <section className="ws-panel" id="fixtures">
        <div className="ws-section-head">
          <h2>
            {view === "LIVE"
              ? "进行中与开赛待确认"
              : view === "RESULTS"
                ? "已结束与赛果待确认"
                : view === "TRACKED"
                  ? "保存的赛前推荐"
                  : "赛程目录"}{" "}
            <span>{data?.total ?? "—"}</span>
          </h2>
          <div className="ws-pills" aria-label="赛程日期范围">
            {[
              ["TODAY", "今日"],
              ["YESTERDAY", "昨日"],
              ["TOMORROW", "明日"],
              ["RECENT", "近期"],
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
        <p className="lifecycle-description">
          {view === "TRACKED"
            ? "市场/近期赛况首次入选，以及V6、旧V2保存的赛前方向；开赛和结束后继续保留。研究记录不是实际票据。"
            : view === "LIVE"
              ? "进行中比赛与已到开球时间、等待来源确认的比赛。比分和分钟来自来源，不按电脑时间推算。"
              : view === "RESULTS"
                ? "最近结束的比赛和仍待确认的赛果；只核验90分钟结果，不将加时或点球混入结算。"
                : "进行中的比赛优先，接着是未开赛赛程。结束的比赛可在“近期赛果”查看。"}{" "}
          {period === "RECENT" ? `${from} 至 ${to} · 柏林日期` : ""}
        </p>
        {view === "TRACKED" && (
          <div className="tracking-model-tabs ws-pills" aria-label="推荐算法">
            {(data?.version?.id && data.version.id !== "GENERAL"
              ? [["ALL", data.version.label]]
              : [
                  ["ALL", "全部算法"],
                  ["GENERAL", "通用赛前分析"],
                  ["V6", "V6 配置388"],
                  ["V2", "9月20日 V2"],
                  ["RESEARCH", "市场 / 近期赛况"],
                ]
            ).map(([id, label]) => (
              <button
                key={id}
                className={trackingModel === id ? "selected" : "secondary"}
                aria-pressed={trackingModel === id}
                onClick={() => {
                  setTrackingModel(id);
                  setOffset(0);
                }}
              >
                {label} · {data?.trackingModelCounts?.[id] ?? "—"}
              </button>
            ))}
          </div>
        )}
        <details
          className="schedule-filters"
          open={
            period === "CUSTOM" || league !== "ALL" || status !== "ALL" || !!q
          }
        >
          <summary>
            筛选联赛、状态和球队{" "}
            {league !== "ALL" || status !== "ALL" || q ? "· 已筛选" : ""}
          </summary>
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
              onChange={(v: string) => {
                setView("ALL");
                change(setStatus)(v);
              }}
              values={[
                ["ALL", "全部状态"],
                ["CANDIDATE", "候选"],
                ["OBSERVING", "观察"],
                ["WATCH", "全部待观察（含待补证）"],
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
        </details>
        <FixtureList
          data={data}
          onSelect={() =>
            sessionStorage.setItem("v2-schedule-scroll", String(window.scrollY))
          }
        />
        {data && !data.items.length && (
          <div className="ws-empty">
            <strong>本筛选范围没有已载入比赛</strong>
            <p>
              这仅说明当前来源/范围没有记录，不代表现实中没有比赛。可清除筛选、查看所有已知日期或来源读取状态。
            </p>
            <button
              className="secondary"
              onClick={() => {
                setView("ALL");
                setPeriod("ALL");
                setLeague("ALL");
                setStatus("ALL");
                setQ("");
                setOffset(0);
              }}
            >
              显示全部已知比赛
            </button>
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
      {mode === "LOCAL_RESEARCH" && (
        <details
          className="comparison-summary"
          onToggle={(e) => setShowComparison(e.currentTarget.open)}
        >
          <summary>V6 与9月20日 V2 · 展开并行统计</summary>
          {showComparison && <ComparisonPanel api={api} compact />}
        </details>
      )}
      {mode === "DEMO" && (
        <Link className="ws-tool-link" to="/demo-workbench">
          打开离线观察与纸面出票演练 →
        </Link>
      )}
    </div>
  );
}
export function FixtureWorkspace({ api, mode }: Props) {
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
    publicOdds = (data.publicData.providerOdds || []).filter(
      (o: any) => o && typeof o === "object",
    );
  return (
    <div className="workspace-page">
      <Link
        className="ws-back"
        to={sessionStorage.getItem("v2-schedule-location") || "/workbench"}
      >
        ← 返回完整赛程
      </Link>
      <Head
        n="MATCH / EVIDENCE"
        title="比赛研究"
        text={`${data.competitionName || "赛事"} · ${fmt(f.kickoffAt)} · ${data.displayState?.label ?? "赛程观察"}`}
      />
      <LoadState {...state} />
      <section className="ws-match-hero">
        <div>
          <TeamBadge name={f.home} logo={data.publicData?.homeLogo} />
          <h2>{teamName(f.home, f.competition || f.leagueCode)}</h2>
        </div>
        <div className="ws-match-middle">
          <span>
            {data.scoreboard?.kind === "ACCEPTED_REGULATION"
              ? "REGULATION / 90′"
              : f.status === "LIVE"
                ? "比赛进展"
                : data.scoreboard?.score
                  ? "来源终场比分"
                  : "开球时间与比分"}
          </span>
          <strong>
            {data.scoreboard?.score
              ? data.scoreboard.score.map((n: any) => n ?? "—").join(" : ")
              : data.archivedScore?.length === 1
                ? data.archivedScore[0]
                : f.status === "FINISHED"
                  ? "比分未核验"
                  : "VS"}
          </strong>
          <small>{fmt(f.kickoffAt)}</small>
          {(data.scoreboard?.score || f.status === "LIVE") && (
            <Scoreboard value={data.scoreboard} compact />
          )}
          {!data.adjudications.length && data.archivedScore?.length > 0 && (
            <small>
              {data.archivedScore.length === 1
                ? "旧档保存比分 · 未作新系统裁定"
                : "旧档比分冲突 · 保留原记录待复核"}
            </small>
          )}
        </div>
        <div>
          <TeamBadge name={f.away} logo={data.publicData?.awayLogo} />
          <h2>{teamName(f.away, f.competition || f.leagueCode)}</h2>
        </div>
      </section>
      <div className="ws-note">
        赛前预测与报价永久冻结。赛后新增赛果与更正，不根据比分重算概率。实时来源不足时，历史记录仍可查看。
      </div>
      {(!data?.version || data.version.id === "GENERAL") && (
        <ComparisonPanel api={api} fixture={id} />
      )}
      {mode === "LOCAL_RESEARCH" && <UniversalPanel api={api} fixture={id} />}
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
          <CurrentMarkets data={data} market={market} />
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
          {latest && market === "1X2" ? (
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
              <QuoteHistory quotes={data.quotes} />
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
          ) : market === "1X2" && !data.referenceMarkets?.length ? (
            <div className="ws-empty compact">
              <strong>尚无完整可核验的1X2报价</strong>
              <p>已保存的公开盘口与历史报价在下方保留原值；缺失不填0。</p>
            </div>
          ) : null}
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
          {data.predictions
            .filter(
              (p: any, i: number, all: any[]) =>
                p.modelId !== "RECENT_FORM_POISSON_RESEARCH_V1" &&
                all.findIndex((x) => x.modelId === p.modelId) === i,
            )
            .map((p: any) => (
              <article className="ws-prediction" key={p.id}>
                <h3>
                  {p.modelId === "MARKET_PROPORTIONAL_V1"
                    ? "市场基准 · 比例去水"
                    : p.modelId === "RECENT_FORM_MARKET80_RESEARCH_V1"
                      ? "市场80%＋近期赛况20% · 未验证研究"
                      : p.modelId === "GENERAL_FOOTBALL_RESEARCH_V2"
                        ? "通用赛前模型 · 当前固定研究方法"
                        : p.modelId === "GENERAL_FOOTBALL_RESEARCH_V1"
                          ? "通用初版 · 已停止新增，保留审计"
                          : p.modelId}
                </h3>
                <div className="ws-probability">
                  {(p.central || []).map((v: number, i: number) => (
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
                    <b>
                      {({ HOME: "主胜", DRAW: "平局", AWAY: "客胜" } as any)[
                        e.selection
                      ] || e.selection}
                    </b>
                    <span>估算EV {pct(e.ev)}</span>
                    <small>
                      {e.accepted
                        ? "研究候选 · 尚未验证收益优势"
                        : p.modelId === "MARKET_PROPORTIONAL_V1"
                          ? "市场基准仅作对照，没有独立优势信号"
                          : e.reason === "RESEARCH_NO_SUPPORTED_EDGE"
                            ? "未达到研究门槛：EV 3%–20%，赔率1.20–8.00"
                            : e.reason === "EV_BELOW_THRESHOLD"
                              ? "估算EV未达到策略门槛"
                              : e.reason}
                    </small>
                  </div>
                ))}
                <Json value={p} label="冻结预测与模型解释 / predictionId" />
              </article>
            ))}
          {data.historicalModelSamples?.map((p: any) => (
            <article className="ws-prediction" key={p.modelId}>
              <h3>{p.label} · 历史固定重放</h3>
              <p className="ws-caption">
                使用归档输入，不是赛前捕获。原模型输出独立保留；不按此场赛果重选方法。
              </p>
              <div className="ws-probability">
                {(
                  p.central ??
                  ["HOME", "DRAW", "AWAY"].map(
                    (side) => p.stressBySelection?.[side] ?? null,
                  )
                ).map((v: number, i: number) => (
                  <div key={i}>
                    <small>
                      {["主胜", "平局", "客胜"][i]}
                      {p.kind === "SELECTION_STRESS_ONLY" ? "压力值" : "概率"}
                    </small>
                    <strong>{pct(v)}</strong>
                  </div>
                ))}
              </div>
              <p>
                原研究方向：
                {(
                  {
                    HOME: "主胜",
                    DRAW: "平局",
                    AWAY: "客胜",
                    NO_ACTION: "无行动",
                  } as any
                )[p.action] ?? p.action}{" "}
                · 原估算EV {pct(p.estimatedEV)}
              </p>
              <Json value={p} label="历史模型原始输出、赔率与样本身份" />
            </article>
          ))}
          {!data.predictions.length && !data.historicalModelSamples?.length && (
            <p className="ws-muted">
              尚无本场冻结预测。不会通过赛果补造赛前概率。
            </p>
          )}
          {data.models.map((m: any) => (
            <details className="ws-model-blocked" key={m.id}>
              <summary>
                {m.label} · 严格推荐资格
                <span className="ws-state">
                  {m.status === "UNSUPPORTED_COMPETITION"
                    ? "本赛事不适用"
                    : "未晋升严格推荐"}
                </span>
              </summary>
              <p>
                {m.status === "UNSUPPORTED_COMPETITION"
                  ? m.reason
                  : "此处显示原登记的严格推荐资格。V6固定并行研究输出在上方单独展示，不因开始记录就自动晋升。"}
              </p>
              <small>{m.probabilityKind}</small>
            </details>
          ))}
          <div className="ws-separate-metrics">
            <span>
              模型概率：
              {data.predictions.length ? "如上，按冻结值显示" : "尚无冻结值"}
            </span>
            <span>
              估算EV：{data.predictions.length ? "读取冻结值" : "未计算"}
            </span>
            <span>
              证据完整度：
              {data.quotes.length
                ? "报价已冻结；各方法特征状态见对应证据"
                : "报价与实时特征缺失"}
            </span>
            <span>验证状态：历史或公开参考研究 / 未晋升</span>
          </div>
          <p className="ws-caption">
            研究排序分如存在，仅表示规则排序，不是命中概率或收益保证。
          </p>
        </section>
      </div>
      <MatchContext data={data} />
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>原始数据与审计时间线</h2>
          <span>预测、赛果、更正分别保留</span>
        </div>
        {data.sourceAliases?.length > 0 && (
          <div className="ws-note">
            另有 {data.sourceAliases.length}{" "}
            条同队、同时间来源记录。来源ID尚未完成权威关联，保留原记录与账本，不自动合并。
            {data.sourceAliases.map((f: any) => (
              <Link key={f.id} to={"/match/" + encodeURIComponent(f.id)}>
                {" "}
                查看关联来源 ↗{" "}
              </Link>
            ))}
          </div>
        )}
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
            label={`旧档关联记录 · ${a.portfolio} · ${a.title}`}
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
        <Json
          value={data.predictions}
          label="全部历次冻结预测（含已停止使用的研究版本）"
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
  ["YESTERDAY", "昨天"],
  ["TODAY", "今日"],
  ["WEEK", "本周"],
  ["MONTH", "本月"],
  ["SEASON", "本赛季"],
  ["ALL", "全历史"],
];
export function HistoryWorkspace({
  api,
  ledger = false,
  mode,
}: Props & { ledger?: boolean }) {
  const [filters, setFilters] = useState<Record<string, string>>(() => ({
      mode:
        new URLSearchParams(window.location.search).get("mode") ||
        (ledger && mode === "LOCAL_RESEARCH"
          ? "PAPER_RESEARCH"
          : "LEGACY_IMPORT"),
      period:
        ledger &&
        mode === "LOCAL_RESEARCH" &&
        !new URLSearchParams(window.location.search).has("mode")
          ? "YESTERDAY"
          : "ALL",
      basis: "PLACED",
      league: "ALL",
      model: "ALL",
      market: "ALL",
      strategy:
        new URLSearchParams(window.location.search).get("strategy") || "ALL",
      currency: "ALL",
      ticketType: "ALL",
      odds: "ALL",
      score: "ALL",
      status: "ALL",
      from: "",
      to: "",
      q: "",
      ...Object.fromEntries(new URLSearchParams(window.location.search)),
    })),
    [offset, setOffset] = useState(
      Number(new URLSearchParams(window.location.search).get("offset") || 0),
    ),
    [detail, setDetail] = useState<any>();
  const recordDialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!detail) return;
    const previous = document.activeElement as HTMLElement;
    recordDialog.current?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(undefined);
      if (e.key === "Tab") {
        const nodes = Array.from(
          recordDialog.current?.querySelectorAll<HTMLElement>(
            'button,a[href],input,select,summary,[tabindex="0"]',
          ) ?? [],
        ).filter((n) => n.getClientRects().length);
        const first = nodes[0],
          last = nodes.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === recordDialog.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === recordDialog.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      previous?.focus();
    };
  }, [detail]);
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      `${ledger ? "/ledger" : "/history"}?` +
        new URLSearchParams({ ...filters, offset: String(offset) }),
    );
  }, [filters, offset, ledger]);
  const state = useData(
    api,
    `/workspace/${ledger ? "ledger" : "history"}?` +
      new URLSearchParams({ ...filters, offset: String(offset) }),
  );
  const { data } = state;
  const openedRecord = useRef("");
  useEffect(() => {
    if (!filters.record || openedRecord.current === filters.record || !data)
      return;
    const match = data.items.find((r: any) => r.id === filters.record);
    if (match) {
      openedRecord.current = filters.record;
      setDetail(match);
    }
  }, [data, filters.record]);
  const [exportNotice, setExportNotice] = useState("");
  async function exportFiltered() {
    try {
      setExportNotice("正在导出完整筛选记录…");
      const value = await api(
        `/workspace/${ledger ? "ledger" : "history"}?` +
          new URLSearchParams({ ...filters, export: "1" }),
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = ledger ? "魔虚罗-筛选账本.json" : "魔虚罗-筛选历史.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportNotice(`已导出完整 ${value.total} 条记录及统计口径。`);
    } catch (e) {
      setExportNotice("导出失败：" + String(e));
    }
  }

  const s = data?.summary;
  const change = (key: string) => (value: string) => {
    setFilters((f) => ({ ...f, [key]: value, record: "" }));
    setOffset(0);
    setDetail(undefined);
  };
  const options = (key: string) => [
    ["ALL", "全部 / 含未知"],
    ...(data?.dimensions?.[key] || []).map((v: any) => [
      v,
      key === "strategy"
        ? (data?.strategies?.find((s: any) => s.id === v)?.name ?? v)
        : v,
    ]),
  ];
  return (
    <div className={"workspace-page" + (ledger ? " ledger-clean" : "")}>
      <Head
        n={ledger ? "03 / LEDGER & REVIEW" : "02 / HISTORY"}
        title={ledger ? "战绩与复盘" : "1.0历史中心"}
        text={
          ledger
            ? "哪场投了什么、赔率多少、赢了还是输了，逐票逐场展开。"
            : "保留过去的全部信息。历史可阅读，资格单独判断。"
        }
      >
        {ledger && (
          <a className="ws-button" href="#ticket-records">
            看票据与结果 ↓
          </a>
        )}
        <Link className="ws-button secondary" to="/strategies">
          策略竞技场 ↗
        </Link>
        <button className="secondary" onClick={exportFiltered}>
          导出当前筛选 ↗
        </button>
      </Head>
      <LoadState {...state} />
      <p role="status">{exportNotice}</p>
      {ledger && (
        <div className="ws-ledger-modes">
          {[
            ...(mode === "LOCAL_RESEARCH"
              ? [["PAPER_RESEARCH", "2.0自动模拟"]]
              : [["PAPER", "DEMO测试票"]]),
            ["LEGACY_IMPORT", "1.0存档战绩"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={filters.mode === v ? "selected" : ""}
              onClick={() => {
                setFilters((f) => ({
                  ...f,
                  mode: v,
                  period: v === "LEGACY_IMPORT" ? "ALL" : "YESTERDAY",
                  basis: "PLACED",
                  strategy: "ALL",
                  from: "",
                  to: "",
                  status: "ALL",
                  record: "",
                }));
                setOffset(0);
                setDetail(undefined);
              }}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <div className="ws-note">
        {ledger && data?.accounting && (
          <p>
            {data.accounting.basis} · 账期 {data.accounting.timeZone}{" "}
            {data.accounting.cutoff}。{data.accounting.attribution}
          </p>
        )}
        {filters.mode === "USER_REPORTED" && ledger
          ? "用户自行声明的成交与返还，不等同于服务器验证的输赢。"
          : ledger && filters.mode === "PAPER"
            ? "DEMO合成测试票；不与真实赛程的研究票或历史票相加。"
            : ledger && filters.mode === "PAPER_RESEARCH"
              ? "自动研究纸面票 · 每票20虚拟单位，按公开展示价假设记录。广覆盖对照与精选价值按策略独立筛选，不等于真实投注。"
              : "LEGACY / HISTORICAL / NON-PROSPECTIVE · 原始票据与模型观测保留，不补造时间与缺失金额。"}{" "}
        {ledger &&
        ["PAPER", "PAPER_RESEARCH", "USER_REPORTED"].includes(filters.mode) ? (
          <>账本读取截止：{fmt(data?.asOf)}</>
        ) : (
          <>旧档案导出截止：{fmt(data?.sourceCutoffAt)}</>
        )}
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
          <div className="ledger-date-basis" aria-label="战绩日期口径">
            {[
              ["PLACED", "按投注日期 · 那天投了什么"],
              ["SETTLED", "按结算日期 · 那天赢了什么"],
            ].map(([v, label]) => (
              <button
                key={v}
                aria-pressed={filters.basis === v}
                className={filters.basis === v ? "selected" : "secondary"}
                onClick={() => change("basis")(v)}
              >
                {label}
              </button>
            ))}
            <span>
              {filters.period === "YESTERDAY"
                ? "昨天"
                : periods.find(([v]) => v === filters.period)?.[1]}{" "}
              ·{" "}
              {data?.accounting?.timeZone === "Asia/Shanghai"
                ? "原北京时间08:00账日"
                : "柏林自然日"}{" "}
              · 赢 {s?.wins ?? "—"} / 输 {s?.losses ?? "—"}
            </span>
          </div>
          <div className="ws-summary six">
            <Stat
              label="投入"
              value={amount(s?.stakeAtoms)}
              detail={s?.currencies
                ?.map((v: string) =>
                  v === "UNKNOWN"
                    ? "原币种未记录"
                    : v === "PAPER" || v === "VIRTUAL_UNITS"
                      ? "纸面单位"
                      : v,
                )
                .join(" / ")}
            />
            <Stat label="已结净收益" value={amount(s?.profitAtoms)} />
            <Stat
              label="ROI"
              value={pct(s?.roi)}
              detail={
                s?.roiDenominator === "LEGACY_RESOLVED_STAKE_EXCLUDING_VOID"
                  ? "分母：已结投入，不含退票"
                  : "分母：已结投入"
              }
            />
            <Stat
              label="当前未结"
              value={data?.exposure?.open ?? "—"}
              detail={`未结投入 ${amount(data?.exposure?.stakeAtoms)} · 包含前期未结`}
            />
            <Stat label="已结" value={s?.settled ?? "—"} />
            <Stat
              label="最大回撤"
              value={amount(s?.maxDrawdownAtoms)}
              detail="以结算时间排序"
            />
          </div>
          <section className="ws-panel ws-chart-panel">
            <div className="ws-bottom-links">
              <button
                className="secondary"
                onClick={() => {
                  setFilters((f) => ({
                    ...f,
                    period: "ALL",
                    from: "",
                    to: "",
                    status: "OPEN",
                    record: "",
                  }));
                  setOffset(0);
                }}
              >
                查看全部未结票 →
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setFilters((f) => ({
                    ...f,
                    period: "ALL",
                    from: "",
                    to: "",
                    status: "REVIEW",
                    record: "",
                  }));
                  setOffset(0);
                }}
              >
                查看待复核票 →
              </button>
              {filters.status !== "ALL" && (
                <button
                  className="secondary"
                  onClick={() => change("status")("ALL")}
                >
                  显示全部状态
                </button>
              )}
            </div>
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

      <section className="ws-panel" id="ticket-records">
        <div className="ws-section-head">
          <h2>
            {ledger ? "票据记录" : "历史档案"} <span>{data?.total ?? "—"}</span>
          </h2>
          <span>统计基于完整筛选集合，分页不改指标</span>
        </div>
        {ledger && (
          <div className="ws-pills" aria-label="票型筛选">
            {[
              ["ALL", "全部票型"],
              ["SINGLE", "单场"],
              ["DOUBLE", "二串一"],
              ["MULTI", "全部串关"],
            ].map(([v, label]) => (
              <button
                key={v}
                aria-pressed={filters.ticketType === v}
                className={filters.ticketType === v ? "selected" : "secondary"}
                onClick={() => change("ticketType")(v)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {ledger && (
          <div className="ws-pills" aria-label="输赢筛选">
            {[
              ["ALL", "全部结果"],
              ["WIN", "赢"],
              ["LOSS", "输"],
              ["OPEN", "未结"],
              ["REVIEW", "待复核"],
              ["VOID", "退款"],
            ].map(([v, label]) => (
              <button
                key={v}
                aria-pressed={filters.status === v}
                className={filters.status === v ? "selected" : "secondary"}
                onClick={() => {
                  if (v === "OPEN" || v === "REVIEW") {
                    setFilters((f) => ({
                      ...f,
                      status: v,
                      basis: "PLACED",
                      record: "",
                    }));
                    setOffset(0);
                  } else change("status")(v);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="ledger-primary-filters">
          <Select
            label="策略"
            value={filters.strategy}
            onChange={change("strategy")}
            values={options("strategy")}
          />
          <label className="ws-filter search">
            <span>球队 / 对阵</span>
            <input
              aria-label="搜索战绩球队"
              placeholder="搜索比赛…"
              value={filters.q}
              onChange={(e) => change("q")(e.target.value)}
            />
          </label>
        </div>
        <details className="schedule-filters">
          <summary>筛选日期、策略、模型、赔率与状态</summary>
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
          <Select
            label="票据状态"
            value={filters.status}
            onChange={change("status")}
            values={[
              ["ALL", "全部状态"],
              ["OPEN", "未结"],
              ["REVIEW", "待复核"],
              ["CLOSED", "已结"],
              ["WIN", "赢"],
              ["LOSS", "输"],
              ["VOID", "退票"],
            ]}
          />
        </details>
        {ledger ? (
          <TicketCards
            records={data?.items}
            basis={filters.basis}
            onDetail={setDetail}
          />
        ) : (
          <div className="ws-records">
            {data?.items.map((r: any) => (
              <button
                className="ws-record-row"
                key={r.id}
                onClick={() => setDetail(r)}
              >
                <div>
                  <span className="ws-record-tag">
                    {(
                      {
                        TICKET: "历史票",
                        RESEARCH_OBSERVATION: "研究观测",
                        REFERENCE_FILE: "原始档案",
                        PAPER: "纸面票",
                        PAPER_RESEARCH: "自动研究纸面票",
                        LEGACY_IMPORT: "历史导入",
                      } as any
                    )[r.kind || r.mode] ??
                      r.kind ??
                      r.mode}
                  </span>
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
                    {(
                      {
                        WIN: "赢",
                        LOSS: "输",
                        VOID: "退票",
                        OPEN: "未结",
                        REVIEW: "待复核",
                        NON_PROSPECTIVE: "非前瞻",
                      } as any
                    )[String(r.status).toUpperCase()] ?? r.status}{" "}
                    · {r.currency === "UNKNOWN" ? "原币种未记录" : r.currency}
                  </small>
                </div>
                <b>↗</b>
              </button>
            ))}
          </div>
        )}
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
      {ledger && (
        <details className="ws-panel ledger-more">
          <summary>深入复盘 · 逐日对账与原始统计</summary>
          <DailyLedger
            days={data?.daily}
            onSelect={(d: string) => {
              setFilters((f) => ({
                ...f,
                period: "ALL",
                from: d,
                to: d,
                basis: "SETTLED",
                record: "",
              }));
              setOffset(0);
            }}
          />
          <StrategyBalances
            strategies={data?.strategies}
            selected={filters.strategy}
            onSelect={change("strategy")}
          />
          <LedgerReview review={data?.review} />
        </details>
      )}
      {detail && (
        <section
          className="ws-panel ws-selected-record"
          role="dialog"
          aria-modal="true"
          aria-label="记录详情"
          tabIndex={-1}
          ref={recordDialog}
        >
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
                {teamName(f.home, f.competition || f.leagueCode)} —{" "}
                {teamName(f.away, f.competition || f.leagueCode)} · 比赛详情 →
              </Link>
            ))}
          </div>
          {(
            detail.legs ||
            detail.raw.legs ||
            (detail.raw.leg ? [detail.raw.leg] : [])
          )?.map((l: any, i: number) => (
            <article className="ws-leg" key={i}>
              <h3>
                {teamName(l.home, l.competition || l.leagueCode)} —{" "}
                {teamName(l.away, l.competition || l.leagueCode)}
              </h3>
              <p>
                注项{" "}
                {l.selectionLabel ??
                  l.pickName ??
                  (["主胜", "平局", "客胜"][Number(l.pick)] || l.pick) ??
                  "未知"}{" "}
                · 赔率 {l.odds ?? "未记录"} ·{" "}
                {l.marketType ?? l.market ?? "1X2"} · 盘口{" "}
                {l.line ?? l.handicap ?? l.total ?? "未记录"}
              </p>
              <p>
                报价：{l.provider || "来源未知"} · {fmt(l.priceCapturedAt)} ·{" "}
                {l.phase || "时相未知"}
              </p>
              <p>{l.rationale?.join("；")}</p>
              <Json value={l} label="本腿原始预测、盘口与结算证据" />
            </article>
          ))}
          <Json value={detail} label="完整原始记录与内容hash" />
          <details className="ws-audit">
            <summary>只读换腿复盘 · 原票不变</summary>
            <p className="ws-caption">
              只使用原票保存的备选赔率及已保存比分，计算整票假设盈亏；不属于真实收益或前瞻验证。
            </p>
            {detail.counterfactuals?.length ? (
              detail.counterfactuals.map((a: any, i: number) => (
                <p key={i}>
                  第{a.index + 1}腿 → {a.selection} · 原备选赔率{" "}
                  {a.odds ?? "未保存"} · 假设整票净收益{" "}
                  {a.hypotheticalProfit == null
                    ? "缺必要原始值，不能计算"
                    : a.hypotheticalProfit.toFixed(2)}
                </p>
              ))
            ) : (
              <p>原票没有保存备选价格；不会以现价补写历史。</p>
            )}
          </details>
        </section>
      )}
      {ledger && (
        <div className="ws-bottom-links">
          <Link to="/archives">导出与原始档案 →</Link>
        </div>
      )}
    </div>
  );
}
export function LaboratoryWorkspace({ api, mode }: Props) {
  const [tab, setTab] = useState(
    window.location.hash === "#parallel" ? "FORWARD" : "GENERAL",
  );
  return (
    <div className="workspace-page lab-clean">
      <Head
        n="MODEL LABORATORY"
        title="模型实验室"
        text="看清每种算法的样本、表现和局限，再决定下一步研究。"
      >
        <Link className="ws-button secondary" to="/strategies">
          策略实战收益 ↗
        </Link>
      </Head>
      <div className="ws-pills lab-tabs" aria-label="模型实验室视图">
        {[
          ["GENERAL", "当前版本"],
          ["FORWARD", "V6与旧V2 · 前瞻对照"],
          ["HISTORICAL", "V6 / V7 / 市场 · 历史研究"],
        ].map(([v, l]) => (
          <button
            key={v}
            aria-pressed={tab === v}
            className={tab === v ? "selected" : "secondary"}
            onClick={() => setTab(v)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "GENERAL" && <GeneralLaboratory api={api} />}
      {tab === "FORWARD" && <ComparisonPanel api={api} />}
      {tab === "HISTORICAL" && (
        <HistoricalLaboratoryWorkspace api={api} mode={mode} />
      )}
    </div>
  );
}
function HistoricalLaboratoryWorkspace({ api }: Props) {
  const [season, setSeason] = useState("ALL"),
    [league, setLeague] = useState("ALL"),
    [odds, setOdds] = useState("ALL"),
    [sampleOffset, setSampleOffset] = useState(0);
  const state = useData(
    api,
    "/workspace/models?" +
      new URLSearchParams({
        season,
        league,
        odds,
        offset: String(sampleOffset),
      }),
    60000,
  );
  const { data } = state;
  const [exportMessage, setExportMessage] = useState("");
  async function exportSamples() {
    try {
      setExportMessage("正在导出全部筛选样本…");
      const value = await api(
        "/workspace/models?" +
          new URLSearchParams({ season, league, odds, export: "1" }),
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "魔虚罗-模型研究-完整样本.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(
        `已导出 ${value.models[0]?.samples?.length ?? 0} 场共同样本及三个方法的证据。`,
      );
    } catch (e) {
      setExportMessage("导出失败：" + String(e));
    }
  }
  return (
    <div className="workspace-page">
      <Head
        n="04 / MODEL LABORATORY"
        title="模型实验室"
        text="比较同一批样本，而不是比较包装后的收益。"
      >
        <button className="secondary" onClick={exportSamples}>
          导出全部筛选样本 ↗
        </button>
        <Link className="ws-button secondary" to="/registry">
          模型登记与冻结评估 ↗
        </Link>
      </Head>
      <LoadState {...state} />
      <div className="ws-note">
        历史固定重放 · 档案导出截止 {fmt(data?.sourceCutoffAt)}；比赛样本截止{" "}
        {data?.population?.sampleCutoff ?? "未记录"}。不自动晋升。
      </div>
      <p role="status">{exportMessage}</p>
      <div className="ws-filters">
        <Select
          label="研究赛季"
          value={season}
          onChange={(v: string) => {
            setSampleOffset(0);
            setSeason(v);
          }}
          values={[
            ["ALL", "全部共同样本"],
            ...(data?.seasons || []).map((s: string) => [s, s]),
          ]}
        />
        <Select
          label="研究联赛"
          value={league}
          onChange={(v: string) => {
            setSampleOffset(0);
            setLeague(v);
          }}
          values={[
            ["ALL", "全部共同样本联赛"],
            ...(data?.leagues || []).map((s: string) => [s, s]),
          ]}
        />
        <Select
          label="研究赔率区间"
          value={odds}
          onChange={(v: string) => {
            setSampleOffset(0);
            setOdds(v);
          }}
          values={[
            ["ALL", "全部 / 含无行动"],
            ["LOW", "市场热门赔率 <1.80"],
            ["MID", "市场热门赔率 1.80–2.49"],
            ["HIGH", "市场热门赔率 ≥2.50"],
          ]}
        />
      </div>
      <section className="ws-panel">
        <h2>同一批比赛，三种固定方法</h2>
        <p className="ws-caption">
          共同样本 {data?.models?.[0]?.metrics.eligibleN ?? "—"}{" "}
          场；V6只有方向压力概率，不能用于三分类损失。
          {data?.population
            ? `原档案 ${data.population.originalN} 场，排除 ${data.population.excludedN} 场；样本截止 ${data.population.sampleCutoff}。`
            : ""}
        </p>
        <div className="ws-table-scroll model-matrix">
          <table>
            <thead>
              <tr>
                <th>口径</th>
                {data?.models.map((m: any) => (
                  <th key={m.id}>
                    {m.id.startsWith("V6")
                      ? "V6 · 配置388"
                      : m.id.startsWith("V7")
                        ? "V7 · 固定融合"
                        : "市场基准"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["共同样本N", (m: any) => m.metrics.eligibleN],
                ["研究动作N", (m: any) => m.metrics.count],
                [
                  "赢 / 输",
                  (m: any) => `${m.metrics.wins} / ${m.metrics.losses}`,
                ],
                ["研究动作ROI", (m: any) => pct(m.metrics.roi)],
                [
                  "平均动作赔率",
                  (m: any) => m.metrics.avgOdds?.toFixed(3) ?? "—",
                ],
                [
                  "回撤（研究单位）",
                  (m: any) => amount(m.metrics.maxDrawdownAtoms),
                ],
                [
                  "LogLoss",
                  (m: any) => m.metrics.logLoss?.toFixed(4) ?? "不适用",
                ],
                ["Brier", (m: any) => m.metrics.brier?.toFixed(4) ?? "不适用"],
                ["样本覆盖率", (m: any) => pct(m.metrics.coverage)],
                ["行动率", (m: any) => pct(m.metrics.actionRate)],
                [
                  "验证状态",
                  (m: any) =>
                    m.id.startsWith("V6") ? "事后配置研究" : "历史重放",
                ],
              ].map(([label, get]: any) => (
                <tr key={label}>
                  <th>{label}</th>
                  {data?.models.map((m: any) => (
                    <td key={m.id}>{get(m)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ws-note">
          V6只有8次历史研究动作，当前收益不能证明稳定优势。V6/V7均未自动晋升；无行动ROI保持空值。
        </p>
        {data?.models.map((m: any) => (
          <Json
            key={m.id}
            value={{
              sampleRange: m.sampleRange,
              sampleManifestHash: m.sampleManifestHash,
              artifactHash: m.artifactHash,
              artifactEvidence: m.artifactEvidence,
              trainCutoff: m.trainCutoff,
              calibrationCutoff: m.calibrationCutoff,
              fixedBlend: m.fixedBlend,
            }}
            label={`${m.label} · 权重、训练截止与样本证据`}
          />
        ))}
        {data?.population && (
          <Json value={data.population} label="全部排除样本与原始资格标记" />
        )}
      </section>
      {data?.models.map((m: any) => (
        <details className="ws-panel lab-detail" key={"samples:" + m.id}>
          <summary>
            {m.label} · 查看全部 {m.sampleTotal} 场证据
          </summary>
          <div className="ws-section-head">
            <h2>{m.label} · 逐场研究证据</h2>
            <span>
              {m.sampleRange.from || "无样本"} — {m.sampleRange.to || "无样本"}
            </span>
          </div>
          <p className="ws-caption">
            当前筛选第 {sampleOffset + 1}–
            {Math.min(sampleOffset + 20, m.sampleTotal)} 场，共 {m.sampleTotal}{" "}
            场。历史重放不是赛前捕获；V6压力值分别保留，没有归一化。
          </p>
          {m.samplePreview.map((r: any) => (
            <div className="ws-odds-history" key={r.fixtureId}>
              <div>
                <span>
                  {r.date} · {teamName(r.home, r.competition || r.leagueCode)} —{" "}
                  {teamName(r.away, r.competition || r.leagueCode)}
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
          <div className="ws-pagination">
            <button
              disabled={!sampleOffset}
              onClick={() => setSampleOffset(Math.max(0, sampleOffset - 20))}
            >
              上一页样本
            </button>
            <button
              disabled={m.nextOffset == null}
              onClick={() => setSampleOffset(m.nextOffset)}
            >
              下一页样本
            </button>
          </div>
        </details>
      ))}
      <section className="ws-panel">
        <div className="ws-section-head">
          <h2>当前赛季 · 严格前瞻表现</h2>
          <span>与上方历史重放分开</span>
        </div>
        <p className="ws-caption">
          按比赛去重：市场基准已冻结 {data?.prospective.marketCapturedN ?? "—"}{" "}
          场，市场＋近期赛况研究已冻结{" "}
          {data?.prospective.researchCapturedN ?? "—"}{" "}
          场；这两类公开参考研究不计入严格前瞻成绩。
        </p>
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
        <details className="ws-panel lab-detail" key={m.id}>
          <summary>{m.label} · 分组与校准</summary>
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
                      <th>均价</th>
                      <th>回撤</th>
                      <th>LogLoss / Brier</th>
                      <th>行动率</th>
                      <th>样本覆盖</th>
                      <th>样本日期</th>
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
                        <td>{r.avgOdds?.toFixed(2) ?? "—"}</td>
                        <td>{amount(r.maxDrawdownAtoms)}</td>
                        <td>
                          {r.logLoss?.toFixed(3) ?? "—"} /{" "}
                          {r.brier?.toFixed(3) ?? "—"}
                        </td>
                        <td>{pct(r.actionRate)}</td>
                        <td>
                          {r.eligibleN}/{r.originalN} · {pct(r.coverage)}
                        </td>
                        <td>
                          {r.sampleRange.from ?? "无样本"} —{" "}
                          {r.sampleRange.to ?? "无样本"}
                        </td>
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
        </details>
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
  const device = useData(api, "/device-access", 30000).data;
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
      {mode === "LOCAL_RESEARCH" && (
        <section className="ws-panel">
          <div className="ws-section-head">
            <h2>手机与并行研究</h2>
            <Link to="/models#parallel">V6 / V2 比较 →</Link>
          </div>
          <p>
            {device?.lanOrigin ? (
              <>
                <span>手机与电脑连接同一网络，打开 </span>
                <a href={device.lanOrigin + "/workbench"}>
                  {device.lanOrigin}/workbench
                </a>
              </>
            ) : (
              "局域网入口暂不可用；当前电脑入口正常。"
            )}
          </p>
          <p className="ws-note">
            电脑需要保持开机。V6 原始特征由后台准备，V2 与 V6
            自动领取冻结任务，不需反复点击。
          </p>
          {device?.featureStatus && (
            <p>
              特征准备：{device.featureStatus.prepared} /{" "}
              {device.featureStatus.targets} 场 · 历史截止{" "}
              {device.featureStatus.historyLastDate} ·{" "}
              {fmt(device.featureStatus.at)}
            </p>
          )}
        </section>
      )}
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
                      ? "通用分析 / V6 / V2 并行研究"
                      : i === 7
                        ? "原子幂等 · 独立自动纸面票"
                        : "自动 / 事件驱动"}
              </small>
            </div>
          ))}
        </div>
        <p className="ws-note">
          手动刷新用于立即读取、重试或复核。正常研究模式自动发现比赛、补取报价和特征、分析与记录纸面票，再核对90分钟结果并结算。来源失败不会成为“无机会”；纸面策略可在“模拟策略”暂停和恢复。
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
              <strong>{leagueName(s.competition, data.leagues)}</strong>
              <small>{s.providerId}</small>
            </div>
            <span className="ws-state">
              {(
                {
                  EMPTY: "本来源本日期为空",
                  FAILED: "读取失败",
                  DEGRADED: "已读公开参考",
                  CAPTURING: "读取中",
                  CAPTURED: "已取得证据",
                  NORMALIZATION_FAILED: "格式待复核",
                } as any
              )[s.state] ?? s.state}
            </span>
            <span>{s.normalizedCount} 场</span>
            <div>
              <small>{fmt(s.startedAt)}</small>
              <p>
                {s.state === "EMPTY"
                  ? "来源未返回该日赛事；不代表其他来源也没有比赛。"
                  : s.state === "FAILED"
                    ? "来源本轮未成功，按退避继续重试；具体原因保留在原始运行记录。"
                    : s.state === "DEGRADED"
                      ? "赛程与可用盘口已保留；价格为公开参考，来源更新时间未提供。"
                      : s.reason}
              </p>
            </div>
          </div>
        ))}
      </section>
      <section className="ws-panel">
        <h2>模型队列</h2>
        <div className="ws-summary">
          {data?.queue.map((q: any) => (
            <Stat
              key={q.state}
              label={
                (
                  {
                    DONE: "已完成",
                    RUNNING: "推断中",
                    QUEUED: "等待领取",
                    FAILED: "失败",
                    BLOCKED: "受阻",
                  } as any
                )[q.state] ?? q.state
              }
              value={q.count}
            />
          ))}
        </div>
        <Link to="/system-details">安装身份、schema与完整状态 →</Link>
      </section>
      {mode === "LOCAL_RESEARCH" && (
        <details className="ws-audit">
          <summary>开发工具 · 离线 DEMO</summary>
          <p>
            用于验证冻结、纸面结算、更正与重启恢复。所有比赛和收益都是合成演示，不参与推荐或模型比较。
          </p>
          {location.hostname === "127.0.0.1" ||
          location.hostname === "localhost" ? (
            <a href={`http://127.0.0.1:5273/workbench?offline=1`}>
              在此电脑打开离线演练 ↗
            </a>
          ) : (
            <p>离线演练只在电脑端开放，不影响手机查看真实赛事。</p>
          )}
        </details>
      )}
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
        title="旧档案与设置"
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
        <Link to="/ledger?mode=LEGACY_IMPORT&period=ALL">旧十策略账本 ↗</Link>
        <Link to="/models">模型实验室 ↗</Link>
      </div>
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
              <Link
                to={
                  "/ledger?mode=LEGACY_IMPORT&period=ALL&strategy=" +
                  encodeURIComponent(p.id)
                }
              >
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
    </div>
  );
}
