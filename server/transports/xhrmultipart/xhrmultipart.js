var sys=require("sys");
var http=require("http");
var net=require("net");
var EventEmitter=require("events").EventEmitter;
var Buffer=require("buffer").Buffer;
var URL=require("url");
var querystring=require("querystring");
var IDProvider=require("IDProvider").IDProvider;

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