$(document).ready(function() {
	
	$(".login").click(function() {
		_gaq.push(['_trackEvent', 'Login Form', 'show', 'mouse']);
		$("#nav").removeClass("active").addClass("inactive");
		
		$("#loginForm").removeClass("inactive").addClass("active");
		$("#sidebar-user-login").focus();
	});
	
	$("#cancel a").click(function() {
		_gaq.push(['_trackEvent', 'Login Form', 'hide', 'mouse']);
		hideLogin();
	});
	
	$("#signupBtn").click(function() {
		_gaq.push(['_trackEvent', 'Signup Form', 'show', 'mouse']);
		$("#signup").addClass("show")
		$("#signup_username").focus();
	});
	
	$("#signup .cancel, #signupBG").click(function() {
		_gaq.push(['_trackEvent', 'Signup Form', 'hide cancel and background', 'mouse']);
		hideSignup();
	});
	
	
	$(document).keydown(function(e) {
		var keypressed = String.fromCharCode(e.which);
		
		if ( e.which == 27 /* ESCAPE */) {
			if ($("#signup").hasClass("show")) {
				_gaq.push(['_trackEvent', 'Signup Form', 'hide esc', 'keyboard']);
				hideSignup();
			} else if ($("#loginForm").hasClass("active")) {
				_gaq.push(['_trackEvent', 'Login Form', 'hide esc', 'keyboard']);
				hideLogin();
			} else if ($("#messages").hasClass("active")) {
				_gaq.push(['_trackEvent', 'Messages', 'hide esc', 'keyboard']);
				hideMessage();
			}
		} else if (e.which == 13 /* RETURN */) {
			if ($("#messages").hasClass("active")) {
				_gaq.push(['_trackEvent', 'Messages', 'hide enter', 'keyboard']);
				hideMessage();
				e.preventDefault();
			}
		} else if (keypressed == " ") {
			_gaq.push(['_trackEvent', 'Messages', 'hide space', 'keyboard']);
			if ($("#messages").hasClass("active")) {
				hideMessage();
				e.preventDefault();
			}
		}
	});
	
	
	$("#sign_out").click(function() {
		_gaq.push(['_trackEvent', 'Login Form', 'log out', 'mouse']);
		registerMessage({
			copy: "Goodbye! Don't be a stranger.",
			cta: "Cya!",
			type: 'info'
		});
	});
	
	
	$("body").on('submit', '.signup_form', function (e) {
		e.preventDefault();
		
		var form = $(this).attr("id");
		form = $("#"+form);
		
		form.find(".error").removeClass("error");
		
		var submitButton = form.find("#signup_submit");
		if ( submitButton.hasClass("loading") ) return;
		submitButton.addClass('loading');

		var s_form = form.serializeArray();
		formData = new FormData();
		formData.append("signup_username", s_form[0].value);
		formData.append("signup_password", s_form[1].value);
		formData.append("signup_password_confirm", s_form[2].value);
		formData.append("signup_email", s_form[3].value);
		formData.append("signup_submit", "");
		formData.append("_wpnonce", s_form[4].value);
		formData.append("_wp_http_referer", s_form[5].value);
		
		$.ajax({
			url: rootURL+'register',
			data: formData,
			processData: false,
			contentType: false,
			type: 'POST',
			success: function ( msg ) {
				if (msg) {
					var firstErrorField = parseErrors(form, msg);
					firstErrorField.focus();
				
					submitButton.removeClass('loading');
				} else {
					if (isCreate && $('.saving').length) {
						$(".showAccountForms").removeClass("showAccountForms");
						flipbook.data.trigger('save');
					} else {
						_gaq.push(['_trackEvent', 'Signup Form', 'complete']);
						registerMessage({
							copy: "Great success! You're logged in and ready to go.",
							cta: "Awesome",
							type: 'success'
						});
						
						window.location.href = $("input[name=_wp_http_referer]").attr("value");
					}
				}
			}
		});
	});
	
	
	$("body").on('submit', '.login-form', function (e) {
		e.preventDefault();
		
		var form = $(this).attr("id");
		form = $("#"+form);
		
		form.find(".error").removeClass("error");
		
		var submitButton = form.find("button[type=submit]");
		if ( submitButton.hasClass("loading") ) return;
		submitButton.addClass("loading");
		
		var formData = form.serializeArray();
		
		var rememberMe = formData[2].value;
		if (rememberMe == "forever") rememberMe = true;
		else rememberMe = false;
		
		$.ajax({
			url: rootURL+'signon',
			data: {user: formData[0].value, password: formData[1].value, remember: rememberMe},
			type: 'POST'
		}).done(function ( msg ) {
			if (msg.indexOf("m_success") == -1) {
				if (isCreate && book.saving) {
					form.find(".errorMsg").parent().addClass("error");
					form.find(".errorMsg").first().focus();
					
					submitButton.removeClass('loading');
				} else {
					_gaq.push(['_trackEvent', 'Login Form', 'error username_password', 'keyboard']);
					showMessage({
						copy: "Gosh dernit, I couldn't log you in. Try your username and password again.",
						cta: "Dang.",
						type: 'error', 
						prevActive: 'loginForm'
					});
				}
			} else {
				if (isCreate && $('.saving').length) {
					$(".showAccountForms").removeClass("showAccountForms");
					flipbook.data.trigger('save');
				} else {
					registerMessage({
						copy: "Welcome back! I missed you.",
						cta: "Awww shucks",
						type: 'info'
					});
					
					window.location.href = $("input[name=_wp_http_referer]").attr("value");
				}
			}
		}).fail(function( msg ) {
			var message = "Oh man, something went wrong. And when I say something, I mean I have no idea.";
			var callToAction = "That's not helpful.";
			switch(msg.status) {
				case 404:
					message = "I can't find the login page! What's going on? Where am I?";
					callToAction = "Calm down, website.";
					break;
				case 500:
					message = "I can't log you in until I find my missing semicolon.";
					callToAction = "Here it is! Jokes, no it isn't.";
					break;
				case 503:
					message = "Can't log you in right now. I'm at the doctor. Check back later.";
					callToAction = "Get well soon";
					break;
				case 509:
					message = "I couldn't eat another thing. I'm absolutely stuffed.";
					callToAction = "It's only wafer thin.";
					break;
			}
			showMessage({
				copy: message,
				cta: callToAction,
				type: 'error', 
				prevActive: 'loginForm'
			});
		});
	});
	
	$("#header").on('click', '.message a', function(e) {
		hideMessage();
		e.preventDefault();
	});

	showMessages();
	
	//make sure clicking anywhere on the banner will send you to the create page
	$("#cta").on("click", function() {
		window.location.href = $(this).children("a").attr("href");
	});
	$("#cta").on("click", "a", function(e) {
		e.stopPropagation();
	});
	
});

function parseErrors(container, msg) {
	msg = msg.split("|");
	msg.splice(msg.length-1, 1);
	
	for (var i = 0; i < msg.length; i++) {
		msg[i] = msg[i].split("-");
		var label = msg[i][0];
		var message = msg[i][1];
		
		_gaq.push(['_trackEvent', 'Signup Form', 'error '+message]);
		container.find('label[for='+ label +']').last().html(message).parent().addClass("error");
		if (label == "signup_password") container.find('label[for='+ label +'_confirm]').last().html(message).parent().addClass("error");
	}
	
	return $('label[for='+ msg[0][0] +']');
}

function hideSignup() {
	$("#signup").removeClass("show");
	$("#signup .error").removeClass("error");
	$("#signup input").blur();
}

function hideLogin() {
	$("#loginForm").removeClass("active").addClass("inactive");
	$("#nav").removeClass("inactive").addClass("active");
	$("#loginForm input").blur();
}

// copy + cta + type(info/success/error)
function showMessage(message) {
	if (!message.copy || !message.cta || !message.type) return;
	if (message.prevActive == null) message.prevActive = "nav";
	
	var copy = message.copy.split(" ");
	message.copy = '';
	for (var i = 0; i < copy.length; i++) {
		message.copy += '<li class="message '+ message.type +'">';
		message.copy += copy[i];
		message.copy += '&nbsp;</li>';
	}
	
	$("#messages").html(message.copy + '<li class="message '+ message.type +'"><a href="javascript:void(0)">'+ message.cta +'</a></li>');
	
	window.setTimeout(function() {
		$(".message a").attr("href", "#" + message.prevActive);
		
		$("#header ul.active").removeClass("active").addClass("inactive");
		if ( $("#header ul.inactive").length < 1 ) $("#nav").addClass("inactive");
		
		$("#messages").removeClass("inactive").addClass("active");
		$("#messagesBG").removeAttr("class").addClass(message.type);
	}, 10);
}

function hideMessage() {
	var prevActive = $(".message a").attr("href");
	
	if (prevActive == null) var prevActive = "#nav";
	if (prevActive == "#loginForm") {
		$("#sidebar-login-form .loading").removeClass('loading');
		$("#sidebar-user-login").focus();
	}
	
	$("#messagesBG").removeAttr("class");
	$("#messages").removeClass("active").addClass("inactive");
	$(prevActive).removeClass("inactive").addClass("active");
}

function registerMessage(message) {
	if (!message.copy || !message.cta || !message.type) return;
	
	message = JSON.stringify(message);
	localStorage["message"] = message;
}

function showMessages() {
	if ( !localStorage["message"] ) return;
	var message = JSON.parse(localStorage["message"]);
	
	showMessage(message);
	clearMessages();
}

function clearMessages() {
	localStorage.removeItem("message");
}







