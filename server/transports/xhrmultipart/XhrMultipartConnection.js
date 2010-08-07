var EventEmitter=require("events").EventEmitter;
var sys=require("sys");
var multipartSeperator="[}\"\"{]"; //Something that will *always* be invalid inside JSON data
var Buffer=require("buffer").Buffer;

/**
 * Multipart outgoing connection, event "close", called maximum of once.
 * Note, the seperator used is crafted to never appear in valid JSON data, so please only use this connection for JSON data.
 * @param {http.ServerRequest} request 
 * @param {http.ServerResponse} response Will be taken over by this.
 * @param {Object} server Not used
 * @constructor
 * @extends EventEmitter
 */
function XhrMultipartConnection(request,response,server,headers) {
	var self=this,
		combinedHeaders,
		i,
		onRequestEnd;
	EventEmitter.call(this);
	this.response=response;
	this.open=true;
	this.contentType="application/json",
	//Wire up events
	onRequestEnd=function() {
		if (self.open) {
			self.open=false;
			self.emit("close");
			self.removeAllListeners("data");
			self.removeAllListeners("close");
		}
	};
	request.connection.on("end",onRequestEnd);
	request.connection.on("close",onRequestEnd);
	//Write response
	combinedHeaders={};
	headers=headers || {};
	for (i in headers) {
		if (headers.hasOwnProperty(i)) {
			combinedHeaders[i]=headers[i];
		}
	}
	combinedHeaders["Content-Type"]="multipart/x-mixed-replace; boundary="+multipartSeperator;
	combinedHeaders["Connection"]="close";
	this.response.writeHead(200,combinedHeaders);
}
sys.inherits(XhrMultipartConnection,EventEmitter);

XhrMultipartConnection.prototype.close=function() {
	var prevOpen=this.open,
		previousResponse=this.response;
	this.open=false;
	this.response=undefined;
	if (previousResponse!==undefined) {
		previousResponse.end("\r\n--"+multipartSeperator+"--\r\n");
	}
	if (prevOpen) {
		this.emit("close");
	}
	self.removeAllListeners("data");
	self.removeAllListeners("close");
}

XhrMultipartConnection.prototype.write=function() {
	var buf=Buffer.isBuffer(arguments[0])?arguments[0]:((arguments.length>1)?new Buffer(arguments[0],arguments[1]):new Buffer(arguments[0],"utf8")),
		self=this,
		pre="Content-Type: text/plain\r\n\r\n",
		post="\r\n--"+multipartSeperator+"\r\nContent-Type: text/plain\r\n\r\n--"+multipartSeperator+"\r\n",
		outbuf;
	if (!this.open || this.response===undefined) {
		return false;
	}
	if (this.response.connection.readyState!=="open" && this.response.connection.readyState!=="writeOnly") {
		this.open=false;
		try {
			this.response.end();
		} catch(e) {}
		this.response=null;
		this.emit("close");
		return false;
	}
	outbuf=new Buffer(pre.length+buf.length+post.length);
	outbuf.write(pre,0,"ascii");
	buf.copy(outbuf,pre.length,0,buf.length);
	outbuf.write(post,pre.length+buf.length,"ascii");
	this.response.write(outbuf);
	return true;
}

exports.XhrMultipartConnection=XhrMultipartConnection;