import nodemailer from "nodemailer";

// Lazily built so a missing SMTP config doesn't crash the server at import
// time - it only matters once someone actually triggers an email-sending
// route, and even then we degrade gracefully (see sendOtpEmail).
let cachedTransporter;
let cachedTransporterKey;

function transporterConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  const key = `${process.env.SMTP_HOST}:${process.env.SMTP_PORT}:${process.env.SMTP_USER}`;
  if (cachedTransporter && cachedTransporterKey === key) return cachedTransporter;
  const port = Number(process.env.SMTP_PORT) || 587;
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Without these, an unreachable or slow-to-respond SMTP host hangs
    // sendMail() indefinitely. Every route that sends email (OTP delivery,
    // fee reminders, password resets) does so while still holding
    // databaseWriteLock's write lock, so an indefinite hang here used to
    // mean an indefinite lock hold - freezing every mutating endpoint for
    // every user in the app, not just the one email. These bound the hang
    // to well under fileStore.js's LOCK_TIMEOUT_MS backstop.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000
  });
  cachedTransporterKey = key;
  return cachedTransporter;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function sendEmail({ to, subject, text, html, devLabel }) {
  if (!transporterConfigured()) {
    if (process.env.NODE_ENV !== "production") console.info(`[emailService] SMTP not configured - ${devLabel} for ${to}: ${text}`);
    else console.error("[emailService] SMTP is not configured; email was not sent.");
    return false;
  }
  try {
    await getTransporter().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
    return true;
  } catch (error) {
    console.error("[emailService] Failed to send email:", error.message);
    return false;
  }
}

export async function sendOtpEmail({ to, name, otp, purpose }) {
  const displayName = name ? String(name).slice(0, 120) : "there";
  const label = purpose === "signup" ? "verify your College Portal signup" : "reset your College Portal password";
  const subject = purpose === "signup" ? "Your College Portal signup code" : "Your College Portal password reset code";
  const text = `Hi ${displayName},\n\nUse this one-time code to ${label}: ${otp}\n\nThis code expires in 10 minutes and can only be used once. If you did not request this, you can ignore this email.\n`;
  const html = `<p>Hi ${escapeHtml(displayName)},</p><p>Use this one-time code to ${escapeHtml(label)}:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${escapeHtml(otp)}</p><p>This code expires in 10 minutes and can only be used once. If you did not request this, you can ignore this email.</p>`;
  return sendEmail({ to, subject, text, html, devLabel: `OTP (${purpose}): ${otp}` });
}

export async function sendFeeReminderEmail({ to, name, amount, dueDate }) {
  const displayName = name ? String(name).slice(0, 120) : "there";
  const subject = "College Portal fee payment reminder";
  const formattedAmount = Number(amount || 0).toLocaleString("en-IN");
  const text = `Hi ${displayName},\n\nYour outstanding college fee balance is ₹${formattedAmount}.${dueDate ? ` The due date is ${dueDate}.` : " Please contact the administration office for payment details."}\n`;
  const html = `<p>Hi ${escapeHtml(displayName)},</p><p>Your outstanding college fee balance is <strong>₹${formattedAmount}</strong>${dueDate ? ` and the due date is <strong>${escapeHtml(dueDate)}</strong>` : ""}.</p><p>Please contact the administration office for payment details.</p>`;
  return sendEmail({ to, subject, text, html, devLabel: `fee reminder for ₹${formattedAmount}` });
}

// Attendance counterpart to sendFeeReminderEmail above. Unlike the in-app
// bell notification (buildNotifications() in routes/shared.js), which a
// student only sees if they happen to have the portal open, this pushes the
// check-in link to them.
//
// `checkInUrl` must be absolute and is built server-side from the validated
// CLIENT_ORIGIN (see server/config/clientOrigin.js). It is deliberately NOT
// taken from anything the caller sends: an email that lands in a student's
// inbox carrying a staff-supplied link would be a ready-made phishing
// vector for harvesting student logins.
export async function sendAttendanceReminderEmail({ to, name, subjectName, className, checkInUrl, closesAt }) {
  const displayName = name ? String(name).slice(0, 120) : "there";
  const subjectLabel = subjectName ? String(subjectName).slice(0, 120) : "your class";
  const classLabel = className ? String(className).slice(0, 60) : "";
  const subject = `Attendance is open for ${subjectLabel}`;
  const closingLine = closesAt ? ` Check-in closes at ${closesAt}.` : "";
  const text = `Hi ${displayName},\n\nAttendance is now open for ${subjectLabel}${classLabel ? ` (${classLabel})` : ""}.${closingLine}\n\nOpen this link on your phone, on campus, to check in:\n${checkInUrl}\n\nYou will be asked to sign in and to allow location access - check-in only works from inside the campus geofence.\n`;
  const html = `<p>Hi ${escapeHtml(displayName)},</p><p>Attendance is now open for <strong>${escapeHtml(subjectLabel)}</strong>${classLabel ? ` (${escapeHtml(classLabel)})` : ""}.${closingLine ? escapeHtml(closingLine) : ""}</p><p><a href="${escapeHtml(checkInUrl)}">Tap here to check in</a></p><p>You will be asked to sign in and to allow location access — check-in only works from inside the campus geofence.</p>`;
  return sendEmail({ to, subject, text, html, devLabel: `attendance reminder for ${subjectLabel}: ${checkInUrl}` });
}
