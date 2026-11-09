import QtQuick
import "lib/Content.js" as Content

Item {
    id: store
    objectName: "contentStore"
    property string outputDirectory: "/home/root/xovi/ChatGPT/images"
    property var items: []
    property bool busy: false
    property int serial: 0
    property var pending: null
    property string errorMessage: ""
    signal created(var content)
    signal updated(var content)
    signal failed(string message)
    signal imageReady(url fileUrl, var context, string contentId)
    x: -10000
    width: 1
    height: 1
    function get(id) { return items.filter(function(item) { return item.id===id; })[0] || null; }
    function remove(ids) { items=items.filter(function(item) { return ids.indexOf(item.id)<0; }); }
    function clear() { cancel();items=[];errorMessage=""; }
    function cancel() { if (renderer.item) renderer.item.cancel();busy=false;pending=null; }
    function fail(message) { cancel();errorMessage=String(message);failed(errorMessage); }
    function create(name,args,context) {
        if (busy) throw new Error("Another preview is being prepared.");
        if (items.length>=24) throw new Error("This chat already has 24 previews. Start a new chat to create more.");
        const validated=Content.validate(name,args);
        pending={name:name,args:validated,documentId:context.documentId,updateId:""};
        begin();return true;
    }
    function setTransparent(id,value) {
        if (busy) return false;
        const item=get(id);
        if (!item) return false;
        const args=JSON.parse(JSON.stringify(item.args));args.transparent=value;
        pending={name:item.name,args:args,documentId:item.documentId,updateId:id};
        begin();return true;
    }
    function begin() {
        busy=true;errorMessage="";
        if (!renderer.active) renderer.active=true;
        else if (renderer.status===Loader.Ready) renderPending();
    }
    function renderPending() {
        if (busy && pending) renderer.item.render(pending.name,pending.args);
    }
    function insert(id,context) {
        if (busy) return false;
        const item=get(id);
        if (!item || item.documentId!==context.documentId) { errorMessage="This preview belongs to another document.";return false; }
        if (!context.pageId || context.pageNumber<1 || context.pageNumber>context.pageCount) { errorMessage="Open a page before inserting.";return false; }
        pending={insertId:id,context:JSON.parse(JSON.stringify(context))};busy=true;errorMessage="";
        const path=outputDirectory+"/content-"+Date.now()+"-"+(++serial)+".png";
        renderer.item.saveImage(item,path);
        return true;
    }
    function inserted(id) {
        items=items.map(function(item) { if (item.id===id) return Object.assign({},item,{inserted:true});return item; });
    }
    Loader {
        id: renderer
        active: false
        source: "ContentRenderer.qml"
        onLoaded: store.renderPending()
        onStatusChanged: if (status===Loader.Error) store.fail("Could not load the content renderer.")
    }
    Connections {
        target: renderer.item
        function onReady(image) {
            if (!store.busy || !store.pending) return;
            const request=store.pending;
            const content={id:request.updateId || "content-"+(++store.serial),name:request.name,
                kind:request.name.slice(7),title:request.args.title,args:request.args,documentId:request.documentId,
                dataUrl:image.dataUrl,width:image.width,height:image.height,warning:image.warning || "",inserted:false};
            if (request.updateId) store.items=store.items.map(function(item) { return item.id===request.updateId?content:item; });
            else store.items=store.items.concat([content]);
            store.busy=false;store.pending=null;
            if (request.updateId) store.updated(content);else store.created(content);
        }
        function onSaved(fileUrl) {
            if (!store.busy || !store.pending || !store.pending.insertId) return;
            const request=store.pending;store.busy=false;store.pending=null;
            store.imageReady(fileUrl,request.context,request.insertId);
        }
        function onFailed(message) { store.fail(message); }
    }
}
