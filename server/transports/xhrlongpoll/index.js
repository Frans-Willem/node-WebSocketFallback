var XhrLongPollServer=require("./XhrLongPollServer").XhrLongPollServer;

exports.createServer=function() {
	return new XhrLongPollServer();
}