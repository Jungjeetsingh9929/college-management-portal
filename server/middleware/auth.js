import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET;

if (!secret || secret === "replace-with-a-long-random-secret" || secret.length < 32) {
  throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
}

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role || "student",
      name: user.name,
      email: user.email,
      code: user.code,
      className: user.className
    },
    secret,
    { expiresIn: "8h" }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication token is required." });
  }

  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token." });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access is required." });
  }
  next();
}

export function requireFaculty(req, res, next) {
  if (req.user?.role !== "teacher") {
    return res.status(403).json({ message: "Teacher access is required." });
  }
  next();
}

export function requireStaff(req, res, next) {
  if (!["admin", "teacher"].includes(req.user?.role)) {
    return res.status(403).json({ message: "Staff access is required." });
  }
  next();
}
