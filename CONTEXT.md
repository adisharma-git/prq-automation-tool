# CONTEXT.md — Pharmacy PRQ Tool

> This file is the single source of truth for any AI assistant, new developer,
> or LLM working on this codebase. Read this before touching any file.

---

## What this project is

A two-module **Electron desktop app** built for the Pharmacy Procurement team at
**SEPL / Amrita Hospital Faridabad**. It runs natively on macOS and Windows.

| Module | What it does |
|--------|-------------|
| **Module 1 — PRQ Generator** | Reads three Excel source files, applies business logic from the Pharmacy PRQ Consolidation Spec v6.0, and writes a formatted `PRQ_Input_<YYYY-MM-DD>.xlsx` output file |
| **Module 2 — Browser Launcher** | Puppeteer-powered browser automation with a no-code action builder (click / type / wait / scroll) and screenshot capture |

---

## Repository layout

```
pharmacy-prq-tool/
│
├── .github/
│   └── workflows/
│       ├── build-release.yml   # ← CRITICAL: cross-platform build + GitHub Release
│       └── ci.yml              # Syntax + spec-compliance check on every push/PR
│
├── src/
│   ├── main.js                 # Electron main process — IPC hub for both modules
│   ├── preload.js              # Context-bridge (contextIsolation: true, no nodeIntegration)
│   ├── index.html              # Full UI — two-module tabbed dark-mode app
│   ├── prq-worker.js           # ← CORE LOGIC: PRQ generation, Spec v6.0
│   └── puppeteer-worker.js     # Browser automation worker
│
├── assets/                     # App icons (icon.icns · icon.ico · icon.png) — add yours here
├── docs/                       # Placeholder for screenshots / additional docs
│
├── CONTEXT.md                  # ← YOU ARE HERE
├── README.md                   # User-facing docs, badges, install instructions
├── CHANGELOG.md                # Versioned release notes (parsed by build-release.yml)
├── CONTRIBUTING.md             # Contribution guide
├── GITHUB_SETUP.md             # Step-by-step: push to GitHub + trigger first release
├── .gitignore                  # Excludes node_modules, dist, .env, PRQ_Input_*.xlsx
└── package.json                # Electron-builder config + all npm scripts
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Renderer Process  (src/index.html)                 │
│  ─ Two-tab UI: PRQ Generator │ Browser Launcher     │
│  ─ Pure HTML/CSS/JS, no framework                   │
│  ─ Communicates via window.api (contextBridge)      │
└────────────────────┬────────────────────────────────┘
                     │  contextBridge  (src/preload.js)
                     │  contextIsolation: true
                     │  nodeIntegration: false
┌────────────────────▼────────────────────────────────┐
│  Main Process  (src/main.js)                        │
│  ─ ipcMain.handle('generate-prq')  ──► fork prq-worker.js    │
│  ─ ipcMain.handle('run-puppeteer') ──► fork puppeteer-worker.js │
│  ─ ipcMain.handle('pick-file')     dialog.showOpenDialog      │
│  ─ ipcMain.handle('pick-save-path')                           │
│  ─ ipcMain.handle('pick-folder')                              │
│  ─ ipcMain.handle('show-in-finder') shell.showItemInFolder    │
└────────────────────┬────────────────────────────────┘
          ┌──────────┴──────────┐
          │ fork()              │ fork()
          ▼                     ▼
┌──────────────────┐  ┌──────────────────────┐
│  prq-worker.js   │  │  puppeteer-worker.js │
│  (child process) │  │  (child process)     │
│  reads xlsx      │  │  Puppeteer browser   │
│  writes ExcelJS  │  │  automation          │
│  logs via stdout │  │  logs via stdout     │
└──────────────────┘  └──────────────────────┘
```

**Why forked child processes?** File I/O and browser automation can take 5–30 seconds.
If run in the main process, the Electron UI freezes. Forking keeps the UI responsive
and lets us stream live logs back via stdout → IPC → renderer.

---

## Module 1 — PRQ Generator deep-dive

### Source files (user selects via Browse buttons)

| File | Key columns | Notes |
|------|------------|-------|
| `Item_Master.xlsx` | `Drug\r\nCode`, `Drug\r\nDescription`, `Manufacture`, `vendor`, `Rate` | **IMPORTANT:** The header cells for Drug Code and Drug Description contain a carriage-return + newline (`\r\n`), not a plain newline. The XLSX library parses them as `"Drug\r\nCode"`. The worker handles this with multi-key fallback. |
| `PO_Qty_Sheet.xlsx` | `Item Code`, `P O Qty`, `Priority` | Contains a `TOTAL` row at the bottom — skipped during processing |
| `Vendor_Split_Sheet.xlsx` | `Vendor`, `Split_Condition`, `Manufacturer in case of conditional_split` | `Split_Condition` values are mixed-case in the source (`Always_Split`, `Conditional_Split`, `No_Split`) — normalised to uppercase+underscore in the worker |

### Output: `PRQ_Input_<YYYY-MM-DD>.xlsx`, sheet name `PRQ Input`

```
Cols A–J   Main PRQ Table
           Row 1:     Header (frozen, auto-filter A1:J1)
           Rows 2–301: Data (300 slots; unused rows are empty but still bordered)
           Row 302:    TOTAL row (A–D merged, F=SUM, G=SUMPRODUCT)

Cols K–L   Buffer (empty)

Cols M–P   Vendor Summary
           Row 1:    "VENDOR SUMMARY" label merged M1:P1
           Row 2:    Headers
           Rows 3–62: One row per unique vendor (up to 60); Col M manually entered
           Row 63:   GRAND TOTAL (SUM formulas)
```

### Column mapping (A–J) — Spec v6.0

| Col | Name | Formula / Source |
|-----|------|-----------------|
| A | Item Code | Item Master `Drug\r\nCode` |
| B | Item Name | Item Master `Drug\r\nDescription` |
| C | Manufacturer | Item Master `Manufacture` |
| D | Vendor | Item Master `vendor` |
| E | Unit Price | Item Master `Rate` — format `#,##0.00` |
| F | PO Qty | PO Qty Sheet `P O Qty` — format `#,##0` |
| G | Value | `=IF(AND(E<>"",F<>""),E*F,"")` — format `#,##0.00` — **never hardcode** |
| H | Priority | PO Qty Sheet `Priority` (`High` / `Normal`) |
| I | Split Condition | Vendor Split Sheet `Split_Condition` → normalised to `NO_SPLIT` / `ALWAYS_SPLIT` / `CONDITIONAL_SPLIT` |
| J | Manufacturer (Always & Conditional Split) | Vendor Split Sheet `Manufacturer in case of conditional_split` — **blank for NO_SPLIT**, populated for the other two |

### Split condition logic

```
NO_SPLIT          → all items for this vendor in one PRQ
ALWAYS_SPLIT      → one PRQ per manufacturer (Col C)
CONDITIONAL_SPLIT → manufacturers listed in Col J each get own PRQ;
                    all other manufacturers are lumped into one combined PRQ

13/10 chunking rule (applies to all three conditions):
  ≤ 13 items  → keep as one PRQ
  > 13 items  → split into chunks of 10; remainder = final PRQ
  e.g. 23 → [10, 10, 3]
```

### Data validation (in prq-worker.js)

| Condition | Action |
|-----------|--------|
| Item Code not in Item Master | Skip row + log `❌ Item Code X not found` |
| Vendor not in Vendor Split Sheet | Default to `NO_SPLIT` + log `⚠ Vendor "X" not found` |
| Duplicate Item Code + Vendor | Skip row + log `⚠ Dup: X/Y` |
| PO Qty ≤ 0 or blank | Skip row (silent) |
| `TOTAL` row in PO Qty Sheet | Skip (it's a summary row, not a drug) |

### Key numbers (from real data, March 2026)

| Metric | Value |
|--------|-------|
| Item Master rows | ~2,382 |
| PO Qty items (typical run) | 50 |
| Vendors in Vendor Split Sheet | 113 |
| Vendors in a typical PRQ run | 6 |
| Typical total PRQ value | ~₹9,75,773 |
| ALWAYS_SPLIT vendors (%) | ~64% |
| CONDITIONAL_SPLIT vendors (%) | ~24% |
| NO_SPLIT vendors (%) | ~12% |

---

## Module 2 — Browser Launcher deep-dive

- **Entry point:** `src/puppeteer-worker.js`
- Receives config via IPC: `{ url, saveFolder, headless, actions[] }`
- Actions are processed sequentially: `click` → `waitForSelector` + `page.click()`; `type` → `waitForSelector` + `page.type()`; `wait` → `sleep(ms)`; `scroll` → `page.evaluate(scrollTo)`
- Screenshot saved as `screenshot-<ISO-timestamp>.png` in `saveFolder` (default: `~/Desktop`)
- To change the **default URL**, edit line ~22 of `puppeteer-worker.js`: `url = 'https://example.com'`
- To add **hardcoded automation steps**, add them after `await page.goto(...)` in `puppeteer-worker.js`

---

## GitHub Actions — CI/CD

### build-release.yml — triggered by `git tag v*.*.*`

```
Tag push (v1.0.0)
    │
    ├── build-mac    (macos-latest)
    │   npx electron-builder --mac --x64 --arm64 --publish never
    │   → uploads dist/*.dmg as artifact "mac-dist"
    │
    ├── build-windows  (windows-latest)
    │   npx electron-builder --win --x64 --publish never
    │   → uploads dist/*.exe as artifact "win-dist"
    │
    └── release  (ubuntu-latest, needs both above)
        downloads both artifacts
        reads release notes from CHANGELOG.md
        creates GitHub Release via softprops/action-gh-release@v2
        attaches .dmg + .exe
```

**Critical:** `--publish never` must appear on every `electron-builder` invocation.
Without it, electron-builder calls the GitHub Releases API during the build to check
for existing releases — failing with 404 because the release doesn't exist yet.
`GITHUB_TOKEN` must only appear in the **release job**, never in the build jobs.

### ci.yml — triggered on every push to `main`/`develop` and every PR

- Checks all `.js` files with `node --check` (syntax validation)
- Validates that key spec v6.0 tokens exist in `prq-worker.js` (NO_SPLIT, ALWAYS_SPLIT, CONDITIONAL_SPLIT, correct formulas, sheet name, freeze panes, etc.)

---

## How to make a new release

```bash
# 1. Edit src/ files as needed
# 2. Bump version
#    - package.json → "version": "1.1.0"
#    - CHANGELOG.md → add ## [1.1.0] — YYYY-MM-DD section
# 3. Commit
git add package.json CHANGELOG.md
git commit -m "chore: release v1.1.0"
# 4. Tag + push (triggers GitHub Actions)
git tag v1.1.0
git push && git push --tags
```

---

## Dependencies

| Package | Version | Why |
|---------|---------|-----|
| `electron` | ^29 | Desktop app shell |
| `electron-builder` | ^24 | Cross-platform packaging (.dmg, .exe, AppImage) |
| `exceljs` | ^4.4 | Writing the PRQ output `.xlsx` with full formatting, formulas, merged cells |
| `xlsx` | ^0.18 | Reading the source `.xlsx` files (SheetJS — fast and reliable for reading) |
| `puppeteer` | ^22 | Browser automation in Module 2 |

**Why two Excel libraries?** `xlsx` (SheetJS) is excellent at reading any `.xlsx` reliably.
`exceljs` gives fine-grained control over cell formatting, borders, fills, merged cells,
and frozen panes needed for the PRQ output. Using both is intentional.

---

## Known edge cases

| Edge case | How it's handled |
|-----------|-----------------|
| `BLN015` appears twice in Item Master | Both rows have the same Item Code with slightly different names (`Bleocin 15mg Inj` vs `Bleocin 15Unit Inj`). The first match wins — the worker uses a map so only the first entry for each code is stored. |
| `DUEN20` appears twice in Item Master | Same situation — first match used |
| Item Master header has `\r\n` not `\n` | Worker uses multi-key fallback: tries `Drug\r\nCode` first, then `Drug\nCode`, then `Drug Code`, then `Item Code` |
| PO Qty Sheet has a `TOTAL` row | Detected by `code.toUpperCase() === 'TOTAL'` and skipped |
| Vendor name case-sensitivity | Vendor names must match **exactly** between Item Master and Vendor Split Sheet (including spaces, capitalisation, abbreviations like `Pvt.Ltd` vs `Pvt. Ltd`) |
| More than 60 unique vendors | Vendor Summary only has 60 rows (per spec). Rows beyond 60 are not shown in the summary but are still present in the main table |
| More than 300 PRQ items | Main table only has 300 data rows (per spec). Items beyond 300 are silently not written |

---

## Environment / dev setup

```bash
# Prerequisites
node --version   # must be >= 18
npm --version    # must be >= 9

# Install
npm install      # also runs electron-builder install-app-deps via postinstall

# Run in dev
npm start

# Build locally (no GitHub needed)
npm run build:mac    # macOS only — requires macOS host
npm run build:win    # Windows only — requires Windows host (or Wine on Linux)
```

---

## What NOT to do

- **Never** pass `GH_TOKEN` or `GITHUB_TOKEN` to the `electron-builder` build steps
- **Never** add a `"publish"` block to `package.json` — it causes electron-builder to call GitHub API during builds
- **Never** hardcode the Value column (Col G) — it must always be an Excel formula
- **Never** manually edit the Vendor Summary formulas (Cols N–P) — they are formula-driven
- **Never** change the sheet name from `PRQ Input` — the spec requires this exactly
- **Never** change the column order — Spec v6.0 defines A–J explicitly and PRQ users rely on fixed column positions

---

## Spec version

This codebase implements **Pharmacy PRQ Consolidation Specification v6.0**
(March 2026, authored by SEPL Pharmacy Procurement).

The spec document is `Pharmacy_PRQ_Spec_v6.docx` (not committed to the repo —
keep it in the team SharePoint / Google Drive).

Key changes in v6.0 vs v5.0:
- Col I renamed to "Manufacturer (Always & Conditional Split)" — now populated for ALWAYS_SPLIT too
- Value moved from Col J → Col G
- Vendor Summary moved to Cols M–P (was L–O)
- Full split logic (Section 7) documented for the first time
