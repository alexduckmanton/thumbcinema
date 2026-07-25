(function($) {
	
	prefixify = function(property, value) {
		var styles = {};
		styles[property] = value;
		styles["-o-"+property] = value;
		styles["-ms-"+property] = value;
		styles["-webkit-"+property] = value;
		
		return styles;
	}
	
	$.fn.do_a_ = function(animation, options) {
		var settings = $.extend({
			callback: function() {},
			reset: true,
			pause: false,
			duration: .75,
			timing: "ease-in-out",
			delay: 0,
			count: 1,
			direction: "normal",
			freeze: false,
			event_element: false,
			completion_event: false,
			completion_buffer: 0
		}, options);
		
		$(window).trigger('doing_a_flip');
		
		var styles = {};
		
		if (settings.freeze) styles = $.extend(styles, {"position": "fixed", "top": this.offset().top, "left": this.offset().left});
		
		styles = $.extend(styles, prefixify("animation-name", animation));
		styles = $.extend(styles, prefixify("animation-duration", settings.duration+"s"));
		styles = $.extend(styles, prefixify("animation-timing-function", settings.timing));
		styles = $.extend(styles, prefixify("animation-delay", settings.delay+"s"));
		styles = $.extend(styles, prefixify("animation-iteration-count", settings.count));
		styles = $.extend(styles, prefixify("animation-direction", settings.direction));
		this.css(styles);
		
		var self = this;
				
		// to be run after the animation has completed
		var on_complete = function() {
			settings.callback();
			
			// pause animation at the end
			if (settings.pause) self.css(prefixify("animation-play-state", "paused"));
			
			// fire off the completion event
			if (settings.completion_event) {
				var element = self;
				if (settings.event_element) element = settings.event_element;
				
				element.trigger(settings.completion_event);
			}
			
			// remove styles added
			if (settings.reset) self.removeAttr("style");
			
			window.setTimeout(function() { $(window).trigger('done_a_flip'); }, settings.completion_buffer);
		}
		
		// run callback function
		window.setTimeout(on_complete, settings.duration*1000);
		
		return this;
	}
	
}(jQuery));
	
	
	
	
	
	
	
	
	
	
	
	
	