(function() {
	TC.Views.ToolSettingsSlider = Backbone.View.extend({
		className: 'slider',
		
		events: function() {
			return Modernizr.touch ? {
				'touchstart .smaller': 'decrease',
				'touchstart .bigger': 'increase',
				'touchstart .value_container': function(e) { this.m_down(e); this.jump(e); },
				'touchmove .value_container': 'drag',
				'touchend .value_container': 'm_up',
				'touchcancel .value_container': 'm_leave'
			} : {
				'click .smaller': 'decrease',
				'click .bigger': 'increase',
				'mousedown .value_container': function(e) { this.m_down(e); this.jump(e); },
				'mousemove .value_container': 'drag',
				'mouseup .value_container': 'm_up',
				'mouseleave .value_container': 'm_leave'
			}
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'render',
				'increase',
				'decrease',
				'jump',
				'drag',
				'm_down',
				'm_up',
				'm_leave',
				'update_value_indicator',
				'update_setting'
			);
			
			// template construction
			$(this.el).append('<a href="javascript:void(0)" class="smaller"></a>');
			$(this.el).append('<div class="value_container"><a class="value"></a></div>');
			$(this.el).append('<a href="javascript:void(0)" class="bigger"></a>');
			
			// store template elements
			this.value_container = $(this.el).find('.value_container');
			this.value_indicator = $(this.el).find('.value');
			
			// set initial value on value indicator. needs to be deferred to calculate width of ui elements
			_.defer(this.update_value_indicator);
			
			this.model.on('change:' + this.options.setting, this.update_value_indicator);
			
			this.mouse_down = false;
		},
		
		render: function() {
			return this;
		},
		
		increase: function() {
			var setting = this.options.setting,
				setting_value = this.model.get(setting);
			
			setting_value++;
			this.update_setting(setting_value);
		},
		
		decrease: function() {
			var setting = this.options.setting,
				setting_value = this.model.get(setting);
			
			setting_value--;
			this.update_setting(setting_value);
		},
		
		jump: function(e) {
			var container_x = this.value_container.offset().left,
				mouse_x = e.pageX || e.originalEvent.pageX, // need original event when using touch events
				container_width = this.value_container.width(),
				clicked_pos = mouse_x - container_x,
				clicked_percent = clicked_pos / container_width * 100,
				setting = this.options.setting,
				min_value = this.model.get('min_' + setting),
				max_value = this.model.get('max_' + setting),
				max_value_norm = max_value - min_value,
				new_value_norn = max_value_norm * clicked_percent / 100,
				new_value = Math.round(new_value_norn + min_value);
			
			this.update_setting(new_value);
		},
		
		drag: function(e) {
			if (!this.mouse_down) return;
			
			this.jump(e);
		},
		
		m_down: function() {
			this.mouse_down = true;
		},
		
		m_up: function() {
			this.mouse_down = false;
		},
		
		m_leave: function() {
			this.m_up();
		},
		
		update_value_indicator: function() {
			var setting = this.options.setting,
				setting_value = this.model.get(setting),
				min = this.model.get('min_' + setting),
				max = this.model.get('max_' + setting),
				max_percentage = 100 - ( this.value_indicator.width() / this.value_container.width() * 100 );
			
			// normalize
			max -= min;
			setting_value -= min;
			var increments = max_percentage / max;
			var value_percent = increments*setting_value + "%";
			
			// update value indicator element position
			this.value_indicator.css('left', value_percent);
		},
		
		update_setting: function(new_value) {
			var setting = this.options.setting;
			
			this.model.set(setting, new_value);
		}
	});
})();
	