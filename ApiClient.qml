import QtQuick
import "lib/ChatProtocol.js" as Protocol

QtObject {
    id: client
    objectName: "apiClient"
    property string apiKey: ""
    property string model: ""
    property string baseUrl: "https://api.openai.com/v1"
    readonly property bool configured: apiKey.trim().length > 0 && model.trim().length > 0
    property bool busy: false
    property var pending: null
    property int generation: 0
    property int timeoutMs: 90000
    property var documentContext: null
    property bool allowTools: true
    property var requestFactory: function() { return new XMLHttpRequest(); }
    property Timer deadline: Timer {
        interval: client.timeoutMs
        onTriggered: {
            client.cancel();
            client.failed("The request timed out. Your message is still available.");
        }
    }
    signal completed(string text)
    signal responded(var response)
    signal failed(string message)

    function cancel() {
        generation++;
        deadline.stop();
        const xhr = pending;
        pending = null;
        busy = false;
        if (xhr) { xhr.onreadystatechange = function() {}; xhr.abort(); }
    }
    function send(history, turn) {
        return sendItems(history.concat([turn]));
    }
    function sendItems(input) {
        if (busy) return false;
        if (!configured) { failed("API not configured."); return false; }
        try {
            const endpoint = Protocol.responseEndpoint(baseUrl);
            const body = JSON.stringify(Protocol.requestItemsBody(model, input, documentContext, allowTools));
            const xhr = requestFactory();
            const token = ++generation;
            pending = xhr;
            busy = true;
            xhr.onreadystatechange = function() {
                if (xhr.readyState !== 4 || token !== client.generation) return;
                deadline.stop();
                pending = null;
                busy = false;
                try {
                    if (xhr.status < 200 || xhr.status >= 300) {
                        throw new Error(Protocol.httpError(xhr.status, xhr.responseText, client.apiKey));
                    }
                    const response = Protocol.parseReply(xhr.responseText);
                    if (response.error) throw new Error(response.error.message || "The API response failed.");
                    responded(response);
                    if (!Protocol.functionCalls(response).length) completed(Protocol.responseText(response));
                } catch (error) {
                    failed(Protocol.cleanError(error.message || error, client.apiKey));
                }
            };
            xhr.open("POST", endpoint);
            xhr.setRequestHeader("Authorization", "Bearer " + apiKey.trim());
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("Accept", "text/event-stream, application/json");
            deadline.restart();
            xhr.send(body);
            return true;
        } catch (error) {
            cancel();
            failed(Protocol.cleanError(error.message || error, apiKey));
            return false;
        }
    }
}
