import QtQuick

// Desktop test fixture, not a substitute for checking native rendering on-device.
Item {
    id: scene
    enum Status { Inactive, Updating, Active }
    enum ViewportType { DeviceViewport, ClientViewport }
    property var document
    property string pageId: ""
    property int viewportType: SceneView.ClientViewport
    property bool ignoreDocumentZoomMode: false
    property bool limitScrollingToPaper: false
    property size tileSize
    property int tileRefreshInterval: 0
    property bool tileAntialiasing: false
    property bool renderingTilesBeyondViewport: false
    property bool textModeEnabled: false
    property bool imReadOnly: false
    property var colorProfile
    property int status: SceneView.Updating
    property bool awaitingInitialTileSet: true
    property point center: Qt.point(800,1100)
    property real scale: 1
    property var controller: QtObject {
        property rect primaryContentRect: Qt.rect(0,0,1600,scene.pageId === "page-2" ? 6600 : 2200)
        property rect itemsBoundingRect: Qt.rect(50,50,1500,primaryContentRect.height-100)
        property rect rootDocumentBoundingRect: Qt.rect(0,0,0,0)
        property bool working: false
        property bool updating: false
    }
    property var tileManager: QtObject { property int pendingTiles: 1 }
    function setFocalPoint(point, factor) {
        if (!ignoreDocumentZoomMode || !imReadOnly || viewportType !== SceneView.ClientViewport)
            throw new Error("Renderer must use its own read-only client viewport.");
        center = point;
        scale = factor;
        tileManager.pendingTiles = 1;
        loading.restart();
        ink.requestPaint();
    }
    Timer {
        id: loading
        interval: 70
        running: true
        onTriggered: {
            scene.status = SceneView.Active;
            scene.awaitingInitialTileSet = false;
            scene.tileManager.pendingTiles = 0;
            ink.requestPaint();
        }
    }
    Canvas {
        id: ink
        anchors.fill: parent
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        onPaint: {
            const ctx=getContext("2d");
            ctx.reset();
            ctx.fillStyle="white";ctx.fillRect(0,0,width,height);
            ctx.translate(width/2-scene.center.x*scene.scale,height/2-scene.center.y*scene.scale);
            ctx.scale(scene.scale,scene.scale);
            ctx.fillStyle=scene.pageId === "page-0" ? "#c00000" : scene.pageId === "page-1" ? "#008000" : "#0000c0";
            ctx.fillRect(50,50,1500,150);
            ctx.fillRect(50,scene.controller.primaryContentRect.height-200,1500,150);
            ctx.strokeStyle="black";ctx.lineWidth=12;ctx.strokeRect(20,20,1560,scene.controller.primaryContentRect.height-40);
            ctx.font="100px sans-serif";ctx.fillText(scene.pageId,180,600);
        }
    }
}
