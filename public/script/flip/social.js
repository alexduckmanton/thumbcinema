(function() {
	TC.Models.Social = Backbone.Model.extend({
		defaults: {
			
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'init_event_handlers',
				'init',
				'activate',
				'deactivate'
			);
			
			_.defer(this.init_event_handlers);
		},
		
		init_event_handlers: function() {
			
		},
		
		init: function() {
			return true;
		},
		
		activate: function() {
			
			// all done, so need to deactivate
			flipbook.toolbox.deactivate(this);
		},
		
		deactivate: function() {
			// gets called on deactivation by the toolbox
		}
	});
})();
