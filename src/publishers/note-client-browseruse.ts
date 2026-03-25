/**
 * Note.com client using Browser Use CLI instead of Playwright.
 * Drop-in replacement for note-client.ts with the same public API.
 *
 * Browser Use CLI communicates via CDP (Chrome DevTools Protocol) directly,
 * offering lower latency and better AI-agent token efficiency.
 */
import { execSync } from "node:child_process";
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
 * Execute a browser-use CLI command and return stdout.
 */
function bu(cmd: string, timeoutMs = 30000): string {
  try {
    return execSync(`browser-use --browser real ${cmd}`, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: unknown) {
    const err = e as { stderr?: string; stdout?: string };
    console.error(`[BrowserUse] Command failed: ${cmd}`);
    if (err.stderr) console.error(`[BrowserUse] stderr: ${err.stderr}`);
    return err.stdout?.trim() ?? "";
  }
}

/**
 * Execute browser-use eval (JavaScript in browser context).
 */
function buEval(js: string, timeoutMs = 15000): string {
  // Escape single quotes for shell safety
  const escaped = js.replace(/'/g, "'\\''");
  return bu(`eval '${escaped}'`, timeoutMs);
}

export class NoteClientBrowserUse {
  private session: NoteSession | null = null;

  // --- Session Management (identical to original) ---

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

  // --- Browser Use CLI helpers ---

  /**
   * Sleep for given milliseconds. Browser Use CLI doesn't have a raw sleep,
   * so we use Node's setTimeout.
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Wait for a CSS selector to appear on page.
   */
  private waitForSelector(selector: string, timeoutMs = 15000): void {
    bu(`wait selector "${selector}" --timeout ${timeoutMs}`, timeoutMs + 5000);
  }

  /**
   * Wait for text to appear on page.
   */
  private waitForText(text: string, timeoutMs = 15000): void {
    bu(`wait text "${text}" --timeout ${timeoutMs}`, timeoutMs + 5000);
  }

  private getState(): string {
    return bu("state");
  }

  private screenshot(): void {
    bu("screenshot");
  }

  /**
   * Click an element by its browser-use index.
   */
  private clickIndex(index: number): void {
    bu(`click ${index}`);
  }

  /**
   * Find element index from state output by matching text content.
   * Returns the first matching [index] or null.
   */
  private findElementIndex(stateOutput: string, textMatch: string): number | null {
    const lines = stateOutput.split("\n");
    for (const line of lines) {
      if (line.includes(textMatch)) {
        const match = line.match(/\[(\d+)\]/);
        if (match) return parseInt(match[1], 10);
      }
    }
    return null;
  }

  /**
   * Find and click an element by text content.
   */
  private clickByText(texts: string[]): boolean {
    const state = this.getState();
    for (const text of texts) {
      const idx = this.findElementIndex(state, text);
      if (idx !== null) {
        this.clickIndex(idx);
        console.log(`[BrowserUse] Clicked element [${idx}] matching "${text}"`);
        return true;
      }
    }
    return false;
  }

  /**
   * Dismiss modal dialogs (ReactModal).
   */
  private async dismissModal(): Promise<void> {
    const state = this.getState();
    if (!state.includes("ReactModal") && !state.includes("modal")) return;

    console.log("[BrowserUse] Modal detected, dismissing...");

    // Try dismiss buttons
    const dismissTexts = [
      "あとで確認する", "今はしない", "後で確認する",
      "閉じる", "あとで", "スキップ", "キャンセル", "Close",
    ];

    if (this.clickByText(dismissTexts)) {
      await this.sleep(1000);
      return;
    }

    // Fallback: press Escape
    bu("keys Escape");
    console.log("[BrowserUse] Pressed Escape to dismiss modal");
    await this.sleep(1000);
  }

  private async dismissModalWithRetry(maxAttempts = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const state = this.getState();
      if (!state.includes("ReactModal") && !state.includes("modal")) return;

      console.log(`[BrowserUse] Modal dismiss attempt ${attempt}/${maxAttempts}`);
      await this.dismissModal();
      await this.sleep(1000);
    }
  }

  async close(): Promise<void> {
    bu("close");
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
      console.log("[BrowserUse] Reusing saved session");
      return;
    }

    console.log("[BrowserUse] Logging in via Browser Use CLI...");

    // Visit homepage to establish cookies
    bu('open "https://note.com"');
    await this.sleep(2000);

    // Navigate to login
    bu('open "https://note.com/login"');
    await this.sleep(3000);

    // Get page state to find input elements
    const state = this.getState();

    // Find email input index
    const emailIdx = this.findElementIndex(state, "メール")
      ?? this.findElementIndex(state, "email")
      ?? this.findElementIndex(state, "type=email");

    if (emailIdx === null) {
      console.log(`[BrowserUse] Page state:\n${state}`);
      throw new Error("Could not find email input on login page");
    }

    // Type email with human-like delay
    bu(`input ${emailIdx} "${email}"`);
    await this.sleep(500);

    // Find password input
    const passwordIdx = this.findElementIndex(state, "password")
      ?? this.findElementIndex(state, "type=password");

    if (passwordIdx === null) {
      throw new Error("Could not find password input");
    }

    bu(`input ${passwordIdx} "${password}"`);
    await this.sleep(500);

    // Click login button
    if (!this.clickByText(["ログイン", "Login"])) {
      throw new Error("Could not find login button");
    }

    // Wait for login to complete
    await this.sleep(5000);

    // Wait for URL change (login redirect)
    // Wait for URL to change away from login page
    for (let i = 0; i < 20; i++) {
      const state = this.getState();
      if (!state.includes("/login")) break;
      await this.sleep(1000);
    }

    // Extract cookies via browser-use
    const cookieOutput = bu("cookies get");
    const noteCookies: Record<string, string> = {};
    let xsrfToken: string | undefined;

    // Parse cookie output
    try {
      // browser-use cookies get returns a Python-style list of dicts
      // We need to parse it - try JSON first
      const cookieStr = cookieOutput.replace(/^cookies:\s*/i, "").trim();
      const parsed = JSON.parse(cookieStr.replace(/'/g, '"'));
      if (Array.isArray(parsed)) {
        for (const c of parsed) {
          if (c.domain?.includes("note.com")) {
            noteCookies[c.name] = c.value;
            if (c.name.toLowerCase().includes("xsrf") || c.name.toLowerCase().includes("csrf")) {
              xsrfToken = c.value;
            }
          }
        }
      }
    } catch {
      // Fallback: extract cookies via JavaScript eval
      const cookieJs = buEval("document.cookie");
      const pairs = cookieJs.split(";").map(p => p.trim());
      for (const pair of pairs) {
        const [name, ...rest] = pair.split("=");
        if (name) {
          noteCookies[name.trim()] = rest.join("=");
          if (name.toLowerCase().includes("xsrf") || name.toLowerCase().includes("csrf")) {
            xsrfToken = rest.join("=");
          }
        }
      }
    }

    const newSession: NoteSession = { cookies: noteCookies, xsrfToken };
    this.saveSession(newSession);
    console.log("[BrowserUse] Login successful, session saved");
  }

  // --- Draft Creation & Content Save (API — unchanged) ---

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

  // --- Publish via Browser Use CLI Editor ---

  async publishViaEditor(
    key: string,
    isPaid = false,
    price = 0,
  ): Promise<string> {
    let publishedUrl = "";

    // Set up response interception via eval
    buEval(`
      window.__publishResult = null;
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const res = await origFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (url.includes('/api/') && url.includes('text_notes')) {
          try {
            const clone = res.clone();
            const json = await clone.json();
            if (json?.data?.key && json?.data?.status === 'published') {
              window.__publishResult = json.data.key;
            }
          } catch {}
        }
        return res;
      };
    `);

    // Open editor
    const editorUrl = `${NOTE_EDITOR}/notes/${key}/edit/`;
    console.log(`[BrowserUse] Opening editor: ${editorUrl}`);
    bu(`open "${editorUrl}"`);

    // Wait for ProseMirror editor to load
    this.waitForSelector(".ProseMirror", 15000);
    await this.sleep(2000);

    // Click "公開に進む" button
    const publishProceedTexts = ["公開に進む", "公開設定", "公開"];
    if (!this.clickByText(publishProceedTexts)) {
      throw new Error("Could not find publish proceed button");
    }

    // Wait for publish settings page
    await this.sleep(3000);

    // Dismiss modal if present
    await this.dismissModalWithRetry(3);
    await this.sleep(1000);

    // Log page state for debugging
    const state = this.getState();
    console.log(`[BrowserUse] Page state after settings load (first 500 chars):\n${state.slice(0, 500)}`);

    // Set paid settings if needed
    if (isPaid && price > 0) {
      try {
        if (this.clickByText(["有料"])) {
          await this.sleep(500);
          // Find price input and fill
          const priceState = this.getState();
          const priceIdx = this.findElementIndex(priceState, "円")
            ?? this.findElementIndex(priceState, "価格")
            ?? this.findElementIndex(priceState, "type=number");
          if (priceIdx !== null) {
            bu(`input ${priceIdx} "${price}"`);
          }
        }
      } catch (e) {
        console.log(`[BrowserUse] Could not set paid options: ${e}`);
      }
    }

    // Dismiss modal again
    await this.dismissModalWithRetry(2);

    // Click "投稿する" (final publish)
    const publishTexts = ["投稿する", "投稿", "公開する"];
    const clicked = this.clickByText(publishTexts);

    if (!clicked) {
      const urlname = process.env.NOTE_URLNAME ?? "sescore";
      const draftUrl = `https://note.com/${urlname}/n/${key}`;
      console.log(`[BrowserUse] Could not find final publish button - returning draft URL: ${draftUrl}`);
      return `${draftUrl}?status=draft-publish-failed`;
    }

    // Wait for publish to complete
    await this.sleep(5000);

    // Check for published URL via intercepted response
    const publishKey = buEval("window.__publishResult || ''");
    if (publishKey && publishKey !== "null" && publishKey !== "") {
      try {
        const noteRes = await fetch(`https://note.com/api/v3/notes/${publishKey}`);
        const noteData = (await noteRes.json()) as { data?: { user?: { urlname?: string } } };
        const urlname = noteData?.data?.user?.urlname ?? process.env.NOTE_URLNAME ?? "fortune2025";
        publishedUrl = `https://note.com/${urlname}/n/${publishKey}`;
      } catch {
        const urlname = process.env.NOTE_URLNAME ?? "sescore";
        publishedUrl = `https://note.com/${urlname}/n/${publishKey}`;
      }
    }

    // Fallback: get current URL
    if (!publishedUrl) {
      const currentState = this.getState();
      const urlMatch = currentState.match(/url:\s*(https?:\/\/[^\s]+)/);
      if (urlMatch && urlMatch[1].includes("note.com") && !urlMatch[1].includes("editor")) {
        publishedUrl = urlMatch[1];
      } else {
        const urlname = process.env.NOTE_URLNAME ?? "sescore";
        publishedUrl = `https://note.com/${urlname}/n/${key}`;
      }
    }

    console.log(`[BrowserUse] Published: ${publishedUrl}`);
    return publishedUrl;
  }

  // --- High-level: Create + Save + Publish ---

  async createAndPublish(
    title: string,
    htmlBody: string,
    options: { hashtags?: string[]; isPaid?: boolean; price?: number } = {},
  ): Promise<string> {
    const { hashtags = [], isPaid = false, price = 0 } = options;

    await this.login();

    console.log("[BrowserUse] Creating draft...");
    const draft = await this.createDraft();
    console.log(`[BrowserUse] Draft created: id=${draft.id}, key=${draft.key}`);

    console.log("[BrowserUse] Saving content...");
    await this.saveDraftContent(draft.id, title, htmlBody, hashtags);
    console.log("[BrowserUse] Content saved");

    console.log("[BrowserUse] Publishing via editor...");
    const url = await this.publishViaEditor(draft.key, isPaid, price);

    return url;
  }
}
