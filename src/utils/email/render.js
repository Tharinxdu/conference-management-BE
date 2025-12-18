function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Very simple variable interpolation:
 * - template string includes {{var}}
 * - we escape values by default
 */
function renderString(template, variables = {}) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    return escapeHtml(value ?? "");
  });
}

module.exports = { renderString, escapeHtml };
