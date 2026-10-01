import React, { useState } from "react";
import { teamName, formatDate } from "../../../packages/display";
const odds = (v: any) => (v == null ? "未提供" : Number(v).toFixed(3));
export function QuoteHistory({ quotes }: any) {
  const [provider, setProvider] = useState(""),
    [selected, setSelected] = useState(0),
    providers = [...new Set<string>(quotes.map((q: any) => q.providerId))],
    active = providers.includes(provider) ? provider : providers[0],
    points = quotes
      .filter((q: any) => q.providerId === active)
      .map((q: any) => ({ ...q, capturedMs: new Date(q.observedAt).getTime() }))
      .filter((q: any) => Number.isFinite(q.capturedMs))
      .sort((a: any, b: any) => a.capturedMs - b.capturedMs),
    rows = points.filter((q: any) =>
      ["HOME", "DRAW", "AWAY"].every(
        (s) =>
          Number.isFinite(Number(q.selections[s])) &&
          Number(q.selections[s]) > 1,
      ),
    );
  if (!rows.length) return null;
  const index = Math.min(selected, rows.length - 1),
    chosen = rows[index],
    values = rows.flatMap((q: any) =>
      ["HOME", "DRAW", "AWAY"].map((s) => Number(q.selections[s])),
    ),
    low = Math.max(1, Math.min(...values) - 0.1),
    high = Math.max(...values) + 0.1,
    x = (q: any) =>
      rows.length === 1
        ? 310
        : 40 +
          ((q.capturedMs - rows[0].capturedMs) /
            Math.max(1, rows.at(-1).capturedMs - rows[0].capturedMs)) *
            540,
    y = (v: number) => 140 - ((v - low) / Math.max(0.01, high - low)) * 110;
  return (
    <details className="quote-chart">
      <summary>报价变化 · {rows.length}次真实捕获</summary>
      <label className="ws-filter">
        <span>报价来源</span>
        <select
          aria-label="报价曲线来源"
          value={active}
          onChange={(e) => {
            setProvider(e.target.value);
            setSelected(0);
          }}
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <svg
        viewBox="0 0 620 185"
        role="img"
        aria-label="同一来源主平客十进制报价变化"
      >
        {[low, (low + high) / 2, high].map((v) => (
          <g key={v}>
            <line x1="40" x2="580" y1={y(v)} y2={y(v)} className="chart-axis" />
            <text x="34" y={y(v) + 4} textAnchor="end">
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {["HOME", "DRAW", "AWAY"].map((s, i) => (
          <g key={s} className={"quote-series series-" + i}>
            <polyline
              fill="none"
              strokeWidth="2.5"
              points={rows
                .map((q: any) => `${x(q)},${y(Number(q.selections[s]))}`)
                .join(" ")}
            />
            {rows.map((q: any, j: number) => (
              <circle
                key={q.id}
                cx={x(q)}
                cy={y(Number(q.selections[s]))}
                r={j === index ? 5 : 2.5}
                onPointerEnter={() => setSelected(j)}
                onClick={() => setSelected(j)}
              >
                <title>
                  {formatDate(q.observedAt)} · {["主胜", "平局", "客胜"][i]}{" "}
                  {q.selections[s]}
                </title>
              </circle>
            ))}
          </g>
        ))}
        <text x="40" y="177">
          {formatDate(rows[0].observedAt)}
        </text>
        <text x="580" y="177" textAnchor="end">
          {formatDate(rows.at(-1).observedAt)}
        </text>
      </svg>
      <div className="quote-legend">
        {["主胜", "平局", "客胜"].map((n, i) => (
          <span key={n} className={"series-" + i}>
            {n}
          </span>
        ))}
      </div>
      <label className="ws-filter">
        <span>选择报价记录（支持方向键）</span>
        <input
          aria-label="选择报价记录"
          type="range"
          min="0"
          max={rows.length - 1}
          value={index}
          onChange={(e) => setSelected(Number(e.target.value))}
        />
      </label>
      <p className="ws-caption" aria-live="polite">
        抓取 {formatDate(chosen.observedAt)} · 主/平/客{" "}
        {["HOME", "DRAW", "AWAY"].map((s) => chosen.selections[s]).join(" / ")}{" "}
        · 来源更新{" "}
        {chosen.providerUpdatedAt == null
          ? "未提供"
          : formatDate(chosen.providerUpdatedAt)}
        。横轴按真实抓取时间；不跨来源拼线，{points.length - rows.length}
        条不完整记录未连线。
      </p>
    </details>
  );
}
export function CurrentMarkets({ data, market }: any) {
  return (
    <div className="current-markets">
      {(data.referenceMarkets || []).map((q: any, i: number) => (
        <article key={i} className="ws-odds-history">
          <p className="ws-caption">
            {q.provider} · 公开参考 · 抓取{" "}
            {formatDate(data.fixture.lastCapturedAt)}
            <br />
            来源更新时间未提供；此处价格不代表已成交。
          </p>
          {market === "1X2" ? (
            <div className="ws-odds-grid">
              {["主胜", "平局", "客胜"].map((s, i) => (
                <div key={s}>
                  <small>{s}</small>
                  <strong>{odds(q.prices[i])}</strong>
                  <small>
                    市场去水{" "}
                    {q.probabilities
                      ? (q.probabilities[i] * 100).toFixed(1) + "%"
                      : "报价不完整"}
                  </small>
                </div>
              ))}
            </div>
          ) : market === "AH" ? (
            <div className="ws-odds-grid">
              {["home", "away"].map((side) => (
                <div key={side}>
                  <small>
                    {side === "home" ? "主队" : "客队"}让球{" "}
                    {q.asian[side].line ?? "未提供"}
                  </small>
                  <strong>{odds(q.asian[side].odds)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="ws-odds-grid">
              {["over", "under"].map((side) => (
                <div key={side}>
                  <small>
                    {side === "over" ? "大球" : "小球"}{" "}
                    {q.total[side].line ?? "未提供"}
                  </small>
                  <strong>{odds(q.total[side].odds)}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
export function MatchContext({ data }: any) {
  const f = data.fixture,
    d = data.publicData.detail;
  const standings = Array.isArray(d?.standings)
    ? d.standings
    : Array.isArray(d?.standings?.groups)
      ? d.standings.groups
      : [];
  const news = Array.isArray(d?.news)
    ? d.news
    : Array.isArray(d?.news?.articles)
      ? d.news.articles
      : [];
  if (!d)
    return (
      <div className="ws-note">
        后台正在补取本场详细资料；赛程和已有报价可以先查看。
        {data.publicData.detailError
          ? "详情来源本轮未成功，自动任务将重试。"
          : ""}
      </div>
    );
  return (
    <section className="ws-panel">
      <div className="ws-section-head">
        <h2>近期赛况与赛事资料</h2>
        <span>资料读取 {formatDate(d.observedAt)}</span>
      </div>
      <div className="ws-form-grid">
        {[
          [f.home, d.homeRecent],
          [f.away, d.awayRecent],
        ].map(([name, games]: any) => (
          <article key={name}>
            <h3>
              {teamName(name, f.competition)} · 最近{games?.length ?? 0}场
            </h3>
            {games?.map((g: any) => (
              <div className="form-game" key={g.id}>
                <small>{formatDate(g.at).slice(0, 10)}</small>
                <span>{teamName(g.opponent)}</span>
                <b
                  className={
                    g.gf > g.ga ? "positive" : g.gf < g.ga ? "negative" : ""
                  }
                >
                  {g.gf} : {g.ga}
                </b>
                <span>{g.gf > g.ga ? "胜" : g.gf < g.ga ? "负" : "平"}</span>
              </div>
            ))}
            {!games?.length && <p>此来源未提供近期战绩；继续寻找资料。</p>}
          </article>
        ))}
      </div>
      <p className="ws-caption">
        球场：{d.venue?.fullName ?? "尚未公布"} ·{" "}
        {d.neutralSite
          ? "来源标注中立场"
          : "主客身份按赛程来源，场地优势未经独立核验"}
        。近期记录比分仅用于研究，权威90分钟结算单独裁定。
      </p>
      <details className="ws-context-section">
        <summary>
          阵容与阵型 · {d.rosters?.length ? "已取得来源资料" : "赛前未公布"}
        </summary>
        {(Array.isArray(d.rosters) ? d.rosters : []).map(
          (r: any, i: number) => (
            <article key={i}>
              <h3>
                {teamName(r.team?.displayName ?? r.team?.name, f.competition)}
              </h3>
              <p>{r.formation ?? "阵型未公布"}</p>
              {(Array.isArray(r.roster) ? r.roster : []).map((p: any) => (
                <span className="ws-player" key={p.athlete?.id}>
                  {p.jersey ?? ""} {p.athlete?.displayName ?? "姓名未提供"}{" "}
                  {p.position?.abbreviation ?? ""}
                  {p.starter ? " · 首发" : ""}
                </span>
              ))}
            </article>
          ),
        )}
      </details>
      <details className="ws-context-section">
        <summary>积分与赛前报道</summary>
        {standings.map((s: any, i: number) => (
          <div key={i}>
            <h3>{s.displayName ?? s.name ?? "来源积分表"}</h3>
            {s.entries?.map((e: any) => (
              <p key={e.team?.id}>
                {teamName(e.team?.displayName)} ·{" "}
                {e.stats?.map((v: any) => v.displayValue).join(" / ")}
              </p>
            ))}
          </div>
        ))}
        {news.map((n: any, i: number) => (
          <p key={i}>
            <a href={n.links?.web?.href} target="_blank" rel="noreferrer">
              {n.headline ?? "赛前报道"}
            </a>
          </p>
        ))}
        {!standings.length && !news.length && (
          <p>本场来源尚未提供积分/报道。</p>
        )}
      </details>
      <p className="ws-caption">
        伤停：尚无可独立核验的名单；不会把未知解释为无人伤停。
      </p>
    </section>
  );
}
