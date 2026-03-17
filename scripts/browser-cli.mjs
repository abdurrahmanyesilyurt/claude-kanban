#!/usr/bin/env node
/**
 * Browser CLI — Agent'ın Bash üzerinden tarayıcıyı kontrol etmesini sağlar.
 * Next.js sunucusundaki /api/browser endpoint'ini çağırır.
 *
 * Kullanım:
 *   node scripts/browser-cli.mjs open <url>
 *   node scripts/browser-cli.mjs screenshot [--session <id>]
 *   node scripts/browser-cli.mjs click <selector> [--session <id>]
 *   node scripts/browser-cli.mjs fill <selector> <value> [--session <id>]
 *   node scripts/browser-cli.mjs navigate <url> [--session <id>]
 *   node scripts/browser-cli.mjs get-text [<selector>] [--session <id>]
 *   node scripts/browser-cli.mjs get-elements [--session <id>]
 *   node scripts/browser-cli.mjs get-page-info [--session <id>]
 *   node scripts/browser-cli.mjs evaluate <script> [--session <id>]
 *   node scripts/browser-cli.mjs select-option <selector> <value> [--session <id>]
 *   node scripts/browser-cli.mjs wait-for <selector> [--timeout <ms>] [--session <id>]
 *   node scripts/browser-cli.mjs close [--session <id>]
 *   node scripts/browser-cli.mjs list-sessions
 */

const API_BASE = process.env.BROWSER_API_URL || "http://localhost:3000/api/browser";

// Parse args
const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  console.error("Kullanım: node scripts/browser-cli.mjs <command> [args...]");
  console.error("Komutlar: open, screenshot, click, fill, navigate, get-text, get-elements, get-page-info, evaluate, select-option, wait-for, close, list-sessions");
  process.exit(1);
}

// Helper: extract --session <id> from args
function extractFlag(flag, argList) {
  const idx = argList.indexOf(flag);
  if (idx === -1) return { value: null, rest: argList };
  const value = argList[idx + 1] || null;
  const rest = [...argList.slice(0, idx), ...argList.slice(idx + 2)];
  return { value, rest };
}

// Session file to persist active session ID between calls
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const SESSION_FILE = join(process.cwd(), ".browser-session");

function getActiveSession() {
  try {
    if (existsSync(SESSION_FILE)) {
      return readFileSync(SESSION_FILE, "utf-8").trim();
    }
  } catch { /* ignore */ }
  return null;
}

function setActiveSession(id) {
  try {
    writeFileSync(SESSION_FILE, id, "utf-8");
  } catch { /* ignore */ }
}

async function callAPI(body) {
  try {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`Hata: ${data.error || "Bilinmeyen hata"}`);
      process.exit(1);
    }
    return data;
  } catch (err) {
    console.error(`API bağlantı hatası: ${err.message}`);
    console.error("Next.js sunucusunun çalıştığından emin olun (npm run dev)");
    process.exit(1);
  }
}

// Parse session flag from remaining args
let restArgs = args.slice(1);
const sessionExtract = extractFlag("--session", restArgs);
let sessionId = sessionExtract.value;
restArgs = sessionExtract.rest;

// If no explicit session, use saved session
if (!sessionId) {
  sessionId = getActiveSession();
}

async function main() {
  switch (command) {
    case "open": {
      const url = restArgs[0];
      if (!url) { console.error("URL gerekli: node browser-cli.mjs open <url>"); process.exit(1); }
      const result = await callAPI({ action: "create", url });
      setActiveSession(result.sessionId);
      console.log(`Tarayıcı açıldı. Session: ${result.sessionId}`);
      // Automatically take screenshot
      const ss = await callAPI({ action: "screenshot", sessionId: result.sessionId });
      console.log(`Screenshot: ${ss.url}`);
      // Get page info
      const info = await callAPI({ action: "getPageInfo", sessionId: result.sessionId });
      console.log(`Sayfa: ${info.title}`);
      console.log(`URL: ${info.url}`);
      break;
    }

    case "screenshot": {
      if (!sessionId) { console.error("Aktif oturum yok. Önce 'open' komutu ile sayfa açın."); process.exit(1); }
      const result = await callAPI({ action: "screenshot", sessionId, fullPage: restArgs.includes("--full") });
      console.log(`Screenshot kaydedildi: ${result.url}`);
      break;
    }

    case "click": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      const selector = restArgs[0];
      if (!selector) { console.error("Selector gerekli: node browser-cli.mjs click <selector>"); process.exit(1); }
      await callAPI({ action: "click", sessionId, selector });
      console.log(`Tıklandı: ${selector}`);
      // Auto screenshot after click
      const ss = await callAPI({ action: "screenshot", sessionId });
      console.log(`Screenshot: ${ss.url}`);
      // Get updated page info
      const info = await callAPI({ action: "getPageInfo", sessionId });
      console.log(`Sayfa: ${info.title} — ${info.url}`);
      break;
    }

    case "fill": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      const selector = restArgs[0];
      const value = restArgs.slice(1).join(" ");
      if (!selector || !value) { console.error("Selector ve değer gerekli: node browser-cli.mjs fill <selector> <value>"); process.exit(1); }
      await callAPI({ action: "fill", sessionId, selector, value });
      console.log(`Dolduruldu: ${selector} = "${value}"`);
      const ss = await callAPI({ action: "screenshot", sessionId });
      console.log(`Screenshot: ${ss.url}`);
      break;
    }

    case "navigate": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      const url = restArgs[0];
      if (!url) { console.error("URL gerekli"); process.exit(1); }
      const result = await callAPI({ action: "navigate", sessionId, url });
      console.log(`Navigasyon: ${result.title}`);
      console.log(`URL: ${result.url}`);
      const ss = await callAPI({ action: "screenshot", sessionId });
      console.log(`Screenshot: ${ss.url}`);
      break;
    }

    case "get-text": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      const selector = restArgs[0] || undefined;
      const result = await callAPI({ action: "getText", sessionId, selector });
      console.log(result.text);
      break;
    }

    case "get-elements": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      const result = await callAPI({ action: "getElements", sessionId });
      console.log(`${result.elements.length} interaktif element bulundu:\n`);
      for (const el of result.elements) {
        const label = el.text || el.placeholder || el.selector;
        console.log(`  [${el.tag}${el.type ? `:${el.type}` : ""}] ${label}  →  selector: "${el.selector}"`);
      }
      break;
    }

    case "get-page-info": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      const result = await callAPI({ action: "getPageInfo", sessionId });
      console.log(`Başlık: ${result.title}`);
      console.log(`URL: ${result.url}`);
      break;
    }

    case "evaluate": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      const script = restArgs.join(" ");
      if (!script) { console.error("Script gerekli"); process.exit(1); }
      const result = await callAPI({ action: "evaluate", sessionId, script });
      console.log(JSON.stringify(result.result, null, 2));
      break;
    }

    case "select-option": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      const selector = restArgs[0];
      const value = restArgs[1];
      if (!selector || !value) { console.error("Selector ve değer gerekli"); process.exit(1); }
      await callAPI({ action: "selectOption", sessionId, selector, value });
      console.log(`Seçildi: ${selector} = "${value}"`);
      const ss = await callAPI({ action: "screenshot", sessionId });
      console.log(`Screenshot: ${ss.url}`);
      break;
    }

    case "wait-for": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      const selector = restArgs[0];
      if (!selector) { console.error("Selector gerekli"); process.exit(1); }
      const timeoutExtract = extractFlag("--timeout", restArgs.slice(1));
      const timeout = timeoutExtract.value ? parseInt(timeoutExtract.value) : 10000;
      const result = await callAPI({ action: "waitForSelector", sessionId, selector, timeout });
      console.log(result.found ? `Element bulundu: ${selector}` : `Element bulunamadı: ${selector} (${timeout}ms timeout)`);
      break;
    }

    case "close": {
      if (!sessionId) { console.error("Aktif oturum yok."); process.exit(1); }
      await callAPI({ action: "close", sessionId });
      console.log("Tarayıcı oturumu kapatıldı.");
      try { writeFileSync(SESSION_FILE, "", "utf-8"); } catch { /* ignore */ }
      break;
    }

    case "list-sessions": {
      const result = await callAPI({ action: "listSessions" });
      if (result.sessions.length === 0) {
        console.log("Aktif oturum yok.");
      } else {
        console.log(`Aktif oturumlar: ${result.sessions.join(", ")}`);
      }
      break;
    }

    default:
      console.error(`Bilinmeyen komut: ${command}`);
      console.error("Komutlar: open, screenshot, click, fill, navigate, get-text, get-elements, get-page-info, evaluate, select-option, wait-for, close, list-sessions");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Beklenmeyen hata: ${err.message}`);
  process.exit(1);
});
