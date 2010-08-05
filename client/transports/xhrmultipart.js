(function() {
	//Simple implementation, all events are just callbacks,
	//A wrapper should be used to implement the proper WebSocket API
	/*
		Protocol:
			pulling with query (GET) parameters:
				fallback_transport	xhrm
				xhrm_type			connect
				xhrm_protocol		protocol
				xhrm_random			random string
			posting with query (GET) parameters (but POST method):
				fallback_transport	xhrm
				xhrm_type			send
				xhrm_id				(id from welcome package)
				xhrm_secret			(secret from welcome package)
			Protocol (>> from server, << to server)
				First server probes something, to make sure multiple packets receiving will work
				>> {t:messageTypes.probe}
				Then server sends welcome message
				>> {t:messageTypes.welcome,id:...,secret:...,protocol:...}
				Client either disconnects (unknown protocol), or probes back (can now send with id/secret)
				<< {t:messageTypes.probe}
				Server responds with one more probe to indicate succesful connect
				>> {t:messageTypes.probe}
				Connection made
				strings:
				>> or << {t:messageTypes.data,c:[array of strings]}
	*/
	function createXhr() {
		return new XMLHttpRequest();
	}
	
	function JSONParse(data) {
		if (JSON && JSON.parse)
			return JSON.parse(data);
		return eval(data);
	}
	
	function encodeString(str) {
		str=str.toString();
		if (JSON && JSON.stringify)
			return JSON.stringify(str);
		var unsafe=/[^a-zA-Z0-9\w]/g;
		var hex="0123456789ABCDEF";
		function escaper(chr) {
			chr=chr.charCodeAt(0);
			if (chr<=0xFF)
				return "\\x"+hex[(chr >> 4)&0xF]+hex[(chr >> 0)&0xF]
			else "\\u"+hex[(chr >> 12)&0xF]+hex[(chr >> 8)&0xF]+hex[(chr >> 4)&0xF]+hex[(chr >> 0)&0xF]
		}
		return "\""+str.replace(unsafe,escaper)+"\"";
	}
	
	/**
	 * MultipartPuller: class to simplify multipart XMLHttpRequest pulling.
	 * @author fw@hardijzer.nl
	 * @param {method} any method supported by XMLHttpRequest (e.g. "GET", "POST")
	 * @param {url} URL
	 * @param {sendData} POST data, or null if none.
	 * @constructor
	 */
	function MultipartPuller(method,url,sendData) {
		var xhr=createXhr(),
			parsed=0,
			closed=false,
			self=this,
			hadData=false;
		self.connected=true;
		xhr.open(method,url,true);
		xhr.send(sendData);
		xhr.onreadystatechange=function() {
			var response,data;
			if (closed) {
				//Ignore
				return;
			}
			if (xhr.readyState==4) {
				closed=true;
				self.connected=false;
				self.onclosed((xhr.status==200 || (xhr.status==0 && hadData))?undefined:("HTTP Status code "+xhr.status));
			} else if (xhr.readyState==3) {
				try {
					response=xhr.responseText;
					if (response.length>parsed) {
						data=response.substr(parsed);
						parsed=response.length;
					}
					hadData=true;
				}
				catch(e) {
					closed=true;
					self.connected=false;
					self.onclosed(e.toString());
				}
				if (data!==undefined) {
					try {
						self.ondata(data);
					}
					catch(e) {
						closed=true;
						self.connected=false;
						self.onclosed("ondata error: "+e.toString());
						self.close();
					}
				}
			}
		}
		
		/**
		 * If not closed already, close the connection and emit .onclose(undefined)
		 * @author fw@hardijzer.nl
		 * @member MultipartPuller
		 */
		this.close=function() {
			var oldxhr=xhr;
			if (!closed) {
				closed=true;
				self.connected=false;
				self.onclosed(undefined);
			}
			if (oldxhr) {
				xhr=undefined;
				oldxhr.onreadystatechange=function(){};
				setTimeout(function() {
					if (oldxhr.readyState!=4)
						oldxhr.abort();
					xhr=undefined;
				},1);
			}
		}
	}
	/**
	 * Event on new data received
	 * @member MultipartPuller
	 * @author fw@hardijzer.nl
	 * @param {data} String containing new data
	 */
	MultipartPuller.prototype.ondata=function(data) {};
	/**
	 * Event on new data received
	 * @member MultipartPuller
	 * @author fw@hardijzer.nl
	 * @param {error} undefined or error string
	 */
	MultipartPuller.prototype.onclosed=function(error) {};
	
	
	/**
	 * MultipartJsonPuller, similar to MultipartPuller, but ondata event now gets an object.
	 * @author fw@hardijzer.nl
	 * @see MultipartPuller
	 * @constructor
	 */
	function MultipartJsonPuller(method,url,sendData) {
			var self=this,
				puller=new MultipartPuller(method,url,sendData),
				closed=false,
				buffer="";
			self.connected=true;
			
			puller.ondata=function(data) {
				var split,line,obj;
				buffer+=data;
				while (!closed) {
					split=buffer.indexOf("\n");
					if (split==-1) {
						break;
					}
					line=buffer.substr(0,split);
					buffer=buffer.substr(split+1);
					line=line.replace(/\r^/,"");
					obj=undefined;
					try {
						obj=JSONParse(line);
					}
					catch(e) {
						closed=true;
						self.connected=false;
						puller.close();
						self.onclose("JSON error: "+e.toString());
						return;
					}
					if (typeof(obj)!="object") {
						closed=true;
						self.connected=false;
						puller.close();
						self.onclose("Received value is not an object but "+typeof(obj));
						return;
					}
					try {
						self.ondata(obj);
					}
					catch(e) {
						if (!closed) {
							closed=true;
							self.connected=false;
							puller.close();
							self.onclose("ondata error: "+e.toString());
						}
					}
				}
			}
			
			puller.onclosed=function(reason) {
				if (!closed) {
					closed=true;
					self.connected=false;
					self.onclosed(reason);
				}
				puller=undefined;
			}
			
			this.close=function() {
				if (!puller)
					return false;
				puller.close();
			}
	}
	MultipartJsonPuller.prototype.ondata=function(obj){};
	MultipartJsonPuller.prototype.onclosed=function(error){};
	
	function simpleHttpRequest(method,url,sendData,timeout,callback) {
		var xhr=createXhr(),
			response,
			success=false,
			timer;
		if (timeout>0) {
			timer=setTimeout(function() {
				xhr.onreadystatechange=function(){};
				xhr.abort();
				callback("Timed out");
			},timeout);
		}
		xhr.open(method,url,true);
		xhr.send(sendData);
		xhr.onreadystatechange=function() {
			if (xhr.readyState==4) {
				if (timer!==undefined) {
					clearTimeout(timer);
				}
				xhr.onreadystatechange=function() {};
				if (xhr.status==200) {
					try {
						response=xhr.responseText;
						success=true;
					}
					catch(e) {
						callback("Error: "+e.toString());
					}
					if (success) {
						setTimeout(function() {
							callback(undefined,response);
						},500);
					}
				} else {
					callback("HTTP Error: "+xhr.status);
				}
			}
		}
	}
	
	/**
	 * QuickChain
	 */
	function QuickChain() {
		var callback=arguments[arguments.length-1],
			funcs=Array.prototype.slice.call(arguments,0,arguments.length-1),
			i=0;
		function next(err) {
			var args;
			if (err!==undefined || i>=funcs.length) {
				callback.apply({},Array.prototype.slice.call(arguments,0));
			} else {
				funcs[i++].apply(next,Array.prototype.slice.call(arguments,1));
			}
		}
		next(undefined);
	}
	
	/**
	 * QuickPar
	 */
	function QuickPar() {
		var callback=arguments[arguments.length-1],
			failed=false,
			todo=arguments.length-1,
			ret=[undefined],
			i;
		function createCallback(i) {
			return function(err) {
				if (failed) {
					return;
				}
				if (err) {
					failed=true;
					callback(err);
				}
				ret[i+1]=Array.prototype.slice.call(arguments,1);
				if (--todo == 0) {
					failed=true;
					callback.apply({},ret);
				}
			}
		}
		for (i=0; i<arguments.length-1; i++) {
			arguments[i].call(createCallback(i));
		}
	}
	
	function QuickPrefix(callback) {
		var topargs=Array.prototype.slice.call(arguments,1);
		return function() {
			var args=[arguments[0]].concat(topargs,Array.prototype.slice.call(arguments,1));
			return callback.apply(this,args);
		}
	}
	
	var messageTypes={
		probe: 0,
		welcome: 1,
		connected: 2,
		data: 3
	};
	
	function getSingleMessage(puller,filter,timeout,callback) {
		var timer,
			oldondata=puller.ondata,
			oldonclosed=puller.onclosed;
		if (!puller.connected) {
			callback("Connection closed");
			return;
		}
		if (timeout) {
			timer=setTimeout(function() {
				puller.ondata=oldondata;
				puller.onclosed=oldonclosed;
				callback("Timeout");
			},timeout);
		}
		puller.ondata=function(obj) {
			if (timer!==undefined) {
				clearTimeout(timer);
			}
			puller.ondata=oldondata;
			puller.onclosed=oldonclosed;
			if (filter(obj)) {
				callback(undefined,obj);
			} else {
				callback("Unexpected message");
			}
		};
		puller.onclose=function(error) {
			if (timer!==undefined) {
				clearTimeout(timer);
			}
			puller.ondata=oldondata;
			puller.onclosed=oldonclosed;
			callback("Closed: "+error);
		};
	}
	function getProbeMessage(puller,timeout,callback) {
		return getSingleMessage(
			puller,
			function(obj) {
				return ((typeof(obj)=="object") && obj.t==messageTypes.probe);
			},
			timeout,
			function(err,obj) {
				callback(err);
			}
		);
	}
	function getWelcomeMessage(puller,timeout,callback) {
		return getSingleMessage(
			puller,
			function(obj) {
				return ((typeof(obj)=="object") && obj.t==messageTypes.welcome);
			},
			timeout,
			function(err,obj) {
				if (err!=undefined) {
					return callback(err);
				}
				return callback(err,obj.id,obj.secret,obj.protocol);
			}
		);
	}

	function XhrMultipartSocket(url,protocol) {
		var self=this,
			connected=false,
			aborted=false,
			sendQueue=[],
			closeCallback=undefined,
			sendCallback=undefined;
		if (url.substr(0,5).toLowerCase()=="ws://") {
			url="http://"+url.substr(5);
		} else if (url.substr(0,6).toLowerCase()==="wss://") {
			url="https://"+url.substr(6);
		}
		
		self.close=function() {
			return closeCallback.apply(this,arguments);
		}
		self.send=function() {
			return sendCallback.apply(this,arguments);
		}
		
			
		function createPullUrl() {
			return url+((url.indexOf("?")==-1)?"?":"&")+
					"fallback_transfer=xhrm"+
					"&xhrm_type=connect"+
					"&xhrm_protocol="+escape(protocol)+
					"&xhrm_random="+escape(Math.random());
		}
		
		function createSendUrl(id,secret) {
			return url+((url.indexOf("?")==-1)?"?":"&")+
					"fallback_transfer=xhrm"+
					"&xhrm_type=send"+
					"&xhrm_id="+escape(id)+
					"&xhrm_secret="+escape(secret)+
					"&xhrm_random="+escape(Math.random());
		}
		
		//Initialization sequence
		QuickChain(
			function() {
				//Step 1: Create a multipart puller
				var puller=new MultipartJsonPuller("GET",createPullUrl(),null);
				//Step 1b: Create a close function for during initialization
				closeCallback=function() {
					self.readyState=self.CLOSING;
					aborted=true;
					puller.close();
				}
				//Step 2: Create a send function for during initialization
				sendCallback=function(s) {
					s=s.toString();
					bufferedAmount+=s.length;
					sendQueue.push(s);
				}
				this(undefined,puller);
			},
			function(puller) {
				//Wait 5 seconds for one probe message
				getProbeMessage(puller,5000,QuickPrefix(this,puller));
			},
			function(puller) {
				//Wait 5 seconds for one welcome message
				getWelcomeMessage(puller,5000,QuickPrefix(this,puller));
			},
			function(puller,id,secret,responseProtocol) {
				//Check protocol
				if (protocol && protocol!=responseProtocol) {
					this("Protocol does not match");
					return;
				}
				//Because the getProbeMessage listeners can return earlier than the simpleHttpRequest, collect any messages that slip through in that time.
				var collected=[];
				puller.ondata=function(o) {
					collected.push(o);
				}
				//In parralel:
				//	Send a probe
				//	Wait for response probe
				QuickPar(
					function() {
						return getProbeMessage(puller,5000,this);
					},
					function() {
						simpleHttpRequest(
							"POST",
							createSendUrl(id,secret),
							"{\"t\":"+messageTypes.probe+"}\n",
							5000,
							this);
					},
					QuickPrefix(this,puller,collected,id,secret,responseProtocol)
				);
			},
			function(err,puller,collected,id,secret,protocol) {
				var i;
				if (err || !puller.connected) {
					self.readyState=self.CLOSED;
					if (!aborted && typeof(self.onerror)=="function") {
						self.onerror({message:err});
					}
					if (typeof(self.onclose)=="function") {
						self.onclose({was_clean:aborted});
					}
				} else {
					var open=true;
					self.readyState=self.OPEN;
					self.protocol=protocol;
					//Set up events and stuff
					var sending=false;
					function ensureSending() {
						if (!open || self.readyState!=self.OPEN || sendQueue.length<1 || sending)
							return;
						sending=true;
						var p="{\"t\":"+messageTypes.data+",\"c\":[",
							s=sendQueue,
							unbuffer=0,
							i;
						sendQueue=[];
						for (i=0; i<s.length; i++) {
							unbuffer+=s[i].length;
							p+=((i===0)?"":",")+encodeString(s[i]);
						}
						p+="]}\n";
						simpleHttpRequest(
							"POST",
							createSendUrl(id,secret),
							p,
							10000,
							function(err) {
								if (err!==undefined) {
									if (self.readyState!==self.CLOSED) {
										self.readyState==self.CLOSED;
										if (typeof(self.onerror)==="function") {
											self.onerror({});
										}
										if (typeof(self.onclose)==="function") {
											self.onclose({was_clean: false});
										}
									}
								} else {
									sending=false;
									ensureSending();
								}
							}
						);
					}
					
					sendCallback=function(s) {
						s=s.toString();
						self.bufferedAmount+=s.length;
						sendQueue.push(s);
						ensureSending();
					}
					closeCallback=function() {
						if (self.readyState==self.OPEN) {
							self.readyState==self.CLOSING;
							puller.close();
						}
					}
					function onClosed(err) {
						if (self.readyState!=self.CLOSED) {
							self.readyState=self.CLOSED;
							if (err!==undefined && typeof(self.onerror)=="function") {
								self.onerror({});
							}
							if (typeof(self.onclose)=="function") {
								self.onclose({was_clean: (err==undefined)});
							}
						}
					}
					function onData(d) {
						var i;
						if (d.t == messageTypes.data && typeof(d.c)=="object" && d.c instanceof Array) {
							for (i=0; (self.readyState === self.OPEN || self.readyState === self.CLOSING) && i<d.c.length; i++) {
								if (typeof(d.c[i])==="string" && typeof(self.onmessage)==="function") {
									self.onmessage({data:d.c[i]});
								}
							}
						} else {
							//TODO: Throw error
						}
					}
					puller.ondata=onData;
					puller.onclosed=onClosed;
					
					if (typeof(self.onopen)=="function") {
						self.onopen({});
					}
					for (i=0; i<collected.length; i++) {
						onData(collected[i]);
					}
				}
			}
		)
	}
	XhrMultipartSocket.prototype.CONNECTING=0;
	XhrMultipartSocket.prototype.OPEN=1;
	XhrMultipartSocket.prototype.CLOSING=2;
	XhrMultipartSocket.prototype.CLOSED=3;
	XhrMultipartSocket.prototype.readyState=XhrMultipartSocket.prototype.CONNECTING;
	XhrMultipartSocket.prototype.protocol="";
	XhrMultipartSocket.prototype.bufferedAmount=0;
	
	XhrMultipartSocket.prototype.send=function(data) {}; //Stub
	XhrMultipartSocket.prototype.close=function() {}; //Stub
	
	window.XhrMultipartSocket=XhrMultipartSocket;
})();