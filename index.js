function log() {
	var str=Array.prototype.join.call(arguments," ");
	var div=document.createElement("div");
	div.appendChild(document.createTextNode(str));
	document.getElementById("console").appendChild(div);
}

window.onload=function() {
	log ("Connecting to "+"ws://"+document.location.host+"/connectHere");
	var ws=new WebSocket("ws://"+document.location.host+"/connectHere");
	ws.onopen=function(event) {
		log("onOpen",arguments.length);
	}
	ws.onmessage=function(event) {
		log("onMessage",arguments.length,event.data);
		ws.send("Echo: "+event.data);
		ws.send("Multiple packets");
		setInterval(function() {
			ws.send("Multiple packets delayed 1");
			ws.send("Multiple packets delayed 2");
		},500);
	}
	ws.onerror=function(event) {
		log("onError");
	}
	ws.onclose=function(event) {
		log("onClose",arguments.length,event.wasClean);
	}
}