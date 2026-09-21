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
  // An incomplete trailing link or image is held back entirely: swapping loose text for a link
  // chip mid-word flickers more than a briefly missing tail. The character classes exclude
  // backticks, so the match is guaranteed to sit outside the code spans removed above and the
  // same suffix can be sliced off the raw block.
  const partialLink = stripped.match(/!?\[[^\]\n`]*(\]\([^)\n`]*)?$/)
  if (partialLink) {
    out = out.slice(0, out.length - partialLink[0].length)
    stripped = withoutCodeSpans(out)
  }
  let closers = ''
  const danglingCode = stripped.indexOf('`')
  // Everything after an unclosed backtick is literal code: close it, and only count emphasis
  // that was opened before it.
  const analysis = danglingCode >= 0 ? stripped.slice(0, danglingCode) : stripped
  if (danglingCode >= 0) closers += '`'
  if (countOf(analysis, '**') % 2 === 1) closers += '**'
  if (countOf(analysis, '~~') % 2 === 1) closers += '~~'
  return closers ? out + closers : out
}

function withoutCodeSpans(text: string): string {
  return text.replace(/`[^`\n]*`/g, '')
}

function countOf(text: string, token: string): number {
  let count = 0
  for (let index = text.indexOf(token); index >= 0; index = text.indexOf(token, index + token.length)) count += 1
  return count
}
