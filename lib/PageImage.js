.pragma library

function validIndex(index, count) {
    return typeof index === "number" && isFinite(index) && Math.floor(index) === index
            && index >= 0 && index < count;
}

function validRect(rect) {
    return rect && [rect.x, rect.y, rect.width, rect.height].every(function(n) {
        return typeof n === "number" && isFinite(n);
    }) && rect.width > 0 && rect.height > 0;
}

// Keep the complete paper, including notes below the first screen of a long page.
function layout(rectangles, maximumEdge) {
    var result = null;
    rectangles.forEach(function(rect) {
        if (!validRect(rect)) return;
        if (!result) {
            result = {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
            return;
        }
        var right = Math.max(result.x + result.width, rect.x + rect.width);
        var bottom = Math.max(result.y + result.height, rect.y + rect.height);
        result.x = Math.min(result.x, rect.x);
        result.y = Math.min(result.y, rect.y);
        result.width = right - result.x;
        result.height = bottom - result.y;
    });
    if (!result) throw new Error("The page has no renderable bounds.");
    var edge = Math.max(256, Math.min(4096, Math.round(maximumEdge || 2048)));
    var scale = edge / Math.max(result.width, result.height);
    return {
        rect: result,
        width: Math.max(1, Math.round(result.width * scale)),
        height: Math.max(1, Math.round(result.height * scale)),
        scale: scale,
        center: {x: result.x + result.width / 2, y: result.y + result.height / 2}
    };
}

function samePage(a, b) {
    return a && b && a.documentId === b.documentId && a.pageId === b.pageId;
}
