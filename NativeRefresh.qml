import QtQuick
import QtQml.Models
import xofm.libs.epaper as Epaper
import ark.controls as ArkControls

Item {
    id: refresh
    property var regions: []
    property real bodySize: 28
    property real buttonSize: 26
    property Item scrollRegion: null
    property bool scrollActive: false
    readonly property font bodyFont: bodyHelper.font
    readonly property font buttonFont: buttonHelper.font
    readonly property font codeFont: codeHelper.font
    ArkControls.FontExtender { id: bodyHelper; font.family: "sans-serif"; font.pixelSize: refresh.bodySize; antialiasing: false }
    ArkControls.FontExtender { id: buttonHelper; font.family: "sans-serif"; font.pixelSize: refresh.buttonSize; antialiasing: false }
    ArkControls.FontExtender { id: codeHelper; font.family: "monospace"; font.pixelSize: refresh.buttonSize; antialiasing: false }
    Instantiator {
        model: refresh.regions
        delegate: Epaper.ScreenModeItem {
            required property var modelData
            parent: modelData
            anchors.fill: parent
            mode: Epaper.ScreenModeItem.Animation
            visible: refresh.visible
        }
    }
    Epaper.ScreenModeItem {
        parent: refresh.scrollRegion
        anchors.fill: parent
        mode: Epaper.ScreenModeItem.Animation
        visible: refresh.visible && refresh.scrollActive && refresh.scrollRegion !== null
    }
}
