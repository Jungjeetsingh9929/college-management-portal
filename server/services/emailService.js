import nodemailer from "nodemailer";

// Lazily built so a missing SMTP config doesn't crash the server at import
// time - it only matters once someone actually triggers an email-sending
// route, and even then we degrade gracefully (see sendPasswordResetEmail).
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
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
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

export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const displayName = name ? String(name).slice(0, 120) : "there";
  const subject = "Reset your College Portal password";
  const text = `Hi ${displayName},\n\nWe received a request to reset your College Portal password. This link expires in 15 minutes and can only be used once:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email - your password will not change.\n`;
  const html = `<p>Hi ${escapeHtml(displayName)},</p><p>We received a request to reset your College Portal password. This link expires in 15 minutes and can only be used once:</p><p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p><p>If you didn't request this, you can safely ignore this email — your password will not change.</p>`;
  return sendEmail({ to, subject, text, html, devLabel: `password reset link: ${resetUrl}` });
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
