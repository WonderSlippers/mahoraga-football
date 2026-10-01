import React from "react";
import { Link } from "react-router-dom";
import {
  teamName,
  formatTime,
  calendarDay,
  formatDate,
} from "../../../packages/display";
const pct = (v: any) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
export function Scoreboard({ value, compact = false }: any) {
  if (!value?.score && !value?.clock) return null;
  return (
    <div className={"fixture-score " + (value.stale ? "stale" : "")}>
      {!compact && (
        <b aria-label="来源比分">
          {value.score?.map((n: any) => n ?? "—").join(" : ") ?? "— : —"}
        </b>
      )}
      <span>
        {value.clock ? `${value.clock} · ` : ""}
        {value.label}
        {value.stale ? " · 上次快照" : ""}
      </span>
      <small>
        采集 {value.observedAt ? formatDate(value.observedAt) : "时间未提供"}
      </small>
      {value.stalled && <small>比分与分钟连续未变 · 进展待确认</small>}
    </div>
  );
}
const directionName = (a: any) =>
  (({ HOME: "主", DRAW: "平", AWAY: "客", OVER: "大", UNDER: "小" }) as any)[
    a.selection
  ] ?? a.selection;
export function TeamBadge({ name, logo }: any) {
  const [failed, setFailed] = React.useState(false);
  const safe =
    typeof logo === "string" &&
    /^https:\/\/a\.espncdn\.com\/i\/teamlogos\//.test(logo);
  return safe && !failed ? (
    <img
      className="team-crest"
      src={logo}
      alt=""
      loading="lazy"
      onError={(e) => {
        setFailed(true);
      }}
    />
  ) : (
    <span className="team-crest fallback" aria-hidden="true">
      {teamName(name).slice(0, 1)}
    </span>
  );
}
export function Recommendations({ data, onSelect }: any) {
  const [tab, setTab] = React.useState("research");
  const groups: any = {
    research: data?.researchCandidates ?? [],
    strict: data?.strictCandidates ?? [],
    observe: data?.observations ?? [],
  };
  return (
    <section className="recommendations" aria-label="比赛推荐">
      <div className="recommendation-tabs">
        {[
          ["research", "研究推荐", data?.candidateCounts?.research],
          ["strict", "严格前瞻", data?.candidateCounts?.strict],
          ["observe", "待观察", data?.candidateCounts?.observations],
        ].map(([key, label, count]) => (
          <button
            key={String(key)}
            className={tab === key ? "selected" : "secondary"}
            onClick={() => setTab(String(key))}
          >
            {label} <b>{count ?? "—"}</b>
          </button>
        ))}
        <span>研究排序分 ≠ 命中概率</span>
      </div>
      <div className="recommendation-rail">
        {groups[tab].slice(0, 6).map((f: any) => (
          <Link
            key={f.id}
            className="recommendation-card"
            to={"/match/" + encodeURIComponent(f.id)}
            onClick={onSelect}
          >
            <div>
              <strong>
                {teamName(f.home, f.competition)} —{" "}
                {teamName(f.away, f.competition)}
              </strong>
              <small>
                {calendarDay(f.kickoffAt)} {formatTime(f.kickoffAt)}
              </small>
            </div>
            {f.research ? (
              <>
                <b className="recommendation-direction">
                  {f.research.selectionName}{" "}
                  <span>{Number(f.research.decimalOdds).toFixed(2)}</span>
                </b>
                <p>
                  研究概率 {pct(f.research.probability)} · 估算EV{" "}
                  {pct(f.research.ev)}
                </p>
                <small title="固定80%市场与20%近期赛况，仅用于未验证研究">
                  未验证研究 · 证据 {pct(f.completeness)}
                </small>
              </>
            ) : (
              <>
                <p>{f.reason}</p>
                <small>点击查看已取得的报价、战绩和下一步</small>
              </>
            )}
          </Link>
        ))}
        {!groups[tab].length && (
          <div className="recommendation-empty">
            {tab === "strict"
              ? "严格前瞻当前未达资格：V6/V7必要特征与训练时间证据尚未齐备。研究推荐单独展示。"
              : tab === "research"
                ? "本轮没有达到研究门槛的方向。下方所有近期比赛仍可查看报价和具体判断；后台持续刷新。"
                : "本范围没有等待观察的赛前比赛。"}
          </div>
        )}
      </div>
      {groups[tab].length > 6 && (
        <button
          className="secondary recommendation-more"
          aria-label={`查看全部 ${data?.candidateCounts?.[tab === "research" ? "research" : "observations"]} 场`}
          onClick={() => onSelect?.(tab === "research" ? "CANDIDATE" : "WATCH")}
        >
          全部{" "}
          {
            data?.candidateCounts?.[
              tab === "research" ? "research" : "observations"
            ]
          }{" "}
          场 →
        </button>
      )}
    </section>
  );
}
export function FixtureList({ data, onSelect }: any) {
  return (
    <div className="fixture-list">
      {data?.items.map((f: any) => (
        <Link
          className="fixture-card"
          key={f.id}
          to={"/match/" + encodeURIComponent(f.id)}
          onClick={onSelect}
        >
          <div className="fixture-clock">
            <strong>{formatTime(f.kickoffAt)}</strong>
            <small>{calendarDay(f.kickoffAt)}</small>
            <small>
              {data.metadata?.leagues?.find(
                (l: any) => l.code === f.competition,
              )?.name ??
                (f.competition === "DEMO" ? "DEMO 合成赛事" : f.competition)}
            </small>
          </div>
          <div className="fixture-teams">
            <div>
              <TeamBadge name={f.home} logo={f.publicData?.homeLogo} />
              <strong title={f.home}>{teamName(f.home, f.competition)}</strong>
            </div>
            <div>
              <TeamBadge name={f.away} logo={f.publicData?.awayLogo} />
              <strong title={f.away}>{teamName(f.away, f.competition)}</strong>
            </div>
          </div>
          <div className="fixture-prices">
            {f.state === "STARTED" || f.state === "FINISHED" ? (
              <>
                <Scoreboard value={f.scoreboard} />
                {!f.scoreboard?.score && <span>比分尚未取得 · 不填0</span>}
                <small>赛前报价与预测在详情中继续保留</small>
              </>
            ) : f.referenceMarket ? (
              <>
                <span>主 / 平 / 客 · 公开参考</span>
                <b>
                  {f.referenceMarket.prices
                    .map((x: any) => Number(x).toFixed(2))
                    .join(" / ")}
                </b>
                <small>
                  市场去水{" "}
                  {f.referenceMarket.probabilities.map(pct).join(" / ")}
                </small>
              </>
            ) : (
              <>
                <span>报价正在补取</span>
                <small>
                  {f.publicData?.detail?.homeRecent?.length
                    ? "已取得近期战绩"
                    : "赛程已确认，后台继续补证"}
                </small>
              </>
            )}
          </div>
          <div className="fixture-judgment">
            <span className={"ws-state state-" + f.state}>{f.label}</span>
            {f.state === "CANDIDATE" && f.research ? (
              <>
                <strong>
                  {f.research.selectionName} · EV {pct(f.research.ev)}
                </strong>
                <small>
                  研究概率 {pct(f.research.probability)} · 排序{" "}
                  {f.research.rankScore}
                </small>
              </>
            ) : (
              <small>{f.reason}</small>
            )}
            {f.state !== "CANDIDATE" && f.tracking && (
              <div className="saved-direction">
                <b>
                  赛前研究 · {f.tracking.selectionName} @{" "}
                  {Number(f.tracking.decimalOdds).toFixed(2)}
                </b>
                <small>
                  冻结概率 {pct(f.tracking.probability)} · EV{" "}
                  {pct(f.tracking.ev)}
                </small>
                <small>首次入选 {formatDate(f.tracking.cutoffAt)}</small>
              </div>
            )}
            {f.parallelDirections?.map((r: any) => (
              <div className="saved-direction" key={r.id}>
                <b>
                  {r.methodId.startsWith("V6") ? "V6赛前" : "旧V2赛前"} ·{" "}
                  {r.actions
                    .map(
                      (a: any) =>
                        `${({ BROAD_1X2: "广覆盖", FEATURED_BEST_MARKET: "最优玩法", V6_NATIVE: "原生规则" } as any)[a.strategy] ?? a.strategy}：${directionName(a)}${a.lineQ == null ? "" : a.lineQ / 4} @ ${a.odds}`,
                    )
                    .join(" / ")}
                </b>
                <small>
                  冻结 {formatDate(r.cutoffAt)} ·{" "}
                  {r.actions
                    .map((a: any) => `EV ${pct(a.estimatedEV)}`)
                    .join(" / ")}
                </small>
              </div>
            ))}
            <small>
              证据完整度 {pct(f.completeness)}
              {f.validation === "LEGACY_NON_PROSPECTIVE" ? " · 历史档案" : ""}
            </small>
          </div>
          <b className="ws-arrow">↗</b>
        </Link>
      ))}
    </div>
  );
}
