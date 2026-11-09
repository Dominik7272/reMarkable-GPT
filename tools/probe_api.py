#!/usr/bin/env python3
"""Probe the actual QML client, optionally including autonomous tools with a test image.

Requires PySide6. Reads credentials privately over SSH; does not load notebook
files, save credentials locally, or print the configuration or raw responses.
"""
import argparse
import base64
import configparser
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QT_QUICK_BACKEND", "software")
os.environ.setdefault("QT_QUICK_CONTROLS_STYLE", "Basic")
from PySide6.QtCore import QObject, QUrl, QBuffer, QIODevice
from PySide6.QtGui import QGuiApplication, QImage, QColor
from PySide6.QtQml import QQmlComponent, QQmlEngine
from PySide6.QtQuick import QQuickView

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--host", default="root@10.11.99.1")
parser.add_argument("--expected-base-url", required=True)
parser.add_argument("--tools", action="store_true", help="Exercise a real tool call using a synthetic blue image; never reads notebook pages")
parser.add_argument("--content", action="store_true", help="Create and locally render a formula preview through the real API; never inserts or reads notebook pages")
parser.add_argument("--graph", action="store_true", help="Create a graph preview through the real API; never inserts or reads notebook pages")
args = parser.parse_args()
if args.host.startswith("-") or not re.fullmatch(r"[A-Za-z0-9_.@:\[\]-]+", args.host):
    parser.error("Invalid SSH host")
result = subprocess.run(["ssh", "-F", "/dev/null", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes",
                         args.host, "cat /home/root/xovi/ChatGPT/config.ini"],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
if result.returncode:
    raise SystemExit("Could not read the tablet configuration over SSH.")
settings = configparser.ConfigParser(interpolation=None)
settings.optionxform = str
try:
    settings.read_string(result.stdout.decode("utf-8-sig"))
except configparser.Error:
    raise SystemExit("Could not parse the tablet configuration.") from None


def value(name, fallback=""):
    text = settings.get("General", name, fallback=fallback).strip()
    return text[1:-1] if len(text) > 1 and text[0] == text[-1] == '"' else text


base = value("baseUrl", "https://api.openai.com/v1")
if base.rstrip("/") != args.expected_base_url.rstrip("/"):
    raise SystemExit("Configured baseUrl does not match --expected-base-url. No request sent.")
key, model = value("apiKey"), value("model")
if not key or not model:
    raise SystemExit("API key or model is missing. No request sent.")
app = QGuiApplication([])
engine = QQmlEngine()
component = QQmlComponent(engine, QUrl.fromLocalFile(str(ROOT / "ApiClient.qml")))
client = component.create()
if client is None:
    raise SystemExit("Could not load ApiClient.qml.")
client.setProperty("apiKey", key)
client.setProperty("model", model)
client.setProperty("baseUrl", base)
client.setProperty("timeoutMs", 45000)
outcome = {"ok": False}


def completed(text):
    outcome.update(ok=True, reply=text.replace(key, "[redacted]")[:80])
    app.quit()


def failed(message):
    outcome.update(error=message.replace(key, "[redacted]"))
    app.quit()


if args.content or args.graph:
    with TemporaryDirectory() as directory:
        view=QQuickView()
        view.setInitialProperties({"settingsFile":QUrl.fromLocalFile(str(Path(directory)/"config.ini"))})
        view.setResizeMode(QQuickView.SizeRootObjectToView)
        view.resize(1200,1800)
        view.setSource(QUrl.fromLocalFile(str(ROOT/"tests/Harness.qml")))
        if view.status()==QQuickView.Error:raise SystemExit("Could not load the content test window.")
        chat=view.rootObject().findChild(QObject,"chatGPT")
        # Credentials stay in memory on ApiClient, never in Qt Settings.
        client=chat.findChild(QObject,"apiClient")
        client.setProperty("apiKey",key);client.setProperty("model",model);client.setProperty("baseUrl",base)
        session=chat.findChild(QObject,"conversationSession");store=chat.findChild(QObject,"contentStore")
        session.finished.connect(lambda text,pages:completed(text))
        session.failed.connect(failed)
        view.show();chat.open()
        chat.setProperty("draft",("Use create_graph to prepare a graph of sin(x) from -5 to 5 on both axes. Do not read any pages. Reply briefly after preparing it." if args.graph else "Use create_formula to prepare the quadratic formula as a transparent image preview. Title: Quadratic formula. Do not read any pages. Reply briefly after preparing it."))
        if chat.send():app.exec()
        items=store.property("items").toVariant()
        outcome["previews"]=[{"kind":item["kind"],"width":item["width"],"height":item["height"]} for item in items]
        outcome["ok"]=bool(outcome["ok"] and items and items[-1]["kind"]==("graph" if args.graph else "formula"))
        client.cancel();view.setSource(QUrl());app.processEvents()
elif args.tools:
    image=QImage(64,64,QImage.Format_RGB32);image.fill(QColor("#0000ff"))
    buffer=QBuffer();buffer.open(QIODevice.WriteOnly);image.save(buffer,"PNG")
    data_url="data:image/png;base64,"+base64.b64encode(bytes(buffer.data())).decode()
    reader_component=QQmlComponent(engine)
    reader_component.setData(b'''import QtQuick
QtObject {
    property string dataUrl
    property string errorMessage: ""
    signal captured(var image)
    signal failed(string message)
    signal cancelled()
    function capturePage(index) {
        Qt.callLater(function() { captured({documentId:"test-doc",documentTitle:"API test",pageId:"test-page",
            pageIndex:0,pageNumber:1,capturedAt:new Date().toISOString(),width:64,height:64,dataUrl:dataUrl}); });
        return true;
    }
    function cancel() {}
    function clear() {}
}''',QUrl())
    reader=reader_component.createWithInitialProperties({"dataUrl":data_url})
    session_component=QQmlComponent(engine,QUrl.fromLocalFile(str(ROOT/"Conversation.qml")))
    session=session_component.createWithInitialProperties({"api":client,"reader":reader})
    if session is None:raise SystemExit("Could not load Conversation.qml.")
    session.setProperty("contextProvider",engine.evaluate('(function(){return {documentId:"test-doc",documentTitle:"API test",pageId:"test-page",pageNumber:1,pageCount:1};})'))
    session.finished.connect(lambda text,pages: completed(text))
    session.failed.connect(failed)
    if session.start("Use read_current_page to inspect the page. What color is it? Reply with only the color name."):
        app.exec()
    outcome["pages_read"]=session.property("pagesRead").toVariant()
    if not outcome["pages_read"]:outcome["ok"]=False
else:
    client.completed.connect(completed)
    client.failed.connect(failed)
    history = engine.toScriptValue([])
    turn = engine.toScriptValue({"role": "user", "content": [{"type": "input_text", "text": "Reply with OK."}]})
    if client.send(history, turn):
        app.exec()
print(json.dumps(outcome))
if not (args.content or args.graph):
    client.cancel()
    client.deleteLater()
    app.processEvents()
sys.exit(0 if outcome["ok"] else 1)
