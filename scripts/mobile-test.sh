#!/bin/bash
# mobile-test.sh — Lightweight mobile testing helper for Claude workflow agents
# Uses UI Automator XML dumps (tiny) instead of screenshots (huge) by default.
# Screenshots are compressed JPEG only when explicitly requested.
#
# Usage:
#   bash scripts/mobile-test.sh <command> [args...]
#
# Commands:
#   inspect                    — UI hierarchy as text (element list with bounds)
#   inspect-raw                — Raw XML dump
#   tap-text "Login"           — Tap element containing text
#   tap-id "btn_login"         — Tap element by resource-id
#   tap <x> <y>               — Tap coordinates
#   type "hello"               — Type text into focused field
#   clear-and-type "hello"     — Clear current field then type
#   scroll-down                — Scroll down
#   scroll-up                  — Scroll up
#   back                       — Press back button
#   home                       — Press home button
#   check-text "Welcome"       — Check if text exists on screen (returns 0/1)
#   check-id "btn_submit"      — Check if resource-id exists
#   wait-for "text" [timeout]  — Wait until text appears (default 15s)
#   screenshot [name]          — Take compressed JPEG screenshot (only when needed!)
#   screen-text                — Get all visible text on screen
#   app-start <package>        — Start app
#   app-stop <package>         — Force stop app
#   app-clear <package>        — Clear app data
#   logcat [lines]             — Get recent logcat (default 50 lines)
#   logcat-errors [lines]      — Get only error logs
#   info                       — Device info

set -euo pipefail

DEVICE="${MOBILE_TEST_DEVICE:-emulator-5554}"
ADB="adb -s $DEVICE"
DUMP_PATH="/sdcard/window_dump.xml"
SCREENSHOT_DIR="${MOBILE_TEST_SCREENSHOT_DIR:-/tmp/mobile-test}"
SCREENSHOT_QUALITY="${MOBILE_TEST_SCREENSHOT_QUALITY:-40}"
SCREENSHOT_WIDTH="${MOBILE_TEST_SCREENSHOT_WIDTH:-540}"

mkdir -p "$SCREENSHOT_DIR"

# --- Helpers ---

dump_ui() {
    $ADB shell "uiautomator dump $DUMP_PATH" >/dev/null 2>&1
    $ADB shell "cat $DUMP_PATH" 2>/dev/null
}

parse_elements() {
    # Parse XML and output human-readable element list
    # Works with both native (text attr) and Flutter (content-desc) apps
    local xml="$1"
    echo "$xml" | python3 -c "
import sys, re, html

xml = sys.stdin.read()
# Match both self-closing and nodes with children
nodes = re.findall(r'<node\s+([^>]+?)(?:/>|>)', xml)

for node in nodes:
    text = ''
    desc = ''
    rid = ''
    cls = ''
    bounds = ''
    clickable = ''
    enabled = ''
    hint_val = ''
    password = ''

    m = re.search(r'text=\"([^\"]*)\"', node)
    if m: text = html.unescape(m.group(1))

    m = re.search(r'content-desc=\"([^\"]*)\"', node)
    if m: desc = html.unescape(m.group(1))

    m = re.search(r'resource-id=\"([^\"]*)\"', node)
    if m: rid = m.group(1)

    m = re.search(r'class=\"([^\"]*)\"', node)
    if m: cls = m.group(1).split('.')[-1]

    m = re.search(r'bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', node)
    if m: bounds = f'[{m.group(1)},{m.group(2)}][{m.group(3)},{m.group(4)}]'

    m = re.search(r'clickable=\"(true|false)\"', node)
    if m: clickable = m.group(1)

    m = re.search(r'enabled=\"(true|false)\"', node)
    if m: enabled = m.group(1)

    m = re.search(r'hint=\"([^\"]*)\"', node)
    if m: hint_val = m.group(1)

    m = re.search(r'password=\"(true|false)\"', node)
    if m: password = m.group(1)

    # Use content-desc as display text if text is empty (Flutter apps)
    display = text or desc

    # Skip invisible/empty nodes (unless they have hint or rid)
    if not display and not rid and not hint_val:
        continue

    parts = []
    if cls: parts.append(cls)
    if display: parts.append(f'\"{display}\"')
    if hint_val and not display: parts.append(f'hint=\"{hint_val}\"')
    if rid:
        short_id = rid.split('/')[-1] if '/' in rid else rid
        parts.append(f'id={short_id}')
    if password == 'true': parts.append('PASSWORD')
    if clickable == 'true': parts.append('CLICKABLE')
    if enabled == 'false': parts.append('DISABLED')
    parts.append(bounds)

    print('  '.join(parts))
" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "[WARN] python3 parse failed, showing raw xml"
        echo "$xml" | head -100
    fi
}

get_center() {
    # Get center coordinates from bounds string [x1,y1][x2,y2]
    echo "$1" | python3 -c "
import sys, re
bounds = sys.stdin.read().strip()
m = re.search(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
if m:
    x = (int(m.group(1)) + int(m.group(3))) // 2
    y = (int(m.group(2)) + int(m.group(4))) // 2
    print(f'{x} {y}')
else:
    print('ERROR')
"
}

find_by_text() {
    local xml="$1"
    local search_text="$2"
    echo "$xml" | python3 -c "
import sys, re, html

xml = sys.stdin.read()
search = '$search_text'.lower()
nodes = re.findall(r'<node\s+([^>]+)/>', xml)

for node in nodes:
    m_text = re.search(r'text=\"([^\"]*)\"', node)
    m_desc = re.search(r'content-desc=\"([^\"]*)\"', node)

    text = html.unescape(m_text.group(1)).lower() if m_text else ''
    desc = html.unescape(m_desc.group(1)).lower() if m_desc else ''

    if search in text or search in desc:
        m = re.search(r'bounds=\"(\[[^\]]+\]\[[^\]]+\])\"', node)
        if m:
            print(m.group(1))
            sys.exit(0)

# Also try clickable parents that contain the text
for node in nodes:
    m_text = re.search(r'text=\"([^\"]*)\"', node)
    if m_text and search in html.unescape(m_text.group(1)).lower():
        m = re.search(r'bounds=\"(\[[^\]]+\]\[[^\]]+\])\"', node)
        if m:
            print(m.group(1))
            sys.exit(0)

print('NOT_FOUND')
"
}

find_by_id() {
    local xml="$1"
    local search_id="$2"
    echo "$xml" | python3 -c "
import sys, re

xml = sys.stdin.read()
search = '$search_id'
nodes = re.findall(r'<node\s+([^>]+)/>', xml)

for node in nodes:
    m_id = re.search(r'resource-id=\"([^\"]*)\"', node)
    if m_id:
        rid = m_id.group(1)
        short = rid.split('/')[-1] if '/' in rid else rid
        if search == short or search == rid:
            m = re.search(r'bounds=\"(\[[^\]]+\]\[[^\]]+\])\"', node)
            if m:
                print(m.group(1))
                sys.exit(0)

print('NOT_FOUND')
"
}

# --- Commands ---

case "${1:-help}" in
    inspect)
        xml=$(dump_ui)
        echo "=== Screen Elements ==="
        parse_elements "$xml"
        ;;

    inspect-raw)
        dump_ui
        ;;

    tap-text)
        text="${2:?Usage: tap-text \"button text\"}"
        xml=$(dump_ui)
        bounds=$(find_by_text "$xml" "$text")
        if [ "$bounds" = "NOT_FOUND" ]; then
            echo "ERROR: Element with text '$text' not found on screen"
            echo "Available elements:"
            parse_elements "$xml"
            exit 1
        fi
        coords=$(get_center "$bounds")
        x=$(echo $coords | cut -d' ' -f1)
        y=$(echo $coords | cut -d' ' -f2)
        $ADB shell input tap "$x" "$y"
        echo "OK: Tapped '$text' at ($x, $y)"
        ;;

    tap-id)
        id="${2:?Usage: tap-id \"resource_id\"}"
        xml=$(dump_ui)
        bounds=$(find_by_id "$xml" "$id")
        if [ "$bounds" = "NOT_FOUND" ]; then
            echo "ERROR: Element with id '$id' not found"
            exit 1
        fi
        coords=$(get_center "$bounds")
        x=$(echo $coords | cut -d' ' -f1)
        y=$(echo $coords | cut -d' ' -f2)
        $ADB shell input tap "$x" "$y"
        echo "OK: Tapped id=$id at ($x, $y)"
        ;;

    tap)
        x="${2:?Usage: tap <x> <y>}"
        y="${3:?Usage: tap <x> <y>}"
        $ADB shell input tap "$x" "$y"
        echo "OK: Tapped ($x, $y)"
        ;;

    type)
        text="${2:?Usage: type \"text\"}"
        # Escape special characters for adb
        escaped=$(echo "$text" | sed 's/ /%s/g; s/&/\\\&/g; s/</\\\</g; s/>/\\\>/g; s/(/\\(/g; s/)/\\)/g; s/|/\\|/g; s/;/\\;/g')
        $ADB shell input text "$escaped"
        echo "OK: Typed '$text'"
        ;;

    clear-and-type)
        text="${2:?Usage: clear-and-type \"text\"}"
        # Select all and delete, then type
        $ADB shell input keyevent KEYCODE_MOVE_HOME
        $ADB shell input keyevent --longpress KEYCODE_DEL 2>/dev/null || $ADB shell input keyevent 67
        sleep 0.3
        # Select all with Ctrl+A then delete
        $ADB shell input keyevent 29 --longpress 2>/dev/null || true
        $ADB shell input keycombination 113 29 2>/dev/null || true  # Ctrl+A
        $ADB shell input keyevent 67  # Delete
        sleep 0.2
        escaped=$(echo "$text" | sed 's/ /%s/g')
        $ADB shell input text "$escaped"
        echo "OK: Cleared and typed '$text'"
        ;;

    scroll-down)
        $ADB shell input swipe 540 1500 540 500 300
        echo "OK: Scrolled down"
        ;;

    scroll-up)
        $ADB shell input swipe 540 500 540 1500 300
        echo "OK: Scrolled up"
        ;;

    back)
        $ADB shell input keyevent 4
        echo "OK: Back pressed"
        ;;

    home)
        $ADB shell input keyevent 3
        echo "OK: Home pressed"
        ;;

    check-text)
        text="${2:?Usage: check-text \"text\"}"
        xml=$(dump_ui)
        bounds=$(find_by_text "$xml" "$text")
        if [ "$bounds" = "NOT_FOUND" ]; then
            echo "NOT_FOUND: '$text' is not on screen"
            exit 1
        else
            echo "FOUND: '$text' at $bounds"
            exit 0
        fi
        ;;

    check-id)
        id="${2:?Usage: check-id \"resource_id\"}"
        xml=$(dump_ui)
        bounds=$(find_by_id "$xml" "$id")
        if [ "$bounds" = "NOT_FOUND" ]; then
            echo "NOT_FOUND: id=$id"
            exit 1
        else
            echo "FOUND: id=$id at $bounds"
            exit 0
        fi
        ;;

    wait-for)
        text="${2:?Usage: wait-for \"text\" [timeout_seconds]}"
        timeout="${3:-15}"
        elapsed=0
        while [ $elapsed -lt $timeout ]; do
            xml=$(dump_ui)
            bounds=$(find_by_text "$xml" "$text")
            if [ "$bounds" != "NOT_FOUND" ]; then
                echo "FOUND: '$text' appeared after ${elapsed}s"
                exit 0
            fi
            sleep 2
            elapsed=$((elapsed + 2))
        done
        echo "TIMEOUT: '$text' did not appear within ${timeout}s"
        exit 1
        ;;

    screenshot)
        name="${2:-screen-$(date +%H%M%S)}"
        raw_file="$SCREENSHOT_DIR/${name}_raw.png"
        final_file="$SCREENSHOT_DIR/${name}.jpg"

        $ADB exec-out screencap -p > "$raw_file"

        # Try to compress with ImageMagick/ffmpeg, fallback to raw PNG
        if command -v convert &>/dev/null; then
            convert "$raw_file" -resize "${SCREENSHOT_WIDTH}x" -quality "$SCREENSHOT_QUALITY" "$final_file"
            rm -f "$raw_file"
            size=$(stat -f%z "$final_file" 2>/dev/null || stat -c%s "$final_file" 2>/dev/null || echo "?")
            echo "OK: $final_file (${size} bytes, compressed JPEG)"
        elif command -v ffmpeg &>/dev/null; then
            ffmpeg -y -i "$raw_file" -vf "scale=${SCREENSHOT_WIDTH}:-1" -q:v 8 "$final_file" 2>/dev/null
            rm -f "$raw_file"
            echo "OK: $final_file (compressed JPEG)"
        else
            # No compression tool — use raw but warn
            final_file="$SCREENSHOT_DIR/${name}.png"
            mv "$raw_file" "$final_file"
            echo "WARN: No ImageMagick/ffmpeg — saved uncompressed: $final_file"
            echo "HINT: Install ImageMagick for smaller screenshots"
        fi
        echo "PATH: $final_file"
        ;;

    screen-text)
        xml=$(dump_ui)
        echo "$xml" | python3 -c "
import sys, re, html
xml = sys.stdin.read()
seen = set()
# Get both text and content-desc (Flutter uses content-desc)
for attr in ['text', 'content-desc']:
    for m in re.finditer(attr + r'=\"([^\"]+)\"', xml):
        decoded = html.unescape(m.group(1))
        if decoded and decoded not in seen:
            seen.add(decoded)
            print(decoded)
# Also show hints
for m in re.finditer(r'hint=\"([^\"]+)\"', xml):
    decoded = html.unescape(m.group(1))
    if decoded and decoded not in seen:
        seen.add(decoded)
        print(f'[hint] {decoded}')
"
        ;;

    app-start)
        package="${2:?Usage: app-start com.example.app}"
        $ADB shell monkey -p "$package" -c android.intent.category.LAUNCHER 1 2>/dev/null
        echo "OK: Started $package"
        ;;

    app-stop)
        package="${2:?Usage: app-stop com.example.app}"
        $ADB shell am force-stop "$package"
        echo "OK: Stopped $package"
        ;;

    app-clear)
        package="${2:?Usage: app-clear com.example.app}"
        $ADB shell pm clear "$package"
        echo "OK: Cleared data for $package"
        ;;

    logcat)
        lines="${2:-50}"
        $ADB logcat -d -t "$lines" 2>/dev/null | tail -"$lines"
        ;;

    logcat-errors)
        lines="${2:-30}"
        $ADB logcat -d *:E 2>/dev/null | tail -"$lines"
        ;;

    info)
        echo "=== Device Info ==="
        echo "Device: $DEVICE"
        echo "Model: $($ADB shell getprop ro.product.model 2>/dev/null)"
        echo "Android: $($ADB shell getprop ro.build.version.release 2>/dev/null)"
        echo "SDK: $($ADB shell getprop ro.build.version.sdk 2>/dev/null)"
        echo "Screen: $($ADB shell wm size 2>/dev/null | tail -1)"
        echo "Density: $($ADB shell wm density 2>/dev/null | tail -1)"
        ;;

    help|*)
        echo "mobile-test.sh — Lightweight mobile testing for Claude agents"
        echo ""
        echo "Commands:"
        echo "  inspect              UI elements (XML-based, lightweight)"
        echo "  tap-text \"Login\"     Tap by visible text"
        echo "  tap-id \"btn_login\"   Tap by resource-id"
        echo "  tap <x> <y>         Tap coordinates"
        echo "  type \"text\"          Type text"
        echo "  clear-and-type \"t\"   Clear field + type"
        echo "  scroll-down/up       Scroll"
        echo "  back / home          Navigation"
        echo "  check-text \"text\"    Verify text exists"
        echo "  check-id \"id\"        Verify element exists"
        echo "  wait-for \"text\" [s]  Wait for text (default 15s)"
        echo "  screenshot [name]    Compressed screenshot (use sparingly!)"
        echo "  screen-text          All visible text"
        echo "  app-start <pkg>      Launch app"
        echo "  app-stop <pkg>       Force stop"
        echo "  logcat [n]           Recent logs"
        echo "  logcat-errors [n]    Error logs only"
        echo "  info                 Device info"
        ;;
esac
