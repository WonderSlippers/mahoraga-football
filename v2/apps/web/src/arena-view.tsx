import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useReport } from "./use-report";
import { TicketCards } from "./ticket-cards";
import { formatDate } from "../../../packages/display";

const money = (x: any) =>
  x == null
    ? "—"
    : (Number(x) / 1e6).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (x: any) => (x == null ? "—" : (x * 100).toFixed(1) + "%");
const tones = [
  "#c6ef79",
  "#69c5e3",
  "#b4a2f5",
  "#f4bc70",
  "#e395aa",
  "#79ceaf",
  "#ef9a6d",
];
const names: Record<string, string> = {
  "general-v2-all-singles": "胜平负基准",
  "general-v2-value-singles": "价值单场",
  "general-v2-featured-picks": "最优玩法",
  "general-v2-spread-singles": "让球策略",
  "general-v2-forced-fun": "全玩法对照",
  "general-v2-double": "价值二串一",
  "general-fun-double-v1": "娱乐二串一",
};
const describe: Record<string, string> = {
  "general-v2-all-singles": "每场选最可能的胜平负，检验普通方向的效果。",
  "general-v2-value-singles": "只选通过保守EV、赔率与独立数据门槛的单场。",
  "general-v2-featured-picks": "在胜平负、让球和大小球中选价值更好的玩法。",
  "general-v2-spread-singles": "只跑有价值的亚洲盘，计入半赢、半输和走盘。",
  "general-v2-forced-fun": "各玩法各选一个方向，作为价值策略的对照组。",
  "general-v2-double": "两场价值方向组合；不满足分散条件就等待。",
  "general-fun-double-v1": "两场最可能方向的独立娱乐对照，可为负EV。",
};
export function ProfitChart({ series, selected, onSelect }: any) {
  const nonempty = series.filter((s: any) => s.metrics.curve.length);
  if (!nonempty.length)
    return (
      <div className="chart-empty">
        赛果结算后，真实模拟收益将在这里形成曲线。
      </div>
    );
  const points = nonempty.flatMap((s: any) => s.metrics.curve);
  const loT = Math.min(...points.map((p: any) => new Date(p.at).getTime())),
    hiT = Math.max(...points.map((p: any) => new Date(p.at).getTime()));
  const values = [0, ...points.map((p: any) => Number(p.profitAtoms) / 1e6)],
    lo = Math.min(...values),
    hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.12, 1),
    min = lo - pad,
    max = hi + pad;
  const x = (at: any) =>
    62 + ((new Date(at).getTime() - loT) / Math.max(hiT - loT, 1)) * 830;
  const y = (v: number) => 238 - ((v - min) / (max - min)) * 202;
  return (
    <div className="profit-chart" data-testid="profit-chart">
      <svg
        viewBox="0 0 920 280"
        role="img"
        aria-label="各策略按结算时间累计净收益比较，虚拟单位"
      >
        {[min, (min + max) / 2, max].map((v, i) => (
          <g key={i}>
            <line x1="62" x2="892" y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x="48" y={y(v) + 4} textAnchor="end">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        <line x1="62" x2="892" y1={y(0)} y2={y(0)} className="chart-zero" />
        {nonempty.map((s: any) => {
          const color =
            tones[series.findIndex((r: any) => r.id === s.id) % tones.length];
          const curve = s.metrics.curve;
          return (
            <g key={s.id} opacity={!selected || s.id === selected ? 1 : 0.15}>
              <polyline
                points={[
                  `${x(loT)},${y(0)}`,
                  ...curve.flatMap((p: any, i: number) => [
                    `${x(p.at)},${y(i ? Number(curve[i - 1].profitAtoms) / 1e6 : 0)}`,
                    `${x(p.at)},${y(Number(p.profitAtoms) / 1e6)}`,
                  ]),
                ].join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={s.id === selected ? 3.5 : 2}
                strokeLinejoin="round"
              />
              <circle
                cx={x(curve.at(-1).at)}
                cy={y(Number(curve.at(-1).profitAtoms) / 1e6)}
                r="4"
                fill={color}
              />
            </g>
          );
        })}
        <text x="62" y="268">
          {formatDate(loT).split(" ")[0]}
        </text>
        <text x="892" y="268" textAnchor="end">
          {formatDate(hiT).split(" ")[0]}
        </text>
      </svg>
      <div className="chart-legend">
        {series.map((s: any, i: number) => (
          <button
            key={s.id}
            aria-pressed={selected === s.id}
            onClick={() => onSelect?.(selected === s.id ? "" : s.id)}
          >
            <i style={{ background: tones[i % tones.length] }} />
            {names[s.id] ?? s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
function StrategyRecords({ api, strategy, period }: any) {
  const [offset, setOffset] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);
  const navigate = useNavigate();
  const query = new URLSearchParams({
    mode: "PAPER_RESEARCH",
    period,
    basis: "PLACED",
    strategy: strategy.portfolioId,
    offset: String(offset),
  });
  const { data, error, busy, refresh } = useReport(
    api,
    "/workspace/ledger?" + query,
  );
  useEffect(() => {
    if (!data || positioned.current) return;
    positioned.current = true;
    const frame = requestAnimationFrame(() =>
      container.current?.closest("section")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [!!data]);
  return (
    <div
      ref={container}
      data-testid="strategy-records"
      data-loaded={!!data}
      aria-busy={busy}
    >
      <p className="arena-caption" role="status">
        {data
          ? `共 ${data.total} 张 · 未结、赢、输全部显示 · 按出票日期筛选`
          : "正在读取该策略的完整记录…"}
      </p>
      {error && (
        <div role="alert" className="arena-error">
          {data ? "显示上次快照 · " : "读取失败 · "}
          {error}
          <button onClick={refresh}>重试</button>
        </div>
      )}
      {data?.items.length > 0 ? (
        <TicketCards
          records={data.items}
          basis="PLACED"
          compact
          onDetail={(r: any) =>
            navigate("/ledger?" + query + "&record=" + encodeURIComponent(r.id))
          }
        />
      ) : data ? (
        <div className="chart-empty">
          这个日期范围内尚未出票。
          <Link to="/workbench">查看比赛和入选原因 →</Link>
        </div>
      ) : (
        <div className="arena-skeleton" aria-label="正在读取模拟记录" />
      )}
      {data && (
        <div className="ws-pagination" aria-label="策略记录分页">
          <span>第 {Math.floor(offset / 40) + 1} 页 · 每页最多 40 张</span>
          <button
            className="secondary"
            disabled={!offset || busy}
            onClick={() => setOffset(Math.max(0, offset - 40))}
          >
            上一页
          </button>
          <button
            className="secondary"
            disabled={data.nextOffset == null || busy}
            onClick={() => setOffset(data.nextOffset)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
export function StrategiesWorkspace({ api }: any) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("ALL"),
    [selected, setSelected] = useState(""),
    [settings, setSettings] = useState(false);
  const [revision, setRevision] = useState(0),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const { data, error, refresh } = useReport(
    api,
    "/workspace/arena?period=" + period,
    revision,
  );
  const strategies = data?.strategies ?? [];
  const ranked = [...strategies].sort(
    (a: any, b: any) =>
      (!!b.metrics.settled ? 1 : 0) - (!!a.metrics.settled ? 1 : 0) ||
      (b.metrics.roi ?? -Infinity) - (a.metrics.roi ?? -Infinity),
  );
  const leader = ranked.find((s: any) => s.metrics.settled > 0);
  const focus = strategies.find((s: any) => s.id === selected);
  const latest = data?.latest ?? [];
  const recordsQuery = new URLSearchParams({
    mode: "PAPER_RESEARCH",
    period: focus ? period : "ALL",
    basis: "PLACED",
    ...(focus ? { strategy: focus.portfolioId } : {}),
  });
  const auto = data?.automation?.[0];
  const recent =
    auto?.lastSuccessAt &&
    Date.now() - new Date(auto.lastSuccessAt).getTime() < 300000;
  const running =
    auto?.stage === "RUNNING" &&
    auto.lastAttemptAt &&
    Date.now() - new Date(auto.lastAttemptAt).getTime() < 180000;
  const active = auto?.enabled && (recent || running);
  async function update(
    p: any,
    enabled: boolean,
    maximumPerDay = p.maximumPerDay,
  ) {
    setBusy(p.id);
    setNotice("");
    try {
      await api("/workspace/paper-policies", {
        id: p.id,
        enabled,
        maximumPerDay,
        expectedRevision: p.revision,
      });
      setRevision((n) => n + 1);
      setNotice("已保存，后台将按新设置自动模拟。");
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div
      className="workspace-page arena-page"
      data-testid="strategy-arena"
      data-loaded={!!data}
    >
      <section className="arena-head">
        <div>
          <p className="eyebrow">MAHORAGA / STRATEGY ARENA</p>
          <h1>
            让策略用战绩说话<span>.</span>
          </h1>
          <p>自动模拟，持续比较。找出更好的方法，看每一张票如何落地。</p>
        </div>
        <div className="arena-head-links">
          <Link to="/workbench?period=TODAY" className="ws-button">
            看今天的比赛 ↗
          </Link>
          <button
            className="secondary"
            onClick={() => setSettings(!settings)}
            aria-expanded={settings}
          >
            模拟设置
          </button>
        </div>
      </section>
      <div className="arena-toolbar">
        <div className="arena-periods" aria-label="策略统计周期">
          {[
            ["ALL", "累计"],
            ["TODAY", "今天"],
            ["YESTERDAY", "昨天"],
            ["WEEK", "本周"],
            ["MONTH", "本月"],
          ].map(([v, l]) => (
            <button
              aria-pressed={period === v}
              className={period === v ? "selected" : ""}
              key={v}
              onClick={() => setPeriod(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <Link
          className={"arena-live " + (active ? "live" : "offline")}
          to="/system"
        >
          <i />
          {active ? "自动模拟运行中" : data ? "自动任务待确认" : "正在读取战绩"}
          <span>↗</span>
        </Link>
      </div>
      {data && (
        <p className="arena-caption">
          后台自动获取比赛和报价、生成预测、模拟出票及结算，不需要一直打开网页。
          {auto?.lastSuccessAt
            ? " 最近完成 " + formatDate(auto.lastSuccessAt) + "。"
            : " 尚无成功运行记录。"}
          {auto?.stage === "RUNNING" ? " 当前正在执行下一轮。" : ""}
          {!auto?.enabled ? " 自动任务已暂停，前往运行状态检查。" : ""}
        </p>
      )}
      {error && (
        <div role="alert" className="arena-error">
          {data ? "显示上次快照 · " : "读取失败 · "}
          {error}
          <button onClick={refresh}>重试</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {settings && (
        <section className="ws-panel arena-settings">
          <div className="ws-section-head">
            <h2>自动模拟设置</h2>
            <button className="secondary" onClick={() => setSettings(false)}>
              完成
            </button>
          </div>
          <p>
            {data?.version?.id === "SEPTEMBER20"
              ? "使用旧版各策略原始固定虚拟投入。"
              : "每票20虚拟单位。"}
            暂停只停止新增，原票继续结算。
          </p>
          {strategies.map((p: any) => (
            <div className="arena-setting" key={p.id}>
              <b>{names[p.id] ?? p.label}</b>
              <label>
                每日上限{" "}
                <select
                  aria-label={p.label + "每日上限"}
                  value={p.maximumPerDay}
                  disabled={!!busy}
                  onChange={(e) =>
                    update(p, !!p.enabled, Number(e.target.value))
                  }
                >
                  {[...new Set([1, 5, 10, 20, 60, 100, p.maximumPerDay])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n} value={n}>
                        {n}票
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={!!busy}
                className="secondary"
                onClick={() => update(p, !p.enabled)}
              >
                {p.enabled ? "暂停新票" : "恢复新票"}
              </button>
            </div>
          ))}
        </section>
      )}
      <section className="arena-overview">
        <div>
          <span>当前收益率领先</span>
          <strong>
            {leader ? (names[leader.id] ?? leader.label) : "等待首批结算"}
          </strong>
          <small>
            {leader
              ? `${leader.metrics.settled}张已结 · 小样本排名，不代表未来收益`
              : "不以预测盈利代替结算成绩"}
          </small>
        </div>
        <div>
          <span>领先策略 ROI</span>
          <strong className={leader?.metrics.roi > 0 ? "positive" : ""}>
            {pct(leader?.metrics.roi)}
          </strong>
          <small>净收益 ÷ 已结投入</small>
        </div>
        <div>
          <span>已结模拟票</span>
          <strong>
            {data?.summary.settled ?? "—"}
            <small>张</small>
          </strong>
          <small>
            赢 {data?.summary.wins ?? "—"} / 输 {data?.summary.losses ?? "—"}
          </small>
        </div>
        <div>
          <span>正在比赛 / 等待开赛</span>
          <strong>
            {data?.openN ?? "—"}
            <small>张未结</small>
          </strong>
          <Link to="/ledger?mode=PAPER_RESEARCH&period=ALL&status=OPEN">
            查看持仓 →
          </Link>
        </div>
      </section>
      <section className="arena-panel arena-ranking">
        <div className="ws-section-head">
          <div>
            <p className="eyebrow">THE CONTENDERS</p>
            <h2>策略排行榜</h2>
          </div>
          <span>点击策略，查看曲线和完整模拟记录</span>
        </div>
        <div className="arena-rank-scroll">
          <table>
            <thead>
              <tr>
                <th>策略</th>
                <th>ROI</th>
                <th>净收益</th>
                <th>赢 / 输</th>
                <th>已结 / 未结</th>
                <th>均赔率</th>
                <th>回撤</th>
                <th>战绩</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((s: any, i: number) => (
                <tr key={s.id} className={selected === s.id ? "focused" : ""}>
                  <td>
                    <button
                      className="rank-select"
                      onClick={() => {
                        const next = selected === s.id ? "" : s.id;
                        setSelected(next);
                      }}
                      aria-pressed={selected === s.id}
                      aria-controls="strategy-actions"
                    >
                      <span className="rank-number">
                        {s.metrics.settled
                          ? String(i + 1).padStart(2, "0")
                          : "—"}
                      </span>
                      <span>
                        <b>{names[s.id] ?? s.label}</b>
                        <small>
                          {s.category === "VALUE" ? "价值策略" : "模拟对照"} ·{" "}
                          {s.enabled ? "自动运行" : "已暂停"}
                        </small>
                        <small className="rank-mobile-counts">
                          赢 {s.metrics.wins} / 输 {s.metrics.losses} · 已结{" "}
                          {s.metrics.settled}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td
                    className={
                      s.metrics.roi > 0
                        ? "positive"
                        : s.metrics.roi < 0
                          ? "negative"
                          : ""
                    }
                  >
                    {pct(s.metrics.roi)}
                  </td>
                  <td>{money(s.metrics.profitAtoms)}</td>
                  <td>
                    {s.metrics.wins} / {s.metrics.losses}
                  </td>
                  <td>
                    {s.metrics.settled} / {s.openN}
                  </td>
                  <td>{s.metrics.avgOdds?.toFixed(2) ?? "—"}</td>
                  <td>{money(s.metrics.maxDrawdownAtoms)}</td>
                  <td>
                    <Link
                      aria-label={(names[s.id] ?? s.label) + "战绩"}
                      to={
                        "/ledger?mode=PAPER_RESEARCH&period=" +
                        period +
                        "&basis=PLACED&strategy=" +
                        encodeURIComponent(s.portfolioId)
                      }
                    >
                      查看 ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="arena-caption">
          各策略独立模拟；同一场比赛可以进入多个账户。对照策略可能选到负EV方向，不能当作价值推荐。
        </p>
      </section>
      <section className="arena-panel">
        <div className="ws-section-head">
          <div>
            <p className="eyebrow">THE PERFORMANCE</p>
            <h2>收益曲线</h2>
          </div>
          <span>按结算时间 · 虚拟单位</span>
        </div>
        <ProfitChart
          series={strategies}
          selected={selected}
          onSelect={setSelected}
        />
      </section>
      {focus && (
        <aside className="arena-focus">
          <strong>{names[focus.id] ?? focus.label}</strong>
          <p>
            {describe[focus.id]}{" "}
            {focus.lifetimeN
              ? `累计${focus.lifetimeN}票，最新出票${formatDate(focus.lastTicketAt)}。`
              : "尚未出票；系统保留比赛并继续检查条件，不伪造战绩。"}
            {` 每日新增上限 ${focus.maximumPerDay} 张，只在满足策略条件时出票。`}
          </p>
          <button className="secondary" onClick={() => setSelected("")}>
            显示全部策略
          </button>
        </aside>
      )}
      <section className="arena-feed" id="strategy-actions">
        <div className="ws-section-head">
          <div>
            <p className="eyebrow">THE ACTION</p>
            <h2>
              {focus
                ? (names[focus.id] ?? focus.label) + " · 全部模拟记录"
                : "最近模拟 · 6张预览"}
            </h2>
          </div>
          <Link to={"/ledger?" + recordsQuery}>打开完整账本 ↗</Link>
        </div>
        {focus ? (
          <StrategyRecords
            key={focus.id + ":" + period}
            api={api}
            strategy={focus}
            period={period}
          />
        ) : latest.length ? (
          <TicketCards
            records={latest}
            compact
            onDetail={(r: any) => {
              navigate(
                "/ledger?" +
                  recordsQuery +
                  "&record=" +
                  encodeURIComponent(r.id),
              );
            }}
          />
        ) : data ? (
          <div className="chart-empty">
            当前没有该策略的模拟票。
            <Link to="/workbench">查看比赛和入选原因 →</Link>
          </div>
        ) : (
          <div className="arena-skeleton" aria-label="正在读取模拟记录" />
        )}
      </section>
      <p className="arena-caption">
        {data?.asOf ? "数据更新 " + formatDate(data.asOf) + " · " : ""}
        参考价模拟，不连接真实投注账户。
        <Link to="/ledger?mode=LEGACY_IMPORT&period=ALL">1.0存档战绩 ↗</Link>
      </p>
    </div>
  );
}
export function ToolsWorkspace() {
  return (
    <div className="workspace-page tools-page">
      <section className="ws-head">
        <div>
          <p className="eyebrow">MAHORAGA / RESEARCH</p>
          <h1>研究与设置</h1>
          <p>深入研究、检查自动任务，或查看旧版记录。</p>
        </div>
      </section>
      <div className="tools-grid">
        {[
          [
            "/models",
            "模型实验室",
            "比较市场基准、V6、V7及旧V2的冻结预测与验证表现。",
          ],
          ["/system", "自动任务状态", "查看抓取、预测、出票和结算是否正常。"],
          [
            "/history",
            "1.0历史中心",
            "旧票、模型观测和历史记录，保留原始口径。",
          ],
          [
            "/legacy",
            "旧版设置与功能对照",
            "读取已有联赛和策略设置，查阅迁移状态。",
          ],
          [
            "/archives",
            "原始数据与审计",
            "查看导入来源、证据与不可改写的原始记录。",
          ],
          [
            "/strategies",
            "模拟策略设置",
            "在竞技场调整每日出票上限、暂停或恢复自动模拟。",
          ],
        ].map(([to, title, desc]) => (
          <Link className="tool-card" key={to} to={to}>
            <span>↗</span>
            <h2>{title}</h2>
            <p>{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
