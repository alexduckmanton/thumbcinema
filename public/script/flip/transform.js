var transform = new Tool();
transform.create = function() {
	transform.deactivate = function() {
		
	}
	
	transform.init = function() {
		if (transformType == "push") {
	/* 		nudge.deactivate(); */
			resetSelection();
		}
		
		return true;
	}
	
	transform.onKeyDown = function(event) {
		// will block typing into the form otherwise
		if (!flipbook.model.get('active')) return;
		
		event.preventDefault();
		var key = event.key;
		
		switch (key) {
			case 'option':
				transform_bounds.strokeColor = "#3c2";
				break;
			case 'delete':
				deleteSelection();
				break;
			case 'backspace':
				deleteSelection();
				break;
			case 'escape':
				clearSelection();
				break;
		}
	}
	
	transform.onKeyUp = function(event) {
		if (event.key == 'option') {
			transform_bounds.strokeColor = selected.strokeColor;
		}
	}
	
	transform.onMouseMove = function(event) {
		getTransformState(event.point);
	}
	
	transform.onMouseDown = function(event) {
		if ( Key.isDown('option') && transformType != "push" ) {
			duplicateSelection();
	/* 		undo.removeChildren(); */
		}
		
		getTransformState(event.point);
		if (transformType != "none") {
	/* 		flipbook.canvas.set_undo(); */
			setTransformState(event.point);
		} else {
	/* 		clearUndo(); */
			if ( !Key.isDown('shift') ) clearSelection();
			var selectionHitResult = selection_layer.hitTest(event.point, initSelect);
			if (selectionHitResult) { //deselect
				canvas_layer.addChild(selectionHitResult.item);
			} else { //select
				hitResult = canvas_layer.hitTest(event.point, initSelect);
				if (hitResult) {
					selection_layer.addChild(hitResult.item);
					selection_layer.lastChild.strokeColor = highlight_color;
				}
			}
			guide_layer.activate();
			var init_size = 5;
			var rectangle = new Rectangle(event.point.subtract(init_size/2), new Size(init_size, init_size));
			marquee = new paper.Path.Rectangle(rectangle);
			marquee.style = select;
			canvas_layer.activate();
		}
		
		showLayer(selection_layer);
	}
	
	transform.onMouseDrag = function(event) {
		if ( !Key.isDown('shift') ) clearSelection();
		
		marquee.remove();
		guide_layer.activate();
		var rectangle = new Rectangle(event.downPoint.subtract(.5), event.point.add(.5));
		marquee = new paper.Path.Rectangle(rectangle);
		marquee.style = select;
		canvas_layer.activate();
		
		// select items
		currentChild = canvas_layer.firstChild;
		while (currentChild) {
			var tempChild = currentChild.nextSibling;
			if ( marquee.bounds.intersects(currentChild.bounds) ) {
				//is inside the bounds of selection, now check segments for precision
				for (var i = 0; i < currentChild.segments.length; i++) {
					if (currentChild.segments[i].point.isInside(marquee.bounds)) {
						selection_layer.addChild(currentChild);
						selection_layer.lastChild.strokeColor = highlight_color;
						i = currentChild.segments.length;
					}
				}
			}
			currentChild = tempChild;
		}
		
		showLayer(selection_layer);
	}
	
	transform.onMouseUp = function(event) {
		resetSelection();
		
		flipbook.canvas.clear_undo();
	}
}

var marquee, transform_bounds, transformType, state;
var transformType = "none";

//hit test properties
var initSelect = {
	fill: false,
	bounds: false,
	stroke: true,
	tolerance: 10
};
var transformSelect = {
	fill: true,
	bounds: true,
	stroke: true,
	tolerance: 50
};

//selection styles
var select = {
	strokeColor: "#ccc",
	strokeWidth: 1,
	dashArray: [4, 2]
};
var selected = {
	strokeColor: "#29f",
	fillColor: new GrayColor(0, 0),
	strokeWidth: 1,
	dashArray: [4, 2]
};
var highlight_color = "#29f";
var pencil_color = "#444"

clearSelection = function() {
	if (marquee) marquee.remove();
	if (transform_bounds) transform_bounds.remove();
	
	for (var i = 0; i < selection_layer.children.length; i++) {
		selection_layer.children[i].copyTo(canvas_layer);
		canvas_layer.lastChild.strokeColor = pencil_color;
	}
	selection_layer.removeChildren();
	canvas_layer.activate();
	showLayer(canvas_layer);
	
	transformType = "none";
	setCursor("auto");
	
	//update the canvas
	paper.view.draw();
}

resetSelection = function() {
	if (marquee) marquee.remove();
	transform.activate();

	guide_layer.activate();
	guide_layer.removeChildren();
	if (selection_layer.children.length) {
		var rectangle = new Rectangle(selection_layer.bounds.topLeft.round().subtract(.5), selection_layer.bounds.bottomRight.round().add(.5));
		transform_bounds = new paper.Path.Rectangle(rectangle);
		transform_bounds.style = selected;
	
		setTransformTolerance(rectangle);
	}
	
	if ( Key.isDown('option') ) transform_bounds.strokeColor = "#3c2";
	
	// set style
	selection_layer.strokeColor = pencil_color;
	if ( selection_layer.children.length > 0 ) {
		fadeOutCanvas();
	} else {
		showLayer(canvas_layer);
	}
	
	selection_layer.activate();
	paper.view.draw();
}

setTransformTolerance = function(selection) {
	var selectionWidth = selection.width;
	var selectionHeight = selection.height;
	var newTolerance = Math.sqrt(Math.min(selectionWidth, selectionHeight));
	newTolerance = Math.ceil(newTolerance);
	
	transformSelect.tolerance = newTolerance;
}

setCursor = function (cursorType) {
	$("#activePage").css('cursor', cursorType);
}

getTransformState = function(point) {
	//reset transform
	transformType = "none";
	setCursor("auto");
	
	if (selection_layer.children.length <= 0 || Key.isDown('shift')) return;
	
	//rotation detect
	if ( isWithinOuterRadius(transform_bounds, point, 100) ) {
		transformType = "rotate";
		setCursor("alias");
	}
	
	transformHandle = transform_bounds.hitTest(point, transformSelect);
	if (transformHandle) {
		if ( transform_bounds.bounds.contains(point) ) {
			transformType = "translate";
			setCursor("move");
		} else {
			transformType = transformHandle.type;
			var draggedCorner = findDraggedCorner();
			if (draggedCorner !== false) {
					//default to scaling
					transformType = "scale";
					if (draggedCorner == 1 || draggedCorner == 3) setCursor("nwse-resize");
					else setCursor("nesw-resize");
			}
			else if (transformType == "stroke" || 
					 transformType == "bounds" ) {
				transformType = "stretch";
				var draggedEdge = findDraggedEdge();
				if (draggedEdge == 0 || draggedEdge == 2) setCursor("ew-resize");
				else setCursor("ns-resize");
			}
		}
	}
}

setTransformState = function(point) {
	switch(transformType) {
		case 'translate':
			translate.activate();
			translate.prevPoint = point;
			break;
		case 'scale':
			scale.activate();
			break;
		case 'rotate':
			rotate.activate();
			rotate.prevPoint = point;
			break;
		case 'stretch':
			stretch.activate();
			break;
		default:
			transformType = 'none';
	}
}

isWithinOuterRadius = function(object, point, threshold) {
	var outerRadius = new Rectangle(object.position.x, object.position.y, object.bounds.width+threshold, object.bounds.height+threshold);
	outerRadius.x = outerRadius.x - outerRadius.width/2
	outerRadius.y = outerRadius.y - outerRadius.height/2
		
	if ( outerRadius.contains(point) ) return true;
	
	return false;
}

findDraggedEdge = function() {
	var draggedEdge = false;
	if (transformHandle.type == "stroke") {
		draggedEdge = transformHandle.location.index;
	} else {
		switch (transformHandle.name) {
			case "left-center":
				draggedEdge = 0;
				break;
			case "top-center":
				draggedEdge = 1;
				break;
			case "right-center":
				draggedEdge = 2;
				break;
			case "bottom-center":
				draggedEdge = 3;
				break;
		}
	}
	return draggedEdge;
}

findDraggedCorner = function() {
	var draggedCorner = false;
	switch (transformHandle.name) {
		case "bottom-left":
			draggedCorner = 0;
			break;
		case "top-left":
			draggedCorner = 1;
			break;
		case "top-right":
			draggedCorner = 2;
			break;
		case "bottom-right":
			draggedCorner = 3;
			break;
	}
	return draggedCorner;
}

duplicateSelection = function() {
	for (var i = 0; i < selection_layer.children.length; i++) {
		selection_layer.children[i].copyTo(canvas_layer);
	}
	fadeOutCanvas();
}

deleteSelection = function() {
	var currentChild = selection_layer.firstChild;
	while (currentChild) {
		var tempChild = currentChild.nextSibling;
		currentChild.remove();
		currentChild = tempChild;
	}
	
	clearSelection();
}

transform.hideSelection = function() {
	if (transform_bounds) {
		transform_bounds.opacity = 0;
		if (transformType == "push") {
			selection_layer.strokeColor = pencil_color;
			pushDots.opacity = 0;
		}
		showLayer(canvas_layer);
		
		flipbook.canvas.update();
	}
}

transform.showSelection = function() {
	if (transform_bounds && selection_layer.children.length > 0) {
		transform_bounds.opacity = 1;
		if (transformType == "push") {
			selection_layer.strokeColor = highlight_color;
			pushDots.opacity = 1;
		}
		fadeOutCanvas();
		
		flipbook.canvas.update();
	}
}

showLayer = function(layer) {
	for (var i = 0; i < layer.children.length; i++) {
		if (layer.children[i]) layer.children[i].opacity = 1;
	}
}

fadeOutCanvas = function() {
	for (var i = 0; i < canvas_layer.children.length; i++) {
		canvas_layer.children[i].opacity = .2;
	}
}
