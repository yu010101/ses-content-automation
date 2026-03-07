/**
 * Offline dry-run test - validates the pipeline logic without API calls.
 * Run: npx tsx src/test-dry-run.ts
 */

import { formatForQiita, formatForZenn, formatForX, generateZennSlug } from "./content/formatter.js";
import { getQiitaTags, getCTA } from "./content/templates.js";
import type { GeneratedArticle } from "./content/generator.js";

const mockArticle: GeneratedArticle = {
  title: "SESエンジニアがフリーランスに転身する際の5つの注意点",
  body: `## はじめに

SESエンジニアとして働いている皆さん、フリーランスへの転身を考えたことはありませんか？

${"本文テスト内容です。SESエンジニアの皆さんにお伝えしたいことがあります。".repeat(200)}

${getCTA()}`,
  keywords: ["SES エンジニア", "フリーランス", "転職", "単価交渉", "キャリアパス"],
  summary: "SESエンジニアがフリーランスに転身する際に知っておくべき5つの重要なポイントを解説",
  xPost: "SESからフリーランスに転身する際の5つの注意点をまとめました！\n\n#SES #フリーランスエンジニア #エンジニア転職",
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  OK: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

console.log("=== SES Content Automation - Dry Run Tests ===\n");

// Test 1: Qiita formatting
console.log("[Test] Qiita formatting");
const qiita = formatForQiita(mockArticle, true);
assert(qiita.title === mockArticle.title, "Title preserved");
assert(qiita.tags.length > 0, "Tags generated");
assert(qiita.tags.length <= 5, "Tags max 5");
assert(qiita.private === true, "Private flag set for dry-run");
assert(qiita.body.includes("FreelanceDB"), "CTA present in body");

// Test 2: Zenn formatting
console.log("\n[Test] Zenn formatting");
const zenn = formatForZenn(mockArticle);
assert(zenn.startsWith("---"), "Has frontmatter");
assert(zenn.includes("title:"), "Has title in frontmatter");
assert(zenn.includes("topics:"), "Has topics in frontmatter");
assert(zenn.includes("published: true"), "Published is true");

// Test 3: Zenn slug generation
console.log("\n[Test] Zenn slug");
const slug = generateZennSlug(mockArticle.title);
assert(slug.length <= 50, `Slug length OK (${slug.length})`);
assert(/^\d{8}-/.test(slug), "Slug starts with date");

// Test 4: X formatting
console.log("\n[Test] X formatting");
const xPost = formatForX(mockArticle);
assert(xPost.length <= 280, `X post within limit (${xPost.length})`);
const xWithUrl = formatForX(mockArticle, "https://qiita.com/test/items/abc123");
assert(xWithUrl.includes("https://qiita.com"), "URL appended");
assert(xWithUrl.length <= 280, `X post with URL within limit (${xWithUrl.length})`);

// Test 5: Qiita tags mapping
console.log("\n[Test] Qiita tags");
const tags = getQiitaTags(["SES エンジニア", "フリーランス 転職"]);
assert(tags.includes("SES"), "SES tag mapped");
assert(tags.includes("フリーランス"), "Freelance tag mapped");
assert(tags.includes("転職"), "Career change tag mapped");

// Test 6: Article body length
console.log("\n[Test] Article body");
assert(mockArticle.body.length >= 5000, `Body length >= 5000 (${mockArticle.body.length})`);
assert(mockArticle.body.includes("freelance.radineer.asia"), "FreelanceDB URL in CTA");

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
