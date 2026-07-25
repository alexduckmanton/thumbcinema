(function() {
	
	TC.Models.SaveForm = Backbone.Model.extend({
		defaults: {
			logged_in: true,
			is_touch: false
		}
	});
	
	TC.Views.SaveForm = Backbone.View.extend({
		id: 'form',
		
		events: {
			'click .cancel': 'cancel',
			'submit #flipbookDetails': 'capture_form',
			'click #submitAccount': 'get_account',
			'click #submitFlipbook': 'save'
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'render'
			);
			
			this.template = _.template( $('#save_form').html() );
			$(this.el).html(this.template({
				logged_in: this.model.get('logged_in'),
				is_touch: this.model.get('is_touch')
			}));
			
			this.title_input = $(this.el).find('#title');
		},
		
		render: function() {
			return this;
		},
		
		focus: function() {
			this.title_input.focus();
		},
		
		blur: function() {
			this.title_input.blur();
		},
		
		cancel: function() {
			flipbook.data.trigger('cancel_details');
		},
		
		get_account: function() {
			if (!this.validate()) return;
			
			flipbook.data.trigger('get_account');
		},
		
		capture_form: function(e) {
			e.preventDefault();
		},
		
		validate: function() {
			this.form = this.serialize();
			if (!this.form[0].value) return false;
			else return true;
		},
		
		serialize: function() {
			return $(this.el).children('form').serializeArray();
		},
		
		save: function() {
			if (!this.validate()) return;
			
			flipbook.data.trigger('save');
		}
	});
	
	TC.Views.AccountForms = Backbone.View.extend({
		id: 'accountForms',
		className: 'form',
		
		events: {
			'click .cancel': 'cancel',
			'submit #flipbook_signup_form': 'capture_form',
			'submit #flipbook-login-form': 'capture_form',
			'click #flipbook-wp-submit': 'save',
			'click #signup_submit': 'save'
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'render'
			);
			
			this.template = _.template( $('#account_forms').html() );
			$(this.el).html( this.template() );
			
			this.username_login_input = $(this.el).find('#flipbook-user-login');
		},
		
		render: function() {
			return this;
		},
		
		cancel: function() {
			flipbook.data.trigger('cancel_account');
		},
		
		focus: function() {
			this.username_login_input.focus();
		},
		
		blur: function() {
			this.username_login_input.blur();
		},
		
		capture_form: function(e) {
			e.preventDefault();
		},
		
		save: function() {
		}
	});
	
})();
