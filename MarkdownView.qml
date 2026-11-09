import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "lib/Markdown.js" as Markdown

Column {
    id: document
    property string markdown: ""
    property font bodyFont: Qt.font({pixelSize: 28})
    property font codeFont: Qt.font({family: "monospace", pixelSize: 25})
    property real unit: 1
    signal linkActivated(string url)
    spacing: 18 * unit
    Repeater {
        model: Markdown.blocks(document.markdown)
        delegate: Column {
            id: block
            required property var modelData
            width: document.width
            spacing: 0
            Loader {
                width: parent.width
                sourceComponent: block.modelData.kind === "code" ? codeBlock : block.modelData.kind === "table" ? tableBlock : proseBlock
            }
            Component {
                id: proseBlock
                Flickable {
                    width: block.width
                    height: prose.contentHeight
                    contentWidth: Math.max(width, prose.contentWidth)
                    contentHeight: height
                    flickableDirection: Flickable.HorizontalFlick
                    boundsBehavior: Flickable.StopAtBounds
                    clip: true
                    TextEdit {
                        id: prose
                        objectName: "markdownText"
                        width: block.width
                        height: contentHeight
                        text: block.modelData.text
                        textFormat: TextEdit.MarkdownText
                        font: document.bodyFont
                        wrapMode: TextEdit.Wrap
                        readOnly: true
                        activeFocusOnPress: false
                        selectByMouse: true
                        selectionColor: "black"
                        selectedTextColor: "white"
                        color: "black"
                        textMargin: 0
                        onLinkActivated: (link) => document.linkActivated(link)
                    }
                    ScrollIndicator.horizontal: ScrollIndicator {}
                }
            }
            Component {
                id: tableBlock
                Flickable {
                    id: tableView
                    width: block.width
                    height: tableRows.height
                    contentWidth: Math.max(width, block.modelData.rows[0].length * 140 * document.unit)
                    contentHeight: height
                    flickableDirection: Flickable.HorizontalFlick
                    boundsBehavior: Flickable.StopAtBounds
                    clip: true
                    Column {
                        id: tableRows
                        width: tableView.contentWidth
                        Repeater {
                            model: block.modelData.rows
                            delegate: RowLayout {
                                id: row
                                required property int index
                                required property var modelData
                                width: tableRows.width
                                height: implicitHeight
                                spacing: 0
                                Repeater {
                                    model: row.modelData
                                    delegate: Rectangle {
                                        required property int index
                                        required property string modelData
                                        Layout.fillWidth: true
                                        Layout.fillHeight: true
                                        Layout.preferredWidth: tableRows.width / row.modelData.length
                                        implicitHeight: cell.contentHeight + 24 * document.unit
                                        color: "white"
                                        border.color: "black"
                                        border.width: Math.max(1, document.unit)
                                        TextEdit {
                                            id: cell
                                            objectName: "tableCell"
                                            x: 12 * document.unit
                                            y: 12 * document.unit
                                            width: parent.width - 24 * document.unit
                                            height: contentHeight
                                            text: (row.index === 0 ? "**" : "") + Markdown.safeMarkdown(parent.modelData) + (row.index === 0 ? "**" : "")
                                            textFormat: TextEdit.MarkdownText
                                            font: document.bodyFont
                                            readOnly: true
                                            activeFocusOnPress: false
                                            selectByMouse: true
                                            wrapMode: TextEdit.Wrap
                                            textMargin: 0
                                            horizontalAlignment: block.modelData.align[parent.index] === "right" ? TextEdit.AlignRight
                                                : block.modelData.align[parent.index] === "center" ? TextEdit.AlignHCenter : TextEdit.AlignLeft
                                            onLinkActivated: (link) => document.linkActivated(link)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    ScrollIndicator.horizontal: ScrollIndicator {}
                }
            }
            Component {
                id: codeBlock
                Rectangle {
                    width: block.width
                    height: codeHeader.height + codeView.height + 28 * document.unit
                    color: "white"
                    border.color: "black"
                    border.width: Math.max(1, document.unit)
                    Row {
                        id: codeHeader
                        x: 14 * document.unit
                        y: 8 * document.unit
                        width: parent.width - 28 * document.unit
                        height: 40 * document.unit
                        Text {
                            width: parent.width - copyCode.width
                            height: parent.height
                            text: block.modelData.language
                            font: document.codeFont
                            verticalAlignment: Text.AlignVCenter
                        }
                        Text {
                            id: copyCode
                            text: "Copy"
                            font: document.codeFont
                            height: parent.height
                            verticalAlignment: Text.AlignVCenter
                            MouseArea {
                                anchors.fill: parent
                                anchors.margins: -6 * document.unit
                                onClicked: { codeText.selectAll(); codeText.copy(); codeText.deselect(); }
                            }
                        }
                    }
                    Flickable {
                        id: codeView
                        x: 14 * document.unit
                        y: codeHeader.height + 14 * document.unit
                        width: parent.width - 28 * document.unit
                        height: codeText.contentHeight
                        contentWidth: Math.max(width, codeText.contentWidth)
                        contentHeight: height
                        flickableDirection: Flickable.HorizontalFlick
                        boundsBehavior: Flickable.StopAtBounds
                        clip: true
                        TextEdit {
                            id: codeText
                            objectName: "codeText"
                            width: contentWidth
                            height: contentHeight
                            text: block.modelData.text
                            textFormat: TextEdit.PlainText
                            font: document.codeFont
                            wrapMode: TextEdit.NoWrap
                            readOnly: true
                            activeFocusOnPress: false
                            selectByMouse: true
                            selectionColor: "black"
                            selectedTextColor: "white"
                            textMargin: 0
                        }
                        ScrollIndicator.horizontal: ScrollIndicator {}
                    }
                }
            }
        }
    }
}
