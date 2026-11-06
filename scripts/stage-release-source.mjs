// Make an LF-normalized, allowlisted source snapshot without changing the checkout.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const destination = resolve(root, process.argv[2] || 'artifacts/github-0.3.0/source');
if (!destination.startsWith(resolve(root, 'artifacts') + '\\') && !destination.startsWith(resolve(root, 'artifacts') + '/')) throw new Error('Destination must be inside artifacts');
const omitted = new Set(['node_modules', 'build', '.gradle', 'target', 'bin', 'obj', 'demo']);
const texts = new Set(['.js','.mjs','.json','.html','.css','.svg','.md','.txt','.yml','.yaml','.sh','.ps1','.kt','.java','.xml','.gradle','.properties','.cs','.csproj','.rs','.toml','.lock','.iss','.rules','.desktop','.service','.webmanifest','.install']);
const hashes = [];
async function copy(path) {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const item of await readdir(path)) if (!omitted.has(item) && !['local.properties', 'debug.keystore'].includes(item)) await copy(resolve(path,item));
    return;
  }
  const name = relative(root,path).replaceAll('\\','/');
  // No local signing material belongs in a source archive.
  if (/\.(jks|keystore|p12|pfx|pem|key)$/i.test(name)) throw new Error(`Unexpected signing material: ${name}`);
  let bytes = await readFile(path);
  if (texts.has(extname(path)) || (!extname(path) && !bytes.includes(0))) bytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
  const out = resolve(destination,name);
  await mkdir(dirname(out),{recursive:true}); await writeFile(out,bytes);
  hashes.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for (const name of ['package.json','package-lock.json','server.js','LICENSE','README.md','CHANGELOG.md','.gitattributes','.dockerignore','vercel.json','giscus.json','api','test','src','public','scripts','native','android','ios','docs','website','.github']) await copy(resolve(root,name));
await writeFile(resolve(destination,'source-sha256.json'),JSON.stringify(hashes.sort((a,b)=>a.path.localeCompare(b.path)),null,2)+'\n');
console.log(`Staged ${hashes.length} source files in ${destination}`);
