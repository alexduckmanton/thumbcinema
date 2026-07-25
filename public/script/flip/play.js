var play = {
	fps: 12,
	
	init: function() {
		// only play if there's more than one page
		var num_pages = flipbook.book.pages.length;
		if (num_pages > 1) return true;
	},
	
	activate: function() {
		flipbook.model.set({playing: true});
		this.go();
	}, 
	
	deactivate: function() {
		flipbook.model.set({playing: false});
	},
	
	go: function() {
		var is_playing = flipbook.model.get('playing');
		
		if (is_playing) {
			var current_page = flipbook.book.pages.current_page(),
				last_page = flipbook.book.pages.length-1,
				self = this;
			
			if (current_page < last_page) flipbook.book.next_page();
			else flipbook.book.first_page();
			flipbook.canvas.update();
			
			window.setTimeout(function() {
				self.go();
			}, 1000/self.fps);
		}
	}
}
