import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: preview
    property var content: null
    property real unit: 1
    property font bodyFont
    property font buttonFont
    property bool busy: false
    property bool canInsert: true
    property int pageNumber: 1
    property string errorMessage: ""
    readonly property bool imageReady: picture.status===Image.Ready
    readonly property var controls: [backButton,transparentButton,reviseButton,insertButton,graphButton]
    signal dismissed()
    signal insertRequested()
    signal reviseRequested()
    signal graphRequested()
    signal transparencyRequested(bool value)
    color: "white"
    MouseArea { anchors.fill: parent }
    component Action: Button {
        id: action
        property bool filled: false
        implicitHeight: 64*preview.unit
        implicitWidth: Math.max(100*preview.unit,implicitContentWidth+28*preview.unit)
        padding: 12*preview.unit
        font: preview.buttonFont
        focusPolicy: Qt.NoFocus
        contentItem: Text {
            text: action.text;font:action.font
            color: action.filled!==action.down?"white":"black"
            opacity: action.enabled?1:.4
            horizontalAlignment: Text.AlignHCenter;verticalAlignment:Text.AlignVCenter
        }
        background: Rectangle { color:action.filled!==action.down?"black":"white" }
    }
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 28*preview.unit
        spacing: 20*preview.unit
        RowLayout {
            Layout.fillWidth: true
            Text { Layout.fillWidth:true;text:preview.content?preview.content.title:"";font:preview.bodyFont;wrapMode:Text.Wrap }
            Action { id:backButton;objectName:"previewBack";text:"Back";onClicked:preview.dismissed() }
        }
        Rectangle { Layout.fillWidth:true;height:preview.unit;color:"black" }
        Image {
            id: picture
            objectName: "contentPreviewImage"
            Layout.fillWidth: true
            Layout.fillHeight: true
            source: preview.content?preview.content.dataUrl:""
            fillMode: Image.PreserveAspectFit
            cache: false
        }
        Text {
            visible: !!text
            Layout.fillWidth: true
            text: preview.errorMessage || (preview.busy?"Preparing preview":"")
            font: preview.buttonFont
            wrapMode: Text.Wrap
        }
        RowLayout {
            Layout.fillWidth: true
            visible: !!preview.content && preview.content.kind==="graph"
            Item { Layout.fillWidth: true }
            Action { id:graphButton;objectName:"previewGraphCalc";text:"Open in graphCalc";enabled:!preview.busy;onClicked:preview.graphRequested() }
        }
        RowLayout {
            Layout.fillWidth: true
            Action {
                id:transparentButton
                objectName: "previewTransparent"
                implicitWidth: transparentLabel.implicitWidth+62*preview.unit
                enabled: !preview.busy
                onClicked: preview.transparencyRequested(!preview.content.args.transparent)
                contentItem: Row {
                    spacing: 14*preview.unit
                    Rectangle {
                        width: 38*preview.unit;height:width
                        anchors.verticalCenter: parent.verticalCenter
                        border.color: "black";border.width:2*preview.unit;color:"white"
                        Rectangle {
                            visible: !!preview.content && preview.content.args.transparent
                            anchors.fill: parent;anchors.margins:8*preview.unit;color:"black"
                        }
                    }
                    Text { id:transparentLabel;text:"Transparent";font:preview.buttonFont;anchors.verticalCenter:parent.verticalCenter }
                }
            }
            Item { Layout.fillWidth:true }
            Action { id:reviseButton;objectName:"previewRevise";text:"Revise";enabled:!preview.busy;onClicked:preview.reviseRequested() }
            Action {
                id:insertButton;objectName:"previewInsert"
                text:"Insert";filled:true;enabled:!preview.busy && preview.canInsert && !!preview.content && preview.imageReady
                onClicked:preview.insertRequested()
            }
        }
        Text { Layout.fillWidth:true;text:"Page "+preview.pageNumber;font:preview.buttonFont;horizontalAlignment:Text.AlignRight }
    }
}
