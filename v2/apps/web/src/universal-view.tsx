import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { teamName, formatDate } from "../../../packages/display";
import { useReport } from "./use-report";
type Client = (path: string, body?: unknown, key?: string) => Promise<any>;
const pct = (v: any) => (v == null ? "—" : (Number(v) * 100).toFixed(1) + "%");
const money = (v: any) =>
  v == null
    ? "—"
    : (Number(v) / 1e6).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmt = (v: any) => (v == null ? "未记录" : formatDate(v));
const basis = (v: string) =>
  ({
    NATIONAL_OPPONENT_ADJUSTED_POISSON: "国家队攻防 / 对手强度",
    CLUB_STANDINGS_POISSON: "联赛攻防 / 进球模型",
    MARKET_FORM_ONLY: "市场与战绩 / 观察",
    MARKET_ONLY: "市场基准 / 对照",
  })[v as "MARKET_ONLY"] || v;
export function planName(p: any, r: any) {
  if (p.market === "1X2")
    return p.selection === "DRAW"
      ? "90分钟平局"
      : teamName(p.selection === "HOME" ? r.home : r.away, r.competition) +
          " · 90分钟胜";
  const line = (p.lineQ / 4).toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
  return p.market === "TOTAL_GOALS"
    ? (p.selection === "OVER" ? "大" : "小") + " " + line + " 球"
    : teamName(p.selection === "HOME" ? r.home : r.away, r.competition) +
        " " +
        (p.lineQ > 0 ? "+" : "") +
        line;
}
function PlanCard({ r, p, value }: any) {
  return (
    <article
      className={"general-card" + (value ? " value" : "")}
      data-testid="general-plan"
    >
      <div className="general-card-top">
        <span>{value ? "价值研究" : "广覆盖对照"}</span>
        <span>{fmt(r.kickoffAt)}</span>
      </div>
      <Link to={"/match/" + encodeURIComponent(r.fixtureId)}>
        <h3>
          {teamName(r.home, r.competition)} <span>vs</span>{" "}
          {teamName(r.away, r.competition)}
        </h3>
      </Link>
      <div className="general-selection">
        <strong>{planName(p, r)}</strong>
        <b>@ {Number(p.odds).toFixed(2)}</b>
      </div>
      <dl>
        <div>
          <dt>
            {p.probabilityKind === "STRESS"
              ? "压力概率"
              : p.probabilityKind === "CONSERVATIVE"
                ? "扣减后概率"
                : p.market === "1X2"
                  ? "模型概率"
                  : "获利概率"}
          </dt>
          <dd>{pct(p.probability)}</dd>
        </div>
        <div>
          <dt>保守EV</dt>
          <dd className={p.estimatedEV > 0 ? "positive" : ""}>
            {pct(p.estimatedEV)}
          </dd>
        </div>
        <div>
          <dt>价格门槛</dt>
          <dd>{p.minimumOdds == null ? "—" : p.minimumOdds.toFixed(2)}</dd>
        </div>
      </dl>
      <p className="general-action">
        {value
          ? "原版策略独立纸面记录 · 90分钟"
          : p.originalStrategy
            ? "原版广覆盖 / 保底纸面记录 · 收益待验证"
            : p.estimatedEV <= 0
              ? "当前价格不足：不投，保留对照"
              : "尚未过精选门槛：观察"}
      </p>
      <p>
        {basis(r.output.basis)} ·{" "}
        {r.output.sampleN == null
          ? "独立样本未齐"
          : `最少球队样本 ${r.output.sampleN}`}{" "}
        · 前瞻收益待验证
      </p>
      <small>
        {r.providerId.replace("ESPN_", "")} · 报价采集 {fmt(r.quoteObservedAt)}{" "}
        · 展示价
      </small>
      {!value && <small>{p.reasons?.join("；")}</small>}
      <Link
        className="general-details"
        to={"/match/" + encodeURIComponent(r.fixtureId)}
      >
        依据、盘口与原始证据 →
      </Link>
    </article>
  );
}
export function UniversalPanel({
  api,
  fixture,
}: {
  api: Client;
  fixture?: string;
}) {
  const { data, error } = useReport(
    api,
    "/workspace/universal" +
      (fixture ? "?fixture=" + encodeURIComponent(fixture) : ""),
  );
  const records = data?.records ?? [];
  const active = records.filter(
    (r: any) => r.fresh && r.actionable && r.state === "DONE",
  );
  const values = active
    .flatMap((r: any) =>
      r.output.plans
        .filter(
          (p: any) => p.isValue && p.accepted && p.ticketType !== "DOUBLE_LEG",
        )
        .map((p: any) => ({ r, p })),
    )
    .filter(
      (x: any, i: number, a: any[]) =>
        a.findIndex(
          (y) =>
            y.r.fixtureId === x.r.fixtureId &&
            y.p.market === x.p.market &&
            y.p.selection === x.p.selection &&
            y.p.lineQ === x.p.lineQ,
        ) === i,
    )
    .sort((a: any, b: any) => b.p.estimatedEV - a.p.estimatedEV);
  const broad = active.flatMap((r: any) =>
    r.output.plans
      .filter((p: any) => p.policyId === "general-v2-all-singles")
      .map((p: any) => ({ r, p })),
  );
  return (
    <section
      className="ws-panel general-panel"
      data-testid="general-panel"
      data-loaded={!!data}
    >
      <div className="ws-section-head">
        <div>
          <div className="ws-section-label">
            {data?.version?.label ?? "通用赛前分析 / GENERAL"}
          </div>
          <h2>{fixture ? "本场方案与价格条件" : "现在有哪些值得研究的方向"}</h2>
        </div>
        <Link to="/strategies">自动纸面策略 →</Link>
      </div>
      <p className="general-intro">
        根据实际取得的攻防数据和参考价格筛选，每个方向保留依据与拒绝原因。
      </p>
      {error && <p role="alert">通用分析读取失败：{error}</p>}
      <div className="general-coverage">
        <span>
          已分析 <b>{data?.coverage.analysedN ?? "—"}</b> 场
        </span>
        <span>
          有独立攻防 <b>{data?.coverage.independentN ?? "—"}</b> 场
        </span>
        <span>
          赛事 <b>{data?.coverage.competitionN ?? "—"}</b> 类
        </span>
        <span>
          当前价值 <b>{data ? values.length : "—"}</b> 个方向
        </span>
      </div>
      <div className="general-cards">
        {values.slice(0, fixture ? 10 : 6).map(({ r, p }: any) => (
          <PlanCard key={p.decisionId} r={r} p={p} value />
        ))}
      </div>
      {data && !values.length && (
        <div className="general-empty">
          <strong>
            {fixture && records[0]?.fixtureStatus !== "SCHEDULED"
              ? "比赛已经开赛，以下保留原赛前分析"
              : "当前没有通过价格与风险门槛的价值方向"}
          </strong>
          <p>
            {active.length}{" "}
            场仍在24小时执行窗口且报价采集不超过10分钟。没有入选不删比赛；下方保留有依据的赛前方向和拒绝理由。
          </p>
        </div>
      )}
      {broad.length > 0 && (
        <details className="general-broad">
          <summary>广覆盖赛前方向 · {broad.length}场 · 未达到精选门槛</summary>
          <h3 className="general-subtitle">
            广覆盖赛前方向 <span>只作对照，不把负EV当价值推荐</span>
          </h3>
          <div className="general-cards">
            {broad.slice(0, fixture ? 10 : 6).map(({ r, p }: any) => (
              <PlanCard key={p.decisionId} r={r} p={p} />
            ))}
          </div>
        </details>
      )}
      {fixture &&
        records.map((r: any) => (
          <details className="general-audit" key={r.id} open>
            <summary>
              全部市场评估与冻结依据 ·{" "}
              {r.fresh ? "采集在10分钟内" : "历史参考报价"}
            </summary>
            <p>
              预测时点 {fmt(r.cutoffAt)} · {basis(r.output.basis)} ·{" "}
              {r.output.reason === "NEUTRAL_VENUE_UNKNOWN"
                ? "场地是否中立尚未确认"
                : r.output.assumptions?.join("；")}
            </p>
            <div className="ws-table-scroll general-evaluated-table">
              <table>
                <thead>
                  <tr>
                    <th>玩法</th>
                    <th>参考价</th>
                    <th>方向概率</th>
                    <th>保守EV</th>
                    <th>价格门槛</th>
                    <th>判定</th>
                  </tr>
                </thead>
                <tbody>
                  {r.output.evaluated?.map((p: any, i: number) => (
                    <tr key={p.policyId + ":" + p.decisionId + ":" + i}>
                      <td>{planName(p, r)}</td>
                      <td>{Number(p.odds).toFixed(2)}</td>
                      <td>{pct(p.probability)}</td>
                      <td>{pct(p.estimatedEV)}</td>
                      <td>{p.minimumOdds?.toFixed(2) ?? "—"}</td>
                      <td>
                        {p.qualified ? "达到研究门槛" : p.reasons.join("；")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="general-market-cards">
              {r.output.evaluated?.map((p: any, i: number) => (
                <article
                  key={p.policyId + ":" + p.decisionId + ":" + i}
                  className="general-market-card"
                >
                  <strong>{planName(p, r)}</strong>
                  <span>{p.qualified ? "达到研究门槛" : "观察 / 未入选"}</span>
                  <dl>
                    <div>
                      <dt>参考价</dt>
                      <dd>{Number(p.odds).toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt>
                        {p.probabilityKind === "STRESS"
                          ? "压力概率"
                          : p.probabilityKind === "CONSERVATIVE"
                            ? "扣减后概率"
                            : p.market === "1X2"
                              ? "模型概率"
                              : "获利概率"}
                      </dt>
                      <dd>{pct(p.probability)}</dd>
                    </div>
                    <div>
                      <dt>保守EV</dt>
                      <dd>{pct(p.estimatedEV)}</dd>
                    </div>
                  </dl>
                  <p>
                    价格门槛 {p.minimumOdds?.toFixed(2) ?? "—"} ·{" "}
                    {p.qualified
                      ? "独立攻防 / 前瞻收益待验证"
                      : p.reasons.join("；")}
                  </p>
                </article>
              ))}
            </div>
            <p>
              亚洲盘/大小球使用完整比分分布，计入赢半、输半和走盘。概率与研究排序不是命中保证；赛后不重算原预测。
            </p>
            {r.output.grid && (
              <details>
                <summary>进球分布及证据</summary>
                <pre>
                  {JSON.stringify(
                    {
                      goal: r.output.goal,
                      margin: r.output.uncertaintyMargin,
                      hash: r.outputHash,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
          </details>
        ))}
      <p className="general-footnote">
        {data?.version
          ? data.version.description
          : "通用研究：未自动晋升。跨赛事迁移仍需前瞻记录。"}{" "}
        参考价纸面模拟 · 数据截止 {fmt(data?.asOf)}。
      </p>
    </section>
  );
}
export function GeneralLaboratory({ api }: { api: Client }) {
  const { data, error } = useReport(api, "/workspace/universal-metrics");
  const historic = data?.manifest?.national?.validation?.holdout;
  return (
    <section
      className="ws-panel general-panel"
      data-testid="general-laboratory"
      data-loaded={!!data}
    >
      <div className="ws-section-label">GENERAL / 冻结模型与前瞻记录</div>
      <h2>{data?.version?.label ?? "通用模型"}的概率与战绩</h2>
      {error && <p role="alert">{error}</p>}
      <p>
        {data?.version?.description ??
          "国家队独立攻防与俱乐部联赛攻防；缺必要数据不填假值。"}{" "}
        各版本账户独立，旧历史票不计入新账户战绩。
      </p>
      <div className="general-coverage">
        <span>
          已冻结赛前 <b>{data?.populationN ?? "—"}</b> 场
        </span>
        <span>
          已核验赛果 <b>{data?.probability.probabilityN ?? "—"}</b> 场
        </span>
        <span>未自动晋升 · 前瞻研究</span>
      </div>
      <div className="ws-table-scroll">
        <table>
          <thead>
            <tr>
              <th>同批前瞻概率</th>
              <th>N</th>
              <th>LogLoss</th>
              <th>Brier</th>
              <th>已结覆盖</th>
            </tr>
          </thead>
          <tbody>
            {[
              [data?.version?.label ?? "通用模型", data?.probability],
              ["市场去水基准", data?.baseline],
            ].map(([label, m]: any) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{m?.probabilityN ?? "—"}</td>
                <td>{m?.logLoss?.toFixed(4) ?? "—"}</td>
                <td>{m?.brier?.toFixed(4) ?? "—"}</td>
                <td>{pct(m?.coverage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        样本：每场首次冻结的赛前概率，只用已核验90分钟赛果。预测截止{" "}
        {fmt(data?.firstCutoffAt)} 至 {fmt(data?.lastCutoffAt)}；本轮统计{" "}
        {fmt(data?.asOf)}。
      </p>
      <h3>各策略实际纸面记录</h3>
      <div className="ws-table-scroll">
        <table>
          <thead>
            <tr>
              <th>策略 / 版本</th>
              <th>票数</th>
              <th>胜 / 负</th>
              <th>未结 / 已结</th>
              <th>投入</th>
              <th>净收益</th>
              <th>ROI</th>
              <th>均赔率</th>
              <th>最大回撤</th>
            </tr>
          </thead>
          <tbody>
            {data?.byStrategy.map((p: any) => (
              <tr key={p.id}>
                <td>
                  <Link
                    to={
                      "/ledger?mode=PAPER_RESEARCH&strategy=" +
                      encodeURIComponent(p.portfolioId)
                    }
                  >
                    {p.label}
                  </Link>
                  <small>
                    {p.strategyVersion}
                    {p.retired ? " · 初版已暂停" : ""}
                  </small>
                </td>
                <td>{p.metrics.count}</td>
                <td>
                  {p.metrics.wins} / {p.metrics.losses}
                </td>
                <td>
                  {p.metrics.open} / {p.metrics.settled}
                </td>
                <td>{money(p.metrics.stakeAtoms)}</td>
                <td>{money(p.metrics.profitAtoms)}</td>
                <td>{pct(p.metrics.roi)}</td>
                <td>{p.metrics.avgOdds?.toFixed(2) ?? "—"}</td>
                <td>{money(p.metrics.maxDrawdownAtoms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        金额为虚拟单位；无已结行动时ROI为空。初版冻结记录保留，策略账户分别统计，参考价不代表真实成交。
      </p>
      <details>
        <summary>国家队历史验证 · {historic?.N ?? "—"}场独立留出样本</summary>
        <p>
          仅男子成年国家队友谊赛，训练2010–2023年；2024年校准；留出样本{" "}
          {historic?.fromDate} 至 {historic?.throughDate}。LogLoss{" "}
          {historic?.LogLoss?.toFixed(4)}，Brier {historic?.Brier?.toFixed(4)}
          ，覆盖 {pct(historic?.coverage)}
          。缺历史赔率，ROI为空；该验证不能证明正式赛事或通用实时策略盈利。
        </p>
        <a
          href="https://github.com/martj42/international_results"
          target="_blank"
          rel="noreferrer"
        >
          原始历史数据说明 →
        </a>
        <div className="ws-table-scroll">
          <table>
            <thead>
              <tr>
                <th>概率区间</th>
                <th>预测事件N</th>
                <th>平均预测</th>
                <th>实际频率</th>
              </tr>
            </thead>
            <tbody>
              {historic?.calibration
                .filter((b: any) => b.N)
                .map((b: any) => (
                  <tr key={b.lower}>
                    <td>
                      {pct(b.lower)}–{pct(b.lower + 0.1)}
                    </td>
                    <td>{b.N}</td>
                    <td>{pct(b.predicted)}</td>
                    <td>{pct(b.observed)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
      {(["bySeason", "byLeague", "byOdds"] as const).map((key, i) => (
        <details key={key}>
          <summary>前瞻概率分{["赛季", "赛事", "赔率区间"][i]}</summary>
          {data?.[key]?.length ? (
            <div className="ws-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>样本组</th>
                    <th>N</th>
                    <th>模型LogLoss</th>
                    <th>市场LogLoss</th>
                    <th>模型Brier</th>
                  </tr>
                </thead>
                <tbody>
                  {data[key].map((g: any) => (
                    <tr key={g.key}>
                      <td>{g.key}</td>
                      <td>{g.N}</td>
                      <td>{g.model.logLoss?.toFixed(4)}</td>
                      <td>{g.baseline.logLoss?.toFixed(4)}</td>
                      <td>{g.model.brier?.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>当前尚无该组已核验赛果，不用0冒充效果。</p>
          )}
        </details>
      ))}
    </section>
  );
}
