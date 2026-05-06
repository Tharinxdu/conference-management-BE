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
 * hash = sha256(app_id + currency + amount(2dp) + HASH_SALT)
 */
function generateHash({ appId, currency, amount, salt }) {
  const raw = `${appId}${currency}${to2dp(amount)}${salt}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Create checkout link for Gala Tickets (GALA APP)
 */
async function createGalaCheckoutLink({
  amount,
  currency,
  reference,
  customer,
  transactionRedirectUrl,
  additionalData,
  items,
}) {
  const baseUrl = mustEnv("ONEPAY_GALA_BASE_URL");
  const appId = mustEnv("ONEPAY_GALA_APP_ID");
  const token = mustEnv("ONEPAY_GALA_APP_TOKEN");
  const salt = mustEnv("ONEPAY_GALA_HASH_SALT");

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
    additional_data: additionalData || "",
  };

  if (Array.isArray(items) && items.length > 0) {
    body.items = items;
  }

  const res = await fetch(`${baseUrl}/v3/checkout/link/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new HttpError(
      502,
      json?.message || "OnePay gala checkout link failed.",
      { onepay: json }
    );
  }

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
      "OnePay gala response missing transaction id or redirect url.",
      { onepay: json }
    );
  }

  return { onepayTransactionId, redirectUrl, raw: json };
}

/**
 * Get status for Gala Tickets (GALA APP)
 */
async function getGalaTransactionStatus(onepayTransactionId) {
  const baseUrl = mustEnv("ONEPAY_GALA_BASE_URL");
  const appId = mustEnv("ONEPAY_GALA_APP_ID");
  const token = mustEnv("ONEPAY_GALA_APP_TOKEN");

  const res = await fetch(`${baseUrl}/v3/transaction/status/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({
      app_id: appId,
      onepay_transaction_id: onepayTransactionId,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(
      502,
      json?.message || "OnePay gala transaction status failed.",
      { onepay: json }
    );
  }

  return json;
}

module.exports = {
  generateHash,
  createGalaCheckoutLink,
  getGalaTransactionStatus,
  to2dp,
};