/**
 * prq-worker.js  —  Pharmacy PRQ Input Sheet Generator
 * Implements Pharmacy PRQ Consolidation Specification v6.0
 *
 * Runs in a forked child process. Receives config via IPC message.
 * Sends { type:'done', outputPath, summary } or { type:'error', error } back.
 */

const path = require('path');
const os   = require('os');

process.on('message', async ({ config }) => {
  try {
    // Dynamic require so electron packing works
    const ExcelJS = require('exceljs');
    const XLSX    = require('xlsx');

    const {
      itemMasterPath,
      poQtyPath,
      vendorSplitPath,
      outputPath,
    } = config;

    // ─── 1. LOAD SOURCE FILES ─────────────────────────────────────────────────
    log('📂 Loading source files...');

    const imWb  = XLSX.readFile(itemMasterPath);
    const poWb  = XLSX.readFile(poQtyPath);
    const vsWb  = XLSX.readFile(vendorSplitPath);

    const imRaw = XLSX.utils.sheet_to_json(imWb.Sheets[imWb.SheetNames[0]], { defval: '' });
    const poRaw = XLSX.utils.sheet_to_json(poWb.Sheets[poWb.SheetNames[0]], { defval: '' });
    const vsRaw = XLSX.utils.sheet_to_json(vsWb.Sheets[vsWb.SheetNames[0]], { defval: '' });

    // Normalise Item Master columns
    // Actual headers use \r\n (carriage-return + newline): "Drug\r\nCode", "Drug\r\nDescription"
    const itemMaster = {};
    imRaw.forEach(r => {
      const code = String(
        r['Drug\r\nCode'] || r['Drug\nCode'] || r['Drug Code'] || r['Item Code'] || ''
      ).trim();
      if (!code) return;
      itemMaster[code] = {
        itemName:     String(r['Drug\r\nDescription'] || r['Drug\nDescription'] || r['Drug Description'] || r['Item Name'] || '').trim(),
        manufacturer: String(r['Manufacture']         || r['Manufacturer']      || '').trim(),
        vendor:       String(r['vendor']               || r['Vendor']           || '').trim(),
        unitPrice:    parseFloat(r['Rate']             || r['Unit Price']       || 0) || 0,
      };
    });
    log(`  ✅ Item Master: ${Object.keys(itemMaster).length} items`);

    // PO Qty Sheet  (Item Code, P O Qty / PO Qty, Priority)
    const poMap = {};
    let poTotalRow = null;
    poRaw.forEach(r => {
      const code = String(r['Item Code'] || '').trim();
      if (!code || code.toUpperCase() === 'TOTAL') { poTotalRow = r; return; }
      const qty  = parseInt(r['P O Qty'] || r['PO Qty'] || r['PO_Qty'] || 0) || 0;
      const pri  = String(r['Priority'] || 'Normal').trim();
      if (qty <= 0) return;
      poMap[code] = { qty, priority: pri === 'High' ? 'High' : 'Normal' };
    });
    log(`  ✅ PO Qty Sheet: ${Object.keys(poMap).length} items`);

    // Vendor Split Sheet  (Vendor, Split_Condition, Manufacturer in case of conditional_split)
    const vendorSplit = {};
    vsRaw.forEach(r => {
      const vendor = String(r['Vendor'] || '').trim();
      if (!vendor) return;
      const cond   = String(r['Split_Condition'] || r['Split Condition'] || '').trim();
      const mfrRaw = String(r['Manufacturer in case of conditional_split'] ||
                            r['Manufacturer (Always & Conditional Split)'] || '').trim();

      // Normalise condition to uppercase with underscores
      let condition = 'NO_SPLIT';
      if (/always/i.test(cond))       condition = 'ALWAYS_SPLIT';
      else if (/conditional/i.test(cond)) condition = 'CONDITIONAL_SPLIT';
      else if (/no_split/i.test(cond))    condition = 'NO_SPLIT';

      vendorSplit[vendor] = {
        condition,
        mfrList: mfrRaw ? mfrRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
      };
    });
    log(`  ✅ Vendor Split Sheet: ${Object.keys(vendorSplit).length} vendors`);

    // ─── 2. BUILD PRQ ROWS ────────────────────────────────────────────────────
    log('🔨 Building PRQ rows...');
    const warnings = [];
    const rows = [];
    const seenItemVendor = new Set();

    for (const [itemCode, po] of Object.entries(poMap)) {
      const im = itemMaster[itemCode];
      if (!im) {
        warnings.push(`❌ Item Code ${itemCode} not found in Item Master — skipped`);
        continue;
      }

      // Pick the IM row: if duplicate item codes in IM just use first
      const vendor      = im.vendor;
      const vs          = vendorSplit[vendor];
      const splitCond   = vs ? vs.condition : 'NO_SPLIT';
      const mfrSplit    = vs ? vs.mfrList.join(', ') : '';

      if (!vs) warnings.push(`⚠ Vendor "${vendor}" not found in Vendor Split Sheet — defaulting to NO_SPLIT`);

      // Duplicate item+vendor check
      const dupKey = `${itemCode}||${vendor}`;
      if (seenItemVendor.has(dupKey)) {
        warnings.push(`⚠ Duplicate Item Code+Vendor: ${itemCode} / ${vendor} — skipped`);
        continue;
      }
      seenItemVendor.add(dupKey);

      // Col J: blank for NO_SPLIT, populated for others
      const mfrAlwaysConditional = splitCond === 'NO_SPLIT' ? '' : mfrSplit;

      rows.push({
        itemCode,
        itemName:     im.itemName,
        manufacturer: im.manufacturer,
        vendor,
        unitPrice:    im.unitPrice,
        poQty:        po.qty,
        value:        im.unitPrice * po.qty,
        priority:     po.priority,
        splitCondition: splitCond,
        mfrAlwaysConditional,
      });
    }

    log(`  ✅ ${rows.length} valid PRQ rows built  (${warnings.length} warnings)`);
    warnings.forEach(w => log('  ' + w));

    // ─── 3. COLLECT UNIQUE VENDORS FOR SUMMARY ────────────────────────────────
    const vendorSet = [...new Set(rows.map(r => r.vendor))].sort();
    log(`  📊 ${vendorSet.length} unique vendors`);

    // ─── 4. WRITE EXCEL OUTPUT ────────────────────────────────────────────────
    log('📝 Writing Excel output...');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Pharmacy PRQ Tool';
    wb.created = new Date();

    const ws = wb.addWorksheet('PRQ Input');

    // ── Column widths ──
    ws.columns = [
      { key: 'A', width: 14 },   // Item Code
      { key: 'B', width: 38 },   // Item Name
      { key: 'C', width: 32 },   // Manufacturer
      { key: 'D', width: 38 },   // Vendor
      { key: 'E', width: 13 },   // Unit Price
      { key: 'F', width: 11 },   // PO Qty
      { key: 'G', width: 14 },   // Value
      { key: 'H', width: 11 },   // Priority
      { key: 'I', width: 20 },   // Split Condition
      { key: 'J', width: 42 },   // Mfr Always/Conditional
      { key: 'K', width: 4  },   // Buffer
      { key: 'L', width: 4  },   // Buffer
      { key: 'M', width: 38 },   // Vendor Name
      { key: 'N', width: 13 },   // Item Count
      { key: 'O', width: 13 },   // Total PO Qty
      { key: 'P', width: 14 },   // Total Value
    ];

    // ── Styles ──
    const headerFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    const headerFont   = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const headerAlign  = { horizontal: 'center', vertical: 'middle', wrapText: true };
    const summaryFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5597' } };
    const totalFill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
    const totalFont    = { name: 'Arial', size: 10, bold: true };
    const thinBorder   = {
      top: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      left: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      right: { style: 'thin', color: { argb: 'FFB0C4DE' } },
    };
    const cellFont     = { name: 'Arial', size: 9 };
    const centerAlign  = { horizontal: 'center', vertical: 'middle' };
    const rightAlign   = { horizontal: 'right', vertical: 'middle' };

    // ── ROW 1: Main header ──
    const hdrRow = ws.getRow(1);
    hdrRow.height = 30;

    const headers = [
      'Item Code', 'Item Name', 'Manufacturer', 'Vendor',
      'Unit Price', 'PO Qty', 'Value\n(Unit Price × PO Qty)',
      'Priority', 'Split Condition', 'Manufacturer\n(Always & Conditional Split)',
    ];
    headers.forEach((h, i) => {
      const cell = hdrRow.getCell(i + 1);
      cell.value = h;
      cell.font = headerFont;
      cell.fill = headerFill;
      cell.alignment = headerAlign;
      cell.border = thinBorder;
    });

    // ── DATA ROWS 2–301 ──
    const alternateOdd  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFCFF' } };
    const alternateEven = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };
    const highPriFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };

    for (let i = 0; i < 300; i++) {
      const excelRow = i + 2; // rows 2–301
      const row = rows[i];
      const wsRow = ws.getRow(excelRow);
      wsRow.height = 16;

      if (row) {
        const isHigh = row.priority === 'High';
        const rowFill = isHigh ? highPriFill : (i % 2 === 0 ? alternateOdd : alternateEven);

        const vals = [
          row.itemCode,
          row.itemName,
          row.manufacturer,
          row.vendor,
          row.unitPrice,
          row.poQty,
          { formula: `=IF(AND(E${excelRow}<>"",F${excelRow}<>""),E${excelRow}*F${excelRow},"")` },
          row.priority,
          row.splitCondition,
          row.mfrAlwaysConditional,
        ];

        vals.forEach((v, ci) => {
          const cell = wsRow.getCell(ci + 1);
          cell.value = v;
          cell.font = cellFont;
          cell.fill = rowFill;
          cell.border = thinBorder;
          cell.alignment = { vertical: 'middle', wrapText: false };

          // Specific formatting
          if (ci === 4) { // Unit Price
            cell.numFmt = '#,##0.00';
            cell.alignment = { ...rightAlign };
          } else if (ci === 5) { // PO Qty
            cell.numFmt = '#,##0';
            cell.alignment = { ...rightAlign };
          } else if (ci === 6) { // Value
            cell.numFmt = '#,##0.00';
            cell.alignment = { ...rightAlign };
          } else if (ci === 7) { // Priority
            cell.alignment = { ...centerAlign };
            if (isHigh) cell.font = { ...cellFont, bold: true, color: { argb: 'FF7B3600' } };
          } else if (ci === 8) { // Split Condition
            cell.alignment = { ...centerAlign };
            // Colour-code split condition
            if (row.splitCondition === 'ALWAYS_SPLIT')       cell.font = { ...cellFont, color: { argb: 'FF1F5C2E' } };
            else if (row.splitCondition === 'CONDITIONAL_SPLIT') cell.font = { ...cellFont, color: { argb: 'FF4A235A' } };
            else                                              cell.font = { ...cellFont, color: { argb: 'FF555555' } };
          }
        });
      } else {
        // Empty rows — still bordered for clarity
        for (let ci = 1; ci <= 10; ci++) {
          const cell = wsRow.getCell(ci);
          cell.font = cellFont;
          cell.border = thinBorder;
          cell.fill = i % 2 === 0 ? alternateOdd : alternateEven;
        }
      }
    }

    // ── ROW 302: TOTAL row ──
    const totalRow = ws.getRow(302);
    totalRow.height = 18;

    // Merge A302:D302 → "TOTAL"
    ws.mergeCells('A302:D302');
    const totalLabelCell = totalRow.getCell(1);
    totalLabelCell.value = 'TOTAL';
    totalLabelCell.font = totalFont;
    totalLabelCell.fill = totalFill;
    totalLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };
    totalLabelCell.border = thinBorder;

    // E302 empty
    const e302 = totalRow.getCell(5);
    e302.fill = totalFill; e302.border = thinBorder;

    // F302: =SUM(F2:F301)
    const f302 = totalRow.getCell(6);
    f302.value = { formula: '=SUM(F2:F301)' };
    f302.numFmt = '#,##0';
    f302.font = totalFont;
    f302.fill = totalFill;
    f302.border = thinBorder;
    f302.alignment = rightAlign;

    // G302: SUMPRODUCT
    const g302 = totalRow.getCell(7);
    g302.value = { formula: '=SUMPRODUCT((E2:E301<>"")*IFERROR(E2:E301*F2:F301,0))' };
    g302.numFmt = '#,##0.00';
    g302.font = totalFont;
    g302.fill = totalFill;
    g302.border = thinBorder;
    g302.alignment = rightAlign;

    // H302–J302 empty
    for (let ci = 8; ci <= 10; ci++) {
      const c = totalRow.getCell(ci);
      c.fill = totalFill; c.border = thinBorder;
    }

    // ── Auto-filter on row 1 cols A-J ──
    ws.autoFilter = { from: 'A1', to: 'J1' };

    // ── Freeze panes row 1 ──
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // ── VENDOR SUMMARY (Cols M–P) ──
    // Row 1: label merged M1:P1
    ws.mergeCells('M1:P1');
    const vsLabel = ws.getCell('M1');
    vsLabel.value = 'VENDOR SUMMARY';
    vsLabel.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    vsLabel.fill = summaryFill;
    vsLabel.alignment = { horizontal: 'center', vertical: 'middle' };
    vsLabel.border = thinBorder;

    // Row 2: summary headers
    const vsHdrRow = ws.getRow(2);
    vsHdrRow.height = 22;
    ['Vendor Name', 'Item Count', 'Total PO Qty', 'Total Value'].forEach((h, i) => {
      const cell = vsHdrRow.getCell(13 + i); // M=13
      cell.value = h;
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5597' } };
      cell.alignment = headerAlign;
      cell.border = thinBorder;
    });

    // Rows 3–62: one per vendor
    const vsFill1 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFCFF' } };
    const vsFill2 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };

    for (let vi = 0; vi < 60; vi++) {
      const excelRow = vi + 3; // rows 3–62
      const wsRow = ws.getRow(excelRow);
      wsRow.height = 15;
      const vsFill = vi % 2 === 0 ? vsFill1 : vsFill2;
      const vendor = vendorSet[vi] || '';

      // M: Vendor Name
      const mCell = wsRow.getCell(13);
      mCell.value = vendor;
      mCell.font = { name: 'Arial', size: 9 };
      mCell.fill = vsFill;
      mCell.border = thinBorder;
      mCell.alignment = { vertical: 'middle' };

      // N: Item Count
      const nCell = wsRow.getCell(14);
      nCell.value = vendor ? { formula: `=IF(M${excelRow}<>"",COUNTIF($D$2:$D$301,M${excelRow}),"")` } : '';
      nCell.numFmt = '#,##0';
      nCell.font = { name: 'Arial', size: 9 };
      nCell.fill = vsFill;
      nCell.border = thinBorder;
      nCell.alignment = rightAlign;

      // O: Total PO Qty
      const oCell = wsRow.getCell(15);
      oCell.value = vendor ? { formula: `=IF(M${excelRow}<>"",SUMIF($D$2:$D$301,M${excelRow},$F$2:$F$301),"")` } : '';
      oCell.numFmt = '#,##0';
      oCell.font = { name: 'Arial', size: 9 };
      oCell.fill = vsFill;
      oCell.border = thinBorder;
      oCell.alignment = rightAlign;

      // P: Total Value
      const pCell = wsRow.getCell(16);
      pCell.value = vendor ? { formula: `=IF(M${excelRow}<>"",SUMPRODUCT(($D$2:$D$301=M${excelRow})*$E$2:$E$301*$F$2:$F$301),"")` } : '';
      pCell.numFmt = '#,##0.00';
      pCell.font = { name: 'Arial', size: 9 };
      pCell.fill = vsFill;
      pCell.border = thinBorder;
      pCell.alignment = rightAlign;
    }

    // Row 63: GRAND TOTAL
    const gtRow = ws.getRow(63);
    gtRow.height = 18;

    const gtLbl = gtRow.getCell(13);
    gtLbl.value = 'GRAND TOTAL';
    gtLbl.font = totalFont;
    gtLbl.fill = totalFill;
    gtLbl.border = thinBorder;
    gtLbl.alignment = { horizontal: 'center', vertical: 'middle' };

    // N63: sum of N3:N62
    const gtN = gtRow.getCell(14);
    gtN.value = { formula: '=SUM(N3:N62)' };
    gtN.numFmt = '#,##0';
    gtN.font = totalFont;
    gtN.fill = totalFill;
    gtN.border = thinBorder;
    gtN.alignment = rightAlign;

    // O63
    const gtO = gtRow.getCell(15);
    gtO.value = { formula: '=SUM(O3:O62)' };
    gtO.numFmt = '#,##0';
    gtO.font = totalFont;
    gtO.fill = totalFill;
    gtO.border = thinBorder;
    gtO.alignment = rightAlign;

    // P63
    const gtP = gtRow.getCell(16);
    gtP.value = { formula: '=SUM(P3:P62)' };
    gtP.numFmt = '#,##0.00';
    gtP.font = totalFont;
    gtP.fill = totalFill;
    gtP.border = thinBorder;
    gtP.alignment = rightAlign;

    // ── Save ──
    await wb.xlsx.writeFile(outputPath);
    log(`✅ Output written → ${outputPath}`);

    // ─── SUMMARY ──────────────────────────────────────────────────────────────
    const totalQty   = rows.reduce((s, r) => s + r.poQty, 0);
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const highCount  = rows.filter(r => r.priority === 'High').length;

    const splitSummary = { NO_SPLIT: 0, ALWAYS_SPLIT: 0, CONDITIONAL_SPLIT: 0 };
    rows.forEach(r => { splitSummary[r.splitCondition] = (splitSummary[r.splitCondition] || 0) + 1; });

    const summary = {
      totalRows:   rows.length,
      totalQty,
      totalValue,
      highCount,
      vendors:     vendorSet.length,
      warnings:    warnings.length,
      splitSummary,
    };

    process.send({ type: 'done', outputPath, summary });
  } catch (err) {
    log(`❌ Fatal error: ${err.message}\n${err.stack}`);
    process.send({ type: 'error', error: err.message });
  }
});

function log(msg) { process.stdout.write(msg + '\n'); }
