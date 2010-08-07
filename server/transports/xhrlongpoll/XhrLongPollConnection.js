var http=require("http");
var sys=require("sys");
var EventEmitter=require("events").EventEmitter;
var Buffer=require("buffer").Buffer;

function sendCodeResponse(res,code,message) {
	var msg=http.STATUS_CODES[code];
	var body="<html><head><title>"+code+": "+msg+"</title><head><body><h1>"+code+": "+msg+"</h1>"+(message?("<p>"+message+"</p>"):"")+"</body></html>";
	res.writeHead(code,{"Content-Type":"text/html","Content-Length":body.length});
	res.write(body);
	res.end();
}

/**
 * A long-poll connection
 * Events are "data"(data) and "close"(reason/undefined). close will only be called once.
 * @author fw@hardijzer.nl
 * @param server Server object, should expose registerHandler and revokeHandler.
 * @constructor
 * @extends EventEmitter
 */
function XhrLongPollConnection(request,response,server,headers) {
	var self=this,
		combindedHeaders,
		i,
		responseBody;
	EventEmitter(this);
	function pollHandler() {
		return self.handlePollRequest.apply(self,arguments);
	}

	this.server=server;
	this.id=server.registerPollHandler(pollHandler);
	this.secret=Math.floor(Math.random()*10000).toString(16);
	this.queue=[];
	this.currentPoll=undefined;
	this.pollTime=60000; //Time to keep a poll open
	this.pollTimeout=10000; //Time to allow between polls
	this.pollTimer=setTimeout(function() {
		self.onPollTimer();
	},this.pollTimeout);
	this.contentType="application/json";
	this.open=true;
	
	responseBody=JSON.stringify({id:this.id,secret:this.secret});
	
	combinedHeaders={};
	headers=headers || {};
	for (i in headers) {
		if (headers.hasOwnProperty(i)) {
			combinedHeaders[i]=headers[i];
		}
	}
	combinedHeaders["Content-Type"]="application/json";
	combinedHeaders["Content-Length"]=responseBody.length;
	response.writeHead(200,combinedHeaders);
	response.end(responseBody,"ascii");
}
sys.inherits(XhrLongPollConnection,EventEmitter);

/**
 * Callback for timer. Either regulates long-poll duration (e.g. disconnect a poll after 60 seconds without data),
 * or regulates request time-outs (e.g. after 10 seconds without a connected poll, assume disconnected)
 * @author fw@hardijzer.nl
 * @member XhrLongPollConnection
 */
XhrLongPollConnection.prototype.onPollTimer=function() {
	var previousPoll,self=this;
	self.pollTimer=undefined;
	if (!self.open) {
		return;
	}
	if (self.currentPoll===undefined) {
		if (self.id!==undefined && self.server!==undefined) {
			self.server.revokePollHandler(self.id);
			self.id=undefined;
			self.server=undefined;
		}
		self.open=false;
		self.emit("close","timeout");
	} else {
		//Poll active, connection will be closed without data.
		previousPoll=self.currentPoll;
		self.currentPoll=undefined;
		previousPoll.writeHead(200,{"Content-Type":self.contentType,"Content-Length":0});
		previousPoll.end("");
		self.pollTimer=setTimeout(function() {
			self.onPollTimer();
		},self.pollTimeout);
	}
}

/**
 * Should be called by server upon a poll
 * @author fw@hardijzer.nl
 * @param {http.ServerRequest} request Request object from http.Server "request" event.
 * @param {http.ServerResponse} response Response object from http.Server "request" event.
 * @param {Object} qs Object containing query data (from querystring.parse(...))
 * @member XhrLongPollConnection
 */
XhrLongPollConnection.prototype.handlePollRequest=function(request,response,qs) {
	sys.puts("handlePollRequest");
	var self=this,
		previousPoll;
	if (!self.open || qs["xhrl_secret"]!=self.secret || request.method!=="GET") {
		sys.puts("handlePollRequest bad request");
		sendCodeResponse(response,500);
		return;
	}
	//Close previous poll response
	if (self.currentPoll!==undefined) {
		previousPoll=self.currentPoll;
		self.currentPoll=undefined;
		previousPoll.writeHead(200,{"Content-Type":self.contentType,"Content-Length":0});
		previousPoll.end("");
	}
	if (self.queue.length>0) {
		sys.puts("LongPoll: Flushing");
		response.writeHead(200,{"Content-Type":self.contentType,"Content-Length":self.queue.reduce(function(prev,cur) { return prev+cur.length; },0)});
		self.queue.forEach(function(data) {
			response.write(data);
		});
		self.queue=[];
		response.end();
		if (self.pollTimer!==undefined) {
			clearTimeout(this.pollTimer);
		}
		self.pollTimer=setTimeout(function() {
			self.onPollTimer();
		},self.pollTimeout);
	} else {
		self.currentPoll=response;
		request.connection.on("end",function() {
			//If this poll is closed, and this was still our current poll
			if (self.currentPoll===response) {
				//Remove it
				self.currentPoll=undefined;
				//Remove timers
				if (self.pollTimer!==undefined) {
					clearTimeout(this.pollTimer);
				}
				//Set new timeout timer
				self.pollTimer=setTimeout(function() {
					self.onPollTimer();
				},self.pollTimeout);
			}
		});
		if (self.pollTimer!==undefined) {
			clearTimeout(this.pollTimer);
		}
		self.pollTimer=setTimeout(function() {
			self.onPollTimer();
		},self.pollTime);
	}
}
/**
 * Close the connection, trigger close event when not already triggered.
 * @author fw@hardijzer.nl
 * @member XhrLongPollConnection
 */
XhrLongPollConnection.prototype.close=function() {
	var previousPoll=this.currentPoll,prevOpen=this.open;
	this.open=false;
	this.queue=[];
	if (this.id!==undefined && this.server!==undefined) {
		this.server.revokePollHandler(this.id);
		this.id=undefined;
		this.server=undefined;
	}
	if (self.pollTimer!==undefined) {
		clearTimeout(this.pollTimer);
	}
	this.currentPoll=undefined;
	if (previousPoll!==undefined) {
		previousPoll.writeHead(200,{"Content-Type":"text/plain","Content-Length":0});
		previousPoll.end("");
	}
	if (prevOpen) {
		this.emit("close");
	}
}
/**
 * Close the connection, trigger close event when not already triggered.
 * @author fw@hardijzer.nl
 * @param {Buffer} buffer Buffer of data to be sent
 * @return true if open, false if not.
 * @type boolean
 * @member XhrLongPollConnection
 */
XhrLongPollConnection.prototype.write=function() {
	sys.puts("LongPoll.write");
	var buf=Buffer.isBuffer(arguments[0])?arguments[0]:((arguments.length>1)?new Buffer(arguments[0],arguments[1]):new Buffer(arguments[0],"utf8")),
		previousPoll=this.currentPoll,
		self=this;
	if (!this.open) {
		sys.puts("LongPoll.write: not open");
		return false;
	}
	if (previousPoll!==undefined) {
		sys.puts("LongPoll.write: sending");
		this.currentPoll=undefined;
		previousPoll.writeHead(200,{"Content-Type":"text/plain","Content-Length":buf.length});
		previousPoll.end(buf);
		if (self.pollTimer!==undefined) {
			clearTimeout(this.pollTimer);
		}
		self.pollTimer=setTimeout(function() {
			self.onPollTimer();
		},self.pollTimeout);
	} else {
		sys.puts("LongPoll.write: queued");
		this.queue.push(buf);
	}
	return true;
}

exports.XhrLongPollConnection=XhrLongPollConnection;