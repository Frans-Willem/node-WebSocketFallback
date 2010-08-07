var http=require("http");
var sys=require("sys");
var EventEmitter=require("events").EventEmitter;
var XhrGeneralSocketRequest=require("../xhrgeneral/XhrGeneralSocketRequest").XhrGeneralSocketRequest;
var XhrGeneralSocketResponse=require("../xhrgeneral/XhrGeneralSocketResponse").XhrGeneralSocketResponse;
var XhrLongPollConnection=require("./XhrLongPollConnection").XhrLongPollConnection;
var IDProvider=require("IDProvider").IDProvider;
var querystring=require("querystring");
var URL=require("url");

function XhrLongPollServer() {
	EventEmitter.call(this);
	this.pollIdprovider=new IDProvider();
	this.pollHandlers={};
	this.pushIdprovider=new IDProvider();
	this.pushHandlers={};
}
sys.inherits(XhrLongPollServer,EventEmitter);

function sendCodeResponse(res,code,message) {
	var msg=http.STATUS_CODES[code];
	var body="<html><head><title>"+code+": "+msg+"</title><head><body><h1>"+code+": "+msg+"</h1>"+(message?("<p>"+message+"</p>"):"")+"</body></html>";
	res.writeHead(code,{"Content-Type":"text/html","Content-Length":body.length});
	res.write(body);
	res.end();
}

XhrLongPollServer.prototype.handleRequest=function(request,response) {
	var qs=querystring.parse(URL.parse(request.url).query || ""),
		id,handler;
	switch (qs["xhrl_type"]) {
		case "connect":
			sys.puts("LongPollServer");
			if (request.method!=="GET") {
				return sendCodeResponse(response,500);
			}
			if (this.listeners("request").length<1) {
				return sendCodeResponse(response,404);
			} else {
				this.emit("request",new XhrGeneralSocketRequest(request,qs["xhrl_protocol"] || ""),new XhrGeneralSocketResponse(this,request,response,XhrLongPollConnection,"xhrl"));
			}
			break;
		case "poll":
			id=parseInt(qs["xhrl_id"],10);
			handler=this.pollHandlers[id];
			if (typeof(handler)==="function") {
				return handler(request,response,qs);
			} else {
				return sendCodeResponse(response,500);
			}
			break;
		case "push":
			id=parseInt(qs["xhrl_id"],10);
			handler=this.pushHandlers[id];
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
}

XhrLongPollServer.prototype.registerPollHandler=function(handler) {
	var id=this.pollIdprovider.alloc();
	if (typeof(handler)!=="function")
		throw new Error("Invalid poll handler");
	this.pollHandlers[id]=handler;
	return id;
}
XhrLongPollServer.prototype.revokePollHandler=function(id) {
	id=parseInt(id,10);
	if (typeof(this.pollHandlers[id])!=="function")
		return;
	delete this.pollHandlers[id];
	this.pollIdprovider.free(id);
}
XhrLongPollServer.prototype.registerPushHandler=function(handler) {
	var id=this.pushIdprovider.alloc();
	if (typeof(handler)!=="function")
		throw new Error("Invalid push handler");
	this.pushHandlers[id]=handler;
	return id;
}
XhrLongPollServer.prototype.revokePushHandler=function(id) {
	id=parseInt(id,10);
	if (typeof(this.pushHandlers[id])!=="function")
		return;
	delete this.pushHandlers[id];
	this.pushIdprovider.free(id);
}
exports.XhrLongPollServer=XhrLongPollServer;