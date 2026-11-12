'use strict';
// Dependency-free checks for this documentation-only showcase. Node.js 18+.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const errors = [];
let links = 0;
const normalise = value => value.split(path.sep).join('/');
const slug = value => value.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
const headingIds = file => new Set([...fs.readFileSync(file, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => slug(match[1])));
function walk(folder) {
  return fs.readdirSync(folder, {withFileTypes:true}).flatMap(entry => {
    if (entry.name === '.git') return [];
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) { errors.push(`Symbolic links are not allowed: ${file}`); return []; }
    return entry.isDirectory() ? walk(file) : [file];
  });
}
function checkLink(target, source) {
  if (/^https:\/\//i.test(target) || /^mailto:/i.test(target)) return;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) { errors.push(`Unexpected link protocol in ${source}: ${target}`); return; }
  links++;
  const [relative, fragment] = target.split('#');
  let decoded;
  try { decoded = decodeURIComponent(relative.split('?')[0]); }
  catch { errors.push(`Invalid link encoding in ${source}: ${target}`); return; }
  const destination = decoded ? path.resolve(path.dirname(source), decoded) : source;
  if (destination !== root && !destination.startsWith(root + path.sep)) { errors.push(`Link escapes repository: ${target}`); return; }
  if (!fs.existsSync(destination)) { errors.push(`Missing local link in ${normalise(path.relative(root,source))}: ${target}`); return; }
  if (fragment && destination.endsWith('.md') && !headingIds(destination).has(fragment)) errors.push(`Missing heading in ${target}`);
}
const files = walk(root);
for (const file of files) {
  const relative = normalise(path.relative(root, file));
  if (!/\.(md|svg|png|yml)$/i.test(file) && relative !== '.github/scripts/check-showcase.cjs') errors.push(`Unexpected file type: ${relative}`);
  if (/(^|\/)\.env(?:\.|$)|\.(sql|sqlite|db|pem|key|p12|pfx|php)$/i.test(relative)) errors.push(`Sensitive or production file type: ${relative}`);
  const bytes = fs.readFileSync(file);
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) errors.push(`File empty or larger than 2 MiB: ${relative}`);
  if (file.endsWith('.md')) {
    const text = bytes.toString('utf8');
    for (const match of text.matchAll(/(?:src|href)="([^"]+)"/g)) checkLink(match[1], file);
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)) checkLink(match[1], file);
  }
  if (file.endsWith('.svg')) {
    const text = bytes.toString('utf8');
    if (!text.includes('<svg') || !text.includes('</svg>')) errors.push(`Invalid SVG wrapper: ${relative}`);
    if (/<script|<foreignObject|(?:href|src)\s*=|\bon\w+\s*=/i.test(text)) errors.push(`Active or externally linked SVG content: ${relative}`);
    if (!text.includes('<title')) errors.push(`Missing accessible SVG title: ${relative}`);
  }
  if (file.endsWith('.png') && (bytes.length < 24 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a')) errors.push(`Invalid PNG signature: ${relative}`);
  if (file.endsWith('.yml')) {
    let form;
    try { form = JSON.parse(bytes.toString('utf8')); }
    catch { errors.push(`Issue forms use the JSON-compatible YAML subset: ${relative}`); continue; }
    if (path.basename(file) === 'config.yml') {
      if (typeof form.blank_issues_enabled !== 'boolean' || !Array.isArray(form.contact_links) || form.contact_links.some(link=>!link.name || !link.about || !/^https:\/\//.test(link.url))) errors.push(`Invalid issue chooser config: ${relative}`);
    } else {
      if (!form.name || !form.description || !Array.isArray(form.body)) { errors.push(`Invalid issue form: ${relative}`); continue; }
      const ids = new Set();
      for (const field of form.body) {
        if (!['markdown','input','textarea','dropdown','checkboxes'].includes(field.type) || !field.attributes) errors.push(`Unsupported issue field: ${relative}`);
        if (field.type !== 'markdown' && (!field.id || ids.has(field.id) || !field.attributes.label)) errors.push(`Missing or duplicate field id/label: ${relative}`);
        if (field.id) ids.add(field.id);
      }
    }
  }
}
for (const name of ['README.md','CONTRIBUTING.md','SECURITY.md','.github/ISSUE_TEMPLATE/bug_report.yml','.github/ISSUE_TEMPLATE/improvement.yml','.github/ISSUE_TEMPLATE/config.yml','.github/scripts/check-showcase.cjs']) {
  if (!fs.existsSync(path.join(root,name))) errors.push(`Missing required showcase file: ${name}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${files.length} files and ${links} local references checked in ${path.basename(root)}.`);
  console.log('Scope: documentation/assets/forms only; no live workflow tests or comprehensive secret scan.');
}
