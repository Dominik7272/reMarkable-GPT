.pragma library

function object(properties) { return {type:"object", properties:properties, required:Object.keys(properties), additionalProperties:false}; }
function tools() {
    const string={type:"string"}, boolean={type:"boolean"};
    function tool(name,description,properties) {
        return {type:"function",name:name,description:description,strict:true,
            parameters:object(Object.assign({title:string},properties,{transparent:boolean}))};
    }
    return [
        tool("create_formula","Prepare a formula image preview. latex is display-mode LaTeX without dollar delimiters. Supports fractions, roots, scripts, Greek, integrals, sums and AMS matrices/aligned equations. Rendering is offline. The user presses Insert; this tool does not edit the notebook.",{latex:string}),
        tool("create_note","Prepare a formatted note image preview. markdown supports headings, bold, italic, lists, quotations and fenced code. Use create_formula for mathematics and create_table for tables. The title labels the preview and is not printed. The user presses Insert.",{markdown:string}),
        tool("create_table","Prepare a table image preview. columns are header strings; rows are equally sized arrays of plain text cells. The title is only a preview label. The user presses Insert.",{columns:{type:"array",items:string},rows:{type:"array",items:{type:"array",items:string}}}),
        tool("create_graph","Plot up to eight equations using the graph calculator. Use expressions in x, equations in x and y, or inequalities; named definitions and references such as f1(x) are supported. Bounds must be positive on logarithmic axes. Choose colors as #RRGGBB, show or hide each graph, and set all plot and export options. The user previews and inserts the image.",{
            graphs:{type:"array",items:object({equation:string,color:string,visible:boolean})},
            xmin:{type:"number"},xmax:{type:"number"},ymin:{type:"number"},ymax:{type:"number"},log_x:boolean,log_y:boolean,
            show_equations:boolean,x_axis:boolean,y_axis:boolean,x_numbers:boolean,y_numbers:boolean,axis_labels:boolean,grid:boolean,border:boolean,
            scale:{type:"number"},ratio:{type:"string",enum:["1:1","6:5","5:4","4:3","7:5","3:2","16:10","5:3","16:9","2:1","21:9","3:1","4:1"]},
            portrait:boolean,resolution:{type:"integer",enum:[800,1200,1600,2400]}}),
        tool("create_diagram","Prepare a diagram image preview with automatically arranged nodes and labelled arrows. Give each node a unique id, a short plain text label and box, ellipse or diamond shape. Edges reference node ids. direction is down or right. The user presses Insert.",{
            direction:{type:"string",enum:["down","right"]},
            nodes:{type:"array",items:object({id:string,label:string,shape:{type:"string",enum:["box","ellipse","diamond"]}})},
            edges:{type:"array",items:object({from:string,to:string,label:string})}})
    ];
}
function text(value,name,max) {
    if (typeof value!=="string" || !value.trim() || value.length>max) throw new Error(name+" must contain 1 to "+max+" characters.");
    return value.trim();
}
function keys(value,expected) {
    if (!value || typeof value!=="object" || Array.isArray(value)
            || Object.keys(value).sort().join(",")!==expected.slice().sort().join(",")) throw new Error("Unexpected or missing content fields.");
}
function validate(name,args) {
    const schema=tools().filter(function(tool) { return tool.name===name; })[0];
    if (!schema) throw new Error("Unknown content function.");
    keys(args,schema.parameters.required);
    args=JSON.parse(JSON.stringify(args));
    if (JSON.stringify(args).length>60000) throw new Error("This content is too large. Split it into smaller items.");
    args.title=text(args.title,"title",100);
    if (typeof args.transparent!=="boolean") throw new Error("transparent must be true or false.");
    if (name==="create_formula") args.latex=text(args.latex,"latex",8000);
    if (name==="create_note") args.markdown=text(args.markdown,"markdown",12000);
    if (name==="create_graph") {
        if (!Array.isArray(args.graphs) || !args.graphs.length || args.graphs.length>8) throw new Error("Use 1 to 8 graphs.");
        args.graphs.forEach(function(graph) {
            keys(graph,["equation","color","visible"]);
            graph.equation=text(graph.equation,"equation",300);
            if (!/^#[0-9a-f]{6}$/i.test(graph.color) || typeof graph.visible!=="boolean") throw new Error("Each graph needs a #RRGGBB color and a visibility flag.");
        });
        ["xmin","xmax","ymin","ymax","scale"].forEach(function(key) {
            if (typeof args[key]!=="number" || !isFinite(args[key])) throw new Error(key+" must be a finite number.");
        });
        ["log_x","log_y","show_equations","x_axis","y_axis","x_numbers","y_numbers","axis_labels","grid","border","portrait"].forEach(function(key) {
            if (typeof args[key]!=="boolean") throw new Error(key+" must be true or false.");
        });
        if (args.scale<0.5 || args.scale>3 || [800,1200,1600,2400].indexOf(args.resolution)<0 ||
            ["1:1","6:5","5:4","4:3","7:5","3:2","16:10","5:3","16:9","2:1","21:9","3:1","4:1"].indexOf(args.ratio)<0)
            throw new Error("Invalid graph scale, resolution or aspect ratio.");
    }
    if (name==="create_table") {
        if (!Array.isArray(args.columns) || args.columns.length<1 || args.columns.length>8
                || !Array.isArray(args.rows) || args.rows.length<1 || args.rows.length>40) throw new Error("Use 1 to 8 columns and 1 to 40 rows.");
        args.columns=args.columns.map(function(cell) { return text(cell,"column",120); });
        args.rows=args.rows.map(function(row) {
            if (!Array.isArray(row) || row.length!==args.columns.length) throw new Error("Every row must match the column count.");
            return row.map(function(cell) {
                if (typeof cell!=="string" || cell.length>500) throw new Error("Table cells must be text of at most 500 characters.");
                return cell;
            });
        });
    }
    if (name==="create_diagram") {
        if (["down","right"].indexOf(args.direction)<0) throw new Error("direction must be down or right.");
        if (!Array.isArray(args.nodes) || !args.nodes.length || args.nodes.length>18
                || !Array.isArray(args.edges) || args.edges.length>30) throw new Error("Use up to 18 nodes and 30 edges.");
        const ids=Object.create(null);
        args.nodes.forEach(function(node) {
            keys(node,["id","label","shape"]);
            node.id=text(node.id,"node id",40);node.label=text(node.label,"node label",150);
            if (ids[node.id] || ["box","ellipse","diamond"].indexOf(node.shape)<0) throw new Error("Use unique node ids and supported shapes.");
            ids[node.id]=true;
        });
        args.edges.forEach(function(edge) {
            keys(edge,["from","to","label"]);
            if (!ids[edge.from] || !ids[edge.to] || edge.from===edge.to || typeof edge.label!=="string" || edge.label.length>80)
                throw new Error("Edges need distinct, existing node ids and a label of at most 80 characters.");
        });
    }
    return args;
}
function graphState(value) {
    const a=validate("create_graph",value);
    const bounds={xmin:a.xmin,xmax:a.xmax,ymin:a.ymin,ymax:a.ymax,logX:a.log_x,logY:a.log_y};
    function hue(color) {
        const r=parseInt(color.slice(1,3),16)/255,g=parseInt(color.slice(3,5),16)/255,b=parseInt(color.slice(5,7),16)/255;
        const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
        if (!d) return 0;
        const h=max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4;
        return h/6;
    }
    return {version:1,graphs:a.graphs.map(function(g,i) { return {uid:i+1,text:g.equation,color:g.color,visible:g.visible,hue:hue(g.color)}; }),selected:0,
        limits:[String(a.xmin),String(a.xmax),String(a.ymin),String(a.ymax)],view:bounds,entered:bounds,
        axes:{logX:a.log_x,logY:a.log_y},output:{ratio:a.ratio,portrait:a.portrait,resolution:a.resolution},
        style:{transparent:a.transparent,equation:a.show_equations,xAxis:a.x_axis,yAxis:a.y_axis,xNumbers:a.x_numbers,
            yNumbers:a.y_numbers,axisLabels:a.axis_labels,grid:a.grid,border:a.border,scale:a.scale}};
}
function escape(value) { return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function svg(width,height,body,transparent) {
    if (width>6000 || height>7000 || width*height>16000000) throw new Error("This preview is too large. Split it into smaller items.");
    return {width:Math.ceil(width),height:Math.ceil(height),svg:'<svg xmlns="http://www.w3.org/2000/svg" width="'+Math.ceil(width)+'" height="'+Math.ceil(height)+'" viewBox="0 0 '+width+' '+height+'">'
        +(transparent?'':'<rect width="100%" height="100%" fill="white"/>')+body+'</svg>'};
}
function font(size,style) { return (style==="code"?"normal":style || "normal")+" "+size+"px "+(style==="code"?"monospace":"sans-serif"); }
function label(x,y,value,size,style,anchor) {
    return '<text x="'+x+'" y="'+y+'" fill="black" font-family="'+(style==="code"?"monospace":"sans-serif")+'" font-size="'+size+'"'
        +(style==="bold"?' font-weight="bold"':style==="italic"?' font-style="italic"':"")
        +(anchor?' text-anchor="'+anchor+'"':"")+'>'+escape(value)+'</text>';
}
function wrap(value,width,size,measure,style) {
    const lines=[];
    String(value).split("\n").forEach(function(paragraph) {
        let line="";
        paragraph.split(/\s+/).forEach(function(word) {
            if (!word) return;
            if (line && measure(line+" "+word,font(size,style))>width) { lines.push(line);line=""; }
            // Break long words without throwing away any characters.
            if (measure(word,font(size,style))>width) {
                if (line) { lines.push(line);line=""; }
                for (const ch of word) {
                    if (line && measure(line+ch,font(size,style))>width) { lines.push(line);line=""; }
                    line+=ch;
                }
            } else line+=(line?" ":"")+word;
        });
        lines.push(line);
    });
    return lines;
}
function note(args,measure) {
    let body="",y=30,code=false;
    const width=1000,pad=28;
    args.markdown.split("\n").forEach(function(line) {
        if (/^\s*```/.test(line)) { code=!code;y+=12;return; }
        if (!line.trim()) { y+=18;return; }
        const heading=/^(#{1,6})\s+(.*)/.exec(line);
        const quote=/^>\s?/.test(line);
        const bullet=/^\s*[-*+]\s+/.test(line);
        let size=heading?Math.max(30,48-heading[1].length*4):28;
        if (heading) line=heading[2];
        if (quote) line=line.replace(/^>\s?/,"");
        if (bullet) line="• "+line.replace(/^\s*[-*+]\s+/,"");
        const left=pad+(quote?24:0),lineHeight=size*1.45;
        let x=left;
        y+=size;
        const startY=y-size;
        let runs=[];
        function flush() {
            body+='<text x="'+left+'" y="'+y+'" font-family="sans-serif" font-size="'+size+'" fill="black" xml:space="preserve">';
            runs.forEach(function(run) {
                body+='<tspan'+(run.style==="bold"?' font-weight="bold"':run.style==="italic"?' font-style="italic"':run.style==="code"?' font-family="monospace"':"")+'>'
                    +escape(run.text.replace(/\t/g,"    ").replace(/ /g,"\u00a0"))+'</tspan>';
            });
            body+='</text>';runs=[];
        }
        // Inline emphasis stays as text; no HTML, links or remote resources are evaluated.
        const tokens=code?[line]:line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
        tokens.forEach(function(token) {
            let style=code?"code":heading?"bold":"normal";
            if (/^\*\*.*\*\*$/.test(token)) { style="bold";token=token.slice(2,-2); }
            else if (/^\*.*\*$/.test(token)) { style="italic";token=token.slice(1,-1); }
            else if (/^`.*`$/.test(token)) { token=token.slice(1,-1);style="code"; }
            token.split(/(\s+)/).forEach(function(word) {
                if (!word) return;
                const parts=measure(word,font(size,style))>width-2*pad?Array.from(word):[word];
                parts.forEach(function(part) {
                    const length=measure(part,font(size,style));
                    if (x+length>width-pad && x>left) { flush();x=left;y+=lineHeight; }
                    if (x===left && /^\s+$/.test(part) && !code) return;
                    if (runs.length && runs[runs.length-1].style===style) runs[runs.length-1].text+=part;
                    else runs.push({text:part,style:style});
                    x+=length;
                });
            });
        });
        flush();
        if (quote) body+='<path d="M '+pad+' '+startY+' V '+(y+8)+'" stroke="black" stroke-width="3"/>';
        y+=lineHeight-size+10;
    });
    return svg(width,y+pad,body,args.transparent);
}
function table(args,measure) {
    const width=Math.max(900,args.columns.length*180),pad=24,cellWidth=(width-2*pad)/args.columns.length;
    let body="",y=pad;
    [args.columns].concat(args.rows).forEach(function(row,index) {
        const lines=row.map(function(cell) { return wrap(cell,cellWidth-28,27,measure,index===0?"bold":"normal"); });
        const height=Math.max.apply(null,lines.map(function(cell) { return cell.length; }))*39+24;
        row.forEach(function(cell,col) {
            const x=pad+col*cellWidth;
            body+='<rect x="'+x+'" y="'+y+'" width="'+cellWidth+'" height="'+height+'" fill="none" stroke="black" stroke-width="2"/>';
            lines[col].forEach(function(line,i) { body+=label(x+14,y+36+i*39,line,27,index===0?"bold":"normal"); });
        });
        y+=height;
    });
    return svg(width,y+pad,body,args.transparent);
}
function diagram(args,measure) {
    const levels=Object.create(null),remaining=args.nodes.slice(),placed=[];
    for (let step=0;remaining.length && step<args.nodes.length;step++) {
        let progress=false;
        for (let i=remaining.length-1;i>=0;i--) {
            const node=remaining[i],incoming=args.edges.filter(function(edge) { return edge.to===node.id; });
            if (incoming.every(function(edge) { return levels[edge.from]!==undefined; })) {
                levels[node.id]=incoming.length?Math.max.apply(null,incoming.map(function(edge) { return levels[edge.from]; }))+1:0;
                placed.push(node);remaining.splice(i,1);progress=true;
            }
        }
        if (!progress) break;
    }
    remaining.forEach(function(node) { levels[node.id]=0; });
    const bands=[];
    args.nodes.forEach(function(node) { const level=levels[node.id];if (!bands[level]) bands[level]=[];bands[level].push(node); });
    const maxBand=Math.max.apply(null,bands.map(function(band) { return band.length; }));
    const horizontal=args.direction==="right",w=280,h=154,gapX=110,gapY=110,pad=40;
    const width=2*pad+(horizontal?bands.length:maxBand)*(w+gapX)-gapX;
    const height=2*pad+(horizontal?maxBand:bands.length)*(h+gapY)-gapY;
    const positions=Object.create(null);
    bands.forEach(function(band,level) {
        band.forEach(function(node,index) {
            const offset=(maxBand-band.length)/2;
            positions[node.id]={x:pad+(horizontal?level:index+offset)*(w+gapX),y:pad+(horizontal?index+offset:level)*(h+gapY),node:node};
        });
    });
    let body="";
    args.edges.forEach(function(edge) {
        const a=positions[edge.from],b=positions[edge.to];
        let x1=a.x+w/2,y1=a.y+h/2,x2=b.x+w/2,y2=b.y+h/2;
        const dx=x2-x1,dy=y2-y1;
        function boundary(node) {
            if (node.shape==="ellipse") return 1/Math.sqrt(dx*dx/(w*w/4)+dy*dy/(h*h/4));
            if (node.shape==="diamond") return 1/(Math.abs(dx)/(w/2)+Math.abs(dy)/(h/2));
            return Math.min(dx?Math.abs((w/2)/dx):Infinity,dy?Math.abs((h/2)/dy):Infinity);
        }
        const ta=boundary(a.node),tb=boundary(b.node);
        x1+=dx*ta;y1+=dy*ta;x2-=dx*tb;y2-=dy*tb;
        body+='<path d="M '+x1+' '+y1+' L '+x2+' '+y2+'" stroke="black" stroke-width="3" fill="none"/>';
        const angle=Math.atan2(y2-y1,x2-x1),len=14;
        body+='<path d="M '+(x2-len*Math.cos(angle-.45))+' '+(y2-len*Math.sin(angle-.45))+' L '+x2+' '+y2+' L '+(x2-len*Math.cos(angle+.45))+' '+(y2-len*Math.sin(angle+.45))+'" stroke="black" stroke-width="3" fill="none"/>';
        if (edge.label) {
            const vertical=Math.abs(y2-y1)>Math.abs(x2-x1);
            const lx=(x1+x2)/2+(vertical?16:0),ly=(y1+y2)/2+(vertical?7:-12),tw=measure(edge.label,font(22))+12;
            if (!args.transparent) body+='<rect x="'+(vertical?lx-6:lx-tw/2)+'" y="'+(ly-24)+'" width="'+tw+'" height="30" fill="white"/>';
            body+=label(lx,ly,edge.label,22,"normal",vertical?"start":"middle");
        }
    });
    args.nodes.forEach(function(node) {
        const p=positions[node.id],fill=args.transparent?"none":"white";
        if (node.shape==="ellipse") body+='<ellipse cx="'+(p.x+w/2)+'" cy="'+(p.y+h/2)+'" rx="'+w/2+'" ry="'+h/2+'" fill="'+fill+'" stroke="black" stroke-width="3"/>';
        else if (node.shape==="diamond") body+='<path d="M '+(p.x+w/2)+' '+p.y+' L '+(p.x+w)+' '+(p.y+h/2)+' L '+(p.x+w/2)+' '+(p.y+h)+' L '+p.x+' '+(p.y+h/2)+' Z" fill="'+fill+'" stroke="black" stroke-width="3"/>';
        else body+='<rect x="'+p.x+'" y="'+p.y+'" width="'+w+'" height="'+h+'" fill="'+fill+'" stroke="black" stroke-width="3"/>';
        const lines=wrap(node.label,node.shape==="diamond"?w*.52:w-38,26,measure);
        if (lines.length>3) throw new Error("A diagram label is too long. Shorten the node labels.");
        lines.forEach(function(line,index) { body+=label(p.x+w/2,p.y+h/2+(index-(lines.length-1)/2)*35+9,line,26,"normal","middle"); });
    });
    return svg(width,height,body,args.transparent);
}
function formula(args,result) {
    const padding=24;
    const match=/\bviewBox="([^"]+)"/.exec(result.svg);
    if (!match) throw new Error("The formula has no image bounds.");
    const box=match[1].split(/\s+/).map(Number);
    const body=result.svg.replace(/^<svg\b[^>]*>/,"").replace(/<\/svg>\s*$/,"");
    // Qt's SVG Tiny renderer does not support nested SVG viewports.
    return svg(result.width+padding*2,result.height+padding*2,
        '<g transform="translate('+padding+' '+padding+') scale('+(result.width/box[2])+' '+(result.height/box[3])+') translate('+(-box[0])+' '+(-box[1])+')">'+body+'</g>',args.transparent);
}
function render(name,args,measure) {
    if (name==="create_note") return note(args,measure);
    if (name==="create_table") return table(args,measure);
    if (name==="create_diagram") return diagram(args,measure);
    throw new Error("Unsupported content renderer.");
}
