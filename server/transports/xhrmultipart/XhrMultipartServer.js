var http=require("http");
var EventEmitter=require("events").EventEmitter;
var sys=require("sys");
var XhrGeneralSocketRequest=require("../xhrgeneral/XhrGeneralSocketRequest").XhrGeneralSocketRequest;
var XhrGeneralSocketResponse=require("../xhrgeneral/XhrGeneralSocketResponse").XhrGeneralSocketResponse;
var XhrMultipartConnection=require("./XhrMultipartConnection").XhrMultipartConnection;
var IDProvider=require("IDProvider").IDProvider;
var querystring=require("querystring");
var URL=require("url");

function XhrMultipartServer() {
	EventEmitter.call(this);
	this.pushIdprovider=new IDProvider();
	this.pushHandlers={};
}
sys.inherits(XhrMultipartServer,EventEmitter);

XhrMultipartServer.prototype.handleRequest=function(request,response) {
	var qs=querystring.parse(URL.parse(request.url).query || ""),
		id,handler;
	switch (qs["xhrm_type"]) {
		case "connect":
			if (request.method!=="GET") {
				return sendCodeResponse(response,500);
			}
			if (this.listeners("request").length<1) {
				return sendCodeResponse(response,404);
			} else {
				this.emit("request",new XhrGeneralSocketRequest(request,qs["xhrm_protocol"] || ""),new XhrGeneralSocketResponse(this,request,response,XhrMultipartConnection,"xhrm"));
			}
			break;
		case "push":
			id=parseInt(qs["xhrm_id"],10);
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
XhrMultipartServer.prototype.registerPushHandler=function(handler) {
	var id=this.pushIdprovider.alloc();
	if (typeof(handler)!=="function")
		throw new Error("Invalid push handler");
	this.pushHandlers[id]=handler;
	return id;
}
XhrMultipartServer.prototype.revokePushHandler=function(id) {
	id=parseInt(id,10);
	if (typeof(this.pushHandlers[id])!=="function")
		return;
	delete this.pushHandlers[id];
	this.pushIdprovider.free(id);
}

function sendCodeResponse(res,code,message) {
	var msg=http.STATUS_CODES[code];
	var body="<html><head><title>"+code+": "+msg+"</title><head><body><h1>"+code+": "+msg+"</h1>"+(message?("<p>"+message+"</p>"):"")+"</body></html>";
	res.writeHead(code,{"Content-Type":"text/html","Content-Length":body.length});
	res.write(body);
	res.end();
}
exports.XhrMultipartServer=XhrMultipartServer;