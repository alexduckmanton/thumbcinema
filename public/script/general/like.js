var like = {};
like.init = function() {
	var postID = flipbook.model.get('post_id'),
		userID = flipbook.model.get('user_id'),
		like_button = $("#like_container");
	
	like_button.on('click', function() {
		$(this).parents('li').addClass("loading");
		
		$.ajax({
			type: "POST",
			url: "/likeflipbook",
			data: {post_id: postID, user_id: userID},
			success: function(msg) {
				if (msg == 1) {
					_gaq.push(['_trackEvent', 'Flipbook', 'like', 'mouse']);
					$("#like").html( parseInt($("#like").html())+1 );
				} else {
					_gaq.push(['_trackEvent', 'Flipbook', 'like remove', 'mouse']);
					$("#like").html( parseInt($("#like").html())-1 );
				}
				like_button.toggleClass('liked');
				$(".loading").removeClass("loading");
			}
		});
	});
}
