// The browse grid. Replaces the WordPress loop that lived in index.php, emitting
// the same markup so _browse.scss's nth-child mosaic still lays out correctly.
//
// Two changes from 2013: a Featured/All toggle where the homepage used to show only
// category 6, and an infinite scroll where it used to have prev/next links.
$(document).ready(function() {

	var PAGE_SIZE = 24;

	// How far from the bottom to start fetching. Roughly a screen and a half, so the
	// next rows are usually already there by the time you reach them.
	var PREFETCH_PX = 1200;

	var view = viewFromUrl();
	var cursor = null;
	var loading = false;
	var exhausted = false;
	var rendered = 0;

	// Bumped on every tab switch. A request carries the generation it was issued
	// under, and any response arriving after a switch is discarded — otherwise a
	// page of Featured results lands in a freshly-emptied All grid and the two
	// tabs' contents get spliced together.
	var generation = 0;

	var $container = $('#postContainer');
	var $loading = $('#galleryLoading');
	var $loadMore = $('#loadMore');

	setActiveTab(view);
	enablePillAnimation();
	loadNextPage();

	// --- tabs ---------------------------------------------------------------

	$('#viewTabs a').on('click', function(e) {
		e.preventDefault();

		var next = $(this).data('view');
		if (next === view) return;

		view = next;
		setActiveTab(view);

		// Keep the URL honest so the tab survives a refresh or a shared link.
		if (window.history.replaceState) {
			window.history.replaceState({}, '', next === 'featured' ? '/' : '/?view=all');
		}

		generation++;
		cursor = null;
		exhausted = false;
		rendered = 0;
		loading = false; // abandon anything in flight; its response will be dropped
		$container.empty();
		$('#galleryEmpty').hide();
		$('#galleryError').hide();

		loadNextPage();
	});

	function setActiveTab(active) {
		$('#viewTabs a').each(function() {
			$(this).toggleClass('active', $(this).data('view') === active);
		});

		// Drives the sliding pill. Two segments, so it's just "is it the far one".
		$('#viewTabs').toggleClass('on-all', active === 'all');
	}

	// Landing on /?view=all should show the pill already on the right, not slide it
	// there. Transitions are switched on a frame after the initial position is set.
	function enablePillAnimation() {
		window.setTimeout(function() { $('#viewTabs').addClass('ready'); }, 0);
	}

	// --- loading ------------------------------------------------------------

	function loadNextPage() {
		if (loading || exhausted) return;
		loading = true;

		var gen = generation;

		$loadMore.hide();
		$loading.show();

		$.ajax({
			url: '/api/flipbooks',
			data: { view: view, limit: PAGE_SIZE, cursor: cursor || undefined },
			headers: TCAdmin.headers(),
			dataType: 'json'
		}).done(function(res) {
			if (gen !== generation) return; // superseded by a tab switch

			append(res.items);
			rendered += res.items.length;
			cursor = res.next_cursor;
			if (!cursor) exhausted = true;

			if (!rendered) $('#galleryEmpty').show();

		}).fail(function() {
			if (gen !== generation) return;

			exhausted = true; // don't hammer a failing endpoint on every scroll tick

			if (!rendered) $('#galleryError').show();
			else $loadMore.show(); // partial grid: let them retry by hand

		}).always(function() {
			if (gen !== generation) return;

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

	// --- helpers ------------------------------------------------------------

	function viewFromUrl() {
		var match = /[?&]view=(featured|all)\b/.exec(window.location.search);
		return match ? match[1] : 'featured';
	}

});
