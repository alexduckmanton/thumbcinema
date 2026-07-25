var duplicate = {
	init: function() {
		return true;
	},
	
	activate: function() {
		var current_page = flipbook.book.pages.current_page();
		
		flipbook.book.pages.add({'is_duplicate': true}, {at: current_page});
		
		// tool is done now, so need to deactivate it
		flipbook.toolbox.deactivate(this);
	}, 
	
	deactivate: function() {
		
	}
}
