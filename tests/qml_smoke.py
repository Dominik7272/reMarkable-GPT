"""Real Qt UI/PNG/HTTP-state checks, using a native renderer fixture on desktop."""
import base64
import json
import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QT_QUICK_BACKEND", "software")
os.environ.setdefault("QT_QUICK_CONTROLS_STYLE", "Basic")
from pathlib import Path
from tempfile import TemporaryDirectory
from enum import IntEnum
from PySide6.QtCore import QObject, QPoint, QUrl, Qt, Property, QEnum, Signal, qInstallMessageHandler
from PySide6.QtGui import QFont, QGuiApplication, QImage, QPainter, QColor
from PySide6.QtQuick import QQuickView, QQuickItem
from PySide6.QtQml import qmlRegisterType
from PySide6.QtTest import QTest

ROOT=Path(__file__).resolve().parents[1]
warnings=[]
qInstallMessageHandler(lambda kind, context, message: warnings.append(message))
app=QGuiApplication([])
regions=[]

class ScreenModeItem(QQuickItem):
    class Mode(IntEnum):
        Content=0
        Animation=1
    QEnum(Mode)
    modeChanged=Signal()
    def __init__(self,parent=None):
        super().__init__(parent)
        self._mode=0
        regions.append(self)
    def get_mode(self): return self._mode
    def set_mode(self,value):
        self._mode=value
        self.modeChanged.emit()
    mode=Property(int,get_mode,set_mode,notify=modeChanged)

class FontExtender(QObject):
    fontChanged=Signal()
    antialiasingChanged=Signal()
    def __init__(self,parent=None):
        super().__init__(parent)
        self._font,self._aa=QFont(),True
    def get_font(self):
        value=QFont(self._font)
        if not self._aa: value.setStyleStrategy(QFont.StyleStrategy.NoAntialias)
        return value
    def set_font(self,value):
        if self._font!=value:
            self._font=value
            self.fontChanged.emit()
    def get_aa(self): return self._aa
    def set_aa(self,value):
        self._aa=value
        self.antialiasingChanged.emit()
        self.fontChanged.emit()
    font=Property(QFont,get_font,set_font,notify=fontChanged)
    antialiasing=Property(bool,get_aa,set_aa,notify=antialiasingChanged)

qmlRegisterType(ScreenModeItem,"xofm.libs.epaper",1,0,"ScreenModeItem")
qmlRegisterType(FontExtender,"ark.controls",1,0,"FontExtender")

def wait_for(predicate, description, limit=4000):
    elapsed=0
    while not predicate() and elapsed<limit:
        QTest.qWait(20)
        elapsed+=20
    assert predicate(), (description,warnings)

def variant(value):
    return value.toVariant() if hasattr(value,"toVariant") else value

def response(text):
    return {"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":text}]}]}

def call(name, arguments, identifier):
    return {"type":"function_call","id":"fc_"+identifier,"name":name,"call_id":identifier,"arguments":json.dumps(arguments),"status":"completed"}

def plan(items):
    harness.setPlan(json.dumps(items))

with TemporaryDirectory() as directory:
    directory=Path(directory)
    config=directory/"config.ini"
    config.write_text("[General]\nbaseUrl=https://gateway.example.test/proxy/v1/\n")
    # Native provider fixture: actual PNG files, no Qt item grabs or layers.
    for index in range(3):
        height=6600 if index==2 else 2200
        image=QImage(1600,height,QImage.Format_RGB32)
        image.fill(Qt.white)
        painter=QPainter(image)
        color=QColor(["#c00000","#008000","#0000c0"][index])
        painter.fillRect(50,50,1500,150,color)
        painter.fillRect(50,height-200,1500,150,color)
        painter.setPen(Qt.black)
        painter.drawRect(20,20,1560,height-40)
        painter.end()
        image.save(str(directory/f"page-{index}.png"))
    view=QQuickView()
    view.engine().addImportPath(str(ROOT/"tests/fixtures"))
    view.setInitialProperties({"settingsFile":QUrl.fromLocalFile(str(config)),"imageDirectory":QUrl.fromLocalFile(str(directory))})
    view.setResizeMode(QQuickView.SizeRootObjectToView)
    view.resize(1200,1800)
    view.setSource(QUrl.fromLocalFile(str(ROOT/"tests/Harness.qml")))
    assert view.status()!=QQuickView.Error,warnings
    harness=view.rootObject()
    chat=harness.findChild(QObject,"chatGPT")
    reader=chat.findChild(QObject,"pageReader")
    api=chat.findChild(QObject,"apiClient")
    agent=chat.findChild(QObject,"conversationSession")
    settings=chat.findChild(QObject,"apiSettings")
    assert api.property("baseUrl")=="https://gateway.example.test/proxy/v1/"
    captured=[]
    reader.captured.connect(lambda image:captured.append(variant(image)))
    view.show();chat.open();chat.setProperty("useNativeDisplay",True)
    QTest.qWait(100)
    assert len(regions)==12,(len(regions),warnings)
    assert {r.parentItem().objectName() for r in regions}=={"newChat","close","composerScroll","send","copyLink","closeLink","conversation","previewBack","previewTransparent","previewRevise","previewInsert","previewGraphCalc"}
    assert chat.findChild(QObject,"messageInput").property("font").styleStrategy() & QFont.StyleStrategy.NoAntialias
    out=ROOT/"artifacts";out.mkdir(exist_ok=True)
    assert not api.property("configured")
    assert not chat.findChild(QObject,"send").property("enabled")
    assert chat.findChild(QObject,"messageInput").property("placeholderText")==""
    assert chat.findChild(QObject,"readPage") is None
    composer=chat.findChild(QQuickItem,"messageInput")
    def click(item):
        QTest.mouseClick(view,Qt.MouseButton.LeftButton,pos=item.mapToScene(item.boundingRect().center()).toPoint())
        QTest.qWait(30)
    chat.setProperty("draft","Unsent message")
    click(composer)
    assert composer.hasActiveFocus(), warnings
    click(composer)
    assert composer.hasActiveFocus(),"Tapping within the message field must keep keyboard focus"
    click(chat.findChild(QQuickItem,"documentContext"))
    assert not composer.hasActiveFocus() and chat.property("opened"), (composer.property("focus"),warnings)
    assert chat.property("draft")=="Unsent message"
    touch_device=QTest.createTouchDevice()
    def tap(item):
        point=item.mapToScene(item.boundingRect().center()).toPoint()
        touch=QTest.touchEvent(view,touch_device)
        touch.press(0,point,view).commit();QTest.qWait(20)
        touch.release(0,point,view).commit();QTest.qWait(30)
    tap(composer)
    assert composer.hasActiveFocus(),"Finger input must reach the message field"
    tap(chat.findChild(QQuickItem,"documentContext"))
    assert not composer.hasActiveFocus() and chat.property("draft")=="Unsent message"
    click(composer)
    click(chat.findChild(QQuickItem,"newChat"))
    assert not composer.hasActiveFocus() and chat.property("draft")=="", "Dismissal must not swallow button clicks"
    click(composer)
    QTest.mouseClick(view,Qt.MouseButton.LeftButton,pos=QPoint(3,3));QTest.qWait(30)
    assert not composer.hasActiveFocus() and chat.property("opened"),"First outside tap dismisses the keyboard"
    QTest.mouseClick(view,Qt.MouseButton.LeftButton,pos=QPoint(3,3));QTest.qWait(30)
    assert not chat.property("opened"),"Second outside tap closes the chat"
    chat.open()
    chat.setProperty("captureDirectory",str(directory))
    assert reader.captureCurrentPage(),(reader.property("errorMessage"),warnings)
    wait_for(lambda:len(captured)==1,"current page image")
    first=captured[-1]
    assert first["pageNumber"]==2 and first["pageId"]=="page-1"
    assert Path(QUrl(first["fileUrl"]).toLocalFile()).is_file()
    image=QImage.fromData(base64.b64decode(first["dataUrl"].split(",",1)[1]))
    assert image.size().width()==1489 and image.height()==2048,image.size()
    assert image.pixelColor(image.width()//2,100).green()>80 and image.pixelColor(image.width()//2,100).red()<80
    assert reader.capturePage(2)
    wait_for(lambda:len(captured)==2,"long page image")
    image=QImage.fromData(base64.b64decode(captured[-1]["dataUrl"].split(",",1)[1]))
    assert image.width()==496 and image.height()==2048,image.size()
    assert image.pixelColor(image.width()//2,35).blue()>80 and image.pixelColor(image.width()//2,2010).blue()>80
    assert reader.capturePage(-1) is False and reader.capturePage(3) is False
    assert reader.capturePage(0);reader.cancel();QTest.qWait(200);assert len(captured)==2
    assert reader.capturePage(0)
    harness.findChild(QObject,"documentFixture").setProperty("prefix","moved-")
    wait_for(lambda:not reader.property("busy"),"reordered-page rejection")
    assert len(captured)==2 and "order changed" in reader.property("errorMessage")
    harness.findChild(QObject,"documentFixture").setProperty("prefix","page-")
    harness.installTransport();harness.setProperty("responseStream",True)
    markdown="## Notebook summary\n\nThe **important** part is *here*, with `inline code`.\n\n- First item\n- Second item\n\n> A note from the document.\n\n| Page | Topic |\n| --- | --- |\n| 2 | Diagram |\n| 3 | Notes |\n\n```python\nvalue = 2 + 3\nprint(value)\n```\n\n[Reference](https://example.com)"
    reasoning={"id":"rs_test","type":"reasoning","summary":[],"encrypted_content":"opaque-reasoning"}
    plan([{"status":"completed","output":[reasoning,call("read_current_page",{},"current")]},
          {"status":"completed","output":[call("read_page",{"page_number":3},"other")]},response(markdown)])
    chat.setProperty("draft","Compare this page with page 3.")
    assert chat.send()
    wait_for(lambda:not agent.property("busy"),"automatic two-page tool loop",8000)
    assert not chat.property("errorMessage"),(chat.property("errorMessage"),warnings)
    assert len(captured)==4
    assert variant(agent.property("pagesRead"))==[2,3]
    assert chat.property("currentPageIndex")==1 and harness.findChild(QObject,"documentFixture").property("navigationCalls")==0
    requests=variant(harness.property("requests"))
    assert len(requests)==3 and requests[0]["stream"] is True
    assert {t["name"] for t in requests[0]["tools"]}=={"get_document_context","read_current_page","read_page","create_formula","create_note","create_table","create_diagram","create_graph"}
    assert requests[1]["input"][1]["encrypted_content"]=="opaque-reasoning"
    assert "pageIndex" not in requests[1]["input"][2]
    outputs=[item for item in requests[-1]["input"] if item.get("type")=="function_call_output"]
    assert [json.loads(item["output"][0]["text"])["pageNumber"] for item in outputs]==[2,3]
    assert all(item["output"][1]["type"]=="input_image" for item in outputs)
    assert chat.property("draft")==""
    QTest.qWait(100)
    conversation=chat.findChild(QQuickItem,"conversation");conversation.positionViewAtBeginning();QTest.qWait(60)
    def visual_items(parent):
        for item in parent.childItems():
            yield item
            yield from visual_items(item)
    visual=list(visual_items(conversation))
    prose=[i for i in visual if i.objectName()=="markdownText"]
    code=[i for i in visual if i.objectName()=="codeText"]
    cells=[i for i in visual if i.objectName()=="tableCell"]
    assert len(cells)==6 and all(i.height()>0 and i.width()>0 for i in cells),[(i.width(),i.height()) for i in cells]
    assert prose and code,warnings
    rendered=[]
    for item in prose:
        item.selectAll();rendered.append(item.property("selectedText"));item.deselect()
    rendered="\n".join(rendered)
    assert "Notebook summary" in rendered and "**important**" not in rendered,rendered
    assert code[0].property("text")=="value = 2 + 3\nprint(value)"
    assert all(not item.flags() & QQuickItem.Flag.ItemAcceptsInputMethod for item in prose+code)
    view.grabWindow().save(str(out/"chat-redesign.png"))
    for status,fragment in [(401,"rejected"),(429,"limit"),(500,"HTTP 500"),(0,"connection")]:
        harness.setProperty("httpStatus",status);chat.setProperty("draft","Another question")
        assert chat.send();wait_for(lambda:not agent.property("busy"),f"HTTP {status}")
        assert fragment in chat.property("errorMessage"),chat.property("errorMessage")
        assert chat.property("draft")=="Another question"
    harness.setProperty("httpStatus",400);harness.setProperty("responseError","Stream must be set to true")
    assert chat.send();wait_for(lambda:not agent.property("busy"),"proxy reason")
    assert chat.property("errorMessage")=="HTTP 400: Stream must be set to true"
    harness.setProperty("responseError","");harness.setProperty("httpStatus",200)
    settings.setProperty("baseUrl","http://192.168.1.10:8080/v1/responses/")
    chat.clearChat()
    before=len(captured)
    plan([{"status":"completed","output":[call("read_page",{"page_number":99},"bad"),call("erase_page",{},"unknown")]},response("That page is unavailable.")])
    chat.setProperty("draft","Read a nonexistent page.");assert chat.send()
    wait_for(lambda:not agent.property("busy"),"invalid function recovery")
    assert len(captured)==before
    assert harness.property("lastUrl")=="http://192.168.1.10:8080/v1/responses"
    errors=[i for i in variant(harness.property("lastRequest"))["input"] if i.get("type")=="function_call_output"]
    assert len(errors)==2 and all("error" in json.loads(i["output"]) for i in errors)
    chat.clearChat();agent.setProperty("maximumCalls",1)
    plan([{"status":"completed","output":[call("get_document_context",{},"ctx")]},
          {"status":"completed","output":[call("read_page",{"page_number":1},"over-limit")]},response("Limit reached.")])
    chat.setProperty("draft","Read several pages.");assert chat.send()
    wait_for(lambda:not agent.property("busy"),"tool budget")
    assert variant(harness.property("lastRequest"))["tool_choice"]=="none"
    assert len(captured)==before
    agent.setProperty("maximumCalls",16);chat.clearChat()
    plan([{"status":"completed","output":[call("get_document_context",{},"repeated")]},
          {"status":"completed","output":[call("get_document_context",{},"repeated")]}])
    chat.setProperty("draft","Get context.");assert chat.send()
    wait_for(lambda:not agent.property("busy"),"repeated function rejection")
    assert "repeated" in chat.property("errorMessage") and chat.property("draft")=="Get context."
    chat.clearChat();harness.setProperty("autoRespond",False)
    chat.setProperty("draft","Keep this draft");assert chat.send();chat.close()
    assert not agent.property("busy") and chat.property("draft")=="Keep this draft"
    chat.open();api.setProperty("timeoutMs",60)
    assert chat.send();wait_for(lambda:not agent.property("busy"),"timeout")
    assert "timed out" in chat.property("errorMessage") and chat.property("draft")=="Keep this draft"
    api.setProperty("timeoutMs",90000);harness.setProperty("autoRespond",True)
    plan([{"status":"completed","output":[call("read_current_page",{},"changing")]},response("Must not appear")])
    assert chat.send();wait_for(lambda:reader.property("busy"),"capture before document change")
    harness.changeDocument();QTest.qWait(300)
    assert not agent.property("busy") and not reader.property("busy")
    assert variant(agent.property("history"))==[] and chat.property("draft")==""
    # Actual creation tools, SVG rasterisation, offline LaTeX worker and PNG insertion.
    store=chat.findChild(QObject,"contentStore")
    chat.setProperty("contentDirectory",str(directory))
    generated=[]
    chat.imageReady.connect(lambda url,context,identifier:generated.append((url,variant(context),identifier)))
    formula={"title":"Quadratic formula","latex":r"x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}","transparent":True}
    note={"title":"Study note","markdown":"# Motion\n\n**Velocity** changes with time.\n\n- Measure the distance\n- Record the time\n\n> Keep the units consistent.","transparent":True}
    table={"title":"Measurements","columns":["Time / s","Distance / m"],"rows":[["0","0"],["1","3"],["2","12"]],"transparent":False}
    diagram={"title":"Experiment","direction":"down","nodes":[{"id":"a","label":"Measure","shape":"box"},{"id":"b","label":"Enough data?","shape":"diamond"},{"id":"c","label":"Plot results","shape":"ellipse"}],"edges":[{"from":"a","to":"b","label":""},{"from":"b","to":"c","label":"yes"}],"transparent":True}
    def create_content(name,args,identifier):
        plan([{"status":"completed","output":[call(name,args,identifier)]},response("Ready.")])
        chat.setProperty("draft","Prepare "+args["title"])
        assert chat.send()
        wait_for(lambda:not agent.property("busy"),"creation tool "+name,25000)
        assert not chat.property("errorMessage"),(chat.property("errorMessage"),warnings)
        items=variant(store.property("items"))
        assert items and items[-1]["title"]==args["title"],(items,warnings,variant(harness.property("lastRequest")))
        assert chat.property("previewId")==items[-1]["id"]
        assert chat.findChild(QQuickItem,"contentPreview").isVisible()
        wait_for(lambda:chat.findChild(QQuickItem,"contentPreview").property("imageReady"),"visible preview image")
        QTest.qWait(60)
        assert not generated,"Creating a preview must not insert anything"
        return items[-1]
    image_record=create_content("create_formula",formula,"formula")
    encoded=QImage.fromData(base64.b64decode(image_record["dataUrl"].split(",",1)[1]))
    assert encoded.width()>400 and encoded.height()>100
    assert encoded.pixelColor(0,0).alpha()==0
    black=sum(encoded.pixelColor(x,y).alpha()>100 and encoded.pixelColor(x,y).red()<80
              for x in range(0,encoded.width(),3) for y in range(0,encoded.height(),3))
    assert black>100,(black,encoded.size(),warnings)
    encoded.save(str(out/"formula.png"))
    view.grabWindow().save(str(out/"formula-preview.png"))
    click(chat.findChild(QQuickItem,"previewTransparent"))
    wait_for(lambda:not store.property("busy"),"transparency rerender",25000)
    updated=variant(store.property("items"))[-1]
    assert not updated["args"]["transparent"]
    opaque=QImage.fromData(base64.b64decode(updated["dataUrl"].split(",",1)[1]))
    assert opaque.pixelColor(0,0).alpha()==255
    click(chat.findChild(QQuickItem,"previewRevise"))
    assert chat.property("draft").startswith('Revise "Quadratic formula":') and composer.hasActiveFocus()
    for name,args,identifier in [("create_note",note,"note"),("create_table",table,"table"),("create_diagram",diagram,"diagram")]:
        record=create_content(name,args,identifier)
        decoded=QImage.fromData(base64.b64decode(record["dataUrl"].split(",",1)[1]))
        assert not decoded.isNull() and decoded.width()<=3072 and decoded.height()<=3072
        decoded.save(str(out/(identifier+".png")))
        view.grabWindow().save(str(out/(identifier+"-preview.png")))
        click(chat.findChild(QQuickItem,"previewBack"))
    graph={"title":"Two curves","transparent":True,
        "graphs":[{"equation":"sin(x)","color":"#cc0000","visible":True},
                  {"equation":"2*f1(x)","color":"#0000cc","visible":True}],
        "xmin":0.1,"xmax":10,"ymin":-3,"ymax":3,"log_x":True,"log_y":False,
        "show_equations":True,"x_axis":True,"y_axis":True,"x_numbers":True,"y_numbers":True,
        "axis_labels":True,"grid":True,"border":True,"scale":1.2,"ratio":"16:9","portrait":False,"resolution":800}
    record=create_content("create_graph",graph,"graph")
    handoffs=[]
    chat.openGraphRequested.connect(lambda state,context:handoffs.append((variant(state),variant(context))))
    click(chat.findChild(QQuickItem,"previewGraphCalc"))
    assert len(handoffs)==1
    graph_state,graph_context=handoffs[0]
    assert graph_state["graphs"][1]["text"]=="2*f1(x)" and graph_state["graphs"][1]["color"]=="#0000cc"
    assert graph_state["axes"]=={"logX":True,"logY":False} and graph_state["output"]["ratio"]=="16:9"
    assert graph_context["documentId"]=="other-doc"
    graph_view=QQuickView();graph_view.resize(1200,1800)
    graph_view.setInitialProperties({"persistenceEnabled":False})
    graph_view.setSource(QUrl.fromLocalFile(str(ROOT.parent/"graphCalc/GraphCalc.qml")))
    assert graph_view.status()!=QQuickView.Error,warnings
    graph_view.show();calculator=graph_view.rootObject();calculator.open();QTest.qWait(100)
    previous=variant(calculator.snapshot())
    calculator.checkpoint();calculator.applyState(graph_view.engine().evaluate('('+json.dumps(graph_state)+')'));calculator.checkpoint()
    actual=variant(calculator.snapshot())
    assert actual["graphs"]==graph_state["graphs"] and actual["axes"]==graph_state["axes"] and actual["output"]==graph_state["output"], (actual,graph_state,warnings)
    calculator.undo();assert variant(calculator.snapshot())["graphs"]==previous["graphs"]
    graph_view.setSource(QUrl());app.processEvents()
    decoded=QImage.fromData(base64.b64decode(record["dataUrl"].split(",",1)[1]))
    assert decoded.width()==800 and decoded.height()==450
    assert decoded.pixelColor(0,0).alpha()==0
    assert any(decoded.pixelColor(x,y).red()>100 and decoded.pixelColor(x,y).blue()<80 and decoded.pixelColor(x,y).alpha()>100
               for x in range(0,800,2) for y in range(0,450,2))
    decoded.save(str(out/"graph.png"));view.grabWindow().save(str(out/"graph-preview.png"))
    click(chat.findChild(QQuickItem,"previewBack"))
    records=variant(store.property("items"))
    assert len(records)==5
    chat.setProperty("previewId",records[0]["id"])
    wait_for(lambda:chat.findChild(QQuickItem,"previewInsert").property("enabled"),"insert enabled after preview loads")
    click(chat.findChild(QQuickItem,"previewInsert"))
    wait_for(lambda:len(generated)==1,"explicit insert saves PNG")
    saved_url,insert_context,insert_id=generated[-1]
    assert Path(saved_url.toLocalFile()).is_file() and insert_id==records[0]["id"]
    assert insert_context["documentId"]=="other-doc" and insert_context["pageId"]=="other-page-0"
    assert not store.insert(records[0]["id"],view.engine().toScriptValue({"documentId":"wrong"}))
    chat.contentInserted(insert_id)
    assert not chat.property("opened") and len(variant(store.property("items")))==5
    assert variant(store.property("items"))[0]["inserted"] is True
    chat.open()
    # A stopped generation discards only its new drafts, preserving completed previews.
    plan([{"status":"completed","output":[call("create_formula",formula,"cancel-formula")]},response("Unused")])
    chat.setProperty("draft","Cancelled content");assert chat.send()
    wait_for(lambda:store.property("busy"),"cancel pending content")
    chat.close();QTest.qWait(250)
    assert not store.property("busy") and len(variant(store.property("items")))==5
    assert chat.property("draft")=="Cancelled content"
    chat.open();chat.clearChat()
    assert variant(store.property("items"))==[]
    for width,height in [(1200,1800),(1800,1200),(900,1400)]:
        view.resize(width,height);QTest.qWait(60)
        panel=chat.findChild(QQuickItem,"panel")
        assert panel.width()<=width and panel.height()<=height
        for name in ["messageInput","send","newChat","close"]:
            item=chat.findChild(QQuickItem,name);point=item.mapToItem(panel,item.boundingRect().center())
            assert 0<point.x()<panel.width() and 0<point.y()<panel.height(),(name,width,height,point)
    bad=[w for w in warnings if any(s in w for s in ["Error:","Unable to assign","Binding loop","Cannot assign","not a type","is not defined"])]
    assert not bad,bad
    view.setSource(QUrl());app.processEvents()
print("PASS: keyboard, native page reads, autonomous tools, offline formulas/notes/tables/diagrams, transparency, revision, explicit PNG insertion, cancellation and document isolation")
