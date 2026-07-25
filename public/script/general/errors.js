(function() {
	window.onerror = function (errorMsg, url, lineNumber, column) {
		// push error to google analytics
		_gaq.push(['_trackEvent', 'Error', errorMsg, url + ": " + lineNumber + ", " + column]);
		
		// clear localStorage incase the recover tool fails
		localStorage.removeItem('flipbook');
		
		flipbook.model.trigger('recover');
		
	    return false;
	}
})();