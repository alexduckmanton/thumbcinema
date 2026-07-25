(function() {
	
	TC.Models.Data = Backbone.Model.extend({
		defaults: {
			type: 'create',
			logged_in: true,
			is_touch: true,
			account_form: false,
			loading: true
		}
	});
	
	TC.Views.Data = Backbone.View.extend({
		el: $(document),
		
		initialize: function() {
			_.bindAll(
				this,
				'init_legacy_pencil',
				'get_details',
				'generate_thumbnail',
				'generate_file',
				'save',
				'save_draft',
				'add_svg',
				'draw_svg',
				'draw_page',
				'draw_element',
				'convert_legacy'
			);
			
			// only load save forms and UI if necessary
			if (this.model.get('type') == 'create') {
				// add save form
				this.save_form = new TC.Views.SaveForm({
					model: new TC.Models.SaveForm({
						'logged_in': this.model.get('logged_in'),
						'is_touch': this.model.get('is_touch')
					})
				})
				$('#book', this.el).append(this.save_form.render().el);
				
				// add account forms if necessary
				if (!this.model.get('logged_in')) {
					this.account_forms = new TC.Views.AccountForms();
					$('#book', this.el).append(this.account_forms.render().el);
				}
				
				// add save button container view, which will add the buttons
				this.save_buttons = new TC.Views.SaveButtons({
					model: new TC.Models.SaveButtons({
						'drafts': this.model.get('logged_in')
					})
				});
				$('.center', this.el).append(this.save_buttons.render().el);
				
				this.on('get_details', this.get_details);
				this.on('get_account', this.get_account);
				this.on('cancel_details', this.cancel_details);
				this.on('cancel_account', this.cancel_account);
				this.on('save', this.save);
				this.on('save_draft', this.save_draft);
			} else {
				// add reference to pencil tool for drawing out legacy flipbooks manually
				_.defer(this.init_legacy_pencil);
			}
		},
		
		init_legacy_pencil: function() {
			this.legacy_pencil = flipbook.toolbox.get('pencil').get('paper_tool')[0];
		},
		
		get_details: function() {
			$('#content', this.el).addClass('saving');
			this.save_form.focus();
		},
		
		cancel_details: function() {
			$('#content', this.el).removeClass('saving');
			this.save_form.blur();
		},
		
		get_account: function() {
			$('#content', this.el).addClass('showAccountForms');
			this.account_forms.focus();
		},
		
		cancel_account: function() {
			$('#content', this.el).removeClass('showAccountForms');
			this.account_forms.blur();
		},
		
		prepare_save: function() {
			clearSelection();
			this.generate_thumbnail();
			this.generate_file();
		},
		
		generate_thumbnail: function() {
			var current_page = flipbook.book.pages.current_page();
			flipbook.book.go_to(flipbook.book.pages.get_interesting_page());
			flipbook.canvas.update();
			var canvas = document.getElementById("activePage");
			this.model.set({'dataURL': canvas.toDataURL("image/png")});
			flipbook.book.pages.set_active_index(current_page);
			flipbook.canvas.update();
		},
		
		generate_file: function() {
			this.model.unset('svg');
			this.model.unset('xml');
			
			var svg = paper.project.exportSVG(),
				xml = (new XMLSerializer).serializeToString(svg);
			
			this.model.set({'svg': svg});
			this.model.set({'xml': xml});
		},
		
		save: function(is_draft) {
			$('#content', this.el).addClass('sending');
			
			// get thumbnail, convert project to svg, convert svg to xml
			// wait a bit so ui can refresh in case it's huge
			var self = this;
			window.setTimeout(function() {
				self.prepare_save();
				
				self.send(is_draft);
			}, 500);
		},
		
		save_draft: function() {
			$('#content', this.el).addClass('drafting');
			this.save(true);
		},
		
		save_local: function() {
			// remove the current page, since it could contain the error
			project.activeLayer.remove();
			
			// generate xml file and save it locally
			this.generate_file();
			localStorage['flipbook'] = this.model.get('xml');
			
			flipbook.recovery.model.trigger('saved_local');
		},
		
		draft_success: function(post_id) {
			flipbook.model.set('post_id', post_id);
			$("#content").removeClass('drafting').removeClass('sending');
		},
		
		send: function(is_draft) {
			var flip_xml = this.model.get('xml');
				thumbnail = this.model.get('dataURL'),
				isNSFW = $("#nsfw").is(":checked"),
				form = this.save_form.serialize(),
				flip_title = form[0].value,
				flip_desc = form[1].value,
				post_id = flipbook.model.get('post_id');
			
			var self = this;
			$.ajax({
				type: "POST",
				url: "/saveflipbook",
				data: {title: flip_title, description: flip_desc, project: flip_xml, imgBase64: thumbnail, nsfw: isNSFW, draft: is_draft, postID: post_id}
			}).done(function(msg) {
				window.onbeforeunload = null;
				
				if (!is_draft) {
					_gaq.push(['_trackEvent', 'Flipbook', 'save complete', 'mouse']);
					registerMessage({
						copy: "Nice one! Your flipbook's saved. Give yourself a pat on the back.",
						cta: "Don't mind if I do",
						type: "success"
					});
					window.location.href = msg;
				} else {
					_gaq.push(['_trackEvent', 'Flipbook', 'save draft', 'mouse']);
					self.draft_success(msg);
				}
			}).fail(function() {
				showMessage({
					copy: "Oh no! Something went wrong and I couldn't save your flipbook. Try again.",
					cta: "Dang",
					type: "error"
				});
			});
		},
		
		load: function() {
			// if there's no post id, then don't load
			if (!this.model.get('post_id')) return;
			
			
			if (this.model.get('data_json')) this.load_legacy();
			else if (this.model.get('data_xml')) this.load_xml();
		},
		
		load_legacy: function() {
			var flipbook_url = this.model.get('data_json');
			
			var self = this;
			$.ajax({
				url: flipbook_url,
				success: function(data) {
					data = JSON.parse(data);
					
					self.legacy_draw_page(3, data.layers);
				}
			});
		},
		
		legacy_draw_page: function(page_index, nodes) {
			var layer = nodes[page_index].children;
			for (var i = 0; i < layer.length; i++) {
				this.legacy_pencil.beginDraw();
				this.legacy_draw_element(layer[i].segments);
				this.legacy_pencil.endDraw();
			}
			page_index++;
			
			var self = this;
			if (page_index < nodes.length) {
				window.setTimeout(function() {
					flipbook.book.pages.add({});
					self.legacy_draw_page(page_index, nodes);
				}, 0);
			} else {
				window.setTimeout(function() {
					self.convert_legacy();
					self.loaded();
				}, 0);
			}
		},
		
		legacy_draw_element: function(segments) {
			for (var i = 0; i < segments.length; i++) {
				var x = segments[i].x,
					y = segments[i].y,
					point = new Point(Math.round(x), Math.round(y));
					
				this.legacy_pencil.dragDraw(point);
			}
		},
		
		convert_legacy: function() {
			// if print tool doesn't exist, don't convert legacy
			if (!flipbook.toolbox.get('print')) return;
			
			this.generate_file();
			this.add_svg(this.model.get('xml'));
		},
		
		add_svg: function(xml) {
			$("#svg").html(xml);
			this.id_svg();
		},
		
		id_svg: function() {
			$("#svg svg").attr('id', 'svg_1');
		},
		
		draw_svg: function(xml) {
			var svg = $('#svg_1'),
				nodes = svg[0].childNodes;
			
			if (nodes.length > 3) {
				this.draw_page(3, nodes);
			} else {
				var self = this;
				window.setTimeout(function() { self.loaded(); }, 0);
			}
		},
		
		load_xml: function() {
			var flipbook_url = this.model.get('data_xml');
			
			var self = this;
			$("#svg").load(flipbook_url, function() {
				self.id_svg();
				self.draw_svg();
			});
		},
		
		draw_page: function(i, nodes) {
			this.draw_element(0, nodes[i].childNodes, nodes[i]);
			i++;
			
			var self = this;
			window.setTimeout(function() {
				if (i < nodes.length) {
					flipbook.book.pages.add({});
					self.draw_page(i, nodes);
				} else {
					self.loaded();
				}
			}, 0);
		},
		
		draw_element: function(i, elements, group) {
			if (elements[i] !== undefined) {
				canvas_layer.importSVG(elements[i]);
					
				if (group !== undefined)		var group_stroke_width = group.getAttribute('stroke-width');
				if (elements[i] !== undefined)	var element_stroke_width = elements[i].getAttribute('stroke-width');
				
				if (element_stroke_width) canvas_layer.lastChild.strokeWidth = element_stroke_width;
				else if (group_stroke_width) canvas_layer.lastChild.strokeWidth = group_stroke_width;
				else canvas_layer.lastChild.strokeWidth = 2;
			}
			
			i++;
			
			var self = this;
			if (i < elements.length) {
				self.draw_element(i, elements, group);
			} else {
				canvas_layer.style = {
					strokeCap: 'round',
					strokeJoin: 'round',
					strokeColor: '#444'
				}
			}
		},
		
		loaded: function() {
			flipbook.book.draw_active_page();
			
			this.model.set('loading', false);
		}
	});
	
})();
