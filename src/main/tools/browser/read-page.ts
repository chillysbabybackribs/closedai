import { pageTextOf, readProblemOf, SELECTOR_ADVICE } from '../../browser-page-ready.js'
import type { ToolAction } from '../action-tool.js'
import { failureResult, numberArg, stringArg, textResult, usageResult } from '../tool.js'
import { truncateText } from '../truncate-json.js'
import { READ_PAGE_TRUNCATION_ADVICE } from '../truncation-advice.js'
import { DEFAULT_MAX_CHARS, maxCharsField, selectorField, tabIdField } from './fields.js'
import { missingTabResult, requireBrowser, type BrowserHostProvider } from './host.js'

const TRUNCATION_ADVICE = READ_PAGE_TRUNCATION_ADVICE

export function readPageAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'read_page',
    description: 'HTML text or one PDF page (select tab first; pdf_page one-based, default 1). selector for HTML only. Not layout verification — use closedai_ui.capture.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: tabIdField,
        selector: selectorField,
        max_chars: maxCharsField,
        pdf_page: { type: 'integer', minimum: 1, maximum: 100000, description: 'PDF text page, one-based; default 1. Does not navigate the viewer. Cannot combine with selector.' }
      },
      additionalProperties: false
    },
    async run(input, context) {
      const tabId = stringArg(input, 'tab_id')
      const selector = stringArg(input, 'selector')
      const maxChars = numberArg(input, 'max_chars', DEFAULT_MAX_CHARS)
      const pdfPage = input.pdf_page === undefined ? undefined : numberArg(input, 'pdf_page', 1)
      if (selector && pdfPage !== undefined) return usageResult('Cannot combine selector and pdf_page; selectors apply only to HTML.')
      const host = requireBrowser(browser)
      const outcome = await host.readPage(tabId, { selector, maxChars, raw: true, ...(pdfPage === undefined ? {} : { pdfPage }) }, context.signal)
      if (!outcome) return missingTabResult(host, tabId)
      // Each of these used to arrive as the same null and was reported as "nothing matches",
      // which is a claim about the page that only one of them supports.
      const problem = readProblemOf(outcome)
      if (problem?.problem === 'selector-invalid') {
        return usageResult(`The page rejected ${JSON.stringify(selector)} as a CSS selector: ${problem.detail}\n${SELECTOR_ADVICE}`)
      }
      if (problem?.problem === 'selector-missing') {
        return failureResult(`Nothing matches selector ${JSON.stringify(selector)}. The selector is valid, so the element is absent or not rendered yet; wait_for it, or omit selector to read the whole page.`)
      }
      if (problem) return failureResult('The page did not answer the read. It may be navigating, or still loading; call wait_for and read again.')
      const page = pageTextOf(outcome)!
      const header = `Title: ${page.title || 'Untitled'}\nURL: ${page.url}\nLoad state: ${page.readyState}`
      if (page.pdf) {
        const pdf = page.pdf
        if (!pdf.available) return failureResult(`${header}\n\nPDF page ${pdf.page} is unavailable. Chromium currently exposes ${pdf.pagesAvailable} pages${pdf.totalPages === null ? '' : ` of ${pdf.totalPages}`}. Wait for the PDF to load and check the page number.`)
        const text = page.text || '(No native text on this page. It may be scanned, blank, or inaccessible; inspect the page image.)'
        return textResult(`${header}\nPDF page: ${pdf.page}${pdf.totalPages === null ? '' : ` of ${pdf.totalPages}`}\nSource: Chromium native PDF accessibility\n\n${text}\n\n${page.truncated ? '[Text truncated; increase max_chars.]\n' : ''}Native text can lose reading order, tables, equations, and image content. pdf_page selects text only; it does not navigate the viewer. Browser capture shows the current viewport.`)
      }
      // The page hands back its text unsliced, so the bound applied here can respect the
      // content: `truncateText` shrinks JSON structurally and only falls back to a plain cut
      // for prose. Cutting a JSON document at N characters yields something that will not parse.
      const bounded = truncateText(page.text || '(no visible text)', maxChars, TRUNCATION_ADVICE)
      const ceiling = page.truncated ? '\n\n[The page exceeded the read ceiling; earlier content only]' : ''
      return textResult(`${header}\n\n${bounded.text}${ceiling}`)
    }
  }
}
