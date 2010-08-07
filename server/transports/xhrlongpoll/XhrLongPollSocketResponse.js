var http=require("http");
var EventEmitter=require("events").EventEmitter;
var sys=require("sys");


function XhrLongPollSocketResponse(server,response) {
	EventEmitter.call(this);
	this.type=responseTypes.none;
	this.server=server;
	this.response=response;
	this.connection=undefined;
	this.remoteAddress=request.connection.remoteAddress;
}
sys.inherits(XhrLongPollSocketResponse,EventEmitter);

XhrLongPollSocketResponse.prototype.readyState="opening";
XhrLongPollSocketResponse.prototype.writeable=false;
XhrLongPollSocketResponse.prototype.readable=false;

XhrLongPollSocketResponse.prototype.writeHead=function(code,headers) {
	if (this.type!==responseTypes.none) {
		throw new Error("Response already started");
	}
	this.type=responseTypes.http;
	this.readyState="opened";
	this.response.writeHead.apply(this.response,arguments);
}

var messageTypes={
	probe: 0,
	welcome: 1,
	data: 2
};
XhrLongPollSocketResponse.prototype.accept=function(protocol,headers) {
	var response=this.response;
	if (this.type!==responseTypes.none) {
		throw new Error("Response already started");
	}
	this.type=responseTypes.socket;
	this.readyState="opening";
	this.response=undefined;
	this.connection=new XhrLongPollConnection(server);
	var responseBody=JSON.stringify({id:this.connection.id,secret:this.connection.secret});
	response.writeHead(200,{"Content-Type":"application/json","Content-Length":responseBody.length});
	response.end(responseBody,"ascii");
}