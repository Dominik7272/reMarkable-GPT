import QtQuick
import "lib/PageImage.js" as PageImage

Item {
    id: reader
    objectName: "pageReader"
    property var documentObject: null
    property string documentId: ""
    property string documentTitle: ""
    property int currentPageIndex: -1
    property string currentPageId: ""
    property int pageCount: 0
    property bool documentLoading: false
    property var sceneColorProfile
    property int maximumEdge: 2048
    // Injection point for desktop tests and other future page renderers.
    property Component rendererComponent: null
    property string captureDirectory: ""
    property bool busy: false
    property string errorMessage: ""
    property int generation: 0
    property var request: null
    property var renderItem: null
    property var lastImage: null
    property bool encoding: false
    signal captured(var image)
    signal failed(string message)
    signal cancelled()
    signal prepareCapture()

    // Canvas encodes native page images without Qt's unsupported layer path.
    x: -10000
    width: 1
    height: 1

    function cancel() { cancelWork(false); }
    function cancelWork(quiet) {
        const wasBusy = busy;
        generation++;
        settle.stop();
        deadline.stop();
        encoder.unloadImage(encoder.imageUrl);
        encoder.imageUrl = "";
        if (renderItem) renderItem.destroy();
        renderItem = null;
        request = null;
        encoding = false;
        busy = false;
        if (wasBusy && quiet !== true) cancelled();
    }
    function clear() {
        cancel();
        lastImage = null;
        errorMessage = "";
    }
    onDocumentIdChanged: clear()
    onDocumentObjectChanged: clear()
    onPageCountChanged: {
        if (request && !PageImage.validIndex(request.pageIndex, pageCount)) cancel();
    }

    function fail(message) {
        cancelWork(true);
        errorMessage = message;
        failed(message);
    }
    function captureCurrentPage() { return capturePage(currentPageIndex); }
    function capturePage(index) {
        cancel();
        errorMessage = "";
        if (!documentObject || !documentId || !PageImage.validIndex(index, pageCount)) {
            fail("Choose a page in the open document.");
            return false;
        }
        if (documentLoading) {
            fail("The document is loading. Try again in a moment.");
            return false;
        }
        try {
            const id = String(documentObject.idForPage(index));
            if (!id || id === "undefined" || id === "null") throw new Error("Page ID unavailable.");
            request = {
                token: generation, documentId: documentId, documentTitle: documentTitle,
                pageId: id, pageIndex: index, pageNumber: index + 1,
                capturedAt: new Date().toISOString()
            };
            prepareCapture();
            const component = rendererComponent || Qt.createComponent("NativePageRenderer.qml", Component.PreferSynchronous);
            if (component.status !== Component.Ready) throw new Error(component.errorString());
            busy = true;
            renderItem = component.createObject(reader, {
                documentObject: documentObject, pageId: id,
                pageIndex: index,
                sceneColorProfile: sceneColorProfile, maximumEdge: maximumEdge
            });
            if (!renderItem) throw new Error("Could not create the page renderer.");
            deadline.restart();
            maybeReady();
            return true;
        } catch (error) {
            fail("Could not read page: " + String(error.message || error));
            return false;
        }
    }
    function maybeReady() {
        if (!busy || !renderItem || encoding) return;
        if (renderItem.errorMessage) { fail(renderItem.errorMessage); return; }
        if (renderItem.renderReady) settle.restart();
        else settle.stop();
    }
    function encode() {
        if (!busy || !request || !renderItem || !renderItem.renderReady || encoding) return;
        encoding = true;
        const scale = Math.min(1, maximumEdge / Math.max(renderItem.width, renderItem.height));
        encoder.width = Math.max(1, Math.round(renderItem.width * scale));
        encoder.height = Math.max(1, Math.round(renderItem.height * scale));
        encoder.canvasSize = Qt.size(encoder.width, encoder.height);
        encoder.imageUrl = renderItem.imageSource;
        encoder.loadImage(encoder.imageUrl);
    }
    Connections {
        target: reader.renderItem
        function onRenderReadyChanged() { reader.maybeReady(); }
        function onErrorMessageChanged() { reader.maybeReady(); }
    }
    Timer { id: settle; interval: 100; onTriggered: reader.encode() }
    Timer { id: deadline; interval: 20000; onTriggered: reader.fail("Page rendering timed out.") }

    Canvas {
        id: encoder
        property url imageUrl: ""
        renderStrategy: Canvas.Immediate
        onImageLoaded: requestPaint()
        onPaint: {
            if (!reader.busy || !reader.request || !imageUrl || !isImageLoaded(imageUrl)) return;
            try {
                if (String(reader.documentObject.idForPage(reader.request.pageIndex)) !== reader.request.pageId)
                    throw new Error("The page order changed. Read the page again.");
                const ctx = getContext("2d");
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(imageUrl, 0, 0, width, height);
                const dataUrl = toDataURL("image/png");
                if (dataUrl.indexOf("data:image/png;base64,") !== 0 || dataUrl.length < 50)
                    throw new Error("PNG encoding failed.");
                const image = reader.request;
                image.dataUrl = dataUrl;
                image.imageUrl = dataUrl;
                image.fileUrl = "";
                if (reader.captureDirectory) {
                    const path = reader.captureDirectory + "/page-" + image.pageNumber + "-" + Date.now() + "-" + reader.generation + ".png";
                    if (!save(path)) throw new Error("Could not save the page image.");
                    image.fileUrl = "file://" + path;
                }
                image.width = width;
                image.height = height;
                reader.lastImage = image;
                reader.request = null;
                deadline.stop();
                reader.busy = false;
                reader.encoding = false;
                if (reader.renderItem) reader.renderItem.destroy();
                reader.renderItem = null;
                unloadImage(imageUrl);
                imageUrl = "";
                reader.captured(image);
            } catch (error) {
                reader.fail("Could not encode page: " + String(error.message || error));
            }
        }
    }
}
