# Changelog

All notable changes to **Pharmacy PRQ Tool** are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

_Changes staged for the next release._

---

## [1.0.0] — 2026-03-28

### 🎉 Initial Release

#### Module 1 — PRQ Generator

- **Full implementation of Pharmacy PRQ Consolidation Spec v6.0**
- Reads three source files: Item Master, PO Qty Sheet, Vendor Split Sheet
- Generates `PRQ_Input_<YYYY-MM-DD>.xlsx` with sheet name **PRQ Input**
- **Column layout (A–J):** Item Code, Item Name, Manufacturer, Vendor, Unit Price, PO Qty, Value, Priority, Split Condition, Manufacturer (Always & Conditional Split)
- Col G formula-driven: `=IF(AND(E<>"",F<>""),E*F,"")` — never hardcoded
- TOTAL row 302: `=SUM(F2:F301)` and `=SUMPRODUCT(...)` for total value
- **Vendor Summary (Cols M–P):** COUNTIF / SUMIF / SUMPRODUCT formulas auto-populate for all unique vendors; GRAND TOTAL row
- Freeze panes on row 1; auto-filter on A1:J1
- Colour-coded rows: High-priority items in amber, Split Condition in green/purple/grey
- **Split Condition support:**
  - `NO_SPLIT` — all items in one PRQ
  - `ALWAYS_SPLIT` — one PRQ per manufacturer; Col J populated
  - `CONDITIONAL_SPLIT` — listed manufacturers split; rest combined; Col J populated
- **Data validation:**
  - Missing Item Codes flagged and skipped (not silently dropped)
  - Unknown vendors default to NO_SPLIT with warning logged
  - Duplicate Item Code + Vendor pairs detected and skipped
  - PO Qty ≤ 0 rows skipped
- Live log streamed to UI during generation
- Post-generation stats: row count, vendor count, total qty, total value (₹), high-priority count, split-condition breakdown, warning count
- One-click **Reveal in Finder / Explorer** for generated file

#### Module 2 — Browser Launcher

- Full Puppeteer-powered browser automation
- **Start button** triggers navigation + optional actions
- Configurable target URL, save folder, headless mode toggle
- **Action builder UI:** add click / type / wait / scroll steps without coding
- Live log output for all Puppeteer events
- Screenshot saved as `screenshot-<timestamp>.png` to chosen folder
- One-click reveal of screenshot in Finder / Explorer

#### App Shell

- Dark-mode Electron shell with macOS native titlebar inset
- Sidebar navigation between both modules
- Two-module IPC architecture — workers run in separate child processes (UI never blocked)
- Context-isolated renderer (no `nodeIntegration`) for security

#### Infrastructure

- Cross-platform build via GitHub Actions:
  - macOS Universal DMG (x64 + arm64) on `macos-latest`
  - Windows NSIS installer (x64) on `windows-latest`
- CI pipeline validates syntax + spec compliance on every push and PR
- Releases automatically published to GitHub Releases on version tag push

### Known Limitations

- Code signing not configured by default — macOS Gatekeeper will prompt on first launch; see README for workaround
- 13/10 chunking rule (PRQ Splitter Spec v3) drives PRQ _grouping_ logic; the Generated PRQs output sheet is planned for v1.1.0
- Maximum 300 PRQ data rows and 60 vendors in Vendor Summary (per spec); rows beyond this are silently ignored

---

## [0.9.0] — 2026-03-25 _(pre-release, internal only)_

- Initial Puppeteer Launcher prototype (Module 2 only)
- Basic Electron shell with Start button
- macOS DMG build tested manually

---

[Unreleased]: https://github.com/adisharma-git/pharmacy-prq-tool/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/adisharma-git/pharmacy-prq-tool/releases/tag/v1.0.0
[0.9.0]: https://github.com/adisharma-git/pharmacy-prq-tool/releases/tag/v0.9.0
