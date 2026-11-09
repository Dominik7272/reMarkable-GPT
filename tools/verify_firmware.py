#!/usr/bin/env python3
"""Check exact native Qt interfaces and apply the patch to extracted firmware.

No proprietary sources or binary files are shipped in this project. Extraction
uses Qt's zstd resource frames and stays in .cache. Requires libzstd and qmldiff.
"""
import argparse
import ctypes as c
import ctypes.util
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def qml_resources(binary):
    lib = c.CDLL(ctypes.util.find_library("zstd"))
    for name in ["ZSTD_getFrameContentSize", "ZSTD_findFrameCompressedSize"]:
        function = getattr(lib, name)
        function.argtypes = [c.c_void_p, c.c_size_t]
        function.restype = c.c_ulonglong
    lib.ZSTD_decompress.argtypes = [c.c_void_p, c.c_size_t, c.c_void_p, c.c_size_t]
    lib.ZSTD_decompress.restype = c.c_size_t
    start = 0
    while (offset := binary.find(bytes.fromhex("28b52ffd"), start)) >= 0:
        start = offset + 4
        source = binary[offset:offset + 2_000_000]
        size = lib.ZSTD_getFrameContentSize(source, len(source))
        compressed = lib.ZSTD_findFrameCompressedSize(source, len(source))
        if size > 2_000_000 or compressed > len(source):
            continue
        destination = c.create_string_buffer(size)
        length = lib.ZSTD_decompress(destination, size, source, compressed)
        if length <= size and b"import QtQuick" in destination.raw[:length]:
            yield destination.raw[:length].decode()


def meta_object(binary, class_name, required_properties, required_methods):
    # Qt 6 revision 13: string table offsets, five-word property entries and
    # six-word method entries. Require the entire interface, not a lone name
    # that could accidentally match the indices of a neighbouring class table.
    start = 0
    while (name := binary.find(class_name.encode() + b"\0", start)) >= 0:
        start = name + 1
        for base in range(max(0, name - 40000), name):
            offset, length = struct.unpack_from("<II", binary, base)
            if base + offset != name or length != len(class_name):
                continue
            strings = []
            for index in range((name - base) // 8):
                offset, length = struct.unpack_from("<II", binary, base + index * 8)
                strings.append(binary[base + offset:base + offset + length].decode())
            for table in range(max(0, base - 50000) // 4 * 4, base + 20000, 4):
                h = struct.unpack_from("<14I", binary, table)
                if h[0] != 13 or h[1] != 0 or not 0 < h[6] < 200 or not 14 <= h[7] < 6000 or h[4] > 500:
                    continue
                properties = {}
                for index in range(h[6]):
                    record = struct.unpack_from("<5I", binary, table + 4 * (h[7] + index * 5))
                    if record[0] >= len(strings):
                        break
                    properties[strings[record[0]]] = record[2]
                if not required_properties.keys() <= properties.keys():
                    continue
                methods = {}
                for index in range(h[4]):
                    record = struct.unpack_from("<6I", binary, table + 4 * (h[5] + index * 6))
                    if record[0] >= len(strings) or record[1] > 30:
                        break
                    parameters = struct.unpack_from("<" + "I" * (record[1] + 1), binary, table + record[2] * 4)
                    if any(value & 0x80000000 and (value & 0x7fffffff) >= len(strings) for value in parameters):
                        break
                    types = tuple(strings[value & 0x7fffffff] if value & 0x80000000 else value for value in parameters)
                    # Public methods/slots, including const Q_INVOKABLEs.
                    if record[4] & 3 == 2 and record[4] & 12 in (0, 8):
                        methods[strings[record[0]]] = types
                if any(methods.get(key) != value for key, value in required_methods.items()):
                    continue
                for prop, writable in required_properties.items():
                    if writable and not properties[prop] & 2:
                        raise RuntimeError(f"{class_name}.{prop} is not writable")
                print(f"PASS: {class_name} native interface")
                return
    raise RuntimeError(f"Could not verify {class_name}'s complete required interface")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--with-graphcalc", type=Path, help="Also verify coexistence with this graphCalc.qmd")
    args = parser.parse_args()
    binary = args.binary.read_bytes()
    manifest = json.loads((ROOT / "compatibility.json").read_text())
    if hashlib.sha256(binary).hexdigest() != manifest["xochitl_sha256"]:
        raise RuntimeError("Firmware binary checksum mismatch")
    meta_object(binary, "ThumbnailProvider", {"document": True, "page": True, "monochrome": True, "source": False}, {})
    meta_object(binary, "QmlDocumentWrapper", {"pageCount": False, "lastOpenedPage": False, "fileType": False},
                {"idForPage": (10, 2)})
    meta_object(binary, "SceneController", {}, {"insertImageFileAsSceneItem": (43, "QUrl", "QPointF")})
    sources = list(qml_resources(binary))
    targets = {"qml/device/view/documentview/DocumentView.qml": "function pasteFromShortcut(actionType)",
               "qt/qml/xofm/libs/toolbar/qml/Toolbar.qml": "id: toolLayout"}
    source_root = ROOT / ".cache/firmware-source"
    for relative, marker in targets.items():
        matches = [source for source in sources if marker in source]
        if len(matches) != 1:
            raise RuntimeError(f"Expected one source for {relative}")
        destination = source_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(matches[0])
    variants = [[ROOT / "chatGPT.qmd"]]
    if args.with_graphcalc:
        variants += [[args.with_graphcalc, ROOT / "chatGPT.qmd"], [ROOT / "chatGPT.qmd", args.with_graphcalc]]
    for index, patches in enumerate(variants):
        output_root = ROOT / f".cache/firmware-patched-{index}"
        subprocess.run(["qmldiff", "apply-diffs", str(source_root), str(output_root),
                        *map(str, patches), "--version", manifest["firmware"]], check=True)
        document = (output_root / "qml/device/view/documentview/DocumentView.qml").read_text()
        assert "chatGPTLoader" in document and "openChatGPT" in document
        toolbar_path = "qt/qml/xofm/libs/toolbar/qml/Toolbar.qml"
        if args.with_graphcalc and index:
            assert "graphCalcLoader" in document
            assert "graphCalcButton" in (output_root / toolbar_path).read_text()
        elif (output_root / toolbar_path).exists():
            assert (output_root / toolbar_path).read_bytes() == (source_root / toolbar_path).read_bytes()
    print("PASS: exact firmware patch and optional graphCalc coexistence in both patch orders")


if __name__ == "__main__":
    main()
