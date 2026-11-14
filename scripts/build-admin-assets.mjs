import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory = new URL('../public/admin/', import.meta.url);
let html = await readFile(new URL('index.html', directory), 'utf8');
for (const extension of ['css', 'js']) {
  const source = new URL(`admin.${extension}`, directory);
  const hash = createHash('sha256').update(await readFile(source)).digest('hex').slice(0,12);
  const name = `admin.${hash}.${extension}`;
  await copyFile(source, new URL(name, directory));
  html = html.replace(new RegExp(`/admin/admin(?:\\.[a-f0-9]{12})?\\.${extension}`, 'g'), `/admin/${name}`);
}
await writeFile(new URL('index.html', directory), html);
console.log('Admin asset versions updated');
