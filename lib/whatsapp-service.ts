/**
 * WhatsApp Service — Playwright-based
 * Uses persistent browser context to keep WhatsApp Web session.
 * Sends messages + files to phone numbers or groups.
 */
import { chromium, BrowserContext, Page } from "playwright";
import path from "path";
import fs from "fs";

const WA_DATA_DIR = path.join(process.cwd(), ".browser-data");

// Global state to persist across Next.js hot reloads
const g = globalThis as unknown as {
  __waContext: BrowserContext | null;
  __waPage: Page | null;
  __waReady: boolean;
  __waInitializing: boolean;
  __waQr: string | null;
};

if (g.__waReady === undefined) g.__waReady = false;
if (g.__waInitializing === undefined) g.__waInitializing = false;
if (g.__waQr === undefined) g.__waQr = null;
if (g.__waContext === undefined) g.__waContext = null;
if (g.__waPage === undefined) g.__waPage = null;

export type WAStatus = {
  connected: boolean;
  qr: string | null;
  initializing: boolean;
};

async function getContext(): Promise<BrowserContext> {
  if (!g.__waContext) {
    if (!fs.existsSync(WA_DATA_DIR)) {
      fs.mkdirSync(WA_DATA_DIR, { recursive: true });
    }
    g.__waContext = await chromium.launchPersistentContext(WA_DATA_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
    });
  }
  return g.__waContext;
}

async function getPage(): Promise<Page> {
  if (!g.__waPage || g.__waPage.isClosed()) {
    const ctx = await getContext();
    g.__waPage = await ctx.newPage();
    await g.__waPage.goto("https://web.whatsapp.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  }
  return g.__waPage;
}

export async function initialize(): Promise<void> {
  if (g.__waReady || g.__waInitializing) return;
  g.__waInitializing = true;

  try {
    const page = await getPage();

    // Wait for WhatsApp to load (either chat list or QR)
    const maxWait = 60000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      // Check if logged in (chat list visible)
      const chatList = await page.$('[data-testid="chat-list-search"], div[data-tab="3"]');
      if (chatList) {
        g.__waReady = true;
        g.__waQr = null;
        g.__waInitializing = false;
        console.log("[WhatsApp] Connected — chat list found");
        return;
      }

      // Check for QR code
      const qrCanvas = await page.$('canvas[aria-label], div[data-ref]');
      if (qrCanvas) {
        // Take screenshot of QR area for display
        const screenshot = await page.screenshot({ type: "png" });
        g.__waQr = `data:image/png;base64,${screenshot.toString("base64")}`;
        console.log("[WhatsApp] QR code detected — waiting for scan");
      }

      await page.waitForTimeout(2000);
    }

    // If we got here, neither logged in nor QR found
    g.__waInitializing = false;
    console.log("[WhatsApp] Timeout waiting for WhatsApp Web to load");
  } catch (e) {
    g.__waInitializing = false;
    console.error("[WhatsApp] Init error:", e);
    throw e;
  }
}

export function getStatus(): WAStatus {
  return {
    connected: g.__waReady,
    qr: g.__waQr,
    initializing: g.__waInitializing,
  };
}

export async function sendMessage(
  target: string,
  message: string,
  filePath?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!g.__waReady || !g.__waPage || g.__waPage.isClosed()) {
    return { ok: false, error: "WhatsApp not connected. Initialize first." };
  }

  const page = g.__waPage;

  try {
    const isPhone = /^\+?\d/.test(target);

    if (isPhone) {
      // Direct message via wa.me URL
      const clean = target.replace(/[\s\-\(\)\+]/g, "");
      await page.goto(
        `https://web.whatsapp.com/send?phone=${clean}`,
        { waitUntil: "domcontentloaded", timeout: 30000 }
      );
      await page.waitForTimeout(3000);
    } else {
      // Search for group
      // Make sure we're on the main page
      const currentUrl = page.url();
      if (!currentUrl.includes("web.whatsapp.com")) {
        await page.goto("https://web.whatsapp.com", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(3000);
      }

      // Click search box
      await page.click('div[contenteditable="true"][data-tab="3"]', { timeout: 10000 });
      await page.waitForTimeout(500);

      // Type group name
      await page.fill('div[contenteditable="true"][data-tab="3"]', target);
      await page.waitForTimeout(2000);

      // Click matching result — use evaluate to handle Unicode correctly
      await page.evaluate((name) => {
        const spans = document.querySelectorAll("span[title]");
        for (const s of spans) {
          if (s.getAttribute("title")?.includes(name)) {
            (s as HTMLElement).click();
            break;
          }
        }
      }, target);
      await page.waitForTimeout(1000);
      // If JS click didn't work, try Playwright native click on first search result
      const chatOpened = await page.$('div[contenteditable="true"][data-tab="10"]');
      if (!chatOpened) {
        // Try clicking via Playwright locator with text
        await page.locator(`span[title]`).filter({ hasText: target }).first().click({ timeout: 5000 });
      }
      await page.waitForTimeout(2000);
    }

    // Wait for compose box
    const composeSelector = 'div[contenteditable="true"][data-tab="10"]';
    await page.waitForSelector(composeSelector, { timeout: 15000 });

    // Send file first if provided
    if (filePath && fs.existsSync(filePath)) {
      // Click attach button
      await page.click('[data-testid="attach-menu-plus"]', { timeout: 5000 }).catch(() => {
        // Try alternative attach button
        return page.click('span[data-icon="plus"]', { timeout: 5000 });
      });
      await page.waitForTimeout(1000);

      // Click document option
      await page.click('[data-testid="mi-attach-document"]', { timeout: 5000 }).catch(() => {
        return page.click('button[aria-label*="Belge"]', { timeout: 5000 }).catch(() => {
          return page.click('button[aria-label*="Document"]', { timeout: 5000 });
        });
      });
      await page.waitForTimeout(1000);

      // Upload file
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(filePath);
        await page.waitForTimeout(2000);

        // Add caption (message) if there's an input
        const captionInput = await page.$('div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]');
        if (captionInput) {
          await captionInput.click();
          await page.waitForTimeout(300);
          // Type message as caption
          await page.evaluate((msg) => {
            const el = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                        document.querySelector('footer div[contenteditable="true"]');
            if (el) {
              (el as HTMLElement).focus();
              document.execCommand("insertText", false, msg);
            }
          }, message);
          await page.waitForTimeout(500);
        }

        // Click send
        await clickSend(page);
        await page.waitForTimeout(2000);
        return { ok: true };
      }
    }

    // Type message in compose box
    await page.click(composeSelector);
    await page.waitForTimeout(300);

    // Use evaluate for multiline support
    await page.evaluate((msg) => {
      const el = document.querySelector('div[contenteditable="true"][data-tab="10"]') as HTMLElement;
      if (el) {
        el.focus();
        const lines = msg.split("\n");
        for (let i = 0; i < lines.length; i++) {
          document.execCommand("insertText", false, lines[i]);
          if (i < lines.length - 1) {
            el.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", code: "Enter", shiftKey: true, bubbles: true })
            );
          }
        }
      }
    }, message);

    await page.waitForTimeout(1000);

    // Click send
    await clickSend(page);
    await page.waitForTimeout(2000);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function clickSend(page: Page): Promise<void> {
  const selectors = [
    'button[aria-label="Gönder"]',
    'button[aria-label="Send"]',
    '[data-testid="compose-btn-send"]',
    'span[data-icon="send"]',
  ];

  for (const sel of selectors) {
    try {
      await page.click(sel, { timeout: 3000 });
      return;
    } catch {
      continue;
    }
  }

  // Fallback: press Enter
  await page.keyboard.press("Enter");
}

export async function destroy(): Promise<void> {
  if (g.__waPage && !g.__waPage.isClosed()) {
    await g.__waPage.close().catch(() => {});
  }
  g.__waPage = null;

  // Don't close context — keep session for next time
  g.__waReady = false;
  g.__waQr = null;
  g.__waInitializing = false;
}
