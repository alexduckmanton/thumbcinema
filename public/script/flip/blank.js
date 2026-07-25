var blank = {
	init: function() {
		return true;
	},
	
	activate: function() {
		var current_page = flipbook.book.pages.current_page();
		
		flipbook.book.pages.add({}, {at: current_page+1});
		
		// tool is done now, so need to deactivate it
		flipbook.toolbox.deactivate(this);
	}, 
	
	deactivate: function() {
		
	}
}
