var delete_page = {
	init: function() {
		return true;
	},
	
	activate: function() {
		var deleted_page = flipbook.book.pages.get_active();

		// activate a sibling page
		if (flipbook.book.pages.length-1) flipbook.book.pages.activate_sibling(deleted_page);
		
		// or if there's only one page, add a new one so the container is never empty
		else flipbook.book.pages.add({}, {at: 1});
		
		// delete the page
		flipbook.book.pages.remove(deleted_page);
		
		// tool is done now, so need to deactivate it
		flipbook.toolbox.deactivate(this);
	}, 
	
	deactivate: function() {
		
	}
}



