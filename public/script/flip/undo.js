(function() {
	
	TC.Models.Undo = Backbone.Model.extend({
		defaults: {
			state: 'undo',
			layer: {}
		}
	});
	
	TC.Collections.Undo = Backbone.Collection.extend({
		model: TC.Models.Undo,
		
		undo: function() {
			var old_undo_layer = this.findWhere({state: 'undo'}),
				new_undo_layer = this.at( this.indexOf(old_undo_layer)-1 ),
				old_redo_layer = this.findWhere({state: 'redo'});
			
			if (old_undo_layer) old_undo_layer.set({state: 'redo'});
			if (old_redo_layer) old_redo_layer.set({state: false});
			if (new_undo_layer) new_undo_layer.set({state: 'undo'});
		},
		
		redo: function() {
			console.log('redoing');
		},
		
		clear_next: function() {
			
		},
		
		clear_undo: function() {
			var old_undo = this.findWhere({state: 'undo'}),
				state_none = {state: false};
			
			if (old_undo) old_undo.set({state: false});
		},
		
		clear: function() {
			this.reset();
		},
		
		get_previous: function() {
			
		}
	});
	
	TC.Views.Undoxxxx = Backbone.View.extend({
		initialize: function() {
			_.bindAll(
				this,
				'render',
				'on_change_active',
				'undo_draw',
				'undo_transform'
			);
			
			var collection = this.model.collection;
			console.log(this);
			project.activeLayer.copyTo(collection.project);
			this.model.set({'layer': collection.project.activeLayer});
			
			this.model.on('change:state', this.on_change_active);
		},
		
		on_change_active: function(e) {
			var state = this.model.get('state');
			if (state != 'redo') return;
			
			var layer = this.model.get('layer');
			if (layer === canvas_layer) this.undo_draw();
			else if (layer === selection_layer || layer === guide_layer) this.undo_transform();
			
			flipbook.canvas.update();
		},
		
		undo_draw: function() {
			console.log('undo draw');
			this.swap_layers(canvas_layer, this.model.get('layer'));
			canvas_layer.activate();
		},
		
		undo_transform: function() {
			
		},
		
		swap_layers: function(layer1, layer2) {
			var tempLayer = new Layer();
			
			copyChildren(layer1, tempLayer);
			copyChildren(layer2, layer1);
			copyChildren(tempLayer, layer2);
			
			tempLayer.remove();
		},
		
		copy_layers: function(from_layer, to_layer, clear) {
			if (clear == null) clear = true;
			
			if (clear) to_layer.removeChildren();
			for (var i = 0; i < from_layer.children.length; i++) {
				from_layer.children[i].copyTo(to_layer);
			}
		}
	});
})();

function copyChildren(fromLayer, toLayer, clear) {
	if (clear == null) clear = true;
	
	if (clear) toLayer.removeChildren();
	for (var i = 0; i < fromLayer.children.length; i++) {
		fromLayer.children[i].copyTo(toLayer);
	}
}

function swapChildren(layer1, layer2) {
	var tempLayer = new Layer();
	
	copyChildren(layer1, tempLayer);
	copyChildren(layer2, layer1);
	copyChildren(tempLayer, layer2);
	
	tempLayer.remove();
}

function setUndo(newState) {
	undoState = newState;
	
	
	if (undoState == "draw") {
		copyChildren(canvas, undo);
		canvas.activate();
	} else if (undoState == "transform") {
		copyChildren(selection, undo);
		selection.activate();
	}
}

var old_undo = {
	state: false,
	
	set: function(newState) {
		this.state = newState;
		
		switch (this.state) {
			case 'draw':
				copyChildren(canvas_layer, undo_layer);
				canvas_layer.activate();
				break;
			case 'transform':
				copyChildren(selection_layer, undo_layer);
				selection_layer.activate();
				break;
		}
	},
	
	clear: function() {
		this.state = false;
	},
	
	activate: function() {
		if (!this.state) return;
		
		if ( Key.isDown("command") || Key.isDown("control") ) {
			if (this.state == "draw") {
				swapChildren(canvas_layer, undo_layer);
				canvas_layer.activate();
			} else if (this.state == "transform") {
				if (undo_layer.children.length == 0 && false) {
					var selectionLength = selection_layer.children.length;
					swapChildren(selection_layer, undo_layer);
					undo_layer.lastChild.name = "duplicate";
					
					for (var i = 0; i < selectionLength; i++) {
						canvas_layer.lastChild.copyTo(selection_layer);
						canvas_layer.lastChild.remove();
					}
				} else if (undo_layer.lastChild.name == "duplicate") {
					undo_layer.lastChild.name = "";
					copyChildren(selection_layer, canvas_layer, false);
					swapChildren(selection_layer, undo_layer);
					undo_layer.removeChildren();
				} else {
					swapChildren(selection_layer, undo_layer);
				}
				
				if (transformType == "push") {
					nudge.deactivate();
					transformType = "push"; // deactivating nudge resets transform type, so need to set to push again
					nudge.init();
				} else {
					resetSelection();
					selection_layer.activate();
				}
			}
		}
	}
}
