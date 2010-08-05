require.paths.unshift(__dirname+"/../RequestRouter");
var sys=require("sys");
var http=require("http");
var fs=require("fs");
var RequestRouter=require("RequestRouter");
var ws=require("./server/transports/websocket");

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
		'index.js': {callback: fileReader("index.js","text/javascript")}
	}
};

var upgradeRoot={
	children: {
		'connectHere': {callback: processUpgrade}
	}
};

var wss=ws.createServer();
function processUpgrade() {
	return wss.handleRequest.apply(wss,Array.prototype.slice.call(arguments));
}

wss.on("request",function(req,res) {
	if (req.url!="/connectHere") {
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
		setTimeout(function() {
			sys.puts("Sending 'Hello world'");
			res.write("Hello world\uFFFF","utf8");
		},200);
		res.on("data",function(data) {
			sys.puts("DataLen: "+data.length);
			data=data.toString("utf8");
			sys.puts("Data: '"+data.substr(0,data.length-1)+"' "+data.charCodeAt(data.length-1).toString(16));
			if (data[0]==="M") {
				res.write("Mecho: "+data.substr(0,data.length-1),"utf8");
			}
		});
	});
});

var server=http.createServer(RequestRouter.createRequestHandler(httpRoot));
server.on("upgrade",RequestRouter.createUpgradeHandler(upgradeRoot));
server.listen(8080);