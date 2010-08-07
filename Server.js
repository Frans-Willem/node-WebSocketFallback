require.paths.unshift(__dirname+"/../RequestRouter");
require.paths.unshift(__dirname+"/../IPCNode");
var sys=require("sys");
var http=require("http");
var fs=require("fs");
var RequestRouter=require("RequestRouter");
var ws=require("./server/transports/websocket");
var xms=require("./server/transports/xhrmultipart");
var xls=require("./server/transports/xhrlongpoll");
var URL=require("url");
var querystring=require("querystring");

function sendCodeResponse(res,code,message) {
	var msg=http.STATUS_CODES[code];
	var body="<html><head><title>"+code+": "+msg+"</title><head><body><h1>"+code+": "+msg+"</h1>"+(message?("<p>"+message+"</p>"):"")+"</body></html>";
	res.writeHead(code,{"Content-Type":"text/html","Content-Length":body.length});
	res.write(body);
	res.end();
}

function fileReader(fname,mime) {
	return function(req,res,unparsed) {
		fs.readFile(fname,function(err,data) {
			if (err) {
				return RequestRouter.sendCodeResponse(res,500,err.toString());
			}
			res.writeHead(200,{"Content-Type":mime,"Content-Length":data.length});
			res.end(data);
		});
	};
}

var httpRoot={
	index: 'index.html',
	children: {
		'index.html': {callback: fileReader("index.html","text/html")},
		'index.js': {callback: fileReader("index.js","text/javascript")},
		'xhrmultipart.js': {callback: fileReader("client/transports/xhrmultipart.js","text/javascript")},
		'xhrlongpoll.js': {callback: fileReader("client/transports/xhrlongpoll.js","text/javascript")},
		'connectHere': {callback: processRequest}
	}
};

var upgradeRoot={
	children: {
		'connectHere': {callback: processUpgrade}
	}
};

var xmss=xms.createServer();
var xlss=xls.createServer();
var wss=ws.createServer();
function processUpgrade() {
	return wss.handleRequest.apply(wss,Array.prototype.slice.call(arguments));
}

function processRequest(request,response) {
	var q=querystring.parse(URL.parse(request.url).query || "");
	switch (q.fallback_transport) {
		case "xhrl": return xlss.handleRequest.apply(xlss,Array.prototype.slice.call(arguments));
		case "xhrm": return xmss.handleRequest.apply(xmss,Array.prototype.slice.call(arguments));
		default: {
			sys.puts("Unknown transport: "+q.fallback_transport+" "+URL.parse(request.url).query);
			return sendCodeResponse(response,500);
		}
	}
}

function socketRequestHandler(req,res) {
	if (URL.parse(req.url).pathname!="/connectHere") {
		var msg=http.STATUS_CODES[404] || "unknown";
		//After a writeHead, a WebSocketResponse will act as a http.ServerResponse
		res.writeHead(404,{"Content-Type":"text/plain","Content-Length":msg.length});
		res.end(msg);
		return;
	}
	//After an accept, a WebSocketResponse will act as a net.Stream
	//Arguments: protocol, headers
	sys.puts("Accepting");
	res.accept("sample",{});
	res.on("connect",function() {
		sys.puts("Connected");
		//setTimeout(function() {
			sys.puts("Sending 'Hello world'");
			res.write("Hello world\uFFFF","utf8");
		//},200);
		res.on("data",function(data) {
			data=data.toString("utf8");
			sys.puts("Data: '"+data.substr(0,data.length-1)+"' "+data.charCodeAt(data.length-1).toString(16));
			if (data[0]==="M") {
				res.write("Mecho: "+data.substr(0,data.length-1),"utf8");
			}
		});
	});
}

wss.on("request",socketRequestHandler);
xmss.on("request",socketRequestHandler);
xlss.on("request",socketRequestHandler);

var server=http.createServer(RequestRouter.createRequestHandler(httpRoot));
server.on("upgrade",RequestRouter.createUpgradeHandler(upgradeRoot));
server.listen(8080);