import React from "react";
import { Link } from "react-router-dom";
import { useReport } from "./use-report";
import { ProfitChart } from "./arena-view";
import { formatDate } from "../../../packages/display";
const money = (x: any) =>
  x == null
    ? "—"
    : (Number(x) / 1e6).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (x: any) => (x == null ? "—" : (x * 100).toFixed(2) + "%");
export function VersionWorkspace({ api, active, onSwitch }: any) {
  const { data, error } = useReport(api, "/workspace/versions");
  const versions = data?.results ?? [];
  return (
    <div className="workspace-page version-page">
      <section className="ws-head">
        <div>
          <p className="eyebrow">MAHORAGA / VERSIONS</p>
          <h1>
            版本竞技场<span className="ws-title-dot">.</span>
          </h1>
          <p className="ws-deck">
            同一网站，独立模型、独立策略、独立战绩。切换查看不暂停其他版本。
          </p>
        </div>
        <Link to="/strategies" className="ws-button">
          查看当前版本策略 ↗
        </Link>
      </section>
      {error && <p role="alert">{error}</p>}
      <div className="version-comparison-cards">
        {versions.map((v: any) => (
          <article
            key={v.version.id}
            className={
              "version-card " + (v.version.id === active ? "selected" : "")
            }
          >
            <span>{v.version.id === active ? "正在查看" : "后台自动研究"}</span>
            <h2>{v.version.label}</h2>
            <button
              className="secondary"
              disabled={v.version.id === active}
              onClick={() => onSwitch(v.version.id)}
            >
              {v.version.id === active ? "当前版本" : "查看此版本"}
            </button>
            <p>{v.version.description}</p>
            <div className="version-card-numbers">
              <div>
                <small>已结净收益</small>
                <strong>{money(v.summary.profitAtoms)}</strong>
              </div>
              <div>
                <small>ROI</small>
                <strong>{percent(v.summary.roi)}</strong>
              </div>
            </div>
            <p>
              已结 {v.summary.settled} · 未结 {v.openN} · 独立策略{" "}
              {v.strategies.length}
            </p>
            <p className="ws-caption">虚拟单位 · 当前样本；不是稳定盈利证明</p>
            <p className="ws-caption">
              新票起点{" "}
              {v.firstPlacementAt == null
                ? "尚无新票"
                : formatDate(v.firstPlacementAt)}{" "}
              · 截止 {formatDate(v.asOf)}
            </p>
          </article>
        ))}
      </div>
      <p className="ws-caption">
        各版本起跑时间与样本不同。新版本未结算时ROI为空，不能凭累计ROI直接判定谁更好；逐策略和分赛事表现可在各版本实验室查看。
      </p>
      <ProfitChart
        series={versions.map((v: any) => ({
          id: v.version.id,
          label: v.version.label,
          metrics: v.summary,
        }))}
      />
      <section className="ws-panel">
        <h2>9月20日版本 · 动态扣减</h2>
        <div className="version-evolution">
          <div>
            <small>额外保守扣减</small>
            <strong>
              {data?.september
                ? (data.september.evolution.marginShift * 100).toFixed(2) +
                  " PP"
                : "—"}
            </strong>
          </div>
          <div>
            <small>进球模型融合权重</small>
            <strong>
              {data?.september ? percent(data.september.evolution.modelW) : "—"}
            </strong>
          </div>
          <div>
            <small>参数修订</small>
            <strong>{data?.september?.revision ?? "—"}</strong>
          </div>
        </div>
        <p className="ws-caption">
          原版微调、选单、串关和补位规则已接回。初始参数来自保存的旧账本；未找到当天逐批代码与配置快照，不能宣称精确复现丢失的运行版本。新票冻结当时参数，后续微调不会改写。
        </p>
        <details className="ws-audit">
          <summary>源版本与参数来源</summary>
          {data?.executionRejections?.length > 0 && (
            <p>
              原版出现同场多盘口串关时，保留计算证据并拒绝出票；其他票照常运行。
            </p>
          )}
          <pre>
            {JSON.stringify(
              {
                identity: data?.identity,
                seed: data?.september?.seed,
                versions: data?.versions,
                executionRejections: data?.executionRejections,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </section>
      <p className="ws-caption">
        历史旧票在历史中心单独保留，未计入这些新账户。V6仅支持五大联赛和原生胜平负策略，缺输入不会借用其他版本预测。
      </p>
    </div>
  );
}
