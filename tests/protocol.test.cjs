const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load(name) {
  const scope = {};
  vm.createContext(scope);
  let source=fs.readFileSync(path.join(__dirname,'../lib',name),'utf8').replace(/^\.pragma library\s*/,'');
  source=source.replace(/^\.import "([^"]+)" as (\w+)\s*$/gm,(_,file,alias)=>{scope[alias]=load(file);return '';});
  vm.runInContext(source,scope);
  return scope;
}
const page=load('PageImage.js'), protocol=load('ChatProtocol.js');
const context={documentId:'doc-1',documentTitle:'Notebook',pageNumber:3,pageId:'page-3'};
const content=load('Content.js');
test('content tools use strict schemas and reject invalid tables and diagrams',()=>{
  for(const tool of content.tools()) {
    assert.equal(tool.strict,true);
    assert.equal(tool.parameters.additionalProperties,false);
    assert.deepEqual([...tool.parameters.required].sort(),Object.keys(tool.parameters.properties).sort());
  }
  const formula={title:'Formula',latex:'x^2',transparent:true};
  assert.equal(content.validate('create_formula',formula).latex,'x^2');
  assert.throws(()=>content.validate('create_formula',{...formula,file:'/tmp/other'}));
  assert.throws(()=>content.validate('create_formula',{...formula,transparent:'yes'}));
  assert.throws(()=>content.validate('create_formula',{...formula,latex:'x'.repeat(8001)}));
  assert.throws(()=>content.validate('create_table',{title:'T',transparent:true,columns:['A','B'],rows:[['one']]}));
  const diagram={title:'D',transparent:true,direction:'down',nodes:[{id:'a',label:'Start',shape:'box'}],edges:[]};
  assert.equal(content.validate('create_diagram',diagram).nodes.length,1);
  assert.throws(()=>content.validate('create_diagram',{...diagram,nodes:[...diagram.nodes,...diagram.nodes]}));
  assert.throws(()=>content.validate('create_diagram',{...diagram,edges:[{from:'a',to:'missing',label:''}]}));
  const args=protocol.toolArguments({call_id:'create',name:'create_formula',arguments:JSON.stringify(formula)},context);
  assert.equal(args.content,true);
});
test('rendered notebook content escapes text and keeps backgrounds optional',()=>{
  const measure=text=>text.length*14;
  const note=content.note({markdown:'# A <script>\n\n**Bold** and `code`\n\n- Item',transparent:true},measure);
  assert.ok(note.svg.includes('&lt;script&gt;') && note.svg.includes('font-weight="bold"'));
  assert.ok(note.svg.includes('font-family="monospace"'));
  assert.ok(!note.svg.includes('<script>') && !note.svg.includes('width="100%"'));
  const table=content.table({columns:['Name','Value'],rows:[['A & B','<image href="file:///etc/passwd"/>']],transparent:false},measure);
  assert.ok(table.svg.includes('&amp;') && !table.svg.includes('<image'));
  assert.ok(table.svg.includes('width="100%"'));
  const lines=content.wrap('verylongword'.repeat(10),100,28,measure);
  assert.equal(lines.join(''),'verylongword'.repeat(10));
});
test('native insertion handler checks document, page and image ownership before writing',()=>{
  const qmd=fs.readFileSync(path.join(__dirname,'../chatGPT.qmd'),'utf8');
  const start=qmd.indexOf('function onImageReady('),brace=qmd.indexOf('{',start);
  let depth=1,end=brace+1;
  while(depth && end<qmd.length){if(qmd[end]==='{')depth++;else if(qmd[end]==='}')depth--;end++;}
  const effects=[];
  const chat={creations:{errorMessage:''},contentInserted:id=>effects.push(['confirmed',id])};
  const root={document:{id:'doc-1'},isLoading:false,currentPageId:'page-3',notePage:true};
  const sceneController={insertImageFileAsSceneItem:(url,position)=>effects.push(['insert',url,position])};
  const scope={root,sceneController,chatGPTLoader:{item:chat},Qt:{point:(x,y)=>({x,y})},
    sceneView:{width:1200,height:1800,viewToScene:point=>point,endItemSelection:()=>effects.push(['selection'])}};
  const insert=vm.runInNewContext('('+qmd.slice(start,end)+')',scope);
  const url='file:///home/root/xovi/ChatGPT/images/content-123-1.png';
  insert(url,{documentId:'other',pageId:'page-3'},'a');
  insert(url,{documentId:'doc-1',pageId:'other-page'},'a');
  insert('file:///tmp/unowned.png',{documentId:'doc-1',pageId:'page-3'},'a');
  root.isLoading=true;insert(url,{documentId:'doc-1',pageId:'page-3'},'a');root.isLoading=false;
  assert.equal(effects.length,0);
  insert(url,{documentId:'doc-1',pageId:'page-3'},'a');
  assert.equal(effects[1][0],'insert');
  assert.equal(effects[1][2].x,600);assert.equal(effects[1][2].y,900);
  assert.deepEqual(effects[2],['confirmed','a']);
});
const image={...context,pageNumber:8,pageId:'page-8',dataUrl:'data:image/png;base64,aGVsbG8=',capturedAt:'2026-11-06T01:00:00.000Z'};
test('configurable API base preserves paths and normalizes endpoint slashes',()=>{
  assert.equal(protocol.responseEndpoint('https://api.openai.com/v1'),'https://api.openai.com/v1/responses');
  assert.equal(protocol.responseEndpoint(' https://gateway.example.test/proxy/v1/// '),'https://gateway.example.test/proxy/v1/responses');
  assert.equal(protocol.responseEndpoint('http://192.168.1.10:8080/v1'),'http://192.168.1.10:8080/v1/responses');
  assert.equal(protocol.responseEndpoint('http://[::1]:8080/v1/responses/'),'http://[::1]:8080/v1/responses');
  for(const url of ['', 'file:///etc/passwd', 'ftp://example.com', 'https://', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=x', 'https://example.com/#x'])
    assert.throws(()=>protocol.responseEndpoint(url),/baseUrl/);
});
test('whole-page geometry includes extended paper and negative coordinates within the pixel budget',()=>{
  const result=page.layout([{x:0,y:0,width:1600,height:2200},{x:-80,y:6000,width:900,height:400}],2048);
  assert.equal(result.rect.x,-80);
  assert.equal(result.rect.height,6400);
  assert.equal(result.height,2048);
  assert.equal(result.width,538);
  assert.equal(result.center.y,3200);
  assert.ok(result.width*result.height<=4096*4096);
  assert.throws(()=>page.layout([],2048),/bounds/);
});
test('page selection rejects fractional, missing and out of range indices',()=>{
  for(const n of [-1,3,NaN,1.5,'1',null]) assert.equal(page.validIndex(n,3),false);
  for(const n of [0,1,2]) assert.equal(page.validIndex(n,3),true);
  assert.equal(page.samePage(context,image),false);
});
test('current position stays distinct from an attachment on another page',()=>{
  const turn=protocol.userTurn('Read this diagram',context,image);
  assert.match(turn.content[0].text,/Page 3 \[page-3\]/);
  assert.match(turn.content[1].text,/Page 8 \[page-8\]/);
  assert.equal(turn.content[2].type,'input_image');
  assert.equal(turn.content[2].image_url,image.dataUrl);
  const body=protocol.requestBody('chosen-model',[],turn);
  assert.equal(body.store,false);
  assert.equal(body.stream,true);
  assert.equal(body.model,'chosen-model');
  assert.equal(body.input.length,1);
  assert.throws(()=>protocol.userTurn('hi',context,{...image,documentId:'other'}),/another document/);
  assert.throws(()=>protocol.userTurn('hi',context,{...image,dataUrl:'file:///etc/passwd'}),/PNG/);
  assert.throws(()=>protocol.userTurn(' ',context,null),/message/);
  assert.throws(()=>protocol.requestBody('',[],turn),/model/);
});
test('response extraction handles multiple messages, refusals and incomplete replies',()=>{
  assert.equal(protocol.responseText({status:'completed',output:[{type:'reasoning'},{type:'message',role:'assistant',content:[{type:'output_text',text:'Answer'}]}]}),'Answer');
  assert.equal(protocol.responseText({output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'Cannot answer'}]}]}),'Cannot answer');
  assert.throws(()=>protocol.responseText({status:'failed'}),/failed/);
  assert.throws(()=>protocol.responseText({output:[]}),/no text/);
});

test('streamed replies use the completed response, regardless of MIME type',()=>{
  const response={status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'OK'}]}]};
  const stream=': keepalive\r\n\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"partial"}\r\n\r\nevent: response.completed\r\ndata: '+JSON.stringify({type:'response.completed',response})+'\r\n\r\ndata: [DONE]\r\n\r\n';
  assert.equal(protocol.readReply(stream),'OK');
  assert.equal(protocol.readReply(JSON.stringify(response)),'OK');
  assert.equal(protocol.readReply('event: response.completed\ndata: '+JSON.stringify({response})),'OK');
  assert.throws(()=>protocol.readReply('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n'),/before the response finished/);
  assert.throws(()=>protocol.readReply('event: error\ndata: {"type":"error","message":"Bad input"}\n\n'),/Bad input/);
  assert.throws(()=>protocol.readReply('event: response.failed\ndata: {"type":"response.failed","response":{"error":{"message":"Model failed"}}}\n\n'),/Model failed/);
  assert.throws(()=>protocol.readReply('data: {broken}\n\n'));
});

test('HTTP errors retain the reason and redact keys and page data',()=>{
  assert.equal(protocol.httpError(400,JSON.stringify({detail:'Stream must be set to true'}),''),'HTTP 400: Stream must be set to true');
  assert.equal(protocol.httpError(400,JSON.stringify({error:{message:'Unsupported parameter: stream'}}),''),'HTTP 400: Unsupported parameter: stream');
  assert.equal(protocol.httpError(400,JSON.stringify({detail:[{msg:'Field required'}]}),''),'HTTP 400: Field required');
  assert.equal(protocol.httpError(500,'<html>Gateway failed</html>',''),'The API returned HTTP 500.');
  assert.equal(protocol.httpError(403,'error code: 1010',''),'HTTP 403: error code: 1010');
  const message=protocol.httpError(400,JSON.stringify({detail:'Secret test-key and Bearer other-key with data:image/png;base64,aGVsbG8='}),'test-key');
  assert.ok(!message.includes('test-key') && !message.includes('other-key') && !message.includes('aGVsbG8='));
});

test('page tool arguments enforce the open document and whole page numbers',()=>{
  const ctx={...context,pageCount:9};
  const invoke=(name,args)=>protocol.toolArguments({call_id:'test',name,arguments:JSON.stringify(args)},ctx);
  assert.equal(invoke('read_current_page',{}).pageIndex,2);
  assert.equal(invoke('read_page',{page_number:9}).pageIndex,8);
  assert.equal(invoke('get_document_context',{}).pageIndex,-1);
  for(const page of [0,-1,10,1.2,'3',null])assert.throws(()=>invoke('read_page',{page_number:page}));
  assert.throws(()=>invoke('read_page',{page_number:3,document_id:'other'}));
  assert.throws(()=>invoke('read_current_page',{page_number:3}));
  assert.throws(()=>invoke('delete_page',{}));
  const result=protocol.toolOutput('call-1',{pageNumber:8},image);
  assert.equal(result.type,'function_call_output');
  assert.equal(result.call_id,'call-1');
  assert.equal(result.output[1].type,'input_image');
  assert.throws(()=>protocol.toolOutput('call-1',{},{}));
});

test('tool-only streams retain reasoning and function calls for the next request',()=>{
  const result={status:'completed',output:[{type:'reasoning',encrypted_content:'opaque'},{type:'function_call',call_id:'call-1',name:'read_current_page',arguments:'{}',status:'completed'}]};
  const parsed=protocol.parseReply('data: '+JSON.stringify({type:'response.completed',response:result})+'\n\n');
  assert.equal(parsed.output[0].encrypted_content,'opaque');
  assert.equal(protocol.functionCalls(parsed)[0].call_id,'call-1');
  const request=protocol.requestItemsBody('model',parsed.output,context,false);
  assert.equal(request.tool_choice,'none');
  assert.equal(request.include[0],'reasoning.encrypted_content');
  assert.ok(!Object.hasOwn(parsed.output[1],'pageIndex'));
});

test('Markdown keeps fenced code literal and separates readable tables',()=>{
  const markdown=load('Markdown.js');
  const blocks=markdown.blocks('## Heading\n\n| Left | Right |\n| --- | ---: |\n| a | `b|c` |\n\n```html\n<img src="test">\n```\n\n![image](https://example.com/pixel) <img src="file:///private">');
  assert.equal(blocks[1].kind,'table');
  assert.equal(blocks[1].rows[1][1],'`b|c`');
  assert.equal(blocks[1].align[1],'right');
  assert.equal(blocks[2].kind,'code');
  assert.equal(blocks[2].text,'<img src="test">');
  assert.ok(blocks[3].text.includes('\\!['));
  assert.ok(!blocks[3].text.includes('<img'));
  for(const name of ['PageReader.qml','NativePageRenderer.qml']) {
    const source=fs.readFileSync(path.join(__dirname,'..',name),'utf8');
    assert.ok(!/\.grabToImage\s*\(/.test(source),'Qt layer grabs must not reappear in the device capture path');
  }
});
