# Pharmacy PRQ Tool

<div align="center">

![Build & Release](https://github.com/adisharma-git/pharmacy-prq-tool/actions/workflows/build-release.yml/badge.svg)
![CI](https://github.com/adisharma-git/pharmacy-prq-tool/actions/workflows/ci.yml/badge.svg)
![Version](https://img.shields.io/github/v/release/adisharma-git/pharmacy-prq-tool?label=latest)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-UNLICENSED-red)

**A desktop app for Pharmacy Procurement at SEPL / Amrita Hospital Faridabad**

[Download Latest Release »](https://github.com/adisharma-git/pharmacy-prq-tool/releases/latest)

</div>

---

## Overview

**Pharmacy PRQ Tool** is a two-module Electron desktop application:

| Module | Purpose |
|--------|---------|
| **PRQ Generator** | Generates `PRQ_Input_<YYYY-MM-DD>.xlsx` from Item Master + PO Qty Sheet + Vendor Split Sheet, implementing Pharmacy PRQ Consolidation Spec v6.0 |
| **Browser Launcher** | Puppeteer-based browser automation with a visual action builder and screenshot capture |

---

## Download & Install

Go to [**Releases**](https://github.com/adisharma-git/pharmacy-prq-tool/releases/latest) and download:

| Platform | File | Notes |
|----------|------|-------|
| macOS (Apple Silicon + Intel) | `Pharmacy.PRQ.Tool-x.x.x.dmg` | Universal binary |
| Windows 10 / 11 | `Pharmacy.PRQ.Tool-Setup-x.x.x.exe` | NSIS installer |

### macOS

1. Open the `.dmg` file
2. Drag **Pharmacy PRQ Tool** to `/Applications`
3. Launch the app

> **Gatekeeper warning?** Go to **System Settings → Privacy & Security** and click **Open Anyway**.

### Windows

1. Run `Pharmacy.PRQ.Tool-Setup-x.x.x.exe`
2. Follow the setup wizard — a desktop shortcut is created automatically

---

## Module 1 — PRQ Generator

### How it works

```
Item_Master.xlsx   ──┐
PO_Qty_Sheet.xlsx  ──┼──► PRQ Generator ──► PRQ_Input_<YYYY-MM-DD>.xlsx
Vendor_Split.xlsx  ──┘
```

### Step-by-step

1. Click **Browse** next to each source file and select your Excel files
2. Optionally click **Choose…** next to Output File (defaults to Desktop)
3. Click **Generate PRQ Sheet**
4. Watch the live log — warnings are highlighted in amber
5. Stats panel shows: row count, vendor count, total value, high-priority count, split breakdown
6. Click the green banner to reveal the file in Finder / Explorer

### Source file column mapping

#### Item Master

| Excel Column | PRQ Column | Notes |
|---|---|---|
| `Drug Code` | A — Item Code | Primary join key; header may contain line break |
| `Drug Description` | B — Item Name | |
| `Manufacture` | C — Manufacturer | Item's actual manufacturer |
| `vendor` | D — Vendor | Join key to Vendor Split Sheet |
| `Rate` | E — Unit Price | Format: `#,##0.00` |

#### PO Qty Sheet

| Excel Column | PRQ Column | Notes |
|---|---|---|
| `Item Code` | Join key | Must match Item Master exactly |
| `P O Qty` | F — PO Qty | Format: `#,##0` |
| `Priority` | H — Priority | `High` or `Normal` |

#### Vendor Split Sheet

| Excel Column | PRQ Column | Notes |
|---|---|---|
| `Vendor` | Join key | Must match Item Master `vendor` exactly |
| `Split_Condition` | I — Split Condition | `Always_Split` / `Conditional_Split` / `No_Split` |
| `Manufacturer in case of conditional_split` | J — Manufacturer (Always & Cond. Split) | Blank for No_Split |

### Output layout

```
Cols A–J    Main PRQ Table      header row 1 · data rows 2–301 · TOTAL row 302
Cols K–L    Buffer              empty
Cols M–P    Vendor Summary      label row 1 · header row 2 · vendors 3–62 · GRAND TOTAL row 63
```

#### Main PRQ columns (A–J)

| Col | Name | Format | Source |
|-----|------|--------|--------|
| A | Item Code | text | Item Master |
| B | Item Name | text | Item Master |
| C | Manufacturer | text | Item Master |
| D | Vendor | text | Item Master |
| E | Unit Price | `#,##0.00` | Item Master |
| F | PO Qty | `#,##0` | PO Qty Sheet |
| G | Value | `#,##0.00` | `=IF(AND(E<>"",F<>""),E*F,"")` |
| H | Priority | text | PO Qty Sheet |
| I | Split Condition | text | Vendor Split Sheet |
| J | Manufacturer (Always & Conditional Split) | text | Vendor Split Sheet — blank for NO_SPLIT |

#### TOTAL row (row 302)

| Col | Formula |
|-----|---------|
| A–D | Merged · labelled **TOTAL** |
| F | `=SUM(F2:F301)` |
| G | `=SUMPRODUCT((E2:E301<>"")*IFERROR(E2:E301*F2:F301,0))` |

#### Vendor Summary formulas (rows 3–62)

| Col | Formula |
|-----|---------|
| N — Item Count | `=IF(M3<>"",COUNTIF($D$2:$D$301,M3),"")` |
| O — Total PO Qty | `=IF(M3<>"",SUMIF($D$2:$D$301,M3,$F$2:$F$301),"")` |
| P — Total Value | `=IF(M3<>"",SUMPRODUCT(($D$2:$D$301=M3)*$E$2:$E$301*$F$2:$F$301),"")` |

Grand Total of Col P must equal Total of Col G (cross-check per spec).

### Split Condition logic

| Condition | Behaviour |
|-----------|-----------|
| `NO_SPLIT` | All items for this vendor in one PRQ; 13/10 chunking if >13 items |
| `ALWAYS_SPLIT` | One PRQ per manufacturer; 13/10 chunking per group; Col J shows manufacturer |
| `CONDITIONAL_SPLIT` | Listed manufacturers get their own PRQ; rest combined; 13/10 chunking throughout |

**13/10 chunking rule:** Groups of up to 13 items stay in one PRQ. If a group exceeds 13, it splits into chunks of 10 with the remainder as the final chunk (e.g. 23 items → 10 + 10 + 3).

### Data validation rules

| Scenario | Behaviour |
|----------|-----------|
| Item Code not in Item Master | Row skipped · warning logged |
| Vendor not in Vendor Split Sheet | Defaults to NO_SPLIT · warning logged |
| Duplicate Item Code + Vendor pair | Row skipped · warning logged |
| PO Qty ≤ 0 or blank | Row skipped |
| Priority value not `High`/`Normal` | Defaults to `Normal` |
| Col J non-blank for NO_SPLIT | Enforced to blank by generator |

---

## Module 2 — Browser Launcher

Puppeteer-powered browser automation with a no-code action builder.

### Features

- Enter any target URL (default: `https://example.com` — change in the UI or in `src/puppeteer-worker.js`)
- Choose screenshot save folder (defaults to Desktop)
- Toggle **headless mode** (invisible vs visible browser)
- **Visual action builder** — no code required:

| Action | Field format | What it does |
|--------|-------------|--------------|
| `click` | CSS selector e.g. `#login-btn` | Clicks the element |
| `type` | `selector \| text` e.g. `#email \| user@example.com` | Types text into the field |
| `wait` | Milliseconds e.g. `2000` | Pauses before next step |
| `scroll` | _(leave blank)_ | Scrolls to bottom of page |

- Live log streamed during automation
- Screenshot saved as `screenshot-<ISO-timestamp>.png`
- Click the green banner to reveal the screenshot in Finder / Explorer

### Customising the automation (advanced)

Edit `src/puppeteer-worker.js` directly to add hardcoded steps after `page.goto(...)`:

```js
// Example: dismiss cookie banner, search, wait
await page.click('#cookie-accept');
await page.type('#search-input', 'pharmacy PRQ');
await page.keyboard.press('Enter');
await sleep(2000);
```

---

## Development

### Prerequisites

- Node.js ≥ 18 ([nodejs.org](https://nodejs.org))
- npm ≥ 9 (bundled with Node)

### Local setup

```bash
git clone https://github.com/adisharma-git/pharmacy-prq-tool.git
cd pharmacy-prq-tool
npm install
npm start
```

### Local builds

```bash
npm run build:mac     # → dist/Pharmacy PRQ Tool-x.x.x.dmg
npm run build:win     # → dist/Pharmacy PRQ Tool Setup x.x.x.exe
npm run build:all     # all platforms
```

### Project structure

```
pharmacy-prq-tool/
├── .github/
│   └── workflows/
│       ├── build-release.yml   # Cross-platform build + GitHub Release on version tag
│       └── ci.yml              # Syntax + spec-compliance checks on push / PR
├── src/
│   ├── main.js                 # Electron main process — IPC hub for both modules
│   ├── preload.js              # Secure context-bridge (contextIsolation: true)
│   ├── index.html              # Two-module tabbed UI
│   ├── prq-worker.js           # PRQ generation logic — Spec v6.0
│   └── puppeteer-worker.js     # Puppeteer automation (forked child process)
├── assets/                     # App icons — icon.icns · icon.ico · icon.png
├── CHANGELOG.md                # Full version history
├── README.md                   # This file
└── package.json                # Electron-builder config + dependencies
```

### Architecture

```
Renderer (index.html)
    │  contextBridge (preload.js)
    ▼
Main Process (main.js)
    ├── generate-prq  ──► fork(prq-worker.js)         reads xlsx · writes ExcelJS
    │                         └── stdout → IPC → renderer (live log)
    └── run-puppeteer ──► fork(puppeteer-worker.js)   Puppeteer automation
                              └── stdout → IPC → renderer (live log)
```

Workers run in isolated child processes — the UI never blocks during generation or automation.

---

## Releasing

### Create a release (automated)

1. Update `"version"` in `package.json`
2. Add release notes under a new `## [x.x.x]` heading in `CHANGELOG.md`
3. Commit and tag:

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release v1.1.0"
git tag v1.1.0
git push && git push --tags
```

GitHub Actions will:
- Build macOS DMG (`macos-latest` runner)
- Build Windows NSIS installer (`windows-latest` runner)
- Create a GitHub Release with both files attached and release notes pulled from `CHANGELOG.md`

### Manual trigger

**Actions → Build & Release → Run workflow** → enter version number.

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| macOS: "App can't be opened" | System Settings → Privacy & Security → Open Anyway |
| Windows: SmartScreen warning | Click **More info** → **Run anyway** |
| Item code generates two rows | The Item Master may have two entries for the same code (e.g. `BLN015`); first match is used |
| Vendor not found warning | Vendor name in Item Master must exactly match Vendor Split Sheet (case-sensitive, spaces included) |
| High-priority rows not highlighted | Ensure `Priority` column in PO Qty Sheet contains exactly `High` (capital H) |
| Screenshot not saved | Choose a writable folder in the Browser Launcher save-folder picker |
| Puppeteer launch fails on Windows | Run `npm install` after cloning — Puppeteer downloads its own Chromium on install |

---

## Spec Reference

Implements **Pharmacy PRQ Consolidation Specification v6.0** (March 2026, SEPL / Amrita Hospital Faridabad).

Key v6.0 changes implemented:
- Col I renamed to **Manufacturer (Always & Conditional Split)** — now populated for ALWAYS_SPLIT too (was blank in v5)
- Value column moved from Col J → **Col G** (grouped with quantity data)
- Column order updated: A Item Code · B Item Name · C Manufacturer · D Vendor · E Unit Price · F PO Qty · **G Value** · H Priority · I Split Condition · J Manufacturer
- Vendor Summary shifted to **Cols M–P** (was L–O)

---

## License

UNLICENSED — proprietary software for internal SEPL / Amrita Hospital Faridabad use only.
