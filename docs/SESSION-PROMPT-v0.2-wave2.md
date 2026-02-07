# Aether OS v0.2 — Wave 2+ Continuation Prompt

**Use this prompt to continue v0.2 development in a new Claude Code session.**

---

## Prompt

```
You are working on Aether OS, an AI-native operating system built as a TypeScript monorepo:
- shared/ — types and protocol definitions
- kernel/ — backend subsystems (ProcessManager, VirtualFS, PTYManager, ContainerManager, BrowserManager, etc.)
- runtime/ — agent loop, LLM providers, tools
- server/ — HTTP + WebSocket server
- components/ — React UI (apps in components/apps/, OS chrome in components/os/)

WHAT'S ALREADY DONE (Wave 1 — merged):
- A1: BrowserManager — Playwright-based kernel browser subsystem, fully implemented with 57 integration tests
- A3: Monaco Code Editor — @monaco-editor/react with multi-tab, file tree sidebar, language auto-detection (18 languages), 22 component tests
- B2: System Monitor App — Real-time SVG charts (CPU/memory/disk/network), /api/system/stats endpoint, 2s polling, per-agent resource breakdown, 10 tests
- E1: Agent Browser Tools — browse_web upgraded to Chromium (with HTTP fallback), added screenshot_page, click_element, type_text, rm, stat, mv, cp tools
- Test suite: 304 tests across 16 suites, all passing

CURRENT STATE:
- Branch: claude/add-playwright-browser-manager-fc1JK (or create a new branch)
- All dependencies installed (run `npm install --legacy-peer-deps` if needed)
- Native deps: `cd kernel && npm install --legacy-peer-deps` for better-sqlite3, node-pty, playwright

YOUR TASK: Implement the remaining v0.2 features. Work in parallel where possible.

Reference docs/SESSION-PROMPTS-v0.2.md for full detailed specs of each feature.
Reference docs/TODO.md for the complete checklist.

WAVE 2 — No dependencies, can run in parallel:

1. **B1: Notification Center** (components/os/NotificationCenter.tsx)
   - Toast notifications (top-right, auto-dismiss, info/success/warning/error types)
   - Bell icon in menu bar with unread badge
   - Notification history panel (dropdown from bell)
   - NotificationProvider React context + useNotifications() hook
   - Wire to kernel events: agent completed/failed/needs-approval, kernel connected/disconnected
   - Persist last 100 notifications to localStorage

2. **D1: Keyboard Shortcuts** (services/shortcutManager.ts + components/os/ShortcutOverlay.tsx)
   - Note: ShortcutOverlay.tsx and shortcutManager.ts already exist — review and enhance them
   - Ensure global shortcuts work: Cmd+K (SmartBar), Cmd+/ (overlay), Cmd+Q/W (close), Cmd+M (minimize), Cmd+Tab (cycle windows), Cmd+1-9 (dock apps), Cmd+N (new terminal), Cmd+, (settings)
   - App-specific shortcut scopes
   - useShortcut() hook for per-component registration

3. **F1: Raw File Serving** (server/src/index.ts + kernel/src/VirtualFS.ts)
   - GET /api/fs/raw?path=/path — serves binary files with correct MIME types
   - Add readFileRaw() to VirtualFS returning Buffer
   - Support HTTP Range requests for audio/video seeking
   - MIME mapping (mp3, wav, png, jpg, pdf, mp4, etc.)
   - Path traversal protection, authentication required

4. **A2: BrowserApp UI** (components/apps/BrowserApp.tsx)
   - Replace iframe approach with real browser connected to kernel BrowserManager
   - Tab bar (multiple browser sessions), navigation chrome (back/forward/reload/URL bar)
   - Page viewport renders screenshots from screencast as <canvas>
   - Forward mouse/keyboard events to kernel browser session
   - Dual-mode: real Chromium when kernel connected, iframe fallback when not

WAVE 3 — Depends on F1 for binary file access:

5. **B3: Music/Audio Player** (components/apps/MusicApp.tsx)
   - HTML5 audio with /api/fs/raw for file streaming
   - Play/pause/seek/volume, shuffle/repeat
   - File browser for kernel FS audio files
   - Web Audio API visualizer
   - TTS tab using browser speechSynthesis

6. **B4: PDF Viewer** (components/apps/DocumentsApp.tsx)
   - pdfjs-dist for rendering PDF pages to canvas
   - Page navigation, zoom, text layer for copy/select
   - Search within document, thumbnail sidebar
   - AI summarization via LLM

7. **C1: Spreadsheet** (components/apps/SheetsApp.tsx)
   - Note: SheetsApp.tsx already exists — review and enhance
   - Add formula engine: SUM, AVERAGE, COUNT, MIN, MAX, IF
   - Virtual-scrolled grid (1000 rows), cell formatting
   - CSV import/export, save/load JSON to kernel FS

8. **C3: Markdown Writer** (components/apps/WriterApp.tsx)
   - Note: WriterApp.tsx already exists — review and enhance
   - Split view with live markdown preview
   - Lightweight markdown-to-HTML converter
   - Toolbar for formatting, file ops to kernel FS
   - AI writing assist via LLM

WAVE 4:

9. **C2: Drawing Canvas** (components/apps/CanvasApp.tsx)
   - Note: CanvasApp.tsx already exists — review and enhance
   - Object-based drawing (pen, line, rectangle, circle, arrow, text)
   - Select/move/resize/delete objects, undo/redo
   - Export as PNG/SVG, save/load to kernel FS
   - Infinite canvas with pan/zoom

10. **D2: Multi-Desktop Workspaces** (components/os/WorkspaceSwitcher.tsx)
    - Note: WorkspaceSwitcher.tsx already exists — review and enhance
    - 3+ virtual workspaces with per-workspace window sets
    - Ctrl+Left/Right to switch, dots in menu bar
    - Move windows between workspaces
    - Overview mode (Ctrl+Up)

11. **D3: Light Theme + Theme System**
    - CSS custom properties for theme tokens
    - ThemeProvider context + useTheme() hook
    - Dark (current) + Light theme definitions
    - Apply to App.tsx, Window.tsx, Dock.tsx frame components
    - Settings toggle: Dark / Light / System

RULES:
- Run tests after each feature: npx vitest run
- Don't break existing 304 tests — only add to them
- Add component tests for new UI (use `// @vitest-environment jsdom` directive at top of test files)
- Follow existing patterns: look at how current apps register in types.ts, Dock.tsx, App.tsx
- Check `getKernelClient().connected` for dual-mode behavior in all new components
- Update docs/TODO.md, docs/FEATURES.md, docs/NEXT_STEPS.md when features complete
- Commit each feature separately with descriptive messages
- Push when done

IMPORTANT NOTES:
- Several components already exist as stubs (ShortcutOverlay, WorkspaceSwitcher, SheetsApp, WriterApp, CanvasApp) — READ them first before rewriting
- Use `--legacy-peer-deps` for any npm install commands
- Component tests need @testing-library/react (already installed as devDep)
- Monaco is already installed — no need to reinstall
- The Dock.tsx apps array and App.tsx DOCK_APPS + switch cases need entries for each new app
- AppID enum in types.ts needs new entries for any new apps
```

---

## Dependency Graph

```
Wave 2 (parallel, no deps):     B1  D1  F1  A2
                                  │       │
Wave 3 (parallel, after F1):     │   B3  B4  C1  C3
                                  │
Wave 4 (parallel):               C2  D2  D3
```

## Estimated Scope

| Feature | Complexity | New Files | Existing Files Modified |
|---------|-----------|-----------|------------------------|
| B1: Notifications | Medium | 1 new + 1 test | App.tsx |
| D1: Shortcuts | Low | 0 (enhance existing) | shortcutManager.ts, ShortcutOverlay.tsx, App.tsx |
| F1: Raw Files | Low | 0 + 1 test | server/src/index.ts, kernel/src/VirtualFS.ts |
| A2: BrowserApp | High | 0 + 1 test | BrowserApp.tsx |
| B3: Music | Medium | 1 new + 1 test | types.ts, Dock.tsx, App.tsx |
| B4: PDF Viewer | Medium | 1 new + 1 test | types.ts, Dock.tsx, App.tsx, package.json |
| C1: Spreadsheet | High | 0 + 1 test | SheetsApp.tsx |
| C3: Writer | Medium | 0 + 1 test | WriterApp.tsx |
| C2: Canvas | Medium | 0 + 1 test | CanvasApp.tsx |
| D2: Workspaces | Medium | 0 + 1 test | WorkspaceSwitcher.tsx, App.tsx |
| D3: Themes | Medium | 1 new (themeManager.ts) | index.html, SettingsApp.tsx, App.tsx, Window.tsx, Dock.tsx |

## Suggested Parallel Grouping for Agent Sessions

If using multiple agents, split as:

- **Agent 1:** B1 (Notifications) + D1 (Shortcuts) — both touch App.tsx but different sections
- **Agent 2:** F1 (Raw Files) → B3 (Music) + B4 (PDF) — server/kernel changes then dependent apps
- **Agent 3:** A2 (BrowserApp) — complex standalone rewrite
- **Agent 4:** C1 (Spreadsheet) + C3 (Writer) + C2 (Canvas) — app enhancements, independent of each other
- **Agent 5:** D2 (Workspaces) + D3 (Themes) — desktop experience features
