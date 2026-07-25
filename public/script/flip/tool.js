(function() {
	// tool model
	TC.Models.Tool = Backbone.Model.extend({
		defaults: {
			title: '',
			id: '',
			shortcut: '',
			class: 'icon',
			icon_layers: 0,
			tool_index: -1,
			type: false,
			self_deactivatable: false,
			url: 'javascript:void(0)',
			target: false
		}
	});
	
	// tool view
	TC.Views.Tool = Backbone.View.extend({
		tagName: 'li',
		
		events: function() {
			return Modernizr.touch ? {
				'touchstart': 'activate'
			} : {
				'click': 'activate'
			}
		},
		
		initialize: function() {
			_.bindAll(this, 'render', 'activate', 'activate_tool', 'update_tools', 'deactivate_prev_tool', 'increment_tool_index', 'update_tool_index');
			
			//activate if necessary
			var tool_index = this.model.get('tool_index');
			if (tool_index > -1) this.model.get('paper_tool')[tool_index].activate();
			
			//add basic icon element
			this.model.set('class', this.model.get('class') + '-' + this.model.get('id'));
			$(this.el).html('<a href="'+ this.model.get('url') +'" class="'+ this.model.get('class') +'" id="'+ this.model.get('id') +'" title="'+ this.model.get('title') +'"></a>');
			if (this.model.get('target')) this.$el.children('a').prop('target', this.model.get('target'));
			
			//add layers, if they exist
			this.anchor = $(this.el).children('a');
			var layer = '<span class="layer"></span>';
			for (var i = 0; i < this.model.get('icon_layers'); i++) {
				this.anchor.append(layer);
			}
			
			//events
			this.model.bind('change:tool_index', this.render);
			this.model.bind('change:tool_index', this.update_tools);
			this.model.bind('shortcut', this.activate);
		},
		
		render: function() {
			var tool_index = this.model.get('tool_index');
			var tool_class;
			tool_index > -1 ? tool_class = 'tool-' + tool_index : tool_class = '';
			
			this.anchor.attr('class', this.model.get('class') + ' ' + tool_class);
			
			return this;
		},
		
		activate: function() {
			if (flipbook.is_blocked()) return;
			
			var self_deactivatable = this.model.get('self_deactivatable'),
				tool = this.model.get('paper_tool'),
				tool_index = this.model.get('tool_index'),
				type = this.model.get('type');
			
			// don't do anything if already active and has no secondary tools
			if (!self_deactivatable && tool_index > -1 && tool.length == 1) return;
			
			// if any siblings are active, they should be deactivated now
			this.model.collection.deactivate_siblings(type, this.model.get('id'));
			
			// if this tool is on, and can be turned off
			if (self_deactivatable && tool_index > -1) {
				this.update_tool_index(-1);
			}
			
			// otherwise, this must either be off, or have more tools to cycle through
			// so activate the next one
			else {
				var next_tool_index = this.increment_tool_index();
				
				// make sure the next cool can be initialised before updating the tool index
				if (tool[next_tool_index].init())
					this.update_tool_index(next_tool_index);
			}
		},
		
		update_tools: function() {
			var tool_index = this.model.get('tool_index');
			
			if (tool_index == -1) this.deactivate_prev_tool();
			else this.activate_tool();
		},
		
		activate_tool: function() {
			var tool = this.model.get('paper_tool'),
				tool_index = this.model.get('tool_index'),
				prev_tool_index = this.model.previous('tool_index');
			
			// deactivate old tool, if it exists
			this.deactivate_prev_tool();
			
			// activate new tool
			tool[tool_index].activate();
			
			flipbook.canvas.update();
			
			_gaq.push(['_trackEvent', 'Flipbook', this.model.get('id'), 'combined']);
		},
		
		deactivate_prev_tool: function() {
			var tool = this.model.get('paper_tool'),
				prev_tool_index = this.model.previous('tool_index');
			
			if (prev_tool_index > -1) tool[prev_tool_index].deactivate();
		},
		
		increment_tool_index: function() {	
			var tool = this.model.get('paper_tool');
			var tool_index = this.model.get('tool_index');
			
			//increment tool index
			tool_index++;
			if (tool_index >= tool.length) tool_index = 0;
			
			return tool_index;
		},
		
		update_tool_index: function(_tool_index) {
			this.model.set({tool_index: _tool_index});
		}
	});
	
	// toolbox collection
	TC.Collections.Toolbox = Backbone.Collection.extend({
		model: TC.Models.Tool, 
		
		deactivate_siblings: function(_type, clicked) {
			//get the active tool(s)
			var clicked_tool = this.where({id: clicked});
			var active_tools = this.where({type: _type});
			active_tools = _.without(active_tools, clicked_tool[0]);
			
			//new values
			var inactive = {tool_index: -1};
			
			//update the tool(s)
			_.invoke( active_tools, 'set', inactive );
		},
		
		get_active: function() {
			return this.filter(function(tool) {
				return tool.get('tool_index') > -1;
			});
		},
		
		reset_active: function() {
			var active_tool = this.get_active();
			
			var reset = {tool_index: 0};
			_.invoke( active_tool, 'set', reset );
		},
		
		deactivate: function(paper_tool) {
			// deactivates a tool by finding the model based on the paper tool object
			// useful to make sure the state of the tool object and model match
			// if deactivating outside the view
			
			var old_tool = this.filter(function(tool) {
				var num_tools = tool.get('paper_tool').length;
				for (var i = 0; i < num_tools; i++) {
					return tool.get('paper_tool')[i] == paper_tool;
				}
			});
			
			// deactivate the tool object to be sure
			var old_paper_tool = old_tool[0].get('paper_tool'),
				old_tool_index = old_tool[0].get('tool_index');
			if (old_paper_tool[old_tool_index]) old_paper_tool[old_tool_index].deactivate();
			
			// set model to reflect deactivated tool
			old_tool[0].set({'tool_index': -1});
		}
	});
})();
