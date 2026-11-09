import QtQuick
import "../"

Item {
    id: harness
    width: 1200
    height: 1800
    property alias chat: chat
    property var lastRequest: null
    property var lastXhr: null
    property string lastUrl: ""
    property int httpStatus: 200
    property bool autoRespond: true
    property string responseText: "The page has a diagram."
    property bool responseStream: false
    property string responseError: ""
    property alias doc: documentFixture
    property url settingsFile: ""
    property url imageDirectory: ""
    property var responsePlan: []
    property int requestCount: 0
    property var requests: []
    QtObject {
        id: documentFixture
        objectName: "documentFixture"
        property int navigationCalls: 0
        property string prefix: "page-"
        function idForPage(index) { return index >= 0 && index < 3 ? prefix + index : ""; }
        function goToPage(index) { navigationCalls++; }
        function imageForPage(index) { return harness.imageDirectory + "/page-" + index + ".png"; }
    }
    QtObject {
        id: otherDocument
        function idForPage(index) { return "other-page-" + index; }
        function imageForPage(index) { return harness.imageDirectory + "/page-" + index + ".png"; }
    }
    function setPlan(json) { responsePlan = JSON.parse(json); }
    function changeDocument() {
        chat.documentObject = otherDocument;
        chat.documentId = "other-doc";
        chat.documentTitle = "Other notebook";
        chat.currentPageIndex = 0;
        chat.currentPageId = "other-page-0";
    }
    function disableNetwork() {
        chat.apiClient.requestFactory = function() {
            throw new Error("Network access is disabled in the desktop preview.");
        };
    }
    function installTransport() {
        chat.apiClient.apiKey = "test-key-never-transmitted";
        chat.apiClient.model = "test-model";
        chat.apiClient.requestFactory = function() {
            const xhr = {
                readyState: 0, status: 0, responseText: "", aborted: false,
                onreadystatechange: function() {},
                open: function(method, url) { this.method=method;this.url=url; },
                setRequestHeader: function() {},
                send: function(body) {
                    harness.lastRequest=JSON.parse(body);
                    harness.lastUrl=this.url;
                    harness.lastXhr=this;
                    harness.requestCount++;
                    harness.requests=harness.requests.concat([harness.lastRequest]);
                    if (harness.autoRespond) responseTimer.restart();
                },
                abort: function() { this.aborted=true; }
            };
            return xhr;
        };
    }
    Timer {
        id: responseTimer
        interval: 40
        onTriggered: {
            const xhr=harness.lastXhr;
            if (!xhr || xhr.aborted) return;
            xhr.status=harness.httpStatus;
            xhr.readyState=4;
            const response=harness.responsePlan.length ? harness.responsePlan.shift()
                : {status:"completed",output:[{type:"message",role:"assistant",content:[{type:"output_text",text:harness.responseText}]}]};
            if (harness.responseError) xhr.responseText=JSON.stringify({detail:harness.responseError});
            else if (harness.responseStream) xhr.responseText="event: response.created\ndata: " + JSON.stringify({type:"response.created",response:{status:"in_progress",output:[]}})
                + "\n\nevent: response.completed\ndata: " + JSON.stringify({type:"response.completed",response:response}) + "\n\n";
            else xhr.responseText=JSON.stringify(response);
            xhr.onreadystatechange();
        }
    }
    ChatGPT {
        id: chat
        anchors.fill: parent
        settingsLocation: harness.settingsFile
        documentObject: documentFixture
        documentId: "doc-1"
        documentTitle: "Notebook"
        currentPageIndex: 1
        currentPageId: "page-1"
        pageCount: 3
    }
}
