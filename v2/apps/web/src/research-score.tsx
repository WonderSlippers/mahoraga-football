import React from "react";
import { researchScoreBand } from "../../../packages/display";
export function ResearchScore({
  score,
  original = false,
  compact = false,
}: any) {
  const band = researchScoreBand(score);
  return (
    <div
      className={`research-score grade-${band.grade}${compact ? " compact" : ""}`}
      data-testid="recommendation-score"
      data-score={band.score ?? "UNKNOWN"}
    >
      <div>
        <span>研究评分</span>
        <strong>
          {band.score ?? "—"}
          <small>/100</small>
        </strong>
      </div>
      <div>
        <b>
          {band.grade === "UNKNOWN"
            ? band.label
            : `${band.grade} · ${band.label}`}
        </b>
        <small>
          {band.score == null
            ? "不补造评分"
            : original
              ? "原版冻结分"
              : "冻结排序分"}{" "}
          · 不是命中概率
        </small>
      </div>
    </div>
  );
}
