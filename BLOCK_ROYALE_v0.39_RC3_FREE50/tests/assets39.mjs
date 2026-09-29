import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const config=JSON.parse(readFileSync(new URL('wrangler.jsonc',root),'utf8'));
assert.equal(config.assets.directory,'./public');
assert.equal(config.assets.not_found_handling,'none');
const files=readdirSync(new URL('public/',root),{recursive:true,withFileTypes:true}).filter(x=>x.isFile());
for(const file of files){
 assert(!/\.(sql|md)$/i.test(file.name)&&file.name!=='SHA256.json');
 assert(!/[\\/](\.git|node_modules|supabase|tests|tools)([\\/]|$)/.test(file.parentPath));
}
for(const name of ['index','host','player','projector','practice']){
 const html=readFileSync(new URL(`public/${name}.html`,root),'utf8');
 for(const [,path] of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
  if(/^(https?:|data:)/.test(path))continue;
  readFileSync(new URL(`public/${path.replace(/^\//,'')}`,root));
 }
}
console.log(`PASS static publication is restricted to public/ (${files.length} files); all HTML references resolve`);
