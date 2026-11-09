// Read-only local reference viewer. Reference drawings are never app implementation assets.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const references = path.join(root, 'docs/design/figma');
const inventory = JSON.parse(
  (await readFile(path.join(references, 'inventory.json'), 'utf8')).replace(
    /^\uFEFF/,
    '',
  ),
);
const permitted = new Set(inventory.map((item) => item.reference));
const fontMap = {
  Inter: 'inter',
  Manrope: 'manrope',
  'Nunito Sans': 'nunito-sans',
  Lora: 'lora',
};
const escape = (value) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4174');
    if (url.pathname === '/font') {
      const family = url.searchParams.get('family');
      const style =
        url.searchParams.get('style') === 'italic' ? 'italic' : 'normal';
      const packageName = fontMap[family];
      if (!packageName || (packageName === 'manrope' && style === 'italic')) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'font/woff2');
      res.end(
        await readFile(
          path.join(
            root,
            `node_modules/@fontsource-variable/${packageName}/files/${packageName}-latin-wght-${style}.woff2`,
          ),
        ),
      );
      return;
    }
    const styles = Object.entries(fontMap)
      .flatMap(([family, packageName]) =>
        (packageName === 'manrope' ? ['normal'] : ['normal', 'italic']).map(
          (style) =>
            `@font-face{font-family:"${family}";font-style:${style};font-weight:100 900;src:url("/font?family=${encodeURIComponent(family)}&style=${style}") format("woff2")}`,
        ),
      )
      .join('');
    const file = url.searchParams.get('file');
    if (file && permitted.has(file)) {
      const svg = await readFile(path.join(references, file), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        `<!doctype html><html><head><title>${escape(file)}</title><style>${styles}body{margin:0}</style></head><body>${svg}</body></html>`,
      );
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      `<!doctype html><html><head><title>Daybook Figma references</title></head><body><h1>187 exported Figma references</h1><p>Local reference drawings for visual review. The interactive library is at <a href="http://localhost:3000/ui">localhost:3000/ui</a>.</p><ul>${inventory.map((item) => `<li><a href="/?file=${encodeURIComponent(item.reference)}">${escape(item.reference)}</a> · ${item.width} × ${item.height}</li>`).join('')}</ul></body></html>`,
    );
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
server.listen(4174, '127.0.0.1', () =>
  console.log('Design references: http://127.0.0.1:4174'),
);
