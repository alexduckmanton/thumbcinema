(function() {
	TC.Models.Print = Backbone.Model.extend({
		defaults: {
			leading_pages: 3,
			per_page: 21,
			columns: 3,
			margin: 10,
			spine_margin: 40,
			scale: .25,
			width: 640,
			height: 360
		},
		
		initialize: function() {
			_.bindAll(
				this,
				'init_event_handlers',
				'generate',
				'remove_leading_pages',
				'remove_onion_styling',
				'arrange',
				'calc_x',
				'calc_y',
				'page_breaks',
				'activate',
				'deactivate'
			);
			
			_.defer(this.init_event_handlers);
		},
		
		init_event_handlers: function() {
			flipbook.data.model.on("change:loading", this.generate);
		},
		
		generate: function() {
			this.svg_container = $("#svg");
			this.svg = this.svg_container.children("svg");
			this.print = SVG(this.svg.attr('id'));
			
			// move svg away from the edges so cut lines aren't cropped
			this.svg.css({
				'padding-top': this.get('margin')/2,
				'padding-left': this.get('margin')/2
			});
			
			this.remove_leading_pages();
			this.remove_onion_styling();
			this.arrange();
			this.page_breaks();
		},
		
		remove_leading_pages: function() {
			for (var i = 0; i < this.get('leading_pages'); i++) {
				$(this.svg.children("g").get(0)).remove();
			}
		},
		
		remove_onion_styling: function() {
			this.svg.children('g[opacity="0.1"]').removeAttr("opacity");
		},
		
		arrange: function() {
			var self = this,
				groups = this.svg.children('g'),
				per_page = this.get('per_page'),
				columns = this.get('columns'),
				margin = this.get('margin'),
				spine_margin = this.get('spine_margin'),
				scale = this.get('scale'),
				width = this.get('width'),
				height = this.get('height'),
				scaled_width = width * scale,
				scaled_height = height * scale,
				c_count = 0,
				r_count = 0,
				page_count = 0;
			
			// lay out the page
			this.svg.children("g").each(function(i, layer) {
				var horz_margin = 0;
				var vert_margin = 0;
				if (c_count > 0) horz_margin = margin;
				if (r_count > 0) vert_margin = margin;
				
				// add mask for page edges
				var clip = self.print.clip();
				var mask = self.print.rect(width, height);
				clip.add(mask);
				
				// move and scale page into place
				var x = self.calc_x(c_count);
				var y = self.calc_y(r_count, page_count);
				$(this).attr("transform", "translate("+ x +","+ y +"),scale("+ scale +","+ scale +")")
					   .attr("clip-path", "url('#"+ $(clip.node).attr('id') +"')");
				
				// cut lines
				self.print.rect(scaled_width + margin + spine_margin, scaled_height + margin)
						  .move(x - margin/2 - spine_margin, y - margin/2)
						  .stroke({color: '#ccc', width: 1})
						  .fill('none');
				
				c_count++;
				if (c_count >= columns) {
					c_count = 0;
					r_count++;
				}
				
				page_count++;
				if (page_count >= per_page) {
					c_count = 0;
					r_count = 0;
					page_count = 0;
				}
			});
			
			// set container height
			this.svg_container.css('height', Math.ceil( per_page / columns * (scaled_height+margin) ));
		},
		
		calc_x: function(c_count) {
			var margin = this.get('margin'),
				spine_margin = this.get('spine_margin'),
				scaled_width = this.get('width') * this.get('scale');
				
			return c_count * (scaled_width + margin + spine_margin) + spine_margin;
		},
		
		calc_y: function(r_count, page_count) {
			var margin = this.get('margin'),
				scaled_height = this.get('height') * this.get('scale');
			
			return (r_count * (scaled_height + margin));
		},
		
		page_breaks: function() {
			var per_page = this.get('per_page'),
				num_pages = flipbook.book.pages.length,
				num_print_pages = Math.ceil( num_pages/per_page ),
				page_index = 0;
			
			for (var i = 0; i < num_print_pages-1; i++) {
				$("#svg svg:last").clone().insertAfter("#svg svg:last");
				
				// remove trailing pages from previous svg
				this.remove_pages($("#svg svg:last").prev(), page_index);
				
				page_index += per_page;
			}
			
			this.remove_pages($("#svg svg:last"), page_index);
		},
		
		remove_pages: function(svg, page_index) {
			var per_page = this.get('per_page');
		
			svg.children('g').each(function(i, group) {
				if (i >= page_index && i < page_index + per_page) {
					return true;
				}
				
				$(this).siblings('rect').first().remove();
				$(this).remove();
			});
		},
		
		init: function() {
			return true;
		},
		
		activate: function() {
			window.print();
			
			// all done, so need to deactivate
			flipbook.toolbox.deactivate(this);
		},
		
		deactivate: function() {
			// gets called on deactivation by the toolbox
		}
	});
})();
