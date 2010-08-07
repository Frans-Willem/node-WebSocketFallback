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
exports.WebSocketRequest=WebSocketRequest;