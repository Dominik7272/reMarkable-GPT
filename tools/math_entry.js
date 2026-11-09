import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
const adaptor=liteAdaptor();
RegisterHTMLHandler(adaptor);
const document=mathjax.document('', {
  InputJax:new TeX({packages:['base','ams','newcommand'], maxBuffer:12000, maxMacros:500,
    formatError:(_jax,error)=>{throw error;}}),
  OutputJax:new SVG({fontCache:'none'})
});
export function render(latex) {
  const container=document.convert(latex,{display:true,em:36,ex:18,containerWidth:1100});
  const node=adaptor.tags(container,'svg')[0];
  if (!node) throw new Error('Could not typeset the formula.');
  const box=adaptor.getAttribute(node,'viewBox').split(/\s+/).map(Number);
  const width=Math.max(1,Math.ceil(box[2]*.036));
  const height=Math.max(1,Math.ceil(box[3]*.036));
  if (width>8000 || height>8000) throw new Error('The formula is too large. Split it into smaller formulas.');
  adaptor.setAttribute(node,'width',String(width));
  adaptor.setAttribute(node,'height',String(height));
  adaptor.setAttribute(node,'color','black');
  adaptor.setAttribute(node,'fill','black');
  adaptor.removeAttribute(node,'style');
  const svg=adaptor.outerHTML(node).replace(/currentColor/g,'black');
  document.clear();
  return {svg,width,height};
}
