import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "lib/Content.js" as Content

FocusScope {
    id: chat
    objectName: "chatGPT"
    property bool opened: false
    property bool useNativeDisplay: false
    property var documentObject: null
    property string documentId: ""
    property string documentTitle: ""
    property int currentPageIndex: -1
    property string currentPageId: ""
    property int pageCount: 0
    property bool documentLoading: false
    property var sceneColorProfile
    property Component pageRenderer: null
    property url settingsLocation: "file:///home/root/xovi/ChatGPT/config.ini"
    property string captureDirectory: ""
    property string errorMessage: ""
    property string selectedLink: ""
    property string pendingDraft: ""
    property int pendingStart: -1
    property string previewId: ""
    property string contentDirectory: "/home/root/xovi/ChatGPT/images"
    readonly property var previewContent: { content.items;return content.get(previewId); }
    readonly property real u: Math.max(0.55, Math.min(1.2, width / 1200, height / 1750))
    readonly property font bodyFont: nativeRefresh.item ? nativeRefresh.item.bodyFont : Qt.font({pixelSize: 28 * u})
    readonly property font buttonFont: nativeRefresh.item ? nativeRefresh.item.buttonFont : Qt.font({pixelSize: 24 * u})
    readonly property font codeFont: nativeRefresh.item ? nativeRefresh.item.codeFont : Qt.font({family: "monospace", pixelSize: 24 * u})
    property alias reader: pageReader
    property alias apiClient: api
    property alias session: agent
    property alias creations: content
    property alias draft: composer.text
    readonly property var history: agent.history
    signal closed()
    signal imageReady(url fileUrl, var context, string contentId)
    signal openGraphRequested(var state, var context)
    visible: opened

    function context() {
        return {documentId: documentId, documentTitle: documentTitle,
            pageNumber: currentPageIndex + 1, pageId: currentPageId, pageCount: pageCount,
            previews: content.items.map(function(item) { return {id:item.id,title:item.title,kind:item.kind,inserted:item.inserted}; })};
    }
    function open() { opened = true; errorMessage = ""; forceActiveFocus(); }
    function dismissKeyboard() {
        composer.focus = false;
        Qt.inputMethod.hide();
    }
    function close() {
        agent.cancel();
        pageReader.cancel();
        selectedLink = "";
        previewId = "";
        dismissKeyboard();
        opened = false;
        closed();
    }
    function clearChat() {
        agent.clear(); pageReader.clear(); content.clear(); messages.clear();previewId="";
        pendingStart = -1; pendingDraft = ""; composer.text = "";
        selectedLink = ""; errorMessage = "";
    }
    function discardPending() {
        if (pendingStart >= 0) {
            while (messages.count > pendingStart) messages.remove(messages.count - 1);
            composer.text = pendingDraft;
        }
        pendingStart = -1;
        pendingDraft = "";
    }
    function send() {
        if (agent.busy || content.busy || !api.configured || !composer.text.trim()) return false;
        if (documentLoading) { errorMessage = "The document is loading."; return false; }
        errorMessage = "";
        pendingDraft = composer.text.trim();
        pendingStart = messages.count;
        messages.append({speaker: "You", body: pendingDraft, pages: "", progress: "", contents:"[]"});
        messages.append({speaker: "ChatGPT", body: "", pages: "", progress: "Thinking", contents:"[]"});
        composer.text = "";
        dismissKeyboard();
        try {
            if (!agent.start(pendingDraft)) { discardPending(); return false; }
            Qt.callLater(function() { conversation.positionViewAtEnd(); });
            return true;
        } catch (error) { discardPending(); errorMessage = String(error.message || error); return false; }
    }
    onDocumentIdChanged: clearChat()
    onDocumentObjectChanged: clearChat()
    function reviseContent() {
        if (!previewContent || agent.busy || content.busy) return;
        composer.text='Revise "'+previewContent.title+'": ';
        previewId="";composer.cursorPosition=composer.text.length;composer.forceActiveFocus();Qt.inputMethod.show();
    }
    function contentInserted(id) { content.inserted(id);previewId="";close(); }
    Keys.onEscapePressed: (event) => {
        if (previewId) previewId="";
        else if (selectedLink) selectedLink = "";
        else close();
        event.accepted = true;
    }

    ApiSettings { id: settings; location: chat.settingsLocation }
    ApiClient { id: api; apiKey: settings.apiKey; model: settings.model; baseUrl: settings.baseUrl }
    Conversation {
        id: agent
        api: chat.apiClient
        reader: chat.reader
        creator: chat.creations
        contextProvider: chat.context
        onStatusChanged: {
            if (chat.pendingStart >= 0 && messages.count > chat.pendingStart + 1)
                messages.setProperty(chat.pendingStart + 1, "progress", status);
        }
        onFinished: (answer, pages) => {
            if (chat.pendingStart < 0) return;
            messages.setProperty(chat.pendingStart + 1, "body", answer);
            messages.setProperty(chat.pendingStart + 1, "pages", pages.length ? "Pages " + pages.join(", ") : "");
            messages.setProperty(chat.pendingStart + 1, "progress", "");
            const previews=JSON.parse(messages.get(chat.pendingStart+1).contents);
            if (previews.length) chat.previewId=previews[previews.length-1].id;
            chat.pendingStart = -1; chat.pendingDraft = "";
            Qt.callLater(function() { conversation.positionViewAtEnd(); });
        }
        onFailed: (message) => { chat.discardPending(); chat.errorMessage = message; }
        onStopped: chat.discardPending()
        onContentReady: (item) => {
            if (chat.pendingStart<0) return;
            const row=chat.pendingStart+1;
            const previews=JSON.parse(messages.get(row).contents);
            previews.push({id:item.id,title:item.title});
            messages.setProperty(row,"contents",JSON.stringify(previews));
        }
    }
    ContentStore {
        id: content
        outputDirectory: chat.contentDirectory
        onImageReady: (fileUrl,context,contentId) => chat.imageReady(fileUrl,context,contentId)
    }
    PageReader {
        id: pageReader
        documentObject: chat.documentObject
        documentId: chat.documentId
        documentTitle: chat.documentTitle
        currentPageIndex: chat.currentPageIndex
        currentPageId: chat.currentPageId
        pageCount: chat.pageCount
        documentLoading: chat.documentLoading
        sceneColorProfile: chat.sceneColorProfile
        rendererComponent: chat.pageRenderer
        captureDirectory: chat.captureDirectory
    }
    ListModel { id: messages; objectName: "messages" }
    MouseArea {
        anchors.fill: parent
        onClicked: {
            if (composer.activeFocus || Qt.inputMethod.visible) chat.dismissKeyboard();
            else chat.close();
        }
    }

    component Action: Button {
        id: control
        property bool filled: false
        implicitHeight: 64 * chat.u
        implicitWidth: Math.max(76 * chat.u, implicitContentWidth + 28 * chat.u)
        font: chat.buttonFont
        focusPolicy: Qt.NoFocus
        padding: 12 * chat.u
        contentItem: Text {
            text: control.text
            font: control.font
            color: control.filled !== control.down ? "white" : "black"
            opacity: control.enabled ? 1 : 0.4
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
        background: Rectangle { color: control.filled !== control.down ? "black" : "white" }
    }
    Rectangle {
        id: panel
        objectName: "panel"
        readonly property real keyboardSpace: Qt.inputMethod.visible ? Qt.inputMethod.keyboardRectangle.height : 0
        width: Math.min(chat.width - 32 * chat.u, 1040 * chat.u)
        height: Math.min(chat.height - keyboardSpace - 24 * chat.u, 1440 * chat.u)
        anchors.horizontalCenter: parent.horizontalCenter
        y: Math.max(12 * chat.u, (chat.height - keyboardSpace - height) / 2)
        color: "white"
        border.color: "black"
        border.width: Math.max(1, 1.5 * chat.u)
        clip: true
        MouseArea { anchors.fill: parent }
        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 30 * chat.u
            spacing: 0
            RowLayout {
                Layout.fillWidth: true
                Layout.preferredHeight: 70 * chat.u
                Text { text: "ChatGPT"; font: chat.bodyFont; Layout.fillWidth: true }
                Action { id: newChat; objectName: "newChat"; text: "New chat"; onClicked: chat.clearChat() }
                Action {
                    id: closeButton
                    objectName: "close"
                    implicitWidth: 56 * chat.u
                    onClicked: chat.close()
                    contentItem: Item {
                        Rectangle { anchors.centerIn: parent; width: 23 * chat.u; height: 2 * chat.u; rotation: 45; color: "black" }
                        Rectangle { anchors.centerIn: parent; width: 23 * chat.u; height: 2 * chat.u; rotation: -45; color: "black" }
                    }
                }
            }
            RowLayout {
                Layout.fillWidth: true
                Layout.preferredHeight: 54 * chat.u
                Text { objectName: "documentContext"; text: chat.documentTitle; font: chat.buttonFont; elide: Text.ElideRight; Layout.fillWidth: true }
                Text { text: "Page " + (chat.currentPageIndex + 1) + " / " + chat.pageCount; font: chat.buttonFont }
            }
            Rectangle { Layout.fillWidth: true; height: 2 * chat.u; color: "black" }
            ListView {
                id: conversation
                objectName: "conversation"
                Layout.fillWidth: true
                Layout.fillHeight: true
                topMargin: 28 * chat.u
                bottomMargin: 24 * chat.u
                spacing: 34 * chat.u
                clip: true
                model: messages
                boundsBehavior: Flickable.StopAtBounds
                ScrollIndicator.vertical: ScrollIndicator {}
                delegate: Column {
                    id: message
                    required property string speaker
                    required property string body
                    required property string pages
                    required property string progress
                    required property string contents
                    width: conversation.width
                    spacing: 12 * chat.u
                    Text { text: message.speaker; font: chat.buttonFont; color: "#555555" }
                    Text {
                        visible: message.speaker === "You"
                        width: parent.width
                        text: message.body
                        textFormat: Text.PlainText
                        font: chat.bodyFont
                        wrapMode: Text.Wrap
                    }
                    MarkdownView {
                        visible: message.speaker === "ChatGPT" && message.body.length > 0
                        width: parent.width
                        markdown: message.body
                        bodyFont: chat.bodyFont
                        codeFont: chat.codeFont
                        unit: chat.u
                        onLinkActivated: (url) => chat.selectedLink = url
                    }
                    Text { visible: !!message.progress; text: message.progress; font: chat.buttonFont }
                    Text { visible: !!message.pages; text: message.pages; font: chat.buttonFont; color: "#555555" }
                    Repeater {
                        model: JSON.parse(message.contents)
                        delegate: Rectangle {
                            id: contentCard
                            required property var modelData
                            readonly property var item: { content.items;return content.get(modelData.id); }
                            width: message.width
                            height: cardRow.height+24*chat.u
                            visible: !!item
                            color:"white";border.color:"black";border.width:chat.u
                            RowLayout {
                                id: cardRow
                                x:12*chat.u;y:12*chat.u;width:parent.width-24*chat.u
                                Image {
                                    Layout.preferredWidth:180*chat.u;Layout.preferredHeight:100*chat.u
                                    source:contentCard.item?contentCard.item.dataUrl:"";fillMode:Image.PreserveAspectFit
                                }
                                Text { Layout.fillWidth:true;text:contentCard.modelData.title;font:chat.buttonFont;wrapMode:Text.Wrap }
                                Action {
                                    text:"Preview";enabled:!agent.busy && !content.busy
                                    onClicked:{chat.dismissKeyboard();chat.previewId=contentCard.modelData.id;}
                                }
                            }
                        }
                    }
                }
            }
            Rectangle { Layout.fillWidth: true; height: chat.u; color: "black" }
            ScrollView {
                id: composerScroll
                objectName: "composerScroll"
                Layout.fillWidth: true
                Layout.preferredHeight: Math.max(100 * chat.u, Math.min(176 * chat.u, composer.contentHeight + 32 * chat.u))
                clip: true
                TextArea {
                    id: composer
                    objectName: "messageInput"
                    font: chat.bodyFont
                    wrapMode: TextEdit.Wrap
                    textFormat: TextEdit.PlainText
                    readOnly: agent.busy
                    leftPadding: 0
                    rightPadding: 0
                    topPadding: 20 * chat.u
                    bottomPadding: 16 * chat.u
                    selectByMouse: true
                    background: null
                    Keys.onReturnPressed: (event) => {
                        if (event.modifiers & Qt.ControlModifier) { chat.send(); event.accepted = true; }
                        else event.accepted = false;
                    }
                }
            }
            RowLayout {
                Layout.fillWidth: true
                Layout.preferredHeight: 66 * chat.u
                Text {
                    objectName: "status"
                    Layout.fillWidth: true
                    Layout.rightMargin: 16 * chat.u
                    text: chat.errorMessage || (!api.configured ? "API not configured" : "")
                    textFormat: Text.PlainText
                    font: chat.buttonFont
                    wrapMode: Text.Wrap
                }
                Action {
                    id: sendButton
                    objectName: "send"
                    text: agent.busy ? "Stop" : "Send"
                    filled: true
                    implicitWidth: 130 * chat.u
                    enabled: agent.busy || (!content.busy && api.configured && !chat.documentLoading && composer.text.trim().length > 0)
                    onClicked: { if (agent.busy) agent.cancel(); else chat.send(); }
                }
            }
        }
        Rectangle {
            visible: !!chat.selectedLink
            anchors.fill: parent
            anchors.margins: 2 * chat.u
            color: "white"
            MouseArea { anchors.fill: parent }
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 30 * chat.u
                Text { text: "Link"; font: chat.bodyFont }
                TextEdit {
                    id: linkText
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    text: chat.selectedLink
                    textFormat: TextEdit.PlainText
                    font: chat.bodyFont
                    wrapMode: TextEdit.WrapAnywhere
                    readOnly: true
                    selectByMouse: true
                }
                RowLayout {
                    Item { Layout.fillWidth: true }
                    Action { id: copyLink; objectName: "copyLink"; text: "Copy"; onClicked: { linkText.selectAll(); linkText.copy(); linkText.deselect(); } }
                    Action { id: closeLink; objectName: "closeLink"; text: "Close"; onClicked: chat.selectedLink = "" }
                }
            }
        }
        ContentPreview {
            id: contentPreview
            objectName: "contentPreview"
            anchors.fill: parent
            anchors.margins: 2*chat.u
            visible: !!chat.previewContent
            content: chat.previewContent
            unit: chat.u
            bodyFont: chat.bodyFont
            buttonFont: chat.buttonFont
            busy: chat.creations.busy || agent.busy
            canInsert: !chat.documentLoading
            pageNumber: chat.currentPageIndex+1
            errorMessage: chat.creations.errorMessage || (chat.previewContent ? chat.previewContent.warning : "")
            onDismissed: chat.previewId=""
            onReviseRequested: chat.reviseContent()
            onGraphRequested: {
                if (chat.previewContent && chat.previewContent.kind==="graph")
                    chat.openGraphRequested(Content.graphState(chat.previewContent.args),chat.context());
            }
            onTransparencyRequested: (value) => chat.creations.setTransparent(chat.previewId,value)
            onInsertRequested: chat.creations.insert(chat.previewId,chat.context())
        }
    }
    MouseArea {
        id: keyboardDismissArea
        anchors.fill: parent
        z: 1
        // Observe releases while allowing the underlying control to receive the press.
        onPressed: (mouse) => mouse.accepted = false
        TapHandler {
            id: keyboardTap
            property bool outsideComposer: false
            property bool keyboardWasActive: false
            target: null
            gesturePolicy: TapHandler.DragThreshold
            onPressedChanged: {
                if (pressed) {
                    const position = composerScroll.mapFromItem(keyboardDismissArea, point.position);
                    outsideComposer = !!chat.previewId || !!chat.selectedLink || !composerScroll.contains(position);
                    keyboardWasActive = composer.activeFocus || Qt.inputMethod.visible;
                }
            }
            onTapped: {
                if (outsideComposer && keyboardWasActive) {
                    // Let the tapped control finish before keyboard dismissal moves the panel.
                    Qt.callLater(chat.dismissKeyboard);
                }
            }
        }
    }
    Loader {
        id: nativeRefresh
        active: chat.useNativeDisplay
        source: "NativeRefresh.qml"
        visible: chat.opened
        onLoaded: {
            item.bodySize = Qt.binding(function() { return 28 * chat.u; });
            item.buttonSize = Qt.binding(function() { return 24 * chat.u; });
            item.regions = [newChat, closeButton, composerScroll, sendButton, copyLink, closeLink].concat(contentPreview.controls);
            item.scrollRegion = conversation;
            item.scrollActive = Qt.binding(function() { return conversation.moving; });
        }
    }
}
