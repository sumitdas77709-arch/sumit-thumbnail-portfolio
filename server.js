
require("dotenv").config();
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Resend } = require("resend");

const app = express();
const PORT = process.env.PORT || 3000;
const { OWNER_EMAIL, RESEND_API_KEY } = process.env;
const SEND_CONFIRMATION =
  String(process.env.SEND_CONFIRMATION).toLowerCase() === "true";

if (!OWNER_EMAIL || !RESEND_API_KEY) {
  console.error("Missing OWNER_EMAIL or RESEND_API_KEY in .env.");
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY.trim());

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
        "font-src": ["https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
      },
    },
  })
);

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many requests. Please try again in a few minutes.",
  },
});

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]
  );

const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const safeName = (n) => n.replace(/[<>"\r\n]/g, "").trim();
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

app.post("/api/order", orderLimiter, async (req, res) => {
  const b = req.body || {};

  if (b.website) return res.json({ ok: true });

  const order = {
    name: clean(b.name, 80),
    email: clean(b.email, 120),
    whatsapp: clean(b.whatsapp, 30),
    channel: clean(b.channel, 200),
    category: clean(b.category, 40),
    plan: clean(b.plan, 40),
    title: clean(b.title, 150),
    details: clean(b.details, 2000),
  };

  if (
    !order.name ||
    !emailOk(order.email) ||
    !order.channel ||
    !order.details
  ) {
    return res.status(400).json({
      ok: false,
      error:
        "Please fill in your name, a valid email, channel link and project details.",
    });
  }

  const rows = [
    ["Name", order.name],
    ["Email", order.email],
    ["WhatsApp", order.whatsapp || "-"],
    ["Channel", order.channel],
    ["Category", order.category || "-"],
    ["Plan", order.plan || "-"],
    ["Video title", order.title || "-"],
  ];

  const html =
    `<h2>New thumbnail order</h2><table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="color:#666"><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`
      )
      .join("") +
    `</table><h3>Project details</h3><p style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:15px">${esc(order.details)}</p><p style="color:#888;font-size:13px">Reply to this email to answer the client directly.</p>`;

  const text =
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nProject details:\n${order.details}`;

  try {
    const { error: ownerError } = await resend.emails.send({
      from: "Portfolio Orders <onboarding@resend.dev>",
      to: [OWNER_EMAIL],
      replyTo: order.email,
      subject: `New order: ${safeName(order.plan) || "Thumbnail"} from ${safeName(order.name)}`,
      text,
      html,
    });

    if (ownerError) {
      throw new Error(
        ownerError.message || "Resend could not send the owner notification"
      );
    }

    if (SEND_CONFIRMATION) {
      const { error: confirmationError } = await resend.emails.send({
        from: "Sumit Das <onboarding@resend.dev>",
        to: [order.email],
        replyTo: OWNER_EMAIL,
        subject: "I got your thumbnail request",
        text: `Hi ${order.name},\n\nThanks for your request. I have received it and will reply within 24 hours with a quick idea for your thumbnail.\n\nSumit Das`,
      });

      if (confirmationError) {
        throw new Error(
          confirmationError.message ||
            "Resend could not send the customer confirmation"
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Email failed:", err.message);
    res.status(500).json({
      ok: false,
      error:
        "Could not send your order right now. Please try again or message me directly.",
    });
  }
});

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
