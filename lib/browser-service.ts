import { chromium, Browser, BrowserContext, Page } from "playwright";
import path from "path";
import fs from "fs";

const SCREENSHOTS_DIR = path.join(process.cwd(), "public", "screenshots");
const BROWSER_DATA_DIR = path.join(process.cwd(), ".browser-data");

// Ensure directories exist
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}
if (!fs.existsSync(BROWSER_DATA_DIR)) {
  fs.mkdirSync(BROWSER_DATA_DIR, { recursive: true });
}

let _browser: Browser | null = null;
let _persistentContext: BrowserContext | null = null;
const _pages = new Map<string, Page>();

async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: false, // Visible browser so user can watch
    });
  }
  return _browser;
}

// Persistent context — keeps cookies/localStorage between sessions (for WhatsApp Web etc.)
async function getPersistentContext(): Promise<BrowserContext> {
  if (!_persistentContext) {
    _persistentContext = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
    });
  }
  return _persistentContext;
}

// --- Session management ---

export async function createSession(sessionId: string, url?: string, persistent = false): Promise<{ sessionId: string }> {
  let page: Page;

  if (persistent) {
    // Use persistent context — keeps login sessions (WhatsApp, etc.)
    const context = await getPersistentContext();
    page = await context.newPage();
  } else {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();
  }

  _pages.set(sessionId, page);

  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  return { sessionId };
}

export async function closeSession(sessionId: string): Promise<void> {
  const page = _pages.get(sessionId);
  if (page) {
    const ctx = page.context();
    // For persistent context, only close the page (not the context) to keep cookies/session
    if (ctx === _persistentContext) {
      await page.close();
    } else {
      await ctx.close();
    }
    _pages.delete(sessionId);
  }
}

function getPage(sessionId: string): Page {
  const page = _pages.get(sessionId);
  if (!page) throw new Error(`Session ${sessionId} not found. Create a session first.`);
  return page;
}

// --- Navigation ---

export async function navigate(sessionId: string, url: string): Promise<{ url: string; title: string }> {
  const page = getPage(sessionId);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return { url: page.url(), title: await page.title() };
}

// --- Screenshot ---

export async function screenshot(sessionId: string, fullPage = false): Promise<{ path: string; url: string }> {
  const page = getPage(sessionId);
  const filename = `${sessionId}-${Date.now()}.png`;
  const filePath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filePath, fullPage });
  return { path: filePath, url: `/screenshots/${filename}` };
}

// --- Click ---

export async function click(sessionId: string, selector: string): Promise<{ success: boolean }> {
  const page = getPage(sessionId);
  await page.click(selector, { timeout: 10000 });
  await page.waitForTimeout(500);
  return { success: true };
}

// --- Fill ---

export async function fill(sessionId: string, selector: string, value: string): Promise<{ success: boolean }> {
  const page = getPage(sessionId);
  await page.fill(selector, value, { timeout: 10000 });
  return { success: true };
}

// --- Get text ---

export async function getText(sessionId: string, selector?: string): Promise<{ text: string }> {
  const page = getPage(sessionId);
  if (selector) {
    const el = await page.$(selector);
    if (!el) return { text: "" };
    const text = await el.textContent();
    return { text: text ?? "" };
  }
  // Get full page text
  const text = await page.evaluate(() => document.body.innerText);
  return { text: text.slice(0, 5000) };
}

// --- Evaluate JS ---

export async function evaluate(sessionId: string, script: string): Promise<{ result: unknown }> {
  const page = getPage(sessionId);
  const result = await page.evaluate((code) => {
    return new Function(code)();
  }, script);
  return { result };
}

// --- Get page info ---

export async function getPageInfo(sessionId: string): Promise<{ url: string; title: string }> {
  const page = getPage(sessionId);
  return { url: page.url(), title: await page.title() };
}

// --- Select option ---

export async function selectOption(sessionId: string, selector: string, value: string): Promise<{ success: boolean }> {
  const page = getPage(sessionId);
  await page.selectOption(selector, value, { timeout: 10000 });
  return { success: true };
}

// --- Wait for selector ---

export async function waitForSelector(sessionId: string, selector: string, timeout = 10000): Promise<{ found: boolean }> {
  const page = getPage(sessionId);
  try {
    await page.waitForSelector(selector, { timeout });
    return { found: true };
  } catch {
    return { found: false };
  }
}

// --- Get all interactive elements (helps agent understand the page) ---

export async function getElements(sessionId: string): Promise<{ elements: Array<{ tag: string; type?: string; text?: string; placeholder?: string; selector: string }> }> {
  const page = getPage(sessionId);
  const elements = await page.evaluate(() => {
    const results: Array<{ tag: string; type?: string; text?: string; placeholder?: string; selector: string }> = [];
    const interactiveSelectors = "a, button, input, select, textarea, [role='button'], [onclick]";
    const els = document.querySelectorAll(interactiveSelectors);

    els.forEach((el, i) => {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim().slice(0, 50) || undefined;
      const type = el.getAttribute("type") || undefined;
      const placeholder = el.getAttribute("placeholder") || undefined;
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className && typeof el.className === "string"
        ? "." + el.className.split(" ").filter(Boolean).slice(0, 2).join(".")
        : "";
      const selector = id || `${tag}${cls}` || `${tag}:nth-of-type(${i + 1})`;

      results.push({ tag, type, text, placeholder, selector });
    });

    return results.slice(0, 50); // Limit to 50 elements
  });

  return { elements };
}

// --- List active sessions ---

export function listSessions(): string[] {
  return Array.from(_pages.keys());
}

// --- Close everything ---

export async function closeAll(): Promise<void> {
  for (const [id] of _pages) {
    await closeSession(id);
  }
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}
