import ts from 'typescript'

export type SourceSpan = { line: number; end: number }
export type ExportedSymbol = SourceSpan & { name: string; kind: string; localName?: string; from?: string }
export type ImportBinding = { local: string; imported: string; from: string }
export type TypeDeclaration = SourceSpan & { name: string }
export type TypeReference = { name: string; line: number }
export type TestCase = SourceSpan & { name: string; references: readonly string[] }
export type SourceAnalysis = {
  exports: readonly ExportedSymbol[]
  imports: readonly ImportBinding[]
  types: readonly TypeDeclaration[]
  typeRefs: readonly TypeReference[]
  tests: readonly TestCase[]
}

/** Syntax only: explicit references and bindings, without a compiler program or inferred types. */
export function analyzeSource(file: string, source: string): SourceAnalysis {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const span = (node: ts.Node): SourceSpan => ({
    line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
    end: ast.getLineAndCharacterOfPosition(Math.max(node.getStart(ast), node.end - 1)).line + 1
  })
  const exports: ExportedSymbol[] = []
  const imports: ImportBinding[] = []
  const types: TypeDeclaration[] = []
  const typeRefs: TypeReference[] = []
  const tests: TestCase[] = []
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text
      const clause = node.importClause
      if (clause?.name) imports.push({ local: clause.name.text, imported: 'default', from })
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) imports.push({ local: bindings.name.text, imported: '*', from })
      if (bindings && ts.isNamedImports(bindings)) {
        for (const entry of bindings.elements) imports.push({ local: entry.name.text, imported: (entry.propertyName ?? entry.name).text, from })
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const entry of node.exportClause.elements) exports.push({
        name: entry.name.text, localName: (entry.propertyName ?? entry.name).text, kind: 'reexport', ...span(node),
        ...(node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? { from: node.moduleSpecifier.text } : {})
      })
    }
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) types.push({ name: node.name.text, ...span(node) })
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    const kind = declarationKind(node)
    if (!kind) continue
    const declarations = ts.isVariableStatement(node) ? node.declarationList.declarations : [node]
    for (const declaration of declarations) {
      const name = 'name' in declaration && declaration.name && ts.isIdentifier(declaration.name as ts.Node)
        ? (declaration.name as ts.Identifier).text : null
      if (name) exports.push({ name, localName: name, kind, ...span(node) })
      if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
        exports.push({ name: 'default', ...(name ? { localName: name } : {}), kind, ...span(node) })
      }
    }
  }

  const testFunctions = new Set(['test', 'it'])
  for (const binding of imports) {
    if (['node:test', 'vitest', '@jest/globals'].includes(binding.from) && ['test', 'it', 'default'].includes(binding.imported)) testFunctions.add(binding.local)
    else testFunctions.delete(binding.local)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
      const target = ts.isTypeReferenceNode(node) ? node.typeName : node.expression
      const name = referenceName(target)
      if (name && !shadowed(name.split('.')[0]!, node)) typeRefs.push({ name, line: span(node).line })
    }
    if (ts.isCallExpression(node) && isTestCall(node, testFunctions)) {
      const title = node.arguments[0]!
      const callback = node.arguments.at(-1)!
      const references = new Set<string>()
      const collect = (child: ts.Node): void => {
        const name = referenceName(child)
        if (name && imports.some((binding) => binding.local === name.split('.')[0]) &&
          isReference(child) && !shadowed(name.split('.')[0]!, child)) references.add(name)
        ts.forEachChild(child, collect)
      }
      collect(callback)
      tests.push({ name: (title as ts.StringLiteral).text, ...span(node), references: [...references] })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return { exports, imports, types, typeRefs, tests }
}

function declarationKind(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return 'function'
  if (ts.isClassDeclaration(node)) return 'class'
  if (ts.isInterfaceDeclaration(node)) return 'interface'
  if (ts.isTypeAliasDeclaration(node)) return 'type'
  if (ts.isEnumDeclaration(node)) return 'enum'
  if (ts.isVariableStatement(node)) return node.declarationList.flags & ts.NodeFlags.Const ? 'const' : node.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var'
  return null
}

function referenceName(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isQualifiedName(node)) {
    const left = referenceName(node.left)
    return left ? `${left}.${node.right.text}` : null
  }
  if (ts.isPropertyAccessExpression(node)) {
    const left = referenceName(node.expression)
    return left ? `${left}.${node.name.text}` : null
  }
  return null
}

/** Exclude property names and declarations; comments and strings are never identifier nodes. */
function isReference(node: ts.Node): boolean {
  const parent = node.parent
  if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent))) return false
  if ('name' in parent && parent.name === node && !ts.isShorthandPropertyAssignment(parent)) return false
  return true
}

function isTestCall(node: ts.CallExpression, names: Set<string>): boolean {
  let callee = node.expression
  while (ts.isPropertyAccessExpression(callee) && ['only', 'skip', 'todo', 'concurrent'].includes(callee.name.text)) callee = callee.expression
  const callback = node.arguments.at(-1)
  return ts.isIdentifier(callee) && names.has(callee.text) && !shadowed(callee.text, node) &&
    !!node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && !!callback &&
    (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
}

/** Fail conservatively when a nearer declaration shadows an imported or top-level name. */
function shadowed(name: string, node: ts.Node): boolean {
  for (let parent: ts.Node | undefined = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isFunctionLike(parent)) {
      if (parent.parameters.some((parameter) => bindingNames(parameter.name).includes(name))) return true
    }
    if ('typeParameters' in parent && (parent.typeParameters as ts.NodeArray<ts.TypeParameterDeclaration> | undefined)?.some((parameter) => parameter.name.text === name)) return true
    if (ts.isBlock(parent)) {
      for (const statement of parent.statements) {
        if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((entry) => bindingNames(entry.name).includes(name))) return true
        if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name?.text === name) return true
      }
    }
  }
  return false
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((entry) => ts.isBindingElement(entry) ? bindingNames(entry.name) : [])
}
