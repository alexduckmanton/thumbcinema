var translate = new Tool();
translate.prevPoint = 0;

translate.onMouseDrag = function(event) {
	for (var i = 0; i < selection_layer.children.length; i++) {
		selection_layer.children[i].translate(event.point.subtract(translate.prevPoint));
	}
	
	transform_bounds.translate(event.point.subtract(translate.prevPoint));
	translate.prevPoint = event.point;
}

translate.onMouseUp = function(event) {
	resetSelection();
}
