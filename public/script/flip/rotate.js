var rotate = new Tool();
rotate.prevPoint = 0;

rotate.onMouseDrag = function(event) {
	//create a triangle between the new and old mouse positions and the center of the selection, determine the angle
	var sideA = rotate.prevPoint.getDistance(event.point, false);
	var sideB = rotate.prevPoint.getDistance(transform_bounds.position, false);
	var sideC = event.point.getDistance(transform_bounds.position, false);
	var angle = (sideB*sideB + sideC*sideC - sideA*sideA) / (2*sideB*sideC);
	angle = Math.acos(angle);
	angle = (angle/(2*Math.PI))*360;
	
	//determine the rotation direction
	var direction = (rotate.prevPoint.x-transform_bounds.position.x) *
					(event.point.y-transform_bounds.position.y) -
					(rotate.prevPoint.y-transform_bounds.position.y)*
					(event.point.x-transform_bounds.position.x);
					
	direction < 0 ? direction = -1 : direction = 1;
	
	angle *= direction;
	selection_layer.rotate(angle, transform_bounds.position);
	transform_bounds.rotate(angle, transform_bounds.position);
	
	rotate.prevPoint = event.point;
}

rotate.onMouseUp = function(event) {
	resetSelection();
}
