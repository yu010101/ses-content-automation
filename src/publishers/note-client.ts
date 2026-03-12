import { chromium, type Browser, type BrowserContext } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const NOTE_API = "https://note.com/api";
const NOTE_EDITOR = "https://editor.note.com";
const SESSION_PATH = join(
  process.env.HOME ?? "~",
  ".ses-content-automation",
  "note_session.json",
);

interface NoteSession {
  cookies: Record<string, string>;
  xsrfToken?: string;
}

interface DraftResult {
  id: number;
  key: string;
}

/**
 * Note.com client using API + Playwright (same approach as boatrace-ai).
 * Flow: login → create draft → save content → publish via editor.
 */
export class NoteClient {
  private session: NoteSession | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  // --- Session Management ---

  private loadSession(): NoteSession | null {
    try {
      return JSON.parse(readFileSync(SESSION_PATH, "utf-8"));
    } catch {
      return null;
    }
  }

  private saveSession(session: NoteSession): void {
    mkdirSync(join(SESSION_PATH, ".."), { recursive: true });
    writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), "utf-8");
    this.session = session;
  }

  private async apiHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (this.session?.cookies) {
      headers["Cookie"] = Object.entries(this.session.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }
    if (this.session?.xsrfToken) {
      headers["X-XSRF-TOKEN"] = this.session.xsrfToken;
    }
    return headers;
  }

  async isSessionValid(): Promise<boolean> {
    if (!this.session?.cookies) return false;
    try {
      const headers = await this.apiHeaders();
      const res = await fetch(`${NOTE_API}/v1/stats/pv_count`, { headers });
      if (res.ok) return true;
      const res2 = await fetch(`${NOTE_API}/v2/creators/mine`, { headers });
      return res2.ok;
    } catch {
      return false;
    }
  }

  // --- Browser Management ---

  private async ensureBrowser(): Promise<BrowserContext> {
    if (this.context) return this.context;

    this.browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    this.context = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });

    // Inject cookies if we have a session
    if (this.session?.cookies) {
      const cookies = Object.entries(this.session.cookies).map(
        ([name, value]) => ({
          name,
          value,
          domain: ".note.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: "Lax" as const,
        }),
      );
      await this.context.addCookies(cookies);
    }

    return this.context;
  }

  private async clickFirst(page: import("playwright").Page, selectors: string[]): Promise<boolean> {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          await el.click();
          return true;
        }
      } catch { /* try next */ }
    }
    return false;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }

  // --- Login ---

  async login(): Promise<void> {
    const email = process.env.NOTE_EMAIL;
    const password = process.env.NOTE_PASSWORD;
    if (!email || !password) {
      throw new Error("NOTE_EMAIL and NOTE_PASSWORD are required");
    }

    // Try existing session first
    this.session = this.loadSession();
    if (this.session && (await this.isSessionValid())) {
      console.log("[Note] Reusing saved session");
      return;
    }

    console.log("[Note] Logging in via Playwright...");
    const ctx = await this.ensureBrowser();
    const page = await ctx.newPage();

    try {
      // Visit homepage first to establish cookies
      await page.goto("https://note.com", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      // Navigate to login
      await page.goto("https://note.com/login", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      // Try multiple selectors for email input
      const emailSelector = (await page.$("#email"))
        ?? (await page.$("input[type='email']"))
        ?? (await page.$("input[name='email']"))
        ?? (await page.$("input[placeholder*='メール']"));
      if (!emailSelector) {
        // Take screenshot for debugging
        console.log(`[Note] Login page URL: ${page.url()}`);
        console.log(`[Note] Login page title: ${await page.title()}`);
        throw new Error("Could not find email input on login page");
      }

      // Type with human-like delays
      await emailSelector.fill("");
      await emailSelector.type(email, { delay: 50 });

      const passwordSelector = (await page.$("#password"))
        ?? (await page.$("input[type='password']"))
        ?? (await page.$("input[name='password']"));
      if (!passwordSelector) throw new Error("Could not find password input");
      await passwordSelector.fill("");
      await passwordSelector.type(password, { delay: 50 });

      await page.waitForTimeout(500);

      // Click login button - try multiple selectors
      const loginClicked = await this.clickFirst(page, [
        ".o-login__button button",
        "button[type='submit']",
        "button:has-text('ログイン')",
        "button:has-text('Login')",
      ]);
      if (!loginClicked) throw new Error("Could not find login button");

      // Wait for login: either URL change or session cookie appears
      try {
        await page.waitForURL((url) => !url.pathname.includes("/login"), {
          timeout: 20000,
        });
      } catch {
        // URL might not change. Check for session via cookies instead.
        console.log("[Note] URL didn't change, checking cookies...");
        await page.waitForTimeout(5000);
      }

      // Extract cookies
      const allCookies = await ctx.cookies();
      const noteCookies: Record<string, string> = {};
      let xsrfToken: string | undefined;

      for (const c of allCookies) {
        if (c.domain.includes("note.com")) {
          noteCookies[c.name] = c.value;
          if (c.name.toLowerCase().includes("xsrf") || c.name.toLowerCase().includes("csrf")) {
            xsrfToken = c.value;
          }
        }
      }

      const newSession: NoteSession = { cookies: noteCookies, xsrfToken };
      this.saveSession(newSession);
      console.log("[Note] Login successful, session saved");
    } finally {
      await page.close();
    }
  }

  // --- Draft Creation & Content Save (API) ---

  async createDraft(): Promise<DraftResult> {
    const headers = await this.apiHeaders();
    const res = await fetch(`${NOTE_API}/v1/text_notes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ template_key: null }),
    });

    if (!res.ok) {
      throw new Error(`Draft creation failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { data: { id: number; key: string } };
    return { id: json.data.id, key: json.data.key };
  }

  async saveDraftContent(
    draftId: number,
    title: string,
    htmlBody: string,
    hashtags: string[] = [],
  ): Promise<void> {
    const headers = await this.apiHeaders();
    const res = await fetch(
      `${NOTE_API}/v1/text_notes/draft_save?id=${draftId}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ name: title, body: htmlBody, hashtags }),
      },
    );

    if (!res.ok) {
      throw new Error(`Draft save failed: ${res.status} ${await res.text()}`);
    }
  }

  // --- Publish via Playwright Editor ---

  async publishViaEditor(
    key: string,
    isPaid = false,
    price = 0,
  ): Promise<string> {
    const ctx = await this.ensureBrowser();
    const page = await ctx.newPage();

    let publishedUrl = "";

    try {
      // Intercept responses to capture the publish API result
      page.on("response", async (response) => {
        const url = response.url();
        if (
          (url.includes("/api/") && response.request().method() === "PUT") ||
          (url.includes("/api/") && url.includes("text_notes") && response.request().method() === "POST")
        ) {
          try {
            const json = await response.json();
            if (json?.data?.key) {
              const urlname = process.env.NOTE_URLNAME ?? "sescore";
              publishedUrl = `https://note.com/${urlname}/n/${json.data.key}`;
            }
          } catch { /* ignore non-JSON */ }
        }
      });

      // Open editor
      const editorUrl = `${NOTE_EDITOR}/notes/${key}/edit/`;
      console.log(`[Note] Opening editor: ${editorUrl}`);
      await page.goto(editorUrl, { waitUntil: "domcontentloaded" });

      // Wait for ProseMirror editor to load
      await page.waitForSelector(".ProseMirror", { timeout: 15000 });
      await page.waitForTimeout(2000);

      // Click "公開に進む" button
      const publishProceedTexts = ["公開に進む", "公開設定", "公開"];
      let clicked = false;
      for (const text of publishProceedTexts) {
        const btn = page.getByRole("button", { name: text });
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          clicked = true;
          console.log(`[Note] Clicked "${text}"`);
          break;
        }
      }
      if (!clicked) {
        throw new Error("Could not find publish proceed button");
      }

      // Wait for publish settings page to fully load
      await page.waitForTimeout(3000);
      // Log page state for debugging
      const buttons = await page.$$eval("button", (els) =>
        els.map((el) => el.textContent?.trim()).filter(Boolean),
      );
      console.log(`[Note] Buttons on page: ${JSON.stringify(buttons)}`);

      // Set paid settings if needed
      if (isPaid && price > 0) {
        try {
          const paidBtn =
            (await page.$("button:has-text('有料')")) ??
            (await page.$("text=有料"));
          if (paidBtn) {
            await paidBtn.click();
            await page.waitForTimeout(500);

            // Find price input
            const inputs = await page.$$("input");
            for (const input of inputs) {
              const type = await input.getAttribute("type");
              const placeholder = (await input.getAttribute("placeholder")) ?? "";
              if (type === "number" || placeholder.includes("円") || placeholder.includes("価格")) {
                await input.fill(String(price));
                break;
              }
            }
          }
        } catch (e) {
          console.log(`[Note] Could not set paid options: ${e}`);
        }
      }

      // Click "投稿する" (final publish)
      const publishTexts = ["投稿する", "投稿", "公開する", "公開"];
      clicked = false;

      // Strategy 1: getByRole with exact match
      for (const text of publishTexts) {
        const btn = page.getByRole("button", { name: text, exact: true });
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          clicked = true;
          console.log(`[Note] Clicked "${text}" (role exact)`);
          break;
        }
      }

      // Strategy 2: getByRole relaxed
      if (!clicked) {
        for (const text of publishTexts) {
          const btn = page.getByRole("button", { name: text });
          if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await btn.click();
            clicked = true;
            console.log(`[Note] Clicked "${text}" (role relaxed)`);
            break;
          }
        }
      }

      // Strategy 3: CSS has-text selectors
      if (!clicked) {
        const cssSelectors = [
          "button:has-text('投稿する')",
          "button:has-text('公開する')",
          "button:has-text('投稿')",
          "[role='button']:has-text('投稿')",
          "a:has-text('投稿する')",
        ];
        for (const sel of cssSelectors) {
          try {
            const el = await page.$(sel);
            if (el && await el.isVisible()) {
              await el.click();
              clicked = true;
              console.log(`[Note] Clicked via CSS: ${sel}`);
              break;
            }
          } catch { /* try next */ }
        }
      }

      // Strategy 4: Find by inner text scan
      if (!clicked) {
        const allButtons = await page.$$("button");
        for (const btn of allButtons) {
          const text = (await btn.textContent())?.trim() ?? "";
          if (text.includes("投稿") || text.includes("公開する")) {
            await btn.click();
            clicked = true;
            console.log(`[Note] Clicked by text scan: "${text}"`);
            break;
          }
        }
      }

      if (!clicked) {
        throw new Error("Could not find final publish button");
      }

      // Wait for publish to complete
      await page.waitForTimeout(5000);

      // Try to get URL from page if not captured via response
      if (!publishedUrl) {
        const currentUrl = page.url();
        if (currentUrl.includes("note.com") && !currentUrl.includes("editor")) {
          publishedUrl = currentUrl;
        } else {
          const urlname = process.env.NOTE_URLNAME ?? "sescore";
          publishedUrl = `https://note.com/${urlname}/n/${key}`;
        }
      }

      console.log(`[Note] Published: ${publishedUrl}`);
      return publishedUrl;
    } finally {
      await page.close();
    }
  }

  // --- High-level: Create + Save + Publish ---

  async createAndPublish(
    title: string,
    htmlBody: string,
    options: { hashtags?: string[]; isPaid?: boolean; price?: number } = {},
  ): Promise<string> {
    const { hashtags = [], isPaid = false, price = 0 } = options;

    await this.login();

    console.log("[Note] Creating draft...");
    const draft = await this.createDraft();
    console.log(`[Note] Draft created: id=${draft.id}, key=${draft.key}`);

    console.log("[Note] Saving content...");
    await this.saveDraftContent(draft.id, title, htmlBody, hashtags);
    console.log("[Note] Content saved");

    console.log("[Note] Publishing via editor...");
    const url = await this.publishViaEditor(draft.key, isPaid, price);

    return url;
  }
}

// --- Markdown to Note HTML Converter ---

export function markdownToNoteHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const htmlParts: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Close list if we're not in a list item
    if (inList && !trimmed.startsWith("- ") && !trimmed.startsWith("* ")) {
      htmlParts.push("</ul>");
      inList = false;
    }

    if (!trimmed) {
      continue;
    }

    // Headers (note.com supports h2, h3 only)
    if (trimmed.startsWith("### ")) {
      htmlParts.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      htmlParts.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      // h1 not supported, use h2
      htmlParts.push(`<h2>${escapeHtml(trimmed.slice(2))}</h2>`);
    } else if (trimmed === "---" || trimmed === "***") {
      htmlParts.push("<hr>");
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      htmlParts.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`);
    } else if (trimmed.startsWith("|")) {
      // Tables not supported — convert to text
      const cells = trimmed
        .split("|")
        .filter((c) => c.trim() && !c.trim().match(/^[-:]+$/));
      if (cells.length > 0) {
        htmlParts.push(`<p>${cells.map((c) => escapeHtml(c.trim())).join(" | ")}</p>`);
      }
    } else {
      htmlParts.push(`<p>${inlineFormat(trimmed)}</p>`);
    }
  }

  if (inList) htmlParts.push("</ul>");

  return htmlParts.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineFormat(text: string): string {
  let result = escapeHtml(text);
  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );
  return result;
}
