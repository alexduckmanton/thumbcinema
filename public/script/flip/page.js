(function() {
	// page model
	TC.Models.Page = Backbone.Model.extend({
		defaults: {
			active: false,
			is_duplicate: false,
			frozen: false,
			num_segments: 0
		}
	});
	
	// page view
	TC.Views.Page = Backbone.View.extend({
		className: 'page',
		
		events: function() {
			return Modernizr.touch ? {
				'touchstart': 'activate'
			} : {
				'click': 'activate'
			}
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'render',
				'update_segment_count',
				'activate',
				'toggle_active',
				'animate_remove',
				'focus_from_right',
				'focus_from_left',
				'init_remove',
				'toggle_freeze',
				'freeze',
				'unfreeze'
			);
			
			// set to active if needed
			if (this.model.get('active')) $(this.el).addClass('active');
			
			// add canvas to container. set whether or not it's a duplicate
			var canvas_model = new TC.Models.Canvas({ 'duplicate_el': this.model.get('duplicate_el') });
			this.canvas = new TC.Views.PageCanvas({ model: canvas_model });
			$(this.el).append(this.canvas.render().el);
			
			this.model.bind('change:active', this.toggle_active);
			this.model.bind('draw', this.canvas.draw_active_page);
			this.model.bind('remove', this.animate_remove);
			this.model.bind('remove_animation_complete', this.init_remove);
			this.model.bind('change:frozen', this.toggle_freeze);
			
			this.model.on('focus_from_right', this.focus_from_right);
			this.model.on('focus_from_left', this.focus_from_left);
			
			this.model.on('post_draw', this.update_segment_count);
			
			// remove unnecessary vars
			this.model.unset('duplicate_el');
			
			this.model.collection.trigger('new_page');
		},
		
		render: function() {
			return this;
		},
		
		update_segment_count: function() {
			var children = canvas_layer,
				count = 0;
			
			for (var i = 0; i < children.length; i++) {
				count += children[i].segments.length;
			}
			
			this.model.set('num_segments', count);
		},
		
		activate: function() {
			if (flipbook.is_blocked()) return;
			
			this.model.collection.set_active(this.model);
		},
		
		toggle_active: function() {
			var is_active = this.model.get('active');
			
			if (is_active) {
				$(this.el).addClass('active');
				this.model.collection.trigger('new_active');
			} else
				$(this.el).removeClass('active');
		},
		
		focus_from_right: function() {
			$(this.canvas.el).do_a_('focusPrevThumb', { freeze: true });
		},
		
		focus_from_left: function() {
			$(this.canvas.el).do_a_('focusNextThumb', { freeze: true });
		},
		
		animate_remove: function() {
			var is_last = $(this.el).is(":last-child");
			
			if (!is_last) this.model.collection.freeze_prev_pages();
			
			var self = this,
				transition_duration = $("#pages").css('transition-duration');
			$(this.canvas.el).do_a_("deletePage", {
				freeze: true,
				reset: false,
				completion_buffer: 250,
				event_element: this.model,
				completion_event: 'remove_animation_complete',
				callback: function() {
					$("#pages").css({
						"transition-duration": "0s",
						"-o-transition-duration": "0s",
						"-moz-transition-duration": "0s",
						"-webkit-transition-duration": "0s"
					});
					window.setTimeout(function() { $("#pages").css({
						"transition-duration": transition_duration,
						"-o-transition-duration": transition_duration,
						"-moz-transition-duration": transition_duration,
						"-webkit-transition-duration": transition_duration
					}); }, 0);
					
					flipbook.book.pages.unfreeze_all();
				}
			});
			
		},
		
		init_remove: function() {
			flipbook.book.pages.trigger('removed', $(this.el).prevAll().length);
			this.remove();
		},
		
		toggle_freeze: function() {
			if (this.model.get('frozen')) this.freeze();
			else this.unfreeze();
		},
		
		freeze: function() {
			var frozen_page = this.model.collection.indexOf(this.model),
				current_page = this.model.collection.current_page(),
				left_offset = (frozen_page > current_page) ? $(this.el).outerWidth(true) : 0;
			
			$(this.canvas.el).css({
				"transition-duration": "0s",
				"-o-transition-duration": "0s",
				"-moz-transition-duration": "0s",
				"-webkit-transition-duration": "0s",
				"position": "fixed",
				"z-index": 10,
				"top": $(this.canvas.el).offset().top,
				"left": $(this.canvas.el).offset().left - left_offset
			});
		},
		
		unfreeze: function() {
			$(this.canvas.el).removeAttr('style');
		}
	});
	
	// page canvas view
	TC.Views.PageCanvas = Backbone.View.extend({
		tagName: 'canvas',
		
		initialize: function() {
			_.bindAll(this, 'render', 'draw_active_page', 'draw', 'clear');
			
			$(this.el).attr('width', this.model.get('width'));
			$(this.el).attr('height', this.model.get('height'));
			
			this.canvas_el = $(this.el)[0]
			this.context = this.canvas_el.getContext('2d');
			
			// if duplicating, draw the specified page image
			var duplicate_el = this.model.get('duplicate_el');
			if (duplicate_el) this.draw(duplicate_el);
			
			// remove unnecessary vars
			this.model.unset('duplicate_el');
		},
		
		render: function() {
			return this;
		},
		
		draw_active_page: function() {
			flipbook.book.hide_onion();
			
			//make sure the main canvas is up to date
			flipbook.canvas.update();
			
			this.draw(flipbook.canvas.canvas_el);
			
			flipbook.book.show_onion();
		},
		
		draw: function(el) {
			this.clear();
			this.context.drawImage(el, 0, 0);
		},
		
		clear: function() {
			this.canvas_el.width = this.canvas_el.width;
		}
	});
})();
