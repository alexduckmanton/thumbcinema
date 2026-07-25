// Feature gate, carried over from the original header.php.
// Same Modernizr checks as 2013, minus the "skip if Chrome" shortcut the
// original used — every browser gets tested the same way now.
(function() {
	if (window.location.pathname === '/sadbrowser') return;
	if (typeof Modernizr === 'undefined') return;

	var required = [
		'fontface',
		'backgroundsize',
		'opacity',
		'rgba',
		'cssanimations',
		'csstransforms',
		'csstransforms3d',
		'csstransitions',
		'canvas',
		'localstorage'
	];

	for (var i = 0; i < required.length; i++) {
		if (!Modernizr[required[i]]) {
			location.replace('/sadbrowser');
			return;
		}
	}
})();
