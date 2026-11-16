export interface ExcelNote {
  companyId: 'tri' | 'tmy';
  number: string;
  date: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  page: number;
  totalPages: number;
  maker: string;
  keeper: string;
  salesperson: string;
  deliveryPerson: string;
  totalAmount: string;
  items: Array<{
    name: string;
    specification: string;
    unit: string;
    quantity: string;
    unitPrice: string;
    amount: string;
    remark: string;
    orderNumber?: string;
  }>;
}
import AdmZip from 'adm-zip';
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';

const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const printableRowsPerNote = 20;
const printableColumnByCompany = { tri: 'N', tmy: 'M' } as const;
const printableColumnNumberByCompany = { tri: 14, tmy: 13 } as const;
const printableSheetNameByCompany = {
  tri: '趣趣特送货单打印模板 ',
  tmy: '天美意送货单打印模板 ',
} as const;

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnNumber(reference: string) {
  return [...reference.replace(/\d/g, '')].reduce(
    (value, character) => value * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function rowNumber(reference: string) {
  return Number(reference.replace(/\D/g, '') || 0);
}

function offsetReference(reference: string, rowOffset: number) {
  return reference.replace(
    /([A-Z]+)(\d+)/g,
    (_match, column, row) => `${column}${Number(row) + rowOffset}`,
  );
}

function findCell(document: XmlDocument, reference: string) {
  return [...document.getElementsByTagName('c')].find(
    (cell) => cell.getAttribute('r') === reference,
  );
}

function ensureCell(document: XmlDocument, reference: string) {
  const existing = findCell(document, reference);
  if (existing) return existing;
  const rowNumber = reference.replace(/\D/g, '');
  const row = [...document.getElementsByTagName('row')].find(
    (item) => item.getAttribute('r') === rowNumber,
  );
  if (!row) throw new Error(`Excel 模板缺少第 ${rowNumber} 行。`);
  const cell = document.createElementNS(spreadsheetNamespace, 'c');
  cell.setAttribute('r', reference);
  const nextCell = [...row.getElementsByTagName('c')].find(
    (item) => columnNumber(item.getAttribute('r') || 'A1') > columnNumber(reference),
  );
  row.insertBefore(cell, nextCell ?? null);
  return cell;
}

function clearCell(cell: XmlElement) {
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.removeAttribute('t');
}

function writeCell(document: XmlDocument, reference: string, value: string | number | undefined) {
  const cell = ensureCell(document, reference);
  clearCell(cell);
  if (value === undefined || value === '') return;
  if (typeof value === 'number') {
    const valueNode = document.createElementNS(spreadsheetNamespace, 'v');
    valueNode.appendChild(document.createTextNode(String(value)));
    cell.appendChild(valueNode);
    return;
  }
  cell.setAttribute('t', 'inlineStr');
  const inline = document.createElementNS(spreadsheetNamespace, 'is');
  const text = document.createElementNS(spreadsheetNamespace, 't');
  text.setAttribute('xml:space', 'preserve');
  text.appendChild(document.createTextNode(value));
  inline.appendChild(text);
  cell.appendChild(inline);
}

function totalOf(note: ExcelNote) {
  return Number(note.totalAmount);
}

function removeElements(document: XmlDocument, tagName: string) {
  [...document.getElementsByTagName(tagName)].forEach((element) =>
    element.parentNode?.removeChild(element),
  );
}

function trimTemplateToOneNote(document: XmlDocument) {
  [...document.getElementsByTagName('row')].forEach((row) => {
    if (Number(row.getAttribute('r') || 0) > printableRowsPerNote) row.parentNode?.removeChild(row);
  });
  const mergeCells = document.getElementsByTagName('mergeCells')[0];
  if (!mergeCells) return;
  [...mergeCells.getElementsByTagName('mergeCell')].forEach((mergeCell) => {
    const references = (mergeCell.getAttribute('ref') || '').split(':');
    if (references.some((reference) => rowNumber(reference) > printableRowsPerNote))
      mergeCell.parentNode?.removeChild(mergeCell);
  });
  mergeCells.setAttribute('count', String(mergeCells.getElementsByTagName('mergeCell').length));
}

function appendSecondNoteLayout(document: XmlDocument) {
  const sheetData = document.getElementsByTagName('sheetData')[0];
  if (!sheetData) throw new Error('Excel 模板缺少工作表数据。');
  const sourceRows = [...sheetData.getElementsByTagName('row')].filter(
    (row) => Number(row.getAttribute('r') || 0) <= printableRowsPerNote,
  );
  sourceRows.forEach((sourceRow) => {
    const row = sourceRow.cloneNode(true) as XmlElement;
    row.setAttribute('r', String(Number(sourceRow.getAttribute('r') || 0) + printableRowsPerNote));
    [...row.getElementsByTagName('c')].forEach((cell) => {
      const reference = cell.getAttribute('r');
      if (reference) cell.setAttribute('r', offsetReference(reference, printableRowsPerNote));
    });
    sheetData.appendChild(row);
  });

  const mergeCells = document.getElementsByTagName('mergeCells')[0];
  if (!mergeCells) return;
  const sourceMerges = [...mergeCells.getElementsByTagName('mergeCell')];
  sourceMerges.forEach((sourceMerge) => {
    const merge = sourceMerge.cloneNode(true) as XmlElement;
    merge.setAttribute(
      'ref',
      offsetReference(sourceMerge.getAttribute('ref') || '', printableRowsPerNote),
    );
    mergeCells.appendChild(merge);
  });
  mergeCells.setAttribute('count', String(mergeCells.getElementsByTagName('mergeCell').length));
}

function cleanPrintableSheet(document: XmlDocument, noteCount: number, companyId: 'tri' | 'tmy') {
  const finalRow = printableRowsPerNote * noteCount;
  const finalColumn = printableColumnByCompany[companyId];
  const finalColumnNumber = printableColumnNumberByCompany[companyId];
  const dimension = document.getElementsByTagName('dimension')[0];
  dimension?.setAttribute('ref', `A1:${finalColumn}${finalRow}`);

  [...document.getElementsByTagName('row')].forEach((row) => {
    const rowNumber = Number(row.getAttribute('r') || 0);
    if (rowNumber > finalRow) {
      row.parentNode?.removeChild(row);
      return;
    }
    row.setAttribute('spans', `1:${finalColumnNumber}`);
    [...row.getElementsByTagName('c')].forEach((cell) => {
      if (columnNumber(cell.getAttribute('r') || 'A1') > finalColumnNumber)
        cell.parentNode?.removeChild(cell);
    });
  });

  [...document.getElementsByTagName('col')].forEach((column) => {
    const minimum = Number(column.getAttribute('min') || 0);
    const maximum = Number(column.getAttribute('max') || 0);
    if (minimum > finalColumnNumber) column.parentNode?.removeChild(column);
    else {
      if (maximum > finalColumnNumber) column.setAttribute('max', String(finalColumnNumber));
    }
  });

  const mergeCells = document.getElementsByTagName('mergeCells')[0];
  if (mergeCells) {
    [...mergeCells.getElementsByTagName('mergeCell')].forEach((mergeCell) => {
      const references = (mergeCell.getAttribute('ref') || '').split(':');
      if (
        references.some(
          (reference) =>
            columnNumber(reference) > finalColumnNumber || rowNumber(reference) > finalRow,
        )
      )
        mergeCell.parentNode?.removeChild(mergeCell);
    });
    mergeCells.setAttribute('count', String(mergeCells.getElementsByTagName('mergeCell').length));
  }

  removeElements(document, 'dataValidations');
  removeElements(document, 'extLst');

  const sheetView = document.getElementsByTagName('sheetView')[0];
  if (sheetView) {
    [...sheetView.childNodes].forEach((child) => sheetView.removeChild(child));
    sheetView.setAttribute('showGridLines', '0');
    sheetView.setAttribute('zoomScale', '100');
    sheetView.setAttribute('zoomScaleNormal', '100');
    sheetView.removeAttribute('zoomScalePageLayoutView');
    sheetView.removeAttribute('tabSelected');
    const selection = document.createElementNS(spreadsheetNamespace, 'selection');
    selection.setAttribute('activeCell', 'A1');
    selection.setAttribute('sqref', 'A1');
    sheetView.appendChild(selection);
  }

  const pageMargins = document.getElementsByTagName('pageMargins')[0];
  if (pageMargins && noteCount === 2) {
    pageMargins.setAttribute('left', '0.196850393700787');
    pageMargins.setAttribute('right', companyId === 'tri' ? '0.118110236220472' : '0');
    pageMargins.setAttribute('top', '0');
    pageMargins.setAttribute('bottom', '0');
    pageMargins.setAttribute('header', '0');
    pageMargins.setAttribute('footer', '0');
  }

  const pageSetup = document.getElementsByTagName('pageSetup')[0];
  if (pageSetup) {
    if (noteCount === 1) {
      // Match the verified one-note workbook exactly. In particular, do not
      // write OOXML paperWidth/paperHeight: desktop Excel may repair those
      // attributes and printer drivers then apply a different orientation.
      pageSetup.setAttribute('paperSize', '9');
      pageSetup.setAttribute('fitToHeight', '0');
      pageSetup.setAttribute('orientation', 'landscape');
      pageSetup.setAttribute('verticalDpi', '180');
      pageSetup.removeAttribute('paperWidth');
      pageSetup.removeAttribute('paperHeight');
      pageSetup.removeAttribute('fitToWidth');
      pageSetup.removeAttribute('scale');
    } else {
      // Keep batch exports landscape as well. Each 20-row slip can flow to the
      // next physical sheet instead of shrinking two slips onto one portrait page.
      const sheetProperties = document.getElementsByTagName('sheetPr')[0];
      if (sheetProperties) {
        let setupProperties = sheetProperties.getElementsByTagName('pageSetUpPr')[0];
        if (!setupProperties) {
          setupProperties = document.createElementNS(spreadsheetNamespace, 'pageSetUpPr');
          sheetProperties.appendChild(setupProperties);
        }
        setupProperties.setAttribute('fitToPage', '1');
      }
      pageSetup.setAttribute('paperSize', '9');
      pageSetup.removeAttribute('paperWidth');
      pageSetup.removeAttribute('paperHeight');
      pageSetup.setAttribute('orientation', 'landscape');
      pageSetup.setAttribute('fitToWidth', '1');
      pageSetup.setAttribute('fitToHeight', '0');
    }
    // The printerSettings binary is deliberately not copied to the standalone
    // workbook. Keep the template's visible page geometry but detach the old
    // machine-specific printer relationship so Excel does not offer a repair.
    pageSetup.removeAttribute('r:id');
    pageSetup.removeAttributeNS(relationshipNamespace, 'id');
  }
}

function fillDeliverySheet(xml: string, notes: ExcelNote[]) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  trimTemplateToOneNote(document);
  if (notes.length === 2) appendSecondNoteLayout(document);

  notes.forEach((note, noteIndex) => {
    const offset = noteIndex * printableRowsPerNote;
    const reference = (column: string, row: number) => `${column}${row + offset}`;
    // Write visible text so narrow merged date cells do not degrade into #######
    // after a different spreadsheet application saves the workbook.
    writeCell(document, reference('C', 3), String(note.date || '').replaceAll('-', '/'));
    writeCell(document, reference('L', 3), note.number);
    writeCell(document, reference('J', 5), note.customerName);
    writeCell(document, reference('J', 6), note.customerAddress || '');
    writeCell(document, reference('J', 7), note.customerPhone || '');
    writeCell(document, reference('L', 7), `第${note.page || 1}页/共${note.totalPages || 1}页`);

    for (let index = 0; index < 5; index += 1) {
      const row = 9 + index;
      const item = note.items?.[index];
      writeCell(document, reference('B', row), item?.orderNumber || '');
      writeCell(document, reference('D', row), item?.name || '');
      if (note.companyId === 'tri')
        writeCell(document, reference('F', row), item?.specification || '');
      writeCell(document, reference('H', row), item?.unit || '');
      writeCell(document, reference('I', row), item ? Number(item.quantity) || 0 : undefined);
      writeCell(document, reference('J', row), item ? Number(item.unitPrice) || 0 : undefined);
      writeCell(document, reference('K', row), item ? Number(item.amount) : undefined);
      writeCell(document, reference('L', row), item?.remark || '');
    }

    const total = totalOf(note);
    writeCell(document, reference('D', 14), total);
    writeCell(document, reference('K', 14), total);
    writeCell(document, reference('B', 19), note.maker || '');
    writeCell(document, reference('E', 19), note.keeper || '');
    writeCell(document, reference('G', 19), note.salesperson || '');
    writeCell(document, reference('J', 19), note.deliveryPerson || '');
  });

  // The export is self-contained. Remaining template formulas would point to
  // worksheets that are intentionally not included in the delivery note file.
  [...document.getElementsByTagName('c')].forEach((cell) => {
    if (cell.getElementsByTagName('f').length > 0) clearCell(cell);
  });
  cleanPrintableSheet(document, notes.length, notes[0].companyId);
  return new XMLSerializer().serializeToString(document);
}

function workbookXml(
  sheets: Array<{ name: string; relationshipId: string; printRows: number; printColumn: string }>,
) {
  const sheetElements = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="${sheet.relationshipId}"/>`,
    )
    .join('');
  const definedNames = sheets
    .map(
      (sheet, index) =>
        `<definedName name="_xlnm.Print_Area" localSheetId="${index}">'${escapeXml(sheet.name).replaceAll('&apos;', "''")}'!$A$1:$${sheet.printColumn}$${sheet.printRows}</definedName>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${spreadsheetNamespace}" xmlns:r="${relationshipNamespace}">
  <fileVersion appName="xl" lastEdited="7" lowestEdited="5" rupBuild="30228"/>
  <workbookPr/>
  <bookViews><workbookView activeTab="0" firstSheet="0"/></bookViews>
  <sheets>${sheetElements}</sheets>
  <definedNames>${definedNames}</definedNames>
  <calcPr calcId="191029" fullCalcOnLoad="0"/>
</workbook>`;
}

function workbookRelationshipsXml(sheetPaths: string[]) {
  const worksheetRelationships = sheetPaths
    .map(
      (sheetPath, index) =>
        `<Relationship Id="rId${index + 1}" Type="${relationshipNamespace}/worksheet" Target="worksheets/${sheetPath.split('/').pop()}"/>`,
    )
    .join('\n  ');
  const offset = sheetPaths.length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRelationships}
  <Relationship Id="rId${offset + 1}" Type="${relationshipNamespace}/styles" Target="styles.xml"/>
  <Relationship Id="rId${offset + 2}" Type="${relationshipNamespace}/theme" Target="theme/theme1.xml"/>
  <Relationship Id="rId${offset + 3}" Type="${relationshipNamespace}/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;
}

function contentTypesXml(sheetPaths: string[]) {
  const sheetOverrides = sheetPaths
    .map(
      (sheetPath) =>
        `<Override PartName="/${sheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheetOverrides}
  <Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${relationshipNamespace}/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="${relationshipNamespace}/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function appPropertiesXml(sheetNames: string[]) {
  const titles = sheetNames.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Excel</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>工作表</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0300</AppVersion>
</Properties>`;
}

function removeUnusedPackageParts(zip: AdmZip, sheetPaths: Set<string>) {
  const exactRemovals = new Set(['xl/calcChain.xml', 'docProps/custom.xml']);
  const removablePrefixes = [
    'xl/externalLinks/',
    'xl/printerSettings/',
    'xl/drawings/',
    'xl/worksheets/_rels/',
  ];
  zip.getEntries().forEach((entry) => {
    const path = entry.entryName;
    const isUnusedWorksheet = /^xl\/worksheets\/.+\.xml$/.test(path) && !sheetPaths.has(path);
    const isComment = /^xl\/comments\d+\.xml$/.test(path);
    if (
      exactRemovals.has(path) ||
      removablePrefixes.some((prefix) => path.startsWith(prefix)) ||
      isUnusedWorksheet ||
      isComment
    )
      zip.deleteFile(path);
  });
}

export function createDeliveryWorkbook(templatePath: string, outputPath: string, note: ExcelNote) {
  createDeliveryBatchWorkbook(templatePath, outputPath, [note]);
}

export function createDeliveryBatchWorkbook(
  templatePath: string,
  outputPath: string,
  notes: ExcelNote[],
) {
  if (!notes.length || notes.length > 2) throw new Error('一次只能导出 1 至 2 张送货单。');
  const zip = new AdmZip(templatePath);
  const sheetPaths: string[] = [];
  const sheets: Array<{
    name: string;
    relationshipId: string;
    printRows: number;
    printColumn: string;
  }> = [];
  // Each company's original template has its own column widths and print area.
  // Keep mixed-company exports in one workbook with a separate sheet per company.
  for (const companyId of new Set(notes.map((note) => note.companyId))) {
    const companyNotes = notes.filter((note) => note.companyId === companyId);
    const templateSheetPath =
      companyId === 'tri' ? 'xl/worksheets/sheet7.xml' : 'xl/worksheets/sheet8.xml';
    const entry = zip.getEntry(templateSheetPath);
    if (!entry) throw new Error('原始 Excel 送货单模板不完整。');
    const index = sheetPaths.length + 1;
    const sheetPath = `xl/worksheets/sheet${index}.xml`;
    zip.addFile(
      sheetPath,
      Buffer.from(fillDeliverySheet(entry.getData().toString('utf8'), companyNotes)),
    );
    sheetPaths.push(sheetPath);
    sheets.push({
      name: printableSheetNameByCompany[companyId],
      relationshipId: `rId${index}`,
      printRows: printableRowsPerNote * companyNotes.length,
      printColumn: printableColumnByCompany[companyId],
    });
  }
  removeUnusedPackageParts(zip, new Set(sheetPaths));
  zip.updateFile('xl/workbook.xml', Buffer.from(workbookXml(sheets)));
  zip.updateFile('xl/_rels/workbook.xml.rels', Buffer.from(workbookRelationshipsXml(sheetPaths)));
  zip.updateFile('[Content_Types].xml', Buffer.from(contentTypesXml(sheetPaths)));
  zip.updateFile('_rels/.rels', Buffer.from(rootRelationshipsXml()));
  zip.updateFile(
    'docProps/app.xml',
    Buffer.from(appPropertiesXml(sheets.map((sheet) => sheet.name))),
  );
  zip.writeZip(outputPath);
}
