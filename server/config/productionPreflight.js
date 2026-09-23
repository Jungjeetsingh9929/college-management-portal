import { validateClientOrigins } from "./clientOrigin.js";

// Keep deployment failures actionable: report every required production setting
// in one startup error instead of failing on whichever imported module happens
// to inspect its setting first.
if (process.env.NODE_ENV === "production") {
  const problems = [];
  const required = [
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["JWT_SECRET", process.env.JWT_SECRET],
    ["SEED_ADMIN_PASSWORD", process.env.SEED_ADMIN_PASSWORD],
    ["SEED_STUDENT_PASSWORD", process.env.SEED_STUDENT_PASSWORD]
  ];
  for (const [name, value] of required) {
    if (!String(value || "").trim()) problems.push(`${name} must be set.`);
  }
  if (String(process.env.JWT_SECRET || "").length > 0 && String(process.env.JWT_SECRET).length < 32) {
    problems.push("JWT_SECRET must be at least 32 characters.");
  }
  const originCheck = validateClientOrigins({ isProduction: true });
  problems.push(...originCheck.fatal);
  if (problems.length) {
    throw new Error(`Production configuration is invalid:\n- ${problems.join("\n- ")}`);
  }
}
