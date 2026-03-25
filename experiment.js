/**
 * experiment.js — Parameter experiment runner for SES Content Automation
 *
 * Tests different parameter configurations for:
 *   - Similarity threshold (checkDiversity)
 *   - Learning ratio (loadKeywords 70/30 split)
 *   - Priority weighting (quote repost target selection)
 *
 * Usage:
 *   node experiment.js
 *   node experiment.js --iterations 5000
 *   node experiment.js --param similarity
 *   node experiment.js --param learning
 *   node experiment.js --param weighting
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Config ───────────────────────────────────────────────

const DEFAULT_ITERATIONS = 1000;

const COMMON_KEYWORDS = [
  "SES", "フリーランス", "エンジニア", "転職", "年収",
  "脱出", "転向", "比較", "完全ガイド", "徹底", "最新", "2026",
];

// ── Helpers ──────────────────────────────────────────────

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomTitle() {
  const count = 2 + Math.floor(Math.random() * 4);
  const picked = shuffle(COMMON_KEYWORDS).slice(0, count);
  return picked.join("で") + "する方法";
}

function computeOverlap(titleA, titleB) {
  const wordsA = COMMON_KEYWORDS.filter((w) => titleA.includes(w));
  const wordsB = COMMON_KEYWORDS.filter((w) => titleB.includes(w));
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const overlap = wordsA.filter((w) => wordsB.includes(w)).length;
  return overlap / Math.max(wordsA.length, wordsB.length);
}

// ── Experiment 1: Similarity Threshold ───────────────────

function experimentSimilarity(iterations) {
  const thresholds = [0.5, 0.6, 0.7, 0.8, 0.9];
  const results = {};

  for (const threshold of thresholds) {
    let accepted = 0;
    let rejected = 0;
    const overlapScores = [];

    for (let i = 0; i < iterations; i++) {
      const candidate = randomTitle();
      const recentCount = 3 + Math.floor(Math.random() * 5);
      const recentTitles = Array.from({ length: recentCount }, randomTitle);

      const scores = recentTitles.map((rt) => computeOverlap(candidate, rt));
      const maxScore = Math.max(...scores);
      overlapScores.push(maxScore);

      if (maxScore >= threshold) {
        rejected++;
      } else {
        accepted++;
      }
    }

    const avgOverlap = overlapScores.reduce((a, b) => a + b, 0) / overlapScores.length;
    results[threshold] = {
      accepted,
      rejected,
      acceptRate: ((accepted / iterations) * 100).toFixed(1) + "%",
      avgMaxOverlap: avgOverlap.toFixed(3),
    };
  }

  return results;
}

// ── Experiment 2: Learning Ratio ─────────────────────────

function experimentLearningRatio(iterations) {
  const ratios = [
    { name: "60/40", proven: 3, exploratory: 5 },
    { name: "70/30", proven: 3, exploratory: 5 },  // current: 3 proven + 2 highCv + 3 rest
    { name: "80/20", proven: 4, exploratory: 3 },
    { name: "90/10", proven: 5, exploratory: 2 },
  ];

  const bestKeywords = ["SESエンジニア転職", "フリーランス独立", "年収アップ", "案件獲得", "単価交渉"];
  const otherKeywords = ["リモートワーク", "副業", "スキルアップ", "AI活用", "キャリア設計", "ポートフォリオ", "面接対策", "税金対策"];

  const results = {};

  for (const ratio of ratios) {
    let provenHitCount = 0;
    const diversityScores = [];

    for (let i = 0; i < iterations; i++) {
      const proven = shuffle(bestKeywords).slice(0, ratio.proven);
      const exploratory = shuffle(otherKeywords).slice(0, ratio.exploratory);
      const selected = [...proven, ...exploratory];

      const provenRatio = proven.length / selected.length;
      provenHitCount += proven.length;

      // Diversity = unique keyword categories represented
      const uniqueCount = new Set(selected).size;
      diversityScores.push(uniqueCount / selected.length);
    }

    const avgDiversity = diversityScores.reduce((a, b) => a + b, 0) / diversityScores.length;
    results[ratio.name] = {
      avgProvenPerRun: (provenHitCount / iterations).toFixed(1),
      avgDiversity: avgDiversity.toFixed(3),
      totalKeywordsPerRun: ratio.proven + ratio.exploratory,
    };
  }

  return results;
}

// ── Experiment 3: Priority Weighting ─────────────────────

function experimentWeighting(iterations) {
  const targets = [
    { username: "high_a", priority: "high" },
    { username: "high_b", priority: "high" },
    { username: "med_a", priority: "medium" },
    { username: "med_b", priority: "medium" },
    { username: "med_c", priority: "medium" },
  ];

  const weightConfigs = [
    { name: "2:1", highWeight: 2, medWeight: 1 },
    { name: "3:1", highWeight: 3, medWeight: 1 },  // current
    { name: "4:1", highWeight: 4, medWeight: 1 },
    { name: "5:1", highWeight: 5, medWeight: 1 },
  ];

  const results = {};

  for (const config of weightConfigs) {
    const selectionCounts = {};
    targets.forEach((t) => (selectionCounts[t.username] = 0));

    for (let i = 0; i < iterations; i++) {
      const weighted = [];
      for (const t of targets) {
        const count = t.priority === "high" ? config.highWeight : config.medWeight;
        for (let j = 0; j < count; j++) weighted.push(t);
      }
      const selected = weighted[Math.floor(Math.random() * weighted.length)];
      selectionCounts[selected.username]++;
    }

    const highTotal = selectionCounts["high_a"] + selectionCounts["high_b"];
    const medTotal = iterations - highTotal;

    results[config.name] = {
      highPct: ((highTotal / iterations) * 100).toFixed(1) + "%",
      medPct: ((medTotal / iterations) * 100).toFixed(1) + "%",
      distribution: Object.fromEntries(
        Object.entries(selectionCounts).map(([k, v]) => [k, ((v / iterations) * 100).toFixed(1) + "%"])
      ),
    };
  }

  return results;
}

// ── CLI ──────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const iterIdx = args.indexOf("--iterations");
  const iterations = iterIdx !== -1 ? parseInt(args[iterIdx + 1], 10) : DEFAULT_ITERATIONS;

  const paramIdx = args.indexOf("--param");
  const param = paramIdx !== -1 ? args[paramIdx + 1] : "all";

  console.log(`=== SES Content Automation — Parameter Experiments ===`);
  console.log(`Iterations: ${iterations}\n`);

  if (param === "all" || param === "similarity") {
    console.log("--- Experiment 1: Similarity Threshold ---");
    const simResults = experimentSimilarity(iterations);
    console.table(simResults);
    console.log();
  }

  if (param === "all" || param === "learning") {
    console.log("--- Experiment 2: Learning Ratio ---");
    const learnResults = experimentLearningRatio(iterations);
    console.table(learnResults);
    console.log();
  }

  if (param === "all" || param === "weighting") {
    console.log("--- Experiment 3: Priority Weighting ---");
    const weightResults = experimentWeighting(iterations);
    console.table(weightResults);
    console.log();
  }

  console.log("=== Done ===");
}

main();
