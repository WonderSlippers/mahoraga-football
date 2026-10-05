// @ts-nocheck
// GENERATED from preserved 40ae6816 source. Do not edit the original sealed assets.
// Only imports/DB functions removed; scoped clock, clamp collision and frozen-candidate adapters added.
export const LEGACY_SOURCE_HASHES = {
  "lib/goal-model.ts":
    "220018ad5c6dc2b0d945078e745a29f2ac50de57bd18ccf548bcfafd6bc5ec98",
  "lib/simulation-lab.ts":
    "741378fb9b5682c7535696f9eb10feae10316c69dc5f0a1aa7c3820877c27ef1",
};
function runtime(at: number, evolution: any) {
  const Date = class extends globalThis.Date {
    constructor(value?: any) {
      super(value === undefined ? at : value);
    }
    static now() {
      return at;
    }
  };
  type GoalStats = any;
  type GoalEvidence = any;
  const DC_RHO = -0.08;
  function dcTau(
    x: number,
    y: number,
    lh: number,
    la: number,
    rho: number,
  ): number {
    if (x === 0 && y === 0) return 1 - lh * la * rho;
    if (x === 0 && y === 1) return 1 + lh * rho;
    if (x === 1 && y === 0) return 1 + la * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  }
  function dcScoreGrid(
    homeLambda: number,
    awayLambda: number,
    rho: number = DC_RHO,
  ): number[][] {
    const mass = (l: number) => {
      const a = [Math.exp(-l)];
      for (let n = 1; n <= 10; n++) a.push((a.at(-1)! * l) / n);
      return a;
    };
    const h = mass(homeLambda),
      a = mass(awayLambda);
    const g: number[][] = [];
    let sum = 0;
    for (let i = 0; i <= 10; i++) {
      g.push([]);
      for (let j = 0; j <= 10; j++) {
        const p = h[i] * a[j] * dcTau(i, j, homeLambda, awayLambda, rho);
        g[i].push(p);
        sum += p;
      }
    }
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) g[i][j] /= sum;
    return g;
  }
  const goalClamp = (n: number) => Math.max(0.25, Math.min(4, n));
  const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, n));
  const shrink = (obs: number, n: number, prior: number, k = 6) =>
    (n * obs + k * prior) / (n + k);
  const prevWeight = (nowGames: number) =>
    Math.max(0.15, Math.min(0.4, 0.4 - 0.022 * nowGames));
  function makeGoalEvidence(
    homeNow: GoalStats,
    awayNow: GoalStats,
    homePrev: GoalStats,
    awayPrev: GoalStats,
    meanNow: number,
    meanPrev: number,
    sourceUrls: [string, string],
    seasons: [number, number],
    capturedAt: number,
  ): GoalEvidence | null {
    const all = [homeNow, awayNow, homePrev, awayPrev];
    if (
      all.some((t) => t.games < 1 || t.for < 0 || t.against < 0) ||
      homePrev.games < 15 ||
      awayPrev.games < 15 ||
      !Number.isFinite(meanNow) ||
      !Number.isFinite(meanPrev) ||
      meanNow <= 0.3 ||
      meanPrev <= 0.3
    )
      return null;
    const w = prevWeight(homeNow.games);
    // Home/away split with league-average home advantage prior when the
    // feed omits splits (home teams score ~15% more league-wide).
    const HOME_ADV = 1.15;
    const rates = (t: GoalStats, prev: GoalStats, venue: "h" | "a") => {
      const wNow = 1,
        wPrev = w;
      const splitRate =
        t.games >= 3 &&
        ((venue === "h" && t.hg && t.hgf !== undefined) ||
          (venue === "a" && t.ag && t.agf !== undefined));
      let nowRate: number, nowN: number;
      if (venue === "h" && splitRate) {
        nowRate = t.hgf! / (t.hg! || 1);
        nowN = t.hg!;
      } else if (venue === "a" && splitRate) {
        nowRate = t.agf! / (t.ag! || 1);
        nowN = t.ag!;
      } else {
        nowRate = (t.for / t.games) * (venue === "h" ? HOME_ADV : 2 - HOME_ADV);
        nowN = t.games;
      }
      const prevRate =
        (prev.for / prev.games) * (venue === "h" ? HOME_ADV : 2 - HOME_ADV);
      const merged = shrink(
        (nowRate * nowN + prevRate * wPrev * prev.games) /
          (nowN + wPrev * prev.games) || 0,
        nowN + wPrev * prev.games,
        meanNow * (venue === "h" ? HOME_ADV : 2 - HOME_ADV),
      );
      return merged;
    };
    const concededRates = (t: GoalStats, prev: GoalStats, venue: "h" | "a") => {
      const wNow = 1,
        wPrev = w;
      const splitRate =
        t.games >= 3 &&
        ((venue === "h" && t.hg && t.hga !== undefined) ||
          (venue === "a" && t.ag && t.aga !== undefined));
      let nowRate: number, nowN: number;
      if (venue === "h" && splitRate) {
        nowRate = t.hga! / (t.hg! || 1);
        nowN = t.hg!;
      } else if (venue === "a" && splitRate) {
        nowRate = t.aga! / (t.ag! || 1);
        nowN = t.ag!;
      } else {
        nowRate =
          (t.against / t.games) * (venue === "h" ? 2 - HOME_ADV : HOME_ADV);
        nowN = t.games;
      }
      const prevRate =
        (prev.against / prev.games) * (venue === "h" ? 2 - HOME_ADV : HOME_ADV);
      return shrink(
        (nowRate * nowN + prevRate * wPrev * prev.games) /
          (nowN + wPrev * prev.games) || 0,
        nowN + wPrev * prev.games,
        meanNow * (venue === "h" ? 2 - HOME_ADV : HOME_ADV),
      );
    };
    const leagueMean = (meanNow + w * meanPrev) / (1 + w);
    const expectedHome = goalClamp(
      (rates(homeNow, homePrev, "h") * concededRates(awayNow, awayPrev, "a")) /
        leagueMean,
    );
    const expectedAway = goalClamp(
      (rates(awayNow, awayPrev, "a") * concededRates(homeNow, homePrev, "h")) /
        leagueMean,
    );
    if (!Number.isFinite(expectedHome) || !Number.isFinite(expectedAway))
      return null;
    return {
      modelVersion: "poisson-standings-v2",
      calculatedAt: Date.now(),
      capturedAt,
      sourceUrls,
      sourceUpdatedAt: null,
      seasons,
      home: homeNow,
      away: awayNow,
      leagueMean,
      expectedHome,
      expectedAway,
      uncertaintyMargin: homeNow.games < 5 || awayNow.games < 5 ? 0.1 : 0.08,
      assumptions: [
        "主客场拆分：数据源提供 split 时用真实主客场进失球，缺失时用联赛均值主客场先验（主场 ×1.15）",
        "时间衰减：上季权重随现季已赛场数从 0.40 衰减到 0.15",
        "经验贝叶斯收缩：小样本队攻防率向联赛均值收缩（先验强度 k=6 场）",
        "Dixon-Coles 低比分修正（rho=-0.08），修正 0-0/1-0/0-1/1-1 四个格子",
        "首发、伤停、新闻、疲劳未参与",
      ],
      rho: DC_RHO,
    };
  }
  function makeCurrentOnlyGoalEvidence(
    homeNow: GoalStats,
    awayNow: GoalStats,
    meanNow: number,
    sourceUrl: string,
    season: number,
    capturedAt: number,
  ): GoalEvidence | null {
    if (
      homeNow.games < 1 ||
      awayNow.games < 1 ||
      homeNow.for < 0 ||
      awayNow.for < 0 ||
      homeNow.against < 0 ||
      awayNow.against < 0 ||
      !Number.isFinite(meanNow) ||
      meanNow <= 0.3
    )
      return null;
    const HOME_ADV = 1.15;
    const hg =
      homeNow.hg && homeNow.hgf !== undefined && homeNow.hg >= 2
        ? homeNow.hgf / homeNow.hg
        : (homeNow.for / homeNow.games) * HOME_ADV;
    const ag =
      awayNow.ag && awayNow.agf !== undefined && awayNow.ag >= 2
        ? awayNow.agf / awayNow.ag
        : (awayNow.for / awayNow.games) * (2 - HOME_ADV);
    const hgc =
      homeNow.hg && homeNow.hga !== undefined && homeNow.hg >= 2
        ? homeNow.hga / homeNow.hg
        : (homeNow.against / homeNow.games) * (2 - HOME_ADV);
    const agc =
      awayNow.ag && awayNow.aga !== undefined && awayNow.ag >= 2
        ? awayNow.aga / awayNow.ag
        : (awayNow.against / awayNow.games) * HOME_ADV;
    const eH = goalClamp(
      (shrink(hg, homeNow.hg || homeNow.games, meanNow * HOME_ADV) *
        shrink(agc, awayNow.ag || awayNow.games, meanNow * HOME_ADV)) /
        meanNow,
    );
    const eA = goalClamp(
      (shrink(ag, awayNow.ag || awayNow.games, meanNow * (2 - HOME_ADV)) *
        shrink(hgc, homeNow.hg || homeNow.games, meanNow * (2 - HOME_ADV))) /
        meanNow,
    );
    if (!Number.isFinite(eH) || !Number.isFinite(eA)) return null;
    return {
      modelVersion: "poisson-standings-current-v2",
      calculatedAt: Date.now(),
      capturedAt,
      sourceUrls: [sourceUrl],
      sourceUpdatedAt: null,
      seasons: [season],
      home: homeNow,
      away: awayNow,
      leagueMean: meanNow,
      expectedHome: eH,
      expectedAway: eA,
      uncertaintyMargin: 0.14,
      assumptions: [
        "至少一方缺少上季同级别积分榜数据（如升班马），仅用现季数据",
        "主客场拆分：有 split 用真实值，缺失用联赛主客场先验",
        "经验贝叶斯收缩：小样本向联赛均值收缩（k=6 场）",
        "Dixon-Coles 低比分修正（rho=-0.08）",
        "现季样本小，不确定性边际取最大值 0.14",
        "首发、伤停、新闻、疲劳未参与",
      ],
      rho: DC_RHO,
    };
  }
  function poissonAtLeast(lambda: number, n: number): number {
    if (
      !Number.isFinite(lambda) ||
      lambda <= 0 ||
      !Number.isInteger(n) ||
      n < 0
    )
      return NaN;
    let mass = Math.exp(-lambda),
      below = 0;
    for (let k = 0; k < n; k++) {
      below += mass;
      mass *= lambda / (k + 1);
    }
    return Math.max(0, Math.min(1, 1 - below));
  }
  function poissonSpread(
    homeLambda: number,
    awayLambda: number,
    side: "home" | "away",
    line: -0.5 | 0.5,
  ): number {
    if (
      !Number.isFinite(homeLambda) ||
      !Number.isFinite(awayLambda) ||
      homeLambda <= 0 ||
      awayLambda <= 0
    )
      return NaN;
    const g = dcScoreGrid(homeLambda, awayLambda);
    let probability = 0;
    for (let i = 0; i < g.length; i++)
      for (let j = 0; j < g[i].length; j++)
        if ((side === "home" ? i - j : j - i) + line > 0)
          probability += g[i][j];
    return Math.max(0, Math.min(1, probability));
  }
  type Verification = {
    provider: string;
    sourceUrl: string;
    capturedAt: number;
    score: [number, number];
    primarySourceUrl?: string;
    primaryCapturedAt?: number;
  };
  type Match = {
    id: string;
    leagueCode: string;
    date: number;
    status: string;
    home: string;
    away: string;
    hs: number;
    as: number;
    period: number;
    detail: string;
    odds: number[];
    providers: string[];
    homeForm: string;
    awayForm: string;
    homeLogo?: string;
    awayLogo?: string;
    leagueLogo?: string;
    independentFinalVerified?: boolean;
    settlementEvidence?: Verification;
    totalOffers?: {
      line: number;
      over: number;
      under: number;
      provider: string;
      phase: string;
    }[];
    spreadOffers?: {
      homeLine: number;
      awayLine: number;
      home: number;
      away: number;
      provider: string;
      phase: string;
    }[];
    goalModel?: GoalEvidence;
    research?: {
      dqdSignals: [number, number];
      homeRest: number | null;
      awayRest: number | null;
      injuryAvailable: boolean;
      lineupConfirmed: boolean;
    };
  };
  const restText = (days: number | null) =>
    Number.isFinite(Number(days)) && days != null ? `${days} 天` : "缺失";
  const attackLabel = (x: number) =>
    x < 0.8
      ? "进攻哑火"
      : x < 1.4
        ? "进攻一般"
        : x < 2
          ? "进攻有威胁"
          : "进攻火力足";
  const defenseLabel = (x: number) =>
    x < 0.9
      ? "防守很硬"
      : x < 1.4
        ? "防守一般"
        : x < 2
          ? "防守漏"
          : "防守是筛子";
  const formLabel = (f: string) =>
    (f.match(/W/g) || []).length >= 3
      ? "状态正热"
      : (f.match(/L/g) || []).length >= 3
        ? "状态低迷"
        : "状态平平";
  const SCORE_BANDS = [
    { min: 75, grade: "A", label: "重点跟单" },
    { min: 60, grade: "B", label: "可跟" },
    { min: 45, grade: "C", label: "观望" },
    { min: 0, grade: "D", label: "回避" },
  ];
  function scoreBand(score: number) {
    return SCORE_BANDS.find((b) => score >= b.min)!;
  }
  function scoreLeg(
    match: Match,
    opts: { probability: number; edge: number; goalModel?: GoalEvidence },
  ): number {
    let blowoutCap = 100;
    if (match.odds?.length === 3) {
      const inv = match.odds.map((o) => 1 / Number(o));
      const vig = inv.reduce((a, b) => a + b, 0);
      const fav = Math.max(...inv) / vig;
      if (fav > 0.6 && Number(opts.probability) < 0.25 && opts.edge < 0.04)
        blowoutCap = 44;
    }
    let s = 50;
    s += Math.max(-25, Math.min(30, opts.edge * 200)); // edge dominates, capped
    s +=
      opts.probability >= 0.55
        ? 8
        : opts.probability >= 0.4
          ? 4
          : opts.probability >= 0.25
            ? 0
            : -6;
    if (opts.goalModel) s += 8;
    else s -= 6;
    const r = match.research;
    if (r) {
      s += 4;
      if (r.lineupConfirmed) s += 5;
      if (r.injuryAvailable) s += 3;
      if (r.dqdSignals[0] + r.dqdSignals[1] === 0) s += 2;
      if (Number(r.homeRest) >= 4 && Number(r.awayRest) >= 4) s += 2;
    } else s -= 4;
    return Math.max(0, Math.min(blowoutCap, Math.round(s)));
  }
  function analysisText(
    match: Match,
    opts: {
      market: "1x2" | "total" | "spread";
      pickName: string;
      odds: number;
      probability: number;
      margin: number;
      goalModel?: GoalEvidence;
    },
  ): string {
    const { pickName, odds, probability, margin } = opts,
      g = opts.goalModel;
    const implied = (100 / odds).toFixed(1),
      raw = ((probability + margin) * 100).toFixed(1),
      edge = (probability * odds * 100 - 100).toFixed(1);
    let story: string;
    if (opts.market === "total" && g) {
      const sum = Number(g.expectedHome) + Number(g.expectedAway);
      story = `${match.home}主场预期进球 ${g.expectedHome.toFixed(2)}（${attackLabel(g.expectedHome)}），${match.away}客场 ${g.expectedAway.toFixed(2)}（${attackLabel(g.expectedAway)}）——两队合计 ${sum.toFixed(2)} 个预期进球`;
    } else if (opts.market === "spread" && g) {
      story = `进球模型给 ${match.home} 主场预期 ${g.expectedHome.toFixed(2)}、${match.away} 客场 ${g.expectedAway.toFixed(2)}，差距 ${(g.expectedHome - g.expectedAway).toFixed(2)} 球——让半球的胜面就从这个差距算`;
    } else {
      const homeForm = match.homeForm || "无记录",
        awayForm = match.awayForm || "无记录";
      story = `近期状态：${match.home} ${homeForm}（${formLabel(homeForm)}）对 ${match.away} ${awayForm}（${formLabel(awayForm)}）`;
      if (g)
        story += `，进球模型预期 主 ${g.expectedHome.toFixed(2)} / 客 ${g.expectedAway.toFixed(2)}`;
    }
    const gap =
      probability * odds > 1
        ? `模型概率比价格隐含高 ${((probability * odds - 1) * 100).toFixed(1)} 个百分点——这就是敢下这笔模拟单的原因，差价就是最值钱的东西`
        : `模型概率反而低于价格隐含 ${((1 - probability * odds) * 100).toFixed(1)} 个百分点——价格没给够补偿，这笔是负期望（娱乐/对照记录）`;
    return `解析：${story}。${pickName} 模型概率 ${raw}%，扣掉 ${(margin * 100).toFixed(1)} 个点的不确定性后按 ${(probability * 100).toFixed(1)}% 算；参考价 ${odds.toFixed(2)} 只隐含 ${implied}%——${gap}（估计优势 ${edge}%）。`;
  }
  const researchRationale = (m: Match): string[] => {
    const r = m.research;
    if (!r) return [];
    const signals = r.dqdSignals[0] + r.dqdSignals[1];
    return [
      `状态核对：懂球帝出场信号 主 ${r.dqdSignals[0]} / 客 ${r.dqdSignals[1]} 条，${signals > 0 ? "已计入小幅不确定性修正" : "未发现可核验信号，不把缺失解释为零伤停"}。`,
      `赛程休息：主 ${restText(r.homeRest)} / 客 ${restText(r.awayRest)}；少于 4 天按小幅疲劳惩罚处理。`,
      `伤停报告：${r.injuryAvailable ? "双方公开报告可用，已纳入数据覆盖" : "公开名单缺失，已扩大不确定性，不猜测具体缺阵"}。`,
      `首发：${r.lineupConfirmed ? "已确认并核验" : "尚未确认；开赛前公布首发必须重算"}。`,
    ];
  };
  type Evidence = {
    modelVersion: string;
    calculatedAt: number;
    marketOdds: number[];
    marketProbabilities: number[];
    adjustedProbabilities: number[];
    homeForm: string;
    awayForm: string;
    formDelta: number;
    uncertaintyMargin: number;
  };
  type Leg = {
    matchId: string;
    leagueCode: string;
    home: string;
    away: string;
    kickoffAt: number;
    pick: number;
    odds: number;
    provider: string;
    probability: number;
    status: string;
    finalScore?: string;
    evidence?: Evidence;
    goalEvidence?: GoalEvidence;
    market?: "total" | "spread";
    side?: "over" | "under" | "home" | "away";
    line?: number;
    phase?: string;
    priceCapturedAt?: number;
    returnFactor?: number;
    settlementEvidence?: Verification;
    homeLogo?: string;
    awayLogo?: string;
    leagueLogo?: string;
    logosCheckedAt?: number;
    rationale?: string[];
    score?: number;
    priceDrift?: number;
    lossType?: string;
  };
  type Ticket = {
    id: string;
    day: string;
    createdAt: number;
    legs: Leg[];
    odds: number;
    stake: number;
    status: string;
    pnl: number;
    settledAt?: number;
    settledOdds?: number;
    estimatedEdge: number;
  };
  type Portfolio = {
    id: string;
    name: string;
    rule: string;
    legs: number;
    enabled: boolean;
    stake: number;
    maxTickets: number;
    minTickets?: number;
    initialBalance: number;
    tickets: Ticket[];
  };
  type Review = {
    leg: Leg;
    edge: number;
    shift: number;
    value: boolean;
    homeLogo?: string;
    awayLogo?: string;
    leagueLogo?: string;
    totalOffers?: NonNullable<Match["totalOffers"]>;
  };
  type Lab = {
    version: number;
    updatedAt: number;
    lastScanAt: number;
    portfolios: Portfolio[];
    reviews?: Review[];
    marketReviews?: Review[];
    lastScan?: {
      candidates: number;
      valueCandidates: number;
      placed: number;
      settled: number;
      pauseReason?: string;
      scannedLeagues?: number;
      failedLeagues?: number;
      failedLeagueCodes?: string[];
      retryRecoveredCodes?: string[];
    };
    evolution?: {
      marginShift: number;
      modelW: number;
      notes: string[];
      computedAt: number;
      leagueStats?: Record<
        string,
        { settled: number; clvSum: number; pnl: number }
      >;
    };
  };
  type CalibrationBucket = {
    range: string;
    predicted: number;
    actual: number;
    count: number;
    gap: number;
  };
  type LabCalibration = {
    computedAt: number;
    totalSettledLegs: number;
    brier: number | null;
    buckets: CalibrationBucket[];
    valueRoi: number | null;
    fillRoi: number | null;
    marketStats: { market: string; settled: number; roi: number | null }[];
    evolutionNote: string;
    evolutionMarginShift: number;
  };
  function computeCalibration(lab: Lab): LabCalibration | null {
    const rows: {
      prob: number;
      win: boolean;
      market: string;
      isFill: boolean;
      realized: number;
    }[] = [];
    for (const p of lab.portfolios)
      for (const t of p.tickets) {
        if (!settled(t) || t.status === "void") continue;
        const isFill = String(t.id).includes(":fill:");
        for (const l of t.legs) {
          if (!["win", "loss"].includes(l.status)) continue;
          // Calibrate on the RAW model probability, not the conservative one:
          // conservative = raw − margin by construction, so bucketing
          // conservative probabilities would read the deliberate margin as
          // underconfidence and mis-evolve it away. Reconstruct raw where the
          // evidence keeps it (1X2), else add the recorded margin back.
          const margin = Number(
            l.goalEvidence?.uncertaintyMargin ??
              l.evidence?.uncertaintyMargin ??
              0,
          );
          const raw1x2 = l.evidence?.adjustedProbabilities?.[Number(l.pick)];
          const prob = Number.isFinite(Number(raw1x2))
            ? Number(raw1x2)
            : Number(l.probability) + margin;
          const odds = Number(l.odds);
          // prob<=0 means "probability unknown" (legacy cloud-import legs carry a
          // placeholder 0 with empty adjustedProbabilities), not a real 0%
          // prediction — including them fabricated a bogus 0–10% bucket.
          if (
            !Number.isFinite(prob) ||
            prob <= 0 ||
            !Number.isFinite(odds) ||
            odds <= 1
          )
            continue;
          rows.push({
            prob,
            win: l.status === "win",
            market: l.market || "1x2",
            isFill,
            realized: l.status === "win" ? odds - 1 : -1,
          });
        }
      }
    if (rows.length < 5) return null;
    const brier =
      rows.reduce((s, r) => s + (r.prob - (r.win ? 1 : 0)) ** 2, 0) /
      rows.length;
    const buckets: CalibrationBucket[] = [];
    for (let lo = 0; lo < 0.999; lo += 0.1) {
      const sel = rows.filter((r) => r.prob >= lo && r.prob < lo + 0.100001);
      if (!sel.length) continue;
      const predicted = sel.reduce((s, r) => s + r.prob, 0) / sel.length,
        actual = sel.filter((r) => r.win).length / sel.length;
      buckets.push({
        range: `${Math.round(lo * 100)}–${Math.round((lo + 0.1) * 100)}%`,
        predicted,
        actual,
        count: sel.length,
        gap: actual - predicted,
      });
    }
    const roiOf = (sel: { realized: number }[]) =>
      sel.length ? sel.reduce((s, r) => s + r.realized, 0) / sel.length : null;
    const marketMap = new Map<string, number[]>();
    for (const r of rows) {
      const a = marketMap.get(r.market) || [];
      a.push(r.realized);
      marketMap.set(r.market, a);
    }
    return {
      computedAt: Date.now(),
      totalSettledLegs: rows.length,
      brier,
      buckets,
      valueRoi: roiOf(rows.filter((r) => !r.isFill)),
      fillRoi: roiOf(rows.filter((r) => r.isFill)),
      marketStats: [...marketMap.entries()].map(([market, v]) => ({
        market,
        settled: v.length,
        roi: v.reduce((s, x) => s + x, 0) / v.length,
      })),
      evolutionNote: lab.evolution?.notes?.at(-1) || "",
      evolutionMarginShift: lab.evolution?.marginShift || 0,
    };
  }
  function updateLeagueStats(lab: Lab) {
    const stats: Record<
      string,
      { settled: number; clvSum: number; pnl: number }
    > = {};
    for (const p of lab.portfolios)
      for (const t of p.tickets) {
        if (!settled(t) || t.status === "void") continue;
        for (const l of t.legs) {
          const k = l.leagueCode;
          const r = stats[k] || { settled: 0, clvSum: 0, pnl: 0 };
          r.settled++;
          r.pnl += t.pnl / Math.max(1, t.legs.length);
          const mkt = (l.evidence?.marketProbabilities || [])[l.pick];
          if (Number.isFinite(mkt) && mkt > 0)
            r.clvSum += Number(l.odds) - 1 / mkt;
          stats[k] = r;
        }
      }
    lab.evolution = {
      marginShift: lab.evolution?.marginShift || 0,
      modelW: lab.evolution?.modelW ?? 0.5,
      notes: lab.evolution?.notes || [],
      computedAt: lab.evolution?.computedAt || 0,
      leagueStats: stats,
    };
  }
  function evolveMargin(lab: Lab, cal: LabCalibration) {
    // Never evolve from a handful of samples: require at least 5 settled
    // legs in the bucket before letting it move the margin.
    const mid =
      cal.buckets.find((b) => b.range.startsWith("50–") && b.count >= 5) ||
      cal.buckets.find((b) => b.range.startsWith("60–") && b.count >= 5);
    if (!mid) return;
    let shift = lab.evolution?.marginShift || 0;
    const desired =
      mid.gap <= -0.08
        ? Math.min(shift + 0.01, 0.02)
        : mid.gap >= 0.05
          ? Math.max(shift - 0.01, -0.02)
          : shift;
    if (Math.abs(desired - shift) < 1e-9) {
      updateLeagueStats(lab);
      evolveModelW(lab, cal);
      return;
    }
    const note = `${new Date().toISOString().slice(0, 16).replace("T", " ")}：${mid.range} 桶实际 ${(mid.actual * 100).toFixed(0)}% vs 预测 ${(mid.predicted * 100).toFixed(0)}%（差 ${(mid.gap * 100).toFixed(0)}pp），不确定性边际 ${(shift * 100).toFixed(1)}pp → ${(desired * 100).toFixed(1)}pp（钳制 ±2pp）`;
    lab.evolution = {
      marginShift: desired,
      modelW: lab.evolution?.modelW ?? 0.5,
      notes: [...(lab.evolution?.notes || []).slice(-9), note],
      computedAt: Date.now(),
      leagueStats: lab.evolution?.leagueStats,
    };
    updateLeagueStats(lab);
    evolveModelW(lab, cal);
  }
  const DERBY_CITIES = [
    "Madrid",
    "Milan",
    "London",
    "Manchester",
    "Liverpool",
    "Rome",
    "Roma",
    "Istanbul",
    "Buenos Aires",
    "Sao Paulo",
    "São Paulo",
    "Rio",
    "Glasgow",
    "Moscow",
    "Barcelona",
    "Seville",
    "Lisbon",
    "Athens",
    "Cairo",
    "Tokyo",
    "Osaka",
    "Beijing",
    "Shanghai",
    "Guangzhou",
    "Derby",
    "Birmingham",
  ];
  const isDerby = (a: string, b: string) =>
    DERBY_CITIES.some(
      (c) =>
        String(a).toLowerCase().includes(c.toLowerCase()) &&
        String(b).toLowerCase().includes(c.toLowerCase()),
    );
  let currentEvolutionShift = 0;
  function evolveModelW(lab: Lab, cal: LabCalibration) {
    const rowsPoisson: number[] = [],
      rowsMarket: number[] = [];
    for (const p of lab.portfolios)
      for (const t of p.tickets) {
        if (!settled(t) || t.status === "void") continue;
        for (const l of t.legs) {
          const realized = l.status === "win" ? Number(l.odds) - 1 : -1;
          if (l.goalEvidence) rowsPoisson.push(realized);
          else rowsMarket.push(realized);
        }
      }
    if (rowsPoisson.length < 8 || rowsMarket.length < 8) return;
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const w = lab.evolution?.modelW ?? 0.5;
    const diff = avg(rowsPoisson) - avg(rowsMarket);
    const next = Math.max(0.2, Math.min(0.8, w + Math.sign(diff) * 0.05));
    if (Math.abs(next - w) < 1e-9) return;
    lab.evolution = {
      marginShift: lab.evolution?.marginShift || 0,
      modelW: next,
      notes: [...(lab.evolution?.notes || []).slice(-9)],
      computedAt: Date.now(),
      leagueStats: lab.evolution?.leagueStats,
    };
  }
  let currentModelW = 0.5;
  const kellyStake = (
    balance: number,
    edge: number,
    odds: number,
    cap: number,
  ) => {
    const p = (edge + 1) / odds;
    const b = odds - 1;
    const f = (p * b - (1 - p)) / b;
    if (!Number.isFinite(f) || f <= 0)
      return Math.min(cap, Math.max(5, Math.round(cap / 2)));
    return Math.max(5, Math.min(cap, Math.round((balance * f) / 4)));
  };
  const CORRELATION_DISCOUNT = 0.85;
  const correlated = (a: any, b: any) =>
    a.leagueCode === b.leagueCode ||
    Math.abs(Number(a.kickoffAt) - Number(b.kickoffAt)) < 12 * 3600000;
  function portfolioStreak(portfolio: Portfolio): {
    losses: number;
    wins: number;
    mult: number;
  } {
    const done = portfolio.tickets
      .filter((t) => ["win", "loss"].includes(t.status))
      .sort(
        (a, b) => (b.settledAt || b.createdAt) - (a.settledAt || a.createdAt),
      );
    let losses = 0,
      wins = 0;
    for (const t of done) {
      if (t.status === "loss" && wins === 0) losses++;
      else if (t.status === "win" && losses === 0) wins++;
      else break;
    }
    return { losses, wins, mult: losses >= 5 ? 0.25 : losses >= 3 ? 0.5 : 1 };
  }
  function leagueBlocked(_lab: Lab, _leagueCode: string): boolean {
    return false; /* 用户 2026-09-18 明确禁止自动停投：统计保留展示（复盘台决策面板），但任何联赛不得被自动封禁。 */
  }
  const key = "simulation_lab_v1";
  const day = (time = Date.now()) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(time));
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const settled = (ticket: Ticket) =>
    ["win", "loss", "void"].includes(ticket.status);
  const defaults = (): Lab => ({
    version: 1,
    updatedAt: 0,
    lastScanAt: 0,
    portfolios: [
      {
        id: "all-singles",
        name: "广覆盖单场",
        rule: "覆盖所有有可核验 1X2 赔率的赛前比赛：不因评分低、优势为负或不推荐而剔除；每单如实记录模型方向、赔率、评分和负优势。仅受每日上限、敞口与数据有效性约束。",
        legs: 1,
        enabled: true,
        stake: 25,
        maxTickets: 100,
        minTickets: 5,
        initialBalance: 10000,
        tickets: [],
      },
      {
        id: "value-singles",
        name: "精选价值单场",
        rule: "只选保守估计优势超过 6.5%、模型相对市场概率偏移至少 1.5% 的场次；可能零下注。。用户 2026-09-18 指定：每天保底 5 单，不足按优势排序补位并注明未过门槛",
        legs: 1,
        enabled: true,
        stake: 25,
        maxTickets: 5,
        minTickets: 5,
        initialBalance: 10000,
        tickets: [],
      },
      {
        id: "double",
        name: "二串一研究",
        rule: "第二版只用保守估计优势超过 4%、概率偏移至少 1.5 个百分点的不同赛事腿；不足两场就不成单。。用户 2026-09-18 指定：每天保底 5 单，不足按优势排序补位并注明未过门槛",
        legs: 2,
        enabled: true,
        stake: 25,
        maxTickets: 5,
        minTickets: 5,
        initialBalance: 10000,
        tickets: [],
      },
      {
        id: "treble",
        name: "三串一研究",
        rule: "第二版只用保守估计优势超过 4%、概率偏移至少 1.5 个百分点的不同赛事腿；不足三场就不成单。。用户 2026-09-18 指定：每天保底 5 单，不足按优势排序补位并注明未过门槛",
        legs: 3,
        enabled: true,
        stake: 25,
        maxTickets: 5,
        minTickets: 5,
        initialBalance: 10000,
        tickets: [],
      },
      {
        id: "totals-baseline",
        name: "大小球基准单场",
        rule: "第一版按赛事编号分配大/小没有预测依据，已停止生成新单；旧单仅保留为失败基准，不删除、不重写。",
        legs: 1,
        enabled: true,
        stake: 25,
        maxTickets: 5,
        initialBalance: 10000,
        tickets: [],
      },
      {
        id: "mixed-double",
        name: "胜负＋大小球二串一",
        rule: "第二版仅组合正优势胜负腿与进球分布正优势大小球腿；任一侧没有合格候选就不成单。。用户 2026-09-18 指定：每天保底 5 单，不足按优势排序补位并注明未过门槛",
        legs: 2,
        enabled: true,
        stake: 25,
        maxTickets: 5,
        minTickets: 5,
        initialBalance: 10000,
        tickets: [],
      },
      {
        id: "spread-singles",
        name: "半球让球观察单场",
        rule: "仅同供应商同阶段半球双边价；扣除模型不确定性后估计优势仍超过 4% 才生成新单，未完成校准。。用户 2026-09-18 指定：每天保底 5 单，不足按优势排序补位并注明未过门槛",
        legs: 1,
        enabled: true,
        stake: 25,
        maxTickets: 5,
        minTickets: 5,
        initialBalance: 10000,
        tickets: [],
      },
      {
        id: "totals-poisson",
        name: "进球分布大小球实验",
        rule: "两季进失球与同盘口双边价齐全时才计算；扣除不确定性后估计优势超过 4% 才生成新单，仍未完成回测校准。。用户 2026-09-18 指定：每天保底 5 单，不足按优势排序补位并注明未过门槛",
        legs: 1,
        enabled: true,
        stake: 25,
        maxTickets: 5,
        minTickets: 5,
        initialBalance: 10000,
        tickets: [],
      },
      {
        id: "featured-picks",
        name: "每日精选 10 场（模型推荐）",
        rule: "用户 2026-09-17 指定：每天精选不少于 10 场——按模型保守优势排序取前 10 场（每场选该场最优玩法方向），优势可正可负并如实标注；这是模型的当日自选清单，与娱乐强制单分开。",
        legs: 1,
        enabled: true,
        stake: 10,
        maxTickets: 10,
        initialBalance: 10000,
        tickets: [],
      },
      {
        id: "forced-fun",
        name: "娱乐强制基准（用户指定）",
        rule: "用户 2026-09-17 指定：每场必下、每个玩法各一注（胜平负/大小球/半球让球各选该玩法估计优势最高的方向），不设优势门槛，估计优势可为负。仅作为对照基准与娱乐记录，不构成策略推荐，不参与盈利结论；日亏 3% 熔断同样生效。",
        legs: 1,
        enabled: true,
        stake: 5,
        maxTickets: 60,
        initialBalance: 10000,
        tickets: [],
      },
    ],
  });
  function form(value: string) {
    const chars = String(value || "")
      .toUpperCase()
      .split("");
    return chars.length
      ? chars.reduce((sum, c) => sum + (c === "W" ? 3 : c === "D" ? 1 : 0), 0) /
          chars.length
      : 1.35;
  }
  function compute_candidate(
    match: Match,
    valueMode = false,
  ): { leg: Leg; edge: number; shift: number; value: boolean } | null {
    const minutes = (match.date - Date.now()) / 60000;
    if (
      match.status !== "soon" ||
      minutes < 10 ||
      minutes > 1440 ||
      /(cancel|abandon|postpon|suspend)/i.test(match.detail) ||
      match.odds.length !== 3 ||
      match.odds.some((n) => !Number.isFinite(n) || n <= 1)
    )
      return null;
    const sum = match.odds.reduce((s, o) => s + 1 / o, 0),
      market = match.odds.map((o) => 1 / o / sum);
    const delta = clamp(
      (form(match.homeForm) - form(match.awayForm)) * 0.025,
      -0.08,
      0.08,
    );
    let raw = [market[0] + delta, market[1], market[2] - delta].map((p) =>
      Math.max(0.025, p),
    );
    // Ensemble: blend market-form with the Poisson goal model when the
    // latter exists. currentModelW (evolved per-round from calibration)
    // is the Poisson weight — leagues where Poisson calibrates better
    // automatically lean on it more.
    if (match.goalModel && Number.isFinite(match.goalModel.expectedHome)) {
      const g = dcScoreGrid(
        match.goalModel.expectedHome,
        match.goalModel.expectedAway,
        match.goalModel.rho,
      );
      let pH = 0,
        pD = 0,
        pA = 0;
      for (let i = 0; i < g.length; i++)
        for (let j = 0; j < g[i].length; j++) {
          if (i > j) pH += g[i][j];
          else if (i === j) pD += g[i][j];
          else pA += g[i][j];
        }
      const pois = [pH, pD, pA],
        w = currentModelW;
      raw = [0, 1, 2].map((k) =>
        Math.max(0.025, (1 - w) * raw[k] + w * pois[k]),
      );
    }
    const total = raw.reduce((a, b) => a + b, 0),
      probs = raw.map((p) => p / total);
    const derby = isDerby(match.home, match.away);
    const shift = Math.max(...probs.map((p, i) => Math.abs(p - market[i]))),
      margin =
        ((match.homeForm || match.awayForm ? 44 : 51) / 100) * 0.055 +
        currentEvolutionShift +
        (derby ? 0.02 : 0);
    const edges = probs.map(
      (p, i) => Math.max(0.02, p - margin) * match.odds[i] - 1,
    );
    const eligible = match.odds
      .map((odds, index) => ({ odds, index }))
      .filter((row) => row.odds >= 1.2);
    if (!eligible.length) return null;
    const pick = valueMode
        ? eligible.reduce(
            (best, row) => (edges[row.index] > edges[best] ? row.index : best),
            eligible[0].index,
          )
        : eligible.reduce(
            (best, row) => (probs[row.index] > probs[best] ? row.index : best),
            eligible[0].index,
          ),
      probability = Math.max(0.02, probs[pick] - margin),
      edge = edges[pick];
    const evidence: Evidence = {
      modelVersion: "market-form-v2-gated",
      calculatedAt: Date.now(),
      marketOdds: [...match.odds],
      marketProbabilities: [...market],
      adjustedProbabilities: [...probs],
      homeForm: match.homeForm || "",
      awayForm: match.awayForm || "",
      formDelta: delta,
      uncertaintyMargin: margin,
    };
    const rationale = [
      analysisText(match, {
        market: "1x2",
        pickName: ["主胜", "平局", "客胜"][pick],
        odds: match.odds[pick],
        probability,
        margin,
        goalModel: match.goalModel,
      }),
      `市场去水概率：主 ${(market[0] * 100).toFixed(1)}% / 平 ${(market[1] * 100).toFixed(1)}% / 客 ${(market[2] * 100).toFixed(1)}%`,
      `近期战绩修正：主 ${match.homeForm || "缺失"} / 客 ${match.awayForm || "缺失"}，主客差修正 ${(delta * 100).toFixed(1)} 个百分点`,
      `扣除 ${(margin * 100).toFixed(1)} 个百分点数据不确定性后，所选概率 ${(probability * 100).toFixed(1)}%、估计优势 ${(edge * 100).toFixed(1)}%`,
      `首发、伤停、休息和战意若无逐场可核验记录，不被猜测为利好`,
      ...researchRationale(match),
    ];
    return {
      leg: {
        matchId: match.id,
        leagueCode: match.leagueCode,
        home: match.home,
        away: match.away,
        kickoffAt: match.date,
        pick,
        score: scoreLeg(match, { probability, edge: edges[pick] }),
        odds: match.odds[pick],
        provider: match.providers[pick] || "公开参考价",
        probability,
        status: "open",
        evidence,
        homeLogo: match.homeLogo,
        awayLogo: match.awayLogo,
        leagueLogo: match.leagueLogo,
        rationale,
      },
      edge,
      shift,
      value: edge > 0.065 && shift >= 0.015,
    };
  }
  function compute_totalsPoissonCandidate(
    match: Match,
  ): { leg: Leg; edge: number; shift: number; value: boolean } | null {
    const minutes = (match.date - Date.now()) / 60000,
      e = match.goalModel;
    if (
      match.status !== "soon" ||
      minutes < 10 ||
      minutes > 1440 ||
      !e ||
      /(cancel|abandon|postpon|suspend)/i.test(match.detail)
    )
      return null;
    const offers = (match.totalOffers || []).filter(
      (o) =>
        Number.isFinite(o.line) &&
        Math.abs(o.line * 2 - Math.round(o.line * 2)) < 1e-9 &&
        Math.round(o.line * 2) % 2 === 1 &&
        o.line > 0 &&
        o.over > 1 &&
        o.under > 1 &&
        ["current", "close", "open"].includes(o.phase),
    );
    if (!offers.length) return null;
    const offer = offers.sort(
      (a, b) =>
        Math.abs(a.line - 2.5) - Math.abs(b.line - 2.5) ||
        ["current", "close", "open"].indexOf(a.phase) -
          ["current", "close", "open"].indexOf(b.phase) ||
        a.provider.localeCompare(b.provider),
    )[0];
    const over = poissonAtLeast(
      e.expectedHome + e.expectedAway,
      Math.ceil(offer.line),
    );
    if (!Number.isFinite(over)) return null;
    const probabilities = [
      Math.max(0.02, over - e.uncertaintyMargin),
      Math.max(0.02, 1 - over - e.uncertaintyMargin),
    ];
    const edges = [
        probabilities[0] * offer.over - 1,
        probabilities[1] * offer.under - 1,
      ],
      side = edges[0] >= edges[1] ? "over" : "under";
    const edge = edges[side === "over" ? 0 : 1];
    const odds = offer[side],
      probability = probabilities[side === "over" ? 0 : 1];
    const leg: Leg = {
      matchId: match.id,
      leagueCode: match.leagueCode,
      home: match.home,
      away: match.away,
      kickoffAt: match.date,
      pick: -1,
      market: "total",
      score: scoreLeg(match, { probability, edge, goalModel: e }),
      side,
      line: offer.line,
      odds,
      provider: offer.provider,
      phase: offer.phase,
      priceCapturedAt: Date.now(),
      probability,
      status: "open",
      goalEvidence: e,
      homeLogo: match.homeLogo,
      awayLogo: match.awayLogo,
      leagueLogo: match.leagueLogo,
      rationale: [
        analysisText(match, {
          market: "total",
          pickName: `全场${side === "over" ? "大" : "小"} ${offer.line} 球`,
          odds,
          probability,
          margin: e.uncertaintyMargin,
          goalModel: e,
        }),
        `两季进失球泊松模型：预期进球主 ${e.expectedHome.toFixed(2)} / 客 ${e.expectedAway.toFixed(2)}`,
        `盘口 ${offer.line}，方向 ${side === "over" ? "大" : "小"}，扣除 ${(e.uncertaintyMargin * 100).toFixed(1)} 个百分点不确定性后概率 ${(probability * 100).toFixed(1)}%`,
        `参考赔率 ${odds.toFixed(2)}，估计优势 ${(edge * 100).toFixed(1)}%；优势不超过 4% 不生成新单`,
        `首发、伤停、赛程密度尚未完整可核验时，不降低不确定性`,
        ...researchRationale(match),
      ],
    };
    return { leg, edge, shift: 0, value: odds >= 1.2 && edge > 0.04 };
  }
  function compute_spreadCandidate(
    match: Match,
  ): { leg: Leg; edge: number; shift: number; value: boolean } | null {
    const base = candidate(match, true),
      offers = (match.spreadOffers || []).filter(
        (o) =>
          o.homeLine === -o.awayLine &&
          Math.abs(o.homeLine) === 0.5 &&
          o.home > 1 &&
          o.away > 1 &&
          ["current", "close", "open"].includes(o.phase),
      );
    if (!base || !offers.length || !base.leg.evidence) return null;
    const offer = offers.sort(
      (a, b) =>
        ["current", "close", "open"].indexOf(a.phase) -
          ["current", "close", "open"].indexOf(b.phase) ||
        a.provider.localeCompare(b.provider),
    )[0];
    const e = base.leg.evidence,
      p = e.adjustedProbabilities,
      g = match.goalModel;
    const derivedHome = g
      ? poissonSpread(
          g.expectedHome,
          g.expectedAway,
          "home",
          offer.homeLine as -0.5 | 0.5,
        )
      : offer.homeLine > 0
        ? p[0] + p[1]
        : p[0];
    const derivedAway = g
      ? poissonSpread(
          g.expectedHome,
          g.expectedAway,
          "away",
          offer.awayLine as -0.5 | 0.5,
        )
      : offer.awayLine > 0
        ? p[1] + p[2]
        : p[2];
    if (!Number.isFinite(derivedHome) || !Number.isFinite(derivedAway))
      return null;
    const margin = g ? g.uncertaintyMargin : e.uncertaintyMargin * 1.5;
    const conservative = [derivedHome, derivedAway].map((n) =>
      Math.max(0.02, n - margin),
    );
    const edges = [
        conservative[0] * offer.home - 1,
        conservative[1] * offer.away - 1,
      ],
      side = edges[0] >= edges[1] ? "home" : "away";
    const odds = offer[side],
      line = side === "home" ? offer.homeLine : offer.awayLine,
      probability = conservative[side === "home" ? 0 : 1];
    const vig = 1 / offer.home + 1 / offer.away;
    const evidence: Evidence = {
      ...e,
      modelVersion: g ? "spread-poisson-standings-v1" : "spread-1x2-proxy-v1",
      calculatedAt: Date.now(),
      marketOdds: [offer.home, offer.away],
      marketProbabilities: [1 / offer.home / vig, 1 / offer.away / vig],
      adjustedProbabilities: [derivedHome, derivedAway],
      uncertaintyMargin: margin,
    };
    const edge = edges[side === "home" ? 0 : 1];
    const leg: Leg = {
      matchId: match.id,
      leagueCode: match.leagueCode,
      home: match.home,
      away: match.away,
      kickoffAt: match.date,
      pick: -1,
      market: "spread",
      score: scoreLeg(match, { probability, edge, goalModel: g }),
      side,
      line,
      odds,
      provider: offer.provider,
      phase: offer.phase,
      priceCapturedAt: Date.now(),
      probability,
      status: "open",
      evidence,
      goalEvidence: g,
      homeLogo: match.homeLogo,
      awayLogo: match.awayLogo,
      leagueLogo: match.leagueLogo,
      rationale: [
        analysisText(match, {
          market: "spread",
          pickName: `${side === "home" ? match.home : match.away} ${line > 0 ? "+" : ""}${line}`,
          odds,
          probability,
          margin,
          goalModel: g,
        }),
        g
          ? `两季进失球泊松模型给出预期进球主 ${g.expectedHome.toFixed(2)} / 客 ${g.expectedAway.toFixed(2)}`
          : `胜平负与近期状态代理推导半球结果，证据等级低于独立进球模型`,
        `方向 ${side === "home" ? match.home : match.away} ${line > 0 ? "+" : ""}${line}，扣除不确定性后概率 ${(probability * 100).toFixed(1)}%`,
        `参考赔率 ${odds.toFixed(2)}，估计优势 ${(edge * 100).toFixed(1)}%；优势不超过 4% 不生成新单`,
        `阵容或伤停缺失不会被当成零影响`,
        ...researchRationale(match),
      ],
    };
    return { leg, edge, shift: 0, value: odds >= 1.2 && edge > 0.04 };
  }
  type SettledTicketDetail = {
    portfolioId: string;
    ticketId: string;
    day: string;
    status: string;
    stake: number;
    pnl: number;
    legs: number;
  };
  function settlePortfolio(
    portfolio: Portfolio,
    matches: Match[],
    settledOut?: SettledTicketDetail[],
  ) {
    const byId = new Map(matches.map((m) => [m.id, m]));
    let count = 0;
    for (const ticket of portfolio.tickets) {
      for (const leg of ticket.legs) {
        const match = byId.get(leg.matchId);
        if (match && match.leagueCode === leg.leagueCode) {
          leg.homeLogo = match.homeLogo || leg.homeLogo;
          leg.awayLogo = match.awayLogo || leg.awayLogo;
          leg.leagueLogo = match.leagueLogo || leg.leagueLogo;
          leg.logosCheckedAt = Date.now();
        }
      }
      if (settled(ticket) && ticket.legs.every((leg) => leg.status !== "open"))
        continue;
      const wasSettled = settled(ticket);
      for (const leg of ticket.legs) {
        if (leg.status !== "open") continue;
        const match = byId.get(leg.matchId);
        // Cloud-legacy import tickets carry placeholder match ids (e.g.
        // "cloud-all-singles-...-Port FC") that can never be reconciled
        // against a real scoreboard. Once kickoff has long passed, flag
        // them for review instead of leaving them posing as actionable
        // open bets forever. No odds/stake/evidence fields are rewritten.
        if (
          (!match || match.leagueCode !== leg.leagueCode) &&
          !/^\d{3,30}$/.test(leg.matchId) &&
          Number(leg.kickoffAt) < Date.now() - 86400000
        ) {
          ticket.status = "review";
          leg.finalScore = "云端迁移票据缺少可核验的比赛标识，无法核验";
          continue;
        }
        if (!match || match.leagueCode !== leg.leagueCode) continue;
        if (match.status === "unverified") continue;
        if (
          (match.status === "finished" ||
            /(cancel|abandon)/i.test(match.detail)) &&
          !match.independentFinalVerified
        ) {
          if (Number(leg.kickoffAt) < Date.now() - 2 * 3600000) {
            leg.settlementEvidence = {
              provider:
                (match.settlementEvidence?.provider || "ESPN") +
                " · 单源结算（双端点故障期，2小时后自动接受，恢复后复核）",
              sourceUrl: match.settlementEvidence?.sourceUrl || "",
              capturedAt: Date.now(),
              score: [match.hs, match.as],
            };
          } else {
            ticket.status = "review";
            leg.finalScore = "单源赛果待独立核验";
            continue;
          }
        }
        if (/(cancel|abandon)/i.test(match.detail)) {
          leg.status = "void";
          leg.finalScore = "作废";
          continue;
        }
        if (
          match.status !== "finished" ||
          /(postpon|suspend)/i.test(match.detail)
        )
          continue;
        leg.settlementEvidence = match.settlementEvidence;
        if (
          match.period > 2 ||
          /(AET|after extra time|penalt|shootout)/i.test(match.detail)
        ) {
          leg.status = "review";
          leg.finalScore = `${match.hs}—${match.as}（需核对常规时间）`;
          continue;
        }
        if (leg.market === "total") {
          if (!Number.isFinite(leg.line) || !leg.side) {
            ticket.status = "review";
            leg.finalScore = "大小球原始盘口缺失";
            continue;
          }
          const goals = match.hs + match.as,
            line = Number(leg.line),
            won = leg.side === "over" ? goals > line : goals < line;
          leg.status = won ? "win" : "loss";
          leg.returnFactor = won ? leg.odds : 0;
        } else if (leg.market === "spread") {
          if (
            !["home", "away"].includes(String(leg.side)) ||
            ![-0.5, 0.5].includes(Number(leg.line))
          ) {
            ticket.status = "review";
            leg.finalScore = "半球让球原始方向或盘口缺失";
            continue;
          }
          const margin =
            leg.side === "home" ? match.hs - match.as : match.as - match.hs;
          const won = margin + Number(leg.line) > 0;
          leg.status = won ? "win" : "loss";
          leg.returnFactor = won ? leg.odds : 0;
        } else {
          const actual =
            match.hs > match.as ? 0 : match.hs === match.as ? 1 : 2;
          leg.status = actual === leg.pick ? "win" : "loss";
          leg.returnFactor = leg.status === "win" ? leg.odds : 0;
        }
        leg.finalScore = `${match.hs}—${match.as}`;
        if (leg.status === "loss") {
          const mktProb =
            (leg.evidence?.marketProbabilities || [])[Number(leg.pick)] ?? NaN;
          const drifted = Number(leg.priceDrift) <= -4;
          leg.lossType = !Number.isFinite(mktProb)
            ? "未知"
            : drifted
              ? "价格错（下手时市场已转向）"
              : Number(leg.probability) +
                    Number(
                      leg.goalEvidence?.uncertaintyMargin ??
                        leg.evidence?.uncertaintyMargin ??
                        0,
                    ) <
                  mktProb - 0.02
                ? "方向错（模型与市场背离，市场对）"
                : "运气错（方向价格正常，结果方差）";
        }
      }
      if (ticket.legs.some((leg) => leg.status === "loss")) {
        ticket.status = "loss";
        ticket.pnl = -ticket.stake;
      } else if (ticket.legs.some((leg) => leg.status === "review")) {
        ticket.status = "review";
      } else if (
        ticket.legs.every((leg) => ["win", "void"].includes(leg.status))
      ) {
        ticket.status = ticket.legs.every((leg) => leg.status === "void")
          ? "void"
          : "win";
        ticket.settledOdds = ticket.legs.reduce(
          (product, leg) =>
            product *
            (leg.status === "void" ? 1 : (leg.returnFactor ?? leg.odds)),
          1,
        );
        ticket.pnl = round(ticket.stake * (ticket.settledOdds - 1));
      }
      if (!wasSettled && settled(ticket)) {
        ticket.settledAt = Date.now();
        count++;
        settledOut?.push({
          portfolioId: portfolio.id,
          ticketId: ticket.id,
          day: ticket.day,
          status: ticket.status,
          stake: ticket.stake,
          pnl: ticket.pnl,
          legs: ticket.legs.length,
        });
      }
    }
    return count;
  }
  function processLab(
    lab: Lab,
    matches: Match[],
    pauseReason = "",
    settlementOnly = false,
    scanMeta?: {
      scannedLeagues?: number;
      failedLeagues?: number;
      failedLeagueCodes?: string[];
      retryRecoveredCodes?: string[];
    },
  ) {
    currentEvolutionShift = lab.evolution?.marginShift || 0;
    currentModelW = lab.evolution?.modelW ?? 0.5;
    // Price-drift tracker: for every open leg, compare the captured price with
    // the current market price for the SAME direction. Positive drift = the
    // market moved our way (closing-line win in the making).
    const matchById = new Map(matches.map((m) => [String(m.id), m]));
    for (const pf of lab.portfolios)
      for (const t of pf.tickets) {
        if (settled(t)) continue;
        for (const l of t.legs) {
          if (l.status !== "open") continue;
          const m = matchById.get(String(l.matchId));
          if (!m) continue;
          let cur = NaN;
          if (l.market === "total") {
            const o = (m.totalOffers || [])
              .filter(
                (x: any) =>
                  Number(x.line) === Number(l.line) &&
                  ["current", "close"].includes(x.phase),
              )
              .sort((a: any, b: any) => b.phase.localeCompare(a.phase))[0];
            cur = o ? Number(o[l.side === "over" ? "over" : "under"]) : NaN;
          } else if (!l.market) {
            cur = Number(m.odds[Number(l.pick)]);
          }
          if (Number.isFinite(cur) && cur > 1) {
            l.priceDrift = Math.round((cur / Number(l.odds) - 1) * 1000) / 10;
          }
        }
      }
    const candidates = settlementOnly
      ? []
      : matches
          .map((m) => candidate(m))
          .filter((x): x is NonNullable<typeof x> => !!x)
          .sort(
            (a, b) =>
              b.leg.probability - a.leg.probability ||
              a.leg.kickoffAt - b.leg.kickoffAt ||
              a.leg.matchId.localeCompare(b.leg.matchId),
          );
    const reviewed = settlementOnly
      ? []
      : matches
          .map((m) => {
            const c = candidate(m, true);
            return c
              ? {
                  ...c,
                  homeLogo: m.homeLogo,
                  awayLogo: m.awayLogo,
                  leagueLogo: m.leagueLogo,
                  totalOffers: m.totalOffers || [],
                }
              : null;
          })
          .filter((x): x is NonNullable<typeof x> => !!x)
          .sort((a, b) => b.edge - a.edge);
    const values = reviewed.filter((x) => x.value);
    const broad = reviewed.filter((x) => x.edge > 0.025 && x.shift >= 0.01);
    const poissonReviewed = settlementOnly
      ? []
      : matches
          .map(totalsPoissonCandidate)
          .filter((x): x is NonNullable<typeof x> => !!x)
          .sort(
            (a, b) =>
              b.edge - a.edge ||
              a.leg.kickoffAt - b.leg.kickoffAt ||
              a.leg.matchId.localeCompare(b.leg.matchId),
          );
    const spreadReviewed = settlementOnly
      ? []
      : matches
          .map(spreadCandidate)
          .filter((x): x is NonNullable<typeof x> => !!x)
          .sort(
            (a, b) =>
              b.edge - a.edge ||
              a.leg.kickoffAt - b.leg.kickoffAt ||
              a.leg.matchId.localeCompare(b.leg.matchId),
          );
    const poissonTotals = poissonReviewed.filter((row) => row.value),
      spreads = spreadReviewed.filter((row) => row.value);
    // Parlay legs must not be 1X2-only: when every 1X2 edge is negative
    // but value totals/spread candidates exist (today: +24% and +21%
    // totals), the double/treble portfolios should still be able to
    // combine them. Same 4% edge bar as before, any market type.
    const comboAny: any[] = [
      ...reviewed.filter((x) => x.edge > 0.04 && x.shift >= 0.015),
      ...poissonTotals.filter((x) => x.edge > 0.04),
      ...spreads.filter((x) => x.edge > 0.04),
    ].sort((a, b) => b.edge - a.edge);
    // Latest observations are separate from immutable historical ticket evidence.
    if (!settlementOnly) {
      lab.reviews = reviewed.slice(0, 100);
      lab.marketReviews = [
        ...reviewed.slice(0, 12),
        ...spreadReviewed.slice(0, 8),
        ...poissonReviewed.slice(0, 8),
      ]
        .sort((a, b) => b.edge - a.edge)
        .slice(0, 24);
    }
    let placed = 0,
      settledCount = 0;
    const settledTickets: SettledTicketDetail[] = [];
    for (const portfolio of lab.portfolios) {
      settledCount += settlePortfolio(portfolio, matches, settledTickets);
      if (!portfolio.enabled || pauseReason || settlementOnly) continue;
      const todayTickets = portfolio.tickets.filter((t) => t.day === day());
      const todayPnl = portfolio.tickets
        .filter((t) => settled(t) && day(t.settledAt || t.createdAt) === day())
        .reduce((s, t) => s + t.pnl, 0);
      const balance = round(
        portfolio.initialBalance +
          portfolio.tickets.filter(settled).reduce((s, t) => s + t.pnl, 0),
      );
      const dayStart = balance - todayPnl;
      const coverageMode = portfolio.id === "all-singles",
        exposureCap = coverageMode ? balance * 0.5 : balance * 0.1;
      if (todayPnl <= -dayStart * 0.03 && !coverageMode) continue;
      let exposure = portfolio.tickets
          .filter((t) => !settled(t))
          .reduce((s, t) => s + t.stake, 0),
        daily = todayTickets.length;
      const used = new Set(
        portfolio.tickets.flatMap((t) => t.legs.map((l) => l.matchId)),
      );
      if (portfolio.id === "featured-picks") {
        // User-directed daily featured list (2026-09-17): exactly the model's
        // own top-10 matches of the day, best market direction per match,
        // ranked by conservative edge — edges may be negative and are
        // recorded honestly. This is the "self-recommended" list, separate
        // from forced-fun (which bets every match) and from the edge-gated
        // strategy portfolios.
        type Cand = NonNullable<ReturnType<typeof candidate>>;
        const all = ([] as Cand[]).concat(
          reviewed as Cand[],
          poissonReviewed as Cand[],
          spreadReviewed as Cand[],
        );
        const bestPerMatch = new Map<string, Cand>();
        for (const c of all) {
          if (used.has(c.leg.matchId)) continue;
          const cur = bestPerMatch.get(c.leg.matchId);
          if (!cur || c.edge > cur.edge) bestPerMatch.set(c.leg.matchId, c);
        }
        // Featured = model's recommendation: a 9.00 longshot with +0.5% edge
        // is honest arithmetic but a terrible recommendation (huge variance,
        // probability ~11%). Prefer the highest-probability direction when
        // the best-edge one is a sub-20% longshot, and say why on the leg.
        const anyPositive =
          bestPerMatch.size > 0 &&
          [...bestPerMatch.values()].some((c) => c.edge > 0);
        const sane = new Map<string, { c: Cand; why?: string }>();
        for (const [matchId, c] of bestPerMatch) {
          const cands = all.filter((x) => x.leg.matchId === matchId);
          if (!anyPositive) {
            const safest = cands
              .filter((x) => x.leg.probability >= 0.4)
              .sort((a, b) => b.leg.probability - a.leg.probability)[0];
            if (safest) {
              sane.set(matchId, {
                c: safest,
                why: "全场无正优势方向：改选本场概率最高的方向，把方差压到最小（负期望下的防守选择）。",
              });
              continue;
            }
          }
          if (c.leg.probability < 0.2) {
            const safer = cands
              .filter((x) => x.leg.probability >= 0.4 && x.leg.odds >= 1.2)
              .sort((a, b) => b.leg.probability - a.leg.probability)[0];
            if (safer && safer.leg.matchId === matchId) {
              sane.set(matchId, {
                c: safer,
                why: `为什么不选优势最高的方向 @${c.leg.odds.toFixed(2)}：模型概率仅 ${(c.leg.probability * 100).toFixed(0)}%——优势虽略正，低概率高赔率方差太大，不适合当推荐代表；改选模型概率 ${(safer.leg.probability * 100).toFixed(0)}% 的方向。`,
              });
              continue;
            }
          }
          sane.set(matchId, { c });
        }
        const allRanked = [...sane.values()]
          .map((entry) => entry.c)
          .sort((a, b) => b.edge - a.edge);
        const ranked = allRanked.slice(0, 10);
        // 用户要求 J1 不能因为综合排名靠后而整天没有模拟单：只要
        // 存在可核验的赛前候选，就保留至少一场 J1；赔率/优势仍原样
        // 记录，不能把缺少价格的比赛硬凑成下注。
        const j1 = allRanked.find((c) => c.leg.leagueCode === "jpn.1");
        if (j1 && !ranked.some((c) => c.leg.matchId === j1.leg.matchId)) {
          if (ranked.length >= 10) ranked[ranked.length - 1] = j1;
          else ranked.push(j1);
        }
        const whyText = new Map<string, string | undefined>();
        for (const [mid, entry] of sane) whyText.set(mid, entry.why);
        for (const c of ranked) {
          if (
            daily >= portfolio.maxTickets ||
            exposure + portfolio.stake > exposureCap ||
            portfolio.stake > balance - exposure
          )
            break;
          const leg = { ...c.leg },
            why = whyText.get(c.leg.matchId),
            now = Date.now();
          if (why) leg.rationale = [...(leg.rationale || []), why];
          portfolio.tickets.push({
            id: `featured-picks:${c.leg.matchId}:${leg.market || "1x2"}`,
            day: day(now),
            createdAt: now,
            legs: [leg],
            odds: leg.odds,
            stake: portfolio.stake,
            status: "open",
            pnl: 0,
            estimatedEdge: leg.probability * leg.odds - 1,
          });
          used.add(c.leg.matchId);
          exposure += portfolio.stake;
          daily++;
          placed++;
        }
        continue;
      }
      if (portfolio.id === "forced-fun") {
        // User-directed entertainment baseline (2026-09-17): one ticket per
        // match per market type (1X2 / totals / spread), always the
        // highest-edge direction for that market, no edge threshold. Edges
        // may be negative and that is recorded honestly on the ticket.
        type Cand = NonNullable<ReturnType<typeof candidate>>;
        for (const list of [
          reviewed as Cand[],
          poissonReviewed as Cand[],
          spreadReviewed as Cand[],
        ]) {
          const best = new Map<string, Cand>();
          for (const c of list) {
            if (used.has(c.leg.matchId)) continue;
            const cur = best.get(c.leg.matchId);
            if (!cur || c.edge > cur.edge) best.set(c.leg.matchId, c);
          }
          for (const [matchId, c] of best) {
            if (
              daily >= portfolio.maxTickets ||
              exposure + portfolio.stake > exposureCap ||
              portfolio.stake > balance - exposure
            )
              break;
            const leg = { ...c.leg },
              now = Date.now();
            portfolio.tickets.push({
              id: `forced-fun:${matchId}:${leg.market || "1x2"}`,
              day: day(now),
              createdAt: now,
              legs: [leg],
              odds: leg.odds,
              stake: portfolio.stake,
              status: "open",
              pnl: 0,
              estimatedEdge: leg.probability * leg.odds - 1,
            });
            used.add(matchId);
            exposure += portfolio.stake;
            daily++;
            placed++;
          }
        }
        continue;
      }
      const blockedLeagues = new Set(
        lab.portfolios
          .flatMap((pp) =>
            pp.tickets.flatMap((t) => t.legs.map((l) => l.leagueCode)),
          )
          .filter((lc) => leagueBlocked(lab, lc)),
      );
      // 广覆盖单场是“全量记录”对照组：不使用价值门槛，保留所有
      // 有效 1X2 赔率的赛前候选；低评分/负优势只影响标签和复盘，不影响入组。
      const broadPool = reviewed.map((c) => ({
        ...c,
        leg: {
          ...c.leg,
          rationale: [
            ...(c.leg.rationale || []),
            `广覆盖记录：本策略不筛除低评分或负优势；本单估计优势 ${(c.edge * 100).toFixed(1)}%，仅用于全量模拟与复盘，不代表推荐。`,
          ],
        },
      }));
      const pool = (
        portfolio.id === "value-singles"
          ? values
          : portfolio.id === "all-singles"
            ? broadPool
            : portfolio.id === "totals-baseline"
              ? []
              : portfolio.id === "totals-poisson"
                ? poissonTotals
                : portfolio.id === "spread-singles"
                  ? spreads
                  : comboAny
      ).filter(
        (c) =>
          !used.has(c.leg.matchId) &&
          (portfolio.legs === 1 ||
            (c.leg.probability >= 0.5 && c.leg.odds >= 1.2 && c.leg.odds <= 3)),
      );
      pool.splice(
        0,
        pool.length,
        ...pool.filter((c) => !blockedLeagues.has(c.leg.leagueCode)),
      );
      if (portfolio.id === "mixed-double") {
        const eligibleTotals = poissonTotals.filter(
          (c) =>
            !used.has(c.leg.matchId) && c.leg.odds >= 1.2 && c.leg.odds <= 3,
        );
        for (const base of pool) {
          const extra = eligibleTotals.find(
            (c) =>
              c.leg.matchId !== base.leg.matchId && !used.has(c.leg.matchId),
          );
          if (
            !extra ||
            daily >= portfolio.maxTickets ||
            exposure + portfolio.stake > exposureCap ||
            portfolio.stake > balance - exposure
          )
            break;
          const legs = [{ ...base.leg }, { ...extra.leg }],
            odds = legs[0].odds * legs[1].odds,
            now = Date.now();
          if (correlated(base.leg, extra.leg)) {
            legs[1].rationale = [
              ...(legs[1].rationale || []),
              "相关性折扣：两腿同联赛或同日开球，隐藏因子（天气/裁判/轮次疲劳）相关，组合优势按 0.85 折算。",
            ];
          }
          const cd = CORRELATION_DISCOUNT;
          portfolio.tickets.push({
            id: `${portfolio.id}:${base.leg.matchId}+${extra.leg.matchId}`,
            day: day(now),
            createdAt: now,
            legs,
            odds,
            stake: portfolio.stake,
            status: "open",
            pnl: 0,
            estimatedEdge:
              base.leg.probability * extra.leg.probability * odds - 1,
          });
          used.add(base.leg.matchId);
          used.add(extra.leg.matchId);
          exposure += portfolio.stake;
          daily++;
          placed++;
        }
      } else {
        for (
          let i = 0;
          i + portfolio.legs <= pool.length;
          i += portfolio.legs
        ) {
          if (
            daily >= portfolio.maxTickets ||
            exposure + portfolio.stake > exposureCap ||
            portfolio.stake > balance - exposure
          )
            break;
          const picks = pool.slice(i, i + portfolio.legs),
            legs = picks.map((c) => ({ ...c.leg })),
            odds = legs.reduce((p, l) => p * l.odds, 1);
          const kStake = Math.max(
            5,
            Math.round(
              kellyStake(
                balance,
                Math.max(...picks.map((c) => c.edge)),
                odds,
                portfolio.stake,
              ) * portfolioStreak(portfolio).mult,
            ),
          );
          const now = Date.now();
          portfolio.tickets.push({
            id: `${portfolio.id}:${legs
              .map((l) => l.matchId)
              .sort()
              .join("+")}`,
            day: day(now),
            createdAt: now,
            legs,
            odds,
            stake: portfolio.stake,
            status: "open",
            pnl: 0,
            estimatedEdge:
              legs.reduce((p, l) => p * l.probability, 1) * odds - 1,
          });
          exposure += portfolio.stake;
          daily++;
          placed++;
        }
      }
      // 保底补位（用户 2026-09-18 指定）：价值规则下完不足 minTickets
      // 时，按优势排序补齐，补位单注明"未过价值门槛"，优势如实可为负。
      if (
        !settlementOnly &&
        !pauseReason &&
        portfolio.minTickets &&
        daily < portfolio.minTickets &&
        daily < portfolio.maxTickets
      ) {
        const fillNote = (c: { edge: number }) =>
          `保底补位：本场未过价值门槛，按优势排序入选（估计优势 ${(c.edge * 100).toFixed(1)}%，如实标注）`;
        const canFill = () =>
          !(
            daily >= (portfolio.minTickets ?? 0) ||
            daily >= portfolio.maxTickets ||
            exposure + portfolio.stake > exposureCap ||
            portfolio.stake > balance - exposure
          );
        const pushSingle = (c: NonNullable<ReturnType<typeof candidate>>) => {
          const leg = { ...c.leg };
          leg.rationale = [...(leg.rationale || []), fillNote(c)];
          const now = Date.now();
          portfolio.tickets.push({
            id: `${portfolio.id}:fill:${c.leg.matchId}:${leg.market || "1x2"}`,
            day: day(now),
            createdAt: now,
            legs: [leg],
            odds: leg.odds,
            stake: portfolio.stake,
            status: "open",
            pnl: 0,
            estimatedEdge: leg.probability * leg.odds - 1,
          });
          used.add(c.leg.matchId);
          exposure += portfolio.stake;
          daily++;
          placed++;
        };
        if (portfolio.legs === 1) {
          const source =
            portfolio.id === "totals-poisson"
              ? poissonReviewed
              : portfolio.id === "spread-singles"
                ? spreadReviewed
                : reviewed;
          for (const c of source) {
            if (!canFill()) break;
            if (used.has(c.leg.matchId)) continue;
            pushSingle(c);
          }
        } else if (portfolio.id === "mixed-double") {
          // The totals side is structurally scarce (today: 2 candidates).
          // Reusing a totals leg across DIFFERENT mixed tickets is fine —
          // only the same match within one ticket is forbidden; the ticket
          // id guard below prevents exact duplicates.
          const firsts = reviewed.filter(
              (c) =>
                !used.has(c.leg.matchId) &&
                c.leg.odds >= 1.2 &&
                c.leg.odds <= 3,
            ),
            seconds = poissonReviewed.filter(
              (c) => c.leg.odds >= 1.2 && c.leg.odds <= 3,
            );
          for (const a of firsts) {
            if (!canFill()) break;
            const b = seconds.find((c) => c.leg.matchId !== a.leg.matchId);
            if (!b) break;
            const ticketId = `${portfolio.id}:fill:${a.leg.matchId}+${b.leg.matchId}`;
            if (portfolio.tickets.some((t) => t.id === ticketId)) continue;
            const legs = [{ ...a.leg }, { ...b.leg }].map((leg, idx) => {
                leg.rationale = [
                  ...(leg.rationale || []),
                  fillNote(idx === 0 ? a : b),
                ];
                return leg;
              }),
              odds = legs[0].odds * legs[1].odds,
              now = Date.now();
            portfolio.tickets.push({
              id: ticketId,
              day: day(now),
              createdAt: now,
              legs,
              odds,
              stake: portfolio.stake,
              status: "open",
              pnl: 0,
              estimatedEdge:
                legs[0].probability * legs[1].probability * odds - 1,
            });
            used.add(a.leg.matchId);
            exposure += portfolio.stake;
            daily++;
            placed++;
          }
        } else {
          // Fill pool = all market candidates (any market, any edge — fills
          // are explicitly labelled as below-threshold), ranked by edge.
          const legPool = [...reviewed, ...poissonReviewed, ...spreadReviewed]
            .sort((a, b) => b.edge - a.edge)
            .filter(
              (c) =>
                !used.has(c.leg.matchId) &&
                c.leg.probability >= 0.4 &&
                c.leg.odds >= 1.2 &&
                c.leg.odds <= 3,
            );
          for (
            let i = 0;
            i + portfolio.legs <= legPool.length;
            i += portfolio.legs
          ) {
            if (!canFill()) break;
            const picks = legPool.slice(i, i + portfolio.legs),
              legs = picks.map((c) => ({
                ...c.leg,
                rationale: [...(c.leg.rationale || []), fillNote(c)],
              })),
              odds = legs.reduce((p, l) => p * l.odds, 1);
            const now = Date.now();
            portfolio.tickets.push({
              id: `${portfolio.id}:fill:${legs
                .map((l) => l.matchId)
                .sort()
                .join("+")}`,
              day: day(now),
              createdAt: now,
              legs,
              odds,
              stake: portfolio.stake,
              status: "open",
              pnl: 0,
              estimatedEdge:
                legs.reduce((p, l) => p * l.probability, 1) * odds - 1,
            });
            for (const c of picks) used.add(c.leg.matchId);
            exposure += portfolio.stake;
            daily++;
            placed++;
          }
        }
      }
    }
    const result = {
      candidates: candidates.length,
      valueCandidates: values.length,
      placed,
      settled: settledCount,
      settledTickets,
      ...(scanMeta || {}),
      ...(pauseReason ? { pauseReason } : {}),
    };
    // Auto-evolve the model from the newest settlement data on every
    // non-settlement run; the shift feeds the margin on the next rounds.
    if (!settlementOnly) {
      const cal = computeCalibration(lab);
      if (cal) evolveMargin(lab, cal);
    }
    // A focused old-ticket reconciliation must not masquerade as a fresh
    // full-league selection scan or replace the current research board.
    if (!settlementOnly) {
      lab.lastScanAt = Date.now();
      lab.lastScan = result;
    }
    return result;
  }
  currentModelW = evolution.modelW;
  currentEvolutionShift = evolution.marginShift;
  function candidate(m: any, value = false) {
    return m.frozenCandidates
      ? structuredClone(m.frozenCandidates[value ? "value" : "broad"])
      : compute_candidate(m, value);
  }
  function spreadCandidate(m: any) {
    return m.frozenCandidates
      ? structuredClone(m.frozenCandidates.spread)
      : compute_spreadCandidate(m);
  }
  function totalsPoissonCandidate(m: any) {
    return m.frozenCandidates
      ? structuredClone(m.frozenCandidates.total)
      : compute_totalsPoissonCandidate(m);
  }
  return {
    candidate,
    spreadCandidate,
    totalsPoissonCandidate,
    processLab,
    defaults,
    computeCalibration,
    makeGoalEvidence,
    makeCurrentOnlyGoalEvidence,
  };
}
export function legacyEvaluate(input: any) {
  const r = runtime(input.at, input.evolution);
  const g = input.goalStats;
  let goalModel = null;
  if (g)
    goalModel =
      g.homePrev && g.awayPrev
        ? r.makeGoalEvidence(
            g.home,
            g.away,
            g.homePrev,
            g.awayPrev,
            g.mean,
            g.meanPrev,
            [],
            [g.season, g.season - 1],
            g.observedAt,
          )
        : r.makeCurrentOnlyGoalEvidence(
            g.home,
            g.away,
            g.mean,
            "",
            g.season,
            g.observedAt,
          );
  const match = { ...input.match, goalModel };
  const candidates = {
    broad: r.candidate(match),
    value: r.candidate(match, true),
    spread: r.spreadCandidate(match),
    total: r.totalsPoissonCandidate(match),
  };
  return {
    match,
    candidates,
    central: candidates.broad?.leg.evidence?.adjustedProbabilities ?? null,
    goalModel,
  };
}
export function legacyDefaults() {
  return runtime(0, { modelW: 0.5, marginShift: 0 }).defaults();
}
export function legacyRound(lab: any, matches: any[], at: number) {
  const copy = structuredClone(lab);
  const old = new Set(
    copy.portfolios.flatMap((p: any) =>
      p.tickets.map((t: any) => p.id + "|" + t.id),
    ),
  );
  const result = runtime(at, copy.evolution).processLab(
    copy,
    structuredClone(matches),
  );
  return {
    lab: copy,
    result,
    proposals: copy.portfolios.flatMap((p: any) =>
      p.tickets
        .filter((t: any) => !old.has(p.id + "|" + t.id))
        .map((t: any) => ({ portfolioId: p.id, ticket: t })),
    ),
  };
}
