import React from "react";
import { Link } from "react-router-dom";
import { teamName, formatDate } from "../../../packages/display";
import { TeamBadge } from "./schedule-view";
const labels: Record<string, string> = {
  WIN: "赢",
  LOSS: "输",
  HALF_WIN: "半赢",
  HALF_LOSS: "半输",
  VOID: "退款",
  PUSH: "走盘",
  OPEN: "待结算",
  REVIEW: "待复核",
  UNKNOWN: "结果未保存",
};
const money = (x: any) =>
  x == null
    ? "—"
    : (Number(x) / 1e6).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const date = (x: any) => (x == null ? "时间未保存" : formatDate(x));
export function TicketCards({
  records,
  onDetail,
  basis,
  compact = false,
}: any) {
  return (
    <div
      className={"ticket-cards" + (compact ? " compact" : "")}
      data-testid="ticket-cards"
    >
      {records?.map((r: any) => (
        <article
          className={`ticket-card outcome-${r.outcome}`}
          key={r.id}
          data-testid="ticket-card"
        >
          <header>
            <div>
              <b>{r.strategyLabel ?? r.strategy}</b>
              <p>
                {r.legCount > 1 ? `${r.legCount} 串 1` : "单场"} ·{" "}
                <time>{date(basis === "SETTLED" ? r.settledAt : r.at)}</time>
              </p>
            </div>
            <strong className="ticket-outcome">
              {labels[r.outcome] ?? r.status}
              {r.pnlAtoms != null && <small>净收益 {money(r.pnlAtoms)}</small>}
            </strong>
          </header>
          {r.legs?.map((l: any, i: number) => (
            <div className="ticket-leg" key={i}>
              <div>
                <div className="ticket-teams">
                  <span>
                    <TeamBadge name={l.home} logo={l.homeLogo} />
                    <b>{teamName(l.home, l.league ?? l.leagueCode)}</b>
                  </span>
                  <em>vs</em>
                  <span>
                    <TeamBadge name={l.away} logo={l.awayLogo} />
                    <b>{teamName(l.away, l.league ?? l.leagueCode)}</b>
                  </span>
                </div>
                <p className="ticket-selection">
                  {String(l.selectionLabel)
                    .replace(
                      /^主队/,
                      teamName(l.home, l.league ?? l.leagueCode),
                    )
                    .replace(
                      /^客队/,
                      teamName(l.away, l.league ?? l.leagueCode),
                    )}{" "}
                  <strong>
                    @ {l.odds == null ? "未保存" : Number(l.odds).toFixed(2)}
                  </strong>
                </p>
                <small>
                  {(
                    {
                      ASIAN_HANDICAP: "亚洲盘",
                      TOTAL_GOALS: "大小球",
                      "1X2": "胜平负",
                      spread: "亚洲盘",
                      total: "大小球",
                    } as any
                  )[l.market] ??
                    l.marketType ??
                    "原市场"}{" "}
                  · 开赛 {date(l.kickoffAt)}
                </small>
              </div>
              <div className={`leg-result outcome-${l.outcome}`}>
                <b>{l.finalScore ?? "—"}</b>
                <span>{labels[l.outcome] ?? "结果待核验"}</span>
                {l.fixtureId && (
                  <Link to={"/match/" + encodeURIComponent(l.fixtureId)}>
                    比赛详情 ↗
                  </Link>
                )}
              </div>
            </div>
          ))}
          <footer>
            <span>
              票面{r.legCount > 1 ? "组合" : ""}赔率{" "}
              <b>@ {r.odds == null ? "未保存" : Number(r.odds).toFixed(2)}</b>
            </span>
            <span>
              投入 <b>{money(r.stakeAtoms)}</b>
            </span>
            <span>
              返还 <b>{money(r.grossAtoms)}</b>
            </span>
            <span>
              {r.currency === "VIRTUAL_UNITS" || r.currency === "PAPER"
                ? "虚拟单位"
                : r.currency === "UNKNOWN"
                  ? "原币种未记录"
                  : r.currency}
            </span>
            <button className="secondary" onClick={() => onDetail(r)}>
              复盘 ↗
            </button>
          </footer>
        </article>
      ))}
    </div>
  );
}
export function StrategyBalances({ strategies, selected, onSelect }: any) {
  return (
    <details className="ws-panel strategy-balances">
      <summary>各策略账本 · 单场、二串一及旧版十策略</summary>
      <div>
        {strategies?.map((s: any) => (
          <button
            className={selected === s.id ? "selected" : ""}
            key={s.id}
            onClick={() => onSelect(s.id)}
          >
            <b>{s.name}</b>
            <span>
              {s.count} 票 · 赢 {s.wins} / 输 {s.losses} · 未结 {s.open}
            </span>
            <strong>累计净收益 {money(s.profitAtoms)}</strong>
            <small>
              ROI {s.roi == null ? "—" : (s.roi * 100).toFixed(2) + "%"} ·{" "}
              {s.enabled === false || s.enabled === 0
                ? "暂停新增"
                : "保留原策略记录"}
            </small>
          </button>
        ))}
      </div>
    </details>
  );
}
export function DailyLedger({ days, onSelect }: any) {
  return (
    <details className="ws-panel">
      <summary>每日对账 · 投注与结算分开</summary>
      <p className="ws-caption">
        当前票据来源的全策略账日汇总；不随上方筛选变化。点日期查看当日结算票。
      </p>
      <div className="ws-table-scroll">
        <table>
          <thead>
            <tr>
              <th>账日</th>
              <th>新票数</th>
              <th>投注投入</th>
              <th>已结票数</th>
              <th>赢 / 输</th>
              <th>结算净收益</th>
              <th>ROI</th>
            </tr>
          </thead>
          <tbody>
            {days?.map((d: any) => (
              <tr key={d.day}>
                <td>
                  <button className="secondary" onClick={() => onSelect(d.day)}>
                    {d.day} ↗
                  </button>
                </td>
                <td>{d.createdCount}</td>
                <td>{money(d.placedStakeAtoms)}</td>
                <td>{d.settled}</td>
                <td>
                  {d.wins} / {d.losses}
                </td>
                <td>{money(d.profitAtoms)}</td>
                <td>{d.roi == null ? "—" : (d.roi * 100).toFixed(2) + "%"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>单张串关票只计一次；点击日期查看当日结算原票。</p>
    </details>
  );
}
