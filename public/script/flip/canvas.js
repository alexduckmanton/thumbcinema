(function() {
	// canvas model
	TC.Models.Canvas = Backbone.Model.extend({
		defaults: {
			margin: 10,
			width: 640,
			height: 360
		}
	});
	
	// canvas view
	TC.Views.Canvas = Backbone.View.extend({
		tagName: 'canvas',
		id: 'activePage',
		
		events: {
			'mousedown':	'pre_draw',
			'mouseup':		'post_draw'
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'hide',
				'show',
				'render',
				'update',
				'clear',
				'pre_draw',
				'post_draw',
				'set_undo',
				'clear_undo',
				'undo',
				'undo_draw',
				'undo_transform',
				'swap_layers'
			);

			$(this.el).attr('width', this.model.get('width'));
			$(this.el).attr('height', this.model.get('height'));
			this.canvas_el = $(this.el)[0];
		},
		
		hide: function() {
			$(this.el).css('opacity', 0);
		},
		
		show: function() {
			$(this.el).css('opacity', 1);
		},
		
		render: function() {
			return this;
		},
		
		update: function() {
			this.canvas_el.width = this.canvas_el.width;
			paper.view.draw();
		},
		
		clear: function() {
			this.canvas_el.width = this.canvas_el.width;
		},
		
		pre_draw: function(e) {
			flipbook.pause();
		},
		
		post_draw: function(e) {
			var self = this;
			
			//need a delay to make sure it runs after paper.js's mouseup event
			window.setTimeout(function() {
				flipbook.book.draw_active_page();
				self.trigger('post_draw');
			}, 0);
		},
		
		set_undo: function() {
			var active_layer = project.activeLayer;
			
			if (project.activeLayer == canvas_layer) {
				this.model.set({undo_state: 'draw'});
			} else if (project.activeLayer == selection_layer || project.activeLayer == guide_layer) {
				this.model.set({undo_state: 'transform'});
			}
			
			if (project.activeLayer == guide_layer) active_layer = selection_layer;
			
			this.copy_children(active_layer, undo_layer);
			
			// mark as copy if necessary
			if (Key.isDown('alt') || Key.isDown('option'))
				undo_layer.lastChild.name = "duplicate";
		},
		
		clear_undo: function() {
			this.model.set({'undo_state': false});
		},
		
		undo: function() {
			var undo_state = this.model.get('undo_state');
			if (!undo_state) return;
			
			if (undo_state == 'draw') this.undo_draw();
			else if (undo_state == 'transform') this.undo_transform();
			
			flipbook.canvas.update();
		},
		
		undo_draw: function() {
			this.swap_layers(canvas_layer, undo_layer);
			canvas_layer.activate();
		},
		
		undo_transform: function() {
			if (!undo_layer.children.length) {
				this.swap_layers(selection_layer, undo_layer);
				clearSelection();
			} else if (undo_layer.lastChild.name == 'duplicate') {
				undo_layer.removeChildren();
				this.swap_layers(selection_layer, undo_layer);
				clearSelection();
			} else {
				this.swap_layers(selection_layer, undo_layer);
				
				if (transformType == "push") {
					nudge.deactivate();
					transformType = "push"; // deactivating nudge resets transform type, so need to set to push again
					nudge.init();
				} else {
					resetSelection();
					selection_layer.activate();
				}
			}
		},
		
		swap_layers: function(layer1, layer2) {
			var tempLayer = new Layer();
			
			this.copy_children(layer1, tempLayer);
			this.copy_children(layer2, layer1);
			this.copy_children(tempLayer, layer2);
			
			tempLayer.remove();
		},
		
		copy_children: function(from_layer, to_layer, clear) {
			if (clear == null) clear = true;
			
			if (clear) to_layer.removeChildren();
			for (var i = 0; i < from_layer.children.length; i++) {
				from_layer.children[i].copyTo(to_layer);
			}
		}
	});
})();
