/**
 * Mid-stream markdown repair for the trailing block of a still-streaming message. Inline syntax
 * the model has not finished typing — `**bold`, `` `code ``, `~~strike`, `[text](https://…` —
 * otherwise flashes as raw characters until the closing token arrives and the block reflows.
 * Settled text is never touched, so nothing the model actually wrote is altered: the repairs
 * exist only for the frames in which the text is visibly incomplete.
 *
 * Deliberately conservative: single `*` and `_` are left alone (list markers, snake_case, and
 * arithmetic make them ambiguous), and an unclosed ``` fence is untouched because the lexer
 * already renders the tail as a code block.
 */
export function closeIncompleteMarkdown(block: string): string {
  if (countOf(block, '```') % 2 === 1) return block
  let out = block
  let stripped = withoutCodeSpans(out)
  let closers = ''
  if (stripped.includes('`')) {
    // Everything after an unclosed backtick is literal code: close it, skip link handling (a
    // bracket in there is code, not a link), and only count emphasis opened before it.
    closers += '`'
    stripped = stripped.slice(0, stripped.indexOf('`'))
  } else {
    // An incomplete trailing link or image is held back entirely: swapping loose text for a link
    // chip mid-word flickers more than a briefly missing tail. The character classes exclude
    // backticks, so the match sits after every complete code span removed above and the same
    // suffix can be sliced off the raw block.
    const partialLink = stripped.match(/!?\[[^\]\n`]*(\]\([^)\n`]*)?$/)
    if (partialLink) {
      out = out.slice(0, out.length - partialLink[0].length)
      stripped = withoutCodeSpans(out)
    }
  }
  if (countOf(stripped, '**') % 2 === 1) closers += '**'
  if (countOf(stripped, '~~') % 2 === 1) closers += '~~'
  if (!closers) return out
  // Emphasis closers do not count after whitespace (and a block's raw text usually ends with a
  // newline), so the closers go in front of the trailing whitespace run.
  const trailing = out.match(/\s+$/)?.[0] ?? ''
  return out.slice(0, out.length - trailing.length) + closers + trailing
}

function withoutCodeSpans(text: string): string {
  return text.replace(/`[^`\n]*`/g, '')
}

function countOf(text: string, token: string): number {
  let count = 0
  for (let index = text.indexOf(token); index >= 0; index = text.indexOf(token, index + token.length)) count += 1
  return count
}
