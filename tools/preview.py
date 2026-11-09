#!/usr/bin/env python3
"""Desktop preview with three synthetic notebook pages. Never contacts OpenAI."""
import os
os.environ.setdefault("QT_QUICK_CONTROLS_STYLE", "Basic")
from pathlib import Path
import sys
from PySide6.QtCore import QObject, QUrl
from PySide6.QtGui import QGuiApplication
from PySide6.QtQuick import QQuickView

ROOT = Path(__file__).resolve().parents[1]
app = QGuiApplication(sys.argv)
view = QQuickView()
view.setTitle("ChatGPT preview (sample pages)")
view.engine().addImportPath(str(ROOT / "tests/fixtures"))
(ROOT / ".cache").mkdir(exist_ok=True)
view.setInitialProperties({"settingsFile": QUrl.fromLocalFile(str(ROOT / ".cache/preview-config.ini"))})
view.setResizeMode(QQuickView.SizeRootObjectToView)
view.resize(1080, 1640)
view.setSource(QUrl.fromLocalFile(str(ROOT / "tests/Harness.qml")))
if view.status() == QQuickView.Error:
    raise SystemExit(1)
chat = view.rootObject().findChild(QObject, "chatGPT")
view.rootObject().disableNetwork()
view.show()
chat.open()
sys.exit(app.exec())
