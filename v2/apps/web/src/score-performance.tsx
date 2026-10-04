import React from "react";
import { formatDate } from "../../../packages/display";
const money = (x: any) =>
  x == null
    ? "—"
    : (Number(x) / 1e6).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const pct = (x: any) => (x == null ? "—" : `${(x * 100).toFixed(2)}%`);
export function ScorePerformance({ data, selected, onSelect }: any) {
  const max = Math.max(
    1,
    ...(data?.bands ?? []).map((b: any) =>
      Math.abs(Number(b.profitAtoms ?? 0)),
    ),
  );
  return (
    <section
      className="ws-panel score-performance"
      data-testid="score-performance"
      data-loaded={!!data}
    >
      <div className="ws-section-head">
        <div>
          <h2>评分下注表现</h2>
          <span>出票评分 · {data?.tickets ?? "—"} 票 · 点击评分查看下注</span>
        </div>
        <button
          className="secondary"
          onClick={() => onSelect("ALL")}
          aria-pressed={selected === "ALL"}
        >
          全部评分
        </button>
      </div>
      <div className="score-grade-grid">
        {data?.bands.map((b: any) => (
          <button
            key={b.grade}
            className={`score-grade ${selected === b.grade ? "selected" : ""}`}
            data-grade={b.grade}
            aria-pressed={selected === b.grade}
            onClick={() => onSelect(b.grade)}
          >
            <header>
              <b>{b.grade === "UNKNOWN" ? "未记录" : `${b.grade} 级`}</b>
              <span>{b.range}</span>
            </header>
            <strong
              className={
                Number(b.profitAtoms) < 0 ? "score-loss" : "score-profit"
              }
            >
              {money(b.profitAtoms)} <small>净收益</small>
            </strong>
            <div className="score-profit-track" aria-hidden="true">
              <i
                className={Number(b.profitAtoms) < 0 ? "negative" : "positive"}
                style={{
                  width: `${(Math.abs(Number(b.profitAtoms ?? 0)) / max) * 50}%`,
                }}
              />
            </div>
            <dl>
              <div>
                <dt>ROI</dt>
                <dd>{pct(b.roi)}</dd>
              </div>
              <div>
                <dt>投入</dt>
                <dd>{money(b.stakeAtoms)}</dd>
              </div>
              <div>
                <dt>赢 / 输 / 走退</dt>
                <dd>
                  {b.wins} / {b.losses} / {b.neutral}
                </dd>
              </div>
              <div>
                <dt>已结 / 未结</dt>
                <dd>
                  {b.settled} / {b.open}
                </dd>
              </div>
            </dl>
            <small>
              {b.count} 票
              {b.missingStake || b.missingProfit ? " · 存在缺失金额" : ""}
              {b.currencyMixed ? " · 多币种不可合计" : ""}
            </small>
          </button>
        ))}
      </div>
      <p className="score-method">
        {data?.attribution}{" "}
        各档不受下方评分筛选影响，日期、模型及其他筛选仍生效。评分是研究排序分，不是命中概率。
      </p>
      <details className="score-exact">
        <summary>查看每个具体分数的盈亏</summary>
        <div className="score-table-scroll">
          <table>
            <thead>
              <tr>
                <th>出票分数</th>
                <th>票数</th>
                <th>赢 / 输</th>
                <th>已结 / 未结</th>
                <th>投入</th>
                <th>净收益</th>
                <th>ROI</th>
              </tr>
            </thead>
            <tbody>
              {data?.exactScores.map((b: any) => (
                <tr key={b.score ?? "UNKNOWN"}>
                  <td>
                    <button
                      className="secondary"
                      aria-pressed={
                        selected ===
                        (b.score == null ? "UNKNOWN" : `EXACT:${b.score}`)
                      }
                      onClick={() =>
                        onSelect(
                          b.score == null ? "UNKNOWN" : `EXACT:${b.score}`,
                        )
                      }
                    >
                      {b.score == null ? "未记录" : `${b.score} · ${b.grade}`}
                    </button>
                  </td>
                  <td>{b.count}</td>
                  <td>
                    {b.wins} / {b.losses}
                  </td>
                  <td>
                    {b.settled} / {b.open}
                  </td>
                  <td>{money(b.stakeAtoms)}</td>
                  <td>{money(b.profitAtoms)}</td>
                  <td>{pct(b.roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {data && (
        <small>
          数据截止 {formatDate(data.asOf)} · ROI = 已结净收益 /
          已结有效投入；无行动为 —
        </small>
      )}
    </section>
  );
}
