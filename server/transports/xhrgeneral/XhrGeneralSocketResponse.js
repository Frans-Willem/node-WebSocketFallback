var EventEmitter=require("events").EventEmitter;
var sys=require("sys");
var XhrPushConnection=require("../xhrgeneral/XhrPushConnection").XhrPushConnection;

var messageTypes={
	probe: 0,
	welcome: 1,
	connected: 2,
	data: 3
};
var responseTypes={
	none: 0,
	http: 1,
	socket: 2,
	closed: 3
};
function XhrGeneralSocketResponse(server,request,response,outgoingClass,transport) {
	var self=this;
	EventEmitter.call(this);
	this.type=responseTypes.none;
	//Keep this pair for HTTP handling
	this.server=server;
	this.response=response;
	this.request=request;
	//Use this for socket handling
	this.outgoingClass=outgoingClass;
	this.transport=transport;
	this.incoming=undefined;
	this.outgoing=undefined;
	
	this.remoteAddress=request.connection.remoteAddress;
}
sys.inherits(XhrGeneralSocketResponse,EventEmitter);

XhrGeneralSocketResponse.prototype.readyState="opening";
XhrGeneralSocketResponse.prototype.writeable=false;
XhrGeneralSocketResponse.prototype.readable=false;

XhrGeneralSocketResponse.prototype.writeHead=function(code,headers) {
	if (this.type!==responseTypes.none) {
		throw new Error("Response already started");
	}
	this.type=responseTypes.http;
	this.readyState="closed";
	this.response.writeHead.apply(this.response,Array.prototype.slice.call(arguments));
}
XhrGeneralSocketResponse.prototype.accept=function(protocol,headers) {
	var self=this,
		prevRequest,
		prevResponse,
		prevServer;
	if (this.type!==responseTypes.none) {
		throw new Error("Response already started");
	}
	this.type=responseTypes.socket;
	this.readyState="opening";
	
	prevRequest=this.request;
	prevResponse=this.response;
	prevServer=this.server;
	this.request=this.response=this.server=undefined;
	
	this.outgoing=new (this.outgoingClass)(prevRequest,prevResponse,prevServer,headers);
	this.incoming=new XhrPushConnection(prevServer,this.transport);
	startConnect(this,protocol);
}
function startConnect(self,protocol) {
	var buffer="",
		connecting=true,
		closed=false,
		connectTimer=undefined;
	
	self.incoming.on("data",onData);
	
	self.outgoing.on("close",function() {
		self.incoming.close();
		self.outgoing.removeListener("data",onData);
		buffer=undefined;
		closed=true;
	});
	function onData(data) {	
		var split,line;
		buffer+=data.toString("utf8");
		while (!closed) {
			split=buffer.indexOf("\n");
			if (split===-1) {
				break;
			}
			line=buffer.substr(0,split);
			buffer=buffer.substr(split+1);
			line=line.replace(/\r$/g,"");
			onLine(line);
		}
	}
	function onLine(line) {
		var obj=undefined;
		try {
			obj=JSON.parse(line);
		}
		catch(e) {
			onError("JSON: "+e.toString());
			return;
		}
		if (typeof(obj)!=="object") {
			onError("Not an object");
			return;
		}
		return onPacket(obj);
	}
	function onPacket(obj) {
		if (connecting) {
			if (obj.t===messageTypes.probe) {
				connecting=false;
				onConnected();
			} else {
				onError("Unexpected message");
				return;
			}
		} else {
			if (obj.t==messageTypes.data && Array.isArray(obj.c)) {
				obj.c.forEach(function(i) {
					if (self.readyState==="open" || self.readyState==="readOnly") {
						self.emit("data",i);
					}
				});
			} else {
				onError("Unexpected message");
				return;
			}
		}
	}
	function onConnected() {
		self.outgoing.write(JSON.stringify({t:messageTypes.probe})+"\n");
		self.readyState="open";
		self.emit("connect");
	}
	function onError(msg) {
		if (self.readyState!=="closed") {
			self.readyState="closed";
			self.emit("error",new Error(msg));
			self.emit("close");
		}
	}
	
	//Send first packets
	self.outgoing.write(JSON.stringify({t:messageTypes.probe})+"\n");
	self.outgoing.write(JSON.stringify({t:messageTypes.welcome,id:self.incoming.id,secret:self.incoming.secret,protocol:protocol})+"\n");
}
XhrGeneralSocketResponse.prototype.write=function() {
	switch (this.type) {
		case responseTypes.closed: break; //Ignore
		case responseTypes.none:{
			throw new Error("Please use .writeHead or .accept first!");
			break;
		}
		case responseTypes.http:{
			return this.response.write.apply(this.response,arguments);
		}
		case responseTypes.socket:{
			if ((this.readyState!=="open" && this.readyState!=="writeOnly") || this.outgoing===undefined) {
				throw new Error("Stream is not writeable");
				return;
			}
			return this.outgoing.write(JSON.stringify({t:messageTypes.data,c:[arguments[0].toString("utf8")]})+"\n");
		}
	}
}
XhrGeneralSocketResponse.prototype.end=function() {
	var oldtype=this.type;
	this.type=responseTypes.closed;
	switch (oldtype) {
		case responseTypes.closed: break; //Ignore
		case responseTypes.none:{
			this.response.end.apply(this.response,arguments);
			this.response=this.request=this.server=undefined;
			break;
		}
		case responseTypes.http:{
			this.response.end.apply(this.response,arguments);
			this.response=this.request=this.server=undefined;
			break;
		}
		case responseTypes.socket:{
			//TODO: Close socket gracefully
			break;
		}
	}
}

exports.XhrGeneralSocketResponse=XhrGeneralSocketResponse;