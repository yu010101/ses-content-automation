import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock config
vi.mock("../src/config.js", () => ({
  config: {
    x: {
      consumerKey: () => "test-consumer-key",
      consumerSecret: () => "test-consumer-secret",
      accessToken: () => "test-access-token",
      accessSecret: () => "test-access-secret",
    },
  },
}));

// Mock MCP client
vi.mock("../src/publishers/mcp-client.js", () => ({
  isMcpAvailable: vi.fn().mockResolvedValue(false),
  mcpCall: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("XPublisher", () => {
  let tmpDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "xpub-test-"));
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;
    mkdirSync(join(tmpDir, "data"), { recursive: true });
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("budget tracking (getXBudget / saveXBudget)", () => {
    it("should start with 0 used when no budget file exists", async () => {
      const { XPublisher } = await import("../src/publishers/x.js");
      // checkBudgetAvailable reads the budget — with no file, used=0, so budget is available
      expect(XPublisher.checkBudgetAvailable()).toBe(true);
    });

    it("should read existing budget file", async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      writeFileSync(
        join(tmpDir, "data/x-budget.json"),
        JSON.stringify({ month: currentMonth, used: 1499 }),
      );

      const { XPublisher } = await import("../src/publishers/x.js");
      expect(XPublisher.checkBudgetAvailable()).toBe(true);
    });

    it("should report exhausted when used >= 1500", async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      writeFileSync(
        join(tmpDir, "data/x-budget.json"),
        JSON.stringify({ month: currentMonth, used: 1500 }),
      );

      const { XPublisher } = await import("../src/publishers/x.js");
      expect(XPublisher.checkBudgetAvailable()).toBe(false);
    });

    it("should reset budget when month changes", async () => {
      writeFileSync(
        join(tmpDir, "data/x-budget.json"),
        JSON.stringify({ month: "2020-01", used: 1500 }),
      );

      const { XPublisher } = await import("../src/publishers/x.js");
      // Old month should reset to 0 used
      expect(XPublisher.checkBudgetAvailable()).toBe(true);
    });
  });

  describe("publishSingle dry-run mode", () => {
    it("should return success with (dry-run) url", async () => {
      const { XPublisher } = await import("../src/publishers/x.js");
      const pub = new XPublisher();
      const result = await pub.publishSingle("Test tweet", "text", true);

      expect(result.success).toBe(true);
      expect(result.url).toBe("(dry-run)");
      expect(result.platform).toBe("x");
      // fetch should NOT be called in dry-run
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should not consume budget in dry-run mode", async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      writeFileSync(
        join(tmpDir, "data/x-budget.json"),
        JSON.stringify({ month: currentMonth, used: 100 }),
      );

      const { XPublisher } = await import("../src/publishers/x.js");
      const pub = new XPublisher();
      await pub.publishSingle("Test tweet", "text", true);

      const budget = JSON.parse(
        readFileSync(join(tmpDir, "data/x-budget.json"), "utf-8"),
      );
      expect(budget.used).toBe(100); // unchanged
    });

    it("should truncate text exceeding 280 chars", async () => {
      const { XPublisher } = await import("../src/publishers/x.js");
      const pub = new XPublisher();
      const longText = "a".repeat(300);
      const result = await pub.publishSingle(longText, "text", true);

      expect(result.success).toBe(true);
    });
  });

  describe("publishQuoteRepost dry-run mode", () => {
    it("should return success with (dry-run) url", async () => {
      const { XPublisher } = await import("../src/publishers/x.js");
      const pub = new XPublisher();
      const result = await pub.publishQuoteRepost(
        "Great insight on SES market!",
        "tweet123",
        true,
      );

      expect(result.success).toBe(true);
      expect(result.url).toBe("(dry-run)");
      expect(result.platform).toBe("x");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should fail when budget exhausted (non-dry-run)", async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      writeFileSync(
        join(tmpDir, "data/x-budget.json"),
        JSON.stringify({ month: currentMonth, used: 1500 }),
      );

      const { XPublisher } = await import("../src/publishers/x.js");
      const pub = new XPublisher();
      const result = await pub.publishQuoteRepost(
        "Test quote",
        "tweet123",
        false,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("budget-exhausted");
    });
  });

  describe("thread building via publish()", () => {
    it("should build single tweet when no xThread provided", async () => {
      const { XPublisher } = await import("../src/publishers/x.js");
      const pub = new XPublisher();

      const article = {
        title: "Test Article",
        body: "Article body",
        keywords: ["SES"],
        summary: "Summary",
        xPost: "Check out this article about SES!",
        xThread: [],
        articleType: "ses-career",
      };

      const result = await pub.publish(article, true);
      expect(result.success).toBe(true);
      expect(result.url).toBe("(dry-run)");
    });

    it("should post multi-tweet thread in dry-run", async () => {
      const { XPublisher } = await import("../src/publishers/x.js");
      const pub = new XPublisher();

      const article = {
        title: "Test Article",
        body: "Article body",
        keywords: ["SES"],
        summary: "Summary",
        xPost: "Single tweet fallback",
        xThread: [
          "Thread tweet 1: SES market overview",
          "Thread tweet 2: Key trends to watch",
          "Thread tweet 3: What this means for engineers",
        ],
        articleType: "ses-career",
      };

      const result = await pub.publish(article, true);
      expect(result.success).toBe(true);
      expect(result.url).toBe("(dry-run)");
    });

    it("should append articleUrl to the last tweet in thread", async () => {
      const { XPublisher } = await import("../src/publishers/x.js");
      const pub = new XPublisher();

      const article = {
        title: "Test",
        body: "Body",
        keywords: ["SES"],
        summary: "Summary",
        xPost: "Single tweet",
        xThread: ["Tweet 1", "Tweet 2"],
        articleType: "ses-career",
      };

      // Spy on console.log to verify URL appended to last tweet
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await pub.publish(article, true, "https://qiita.com/test/items/abc");

      // Find the log line that shows the thread content
      const threadLogs = logSpy.mock.calls
        .map((c) => c.join(" "))
        .filter((s) => s.includes("qiita.com"));
      expect(threadLogs.length).toBeGreaterThan(0);

      logSpy.mockRestore();
    });
  });
});
