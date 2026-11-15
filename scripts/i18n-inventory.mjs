import ts from 'typescript';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const textAttributes = new Set([
  'label',
  'title',
  'description',
  'hint',
  'placeholder',
  'aria-label',
  'loadingLabel',
  'caption',
  'emptyTitle',
  'alt',
]);
const technicalProperties = new Set([
  'className',
  'class',
  'id',
  'key',
  'href',
  'path',
  'sourceKey',
  'operation',
  'query',
  'mutation',
  'fields',
  'format',
  'fontFamily',
  'family',
]);
const sql =
  /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|WITH)\b|\bAS\s+["']|\b[a-z_]+_id\b/;
export const messageKey = (text) => text.replace(/\s+/g, ' ').trim();
function errorArgument(node, sf) {
  const p = node.parent;
  return (
    p.arguments?.[0] === node &&
    ((ts.isCallExpression(p) && p.expression.getText(sf) === 'fail') ||
      (ts.isNewExpression(p) &&
        /(?:^|\.)[A-Za-z]*Error$/.test(p.expression.getText(sf))))
  );
}
function fieldLabelArgument(node, sf, file) {
  const parent = node.parent;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments[1] === node &&
    (parent.expression.getText(sf) === 'cleanText' ||
      (file.replaceAll('\\', '/').endsWith('/auth/http.ts') &&
        parent.expression.getText(sf) === 'text'))
  );
}
function documentCopy(node) {
  let p = node.parent;
  while (p) {
    if (
      ts.isVariableDeclaration(p) &&
      ['labels', 'greetings'].includes(p.name.getText())
    )
      return true;
    p = p.parent;
  }
  return false;
}
function technicalNode(node, sf) {
  let p = node.parent;
  while (p) {
    if (ts.isJsxAttribute(p)) return !textAttributes.has(p.name.getText(sf));
    if (
      ts.isPropertyAssignment(p) &&
      technicalProperties.has(p.name.getText(sf).replaceAll(/["']/g, ''))
    )
      return true;
    if (ts.isVariableDeclaration(p))
      return /^(fields|query|mutation|className|classes|.*Fields|.*Query)$/.test(
        p.name.getText(sf),
      );
    if (ts.isStatement(p)) break;
    p = p.parent;
  }
  return false;
}
export function scanSource(source, file) {
  const normalizedFile = file.replaceAll('\\', '/');
  if (
    normalizedFile.startsWith('packages/ui/src/i18n/') ||
    normalizedFile === 'packages/ui/src/messages.js'
  )
    return [];
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const entries = new Map();
  const backend = file.replaceAll('\\', '/').startsWith('apps/backend/');
  function add(message, node, category) {
    message = messageKey(message);
    if (!message || !/[a-zA-Z]/.test(message)) return;
    const item = entries.get(message) ?? { message, locations: [] };
    item.locations.push({
      file: file.replaceAll('\\', '/'),
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      category,
    });
    entries.set(message, item);
  }
  function visit(n) {
    if (ts.isJsxText(n)) add(n.text, n, 'jsx');
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent,
        s = messageKey(n.text),
        error =
          errorArgument(n, sf) ||
          (ts.isBinaryExpression(p) &&
            p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(p.left) &&
            ['error', 'deviceWarning'].includes(p.left.name.text)) ||
          (ts.isPropertyAssignment(p) &&
            p.name.getText(sf).replaceAll(/["']/g, '') === 'error'),
        attribute = ts.isJsxAttribute(p);
      const technicalProperty =
        ts.isPropertyAssignment(p) &&
        technicalProperties.has(p.name.getText(sf).replaceAll(/["']/g, ''));
      const comparison =
        ts.isBinaryExpression(p) &&
        [
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(p.operatorToken.kind);
      const plausible =
        /[a-z]/.test(s) &&
        (/^[A-Z]/.test(s) || s.includes(' ')) &&
        !/[{}<>;=\\]/.test(s) &&
        !sql.test(s) &&
        !s.startsWith('http');
      if (
        ts.isCallExpression(p) &&
        p.expression.getText(sf) === 't' &&
        p.arguments[0] === n
      )
        add(s, n, 'translation-key');
      else if (attribute) {
        if (textAttributes.has(p.name.getText(sf))) add(s, n, 'attribute');
      } else if (error) add(s, n, 'error');
      else if (
        ts.isPropertyAssignment(p) &&
        textAttributes.has(p.name.getText(sf).replaceAll(/["']/g, '')) &&
        (!backend || documentCopy(n))
      )
        add(s, n, 'text-property');
      else if (fieldLabelArgument(n, sf, file)) add(s, n, 'field-label');
      else if (
        !technicalNode(n, sf) &&
        !technicalProperty &&
        !comparison &&
        plausible &&
        (!backend ||
          documentCopy(n) ||
          file.replaceAll('\\', '/').endsWith('/communications/templates.ts'))
      )
        add(s, n, 'literal');
    } else if (ts.isTemplateExpression(n)) {
      let message = n.head.text,
        index = 0;
      for (const span of n.templateSpans)
        message += '{p' + index++ + '}' + span.literal.text;
      const words = message.replace(/\{p\d+\}/g, '');
      const plausible =
        /[a-z]/.test(words) &&
        (/^[A-Z]/.test(words.trim()) || words.trim().includes(' '));
      const textProperty =
        ts.isPropertyAssignment(n.parent) &&
        textAttributes.has(n.parent.name.getText(sf).replaceAll(/["']/g, ''));
      if (
        plausible &&
        (textProperty || !technicalNode(n, sf)) &&
        !/^\s*(query|mutation|subscription|fragment)\b/.test(words) &&
        !/^\s*(\/|\{|https?:)/.test(words) &&
        !sql.test(words) &&
        !/[<>;]/.test(words) &&
        (!backend ||
          errorArgument(n, sf) ||
          fieldLabelArgument(n, sf, file) ||
          documentCopy(n) ||
          file.replaceAll('\\', '/').endsWith('/communications/templates.ts'))
      )
        add(message, n, 'template');
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return [...entries.values()];
}
export async function collectInventory() {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(path.join(root, dir), {
      withFileTypes: true,
    })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (
        /\.(tsx?|js)$/.test(file) &&
        !file.endsWith('.d.ts') &&
        !/\.(test|stories)\./.test(file) &&
        !file.endsWith('examples.tsx')
      )
        files.push(file);
    }
  }
  for (const dir of [
    'apps/frontend/src',
    'packages/ui/src',
    'apps/backend/src/modules',
  ])
    await walk(dir);
  files.push('apps/backend/src/app.ts');
  const all = new Map();
  for (const file of files)
    for (const item of scanSource(
      await readFile(path.join(root, file), 'utf8'),
      file,
    )) {
      const existing = all.get(item.message);
      if (existing) existing.locations.push(...item.locations);
      else all.set(item.message, item);
    }
  const recovery = JSON.parse(
    await readFile(
      path.join(root, 'packages/ui/src/recovery-presets.json'),
      'utf8',
    ),
  );
  function copy(value, key = '') {
    if (
      typeof value === 'string' &&
      (textAttributes.has(key) || key === 'actions')
    ) {
      const message = messageKey(value);
      if (message) {
        const item = all.get(message) ?? { message, locations: [] };
        item.locations.push({
          file: 'packages/ui/src/recovery-presets.json',
          line: 1,
          category: 'recovery',
        });
        all.set(message, item);
      }
    } else if (Array.isArray(value)) value.forEach((item) => copy(item, key));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) copy(v, k);
  }
  copy(recovery);
  return [...all.values()].sort((a, b) => a.message.localeCompare(b.message));
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const items = await collectInventory();
  const destination = process.argv[2] ?? '.cache/p11-message-inventory.json';
  await writeFile(
    path.resolve(root, destination),
    JSON.stringify(items, null, 2) + '\n',
  );
  process.stdout.write(
    `${items.length} candidate messages inventoried; review exclusions and catalogue coverage before claiming localization.\n`,
  );
}
