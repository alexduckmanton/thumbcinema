(function() {
	TC.Views.ToolSettingsContainer = Backbone.View.extend({
		className: 'settings',
		
		events: function() {
			
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'render'
			);
		},
		
		render: function() {
			return this;
		}
	});
})();
	