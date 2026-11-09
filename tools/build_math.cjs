const {build}=require('esbuild');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'lib/vendor'),{recursive:true});
// Qt reserves Function.connect for signals. Rename MathJax's internal CSS map
// while bundling, leaving the installed dependency and Qt's globals untouched.
build({entryPoints:[path.join(__dirname,'math_worker_entry.js')],outfile:path.join(root,'lib/vendor/MathWorker.js'),
  bundle:true,format:'iife',platform:'neutral',target:'es2017',minify:process.env.MATH_DEBUG!=='1',
  banner:{js:'// MathJax 3.2.2, Apache-2.0. Built by tools/build_math.cjs.\ntry {'},
  footer:{js:'} catch (error) { var failure=String(error.message || error); console.warn("Formula worker:", error.stack); WorkerScript.onMessage=function(message) { WorkerScript.sendMessage({token:message.token,error:"Formula renderer unavailable: "+failure}); }; }'},
  plugins:[{name:'qt-function-connect',setup(builder) {
    builder.onLoad({filter:/mathjax-full\/js\/util\/Styles\.js$/},args=>({
      contents:fs.readFileSync(args.path,'utf8').replace(/Styles\.connect\b/g,'Styles.styleConnections'),loader:'js'
    }));
  }}]
}).then(()=>fs.copyFileSync(path.join(root,'node_modules/mathjax-full/LICENSE'),path.join(root,'lib/vendor/MathJax-LICENSE.txt')))
  .catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
