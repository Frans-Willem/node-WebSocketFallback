var EventEmitter=require("events").EventEmitter;
var sys=require("sys");
var WebSocketResponse=require("./WebSocketResponse").WebSocketResponse;
var WebSocketRequest=require("./WebSocketRequest").WebSocketRequest;

function WebSocketServer() {
	EventEmitter.call(this);
}
sys.inherits(WebSocketServer,EventEmitter);

function sendSocketCode(socket,httpVersion,code) {
	var msg=http.STATUS_CODES[code];
	var body=code+": "+msg;
	var response="HTTP/"+httpVersion+" "+code+" "+msg+"\r\nContent-Type: text/plain\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n"+body;
	socket.write(response,"ascii")
	socket.end();
	return;
}

WebSocketServer.prototype.handleRequest=function(request,socket,head) {
	var upgrade,connection,host,
		wsrequest,wsresponse;
	upgrade=request.headers["Upgrade"] || request.headers["upgrade"] || "";
	connection=request.headers["Connection"] || request.headers["connection"] || "";
	host=request.headers["Host"] || request.headers["host"] || "";
	if (upgrade!=="WebSocket" || connection!=="Upgrade" || host==="") {
		return sendSocketCode(socket,request.httpVersion,500);
	}
	wsrequest=new WebSocketRequest(request);
	wsresponse=new WebSocketResponse(request,socket,head);
	if (this.listeners("request").length>0) {
		this.emit("request",wsrequest,wsresponse);
	} else {
		wsresponse.writeHead(404,{});
		wsresponse.end();
	}
}

exports.WebSocketServer=WebSocketServer;