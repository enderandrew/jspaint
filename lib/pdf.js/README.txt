pdfjs-dist 6.4.299 (https://github.com/mozilla/pdf.js), Apache-2.0, see LICENSE.
Only what Paint needs to render a PDF page: the minified library and worker (the "legacy" build, which supports
browsers and Electron versions from before the newest JavaScript features), CMaps, standard fonts, ICC profiles,
and the non-WebAssembly fallbacks for JBIG2 and JPEG 2000 images (the page's Content-Security-Policy does not allow WebAssembly).
