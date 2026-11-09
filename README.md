# ChatGPT for reMarkable Paper Pro

Version **0.3.2**, for firmware **3.29.1.0** and the existing xovi / qt-resource-rebuilder setup.

The interface uses square edges, a compact conversation view and an uncluttered composer. Replies render Markdown headings, emphasis, lists, quotations, links, tables and fenced code. Tables scroll horizontally when necessary. Code blocks have a monospace font and a Copy action. Links open a selectable URL view. The notebook background stays unchanged. Input controls refresh independently; the conversation uses the fast waveform only while scrolling.

Tapping outside the message field dismisses the keyboard. Buttons and text selection still receive the tap. Tapping the surrounding notebook dismisses an active keyboard first; a second tap closes the chat. Sending or closing the chat also releases the message field's keyboard focus.

## Automatic page reading

Type a question and press **Send**. The model can call:

- `get_document_context()`: the open document, current page and page count.
- `read_current_page()`: an image of the page the user is currently on.
- `read_page({page_number: 3})`: an image of another page in this document, using page numbers starting at 1.

There is no attachment step. The application executes the tool, returns the page image through the [Responses function-calling protocol](https://developers.openai.com/api/docs/guides/function-calling), and continues until the assistant answers. Its instructions tell it to read notebook content itself. The interface shows which page is being read and records the pages used below the reply. Reading a page does not navigate the editing view.

`Conversation.qml` keeps the complete response items, including function calls and encrypted reasoning, when continuing a request. Tool names and arguments are checked locally. Invalid page numbers, unsupported tools and unavailable images return tool errors. Access is limited to the open document. The model can read pages and prepare content previews; insertion requires the user's Insert action. It has no file-system or command-execution tools. A turn allows up to 16 tool calls and 12 model requests to bound repeated failures. Requests remain capped at 24 MB.

**Stop**, closing the window, and switching documents cancel pending work. Failed or stopped turns restore the draft; a successful answer commits the conversation. New chat and document changes clear history. History lives in memory.

## Create notebook content

Ask for content such as "Create an image of the quadratic formula" or "Make a flowchart of this process". Five tools prepare previews:

- `create_formula`: display LaTeX, including fractions, roots, scripts, Greek, integrals, sums, matrices and aligned equations.
- `create_note`: Markdown headings, bold, italic, lists, quotations and code.
- `create_table`: headers and wrapped text cells, with up to 8 columns and 40 rows.
- `create_diagram`: automatically arranged boxes, ellipses and diamonds with labelled arrows, laid out downwards or to the right.
- `create_graph`: plots equations, implicit relations and inequalities using the graph calculator's plotting engine. It accepts multiple colored or hidden graphs, function references, x/y limits, independent logarithmic axes, all graph display controls, scale, aspect ratio, orientation and resolution. The bundled GraphMath.js is copied from graphCalc 0.9.1; it does not alter the installed graph calculator.

Graph previews also have **Open in graphCalc**. It opens graphCalc 0.9.1 with the equations, colors, visibility, limits, logarithmic axes and export settings from the preview. The previous graphCalc session is kept in its undo history. The button requires graphCalc 0.9.1 or newer.

The preview opens when the assistant finishes. **Insert** places it at the centre of the current notebook view and closes chat. The notebook's image selection can move and resize it; insertion uses the same native scene method as graphCalc, including native persistence and undo. These are PNG images, so the text and diagram elements are not individually editable notebook objects.

**Revise** opens the composer with the preview title, ready for your requested changes. The next response creates a revised preview. **Back** returns to chat; each generated item has a Preview action. **Transparent** changes the background locally without another API request. Nothing is inserted when a preview is generated or revised. Successful insertions are included in the assistant's subsequent document context.

MathJax 3.2.2 and its SVG font paths are bundled for offline formula typesetting. The formula worker loads on demand and runs outside the UI thread. Notes, tables and diagrams render locally too. No Python, browser engine or extra rendering service is required on the tablet. Only the assistant's content instructions come from the configured API. Export uses twice the layout resolution, with the longest edge capped at 3072 pixels. Native Qt SVG and Canvas encode PNGs without item grabs or layers.

The model supplies structured content, not executable code or arbitrary SVG. Labels are escaped. HTML, remote assets and TeX package loading are unavailable. Limits on source length, diagram size, image dimensions and preview count bound rendering work. Failed or stopped turns discard their new previews while preserving earlier completed ones. Saved insert images live under `/home/root/xovi/ChatGPT/images`; chat previews remain in memory. Document and page identities are checked again immediately before native insertion. Physical-device insertion through this new chat action needs checking after activation.

## Capture crash fix

The earlier page reader used a Qt item grab. Device logs showed `Layers are not supported and don't make sense`, followed by SIGSEGV. Xochitl's custom scene-graph backend does not support that path.

The replacement uses the native `ThumbnailProvider` used by the page overview. `PageReader.qml` loads that image and encodes it directly with Canvas. It does not use Qt item grabs, layers, a second SceneView, or screen navigation. The current scene is flushed through its native deferred-work method before requesting an image.

Image detail and page coverage depend on the firmware's page-overview raster. The reader preserves its native resolution, scaling down only when its long edge exceeds 2048 pixels. Upscaling cannot restore small writing that is absent from the native raster. This replacement needs physical-device validation after activation; desktop tests use native-provider fixtures.

`captureCurrentPage()` and `capturePage(zeroBasedIndex)` remain available on `PageReader`. `captured(image)` returns the document/page identity, page number, capture time, dimensions and an immutable PNG data URL. Setting `captureDirectory` also saves the PNG there. No notebook content is edited.

## API settings

On the tablet, edit `/home/root/xovi/ChatGPT/config.ini`:

```ini
[General]
apiKey=YOUR_API_KEY
model=YOUR_MODEL_ID
baseUrl=https://your-server.example/v1
```

The default base URL is `https://api.openai.com/v1`. The app appends `/responses`; a complete URL ending in `/responses` also works. The server must support Responses API function calls and image inputs in function outputs. Chat Completions-only servers are not supported. Existing configuration is preserved on reinstall, with file permissions 600. Reload Xochitl after editing it.

Requests use `stream: true` and `store: false`. The client accepts SSE, including streams incorrectly labelled as JSON, and ordinary JSON replies. The finished answer is displayed after generation completes. Error messages retain the server's reason with API keys and image data redacted. Only sending a message starts API work; page tools then send the requested pages to the configured server as part of that conversation.

Without API configuration, Send is disabled. This is an API client; ChatGPT website sign-in is not implemented. The tablet runs QML and JavaScript and does not need Python.

## Installation

```sh
python3 tools/device.py check
python3 tools/device.py install
```

The installer checks the exact firmware binary, Qt worker/SVG support, stages and verifies 21 payload files, backs up the old application, preserves configuration and moves the QMD last. It does not restart Xochitl. Save the notebook before using the activation command it prints. The square GPT button is at the lower-right corner, outside the native toolbar layout. The graph calculator and other extensions are preserved.

```sh
python3 tools/device.py bundle   # dist/ChatGPT-0.3.2.tar.gz
python3 tools/device.py disable
python3 tools/device.py logs
```

## Verification

```sh
node --test tests/protocol.test.cjs
PYTHONPATH=../graphCalc/.cache/qt-runtime \
  /home/dominik/.local/share/uv/python/cpython-3.13-linux-x86_64-gnu/bin/python3.13 tests/qml_smoke.py
python3 tools/verify_firmware.py ../graphCalc/.cache/xochitl-3.29.1.0 \
  --with-graphcalc ../graphCalc/graphCalc.qmd
```

Desktop Qt checks cover PNG encoding, long-page image fixtures, automatic current/other-page reads, invalid functions, preserved reasoning, drafts, cancellation, document isolation, Markdown rendering, tables, code and compact layouts. They also run all four creation tools, the actual MathJax worker, SVG rasterisation, transparent/opaque backgrounds, revision, explicit PNG export and cancellation of new drafts. Firmware checks verify native thumbnail/document properties and the exact image-insertion signature, then apply the UI patch with graphCalc in both orders. Proprietary extracted sources remain in `.cache` and are never bundled. Desktop preview uses `tools/preview.py` with the same PySide6 environment; networking is disabled.

`tools/probe_api.py --expected-base-url URL --tools`, run with PySide6, exercises the actual QML tool loop against the configured server with a synthetic blue image. It privately reads the API configuration over SSH and never reads notebook files or prints credentials. The configured Codex proxy completed this test and answered Blue. The default probe sends only a fixed text prompt. Live probes are never run automatically by the test suite.

`tools/probe_api.py --expected-base-url URL --content` asks the actual API for a quadratic formula preview and renders the result with the real local worker. This passed against the configured Codex proxy. It reads and inserts no notebook content. To rebuild the bundled worker, use `npm ci --ignore-scripts` and `npm run build:math`. The MathJax license and Qt compatibility change are documented in `lib/vendor`.

Installation receipts are in `.cache/last-install.json`. The installed device files and backups are under `/home/root/xovi/ChatGPT`.
