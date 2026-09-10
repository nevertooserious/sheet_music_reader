import type { PDFPageProxy } from 'pdfjs-dist';
import { extractPage } from './extract';
import type { PageExtraction } from './model';

/** Adapts a pdf.js page (from either build) to the extraction walker. */
export async function extractPdfPage(page: PDFPageProxy, index: number, ops: Record<string, number>): Promise<PageExtraction> {
  const viewport = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  return extractPage({
    index,
    width: viewport.width,
    height: viewport.height,
    transform: viewport.transform,
    opList,
    ops,
    getFont: (id) => {
      try {
        return page.commonObjs.get(id) ?? undefined;
      } catch {
        return undefined;
      }
    },
  });
}
