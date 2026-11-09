import QtQuick
import QtCore

Item {
    objectName: "apiSettings"
    property alias apiKey: settings.apiKey
    property alias model: settings.model
    property alias baseUrl: settings.baseUrl
    property alias location: settings.location
    Settings {
        id: settings
        location: "file:///home/root/xovi/ChatGPT/config.ini"
        property string apiKey: ""
        property string model: ""
        property string baseUrl: "https://api.openai.com/v1"
    }
}
