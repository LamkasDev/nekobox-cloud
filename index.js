var path = require('path');
var express = require('express')
var bodyParser = require('body-parser');
var jsdom = require('jsdom');
var jquery = require('jquery');
var fs = require('fs');
var https = require('https');
var http = require('http');
var favicon = require('serve-favicon');
var compression = require('compression');
var cookieParser = require('cookie-parser');
var bcrypt = require('bcrypt');
var sql = require('mysql2');
var crypto = require("crypto");
var getSize = require('get-folder-size');
var formidable = require('formidable');
var fs = require('fs-extra');
var cookie = require("cookie");

var app = express()
app.use(favicon(path.join(__dirname, 'public', 'images', 'favicon.ico')));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(compression());

app.use(express.json());
app.use(express.urlencoded());

var path1 = process.cwd() + "/data/config_persistent.txt";
var globalPersistentConfigData = fs.readFileSync(path1);
var globalPersistentConfig = JSON.parse(globalPersistentConfigData);

var sqlConn = sql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "nekobox_cloud",
    charset: 'utf8mb4'
});

sqlConn.connect(function(err) {
if (err) { throw err; }
    console.log("Connected to SQL-");
});

var sessions = new Map();
var sessionSockets = new Map();

app.use('/static',
    express.static(__dirname + '/public')
);

app.get('/', async(req, res) => {
    await resolvePage('index', req, res);
})

app.get('/register', async(req, res) => {
    await resolvePage('register', req, res);
})

app.get('/login', async(req, res) => {
    await resolvePage('login', req, res);
})

app.get('/drive', async(req, res) => {
    await resolvePage('drive', req, res);
})

app.get('/logout', async(req, res) => {
    if(req.cookies['sessionID'] !== undefined) {
        res.clearCookie('sessionID');
        res.clearCookie('sessionName');

        if(sessions.has(req.cookies['sessionID'])) {
            sessions.delete(req.cookies['sessionID']);
        }
    }

    res.redirect('/');
})

app.post('/delete', async(req, res) => {
    if(req.cookies['sessionID'] === undefined || !sessions.has(req.cookies['sessionID'])) {
        console.log("invalid session")
        res.setHeader('Content-Type', 'application/json');
        var data = {
            status: -1
        }
        res.end(JSON.stringify(data));
        return;
    }

    var user = sessions.get(req.cookies['sessionID']);
    if (!fs.existsSync(user.drivePath + req.body.file)) {
        console.log("invalid path - " + user.drivePath + req.body.file)
        res.setHeader('Content-Type', 'application/json');
        var data = {
            status: -1
        }
        res.end(JSON.stringify(data));
        return;
    }

    fs.unlinkSync(user.drivePath + req.body.file);
    res.setHeader('Content-Type', 'application/json');
    var data = {
        status: 1
    }
    res.end(JSON.stringify(data));
})

app.get('/download', async(req, res) => {
    if(req.cookies['sessionID'] === undefined || !sessions.has(req.cookies['sessionID'])) {
        console.log("invalid session")
        res.setHeader('Content-Type', 'application/json');
        var data = {
            status: -1
        }
        res.end(JSON.stringify(data));
        return;
    }

    var user = sessions.get(req.cookies['sessionID']);
    if (!fs.existsSync(user.drivePath + req.query.file)) {
        console.log("invalid path - " + user.drivePath + req.query.file)
        res.setHeader('Content-Type', 'application/json');
        var data = {
            status: -1
        }
        res.end(JSON.stringify(data));
        return;
    }

    res.download(user.drivePath + req.query.file);
})

app.post('/upload', async(req, res) => {
    if(req.cookies['sessionID'] === undefined || !sessions.has(req.cookies['sessionID']) || !sessionSockets.has(req.cookies['sessionID']) ) {
        console.log("invalid session")
        res.setHeader('Content-Type', 'application/json');
        var data = {
            status: -1
        }
        res.end(JSON.stringify(data));
        return;
    }

    var socket = sessionSockets.get(req.cookies['sessionID']);
    var user = sessions.get(req.cookies['sessionID']);

    var form = formidable({ multiples: true });
    form.uploadDir = user.drivePath;
    form.keepExtensions = true;

    var sentStartPacket = false;
    var fileName = req.query.fileName;
    var fileID = crypto.randomBytes(16).toString("hex");

    form.on('progress', function(bytesReceived, bytesExpected) {
        if(!sentStartPacket) {
            sentStartPacket = true;
            socket.emit("fileStart", fileID, fileName);
        }

        socket.emit("progress", fileID, fileName, bytesReceived, bytesExpected);

        if(bytesReceived >= bytesExpected) {
            socket.emit("fileFinish", fileID, fileName);
        }
    });

    form.parse(req, function(err, fields, files) {
        console.log("file path: " + JSON.stringify(files.fileUploaded.path));

        fs.rename(files.fileUploaded.path, user.drivePath + "/" + files.fileUploaded.name, function(err) {
            if (err) {
                throw err;
            }

            console.log('renamed complete');  
        });
        
        res.end();
    });
})

app.post('/auth-register', async(req, res) => {
    if(req.body.username === undefined || req.body.email === undefined || req.body.password === undefined) {
        console.log("invalid login");
        return;
    }

    //Register rules
    if(req.body.username.length < 3) {
        res.setHeader('Content-Type', 'application/json');
        var data = {
            status: -2
        }
        res.end(JSON.stringify(data));
        return;
    }

    if(req.body.password.length < 5) {
        res.setHeader('Content-Type', 'application/json');
        var data = {
            status: -3
        }
        res.end(JSON.stringify(data));
        return;
    }

    if(!req.body.email.includes("@")) {
        res.setHeader('Content-Type', 'application/json');
        var data = {
            status: -4
        }
        res.end(JSON.stringify(data));
        return;
    }

    //
    var query = "SELECT * FROM users WHERE username='" + req.body.username + "'";
    var query2 = "SELECT * FROM users WHERE email='" + req.body.email + "'";

    sqlConn.query(query, (err, result) => {
        if(err) { throw err; }
        if(result.length < 1) { return; }

        if(!res.finished) {
            res.setHeader('Content-Type', 'application/json');
            var data = {
                status: -1
            }
            res.end(JSON.stringify(data));
        }
    });

    sqlConn.query(query2, (err, result) => {
        if(err) { throw err; }
        if(result.length < 1) { return; }

        if(!res.finished) {
            res.setHeader('Content-Type', 'application/json');
            var data = {
                status: 0
            }
            res.end(JSON.stringify(data));
        }
    });

    bcrypt.genSalt(10, function(err, salt) {
        bcrypt.hash(req.body.password, salt, (err, cryptedPassword) => {
            console.log("received register -" + req.body.username + "." + req.body.email + "." + cryptedPassword);
            var id = crypto.randomBytes(16).toString("hex");
            fs.mkdirSync("E://nekobox//" + id);

            var query3 = "INSERT IGNORE INTO users (id, username, email, password, drivePath) VALUES('" + id + "', '" + req.body.username + "', '" + req.body.email + "','" + cryptedPassword + "', 'E://nekobox//" + id + "')";
            sqlConn.query(query3, (err, result) => {
                if(err) { throw err; }
        
                if(!res.finished) {
                    res.setHeader('Content-Type', 'application/json');
                    var session = crypto.randomBytes(16).toString("hex");
                    var data = {
                        status: 1
                    }
                    sessions.set(session, result[0]);
                    res.cookie("sessionID", session);
                    res.cookie("sessionUsername", req.body.username);
                    res.end(JSON.stringify(data));
                }
            });
        })
    });
})

app.post('/auth-login', async(req, res) => {
    if(req.body.username === undefined || req.body.password === undefined) {
        console.log("invalid login");
        return;
    }

    var query = "SELECT * FROM users WHERE username='" + req.body.username + "'";

    sqlConn.query(query, (err, result) => {
        if(err) { throw err; }
        if(result.length < 1) { 
            res.setHeader('Content-Type', 'application/json');
            var data = {
                status: -1
            }
            res.end(JSON.stringify(data));
            return;
        }

        bcrypt.compare(req.body.password, result[0].password.toString(), function(err, same) {
            if(same === true) {
                res.setHeader('Content-Type', 'application/json');
                var session = crypto.randomBytes(16).toString("hex");
                var data = {
                    status: 1
                }
                sessions.set(session, result[0]);
                res.cookie("sessionID", session);
                res.cookie("sessionUsername", req.body.username);
                res.end(JSON.stringify(data));
            } else {
                res.setHeader('Content-Type', 'application/json');
                var data = {
                    status: 0
                }
                res.end(JSON.stringify(data));
            }
        })
    });
})

var server = https.createServer({
    key: fs.readFileSync('./keys/key.pem'),
    cert: fs.readFileSync('./keys/certificate.pem')
}, app).listen(443);
app.listen(80);
console.log("[MAIN_SERVER] Server listening on port 443 & 80-");

const io = require('socket.io')(server);
io.on('connect', socket => {
    var cookies = cookie.parse(socket.handshake.headers.cookie);
    if(cookies['sessionID'] === undefined || !sessions.has(cookies['sessionID'])) {
        console.log("invalid socket.io session");
        return;
    }

    sessionSockets.set(cookies['sessionID'], socket);
    console.log("new socket.io session");
});

async function resolvePage(name, req, res) {
    if(!req.secure) { return res.redirect(['https://', req.get('Host'), req.url].join('')); }

    var indexHTML = await readFile(path.join(__dirname + '/public/pages/' + name + '.html'));
    var dom = await dynamic(indexHTML, name, req, res);

    if(typeof dom === undefined) {
        res.status(501);
        res.end();
        return;
    }

    fs.writeFile('temp/' + name + '.html', dom.serialize(), err => {
        res.sendFile(path.join(__dirname + '/temp/' + name + '.html'));
    });
}

async function loadHTML() {
    global.folderHTML = await readFile(path.join(__dirname + '/public/templates/folder.html'));
}

async function dynamic(indexHTML, name, req, res) {
    var dom = await new jsdom.JSDOM(indexHTML);
    var $ = jquery(dom.window);
    await loadHTML();

    switch(name) {
        case "index":
            if(req.cookies['sessionID'] !== undefined) {
                $('#loginSection').html('');
            } else {
                $('#accountSection').html('');
            }
            return dom;

        case "drive":
            if(req.cookies['sessionID'] === undefined || !sessions.has(req.cookies['sessionID'])) {
                $('#driveSection').html('');
                return dom;
            }
            var user = sessions.get(req.cookies['sessionID']);
            var gbs = user.driveSpace / 1073741824;

            return await new Promise(resolve => {
                getSize(user.drivePath, (err, total) => {
                    var gbs2 = total / 1073741824;
                    var percent = gbs2 / gbs * 100;

                    $('#driveUsed0').text("drive usage (" + percent.toFixed(2) + "%)");
                    $('#driveUsed').text(gbs2.toFixed(2) + "/" + gbs.toFixed(2) + " GBs");
                    $('#driveSpace').attr("value", percent);
                    $('#invalidSection').html('');

                    var foldersHTML = getStructure(user, '');
                    $('#folders').html(foldersHTML);
                    resolve(dom);
                });
            });

        default:
            return dom;
    }
}

function getStructure(user, additionalPath) {
    var foldersHTML = "";
    fs.readdirSync(user.drivePath + additionalPath).forEach(folder => {
        var html = folderHTML;
        var html2 = "";

        var extension = folder.substring(folder.lastIndexOf(".") + 1);
        var count = additionalPath.split("/").length - 1;
        var a = "";
        for(var i = 0; i < count; i += 1) {
            a += "📁";
        }
        
        var id = crypto.randomBytes(16).toString("hex");
        if(!folder.includes(".")) {
            html = html.split("/folderName/").join('<div class="empty">' + a + "</div>📁 " + folder);
            html = html.split("/folderName1/").join(additionalPath + "/" + folder);
            html = html.split("/id/").join(id);
            html2 = getStructure(user, additionalPath + "/" + folder);
        } else {
            var icon = "❓";

            switch(extension.toLowerCase()) {
                case "rar":
                case "zip":
                    icon = "🗄️";
                    break;

                case "md":
                case "txt":
                    icon = "📄";
                    break;
    
                case "wav":
                case "mp3":
                    icon = "🎵";
                    break;

                case "mov":
                case "gif":
                case "mp4":
                    icon = "🎞️";
                    break;
    
                case "exe":
                    icon = "⚙️";
                    break;

                case "jfif":
                case "webp":
                case "jpg":
                case "jpeg":
                case "png":
                    icon = "🖼️";
                    break;
            }

            var folderName = folder.substring(0, 64);
            if(folder.length > 64) {
                folderName += "...";
            }

            var session = crypto.randomBytes(16).toString("hex");
            html = html.split("/folderName/").join('<div class="empty">' + a + "</div> " + icon + " " + folderName);
            html = html.split("/folderName1/").join(additionalPath + "/" + folder);
            html = html.split("/id/").join(id);
        }

        foldersHTML += html;
        foldersHTML += html2;
    });

    return foldersHTML;
}

async function readFile(path) {
    return new Promise((resolve, reject) => {
      fs.readFile(path, 'utf8', function (err, data) {
        if (err) {
          reject(err);
        }
        resolve(data);
      });
    });
}