import QtQuick
QtObject {
    property var document
    property int page: 0
    property bool monochrome: false
    readonly property url source: document ? document.imageForPage(page) : ""
}
