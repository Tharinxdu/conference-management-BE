const QRCode = require("qrcode");

async function qrTextToPngBuffer(qrText) {
  return QRCode.toBuffer(qrText, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 8,
  });
}

module.exports = { qrTextToPngBuffer };
