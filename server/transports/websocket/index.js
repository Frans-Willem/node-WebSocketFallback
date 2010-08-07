var WebSocketServer=require("./WebSocketServer").WebSocketServer;

exports.createServer=function() {
	return new WebSocketServer();
}