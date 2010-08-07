function log() {
	var str=Array.prototype.join.call(arguments," ");
	var div=document.createElement("div");
	div.appendChild(document.createTextNode(str));
	document.getElementById("console").appendChild(div);
}
window.log=log;

window.onload=function() {
	var ws=new WebSocket("ws://"+document.location.host+"/connectHere","sample");
	//var ws=new XhrMultipartSocket("ws://"+document.location.host+"/connectHere","sample");
	//var ws=new XhrLongpollSocket("ws://"+document.location.host+"/connectHere","sample");
	log("Connecting to "+document.location.protocol+"//"+document.location.host+"/connectHere with "+ws.constructor.name);
	var interval;
	ws.onopen=function(event) {
		log("onOpen",arguments.length);
		ws.send("Multiple packets");
		var pack=1;
		interval=setInterval(function() {
			ws.send("Multiple packets delayed "+(pack++)+"\uFFFF");
		},250);
	}
	var received=0;
	ws.onmessage=function(event) {
		if (received++ == 10) {
			ws.close();
			clearInterval(interval);
			return;
		}
		log("onMessage",arguments.length,event.data);
		ws.send("Echo: "+event.data+"\uFFFF");
	}
	ws.onerror=function(event) {
		log("onError");
	}
	ws.onclose=function(event) {
		log("onClose",arguments.length,event.wasClean);
		if (interval!==undefined) {
			clearInterval(interval);
			interval=undefined;
		}
	}
}