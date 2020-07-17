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

var app = express()
app.use(favicon(path.join(__dirname, 'public', 'images', 'favicon.ico')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(compression());

app.use(express.json());
app.use(express.urlencoded());

app.use('/static',
    express.static(__dirname + '/public')
);

app.get('/', async(req, res) => {
    await resolvePage('index', req, res);
})

https.createServer({
    key: fs.readFileSync('./keys/key.pem'),
    cert: fs.readFileSync('./keys/certificate.pem')
}, app).listen(443);
app.listen(80);
console.log("[MAIN_SERVER] Server listening on port 443 & 80-");

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

async function dynamic(indexHTML, name, req, res) {
    var dom = await new jsdom.JSDOM(indexHTML);
    var $ = jquery(dom.window);

    return dom;
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