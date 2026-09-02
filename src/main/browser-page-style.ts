// User-origin CSS applied to each completed top-level page load. It only affects native
// Chromium scrollbar paint, so sites that use custom in-document scrollers can retain their
// own intended controls.
export const EMBEDDED_BROWSER_SCROLLBAR_CSS = `
  :root {
    scrollbar-color: #62656b #1a1c20;
    scrollbar-width: thin;
  }

  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  ::-webkit-scrollbar-track {
    background: #1a1c20;
  }

  ::-webkit-scrollbar-thumb {
    min-height: 36px;
    border: 2px solid #1a1c20;
    border-radius: 999px;
    background: #62656b;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: #7a7e86;
  }

  ::-webkit-scrollbar-corner {
    background: #1a1c20;
  }
`
