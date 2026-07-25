// Boots the drawing tool. This is the window.onload block that used to be inlined
// into create.php by WordPress, with the PHP device detection swapped for TCDevice.
(function() {

	// Phones were always turned away — the canvas needs a real pointer and some room.
	if (TCDevice.isPhone && !TCDevice.isTablet) {
		location.replace('/');
		return;
	}

	if (TCDevice.isTablet) {
		document.getElementById('book').className = 'tablet';
	}

	window.onload = function() {
		window.flipbook = new TC.Views.Flipbook({
			model: new TC.Models.Flipbook({
				logged_in: true, // no accounts any more; everyone saves as themselves
				is_touch: TCDevice.isTouch
			})
		});

		// for safari autofill
		window.setTimeout(function() { $('input').blur(); }, 1000);
	};

})();
