function XhrGeneralSocketRequest(request,protocol) {
	this.method=request.method;
	this.url=request.url;
	this.headers=request.headers;
	this.httpVersion=request.httpVersion;
	this.connection=request.connection;
	this.protocol=protocol;
}

exports.XhrGeneralSocketRequest=XhrGeneralSocketRequest;