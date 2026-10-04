import React from "react";
import { Link } from "react-router-dom";
import {
  teamName,
  teamOriginalName,
  formatTime,
  calendarDay,
  formatDate,
  groupResearchDirections,
  researchBetKey,
} from "../../../packages/display";
import { ResearchScore } from "./research-score";
export function TeamName({ name, competition = "" }: any) {
  const chinese = teamName(name, competition),
    original = teamOriginalName(name);
  return (
    <span className="team-name">
      <span>{chinese || "球队名称未提供"}</span>
      {original && original !== chinese && (
        <small className="team-original" lang="en">
          {original}
        </small>
      )}
    </span>
  );
}
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
  React.useEffect(() => setFailed(false), [logo]);
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
          [
            "research",
            data?.version?.label ?? "当前模型研究",
            data?.candidateCounts?.research,
          ],
          ["strict", "严格前瞻", data?.candidateCounts?.strict],
          ["observe", "待观察", data?.candidateCounts?.observations],
        ].map(([key, label, count]) => (
          <button
            key={String(key)}
            aria-pressed={tab === key}
            className={tab === key ? "selected" : "secondary"}
            onClick={() => setTab(String(key))}
          >
            {label} <b>{key === "strict" ? "未启用" : (count ?? "—")}</b>
          </button>
        ))}
        <span>研究排序分 ≠ 命中概率</span>
      </div>
      <p className="ws-muted">
        {tab === "research"
          ? `本栏使用${data?.version?.label ?? "当前所选模型"}，分数读取保存的排序值。模型概率、EV、数据完整度分别展示，收益优势尚未验证。`
          : tab === "strict"
            ? "严格前瞻是赛前输入、固定规则和记录的验证资格，不是另一个算法名称。"
            : "没有入选的比赛仍在完整赛程中；等待补证不代表现实没有机会。"}
      </p>
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
                <TeamName name={f.home} competition={f.competition} /> —{" "}
                <TeamName name={f.away} competition={f.competition} />
              </strong>
              <small>
                {calendarDay(f.kickoffAt)} {formatTime(f.kickoffAt)}
              </small>
            </div>
            {f.research ? (
              <>
                <ResearchScore
                  score={f.research.rankScore}
                  original={data?.version?.id === "SEPTEMBER20"}
                  compact
                />
                <b className="recommendation-direction">
                  {f.research.selectionName}{" "}
                  <span>
                    @{" "}
                    {Number(f.research.decimalOdds ?? f.research.odds).toFixed(
                      2,
                    )}
                  </span>
                </b>
                <p>
                  {f.research.probabilityKind === "STRESS"
                    ? "压力概率"
                    : f.research.probabilityKind === "CONSERVATIVE"
                      ? "扣减后概率"
                      : "模型概率"}{" "}
                  {pct(f.research.probability)} · 估算EV {pct(f.research.ev)}
                </p>
                <small>
                  {f.research.modelLabel} · 未验证研究 · 证据{" "}
                  {pct(f.completeness)}
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
              ? "严格推荐尚未启用，当前没有正式资格结果。V6固定研究与旧V2保存方向在推荐跟踪中可查看；不能把本栏为空解释成扫描后没有机会。"
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
      {data?.items.map((f: any) => {
        const current = f.state === "CANDIDATE" ? f.research : null;
        const currentKey = current
          ? researchBetKey({
              ...current,
              modelId: current.modelId ?? data?.version?.modelId,
            })
          : null;
        const groups = groupResearchDirections(f.generalDirections);
        const earlier = groups.find(
          (g) => researchBetKey(g.primary) === currentKey,
        );
        return (
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
                <strong>
                  <TeamName name={f.home} competition={f.competition} />
                </strong>
              </div>
              <div>
                <TeamBadge name={f.away} logo={f.publicData?.awayLogo} />
                <strong>
                  <TeamName name={f.away} competition={f.competition} />
                </strong>
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
                  <ResearchScore
                    score={f.research.rankScore}
                    original={data?.version?.id === "SEPTEMBER20"}
                    compact
                    label="当前研究评分"
                    betKey={currentKey}
                  />
                  <strong>
                    {f.research.selectionName} · EV {pct(f.research.ev)}
                  </strong>
                  <small>
                    {f.research.probabilityKind === "STRESS"
                      ? "压力概率"
                      : f.research.probabilityKind === "CONSERVATIVE"
                        ? "扣减后概率"
                        : "研究概率"}{" "}
                    {pct(f.research.probability)}
                  </small>
                  <small>
                    {f.research.modelLabel} ·{" "}
                    {f.research.policyLabel ?? "当前候选"}
                  </small>
                  {earlier && (
                    <small className="score-history">
                      首次赛前记录：{earlier.primary.rank ?? "未提供"}分
                      {earlier.primary.cutoffAt
                        ? ` · ${formatDate(earlier.primary.cutoffAt)}`
                        : ""}
                      {` · @ ${Number(earlier.primary.odds).toFixed(2)}`} ·
                      历史评分不随当前评分改写
                    </small>
                  )}
                </>
              ) : (
                <small>{f.reason}</small>
              )}
              {f.state !== "CANDIDATE" && f.tracking && (
                <div className="saved-direction">
                  <b>
                    旧市场启发式 · 原方向 {f.tracking.selectionName} @{" "}
                    {Number(f.tracking.decimalOdds).toFixed(2)}
                  </b>
                  <small>
                    冻结概率 {pct(f.tracking.probability)} · EV{" "}
                    {pct(f.tracking.ev)}
                  </small>
                  <small>首次入选 {formatDate(f.tracking.cutoffAt)}</small>
                </div>
              )}
              {groups
                .filter((g) => researchBetKey(g.primary) !== currentKey)
                .map((g) => {
                  const p = g.primary;
                  return (
                    <div
                      className="saved-direction"
                      key={researchBetKey(p)}
                      data-testid="saved-direction"
                      data-bet-key={researchBetKey(p)}
                    >
                      <ResearchScore
                        score={p.rank}
                        original={data?.version?.id === "SEPTEMBER20"}
                        compact
                        label={
                          data?.version?.id === "GENERAL"
                            ? "首次赛前评分"
                            : "赛前保存评分"
                        }
                        betKey={researchBetKey(p)}
                      />
                      <b>
                        {p.selectionName ??
                          `${({ "1X2": "胜平负", ASIAN_HANDICAP: "亚洲盘", TOTAL_GOALS: "大小球" } as any)[p.market] ?? p.market} · ${directionName(p)}`}
                        {p.selectionName || p.lineQ == null
                          ? ""
                          : ` ${p.lineQ > 0 ? "+" : ""}${p.lineQ / 4}`}{" "}
                        @ {Number(p.odds).toFixed(2)}
                      </b>
                      <small>
                        适用策略：{g.policies.join(" / ") || "赛前研究"}
                      </small>
                      <small>
                        {p.probabilityKind === "STRESS"
                          ? "压力概率"
                          : p.probabilityKind === "CONSERVATIVE"
                            ? "扣减后概率"
                            : "原概率"}{" "}
                        {pct(p.probability)} · 保守EV {pct(p.estimatedEV)} ·
                        冻结 {formatDate(p.cutoffAt)}
                      </small>
                      {g.records.some(
                        (r) =>
                          r.rank !== p.rank ||
                          r.odds !== p.odds ||
                          r.cutoffAt !== p.cutoffAt,
                      ) && (
                        <small>
                          其他策略或时点另有冻结评分，详情中分别保留；此处使用首条保存记录。
                        </small>
                      )}
                    </div>
                  );
                })}
              {f.parallelDirections?.map((r: any) => (
                <div className="saved-direction" key={r.id}>
                  <b>
                    {r.methodId.startsWith("V6") ? "V6赛前" : "旧V2赛前"} ·{" "}
                    {r.actions
                      .map(
                        (a: any) =>
                          `${({ BROAD_1X2: "广覆盖", FEATURED_BEST_MARKET: "最优玩法", V6_NATIVE: "原生规则" } as any)[a.strategy] ?? a.strategy}：${directionName(a)}${a.lineQ == null ? "" : a.lineQ / 4} @ ${a.odds == null ? "—" : Number(a.odds).toFixed(2)}`,
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
        );
      })}
    </div>
  );
}
