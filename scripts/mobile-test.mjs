#!/usr/bin/env node
/**
 * mobile-test.mjs — Lightweight mobile testing helper for Claude workflow agents
 * Uses UI Automator XML dumps (tiny) instead of screenshots (huge) by default.
 *
 * Usage: node scripts/mobile-test.mjs <command> [args...]
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const DEVICE = process.env.MOBILE_TEST_DEVICE || "emulator-5554";
const ADB = `adb -s ${DEVICE}`;
const DUMP_PATH = "/sdcard/window_dump.xml";
const SCREENSHOT_DIR = process.env.MOBILE_TEST_SCREENSHOT_DIR || resolve(process.env.TEMP || "/tmp", "mobile-test");

try { mkdirSync(SCREENSHOT_DIR, { recursive: true }); } catch {}

// --- Helpers ---

function adb(cmd, opts = {}) {
  try {
    return execSync(`${ADB} ${cmd}`, {
      encoding: "utf-8",
      timeout: opts.timeout || 15000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      ...opts
    }).trim();
  } catch (e) {
    if (opts.silent) return "";
    throw e;
  }
}

function dumpUI() {
  adb(`shell "uiautomator dump ${DUMP_PATH}"`, { silent: true });
  return adb(`shell "cat ${DUMP_PATH}"`);
}

function parseNodes(xml) {
  const nodes = [];
  const re = /<node\s+([^>]+?)(?:\/>|>)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const r = new RegExp(`${name}="([^"]*)"`, "");
      const match = r.exec(attrs);
      return match ? match[1] : "";
    };
    nodes.push({
      text: get("text"),
      desc: get("content-desc"),
      rid: get("resource-id"),
      cls: get("class").split(".").pop(),
      bounds: get("bounds"),
      clickable: get("clickable") === "true",
      enabled: get("enabled") !== "false",
      password: get("password") === "true",
      hint: get("hint"),
      scrollable: get("scrollable") === "true",
    });
  }
  return nodes;
}

function parseBounds(boundsStr) {
  const m = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const [, x1, y1, x2, y2] = m.map(Number);
  return { x1, y1, x2, y2, cx: Math.floor((x1 + x2) / 2), cy: Math.floor((y1 + y2) / 2) };
}

function findByText(nodes, search) {
  const s = search.toLowerCase();
  for (const n of nodes) {
    const display = (n.text || n.desc || "").toLowerCase();
    if (display.includes(s) && n.bounds) return n;
  }
  return null;
}

function findById(nodes, id) {
  for (const n of nodes) {
    const shortId = n.rid.includes("/") ? n.rid.split("/").pop() : n.rid;
    if (shortId === id || n.rid === id) return n;
  }
  return null;
}

function formatElements(nodes) {
  const lines = [];
  for (const n of nodes) {
    const display = n.text || n.desc;
    if (!display && !n.rid && !n.hint) continue;

    const parts = [];
    if (n.cls) parts.push(n.cls);
    if (display) parts.push(`"${display}"`);
    if (n.hint && !display) parts.push(`hint="${n.hint}"`);
    if (n.rid) {
      const short = n.rid.includes("/") ? n.rid.split("/").pop() : n.rid;
      parts.push(`id=${short}`);
    }
    if (n.password) parts.push("PASSWORD");
    if (n.clickable) parts.push("CLICKABLE");
    if (n.scrollable) parts.push("SCROLLABLE");
    if (!n.enabled) parts.push("DISABLED");
    if (n.bounds) parts.push(n.bounds);
    lines.push(parts.join("  "));
  }
  return lines.join("\n");
}

// --- Commands ---

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "inspect": {
    const xml = dumpUI();
    const nodes = parseNodes(xml);
    console.log("=== Screen Elements ===");
    console.log(formatElements(nodes));
    break;
  }

  case "inspect-raw": {
    console.log(dumpUI());
    break;
  }

  case "tap-text": {
    const text = args[0];
    if (!text) { console.error("Usage: tap-text \"button text\""); process.exit(1); }
    const xml = dumpUI();
    const nodes = parseNodes(xml);
    const node = findByText(nodes, text);
    if (!node) {
      console.error(`ERROR: Element with text '${text}' not found on screen`);
      console.log("Available elements:");
      console.log(formatElements(nodes));
      process.exit(1);
    }
    const b = parseBounds(node.bounds);
    adb(`shell input tap ${b.cx} ${b.cy}`);
    console.log(`OK: Tapped '${node.text || node.desc}' at (${b.cx}, ${b.cy})`);
    break;
  }

  case "tap-id": {
    const id = args[0];
    if (!id) { console.error("Usage: tap-id \"resource_id\""); process.exit(1); }
    const xml = dumpUI();
    const nodes = parseNodes(xml);
    const node = findById(nodes, id);
    if (!node) {
      console.error(`ERROR: Element with id '${id}' not found`);
      process.exit(1);
    }
    const b = parseBounds(node.bounds);
    adb(`shell input tap ${b.cx} ${b.cy}`);
    console.log(`OK: Tapped id=${id} at (${b.cx}, ${b.cy})`);
    break;
  }

  case "tap": {
    const [x, y] = args;
    if (!x || !y) { console.error("Usage: tap <x> <y>"); process.exit(1); }
    adb(`shell input tap ${x} ${y}`);
    console.log(`OK: Tapped (${x}, ${y})`);
    break;
  }

  case "type": {
    const text = args[0];
    if (!text) { console.error("Usage: type \"text\""); process.exit(1); }
    const escaped = text.replace(/ /g, "%s").replace(/&/g, "\\&").replace(/</g, "\\<").replace(/>/g, "\\>").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\|/g, "\\|").replace(/;/g, "\\;");
    adb(`shell input text "${escaped}"`);
    console.log(`OK: Typed '${text}'`);
    break;
  }

  case "clear-and-type": {
    const text = args[0];
    if (!text) { console.error("Usage: clear-and-type \"text\""); process.exit(1); }
    // Triple-tap to select all, then delete
    adb("shell input keyevent 29 --longpress", { silent: true });
    adb("shell input keyevent 67");
    // Also try Ctrl+A
    adb("shell input keycombination 113 29", { silent: true });
    adb("shell input keyevent 67");
    const escaped = text.replace(/ /g, "%s");
    adb(`shell input text "${escaped}"`);
    console.log(`OK: Cleared and typed '${text}'`);
    break;
  }

  case "scroll-down": {
    adb("shell input swipe 540 1500 540 500 300");
    console.log("OK: Scrolled down");
    break;
  }

  case "scroll-up": {
    adb("shell input swipe 540 500 540 1500 300");
    console.log("OK: Scrolled up");
    break;
  }

  case "back": {
    adb("shell input keyevent 4");
    console.log("OK: Back pressed");
    break;
  }

  case "home": {
    adb("shell input keyevent 3");
    console.log("OK: Home pressed");
    break;
  }

  case "check-text": {
    const text = args[0];
    if (!text) { console.error("Usage: check-text \"text\""); process.exit(1); }
    const xml = dumpUI();
    const nodes = parseNodes(xml);
    const node = findByText(nodes, text);
    if (!node) {
      console.log(`NOT_FOUND: '${text}' is not on screen`);
      process.exit(1);
    }
    console.log(`FOUND: '${text}' at ${node.bounds}`);
    break;
  }

  case "check-id": {
    const id = args[0];
    if (!id) { console.error("Usage: check-id \"resource_id\""); process.exit(1); }
    const xml = dumpUI();
    const nodes = parseNodes(xml);
    const node = findById(nodes, id);
    if (!node) {
      console.log(`NOT_FOUND: id=${id}`);
      process.exit(1);
    }
    console.log(`FOUND: id=${id} at ${node.bounds}`);
    break;
  }

  case "wait-for": {
    const text = args[0];
    const timeout = parseInt(args[1] || "15", 10);
    if (!text) { console.error("Usage: wait-for \"text\" [timeout_seconds]"); process.exit(1); }
    let elapsed = 0;
    while (elapsed < timeout) {
      const xml = dumpUI();
      const nodes = parseNodes(xml);
      const node = findByText(nodes, text);
      if (node) {
        console.log(`FOUND: '${text}' appeared after ${elapsed}s`);
        process.exit(0);
      }
      execSync("timeout /t 2 >nul 2>&1 || sleep 2", { windowsHide: true, stdio: "ignore" });
      elapsed += 2;
    }
    console.log(`TIMEOUT: '${text}' did not appear within ${timeout}s`);
    process.exit(1);
  }

  case "screenshot": {
    const name = args[0] || `screen-${Date.now()}`;
    const rawFile = resolve(SCREENSHOT_DIR, `${name}.png`);
    try {
      const data = execSync(`${ADB} exec-out screencap -p`, { maxBuffer: 20 * 1024 * 1024 });
      writeFileSync(rawFile, data);
      console.log(`OK: ${rawFile}`);
      console.log(`PATH: ${rawFile}`);
      console.log(`WARN: Screenshot is large PNG. Use 'inspect' for routine checks!`);
    } catch (e) {
      console.error(`ERROR: Screenshot failed: ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case "screen-text": {
    const xml = dumpUI();
    const seen = new Set();
    const patterns = [/text="([^"]+)"/g, /content-desc="([^"]+)"/g, /hint="([^"]+)"/g];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(xml)) !== null) {
        const val = m[1];
        if (val && !seen.has(val)) {
          seen.add(val);
          console.log(val);
        }
      }
    }
    break;
  }

  case "app-start": {
    const pkg = args[0];
    if (!pkg) { console.error("Usage: app-start com.example.app"); process.exit(1); }
    adb(`shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, { silent: true });
    console.log(`OK: Started ${pkg}`);
    break;
  }

  case "app-stop": {
    const pkg = args[0];
    if (!pkg) { console.error("Usage: app-stop com.example.app"); process.exit(1); }
    adb(`shell am force-stop ${pkg}`);
    console.log(`OK: Stopped ${pkg}`);
    break;
  }

  case "app-clear": {
    const pkg = args[0];
    if (!pkg) { console.error("Usage: app-clear com.example.app"); process.exit(1); }
    adb(`shell pm clear ${pkg}`);
    console.log(`OK: Cleared data for ${pkg}`);
    break;
  }

  case "logcat": {
    const lines = args[0] || "50";
    const output = adb(`logcat -d -t ${lines}`, { timeout: 10000 });
    console.log(output);
    break;
  }

  case "logcat-errors": {
    const lines = args[0] || "30";
    const output = adb(`logcat -d *:E`, { timeout: 10000, silent: true });
    const logLines = output.split("\n");
    console.log(logLines.slice(-parseInt(lines)).join("\n"));
    break;
  }

  case "info": {
    console.log("=== Device Info ===");
    console.log(`Device: ${DEVICE}`);
    console.log(`Model: ${adb('shell getprop ro.product.model', { silent: true })}`);
    console.log(`Android: ${adb('shell getprop ro.build.version.release', { silent: true })}`);
    console.log(`SDK: ${adb('shell getprop ro.build.version.sdk', { silent: true })}`);
    console.log(`Screen: ${adb('shell wm size', { silent: true })}`);
    break;
  }

  case "help":
  default:
    console.log(`mobile-test.mjs — Lightweight mobile testing for Claude agents

Commands:
  inspect              UI elements list (XML-based, lightweight!)
  inspect-raw          Raw XML dump
  tap-text "Login"     Tap by visible text / content-desc
  tap-id "btn_login"   Tap by resource-id
  tap <x> <y>         Tap coordinates
  type "text"          Type text
  clear-and-type "t"   Clear field + type
  scroll-down/up       Scroll
  back / home          Navigation
  check-text "text"    Verify text exists (exit 0/1)
  check-id "id"        Verify element exists
  wait-for "text" [s]  Wait for text (default 15s)
  screenshot [name]    Save screenshot (use sparingly!)
  screen-text          All visible text on screen
  app-start <pkg>      Launch app
  app-stop <pkg>       Force stop
  app-clear <pkg>      Clear app data
  logcat [n]           Recent logs (default 50)
  logcat-errors [n]    Error logs only
  info                 Device info`);
    break;
}
