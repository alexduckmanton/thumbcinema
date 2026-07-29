// The browse grid. Replaces the WordPress loop that lived in index.php, emitting
// the same markup so _browse.scss's nth-child mosaic still lays out correctly.
//
// One change from 2013: an infinite scroll where it used to have prev/next links.
// Like the original it shows one list — featured only.
$(document).ready(function() {

	var PAGE_SIZE = 24;

	// How far from the bottom to start fetching. Roughly a screen and a half, so the
	// next rows are usually already there by the time you reach them.
	var PREFETCH_PX = 1200;

	var cursor = null;
	var loading = false;
	var exhausted = false;
	var rendered = 0;

	var $container = $('#postContainer');
	var $loading = $('#galleryLoading');
	var $loadMore = $('#loadMore');

	loadNextPage();

	// --- loading ------------------------------------------------------------

	function loadNextPage() {
		if (loading || exhausted) return;
		loading = true;

		$loadMore.hide();
		$loading.show();

		$.ajax({
			url: '/api/flipbooks',
			data: { view: 'featured', limit: PAGE_SIZE, cursor: cursor || undefined },
			headers: TCAdmin.headers(),
			dataType: 'json'
		}).done(function(res) {
			append(res.items);
			rendered += res.items.length;
			cursor = res.next_cursor;
			if (!cursor) exhausted = true;

			if (!rendered) $('#galleryEmpty').show();

		}).fail(function() {
			exhausted = true; // don't hammer a failing endpoint on every scroll tick

			if (!rendered) $('#galleryError').show();
			else $loadMore.show(); // partial grid: let them retry by hand

		}).always(function() {
			loading = false;
			$loading.hide();
			maybeLoadMore();
		});
	}

	function append(items) {
		if (!items.length) return;

		var $batch = $();

		for (var i = 0; i < items.length; i++) {
			var item = items[i];

			var $card = $('<a class="post"></a>')
				.attr('href', '/f/' + encodeURIComponent(item.id))
				.css('background-image', 'url(' + item.thumbnail_url + ')')
				.append($('<span class="title"></span>').text(item.title || ''));

			// Admin toggles live in .icons, which _browse.scss already positions in
			// the card's top-right corner and reveals on hover.
			var $admin = TCAdmin.controls(item, function() {});
			if ($admin) $card.append($('<span class="icons"></span>').append($admin));

			$batch = $batch.add($card);
		}

		$container.append($batch);
	}

	// --- infinite scroll ----------------------------------------------------

	// IntersectionObserver would be tidier, but this codebase is jQuery 1.9 and a
	// throttled scroll handler keeps it in period and works everywhere the rest of
	// the site does. The button is the fallback when a fetch fails.
	var ticking = false;
	$(window).on('scroll resize', function() {
		if (ticking) return;
		ticking = true;
		window.setTimeout(function() {
			ticking = false;
			maybeLoadMore();
		}, 150);
	});

	// The manual retry after a failed fetch. A failure sets `exhausted` so a scroll
	// tick doesn't hammer a broken endpoint, so clear it before trying again.
	$loadMore.on('click', function() {
		exhausted = false;
		loadNextPage();
	});

	function maybeLoadMore() {
		if (loading || exhausted) return;

		var distanceFromBottom = $(document).height() - ($(window).scrollTop() + $(window).height());
		if (distanceFromBottom < PREFETCH_PX) loadNextPage();
	}

});
