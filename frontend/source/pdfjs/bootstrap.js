/** PDF.js 6.4.299. The previous bundled release was removed. */
import * as pdfjsLib from "./pdf.min.js";

const base = new URL("./", import.meta.url);
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.js", base).href;
globalThis.pdfjsLib = pdfjsLib;
globalThis.lumiPdfAssetBase = base.href;
