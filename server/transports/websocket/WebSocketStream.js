var EventEmitter=require("events").EventEmitter;
var sys=require("sys");
var http=require("http");
var crypto=require("crypto");
var Buffer=require("buffer").Buffer;

//Notes:
//	Should work

//Also apply this to on
function WebSocketStream(request,socket,head,protocol,responseHeaders) {
	var self=this;
	
	EventEmitter.call(this);
	this._socket=socket;
	this._httpVersion=request.httpVersion;
	this._headers=request.headers;
	this._responseHeaders=responseHeaders;
	this._url=request.url;
	this._protocol=protocol;
	this._buffer=(head && head.length>0)?[head]:[];
	this._bufferLen=(head && head.length>0)?head.length:0;
	this._paused=false;
	this._handshaked=false;
	this._handshakeInfo=undefined;
	this._hadError=false; //Have we already emitted an error?
	this._hasEnded=false;
	this._shouldDecode=false;
	//Readable events
	socket.on("data",function(data) {
		if (data && data.length>0) {
			self._buffer.push(data);
			self._bufferLen+=data.length;
			self._parseBuffer();
		}
	});
	socket.on('error',function() {
		self.readable=self._socket.readable;
		self.writeable=self._socket.writeable && self._handshaked && !self._hadError;
		if (!self._hadError && !self_hasEnded) {
			self._hadError=true;
			self.emit.apply(self,['error'].concat(Array.prototype.slice.call(arguments)));
		}
	});
	socket.on('end',function() {
		self.readable=self._socket.readable & !self._hasEnded;
		if (!self._hasEnded) {
			self._hasEnded=true;
			self.emit.apply(self,['end'].concat(Array.prototype.slice.call(arguments)));
		}
	});
	socket.on('close',function() {
		self.readable=self._socket.readable & !self._hasEnded;
		self.emit.apply(self,['close'].concat(Array.prototype.slice.call(arguments)));
	});
	//Writeable events
	socket.on('drain',function() {
		self.emit.apply(self,['drain'].concat(Array.prototype.slice.call(arguments)));
	});
	//'error' & 'close' already done
	
	//Next tick start parsing the buffer
	process.nextTick(function() {self._parseBuffer();});
	//Everything wired up, get ready for 
	socket.resume();
}
sys.inherits(WebSocketStream,EventEmitter);
//Readable: properties
WebSocketStream.prototype.readable=true;
//Writeable: properties
WebSocketStream.prototype.writeable=false; //According to docs should be true, but setting to false because we're waiting for connect
//Readable: methods
WebSocketStream.prototype.setEncoding=function(encoding) {
	if (encoding=="utf8") {
		this._shouldDecode=true;
	} else if (encoding===undefined) {
		this._shouldDecode=false;
	} else {
		throw new Error("Unsupported encoding for WebSocket, only UTF8 supported.");
	}
}
WebSocketStream.prototype.pause=function() {
	this._paused=true;
	return this._socket.pause();
}
WebSocketStream.prototype.resume=function() {
	var self=this;
	this._paused=false;
	process.nextTick(function() {
		self._parseBuffer();
	});
	return this._socket.resume();
}
WebSocketStream.prototype.destroy=function() {
	var ret=this._socket.destroy();
	this.readable=this._socket.readable && !this._hasEnded;
	self.writeable=this._socket.writeable && this._handshaked && !this._hadError;
	return ret;
}
//TODO: Resume implementing functions here.
//Writeable: methods
WebSocketStream.prototype.end=function() {
	//TODO: Remember to set writeable=false;
}
WebSocketStream.prototype.write=function(arg1,arg2) {
	var buf=Buffer.isBuffer(arg1)?arg1:(new Buffer(arg1,arg2 || "utf8")),
		newbuf;
	newbuf=new Buffer(buf.length+2);
	newbuf[0]=0x00;
	buf.copy(newbuf,1,0,buf.length);
	newbuf[buf.length+1]=0xFF;
	return this._socket.write(newbuf);
}
WebSocketStream.prototype.end=function() {
	return this._socket.end.apply(this._socket,arguments);
}
WebSocketStream.prototype.destroy=WebSocketStream.prototype.destroy; //Already done in readable part
//Custom methods
WebSocketStream.prototype._triggerError=function(msg) {
	if (!this._hadError) {
		this._hadError=true;
		this.emit('error',new Error(msg));
	}
	if (!this._hasEnded) {
		this._hasEnded=true;
		this.emit('end',true);
	}
	//this._socket.end();
	this._socket.destroy();
}
function sendSocketCode(socket,httpVersion,code) {
	var msg=http.STATUS_CODES[code];
	var body=code+": "+msg;
	var response="HTTP/"+httpVersion+" "+code+" "+msg+"\r\nContent-Type: text/plain\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n"+body;
	socket.write(response,"ascii")
	socket.end();
	return;
}
WebSocketStream.prototype._doHandshake=function() {
	var info=this._handshakeInfo,
		response,responseHeader,
		key1,key2,key1digits,key2digits,key1spaces,key2spaces,handshake,
		buf,
		left;
	if (info===undefined) {
		key1=this._headers["Sec-WebSocket-Key1"] || this._headers["sec-websocket-key1"] || "";
		key2=this._headers["Sec-WebSocket-Key2"] || this._headers["sec-websocket-key2"] || "";
		if (key1!=="" || key2!=="") {
			require("sys").puts("Draft 76");
			key1digits=parseInt(key1.replace(/[^0-9]/g,""),10);
			key1spaces=key1.replace(/[^ ]/g,"").length;
			key2digits=parseInt(key2.replace(/[^0-9]/g,""),10);
			key2spaces=key2.replace(/[^ ]/g,"").length;
			if ((key1digits % key1spaces)!==0 || (key2digits % key2spaces)!==0) {
				sendSocketCode(this._socket,this._httpVersion,500);
				this._triggerError("Invalid handshake keys");
				return false;
			}
			key1=key1digits/key1spaces;
			key2=key2digits/key2spaces;
			info=this._handshakeInfo={
				data: new Buffer(16),
				filled: 8
			};
			info.data[0]=(key1>>24)&0xFF;
			info.data[1]=(key1>>16)&0xFF;
			info.data[2]=(key1>>8)&0xFF;
			info.data[3]=(key1>>0)&0xFF;
			info.data[4]=(key2>>24)&0xFF;
			info.data[5]=(key2>>16)&0xFF;
			info.data[6]=(key2>>8)&0xFF;
			info.data[7]=(key2>>0)&0xFF;
		} else {
			require("sys").puts("Draft 55");
			info=this._handshakeInfo=false;
		}
	}
	if (info===false) {
		//Simple pre-draft-76 handshake
		response="HTTP/"+this._httpVersion+" 101 WebSocket Protocol Handshake\r\n"+
			"Upgrade: WebSocket\r\n"+
			"Connection: Upgrade\r\n"+
			"WebSocket-Origin: "+(this._headers["Origin"] || this._headers["origin"] || "")+"\r\n"+
			"WebSocket-Location: ws://"+(this._headers["Host"] || this._headers["host"] || "")+this._url+"\r\n"+
			"WebSocket-Protocol: "+(this._protocol || "")+"\r\n";
		if (typeof(this._responseHeaders)==="object") {
			for (responseHeader in this._responseHeaders) {
				if (
					this._responseHeaders.hasOwnProperty(responseHeader) &&
					_responseHeaders.toLowerCase()!=="upgrade" &&
					_responseHeaders.toLowerCase()!=="connection" &&
					_responseHeaders.toLowerCase()!=="websocket-origin" &&
					_responseHeaders.toLowerCase()!=="websocket-location" &&
					_responseHeaders.toLowerCase()!=="websocket-protocol"
				) {
					response+=responseHeader+": "+(this._responseHeaders[responseHeader] || "")+"\r\n";
				}
			}
		}
		response+="\r\n";
		this._socket.write(response,"ascii");
		return true;
	} else if (typeof(info)==="object") {
		//Attempt to extract info from buffer
		while (info.filled<info.data.length && this._buffer.length>0) {
			buf=this._buffer.shift();
			left=Math.min(buf.length,info.data.length-info.filled);
			buf.copy(info.data,info.filled,0,left);
			info.filled+=left;
			this._bufferLen-=left;
			if (buf.length>left) {
				this._buffer.unshift(buf.slice(left,buf.length));
			}
		}
		if (info.filled === info.data.length) {
			response="HTTP/"+this._httpVersion+" 101 WebSocket Protocol Handshake\r\n"+
				"Upgrade: WebSocket\r\n"+
				"Connection: Upgrade\r\n"+
				"Sec-WebSocket-Origin: "+(this._headers["Origin"] || this._headers["origin"] || "")+"\r\n"+
				"Sec-WebSocket-Location: ws://"+(this._headers["Host"] || this._headers["host"] || "")+this._url+"\r\n"+
				"Sec-WebSocket-Protocol: "+(this._protocol || "")+"\r\n";
			if (typeof(this._responseHeaders)==="object") {
				for (responseHeader in this._responseHeaders) {
					if (
						this._responseHeaders.hasOwnProperty(responseHeader) &&
						_responseHeaders.toLowerCase()!=="upgrade" &&
						_responseHeaders.toLowerCase()!=="connection" &&
						_responseHeaders.toLowerCase()!=="sec-websocket-origin" &&
						_responseHeaders.toLowerCase()!=="sec-websocket-location" &&
						_responseHeaders.toLowerCase()!=="sec-websocket-protocol"
					) {
						response+=responseHeader+": "+(this._responseHeaders[responseHeader] || "")+"\r\n";
					}
				}
			}
			response+="\r\n";
			sys.puts("response: "+response);
			this._socket.write(response,"ascii");
			handshake=crypto.createHash("md5");
			handshake.update(info.data.toString("binary"),"binary");
			handshake=new Buffer(handshake.digest("binary"),"binary");
			this._socket.write(handshake);
			this._handshakeInfo=undefined;
			return true;
		}
		return false;
	} else {
		sendSocketCode(this._socket,this._httpVersion,500);
		this._triggerError("Unknown handshake method");
		return false;
	}
}
function extractSimplePacket(buffers,size) {
	var output=new Buffer(size),
		offset=1,
		written=0,
		current,
		startcopy,
		endcopy;
	while (size) {
		current=buffers.shift();
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
		buffers.unshift(current.slice(endcopy+1,current.length));
	}
	return output;
}
WebSocketStream.prototype._onPacket=function(type,data) {
	if (type===0) {
		this.emit("data",this._shouldDecode?data.toString("utf8"):data);
	}
}
WebSocketStream.prototype._parseBuffer=function() {
	var packetType,
		i, //Full index
		bi, //Index into buffer
		b; //Buffer working in
	if (this._hasEnded || this._hadError) {
		return;
	}
	if (!this._handshaked) {
		require("sys").puts("Handshaking");
		if (this._doHandshake()) {
			require("sys").puts("Handshake done");
			this._handshaked=true;
			this.emit('connect');
		} else {
			return;
		}
	}
	require("sys").puts("Parsing");
	while (this._buffer.length>0 && !this._paused && this._socket.readable && !this._hasEnded && !this._hadError) {
		packetType=this._buffer[0][0];
		if ((packetType&0x80) === 0x80) {
			//TODO: Implement
			packetType=incoming[0][0];
			throw new Error("TODO: NOT IMPLEMENTED YET");
		} else {
			//0xFF terminated packet
			i=0;
			bi=0;
			b=0;
			while (b<this._buffer.length) {
				if (this._buffer[b][bi]==0xFF) {
					this._onPacket(packetType,extractSimplePacket(this._buffer,i-1));
					this._bufferLen-=i+1;
					break;
				}
				i++;
				bi++;
				if (bi>this._buffer[b].length) {
					b++;
					bi=0;
				}
			}
		}
	}
}
exports.WebSocketStream=WebSocketStream;