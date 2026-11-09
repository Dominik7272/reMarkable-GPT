// Shared by Qt Quick and the desktop preview. Never evaluates JavaScript input.
var functions = {
    sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan],
    asin: [1, Math.asin], acos: [1, Math.acos], atan: [1, Math.atan],
    sinh: [1, Math.sinh], cosh: [1, Math.cosh], tanh: [1, Math.tanh],
    sqrt: [1, Math.sqrt], abs: [1, Math.abs], exp: [1, Math.exp],
    ln: [1, Math.log], log: [1, function (x) { return Math.log(x) / Math.LN10; }],
    log10: [1, function (x) { return Math.log(x) / Math.LN10; }],
    floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round],
    sign: [1, function (x) { return x === 0 ? 0 : x > 0 ? 1 : -1; }],
    min: [2, Math.min], max: [2, Math.max], pow: [2, Math.pow], atan2: [2, Math.atan2]
};

// Display the constant as a symbol, preserving the cursor through replacements.
// Letter boundaries keep unrelated and incomplete names intact; 2pi is valid.
function normalizePi(text, cursor) {
    text = String(text);
    cursor = cursor === undefined ? text.length : Math.max(0, Math.min(text.length, cursor));
    var position = cursor;
    var normalized = text.replace(/(^|[^a-z])pi(?=$|[^a-z])/gi, function (match, prefix, offset) {
        if (cursor >= offset + prefix.length + 2) position--;
        return prefix + "π";
    });
    return {text: normalized, cursor: position};
}

function normalizeInput(text, cursor) {
    var pi = normalizePi(text, cursor), position = pi.cursor;
    var normalized = pi.text.replace(/\*\*|××|<=|>=|\*|\//g, function (match, offset) {
        if (match.length === 2 && pi.cursor >= offset + 2) position--;
        return match === "<=" ? "≤" : match === ">=" ? "≥" : match.length === 2 ? "^" : match === "/" ? "÷" : "×";
    });
    return {text: normalized, cursor: position};
}

// A hue ring with a slightly darkened ink keeps colored curves readable.
function hueColor(hue) {
    hue = ((hue % 1) + 1) % 1;
    var sector = hue * 6, x = 1 - Math.abs(sector % 2 - 1);
    var rgb = sector < 1 ? [1,x,0] : sector < 2 ? [x,1,0] : sector < 3 ? [0,1,x]
        : sector < 4 ? [0,x,1] : sector < 5 ? [x,0,1] : [1,0,x];
    return "#" + rgb.map(function (v) { return ("0" + Math.round((.08 + .72 * v) * 255).toString(16)).slice(-2); }).join("");
}

// Treat names and multi-character operators as editing units, including when
// the cursor is inside them. Numbers retain ordinary digit-by-digit deletion.
function deletionRange(text, cursor, backwards, names) {
    text = String(text);
    cursor = Math.max(0, Math.min(text.length, cursor));
    var target = backwards === false ? cursor : cursor - 1;
    if (target < 0 || target >= text.length) return {start: cursor, end: cursor};
    for (var index = 0; index <= target;) {
        var rest = text.slice(index), match;
        if ((match = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest))) {
            index += match[0].length;
            continue;
        }
        var identifier = /^[a-z][a-z0-9_]*/i.exec(rest);
        var custom = identifier && (/^f\d+$/i.test(identifier[0]) || (names && names.indexOf(identifier[0].toLowerCase()) >= 0));
        if ((match = custom ? identifier : /^(?:log10|atan2|[a-z]+)/i.exec(rest))) {
            var end = index + match[0].length;
            if (custom || Object.prototype.hasOwnProperty.call(functions, match[0].toLowerCase())) {
                var opening = /^\s*\(/.exec(text.slice(end));
                if (opening) end += opening[0].length;
            }
            if ((match[0].length > 1 || custom) && target < end) return {start: index, end: end};
            index = end;
        } else if (rest.slice(0, 2) === "**") {
            if (target < index + 2) return {start: index, end: index + 2};
            index += 2;
        } else index++;
    }
    return {start: target, end: target + 1};
}

function backspaceStart(text, cursor) {
    return deletionRange(text, cursor, true).start;
}

function compile(input, options) {
    options = options || {};
    var source = String(input).trim().replace(/^y\s*=\s*/i, "")
        .replace(/[−–]/g, "-").replace(/[×·]/g, "*")
        .replace(/÷/g, "/").replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, function (power) {
            var superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹";
            return "^(" + power.split("").map(function (digit) {
                return digit === "⁻" ? "-" : digit === "⁺" ? "+" : String(superscripts.indexOf(digit));
            }).join("") + ")";
        }).toLowerCase();
    if (!source || source.length > 300) throw new Error("Enter an equation (up to 300 characters).");
    var tokens = [], index = 0, cursor = 0, depth = 0, hasVariable = false, hasX = false, hasY = false;
    function fail(message) { throw new Error(message + " at position " + (tokens[cursor].at + 1) + "."); }
    while (index < source.length) {
        var rest = source.slice(index), match;
        if (/^\s/.test(rest)) { index++; continue; }
        if (rest[0] === "π") {
            match = ["π"];
            tokens.push({type: "name", value: "pi", at: index});
        } else if ((match = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/.exec(rest))) {
            tokens.push({type: "number", value: Number(match[0]), at: index});
        } else if ((match = /^[a-z][a-z0-9_]*/.exec(rest))) {
            // Keep compact products such as xy and x2 while permitting f1.
            if (/^[xye][xye0-9]*$/.test(match[0]) && match[0].length > 1
                    && !(options.hasName && options.hasName(match[0]))) match = [match[0][0]];
            tokens.push({type: "name", value: match[0], at: index});
        } else if ((match = /^(?:\*\*|[+\-*/^(),])/.exec(rest))) {
            tokens.push({type: match[0] === "**" ? "^" : match[0], at: index});
        } else throw new Error("Unexpected character '" + source[index] + "' at position " + (index + 1) + ".");
        index += match[0].length;
    }
    tokens.push({type: "end", at: source.length});
    function take(type) { if (tokens[cursor].type === type) { cursor++; return true; } return false; }
    function primary() {
        if (++depth > 40) fail("Expression is too deeply nested");
        var token = tokens[cursor], node;
        if (take("number")) node = ["n", token.value];
        else if (take("name")) {
            if (token.value === (options.parameter || "x")) { hasVariable = hasX = true; node = ["x"]; }
            else if (token.value === "x" && !options.parameter) { hasVariable = hasX = true; node = ["x"]; }
            else if (token.value === "y" && options.allowY && !options.parameter) { hasVariable = hasY = true; node = ["y"]; }
            else if (token.value === "pi" || token.value === "e") node = ["n", token.value === "pi" ? Math.PI : Math.E];
            else {
                var fn = Object.prototype.hasOwnProperty.call(functions, token.value) ? functions[token.value]
                    : options.resolve ? options.resolve(token.value) : null;
                if (!fn) fail("Unknown name '" + token.value + "'");
                if (fn[0] === 0) { depth--; return ["n", fn[1]()]; }
                if (!take("(")) fail("Use parentheses after '" + token.value + "'");
                var args = [expression()];
                while (take(",")) args.push(expression());
                if (!take(")")) fail("Expected ')'");
                if (args.length !== fn[0]) fail(token.value + " needs " + fn[0] + " argument(s)");
                node = ["f", fn, args];
            }
        } else if (take("(")) {
            node = expression();
            if (!take(")")) fail("Expected ')'");
        } else fail("Expected a number, x, or a function");
        depth--;
        return node;
    }
    function power() { var node = primary(); return take("^") ? ["^", node, unary()] : node; }
    function unary() {
        if (++depth > 40) fail("Expression is too deeply nested");
        var node;
        if (take("+")) node = unary();
        else if (take("-")) node = ["neg", unary()];
        else node = power();
        depth--;
        return node;
    }
    function multiply() {
        var node = unary();
        while (true) {
            if (take("*")) node = ["*", node, unary()];
            else if (take("/")) node = ["/", node, unary()];
            else if (["number", "name", "("].indexOf(tokens[cursor].type) >= 0) node = ["*", node, unary()];
            else return node;
        }
    }
    function expression() {
        var node = multiply();
        while (true) {
            if (take("+")) node = ["+", node, multiply()];
            else if (take("-")) node = ["-", node, multiply()];
            else return node;
        }
    }
    var tree = expression();
    if (tokens[cursor].type !== "end") fail("Unexpected input");
    function literal(value) { return {constant: true, value: value, cost: 1, run: function () { return value; }}; }
    // Resolve the tree once. Sampling then calls small numeric closures rather
    // than walking node tags and allocating argument arrays for every point.
    function build(node) {
        var kind = node[0], a, b, operation;
        if (kind === "n") return literal(node[1]);
        if (kind === "x") return {cost: 1, run: function (x) { return x; }};
        if (kind === "y") return {cost: 1, run: function (x, y) { return y; }};
        if (kind === "neg") {
            a = build(node[1]);
            return a.constant ? literal(-a.value) : {cost: a.cost + 1, run: function (x, y) { return -a.run(x, y); }};
        }
        if (kind === "f") {
            operation = node[1][1];
            a = build(node[2][0]);
            if (node[2].length === 1)
                return a.constant ? literal(operation(a.value)) : {cost: a.cost + (node[1][3] || 1), run: function (x, y) { return operation(a.run(x, y)); }};
            b = build(node[2][1]);
        } else {
            a = build(node[1]); b = build(node[2]);
            if (kind === "+") operation = function (x, y) { return x + y; };
            else if (kind === "-") operation = function (x, y) { return x - y; };
            else if (kind === "*") operation = function (x, y) { return x * y; };
            else if (kind === "/") operation = function (x, y) { return x / y; };
            else operation = Math.pow;
        }
        if (a.constant && b.constant) return literal(operation(a.value, b.value));
        if (kind === "^" && b.constant) {
            if (b.value === 2) return {cost: a.cost + 1, run: function (x, y) { var v = a.run(x, y); return v * v; }};
            if (b.value === 3) return {cost: a.cost + 2, run: function (x, y) { var v = a.run(x, y); return v * v * v; }};
            if (b.value === 4) return {cost: a.cost + 2, run: function (x, y) { var v = a.run(x, y); v *= v; return v * v; }};
        }
        var cost = a.cost + b.cost + (kind === "f" ? node[1][3] || 1 : 1);
        if (a.constant) return {cost: cost, run: function (x, y) { return operation(a.value, b.run(x, y)); }};
        if (b.constant) return {cost: cost, run: function (x, y) { return operation(a.run(x, y), b.value); }};
        return {cost: cost, run: function (x, y) { return operation(a.run(x, y), b.run(x, y)); }};
    }
    var evaluator = build(tree);
    if (evaluator.cost > 4096) throw new Error("Equation is too complex. Simplify its references.");
    return {source: normalizeInput(String(input).trim()).text, hasVariable: hasVariable,
        hasX: hasX, hasY: hasY, cost: evaluator.cost, evaluate: evaluator.run};
}

function constant(text) {
    var expression = compile(text), value = expression.evaluate(0);
    if (expression.hasVariable || !isFinite(value)) throw new Error("Limits must be finite numbers; pi and e are allowed.");
    return value;
}

function validate(equation, xmin, xmax, ymin, ymax) {
    var model = {expression: compile(equation), xmin: constant(xmin), xmax: constant(xmax), ymin: constant(ymin), ymax: constant(ymax)};
    validateBounds(model);
    return model;
}

function bounds(model) {
    var result = {xmin: model.xmin, xmax: model.xmax, ymin: model.ymin, ymax: model.ymax};
    if (model.logX) result.logX = true;
    if (model.logY) result.logY = true;
    return result;
}

function sameBounds(a, b) {
    return !!a && !!b && a.xmin === b.xmin && a.xmax === b.xmax && a.ymin === b.ymin && a.ymax === b.ymax
        && !!a.logX === !!b.logX && !!a.logY === !!b.logY;
}

function validateBounds(model) {
    [model.xmin, model.xmax, model.ymin, model.ymax].forEach(function (v) {
        if (typeof v !== "number" || !isFinite(v)) throw new Error("The graph view needs finite limits.");
    });
    if (model.xmin >= model.xmax || model.ymin >= model.ymax) throw new Error("Each minimum must be less than its maximum.");
    [model.xmin, model.xmax, model.ymin, model.ymax].forEach(function (v) {
        if (Math.abs(v) > 1e12) throw new Error("Keep limits between -1e12 and 1e12.");
    });
    ["x", "y"].forEach(function (axis) {
        var low = model[axis + "min"], high = model[axis + "max"], log = !!model[axis === "x" ? "logX" : "logY"];
        if (log && low <= 0) throw new Error("Log " + axis + " limits must be greater than 0.");
        if (log && low < 1e-12) throw new Error("Keep log " + axis + " limits at or above 1e-12.");
        if ((log ? Math.log(high / low) / Math.LN10 : high - low) < 1e-9)
            throw new Error(log ? "The log " + axis + " range is too small." : "Each axis must span at least 1e-9.");
    });
    return bounds(model);
}

function axisMap(low, high, log) {
    var start = log ? Math.log(low) / Math.LN10 : low;
    var end = log ? Math.log(high) / Math.LN10 : high, span = end - start;
    return {
        at: function (fraction) { return log ? Math.pow(10, start + fraction * span) : low + fraction * span; },
        position: function (value) { return ((log ? Math.log(value) / Math.LN10 : value) - start) / span; }
    };
}

function viewCoordinates(view) {
    return {xmin: view.logX ? Math.log(view.xmin) / Math.LN10 : view.xmin,
            xmax: view.logX ? Math.log(view.xmax) / Math.LN10 : view.xmax,
            ymin: view.logY ? Math.log(view.ymin) / Math.LN10 : view.ymin,
            ymax: view.logY ? Math.log(view.ymax) / Math.LN10 : view.ymax};
}

function fromCoordinates(value, view, axis) {
    var result = bounds(view);
    ["x", "y"].forEach(function (name) {
        if (axis && axis !== name) return;
        var log = !!view[name === "x" ? "logX" : "logY"];
        result[name + "min"] = log ? Math.pow(10, value[name + "min"]) : value[name + "min"];
        result[name + "max"] = log ? Math.pow(10, value[name + "max"]) : value[name + "max"];
    });
    return validateBounds(result);
}

function setAxisLog(view, axis, enabled) {
    validateBounds(view);
    var next = bounds(view), name = axis === "x" ? "logX" : "logY";
    next[name] = enabled === true;
    if (enabled) {
        var low = next[axis + "min"], high = next[axis + "max"];
        if (high <= 1e-12) { low = .1; high = 10; }
        else if (low <= 0 || low < 1e-12) low = Math.max(1e-12, high / 100);
        next[axis + "min"] = low; next[axis + "max"] = high;
    } else if (next[axis + "max"] - next[axis + "min"] < 1e-9) {
        var range = constrainAxis(next[axis + "min"], next[axis + "max"]);
        next[axis + "min"] = range[0]; next[axis + "max"] = range[1];
    }
    return validateBounds(next);
}

function viewModel(expression, view) {
    var model = validateBounds(view);
    model.expression = expression;
    return model;
}

// Parse labels without compiling; the UI can use this when opening a menu.
function describeEntry(text, alias) {
    text = normalizeInput(String(text).trim()).text;
    var parts = text.split(/([=<>≤≥])/), result = {name: alias, text: text, rhs: text, kind: "function", parameter: "x", named: false};
    if (parts.length !== 1 && (parts.length !== 3 || !parts[0].trim() || !parts[2].trim()))
        throw new Error("Enter an expression on each side of one comparison sign.");
    if (parts.length === 3) {
        var lhs = parts[0].trim().toLowerCase(), rhs = parts[2].trim();
        var fn = /^([a-z][a-z0-9_]*)\(\s*([a-z])\s*\)$/.exec(lhs);
        if (parts[1] !== "=") {
            result.kind = "inequality"; result.lhs = parts[0].trim(); result.rhs = rhs; result.operator = parts[1];
        } else if (fn && !Object.prototype.hasOwnProperty.call(functions, fn[1])) {
            result.name = fn[1]; result.parameter = fn[2]; result.named = true; result.rhs = rhs;
        } else if (/^[a-z][a-z0-9_]*$/.test(lhs) && !/^[xy][xy0-9]*$/.test(lhs)) {
            result.name = lhs; result.kind = "constant"; result.named = true; result.rhs = rhs;
        } else { result.kind = "relation"; result.lhs = parts[0].trim(); result.rhs = rhs; }
    }
    result.label = result.named || result.kind === "relation" || result.kind === "inequality" ? text : alias + "(x) = " + text;
    result.reference = result.kind === "constant" ? result.name : result.name + "(";
    return result;
}

var definitionCache = null, definitionGeneration = 0;
function graphModel(entries, view) {
    var model = validateBounds(view), descriptions = [], registry = Object.create(null);
    var key = JSON.stringify(entries.map(function (e, i) { return [e.name || "f" + (i + 1), String(e.text)]; }));
    if (!definitionCache || definitionCache.key !== key) {
        entries.forEach(function (entry, index) {
            var alias = entry.name || "f" + (index + 1), info;
            try { info = describeEntry(entry.text, alias); }
            catch (error) { info = {text: String(entry.text), error: error.message}; }
            info.alias = alias; info.index = index;
            descriptions.push(info);
            registry[alias] = info;
        });
        descriptions.forEach(function (info) {
            if (!info.named || info.name === info.alias) return;
            if (Object.prototype.hasOwnProperty.call(functions, info.name) || ["x","y","e","pi"].indexOf(info.name) >= 0)
                info.error = "The name '" + info.name + "' is reserved.";
            else if (registry[info.name] && registry[info.name] !== info) {
                info.error = registry[info.name].error = "The name '" + info.name + "' is already defined.";
            } else registry[info.name] = info;
        });
        definitionCache = {key: key, descriptions: descriptions, registry: registry, generation: ++definitionGeneration};
    }
    var cache = definitionCache;
    var depth = 0;
    function resolve(name) {
        var info = cache.registry[name];
        if (!info) return null;
        var compiled = buildEntry(info);
        return [compiled.arity, compiled.call, compiled.cacheKey, compiled.cost];
    }
    function buildEntry(info) {
        if (info.compiled) return info.compiled;
        if (info.error) throw new Error(info.error);
        if (!info.text.trim()) throw new Error("'" + info.alias + "' is empty.");
        if (info.building) throw new Error("Circular reference involving '" + info.alias + "'.");
        if (++depth > 24) { depth--; throw new Error("Too many nested graph references."); }
        info.building = true;
        try {
            var options = {allowY: true, resolve: resolve, hasName: function (name) { return !!cache.registry[name]; }};
            var expression, orientation = "x", arity = 1;
            if (info.kind === "function") {
                if (info.named) options.parameter = info.parameter;
                expression = compile(info.rhs, options);
                if (expression.hasY) throw new Error("Use = in equations containing y.");
            } else if (info.kind === "constant") {
                expression = compile(info.rhs, options);
                if (expression.hasVariable || !isFinite(expression.evaluate(0, 0))) throw new Error("Constants must be finite and independent of x and y.");
                arity = 0; orientation = "constant";
            } else {
                var rhs = compile(info.rhs, options);
                if (info.kind === "inequality") {
                    expression = compile("(" + info.lhs + ")-(" + info.rhs + ")", options);
                    expression.inequality = info.operator;
                    orientation = "implicit"; arity = 2;
                } else if (info.lhs.toLowerCase() === "y" && !rhs.hasY) expression = rhs;
                else if (info.lhs.toLowerCase() === "x" && !rhs.hasX) {
                    var side = rhs;
                    expression = {evaluate: function (y) { return side.evaluate(0, y); }, cost: side.cost};
                    orientation = "y";
                } else {
                    expression = compile("(" + info.lhs + ")-(" + info.rhs + ")", options);
                    orientation = "implicit"; arity = 2;
                    if (!expression.hasVariable && expression.evaluate(0, 0) === 0) throw new Error("This equation is true everywhere.");
                }
            }
            expression.source = info.text;
            expression.title = info.label;
            expression.orientation = orientation;
            expression.cacheKey = cache.generation + ":" + info.index;
            expression.arity = arity; expression.call = expression.evaluate;
            info.compiled = expression;
            return expression;
        } finally { info.building = false; depth--; }
    }
    model.graphs = [];
    entries.forEach(function (entry, index) {
        if (entry.visible === false || !String(entry.text).trim()) return;
        try {
            var expression = buildEntry(cache.descriptions[index]);
            if (expression.orientation !== "constant") model.graphs.push({expression: expression,
                color: /^#[a-f0-9]{6}$/i.test(entry.color) ? entry.color : "#000000", number: index + 1, name: entry.name});
        } catch (error) {
            throw new Error((entry.name ? entry.name + ": " : entries.length > 1 ? "Graph " + (index + 1) + ": " : "") + error.message);
        }
    });
    model.expression = model.graphs.length ? model.graphs[0].expression : null;
    return model;
}

function reframe(model, view) {
    var next = viewModel(model.expression, view);
    if (model.graphs) next.graphs = model.graphs;
    return next;
}

function constrainAxis(low, high, log) {
    var center = low / 2 + high / 2;
    // Keep several representable steps at large offsets, so repeated zooms
    // cannot collapse the range to a single floating-point value.
    var limit = log ? 12 : 1e12;
    var minimum = log ? 1.01e-9 : Math.max(1.01e-9, Math.min(1e12, Math.abs(center)) * 4e-15);
    var span = Math.max(minimum, Math.min(2 * limit, high - low));
    center = Math.max(-limit + span / 2, Math.min(limit - span / 2, center));
    return [center - span / 2, center + span / 2];
}

// dx/dy are fractions of the plot width/height, with positive motion right/down.
function panView(view, dx, dy, axis) {
    validateBounds(view);
    if (!isFinite(dx) || !isFinite(dy)) throw new Error("Invalid pan distance.");
    dx = Math.max(-1e6, Math.min(1e6, dx));
    dy = Math.max(-1e6, Math.min(1e6, dy));
    var c = viewCoordinates(view), sx = -(c.xmax - c.xmin) * dx, sy = (c.ymax - c.ymin) * dy;
    var x = constrainAxis(c.xmin + sx, c.xmax + sx, view.logX);
    var y = constrainAxis(c.ymin + sy, c.ymax + sy, view.logY);
    return fromCoordinates({xmin: x[0], xmax: x[1], ymin: y[0], ymax: y[1]}, view, axis);
}

// factor > 1 zooms in. ax/ay identify a stationary point in the plot (0..1).
function zoomView(view, factor, ax, ay, axis) {
    validateBounds(view);
    if (!isFinite(factor) || factor <= 0 || !isFinite(ax) || !isFinite(ay)) throw new Error("Invalid zoom.");
    factor = Math.max(1e-6, Math.min(1e6, factor));
    ax = Math.max(0, Math.min(1, ax)); ay = Math.max(0, Math.min(1, ay));
    var c = viewCoordinates(view), spanX = c.xmax - c.xmin, spanY = c.ymax - c.ymin;
    var anchorX = c.xmin + ax * spanX, anchorY = c.ymax - ay * spanY;
    var w = Math.max(1e-9, Math.min(2e12, spanX / factor));
    var h = Math.max(1e-9, Math.min(2e12, spanY / factor));
    var x = constrainAxis(anchorX - ax * w, anchorX + (1 - ax) * w, view.logX);
    var y = constrainAxis(anchorY - (1 - ay) * h, anchorY + ay * h, view.logY);
    return fromCoordinates({xmin: x[0], xmax: x[1], ymin: y[0], ymax: y[1]}, view, axis);
}

// A logarithmic axis has no zero. Its perpendicular axis sits at the frame edge.
function axisPositions(view) {
    return {x: view.logY ? 1 : view.ymin <= 0 && view.ymax >= 0 ? view.ymax / (view.ymax - view.ymin) : NaN,
            y: view.logX ? 0 : view.xmin <= 0 && view.xmax >= 0 ? -view.xmin / (view.xmax - view.xmin) : NaN};
}

// Hit-test the visible zero axes, plus coordinate-label strips for the wheel.
// area and pointer coordinates are display pixels, independent of Canvas size.
// An empty result means normal two-axis zoom. For touch, both initial finger
// positions must hit the same axis; the pinch midpoint alone never selects it.
function zoomAxisAt(view, area, options, x, y, tolerance, directionX, directionY, size) {
    var style = plotOptions(options), right = area.left + area.width, bottom = area.top + area.height;
    var axes = axisPositions(view);
    size = size || {width: 1200, height: 900};
    var imageScale = area.width / frame(size.width, size.height, style).width * drawingScale(size.width, size.height, style);
    function hit(px, py, labels) {
        var insideX = px >= area.left && px <= right, insideY = py >= area.top && py <= bottom;
        // Keep wheel targets tied to the printed labels, independently of
        // the touch tolerance. Touch scaling requires the actual axis line.
        if (labels && insideX && py >= bottom && py <= bottom + 40 * imageScale && (style.xNumbers || style.xAxis && style.axisLabels)) return 1;
        if (labels && insideY && px <= area.left && px >= area.left - 64 * imageScale && (style.yNumbers || style.yAxis && style.axisLabels)) return 2;
        var dx = Infinity, dy = Infinity;
        if (style.yAxis && isFinite(axes.y) && py >= area.top - tolerance && py <= bottom + tolerance)
            dx = Math.abs(px - (area.left + axes.y * area.width));
        if (style.xAxis && isFinite(axes.x) && px >= area.left - tolerance && px <= right + tolerance)
            dy = Math.abs(py - (area.top + axes.x * area.height));
        // A point near the intersection can belong to both lines. Combining
        // both fingertips below resolves the axis without rejecting that point.
        return (dy <= tolerance ? 1 : 0) | (dx <= tolerance ? 2 : 0);
    }
    var mask;
    if (!isFinite(directionX) || !isFinite(directionY)) mask = hit(x, y, true); // Mouse wheel.
    else {
        if (directionX === 0 && directionY === 0) return ""; // Touch positions not available yet.
        mask = hit(x - directionX, y - directionY, false) & hit(x + directionX, y + directionY, false);
    }
    return mask === 1 ? "x" : mask === 2 ? "y" : "";
}

function snapView(view) {
    validateBounds(view);
    var result = bounds(view);
    ["x", "y"].forEach(function (axis) {
        var log = !!view[axis === "x" ? "logX" : "logY"];
        var low = view[axis + "min"], high = view[axis + "max"];
        if (log) {
            var a = Math.floor(Math.log(low) / Math.LN10), b = Math.ceil(Math.log(high) / Math.LN10);
            while (Math.pow(10, a + 1) <= low) a++;
            while (Math.pow(10, b - 1) >= high) b--;
            result[axis + "min"] = Math.pow(10, Math.max(-12, a));
            result[axis + "max"] = Math.pow(10, Math.min(12, b));
        } else { result[axis + "min"] = Math.floor(low); result[axis + "max"] = Math.ceil(high); }
    });
    return result;
}

// Equal units on both axes. Expand the tighter dimension around the current
// center; only the supported numerical limits can require reducing the view.
function squareView(view, area) {
    validateBounds(view);
    if (!area || !isFinite(area.width) || !isFinite(area.height) || area.width <= 0 || area.height <= 0)
        throw new Error("Invalid plot size.");
    var c = viewCoordinates(view), cx = c.xmin / 2 + c.xmax / 2, cy = c.ymin / 2 + c.ymax / 2;
    var units = Math.max((c.xmax - c.xmin) / area.width, (c.ymax - c.ymin) / area.height,
        Math.max(1.01e-9, view.logX ? 0 : Math.abs(cx) * 4e-15) / area.width,
        Math.max(1.01e-9, view.logY ? 0 : Math.abs(cy) * 4e-15) / area.height);
    units = Math.min(units, (view.logX ? 24 : 2e12) / area.width, (view.logY ? 24 : 2e12) / area.height);
    var w = units * area.width, h = units * area.height;
    var x = constrainAxis(cx - w / 2, cx + w / 2, view.logX), y = constrainAxis(cy - h / 2, cy + h / 2, view.logY);
    return fromCoordinates({xmin: x[0], xmax: x[1], ymin: y[0], ymax: y[1]}, view);
}

function plotOptions(options) {
    var result = {transparent: false, equation: true, xAxis: true, yAxis: true,
                  xNumbers: true, yNumbers: true, axisLabels: true, grid: true, border: true, scale: 1};
    // Preserve compatibility with callers that passed only the grid flag.
    if (typeof options === "boolean") result.grid = options;
    else if (options) Object.keys(result).forEach(function (key) {
        if (typeof result[key] === "boolean" && typeof options[key] === "boolean") result[key] = options[key];
    });
    if (options && typeof options.scale === "number" && isFinite(options.scale))
        result.scale = Math.max(0.5, Math.min(3, options.scale));
    return result;
}

var aspectRatios = ["1:1", "6:5", "5:4", "4:3", "7:5", "3:2", "16:10", "5:3", "16:9", "2:1", "21:9", "3:1", "4:1"];

function outputOptions(options) {
    options = options || {};
    var legacy = {standard: "4:3", square: "1:1", wide: "16:9", tall: "4:3"};
    var ratio = aspectRatios.indexOf(options.ratio) >= 0 ? options.ratio
        : Object.prototype.hasOwnProperty.call(legacy, options.format) ? legacy[options.format] : "4:3";
    return {ratio: ratio, portrait: typeof options.portrait === "boolean" ? options.portrait : options.format === "tall",
            resolution: [800, 1200, 1600, 2400].indexOf(options.resolution) >= 0 ? options.resolution : 1200};
}

function outputSize(options, edge) {
    var output = outputOptions(options), length = edge || output.resolution;
    var ratio = output.ratio.split(":"), short = Math.round(length * Number(ratio[1]) / Number(ratio[0]));
    return output.portrait ? {width: short, height: length} : {width: length, height: short};
}

function previewSize(options, moving) {
    var output = outputOptions(options), ratio = output.ratio.split(":"), a = Number(ratio[0]), b = Number(ratio[1]);
    var x = a, y = b;
    while (y) { var rest = x % y; x = y; y = rest; }
    a /= x; b /= x;
    // Whole pixels at both preview sizes, with exactly the same aspect ratio.
    var multiple = Math.max(2, Math.round(1200 / (2 * a)) * 2) / (moving ? 2 : 1);
    return output.portrait ? {width: b * multiple, height: a * multiple} : {width: a * multiple, height: b * multiple};
}

function drawingScale(width, height, style) {
    return Math.min(width / 1200, height / 675) * style.scale;
}

function legendLayout(width, height, style, count) {
    var scale = drawingScale(width, height, style);
    var maxRows = Math.max(1, Math.floor(height * .30 / (36 * scale)));
    var columns = count > 1 ? Math.max(2, Math.ceil(count / maxRows)) : 1;
    return {columns: columns, rows: Math.ceil(count / columns)};
}

function frame(width, height, options, model) {
    var style = plotOptions(options);
    var scale = drawingScale(width, height, style);
    var left = (style.yNumbers ? 112 : style.axisLabels && style.yAxis ? 48 : 24) * scale;
    var top = (style.equation ? 100 : style.axisLabels && style.yAxis ? 42 : 24) * scale;
    if (style.equation && model && model.graphs && model.graphs.length > 1)
        top = Math.max(top, (52 + 36 * legendLayout(width, height, style, model.graphs.length).rows) * scale);
    var bottom = (style.xNumbers ? 90 : style.axisLabels && style.xAxis ? 54 : 24) * scale;
    var right = (style.xNumbers ? 36 : 24) * scale;
    return {left: left, top: top, width: width - left - right, height: height - top - bottom};
}

function format(value) {
    if (Math.abs(value) < 1e-14) return "0";
    var absolute = Math.abs(value);
    return absolute >= 1e6 || absolute < 0.001 ? value.toExponential(2).replace(/\.00e/, "e") : String(Number(value.toPrecision(5)));
}

function tickStep(low, high, target) {
    var rough = (high - low) / (target || 6), magnitude = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var normalized = rough / magnitude;
    return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function ticks(low, high, target, step) {
    step = step || tickStep(low, high, target);
    var result = [], first = Math.ceil(low / step);
    for (var i = 0; i < 30; i++) {
        var value = (first + i) * step;
        if (value > high + step * 1e-8) break;
        result.push(Math.abs(value) < step * 1e-8 ? 0 : value);
    }
    return result;
}

function logTicks(low, high, target, step) {
    var start = Math.log(low) / Math.LN10, end = Math.log(high) / Math.LN10;
    if (end - start < 1.2) return {major: ticks(low, high, target), minor: []};
    var stride = step || Math.max(1, Math.ceil((end - start) / (target || 6)));
    var major = [], minor = [];
    for (var power = Math.max(-12, Math.floor(start)); power <= Math.min(12, Math.ceil(end)); power++) {
        var decade = Math.pow(10, power);
        if (power % stride === 0 && decade >= low && decade <= high) major.push(decade);
        for (var i = 2; i <= 9; i++) {
            var value = i * decade;
            if (value >= low && value <= high) minor.push(value);
        }
    }
    return {major: major, minor: minor};
}

// Spread a fixed budget over the complete view. Stop ordinary refinement below
// a fraction of a pixel; dense, bounded oscillations become a local envelope.
function sample(model, width, height) {
    if (model.expression.orientation === "implicit") return sampleImplicit(model, width, height);
    if (model.expression.orientation === "y") {
        var swapped = sample({expression: {evaluate: model.expression.evaluate},
            xmin: model.ymin, xmax: model.ymax, ymin: model.xmin, ymax: model.xmax,
            logX: model.logY, logY: model.logX}, height, width);
        swapped.segments = swapped.segments.map(function (s) { return [width - s[1], height - s[0], width - s[3], height - s[2]]; });
        return swapped;
    }
    var segments = [], calls = 0, defined = 0, budget = 20000, limited = false, denseColumns = 0;
    var xMap = axisMap(model.xmin, model.xmax, model.logX), yMap = axisMap(model.ymin, model.ymax, model.logY);
    var count = Math.max(64, Math.min(2048, Math.ceil(width / 2)));
    function value(px) {
        calls++;
        var y = model.expression.evaluate(xMap.at(px / width));
        if (isFinite(y)) defined++;
        return (1 - yMap.position(y)) * height;
    }
    var previous = value(0);
    for (var column = 0; column < count; column++) {
        var x0 = column / count * width, x1 = (column + 1) / count * width;
        var allowance = Math.floor((budget - calls) / (count - column));
        var startCalls = calls, values = [], local = [], gap = false, dense = false;
        var low = Infinity, high = -Infinity;
        values[0] = previous;
        values[32] = previous = value(x1);
        function at(t) {
            var key = t * 2;
            if (values[key] !== undefined) return values[key];
            if (calls - startCalls >= allowance) { limited = true; return NaN; }
            var y = value(x0 + t / 16 * (x1 - x0));
            values[key] = y;
            return y;
        }
        function segment(a, ya, b, yb) {
            if (!isFinite(ya) || !isFinite(yb)) { gap = true; return; }
            // Curved jumps through opposite off-screen sides are poles. A
            // steep straight line is accepted earlier by the error test.
            if ((ya < 0 && yb > height) || (yb < 0 && ya > height)) { gap = true; return; }
            if (!(ya < 0 && yb < 0) && !(ya > height && yb > height))
                local.push([x0 + a / 16 * (x1 - x0), ya, x0 + b / 16 * (x1 - x0), yb]);
        }
        function walk(a, b) {
            var ya = at(a), yb = at(b), mid = (a + b) / 2, ym = at(mid);
            var finite = isFinite(ya) && isFinite(yb) && isFinite(ym);
            if (!isFinite(ya) && !isFinite(yb) && !isFinite(ym)) { gap = true; return; }
            var error = finite ? Math.abs(ym - (ya / 2 + yb / 2)) : Infinity;
            if (finite && error <= 0.7) {
                if (!(ya < 0 && yb < 0) && !(ya > height && yb > height))
                    local.push([x0 + a / 16 * (x1 - x0), ya, x0 + b / 16 * (x1 - x0), yb]);
            } else if (b - a > 1 && calls - startCalls < allowance) {
                walk(a, mid); walk(mid, b);
            } else {
                if (finite && ya >= 0 && ya <= height && ym >= 0 && ym <= height && yb >= 0 && yb <= height) dense = true;
                segment(a, ya, mid, ym); segment(mid, ym, b, yb);
            }
        }
        var y0 = at(0), y1 = at(16), q1 = at(4), mid = at(8), q3 = at(12);
        // An off-grid probe avoids repeatedly hitting the same phase of a
        // periodic function on the uniform quarter-pixel lattice.
        var probeAt = 16 * 0.38196601125, probe = at(probeAt);
        var finite = [y0, q1, mid, q3, y1, probe].every(isFinite);
        var error = finite ? Math.max(Math.abs(q1 - (y0 * .75 + y1 * .25)),
            Math.abs(mid - (y0 / 2 + y1 / 2)), Math.abs(q3 - (y0 * .25 + y1 * .75)),
            Math.abs(probe - (y0 + (y1 - y0) * probeAt / 16))) : Infinity;
        if (finite && error <= 0.7) {
            if (!(y0 < 0 && y1 < 0) && !(y0 > height && y1 > height)) local.push([x0, y0, x1, y1]);
        } else {
            walk(0, 4); walk(4, 8); walk(8, 12); walk(12, 16);
            // A large off-grid deviation with an otherwise straight mesh is
            // also unresolved oscillation, rather than a genuinely flat line.
            if (finite && local.length <= 4 && error > 2) dense = true;
        }
        for (var k = 0; k <= 33; k++) {
            var y = k === 33 ? probe : values[k];
            if (y === undefined) continue;
            if (!isFinite(y)) gap = true;
            else { low = Math.min(low, y); high = Math.max(high, y); }
        }
        if (dense && !gap && low >= 0 && high <= height) {
            segments.push([(x0 + x1) / 2, low, (x0 + x1) / 2, high]);
            denseColumns++;
        } else {
            for (var j = 0; j < local.length; j++) segments.push(local[j]);
        }
    }
    if (!defined) throw new Error("The equation has no real values in this x range.");
    return {segments: segments, calls: calls, truncated: limited, denseColumns: denseColumns};
}

// Marching squares with shared edge roots. Bisection rejects sign changes at
// poles, and center probes refine small loops and ambiguous intersections.
function sampleImplicit(model, width, height) {
    var moving = width < 700, budget = moving ? 14000 : 60000;
    // Leave most of the budget for edge roots and refinement at every output size.
    var cell = Math.max(moving ? 12 : 8, Math.sqrt(width * height / (budget * .30)));
    var nx = Math.max(8, Math.ceil(width / cell)), ny = Math.max(8, Math.ceil(height / cell));
    var dx = width / nx, dy = height / ny, calls = 0, defined = 0, nonzero = false, limited = false, segments = [], fills = [];
    var inequality = model.expression.inequality;
    var xMap = axisMap(model.xmin, model.xmax, model.logX), yMap = axisMap(model.ymin, model.ymax, model.logY);
    function inside(v) {
        return isFinite(v) && (inequality === "<" ? v < 0 : inequality === "≤" ? v <= 0 : inequality === ">" ? v > 0 : v >= 0);
    }
    function value(px, py) {
        if (calls >= budget) { limited = true; return NaN; }
        calls++;
        var v = model.expression.evaluate(xMap.at(px / width), yMap.at(1 - py / height));
        if (isFinite(v)) { defined++; if (v !== 0) nonzero = true; }
        return v;
    }
    var vertices = new Float64Array((nx + 1) * (ny + 1));
    for (var row = 0; row <= ny; row++) for (var col = 0; col <= nx; col++)
        vertices[row * (nx + 1) + col] = value(col * dx, row * dy);
    if (!defined) throw new Error("The equation has no real values in this view.");
    if (!nonzero) {
        if (!inequality) throw new Error("This equation is true everywhere.");
        if (!inside(0) || defined === vertices.length)
            return {segments: [], fills: inside(0) ? [[0,0,width,0,width,height,0,height]] : [], calls: calls, truncated: false, denseColumns: 0};
    }
    var roots = Object.create(null);
    function root(a, b, fa, fb, key) {
        if (key !== undefined && roots[key] !== undefined) return roots[key];
        var result = null;
        if (fa === 0) result = a;
        else if (fb === 0) result = b;
        else if (isFinite(fa) && isFinite(fb) && (fa < 0) !== (fb < 0)) {
            var lo = a, hi = b, initial = Math.min(Math.abs(fa), Math.abs(fb)), best = initial;
            var point = null;
            for (var i = 0; i < 9; i++) {
                var t = Math.max(.1, Math.min(.9, (fa / 2) / (fa / 2 - fb / 2)));
                var p = [lo[0] + t * (hi[0] - lo[0]), lo[1] + t * (hi[1] - lo[1])], v = value(p[0], p[1]);
                if (!isFinite(v)) break;
                if (Math.abs(v) < best) { best = Math.abs(v); point = p; }
                if (v === 0) { point = p; best = 0; break; }
                if ((v < 0) === (fa < 0)) { lo = p; fa = v; } else { hi = p; fb = v; }
                if (best < initial * .001 && Math.hypot(hi[0] - lo[0], hi[1] - lo[1]) < .15) break;
            }
            if (point && best < initial * .1) result = point;
        }
        if (key !== undefined) roots[key] = result;
        return result;
    }
    function emit(a, b) {
        if (!a || !b || (a[0] === b[0] && a[1] === b[1])) return;
        segments.push([a[0], a[1], b[0], b[1]]);
    }
    function shade(points, values) {
        if (!values.every(isFinite)) return;
        var polygon = [];
        for (var k = 0; k < points.length; k++) {
            var next = (k + 1) % points.length;
            if (inside(values[k])) polygon.push(points[k][0], points[k][1]);
            if (inside(values[k]) !== inside(values[next])) {
                var hit = root(points[k], points[next], values[k], values[next]);
                if (!hit) return;
                polygon.push(hit[0], hit[1]);
            }
        }
        if (polygon.length >= 6) fills.push(polygon);
    }
    function walk(x, y, w, h, v, depth, keys) {
        if (limited) return;
        var center = value(x + w / 2, y + h / 2), finite = v.every(isFinite);
        if (inequality && finite && center === 0 && v.every(function (n) { return n === 0; })) {
            if (inside(0)) fills.push([x,y,x+w,y,x+w,y+h,x,y+h]);
            return;
        }
        var same = finite && v.every(function (n) { return (n < 0) === (v[0] < 0); });
        var near = finite && Math.abs(center) < Math.min.apply(null, v.map(Math.abs)) * .1;
        if (depth < 2 && finite && isFinite(center) && same && ((center < 0) !== (v[0] < 0) || center === 0 || near)) {
            var t = value(x + w / 2, y), r = value(x + w, y + h / 2), b = value(x + w / 2, y + h), l = value(x, y + h / 2);
            walk(x, y, w/2, h/2, [v[0],t,center,l], depth+1);
            walk(x+w/2, y, w/2, h/2, [t,v[1],r,center], depth+1);
            walk(x+w/2, y+h/2, w/2, h/2, [center,r,v[2],b], depth+1);
            walk(x, y+h/2, w/2, h/2, [l,center,b,v[3]], depth+1);
            return;
        }
        var corners = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]], hits = [];
        if (inequality && finite && isFinite(center)) {
            if (v.every(inside) && inside(center)) fills.push([x,y,x+w,y,x+w,y+h,x,y+h]);
            else for (var side = 0; side < 4; side++)
                shade([corners[side],corners[(side+1)%4],[x+w/2,y+h/2]], [v[side],v[(side+1)%4],center]);
        }
        for (var edge = 0; edge < 4; edge++) {
            var next = (edge+1)%4;
            if (v[edge] === 0 && v[next] === 0) emit(corners[edge],corners[next]);
            else if ((v[edge] < 0) !== (v[next] < 0) || v[edge] === 0 || v[next] === 0) {
                var hit = root(corners[edge],corners[next],v[edge],v[next],keys ? keys[edge] : undefined);
                if (hit && !hits.some(function (p) { return p[0] === hit[0] && p[1] === hit[1]; })) hits.push(hit);
            }
        }
        if (hits.length === 2) emit(hits[0],hits[1]);
        else if (hits.length === 4) {
            if ((center < 0) === (v[0] < 0)) { emit(hits[0],hits[1]); emit(hits[2],hits[3]); }
            else { emit(hits[0],hits[3]); emit(hits[1],hits[2]); }
        }
    }
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
        var at = j * (nx + 1) + i;
        walk(i*dx, j*dy, dx, dy, [vertices[at],vertices[at+1],vertices[at+nx+2],vertices[at+nx+1]], 0,
            ["h"+at,"v"+(at+1),"h"+(at+nx+1),"v"+at]);
    }
    return {segments: segments, fills: fills, calls: calls, truncated: limited, denseColumns: 0};
}

// Retain several curves so recoloring or hiding one does not resample the rest.
// The entry and segment caps bound memory even with a long list of equations.
var curveCache = [];
function curve(model, width, height) {
    for (var i = 0; i < curveCache.length; i++) {
        var cached = curveCache[i];
        if (cached.expression !== (model.expression.cacheKey || model.expression.source) || !sameBounds(cached, model)
                || cached.width < width || cached.height < height) continue;
        curveCache.splice(i, 1); curveCache.push(cached);
        return {segments: cached.plot.segments, fills: cached.plot.fills || [], xScale: width / cached.width, yScale: height / cached.height, calls: 0,
                truncated: cached.plot.truncated, denseColumns: cached.plot.denseColumns};
    }
    var plot = sample(model, width, height);
    var entry = bounds(model);
    entry.expression = model.expression.cacheKey || model.expression.source;
    entry.width = width; entry.height = height; entry.plot = plot;
    curveCache.push(entry);
    function size(item) { return item.plot.segments.length + (item.plot.fills || []).length; }
    var segments = curveCache.reduce(function (sum, item) { return sum + size(item); }, 0);
    while (curveCache.length > 16 || (segments > 40000 && curveCache.length > 1)) segments -= size(curveCache.shift());
    return {segments: plot.segments, fills: plot.fills || [], xScale: 1, yScale: 1, calls: plot.calls,
            truncated: plot.truncated, denseColumns: plot.denseColumns};
}

function draw(ctx, width, height, model, options) {
    var style = plotOptions(options);
    var series = model.graphs || [{expression: model.expression, color: "black", number: 1}];
    var scale = drawingScale(width, height, style), area = frame(width, height, style, model), left = area.left, top = area.top;
    var w = area.width, h = area.height;
    var xMap = axisMap(model.xmin, model.xmax, model.logX), yMap = axisMap(model.ymin, model.ymax, model.logY);
    function px(x) { return left + xMap.position(x) * w; }
    function py(y) { return top + (1 - yMap.position(y)) * h; }
    function line(x0, y0, x1, y1, color, thickness) {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    // Clear the alpha channel as well as old strokes when switching styles.
    ctx.clearRect(0, 0, width, height);
    if (!style.transparent) { ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height); }
    ctx.fillStyle = "black"; ctx.font = Math.round(29 * scale) + "px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    if (style.equation) series.forEach(function (entry, index) {
        var layout = legendLayout(width, height, style, series.length), cell = w / layout.columns;
        var x = left + index % layout.columns * cell, y = (42 + Math.floor(index / layout.columns) * 36) * scale;
        var title = entry.expression.title || "y = " + entry.expression.source.replace(/^y\s*=\s*/i, "");
        if (title.length > 62) title = title.slice(0, 59) + "...";
        var heading = title, inset = series.length > 1 ? 34 * scale : 0;
        if (ctx.measureText) while (heading.length > 6 && ctx.measureText(heading).width > cell - inset - 12 * scale) heading = heading.slice(0, -4) + "...";
        ctx.fillStyle = entry.color;
        if (inset) line(x, y, x + 22 * scale, y, entry.color, 4 * scale);
        ctx.fillText(heading, x + inset, y);
    });
    ctx.font = Math.round(23 * scale) + "px sans-serif";
    var target = Math.max(2, 6 / style.scale), sharedStep;
    var unitsX = (model.xmax - model.xmin) / w, unitsY = (model.ymax - model.ymin) / h;
    // Equal unit scales also need equal tick intervals, or the visible cells
    // can still be rectangular when each axis rounds its own tick spacing.
    if (!model.logX && !model.logY && Math.abs(unitsX / unitsY - 1) < 1e-8)
        sharedStep = Math.min(tickStep(model.xmin, model.xmax, target), tickStep(model.ymin, model.ymax, target));
    var result = {calls: 0, truncated: false, denseColumns: 0, warnings: []}, prepared = [];
    series.forEach(function (entry) {
        var plot;
        try { plot = curve(viewModel(entry.expression, model), w, h); }
        catch (error) {
            if (error.message.indexOf("no real values") < 0) throw error;
            result.warnings.push((entry.name || "Graph " + entry.number) + " has no real values in this range.");
            return;
        }
        prepared.push({entry: entry, plot: plot});
        result.calls += plot.calls; result.truncated = result.truncated || plot.truncated;
        result.denseColumns += plot.denseColumns;
        if (!plot.fills.length) return;
        ctx.save(); ctx.beginPath(); ctx.rect(left, top, w, h); ctx.clip();
        ctx.globalAlpha = .18; ctx.fillStyle = entry.color; ctx.beginPath();
        plot.fills.forEach(function (polygon) {
            ctx.moveTo(left + polygon[0] * plot.xScale, top + polygon[1] * plot.yScale);
            for (var i = 2; i < polygon.length; i += 2) ctx.lineTo(left + polygon[i] * plot.xScale, top + polygon[i+1] * plot.yScale);
            ctx.closePath();
        });
        ctx.fill(); ctx.restore();
    });
    var xTicks = model.logX ? logTicks(model.xmin, model.xmax, target) : {major: ticks(model.xmin, model.xmax, target, sharedStep), minor: []};
    var yTicks = model.logY ? logTicks(model.ymin, model.ymax, target) : {major: ticks(model.ymin, model.ymax, target, sharedStep), minor: []};
    if (style.grid) {
        xTicks.minor.forEach(function (x) {
            if (Math.log(10 / 9) / Math.log(model.xmax / model.xmin) * w >= 5 * scale)
                line(px(x), top, px(x), top + h, "#eeeeee", .7 * scale);
        });
        yTicks.minor.forEach(function (y) {
            if (Math.log(10 / 9) / Math.log(model.ymax / model.ymin) * h >= 5 * scale)
                line(left, py(y), left + w, py(y), "#eeeeee", .7 * scale);
        });
    }
    xTicks.major.forEach(function (x) {
        var p = px(x);
        if (style.grid) line(p, top, p, top + h, "#dddddd", scale);
        if (style.xNumbers) {
            ctx.fillStyle = "black"; ctx.textAlign = "center"; ctx.fillText(format(x), p, top + h + 28 * scale);
        }
    });
    yTicks.major.forEach(function (y) {
        var p = py(y);
        if (style.grid) line(left, p, left + w, p, "#dddddd", scale);
        if (style.yNumbers) {
            ctx.fillStyle = "black"; ctx.textAlign = "right"; ctx.fillText(format(y), left - 14 * scale, p);
        }
    });
    if (style.border) { ctx.strokeStyle = "#888888"; ctx.lineWidth = scale; ctx.strokeRect(left, top, w, h); }
    var axes = axisPositions(model);
    if (style.yAxis && isFinite(axes.y)) line(left + axes.y * w, top, left + axes.y * w, top + h, "#555555", 2 * scale);
    if (style.xAxis && isFinite(axes.x)) line(left, top + axes.x * h, left + w, top + axes.x * h, "#555555", 2 * scale);
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, w, h); ctx.clip();
    prepared.forEach(function (item) {
        var entry = item.entry, plot = item.plot;
        var strict = entry.expression.inequality === "<" || entry.expression.inequality === ">";
        ctx.beginPath(); ctx.strokeStyle = entry.color; ctx.lineWidth = 3.2 * scale;
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        var lastX = NaN, lastY = NaN;
        plot.segments.forEach(function (s) {
            if (strict) {
                var x0 = s[0] * plot.xScale, y0 = s[1] * plot.yScale;
                var dx = (s[2]-s[0]) * plot.xScale, dy = (s[3]-s[1]) * plot.yScale;
                var horizontal = Math.abs(dx) >= Math.abs(dy), start = horizontal ? x0 : y0, delta = horizontal ? dx : dy;
                if (Math.abs(delta) < 1e-9) return;
                var low = Math.min(start, start+delta), high = Math.max(start, start+delta), period = 14 * scale;
                for (var dash = Math.floor(low / period); dash * period < high; dash++) {
                    var a = Math.max(low, dash * period), b = Math.min(high, (dash+.55) * period);
                    if (a >= b) continue;
                    var t0 = (a-start)/delta, t1 = (b-start)/delta;
                    ctx.moveTo(left+x0+dx*t0, top+y0+dy*t0); ctx.lineTo(left+x0+dx*t1, top+y0+dy*t1);
                }
                return;
            }
            if (s[0] !== lastX || s[1] !== lastY) ctx.moveTo(left + s[0] * plot.xScale, top + s[1] * plot.yScale);
            ctx.lineTo(left + s[2] * plot.xScale, top + s[3] * plot.yScale);
            lastX = s[2]; lastY = s[3];
        });
        ctx.stroke();
    });
    ctx.restore();
    if (series.length && !prepared.length) throw new Error("The equation has no real values in this x range.");
    ctx.fillStyle = "black";
    if (style.axisLabels && style.xAxis) { ctx.textAlign = "right"; ctx.fillText("x", left + w, height - 22 * scale); }
    if (style.axisLabels && style.yAxis) { ctx.textAlign = "left"; ctx.fillText("y", 25 * scale, top - 28 * scale); }
    return result;
}

if (typeof module !== "undefined") module.exports = {compile: compile, constant: constant, validate: validate, sample: sample, draw: draw, ticks: ticks, format: format,
    backspaceStart: backspaceStart, deletionRange: deletionRange, normalizePi: normalizePi, normalizeInput: normalizeInput, hueColor: hueColor, graphModel: graphModel, describeEntry: describeEntry, reframe: reframe,
    bounds: bounds, sameBounds: sameBounds, validateBounds: validateBounds,
    viewModel: viewModel, panView: panView, zoomView: zoomView, zoomAxisAt: zoomAxisAt, snapView: snapView, squareView: squareView, frame: frame, plotOptions: plotOptions,
    axisMap: axisMap, logTicks: logTicks, setAxisLog: setAxisLog, aspectRatios: aspectRatios,
    outputOptions: outputOptions, outputSize: outputSize, previewSize: previewSize};
