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

function generateHash({ appId, currency, amount, salt }) {
  const raw = `${appId}${currency}${to2dp(amount)}${salt}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

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

  const hash = generateHash({ appId, currency, amount, salt });

  const res = await fetch(`${baseUrl}/v3/checkout/link/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({
      currency,
      app_id: appId,
      hash,
      amount: Number(amount),
      reference,
      customer_first_name: customer.firstName,
      customer_last_name: customer.lastName,
      customer_phone_number: customer.phone,
      customer_email: customer.email,
      transaction_redirect_url: transactionRedirectUrl,
      additionalData: additionalData || "",
      items: items || undefined,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(502, json?.message || "OnePay checkout link failed.", { onepay: json });
  }

  const onepayTransactionId = json?.data?.ipg_transaction_id;
  const redirectUrl = json?.data?.gateway?.redirect_url;

  if (!onepayTransactionId || !redirectUrl) {
    throw new HttpError(502, "OnePay response missing transaction id or redirect url.", { onepay: json });
  }

  return { onepayTransactionId, redirectUrl, raw: json };
}

async function getTransactionStatus(onepayTransactionId) {
  const baseUrl = mustEnv("ONEPAY_BASE_URL");
  const appId = mustEnv("ONEPAY_APP_ID");
  const token = mustEnv("ONEPAY_APP_TOKEN");

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
    throw new HttpError(502, json?.message || "OnePay transaction status failed.", { onepay: json });
  }

  return json; // expect json.data.status boolean + amount/currency/paid_on
}

module.exports = {
  generateHash,
  createCheckoutLink,
  getTransactionStatus,
  to2dp,
};
