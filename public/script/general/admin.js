// Admin mode.
//
// There are no accounts on this site — that whole layer was deliberately deleted —
// so curation is gated on a single shared secret instead. Visit any page with
// ?admin=<token> once and it's remembered in localStorage; from then on the two
// toggles below appear on gallery cards and on flipbook pages, and every write is
// sent with an Authorization header the API checks.
//
// The toggles reuse the 2013 icon sprite: the heart that used to mean "liked" now
// means featured, and the report flag that used to mean "somebody reported this"
// now means NSFW — which hides the flipbook from both browse tabs while leaving it
// reachable on its own URL, exactly as reporting did.
window.TCAdmin = (function() {

	var STORAGE_KEY = 'tc_admin_token';

	var token = readToken();

	function readToken() {
		// ?admin=… wins, and is scrubbed from the URL immediately so the token
		// doesn't sit in the address bar during a screen share.
		var match = /[?&]admin=([^&]+)/.exec(window.location.search);
		if (match) {
			var supplied = decodeURIComponent(match[1]);
			try { localStorage.setItem(STORAGE_KEY, supplied); } catch (e) {}

			var clean = window.location.pathname +
				window.location.search.replace(/([?&])admin=[^&]*&?/, '$1').replace(/[?&]$/, '');
			if (window.history.replaceState) window.history.replaceState({}, '', clean);

			return supplied;
		}

		try { return localStorage.getItem(STORAGE_KEY) || null; } catch (e) { return null; }
	}

	function isEnabled() {
		return !!token;
	}

	function signOut() {
		try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
		token = null;
	}

	// Sent on reads too: it's what makes NSFW flipbooks visible in the All tab, so
	// anything moderated can still be found and un-flagged.
	function headers() {
		return token ? { Authorization: 'Bearer ' + token } : {};
	}

	/**
	 * Builds the toggle pair for one flipbook.
	 * onChange(flip) fires after a successful write, with the updated flags.
	 */
	function controls(flip, onChange) {
		if (!isEnabled()) return null;

		var $wrap = $('<span class="tc-admin"></span>');

		var $featured = toggle('featured', flip.featured,
			'icon-heart-grey', 'icon-heart-blue',
			'Featured on the home page');

		var $nsfw = toggle('nsfw', flip.nsfw,
			'icon-report-grey', 'icon-report-red',
			'Adult content — hidden from both tabs');

		$wrap.append($featured).append($nsfw);

		function toggle(field, initial, offClass, onClass, title) {
			var $el = $('<span class="tc-admin-toggle"></span>')
				.attr('title', title)
				.addClass(initial ? onClass : offClass)
				.data('on', !!initial);

			$el.on('click', function(e) {
				// Gallery cards are anchors; don't navigate.
				e.preventDefault();
				e.stopPropagation();

				if ($el.hasClass('busy')) return;
				$el.addClass('busy');

				var next = !$el.data('on');
				var payload = {};
				payload[field] = next;

				$.ajax({
					url: '/api/admin/flipbooks/' + encodeURIComponent(flip.id),
					type: 'PATCH',
					contentType: 'application/json',
					headers: headers(),
					data: JSON.stringify(payload)
				}).done(function(updated) {
					$el.data('on', updated[field])
						.toggleClass(onClass, !!updated[field])
						.toggleClass(offClass, !updated[field]);

					flip.featured = updated.featured;
					flip.nsfw = updated.nsfw;

					if (onChange) onChange(updated);
				}).fail(function(xhr) {
					if (xhr.status === 401 || xhr.status === 404) {
						showMessage({
							copy: "That admin token isn't working any more.",
							cta: 'Fine',
							type: 'error'
						});
						signOut();
					} else {
						showMessage({
							copy: "Couldn't save that. Try again?",
							cta: 'Dang',
							type: 'error'
						});
					}
				}).always(function() {
					$el.removeClass('busy');
				});
			});

			return $el;
		}

		return $wrap;
	}

	return {
		isEnabled: isEnabled,
		headers: headers,
		controls: controls,
		signOut: signOut
	};

})();
