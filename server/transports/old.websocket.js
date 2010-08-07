/*
TODO: Properly handle length indicated message
TODO: Properly handle and send FIN websocket packet (type 0xFF, length 0)
*/

var sys=require("sys");
var http=require("http");
var EventEmitter=require("events").EventEmitter;
var Buffer=require("buffer").Buffer;
var crypto=require("crypto");

function EEBase() {}
EEBase.prototype=EventEmitter.prototype;

function WebSocketServer() {
	EventEmitter.call(this);
}
WebSocketServer.prototype=new EEBase();

exports.createServer=function() {
	return new WebSocketServer();
}

WebSocketServer.prototype.handleRequest=function(request,socket,head) {
	var key1,key2,key1digits,key2digits,key1spaces,key2spaces,upgrade,connection,origin,host,
		handshakeData,handshakeLen,wsrequest,wsresponse,self=this;
	upgrade=request.headers["Upgrade"] || request.headers["upgrade"] || "";
	connection=request.headers["Connection"] || request.headers["connection"] || "";
	origin=request.headers["Origin"] || request.headers["origin"] || "";
	host=request.headers["Host"] || request.headers["host"] || "";
	if (upgrade!=="WebSocket" || connection!=="Upgrade" || host==="") {
		return sendSocketCode(socket,request.httpVersion,500);
	}
	wsrequest=new WebSocketRequest(request);
	key1=request.headers["Sec-WebSocket-Key1"] || request.headers["sec-websocket-key1"] || "";
	key2=request.headers["Sec-WebSocket-Key2"] || request.headers["sec-websocket-key2"] || "";
	if (key1!=="" || key2!=="") {
		key1digits=parseInt(key1.replace(/[^0-9]/g,""),10);
		key1spaces=key1.replace(/[^ ]/g,"").length;
		key2digits=parseInt(key2.replace(/[^0-9]/g,""),10);
		key2spaces=key2.replace(/[^ ]/g,"").length;
		if ((key1digits % key1spaces)!==0 || (key2digits % key2spaces)!==0) {
			return sendSocketCode(socket,request.httpVersion,500);
		}
		key1=key1digits/key1spaces;
		key2=key2digits/key2spaces;
		var handshakeData=new Buffer(16);
		handshakeData[0]=(key1>>24)&0xFF;
		handshakeData[1]=(key1>>16)&0xFF;
		handshakeData[2]=(key1>>8)&0xFF;
		handshakeData[3]=(key1>>0)&0xFF;
		handshakeData[4]=(key2>>24)&0xFF;
		handshakeData[5]=(key2>>16)&0xFF;
		handshakeData[6]=(key2>>8)&0xFF;
		handshakeData[7]=(key2>>0)&0xFF;
		var handshakeLen=8;
		function onData(data) {
			var i;
			for (i=0; i<data.length && handshakeLen<handshakeData.length; i++)
				handshakeData[handshakeLen++]=data[i];
			if (handshakeLen>=handshakeData.length) {
				socket.removeListener("data",onData);
				wsresponse=new WebSocketResponse(request,socket,(i<data.length)?data.slice(i,data.length):undefined,handshakeData);
				if (self.listeners("request").length>0) self.emit("request",wsrequest,wsresponse);
				else {
					wsresponse.writeHead(404,{});
					wsresponse.end();
				}
			}
		}
		socket.on("data",onData);
		if (head)
			onData(head);
	} else {
		wsresponse=new WebSocketResponse(request,socket,head);
		if (self.listeners("request").length>0) self.emit("request",wsrequest,wsresponse);
		else {
			wsresponse.writeHead(404,{});
			wsresponse.end();
		}
	}
}
function sendSocketCode(socket,httpVersion,code) {
	var msg=http.STATUS_CODES[code];
	var body=code+": "+msg;
	var response="HTTP/"+request.httpVersion+" "+code+" "+msg+"\r\nContent-Type: text/plain\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n"+body;
	socket.write(response,"ascii")
	socket.end();
	return;
}

function WebSocketRequest(request) {
	this.method=request.method;
	this.url=request.url;
	this.headers=request.headers;
	this.httpVersion=request.httpVersion;
	this.connection=request.connection;
	this.protocol=
		this.headers["WebSocket-Protocol"] ||
		this.headers["Sec-WebSocket-Protocol"] ||
		this.headers["websocket-protocol"] ||
		this.headers["sec-websocket-protocol"] ||
		"";
}

var responseTypes={
	none: 0,
	http: 1,
	websocket: 2,
	closed: 3
};
function WebSocketResponse(request,socket,head,handshakeData) {
	var self=this;
	EventEmitter.call(this);
	this.socket=socket;
	this.handshakeData=handshakeData;
	this.type=responseTypes.none;
	this.response=undefined;
	this.request=request;
	
	this.remoteAddress=socket.remoteAddress;
	
	this.dataCollected=[];
	if (head) {
		this.dataCollected.push(head);
	}
	this.dataCollector=function(data) {
		self.dataCollected.push(data);
	}
	this.socket.on("data",this.dataCollector);
}
WebSocketResponse.prototype=new EEBase();
WebSocketResponse.prototype.readyState="opening";
WebSocketResponse.prototype.writeable=false;
WebSocketResponse.prototype.readable=false;
WebSocketResponse.prototype.writeHead=function(code,headers) {
	if (this.type!==responseTypes.none) {
		throw new Error("Response already started");
	}
	this.type=responseTypes.http;
	this.readyState="closed";

	this.response=new http.ServerResponse(this.request);
	this.response.writeHead.apply(this.response,Array.prototype.slice.call(arguments));
}
function wireupWebsocketEvents(self,socket) {
	var incoming=[],
		totalLen=incoming.reduce(function(prev,cur) { return prev+cur.length; },0),
		queue=[],
		paused=false;
	self.pause=function() {
		paused=true;
	}
	self.resume=function() {
		paused=false;
		while (!paused && queue.length>0) {
			if (self.encoding) {
				self.emit("data",queue.shift().toString(self.encoding));
			} else {
				self.emit("data",queue.shift());
			}
		}
	}
	function onPacket(type,buffer) {
		if (type===0) {
			if (paused) {
				queue.push(buffer);
			} else {
				if (self.encoding) {
					self.emit("data",buffer.toString(self.encoding));
				} else {
					self.emit("data",buffer);
				}
			}
		}
	}
	function extractSimplePacket(incoming,size) {
		var output=new Buffer(size),
			offset=1,
			written=0,
			current,
			startcopy,
			endcopy;
		while (size) {
			current=incoming.shift();
			if (current.length<=offset) {
				offset=0;
				continue;
			}
			startcopy=offset;
			endcopy=Math.min(offset+size,current.length);
			offset=0;
			current.copy(output,written,startcopy,endcopy);
			written+=endcopy-startcopy;
			size-=endcopy-startcopy;
		}
		if (endcopy+1 < current.length) {
			incoming.unshift(current.slice(endcopy+1,current.length));
		}
		return output;
	}
	function parseData() {
		while (true) {
			if (incoming.length==0)
				break;
			if ((incoming[0][0]&0x80) === 0x80) {
				//TODO: Implement
				packetType=incoming[0][0];
				throw new Error("TODO: NOT IMPLEMENTED YET");
			} else {
				//0xFF terminated packet
				packetType=incoming[0][0];
				i=0;
				bi=0;
				b=0;
				while (b<incoming.length) {
					if (incoming[b][bi]==0xFF) {
						onPacket(packetType,extractSimplePacket(incoming,i-1));
						totalLen-=i+1;
						break;
					}
					i++;
					bi++;
					if (bi>incoming[b].length) {
						b++;
						bi=0;
					}
				}
			}
		}
	}
	function onData(data) {
		var b,i,bi,packetType;
		incoming.push(data);
		totalLen+=data.length;
		parseData();
	}
	function onEnd() {
		var args=["end"].concat(Array.prototype.slice.call(arguments));
		self.readable=false;
		self.emit.apply(self,args);
	}
	function onTimeout() {
		var args=["timeout"].concat(Array.prototype.slice.call(arguments));
		self.emit.apply(self,args);
	}
	function onDrain() {
		var args=["drain"].concat(Array.prototype.slice.call(arguments));
		self.emit.apply(self,args);
	}
	function onError() {
		var args=["error"].concat(Array.prototype.slice.call(arguments));
		self.readable=false;
		self.writeable=false;
		self.emit.apply(self,args);
	}
	function onClose(had_error) {
		var args=["close"].concat(Array.prototype.slice.call(arguments));
		self.readable=false;
		self.writeable=false;
		self.emit.apply(self,args);
	}
	socket.removeListener("data",self.dataCollector);
	incoming=incoming.concat(self.dataCollected);
	socket.on("data",onData);
	socket.on("end",onEnd);
	socket.on("timeout",onTimeout);
	socket.on("drain",onDrain);
	socket.on("error",onError);
	socket.on("close",onClose);
	parseData();
}
WebSocketResponse.prototype.accept=function(protocol,headers) {
	var headername,headervalue,handshake,self=this;
	if (this.type!==responseTypes.none) {
		throw new Error("Response already started");
	}
	this.type=responseTypes.websocket;
	this.readyState="opening";
	var response="HTTP/"+this.request.httpVersion+" 101 WebSocket Protocol Handshake\r\n"+
		"Upgrade: WebSocket\r\n"+
		"Connection: Upgrade\r\n";
	if (this.handshakeData) {
		response+="Sec-WebSocket-Origin: "+(this.request.headers["Origin"] || this.request.headers["origin"] || "")+"\r\n"+
			"Sec-WebSocket-Location: ws://"+(this.request.headers["Host"] || this.request.headers["host"] || "")+this.request.url+"\r\n"+
			"Sec-WebSocket-Protocol: "+(protocol || "")+"\r\n";
		for (headername in headers) {
			if (headers.hasOwnProperty(headername) &&
				headername.toLowerCase()!=="upgrade" &&
				headername.toLowerCase()!=="connection" &&
				headername.toLowerCase()!=="sec-websocket-origin" &&
				headername.toLowerCase()!=="sec-websocket-location" &&
				headername.toLowerCase()!=="sec-websocket-protocol"
			) {
				response+=headername+": "+(headers[headername] || "")+"\r\n";
			}
		}
		response+="\r\n";
		this.socket.write(response,"ascii");
		handshake=crypto.createHash("md5");
		handshake.update(this.handshakeData.toString("binary"),"binary");
		handshake=new Buffer(handshake.digest("binary"),"binary");
		this.handshakeData=undefined;
		this.socket.write(handshake);
	} else {
		response+="WebSocket-Origin: "+(this.request.headers["Origin"] || this.request.headers["origin"] || "")+"\r\n"+
			"WebSocket-Location: ws://"+(this.request.headers["Host"] || this.request.headers["host"] || "")+this.request.url+"\r\n"+
			"WebSocket-Protocol: "+(protocol || "")+"\r\n";
		for (headername in headers) {
			if (headers.hasOwnProperty(headername) &&
				headername.toLowerCase()!=="upgrade" &&
				headername.toLowerCase()!=="connection" &&
				headername.toLowerCase()!=="websocket-origin" &&
				headername.toLowerCase()!=="websocket-location" &&
				headername.toLowerCase()!=="websocket-protocol"
			) {
				response+=headername+": "+(headers[headername] || "")+"\r\n";
			}
		}
		response+="\r\n";
		this.socket.write(response,"ascii");
	}
	//Wire the whole thing up
	process.nextTick(function() {
		if (self.readyState==="opening" && self.type===responseTypes.websocket) {
			self.readyState="open";
			self.readable=self.writeable=true;
			self.emit("connect");
			wireupWebsocketEvents(self,self.socket);
		}
	});
}
WebSocketResponse.prototype.write=function() {
	switch (this.type) {
		case responseTypes.none:
			throw new Error("Call .accept or .writeHead first");
			break;
		case responseTypes.websocket:{
			if (!this.writeable) {
				throw new Error("Not writeable. (wait for 'connect' event?)");
			}
			var buf=(arguments[0] instanceof Buffer)?arguments[0]:(arguments.length>1?new Buffer(arguments[0],arguments[1]):new Buffer(arguments[0],"utf8"));
			var sendBuf=new Buffer(buf.length+2);
			for (var i=0; i<buf.length; i++) {
				if (buf[i]==0xFF) {
					throw new Error("terminator byte (0xFF) found in data, unable to send a string. Did you use 'utf8' encoding?");
				}
			}
			sendBuf[0]=0x00;
			buf.copy(sendBuf,1,0,buf.length);
			sendBuf[sendBuf.length-1]=0xFF;
			return this.socket.write(sendBuf);
			break;
		}
		case responseTypes.http:
			return this.response.write.apply(this.response,Array.prototype.slice.call(arguments));
		case responseTypes.closed:
			throw new Error(".end or .destroy already called");
			break;
	}
}
WebSocketResponse.prototype.end=function() {
	this.readyState="closed";
	this.writeable=false;
	switch (this.type) {
		case responseTypes.http:
			return this.response.end.apply(this.response,Array.prototype.slice.call(arguments));
		case responseTypes.websocket:
			this.write.apply(this,Array.prototype.slice.call(arguments));
			this.socket.end();
		case responseTypes.none:
			return this.socket.end();
		default:
			return this.socket.end();
	}
}
WebSocketResponse.prototype.destroy=function() {
	switch (this.type) {
		case responseTypes.http:
			if (this.response)
				this.response.end.apply(this.response,Array.prototype.slice.call(arguments));
			if (this.socket)
			this.socket.destroy();
			break;
		default:
			if (this.socket)
				this.socket.destroy();
			break;
	}
	this.writeable=false;
	this.readyState="closed";
	this.socket=undefined;
	this.response=undefined;
	this.type=responseTypes.closed;
}
WebSocketResponse.prototype.pause=function () {};//Stub
WebSocketResponse.prototype.resume=function () {};//Stub
WebSocketResponse.prototype.setTimeout=function() {
	if (this.type===responseTypes.none) {
		throw new Error("Please call .accept first");
	}
	if (this.type!==responseTypes.websocket) {
		throw new Error("WebSocket not accepted");
	}
	this.socket.setTimeout.apply(this.socket,Array.prototype.slice.call(arguments));
}
WebSocketResponse.prototype.setNoDelay=function() {
	if (this.type===responseTypes.none) {
		throw new Error("Please call .accept first");
	}
	if (this.type!==responseTypes.websocket) {
		throw new Error("WebSocket not accepted");
	}
	this.socket.setNoDelay.apply(this.socket,Array.prototype.slice.call(arguments));
}
WebSocketResponse.prototype.setKeepAlive=function() {
	if (this.type===responseTypes.none) {
		throw new Error("Please call .accept first");
	}
	if (this.type!==responseTypes.websocket) {
		throw new Error("WebSocket not accepted");
	}
	this.socket.setKeepAlive.apply(this.socket,Array.prototype.slice.call(arguments));
}
WebSocketResponse.prototype.setEncoding=function(enc) {
	this.encoding=enc;
}