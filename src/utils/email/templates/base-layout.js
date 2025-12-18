function baseLayout({ title, bodyHtml, footerText }) {
  return `
  <div style="font-family: Arial, sans-serif; color:#111; line-height:1.4">
    <h2 style="margin:0 0 12px">${title}</h2>
    <div>${bodyHtml}</div>
    <hr style="margin:20px 0; border:none; border-top:1px solid #eee" />
    <div style="font-size:12px; color:#666">${footerText || "APSC 2026"}</div>
  </div>`;
}

module.exports = { baseLayout };
