import QtQuick
import com.remarkable
import xofm.libs.sceneview

// Use the native page overview image. Qt item grabs require layers, which the
// device's custom scene-graph renderer does not support.
Item {
    id: renderer
    required property var documentObject
    required property string pageId
    required property int pageIndex
    property var sceneColorProfile
    property int maximumEdge: 2048
    readonly property url imageSource: pageImage.source
    readonly property bool renderReady: pageImage.status === Image.Ready
            && pageImage.implicitWidth > 0 && pageImage.implicitHeight > 0
    readonly property string errorMessage: pageImage.status === Image.Error ? "Could not load the native page image." : ""
    width: pageImage.implicitWidth
    height: pageImage.implicitHeight
    ThumbnailProvider {
        id: thumbnail
        document: renderer.documentObject
        page: renderer.pageIndex
        monochrome: false
    }
    Image {
        id: pageImage
        source: thumbnail.source
        asynchronous: true
        cache: false
        visible: false
    }
}
