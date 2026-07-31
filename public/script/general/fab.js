// The create button is an extended FAB — a circle with a "New" label beside it —
// while you're at the top of the page, and folds down to a plain circle once you
// start scrolling. All this does is put `scrolled` on <body>; revival.css does the
// folding, and the label collapses by max-width rather than being removed, so it
// stays in the accessibility tree throughout.
//
// Throttled with setTimeout rather than requestAnimationFrame to match gallery.js,
// which does the same thing for the infinite scroll a few files over. The class is
// only touched when the state actually changes, so the throttle is about not
// reading scrollTop on every tick, not about the write.
$(document).ready(function() {

	// Far enough that a stray trackpad nudge doesn't collapse it, close enough that
	// it has folded before the header has left the screen.
	var THRESHOLD = 48;

	var $body = $('body');
	var ticking = false;
	var scrolled = null; // null so the first update always applies

	function update() {
		var next = $(window).scrollTop() > THRESHOLD;
		if (next === scrolled) return;

		scrolled = next;
		$body.toggleClass('scrolled', next);
	}

	// A reload partway down a page restores the scroll position, so the button has
	// to start folded rather than expanded and then jump.
	update();

	$(window).on('scroll resize', function() {
		if (ticking) return;
		ticking = true;
		window.setTimeout(function() {
			ticking = false;
			update();
		}, 100);
	});

});
