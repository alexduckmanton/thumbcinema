(function() {

	TC.Models.SaveButtons = Backbone.Model.extend({
		defaults: {
			drafts: true
		}
	});
	
	TC.Views.SaveButtons = Backbone.View.extend({
		id: 'save',
		className: 'no_save',
		
		initialize: function() {
			_.bindAll(
				this,
				'init_event_handlers',
				'show',
				'hide',
				'render'
			);
			
			this.save_complete = new TC.Views.SaveComplete();
			$(this.el).append(this.save_complete.render().el);
			
			if (this.model.get('drafts')) {
				this.save_draft = new TC.Views.SaveDraft();
				$(this.el).append(this.save_draft.render().el);
			}
			
			_.defer(this.init_event_handlers);
		},
		
		init_event_handlers: function() {
			flipbook.book.pages.on("add", this.show);
			flipbook.book.pages.on("remove", this.hide);
		},
		
		show: function() {
			$(this.el).removeClass('no_save');
		},
		
		hide: function() {
			if (flipbook.book.pages.length <= 1)
				$(this.el).addClass('no_save');
		},
		
		render: function() {
			return this;
		}
	});
	
	TC.Views.SaveComplete = Backbone.View.extend({
		tagName: 'a',
		className: 'button',
		
		attributes: {
			'href': 'javascript:void(0)'
		},
		
		events: {
			'click': 'activate'
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'render',
				'activate'
			);
			
			$(this.el).html('Save flipbook');
		},
		
		render: function() {
			return this;
		},
		
		activate: function() {
			flipbook.data.trigger('get_details');
		}
	});
	
	TC.Views.SaveDraft = Backbone.View.extend({
		tagName: 'span',
		
		events: {
			'click #draft': 'activate'
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'render',
				'activate'
			);
			
			$(this.el).html('<a href="javascript:void(0)" id="draft"></a>');
			this.btn = $(this.el).children('a');
			this.btn.html('Save draft');
		},
		
		render: function() {
			return this;
		},
		
		activate: function() {
			flipbook.data.trigger('save_draft');
		}
	});
	
})();
