import React, { useState } from "react";
import { teamName } from "../../../packages/display";
const amount = (v: any) => (v == null ? "—" : (Number(v) / 1e6).toFixed(2)),
  pct = (v: any) => (v == null ? "—" : (v * 100).toFixed(2) + "%");
export function LedgerReview({ review }: any) {
  const [strategyId, setStrategyId] = useState("");
  const [selectedDay, setSelectedDay] = useState(0);
  if (!review) return null;
  const Table = ({ rows }: any) => (
    <div className="ws-table-scroll">
      <table>
        <thead>
          <tr>
            <th>范围</th>
            <th>票数</th>
            <th>胜 / 负</th>
            <th>投入</th>
            <th>收益</th>
            <th>ROI</th>
            <th>回撤</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.value}>
              <td>{r.value}</td>
              <td>{r.count}</td>
              <td>
                {r.wins} / {r.losses}
              </td>
              <td>{amount(r.stakeAtoms)}</td>
              <td>{amount(r.profitAtoms)}</td>
              <td>{pct(r.roi)}</td>
              <td>{amount(r.maxDrawdownAtoms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <details className="ws-panel lab-detail">
      <summary>复盘：十策略、昨日结算、失误集中与样本质量</summary>
      <p className="ws-caption">
        按当前筛选范围。历史描述统计，不是前瞻验证。{review.attribution}
      </p>
      <h3>昨日结算 · {review.yesterday.day}</h3>
      <p>
        {review.yesterday.count} 票 · 净收益{" "}
        {amount(review.yesterday.profitAtoms)} · ROI {pct(review.yesterday.roi)}
      </p>
      <p>
        上一账日出票批次：{review.yesterdayCreated.count}票 · 已结
        {review.yesterdayCreated.settled}票 · 未结{review.yesterdayCreated.open}
        票 · 已实现收益{amount(review.yesterdayCreated.profitAtoms)}
        。按原出票日观察，包括后来结算的票；不是严格前瞻。
      </p>
      <h3>策略比较</h3>
      <Table rows={review.strategies} />
      <details>
        <summary>十策略逐日结算比较</summary>
        <p className="ws-caption">
          账日沿用旧版上海08:00划分；零票表示该日没有已结动作，ROI为空。
        </p>
        <label className="ws-filter">
          <span>逐日走势策略</span>
          <select
            aria-label="逐日走势策略"
            value={strategyId || review.strategies[0]?.id}
            onChange={(e) => setStrategyId(e.target.value)}
          >
            {review.strategies.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.value}
              </option>
            ))}
          </select>
        </label>
        {review.daily.length > 0 && (
          <DailyStrategies
            days={review.daily}
            strategyId={strategyId || review.strategies[0]?.id}
            selected={Math.min(selectedDay, review.daily.length - 1)}
            onSelect={setSelectedDay}
          />
        )}
        <div className="ws-table-scroll">
          <table>
            <thead>
              <tr>
                <th>结算账日</th>
                {review.strategies.map((s: any) => (
                  <th key={s.id}>{s.value}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {review.daily.map((d: any) => (
                <tr key={d.day}>
                  <th>{d.day}</th>
                  {d.strategies.map((s: any) => (
                    <td key={s.id}>
                      {s.count}票 · {amount(s.profitAtoms)}
                      <br />
                      ROI {pct(s.roi)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>分月走势</summary>
        <Table rows={review.months} />
      </details>
      {[
        ["联赛组合", review.leagues],
        ["模型组合", review.models],
        ["市场组合", review.markets],
        ["原始评分段", review.scoreBands],
        ["票面赔率区间", review.oddsBands],
        ["原规则、补位与娱乐对照", review.selectionTypes],
      ].map(([title, rows]: any) => (
        <details key={title}>
          <summary>{title}与亏损集中</summary>
          <Table rows={rows} />
        </details>
      ))}
      <h3>样本与采样审计</h3>
      <p>
        {review.sampling.tickets} 票 · {review.sampling.legs} 腿 ·{" "}
        {review.sampling.uniqueKnownFixtures} 个已知比赛ID
      </p>
      <p>
        缺报价时间 {review.sampling.missingQuoteTime} · 模型身份未知{" "}
        {review.sampling.missingModel} · 无可用原始评分{" "}
        {review.sampling.unscorable}
        。同一比赛跨策略的多票保留；不当作独立预测样本。
      </p>
      <details>
        <summary>失败单腿 · 共 {review.failedLegTotal} 项</summary>
        {review.failedLegs.map((r: any) => (
          <article className="ws-leg" key={r.ticketId + ":" + r.index}>
            <b>
              {teamName(r.home)} — {teamName(r.away)}
            </b>
            <p>
              原选择 {r.selection} · 赔率 {r.odds ?? "未知"} · 原比分{" "}
              {r.finalScore ?? "未记录"}
            </p>
            <p>{Array.isArray(r.reason) ? r.reason.join("；") : r.reason}</p>
            <a
              href={`/ledger?mode=LEGACY_IMPORT&period=ALL&q=${encodeURIComponent(r.ticketId)}&record=${encodeURIComponent(r.ticketId)}`}
            >
              打开原票与换腿复盘 →
            </a>
          </article>
        ))}
      </details>
      <details>
        <summary>历史方向概率校准 · 非严格验证</summary>
        {review.calibration.length ? (
          review.calibration.map((b: any) => (
            <p key={b.lower}>
              {Math.round(b.lower * 100)}–{Math.round((b.lower + 0.1) * 100)}% ·
              N={b.n} · 预测 {pct(b.predicted)} · 原腿胜率 {pct(b.observed)}
            </p>
          ))
        ) : (
          <p>没有同时记录有效原概率和单腿胜负的样本。</p>
        )}
      </details>
    </details>
  );
}
function DailyStrategies({ days, strategyId, selected, onSelect }: any) {
  const values = days.map((d: any) =>
      d.strategies.find((s: any) => s.id === strategyId),
    ),
    profits = values.map((s: any) =>
      s?.profitAtoms == null ? null : Number(s.profitAtoms) / 1e6,
    ),
    scale = Math.max(
      1,
      ...profits.filter((v: any) => v !== null).map(Math.abs),
    ),
    step = 600 / days.length,
    chosen = values[selected];
  return (
    <div className="daily-chart">
      <svg viewBox="0 0 640 190" role="img" aria-label="所选策略逐日已结收益">
        <line x1="20" x2="620" y1="85" y2="85" className="chart-axis" />
        {profits.map((v: any, i: number) =>
          v === null ? null : (
            <rect
              key={days[i].day}
              x={20 + i * step + step * 0.1}
              y={v >= 0 ? 85 - (v / scale) * 65 : 85}
              width={Math.max(0.4, step * 0.8)}
              height={Math.max(0.4, (Math.abs(v) / scale) * 65)}
              className={v >= 0 ? "bar-positive" : "bar-negative"}
              opacity={selected === i ? 1 : 0.6}
              onPointerEnter={() => onSelect(i)}
              onClick={() => onSelect(i)}
            >
              <title>
                {days[i].day}：{v.toFixed(2)}
              </title>
            </rect>
          ),
        )}
        <text x="20" y="175">
          {days[0].day}
        </text>
        <text x="620" y="175" textAnchor="end">
          {days.at(-1).day}
        </text>
        <text x="620" y="16" textAnchor="end">
          ±{scale.toFixed(2)}
        </text>
      </svg>
      <label className="ws-filter">
        <span>选择结算账日（支持方向键）</span>
        <input
          aria-label="选择结算账日"
          type="range"
          min="0"
          max={days.length - 1}
          value={selected}
          onChange={(e) => onSelect(Number(e.target.value))}
        />
      </label>
      <p className="ws-caption" aria-live="polite">
        {days[selected].day} · {chosen?.count ?? 0}票 · 收益
        {amount(chosen?.profitAtoms)} · ROI {pct(chosen?.roi)}
        。缺额不画条，零票与零收益分别显示。
      </p>
    </div>
  );
}
