import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
export async function buildAuth(outDir=new URL('../app/vendor/',import.meta.url)) {
 await build({stdin:{contents:"export {createClient} from '@supabase/supabase-js';",resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,outfile:fileURLToPath(new URL('supabase.mjs',outDir))});
}
if(process.argv[1]===fileURLToPath(import.meta.url))await buildAuth();
