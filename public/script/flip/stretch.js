var stretch = new Tool();

stretch.onMouseDrag = function(event) {
	var draggedEdge = findDraggedEdge();
	
	var oppositeEdge = draggedEdge+2;
	if (oppositeEdge > 3) oppositeEdge -= 4;
	
	resize(event.point, draggedEdge, oppositeEdge, true);
}

stretch.onMouseUp = function(event) {
	// hackity hack
	var pencil_tool = flipbook.toolbox.get('pencil').get('paper_tool')[0];
	
	for (var i = 0; i < selection_layer.children.length; i++) {
		pencil_tool.completePath(selection_layer.children[i]);
	}
	resetSelection();
}
