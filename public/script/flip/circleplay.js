var circleplay = {
	fps: 12,
	margin: .05,
	circle_timeline: 0,
	x1: 0,
	x2: 0,
	x3: 0,
	y1: 0,
	y2: 0,
	y3: 0,
	num_pages: 0,
	friction: 400,
	error_margin: 0,
	
	init: function() {
		// only play if there's more than one page
		this.num_pages = flipbook.book.pages.length;
		if (this.num_pages > 1) return true;
	},
	
	activate: function() {
		flipbook.model.set({circleplaying: true});
		
		circleTimeline = book.currentPage;
		$(document).on("mousemove", this, this.go);
		
		flipbook.model.bind('change:circleplaying', this.unbind);
	}, 
	
	deactivate: function() {
		flipbook.model.set({circleplaying: false});
	},
	
	unbind: function() {
		$(document).off("mousemove", this.go);
	},
	
	go: function(e) {
		// 'this' is gone now
		self = e.data;
		
		self.get_timeline_position(e.pageX, e.pageY);
		if (self.circle_timeline%1 < this.margin || self.circle_timeline%1 > 1-this.margin) return;
		
		var page_num = Math.floor(self.circle_timeline);
		flipbook.book.pages.set_active_index(page_num);
	},

	get_timeline_position: function(newX, newY) {
		if (newX == this.x3 && newY == this.y3) return; //safari sometimes fires mousemove twice

		this.x1 = this.x2;
		this.x2 = this.x3;
		this.x3 = newX;
		
		this.y1 = this.y2;
		this.y2 = this.y3;
		this.y3 = newY;
		
		var side1 = Math.sqrt( Math.pow(this.x2 - this.x1, 2) + Math.pow(this.y2 - this.y1, 2) );
		var side2 = Math.sqrt( Math.pow(this.x3 - this.x2, 2) + Math.pow(this.y3 - this.y2, 2) );
		
		var angle = (this.x1-this.x2)*(this.y3-this.y2) - (this.y1-this.y2)*(this.x3-this.x2);
		
		var direction;
		if ( angle > this.error_margin )
			direction = -1;
		else if ( angle < -this.error_margin )
			direction = 1;
		else
			direction = 0;
		
		var speed;
		if (side1 > 0 && side2 > 0) speed = Math.floor(side1 + side2);
		
		var circleSpeed = speed*direction/this.friction;
		if (!circleSpeed) circleSpeed = 0;
		
		this.circle_timeline += circleSpeed;
		
		if (this.circle_timeline > this.num_pages) this.circle_timeline = 0;
		if (this.circle_timeline < 0) this.circle_timeline = this.num_pages;
	}
}
