// Replaces the server-side Mobile_Detect.php that used to set $GLOBALS['isMobile']
// and $GLOBALS['isTablet'] before the page rendered. Same two questions, asked
// client side: is this a touch device, and is it a phone (too small to draw on).
window.TCDevice = (function() {
	var ua = navigator.userAgent;

	var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
	var isTablet = /iPad/i.test(ua) ||
		(/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
		(/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1); // iPadOS masquerades as desktop Safari
	var isPhone = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua);

	return {
		isTouch: isTouch,
		isTablet: isTablet,
		isPhone: isPhone
	};
})();
