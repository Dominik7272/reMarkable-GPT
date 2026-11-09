import QtQuick
import "lib/ChatProtocol.js" as Protocol

QtObject {
    id: session
    objectName: "conversationSession"
    required property var api
    required property var reader
    property var creator: null
    property var contextProvider: function() { return {}; }
    property bool busy: false
    property string status: ""
    property var history: []
    property var working: []
    property var queue: []
    property var activeCall: null
    property var pagesRead: []
    property var handledCalls: ({})
    property string documentId: ""
    property int calls: 0
    property int rounds: 0
    property int maximumCalls: 16
    property int maximumRounds: 12
    property var contentCreated: []
    signal finished(string text, var pages)
    signal failed(string message)
    signal stopped()
    signal pageRead(int number)
    signal contentReady(var content)

    function cancel() {
        const running = busy;
        busy = false;
        api.cancel();
        reader.cancel();
        if (creator) { creator.cancel();creator.remove(contentCreated); }
        contentCreated=[];
        activeCall = null;
        queue = [];
        working = [];
        status = "";
        if (running) stopped();
    }
    function clear() { cancel(); history = []; pagesRead = []; }
    function fail(message) {
        busy = false;
        api.cancel();
        reader.cancel();
        if (creator) { creator.cancel();creator.remove(contentCreated); }
        contentCreated=[];
        activeCall = null;
        queue = [];
        working = [];
        status = "";
        failed(message);
    }
    function start(text) {
        if (busy || !api.configured) return false;
        if (!text.trim()) return false;
        const context = contextProvider();
        if (!context.documentId || context.pageNumber < 1 || context.pageNumber > context.pageCount)
            throw new Error("Open a document before sending a message.");
        documentId = context.documentId;
        working = history.concat([Protocol.userTurn(text, context, null)]);
        queue = [];
        activeCall = null;
        pagesRead = [];
        contentCreated = [];
        handledCalls = Object.create(null);
        calls = 0;
        rounds = 0;
        busy = true;
        request();
        return true;
    }
    function request() {
        if (!busy) return;
        const context = contextProvider();
        if (context.documentId !== documentId) { fail("The open document changed."); return; }
        if (rounds++ >= maximumRounds) { fail("Tool limit reached. Send a follow-up to continue."); return; }
        api.documentContext = context;
        api.allowTools = calls < maximumCalls && rounds < maximumRounds;
        status = "Thinking";
        api.sendItems(working);
    }
    function receive(response) {
        if (!busy) return;
        try {
            if (!Array.isArray(response.output)) throw new Error("The API returned no response items.");
            const requested = Protocol.functionCalls(response);
            if (requested.length > 32) throw new Error("The API returned too many function calls at once.");
            if (requested.length && response.status !== "completed") throw new Error("The function request was incomplete. Try again.");
            working = working.concat(response.output);
            if (requested.length) {
                queue = requested.slice();
                nextTool();
                return;
            }
            const answer = Protocol.responseText(response);
            history = working.slice();
            working = [];
            contentCreated = [];
            status = "";
            busy = false;
            finished(answer, pagesRead.slice());
        } catch (error) { fail(Protocol.cleanError(error.message || error, api.apiKey)); }
    }
    function nextTool() {
        if (!busy) return;
        if (!queue.length) { request(); return; }
        const call = queue.shift();
        if (typeof call.call_id !== "string" || !call.call_id || Object.prototype.hasOwnProperty.call(handledCalls, call.call_id)) {
            fail("The API returned an invalid or repeated function call.");
            return;
        }
        handledCalls[call.call_id] = true;
        activeCall = {call_id: call.call_id, name: call.name, arguments: call.arguments, pageIndex: -1};
        try {
            if (++calls > maximumCalls) throw new Error("Tool limit reached. Finish with the information already available.");
            const context = contextProvider();
            if (context.documentId !== documentId) throw new Error("The open document changed.");
            const args = Protocol.toolArguments(call, context);
            if (call.name === "get_document_context") { completeTool(context, null); return; }
            if (args.content) {
                if (!creator) throw new Error("Content previews are unavailable.");
                status="Preparing "+call.name.slice(7);
                creator.create(call.name,args.args,context);
                return;
            }
            activeCall.pageIndex = args.pageIndex;
            status = "Reading page " + (args.pageIndex + 1);
            if (!reader.capturePage(args.pageIndex) && activeCall)
                completeTool({error: reader.errorMessage || "Could not read the page."}, null);
        } catch (error) { completeTool({error: Protocol.cleanError(error.message || error, api.apiKey)}, null); }
    }
    function completeTool(value, image) {
        if (!busy || !activeCall) return;
        working.push(Protocol.toolOutput(activeCall.call_id, value, image));
        activeCall = null;
        // Avoid deep recursion when several tools complete synchronously.
        Qt.callLater(nextTool);
    }
    property Connections apiSignals: Connections {
        target: session.api
        function onResponded(response) { session.receive(response); }
        function onFailed(message) { if (session.busy) session.fail(message); }
    }
    property Connections readerSignals: Connections {
        target: session.reader
        function onCaptured(image) {
            if (!session.busy || !session.activeCall) return;
            if (image.documentId !== session.documentId || image.pageIndex !== session.activeCall.pageIndex) {
                session.fail("The requested page changed while it was being read.");
                return;
            }
            if (session.pagesRead.indexOf(image.pageNumber) < 0) {
                session.pagesRead = session.pagesRead.concat([image.pageNumber]);
                session.pageRead(image.pageNumber);
            }
            session.completeTool({documentId: image.documentId, documentTitle: image.documentTitle,
                pageId: image.pageId, pageNumber: image.pageNumber, capturedAt: image.capturedAt,
                width: image.width, height: image.height, source: "native_page_image"}, image);
            session.reader.clear();
        }
        function onFailed(message) { if (session.busy && session.activeCall) session.completeTool({error: message}, null); }
        function onCancelled() { if (session.busy && session.activeCall) session.completeTool({error: "The page read was cancelled."}, null); }
    }
    property Connections creatorSignals: Connections {
        target: session.creator
        function onCreated(content) {
            if (!session.busy || !session.activeCall || !/^create_/.test(session.activeCall.name)) return;
            session.contentCreated=session.contentCreated.concat([content.id]);
            session.contentReady(content);
            session.completeTool({content_id:content.id,title:content.title,kind:content.kind,
                width:content.width,height:content.height,warning:content.warning,status:"preview_ready",inserted:false,
                next_step:"The user can preview, revise or press Insert. Nothing has been added to the notebook."},null);
        }
        function onFailed(message) {
            if (session.busy && session.activeCall && /^create_/.test(session.activeCall.name)) session.completeTool({error:message},null);
        }
    }
}
