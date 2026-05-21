import * as XLSX from "xlsx";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string | number | null>[];
  sheetName: string;
}

export function parseExcelBuffer(buffer: ArrayBuffer): ParsedSheet[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(sheet, {
      defval: null,
    });
    const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
    return { headers, rows: jsonData, sheetName };
  });
}

export function detectSizeColumns(headers: string[]): string[] {
  const sizePatterns = [
    /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)$/i,
    /^(3[2-9]|4[0-9]|5[0-9]|6[0-9])$/,
    /^T\d+$/i,
    /^\d{1,2}(\/\d{1,2})?$/,
  ];
  return headers.filter((h) =>
    sizePatterns.some((p) => p.test(h.trim()))
  );
}

export function extractSizeQuantities(
  row: Record<string, string | number | null>,
  sizeColumns: string[]
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const col of sizeColumns) {
    const val = row[col];
    const qty = typeof val === "number" ? val : parseInt(String(val || "0"), 10);
    if (!isNaN(qty) && qty > 0) {
      result[col] = qty;
    }
  }
  return result;
}
