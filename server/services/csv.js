// Shared CSV serialization. Extracted from three call sites that had each
// grown their own copy of the same row-joining loop (attendanceService.js,
// reportService.js, routes/marks.js) — the header lists and row content stay
// exactly as each caller already built them; only the identical
// join-and-escape step underneath is now written once.
//
// csvEscape existed only in attendanceService.js; the other two copied its
// body inline. Behavior is unchanged: a leading =, +, -, @, tab, or carriage
// return still gets a defusing leading apostrophe (CSV/Excel formula
// injection guard), and every field is still quoted.
export function csvEscape(value) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function toCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

// Sets the two response headers every CSV download route was already
// setting individually (with small drifts: some used res.header +
// res.attachment, marks.js set Content-Type/Content-Disposition directly).
// Unified here for new callers; existing routes are left as they were,
// since changing header casing/order on a working download is not a
// behavior-compatible change worth making as part of this extraction.
export function sendCsv(res, filename, headers, rows) {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}
