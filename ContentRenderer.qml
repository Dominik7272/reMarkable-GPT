import QtQuick
import QtQml.WorkerScript
import "lib/Content.js" as Content
import "lib/GraphMath.js" as GraphMath

Item {
    id: renderer
    x: -10000
    width: 1
    height: 1
    property int generation: 0
    property bool busy: false
    property string toolName: ""
    property var spec: null
    property string mode: ""
    property string savePath: ""
    property var graphModel: null
    property var graphOptions: null
    signal ready(var image)
    signal saved(url fileUrl)
    signal failed(string message)

    function cancel() {
        generation++;busy=false;deadline.stop();start.stop();
        canvas.unloadImage(canvas.imageUrl);canvas.imageUrl="";
    }
    function fail(message) { cancel();failed(String(message)); }
    function render(name,args) {
        cancel();busy=true;mode="render";toolName=name;spec=args;
        deadline.restart();start.restart();
    }
    function saveImage(image,path) {
        cancel();busy=true;mode="save";savePath=path;deadline.restart();
        load({width:image.width,height:image.height},image.dataUrl,1);
    }
    function load(size,url,scale) {
        const factor=Math.min(scale,3072/Math.max(size.width,size.height));
        canvas.width=Math.max(1,Math.round(size.width*factor));
        canvas.height=Math.max(1,Math.round(size.height*factor));
        canvas.canvasSize=Qt.size(canvas.width,canvas.height);
        canvas.imageUrl=url;canvas.loadImage(url);
        if (canvas.isImageLoaded(url)) canvas.requestPaint();
    }
    function encode(svg) {
        load(svg,"data:image/svg+xml;base64,"+Qt.btoa(svg.svg),2);
    }
    Timer {
        id: start
        interval: 1
        onTriggered: {
            try {
                if (renderer.toolName==="create_formula") {
                    // The worker parses MathJax only on the first formula, off the UI thread.
                    math.source=Qt.resolvedUrl("lib/vendor/MathWorker.js");
                    math.sendMessage({token:renderer.generation,latex:renderer.spec.latex});
                } else if (renderer.toolName==="create_graph") {
                    const a=renderer.spec;
                    const bounds=GraphMath.validateBounds({xmin:a.xmin,xmax:a.xmax,ymin:a.ymin,ymax:a.ymax,logX:a.log_x,logY:a.log_y});
                    const entries=a.graphs.map(function(g,i) { return {name:"f"+(i+1),text:g.equation,color:g.color,visible:g.visible}; });
                    renderer.graphModel=GraphMath.graphModel(entries,bounds);
                    if (!renderer.graphModel.graphs.length) throw new Error("At least one visible graph is required.");
                    renderer.graphOptions={transparent:a.transparent,equation:a.show_equations,xAxis:a.x_axis,yAxis:a.y_axis,
                        xNumbers:a.x_numbers,yNumbers:a.y_numbers,axisLabels:a.axis_labels,grid:a.grid,border:a.border,scale:a.scale};
                    const size=GraphMath.outputSize({ratio:a.ratio,portrait:a.portrait,resolution:a.resolution});
                    canvas.width=size.width;canvas.height=size.height;canvas.canvasSize=Qt.size(size.width,size.height);
                    renderer.mode="graph";canvas.requestPaint();
                } else {
                    const ctx=canvas.getContext("2d");
                    if (!ctx) throw new Error("The image canvas is unavailable.");
                    renderer.encode(Content.render(renderer.toolName,renderer.spec,function(text,font) {
                        ctx.font=font;return ctx.measureText(text).width;
                    }));
                }
            } catch (error) { renderer.fail(error.message || error); }
        }
    }
    WorkerScript {
        id: math
        onMessage: (message) => {
            if (!renderer.busy || message.token!==renderer.generation) return;
            if (message.error) { renderer.fail(message.error);return; }
            try { renderer.encode(Content.formula(renderer.spec,message.result)); }
            catch (error) { renderer.fail(error.message || error); }
        }
    }
    Timer { id: deadline;interval:20000;onTriggered:renderer.fail("Content rendering timed out.") }
    Canvas {
        id: canvas
        width: 1
        height: 1
        property url imageUrl: ""
        renderTarget: Canvas.Image
        renderStrategy: Canvas.Immediate
        onImageLoaded: requestPaint()
        onPaint: {
            if (!renderer.busy || (renderer.mode!=="graph" && (!imageUrl || !isImageLoaded(imageUrl)))) return;
            try {
                const ctx=getContext("2d");
                let warning="";
                if (renderer.mode==="graph") {
                    const result=GraphMath.draw(ctx,width,height,renderer.graphModel,renderer.graphOptions);
                    warning=(result.truncated?["Sampling limit reached."]:[]).concat(result.warnings).join(" ");
                } else { ctx.clearRect(0,0,width,height);ctx.drawImage(imageUrl,0,0,width,height); }
                if (renderer.mode==="save") {
                    if (!save(renderer.savePath)) throw new Error("Could not save the content image.");
                    renderer.busy=false;deadline.stop();renderer.saved("file://"+renderer.savePath);
                } else {
                    const dataUrl=toDataURL("image/png");
                    if (dataUrl.indexOf("data:image/png;base64,")!==0 || dataUrl.length<50) throw new Error("Could not encode the content image.");
                    renderer.busy=false;deadline.stop();renderer.ready({dataUrl:dataUrl,width:width,height:height,warning:warning});
                }
            } catch (error) { renderer.fail(error.message || error); }
        }
    }
}
