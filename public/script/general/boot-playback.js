// Boots playback for a single flipbook. Replaces single.php, which used to inline
// the post's title, author and attachment URLs straight into the page. Now the
// same fields are fetched from the API and handed to the same Backbone model.
(function() {

	var id = flipbookIdFromPath();

	if (!id) {
		showMissing();
		return;
	}

	$.ajax({
		url: '/api/flipbooks/' + encodeURIComponent(id),
		dataType: 'json'
	}).done(function(flip) {
		document.title = flip.title || 'thumbcinema';
		$('#flipbookTitle').text(flip.title || '');
		$('#flipbookDescription').text(flip.description || '');
		$('#views').text(flip.views);

		// Nothing for anyone but the administrator; returns null otherwise.
		var adminControls = TCAdmin.controls(flip);
		if (adminControls) $('#adminControls').append(adminControls);

		// Two generations of saved data. 2012-early 2013 flipbooks are paper.js
		// segment JSON and get redrawn stroke by stroke; everything after is SVG.
		var dataAttr = flip.format === 'legacy-json' ? 'data_json' : 'data_xml';

		var model = {
			logged_in: true,
			post_id: flip.id,
			title: flip.title || '',
			thumb_url: flip.thumbnail_url,
			is_touch: TCDevice.isTouch,
			type: 'playback',
			loading: true
		};

		start(model, dataAttr, flip.data_url);

	}).fail(function() {
		showMissing();
	});


	function start(model, dataAttr, dataUrl) {
		// Deliberately built WITHOUT the artwork URL — see below.
		var boot = function() {
			window.flipbook = new TC.Views.Flipbook({
				model: new TC.Models.Flipbook(model)
			});

			// data.js fires its fetch from inside the constructor, but sets up the
			// pencil that legacy flipbooks are redrawn with via _.defer(). That's a
			// race: whichever lands first wins. In 2013 WordPress took tens of
			// milliseconds to serve the artwork so the pencil always won. A local
			// server or a warm CDN answers in ~3ms and the fetch wins instead,
			// which threw inside the jQuery success handler and left every 2012
			// flipbook stuck on the loading spinner.
			//
			// So the constructor gets no URL and its load() is a no-op. One tick
			// later the deferred setup has definitely run, and we start the load
			// ourselves. No original file needs touching.
			_.defer(function() {
				flipbook.data.model.set(dataAttr, dataUrl);
				flipbook.data.load();
			});
		};

		// window.onload may already have fired by the time the metadata lands
		if (document.readyState === 'complete') boot();
		else window.onload = boot;
	}


	function flipbookIdFromPath() {
		var match = /^\/f\/([^\/?#]+)/.exec(window.location.pathname);
		return match ? decodeURIComponent(match[1]) : null;
	}

	function showMissing() {
		$(function() {
			$('#content').removeClass('loading');
			$('#book, #tray, #info').hide();
			$('#flipbookMissing').show();
		});
	}

})();
