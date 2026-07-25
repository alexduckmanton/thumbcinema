paper.install(window);

(function(window) {
	var TC = {
		Models: {},
		Collections: {},
		Views: {}
	};
	
	window.TC = TC;
})(window);

(function() {		
	TC.Models.Flipbook = Backbone.Model.extend({
		defaults: {
			active: true,
			playing: false,
			circleplaying: false,
			logged_in: true,
			type: 'create',
			is_touch: false,
			data_json: false,
			data_xml: false,
			post_id: "",
			animation_count: 0,
			loading: false
		},
		
		increment_animation_count: function() {
			this.set('animation_count', this.get('animation_count') + 1);
		},
		
		decrement_animation_count: function() {
			this.set('animation_count', this.get('animation_count') - 1);
		}
	});
	
	// app view
	TC.Views.Flipbook = Backbone.View.extend({
		el: $(document),
		
		events: {
			'keydown': 'keyboard_shortcuts'
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'recover',
				'block_ui',
				'unblock_ui',
				'is_blocked',
				'deactivate',
				'activate',
				'render',
				'toggle_playing',
				'on_play',
				'on_pause',
				'pause',
				'init_tools',
				'keyboard_shortcuts',
				'toggle_loading',
				'loading',
				'loaded'
			);
			
			this.canvas = new TC.Views.Canvas({
				model: new TC.Models.Canvas({undo_state: false})
			});
			
			//add canvas view to dom
			$('#book', this.el).append(this.canvas.render().el);
			this.canvas.x = $(this.canvas.el).offset().left;
			this.canvas.y = $(this.canvas.el).offset().top;
			
			//init paper.js
			paper.setup("activePage");
			
			//init layers
			guide_layer = new Layer();
			guide_layer.name = guide_layer.id;
			undo_layer = new Layer();
			undo_layer.visible = false;
			undo_layer.name = undo_layer.id;
			canvas_layer = new Layer();
			canvas_layer.name = canvas_layer.id;
			onion_layer = {};
			selection_layer = paper.project.layers[0];
			selection_layer.name = selection_layer.id;
			selection_layer.applyMatrix = true;
			canvas_layer.activate();
			
			//init backbone pages/layers collection
			this.book = new TC.Views.Book({
				model: new TC.Models.Book({flipbook: this})
			});
			$('#pageContainer', this.el).append(this.book.render().el);
			
			// set to loading if necessary, and toggle loading classes
			if (localStorage['flipbook']) this.model.set('loading', true);
			if (this.model.get('loading')) this.loading();
			
			//add tools collection
			this.toolbox = new TC.Collections.Toolbox();
			this.init_tools();
			
			// add data
			this.data = new TC.Views.Data({
				model: new TC.Models.Data({
					'type': this.model.get('type'),
					'post_id': this.model.get('post_id'),
					'logged_in': this.model.get('logged_in'),
					'is_touch': this.model.get('is_touch'),
					'account_form': !this.model.get('logged_in'),
					'data_json': this.model.get('data_json'),
					'data_xml': this.model.get('data_xml'),
					'loading': this.model.get('loading')
				})
			});
			
			// if create page, init recover
			if (this.model.get('type') == 'create') {
				var recovery_model = new TC.Models.Recover({'flipbook': this});
				
				// if a flipbook is saved in local storage, restore it
				if (localStorage['flipbook']) recovery_model.set('state', 'restore');
				this.recovery = new TC.Views.Recover({ model: recovery_model });
				
				this.model.on('recover', this.recover);
			}

			this.model.on('change:playing',			this.toggle_playing);
			this.model.on('change:circleplaying',	this.toggle_playing);
			
			this.book.pages.on('add',			this.canvas.clear_undo);
			this.book.pages.on('new_active',	this.canvas.clear_undo);
			
			this.book.pages.on('remove', this.canvas.hide);
			this.book.pages.on('removed', this.canvas.show);
			
			this.data.on('get_details',		this.deactivate);
			this.data.on('cancel_details',	this.activate);
			
			this.data.model.on('change:loading', this.toggle_loading);
			this.data.load();
			
			$(window).on('doing_a_flip',	this.block_ui);
			$(window).on('done_a_flip',		this.unblock_ui);
		},
		
		recover: function() {
			this.recovery.model.trigger('save');
		},
		
		block_ui: function() {
			this.model.increment_animation_count();
		},
		
		unblock_ui: function() {
			this.model.decrement_animation_count();
		},
		
		is_blocked: function() {
			var animation_count = this.model.get('animation_count');
			
			if (animation_count > 0) return true;
			else return false;
		},
		
		deactivate: function() {
			this.model.set({'active': false});
		},
		
		activate: function() {
			this.model.set({'active': true});
		},
		
		is_playing: function() {
			return this.model.get('playing') || this.model.get('circleplaying');
		},
		
		toggle_playing: function() {
			if (this.is_playing()) this.on_play();
			else this.on_pause();
		},
		
		on_play: function() {
			this.trigger('play');
		},
		
		on_pause: function() {
			this.toolbox.deactivate_siblings('playback');
			this.trigger('pause');
		},
		
		pause: function() {
			this.model.set({'playing': false});
			this.model.set({'circleplaying': false});
		},
		
		play: function() {
			this.toolbox.get('play').trigger('shortcut');
		},
		
		toggle_loading: function() {
			if (this.data.model.get('loading')) this.loading();
			else this.loaded();
		},
		
		loading: function() {
			$("#pageContainer").addClass('loading');
			$("#content").addClass('loading');
			$("#loadingFlipbook").addClass('loading');
		},
		
		loaded: function() {
			flipbook.canvas.update();
			flipbook.book.first_page();
			$("#loadingFlipbook.loading").removeClass('loading');
			$("#pageContainer.loading").removeClass('loading');
			$("#content.loading").removeClass('loading');
			
			if (this.model.get('type') == 'playback') {
				this.play();
			}
		},
		
		keyboard_shortcuts: function(e) {
/* 			console.log(e.keyCode); */
			
			// make sure the flipbook is active before allowing shortcuts
			if (!this.model.get('active')) return;
			
			// find the tool with the matching shortcut
			var key = e.keyCode;
			var tool = this.toolbox.toArray();
			tool = _.find(tool, function(elem) {
				var shortcuts = elem.get('shortcut');
				if (shortcuts == key || (shortcuts.length && shortcuts.indexOf(key) != -1)) return true;
			});
			
			// check if the active tool has shortcuts
			var active_tool = this.toolbox.get_active()[0];
			
			if (active_tool) {
				var active_tool_index = active_tool.get('tool_index'),
					active_paper_tool = active_tool.get('paper_tool')[active_tool_index];
				
				if (active_paper_tool.trigger != undefined) active_paper_tool.trigger('shortcuts', e);
			}
			
			// key is a shortcut for tool, trigger it, otherwise do manual checks
			if (tool) {
				tool.trigger('shortcut');
			} else if (e.keyCode == 37) {
				// left
				this.book.trigger('prev');
			} else if (e.keyCode == 39) {
				// right
				this.book.trigger('next');
			} else if (e.keyCode == 90) {
				// Z
				if (Key.isDown('command') || Key.isDown('control')) {
					this.canvas.undo();
				}
			}
		},
		
		init_tools: function() {
			var type = this.model.get('type'),
				is_touch = this.model.get('is_touch');
			
			if (type == 'create') {
				//init pencil
				var pencil_tool = new TC.Models.Pencil();
				
				var pencil_model = new TC.Models.Tool({
					title: 'Draw (b)',
					id: 'pencil',
					shortcut: [80, 66], // P, B
					type: 'create',
					tool_index: 0,
					paper_tool: [pencil_tool]
				});
				this.toolbox.add(pencil_model);
				
				// add pencil view to the DOM
				var pencil_view = new TC.Views.Tool({ model: pencil_model });
				$('#tray .left', this.el).append(pencil_view.render().el);
				
				// add pencil settings container view to the DOM
				var pencil_settings = new TC.Views.ToolSettingsContainer();
				$(pencil_view.render().el).append(pencil_settings.render().el);
				
				// add pencil width as user-editable setting
				var pencil_width_settings = new TC.Views.ToolSettingsSlider({ model: pencil_tool, setting: 'width' });
				$(pencil_settings.render().el).append(pencil_width_settings.render().el);
				
				
				//init eraser
				var eraser_model = new TC.Models.Tool();
				eraser_model.set({
					title: 'Erase (e)',
					id: 'eraser',
					shortcut: 69, // E
					type: 'create',
					paper_tool: [eraser]
				});
				this.toolbox.add(eraser_model);
				
				var eraser_view = new TC.Views.Tool({
					model: eraser_model
				});
				$('#tray .left', this.el).append(eraser_view.render().el);
				
				//init transform
				var transform_model = new TC.Models.Tool();
				transform_model.set({
					title: 'Transform (e)',
					id: 'transform',
					shortcut: 86, // V
					type: 'create',
					icon_layers: 4,
					paper_tool: [transform, nudge]
				});
				this.toolbox.add(transform_model);
				
				var transform_view = new TC.Views.Tool({
					model: transform_model
				});
				$('#tray .left', this.el).append(transform_view.render().el);
				transform.create();
				
				//init delete
				var delete_model = new TC.Models.Tool();
				delete_model.set({
					title: 'Delete page',
					id: 'delete',
					paper_tool: [delete_page]
				});
				this.toolbox.add(delete_model);
				
				var delete_view = new TC.Views.Tool({
					model: delete_model
				});
				$('#tray .right', this.el).append(delete_view.render().el);
				
				//init blank
				var blank_model = new TC.Models.Tool();
				blank_model.set({
					title: 'Blank page',
					id: 'blank',
					shortcut: 78, // N
					paper_tool: [blank]
				});
				this.toolbox.add(blank_model);
				
				var blank_view = new TC.Views.Tool({
					model: blank_model
				});
				$('#tray .right', this.el).append(blank_view.render().el);
				
				//init duplicate
				var duplicate_model = new TC.Models.Tool();
				duplicate_model.set({
					title: 'Duplicate page',
					id: 'duplicate',
					shortcut: 68, // D
					paper_tool: [duplicate]
				});
				this.toolbox.add(duplicate_model);
				
				var duplicate_view = new TC.Views.Tool({
					model: duplicate_model
				});
				$('#tray .right', this.el).append(duplicate_view.render().el);
			}
			
			if (type == 'playback' && !this.model.get('is_touch')) {
				var print_tool = new TC.Models.Print();
				
				var print_model = new TC.Models.Tool();
				print_model.set({
					title: 'Print',
					id: 'print',
					paper_tool: [print_tool]
				});
				this.toolbox.add(print_model);
				
				var print_view = new TC.Views.Tool({
					model: print_model
				});
				$('#tray .right', this.el).append(print_view.render().el);
			}
			
			if (type == 'playback') {
				//init pencil model for legacy flipbooks
				var legacy_pencil = new TC.Models.Pencil({
					type: 'playback',
					width: 2
				});
				var legacy_pencil_model = new TC.Models.Tool({
					id: 'pencil',
					paper_tool: [legacy_pencil]
				});
				this.toolbox.add(legacy_pencil_model);
				
				//init twitter
				var twitter_model = new TC.Models.Tool({
					title: 'Twitter',
					id: 'twitter',
					url: 'https://twitter.com/share?text=' + this.model.get('title'),
					target: '_blank',
					paper_tool: [ new TC.Models.Social() ]
				});
				this.toolbox.add(twitter_model);
				
				var twitter_view = new TC.Views.Tool({
					model: twitter_model
				});
				$('#tray .left', this.el).prepend(twitter_view.render().el);
				
				//init facebook
				var facebook_model = new TC.Models.Tool({
					title: 'Facebook',
					id: 'facebook',
					url: 'http://www.facebook.com/sharer/sharer.php?s=100&p[url]='+ document.URL +'&p[images][0]='+ this.model.get('thumb_url') +'&p[title]='+ this.model.get('title'),
					target: '_blank',
					paper_tool: [ new TC.Models.Social() ]
				});
				this.toolbox.add(facebook_model);
				
				var facebook_view = new TC.Views.Tool({
					model: facebook_model
				});
				$('#tray .left', this.el).prepend(facebook_view.render().el);
			}
			
			if (!is_touch) {
				//init circleplay
				var circleplay_model = new TC.Models.Tool();
				circleplay_model.set({
					title: 'Circleplay',
					id: 'circleplay',
					type: 'playback',
					self_deactivatable: true,
					paper_tool: [circleplay]
				});
				this.toolbox.add(circleplay_model);
				
				var circleplay_view = new TC.Views.Tool({
					model: circleplay_model
				});
				$('#tray .right', this.el).append(circleplay_view.render().el);
			}
			
			//init play
			var play_model = new TC.Models.Tool();
			play_model.set({
				title: 'Play',
				id: 'play',
				type: 'playback',
				self_deactivatable: true,
				paper_tool: [play]
			});
			this.toolbox.add(play_model);
			
			var play_view = new TC.Views.Tool({
				model: play_model
			});
			$('#tray .right', this.el).append(play_view.render().el);
		},
		
		render: function() {
/* 			console.log("oh hi"); */
		}
	});
})();










