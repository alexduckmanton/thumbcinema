$(document).ready(function() {
	
	$("#settings-form").submit(function (e) {
		e.preventDefault();
		
		var form = $(this).attr("id");
		form = $("#"+form);
		
		form.find(".error").removeClass("error");
		
		var submitButton = form.find("#settings-submit");
		if ( submitButton.hasClass("loading") ) return;
		submitButton.addClass('loading');
		
		var formData = document.getElementById(form.attr("id"));
		var formData = new FormData(formData);
		
		$.ajax({
			url: '/updateProfile',
			data: formData,
			processData: false,
			contentType: false,
			type: 'POST',
			success: function ( msg ) {
				if (msg.indexOf("success") != -1) {
					registerMessage({
						copy: "Your profile's looking gooooooood.",
						cta: "Heck yeah it is",
						type: "success"
					});
					
					location.reload();
				} else {
					var firstErrorField = parseErrors(form, msg);
					firstErrorField.focus();
					submitButton.removeClass('loading');
				}
			}
		});
	});
	
	$("#account-delete-form").submit(function(e) {
		registerMessage({
			copy: "Come back soon. Can't we still be friends?",
			cta: "Awww friend",
			type: "info"
		});
	});
	
	$("#postContainer").on("click", ".icons", false);
	$("#postContainer").on("click", ".edit_flipbook", true);
	$("#postContainer").on("click", ".trash", confirm_delete);
	$("#postContainer").on("click", ".confirm_delete", cancel_delete);
	$("#postContainer").on("click", ".confirm .button", delete_flipbook);
	
});

confirm_delete = function(e) {
	e.preventDefault();
	var flipbook = $(this).parents(".post");
	
	flipbook.addClass("confirm_delete");
}

cancel_delete = function(e) {
	e.preventDefault();
	flipbook = $(this);
	
	if ( flipbook.hasClass("confirm_delete") ) {
		flipbook.removeClass("confirm_delete");
	}
}

delete_flipbook = function(e) {
	e.preventDefault();
	e.stopPropagation();
	$(this).addClass("loading");
	var flipbook = $(this).parents(".post");
	
	var postID = flipbook.attr("id");
	postID = postID.substr(5);
	$.ajax({
		type: "POST",
		url: "/deleteflipbook",
		data: {post_id: postID}
	}).done(function(msg) {
		if (!msg) {
			post_delete_flipbook(flipbook);
		}
	}).fail(function() {
		showMessage({
			copy: "Whoa, something went wrong. Try again in a minute or so.",
			cta: "Dang",
			type: "error"
		});
		$(".loading").removeClass("loading");
	});
}

post_delete_flipbook = function(flipbook) {
	flipbook.addClass("deleted");
	var timing = flipbook.css("-o-animation-duration") || 
				 flipbook.css("-ms-animation-duration") || 
				 flipbook.css("-moz-animation-duration") || 
				 flipbook.css("-webkit-animation-duration") || 
				 flipbook.css("animation-duration");
	timing = parseFloat(timing)*1000;
	
	window.setTimeout(function() {
		flipbook.remove();
	}, timing);
}








