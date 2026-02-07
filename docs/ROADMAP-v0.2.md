# Aether OS v0.2 — Real Apps & Real Browser

**Theme:** Make everything real. Replace every mock, iframe, and stub with a genuine implementation.

**Status:** ✅ Complete (all 14 sessions implemented across 4 waves)

---

## 1. Real Browser

The current browser is an `<iframe>` wrapper. Most of the web blocks iframe embedding via `X-Frame-Options`. This is the single biggest gap between "demo" and "real."

### 1.1 Approach: Kernel-Managed Chromium

The kernel spawns a headless Chromium instance (via Puppeteer or Playwright) per browser session. The browser runs server-side, and the UI gets a live stream of what's on screen.

```
User clicks URL bar → kernel receives navigate command
  → Puppeteer navigates Chromium → captures screenshot/DOM
  → streams back to UI via WebSocket
  → UI renders the page as a live, interactive view
```

### 1.2 Implementation Plan

| Task | Details |
|------|---------|
| **Add Playwright to kernel** | `kernel/src/BrowserManager.ts` — manages headless Chromium instances per agent/session |
| **CDP streaming** | Use Chrome DevTools Protocol to stream page screenshots at ~15-30fps, or use `Page.screencast` for efficient video frames |
| **Input forwarding** | Forward mouse clicks, keyboard input, and scroll events from the UI to the Chromium instance via CDP |
| **Navigation controls** | Back, forward, refresh, URL bar — all map to Playwright page methods |
| **Tab support** | Multiple pages per browser context, tab bar in the UI |
| **DevTools panel** | Optional: expose a simplified DOM inspector / network tab |
| **Agent browser tool upgrade** | Replace the `browse_web` HTTP-fetch tool with real Chromium interaction — agents can click buttons, fill forms, read rendered DOM |
| **Download handling** | Files downloaded by the browser land in the agent's filesystem |
| **Cookie/session persistence** | Browser state persists across kernel restarts via browser context storage |

### 1.3 Dual-Mode Behavior

| Mode | Behavior |
|------|----------|
| **Kernel mode** | Real Chromium via Playwright, full interaction |
| **Mock mode** | Falls back to iframe (current behavior) with a banner explaining limitations |

### 1.4 Security Considerations

- Each browser instance runs in its own Chromium profile (isolated cookies/storage)
- Network requests from the browser are logged and inspectable
- Optional: restrict allowed domains per agent
- Browser runs headless server-side — no code execution on the client

---

## 2. Real Code Editor

Replace the regex-based syntax highlighter with a professional editor.

### 2.1 Monaco Editor Integration

| Task | Details |
|------|---------|
| **Replace CodeEditorApp internals** | Swap regex highlighting for Monaco Editor (the engine behind VS Code) |
| **Language support** | TypeScript, JavaScript, Python, Rust, Go, C/C++, JSON, YAML, Markdown, HTML/CSS, SQL, Shell — out of the box with Monaco |
| **LSP integration** | Run language servers in the kernel (tsserver, pyright, etc.), connect via WebSocket to Monaco |
| **Autocomplete** | Powered by LSP — real IntelliSense, not guessing |
| **Multi-file tabs** | Open multiple files, tab bar with unsaved indicators |
| **File tree sidebar** | Integrated file browser (leverage existing FileExplorer logic) |
| **Search & replace** | Across files, with regex support |
| **Git integration** | Inline diff view, blame annotations, change indicators in the gutter |
| **Minimap** | Code overview on the right side (Monaco built-in) |
| **Keyboard shortcuts** | VS Code-compatible keybindings |
| **AI assist** | Cmd+I for inline AI suggestions using the configured LLM |
| **Collaborative editing** | When multiple agents edit the same file, show cursors (stretch goal) |

### 2.2 Alternative: CodeMirror 6

If Monaco is too heavy (~2MB), CodeMirror 6 is a lighter alternative with excellent extension support. Decision should be based on bundle size constraints.

---

## 3. Real Video Player

### 3.1 Features

| Task | Details |
|------|---------|
| **Local file playback** | Browse kernel FS for video files, play with HTML5 `<video>` |
| **URL playback** | Paste a direct video URL (MP4, WebM, HLS) |
| **Streaming support** | HLS.js for `.m3u8` streams, DASH.js for MPEG-DASH |
| **YouTube integration** | Embed via youtube-nocookie.com or use yt-dlp in kernel to extract stream URLs |
| **Playlist support** | Queue multiple videos, auto-advance |
| **Subtitles** | Load `.srt` / `.vtt` files from kernel FS |
| **Picture-in-picture** | Native browser PiP API |
| **Keyboard controls** | Space (pause), arrows (seek), F (fullscreen), M (mute) |
| **Thumbnail preview** | Generate thumbnails server-side with ffmpeg |

---

## 4. Real Photos App

### 4.1 Features

| Task | Details |
|------|---------|
| **Kernel FS gallery** | Scan agent filesystems for image files, display as grid |
| **Screenshot capture** | Capture screenshots of agent desktops / VNC sessions |
| **AI image generation** | Generate images via DALL-E, Stable Diffusion (local), or Gemini Imagen |
| **Image editing** | Crop, rotate, resize, filters (via canvas API or sharp on kernel) |
| **OCR** | Extract text from images using Tesseract.js or LLM vision |
| **Metadata viewer** | EXIF data display for uploaded photos |
| **AI analysis** | Already partially works with Gemini — extend to all LLM providers with vision |
| **Drag & drop** | Drop images from desktop into the app |
| **Export** | Save edited images back to kernel FS |

---

## 5. Real Music / Audio Player

### 5.1 New App: Music

| Task | Details |
|------|---------|
| **Audio file playback** | MP3, FLAC, OGG, WAV from kernel FS |
| **Web Audio API** | Visualizer (waveform / frequency bars) |
| **Playlist management** | Create, save, load playlists |
| **Text-to-speech** | Agents can speak — TTS output plays in the Music app |
| **Speech-to-text** | Microphone input → transcription via Whisper (local) or cloud API |
| **Podcast player** | RSS feed parsing, episode list, playback position memory |
| **Background playback** | Audio continues when app is minimized |
| **Media controls** | Global keyboard shortcuts, menu bar now-playing indicator |

---

## 6. Real Email Client

### 6.1 New App: Mail

| Task | Details |
|------|---------|
| **IMAP/SMTP support** | Connect to any email provider via kernel-side IMAP client (imapflow) |
| **Gmail API option** | OAuth2 flow for Google accounts |
| **Inbox view** | Thread list with search, labels/folders |
| **Compose** | Rich text editor (or Markdown) with attachments from kernel FS |
| **Agent email tool** | Agents can send and read emails as part of their task loop |
| **Notifications** | Desktop notification widget for new mail |
| **Filters & rules** | Auto-sort, auto-respond (via agent) |

---

## 7. Real Calendar

### 7.1 New App: Calendar

| Task | Details |
|------|---------|
| **CalDAV support** | Sync with Google Calendar, iCloud, Nextcloud |
| **Week/month/day views** | Standard calendar UI with drag-to-create events |
| **Agent scheduling** | Agents can create events, set reminders, check availability |
| **Task integration** | Calendar events can trigger agent tasks |
| **Recurring events** | Daily, weekly, monthly with exception handling |
| **Timezone support** | Proper timezone handling for distributed teams |

---

## 8. Real PDF Viewer

### 8.1 New App: Documents

| Task | Details |
|------|---------|
| **PDF rendering** | pdf.js for client-side PDF rendering |
| **Annotation** | Highlight, comment, draw on PDFs |
| **Text extraction** | Copy text from PDFs, send to agents for analysis |
| **Form filling** | Interactive PDF forms |
| **Print** | Export annotated PDFs |
| **AI summarization** | "Summarize this document" button powered by LLM |

---

## 9. Real Spreadsheet

### 9.1 New App: Sheets

| Task | Details |
|------|---------|
| **Grid editor** | Real spreadsheet grid with cell selection, formatting |
| **Formulas** | SUM, AVERAGE, IF, VLOOKUP — standard spreadsheet functions via HyperFormula or similar |
| **CSV/TSV import/export** | Load data from kernel FS |
| **Charts** | Bar, line, pie charts from selected data |
| **Agent data tool** | Agents can read/write spreadsheet data programmatically |
| **Large datasets** | Virtual scrolling for 100k+ rows |

---

## 10. Real Drawing / Whiteboard

### 10.1 New App: Canvas

| Task | Details |
|------|---------|
| **Freehand drawing** | Pen, brush, eraser with pressure sensitivity |
| **Shapes & text** | Rectangle, circle, arrow, text boxes |
| **Layers** | Multiple layers with opacity and blending |
| **Collaboration** | Multiple agents can draw on the same canvas |
| **Export** | Save as PNG/SVG to kernel FS |
| **AI drawing** | "Draw me a diagram of..." — LLM generates SVG or describes what to draw |
| **Flowcharts** | Drag-and-drop flowchart builder for agent orchestration |

---

## 11. Real Markdown Editor

### 11.1 New App: Writer

| Task | Details |
|------|---------|
| **Split view** | Edit on left, live preview on right |
| **Full GFM support** | Tables, task lists, code blocks with syntax highlighting, footnotes |
| **WYSIWYG option** | Toggle between raw markdown and rich text (Milkdown or ProseMirror) |
| **Export** | PDF, HTML, DOCX via pandoc on kernel |
| **Templates** | Pre-built templates for common document types |
| **AI writing assist** | Inline completion, rewrite selection, expand outline |

---

## 12. Real Database Browser

### 12.1 New App: Database

| Task | Details |
|------|---------|
| **SQLite browser** | Query the Aether OS StateStore or any SQLite file on kernel FS |
| **PostgreSQL/MySQL** | Connect to external databases via kernel proxy |
| **Query editor** | SQL editor with autocomplete (table names, columns) |
| **Results grid** | Sortable, filterable results table |
| **Schema viewer** | Visual table structure with relationships |
| **Query history** | Save and re-run queries |
| **Agent DB tool** | Agents can query databases as part of their workflow |

---

## 13. System-Level Upgrades

### 13.1 App Store / App Manager

| Task | Details |
|------|---------|
| **App registry** | JSON manifest per app (name, icon, permissions, entry point) |
| **Install/uninstall** | Apps can be added and removed at runtime |
| **App permissions** | Apps declare what kernel APIs they need (filesystem, network, etc.) |
| **Third-party apps** | Framework for community-built apps |

### 13.2 Notification Center

| Task | Details |
|------|---------|
| **System notifications** | Toast notifications for agent events, errors, completions |
| **Notification history** | Scrollable list of past notifications |
| **Per-app notifications** | Email has new mail, calendar has reminders, agents need approval |
| **Do not disturb** | Suppress notifications during focus time |

### 13.3 Clipboard Manager

| Task | Details |
|------|---------|
| **Cross-app clipboard** | Copy in one app, paste in another (within Aether) |
| **Clipboard history** | Last N items, searchable |
| **Agent clipboard access** | Agents can read/write the clipboard programmatically |
| **Rich content** | Support text, images, file references |

### 13.4 System Monitor (Upgraded Activity Monitor)

| Task | Details |
|------|---------|
| **Real metrics** | CPU, memory, disk, network from kernel (not just widgets) |
| **Per-agent resource usage** | How much CPU/memory/API calls each agent is consuming |
| **Process list** | Real process table with kill/stop/continue controls |
| **LLM usage tracking** | Token counts, costs, latency per agent per provider |
| **Charts** | Historical graphs of resource usage |

---

## 14. Desktop Environment Upgrades

### 14.1 Multi-Desktop / Workspaces

| Task | Details |
|------|---------|
| **Virtual desktops** | Swipe or keyboard shortcut to switch between workspaces |
| **Per-workspace apps** | Different apps open on different desktops |
| **Mission Control overview** | Expose-style view of all workspaces |

### 14.2 Keyboard Shortcuts

| Task | Details |
|------|---------|
| **Global shortcuts** | Cmd+Space (Smart Bar), Cmd+Tab (app switch), Cmd+Q (close) |
| **Per-app shortcuts** | Each app registers its own shortcuts |
| **Shortcut overlay** | Cmd+/ to show all available shortcuts |
| **Customizable** | User can rebind shortcuts in Settings |

### 14.3 Drag & Drop

| Task | Details |
|------|---------|
| **File drag** | Drag files between File Explorer, Code Editor, Notes, and other apps |
| **Cross-app** | Drag an image from Photos into Notes |
| **External drop** | Drop files from the host OS into Aether apps |

### 14.4 Theming

| Task | Details |
|------|---------|
| **Light theme** | Full light mode with proper contrast |
| **Theme switching** | Toggle in Settings, applies system-wide |
| **Custom themes** | User-defined color palettes |
| **Per-window appearance** | Some apps (Terminal, Video) always dark |

---

## Priority Order

If building v0.2 incrementally, this is the recommended order:

1. **Real Browser** (Playwright) — highest impact, unlocks agent web interaction
2. **Real Code Editor** (Monaco) — developers spend most time here
3. **Notification Center** — ties everything together
4. **System Monitor upgrade** — observability is core to the OS
5. **Multi-desktop workspaces** — makes the desktop usable with many apps
6. **Keyboard shortcuts** — power users need this
7. **Music/Audio Player** — enables TTS/STT for agents
8. **PDF Viewer** — agents processing documents
9. **Spreadsheet** — agents working with data
10. **Email Client** — agents communicating externally
11. **Calendar** — scheduling and time-aware agents
12. **Database Browser** — data inspection
13. **Drawing/Whiteboard** — visual collaboration
14. **Markdown Editor** — document authoring
15. **App Store** — meta-feature for all future apps

---

## Dependencies & New Packages

```
# Kernel-side
playwright              # Real browser automation
sharp                   # Image processing
ffmpeg-static           # Video thumbnails, audio processing
imapflow                # Email (IMAP)
nodemailer              # Email (SMTP)
ical-generator          # Calendar events
pdf-parse               # PDF text extraction

# Frontend
@monaco-editor/react    # Code editor
pdfjs-dist              # PDF rendering
hls.js                  # Video streaming
hyperformula            # Spreadsheet formulas
@milkdown/core          # Markdown WYSIWYG
tldraw or excalidraw    # Drawing/whiteboard
```

---

## Success Criteria for v0.2

- [ ] Browser loads any website, not just iframe-friendly ones
- [ ] Agents can navigate, click, and read web pages through a real browser
- [ ] Code editor has real syntax highlighting, autocomplete, and multi-file support
- [ ] Video player plays local files and streams
- [ ] Photos app browses kernel FS and supports AI analysis with any provider
- [ ] At least 3 new apps are functional (from: Music, Email, Calendar, PDF, Sheets, Canvas, Writer, Database)
- [ ] Notification center is operational
- [ ] Keyboard shortcuts work globally
- [ ] Light theme exists and works
- [ ] All existing tests still pass, new features have tests
