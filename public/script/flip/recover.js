(function() {
	
	TC.Models.Recover = Backbone.Model.extend({
		defaults: {
			state: false
		}
	});
	
	TC.Views.Recover = Backbone.View.extend({
		id: 'recover',
		
		events: {
			'click .button': 'reload'
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'render',
				'make_recovery',
				'saved',
				'restore'
			);
			
			this.flipbook = this.model.get('flipbook');
			
			this.template = _.template( $('#recover').html() );
			$(this.el).html(this.template());
			
			this.model.on('saved_local', this.saved);
			this.model.on('save', this.make_recovery);
			if (this.model.get('state') == 'restore') this.restore();
		},
		
		render: function() {
			return this;
		},
		
		make_recovery: function() {
			window.onbeforeunload = null;
			$('body').append(this.el);
			flipbook.data.save_local();
		},
		
		saved: function() {
			$(this.el).find('.loading').removeClass('loading');
			_gaq.push(['_trackEvent', 'Error', 'Recovery', 'Show']);
		},
		
		restore: function() {
			this.flipbook.data.add_svg(localStorage['flipbook']);
			this.flipbook.data.draw_svg();
			this.restore_complete();
		},
		
		restore_complete: function() {
			localStorage.removeItem('flipbook');
			_gaq.push(['_trackEvent', 'Error', 'Recovery', 'Complete']);
		},
		
		reload: function() {
			window.location.reload();
		}
	});
	
})();
