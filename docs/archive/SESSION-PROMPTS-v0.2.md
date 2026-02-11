# Aether OS v0.2 — Session Prompts (Execution Playbook)

Each prompt below is a **self-contained session** you can paste into Claude Code, Codex, or any coding agent. They're ordered by priority and grouped so independent sessions can run in parallel.

**How to use:**
- Pick a prompt, paste it at the start of a new session
- Each prompt includes: context, scope, files to touch, success criteria
- Prompts marked with the same **parallel group** letter can run simultaneously on separate branches
- Merge in priority order when done

---

## Parallel Group A — The Big Three (highest impact)

### A1. Real Browser — BrowserManager (Kernel Side)

```
You are working on Aether OS, an AI-native operating system with a real TypeScript kernel.

TASK: Implement a BrowserManager kernel subsystem that manages real Chromium browser instances via Playwright.

CONTEXT:
- The kernel is at kernel/src/Kernel.ts — it instantiates subsystems (ProcessManager, VirtualFS, PTYManager, ContainerManager, VNCManager, etc.) and routes commands via handleCommand()
- All subsystems communicate through EventBus (kernel/src/EventBus.ts) — typed pub/sub
- The shared protocol is at shared/src/protocol.ts — discriminated unions for KernelCommand and KernelEvent
- The server at server/src/index.ts routes WebSocket messages to kernel.handleCommand() and streams kernel events back
- Current browser is just an iframe in components/apps/BrowserApp.tsx — most sites block it

CREATE: kernel/src/BrowserManager.ts

Requirements:
1. BrowserManager class that follows the same pattern as VNCManager or PTYManager:
   - Constructor takes EventBus
   - init() method to check if Playwright/Chromium is available (graceful fallback if not)
   - shutdown() method to close all browser instances

2. Browser session management:
   - createSession(sessionId: string, options?: { width?: number, height?: number }) — launches a headless Chromium page
   - destroySession(sessionId: string) — closes a browser page
   - navigateTo(sessionId: string, url: string) — navigate to URL
   - goBack(sessionId: string) / goForward(sessionId: string) — history navigation
   - reload(sessionId: string) — refresh the page
   - getScreenshot(sessionId: string) — returns a base64 PNG screenshot of the current page
   - getPageInfo(sessionId: string) — returns { url, title, favicon?, isLoading }
   - getDOMSnapshot(sessionId: string) — returns simplified DOM (text content, links, forms, interactive elements) for agent consumption

3. Input forwarding:
   - click(sessionId: string, x: number, y: number, button?: 'left' | 'right')
   - type(sessionId: string, text: string)
   - keyPress(sessionId: string, key: string)
   - scroll(sessionId: string, deltaX: number, deltaY: number)

4. Streaming:
   - startScreencast(sessionId: string, fps?: number) — emit screenshots via EventBus at given FPS (default 10)
   - stopScreencast(sessionId: string)
   - Emit events: 'browser:screenshot', 'browser:page_info', 'browser:navigation'

5. Add to shared/src/protocol.ts:
   - New command types: 'browser:create', 'browser:navigate', 'browser:click', 'browser:type', 'browser:keypress', 'browser:scroll', 'browser:screenshot', 'browser:destroy', 'browser:screencast_start', 'browser:screencast_stop', 'browser:back', 'browser:forward', 'browser:reload', 'browser:dom_snapshot'
   - New event types: 'browser:created', 'browser:navigated', 'browser:screenshot', 'browser:page_info', 'browser:destroyed', 'browser:error'

6. Wire into Kernel.ts:
   - Add BrowserManager as this.browser property
   - Call this.browser.init() during boot
   - Call this.browser.shutdown() during shutdown
   - Handle browser:* commands in handleCommand()

7. Add playwright as a dependency to kernel/package.json

8. Write tests in kernel/src/__tests__/BrowserManager.test.ts:
   - Test session creation/destruction
   - Test navigation
   - Test screenshot capture
   - Test graceful fallback when Playwright is not installed
   - Mock Playwright's browser/page APIs

PATTERNS TO FOLLOW:
- Look at kernel/src/VNCManager.ts and kernel/src/PTYManager.ts for the subsystem pattern
- Look at how commands are routed in Kernel.ts handleCommand() switch statement
- Look at how events are typed in shared/src/protocol.ts

DO NOT modify any frontend/UI files. This is kernel-only.

SUCCESS CRITERIA:
- BrowserManager.test.ts passes with at least 10 tests
- Kernel boots with BrowserManager initialized (or gracefully skips if no Chromium)
- All new protocol types compile
- npm run lint passes
- npm run test passes (all existing 149 tests + new browser tests)
```

---

### A2. Real Browser — Frontend (UI Side)

```
You are working on Aether OS, an AI-native operating system with a React frontend.

TASK: Replace the iframe-based BrowserApp with a real browser UI that connects to the kernel's BrowserManager via WebSocket.

CONTEXT:
- The current browser is at components/apps/BrowserApp.tsx — a simple iframe wrapper, 75 lines
- The kernel client is at services/kernelClient.ts — handles WebSocket communication, has methods like sendCommand() and event listeners
- The kernel hook is at services/useKernel.ts — React hook for kernel state
- App registration is in types.ts (AppID enum) and App.tsx (window rendering switch)
- All apps follow a pattern: React component, receives initialData via WindowState.initialData
- The kernel now has a BrowserManager that accepts browser:* commands and emits browser:* events (from session A1)
- Protocol types are in shared/src/protocol.ts

REWRITE: components/apps/BrowserApp.tsx

Requirements:
1. Tab bar:
   - Multiple tabs, each tab = one kernel browser session
   - "+" button to open new tab
   - Tab shows favicon + title (from browser:page_info events)
   - Click tab to switch, middle-click or X to close
   - Draggable tab reorder (stretch goal)

2. Navigation chrome:
   - Back, Forward, Reload buttons — send browser:back/forward/reload commands
   - URL bar — shows current URL, editable, Enter to navigate
   - Loading indicator (spinner on reload button when isLoading)
   - Lock icon for HTTPS

3. Page viewport:
   - Renders screenshots from the kernel's BrowserManager screencast as an <img> or <canvas>
   - Forwards mouse clicks to kernel (browser:click with x,y coordinates relative to viewport)
   - Forwards keyboard input to kernel (browser:type / browser:keypress)
   - Forwards scroll events to kernel (browser:scroll)
   - Resize handling: when window resizes, notify kernel to resize browser viewport

4. Dual-mode behavior:
   - If kernel is connected and BrowserManager is available: use real browser via WebSocket
   - If kernel is not connected: fall back to current iframe behavior with a banner: "Limited mode: some sites may not load. Connect kernel for full browser."

5. Status bar (bottom):
   - Hovered link URL preview (stretch goal)
   - Zoom controls: +, -, reset

6. Performance:
   - Use requestAnimationFrame for screenshot rendering
   - Don't re-render React on every screenshot frame — use canvas.drawImage() or direct img.src mutation
   - Throttle mouse move events to prevent flooding the WebSocket

PATTERNS TO FOLLOW:
- Look at components/os/VNCViewer.tsx for how it renders a remote visual stream
- Look at components/apps/TerminalApp.tsx for how it connects to kernel via WebSocket
- Look at services/kernelClient.ts for how to send commands and listen for events

SUCCESS CRITERIA:
- Browser loads any website when kernel is connected (no more X-Frame-Options issues)
- Tabs work: create, switch, close
- Navigation works: back, forward, reload, URL bar
- Mouse clicks on the page viewport are forwarded and reflected
- Keyboard input works (can type in a search box on a website)
- Falls back to iframe gracefully when kernel is not connected
- No TypeScript errors, npm run lint passes
```

---

### A3. Real Code Editor — Monaco Integration

```
You are working on Aether OS, an AI-native operating system with a React frontend.

TASK: Replace the current regex-based code editor with Monaco Editor (the VS Code engine).

CONTEXT:
- Current editor is at components/apps/CodeEditorApp.tsx — ~12KB, regex-based syntax highlighting, connects to kernel FS for read/write
- The kernel client at services/kernelClient.ts has methods: readFile(path), writeFile(path, content), listDir(path)
- App IDs are in types.ts, app rendering is in App.tsx
- The app can receive initialData with a file path to open

REWRITE: components/apps/CodeEditorApp.tsx

Requirements:
1. Monaco Editor integration:
   - Install @monaco-editor/react as a dependency in the root package.json
   - Replace the textarea + regex highlighting with <Editor> from @monaco-editor/react
   - Theme: "vs-dark" (matches Tokyo Night aesthetic) or create a custom Tokyo Night theme
   - Language detection from file extension (ts, js, py, rs, go, json, yaml, md, html, css, sql, sh, etc.)

2. File management:
   - Tab bar at top: multiple files open simultaneously
   - Each tab shows filename, unsaved dot indicator, close button
   - Clicking a tab switches the active editor
   - Cmd+S / Ctrl+S saves the current file to kernel FS (or shows "not connected" toast in mock mode)
   - Cmd+W / Ctrl+W closes the current tab

3. Sidebar file tree:
   - Collapsible left panel (toggle with icon button)
   - Shows directory tree from kernel FS
   - Click file to open in a new tab (or focus existing tab if already open)
   - Right-click context menu: New File, New Folder, Rename, Delete
   - Auto-expand to the currently open file's directory

4. Editor features (Monaco built-in, just enable):
   - Minimap (right side code overview)
   - Line numbers
   - Bracket matching & auto-closing
   - Find & Replace (Cmd+F, Cmd+H)
   - Multi-cursor (Alt+Click)
   - Code folding
   - Word wrap toggle

5. Status bar (bottom):
   - Current language
   - Line:Column cursor position
   - Encoding (UTF-8)
   - Indentation (Spaces: 2 / Tabs)
   - "Connected" / "Disconnected" kernel status

6. Dual-mode:
   - Kernel connected: read/write from kernel FS
   - Mock mode: use localStorage for file contents, show a sample file on first load

7. Integration with window system:
   - Accept initialData.path to open a specific file on launch
   - Accept initialData.paths (array) to open multiple files
   - Window title updates to show current file name

PATTERNS TO FOLLOW:
- Look at the existing CodeEditorApp.tsx for how it connects to kernel FS
- Look at FileExplorer.tsx (components/apps/FileExplorer.tsx) for how it renders the file tree
- Don't duplicate the file tree logic — extract shared utilities if needed

DO NOT change any kernel code. This is frontend-only.

SUCCESS CRITERIA:
- Monaco Editor renders with syntax highlighting for at least 10 languages
- File open/save works with kernel FS
- Multiple file tabs work (open, switch, close, unsaved indicator)
- Sidebar file tree shows kernel FS contents
- Cmd+S saves, Cmd+F opens find
- Falls back to localStorage in mock mode
- No TypeScript errors, npm run lint passes
- Performance: editor loads in under 2 seconds, typing has no perceptible lag
```

---

## Parallel Group B — New Core Apps

### B1. Notification Center

```
You are working on Aether OS, an AI-native operating system with a React frontend styled with Tailwind CSS and glassmorphism.

TASK: Build a notification center — toast notifications + notification history panel.

CONTEXT:
- App.tsx is the main window manager. It renders the menu bar at the top (with time, battery, wifi icons) and all app windows
- The kernel emits events via WebSocket (services/kernelClient.ts) for agent state changes, errors, completions, etc.
- The UI uses Lucide icons (lucide-react), Tailwind CSS via CDN, and a dark Tokyo Night / glassmorphism style
- The menu bar is rendered directly in App.tsx around line 30-50 area

CREATE:
1. components/os/NotificationCenter.tsx — the notification system
2. Update App.tsx to integrate it

Requirements:
1. Toast notifications:
   - Appear in top-right corner, stack vertically
   - Auto-dismiss after 5 seconds (configurable)
   - Types: info (blue), success (green), warning (yellow), error (red)
   - Each toast has: icon, title, body text, timestamp, dismiss button
   - Slide-in animation from right, fade-out on dismiss
   - Max 4 visible toasts, older ones queue

2. Notification center panel:
   - Bell icon in the menu bar (with unread count badge)
   - Click bell to toggle a dropdown panel (like macOS notification center)
   - Scrollable list of all past notifications
   - "Mark all as read" button
   - "Clear all" button
   - Each notification: icon, title, body, relative timestamp ("2m ago"), read/unread indicator
   - Click a notification to take action (e.g., open the agent that completed)

3. Notification sources (wire these up):
   - Agent completed: "Agent 'Coder' finished: Built REST API"
   - Agent failed: "Agent 'Researcher' failed: API rate limit exceeded"
   - Agent needs approval: "Agent 'DevOps' wants to run: rm -rf /tmp/old"
   - Kernel connected/disconnected
   - File operations in the background (stretch)

4. React context:
   - Create a NotificationProvider context so any component can call:
     notify({ type: 'success', title: 'Done', body: 'Agent completed' })
   - Export useNotifications() hook

5. Persistence:
   - Store notification history in localStorage (last 100)
   - Restore on page reload

6. Style:
   - Glassmorphism: bg-white/10 backdrop-blur-xl border border-white/20
   - Consistent with existing UI (look at Window.tsx, Dock.tsx for reference)
   - Dark theme only for now

SUCCESS CRITERIA:
- Toast notifications appear and auto-dismiss
- Bell icon shows unread count
- Notification panel opens/closes with full history
- notify() works from any component via context hook
- Agent completion/failure/approval events trigger notifications
- No TypeScript errors, npm run lint passes
```

---

### B2. System Monitor (Activity Monitor Upgrade)

```
You are working on Aether OS, an AI-native operating system.

TASK: Build a real System Monitor app that shows live kernel metrics, per-agent resource usage, and LLM token tracking.

CONTEXT:
- There's a basic "Activity Monitor" desktop widget at components/os/DesktopWidgets.tsx but it's just static/random numbers
- The kernel exposes data via WebSocket events and HTTP endpoints:
  - GET /api/processes — list all processes with state, steps, creation time
  - GET /api/gpu — GPU status if available
  - GET /api/cluster — cluster node info
  - GET /api/llm/providers — LLM provider status
  - Kernel events: process:state_changed, process:output, agent:step (contain step counts)
- App IDs are in types.ts (AppID enum), window rendering in App.tsx
- services/kernelClient.ts has getProcesses(), getGPUStatus(), getClusterStatus(), getLLMProviders()

CREATE: components/apps/SystemMonitorApp.tsx
UPDATE: types.ts — add AppID.MONITOR = 'monitor'
UPDATE: App.tsx — add monitor to the window rendering switch and dock

Requirements:
1. Overview tab:
   - Total agents: running / stopped / completed / failed (with colored counts)
   - System uptime
   - Kernel mode indicator (standalone / hub / node)
   - LLM providers: list with green/red status dots
   - Docker: available / not available
   - GPU: model + VRAM usage if available, "No GPU" otherwise

2. Processes tab:
   - Table: PID, Name, Template, State, Steps, CPU est., Memory est., Created, Actions
   - Sortable columns
   - Row colors by state: green=running, yellow=stopped, gray=completed, red=failed
   - Actions: Stop (SIGSTOP), Resume (SIGCONT), Kill (SIGTERM), Force Kill (SIGKILL)
   - Auto-refresh every 2 seconds
   - Search/filter bar

3. LLM Usage tab:
   - Per-agent token tracking: agent name, provider, model, input tokens, output tokens, estimated cost
   - Total tokens today / this week / all time
   - Cost calculation: configurable $/token rates per provider
   - Bar chart: top 5 agents by token usage (simple CSS bar chart, no chart library needed)

4. Cluster tab (if cluster mode):
   - Node list: hostname, status, capacity, current load, latency
   - Agent distribution: which agents on which nodes

5. Design:
   - Tab navigation at top (Overview | Processes | LLM Usage | Cluster)
   - Dark theme, monospace font for numbers
   - Green/red/yellow status indicators throughout
   - Compact layout — lots of info, minimal wasted space

SUCCESS CRITERIA:
- Shows real data from kernel (not mocked) when connected
- Process list updates live
- Can stop/resume/kill agents from the process table
- LLM usage section shows token counts
- Graceful fallback when kernel not connected
- Registered as a new app in the Dock
- No TypeScript errors, npm run lint passes
```

---

### B3. Music / Audio Player

```
You are working on Aether OS, an AI-native operating system with a React frontend.

TASK: Build a Music app that plays audio files from the kernel filesystem and supports Text-to-Speech for agents.

CONTEXT:
- The kernel filesystem serves files. services/kernelClient.ts has readFile(path) which returns content
- For binary files, the server serves them via GET /api/fs/raw?path=/path/to/file (you may need to add this endpoint)
- types.ts has the AppID enum, App.tsx handles window rendering
- The DesktopWidgets.tsx has a "Music Player" widget stub that shows static "Now Playing" info

CREATE: components/apps/MusicApp.tsx
UPDATE: types.ts — add AppID.MUSIC = 'music'
UPDATE: App.tsx — add music to window rendering and dock

Requirements:
1. Audio playback:
   - HTML5 <audio> element for playback
   - Support: MP3, WAV, OGG, FLAC (browser-native formats)
   - Play/Pause, Previous, Next, Seek bar, Volume slider
   - Shuffle, Repeat (one / all / off)
   - Time display: current / total

2. File browser:
   - Left sidebar: browse kernel FS for audio files
   - Auto-scan common locations: /home/*/Music, /home/*/Downloads
   - Filter by audio file extensions
   - Click to play, double-click to play and clear queue

3. Playlist:
   - Right panel: current queue
   - Drag to reorder (or up/down arrows)
   - Add files, remove tracks, clear queue
   - Save/load named playlists to kernel FS at /home/root/Music/playlists/

4. Visualizer:
   - Web Audio API: connect audio element to AnalyserNode
   - Simple frequency bar visualization (canvas element)
   - Subtle, doesn't dominate the UI

5. Now Playing:
   - Large album art area (placeholder gradient if no art)
   - Track title, artist (from ID3 metadata if available, filename otherwise)
   - Waveform/progress indicator

6. Text-to-Speech integration:
   - "TTS" tab: paste text, select voice, click Speak
   - Uses browser's speechSynthesis API
   - Future: agents can trigger TTS via kernel command (just add the protocol types for now, don't implement kernel side)

7. Mini player:
   - When minimized, show a slim player bar at top of the desktop (above dock)
   - Just: track name, play/pause, next, progress bar

8. Mock mode:
   - Without kernel, show a demo UI with a sample track (use a sine wave generated via Web Audio API oscillator)

SUCCESS CRITERIA:
- Can browse kernel FS, find audio files, and play them
- Playback controls all work (play, pause, seek, volume, next, prev)
- Queue/playlist management works
- Visualizer animates during playback
- Registered as a new app in the Dock
- No TypeScript errors, npm run lint passes
```

---

### B4. PDF Viewer / Documents App

```
You are working on Aether OS, an AI-native operating system with a React frontend.

TASK: Build a Documents app that renders PDF files using pdf.js.

CONTEXT:
- The kernel serves raw files via HTTP. You can load PDFs via URL from the kernel
- services/kernelClient.ts has file operations
- App rendering is in App.tsx, IDs in types.ts

CREATE: components/apps/DocumentsApp.tsx
UPDATE: types.ts — add AppID.DOCUMENTS = 'documents'
UPDATE: App.tsx — add documents to window rendering and dock

Requirements:
1. PDF rendering:
   - Use pdfjs-dist (add to package.json dependencies)
   - Set up the PDF.js worker (use CDN worker URL or bundled worker)
   - Render pages to <canvas> elements
   - Lazy-render: only render visible pages + 1 above and 1 below

2. Navigation:
   - Scroll through pages naturally
   - Page indicator: "Page 3 of 42"
   - Jump to page input
   - Thumbnail sidebar (toggle): small previews of all pages

3. Zoom:
   - Zoom in (+), zoom out (-), fit width, fit page
   - Cmd+= / Cmd+- keyboard shortcuts
   - Display zoom percentage

4. Text layer:
   - Render the PDF text layer overlay so users can select and copy text
   - Search within document (Cmd+F): highlight matches, navigate between them

5. AI summarization:
   - "Summarize" button in toolbar
   - Extracts all text from PDF
   - Sends to the configured LLM (via services/geminiService.ts or kernel LLM endpoint)
   - Shows summary in a slide-out panel

6. File opening:
   - Accept initialData.path to open a specific PDF
   - "Open File" button: browse kernel FS for .pdf files
   - Drag & drop a PDF onto the window

7. Mock mode:
   - Without kernel, show a file-open dialog that accepts local file upload
   - Still renders the PDF fully (pdf.js works client-side)

8. Style:
   - Light content area (PDFs are usually white) with dark chrome/toolbar
   - Consistent with the rest of the OS

SUCCESS CRITERIA:
- PDFs render correctly with all pages
- Text is selectable and copyable
- Zoom works smoothly
- Search highlights matches in the document
- AI summarize produces a summary from the LLM
- Thumbnail sidebar shows page previews
- No TypeScript errors, npm run lint passes
```

---

## Parallel Group C — More Apps

### C1. Spreadsheet App

```
You are working on Aether OS, an AI-native operating system with a React frontend.

TASK: Build a Spreadsheet app (like a lightweight Google Sheets).

CONTEXT:
- App rendering is in App.tsx, IDs in types.ts
- Kernel FS available via services/kernelClient.ts
- Use Tailwind CSS dark theme consistent with the OS

CREATE: components/apps/SheetsApp.tsx
UPDATE: types.ts — add AppID.SHEETS = 'sheets'
UPDATE: App.tsx — add sheets to window rendering and dock

Requirements:
1. Grid:
   - Spreadsheet grid: columns A-Z (expandable), rows 1-1000 (virtual scrolled)
   - Cell selection (click), range selection (shift+click or drag)
   - Cell editing: double-click or start typing to enter edit mode
   - Tab to move right, Enter to move down, arrow keys to navigate
   - Column resize by dragging header borders
   - Row numbers on left, column letters on top

2. Cell types:
   - Text, Number, Date (auto-detect on input)
   - Format: bold, italic, text color, background color, alignment
   - Number formatting: decimal places, currency, percentage

3. Formulas:
   - Prefix with = to enter formula mode
   - Implement core formulas WITHOUT a library (keep it simple):
     - SUM(A1:A10), AVERAGE(A1:A10), COUNT(A1:A10), MIN, MAX
     - Basic math: +, -, *, /, ^
     - Cell references: A1, $A$1 (absolute)
     - IF(condition, true_val, false_val)
   - Show formula in an input bar above the grid when cell is selected
   - Circular reference detection

4. CSV import/export:
   - Import: paste CSV text or load .csv file from kernel FS
   - Export: save as .csv to kernel FS
   - Parse with proper quote handling

5. File operations:
   - Save/load spreadsheet as JSON to kernel FS (cells + formatting + formulas)
   - Cmd+S to save, Cmd+O to open
   - Autosave indicator

6. Style:
   - Light grid area (spreadsheets work better light) with dark toolbar
   - Selected cell: blue border
   - Selected range: light blue fill
   - Alternating row shading (subtle)

SUCCESS CRITERIA:
- Grid renders smoothly with 1000 rows (virtual scrolling)
- Cell editing and navigation work with keyboard
- At least SUM, AVERAGE, COUNT, IF formulas work correctly
- CSV import/export works
- Save/load to kernel FS works
- No TypeScript errors, npm run lint passes
```

---

### C2. Drawing / Whiteboard App

```
You are working on Aether OS, an AI-native operating system with a React frontend.

TASK: Build a Canvas drawing app / whiteboard.

CREATE: components/apps/CanvasApp.tsx
UPDATE: types.ts — add AppID.CANVAS = 'canvas'
UPDATE: App.tsx — add canvas to window rendering and dock

Requirements:
1. Drawing tools:
   - Pen (freehand), Line, Rectangle, Circle/Ellipse, Arrow
   - Eraser
   - Text tool (click to place text box, type, click away to confirm)
   - Color picker (preset palette + custom hex input)
   - Stroke width slider (1-20px)
   - Fill toggle for shapes (outline only vs filled)

2. Canvas:
   - HTML5 Canvas element, full size of the app window
   - Infinite canvas with pan (hold space + drag, or middle mouse)
   - Zoom (scroll wheel, or pinch on trackpad)
   - Coordinate indicator in status bar

3. Object model:
   - Each drawn element is stored as a JavaScript object (not just pixels)
   - Select tool: click to select, drag to move, handles to resize
   - Delete selected with Backspace/Delete
   - Undo (Cmd+Z) / Redo (Cmd+Shift+Z) — keep last 50 actions

4. Export:
   - Export as PNG (canvas.toBlob)
   - Export as SVG (serialize objects to SVG elements)
   - Save to kernel FS

5. Import:
   - Load saved canvas from kernel FS (JSON format)
   - Paste image from clipboard onto canvas

6. Style:
   - Toolbar on left side (vertical icon strip)
   - Property panel on right (color, stroke, fill) — only visible when relevant
   - Dark UI frame, white/light canvas area

SUCCESS CRITERIA:
- Freehand drawing works smoothly (60fps, no jank)
- All shape tools produce correct shapes
- Select, move, resize, delete objects
- Undo/redo works
- Export as PNG works
- Save/load canvas state to kernel FS
- No TypeScript errors, npm run lint passes
```

---

### C3. Markdown Editor / Writer App

```
You are working on Aether OS, an AI-native operating system with a React frontend.

TASK: Build a Markdown Writer app with live preview.

CREATE: components/apps/WriterApp.tsx
UPDATE: types.ts — add AppID.WRITER = 'writer'
UPDATE: App.tsx — add writer to window rendering and dock

Requirements:
1. Split view:
   - Left panel: raw markdown editor (monospace font, line numbers)
   - Right panel: live rendered preview
   - Resizable split (drag divider)
   - Toggle modes: Editor only, Preview only, Split (default)

2. Markdown rendering:
   - Implement a lightweight markdown-to-HTML converter (no heavy library):
     - Headers (# through ######)
     - Bold (**), Italic (*), Strikethrough (~~), Code (`inline`)
     - Code blocks (``` with language label, apply simple syntax class)
     - Unordered lists (- and *), Ordered lists (1.)
     - Task lists (- [ ] and - [x])
     - Links [text](url), Images ![alt](url)
     - Blockquotes (>)
     - Horizontal rules (---)
     - Tables (| col1 | col2 |)
   - Render via dangerouslySetInnerHTML with a sanitization pass (strip <script> tags)

3. Toolbar:
   - Formatting buttons: Bold, Italic, Heading, Code, Link, Image, List, Quote, Table
   - Each button wraps selection with appropriate markdown syntax
   - If no selection, insert placeholder text

4. File operations:
   - Open .md files from kernel FS
   - Save to kernel FS (Cmd+S)
   - Autosave with 3s debounce
   - Unsaved indicator in title bar

5. AI writing assist:
   - "AI Assist" button or Cmd+I
   - Options: "Continue writing", "Summarize selection", "Rewrite selection", "Fix grammar"
   - Sends request to LLM via services/geminiService.ts
   - Shows result inline or in a popup for review before inserting

6. Word count:
   - Status bar: word count, character count, reading time estimate

SUCCESS CRITERIA:
- Markdown renders correctly for all listed features
- Split view with resizable divider works
- Toolbar buttons insert correct markdown syntax
- File open/save works with kernel FS
- AI assist generates text from LLM
- No TypeScript errors, npm run lint passes
```

---

## Parallel Group D — Desktop Experience

### D1. Keyboard Shortcuts System

```
You are working on Aether OS, an AI-native operating system with a React frontend.

TASK: Implement a global keyboard shortcut system with a shortcut overlay.

CONTEXT:
- App.tsx is the main component. It already handles Cmd+K for SmartBar
- Apps are identified by AppID enum in types.ts
- Window management (open, close, focus, minimize, maximize) is in App.tsx

CREATE: services/shortcutManager.ts — keyboard shortcut registry and handler
CREATE: components/os/ShortcutOverlay.tsx — the Cmd+/ help overlay
UPDATE: App.tsx — integrate the shortcut system

Requirements:
1. ShortcutManager service:
   - registerShortcut(id, combo, handler, description, scope) — registers a shortcut
   - unregisterShortcut(id) — removes a shortcut
   - Scope: 'global' (always active) or 'app:appId' (only when that app is focused)
   - Combo format: 'Cmd+K', 'Cmd+Shift+N', 'Alt+1', 'Ctrl+Shift+P'
   - Cross-platform: Cmd on Mac, Ctrl on Windows/Linux (detect OS)
   - Prevent conflicts: warn if a combo is already registered

2. Default global shortcuts:
   - Cmd+K: Open Smart Bar (already exists, move to this system)
   - Cmd+/ or Cmd+?: Show shortcut overlay
   - Cmd+Q: Close focused window
   - Cmd+M: Minimize focused window
   - Cmd+Shift+M: Maximize/restore focused window
   - Cmd+W: Close focused window
   - Cmd+Tab: Cycle through open windows
   - Cmd+N: Open new Terminal
   - Cmd+,: Open Settings
   - Cmd+1 through Cmd+9: Focus/open Nth dock app
   - Escape: Close active modal/overlay/SmartBar

3. App-specific shortcuts (registered by each app):
   - Terminal: Cmd+T (new tab), Cmd+K (clear)
   - Code Editor: Cmd+S (save), Cmd+P (quick open file), Cmd+Shift+F (search all files)
   - Browser: Cmd+L (focus URL bar), Cmd+T (new tab), Cmd+R (reload)
   - Notes: Cmd+S (save), Cmd+B (bold), Cmd+I (italic)

4. Shortcut overlay (Cmd+/):
   - Modal overlay with grouped shortcut list
   - Groups: System, Window Management, Navigation, [Per-App sections]
   - Searchable: type to filter shortcuts
   - Shows combo in a <kbd> styled tag
   - Glassmorphism style, dismissible with Escape or click outside

5. React integration:
   - useShortcut(combo, handler, deps) hook for components to register shortcuts
   - Auto-cleanup on unmount

SUCCESS CRITERIA:
- All listed global shortcuts work
- Cmd+/ shows the overlay with all registered shortcuts
- Cmd+Tab cycles windows
- Cmd+1-9 opens dock apps
- App-specific shortcuts only fire when that app is focused
- useShortcut hook works for easy per-component registration
- No TypeScript errors, npm run lint passes
```

---

### D2. Multi-Desktop Workspaces

```
You are working on Aether OS, an AI-native operating system with a React frontend.

TASK: Add virtual desktop workspaces (like macOS Spaces).

CONTEXT:
- App.tsx manages all windows in a windows[] state array
- Each WindowState has: id, appId, title, isOpen, isMinimized, isMaximized, zIndex, position, size
- The Dock is at components/os/Dock.tsx

UPDATE: App.tsx — add workspace state and switching
CREATE: components/os/WorkspaceSwitcher.tsx — workspace indicator and switch UI

Requirements:
1. Workspace model:
   - Default: 3 workspaces (expandable up to 9)
   - Each workspace has its own set of visible windows
   - Windows belong to a workspace (add workspaceId to WindowState)
   - Dock is shared across all workspaces
   - Menu bar is shared

2. Switching:
   - Ctrl+Left / Ctrl+Right: switch to adjacent workspace (with slide animation)
   - Ctrl+1 through Ctrl+9: jump to workspace N
   - WorkspaceSwitcher in menu bar: row of dots showing workspaces, filled dot = current
   - Click a dot to switch

3. Window management:
   - Move window to another workspace: right-click title bar → "Move to Workspace 2"
   - Or: Ctrl+Shift+Left/Right to move focused window to adjacent workspace
   - "Show on all workspaces" option (sticky windows, e.g., music player)

4. Overview:
   - Ctrl+Up or F3: show all workspaces as a grid (Mission Control style)
   - Each workspace shows miniature previews of its windows
   - Click a workspace to switch to it
   - Drag windows between workspaces in overview
   - Click + to add a new workspace

5. Animation:
   - Horizontal slide transition when switching workspaces
   - CSS transition, 200ms, ease-out
   - Windows in departing workspace slide out, arriving workspace slides in

6. Persistence:
   - Store workspace assignments in window state
   - Remember which workspace was active on reload

SUCCESS CRITERIA:
- Ctrl+Left/Right switches workspaces with slide animation
- Windows are isolated per workspace
- WorkspaceSwitcher dots appear in menu bar
- Ctrl+Up shows overview with workspace grid
- Can move windows between workspaces
- No TypeScript errors, npm run lint passes
```

---

### D3. Light Theme + Theme System

```
You are working on Aether OS, an AI-native operating system styled with Tailwind CSS.

TASK: Implement a theme system with dark (default) and light themes.

CONTEXT:
- The entire UI uses Tailwind CSS classes directly in components
- Current style: dark backgrounds (bg-gray-900, bg-gray-800), white text, glassmorphism (bg-white/10, backdrop-blur)
- Settings app at components/apps/SettingsApp.tsx has a "Theme" section that doesn't work yet
- All components are in components/os/ and components/apps/

CREATE: services/themeManager.ts — theme state management
UPDATE: index.html — add CSS custom properties for theming
UPDATE: components/apps/SettingsApp.tsx — make theme toggle functional

Requirements:
1. Theme approach:
   - Use CSS custom properties (vars) instead of rewriting every Tailwind class
   - Define theme tokens in index.html <style> block:
     --bg-primary, --bg-secondary, --bg-tertiary
     --text-primary, --text-secondary, --text-muted
     --border-color, --border-subtle
     --glass-bg, --glass-border
     --accent, --accent-hover
     --success, --warning, --error
   - Dark theme: current Tokyo Night colors
   - Light theme: clean whites, light grays, blue accents

2. Theme manager:
   - ThemeProvider React context
   - useTheme() hook returning { theme, setTheme, toggle }
   - Persist to localStorage
   - Respect system preference (prefers-color-scheme) as initial default
   - Apply theme by setting a data-theme="dark|light" attribute on <html>

3. CSS implementation:
   - In index.html, define both theme sets:
     html[data-theme="dark"] { --bg-primary: #1a1b26; ... }
     html[data-theme="light"] { --bg-primary: #ffffff; ... }
   - Add Tailwind-compatible utility classes that reference CSS vars:
     .bg-theme-primary { background-color: var(--bg-primary); }
     Or use Tailwind's arbitrary value syntax: bg-[var(--bg-primary)]

4. Component updates (minimal, targeted):
   - Update the key "frame" components that define the overall look:
     - App.tsx (desktop background, menu bar)
     - Window.tsx (window frame, title bar)
     - Dock.tsx (dock background)
   - Leave individual app contents for now — they'll inherit through CSS vars
   - Glassmorphism should work in both themes (lighter blur in light mode)

5. Settings integration:
   - Make the existing theme toggle in SettingsApp actually work
   - Radio buttons or toggle: Dark / Light / System

6. Exceptions:
   - Terminal always dark (dark terminal is universal)
   - Video player always dark
   - Code editor follows the main theme but can be overridden

SUCCESS CRITERIA:
- data-theme="light" on <html> switches the entire OS to light mode
- Menu bar, dock, windows, and desktop look good in both themes
- Settings toggle works and persists across reload
- System preference is respected on first load
- Terminal stays dark regardless
- No TypeScript errors, npm run lint passes
```

---

## Parallel Group E — Agent Browser Tool Upgrade

### E1. Agent Browser Tools (Runtime Side)

```
You are working on Aether OS. The kernel now has a BrowserManager (from session A1).

TASK: Upgrade the agent's browser tools from simple HTTP fetch to real Chromium-powered browsing.

CONTEXT:
- Agent tools are defined in runtime/src/tools.ts
- The current browse_web tool just does an HTTP fetch and extracts text
- The kernel's BrowserManager can: create sessions, navigate, click, type, scroll, get screenshots, get DOM snapshots
- Tools have access to the kernel via ctx.kernel
- Tool interface: { name, description, requiresApproval?, execute: (args, ctx) => Promise<ToolResult> }

UPDATE: runtime/src/tools.ts — replace browse_web and add new browser tools

Requirements:
1. Replace browse_web:
   - Instead of HTTP fetch, use kernel.browser.createSession() + navigateTo() + getDOMSnapshot()
   - Return structured content: title, URL, text content, links, forms, interactive elements
   - Auto-cleanup: destroy session after content is extracted (for simple browsing)
   - Fallback: if BrowserManager is not available, fall back to current HTTP fetch behavior

2. Add browse_interactive tool:
   - Creates a persistent browser session tied to the agent
   - Returns DOM snapshot with element IDs for interaction
   - Session stays open for follow-up actions

3. Add browser_click tool:
   - Click an element by CSS selector or coordinates
   - Returns: new page DOM snapshot after click (page may have changed)

4. Add browser_type tool:
   - Type text into a focused input or specified selector
   - Returns: updated DOM snapshot

5. Add browser_screenshot tool:
   - Returns base64 PNG screenshot of current page
   - Useful for vision-capable agents

6. Add browser_scroll tool:
   - Scroll down/up by amount
   - Returns: new visible content

7. Add browser_close tool:
   - Close the persistent browser session
   - Agent should call this when done browsing

8. Update agent templates:
   - Add new browser tools to the 'web-researcher' template
   - Add a new template: 'web-navigator' — specialized for form-filling, data extraction, web automation

9. Tool descriptions:
   - Each tool description should be clear and detailed enough that an LLM knows when and how to use it
   - Include parameter descriptions

SUCCESS CRITERIA:
- browse_web now uses real Chromium (with fallback to HTTP fetch)
- Agent can: navigate → read page → click a link → read new page → fill a form → submit
- All tools have clear descriptions for LLM consumption
- New 'web-navigator' template exists
- Existing tests pass, new tools have at least basic tests
- npm run lint passes
```

---

## Parallel Group F — Infrastructure & Server

### F1. Raw File Serving Endpoint

```
You are working on Aether OS.

TASK: Add a raw file serving endpoint to the server for binary files (images, audio, video, PDFs).

CONTEXT:
- Server is at server/src/index.ts — Node.js HTTP + WebSocket
- The kernel filesystem at kernel/src/VirtualFS.ts reads files but returns text content
- Apps like Music, Photos, Video, Documents need to load binary files via HTTP

UPDATE: server/src/index.ts — add /api/fs/raw endpoint
UPDATE: kernel/src/VirtualFS.ts — add readFileRaw() method that returns a Buffer

Requirements:
1. GET /api/fs/raw?path=/home/root/Music/song.mp3
   - Authenticated (require valid JWT token)
   - Read file from VirtualFS as raw Buffer
   - Set correct Content-Type based on file extension (audio/mpeg, image/png, application/pdf, etc.)
   - Set Content-Length header
   - Set Content-Disposition: inline
   - Stream the file (don't load entirely into memory for large files)
   - Return 404 if file doesn't exist
   - Return 403 if path traversal detected
   - Return 400 if path parameter is missing

2. MIME type mapping:
   - .mp3→audio/mpeg, .wav→audio/wav, .ogg→audio/ogg, .flac→audio/flac
   - .png→image/png, .jpg/.jpeg→image/jpeg, .gif→image/gif, .svg→image/svg+xml, .webp→image/webp
   - .mp4→video/mp4, .webm→video/webm
   - .pdf→application/pdf
   - .json→application/json, .txt→text/plain
   - Default: application/octet-stream

3. Range requests (for audio/video seeking):
   - Support HTTP Range header for partial content (206 Partial Content)
   - This enables audio/video seeking in the browser

4. VirtualFS update:
   - Add readFileRaw(path: string): Promise<Buffer> method
   - Existing readFile returns { content: string }, keep that for text
   - readFileRaw returns the raw Buffer for binary files
   - Same path security checks as readFile

5. Tests:
   - Add tests for the raw endpoint in server/src/__tests__/
   - Test: valid file, missing file, path traversal blocked, correct MIME type

SUCCESS CRITERIA:
- GET /api/fs/raw?path=/some/file.mp3 returns the file with correct Content-Type
- Range requests work for audio/video seeking
- Path traversal is blocked
- Tests pass
- npm run lint passes
```

---

## Execution Matrix

| Session | Parallel Group | Depends On | Est. Complexity | Branch Name |
|---------|---------------|------------|-----------------|-------------|
| A1. BrowserManager (kernel) | A | — | High | feat/browser-kernel |
| A2. BrowserApp (UI) | A | A1 | High | feat/browser-ui |
| A3. Monaco Editor | A | — | Medium | feat/monaco-editor |
| B1. Notification Center | B | — | Medium | feat/notifications |
| B2. System Monitor | B | — | Medium | feat/system-monitor |
| B3. Music App | B | F1 | Medium | feat/music-app |
| B4. PDF Viewer | B | F1 | Medium | feat/pdf-viewer |
| C1. Spreadsheet | C | — | High | feat/sheets |
| C2. Drawing Canvas | C | — | Medium | feat/canvas |
| C3. Markdown Writer | C | — | Medium | feat/writer |
| D1. Keyboard Shortcuts | D | — | Low | feat/shortcuts |
| D2. Multi-Desktop | D | — | Medium | feat/workspaces |
| D3. Theme System | D | — | Medium | feat/themes |
| E1. Agent Browser Tools | E | A1 | Medium | feat/agent-browser |
| F1. Raw File Endpoint | F | — | Low | feat/raw-files |

**Recommended execution order:**
```
Wave 1 (parallel): A1 + A3 + B1 + D1 + F1
Wave 2 (parallel): A2 + B2 + D3 + E1 (after A1, F1 done)
Wave 3 (parallel): B3 + B4 + C1 + C3 (after F1 done)
Wave 4 (parallel): C2 + D2
```

Each wave can be 1-4 agents working simultaneously on separate branches. Merge each wave before starting the next.
