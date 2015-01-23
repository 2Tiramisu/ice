// **********************************************************************
//
// Copyright (c) 2003-2015 ZeroC, Inc. All rights reserved.
//
// This copy of Ice is licensed to you under the terms described in the
// ICE_LICENSE file included in this distribution.
//
// **********************************************************************

var gutil = require("gulp-util");
var PluginError = gutil.PluginError;
var PLUGIN_NAME = "gulp-slice2js-bundle";
var through = require("through2");
var fs = require("fs");
var path = require("path");

function rmfile(path)
{
    try
    {
        fs.unlinkSync(path);
    }
    catch(e)
    {
    }
}

function mkdir(path)
{
    try
    {
        fs.mkdirSync(path);
    }
    catch(e)
    {
        if(e.code != "EEXIST")
        {
            throw e;
        }
    }
}

function isnewer(input, output)
{
    return fs.statSync(input).mtime.getTime() > fs.statSync(output).mtime.getTime();
}

function isfile(path)
{
    try
    {
        return fs.statSync(path).isFile();
    }
    catch(e)
    {
        if(e.code == "ENOENT")
        {
            return false;
        }
        throw e;
    }
    return false;
}

var esprima = require('esprima');

var Depends = function()
{
    this.depends = [];
};

Depends.prototype.get = function(file)
{
    for(var i = 0; i < this.depends.length; ++i)
    {
        var obj = this.depends[i];
        if(obj.file.path === file)
        {
            return obj.depends;
        }
    }
    return [];
};

Depends.prototype.expand = function(o)
{
    if(o === undefined)
    {
        for(var i = 0; i < this.depends.length; ++i)
        {
            this.expand(this.depends[i]);
        }
    }
    else
    {
        var newDepends = o.depends.slice();
        for(var j = 0; j < o.depends.length; ++j)
        {
            var depends = this.get(o.depends[j]);
            for(var k = 0; k < depends.length; ++k)
            {
                if(newDepends.indexOf(depends[k]) === -1)
                {
                    newDepends.push(depends[k]);
                }
            }
        }

        if(o.depends.length != newDepends.length)
        {

            o.depends = newDepends;
            this.expand(o);
        }
    }
    return this;
};

Depends.comparator = function(a, b)
{
    // B depends on A
    var i;
    var result = 0;

    for(i = 0; i < b.depends.length; ++i)
    {
        if(b.depends[i] === a.file.path)
        {
            result = -1;
        }
    }
    // A depends on B
    for(i = 0; i < a.depends.length; ++i)
    {
        if(a.depends[i] === b.file.path)
        {
            if(result == -1)
            {
                process.stderr.write("warning: circulary dependency between: " + a.file.path + " and " + b.file.path + "\n");
                return result;
            }
            result = 1;
        }
    }

    return result;
};

Depends.prototype.sort = function()
{
    var objects = this.depends.slice();
    for(var i = 0; i < objects.length; ++i)
    {
        for(var j = 0; j < objects.length; ++j)
        {
            if(j === i) { continue; }
            var v = Depends.comparator(objects[i], objects[j]);
            if(v < 0)
            {
                var tmp = objects[j];
                objects[j] = objects[i];
                objects[i] = tmp;
            }
        }
    }
    return objects;
};

var Parser = {};

Parser.add = function(depend, file, srcDir)
{
    if(file.indexOf("../Ice/") === 0 ||
       file.indexOf("../IceGrid/")  === 0 ||
       file.indexOf("../IceStorm/") === 0 ||
       file.indexOf("../Glacier2/") === 0)
    {
        file = isfile(path.join(srcDir, path.dirname(file), "browser", path.basename(file))) ?
            path.resolve(path.join(srcDir, path.dirname(file), "browser", path.basename(file))) :
            path.resolve(path.join(srcDir, file));

        if(depend.depends.indexOf(file) === -1)
        {
            depend.depends.push(file);
        }
    }
};

Parser.transverse = function(object, depend, srcDir)
{
    function appendfile(arg)
    {
        Parser.add(depend, arg.value + ".js", srcDir);
    }

    for(var key in object)
    {
        var value = object[key];
        if(value !== null && typeof value == "object")
        {
            Parser.transverse(value, depend, srcDir);

            if(value.type === "CallExpression")
            {
                if(value.callee.name === "require")
                {
                    Parser.add(depend, value.arguments[0].value + ".js", srcDir);
                }
                else if(value.callee.type == "MemberExpression" &&
                        value.callee.property.name == "require" &&
                        (value.callee.object.name == "__M" ||
                        (value.callee.object.property && value.callee.object.property.name == "__M")))
                {
                    value.arguments[1].elements.forEach(appendfile);
                }
            }
        }
    }
};

var StringBuffer = function()
{
    this.buffer = new Buffer(0);
};

StringBuffer.prototype.write = function(data)
{
    this.buffer = Buffer.concat([this.buffer, new Buffer(data, "utf8")]);
};

function bundle(args)
{
    var files = [];
    var outputFile = null;

    return through.obj(
        function(file, enc, cb)
        {
            if(file.isNull())
            {
                return;
            }

            if(file.isStream())
            {
                return this.emit('error', new PluginError(PLUGIN_NAME, 'Streaming not supported'));
            }

            if(!outputFile)
            {
                outputFile = file;
            }

            files.push(file);
            cb();
        },
        function(cb)
        {
            if(!isfile(args.target) ||
               files.some(function(f){ return isnewer(f.path, args.target); }))
            {
                var d = new Depends();
                files.forEach(
                    function(file)
                    {
                        var depend = {file: file, depends:[]};
                        d.depends.push(depend);
                        Parser.transverse(esprima.parse(file.contents.toString()), depend, args.srcDir);
                    });

                d.depends = d.expand().sort();

                //
                // Wrap the library in a closure to hold the private __Slice module.
                //
                var preamble =
                    "(function()\n" +
                    "{\n";

                var epilogue =
                    "}());\n\n";

                //
                // Wrap contents of each file in a closure to keep local variables local.
                //
                var modulePreamble =
                    "\n" +
                    "    (function()\n" +
                    "    {\n";

                var moduleEpilogue =
                    "    }());\n";


                var sb = new StringBuffer();

                sb.write(preamble);

                args.modules.forEach(
                    function(m){
                        sb.write("    window." + m + " = window." + m + " || {};\n");
                        if(m == "Ice")
                        {
                            sb.write("    Ice.Slice = Ice.Slice || {};\n");
                        }
                    });
                sb.write("    var Slice = Ice.Slice;");

                for(var i = 0;  i < d.depends.length; ++i)
                {
                    sb.write(modulePreamble);
                    var data = d.depends[i].file.contents.toString();
                    var lines = data.toString().split("\n");

                    var skip = false;
                    var skipUntil;
                    var skipAuto = false;
                    var line;

                    for(var j in lines)
                    {
                        line = lines[j].trim();

                        if(line == "/* slice2js browser-bundle-skip */")
                        {
                            skipAuto = true;
                            continue;
                        }
                        if(line == "/* slice2js browser-bundle-skip-end */")
                        {
                            skipAuto = false;
                            continue;
                        }
                        else if(skipAuto)
                        {
                            continue;
                        }

                        //
                        // Get rid of require statements, the bundle include all required files,
                        // so require statements are not required.
                        //
                        if(line.match(/var .* require\(".*"\).*;/))
                        {
                            continue;
                        }
                        if(line.match(/__M\.require\(/))
                        {
                            if(line.lastIndexOf(";") === -1)
                            {
                                // skip until next semicolon
                                skip = true;
                                skipUntil = ";";
                            }
                            continue;
                        }


                        //
                        // Get rid of __M.module statements, in browser top level modules are
                        // global.
                        //
                        if(line.match(/var .* = __M.module\(/))
                        {
                            if(line.lastIndexOf(";") === -1)
                            {
                                // skip until next semicolon
                                skip = true;
                                skipUntil = ";";
                            }
                            continue;
                        }

                        if(skip)
                        {
                            if(line.lastIndexOf(skipUntil) !== -1)
                            {
                                skip = false;
                            }
                            continue;
                        }

                        var out = lines[j];
                        if(line.indexOf("module.exports.") === 0)
                        {
                            continue;
                        }
                        else if(line.indexOf("exports.") === 0)
                        {
                            continue;
                        }
                        else if(line.indexOf("exports =") === 0)
                        {
                            continue;
                        }

                        if(line.indexOf("__M.type") !== -1)
                        {
                            out = out.replace(/__M\.type/g, "eval");
                        }

                        sb.write("        " + out + "\n");
                    }
                    sb.write(moduleEpilogue);
                }
                sb.write("\n");
                //
                // Now exports the modules to the global Window object.
                //
                args.modules.forEach(
                    function(m){
                        sb.write("    window." + m + " = " + m + ";\n");
                    });

                sb.write(epilogue);

                this.push(new gutil.File(
                    {
                        cwd: "",
                        base:"",
                        path:path.basename(args.target),
                        contents:sb.buffer
                    }));
            }
            cb();
        });
}

module.exports = bundle;