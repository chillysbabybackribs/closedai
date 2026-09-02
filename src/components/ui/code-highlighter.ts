import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import css from 'shiki/langs/css.mjs'
import diff from 'shiki/langs/diff.mjs'
import html from 'shiki/langs/html.mjs'
import javascript from 'shiki/langs/javascript.mjs'
import jsx from 'shiki/langs/jsx.mjs'
import json from 'shiki/langs/json.mjs'
import markdown from 'shiki/langs/markdown.mjs'
import python from 'shiki/langs/python.mjs'
import shellscript from 'shiki/langs/shellscript.mjs'
import tsx from 'shiki/langs/tsx.mjs'
import typescript from 'shiki/langs/typescript.mjs'
import yaml from 'shiki/langs/yaml.mjs'
import githubDarkDefault from 'shiki/themes/github-dark-default.mjs'

const highlighterPromise = createHighlighterCore({
  themes: [githubDarkDefault],
  langs: [
    ...css,
    ...diff,
    ...html,
    ...javascript,
    ...jsx,
    ...json,
    ...markdown,
    ...python,
    ...shellscript,
    ...tsx,
    ...typescript,
    ...yaml
  ],
  engine: createJavaScriptRegexEngine()
})

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'shellscript',
  css: 'css',
  diff: 'diff',
  html: 'html',
  js: 'javascript',
  javascript: 'javascript',
  json: 'json',
  jsx: 'jsx',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  python: 'python',
  sh: 'shellscript',
  shell: 'shellscript',
  shellscript: 'shellscript',
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',
  xml: 'html',
  yaml: 'yaml',
  yml: 'yaml'
}

export async function highlightCode(code: string, language: string, theme: string): Promise<string> {
  const highlighter = await highlighterPromise
  return highlighter.codeToHtml(code, {
    lang: LANGUAGE_ALIASES[language.toLowerCase()] ?? 'plaintext',
    theme: theme === 'github-dark-default' ? theme : 'github-dark-default'
  })
}
