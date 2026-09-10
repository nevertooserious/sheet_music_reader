import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ParseOptions, ScoreDocument, ScoreParser } from '../core/contracts';
import type { PageInfo } from '../core/types';
import { analyze, type ParseDebug } from './analyze';
import type { FontInfo, PageExtraction } from './model';
import { extractPdfPage } from './pdfPage';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** What `ScoreDocument.debug` carries for the parsing showcase. */
export interface ParsingDebug extends ParseDebug {
  parseMs: number;
  allFonts: FontInfo[];
  extraction: { glyphs: number; paths: number; texts: number; images: number };
}

function describeOpenError(err: unknown, fileName: string): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) return `"${fileName}" is not a valid PDF file.`;
  if (name === 'PasswordException') return `"${fileName}" is password-protected and cannot be opened.`;
  return `"${fileName}" could not be opened as a PDF: ${message}`;
}

function createDocument(doc: PDFDocumentProxy, base: Omit<ScoreDocument, 'renderPage' | 'dispose'>): ScoreDocument {
  const inflight = new WeakMap<HTMLCanvasElement, RenderTask>();
  let disposed = false;
  return {
    ...base,
    async renderPage(pageIndex, canvas, scale) {
      if (disposed) throw new Error('Document disposed');
      if (pageIndex < 0 || pageIndex >= doc.numPages) throw new Error(`Page ${pageIndex + 1} does not exist`);
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale });
      inflight.get(canvas)?.cancel();
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      const task = page.render({ canvasContext: ctx, viewport });
      inflight.set(canvas, task);
      try {
        await task.promise;
      } catch (err) {
        if (err instanceof pdfjs.RenderingCancelledException) return;
        throw err;
      } finally {
        if (inflight.get(canvas) === task) inflight.delete(canvas);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      void doc.destroy().catch(() => undefined);
    },
  };
}

/** PDF → ScoreModel via pdf.js vector extraction (see ARCHITECTURE.md "Approach"). */
export function createParser(): ScoreParser {
  return {
    async parse(data: ArrayBuffer, options: ParseOptions): Promise<ScoreDocument> {
      const t0 = performance.now();
      const progress = (fraction: number, stage: string): void => options.onProgress?.({ fraction, stage });
      progress(0.02, 'Opening PDF');
      let doc: PDFDocumentProxy;
      try {
        doc = await pdfjs.getDocument({
          data: new Uint8Array(data.slice(0)),
          fontExtraProperties: true,
          isEvalSupported: false,
          verbosity: pdfjs.VerbosityLevel.ERRORS,
        }).promise;
      } catch (err) {
        throw new Error(describeOpenError(err, options.fileName));
      }
      try {
        const pages: PageExtraction[] = [];
        const infos: PageInfo[] = [];
        for (let i = 0; i < doc.numPages; i++) {
          progress(0.05 + (0.45 * i) / doc.numPages, `Reading page ${i + 1} of ${doc.numPages}`);
          const page = await doc.getPage(i + 1);
          const viewport = page.getViewport({ scale: 1 });
          infos.push({ index: i, width: viewport.width, height: viewport.height });
          pages.push(await extractPdfPage(page, i, pdfjs.OPS as unknown as Record<string, number>));
        }
        const { score, debug } = analyze(pages, {
          fileName: options.fileName,
          unfoldRepeats: options.unfoldRepeats,
          onProgress: progress,
        });
        const allFonts = new Map<string, FontInfo>();
        for (const p of pages) for (const f of p.fonts) allFonts.set(f.name, f);
        const parsingDebug: ParsingDebug = {
          ...debug,
          parseMs: Math.round(performance.now() - t0),
          allFonts: [...allFonts.values()],
          extraction: {
            glyphs: pages.reduce((s, p) => s + p.glyphs.length, 0),
            paths: pages.reduce((s, p) => s + p.paths.length, 0),
            texts: pages.reduce((s, p) => s + p.texts.length, 0),
            images: pages.reduce((s, p) => s + p.imageCount, 0),
          },
        };
        progress(1, 'Done');
        return createDocument(doc, { score, pages: infos, debug: parsingDebug });
      } catch (err) {
        await doc.destroy().catch(() => undefined);
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
  };
}
