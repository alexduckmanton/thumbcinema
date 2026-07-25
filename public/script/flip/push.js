var nudge = new Tool();

var mouse = new Point(0,0);

var pushRadius, pushDots, pushSegments, pushDotsVisibility;

do_nudge = function() {
	pushDots.opacity = pushDotsVisibility;
	pushRadius.position.x = mouse.x;
	pushRadius.position.y = mouse.y;
	pushDots.removeChildren();
	pushSegments = [];
	
	for (var i = 0; i < selection_layer.children.length; i++) {
		var currentChild = selection_layer.children[i];
		if ( pushRadius.bounds.intersects(currentChild.bounds) ) {
		
			for (var j = 0; j < selection_layer.children[i].segments.length; j+=2) {
				var currentSegment = selection_layer.children[i].segments[j];
				
				if ( pushRadius.bounds.contains(currentSegment.point) ) {
					pushSegments.push(selection_layer.children[i].segments[j]);
					if (selection_layer.children[i].segments[j+1]) pushSegments.push(selection_layer.children[i].segments[j+1]);
					
					var distance = currentSegment.point.getDistance(mouse, false);
					var distancePercent = 1-distance/(pushRadius.bounds.width/2);
					distancePercent = Math.sqrt(distancePercent);
					if (distancePercent > .75) distancePercent = .75;
					distancePercent = Math.max(distancePercent, 0);
					pushDots.addChild( new paper.Path.Circle(currentSegment.point, 5*distancePercent) );
 					pushDots.lastChild.fillColor = "#29f";
				}
			}
		}
	}
}

nudge.deactivate = function() {
	transformType = "none";
	selection_layer.strokeColor = "";
	if (pushRadius) pushRadius.remove();
	if (pushDots) pushDots.remove();
	resetSelection();
}

nudge.init = function(e) {
	if (selection_layer.children.length == 0) return false;
	
	transformType = "push";
	transform_bounds.visible = false;
	selection_layer.strokeColor = "#29f";
	guide_layer.activate();
	
	var pushRadius_origin = new Point(-999,-999);
	pushRadius = new paper.Path.Rectangle(pushRadius_origin, 100);
	
	pushDots = new Group();
	if (flipbook.model.get('is_touch')) pushDotsVisibility = 0;
	else pushDotsVisibility = 1;
	
	paper.view.draw();
	
	return true;
}

nudge.onMouseDown = function(event) {
	mouse = event.point;
	flipbook.canvas.set_undo();
	do_nudge();
}

nudge.onMouseMove = function(event) {
	mouse = event.point;
	setCursor("move");
	do_nudge();
}

nudge.onMouseDrag = function(event) {
	pushDots.opacity = 0;
	for (var i = 0; i < pushSegments.length; i++) {
		var tIndex = Math.floor(i/2)
		var tolerance = pushDots.children[tIndex].bounds.width;
		if (i%2 == 1 && tIndex < pushDots.children.length-1) tolerance = (tolerance + pushDots.children[tIndex+1].bounds.width)/2; //average value between dots
		else if (tIndex == pushDots.children.length) tolerance = 0;
		
		if (!tolerance) tolerance = 0; // remove NaN values
		else tolerance = tolerance/2/5; // use radius and account for dot scaling
		
		tolerance *= tolerance;
		
		var xDist = (event.point.x - event.lastPoint.x)*tolerance;
		var yDist = (event.point.y - event.lastPoint.y)*tolerance;
		
		pushSegments[i].point.x += xDist;
		pushSegments[i].point.y += yDist;
	}
}

nudge.onMouseUp = function(event) {
	completePaths(selection_layer);
	do_nudge();
	
	//clear
	if (event.lastPoint.equals(event.point) && pushDots.children < 5) {
		flipbook.toolbox.reset_active();
		clearSelection();
	}
}
