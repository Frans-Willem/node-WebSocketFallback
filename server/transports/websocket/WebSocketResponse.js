var http=require("http");
var EventEmitter=require("events").EventEmitter;
var sys=require("sys");
var Buffer=require("buffer").Buffer;
var WebSocketStream=require("./WebSocketStream").WebSocketStream;
/*
Normal operation:
	.writeHead(see http.ServerResponse)
	.accept(
	.end
	* NO EVENTS *
HTTP mode (after writeHead):
	Everything supported by http.ServerResponse
	No events
SOCKET mode (after .accept)
*/
function WebSocketResponse(request,socket,head) {
	EventEmitter.call(this);
	socket.pause(); //Ensure no more data gets sent to non-existing data-event handlers
	this.request=request;
	this.socket=socket;
	this.head=head;
}
sys.inherits(WebSocketResponse,EventEmitter);

WebSocketResponse.enumTypes={
	RAW: 0,
	HTTP: 1,
	SOCKET: 2
}
WebSocketResponse.prototype.type=WebSocketResponse.enumTypes.RAW;

/*
	Switch to HTTP Implementation
*/
WebSocketResponse.prototype.writeHead=function() {
	var keys=Object.keys(this),
		request=this.request,
		self=this;
	//Delete all properties
	keys.forEach(function(k) {
		delete self[k];
	});
	//Change prototype
	this.__proto__=http.ServerResponse.prototype;
	//Call constructor
	http.ServerResponse.call(this,request);
	this.shouldKeepAlive=false;
	//Add custom accept function
	this.accept=function() {
		throw new Error("WebSocketResponse was already answered as HTTP Response");
	}
	//If ServerResponse wanted the sockets data, it would've attached a listener by now
	socket.resume();
	//Call writeHead (don't use this, as *maybe* the writeHead property may be set to ourselves)
	return http.ServerResponse.prototype.writeHead.apply(this,arguments);
}
/*
	Switch to Socket implementation
*/
WebSocketResponse.prototype.accept=function(protocol,headers) {
	var keys=Object.keys(this),
		request=this.request,
		socket=this.socket,
		head=this.head,
		self=this;
	//Delete all properties
	keys.forEach(function(k) {
		delete self[k];
	});
	//Change prototype
	this.__proto__=WebSocketStream.prototype;
	//Hook appropriate functions
	WebSocketStream.call(this,request,socket,head,protocol,headers);
	return true;
}

exports.WebSocketResponse=WebSocketResponse;