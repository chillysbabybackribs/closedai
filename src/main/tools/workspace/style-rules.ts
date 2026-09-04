export type StyleRule = {
  name: string
  line: number
  start: number
  end: number
  conditions: readonly string[]
}

/** Locate complete rules, including repeated selectors under media/supports/layer wrappers. */
export function styleRules(source: string): StyleRule[] {
  const rules: StyleRule[] = []
  const stack: Array<{ selector: string; rules: StyleRule[] }> = []
  let pending = ''
  let start = 1
  let line = 1
  let quote = ''
  let comment = false
  let parentheses = 0
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    const next = source[index + 1]
    if (char === '\n') line++
    if (comment) {
      if (char === '*' && next === '/') { comment = false; index++ }
      continue
    }
    if (quote) {
      pending += char
      if (char === '\\' && next) {
        pending += next
        if (next === '\n') line++
        index++
      } else if (char === quote) quote = ''
      continue
    }
    if (char === '/' && next === '*') { comment = true; index++; continue }
    if (!pending.trim() && !/\s/.test(char)) start = line
    if (char === '"' || char === "'") { quote = char; pending += char; continue }
    if (char === '(') parentheses++
    if (char === ')') parentheses = Math.max(0, parentheses - 1)
    if (parentheses) { pending += char; continue }
    if (char === '{') {
      const selector = pending.trim()
      const conditions = stack.map((entry) => entry.selector).filter((entry) => entry.startsWith('@'))
      const found: StyleRule[] = selector.startsWith('@') ? [] : [...selector.matchAll(/\.(-?[A-Za-z_][-\w]*)/g)]
        .map((match) => ({ name: match[1]!, line: start + selector.slice(0, match.index).split('\n').length - 1, start, end: line, conditions }))
      stack.push({ selector, rules: found })
      rules.push(...found)
      pending = ''
    } else if (char === '}') {
      for (const rule of stack.pop()?.rules ?? []) rule.end = line
      pending = ''
    } else if (char === ';') {
      pending = ''
    } else {
      pending += char
    }
  }
  return rules
}
