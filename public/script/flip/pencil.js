(function() {
	TC.Models.Pencil = Backbone.Model.extend({
		defaults: {
			tool: new Tool(),
			type: 'create',
			flattenDistance: 5,
			color: '#444',
			width: 3,
			min_width: 1,
			max_width: 10,
			shortcuts: [219, 221],
			shortcut_larger: 219,	// [
			shortcut_smaller: 221,	// ]
			join: 'round',
			cap: 'round'
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'shortcuts',
				'decrease_width',
				'increase_width',
				'limit_width',
				'update_pencil_style',
				'init_event_handlers',
				'completePath',
				'activate'
			);
			
			this.update_pencil_style();
			this.path;
			
			if (this.get('type') == 'create') _.defer(this.init_event_handlers);
		},
		
		init_event_handlers: function() {
			var self = this,
				tool = this.get('tool');
			
			tool.onMouseDown = function(event) { self.beginDraw(); }
			tool.onMouseDrag = function(event) { self.dragDraw(event.point); }
			tool.onMouseUp	 = function(event) { self.endDraw(); }
			
			this.on('change:width', this.limit_width);
			this.on('change:width', this.update_pencil_style);
			this.on('shortcuts', this.shortcuts);
		},
		
		shortcuts: function(e) {
			var key = e.keyCode;
			
			switch(key) {
				case 219:
					this.decrease_width();
					break;
				case 221:
					this.increase_width();
					break;
			}
		},
		
		decrease_width: function() {
			var width = this.get('width');
			
			this.set('width', width - 1);
		},
		
		increase_width: function() {
			var width = this.get('width');
			
			this.set('width', width + 1);
		},
		
		limit_width: function() {
			var width = this.get('width'),
				min = this.get('min_width'),
				max = this.get('max_width');
			
			if (width < min) this.set('width', min);
			else if (width > max) this.set('width', max);
		},
		
		update_pencil_style: function() {
			this.pencil_style = {
				strokeColor: this.get('color'),
				strokeWidth: this.get('width'),
				strokeJoin: this.get('join'),
				strokeCap: this.get('cap')
			};
		},
		
		activate: function() {
			this.get('tool').activate();
		},
	
		beginDraw: function() {
			if (this.get('type') == 'create') flipbook.canvas.set_undo();
			
			this.path = new paper.Path();
			this.path.style = this.pencil_style;
		},
		
		dragDraw: function(point) {
			this.path.add(point);
			//this.path.smooth();
		},
		
		endDraw: function() {
			if (this.path.segments.length <= 1) {
				this.path.remove();
				return;
			}
			this.completePath(this.path);
		},
		
		completePath: function(path) {
			var flattenDistance = this.get('flattenDistance');
			
		/* 	path.smooth(); */
			path.flatten(flattenDistance);
			path.name = path.layer.id + '_' + path.id;
		},
		
		deactivate: function() {
			
		},
		
		init: function() {
			clearSelection();
			canvas_layer.activate();
			
			return true;
		}
	});
})();
