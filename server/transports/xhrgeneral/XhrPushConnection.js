var http=require("http");
var EventEmitter=require("events").EventEmitter;
var sys=require("sys");

function sendCodeResponse(res,code,message) {
	var msg=http.STATUS_CODES[code];
	var body="<html><head><title>"+code+": "+msg+"</title><head><body><h1>"+code+": "+msg+"</h1>"+(message?("<p>"+message+"</p>"):"")+"</body></html>";
	res.writeHead(code,{"Content-Type":"text/html","Content-Length":body.length});
	res.write(body);
	res.end();
}

/**
 * Incoming push connection.
 * Events "close" and "data"
 * @param {Object} server server object that handles requests, should expose registerPushHandler and revokePushHandler.
 * @constructor
 * @extends EventEmitter
 */
function XhrPushConnection(server,transport) {
	var self=this;
	EventEmitter.call(this);
	this.server=server;
	this.id=server.registerPushHandler(pushHandler);
	this.secret=Math.floor(Math.random()*1000000).toString();
	this.open=true;
	
	function pushHandler(request,response,qs) {
		if (request.method!="POST" || !self.open || qs[transport+"_secret"]!=self.secret) {
			return sendCodeResponse(response,500);
		}
		request.on("data",function(data) {
			if (self.open) {
				self.emit("data",data);
			}
		})
		request.on("end",function() {
			response.writeHead(200,{"Content-Type":"text/plain","Content-Length":2});
			response.end("OK","ascii");
		});
	}
}
sys.inherits(XhrPushConnection,EventEmitter);
XhrPushConnection.prototype.close=function() {
	var prevOpen=this.open,
		prevId=this.id,
		prevServer=this.server;
	this.open=false;
	this.id=undefined;
	this.server=undefined;
	if (prevId!==undefined && prevServer!==undefined) {
		prevServer.revokePushHandler(prevId);
	}
	if (prevOpen) {
		this.emit("close");
	}
}
exports.XhrPushConnection=XhrPushConnection;