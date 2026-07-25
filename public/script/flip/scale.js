var scale = new Tool();

completePaths = function(group) {
	// what a hack oh my god this is glorious
	var pencil_tool = flipbook.toolbox.get('pencil').get('paper_tool')[0];
	
	for (var i = 0; i < group.children.length; i++) {
		pencil_tool.completePath(group.children[i]);
	}
}

resize = function(eventPoint, draggedPoint, oppositePoint, stretching) {
	var hitItem = transformHandle.item;
	var distance = eventPoint.subtract(hitItem.segments[oppositePoint].point);
	var scaleX = Math.abs(distance.x)/hitItem.bounds.width || 1;
	var scaleY = Math.abs(distance.y)/hitItem.bounds.height || 1;
	if (stretching) draggedPoint%2 == 0 ? scaleY = 1 : scaleX = 1;
	
	//scale
	for (var i = 0; i < selection_layer.children.length; i++) {
		selection_layer.children[i].scale(scaleX, scaleY, hitItem.segments[oppositePoint].point);
	}
	hitItem.scale(scaleX, scaleY, hitItem.segments[oppositePoint].point);
	
	//flip if needed
	distance = eventPoint.subtract(hitItem.segments[draggedPoint].point);
	if ( Math.abs(distance.y) > 1 && scaleY != 1) {
		selection_layer.scale(1, -1, hitItem.segments[oppositePoint].point);
		hitItem.scale(1, -1, hitItem.segments[oppositePoint].point);
	} else if ( Math.abs(distance.x) > 1 && scaleX != 1) {
		selection.layer.scale(-1, 1, hitItem.segments[oppositePoint].point);
		hitItem.scale(-1, 1, hitItem.segments[oppositePoint].point);
	}
}

scale.onMouseDrag = function(event) {
	var draggedCorner = findDraggedCorner();
	
	var oppositeCorner = draggedCorner+2;
	if (oppositeCorner > 3) oppositeCorner -= 4;
	
	resize(event.point, draggedCorner, oppositeCorner, false);
}

scale.onMouseUp = function(event) {
	completePaths(selection_layer);
	resetSelection();
}
