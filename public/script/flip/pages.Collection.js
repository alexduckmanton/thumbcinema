(function() {
	// pages collection
	TC.Collections.Pages = Backbone.Collection.extend({
		model: TC.Models.Page,
		
		set_active: function(new_active) {
			//get the active page
			var old_active = this.where({active: true});
			
			//set old active to inactive
			var inactive = {active: false};
			_.invoke(old_active, 'set', inactive);
			
			// set new active to active
			new_active.set({active: true});
		},
		
		set_active_index: function(index) {
			//don't do anything if index out of bounds
			if (index <= -1 || index >= this.length) return;
			
			this.set_active( this.at(index) );
		},
		
		activate_sibling: function(sibling) {
			var sibling_index = this.indexOf(sibling),
				focus_event = "";

			if (sibling_index == this.length-1) {
				// is at the end, activate the second-last
				sibling_index--;
				focus_event = "focus_from_right";
			} else {
				// activate the next one
				sibling_index++;
				focus_event = "focus_from_left";
			}
			
			this.set_active(this.at(sibling_index));
			this.at(sibling_index).trigger(focus_event);
		},
		
		get_active: function() {
			return this.findWhere({active: true});
		},
		
		current_page: function() {
			return this.indexOf(this.get_active());
		},
		
		at_last_page: function() {
			if (this.current_page() == this.length-1) return true;
			else return false;
		},
		
		freeze_current: function() {
			var to_freeze = this.get_active();
			
			to_freeze.set({frozen: true});
		},
		
		freeze_next_pages: function() {
			var to_freeze = _.rest(this.models, this.current_page()+1);
			to_freeze.reverse();
			
			_.invoke(to_freeze, 'set', {frozen: true});
		},
		
		freeze_prev_pages: function() {
			var to_freeze = _.first(this.models, this.current_page());
			
			_.invoke(to_freeze, 'set', {frozen: true});
		},
		
		unfreeze_all: function() {
			var frozen = this.where({frozen: true});
			
			_.invoke(frozen, 'set', {frozen: false});
		},
		
		get_interesting_page: function() {
			var interesting = _.max(this.models, function(page) {
				return page.get('num_segments');
			});
			
			return this.indexOf(interesting);
		}
	});
})();
