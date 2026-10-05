import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { teamName, formatDate } from "../../../packages/display";
import { TeamName } from "./schedule-view";
const pct = (v: any) => (v == null ? "—" : (v * 100).toFixed(2) + "%");
const num = (v: any) => (v == null ? "—" : Number(v).toFixed(3));
const names: any = {
  BROAD_1X2: "V2 广覆盖方向",
  FEATURED_BEST_MARKET: "V2 每场最优玩法",
  V6_NATIVE: "V6 原生规则",
};
export const comparisonReason = (r: string) =>
  (
    ({
      UNSUPPORTED_COMPETITION: "V6仅支持五大联赛",
      LIVE_RAW_FEATURE_SNAPSHOT_PENDING: "原始特征准备中",
      OUTSIDE_ORIGINAL_10MIN_24H_WINDOW: "旧版原规则：开赛前10分钟至24小时",
      NO_SUPPORTED_EDGE: "原规则未发现支持的优势",
      QUOTE_STALE: "报价超过10分钟",
      NO_ORIGINAL_ELIGIBLE_DIRECTION: "没有符合原规则的方向",
    }) as any
  )[r] || r;
type Props = {
  api: (path: string) => Promise<any>;
  fixture?: string;
  compact?: boolean;
};
export function ComparisonPanel({ api, fixture, compact = false }: Props) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [population, setPopulation] = useState("common"),
    [directionsView, setDirectionsView] = useState("current"),
    [league, setLeague] = useState("ALL");
  const query = new URLSearchParams({
    league,
    ...(fixture ? { fixture } : {}),
  });
  useEffect(() => {
    let live = true;
    const read = () =>
      api("/workspace/comparison?" + query)
        .then((d) => {
          if (live) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    void read();
    const timer = setInterval(read, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [fixture, league]);
  const exportRecords = async () => {
    try {
      const all = await api("/workspace/comparison?" + query + "&export=1");
      let cursor = all.exportNextOffset;
      while (cursor !== null) {
        const page = await api(
          "/workspace/comparison?" +
            query +
            "&export=1&offset=" +
            cursor +
            "&before=" +
            new Date(all.recordCaptureBeforeAt).getTime() +
            "&sequence=" +
            all.observationSequence +
            "&adjudicationSequence=" +
            all.adjudicationSequence,
        );
        all.records.push(...page.records);
        cursor = page.exportNextOffset;
      }
      all.exportNextOffset = null;
      if (all.records.length !== all.totalRecords)
        throw Error("EXPORT_INCOMPLETE");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(all, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "魔虚罗-V6与旧版V2-冻结比较.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(String(e));
    }
  };
  const current = (data?.currentDirections || []).filter(
    (r: any) => new Date(r.kickoffAt).getTime() > Date.now(),
  );
  const visible = compact
    ? current.filter((r: any) => r.state === "DONE" && r.output.actions.length)
    : fixture
      ? [...(data?.latestRecords || [])].sort(
          (a: any, b: any) =>
            +(b.output.actions.length > 0) - +(a.output.actions.length > 0),
        )
      : directionsView === "tracked"
        ? (data?.trackedDirections ?? [])
        : current;
  return (
    <section
      className="ws-panel comparison-panel"
      data-testid="parallel-comparison"
      data-loaded={data !== undefined}
    >
      <div className="ws-section-head">
        <div>
          <p className="eyebrow">TWO METHODS / FROZEN FORWARD RESEARCH</p>
          <h2>
            {fixture ? "两套方法的冻结记录" : "V6 与 9月20日 V2 · 并行比较"}
          </h2>
        </div>
        {compact ? (
          <Link to="/models#parallel">查看完整比较 →</Link>
        ) : (
          <button className="secondary" onClick={exportRecords}>
            导出冻结记录 ↗
          </button>
        )}
      </div>
      <p className="ws-note">
        固定 V6 配置388，对照旧版 V2
        原提交默认值。两套读取同一份赛前报价；自动保存推断、跟踪赛果，每个方向按
        1 单位记录研究收益。V7 已封存，不自动替换。
      </p>
      {error && <p role="alert">比较读取失败：{error}</p>}
      {!data && !error && <p role="status">正在读取并行记录…</p>}
      {data && !compact && !fixture && (
        <p className="ws-note">
          两套已运行的近期方向记录 {current.length} 份 ·{" "}
          <a href="#parallel-directions">直接看冻结方向 ↓</a>
        </p>
      )}
      {data && !compact && !fixture && (
        <>
          <div className="ws-filters">
            <label className="ws-filter">
              <span>比较口径</span>
              <select
                aria-label="比较口径"
                value={population}
                onChange={(e) => setPopulation(e.target.value)}
              >
                <option value="common">同场同报价共同样本</option>
                <option value="all">各自首次成功覆盖</option>
              </select>
            </label>
            <label className="ws-filter">
              <span>比较联赛</span>
              <select
                aria-label="比较联赛"
                value={league}
                onChange={(e) => setLeague(e.target.value)}
              >
                <option value="ALL">全部已记录</option>
                {[
                  ...new Set<string>(
                    data.records.map((r: any) => r.competition),
                  ),
                ].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="ws-summary">
            <div className="ws-stat">
              <span>同场共同样本</span>
              <strong>{data.commonFixtureN}</strong>
              <small>重复刷新不增加比赛数</small>
            </div>
            <div className="ws-stat">
              <span>各自成功覆盖 · V6 / V2</span>
              <strong>
                {data.methods.map((m: any) => m.successfulFixtureN).join(" / ")}
              </strong>
              <small>共 {data.totalRecords} 份冻结记录；受阻保留原因</small>
            </div>
            <div className="ws-stat">
              <span>统计截止</span>
              <strong className="comparison-at">{formatDate(data.asOf)}</strong>
            </div>
          </div>
          <div className="comparison-table">
            <table>
              <thead>
                <tr>
                  <th>固定方法 / 策略</th>
                  <th>预测N / 覆盖</th>
                  <th>行动 / 已结 / 未结</th>
                  <th>赢 / 输 / 走</th>
                  <th>净收益</th>
                  <th>ROI</th>
                  <th>平均赔率</th>
                  <th>回撤</th>
                  <th>LogLoss / Brier</th>
                </tr>
              </thead>
              <tbody>
                {data.methods.flatMap((m: any) =>
                  m.metrics.map((s: any) => {
                    const v = s[population];
                    return (
                      <tr key={m.id + s.strategy}>
                        <td>
                          <strong>{names[s.strategy]}</strong>
                          <small>{m.label}</small>
                        </td>
                        <td>
                          {v.predictionN} / {m.capturedFixtureN}
                        </td>
                        <td>
                          {v.actionN} / {v.settledN} / {v.openN}
                        </td>
                        <td>
                          {v.wins} / {v.losses} / {v.pushes}
                        </td>
                        <td>{num(v.netUnits)} 单位</td>
                        <td>{pct(v.roi)}</td>
                        <td>{num(v.averageOdds)}</td>
                        <td>{num(v.drawdown)}</td>
                        <td>
                          {num(v.logLoss)} / {num(v.brier)}
                          {m.id.startsWith("V6") && (
                            <small>压力输出不计算中心概率指标</small>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          {data.methods.map((m: any) => (
            <details className="ws-audit" key={m.id}>
              <summary>{m.label} · 冻结信息与受阻原因</summary>
              <p>
                封存 {formatDate(m.frozenAt)} · hash {m.manifestHash}
              </p>
              {Object.entries(m.blockedReasons).map(([r, n]: any) => (
                <p key={r}>
                  {comparisonReason(r)}：{n} 次
                </p>
              ))}
              <pre>{JSON.stringify(m.manifest, null, 2)}</pre>
              {m.metrics.map((s: any) => (
                <div key={s.strategy}>
                  <h3>
                    {names[s.strategy]} ·{" "}
                    {population === "common" ? "共同样本" : "各自覆盖"}分组
                  </h3>
                  <p>
                    赛季按7月至次年6月；赔率段左闭右开。所有统计截止{" "}
                    {formatDate(data.asOf)}。
                  </p>
                  {Object.entries(s.breakdown).map(([kind, groups]: any) => (
                    <div key={kind}>
                      <strong>
                        {
                          (
                            {
                              leagues: "分联赛",
                              seasons: "分赛季",
                              odds: "分赔率段",
                            } as any
                          )[kind]
                        }
                      </strong>
                      {groups.map((g: any) => (
                        <p key={g.label}>
                          {g.label} · N {g[population].predictionN} · 已结{" "}
                          {g[population].settledN} · ROI{" "}
                          {pct(g[population].roi)} · 回撤{" "}
                          {num(g[population].drawdown)}
                        </p>
                      ))}
                    </div>
                  ))}
                  <p>
                    中心概率校准样本 {s[population].probabilityN}
                    ；V6压力值不作为中心概率。详细校准桶可导出。
                  </p>
                </div>
              ))}
            </details>
          ))}
          <p className="ws-note">
            {data.commonFixtureN === 0
              ? "尚无同场共同样本：V6只支持五大联赛，旧V2只在开赛前10分钟至24小时运行。各自成功覆盖可查看已运行比赛，受阻不等于模型失败。"
              : "共同样本取同一场、同一份报价的首次成功推断；每次刷新不重复计数。"}
            {data.methods.every((m: any) =>
              m.metrics.every((s: any) => s.common.settledN === 0),
            )
              ? "目前共同样本尚未结算，不能判断谁更好。"
              : "请结合已结样本数量、收益、回撤和校准评估，不自动宣布或晋升优胜方法。"}
            公开参考价研究统计与旧账本、真实资金分开。
          </p>
        </>
      )}
      {!fixture && (
        <div className="ws-pills" aria-label="模型推荐记录">
          <button
            className={directionsView === "current" ? "selected" : "secondary"}
            onClick={() => setDirectionsView("current")}
          >
            赛前方向
          </button>
          <button
            className={directionsView === "tracked" ? "selected" : "secondary"}
            onClick={() => setDirectionsView("tracked")}
          >
            跟踪已保存方向
          </button>
          <Link to="/workbench?view=TRACKED">全部推荐跟踪 →</Link>
        </div>
      )}
      <div
        className="comparison-records"
        id={!fixture && !compact ? "parallel-directions" : undefined}
      >
        {visible?.slice(0, compact ? 4 : fixture ? 12 : 16).map((r: any) => (
          <article className="comparison-record" key={r.id}>
            <div>
              <small>
                {r.methodId.startsWith("V6") ? "V6 配置388" : "旧版 V2"} ·{" "}
                {formatDate(r.cutoffAt)}
              </small>
              <Link to={"/match/" + encodeURIComponent(r.fixtureId)}>
                <TeamName name={r.home} competition={r.competition} />{" "}
                <span>vs</span>{" "}
                <TeamName name={r.away} competition={r.competition} />
              </Link>
              <small>
                开赛 {formatDate(r.kickoffAt)} · {r.competition}
              </small>
              <small>
                {r.fixtureStatus === "FINISHED"
                  ? "已结束 · 原预测冻结"
                  : new Date(r.kickoffAt).getTime() <= Date.now()
                    ? "已到开球时间 · 继续跟踪"
                    : "赛前研究方向"}
                {r.resultState === "REVIEW"
                  ? " · 赛果待复核"
                  : r.resultState === "ACCEPTED_REGULATION"
                    ? ` · 90分钟 ${JSON.parse(r.regulationJson).home} : ${JSON.parse(r.regulationJson).away}`
                    : ""}
              </small>
              <small>
                报价采集 {formatDate(r.quoteObservedAt)} · {r.quoteProviderId}
              </small>
              {Date.now() - new Date(r.quoteObservedAt).getTime() > 600000 && (
                <small>
                  {new Date(r.kickoffAt).getTime() <= Date.now()
                    ? "赛前报价永久冻结 · 赛后不刷新原预测"
                    : "报价已过10分钟 · 此处保留冻结记录，等待自动刷新"}
                </small>
              )}
            </div>
            <div>
              {r.output.central && (
                <small>
                  中心概率 · 主 {pct(r.output.central[0])} / 平{" "}
                  {pct(r.output.central[1])} / 客 {pct(r.output.central[2])}
                </small>
              )}
              {r.state === "BLOCKED" ? (
                <p>{comparisonReason(r.output.reason)}</p>
              ) : r.output.actions.length ? (
                r.output.actions.map((a: any) => (
                  <p key={a.strategy}>
                    {names[a.strategy]} ·{" "}
                    {
                      (
                        {
                          HOME: "主",
                          DRAW: "平",
                          AWAY: "客",
                          OVER: "大",
                          UNDER: "小",
                        } as any
                      )[a.selection]
                    }{" "}
                    {a.lineQ === null ? "" : a.lineQ / 4} @{" "}
                    {a.odds == null ? "—" : Number(a.odds).toFixed(2)}
                    <small>
                      {r.methodId.startsWith("V6") ? "压力值" : "保守选择值"}{" "}
                      {pct(a.probability)} · EV {pct(a.estimatedEV)}
                      {a.estimatedEV <= 0 ? " · 负优势观察方向" : ""}
                    </small>
                  </p>
                ))
              ) : (
                <p>已成功推断 · 原规则无行动</p>
              )}
            </div>
            <details className="ws-audit">
              <summary>冻结证据</summary>
              <pre>{JSON.stringify(r.output, null, 2)}</pre>
            </details>
          </article>
        ))}
      </div>
      {data && !visible?.length && (
        <p className="ws-note">
          等待已发现赛事的赛前报价；采集与推断在后台自动推进。未入选比赛仍在完整赛程中。
        </p>
      )}
      {data && !compact && (
        <details className="ws-audit">
          <summary>最近任务与受阻记录 · {data.records.length} 份</summary>
          {data.records.map((r: any) => (
            <p key={r.id}>
              {r.methodId.startsWith("V6") ? "V6" : "旧V2"} · {teamName(r.home)}
              —{teamName(r.away)} · {formatDate(r.cutoffAt)} ·{" "}
              {r.state === "BLOCKED"
                ? comparisonReason(r.output.reason)
                : r.output.actions.length
                  ? "已冻结研究方向"
                  : "成功推断，无行动"}
            </p>
          ))}
        </details>
      )}
      {data && !compact && (
        <details className="ws-audit">
          <summary>统计约定与 V7 封存</summary>
          {data.limitations.map((s: string) => (
            <p key={s}>{s}</p>
          ))}
          <pre>{JSON.stringify(data.savedV7, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
