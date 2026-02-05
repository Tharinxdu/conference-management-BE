// src/utils/onepay-client.js
const crypto = require("crypto");
const { HttpError } = require("./http-error.js");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function to2dp(amount) {
  return Number(amount).toFixed(2);
}

/**
 * Docs:
 * hash = sha256(app_id + currency + amount(2dp) + HASH_SALT)
 */
function generateHash({ appId, currency, amount, salt }) {
  const raw = `${appId}${currency}${to2dp(amount)}${salt}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Create Transaction (Create Payment Request)
 * - returns transaction_id and payment URL/redirect URL
 */
async function createCheckoutLink({
  amount,
  currency,
  reference,
  customer,
  transactionRedirectUrl,
  additionalData,
  items,
}) {
  const baseUrl = mustEnv("ONEPAY_BASE_URL");
  const appId = mustEnv("ONEPAY_APP_ID");
  const token = mustEnv("ONEPAY_APP_TOKEN");
  const salt = mustEnv("ONEPAY_HASH_SALT");

  // Ensure the exact 2dp amount is used for BOTH hash and payload
  const amt = Number(to2dp(amount));
  const hash = generateHash({ appId, currency, amount: amt, salt });

  const body = {
    currency,
    app_id: appId,
    hash,
    amount: amt,
    reference,

    customer_first_name: customer.firstName,
    customer_last_name: customer.lastName,
    customer_phone_number: customer.phone,
    customer_email: customer.email,

    transaction_redirect_url: transactionRedirectUrl,

    // ✅ docs use snake_case
    additional_data: additionalData || "",
  };

  // Only include items if present (optional)
  if (Array.isArray(items) && items.length > 0) {
    body.items = items;
  }

  const res = await fetch(`${baseUrl}/v3/checkout/link/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // If docs require Bearer, change to: `Bearer ${token}`
      Authorization: token,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(
      502,
      json?.message || "OnePay checkout link failed.",
      { onepay: json }
    );
  }

  // Docs call it transaction_id (callback sample), but your previous parse used ipg_transaction_id.
  // Be tolerant and support both.
  const onepayTransactionId =
    json?.data?.transaction_id ||
    json?.data?.ipg_transaction_id ||
    json?.data?.data?.transaction_id;

  const redirectUrl =
    json?.data?.payment_url ||
    json?.data?.gateway?.redirect_url ||
    json?.data?.redirect_url;

  if (!onepayTransactionId || !redirectUrl) {
    throw new HttpError(
      502,
      "OnePay response missing transaction id or redirect url.",
      { onepay: json }
    );
  }

  return { onepayTransactionId, redirectUrl, raw: json };
}

/**
 * Get Transaction (Track Payment Status)
 * Docs emphasize "transaction_id"
 */
async function getTransactionStatus(onepayTransactionId) {
  const baseUrl = mustEnv("ONEPAY_BASE_URL");
  const appId = mustEnv("ONEPAY_APP_ID");
  const token = mustEnv("ONEPAY_APP_TOKEN");

  const res = await fetch(`${baseUrl}/v3/transaction/status/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // If docs require Bearer, change to: `Bearer ${token}`
      Authorization: token,
    },
    body: JSON.stringify({
      app_id: appId,
      // ✅ use the doc term
      transaction_id: onepayTransactionId,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(
      502,
      json?.message || "OnePay transaction status failed.",
      { onepay: json }
    );
  }

  return json;
}

module.exports = {
  generateHash,
  createCheckoutLink,
  getTransactionStatus,
  to2dp,
};