var eraser = new Tool();

var eraser_style = {
	segments: true,
	fill: false,
	stroke: false,
	tolerance: 10
};

function erase(event, hitResult) {
	if ( hitResult.type == "segment" ) {
		if ( hitResult.item.segments.length <= 2 ) {
			hitResult.item.remove();
			return;
		}
		
		// begining or end of a line
		if ( hitResult.segment.index == 0 ) {
			hitResult.segment.remove();
		}
		
		// middle of a line
		else {
			splitLine(hitResult.item, hitResult.segment.index);
		}
	}
	hitResult = canvas_layer.hitTest(event.point, eraser_style);
	if (hitResult) erase(event, hitResult);
}

function splitLine(item, deadSegment) {
	if (deadSegment > 1) {
		path = new paper.Path();
		path.style = item.style;
		for (var i = 0; i < deadSegment; i++) {
			path.add(item.segments[i].point);
		}
	}
	
	if (item.segments.length - deadSegment > 2) {
		path = new paper.Path();
		path.style = item.style;
		for (var i = deadSegment+1; i < item.segments.length; i++) {
			path.add(item.segments[i].point);
		}
	}
	
	item.remove();
}

eraser.deactivate = function() {
	
}

eraser.init = function() {
	clearSelection();
	canvas_layer.activate();
	
	return true;
}

eraser.onMouseDown = function(event) {
	flipbook.canvas.set_undo();
	
	//erase
	hitResult = canvas_layer.hitTest(event.point, eraser_style);
	if (hitResult) erase(event, hitResult);
}

eraser.onMouseDrag = function(event) {
	//erase
	hitResult = canvas_layer.hitTest(event.point, eraser_style);
	if (hitResult) erase(event, hitResult);
}
