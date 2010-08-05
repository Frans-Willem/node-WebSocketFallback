var sys=require("sys");
var http=require("http");
var net=require("net");
var EventEmitter=require("events").EventEmitter;
var Buffer=require("buffer").Buffer;
var URL=require("url");
var querystring=require("querystring");
var IDProvider=require("IDProvider").IDProvider;

function EEBase() {}
EEBase.prototype=EventEmitter.prototype;

function XhrMultipartServer() {
	EventEmitter.call(this);
	this.idprovider=new IDProvider();
	this.sendHandlers={};
}
XhrMultipartServer.prototype=new EEBase();
var multipartSeperator="[}\"\"{]"; //Something that will *always* be invalid inside JSON data

function sendCodeResponse(res,code,message) {
	var msg=http.STATUS_CODES[code];
	var body="<html><head><title>"+code+": "+msg+"</title><head><body><h1>"+code+": "+msg+"</h1>"+(message?("<p>"+message+"</p>"):"")+"</body></html>";
	res.writeHead(code,{"Content-Type":"text/html","Content-Length":body.length});
	res.write(body);
	res.end();
}

XhrMultipartServer.prototype.handleRequest=function(request,response) {
	var qs=querystring.parse(URL.parse(request.url).query || ""),
		id,handler;
	switch (qs["xhrm_type"]) {
		case "connect":
			if (this.listeners("request").length<1) {
				return sendCodeResponse(response,404);
			} else {
				this.emit("request",new XhrMultipartSocketRequest(request,qs["xhrm_protocol"] || ""),new XhrMultipartSocketResponse(this,request,response));
			}
			break;
		case "send":
			id=parseInt(qs["xhrm_id"],10);
			handler=this.sendHandlers[id];
			if (typeof(handler)==="function") {
				return handler(request,response,qs);
			} else {
				return sendCodeResponse(response,500);
			}
			break;
		default:
			return sendCodeResponse(response,500);
			break;
	}
	//response.write("--abcdef\r\nContent-Type: text/plain\r\n\r\nMessage two\r\n--abcdef\r\n");
	//response.write("--abcdef\r\nContent-Type: text/plain\r\n\r\nMessage three\r\n--abcdef\r\n");
}

XhrMultipartServer.prototype.registerSendHandler=function(handler) {
	var id=this.idprovider.alloc();
	if (typeof(handler)!=="function")
		throw new Error("Invalid send handler");
	this.sendHandlers[id]=handler;
	return id;
}
XhrMultipartServer.prototype.revokeSendHandler=function(id) {
	id=parseInt(id,10);
	if (typeof(this.sendHandlers[id])!=="function")
		return;
	delete this.sendHandlers[id];
	this.idprovider.alloc(id);
}

/*
	sys.puts("Got connection!");
	var sep="";
	response.writeHead(200,{
		"Content-Type":"multipart/x-mixed-replace; boundary="+sep+"",
		"Connection":"close"
	});
	//response.chunkedEncoding=false;
	sys.puts(JSON.stringify(sep));
	var msg=1;
	response.write("--"+sep+"\r\n");
	var interval=setInterval(function() {
		sys.puts("Msg "+msg);
		response.write("Content-Type: text/plain\r\n\r\nMessage "+(msg++)+"--"+sep+"\r\nContent-Type: text/plain\r\n\r\n--"+sep+"\r\n");
	},2000);
	response.connection.on("end",function() {
		sys.puts("Response ended");
		clearInterval(interval);
	});
*/

function XhrMultipartSocketRequest(request,protocol) {
	this.method=request.method;
	this.url=request.url;
	this.headers=request.headers;
	this.httpVersion=request.httpVersion;
	this.connection=request.connection;
	this.protocol=protocol;
}


var responseTypes={
	none: 0,
	http: 1,
	socket: 2,
	closed: 3
};
function XhrMultipartSocketResponse(server,request,response) {
	var self=this;
	EventEmitter.call(this);
	this.type=responseTypes.none;
	this.response=response;
	this.request=request;
	this.server=server;
	
	this.remoteAddress=request.connection.remoteAddress;
}
XhrMultipartSocketResponse.prototype=new EEBase();

XhrMultipartSocketResponse.prototype.readyState="opening";
XhrMultipartSocketResponse.prototype.writeable=false;
XhrMultipartSocketResponse.prototype.readable=false;
XhrMultipartSocketResponse.prototype.writeHead=function(code,headers) {
	if (this.type!==responseTypes.none) {
		throw new Error("Response already started");
	}
	this.type=responseTypes.http;
	this.readyState="closed";

	this.response.writeHead.apply(this.response,Array.prototype.slice.call(arguments));
}

var messageTypes={
	probe: 0,
	welcome: 1,
	connected: 2,
	data: 3
};

XhrMultipartSocketResponse.prototype.accept=function(protocol,headers) {
	var self=this,
		id,secret,
		incoming="",
		open=true;
	if (this.type!==responseTypes.none) {
		throw new Error("Response already started");
	}
	this.type=responseTypes.socket;
	this.readyState="opening";
	secret=Math.floor(Math.random()*100000).toString(16);
	id=this.server.registerSendHandler(sendHandler);
	
	function sendHandler(request,response,query) {
		if (request.method!=="POST" || query["xhrm_secret"]!==secret) {
			sendCodeResponse(response,500);
		} else {
			request.on("data",onData);
			request.on("end",function() {
				response.writeHead(200,{"Content-Length":2});
				response.end("OK");
			});
		}
	}
	
	function onLine(line) {
		if (!open) {
			return;
		}
		sys.puts("Line: "+line);
		var obj;
		try {
			obj=JSON.parse(line);
		}
		catch(e) {
			return onError("Data: '"+line+"' "+line.length+" "+e.toString());
		}
		if (typeof(obj)!=="object") {
			return onError("Received JSON was not an object");
		}
		if (obj.t==messageTypes.probe && self.readyState=="opening") {
			open=true;
			onConnected();
		} else if (obj.t==messageTypes.data && self.readable) {
			if (Array.isArray(obj.c)) {
				obj.c.forEach(function(p) {
					if (typeof(p)=="string") {
						onPacket(p);
					}
				});
			} else onError("obj.c should be array");
		} else onError("Unexpected package");
	}
	
	function onPacket(p) {
		if (open) {
			self.emit("data",p);
		}
	}
	
	function parseData() {
		if (!open) {
			return;
		}
		var split,line;
		while (true) {
			split=incoming.indexOf("\n");
			if (split===-1)
				break;
			line=incoming.substr(0,split);
			incoming=incoming.substr(split+1);
			if (line.length>0) {
				onLine(line);
			}
		}
	}
	
	function onData(data) {
		if (!open) {
			return;
		}
		incoming+=data.toString("ascii");
		parseData();
	}
	
	function onEnd() {
		if (id!==undefined) {
			self.server.revokeSendHandler(id);
			id=undefined;
		}
		self.emit("end");
	}
	
	function onClose() {
		if (id!==undefined) {
			self.server.revokeSendHandler(id);
			id=undefined;
		}
		self.emit("close");
	}
	
	function onError(reason) {
		self.readable=false;
		self.writeable=false;
		self.readyState="open";
		sys.puts("Error: "+reason);
		//self.emit("error",reason);
	}
	
	function onConnected() {
		self.response.write("Content-Type: text/plain\r\n\r\n"+JSON.stringify({t:messageTypes.probe})+"\r\n\r\n--"+multipartSeperator+"\r\nContent-Type: text/plain\r\n\r\n--"+multipartSeperator+"\r\n");
		self.readyState="open";
		self.readable=true;
		self.writeable=true;
		self.emit("connect");
	}
	
	this.request.connection.on("end",onEnd);
	this.request.connection.on("close",onEnd);
	this.response.writeHead(200,{
		"Content-Type":"multipart/x-mixed-replace; boundary="+multipartSeperator+"",
		"Connection":"close"
	});
	this.response.write(
		"Content-Type: text/plain\r\n\r\n"+JSON.stringify({t:messageTypes.probe})+"\r\n\r\n--"+multipartSeperator+"\r\nContent-Type: text/plain\r\n\r\n--"+multipartSeperator+"\r\n"+
		"Content-Type: text/plain\r\n\r\n"+JSON.stringify({t:messageTypes.welcome,id:id,secret:secret,protocol:(protocol || "").toString()})+"\r\n\r\n--"+multipartSeperator+"\r\nContent-Type: text/plain\r\n\r\n--"+multipartSeperator+"\r\n"
	);
}
XhrMultipartSocketResponse.prototype.write=function() {
	switch (this.type) {
		case responseTypes.none:
			throw new Error("Call .accept or .writeHead first");
			break;
		case responseTypes.socket:{
			if (!this.writeable) {
				throw new Error("Not writeable. (wait for 'connect' event?)");
			}
			this.response.write("Content-Type: text/plain\r\n\r\n"+JSON.stringify({t:messageTypes.data,c:[arguments[0].toString(arguments[1])]})+"\r\n\r\n--"+multipartSeperator+"\r\nContent-Type: text/plain\r\n\r\n--"+multipartSeperator+"\r\n");
			break;
		}
		case responseTypes.http:
			return this.response.write.apply(this.response,Array.prototype.slice.call(arguments));
		case responseTypes.closed:
			throw new Error(".end or .destroy already called");
			break;
	}
}

exports.createServer=function() {
	return new XhrMultipartServer();
};