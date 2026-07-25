(function() {
	// model for book
	TC.Models.Book = Backbone.Model.extend({
	
	});
	
	// view for all pages
	TC.Views.Book = Backbone.View.extend({
		id: 'pages',
		
		initialize: function() {
			_.bindAll(
				this,
				'render',
				'draw_active_page',
				'add_page',
				'add_blank_page',
				'add_duplicate_page',
				'animate_add_page',
				'remove_page',
				'update_onion',
				'update_pages_position', 
				'set_current_layer', 
				'previous_page', 
				'next_page',
				'first_page',
				'go_to',
				'toggle_playing',
				'update_segment_count',
				'update_close_warning'
			);
			
			// make the flipbook available
			this.flipbook = this.model.get('flipbook');
			
			// system layers like guide and selection. used to get correct paper layer index when compared to normal page num
			this.system_layers = paper.project.layers.length - 1;
			
			// collection for pages
			this.pages = new TC.Collections.Pages();
			
			//init the first page
			var first_page = new TC.Models.Page({
				active: true
			});
			this.pages.add(first_page);
			
			// add first page to dom
			var first_page_view = new TC.Views.Page({
				model: first_page
			});
			$(this.el).append(first_page_view.render().el);
			
			this.pages.on('new_active',	this.clear_selection);
			
			this.pages.on('add',		this.draw_active_page);
			this.pages.on('add',		this.add_page);
			this.pages.on('add',		this.update_onion);
			this.pages.on('removed',	this.update_onion);
			this.pages.on('removed',	this.remove_page);
			this.pages.on('new_active',	this.update_onion);
			this.pages.on('new_active',	this.set_current_layer);
			this.pages.on('new_active',	this.update_pages_position);
			this.pages.on('new_page',	this.update_pages_position);
			this.pages.on('removed',	this.update_pages_position);
			this.pages.on('update',		this.update_pages_position);
			
			this.pages.on('add',		this.update_close_warning);
			this.pages.on('removed',	this.update_close_warning);
			
			this.on('prev',				this.previous_page);
			this.on('next',				this.next_page);
			
			this.model.get('flipbook').on('play',	this.toggle_playing);
			this.model.get('flipbook').on('play',	this.hide_onion);
			
			this.model.get('flipbook').on('pause',	this.toggle_playing);
			this.model.get('flipbook').on('pause',	this.update_onion);
			
			// when finished drawing, update the current page's segment count. highest count used for thumbnails
			this.flipbook.canvas.on('post_draw',	this.update_segment_count);
			
			// animations
			this.pages.on('add',	this.animate_add_page);
			
			// give initial position to page container
			var self = this;
			window.setTimeout(function() { self.update_pages_position(); }, 0);
		},
		
		render: function() {
			return this;
		},
		
		clear_selection: function() {
			clearSelection();
		},
		
		update_segment_count: function() {
			this.pages.get_active().trigger('post_draw');
		},
		
		update_close_warning: function() {
			if (this.model.get('flipbook').model.get('type') == 'playback') return;
			var num_pages = this.pages.length;
			
			if (num_pages > 1) {
				window.onbeforeunload = function(e) { return "Whoa, you haven't saved your flipbook yet."; };
			} else {
				window.onbeforeunload = null;
			}
		},
		
		animate_add_page: function(new_page) {
			if (flipbook.data.model.get('loading')) return;
			
			var is_duplicate = new_page.get('is_duplicate'),
				active_page = $(this.el).find('.active'),
				prev_active = active_page.prev(),
				main_canvas = $(this.model.get("flipbook").canvas.el),
				self = this;
			
			// outgoing page
			prev_active.find("canvas").do_a_("newPageIcon", {freeze: true});
			
			var canvas_animation = "newPage";
			
			// incoming page
			if (is_duplicate) {
				canvas_animation = "nudge";
			}
			
			main_canvas.do_a_(canvas_animation, {
				callback: function() {
					self.pages.unfreeze_all();
					self.pages.trigger('added');
				}
			});
			this.pages.freeze_next_pages();
		},
		
		add_page: function(new_page) {
			var is_duplicate = new_page.get('is_duplicate'),
				active_page = $(this.el).find('.active'),
				active_canvas = active_page.children('canvas');
			
			transform.hideSelection();
			
			// add either a blank or duplicate layer to the paper project
			is_duplicate ? this.add_duplicate_page(new_page) : this.add_blank_page(new_page);
			
			// if duplicating, pass the duplicated canvas element, so it can be drawn to the new canvas
			is_duplicate ? new_page.set({'duplicate_el': active_canvas[0]}) : new_page.set({'duplicate_el': false});
			
			//create the new page view and add it to the dom, either before or after the active page
			var page = new TC.Views.Page({
				model: new_page
			});
			is_duplicate ? active_page.before(page.render().el) : active_page.after(page.render().el);
			
			canvas_layer.activate();
			transform.showSelection();
		},
		
		add_blank_page: function(new_page) {
			this.clear_selection();
			
			var current_page = this.pages.current_page() + this.system_layers;
			
			canvas_layer.visible = false;
			this.pages.set_active(new_page);
			
			canvas_layer = new Layer();
			canvas_layer.moveAbove(paper.project.layers[current_page]);
			canvas_layer.name = canvas_layer.id;
		},
		
		add_duplicate_page: function(new_page) {
			// need to freeze the current page before anything happens so it doesn't jump around the UI
			this.pages.freeze_current();
			
			// new page model has already been added, so need to subtract 1 to adjust for this
			var current_layer = this.pages.current_page() + this.system_layers - 1;

			// copy the current layer and move the new one before it
			var new_layer = project.layers[current_layer].clone();
			new_layer.moveAbove(project.layers[current_layer-1]);
/* 			new_layer.name = new_layer.id; */
			
			// copy selection to current (now previous) page
			for (var i = 0; i < selection_layer.children.length; i++) {
				selection_layer.children[i].copyTo(new_layer);
			}
			
			// reset opacity of current (now previous) layer in case it had a selection
			new_layer.opacity = 1;
			new_layer.visible = false;
			
			// paperjs activates the new layer by default, so re-activate the canvas layer
			canvas_layer.activate();
		},
		
		remove_page: function(deleted_index) {
			var deleted_layer = deleted_index + this.system_layers;
			
			clearSelection();
			project.layers[deleted_layer].remove();
		},
		
		draw_active_page: function() {
			var active_page = this.pages.get_active();
			
			transform.hideSelection();
			active_page.trigger('draw');
			transform.showSelection();
		},
		
		update_pages_position: function() {
			var current_page = this.pages.current_page(),
				canvas_width = flipbook.canvas.model.get('width'),
				canvas_margin = flipbook.canvas.model.get('margin');
			
			var new_pos = flipbook.canvas.x - canvas_margin - current_page*(canvas_width + canvas_margin*2);
			$(this.el).css('left', new_pos);
		},
		
		set_current_layer: function() {
			var active_page = $(this.el).find('.active');
			if (active_page.length) {
				
				// hide the old canvas layer
				if (flipbook.is_playing() || canvas_layer != onion_layer) canvas_layer.visible = false;
				
				// set current page in paperjs project
				var current_page = this.pages.current_page(),
					current_layer = current_page + this.system_layers;
				canvas_layer = paper.project.layers[current_layer];
				canvas_layer.opacity = 1;
				canvas_layer.visible = true;
				canvas_layer.activate();
				
				flipbook.canvas.update();
			}
		},
		
		clear_onion: function() {
			onion_layer = {};
		},
		
		update_onion: function() {
			if (flipbook.is_playing() || flipbook.model.get('type') == 'playback') return;
			
			var current_page = this.pages.current_page(),
				current_layer = current_page + this.system_layers;
			
			if (current_page > 0) {
				this.hide_onion();
				onion_layer = project.layers[current_layer-1];
				this.show_onion();
			} else {
				this.hide_onion();
				this.clear_onion();
			}
		},
		
		hide_onion: function() {
			if (onion_layer == canvas_layer) return;

			onion_layer.opacity = 1;
			onion_layer.visible = false;
			flipbook.canvas.update();
		},
		
		show_onion: function() {
			onion_layer.opacity = .1;
			onion_layer.visible = true;
			flipbook.canvas.update();
		},
		
		previous_page: function() {
			var current_page = this.pages.current_page();
			this.pages.set_active_index( current_page - 1 );
		},
		
		next_page: function() {
			var current_page = this.pages.current_page();
			this.pages.set_active_index( current_page + 1 );
		},
		
		first_page: function() {
			this.pages.set_active_index( 0 );
		},
		
		go_to: function(page_index) {
			this.pages.set_active_index( page_index );
		},
		
		toggle_playing: function() {
			var flipbook = this.model.get('flipbook'),
				is_playing = flipbook.model.get('playing') || flipbook.model.get('circleplaying');
			
			if (is_playing) $(this.el).addClass('playing');
			else $(this.el).removeClass('playing');
		}
	});
})();
