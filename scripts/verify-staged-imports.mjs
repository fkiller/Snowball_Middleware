// Build-time check only: static, relative literal imports in the reviewed
// staging tree. Dynamic paths, assets, bare packages and runtime behavior need
// separate validation and platform smoke tests.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export function verifyStagedImports(staging, files) {
  const root = path.resolve(staging);
  const missing = [];
  for (const relative of files) {
    if (!/\.(?:mjs|cjs|js)$/.test(relative)) continue;
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) throw Error('Invalid staged file path');
    const source = ts.createSourceFile(relative, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const check = (specifier, commonjs) => {
      if (!(specifier.startsWith('./') || specifier.startsWith('../'))) return;
      const target = path.resolve(path.dirname(filename), specifier);
      const candidates = commonjs ? [target, ...['.js', '.json', '.node'].map(ext => target + ext), path.join(target, 'index.js'), path.join(target, 'index.json')] : [target];
      if (!candidates.some(candidate => candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile())) missing.push(`${relative}: ${specifier}`);
    };
    const walk = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text, false);
      if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) check(node.arguments[0].text, false);
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') check(node.arguments[0].text, true);
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  if (missing.length) throw Error(`Missing staged relative imports:\n${missing.join('\n')}`);
}
