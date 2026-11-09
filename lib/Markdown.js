.pragma library

function safeMarkdown(text) {
    // Code spans stay literal. Other text cannot load remote images or HTML.
    return text.split(/(`+[^`]*`+)/g).map(function(part) {
        if (part.charAt(0) === "`") return part;
        return part.replace(/<(https?:\/\/[^<>\s]+)>/g, "[$1]($1)")
            .replace(/!\[/g, "\\![").replace(/<(?=[A-Za-z!/])/g, "&lt;");
    }).join("");
}

function blocks(source) {
    var result = [], normal = [], code = [], fence = "", language = "";
    function flush() {
        var text = normal.join("\n").trim();
        if (text) result.push({kind: "markdown", text: safeMarkdown(text), language: ""});
        normal = [];
    }
    var lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (!fence && match) {
            flush(); fence = match[1]; language = match[2].trim().split(/\s+/)[0]; code = [];
        } else if (fence && match && match[1].charAt(0) === fence.charAt(0)
                && match[1].length >= fence.length && !match[2].trim()) {
            result.push({kind: "code", text: code.join("\n"), language: language});
            fence = ""; code = [];
        } else if (fence) code.push(line);
        else if (line.indexOf("|") >= 0 && i + 1 < lines.length && tableRow(lines[i + 1]).every(function(cell) {
            return /^:?-{3,}:?$/.test(cell.trim());
        })) {
            flush();
            var header = tableRow(line);
            var align = tableRow(lines[++i]).map(function(cell) {
                return cell.trim().slice(-1) === ":" ? (cell.trim().charAt(0) === ":" ? "center" : "right") : "left";
            });
            var rows = [header];
            while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].indexOf("|") >= 0) {
                var cells = tableRow(lines[++i]);
                while (cells.length < header.length) cells.push("");
                rows.push(cells.slice(0, header.length));
            }
            result.push({kind: "table", rows: rows, align: align});
        } else normal.push(line);
    }
    if (fence) result.push({kind: "code", text: code.join("\n"), language: language});
    flush();
    return result;
}

function tableRow(line) {
    var text = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    var result = [], cell = "", code = false;
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (ch === "\\" && i + 1 < text.length) { cell += ch + text.charAt(++i); continue; }
        if (ch === "`") code = !code;
        if (ch === "|" && !code) { result.push(cell.trim()); cell = ""; }
        else cell += ch;
    }
    result.push(cell.trim());
    return result;
}
