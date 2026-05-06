import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export type PdfFormat = "A6" | "A7" | "A8" | "round";

const SIZES: Record<PdfFormat, [number, number]> = {
  A6: [105, 148],
  A7: [74, 105],
  A8: [52, 74],
  round: [90, 90],
};

/**
 * Captures the receipt preview DOM element as a high-res image
 * and places it exactly as-is into a PDF of the chosen format.
 * Returns the PDF as a Blob for sharing.
 */
export async function generatePdfFromElement(
  element: HTMLElement,
  format: PdfFormat,
  fileName?: string
): Promise<Blob> {
  const [pw, ph] = SIZES[format];
  const scale = 3;

  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.position = "absolute";
  clone.style.left = "-9999px";
  clone.style.top = "0";
  clone.style.zIndex = "-1";
  document.body.appendChild(clone);

  try {
    const canvas = await html2canvas(clone, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    const imgData = canvas.toDataURL("image/png");
    const imgW = canvas.width / scale;
    const imgH = canvas.height / scale;

    const margin = 2;
    const maxW = pw - margin * 2;
    const maxH = ph - margin * 2;
    // px to mm = px * 0.264583
    const pxToMm = 0.264583;
    const ratio = Math.min(maxW / (imgW * pxToMm), maxH / (imgH * pxToMm));
    const pdfImgW = imgW * pxToMm * ratio;
    const pdfImgH = imgH * pxToMm * ratio;

    const doc = new jsPDF({
      orientation: pw > ph ? "l" : "p",
      unit: "mm",
      format: [pw, ph],
    });

    const x = (pw - pdfImgW) / 2;
    const y = (ph - pdfImgH) / 2;

    if (format === "round") {
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.3);
      doc.circle(pw / 2, ph / 2, Math.min(pw, ph) / 2 - 1, "S");
    }

    doc.addImage(imgData, "PNG", x, y, pdfImgW, pdfImgH);

    const name = fileName || `recibo-${format}-${Date.now()}`;
    doc.save(`${name}.pdf`);

    // Return blob for sharing
    return doc.output("blob");
  } finally {
    document.body.removeChild(clone);
  }
}
