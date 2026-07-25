var report = {};
report.init = function() {
	var postID = flipbook.model.get('post_id'),
		userID = flipbook.model.get('user_id'),
		report_button = $("#report");
	
	report_button.on('click', function() {
		$(this).parents('li').addClass("loading");
		
		$.ajax({
			type: "POST",
			url: "/reportflipbook",
			data: {post_id: postID, user_id: userID},
			success: function(msg) {
				var reportIcon = report_button.children('span').first();
				reportIcon.toggleClass("reported");
				
				if (reportIcon.hasClass("reported")) {
					_gaq.push(['_trackEvent', 'Flipbook', 'report remove', 'mouse']);
					titleText = "Report as inappropriate";
				} else {
					_gaq.push(['_trackEvent', 'Flipbook', 'report', 'mouse']);
					titleText = "You reported this flipbook as inappropriate";
				}
				reportIcon.attr("title", titleText);
				$(".loading").removeClass("loading");
			}
		});
	});
}
