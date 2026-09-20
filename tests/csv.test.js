// Dependency-free (no express/db boot), like client-origin.test.js.
// Guards the shared CSV serializer extracted from attendanceService.js,
// reportService.js, and routes/marks.js in Phase 8.3: behavior must be
// byte-for-byte identical to what each of those three had inline before.
import assert from "node:assert/strict";
import { csvEscape, sendCsv, toCsv } from "../server/services/csv.js";

// --- csvEscape: quoting and formula-injection guard --------------------

assert.equal(csvEscape("plain"), '"plain"');
assert.equal(csvEscape("has \"quotes\""), '"has ""quotes"""');
assert.equal(csvEscape(""), '""');
assert.equal(csvEscape(null), '""');
assert.equal(csvEscape(undefined), '""');
assert.equal(csvEscape(42), '"42"');

// A field starting with =, +, -, @, tab, or CR is a formula-injection risk
// in Excel/Sheets; a defusing leading apostrophe must be added.
assert.equal(csvEscape("=SUM(A1:A2)"), "\"'=SUM(A1:A2)\"");
assert.equal(csvEscape("+1"), "\"'+1\"");
assert.equal(csvEscape("-1"), "\"'-1\"");
assert.equal(csvEscape("@mention"), "\"'@mention\"");
assert.equal(csvEscape("\tstart"), "\"'\tstart\"");
// A minus or plus in the middle of a value is not a formula and must be
// left alone.
assert.equal(csvEscape("2026-01-05"), '"2026-01-05"');
assert.equal(csvEscape("A+B"), '"A+B"');

// --- toCsv: header + rows, trailing newline -----------------------------

const csv = toCsv(["Name", "Note"], [["Ada", "Hi, \"there\""], ["Grace", "-5"]]);
assert.equal(csv, '"Name","Note"\n"Ada","Hi, ""there"""\n"Grace","\'-5"\n');
assert.equal(toCsv(["Only"], []), '"Only"\n');

// --- sendCsv: sets both headers exactly as every caller did previously --

function fakeRes() {
  const headers = {};
  return {
    headers,
    set(key, value) { headers[key] = value; },
    send(body) { this.body = body; }
  };
}
const res = fakeRes();
sendCsv(res, "report.csv", ["A"], [["1"]]);
assert.equal(res.headers["Content-Type"], "text/csv; charset=utf-8");
assert.equal(res.headers["Content-Disposition"], 'attachment; filename="report.csv"');
assert.equal(res.body, '"A"\n"1"\n');

console.log("csv tests passed");
