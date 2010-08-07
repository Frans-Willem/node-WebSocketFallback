var XhrMultipartServer=require("./XhrMultipartServer").XhrMultipartServer;

exports.createServer=function() {
	return new XhrMultipartServer()
}