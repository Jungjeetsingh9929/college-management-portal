// Shared CSV serialization. Extracted from three call sites that had each grown their own copy of the same row-joining loop (attendanceService.js, reportService.js.
export function csvEscape(value) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function toCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

// Sets the two response headers every CSV download route was already setting individually (with small drifts: some used res.header + res.attachment.
export function sendCsv(res, filename, headers, rows) {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}
