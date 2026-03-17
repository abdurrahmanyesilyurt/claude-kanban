import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  closeSession,
  navigate,
  screenshot,
  click,
  fill,
  getText,
  evaluate,
  getPageInfo,
  selectOption,
  waitForSelector,
  getElements,
  listSessions,
} from "@/lib/browser-service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, sessionId, ...params } = body;

    switch (action) {
      case "create": {
        const id = sessionId || uuidv4();
        const result = await createSession(id, params.url);
        return NextResponse.json(result);
      }
      case "close": {
        if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
        await closeSession(sessionId);
        return NextResponse.json({ ok: true });
      }
      case "navigate": {
        if (!sessionId || !params.url) return NextResponse.json({ error: "sessionId and url required" }, { status: 400 });
        const result = await navigate(sessionId, params.url);
        return NextResponse.json(result);
      }
      case "screenshot": {
        if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
        const result = await screenshot(sessionId, params.fullPage ?? false);
        return NextResponse.json(result);
      }
      case "click": {
        if (!sessionId || !params.selector) return NextResponse.json({ error: "sessionId and selector required" }, { status: 400 });
        const result = await click(sessionId, params.selector);
        return NextResponse.json(result);
      }
      case "fill": {
        if (!sessionId || !params.selector || params.value === undefined) return NextResponse.json({ error: "sessionId, selector, and value required" }, { status: 400 });
        const result = await fill(sessionId, params.selector, params.value);
        return NextResponse.json(result);
      }
      case "getText": {
        if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
        const result = await getText(sessionId, params.selector);
        return NextResponse.json(result);
      }
      case "evaluate": {
        if (!sessionId || !params.script) return NextResponse.json({ error: "sessionId and script required" }, { status: 400 });
        const result = await evaluate(sessionId, params.script);
        return NextResponse.json(result);
      }
      case "getPageInfo": {
        if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
        const result = await getPageInfo(sessionId);
        return NextResponse.json(result);
      }
      case "selectOption": {
        if (!sessionId || !params.selector || !params.value) return NextResponse.json({ error: "sessionId, selector, and value required" }, { status: 400 });
        const result = await selectOption(sessionId, params.selector, params.value);
        return NextResponse.json(result);
      }
      case "waitForSelector": {
        if (!sessionId || !params.selector) return NextResponse.json({ error: "sessionId and selector required" }, { status: 400 });
        const result = await waitForSelector(sessionId, params.selector, params.timeout);
        return NextResponse.json(result);
      }
      case "getElements": {
        if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
        const result = await getElements(sessionId);
        return NextResponse.json(result);
      }
      case "listSessions": {
        return NextResponse.json({ sessions: listSessions() });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
