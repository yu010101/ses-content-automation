import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock external dependencies - use class syntax so `new OpenAI()` / `new Anthropic()` work
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "SESエンジニアの視点から共感します。現場の実態を知る声は貴重です" }],
      }),
    };
  }
  return { default: MockAnthropic };
});

vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  tweetId: "12345",
                  tweetText: "SESエンジニアの単価が上昇傾向にあります",
                  tweetUrl: "https://x.com/user/status/12345",
                }),
              },
            },
          ],
        }),
      },
    };
  }
  return { default: MockOpenAI };
});

vi.mock("../src/config.js", () => ({
  config: {
    xai: {
      apiKey: () => "test-xai-key",
      baseUrl: "https://api.x.ai/v1",
      model: "grok-test",
    },
    anthropic: {
      apiKey: () => "test-anthropic-key",
      model: "claude-test",
    },
    x: {
      consumerKey: () => "ck",
      consumerSecret: () => "cs",
      accessToken: () => "at",
      accessSecret: () => "as",
    },
  },
}));

vi.mock("../src/publishers/x.js", () => ({
  XPublisher: class MockXPublisher {
    publishQuoteRepost = vi.fn().mockResolvedValue({
      success: true,
      tweetId: "99999",
      url: "https://x.com/i/status/99999",
      platform: "x",
    });
  },
}));

describe("quote-repost module", () => {
  let tmpDir: string;
  const originalCwd = process.cwd;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "qr-test-"));
    mkdirSync(join(tmpDir, "data"), { recursive: true });

    writeFileSync(
      join(tmpDir, "data/quote-targets.json"),
      JSON.stringify({
        targets: [
          { username: "user_high", displayName: "High User", priority: "high" },
          { username: "user_med", displayName: "Med User", priority: "medium" },
        ],
      }),
    );

    writeFileSync(
      join(tmpDir, "data/quote-history.json"),
      JSON.stringify({ quotes: [] }),
    );

    // Set cwd BEFORE module import so TARGETS_PATH / HISTORY_PATH resolve to tmpDir
    process.cwd = () => tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("selectTarget (weighted selection)", () => {
    it("should favor high-priority targets over many runs", async () => {
      const counts: Record<string, number> = {};

      for (let i = 0; i < 50; i++) {
        vi.resetModules();
        const mod = await import("../src/x-amplification/quote-repost.js");
        const result = await mod.executeQuoteRepost(true);
        if (result.target) {
          counts[result.target] = (counts[result.target] || 0) + 1;
        }
      }

      // High-priority (weight 3) vs medium (weight 1) => ~75% vs ~25%
      expect(counts["user_high"] || 0).toBeGreaterThan(counts["user_med"] || 0);
    });

    it("should select first weighted entry when random returns 0", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const mod = await import("../src/x-amplification/quote-repost.js");
      const result = await mod.executeQuoteRepost(true);
      expect(result.success).toBe(true);
      expect(result.target).toBe("user_high");
    });
  });

  describe("loadTargets / loadHistory / saveHistory (file I/O)", () => {
    it("should load targets from quote-targets.json", async () => {
      const mod = await import("../src/x-amplification/quote-repost.js");
      const result = await mod.executeQuoteRepost(true);
      expect(result.target).toMatch(/user_high|user_med/);
    });

    it("should handle missing history file gracefully", async () => {
      try {
        rmSync(join(tmpDir, "data/quote-history.json"));
      } catch {
        // ignore
      }

      const mod = await import("../src/x-amplification/quote-repost.js");
      const result = await mod.executeQuoteRepost(true);
      expect(result.success).toBe(true);
    });

    it("should save history after non-dry-run execution", async () => {
      const mod = await import("../src/x-amplification/quote-repost.js");
      const result = await mod.executeQuoteRepost(false);
      expect(result.success).toBe(true);

      const historyRaw = readFileSync(
        join(tmpDir, "data/quote-history.json"),
        "utf-8",
      );
      const history = JSON.parse(historyRaw);
      expect(history.quotes.length).toBeGreaterThan(0);
      expect(history.quotes[0]).toHaveProperty("quotedTweetId");
      expect(history.quotes[0]).toHaveProperty("commentText");
    });
  });

  describe("generateQuoteComment (mocked Anthropic)", () => {
    it("should return text within 140 chars", async () => {
      const mod = await import("../src/x-amplification/quote-repost.js");
      const result = await mod.executeQuoteRepost(true);
      expect(result.comment).toBeDefined();
      expect(result.comment!.length).toBeLessThanOrEqual(140);
    });

    it("should truncate long comments to 140 chars", async () => {
      vi.resetModules();

      vi.doMock("@anthropic-ai/sdk", () => ({
        default: class LongAnthropic {
          messages = {
            create: vi.fn().mockResolvedValue({
              content: [{ type: "text", text: "あ".repeat(200) }],
            }),
          };
        },
      }));

      const mod = await import("../src/x-amplification/quote-repost.js");
      const result = await mod.executeQuoteRepost(true);
      expect(result.comment).toBeDefined();
      expect(result.comment!.length).toBeLessThanOrEqual(140);
    });
  });
});
